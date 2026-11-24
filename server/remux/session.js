// One playing torrent file: segments are produced by one ffmpeg at a time, from the segment the player
// asks for. A request for a segment that is already written is served from disk; one just ahead of ffmpeg
// waits for it; anything else (a seek) restarts ffmpeg there. ffmpeg is held back (by not reading its
// output) once it is AHEAD segments past the player, so a paused film doesn't download to the end, or
// past a subtitle segment the player waits for, whichever is further.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Splitter } = require('./mp4');
const { ffmpegArgs, seekTime, subFiles: runFiles, SUB_LANGS } = require('./media');
const sidecar = require('./sidecar');
const opensubs = require('./opensubs');
const translate = require('./translate');
const swarm = require('./swarm');
const cfg = require('./config');

const AHEAD = 30, BEHIND = 40, WAIT_MS = 90000, JUMP = 6, SLACK_S = 0.05;
// Handover (README "Restarts"): a process handing over to the next one (a deploy) keeps its ffmpeg runs going
// up to DRAIN_AHEAD segments past the last request (about 5 min), into the folder both processes share. Each
// running ffmpeg says so in `producer.json` every BEAT_MS; the other process serves those segments from disk
// instead of reading the torrent again with a run of its own, until the file is older than BEAT_STALE_MS.
const DRAIN_AHEAD = 75, BEAT_MS = 1000, BEAT_STALE_MS = 4000;
// A subtitle segment waits at most this long for the torrent's subtitle files (sidecar.js): Safari gives up on one
// after about 6 s and, after two, loads nothing more, video too. S3E6 (2026-11-07 18:08 UTC): its .srt took 49 s
// from a swarm of 1 peer, sub0-0.vtt went unanswered six times and the video stalled on segments it had on disk.
const SIDECAR_WAIT_MS = 4000;
// a subtitle segment of a translated track waits at most this long for its lines (Safari gives a subtitle request
// 10 s); the lines past the player are translated every PUMP_MS as ffmpeg writes the English
// (URGENT: lines per call while a player waits)
const TRANSLATE_WAIT_MS = 6000, PUMP_MS = 3000, URGENT = 12, SOON_S = 60;
// OpenSubtitles downloads in one language found not to be this video before giving up (nextPick)
const MISFITS = 2;
// torrents whose files carry TV captions (ALL CAPS): the next episode fetches better subtitles right away
const shouty = new Set();
// dir -> the Session using it: a player closed and opened again within close()'s 3 s gets a new Session on the
// same folder, which the old one must not delete (2026-11-04 21:00: S3E4 reopened 2 s after /gst/remove, its
// segments went missing and every request got 500 ENOENT)
const live = new Map();

class Session {
    constructor(media, dir) {
        this.m = media;
        this.dir = dir;
        live.set(dir, this);
        this.job = null;
        this.delay = null;
        this.lastReq = 0;
        this.subWant = 0;   // ffmpeg may run until this segment for a subtitle request (flow)
        this.used = Date.now();
        this.waiters = [];
        this.cues = media.subs.map(() => new Map());   // per subtitle: "start|text" -> cue
        // subtitle files of the torrent (media.js sidecars): read whole, once
        this.sidecars = Promise.all(media.subs.map((s, k) => s.sidecar != null && sidecar.cues(media.hash, s.sidecar, s.lang)
            .then(cues => { for (const c of cues) this.cues[k].set(c.start.toFixed(3) + '|' + c.text, c); })
            .catch(e => console.error(`${media.hash.slice(0, 8)}:${media.index} ${e.message}`))));
        // subtitles from OpenSubtitles (opensubs.js): `source` describes the torrent file, `better` the English
        // cues that replace subtitle 0 (or are the English track when the file has none), `fitMap` how they were
        // moved onto the video; `picks`/`found` the searches for languages the file has no subtitles in
        this.source = null;
        this.fetched = null;
        this.ext = null;
        this.better = null;
        this.fitMap = null;
        this.picks = {};
        this.found = {};
        this.osLines = {};
        this.osPick = {};   // the pick osLines were downloaded from
        this.osFit = {};   // per language: { lines: English lines at the last fit, cues }
        this.misfits = {};   // per language: downloads left out as not this video (nextPick)
        this.osFailed = {};   // per language: OpenSubtitles' lines given up on, translated instead (giveUp)
        this.mtWait = [];   // the starts of the translated segments players wait for (mtCues)
        this.pumping = {};
        // subtitle 0 is English when the file has English ones (media.js puts them first)
        this.english = !!media.subs.length && media.subs[0].lang === 'en';
        this.fitted = -40;   // caption lines at the last fit (the first at 20)
        this.checked = false;
        fs.mkdirSync(dir, { recursive: true });
    }

