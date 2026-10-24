// Subtitles from OpenSubtitles (server/remux/README.md, "Subtitles from OpenSubtitles"): better English ones
// for a file whose own are TV captions (ALL CAPS, cut into 1-2 s pieces) or that has none, and Bulgarian and
// Russian ones for a file without its own. Downloads cost quota (OpenSubtitles counts them per account per
// day), so each is made once, only when wanted, and kept in cfg.subs for everyone.
//   search({ hash, index, url, size, tmdb, kind, name }, lang) -> { id, release, match } | null
//   download(pick) -> cues; find(f, lang): both
//   align(cues, ref) -> { cues, anchors, speed, from, to } | null: moved onto the file's own captions' timing
//   alignTiming(cues, ref, lag) -> the same, or { cues: null, misfit }: another language, by the lines' timing
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
    login = { token: j.token, base: j.base_url ? `https://${j.base_url}/api/v1` : API, at: Date.now(), until: Date.now() + 20 * 3600e3 };
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

// Does a subtitle say it's for another episode than ep? Its own data (feature_details), else its release name,
// also as "124 - <title>" (S1E24, the way some packs number files). A file-hash match doesn't overrule it: for
// Friends S01E01 (1a6558e5, the S01-S10 Silence pack) the hash match was "124 - The One Where Rachel Finds Out",
// S1E24's lines on S1E1, 2026-10-20.
function otherEpisode(a, ep) {
    if (!ep) return false;
    const d = a.feature_details || {};
    if (d.episode_number != null && d.season_number != null && (+d.episode_number !== ep.episode || +d.season_number !== ep.season)) return true;
    const rel = String(a.release || ''), n = !/^\s*(19|20)\d\d\b/.test(rel) && /^\s*([1-9]\d?)(\d{2}) - /.exec(rel);
    const e = episodeOf(rel) || (n ? { season: +n[1], episode: +n[2] } : null);
    return !!e && (e.episode !== ep.episode || e.season !== ep.season);
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

// the title part of a release name, before the year or episode: a release of something else filed under the
// same TMDB id ("The.Odyssey.The.Making.of.an.Epic.2026...-Kitsune" under The Odyssey, 2026-10-19) has words
// the file's title doesn't
function titleWords(s) {
    const w = String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const end = w.findIndex((x, i) => i && (/^(19|20)\d\d$/.test(x) || /^s\d+e\d+$/.test(x) || /^\d+x\d+$/.test(x)));
    return end > 0 ? w.slice(0, end) : null;
}
// recorded in a cinema: the timing of a cinema copy, not of a WEB or disc release
const CAM = /\b(cam|hdcam|camrip|ts|hdts|telesync|tc|telecine)\b/i;

// the subtitle most likely to fit this file: the same file (hash) first, then the same title, the same source
// (WEB vs DVD timings and cuts differ) and tags, not from a cinema copy, not for the hearing impaired ([door
// slams]), then the most downloaded
function best(list, name) {
    const file = path.basename(name || ''), mine = tags(file), src = source(file);
    const title = new Set(titleWords(file.replace(/[._]/g, ' ')) || []);
    const other = r => { const w = titleWords(r); return !!(title.size && w && w.some(x => !title.has(x))); };
    const score = a => (a.moviehash_match ? 1000 : 0) +
        (other(a.release) ? -100 : 0) + (CAM.test(String(a.release).replace(/[._-]/g, ' ')) && !CAM.test(file.replace(/[._-]/g, ' ')) ? -30 : 0) +
        (src && source(a.release) === src ? 40 : 0) +
        [...tags(a.release)].filter(w => mine.has(w)).length * 10 +
        (a.hearing_impaired ? -15 : 0) + (a.from_trusted ? 5 : 0) + Math.log10(1 + (a.download_count || 0));
    return list.filter(s => s.attributes.files && s.attributes.files.length)
        .sort((x, y) => score(y.attributes) - score(x.attributes))[0] || null;
}

function parseSrt(text) {
    const cues = [];
    // (WebVTT may leave out the hours)
    const t = s => { const m = /(?:(\d+):)?(\d+):(\d+)[,.](\d+)/.exec(s); return m ? +(m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : null; };
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

// OpenSubtitles' hash of one torrent file, worked out once (two reads of 64 KiB from the torrent)
const hashes = new Map();
function fileHash(f) {
    const key = `${f.hash}:${f.index}`;
    if (!hashes.has(key)) hashes.set(key, moviehash(f.url, f.size).catch(() => null));
    return hashes.get(key);
}

// The best subtitle in one language for this torrent file: { id, release, match } | null. A search costs no
// quota; a pick is kept per torrent file and language.
async function search(f, lang) {
    const c = creds();
    if (!c.key || !f.tmdb) return null;
    const ep = f.kind === 'tv' ? episodeOf(f.name) : null;
    if (f.kind === 'tv' && !ep) return null;
    const cacheFile = path.join(cfg.subs, `pick-${f.hash}-${f.index}-${lang}.json`);
    try {
        const kept = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (!otherEpisode(kept, ep)) return kept;
        console.log(`opensubtitles: ${f.hash.slice(0, 8)}:${f.index} ${lang} kept pick "${kept.release}" is another episode: picking again`);
    } catch (e) { /* not picked yet */ }
    const hash = await fileHash(f);
    // the API answers only with its parameters in alphabetical order (else a redirect)
    const q = Object.assign({ languages: lang }, hash ? { moviehash: hash } : {},
        f.kind === 'tv' ? { parent_tmdb_id: f.tmdb, season_number: ep.season, episode_number: ep.episode } : { tmdb_id: f.tmdb });
    const qs = Object.keys(q).sort().map(k => `${k}=${encodeURIComponent(q[k])}`).join('&');
    const found = await request(API, '/subtitles?' + qs, {});
    const pick = best((found.data || []).filter(x => !otherEpisode(x.attributes || {}, ep)), f.name);
    if (!pick) console.log(`opensubtitles: nothing for ${qs}`);
    const a = pick && pick.attributes;
    const out = pick ? { id: a.files[0].file_id, release: a.release, match: !!a.moviehash_match } : null;
    // nothing found is asked again next time: subtitles get uploaded after a release
    if (out) { fs.mkdirSync(cfg.subs, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(out)); }
    return out;
}

// a picked subtitle's lines: downloaded once (counts against the daily quota), then from cfg.subs
async function download(pick) {
    const srtFile = path.join(cfg.subs, `os-${pick.id}.srt`);
    let srt;
    try { srt = fs.readFileSync(srtFile, 'utf8'); } catch (e) {
        let s = await session(), dl;
        try { dl = await request(s.base, '/download', { body: { file_id: pick.id }, token: s.token }); } catch (e) {
            // a token OpenSubtitles stopped taking well before its 24 h: every download answered "401 invalid
            // token" on 2026-10-20 (19:43 UTC, signed in 17:55) until a restart. Not another sign-in (three in a
            // row all stayed valid, and the token's exp said 24 h; measured that evening), cause unknown: the log
            // says the token's age, and whether a new one helps (the next line is a download, or this 401 again)
            if (e.status !== 401 || !s.token) throw e;
            console.log(`opensubtitles: download answered 401 "${e.message.replace(/^.*?401 /, '')}" with a token ` +
                `${((Date.now() - s.at) / 60e3).toFixed(0)} min old: signing in again`);
            login = null;
            s = await session();
            dl = await request(s.base, '/download', { body: { file_id: pick.id }, token: s.token });
        }
        srt = await (await fetch(dl.link)).text();
        fs.mkdirSync(cfg.subs, { recursive: true });
        fs.writeFileSync(srtFile, srt);
        console.log(`opensubtitles: downloaded ${pick.id} "${pick.release}" (${dl.remaining} downloads left today)`);
    }
    return parseSrt(srt);
}

async function find(f, lang) {
    const pick = await search(f, lang);
    return pick && Object.assign({ cues: await download(pick) }, pick);
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

function wordPairs(cues, ref) {
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
    return out;
}

// Pairs from timing alone, for subtitles in another language than the reference: a line's start and those of
// its neighbours (NEAR on each side) form a pattern of pauses and speech that the reference has once, at the
// right shift. A pair is a line whose pattern lands on reference starts (within TOL) for at least HITS of its
// neighbours at one shift and clearly fewer at any other (a different film or a cut gets no such pairs).
// `speed`: download time x speed = reference time (a 25 fps release of a 23.976 film: 25/23.976).
const T = { NEAR: 8, TOL: 0.3, HITS: 9, MARGIN: 3, RANGE: 900, GRID: 0.05, WINDOW: 20, PEAKS: 6 };
const lowerBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
function timingPairs(cues, ref, speed) {
    if (!ref.length) return [];
    const starts = ref.map(c => c.start).sort((x, y) => x - y), last = starts[starts.length - 1];
    // which grid cells are within TOL of a reference start: a lookup per neighbour instead of a search
    const cell = t => Math.round(t / T.GRID), hit = new Uint8Array(cell(last + T.TOL) + 2);
    for (const t of starts) for (let c = Math.max(0, cell(t - T.TOL)); c <= cell(t + T.TOL); c++) hit[c] = 1;
    const near = t => t >= 0 && t <= last + T.TOL && hit[cell(t)] === 1;
    // the shifts worth trying near a line: the PEAKS most common differences between the starts of the lines
    // around it (WINDOW) and the reference's (a second apart or more). Trying every reference line in RANGE
    // took 4 s for a film.
    const peaks = [], bins = Math.round(T.RANGE / 0.2), votes = new Int32Array(2 * bins + 1);
    for (let w = 0; w < cues.length; w += T.WINDOW) {
        votes.fill(0);
        let j0 = 0;
        for (let k = Math.max(0, w - T.WINDOW); k < Math.min(cues.length, w + 2 * T.WINDOW); k++) {
            const at = cues[k].start * speed;
            while (j0 < starts.length && starts[j0] < at - T.RANGE) j0++;
            for (let j = j0; j < starts.length && starts[j] <= at + T.RANGE; j++) votes[bins + Math.round((starts[j] - at) / 0.2)]++;
        }
        const top = [];
        for (let p = 0; p < T.PEAKS; p++) {
            let m = -1;
            for (let d = 0; d < votes.length; d++) if (votes[d] && (m < 0 || votes[d] > votes[m])) m = d;
            if (m < 0) break;
            top.push(m);
            votes.fill(0, Math.max(0, m - 4), m + 5);
        }
        peaks.push(top.map(d => (d - bins) * 0.2));
    }
    const out = [];
    cues.forEach((c, i) => {
        const nb = [];
        for (let k = Math.max(0, i - T.NEAR); k <= Math.min(cues.length - 1, i + T.NEAR); k++) if (k !== i) nb.push((cues[k].start - c.start) * speed);
        if (nb.length < T.HITS) return;
        const at = c.start * speed, cand = [];
        for (const d of peaks[Math.floor(i / T.WINDOW)]) {
            let j = lowerBound(starts, at + d - 0.6);
            for (; j < starts.length && starts[j] <= at + d + 0.6; j++) {
                let n = 0;
                for (const o of nb) if (near(starts[j] + o)) n++;
                cand.push({ b: starts[j], n });
            }
        }
        const best = cand.reduce((x, y) => (!x || y.n > x.n ? y : x), null);
        // the runner-up at another shift (reference lines less than a second apart are the same moment)
        const second = cand.reduce((m, y) => (best && Math.abs(y.b - best.b) >= 1 ? Math.max(m, y.n) : m), 0);
        if (best && best.n >= T.HITS && best.n >= second + T.MARGIN) out.push({ a: c.start, b: best.b, n: best.n });
    });
    return out;
}

// Both times move forward: the longest such chain. Drops chance matches of a common phrase ("you and me"),
// above all from the part of the download past the captions read so far (S1E14 at 19 min: a line from
// 27:49 matched one at 18:25).
function chain(pairs) {
    const out = pairs.slice().sort((x, y) => x.a - y.a);
    const tails = [], prev = new Array(out.length);
    out.forEach((p, i) => {
        let lo = 0, hi = tails.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (out[tails[mid]].b < p.b) lo = mid + 1; else hi = mid; }
        prev[i] = lo ? tails[lo - 1] : -1;
        tails[lo] = i;
    });
    const ch = [];
    for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) ch.unshift(out[i]);
    // runs: consecutive anchors whose shift changes by at most 1.5 s. An edit is a jump between two long runs;
    // a chance match is a run of one or two
    const runs = [];
    ch.forEach((p, i) => {
        if (i && Math.abs((p.b - p.a) - (ch[i - 1].b - ch[i - 1].a)) <= 1.5) runs[runs.length - 1].push(p);
        else runs.push([p]);
    });
    return [].concat(...runs.filter(r => r.length >= 3));
}

// the cues moved along the anchors (download time a -> reference time b), `lag` earlier
// (past the ends: at `rate`, else the anchors' overall speed)
function follow(cues, pts, lag, rate) {
    if (pts.length < MIN_ANCHORS) return { anchors: pts.length, cues: null };
    // overall speed: least squares of caption time on download time
    const n = pts.length, ma = pts.reduce((x, p) => x + p.a, 0) / n, mb = pts.reduce((x, p) => x + p.b, 0) / n;
    const speed = rate || pts.reduce((x, p) => x + (p.a - ma) * (p.b - mb), 0) / (pts.reduce((x, p) => x + (p.a - ma) ** 2, 0) || 1);
    const map = t => {
        let lo = 0, hi = n - 1;
        if (t <= pts[0].a) return pts[0].b + (t - pts[0].a) * speed;
        if (t >= pts[hi].a) return pts[hi].b + (t - pts[hi].a) * speed;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].a <= t) lo = mid; else hi = mid; }
        const p = pts[lo], q = pts[hi], f = q.a > p.a ? (t - p.a) / (q.a - p.a) : 0;
        // between two runs (an edit, chain()): the nearer one's shift. The cut is at one moment, and sliding
        // from one shift to the other over the gap put the lines in it up to 38 s off (BG TELESYNC, 2026-10-19)
        if (Math.abs((q.b - q.a) - (p.b - p.a)) > 1.5) return t + (f < 0.5 ? p.b - p.a : q.b - q.a);
        return p.b + (q.b - p.b) * f;
    };
    const out = cues.map(c => ({ start: map(c.start) - lag, end: map(c.end) - lag, text: c.text }))
        .filter(c => c.end > c.start);
    // map: download time -> video time, for other languages of the same release (session.js osCues)
    return { anchors: n, speed, from: pts[0].b - pts[0].a, to: pts[n - 1].b - pts[n - 1].a, cues: out,
        map: t => map(t) - lag };
}

