// lampa-remux: plays any torrent file in a browser by repackaging it as HLS (server/remux/README.md).
// Speaks the protocol Lampa uses for TorrServer's GStreamer build ("Settings → TorrServer → transcoding",
// storage key torrserver_gts), so Lampa needs no changes. Serve it at <torrserver url>/gst/:
//   GET /gst/echo                                  -> JSON (Lampa checks this before using /gst/)
//   GET /gst/<hash>/master.m3u8?index=<file>[&lang=ja] -> HLS master (video + audio in that language, English by
//                                                     default + English/Bulgarian/Russian subtitles, English on by
//                                                     themselves when the audio isn't English)
//   GET /gst/<hash>/<file>.<lang>/video.m3u8, init.mp4, seg<n>.m4s, <track>.m3u8, <track>-<n>.vtt
//                                                     (track: sub<k> the file's own, os<lang> from OpenSubtitles)
//   GET /gst/<hash>/heartbeat                      -> TorrServer's stats for the player's info panel
//   GET /gst/remove?hash=<hash>                    -> stop and drop the torrent
//   GET /gst/speedtest?mb=4                        -> random bytes, for the browser to time its connection
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const media = require('./media');
const { Session } = require('./session');
const cfg = require('./config');

const IDLE_KILL_MS = 60000, IDLE_DROP_MS = 10 * 60000;
const sessions = new Map();   // "<hash>:<file>" -> Promise<Session>

function session(hash, index, lang) {
    const key = `${hash}:${index}:${lang}`;
    if (!sessions.has(key)) {
        const p = media.load(hash, index, lang).then(m => {
            const s = new Session(m, path.join(cfg.cache, `${hash}-${index}-${lang}`));
            console.log(`${hash.slice(0, 8)}:${index} ${m.video.codec_name} ${m.resolution}, audio ${m.audio ? m.audio.codec_name + ' ' + ((m.audio.tags || {}).language || '?') : 'none'}` +
                `, subtitles ${m.subs.map(x => x.lang).join(' ') || 'none'}, ${m.bounds.length - 1} segments (${m.cuesUsed ? 'keyframes' : 'fixed'})`);
            return s;
        });
        p.catch(e => { console.error(`${key}: ${e.message}`); sessions.delete(key); });
        sessions.set(key, p);
    }
    return sessions.get(key);
}

function forHash(hash) {
    return [...sessions.keys()].filter(k => k.startsWith(hash + ':')).map(k => sessions.get(k));
}

function torrserver(route, body) {
    return fetch(cfg.torrserver + route, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
        .then(r => r.ok ? r.json() : null).catch(() => null);
}

// the title, for subtitles from OpenSubtitles: the torrent file's name says the episode
async function describe(s, hash, tmdb, kind) {
    if (!tmdb || s.source) return;
    const t = await torrserver('/torrents', { action: 'get', hash });
    const f = ((t && t.file_stats) || []).find(x => String(x.id) === String(s.m.index)) || {};
    s.describe({ tmdb, kind: kind === 'movie' ? 'movie' : 'tv', name: f.path || '', size: f.length || 0 });
}

const LANG_NAMES = { en: 'English', bg: 'Bulgarian', ru: 'Russian' };

function master(s) {
    // the title rides along in every path (<file>.<lang>.<kind><tmdb>/): a session made again from a segment
    // request (after a restart the player carries on without asking for the master) still knows the episode
    const src = s.source, m = s.m, tracks = s.tracks();
    const base = `${m.index}.${m.lang}${src ? '.' + (src.kind === 'movie' ? 'm' : 't') + src.tmdb : ''}/`;
    const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
    // the menu shows NAME, which must be unique; the player picks by LANGUAGE (desktop/player.js)
    const names = new Set();
    tracks.forEach((t, k) => {
        let name = LANG_NAMES[t.lang] + (t.title && !/^(english|bulgarian|russian)$/i.test(t.title) ? ` (${t.title.replace(/"/g, '')})` : '');
        for (let i = 2; names.has(name); i++) name = `${LANG_NAMES[t.lang]} ${i}`;
        names.add(name);
        const first = tracks.findIndex(x => x.lang === t.lang) === k;
        lines.push(`#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${name}",LANGUAGE="${t.lang}",` +
            `DEFAULT=${m.subsOn && k === 0 && t.lang === 'en' ? 'YES' : 'NO'},AUTOSELECT=${first ? 'YES' : 'NO'},FORCED=NO,URI="${base}${t.id}.m3u8"`);
    });
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${m.bandwidth},CODECS="${m.codecs}"` +
        (m.resolution ? `,RESOLUTION=${m.resolution}` : '') + (tracks.length ? ',SUBTITLES="subs"' : ''));
    lines.push(`${base}video.m3u8`);
    return lines.join('\n') + '\n';
}

function playlist(s, item, map) {
    const b = s.m.bounds, n = b.length - 1;
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, b[i + 1] - b[i]);
    const lines = ['#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${Math.ceil(max)}`, '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-INDEPENDENT-SEGMENTS'];
    if (map) lines.push(`#EXT-X-MAP:URI="${map}"`);
    for (let i = 0; i < n; i++) lines.push(`#EXTINF:${(b[i + 1] - b[i]).toFixed(6)},`, item(i));
    lines.push('#EXT-X-ENDLIST');
    return lines.join('\n') + '\n';
}

