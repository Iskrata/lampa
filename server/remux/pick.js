// Which release to play, decided here for every device, the TV included (README "Picking a release"):
//   GET /gst/pick?tmdb=<id>&kind=movie|tv[&season=&episode=][&lang=ja]
//   -> { audio, choices: [{ res, label, releases: [best first] }] best resolution first, found, took }, and
//      notOut: YYYY-MM-DD (or 'soon') for a film not out at home yet (no choices then)
// It searches Jackett the way Lampa's own parser does, keeps real seeders and drops dead releases (swarm.js),
// ranks with the browser's own rules (desktop/pick.js, run here unchanged), leaves out releases that failed
// for this title and puts the ones that played first (releases.js). The device then chooses the resolution
// for its screen and connection, and skips video it can't decode (desktop/play.js).
//   GET /gst/link?u=<Jackett .torrent link without its key>: that link, fetched with the key (TorrServer
//   fetches it), so the releases handed out never carry Jackett's key
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const cfg = require('./config');
const swarms = require('./swarm');
const releases = require('./releases');

// desktop/pick.js: next to this file on the home server (lampa-setup.ps1 copies it in), else the repo's
const RULES = [path.join(__dirname, 'desktop-pick.js'), path.join(__dirname, '..', '..', 'desktop', 'pick.js')].find(f => fs.existsSync(f));
const box = { window: {} };
vm.runInNewContext(fs.readFileSync(RULES, 'utf8'), box, { filename: RULES });
const rules = box.window.rubyPick;

const TMDB_KEEP_MS = 6 * 3600e3, SEARCH_KEEP_MS = 10 * 60000, SEARCH_MS = 30000, PER_RES = 10;
// link-only releases' hashes: Jackett answers in 0.2-0.8 s each (85 at once for Matchbox, 2026-10-20); the
// pick waits at most HASH_WAIT_MS for them, the rest are cached for the next pick
const HASH_WAIT_MS = 2500, HASH_AT_ONCE = 16, HASH_KEEP = 20000;

function cached(map, key, keepMs, make) {
    const c = map.get(key);
    if (c && Date.now() - c.at < keepMs) return c.p;
    const p = make();
    map.set(key, { at: Date.now(), p });
    p.catch(() => map.delete(key));
    return p;
}

async function json(url, ms) {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw Object.assign(new Error(`${new URL(url).host} answered ${r.status}`), { status: 502 });
    return r.json();
}

// the title as Lampa's title page has it (names, dates, runtimes, seasons, genres)
const titles = new Map();
function details(kind, tmdb) {
    return cached(titles, kind + tmdb, TMDB_KEEP_MS, () =>
        json(`https://api.themoviedb.org/3/${kind}/${tmdb}?api_key=${cfg.tmdbKey}&language=en` +
            (kind === 'movie' ? '&append_to_response=release_dates' : ''), 10000));
}

// The day a film can first be watched at home anywhere (TMDB's digital, physical or TV release dates), when TMDB
// knows one, as YYYY-MM-DD. Before it, every "WEB-DL" or "BluRay" of its name and year is another film: all 13
// releases of "The Odyssey 2026" were The Asylum's 86-min film on 2026-10-21 (ffprobe on ruby), while Nolan's
// comes out digitally on 2026-11-17 (US). HOME_EARLY_DAYS: releases leak a few days before the date.
const HOME = [4, 5, 6], HOME_EARLY_DAYS = 7;
function atHome(movie) {
    const days = [];
    for (const c of (movie.release_dates && movie.release_dates.results) || [])
        for (const r of c.release_dates || []) if (HOME.includes(r.type) && r.release_date) days.push(r.release_date.slice(0, 10));
    return days.sort()[0] || '';
}
// '' when it may be out at home, else the day it comes out, or 'soon' when TMDB has no home date yet and the film
// hasn't come out anywhere (its first release of any kind is still ahead)
function notOut(movie) {
    const day = atHome(movie);
    if (day) return Date.parse(day) - HOME_EARLY_DAYS * 86400e3 > Date.now() ? day : '';
    const first = [movie.release_date || ''];
    for (const c of (movie.release_dates && movie.release_dates.results) || [])
        for (const r of c.release_dates || []) if (r.release_date) first.push(r.release_date.slice(0, 10));
    const known = first.filter(Boolean).sort()[0];
    return known && Date.parse(known) > Date.now() ? 'soon' : '';
}

