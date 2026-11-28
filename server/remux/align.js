// The same moment in another release of the same episode or film (README "Switching releases"). Releases from
// different sources are cut differently: Desperate Housewives S3E20's 720p (0b667957, 2561 s) against its 1080p
// (98dbecc5, 2472 s), measured 2026-11-28 by pairing their English subtitle lines: the 720p is 3.4-4.1 s earlier at
// 3:17 (the 1080p opens with a network bumper), 38.5-40.1 s later at 20:00 and 83.6-85.4 s later at 38:20. The
// shift steps at act breaks, so neither the same time nor the lengths' ratio is the same moment.
//   map(a, b, t, make) -> { at, how, pairs }: `t` in session a's video, `at` in session b's.
//   how: 'same' (lengths within SAME_S: one timeline), 'subtitles' (lines said in both, near t), 'guess' (no lines
//   to pair: the earlier of t and where the lengths' ratio puts it, so the viewer sees a little again rather than
//   misses some). make(from, to): b's segments that hold the seconds from-to (their subtitles come with them).
'use strict';

const SAME_S = 1, BEFORE_S = 120, AFTER_S = 45, NEAREST = 5, AGREE_S = 1.5, REPEAT_S = 3;

const norm = s => s.replace(/<[^>]+>/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function cues(s) { return (await s.allCues('sub0', 3000)).filter(c => norm(c.text).length >= 8); }

async function map(a, b, t, make) {
    const da = a.m.duration, db = b.m.duration;
    if (Math.abs(da - db) <= SAME_S) return { at: t, how: 'same', pairs: 0 };
    // no lines to pair: where the lengths' ratio puts it, but never later than t (a repeat over a skip). The earlier
    // of t and t + the difference put 5:27 of a 720p at 1:37 of a 1080p 230 s shorter (Desperate Housewives S3E20,
    // cc382536 → 98dbecc5, 2026-11-28; the 720p has no subtitles to pair)
    const guess = { at: Math.max(0, Math.min(t, t * db / da)), how: 'guess', pairs: 0 };
    if (!a.m.subs.length || !b.m.subs.length) return guess;
    // what a has said around t (played, or made ahead of the video)
    const near = (await cues(a)).filter(c => c.start > t - BEFORE_S && c.start < t + AFTER_S);
    if (near.length < 2) return guess;
    // b's same stretch, where the lengths' ratio puts it, wide enough for the steps between act breaks
    const g = t * db / da, wide = Math.min(BEFORE_S, Math.abs(db - da) + 30);
    await make(Math.max(0, g - wide), Math.min(db, g + AFTER_S));
    // a line said twice in the stretch pairs with nothing; the same line within REPEAT_S is one (two ffmpeg runs over
    // the same seconds wrote it 0.4-2 s apart: "you feel up to another tour of duty" at 2289.4 and 2289.8)
    const theirs = new Map();
    for (const c of await cues(b)) if (c.start > g - wide - 10 && c.start < g + AFTER_S + 10) {
        const k = norm(c.text), o = theirs.get(k);
        if (o === undefined) theirs.set(k, c);
        else if (o && Math.abs(o.start - c.start) > REPEAT_S) theirs.set(k, null);
    }
    const pairs = [];
    for (const c of near) { const o = theirs.get(norm(c.text)); if (o) pairs.push({ t: c.start, shift: o.start - c.start }); }
    if (pairs.length < 2) return guess;
    // the lines nearest t, their middle shift; at least two within AGREE_S of it
    const close = pairs.sort((x, y) => Math.abs(x.t - t) - Math.abs(y.t - t)).slice(0, NEAREST).map(p => p.shift).sort((x, y) => x - y);
    const shift = close[close.length >> 1];
    if (close.filter(s => Math.abs(s - shift) <= AGREE_S).length < 2) return guess;
    return { at: Math.max(0, Math.min(t + shift, db - 1)), how: 'subtitles', pairs: pairs.length, shift: +shift.toFixed(2) };
}

module.exports = { map, norm };
