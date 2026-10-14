// Keyframe times of an MP4/MOV file, from its moov index (stss sync samples + stts/ctts timing + edit
// list), read with HTTP range requests: the moov may be at the start or after the media data.
// keyframes(url) -> [seconds, ...] for the video track, or null (not MP4 / every frame is a keyframe).
'use strict';

async function range(url, start, length) {
    const r = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
    if (r.status !== 206 && r.status !== 200) throw new Error(`range ${start}: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
}

function boxes(b, start, end, fn) {
    for (let i = start; i + 8 <= end;) {
        let size = b.readUInt32BE(i), head = 8;
        if (size === 1) { size = Number(b.readBigUInt64BE(i + 8)); head = 16; }
        if (size < head || i + size > end) return;
        fn(b.toString('latin1', i + 4, i + 8), i + head, i + size);
        i += size;
    }
}

const child = (b, s, e, type) => { let r = null; boxes(b, s, e, (t, a, z) => { if (!r && t === type) r = [a, z]; }); return r; };

// the moov box: scan top-level box headers until it turns up
async function moov(url) {
    let pos = 0;
    for (let n = 0; n < 64; n++) {
        const h = await range(url, pos, 16);
        if (h.length < 8) return null;
        let size = h.readUInt32BE(0);
        if (size === 1) size = Number(h.readBigUInt64BE(8));
        const type = h.toString('latin1', 4, 8);
        if (n === 0 && type !== 'ftyp') return null;
        if (type === 'moov') return range(url, pos, size);
        if (size < 8) return null;
        pos += size;
    }
    return null;
}

async function keyframes(url) {
    const m = await moov(url);
    if (!m) return null;
    let out = null;
    boxes(m, 8, m.length, (type, s, e) => {
        if (out || type !== 'trak') return;
        const mdia = child(m, s, e, 'mdia'), hdlr = mdia && child(m, mdia[0], mdia[1], 'hdlr');
        if (!hdlr || m.toString('latin1', hdlr[0] + 8, hdlr[0] + 12) !== 'vide') return;
        const mdhd = child(m, mdia[0], mdia[1], 'mdhd');
        const scale = m.readUInt32BE(mdhd[0] + (m[mdhd[0]] === 1 ? 20 : 12));
        const minf = child(m, mdia[0], mdia[1], 'minf'), stbl = minf && child(m, minf[0], minf[1], 'stbl');
        if (!stbl) return;
        const stss = child(m, stbl[0], stbl[1], 'stss');
        if (!stss) return;                                   // no table: every sample is a keyframe
        const stts = child(m, stbl[0], stbl[1], 'stts'), ctts = child(m, stbl[0], stbl[1], 'ctts');

        // presentation start: the first edit's media time
        let shift = 0;
        const edts = child(m, s, e, 'edts'), elst = edts && child(m, edts[0], edts[1], 'elst');
        if (elst && m.readUInt32BE(elst[0] + 4) > 0) {
            const v1 = m[elst[0]] === 1, t = v1 ? Number(m.readBigInt64BE(elst[0] + 16)) : m.readInt32BE(elst[0] + 12);
            if (t > 0) shift = t;
        }

        const sync = [];
        for (let i = 0, n = m.readUInt32BE(stss[0] + 4); i < n; i++) sync.push(m.readUInt32BE(stss[0] + 8 + i * 4));
        const wanted = new Set(sync), times = [];
        let sample = 1, dts = 0, ci = 0, cLeft = 0, cOff = 0;
        const cN = ctts ? m.readUInt32BE(ctts[0] + 4) : 0, cV1 = ctts && m[ctts[0]] === 1;
        const nextCtts = () => {
            if (ci >= cN) { cOff = 0; cLeft = Infinity; return; }
            cLeft = m.readUInt32BE(ctts[0] + 8 + ci * 8);
            cOff = cV1 ? m.readInt32BE(ctts[0] + 12 + ci * 8) : m.readUInt32BE(ctts[0] + 12 + ci * 8);
            ci++;
        };
        if (ctts) nextCtts();
        for (let i = 0, n = m.readUInt32BE(stts[0] + 4); i < n; i++) {
            const count = m.readUInt32BE(stts[0] + 8 + i * 8), delta = m.readUInt32BE(stts[0] + 12 + i * 8);
            for (let k = 0; k < count; k++, sample++, dts += delta) {
                if (ctts) { while (cLeft === 0) nextCtts(); cLeft--; }
                if (wanted.has(sample)) times.push((dts + (ctts ? cOff : 0) - shift) / scale);
            }
        }
        out = times.sort((a, b) => a - b);
    });
    return out && out.length > 1 ? out : null;
}

module.exports = { keyframes };
