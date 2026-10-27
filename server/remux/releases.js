// What Ruby remembers about releases, per title (README "Picking a release"), for /gst/pick:
//   * played: this service sent PLAYED_S of a release's video for the title (seeks back don't count twice)
//   * failed: it was seen dead (swarm.js), or a player gave up on it (desktop/swarm.js: no peers, too slow)
//   * wrong: its video is another film of the same name (pick.js `sameFilm`: The Asylum's 86-min "The Odyssey"
//     2026 played for Nolan's 173-min one on 2026-10-21). Only for this title: it is the right film for the other one
// A failed release isn't offered again for FAIL_KEEP_MS[why], for any title (a torrent that sends nothing does so
// whatever it was opened for: bbbc0a68, Vikings S06, failed on 2026-10-20 opened from Vikings: Athelstan's
// Journal's page, tv 65491), or until it plays (picked by hand). One that played for a title comes first in its
// resolution for that title. Kept across restarts in REMUX_RELEASES:
//   { "<m|t><tmdb>": { "<hash>": { ok: time, fail: time, wrong: time, why, title } } }
'use strict';
const fs = require('fs');
const cfg = require('./config');

const PLAYED_S = 120;
// how long a failure keeps a release out (the user's call, 2026-10-27). Too slow and no peers are the swarm and
// this server's download at that moment: Desperate Housewives S2's two 1080p packs had played for the title,
// then one slow minute each banned them for good and S2E12 had nothing left. Dead (nothing sent for 25 s while
// a tracker still lists it) is a stronger sign. No video in it doesn't change: kept. Unknown reasons: a day.
const HOUR = 3600e3, FAIL_KEEP_MS = { slow: 6 * HOUR, nopeers: 6 * HOUR, dead: 24 * HOUR, nofiles: Infinity };
const failKeep = why => FAIL_KEEP_MS[why] || 24 * HOUR;

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
    const keep = failKeep(why);
    console.log(`${hash.slice(0, 8)} failed (${why}) for ${key}: not offered ${keep === Infinity ? 'again' : `for ${keep / HOUR} h`}`);
    return true;
}

// another film than this title, by its video's length (pick.js sameFilm): never offered for this title again
function wrong(tmdb, kind, hash, why, name) {
    const key = titleKey(tmdb, kind);
    mark(key, hash.toLowerCase(), 'wrong', why, name);
    console.log(`${hash.slice(0, 8)} is not ${key} (${why}): not offered for it again`);
}

// { played: Set, failed: Set, wrong: Set } of hashes: played for this title, failed for any within its reason's
// FAIL_KEEP_MS; whichever happened last counts.
// wrong: another film for this title. failedNames / wrongNames: those release names through nameKey, for a
// release whose hash isn't known (pick.js)
function of(tmdb, kind, nameKey) {
    const last = {}, now = Date.now();   // hash -> { ok, fail, why, title } latest across titles
    for (const t of Object.values(titles)) for (const [h, r] of Object.entries(t)) {
        const l = last[h] = last[h] || { ok: 0, fail: 0 };
        l.ok = Math.max(l.ok, r.ok || 0);
        if ((r.fail || 0) > l.fail) l.fail = r.fail, l.why = r.why;
        if (r.title) l.title = r.title;
    }
    const played = new Set(), bad = new Set(), names = new Set();
    for (const [h, l] of Object.entries(last)) if (l.fail > l.ok && now - l.fail < failKeep(l.why)) { bad.add(h); if (l.title && nameKey) names.add(nameKey(l.title)); }
    const wrongs = new Set(), wrongNames = new Set();
    for (const [h, r] of Object.entries(titles[titleKey(tmdb, kind)] || {})) {
        if ((r.wrong || 0) > (r.ok || 0)) { wrongs.add(h); if (r.title && nameKey) wrongNames.add(nameKey(r.title)); }
        else if ((r.ok || 0) > last[h].fail) played.add(h);
    }
    return { played, failed: bad, failedNames: names, wrong: wrongs, wrongNames };
}

// when the release last played for any title (0: never). swarm.js: one that played after it was seen dead isn't
// dead (23609c03, Desperate Housewives S2 720p, was called dead at 07:32:59 on 2026-10-27, played 120 s ten
// seconds later, and stayed hidden as dead, so S2E12 had nothing left to play)
function lastPlayed(hash) {
    let ok = 0;
    for (const t of Object.values(titles)) if (t[hash]) ok = Math.max(ok, t[hash].ok || 0);
    return ok;
}

module.exports = { watching, sent, failed, wrong, of, lastPlayed };