// GET /gst/home?tmdb=<film>: { notOut } for the title page's and billboard's Play (desktop/play.js later)
async function home(tmdb) {
    if (!/^\d+$/.test(tmdb || '')) throw Object.assign(new Error('tmdb=<id> needed'), { status: 400 });
    return { notOut: notOut(await details('movie', tmdb)) };
}

function jackettKey() {
    if (cfg.jackettKey) return cfg.jackettKey;
    try { return JSON.parse(fs.readFileSync(cfg.jackettConfig, 'utf8').replace(/^﻿/, '')).APIKey || ''; } catch (e) { return ''; }
}

// Lampa's own search (app.min.js jackett(), parse_lang "df"): the original title, films or TV, plus anime
const ANIME_LANGUAGES = ['ja', 'zh'];
const searches = new Map();
function search(movie, kind) {
    const query = movie.original_title || movie.original_name || movie.title || movie.name || '';
    const anime = ANIME_LANGUAGES.includes(movie.original_language) && (movie.genres || []).some(g => g.id === 16);
    const cat = (kind === 'tv' && movie.number_of_seasons > 0 ? '5000' : '2000') + (anime ? ',5070' : '');
    const key = jackettKey();
    if (!key) return Promise.reject(Object.assign(new Error('no Jackett key (JACKETT_KEY or JACKETT_CONFIG)'), { status: 503 }));
    return cached(searches, query + '|' + cat, SEARCH_KEEP_MS, async () => {
        const j = await json(`${cfg.jackett}/api/v2.0/indexers/all/results?apikey=${encodeURIComponent(key)}` +
            `&Query=${encodeURIComponent(query)}&Category[]=${cat}`, SEARCH_MS);
        return j.Results || [];
    });
}

// a Jackett download link fetched with the key: the .torrent file, or (LimeTorrents, TorrentGalaxyClone) a
// redirect to the release's magnet
function jackettGet(u, key) {
    return fetch(u + (u.includes('?') ? '&' : '?') + 'jackett_apikey=' + encodeURIComponent(key), { redirect: 'manual', signal: AbortSignal.timeout(SEARCH_MS) });
}
const withoutKey = l => l.replace(/([?&])jackett_apikey=[^&]*&?/, '$1').replace(/[?&]$/, '');

// the info-hash of a .torrent file: sha1 of its bencoded info dictionary, as it is in the file
function infoHash(b) {
    let i = 0;
    const skip = () => {   // past one bencoded value
        const c = b[i];
        if (c === 0x69) { i = b.indexOf(0x65, i) + 1; return; }                 // i<n>e
        if (c === 0x6c || c === 0x64) { i++; while (b[i] !== 0x65) { if (i >= b.length) throw new Error('cut'); skip(); } i++; return; }
        const colon = b.indexOf(0x3a, i), n = +b.slice(i, colon).toString();    // <n>:<bytes>
        if (colon < 0 || !(n >= 0)) throw new Error('not bencode');
        i = colon + 1 + n;
    };
    if (b[i++] !== 0x64) return '';
    while (i < b.length && b[i] !== 0x65) {
        const colon = b.indexOf(0x3a, i), n = +b.slice(i, colon).toString(), name = b.slice(colon + 1, colon + 1 + n).toString();
        i = colon + 1 + n;
        const start = i;
        skip();
        if (name === 'info') return crypto.createHash('sha1').update(b.slice(start, i)).digest('hex');
    }
    return '';
}

