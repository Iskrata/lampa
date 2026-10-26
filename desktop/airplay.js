// AirPlay log (desktop/README.md "AirPlay"): what the phone's video did around an AirPlay session, in the
// remux's log on the server (POST /gst/log). On 2026-10-24/25 a Samsung TV (AirPlay 2, "65\" QLED") dropped
// six times; the access log shows each drop as the phone loading the video again where the TV was, 20-30 s
// after the TV stopped asking for segments (a pause?) and, twice, 3 s after the page hid (the phone locked?).
// What the page saw then (pause, page hidden, the route lost, full screen closed) is only known on the phone:
// this sends it. Only while the video plays on a screen and for 2 minutes after; a beacon, so a locking phone
// still sends it.
(function () {
    'use strict';

    var AFTER_MS = 120000, EVENTS = ['play', 'pause', 'playing', 'waiting', 'stalled', 'seeking', 'ended', 'error',
        'emptied', 'loadstart', 'ratechange', 'webkitbeginfullscreen', 'webkitendfullscreen',
        'webkitcurrentplaybacktargetiswirelesschanged'];
    var lines = [], timer = 0, wirelessAt = 0, t0 = Date.now();

    function current() { return Lampa.PlayerVideo.video(); }

    function hash(v) {
        var m = /\/gst\/([0-9a-f]{40})\//i.exec((v && v.currentSrc) || '');
        return m ? m[1].slice(0, 8) : '-';
    }

    function note(what, v) {
        v = v || current();
        var wireless = !!(v && v.webkitCurrentPlaybackTargetIsWireless);
        if (wireless) wirelessAt = Date.now();
        else if (!wirelessAt || Date.now() - wirelessAt > AFTER_MS) return;
        lines.push('+' + ((Date.now() - t0) / 1000).toFixed(1) + 's ' + hash(v) + ' ' + what +
            (v ? ' t=' + (v.currentTime || 0).toFixed(1) + ' paused=' + (v.paused ? 1 : 0) + ' ready=' + v.readyState +
                ' rate=' + v.playbackRate : ' no video') +
            ' wireless=' + (wireless ? 1 : 0) + ' hidden=' + (document.hidden ? 1 : 0) +
            ' full=' + (v && v.webkitDisplayingFullscreen ? 1 : 0));
        // a page going away, or the route changing, can't wait for the batch
        var now = /^(hidden|pagehide|webkitcurrentplaybacktargetiswirelesschanged|destroy)/.test(what);
        clearTimeout(timer);
        if (now) send(); else timer = setTimeout(send, 2000);
    }

    function send() {
        if (!lines.length) return;
        var body = lines.join('\n');
        lines = [];
        try { navigator.sendBeacon(Lampa.Torserver.url() + '/gst/log', body); } catch (e) {}
    }

    function watch(v) {
        if (!v || v._rubyApLog) return;
        v._rubyApLog = true;
        EVENTS.forEach(function (name) { v.addEventListener(name, function () { note(name, v); }); });
    }

    function start() {
        // the player's <video> can be new for each stream
        Lampa.Player.listener.follow('ready', function () { watch(current()); });
        Lampa.Player.listener.follow('destroy', function () { note('destroy (player closed)'); });
        document.addEventListener('visibilitychange', function () { note(document.hidden ? 'hidden' : 'visible'); });
        window.addEventListener('pagehide', function () { note('pagehide'); });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.Torserver) return;
        clearInterval(t);
        if (window.WebKitPlaybackTargetAvailabilityEvent && navigator.sendBeacon) start();
    }, 100);
})();
