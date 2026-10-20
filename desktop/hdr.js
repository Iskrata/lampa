// HDR films in a browser that can't show HDR video (server/remux/README.md "HDR").
// Safari skips an HDR10 variant (VIDEO-RANGE=PQ) where it can't show HDR video, and fails at once on one
// listed as SDR; the media playlist on its own plays (macOS Safari 27 on an XDR display and the iOS 27 simulator,
// 2026-10-19: both report `(video-dynamic-range: high)` false). There the player gets the variant playlist,
// and the master's subtitles as whole files (the remux's <track>.vtt), which Lampa shows itself. The remux
// learns a file's own subtitles as ffmpeg reads ahead and refits OpenSubtitles' as more come in, so the one on
// screen is loaded again every 30 s.
// app.min.js asks variantOnly(parser) before keeping a master that lists subtitles (its createParser).
(function () {
    'use strict';

    var RELOAD_MS = 30000;

    function hdr(level) {
        var range = level && level.attrs && level.attrs['VIDEO-RANGE'];
        return range === 'PQ' || range === 'HLG';
    }

    function showsHdr() {
        return !!(window.matchMedia && matchMedia('(video-dynamic-range: high)').matches);
    }

    // true: play the variant playlist, with the master's subtitles handed to Lampa as files
    function variantOnly(parser) {
        if (!parser.levels.length || !parser.levels.every(hdr) || showsHdr()) return false;
        var subs = parser.subtitleTracks.map(function (t, i) {
            return { index: i, label: t.name, language: t.lang, url: t.url.replace(/\.m3u8(\?.*)?$/, '.vtt$1'), ruby_reload: true };
        });
        console.log('Player', 'HDR video this browser can\'t show: variant playlist, subtitles as files', subs.length);
        if (subs.length) Lampa.Player.subtitles(subs);
        return true;
    }

    function reload() {
        if (!Lampa.Player.opened()) return;
        var video = Lampa.PlayerVideo.video();
        ((video && video.customSubs) || []).forEach(function (s) {
            if (s.ruby_reload && s.selected) s.mode = 'showing';   // Lampa's setter loads s.url again
        });
    }

    window.rubyHdr = { variantOnly: variantOnly };

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo) return;
        clearInterval(t);
        setInterval(reload, RELOAD_MS);
    }, 100);
})();
