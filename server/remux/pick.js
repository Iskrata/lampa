// Which release to play, decided here for every device, the TV included (README "Picking a release"):
//   GET /gst/pick?tmdb=<id>&kind=movie|tv[&season=&episode=][&lang=ja]
//   -> { audio, choices: [{ res, label, releases: [best first] }] best resolution first, found, took }
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
const cfg = require('./config');
const swarms = require('./swarm');
const releases = require('./releases');

// desktop/pick.js: next to this file on the home server (lampa-setup.ps1 copies it in), else the repo's
const RULES = [path.join(__dirname, 'desktop-pick.js'), path.join(__dirname, '..', '..', 'desktop', 'pick.js')].find(f => fs.existsSync(f));
const box = { window: {} };
vm.runInNewContext(fs.readFileSync(RULES, 'utf8'), box, { filename: RULES });
const rules = box.window.rubyPick;

const TMDB_KEEP_MS = 6 * 3600e3, SEARCH_KEEP_MS = 10 * 60000, SEARCH_MS = 30000, PER_RES = 10;

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
        json(`https://api.themoviedb.org/3/${kind}/${tmdb}?api_key=${cfg.tmdbKey}&language=en`, 10000));
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

// a Jackett download link without its key: TorrServer (on this machine) fetches it through link() below
function keyless(l) {
    return l && /[?&]jackett_apikey=/.test(l) ?
        `http://127.0.0.1:${cfg.port}/gst/link?u=${encodeURIComponent(l.replace(/([?&])jackett_apikey=[^&]*&?/, '$1').replace(/[?&]$/, ''))}` : l;
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
    // copies: alive() writes the real seeders into them, and the search stays cached for the next ask
    const found = (await search(movie, kind)).map(r => Object.assign({}, r));
    const known = rules.twins(found);
    const alive = rules.alive(found, await swarms.report(known.hashes), known);
    const mem = releases.of(tmdb, kind), id = r => rules.hashOf(r);
    const usable = alive.filter(r => !mem.failed.has(id(r)));
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
    console.log(`pick ${kind} ${tmdb}${target ? ` S${target.season}E${target.episode}` : ''}: ${found.length} found, ` +
        `${found.length - alive.length} dead, ${alive.length - usable.length} failed before, ` +
        choices.map(c => `${c.label} ${c.releases.length}${c.releases[0].played ? ' (played first)' : ''}`).join(', ') + ` in ${(took / 1000).toFixed(1)} s`);
    return { audio: best.audio, choices, found: found.length, took };
}

// TorrServer fetching a .torrent link handed out by pick(): only ever our Jackett, with the key added
async function link(u, res) {
    const key = jackettKey();
    if (!u || !u.startsWith(cfg.jackett + '/') || !key) { res.writeHead(404); return res.end(); }
    const r = await fetch(u + (u.includes('?') ? '&' : '?') + 'jackett_apikey=' + encodeURIComponent(key), { redirect: 'manual', signal: AbortSignal.timeout(SEARCH_MS) });
    // some indexers (TorrentGalaxyClone) answer with a redirect to a magnet link, which TorrServer follows
    if (r.status >= 300 && r.status < 400) { res.writeHead(r.status, { Location: r.headers.get('location') }); return res.end(); }
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/x-bittorrent' });
    res.end(Buffer.from(await r.arrayBuffer()));
}

// Lampa's own Jackett search (its parser, the manual torrent list) comes here instead of to Jackett (Caddy routes
// /jackett/api/ here): the key is added here and taken out of the answer, where every download link carries
// it, so browsers never hold it (asked for 2026-10-20: it was in every browser's settings and in search URLs).
async function search(path, query, res) {
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

module.exports = { pick, link, search, rules };
