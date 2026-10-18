// Better English subtitles from OpenSubtitles (server/remux/README.md, "Subtitles from OpenSubtitles"), for a
// file whose own are TV captions (ALL CAPS, cut into 1-2 s pieces) or that has none. Downloads cost quota
// (OpenSubtitles counts them per account per day), so each is made once and kept in cfg.subs for everyone.
//   find({ hash, index, url, size, tmdb, kind, name }) -> { id, release, match, cues } | null
//   align(cues, ref) -> { cues, anchors, speed, from, to } | null: moved onto the file's own captions' timing
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const API = 'https://api.opensubtitles.com/api/v1', UA = 'Ruby v1.0';
let login = null;   // { token, base, until }

function creds() {
    const c = { key: process.env.OPENSUBTITLES_API_KEY, user: process.env.OPENSUBTITLES_USER, pass: process.env.OPENSUBTITLES_PASSWORD };
    // the private settings file (never in git): KEY=value lines
    try {
        for (const line of fs.readFileSync(cfg.opensubtitlesEnv, 'utf8').split(/\r?\n/)) {
            const m = /^\s*(OPENSUBTITLES_\w+)\s*=\s*(.*?)\s*$/.exec(line);
            if (m) c[{ OPENSUBTITLES_API_KEY: 'key', OPENSUBTITLES_USER: 'user', OPENSUBTITLES_PASSWORD: 'pass' }[m[1]]] = m[2];
        }
    } catch (e) { /* no file: environment only */ }
    return c;
}

async function request(base, route, opts) {
    const c = creds();
    const headers = { 'Api-Key': c.key, 'User-Agent': UA, Accept: 'application/json' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    const r = await fetch(base + route, { method: opts.body ? 'POST' : 'GET', headers, body: opts.body && JSON.stringify(opts.body), redirect: 'follow' });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* html error page */ }
    if (!r.ok) throw Object.assign(new Error(`opensubtitles ${route.split('?')[0]}: ${r.status} ${(json && json.message) || text.slice(0, 120)}`), { status: r.status });
    return json;
}

// signed in, a download counts against the account's daily quota instead of the much smaller anonymous one
async function session() {
    const c = creds();
    if (!c.user || !c.pass) return { token: null, base: API };
    if (login && login.until > Date.now()) return login;
    const j = await request(API, '/login', { body: { username: c.user, password: c.pass } });
    login = { token: j.token, base: j.base_url ? `https://${j.base_url}/api/v1` : API, until: Date.now() + 20 * 3600e3 };
    console.log(`opensubtitles: signed in (${j.user && j.user.allowed_downloads} downloads a day${j.user && j.user.vip ? ', VIP' : ''})`);
    return login;
}

// OpenSubtitles' file hash: size + the sum of the first and last 64 KiB as little-endian 64-bit words
async function moviehash(url, size) {
    const CH = 65536;
    if (!size || size < CH * 2) return null;
    const part = async (from) => {
        const r = await fetch(url, { headers: { Range: `bytes=${from}-${from + CH - 1}` } });
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length !== CH) throw new Error('short read');
        return b;
    };
    let h = BigInt(size);
    for (const b of [await part(0), await part(size - CH)]) for (let i = 0; i < CH; i += 8) h = (h + b.readBigUInt64LE(i)) & 0xFFFFFFFFFFFFFFFFn;
    return h.toString(16).padStart(16, '0');
}

// "S01E12", "1x12" in the file's name
function episodeOf(name) {
    const m = /S(\d{1,2})[ ._-]?E(\d{1,3})/i.exec(name || '') || /\b(\d{1,2})x(\d{2,3})\b/.exec(name || '');
    return m ? { season: +m[1], episode: +m[2] } : null;
}

// a release's source (WEB, DVD, Blu-ray, TV) and its other tags. Only these count when comparing names: the
// show's and the episode's words are in most names (with them, S1E12's DVD rips "...Every Day a Little
// Death.DVDRip" beat the WEB rip of the same broadcast, 2026-10-18).
function source(s) {
    s = String(s || '').toLowerCase();
    return /web/.test(s) ? 'web' : /dvd/.test(s) ? 'dvd' : /blu-?ray|bdrip|brrip|bdremux/.test(s) ? 'bluray' : /hdtv|pdtv/.test(s) ? 'tv' : '';
}
const TAGS = /^(amzn|nf|hulu|dsnp|hmax|atvp|x264|x265|h264|h265|hevc|avc|480p|576p|720p|1080p|2160p|proper|repack)$/;
function tags(s) {
    const w = String(s || '').toLowerCase().split(/[^a-z0-9]+/);
    const group = (/-([a-z0-9]+)(\[[^\]]*\])?(\.[a-z0-9]{2,4})?$/i.exec(String(s || '')) || [])[1];
    return new Set(w.filter(x => TAGS.test(x)).concat(group ? ['group:' + group.toLowerCase()] : []));
}