// Releases with only a .torrent link (LimeTorrents, TorrentGalaxyClone) have no hash in Jackett's results, so
// the trackers couldn't be asked about them and a failed one was never matched: on 2026-10-20 LimeTorrents'
// "Matchbox The Movie 2026 1080p WEB DL HEVC x265 5 1 BONE" (3079 seeders, b317b439, which the trackers say
// has 4) failed with no peers and was offered first again, and its twin by name was another torrent (d9576d60).
// Fetched through Jackett once per link (keyless) and kept; sets r.InfoHash. -> how many it found in time
const linkHashes = new Map();   // keyless link -> hash ('' when the answer had none)
let hashing = 0;
const hashQueue = [];
function linkHash(link, key) {
    const k = withoutKey(link);
    if (linkHashes.has(k)) return linkHashes.get(k);
    const p = new Promise(go => { hashing < HASH_AT_ONCE ? (hashing++, go()) : hashQueue.push(go); }).then(async () => {
        const r = await jackettGet(k, key);
        const loc = r.headers.get('location') || '';
        if (loc) return ((/btih:([0-9a-f]{40})/i.exec(loc) || [])[1] || '').toLowerCase();
        if (!r.ok) throw new Error(`Jackett answered ${r.status}`);
        return infoHash(Buffer.from(await r.arrayBuffer()));
    }).finally(() => { const next = hashQueue.shift(); next ? next() : hashing--; });
    linkHashes.set(k, p);
    p.then(h => { linkHashes.set(k, Promise.resolve(h)); if (linkHashes.size > HASH_KEEP) linkHashes.delete(linkHashes.keys().next().value); },
        e => { linkHashes.delete(k); console.error(`link hash: ${e.message}`); });
    return p;
}
async function resolveLinks(found) {
    // only our Jackett's links: the key is added to them
    const key = jackettKey(), todo = found.filter(r => r.Link && r.Link.startsWith(cfg.jackett + '/') && !rules.hashOf(r));
    let got = 0;
    await Promise.race([
        Promise.all(todo.map(r => linkHash(r.Link, key).then(h => { if (h) r.InfoHash = h, got++; }, () => {}))),
        new Promise(go => setTimeout(go, HASH_WAIT_MS))]);
    return { asked: todo.length, got };
}

// a Jackett download link without its key: TorrServer (on this machine) fetches it through link() below
function keyless(l) {
    return l && /[?&]jackett_apikey=/.test(l) ? `http://127.0.0.1:${cfg.port}/gst/link?u=${encodeURIComponent(withoutKey(l))}` : l;
}

// a release as a browser gets it: what Lampa's torrent flow and the lists read, and no Jackett key
const FIELDS = ['Title', 'Tracker', 'Size', 'Seeders', 'Peers', 'PublishDate', 'MagnetUri', 'InfoHash'];
function handOut(r, played) {
    const out = {};
    for (const f of FIELDS) if (r[f] != null) out[f] = r[f];
    if (r.Link) out.Link = keyless(r.Link);
    if (played) out.played = true;
    return out;
}

async function pick(q) {
    const t0 = Date.now(), kind = q.get('kind') === 'movie' ? 'movie' : 'tv', tmdb = q.get('tmdb') || '';
    if (!/^\d+$/.test(tmdb)) throw Object.assign(new Error('tmdb=<id> needed'), { status: 400 });
    const target = kind === 'tv' ? { season: +q.get('season') || 1, episode: +q.get('episode') || 1 } : null;
    const movie = await details(kind, tmdb);
    // not out yet: nothing found under its name is it (play.js says when it comes out)
    const later = kind === 'movie' ? notOut(movie) : '';
    if (later) {
        console.log(`pick movie ${tmdb}: not out at home until ${later}`);
        return { audio: null, choices: [], found: 0, notOut: later, took: Date.now() - t0 };
    }
    // copies: alive() writes the real seeders into them, and the search stays cached for the next ask
    const found = (await search(movie, kind)).map(r => Object.assign({}, r));
    const links = await resolveLinks(found);
    const known = rules.twins(found);
    const alive = rules.alive(found, await swarms.report(known.hashes), known);
    const mem = releases.of(tmdb, kind, rules.key), id = r => rules.hashOf(r);
    // a release still without a hash (its link not resolved in time) is matched by name
    // and one seen to be another film of this name (sameFilm) is left out for this title
    const usable = alive.filter(r => id(r) ? !mem.failed.has(id(r)) && !mem.wrong.has(id(r)) :
        !mem.failedNames.has(rules.key(r.Title)) && !mem.wrongNames.has(rules.key(r.Title)));
    const audio = rules.anime(movie) ? (q.get('lang') === 'ja' ? 'ja' : 'en') : null;
    const best = rules.best(usable, movie, target, audio);
    const choices = [2160, 1080, 720].filter(res => best.groups[res]).map(res => {
        // one torrent is listed by several indexers: once is enough (the best-ranked listing)
        const seen = new Set(), g = best.groups[res].filter(r => { const k = id(r) || rules.key(r.Title); return !seen.has(k) && seen.add(k); });
        const played = g.filter(r => mem.played.has(id(r)));
        return { res, label: rules.LABEL[res], releases: played.concat(g.filter(r => !mem.played.has(id(r)))).slice(0, PER_RES)
            .map(r => handOut(r, mem.played.has(id(r)))) };
    });
    const took = Date.now() - t0;
    console.log(`pick ${kind} ${tmdb}${target ? ` S${target.season}E${target.episode}` : ''}: ${found.length} found ` +
        `(${links.got}/${links.asked} link-only hashed), ` +
        `${found.length - alive.length} dead, ${alive.length - usable.length} failed or another film before, ` +
        choices.map(c => `${c.label} ${c.releases.length}${c.releases[0].played ? ' (played first)' : ''}`).join(', ') + ` in ${(took / 1000).toFixed(1)} s`);
    return { audio: best.audio, choices, found: found.length, took };
}

