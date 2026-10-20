// Downloads (server/remux/README.md "Downloads"): one torrent file made into an MP4 that an iPhone keeps and
// plays offline (Files, TV app), English/Bulgarian/Russian subtitles inside.
//   1. ffmpeg reads the whole file from TorrServer: video copied, audio as for streaming (media.js), the file's
//      own subtitles as WebVTT.
//   2. A Session makes the subtitle tracks exactly as for the player (OpenSubtitles searched and fitted).
//   3. A second ffmpeg run, on local disk, puts them in as mov_text and the index at the front.
// A job is <downloads>/<id>.json plus the folder <id>/; both survive restarts, and an unfinished job starts
// over after one.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const media = require('./media');
const { Session } = require('./session');
const ts = require('./torrserver');
const cfg = require('./config');

// pass 1 at once: each holds a torrent in TorrServer (up to 1 GB of RAM) and shares ruby's download speed
const RUNNING_MAX = 2;
const KEEP_MS = 3 * 24 * 3600e3, FAILED_KEEP_MS = 24 * 3600e3;
const RESERVE = 20e9;            // disk left free for everything else
const STALL_MS = 10 * 60e3;      // no progress this long: the torrent stopped downloading
const ISO3 = { en: 'eng', bg: 'bul', ru: 'rus' };

const dir = cfg.downloads;
const jobs = new Map();          // id -> job
fs.mkdirSync(dir, { recursive: true });

const folder = j => path.join(dir, j.id);
const film = j => path.join(folder(j), 'film.mp4');
// the name the phone saves it under: "Gladiator (2000).mp4"
const fileName = j => (String(j.name || 'Film').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 120) || 'Film') + '.mp4';

function save(j) {
    const { proc, stalled, ...keep } = j;
    fs.writeFileSync(path.join(dir, j.id + '.json'), JSON.stringify(keep));
}

function view(j) {
    return { id: j.id, hash: j.hash, index: j.index, tmdb: j.tmdb, kind: j.kind, season: j.season, episode: j.episode,
        name: j.name, state: j.state, progress: j.progress, size: j.size, subs: j.subs || [], error: j.error,
        expires: j.ready ? j.ready + KEEP_MS : null,
        url: j.state === 'ready' ? `download/${j.id}/${encodeURIComponent(fileName(j))}` : null };
}

// space the unfinished jobs will still take: pass 1 writes about the file's size, pass 2 a copy of it
function owed() {
    let n = 0;
    for (const j of jobs.values()) if (j.state !== 'ready' && j.state !== 'failed') n += j.bytes * 2.1;
    return n;
}

async function create(p) {
    const hash = String(p.hash || '').toLowerCase(), index = String(parseInt(p.index, 10) || 1);
    if (!/^[0-9a-f]{40}$/.test(hash)) throw Object.assign(new Error('bad hash'), { status: 400 });
    const lang = p.lang === 'ja' ? 'ja' : 'en', id = `${hash}-${index}-${lang}`;
    const known = jobs.get(id);
    if (known && known.state !== 'failed') return known;
    const f = await ts.file(hash, index);
    if (!f.length) throw Object.assign(new Error('TorrServer doesn\'t have this file'), { status: 404 });
    const free = (s => s.bavail * s.bsize)(await fs.promises.statfs(dir));
    if (free - owed() - RESERVE < f.length * 2.1) {
        throw Object.assign(new Error(`Not enough space on the server (${(free / 1e9).toFixed(0)} GB free)`), { status: 507 });
    }
    const j = { id, hash, index, lang, bytes: f.length, path: f.path || '', name: p.name, tmdb: p.tmdb ? String(p.tmdb) : null,
        kind: p.kind === 'tv' ? 'tv' : 'movie', season: p.season || null, episode: p.episode || null,
        state: 'queued', progress: 0, size: null, error: null, created: Date.now(), ready: null };
    jobs.set(id, j);
    save(j);
    console.log(`download ${id}: queued "${j.name}" (${(j.bytes / 1e9).toFixed(1)} GB)`);
    next();
    return j;
}

function next() {
    const running = [...jobs.values()].filter(j => j.state === 'fetching').length;
    const queued = [...jobs.values()].filter(j => j.state === 'queued').sort((a, b) => a.created - b.created);
    queued.slice(0, Math.max(0, RUNNING_MAX - running)).forEach(j => {
        run(j).catch(e => {
            if (j.cancelled) return;
            console.error(`download ${j.id}: ${e.message}`);
            Object.assign(j, { state: 'failed', error: e.message, failed: Date.now() });
            save(j);
            done(j);
        });
    });
}

