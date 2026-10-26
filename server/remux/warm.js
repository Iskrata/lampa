// Warming a file up before anyone plays it (README "Warming up"):
//   GET /gst/warm?link=<magnet or this service's /gst/link>[&season=&episode=][&pct=][&lang=ja][&title=]
//   GET /gst/warm?hash=<hash>&index=<file>[&pct=][&lang=ja]        (a file of a torrent already added: the next
//                                                                   episode in the player's playlist)
// adds the torrent to TorrServer, waits for its file list, opens the file as the master does (probe and index,
// kept on disk by source.js) and makes the segments of the first WARM_S (60) seconds from where it will start (pct,
// the progress saved for it). TorrServer closes an idle torrent after 30 s (TorrentDisconnectTimeout) and keeps
// its pieces in memory, so what lasts is on disk: the file list (TorrServer's database, torrserver.js keep), the
// file's start and index, the session and those segments. Play then gets its master at once and the first
// seconds from disk while the torrent connects again.
// -> { hash, index, segments: [from, to], took } when done; 404 when the file isn't in the torrent
'use strict';
const cfg = require('./config');
const { post: torrserver, keep } = require('./torrserver');

// WARM_S: the torrent comes back to Play closed (TorrServer's 30 s idle timeout) and finding peers again took 41 s
// for the first segment past the warm ones (Breaking Bad S2E3, 2026-10-26, README "Warming up"): 30 s made playback
// stop for ~11 s at 0:30
const AT_ONCE = 2, LIST_MS = 60000, WARM_S = 60, AGAIN_MS = 30 * 60000;
const VIDEO = /\.(mkv|mp4|m4v|avi|mov|ts|m2ts|webm|wmv)$/i;
const running = new Set(), warmed = new Map();   // "<hash>:<file>:<lang>:<seg>" -> when it was warmed
const sec = ms => (ms / 1000).toFixed(1) + ' s';
const fail = (status, message) => Object.assign(new Error(message), { status });

// S02E10, 2x10
function episodeOf(p) {
    const m = /s(\d{1,2})[ ._-]?e(\d{1,3})/i.exec(p) || /\b(\d{1,2})x(\d{2,3})\b/i.exec(p);
    return m ? { season: +m[1], episode: +m[2] } : null;
}
// the file Play would start (desktop/pick.js file): the episode asked for, else the largest video
function pickFile(files, season, episode) {
    const videos = files.filter(f => VIDEO.test(f.path || ''));
    if (season) return videos.find(f => { const e = episodeOf(f.path.split('/').pop()); return e && e.season === season && e.episode === episode; });
    return videos.sort((a, b) => (b.length || 0) - (a.length || 0))[0];
}

async function fileList(hash) {
    const until = Date.now() + LIST_MS;
    for (;;) {
        const t = await torrserver('/torrents', { action: 'get', hash });
        if (t && t.file_stats && t.file_stats.length) return t.file_stats;
        if (Date.now() > until) throw fail(504, 'no file list in 60 s');
        await new Promise(r => setTimeout(r, 1000));
    }
}

// only what Play itself would add: a magnet, or a .torrent link through this service (pick.js keyless)
const allowed = l => /^magnet:\?/i.test(l) || l.startsWith(`http://127.0.0.1:${cfg.port}/gst/link?`);

// session(hash, index, lang): server.js's, the one the master and the segments use
async function warm(q, session) {
    const t0 = Date.now(), lang = q.get('lang') === 'ja' ? 'ja' : 'en';
    let hash = (q.get('hash') || '').toLowerCase(), index = q.get('index') || '';
    const link = q.get('link') || '', season = +q.get('season') || 0, episode = +q.get('episode') || 0;
    if (!/^[0-9a-f]{40}$/.test(hash) && !allowed(link)) throw fail(400, 'link=<magnet> or hash=&index= needed');
    if (running.size >= AT_ONCE) throw fail(429, 'busy');
    const key = hash || link;
    if (running.has(key)) throw fail(409, 'already warming');
    running.add(key);
    try {
        if (!hash) {
            const t = await torrserver('/torrents', { action: 'add', link, title: q.get('title') || '', save_to_db: false });
            if (!t || !t.hash) throw fail(502, 'TorrServer refused the torrent');
            hash = t.hash.toLowerCase();
        }
        const files = await fileList(hash), listed = Date.now();
        if (!index) {
            const f = pickFile(files, season, episode);
            if (!f) throw fail(404, season ? `S${season}E${episode} isn't in it` : 'no video in it');
            index = String(f.id);
        }
        const s = await session(hash, index, lang), opened = Date.now();
        await s.init();
        const pct = Math.min(Math.max(+q.get('pct') || 0, 0), 99), b = s.m.bounds;
        const from = s.index(s.m.duration * pct / 100);
        let to = from;
        while (to + 1 < b.length - 1 && b[to + 1] - b[from] < WARM_S) to++;
        const done = `${hash}:${index}:${lang}:${from}`;
        if (Date.now() - (warmed.get(done) || 0) < AGAIN_MS) return { hash, index, segments: [from, to], took: Date.now() - t0, again: true };
        // one segment after another, as a player asks for them (one ffmpeg run from `from`)
        let mine = 0;
        for (let n = from; n <= to; n++) { mine = Date.now(); await s.segment(n); }
        // nobody else asked for anything meanwhile: ffmpeg would read on 30 segments for nobody
        if (s.used - mine < 20) s.stop();
        warmed.set(done, Date.now());
        if (warmed.size > 500) warmed.delete(warmed.keys().next().value);
        keep(hash).catch(e => console.error('keep:', e.message));
        const took = s.m.took || {};
        console.log(`warm ${hash.slice(0, 8)}:${index}${season ? ` S${season}E${episode}` : ''} in ${sec(Date.now() - t0)}: file list ${sec(listed - t0)}, ` +
            `open ${sec(opened - listed)}${took.kept ? ' (kept from an earlier open)' : ''}, seg${from}-${to} ${sec(Date.now() - opened)}`);
        return { hash, index, segments: [from, to], took: Date.now() - t0 };
    } finally {
        running.delete(key);
    }
}

module.exports = { warm, episodeOf, pickFile };
