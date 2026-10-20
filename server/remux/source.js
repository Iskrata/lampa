// A torrent file's bytes for ffprobe and ffmpeg, from disk where an earlier open read them (README "Opening a
// file again"). Every ffmpeg run opens the file from its start and reads its index at the end (Matroska Cues,
// Tags; an MP4's moov), and a torrent drops what it holds when the player closes. In a series pack those are
// two whole pieces of other episodes' data: Friends S01-S10 (16 MiB pieces) waited 33-52 s for them on every
// open (2026-10-20). So what the first open's probe reads (the file's start up to ffprobe's limit, the index,
// the last 64 KiB for OpenSubtitles' hash) is kept here, with the probe's answer, and ffmpeg and ffprobe read
// the file through this service: GET /gst/src/<hash>/<file>[?rec=1] (HTTP ranges, rec: keep what passes).
// A torrent's bytes never change, so nothing kept goes stale; the oldest files go when the total passes
// cfg.sourcesMax.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const cfg = require('./config');

const REC_MAX = 64 << 20;   // bytes kept per file (ffprobe reads up to 20 MB of the start, plus the index)
const files = new Map();    // "<hash>-<file>" -> { dir, size, ranges: [{ a, b }], probe, used }

const sec = ms => (ms / 1000).toFixed(1) + ' s';
const key = (hash, index) => `${String(hash).toLowerCase()}-${index}`;

function entry(hash, index) {
    const k = key(hash, index);
    if (!files.has(k)) {
        const dir = path.join(cfg.sources, k);
        let f = { size: null, ranges: [], probe: null };
        try { f = Object.assign(f, JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))); } catch (e) { /* new */ }
        f.dir = dir;
        f.ranges = f.ranges.filter(r => fs.existsSync(path.join(dir, `${r.a}.bin`)));
        files.set(k, f);
    }
    return files.get(k);
}

function save(f) {
    f.used = Date.now();
    fs.mkdirSync(f.dir, { recursive: true });
    const { size, ranges, probe, used } = f;
    fs.writeFileSync(path.join(f.dir, 'meta.json'), JSON.stringify({ size, ranges, probe, used }));
}

// where ffmpeg/ffprobe read the file; rec: keep the bytes read (the first open's probe)
function url(hash, index, rec) {
    const host = cfg.host === '0.0.0.0' || cfg.host === '::' ? '127.0.0.1' : cfg.host;
    return `http://${host}:${cfg.port}/gst/src/${hash}/${index}${rec ? '?rec=1' : ''}`;
}

// the probe's answer ({ info, keys, mp4 }) kept from an earlier open, or null; with a value, keep it
function probe(hash, index, value) {
    const f = entry(hash, index);
    if (value === undefined) {
        if (f.probe) { f.used = Date.now(); touch(f); }
        return f.probe;
    }
    f.probe = value;
    save(f);
    prune();
    return value;
}

// meta.json's time is what prune() goes by: a file opened again stays (written at most once an hour)
function touch(f) {
    if (Date.now() - (f.touched || 0) < 3600000) return;
    f.touched = Date.now();
    try { save(f); } catch (e) { /* not kept yet */ }
}

// the kept range holding byte `pos` that goes furthest, or null
function covering(f, pos) {
    let best = null;
    for (const r of f.ranges) if (r.a <= pos && pos < r.b && (!best || r.b > best.b)) best = r;
    return best;
}

function kept(f) { return f.ranges.reduce((n, r) => n + r.b - r.a, 0); }

function record(f, a, chunks) {
    const buf = Buffer.concat(chunks), b = a + buf.length;
    if (!buf.length || f.ranges.some(r => r.a <= a && b <= r.b) || kept(f) + buf.length > REC_MAX) return;
    fs.mkdirSync(f.dir, { recursive: true });
    fs.writeFileSync(path.join(f.dir, `${a}.bin`), buf);
    // a range inside the new one is now redundant
    for (const r of f.ranges.filter(r => a <= r.a && r.b <= b && r.a !== a)) fs.rmSync(path.join(f.dir, `${r.a}.bin`), { force: true });
    f.ranges = f.ranges.filter(r => !(a <= r.a && r.b <= b)).concat({ a, b });
    save(f);
}