    file(n) { return path.join(this.dir, `seg${n}.m4s`); }
    has(n) { return fs.existsSync(this.file(n)); }

    // the init segment: a one-second ffmpeg run from the start (same settings as every job)
    init() {
        if (this.closed) return Promise.reject(new Error('closed'));
        const file = path.join(this.dir, 'init.mp4');
        if (fs.existsSync(file)) return Promise.resolve(file);
        if (this.initing) return this.initing;
        this.initing = new Promise((resolve, reject) => {
            const p = spawn(cfg.ffmpeg, ffmpegArgs(this.m, 0, { duration: 1 }), { stdio: ['ignore', 'pipe', 'pipe'] });
            let done = false, err = '';
            const sp = new Splitter({
                onInit: buf => { done = true; fs.writeFileSync(file, buf); p.kill(); resolve(file); },
                onFragment: () => {}
            });
            p.stdout.on('data', c => { if (!done) sp.push(c); });
            p.stderr.on('data', c => { err += c; });
            p.on('close', () => { this.initing = null; if (!done) reject(new Error('init: ' + err.trim().slice(-300))); });
        });
        return this.initing;
    }

    async segment(n) {
        if (this.closed) throw new Error('closed');
        this.used = Date.now();
        this.lastReq = n;
        this.prune();
        if (this.has(n)) { this.flow(); return this.file(n); }
        // the other process's ffmpeg is making it (a handover): wait for its file, start our own run only if
        // that run ends or stops short of n
        if (this.peerMakes(n)) {
            await this.until(() => this.has(n) || !this.peerMakes(n), WAIT_MS, BEAT_MS);
            if (this.has(n)) return this.file(n);
        }
        // a missing segment behind the one ffmpeg writes was pruned (or another tab is further on): only a new run
        // makes it again. Waiting for it held ffmpeg back for good (flow() with lastReq far behind), so nothing read
        // the torrent and swarm.js called a live swarm dead: VisionQuest on 2026-10-20 at 14:29, a new tab asking
        // seg0 of a run at about seg70 (README "Dead swarms")
        const j = this.job;
        if (!j || j.ended || n < j.cur || n > j.cur + JUMP) this.start(n);
        else this.flow();
        await this.until(() => this.has(n), WAIT_MS);
        return this.file(n);
    }

    // another process's live ffmpeg run covers segment n (its producer.json is fresh)
    peerMakes(n) {
        try {
            const f = path.join(this.dir, 'producer.json'), p = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (p.pid === process.pid || Date.now() - fs.statSync(f).mtimeMs >= BEAT_STALE_MS) return false;
            // the same for every run of this file: the subtitle cues its run wrote are placed by it (readCues)
            if (this.delay == null && p.delay != null) this.delay = p.delay;
            return n >= p.start && n <= p.upto;
        } catch (e) { return false; }
    }

