// One playing torrent file: segments are produced by one ffmpeg at a time, from the segment the player
// asks for. A request for a segment that is already written is served from disk; one just ahead of ffmpeg
// waits for it; anything else (a seek) restarts ffmpeg there. ffmpeg is held back (by not reading its
// output) once it is AHEAD segments past the player, so a paused film doesn't download to the end.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Splitter } = require('./mp4');
const { ffmpegArgs, seekTime } = require('./media');
const cfg = require('./config');

const AHEAD = 30, BEHIND = 40, WAIT_MS = 90000, JUMP = 6, SLACK_S = 0.05;

class Session {
    constructor(media, dir) {
        this.m = media;
        this.dir = dir;
        this.job = null;
        this.delay = null;
        this.lastReq = 0;
        this.used = Date.now();
        this.waiters = [];
        this.cues = media.subs.map(() => new Map());   // per subtitle: "start|text" -> cue
        fs.mkdirSync(dir, { recursive: true });
    }

    file(n) { return path.join(this.dir, `seg${n}.m4s`); }
    has(n) { return fs.existsSync(this.file(n)); }

    // the init segment: a one-second ffmpeg run from the start (same settings as every job)
    init() {
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
        this.used = Date.now();
        this.lastReq = n;
        this.prune();
        if (this.has(n)) { this.flow(); return this.file(n); }
        const j = this.job;
        if (!j || j.ended || n < j.start || n > j.cur + JUMP) this.start(n);
        else this.flow();
        await this.until(() => this.has(n), WAIT_MS);
        return this.file(n);
    }

    start(n) {
        this.stop();
        const m = this.m, j = { start: n, cur: n, frags: [], ended: false, paused: false };
        const subFiles = m.subs.map((_, k) => path.join(this.dir, `sub${k}-${n}.vtt`));
        j.subFiles = subFiles;
        j.proc = spawn(cfg.ffmpeg, ffmpegArgs(m, m.bounds[n], { subFiles }), { stdio: ['ignore', 'pipe', 'pipe'] });
        const splitter = new Splitter({ onInit: () => {}, onFragment: (t, buf) => this.fragment(j, t, buf) },
            { video: m.bounds[n], audio: seekTime(m, m.bounds[n]) - m.audioLead });
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
        console.log(`${m.hash.slice(0, 8)}:${m.index} ffmpeg from segment ${n} (${m.bounds[n].toFixed(1)}s)`);
    }

    stop() {
        const j = this.job;
        if (j && !j.ended) { j.killed = true; j.proc.kill(); }
        this.job = null;
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
        this.flow();
    }

    index(t) {   // last segment starting at or before t (with a little slack)
        const b = this.m.bounds;
        let lo = 0, hi = b.length - 2;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b[mid] <= t + SLACK_S) lo = mid; else hi = mid - 1; }
        return lo;
    }

    write(j, n) {
        if (!j.frags.length) return;
        const tmp = this.file(n) + '.tmp';
        fs.writeFileSync(tmp, Buffer.concat(j.frags));
        fs.renameSync(tmp, this.file(n));
        j.frags = [];
        this.notify();
    }

    // hold ffmpeg back when far ahead of the player, let it go again when the player catches up
    flow() {
        const j = this.job;
        if (!j || j.ended) return;
        const ahead = j.cur - this.lastReq;
        if (!j.paused && ahead > AHEAD) { j.paused = true; j.proc.stdout.pause(); }
        else if (j.paused && ahead < AHEAD - 10) { j.paused = false; j.proc.stdout.resume(); }
    }

    prune() {
        for (const f of fs.readdirSync(this.dir)) {
            const m = /^seg(\d+)\.m4s$/.exec(f);
            // (a segment being sent right now can't be deleted on Windows: the next prune gets it)
            if (m && +m[1] < this.lastReq - BEHIND) try { fs.rmSync(path.join(this.dir, f), { force: true }); } catch (e) { /* next time */ }
        }
    }

    until(test, ms) {
        if (test()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const w = { test, resolve, timer: setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); reject(new Error('timeout')); }, ms) };
            this.waiters.push(w);
        });
    }

    notify() {
        this.waiters = this.waiters.filter(w => {
            if (!w.test()) return true;
            clearTimeout(w.timer); w.resolve(); return false;
        });
    }

    // WebVTT for subtitle k, segment n: the cues ffmpeg has written that overlap it. Waits until the video
    // is past this segment, so its cues are in (subtitle packets are muxed alongside the video).
    async subtitle(k, n) {
        this.used = Date.now();
        const passed = () => { const j = this.job; return j && n >= j.start && (j.cur > n || j.ended); };
        await this.until(passed, WAIT_MS).catch(() => {});
        this.readCues(k);
        const from = this.m.bounds[n], to = this.m.bounds[n + 1];
        const cues = [...this.cues[k].values()].filter(c => c.end > from && c.start < to).sort((a, b) => a.start - b.start);
        return 'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n' +
            cues.map(c => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n');
    }

    readCues(k) {
        for (const f of fs.readdirSync(this.dir)) {
            const run = new RegExp(`^sub${k}-(\\d+)\\.vtt$`).exec(f);
            if (!run) continue;
            // each run's subtitle times start at its -ss; shown in step with the video (mp4.js)
            const shift = seekTime(this.m, this.m.bounds[+run[1]]) + (this.delay || 0);
            const text = fs.readFileSync(path.join(this.dir, f), 'utf8');
            for (const block of text.split(/\r?\n\r?\n/)) {
                const m = /(\d+:)?(\d+):(\d+\.\d+)\s+-->\s+(\d+:)?(\d+):(\d+\.\d+)[^\n]*\n([\s\S]+)/.exec(block);
                if (!m) continue;
                const sec = (h, mm, s) => (h ? parseInt(h, 10) * 3600 : 0) + parseInt(mm, 10) * 60 + parseFloat(s);
                const cue = { start: shift + sec(m[1], m[2], m[3]), end: shift + sec(m[4], m[5], m[6]), text: m[7].trim() };
                this.cues[k].set(cue.start.toFixed(3) + '|' + cue.text, cue);
            }
        }
    }

    // On Windows a killed ffmpeg holds its files open for a moment: delete a little later, and retry once
    close() {
        this.stop();
        const rm = retry => setTimeout(() => {
            try { fs.rmSync(this.dir, { recursive: true, force: true }); }
            catch (e) { if (retry) rm(false); else console.error(`could not delete ${this.dir}: ${e.message}`); }
        }, 3000);
        rm(true);
    }
}

function vttTime(t) {
    const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

module.exports = { Session };
