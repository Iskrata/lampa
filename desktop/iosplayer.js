// Skip intro and Next episode inside iOS's own player (desktop/README.md, "Player"). On an iPhone each stream
// plays in iOS's full-screen player (player.js iphoneFullscreen), which covers the page: Lampa's Skip button and
// nextup.js's card are there but unseen (iOS 26 simulator, 2026-11-03: the button shown 9.7 s in, the video in
// iOS's player). A page can't draw over that player, but iOS shows the video's text tracks in it, and its
// "10 s forward" button is a plain seek the page sees. So, while the video is in iOS's player:
//   * a line at the top of the picture says what that button does now: "Skip intro: tap ↻10" during a segment
//     Lampa offers a button for, "Next episode in 7: tap ↻10" during nextup.js's countdown
//   * a forward seek from inside such a segment lands at its end (as Lampa's own rewind does for its keys), one
//     during the countdown starts the next episode now.
// While AirPlaying the page is the remote instead (player.js leaves iOS's player then). Runs everywhere: it acts
// only while a video is in iOS's player.
(function () {
    'use strict';

    var last = 0;

    // in iOS's player, the picture on this screen
    function inNative(v) {
        return !!(v && v === Lampa.PlayerVideo.video() && v.webkitDisplayingFullscreen && !v.webkitCurrentPlaybackTargetIsWireless);
    }

    // the skip segment around t that Lampa offers a button for (Settings → Player → Segments "user"), or null
    function segment(t) {
        var s = Lampa.PlayerSegments && Lampa.PlayerSegments.get(t);
        return s && !s.segment.skiped && Lampa.Storage.get('player_segments_' + s.type, 'auto') == 'user' ? s.segment : null;
    }

    // a skip segment late in the file is the end credits: Lampa's button starts the next episode there (app.min.js draw$6)
    function isEnd(seg, v) {
        var d = v.duration || 0;
        return d && (seg.start >= d * 0.7 || seg.end >= d - 15);
    }

    function countdown() {
        var n = window.rubyNextUp && rubyNextUp.state();
        return n && n.left != null ? n : null;
    }

    function text(v) {
        var seg = segment(v.currentTime), n = countdown();
        if (seg) return (isEnd(seg, v) ? 'Next episode' : 'Skip intro') + ': tap ↻10';
        if (n) return 'Next episode in ' + n.left + ': tap ↻10';
        return '';
    }

    // one track per video element, marked so player.js's subtitle code leaves it alone
    function track(v) {
        if (!v._rubyHint) {
            v._rubyHint = v.addTextTrack('subtitles', 'Ruby', '');
            v._rubyHint._rubyHint = true;
        }
        return v._rubyHint;
    }

    function show(v, s) {
        if ((v._rubyHintText || '') === s) return;
        v._rubyHintText = s;
        var t = track(v);
        [].slice.call(t.cues || []).forEach(function (c) { t.removeCue(c); });
        if (!s) {
            t.mode = 'disabled';
            return;
        }
        var cue = new VTTCue(0, 1e6, s);
        // at the top of the picture, clear of the subtitles at the bottom
        cue.line = 0;
        t.addCue(cue);
        t.mode = 'showing';
    }

    function onTime(e) {
        var v = e.target;
        if (v !== Lampa.PlayerVideo.video()) return;
        if (!v.seeking) last = v.currentTime;
        show(v, inNative(v) ? text(v) : '');
    }

    function onSeeking(e) {
        var v = e.target, from = last, to = v.currentTime;
        if (!inNative(v) || to <= from + 0.5) return;
        var seg = segment(from), n = countdown();
        if (seg && to < seg.end) {
            seg.skiped = true;
            console.log('Ruby iosplayer', 'skip', from.toFixed(1), '->', seg.end.toFixed(1));
            if (isEnd(seg, v)) Lampa.PlayerPlaylist.next();
            else v.currentTime = Math.min(seg.end, v.duration || seg.end);
        } else if (!seg && n) {
            console.log('Ruby iosplayer', 'next episode at', from.toFixed(1));
            rubyNextUp.go();
        }
        last = v.currentTime;
        show(v, text(v));
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.PlayerVideo || !Lampa.PlayerPlaylist || !Lampa.Storage) return;
        clearInterval(t);
        if (!window.HTMLVideoElement || !HTMLVideoElement.prototype.webkitEnterFullscreen || !window.VTTCue) return;
        // media events don't bubble: caught in the capture phase, whatever the element
        document.addEventListener('timeupdate', onTime, true);
        document.addEventListener('seeking', onSeeking, true);
        document.addEventListener('webkitendfullscreen', function (e) { if (e.target._rubyHint) show(e.target, ''); }, true);
    }, 100);
})();
