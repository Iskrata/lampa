// Splits ffmpeg's fragmented MP4 output (-movflags frag_keyframe+empty_moov+default_base_moof: one
// moof+mdat per video keyframe) into the HLS init segment and fragments with their start time.
// ffmpeg starts every run's tracks at 0, each on its own; the player needs them at their place in the film,
// in sync. So each fragment's decode times (tfdt) are moved later:
//   video by `at.video`: the run starts at that keyframe, shown the file's reorder delay after it
//   other tracks by `at.audio` + the video's reorder delay: audio starts where ffmpeg was told to seek, and
//   is shown in step with the video, which is displayed `delay` after its decode time (B-frames)
// `at.delay` is the file's reorder delay from an earlier run (this run's own is `.delay`); videoSeconds is
// when the fragment's first keyframe is shown, on the film's timeline (the keyframe index's times).
// new Splitter({ onInit(buf), onFragment(videoSeconds, buf) }, { video, audio, delay }).push(chunk); .delay
'use strict';

function boxes(b, start, end, fn) {
    for (let i = start; i + 8 <= end;) {
        let size = b.readUInt32BE(i), head = 8;
        if (size === 1) { size = Number(b.readBigUInt64BE(i + 8)); head = 16; }
        if (size < head || i + size > end) return;
        fn(b.toString('latin1', i + 4, i + 8), i + head, i + size);
        i += size;
    }
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'moof', 'traf']);

// walk nested boxes, calling fn(type, start, end) for every leaf and container
function walk(b, start, end, fn) {
    boxes(b, start, end, (type, s, e) => { fn(type, s, e); if (CONTAINERS.has(type)) walk(b, s, e, fn); });
}

// every track's id, timescale and handler, from the init segment's moov
function tracks(moov) {
    const list = [];
    boxes(moov, 8, moov.length, (type, s, e) => {
        if (type !== 'trak') return;
        const t = {};
        walk(moov, s, e, (ty, a) => {
            if (ty === 'tkhd') t.id = moov.readUInt32BE(a + (moov[a] === 1 ? 20 : 12));
            if (ty === 'mdhd') t.scale = moov.readUInt32BE(a + (moov[a] === 1 ? 20 : 12));
            if (ty === 'hdlr') t.handler = moov.toString('latin1', a + 8, a + 12);
        });
        list.push(t);
    });
    return list;
}

// composition offset of the video's first sample in a moof (its trun), in seconds
function firstOffset(moof, list) {
    let track = null, off = null;
    walk(moof, 8, moof.length, (type, a) => {
        if (type === 'tfhd') { const id = moof.readUInt32BE(a + 4); track = list.find(t => t.id === id); }
        if (type !== 'trun' || off != null || !track || track.handler !== 'vide') return;
        const flags = moof.readUInt32BE(a) & 0xFFFFFF;
        if (!(flags & 0x800) || !moof.readUInt32BE(a + 4)) { off = 0; return; }
        let o = a + 8;
        for (const f of [0x1, 0x4, 0x100, 0x200, 0x400]) if (flags & f) o += 4;
        off = (moof[a] === 1 ? moof.readInt32BE(o) : moof.readUInt32BE(o)) / track.scale;
    });
    return off || 0;
}

// shift every track's decode time in a moof (in place); returns the video track's, in seconds
function retime(moof, list, shift) {
    let track = null, video = null;
    walk(moof, 8, moof.length, (type, a) => {
        if (type === 'tfhd') { const id = moof.readUInt32BE(a + 4); track = list.find(t => t.id === id); }
        if (type !== 'tfdt' || !track) return;
        const add = Math.round(shift(track) * track.scale);
        let t;
        if (moof[a] === 1) { t = Math.max(0, Number(moof.readBigUInt64BE(a + 4)) + add); moof.writeBigUInt64BE(BigInt(t), a + 4); }
        else { t = Math.max(0, moof.readUInt32BE(a + 4) + add); if (t > 0xFFFFFFFF) throw new Error('tfdt overflow'); moof.writeUInt32BE(t, a + 4); }
        if (track.handler === 'vide' && video == null) video = t / track.scale;
    });
    return video;
}

class Splitter {
    constructor(handlers, at) {
        this.h = handlers;
        this.at = at || { video: 0, audio: 0 };
        this.delay = null;
        this.chunks = [];   // unparsed output; joined only once a whole box is in (an mdat can be 30 MB)
        this.length = 0;
        this.init = [];
        this.tracks = null;
        this.moof = null;
    }

    push(chunk) {
        this.chunks.push(chunk);
        this.length += chunk.length;
        for (;;) {
            if (this.length < 16 && !(this.length >= 8 && this.peek(8).readUInt32BE(0) !== 1)) return;
            const head = this.peek(16);
            let size = head.readUInt32BE(0);
            if (size === 1) size = Number(head.readBigUInt64BE(8));
            if (size < 8) throw new Error('bad mp4 box');
            if (this.length < size) return;
            const all = Buffer.concat(this.chunks, this.length);
            this.box(all.toString('latin1', 4, 8), all.subarray(0, size));
            const rest = all.subarray(size);
            this.chunks = rest.length ? [rest] : [];
            this.length = rest.length;
        }
    }

    peek(n) {
        return this.chunks[0].length >= n ? this.chunks[0] : Buffer.concat(this.chunks, Math.min(n, this.length));
    }

    box(type, b) {
        if (!this.tracks) {
            if (type !== 'moov') { this.init.push(b); return; }    // ftyp (and anything before moov)
            this.init.push(b);
            this.tracks = tracks(b);
            this.h.onInit(Buffer.concat(this.init));
            return;
        }
        if (type === 'moof') { this.moof = b; return; }
        if (type === 'mdat' && this.moof) {
            const frag = Buffer.concat([this.moof, b]);   // a copy, safe to patch
            const moof = frag.subarray(0, this.moof.length);
            if (this.delay == null) this.delay = firstOffset(moof, this.tracks);
            // keyframes don't all have the same composition offset (x265 open GOPs: 0.083 s and 0.25 s in one
            // file), so every run is lined up on the file's own delay (its first run's), not this run's first
            // keyframe: a run from a later segment then shows its frames when a run from the start would
            const lead = this.at.delay != null ? this.at.delay : this.delay;
            const shift = t => t.handler === 'vide' ? this.at.video + lead - this.delay : this.at.audio + lead;
            const decode = retime(moof, this.tracks, shift);
            // the keyframe's place in the film is when it is shown, not decoded: by decode time the fragment
            // starting at 10.427 s came out at 10.26 s and went into the segment before
            this.h.onFragment(decode + firstOffset(moof, this.tracks) - lead, frag);
            this.moof = null;
        }
    }
}

module.exports = { Splitter };