// a job left the torrent: drop it from TorrServer, unless someone is watching it (server.js)
let watched = () => false;
function done(j) {
    if (!watched(j.hash) && !reading(j.hash)) ts.post('/torrents', { action: 'drop', hash: j.hash });
    next();
}

async function run(j) {
    Object.assign(j, { state: 'fetching', progress: 0, error: null });
    save(j);
    const m = await media.load(j.hash, j.index, j.lang);
    fs.rmSync(folder(j), { recursive: true, force: true });
    // a Session reads the subtitles pass 1 writes as one run from 0 (sub<k>-0.vtt), on pass 1's own timing
    const s = new Session(m, folder(j));
    s.delay = 0;
    if (j.tmdb) s.describe({ tmdb: j.tmdb, kind: j.kind, name: j.path, size: j.bytes });
    const av = path.join(folder(j), 'av.mp4');
    const subFiles = m.subs.map((_, k) => path.join(folder(j), `sub${k}-0.vtt`));
    console.log(`download ${j.id}: pass 1, ${m.video.codec_name} ${m.resolution}, ${m.duration.toFixed(0)} s`);
    const t0 = Date.now();
    await ffmpeg(j, ['-progress', 'pipe:1', ...media.ffmpegArgs(m, 0, { subFiles, file: av })], t => {
        j.progress = Math.min(t / m.duration, 1);
    });
    console.log(`download ${j.id}: pass 1 took ${((Date.now() - t0) / 1000).toFixed(0)} s`);

    j.state = 'subtitles';
    save(j);
    // the file's own English first: TV captions (ALL CAPS) send for better ones, which are then fitted to them
    if (s.english) await s.allCues('sub0');
    await Promise.all([s.fetched, s.ready(60000)]);
    const tracks = [];
    for (const t of s.tracks()) {
        const text = await s.subtitleFile(t.id);
        if (!/-->/.test(text)) continue;   // nothing that fits this video
        const file = path.join(folder(j), `${t.id}.vtt`);
        fs.writeFileSync(file, text);
        tracks.push(Object.assign({ file }, t));
    }
    if (j.cancelled) throw new Error('cancelled');

    j.state = 'finishing';
    save(j);
    const a = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', av];
    tracks.forEach(t => a.push('-i', t.file));
    a.push('-map', '0');
    tracks.forEach((t, k) => a.push('-map', `${k + 1}:0`));
    a.push('-c', 'copy', '-c:s', 'mov_text');
    // English on by itself when the audio isn't English (media.js subsOn), like in the player
    tracks.forEach((t, k) => a.push(`-metadata:s:s:${k}`, `language=${ISO3[t.lang]}`,
        `-disposition:s:${k}`, m.subsOn && k === 0 && t.lang === 'en' ? 'default' : '0'));
    a.push('-movflags', '+faststart', film(j));
    await ffmpeg(j, a);
    for (const f of fs.readdirSync(folder(j))) if (f !== 'film.mp4') fs.rmSync(path.join(folder(j), f), { force: true });

    Object.assign(j, { state: 'ready', progress: 1, size: fs.statSync(film(j)).size, subs: tracks.map(t => t.lang), ready: Date.now() });
    save(j);
    console.log(`download ${j.id}: ready, ${(j.size / 1e9).toFixed(2)} GB, subtitles ${tracks.map(t => t.lang).join(' ') || 'none'}`);
    done(j);
}

