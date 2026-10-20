// Continue starts the stream at the saved time (desktop/README.md, "Starting where you left off"). Lampa's player
// starts every video at 0 and jumps to the saved time on its first `timeupdate` (app.min.js Timeline), so the
// remux made segment 0 for nothing and then the one at the saved time: Friends S01E01 at 0:53 waited 4.8 s for
// seg0, then 8.8-12 s for seg8 (2026-10-20). hls.js is given the saved time as its `startPosition`; Lampa's own
// jump then lands where the video already is. Safari's native HLS gets the time set as soon as the player calls
// load(): Safari then asks for the segment there, not segment 0 (iOS 27 simulator, 2026-10-20; a `#t=` in the URL
// still fetched segment 0 first). Runs everywhere (TV too).
(function () {
    var at = 0;       // where the stream being opened starts, 0 for the start
    var native = 0;   // the same, until a native HLS video has been given it

    // where Lampa's player will jump (app.min.js Timeline's timeupdate handler): the saved time when it is past
    // 10 s and under 90 %, not within the last 15 s; not when Settings → Player says start again or ask
    function resumeAt(data) {
        var t = data && data.timeline, mode = Lampa.Storage.field('player_timecode');
        if (!t || mode === 'again' || mode === 'ask' || !(t.percent < 90)) return 0;
        var exact = parseFloat(t.time + ''), d = parseFloat(t.duration + '') || 0;
        var posit = exact > 0 && (!d || exact < d) ? exact : Math.round(d * t.percent / 100);
        if (!(posit > 10)) return 0;
        return d && posit > d - 15 ? d - 15 : posit;
    }

    // window.Hls with startPosition set for the stream being opened (Lampa makes a new Hls per stream)
    function wrapHls() {
        var Orig = window.Hls;
        if (!Orig || Orig.rubyStartAt) return;
        var Hls = function (config) {
            var c = {};
            for (var k in config || {}) c[k] = config[k];
            if (at && c.startPosition == null) {
                c.startPosition = at;
                console.log('Ruby startat', 'hls.js starts at', at.toFixed(1));
            }
            return new Orig(c);
        };
        Object.getOwnPropertyNames(Orig).forEach(function (k) {
            if (/^(prototype|length|name|caller|arguments)$/.test(k)) return;
            try { Object.defineProperty(Hls, k, Object.getOwnPropertyDescriptor(Orig, k)); } catch (e) {}
        });
        Hls.prototype = Orig.prototype;
        Hls.rubyStartAt = true;
        window.Hls = Hls;
    }

    // native HLS (Safari): the player sets src and calls load(); a time set before metadata is where it starts
    // (HTML's default playback start position). load() resets it, so it is set right after.
    function wrapLoad() {
        var load = HTMLMediaElement.prototype.load;
        HTMLMediaElement.prototype.load = function () {
            var r = load.apply(this, arguments);
            if (native && /\.m3u8/.test(this.getAttribute('src') || '')) {
                try { this.currentTime = native; console.log('Ruby startat', 'native HLS starts at', native.toFixed(1)); } catch (e) {}
                native = 0;
            }
            return r;
        };
    }

    function init() {
        wrapLoad();
        // 'start' comes right before the player is given the stream (PlayerVideo.url)
        Lampa.Player.listener.follow('start', function (data) {
            at = native = resumeAt(data);
            wrapHls();
        });
        Lampa.Player.listener.follow('destroy', function () { at = native = 0; });
    }

    var timer = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.Player.listener || !Lampa.Storage) return;
        clearInterval(timer);
        init();
    }, 100);
})();
