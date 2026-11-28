// Moving up to a better release while one plays (desktop/README.md "Switching releases while playing"). The user,
// 2026-11-28: start faster with lower quality and move up to a higher quality one over time, based on the
// connection, if such a torrent exists. A release below what this screen and connection take (play.js autoPick)
// plays when the better one was too slow (swarm.js switched down) or wasn't offered (failed in the last hours):
//   * after STEADY_S of playing without a jump or a stall, the remux service warms the best release above it, from
//     AHEAD_S ahead of the video, WARM_S of it (swap.js prepare: /gst/warm)
//   * it moves up only when what that made (at least MEASURE_S) took at most FAST of its length, so the torrent
//     keeps up with room to spare, and the same moment was found in it (same length, or subtitle lines said in
//     both: server/remux/align.js; a guess isn't enough). Then, when the video reaches the warmed place, the
//     player takes the better release there (swap.js apply): its first segments are on disk, so the switch is a
//     short reload, not a wait
//   * too slow, or it couldn't be opened: that release is tried again after AGAIN_MS, doubled each time; one that
//     can only be guessed (no subtitles to pair) isn't tried again on this page
// A release switched away from because it stalled (swarm.js, compat.js) isn't tried again for HOLD_MS.
// Not during AirPlay (the TV holds the stream) or near the end.
(function () {
    var STEADY_S = 60, AHEAD_S = 45, WARM_S = 60, FAST = 0.6, MEASURE_S = 20, AGAIN_MS = 5 * 60000, HOLD_MS = 30 * 60000, END_S = 120;
    var state = null;   // { from, last, next, trying, armed: { p, release, at, until } }
    var skip = {};      // hash -> until when it isn't tried
    var tries = {};     // hash -> measured too slow this many times

    function reset() { state = { from: null, last: 0, next: 0, trying: false, armed: null }; }
    function hashOf(r) { return (rubyPick.hashOf(r) || '').toLowerCase(); }
    function skipped(r) { var h = hashOf(r); return !!h && skip[h] > Date.now(); }

    function tick() {
        var v = Lampa.PlayerVideo.video();
        if (!state || !v || v.paused || !Lampa.Player.opened() || !rubySwap.stream() || v.webkitCurrentPlaybackTargetIsWireless) return;
        // playing steadily: counted from the last jump or stall (a resume to the saved place is a jump)
        if (state.from === null || v.currentTime < state.last || v.currentTime - state.last > 5) state.from = v.currentTime;
        state.last = v.currentTime;
        if (state.armed) return arrive(v);
        if (state.trying || Date.now() < state.next || v.currentTime - state.from < STEADY_S) return;
        var at = v.currentTime + AHEAD_S;
        if (v.duration && at + WARM_S > v.duration - END_S) { state.next = Infinity; return; }
        var r = rubyPlay.better(skipped)[0];
        if (!r) { state.next = Date.now() + AGAIN_MS; return; }
        state.trying = true;
        var from = rubySwap.stream(), mine = state;
        console.log('Ruby upgrade', 'trying', r.Title, 'from', Math.round(at));
        rubySwap.prepare(r, at, WARM_S).then(function (p) {
            if (state !== mine || rubySwap.stream() !== from) return;
            mine.trying = false;
            // measured now (at least MEASURE_S made by this call) and the same moment found (not guessed)
            var fast = p.seconds >= MEASURE_S && p.made <= p.seconds * 1000 * FAST, sure = p.aligned === 'same' || p.aligned === 'subtitles';
            console.log('Ruby upgrade', p.hash.slice(0, 8), p.seconds + ' s made in ' + (p.made / 1000).toFixed(1) + ' s,', p.aligned, 'shift', p.shift,
                fast && sure ? '-> moving up at ' + Math.round(at) : '-> not now, again in ' + AGAIN_MS / 60000 + ' min');
            if (!fast || !sure) {
                // a guess (no subtitles to pair) stays a guess: not again this page. Too slow: again after AGAIN_MS,
                // twice as long each time (each try makes ~60-200 s of the better release on the home server: 195 s
                // of 1080p, ~200 MB, on 2026-11-28)
                var h = p.hash.toLowerCase(), n = tries[h] = (tries[h] || 0) + 1;
                skip[h] = sure ? Date.now() + AGAIN_MS * Math.pow(2, n - 1) : Infinity;
                mine.next = Date.now() + AGAIN_MS;
                return;
            }
            mine.armed = { p: p, release: r, at: at, until: at + WARM_S - 10 };
        }, function (e) {
            if (state !== mine) return;
            console.log('Ruby upgrade', 'could not open', r.Title + ':', e.message);
            mine.trying = false;
            mine.next = Date.now() + AGAIN_MS;
            var h = hashOf(r);
            if (h) skip[h] = Date.now() + AGAIN_MS;
        });
    }

    // the video reached the warmed place: the better release from here. Past it or jumped away: warmed again later
    function arrive(v) {
        var a = state.armed, t = v.currentTime;
        if (t >= a.until || t < a.at - AHEAD_S - 10) { state.armed = null; state.next = Date.now(); return; }
        if (t < a.at) return;
        state.armed = null;
        if (rubySwap.apply(a.p, t + (a.p.shift || 0), a.release, 'better'))
            Lampa.Noty.show('Now in ' + (rubyPick.LABEL[rubyPick.resolution(a.release.Title || '')] || 'better quality'));
    }

    function init() {
        Lampa.Player.listener.follow('start', reset);
        Lampa.Player.listener.follow('destroy', function () { state = null; });
        rubySwap.follow(function (e) {
            // a switch away from a stall is under way: nothing armed may land in the middle of it
            if (e.type === 'swapping' && state) { state.armed = null; state.next = Date.now() + AGAIN_MS; }
            if (e.type !== 'swapped') return;
            // moved away from because it stalled or stopped: not straight back to it
            if (e.why !== 'better') skip[e.old] = Date.now() + HOLD_MS;
            reset();
        });
        setInterval(tick, 1000);
    }

    var timer = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo || !window.rubySwap || !window.rubyPlay || !rubyPlay.better || !window.rubyPick) return;
        clearInterval(timer);
        init();
    }, 100);
})();