// the subtitle most likely to fit this file: the same file (hash) first, then the same source (WEB vs DVD
// timings and cuts differ) and tags, not for the hearing impaired ([door slams]), then the most downloaded
function best(list, name) {
    const file = path.basename(name || ''), mine = tags(file), src = source(file);
    const score = a => (a.moviehash_match ? 1000 : 0) +
        (src && source(a.release) === src ? 40 : 0) +
        [...tags(a.release)].filter(w => mine.has(w)).length * 10 +
        (a.hearing_impaired ? -15 : 0) + (a.from_trusted ? 5 : 0) + Math.log10(1 + (a.download_count || 0));
    return list.filter(s => s.attributes.files && s.attributes.files.length)
        .sort((x, y) => score(y.attributes) - score(x.attributes))[0] || null;
}

function parseSrt(text) {
    const cues = [];
    const t = s => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : null; };
    for (const block of text.replace(/^﻿/, '').split(/\r?\n\s*\r?\n/)) {
        const m = /([\d:,.]+)\s*-->\s*([\d:,.]+)[^\n]*\n([\s\S]+)/.exec(block);
        if (!m) continue;
        const start = t(m[1]), end = t(m[2]);
        // drop SSA styling ({\an8}) and the tags WebVTT doesn't know; keep <i> <b> <u>
        const body = m[3].replace(/\{\\[^}]*\}/g, '').replace(/<(?!\/?[ibu]>)[^>]*>/gi, '').trim();
        if (start != null && end > start && body) cues.push({ start, end, text: body });
    }
    return cues;
}

async function find(f) {
    const c = creds();
    if (!c.key || !f.tmdb) return null;
    const ep = f.kind === 'tv' ? episodeOf(f.name) : null;
    if (f.kind === 'tv' && !ep) return null;
    const hash = await moviehash(f.url, f.size).catch(() => null);
    const cacheFile = path.join(cfg.subs, `pick-${f.hash}-${f.index}.json`);
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { /* not picked yet */ }
    // the API answers only with its parameters in alphabetical order (else a redirect)
    const q = Object.assign({ languages: 'en' }, hash ? { moviehash: hash } : {},
        f.kind === 'tv' ? { parent_tmdb_id: f.tmdb, season_number: ep.season, episode_number: ep.episode } : { tmdb_id: f.tmdb });
    const qs = Object.keys(q).sort().map(k => `${k}=${encodeURIComponent(q[k])}`).join('&');
    const found = await request(API, '/subtitles?' + qs, {});
    const pick = best(found.data || [], f.name);
    if (!pick) { console.log(`opensubtitles: nothing for ${qs}`); return null; }
    const a = pick.attributes, fileId = a.files[0].file_id;
    const srtFile = path.join(cfg.subs, `os-${fileId}.srt`);
    let srt;
    try { srt = fs.readFileSync(srtFile, 'utf8'); } catch (e) {
        const s = await session();
        const dl = await request(s.base, '/download', { body: { file_id: fileId }, token: s.token });
        srt = await (await fetch(dl.link)).text();
        fs.mkdirSync(cfg.subs, { recursive: true });
        fs.writeFileSync(srtFile, srt);
        console.log(`opensubtitles: downloaded ${fileId} "${a.release}" (${dl.remaining} downloads left today)`);
    }
    const out = { id: fileId, release: a.release, match: !!a.moviehash_match, cues: parseSrt(srt) };
    fs.mkdirSync(cfg.subs, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(out));
    return out;
}

// The downloaded lines moved onto the file's own captions, which are in step with the video. Both are
// transcripts of the same dialogue, so their words line them up: a run of 3 words found in exactly one caption
// anchors that moment (download time -> caption time, each at the run's place within its line). The shift is
// followed from anchor to anchor, which also covers a different speed and edits: S1E14's WEB rip (checked
// 2026-10-18 against 382 anchors) runs 25/23.976 fast, and on top of that its shift moves 12.0 -> 10.7 s, jumps
// to 12.4 s at 11 min and to 6.4 s at 14:40 (about 5 s of footage the Amazon file doesn't have). One shift and
// speed for the whole episode (the first version: overlap of "someone is talking" on a 0.2 s grid) was up to
// 4 s off there, and found none for S1E13, which kept its captions. Chance matches of a phrase said twice
// are dropped (anchors()). Past the last anchor: the last shift, at
// the anchors' overall speed. Captions come up about CAPTION_LAG late (on 37 s of S1E12 the speech lined up
// best with them 0.25 s earlier), so the result is that much earlier.
const CAPTION_LAG = 0.25, MIN_ANCHORS = 8;

