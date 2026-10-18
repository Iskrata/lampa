// Better English subtitles from OpenSubtitles (server/remux/README.md, "Subtitles from OpenSubtitles"), for a
// file whose own are TV captions (ALL CAPS, cut into 1-2 s pieces) or that has none. Downloads cost quota
// (OpenSubtitles counts them per account per day), so each is made once and kept in cfg.subs for everyone.
//   find({ hash, index, url, size, tmdb, kind, name }) -> { id, release, match, cues } | null
//   align(cues, ref) -> { cues, offset, scale, score } | null: moved onto the file's own captions' timing
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

const words = s => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !/^(s\d+e\d+|\d+)$/.test(w)));

// the subtitle most likely to fit this file: the same file (hash) first, then a release named like it
// (WEB vs DVD timings differ), not for the hearing impaired ([door slams]), then the most downloaded
function best(list, name) {
    const mine = words(path.basename(name || ''));
    const score = a => (a.moviehash_match ? 1000 : 0) +
        [...words(a.release)].filter(w => mine.has(w)).length * 10 +
        (/web/i.test(a.release || '') && /web/i.test(name || '') ? 20 : 0) +
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

// The shift (and speed: PAL DVDs run 25/23.976 fast) that lays the downloaded lines best over the file's own
// captions, which are in step with the video. On a 0.2 s grid over the captions' span: overlap / union of
// "someone is talking" in both. Shifts up to ±90 s, from 60 caption lines (about 4 minutes): a shorter span
// has too few pauses to tell shifts apart (S1E12's first 20 lines, the dense "previously on" recap, matched a
// shift of 59 s at 0.96, and within ±5 s always the edge).
const STEP = 0.2, RANGE = 90, SCALES = [1, 25 / 23.976, 23.976 / 25];

function align(cues, ref) {
    if (!cues.length || ref.length < 60) return null;
    const r0 = Math.min(...ref.map(c => c.start)), r1 = Math.max(...ref.map(c => c.end));
    const n = Math.ceil((r1 - r0) / STEP), K = Math.round(RANGE / STEP);
    const grid = (list, scale, from, len) => {
        const g = new Uint8Array(len);
        for (const c of list) {
            const a = Math.max(0, Math.floor((c.start * scale - from) / STEP)), b = Math.min(len, Math.ceil((c.end * scale - from) / STEP));
            for (let i = a; i < b; i++) g[i] = 1;
        }
        return g;
    };
    const refG = grid(ref, 1, r0, n);
    let top = null;
    for (const scale of SCALES) {
        const candG = grid(cues, scale, r0 - RANGE, n + 2 * K);   // candG[i + K - k] is the candidate shifted by k steps
        for (let k = -K; k <= K; k++) {
            let both = 0, any = 0;
            for (let i = 0; i < n; i++) { const x = refG[i], y = candG[i + K - k]; both += x & y; any += x | y; }
            const score = any ? both / any : 0;
            if (!top || score > top.score) top = { scale, offset: k * STEP, score };
        }
    }
    if (!top || top.score < 0.45) return top && Object.assign(top, { cues: null });
    top.cues = cues.map(c => ({ start: c.start * top.scale + top.offset, end: c.end * top.scale + top.offset, text: c.text }));
    return top;
}

// TV captions: almost no lower-case letters
function shouting(cues) {
    const text = cues.map(c => c.text.replace(/<[^>]+>/g, '').replace(/^[A-Z][a-z]+( [A-Z][a-z]+)?:/gm, '')).join(' ');
    const upper = (text.match(/[A-Z]/g) || []).length, lower = (text.match(/[a-z]/g) || []).length;
    return upper + lower > 200 && lower / (upper + lower) < 0.1;
}

module.exports = { find, align, shouting, episodeOf, configured: () => !!creds().key };