// Another film of the same name and year: release names can't tell them apart ("The Odyssey 2026 1080p AMZN
// WEB-DL" was The Asylum's 86-min mockbuster, not Nolan's 173-min film, 2026-10-21), the video's length can.
// Called when a film's file is opened (server.js, master.m3u8): a length far from TMDB's runtime is remembered
// for this title (releases.wrong) and refused. -> '' when it may be this film, else why it isn't.
// The margins leave room for other cuts: Kingdom of Heaven's director's cut is 1.35x the theatrical 144 min,
// Apocalypse Now's Final Cut 1.24x. TMDB's runtime is the theatrical one; under 40 min it isn't trusted.
const SHORTER = 0.7, LONGER = 1.5, OFF_MIN = 20;
async function sameFilm(tmdb, kind, hash, seconds, name) {
    if (kind !== 'movie' || !/^\d+$/.test(tmdb || '') || !seconds) return '';
    let movie;
    try { movie = await details('movie', tmdb); } catch (e) { return ''; }
    const want = movie.runtime || 0, got = seconds / 60;
    if (want < 40 || Math.abs(got - want) < OFF_MIN || (got >= want * SHORTER && got <= want * LONGER)) return '';
    const why = `${Math.round(got)} min, ${movie.title} is ${want} min`;
    releases.wrong(tmdb, 'movie', hash, why, name);
    return why;
}

// TorrServer fetching a .torrent link handed out by pick(): only ever our Jackett, with the key added
async function link(u, res) {
    const key = jackettKey();
    if (!u || !u.startsWith(cfg.jackett + '/') || !key) { res.writeHead(404); return res.end(); }
    const r = await jackettGet(u, key);
    // some indexers (TorrentGalaxyClone) answer with a redirect to a magnet link, which TorrServer follows
    if (r.status >= 300 && r.status < 400) { res.writeHead(r.status, { Location: r.headers.get('location') }); return res.end(); }
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/x-bittorrent' });
    res.end(Buffer.from(await r.arrayBuffer()));
}

// Lampa's own Jackett search (its parser, the manual torrent list) comes here instead of to Jackett (Caddy routes
// /jackett/api/ here): the key is added here and taken out of the answer, where every download link carries
// it, so browsers never hold it (asked for 2026-10-20: it was in every browser's settings and in search URLs).
async function lampaSearch(path, query, res) {
    const key = jackettKey();
    if (!key || !/^\/api\/v2\.0\/indexers\/[\w:.-]+\/results$/.test(path)) { res.writeHead(404); return res.end(); }
    const q = new URLSearchParams(query);
    q.set('apikey', key);
    const r = await fetch(`${cfg.jackett}${path}?${q}`, { signal: AbortSignal.timeout(SEARCH_MS) });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { res.writeHead(502); return res.end(); }
    if (Array.isArray(j.Results)) for (const x of j.Results) if (x.Link) x.Link = keyless(x.Link);
    res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(j).split(key).join('hidden'));
}

module.exports = { pick, home, link, lampaSearch, sameFilm, rules };
