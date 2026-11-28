// Warming a file up before anyone plays it (README "Warming up"):
//   GET /gst/warm?link=<magnet or this service's /gst/link>[&season=&episode=][&at=|&pct=][&secs=][&lang=ja][&title=]
//   GET /gst/warm?link=...&like=<hash>:<file>   (the same episode as that file of another torrent, by its name: a player
//                                                switching releases, desktop/swap.js)
//   GET /gst/warm?hash=<hash>&index=<file>[&at=|&pct=][&lang=ja]        (a file of a torrent already added: the next
//                                                                   episode in the player's playlist)
// adds the torrent to TorrServer, waits for its file list, opens the file as the master does (probe and index,
// kept on disk by source.js) and makes the segments of the first WARM_S (60) seconds from where it will start (at:
// the place saved for it in seconds, or pct: a percent). TorrServer closes an idle torrent after 30 s (TorrentDisconnectTimeout) and keeps
// its pieces in memory, so what lasts is on disk: the file list (TorrServer's database, torrserver.js keep), the
// file's start and index, the session and those segments. Play then gets its master at once and the first
// seconds from disk while the torrent connects again.
// secs: how much to make (default WARM_S; a player switching releases while it waits asks for less, desktop/swap.js)
// -> { hash, index, segments: [from, to], took, made, seconds, duration[, at, shift, aligned, pairs] } when done; 404
// when the file isn't in the torrent. made: ms making the segments this call made (not the file list, the open, or
// segments already on disk), `seconds` of video: how fast the torrent keeps up now (desktop/upgrade.js). With like=,
// `at` is a moment of that other file: at/shift/aligned say where that moment is in this one (align.js)
'use strict';
const cfg = require('./config');
const { post: torrserver, keep } = require('./torrserver');
const align = require('./align');

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
    const link = q.get('link') || '';
    let season = +q.get('season') || 0, episode = +q.get('episode') || 0;
    const like = /^([0-9a-f]{40}):(\d+)$/i.exec(q.get('like') || '');
    if (like && !season) {
        // (a torrent TorrServer holds only in its database lists its files once it has loaded it: fileList waits)
        const f = (await fileList(like[1].toLowerCase()).catch(() => [])).find(x => String(x.id) === like[2]) || {};
        const e = episodeOf((f.path || '').split('/').pop());
        if (e) ({ season, episode } = e);
    }
    if (!/^[0-9a-f]{40}$/.test(hash) && !allowed(link)) throw fail(400, 'link=<magnet> or hash=&index= needed');
    // a player switching releases (like=) isn't kept waiting by warm-ups for later
    if (running.size >= AT_ONCE && !like) throw fail(429, 'busy');
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
        // what this call made (segments not on disk before), and how long that took: how fast the torrent keeps up
        let made = 0, madeS = 0, mine = 0;
        const make = async (n1, n2) => {
            for (let n = n1; n <= n2; n++) {
                const had = s.has(n), t1 = mine = Date.now();
                await s.segment(n);
                if (!had) { made += Date.now() - t1; madeS += b[n + 1] - b[n]; }
            }
        };
        let at = Math.min(+q.get('at') || s.m.duration * pct / 100, s.m.duration), fit = null;
        // `at` is in the other release's video: the same moment in this one (align.js)
        if (like) {
            // the playing file may itself be unreadable (the torrent sends too little: a switch away from it is why
            // this was asked): then this file's time as it is
            fit = await session(like[1].toLowerCase(), like[2], lang).then(async a => { await a.init(); return a; })
                .then(a => align.map(a, s, at, (t1, t2) => make(s.index(t1), s.index(t2))), e => ({ at, how: 'guess', pairs: 0, why: e.message }));
            at = fit.at;
        }
        const from = s.index(at);
        const want = Math.min(Math.max(+q.get('secs') || WARM_S, 1), WARM_S);
        let to = from;
        while (to + 1 < b.length - 1 && b[to + 1] - b[from] < want) to++;
        const facts = () => Object.assign({ seconds: +madeS.toFixed(1), duration: +s.m.duration.toFixed(1) },
            fit ? { at: +at.toFixed(2), shift: +(at - (+q.get('at') || 0)).toFixed(2), aligned: fit.how, pairs: fit.pairs } : {});
        const done = `${hash}:${index}:${lang}:${from}`;
        // (its segments may be gone since: played past and pruned, or the session closed)
        if (!fit && Date.now() - (warmed.get(done) || 0) < AGAIN_MS && s.has(from) && s.has(to)) return { hash, index, segments: [from, to], took: Date.now() - t0, again: true, ...facts() };
        // one segment after another, as a player asks for them (one ffmpeg run from `from`)
        await make(from, to);
        // nobody else asked for anything meanwhile: ffmpeg would read on 30 segments for nobody
        if (s.used - mine < 20) s.stop();
        warmed.set(done, Date.now());
        if (warmed.size > 500) warmed.delete(warmed.keys().next().value);
        keep(hash).catch(e => console.error('keep:', e.message));
        const took = s.m.took || {};
        console.log(`warm ${hash.slice(0, 8)}:${index}${season ? ` S${season}E${episode}` : ''} in ${sec(Date.now() - t0)}: file list ${sec(listed - t0)}, ` +
            `open ${sec(opened - listed)}${took.kept ? ' (kept from an earlier open)' : ''}, seg${from}-${to} ${sec(Date.now() - opened)}` +
            (fit ? `, ${like[1].slice(0, 8)}:${like[2]} at ${(+q.get('at') || 0).toFixed(1)} s is ${at.toFixed(1)} s here (${fit.how}${fit.pairs ? `, ${fit.pairs} lines` : ''})` : '') +
            (madeS ? `; made ${madeS.toFixed(0)} s of video in ${sec(made)}` : ''));
        return { hash, index, segments: [from, to], took: Date.now() - t0, made, ...facts() };
    } finally {
        running.delete(key);
    }
}

module.exports = { warm, episodeOf, pickFile };