// TorrServer's stream from `a` (to `z` inclusive, or the end): { res, size }
function upstream(hash, index, a, z) {
    const u = `${cfg.torrserver}/stream/file?link=${encodeURIComponent(hash)}&index=${encodeURIComponent(index)}&play`;
    return new Promise((resolve, reject) => {
        const req = http.get(u, { headers: { Range: `bytes=${a}-${z == null ? '' : z}` } }, res => {
            if (res.statusCode !== 206 && res.statusCode !== 200) { res.resume(); return reject(new Error(`TorrServer: HTTP ${res.statusCode}`)); }
            const total = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
            const size = total ? +total[1] : res.statusCode === 200 ? +res.headers['content-length'] : null;
            if (res.statusCode === 200 && a > 0) { res.destroy(); return reject(new Error('TorrServer ignored the range')); }
            resolve({ res, size, req });
        });
        req.on('error', reject);
    });
}

// copy a readable into the response without ending it; false when the response closed first
function pump(from, res, onData) {
    return new Promise(resolve => {
        let done = false;
        const finish = ok => { if (done) return; done = true; res.off('close', closed); resolve(ok); };
        const closed = () => { from.destroy(); finish(false); };
        res.on('close', closed);
        if (onData) from.on('data', onData);
        from.on('end', () => finish(true));
        from.on('error', () => finish(false));
        from.pipe(res, { end: false });
    });
}

// GET /gst/src/<hash>/<file>: the bytes asked for, kept ones from disk and the rest from TorrServer
async function handle(req, res, hash, index, rec) {
    const f = entry(hash, index);
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    let a = m ? +m[1] : 0, z = m && m[2] ? +m[2] : null, up = null;
    if (f.size == null) {
        up = await upstream(hash, index, a, z);
        f.size = up.size;
    }
    const size = f.size;
    if (z == null || z >= size) z = size - 1;
    if (a > z) { if (up) up.req.destroy(); res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${a}-${z}/${size}`, 'Content-Length': z - a + 1 });
    f.used = Date.now();
    const t0 = Date.now(), from0 = a;
    // kept ranges one after another (the Cues element's head and body were read apart: 16 bytes, then the rest)
    for (let r; !up && a <= z && (r = covering(f, a));) {
        const end = Math.min(r.b, z + 1);
        if (!await pump(fs.createReadStream(path.join(f.dir, `${r.a}.bin`), { start: a - r.a, end: end - r.a - 1 }), res)) return;
        a = end;
    }
    if (a <= z) {
        up = up || await upstream(hash, index, a, z);
        const chunks = [], from = a;
        let n = 0, n2 = 0;
        const keep = rec ? c => { if (n < REC_MAX) { chunks.push(c); n += c.length; } } : null;
        res.on('close', () => up.req.destroy());
        const sent = await pump(up.res, res, c => { n2 += c.length; if (keep) keep(c); });
        if (rec) try { record(f, from, chunks); } catch (e) { console.error(`source ${key(hash, index)}: ${e.message}`); }
        if (process.env.REMUX_DEBUG) console.log(`src ${hash.slice(0, 8)}:${index} ${from0}-${z}${rec ? ' rec' : ''}: disk ${from - from0}, ` +
            `TorrServer ${n2} from ${from} in ${sec(Date.now() - t0)}${sent ? '' : ' (closed)'}`);
    } else if (process.env.REMUX_DEBUG) console.log(`src ${hash.slice(0, 8)}:${index} ${from0}-${z}: disk ${a - from0}`);
    res.end();
}

// the oldest files go once all kept bytes pass cfg.sourcesMax
let pruning = false;
function prune() {
    if (pruning) return;
    pruning = true;
    try {
        const all = fs.readdirSync(cfg.sources).map(name => {
            const dir = path.join(cfg.sources, name);
            let bytes = 0, used = 0;
            try {
                for (const x of fs.readdirSync(dir)) bytes += fs.statSync(path.join(dir, x)).size;
                used = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).used || 0;
            } catch (e) { /* half-written: oldest */ }
            return { name, dir, bytes, used };
        }).sort((x, y) => y.used - x.used);
        let total = 0;
        for (const x of all) {
            total += x.bytes;
            if (total > cfg.sourcesMax) { fs.rmSync(x.dir, { recursive: true, force: true }); files.delete(x.name); }
        }
    } catch (e) { /* no folder yet */ }
    pruning = false;
}

fs.mkdirSync(cfg.sources, { recursive: true });
prune();

// where the kept start of the file ends (0: none)
function headEnd(hash, index) {
    let pos = 0;
    for (let r; (r = covering(entry(hash, index), pos));) pos = r.b;
    return pos;
}

// how many bytes of [a, b) are kept (startup.js counts them as there)
function covered(hash, index, a, b) {
    let n = 0;
    for (let pos = a, r; pos < b && (r = covering(entry(hash, index), pos));) { n += Math.min(b, r.b) - pos; pos = r.b; }
    return n;
}

module.exports = { url, probe, handle, covered, headEnd };
