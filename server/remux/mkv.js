// Keyframe times of a Matroska file, read from its Cues (the seek index) with a few HTTP range requests,
// so the HLS playlist can cut segments exactly at keyframes without reading the file.
// keyframes(url) -> [seconds, ...] for the first video track, or null (not Matroska / no Cues).
'use strict';

const ID = {
    EBML: 0x1A45DFA3, Segment: 0x18538067, SeekHead: 0x114D9B74, Seek: 0x4DBB, SeekID: 0x53AB,
    SeekPosition: 0x53AC, Info: 0x1549A966, TimestampScale: 0x2AD7B1, Tracks: 0x1654AE6B,
    TrackEntry: 0xAE, TrackNumber: 0xD7, TrackType: 0x83, Cues: 0x1C53BB6B, CuePoint: 0xBB, CueTime: 0xB3,
    CueTrackPositions: 0xB7, CueTrack: 0xF7
};

async function range(url, start, length) {
    const r = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
    if (r.status !== 206 && r.status !== 200) throw new Error(`range ${start}: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
}

// EBML variable-length integer at b[i]: { value, length }; an ID keeps its marker bit
function vint(b, i, keepMarker) {
    const first = b[i];
    let len = 1, mask = 0x80;
    while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
    if (len > 8 || i + len > b.length) return null;
    let value = keepMarker ? first : first & (mask - 1), unknown = value === mask - 1;
    for (let k = 1; k < len; k++) { value = value * 256 + b[i + k]; if (b[i + k] !== 0xFF) unknown = false; }
    return { value: !keepMarker && unknown ? Infinity : value, length: len };
}

// child elements of b[start..end): [{ id, data, size }]; stops at a truncated element
function children(b, start, end) {
    const out = [];
    let i = start;
    while (i < end) {
        const id = vint(b, i, true); if (!id) break;
        const size = vint(b, i + id.length, false); if (!size) break;
        const data = i + id.length + size.length;
        out.push({ id: id.value, data, size: size.value });
        if (size.value === Infinity || data + size.value > end) break;
        i = data + size.value;
    }
    return out;
}

const uint = (b, e) => { let v = 0; for (let k = 0; k < e.size; k++) v = v * 256 + b[e.data + k]; return v; };
const find = (list, id) => list.find(e => e.id === id);

// a whole top-level element at an absolute file offset
async function element(url, pos) {
    const head = await range(url, pos, 16);
    const id = vint(head, 0, true), size = vint(head, id.length, false);
    const hl = id.length + size.length;
    return { id: id.value, buf: await range(url, pos + hl, size.value), };
}

async function keyframes(url) {
    const head = await range(url, 0, 65536);
    const top = children(head, 0, head.length);
    if (!find(top, ID.EBML)) return null;
    const seg = find(top, ID.Segment);
    if (!seg) return null;
    const base = seg.data;                              // positions in the SeekHead count from here
    const level1 = children(head, base, head.length);

    const pos = {};
    const seekHead = find(level1, ID.SeekHead);
    if (seekHead) for (const s of children(head, seekHead.data, seekHead.data + seekHead.size)) {
        if (s.id !== ID.Seek) continue;
        const f = children(head, s.data, s.data + s.size), id = find(f, ID.SeekID), p = find(f, ID.SeekPosition);
        if (id && p) pos[uint(head, id)] = base + uint(head, p);
    }

    // Info and Tracks are usually in the first 64 KB; else follow the SeekHead
    const body = async (id) => {
        const e = find(level1, id);
        if (e && e.data + e.size <= head.length) return head.subarray(e.data, e.data + e.size);
        return pos[id] ? (await element(url, pos[id])).buf : null;
    };
    const info = await body(ID.Info), tracks = await body(ID.Tracks);
    if (!info || !tracks || !pos[ID.Cues]) return null;

    const scale = find(children(info, 0, info.length), ID.TimestampScale);
    const ns = scale ? uint(info, scale) : 1e6;         // nanoseconds per Matroska tick

    let video = null;
    for (const t of children(tracks, 0, tracks.length)) {
        if (t.id !== ID.TrackEntry) continue;
        const f = children(tracks, t.data, t.data + t.size), type = find(f, ID.TrackType), num = find(f, ID.TrackNumber);
        if (type && num && uint(tracks, type) === 1) { video = uint(tracks, num); break; }
    }
    if (video == null) return null;

    const cues = await element(url, pos[ID.Cues]);
    if (cues.id !== ID.Cues) return null;
    const c = cues.buf, times = [];
    for (const p of children(c, 0, c.length)) {
        if (p.id !== ID.CuePoint) continue;
        const f = children(c, p.data, p.data + p.size), time = find(f, ID.CueTime);
        const onVideo = f.some(e => e.id === ID.CueTrackPositions &&
            children(c, e.data, e.data + e.size).some(x => x.id === ID.CueTrack && uint(c, x) === video));
        if (time && onVideo) times.push(uint(c, time) * ns / 1e9);
    }
    times.sort((a, b) => a - b);
    return times.length > 1 ? times : null;
}

module.exports = { keyframes };