    // ours: written while a run is alive, deleted when it ends
    beat() {
        const j = this.job, f = path.join(this.dir, 'producer.json');
        try {
            if (!j || j.ended) return fs.rmSync(f, { force: true });
            const tmp = f + '.' + process.pid;
            fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, start: j.start, cur: j.cur, upto: this.lastReq + this.ahead(), delay: this.delay }));
            fs.renameSync(tmp, f);
        } catch (e) { /* the next beat */ }
    }

    ahead() { return this.draining ? DRAIN_AHEAD : AHEAD; }

    // Handover: run ahead further, and say whether this session's work is done (no run, or one held back)
    drain() {
        this.draining = true;
        this.flow();
    }
    drained() {
        const j = this.job;
        return !j || j.ended || j.paused;
    }

    // is ffmpeg reading the torrent for segment n now? (a run held back by flow() asks it for nothing: swarm.js)
    reading(n) {
        const j = this.job;
        return !!j && !j.ended && !j.paused && n >= j.start;
    }

    start(n) {
        this.stop();
        // a request that got this session before /gst/remove closed it (a master still probing): no ffmpeg in a
        // folder about to be deleted (2026-11-05 dev server: the 4K remux's master ended 57 s in, 20 s after the
        // close, and its ffmpeg wrote into the deleted folder: ENOENT)
        if (this.closed) return;
        this.subWant = 0;
        const m = this.m, j = { start: n, cur: n, frags: [], ended: false, paused: false };
        const subFiles = runFiles(m, this.dir, n);
        j.subFiles = subFiles;
        j.proc = spawn(cfg.ffmpeg, ffmpegArgs(m, m.bounds[n], { subFiles }), { stdio: ['ignore', 'pipe', 'pipe'] });
        const splitter = new Splitter({ onInit: () => {}, onFragment: (t, buf) => this.fragment(j, t, buf) },
            { video: m.bounds[n], audio: seekTime(m, m.bounds[n]) - m.audioLead, delay: this.delay });
        j.splitter = splitter;
        j.proc.stdout.on('data', c => { try { splitter.push(c); } catch (e) { console.error(e); j.proc.kill(); } });
        let err = '';
        j.proc.stderr.on('data', c => { err = (err + c).slice(-2000); });
        j.proc.on('close', code => {
            j.ended = true;
            // ffmpeg reached the end of the file: the last segment is complete
            if (code === 0 && this.job === j) this.write(j, j.cur);
            if (code && !j.killed) console.error(`ffmpeg ${m.hash}:${m.index} from ${n} exited ${code}: ${err.trim()}`);
            this.notify();
        });
        this.job = j;
        clearInterval(this.beating);
        this.beating = setInterval(() => { this.beat(); if (j.ended) clearInterval(this.beating); }, BEAT_MS);
        this.beat();
        console.log(`${m.hash.slice(0, 8)}:${m.index} ffmpeg from segment ${n} (${m.bounds[n].toFixed(1)}s)`);
    }

    stop() {
        const j = this.job;
        if (j && !j.ended) { j.killed = true; j.proc.kill(); }
        this.job = null;
        clearInterval(this.beating);
        this.beat();
    }

    // a fragment starts at a video keyframe; it belongs to the segment whose start is at or before it.
    // t is on the film's timeline: the run's first fragment was shifted to exactly its first segment's start.
    fragment(j, t, buf) {
        if (this.job !== j) return;
        const n = Math.max(j.start, this.index(t || 0));
        if (process.env.REMUX_DEBUG) console.log(`frag t=${t && t.toFixed(3)} -> seg ${n} [${this.m.bounds[n].toFixed(3)}, ${this.m.bounds[n + 1].toFixed(3)})`);
        if (this.delay == null) this.delay = j.splitter.delay;   // the same for every run of this file
        if (n > j.cur) { this.write(j, j.cur); j.cur = n; }
        j.frags.push(buf);
        swarm.progress(this.m.hash.toLowerCase());
        this.flow();
    }

    index(t) {   // last segment starting at or before t (with a little slack)
        const b = this.m.bounds;
        let lo = 0, hi = b.length - 2;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b[mid] <= t + SLACK_S) lo = mid; else hi = mid - 1; }
        return lo;
    }

    // A segment already on disk is kept, not replaced: a run started behind it (a seek back, a TV asking an
    // earlier segment) cuts it again, and on Windows a rename onto a file a player is reading fails (EPERM).
    // It threw out of the ffmpeg pipe and killed the run: 41 errors (17 segments) on ruby, 2026-10-26 to 11-15, e.g.
    // S3E10 on 2026-11-15 08:44, three seeks back over seg13 while Safari re-read seg9-27, and 12:53 an AirPlay
    // TV reading seg226 (README "A segment cut twice"). The two cuts differ by about a kilobyte, and the one on
    // disk is the one players already have. The .tmp name carries the pid: both installs may cut it at once.
    write(j, n) {
        if (!j.frags.length) return;
        const f = this.file(n), buf = Buffer.concat(j.frags);
        j.frags = [];
        this.wrote = true;
        if (fs.existsSync(f)) return this.notify();
        const tmp = `${f}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, buf);
        this.place(tmp, f, 0);
    }

    // rename the finished .tmp into place; while something holds the folder's file (an antivirus scan of the
    // new .tmp), try again a few times over about 3 s instead of losing the segment
    place(tmp, f, tries) {
        try {
            fs.renameSync(tmp, f);
            this.notify();
        } catch (e) {
            if (fs.existsSync(f) || tries >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
                if (!fs.existsSync(f)) console.error(`${this.m.hash.slice(0, 8)}:${this.m.index} ${path.basename(f)}: ${e.code} after ${tries + 1} tries`);
                return fs.rm(tmp, { force: true }, () => {});
            }
            setTimeout(() => this.place(tmp, f, tries + 1), 100 << tries);
        }
    }

    // hold ffmpeg back when far ahead of the player, let it go again when the player catches up or waits for
    // subtitles further on. Safari reads subtitle segments minutes ahead of the video and stops loading
    // anything, video too, after two of them time out (its 10 s): held at the video's limit, a subtitle
    // segment past it never came (TYSON S01E01 on 2026-10-20: sub0-34 twice, then nothing for 90 s)
    flow() {
        const j = this.job;
        if (!j || j.ended) return;
        const ahead = j.cur - this.lastReq, max = this.ahead();
        if (!j.paused && ahead > max && j.cur > this.subWant) { j.paused = true; j.proc.stdout.pause(); }
        else if (j.paused && (ahead < max - 10 || j.cur <= this.subWant)) { j.paused = false; j.proc.stdout.resume(); }
    }

    prune() {
        for (const f of fs.readdirSync(this.dir)) {
            const m = /^seg(\d+)\.m4s$/.exec(f);
            // (a segment being sent right now can't be deleted on Windows: the next prune gets it)
            if (m && +m[1] < this.lastReq - BEHIND) try { fs.rmSync(path.join(this.dir, f), { force: true }); } catch (e) { /* next time */ }
        }
    }

    // poll: also look every `poll` ms (another process's files tell nothing to notify())
    until(test, ms, poll) {
        if (test()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const w = { test, resolve: () => { clearInterval(w.poll); resolve(); }, reject: e => { clearInterval(w.poll); reject(e); },
                timer: setTimeout(() => { clearInterval(w.poll); this.waiters = this.waiters.filter(x => x !== w); reject(new Error('timeout')); }, ms) };
            if (poll) w.poll = setInterval(() => this.notify(), poll);
            this.waiters.push(w);
        });
    }

    notify() {
        this.waiters = this.waiters.filter(w => {
            if (!w.test()) return true;
            clearTimeout(w.timer); w.resolve(); return false;
        });
    }

    // The subtitle tracks, English, Bulgarian, Russian: the file's own (`sub<k>`, k its place in m.subs) and,
    // in a language it has none in, the one from OpenSubtitles (`os<lang>`), else one translated from the English
    // (`mt<lang>`, translate.js; osOff). Ids, not places in this list, go into the playlists: OpenSubtitles may
    // answer after the master was made.
    tracks() {
        const own = this.m.subs.map((s, k) => ({ id: `sub${k}`, lang: s.lang, title: (s.tags && s.tags.title) || '' }));
        const ext = SUB_LANGS.filter(l => !own.some(t => t.lang === l) &&
            (l === 'en' ? this.better : this.found[l] && !(this.osOff(l) && this.canTranslate(l))))
            .map(l => ({ id: `os${l}`, lang: l, title: '' }));
        const mt = Object.keys(translate.LANGS).filter(l => l in this.found && this.osOff(l) && this.canTranslate(l))
            .map(l => ({ id: `mt${l}`, lang: l, title: 'AI translation' }));
        return own.concat(ext, mt).sort((x, y) => SUB_LANGS.indexOf(x.lang) - SUB_LANGS.indexOf(y.lang));
    }

    // a track id from a request: known now, or once OpenSubtitles has answered. Also one this session's master
    // listed before the other became the one (osOff changed): an `os` track then answers with the translation
    // (allCues), an `mt` track goes on translating.
    async hasTrack(id) {
        if (!this.tracks().some(t => t.id === id) && /^(os|mt)/.test(id)) await this.ready();
        const x = /^(os|mt)([a-z]{2})$/.exec(id);
        return this.tracks().some(t => t.id === id) || this.ownEnglish(id) ||
            !!(x && x[2] !== 'en' && (x[1] === 'os' ? x[2] in this.found && (this.found[x[2]] || this.canTranslate(x[2])) : this.canTranslate(x[2])));
    }

    // OpenSubtitles has nothing for this language that can be used now: its search failed or found none, the
    // day's download quota is spent (opensubs.js quotaOut) and the pick isn't on disk, or in this session a
    // download failed or no pick fitted the video (osFailed). Translated instead, where canTranslate.
    osOff(lang) {
        const p = this.found[lang];
        return !p || !!this.osFailed[lang] || (opensubs.quotaOut() && !opensubs.downloaded(p));
    }

    canTranslate(lang) {
        return lang in translate.LANGS && !this.m.subs.some(s => s.lang === lang) && !!(this.english || this.better) && translate.configured();
    }

    // OpenSubtitles' lines given up on for this session (the translation shows instead)
    giveUp(lang, why) {
        if (this.osFailed[lang]) return;
        this.osFailed[lang] = true;
        console.log(`${this.m.hash.slice(0, 8)}:${this.m.index} ${lang}: ${why}, translating the English instead`);
    }

    // `osen` asked for while the file has English of its own: a player that got the master before this service
    // knew the torrent's subtitle files (sidecar.js) carries on with it after a restart, without asking again
    ownEnglish(id) { return id === 'osen' && this.english && !this.tracks().some(t => t.id === id); }

    // OpenSubtitles' answers for the languages the file has no subtitles in, waited for up to `ms`
    ready(ms = 8000) {
        const all = Promise.all([this.english ? null : this.fetched].concat(Object.values(this.picks)));
        return Promise.race([all, new Promise(r => setTimeout(r, ms))]);
    }

    // WebVTT for one track, segment n: the cues that overlap it. The file's own wait until the video is past
    // this segment, so ffmpeg has written them (subtitle packets are muxed alongside the video).
    async subtitle(id, n) {
        this.used = Date.now();
        const from = this.m.bounds[n], to = this.m.bounds[n + 1];
        // only the running ffmpeg writes them: none, or one from a later segment (a seek), never will
        const passed = () => { const j = this.job; return !j || n < j.start || j.cur > n || j.ended; };
        // (a translation waits for the file's own English it is made from)
        const own = /^sub(\d+)$/.exec(id) || (/^mt/.test(id) && this.english && !this.better && [id, '0']);
        if (own && this.m.subs[+own[1]].sidecar == null && !passed()) {
            // just past ffmpeg: let it on; far past it is a seek, and the video request restarts ffmpeg there
            if (n <= this.job.cur + JUMP) { this.subWant = Math.max(this.subWant, n + 1); this.flow(); }
            await this.until(passed, WAIT_MS).catch(() => {});
        }
        // A line across the segment's end is cut there, the rest in the next segment. Repeated whole in both
        // (as Apple's HLS spec has it), Safari shows it once, but a Samsung TV AirPlayed to showed it twice, one
        // copy over the other (Desperate Housewives, Nov 2026: the TV, "MFi_AirPlay_Device" in the access log,
        // fetched sub0-<n>.vtt itself; 2026-11-18 S3E10 served 1078 cues for its lines, many in two segments).
        const cues = (await this.allCues(id, SIDECAR_WAIT_MS, from, to)).filter(c => c.end > from && c.start < to)
            .map(c => ({ start: Math.max(c.start, from), end: Math.min(c.end, to), text: c.text }))
            .filter(c => c.end - c.start > 0.05);
        return 'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n' + vtt(cues);
    }

    // WebVTT for one whole track, as far as it is known: for a player given subtitles as a file instead of in
    // the HLS master (desktop/compat.js). The file's own come in as ffmpeg reads ahead, and the fits improve, so
    // that player asks again now and then.
    async subtitleFile(id) {
        this.used = Date.now();
        return 'WEBVTT\n\n' + vtt(await this.allCues(id));
    }

    // (ms: wait no longer than that for the torrent's subtitle files, then answer with what is known; from-to: the
    // segment a translation waits for)
    async allCues(id, ms, from, to) {
        await (ms ? Promise.race([this.sidecars, new Promise(r => setTimeout(r, ms).unref())]) : this.sidecars);
        if (this.ownEnglish(id)) id = 'sub0';
        const own = /^sub(\d+)$/.exec(id);
        let all;
        if (own) {
            const k = +own[1];
            this.readCues(k);
            if (k === 0 && this.english) this.checkCaptions();
            all = k === 0 && this.english && this.better ? this.better : [...this.cues[k].values()];
        } else if (id === 'osen') {
            await this.fetched;
            all = this.better || [];
        } else if (/^mt/.test(id)) {
            all = await this.mtCues(id.slice(2), from, to);
        } else {
            const lang = id.slice(2);
            if (!(this.osOff(lang) && this.canTranslate(lang))) all = await this.osCues(lang);
            if (this.osOff(lang) && this.canTranslate(lang)) all = await this.mtCues(lang, from, to);
        }
        return all.slice().sort((a, b) => a.start - b.start);
    }

    // the torrent file (name, size, the title's TMDB id): what OpenSubtitles is searched by
    describe(file) {
        if (!this.source && file && file.tmdb) this.source = file;
        if (!this.source) return;
        if (!this.english || shouty.has(this.m.hash)) this.betterSubs();
        SUB_LANGS.filter(l => l !== 'en' && !this.m.subs.some(s => s.lang === l)).forEach(l => this.lookup(l));
    }

    // a language the file has no subtitles in: searched now (free), downloaded once someone picks it
    lookup(lang) {
        if (this.picks[lang] || !opensubs.configured()) return;
        const f = Object.assign({ hash: this.m.hash, index: this.m.index, url: this.m.url }, this.source);
        // (a failed search counts as none found: translated, where canTranslate)
        this.picks[lang] = opensubs.search(f, lang).then(p => { this.found[lang] = p; return p; })
            .catch(e => { console.error(`${this.m.hash.slice(0, 8)}:${this.m.index} ${e.message}`); this.found[lang] = null; return null; });
    }

    // Its lines on the video's timing. Made from the same release as the English download, they follow the
    // English (fit's map); otherwise they are lined up by timing with the English in step with the video
    // (opensubs.js alignTiming): the download lined up, else the file's own, else the download as it is. From
    // 20 English lines, again every 40 more, like fit(). No fit yet: as they are; none with plenty of English to
    // go by (another film or cut under the same title): no lines, they would be wrong all along.
    async osCues(lang) {
        const pick = await this.picks[lang], tag = `${this.m.hash.slice(0, 8)}:${this.m.index}`;
        if (!pick) return [];
        if (!this.osLines[lang]) {
            // a failed download is tried again in 10 min, not on the player's next subtitle request (once a second:
            // f3647aee:15 bg, 2026-10-20)
            // (find: past garbled downloads, so the pick may change)
            const f = Object.assign({ hash: this.m.hash, index: this.m.index, url: this.m.url }, this.source);
            this.osLines[lang] = opensubs.find(f, lang, pick).then(r => {
                if (r) console.log(`${tag} ${lang} subtitles from OpenSubtitles: "${r.release}"${r.match ? ' (made for this file)' : ''}`);
                this.osPick[lang] = r;
                return r ? r.cues : [];
            }).catch(e => {
                console.error(e.message);
                if (this.canTranslate(lang)) this.giveUp(lang, `download failed (${e.status === 406 ? 'no quota' : e.message.slice(0, 60)})`);
                else setTimeout(() => { delete this.osLines[lang]; }, 10 * 60e3).unref();
                return [];
            });
        }
        const cues = await this.osLines[lang], map = this.fitMap, got = this.osPick[lang];
        if (!got) return [];
        const same = map && this.ext && String(this.ext.release).toLowerCase() === String(got.release).toLowerCase();
        if (same) return cues.map(c => ({ start: map(c.start), end: map(c.end), text: c.text })).filter(c => c.end > c.start);
        const ref = this.englishRef();
        const fit = this.osFit[lang] || (this.osFit[lang] = { lines: -40, cues });
        if (ref.length >= 20 && ref.length >= fit.lines + 40) {
            fit.lines = ref.length;
            // the file's own TV captions come up late (fit())
            const a = opensubs.alignTiming(cues, ref, !this.better && shouty.has(this.m.hash) ? opensubs.CAPTION_LAG : 0);
            console.log(`${tag} ${lang} "${got.release}" against ${ref.length} English lines by timing: ${a.anchors} anchors` +
                (a.cues ? `, speed ${a.speed.toFixed(4)}, shift ${a.from.toFixed(1)} -> ${a.to.toFixed(1)} s` +
                    (a.share ? ` (one for the whole film: ${(a.share * 100).toFixed(0)} % of lines on an English one)` : '') : a.misfit ? ', not this video: no lines' : ', no fit yet, as it is'));
            if (a.cues) fit.cues = a.cues;
            else if (a.misfit) { fit.cues = []; this.nextPick(lang, got); }
        }
        return fit.cues;
    }

    // English in step with the video: the download lined up, else the file's own as far as ffmpeg has written them
    englishRef() {
        if (this.english) this.readCues(0);
        return this.better || (this.english ? [...this.cues[0].values()].sort((a, b) => a.start - b.start) : []);
    }

    // A translated track (translate.js): the English lines with a translation. A segment (from-to) waits up to
    // TRANSLATE_WAIT_MS for its lines, translated first; the whole track (no from) answers with what is done.
    async mtCues(lang, from, to) {
        const b = this.translator(lang);
        if (from != null) {
            const missing = () => this.englishRef().some(c => c.end > from && c.start < to && b.pending(c.text));
            this.mtWait.push(from);
            this.pump(lang);
            await this.until(() => !missing(), TRANSLATE_WAIT_MS, 250).catch(() => {});
            this.mtWait.splice(this.mtWait.indexOf(from), 1);
        } else this.pump(lang);
        return this.englishRef().filter(c => b.text(c.text) !== undefined).map(c => ({ start: c.start, end: c.end, text: b.text(c.text) }));
    }

    translator(lang) {
        return translate.book(Object.assign({ hash: this.m.hash, index: this.m.index }, this.source), lang);
    }

    // From the first time a player asks for a translated track: the English lines from just behind the player
    // on, translated as ffmpeg writes them, so they are ready before the player asks; a segment a player waits
    // for first
    pump(lang) {
        if (this.pumping[lang]) return;
        this.pumping[lang] = true;
        const b = this.translator(lang);
        const step = () => {
            if (this.closed) return;
            // (the player's latest video segment: lines up to SOON_S past it go now, later ones 40 at a time)
            const pos = this.m.bounds[this.lastReq] || 0;
            const p = this.mtWait.length ? b.next(this.englishRef(), Math.min(...this.mtWait), URGENT)
                : b.next(this.englishRef(), Math.max(0, pos - 30), undefined, pos + SOON_S);
            if (p) p.then(step); else setTimeout(step, PUMP_MS).unref();
        };
        step();
    }

    // the whole film translated (download.js: its English is all known then)
    async translateAll(lang) {
        const b = this.translator(lang);
        for (let p; (p = b.next(this.englishRef(), 0));) await p;
    }

    // a download that isn't this video: the next one OpenSubtitles has, up to MISFITS per language and session
    // (each costs a download from the daily quota)
    nextPick(lang, got) {
        if ((this.misfits[lang] = (this.misfits[lang] || 0) + 1) > MISFITS) {
            if (this.canTranslate(lang)) this.giveUp(lang, `${MISFITS} downloads didn't fit this video`);
            return;
        }
        const f = Object.assign({ hash: this.m.hash, index: this.m.index, url: this.m.url }, this.source);
        opensubs.misfit(f, lang, got.id);
        console.log(`${this.m.hash.slice(0, 8)}:${this.m.index} ${lang} "${got.release}" left out for this file: picking another`);
        delete this.picks[lang]; delete this.osLines[lang]; delete this.osPick[lang]; delete this.osFit[lang];
        this.lookup(lang);
    }

    // Once the file's own subtitle 0 has enough lines: TV captions (ALL CAPS) get replaced
    checkCaptions() {
        const ref = [...this.cues[0].values()];
        if (!this.checked && ref.length >= 15) {
            this.checked = true;
            if (opensubs.shouting(ref)) {
                console.log(`${this.m.hash.slice(0, 8)}:${this.m.index} subtitles are TV captions (ALL CAPS): asking OpenSubtitles`);
                shouty.add(this.m.hash);
                this.betterSubs();
            }
        }
        this.fit();
    }

    betterSubs() {
        if (this.fetched || !opensubs.configured()) return this.fetched;
        if (!this.source) {
            if (!this.unnamed) console.log(`${this.m.hash.slice(0, 8)}:${this.m.index} no title id with this stream: can't ask OpenSubtitles`);
            this.unnamed = true;
            return null;
        }
        const f = Object.assign({ hash: this.m.hash, index: this.m.index, url: this.m.url }, this.source);
        this.fetched = opensubs.find(f, 'en').then(r => { this.ext = r; this.fit(); return r; })
            .catch(e => { console.error(`${this.m.hash.slice(0, 8)}:${this.m.index} ${e.message}`); return null; });
        return this.fetched;
    }

    // The download onto the file's own captions' timing by their words (opensubs.js align): from 20 caption
    // lines, again every 40 more, so later edits in the release are followed as the captions come in.
    // No captions in the file: a download for this very file (hash match) as it is, else the best guess.
    fit() {
        const ext = this.ext, tag = `${this.m.hash.slice(0, 8)}:${this.m.index}`;
        if (!ext || !ext.cues.length) return;
        if (!this.english) {
            if (!this.better) console.log(`${tag} subtitles from OpenSubtitles: "${ext.release}"${ext.match ? ' (made for this file)' : ''}`);
            this.better = ext.cues;
            return;
        }
        const ref = [...this.cues[0].values()];
        if (ref.length < 20 || ref.length < this.fitted + 40) return;
        this.fitted = ref.length;
        const a = opensubs.align(ext.cues, ref);
        if (!a) return;
        console.log(`${tag} OpenSubtitles "${ext.release}" against ${ref.length} caption lines: ${a.anchors} anchors` +
            (a.cues ? `, speed ${a.speed.toFixed(4)}, shift ${a.from.toFixed(1)} -> ${a.to.toFixed(1)} s` : ', too few, keeping the captions'));
        if (a.cues) { this.better = a.cues; this.fitMap = a.map; }
    }

    readCues(k) {
        for (const f of fs.readdirSync(this.dir)) {
            const run = new RegExp(`^sub${k}-(\\d+)\\.vtt$`).exec(f);
            if (!run) continue;
            // each run's subtitle times start at its -ss; shown in step with the video (mp4.js)
            const shift = seekTime(this.m, this.m.bounds[+run[1]]) + (this.delay || 0);
            const text = fs.readFileSync(path.join(this.dir, f), 'utf8');
            for (const block of text.split(/\r?\n\r?\n/)) {
                // a line the run started inside is before its 0, and ffmpeg signs each field ("00:-1.-700" is
                // -1.7 s: media.js ffmpegArgs)
                const m = /^((?:-?\d+:){1,2}-?\d+\.-?\d+)\s+-->\s+((?:-?\d+:){1,2}-?\d+\.-?\d+)[^\n]*\n([\s\S]+)/m.exec(block);
                if (!m) continue;
                const cue = { start: shift + vttSec(m[1]), end: shift + vttSec(m[2]), text: m[3].trim() };
                if (cue.end <= cue.start) continue;
                this.cues[k].set(cue.start.toFixed(3) + '|' + cue.text, cue);
            }
        }
    }

    // On Windows a killed ffmpeg holds its files open for a moment: delete a little later, and retry once
    close() {
        this.closed = true;
        this.stop();
        // (/gst/remove) requests waiting for its segments get an answer now, not after WAIT_MS
        for (const w of this.waiters) { clearTimeout(w.timer); w.reject(new Error('closed')); }
        this.waiters = [];
        if (live.get(this.dir) === this) live.delete(this.dir);
        const rm = retry => setTimeout(() => {
            if (live.has(this.dir)) return;   // a new session took the folder over
            try { fs.rmSync(this.dir, { recursive: true, force: true }); }
            catch (e) { if (retry) rm(false); else console.error(`could not delete ${this.dir}: ${e.message}`); }
        }, 3000);
        rm(true);
    }
}

// "[hh:]mm:ss.mmm" in seconds, each field with its own sign as ffmpeg writes times before 0 ("00:-1.-700")
function vttSec(t) {
    const f = t.split(/[:.]/).map(Number), ms = f.pop(), s = f.pop();
    return f.reduce((x, v) => x * 60 + v, 0) * 60 + s + ms / 1000;
}

function vtt(cues) {
    return cues.map(c => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n');
}

function vttTime(t) {
    const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

module.exports = { Session };