const spoken = s => (String(s).toLowerCase().replace(/<[^>]+>/g, ' ').replace(/^[a-z .']{2,25}:/gm, ' ').match(/[a-z0-9']+/g)) || [];

function anchors(cues, ref) {
    const rw = ref.map(c => spoken(c.text)), index = new Map();
    rw.forEach((w, i) => {
        for (let k = 0; k + 3 <= w.length; k++) {
            const key = w.slice(k, k + 3).join(' '), e = index.get(key);
            if (e) e.dup = true; else index.set(key, { i, k, dup: false });
        }
    });
    const at = (c, k, n) => c.start + (c.end - c.start) * k / Math.max(1, n);
    const out = [];
    for (const c of cues) {
        const w = spoken(c.text);
        for (let k = 0; k + 3 <= w.length; k++) {
            const e = index.get(w.slice(k, k + 3).join(' '));
            if (e && !e.dup) { out.push({ a: at(c, k, w.length), b: at(ref[e.i], e.k, rw[e.i].length) }); break; }
        }
    }
    out.sort((x, y) => x.a - y.a);
    // both times move forward: the longest such chain. Drops chance matches of a common phrase ("you and me"),
    // above all from the part of the download past the captions read so far (S1E14 at 19 min: a line from
    // 27:49 matched one at 18:25).
    const tails = [], prev = new Array(out.length);
    out.forEach((p, i) => {
        let lo = 0, hi = tails.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (out[tails[mid]].b < p.b) lo = mid + 1; else hi = mid; }
        prev[i] = lo ? tails[lo - 1] : -1;
        tails[lo] = i;
    });
    const chain = [];
    for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) chain.unshift(out[i]);
    // runs: consecutive anchors whose shift changes by at most 1.5 s. An edit is a jump between two long runs;
    // a chance match is a run of one or two
    const runs = [];
    chain.forEach((p, i) => {
        if (i && Math.abs((p.b - p.a) - (chain[i - 1].b - chain[i - 1].a)) <= 1.5) runs[runs.length - 1].push(p);
        else runs.push([p]);
    });
    return [].concat(...runs.filter(r => r.length >= 3));
}

function align(cues, ref) {
    if (!cues.length || !ref.length) return null;
    const pts = anchors(cues, ref);
    if (pts.length < MIN_ANCHORS) return { anchors: pts.length, cues: null };
    // overall speed: least squares of caption time on download time
    const n = pts.length, ma = pts.reduce((x, p) => x + p.a, 0) / n, mb = pts.reduce((x, p) => x + p.b, 0) / n;
    const speed = pts.reduce((x, p) => x + (p.a - ma) * (p.b - mb), 0) / (pts.reduce((x, p) => x + (p.a - ma) ** 2, 0) || 1);
    const map = t => {
        let lo = 0, hi = n - 1;
        if (t <= pts[0].a) return pts[0].b + (t - pts[0].a) * speed;
        if (t >= pts[hi].a) return pts[hi].b + (t - pts[hi].a) * speed;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].a <= t) lo = mid; else hi = mid; }
        const p = pts[lo], q = pts[hi], f = q.a > p.a ? (t - p.a) / (q.a - p.a) : 0;
        return p.b + (q.b - p.b) * f;
    };
    const out = cues.map(c => ({ start: map(c.start) - CAPTION_LAG, end: map(c.end) - CAPTION_LAG, text: c.text }))
        .filter(c => c.end > c.start);
    return { anchors: n, speed, from: pts[0].b - pts[0].a, to: pts[n - 1].b - pts[n - 1].a, cues: out };
}

// TV captions: almost no lower-case letters
function shouting(cues) {
    const text = cues.map(c => c.text.replace(/<[^>]+>/g, '').replace(/^[A-Z][a-z]+( [A-Z][a-z]+)?:/gm, '')).join(' ');
    const upper = (text.match(/[A-Z]/g) || []).length, lower = (text.match(/[a-z]/g) || []).length;
    return upper + lower > 200 && lower / (upper + lower) < 0.1;
}

module.exports = { find, align, shouting, episodeOf, best, configured: () => !!creds().key };