function align(cues, ref) {
    if (!cues.length || !ref.length) return null;
    return follow(cues, chain(wordPairs(cues, ref)), CAPTION_LAG);
}

// Another language onto the reference (the file's own English, or English already lined up) by timing, at the
// frame-rate change a release is most commonly converted by that gives the most anchors. A fit pairs at least
// MIN_SHARE of the download's lines that land among the reference lines read so far: lining up Nolan's "The Odyssey"
// with The Asylum's film of the same name (2026-10-19) paired 1-2 % of them by chance (16-22 anchors), real fits
// 58-80 %. No fit: { cues: null, misfit }, misfit when there was enough English to tell (MIN_REF lines, about
// 10 min; the real fits worked from 60).
const SPEEDS = [1, 25 / 23.976, 23.976 / 25, 1.001, 1 / 1.001], MIN_SHARE = 0.2, MIN_REF = 200;
function alignTiming(cues, ref, lag = 0) {
    if (!cues.length || !ref.length) return null;
    let pts = [], rate = 1;
    for (const s of SPEEDS) { const p = chain(timingPairs(cues, ref, s)); if (p.length > pts.length) { pts = p; rate = s; } }
    // the lines that land among reference lines (within 10 s of one: after a seek the file's own cover pieces)
    const r = follow(cues, pts, lag, rate), starts = ref.map(c => c.start).sort((x, y) => x - y);
    const among = t => { const j = lowerBound(starts, t - 10); return j < starts.length && starts[j] <= t + 10; };
    const span = r.cues ? r.cues.filter(c => among(c.start)).length : 0;
    if (r.cues && pts.length >= MIN_SHARE * span) return r;
    return { anchors: pts.length, cues: null, misfit: ref.length >= MIN_REF };
}

// TV captions: almost no lower-case letters
function shouting(cues) {
    const text = cues.map(c => c.text.replace(/<[^>]+>/g, '').replace(/^[A-Z][a-z]+( [A-Z][a-z]+)?:/gm, '')).join(' ');
    const upper = (text.match(/[A-Z]/g) || []).length, lower = (text.match(/[a-z]/g) || []).length;
    return upper + lower > 200 && lower / (upper + lower) < 0.1;
}

module.exports = { find, search, download, align, alignTiming, timingPairs, shouting, CAPTION_LAG, episodeOf, best, parseSrt, configured: () => !!creds().key };
