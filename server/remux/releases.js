// What Ruby remembers about releases, per title (README "Picking a release"), for /gst/pick:
//   * played: this service sent PLAYED_S of a release's video for the title (seeks back don't count twice)
//   * failed: it was seen dead (swarm.js), or a player gave up on it (desktop/swarm.js: no peers, too slow)
//   * wrong: its video is another film of the same name (pick.js `sameFilm`: The Asylum's 86-min "The Odyssey"
//     2026 played for Nolan's 173-min one on 2026-10-21). Only for this title: it is the right film for the other one
// A failed release is never offered again, for any title (a torrent that sends nothing does so whatever it
// was opened for: bbbc0a68, Vikings S06, failed on 2026-10-20 opened from Vikings: Athelstan's Journal's page,
// tv 65491), unless it plays later (picked by hand). One that played for a title comes first in its
// resolution for that title. Kept across restarts in REMUX_RELEASES:
//   { "<m|t><tmdb>": { "<hash>": { ok: time, fail: time, wrong: time, why, title } } }
'use strict';
const fs = require('fs');
const cfg = require('./config');

const PLAYED_S = 120;

let titles = {};
try { titles = JSON.parse(fs.readFileSync(cfg.releases, 'utf8')); } catch (e) {}
let saving = null;
function save() {
    if (saving) return;
    saving = setTimeout(() => { saving = null; fs.writeFile(cfg.releases, JSON.stringify(titles), () => {}); }, 1000);
}

const titleKey = (tmdb, kind) => (kind === 'movie' ? 'm' : 't') + tmdb;

// hash -> { title (key), name, sent: Set of "<file>:<segment>", seconds }: what this process saw played
const seen = new Map();

// a request for one of the torrent's files named its title (the master's tmdb/kind, or a segment's path)
function watching(hash, tmdb, kind, name) {
    if (!tmdb) return;
    hash = hash.toLowerCase();
    let s = seen.get(hash);
    if (!s) seen.set(hash, s = { sent: new Set(), seconds: 0 });
    s.title = titleKey(tmdb, kind);
    if (name) s.name = name;
}

function mark(title, hash, field, why, name) {
    const t = titles[title] = titles[title] || {}, r = t[hash] = t[hash] || {};
    r[field] = Date.now();
    if (why) r.why = why;
    if (name && !r.title) r.title = name;
    save();
}

// a segment of <seconds> sent to a player
function sent(hash, file, segment, seconds) {
    const s = seen.get(hash.toLowerCase());
    if (!s || !s.title || s.done || s.sent.has(file + ':' + segment)) return;
    s.sent.add(file + ':' + segment);
    s.seconds += seconds;
    if (s.seconds < PLAYED_S) return;
    s.done = true;
    mark(s.title, hash.toLowerCase(), 'ok', null, s.name);
    console.log(`${hash.slice(0, 8)} played ${Math.round(s.seconds)} s of ${s.title}: offered first from now on`);
}

// title: { tmdb, kind } when the caller knows it (a player's report), else the title this hash was seen with
function failed(hash, why, title, name) {
    hash = hash.toLowerCase();
    const s = seen.get(hash), key = title && title.tmdb ? titleKey(title.tmdb, title.kind) : s && s.title;
    if (!key) return false;
    mark(key, hash, 'fail', why, name || s && s.name);
    if (s) s.done = false, s.seconds = 0, s.sent.clear();
    console.log(`${hash.slice(0, 8)} failed (${why}) for ${key}: not offered again`);
    return true;
}

// another film than this title, by its video's length (pick.js sameFilm): never offered for this title again
function wrong(tmdb, kind, hash, why, name) {
    const key = titleKey(tmdb, kind);
    mark(key, hash.toLowerCase(), 'wrong', why, name);
    console.log(`${hash.slice(0, 8)} is not ${key} (${why}): not offered for it again`);
}

// { played: Set, failed: Set, wrong: Set } of hashes: played for this title, failed for any; whichever happened last counts.
// wrong: another film for this title. failedNames / wrongNames: those release names through nameKey, for a
// release whose hash isn't known (pick.js)
function of(tmdb, kind, nameKey) {
    const last = {};   // hash -> { ok, fail, title } latest across titles
    for (const t of Object.values(titles)) for (const [h, r] of Object.entries(t)) {
        const l = last[h] = last[h] || { ok: 0, fail: 0 };
        l.ok = Math.max(l.ok, r.ok || 0); l.fail = Math.max(l.fail, r.fail || 0);
        if (r.title) l.title = r.title;
    }
    const played = new Set(), bad = new Set(), names = new Set();
    for (const [h, l] of Object.entries(last)) if (l.fail > l.ok) { bad.add(h); if (l.title && nameKey) names.add(nameKey(l.title)); }
    const wrongs = new Set(), wrongNames = new Set();
    for (const [h, r] of Object.entries(titles[titleKey(tmdb, kind)] || {})) {
        if ((r.wrong || 0) > (r.ok || 0)) { wrongs.add(h); if (r.title && nameKey) wrongNames.add(nameKey(r.title)); }
        else if ((r.ok || 0) > last[h].fail) played.add(h);
    }
    return { played, failed: bad, failedNames: names, wrong: wrongs, wrongNames };
}

module.exports = { watching, sent, failed, wrong, of };