function ffmpeg(j, args, onTime) {
    return new Promise((resolve, reject) => {
        if (j.cancelled) return reject(new Error('cancelled'));
        const p = spawn(cfg.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        j.proc = p;
        let err = '', out = '', last = Date.now(), at = -1;
        // ffmpeg waits on TorrServer for as long as the torrent has no seeders: give up after STALL_MS
        const watch = setInterval(() => {
            if (Date.now() - last > STALL_MS) { j.stalled = true; p.kill(); }
        }, 30000);
        p.stdout.on('data', c => {
            out += c;
            let i;
            while ((i = out.indexOf('\n')) >= 0) {
                const line = out.slice(0, i);
                out = out.slice(i + 1);
                const t = /^out_time_us=(\d+)/.exec(line);
                if (t && onTime && +t[1] !== at) { at = +t[1]; last = Date.now(); onTime(at / 1e6); }
            }
        });
        p.stderr.on('data', c => { err = (err + c).slice(-2000); last = Date.now(); });
        p.on('close', code => {
            clearInterval(watch);
            j.proc = null;
            if (j.cancelled) reject(new Error('cancelled'));
            else if (j.stalled) reject(new Error('The torrent stopped downloading (no seeders?)'));
            else if (code) reject(new Error('ffmpeg: ' + err.trim().slice(-300)));
            else resolve();
        });
    });
}

// On Windows a killed ffmpeg holds its files open for a moment: delete a little later, and retry once
function remove(j) {
    jobs.delete(j.id);
    fs.rmSync(path.join(dir, j.id + '.json'), { force: true });
    const rm = retry => setTimeout(() => {
        try { fs.rmSync(folder(j), { recursive: true, force: true }); }
        catch (e) { if (retry) rm(false); else console.error(`could not delete ${folder(j)}: ${e.message}`); }
    }, 3000);
    rm(true);
}

function cancel(j) {
    const was = j.state;
    j.cancelled = true;
    if (j.proc) j.proc.kill();
    remove(j);
    console.log(`download ${j.id}: removed (${was})`);
    if (was !== 'ready' && was !== 'failed') done(j);
}

// a download still needs this torrent in TorrServer
function reading(hash) {
    hash = String(hash).toLowerCase();
    return [...jobs.values()].some(j => j.hash === hash && (j.state === 'queued' || j.state === 'fetching'));
}

// The file, with byte ranges: a phone's download can resume, and Safari asks for ranges to play it
function sendFilm(req, res, j) {
    const file = film(j), size = fs.statSync(file).size, name = fileName(j);
    const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
        'Last-Modified': new Date(j.ready).toUTCString(), 'Access-Control-Allow-Origin': '*',
        'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` };
    let start = 0, end = size - 1, status = 200;
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r && (r[1] || r[2])) {
        if (r[1]) { start = +r[1]; if (r[2]) end = Math.min(+r[2], size - 1); }
        else start = Math.max(0, size - +r[2]);
        if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
        status = 206;
        h['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    h['Content-Length'] = end - start + 1;
    res.writeHead(status, h);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
}

function body(req) {
    return new Promise((resolve, reject) => {
        let b = '';
        req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); });
        req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
        req.on('error', reject);
    });
}

//   POST /gst/download {hash, index, lang, tmdb, kind, season, episode, name} -> the job
//   GET  /gst/downloads                     -> every job
//   GET  /gst/download/<id>/<name>.mp4      -> the file, once ready
//   POST /gst/download/<id>/cancel          -> stop it, or delete the file
async function handle(req, res, parts, send) {
    const json = (status, v) => send(res, status, JSON.stringify(v), 'application/json');
    try {
        if (parts[0] === 'downloads') return json(200, [...jobs.values()].map(view));
        if (!parts[1] && req.method === 'POST') return json(200, view(await create(await body(req))));
        const j = jobs.get(parts[1]);
        if (!j) return json(404, { error: 'no such download' });
        if (parts[2] === 'cancel' && req.method === 'POST') { cancel(j); return json(200, { ok: true }); }
        if (parts[2] && j.state === 'ready') return sendFilm(req, res, j);
        return json(200, view(j));
    } catch (e) {
        return json(e.status || 500, { error: e.message });
    }
}

// jobs on disk from before a restart: ready ones are served again, unfinished ones start over; old ones go
function load() {
    for (const f of fs.readdirSync(dir)) {
        if (!/\.json$/.test(f)) continue;
        try {
            const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
            if (j.state === 'ready' && !fs.existsSync(film(j))) { remove(j); continue; }
            if (j.state !== 'ready' && j.state !== 'failed') Object.assign(j, { state: 'queued', progress: 0 });
            jobs.set(j.id, j);
        } catch (e) { console.error(`download ${f}: ${e.message}`); }
    }
    if (jobs.size) console.log(`downloads: ${jobs.size} on disk`);
}

function expire() {
    const now = Date.now();
    for (const j of [...jobs.values()]) {
        if ((j.state === 'ready' && now - j.ready > KEEP_MS) || (j.state === 'failed' && now - (j.failed || 0) > FAILED_KEEP_MS)) {
            console.log(`download ${j.id}: expired`);
            remove(j);
        }
    }
}

// server.js says which torrents players are using, then jobs left unfinished by a restart carry on
function start(isWatched) {
    watched = isWatched;
    load();
    next();
    setInterval(expire, 3600e3).unref();
    expire();
}

module.exports = { start, handle, reading };