// random bytes (can't be compressed or cached) for the browser to time its connection to this server
const NOISE = require('crypto').randomBytes(1 << 20);
function speedtest(res, mb) {
    const n = Math.min(Math.max(parseInt(mb, 10) || 4, 1), 16);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': n * NOISE.length, 'Cache-Control': 'no-store' });
    let i = 0;
    const more = () => { while (i < n) { i++; if (!res.write(NOISE)) return res.once('drain', more); } res.end(); };
    more();
}

// the audio languages a player may ask for (media.js LANGS); anything else is English
const lang = l => (l === 'ja' ? 'ja' : 'en');

const TYPES = { m3u8: 'application/vnd.apple.mpegurl', mp4: 'video/mp4', m4s: 'video/iso.segment', vtt: 'text/vtt; charset=utf-8' };

function send(res, status, body, type) {
    res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*' });
    res.end(body);
}

function sendFile(res, file) {
    const size = fs.statSync(file).size;
    res.writeHead(200, { 'Content-Type': TYPES[file.split('.').pop()], 'Content-Length': size, 'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(file).pipe(res);
}

async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.replace(/^.*?\/gst\//, '').split('/').map(decodeURIComponent);
    const [hash, a, b] = parts;

    if (hash === 'speedtest') return speedtest(res, url.searchParams.get('mb'));
    if (hash === 'echo') return send(res, 200, '{"remux":true}', 'application/json');   // Lampa parses it as JSON
    if (hash === 'remove') {
        const h = url.searchParams.get('hash') || '';
        for (const p of forHash(h)) p.then(s => s.close(), () => {});
        for (const k of [...sessions.keys()]) if (k.startsWith(h + ':')) sessions.delete(k);
        await torrserver('/torrents', { action: 'drop', hash: h });
        return send(res, 200, 'ok');
    }
    if (!/^[0-9a-f]{40}$/i.test(hash || '')) return send(res, 404, 'not found');

    if (a === 'heartbeat') {
        for (const p of forHash(hash)) p.then(s => { s.used = Date.now(); }, () => {});
        const [cache, torrent] = await Promise.all([torrserver('/cache', { action: 'get', hash }), torrserver('/torrents', { action: 'get', hash })]);
        return send(res, 200, JSON.stringify(Object.assign({ Readers: [], Pieces: {} }, cache, { Torrent: torrent || {} })), 'application/json');
    }
    if (a === 'master.m3u8') {
        const s = await session(hash, url.searchParams.get('index') || '1', lang(url.searchParams.get('lang')));
        await describe(s, hash, url.searchParams.get('tmdb'), url.searchParams.get('kind'));
        // languages the file has no subtitles in wait a little for OpenSubtitles: the master lists them or not
        await Promise.all([s.init(), s.ready()]);   // ready before the player asks for it
        return send(res, 200, master(s), TYPES.m3u8);
    }

    const [file, l, title] = (a || '').split('.');
    const s = await session(hash, file, lang(l));
    const t = /^([mt])(\d+)$/.exec(title || '');
    if (t) await describe(s, hash, t[2], t[1] === 'm' ? 'movie' : 'tv');
    let m;
    if (b === 'video.m3u8') return send(res, 200, playlist(s, i => `seg${i}.m4s`, 'init.mp4'), TYPES.m3u8);
    if (b === 'init.mp4') return sendFile(res, await s.init());
    if ((m = /^seg(\d+)\.m4s$/.exec(b))) return sendFile(res, await s.segment(+m[1]));
    if ((m = /^(sub\d+|os[a-z]{2})\.m3u8$/.exec(b)) && await s.hasTrack(m[1])) return send(res, 200, playlist(s, i => `${m[1]}-${i}.vtt`), TYPES.m3u8);
    if ((m = /^(sub\d+|os[a-z]{2})-(\d+)\.vtt$/.exec(b)) && await s.hasTrack(m[1])) return send(res, 200, await s.subtitle(m[1], +m[2]), TYPES.vtt);
    return send(res, 404, 'not found');
}

// stop ffmpeg for files nobody is watching; forget them (and their segments) after a while
setInterval(() => {
    for (const [key, p] of sessions) p.then(s => {
        const idle = Date.now() - s.used;
        if (idle > IDLE_DROP_MS) { s.close(); sessions.delete(key); }
        else if (idle > IDLE_KILL_MS) s.stop();
    }, () => {});
}, 15000);

// a failed request or a file that won't delete must not stop the service
process.on('unhandledRejection', e => console.error('unhandled:', e && e.message || e));

fs.rmSync(cfg.cache, { recursive: true, force: true });
fs.mkdirSync(cfg.cache, { recursive: true });
http.createServer((req, res) => {
    handle(req, res).catch(e => { console.error(req.url, e.message); if (!res.headersSent) send(res, 500, e.message); else res.end(); });
}).listen(cfg.port, cfg.host, () => console.log(`lampa-remux on ${cfg.host}:${cfg.port}, TorrServer ${cfg.torrserver}, cache ${cfg.cache}`));
