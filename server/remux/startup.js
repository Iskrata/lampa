// How far a file is from playing (README "Loading progress"): until segment 0 is written, the share of the
// bytes that takes which TorrServer already holds, from its piece map. Starting waits on TorrServer finding
// peers (README "Why starting takes longer than a seek"), and these bytes are what it downloads meanwhile:
// ffprobe reads up to the first PROBE_BYTES of the file, then segment 0 is the file's first seconds.
'use strict';

const PROBE_BYTES = 20e6, FORGET_MS = 5 * 60000;
const started = new Map();   // "<hash>:<file>" -> { at, session }: master requests, the session once probed

function begin(hash, index) {
    const st = { at: Date.now(), session: null };
    started.set(`${hash}:${index}`, st);
    for (const [k, v] of started) if (Date.now() - v.at > FORGET_MS) started.delete(k);
    return st;
}

// the bytes from the start of the file it reads: before the probe its limit, after it up to segment 0's end
function needed(st, length) {
    const m = st && st.session && st.session.m;
    return Math.min(length, m ? Math.max(1, m.bandwidth / 8 * m.bounds[1]) : PROBE_BYTES);
}

// { pct } (0-100, 100 once segment 0 is written) for one file of the torrent, null without one. The player
// asks before its master request arrives (Lampa also asks for the torrent's other files' masters, so the file
// must be named). cache and torrent are TorrServer's /cache and /torrents answers for the hash.
function report(hash, index, cache, torrent) {
    if (!index) return null;
    const st = started.get(`${hash}:${index}`);
    if (st && st.session && st.session.has(0)) return { pct: 100 };
    const files = ((torrent && torrent.file_stats) || []).slice().sort((a, b) => a.id - b.id);
    const pl = cache && cache.PiecesLength;
    let off = 0, file = null;
    for (const f of files) { if (String(f.id) === String(index)) { file = f; break; } off += f.length; }
    if (!file || !pl) return { pct: 0 };
    const need = needed(st, file.length), end = off + need;
    let have = 0;
    for (let i = Math.floor(off / pl); i * pl < end; i++) {
        const p = cache.Pieces && cache.Pieces[i];
        if (!p) continue;
        const overlap = Math.min(end, (i + 1) * pl) - Math.max(off, i * pl);
        have += p.Completed ? overlap : overlap * Math.min(1, (p.Size || 0) / (p.Length || pl));
    }
    return { pct: Math.min(99, Math.floor(have * 100 / need)) };
}

module.exports = { begin, report };
