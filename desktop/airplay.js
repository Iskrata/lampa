// AirPlay log (desktop/README.md "AirPlay"): what the phone's video did around an AirPlay session, in the
// remux's log on the server (POST /gst/log). On 2026-10-24/25 a Samsung TV (AirPlay 2, "65\" QLED") dropped
// six times; the access log shows each drop as the phone loading the video again where the TV was, 20-30 s
// after the TV stopped asking for segments (a pause?) and, twice, 3 s after the page hid (the phone locked?).
// What the page saw then (pause, page hidden, the route lost, full screen closed) is only known on the phone:
// this sends it. One line when a stream opens (so a log without AirPlay lines still says the page sent it), every
// route change, and every event while an AirPlay screen is around or the video plays on one (and 2 minutes
// after); a beacon, so a locking phone still sends it.
// The first version (2026-10-26) sent nothing from an iPhone that AirPlayed to a Mac for a minute: it listened
// on the element Lampa's `ready` handed it and logged only once `webkitCurrentPlaybackTargetIsWireless` was
// true. Now media events are caught on the document (capture: they don't bubble), whatever the element.
// Also every event from a stream's opening until it first plays, a line every 10 s while it doesn't, and errors:
// on 2026-10-29 an iPhone (iOS 18.7) twice loaded Desperate Housewives S2E13 at its saved place (segments 266-267
// in the access log) and sat at readyState 2 without playing; the same stream played in Mac Safari at once, and
// on the phone after a page reload. With no AirPlay screen around, nothing said what the video did.
(function () {
    'use strict';

    var AFTER_MS = 120000, EVENTS = ['play', 'pause', 'playing', 'waiting', 'stalled', 'seeking', 'ended', 'error',
        'emptied', 'loadstart', 'ratechange', 'webkitbeginfullscreen', 'webkitendfullscreen',
        'webkitcurrentplaybacktargetiswirelesschanged', 'webkitplaybacktargetavailabilitychanged'];
    var ROUTE = /^(webkitcurrentplaybacktargetiswirelesschanged|webkitplaybacktargetavailabilitychanged|loadstart)$/;
    var lines = [], timer = 0, wirelessAt = 0, t0 = Date.now(), opened = '', screens = false, starting = 0;

    function hash(v) {
        var m = /\/gst\/([0-9a-f]{40})\//i.exec((v && v.currentSrc) || '');
        return m ? m[1].slice(0, 8) : '-';
    }

    function line(what, v) {
        var wireless = !!(v && v.webkitCurrentPlaybackTargetIsWireless);
        return '+' + ((Date.now() - t0) / 1000).toFixed(1) + 's ' + hash(v) + ' ' + what +
            (v ? ' t=' + (v.currentTime || 0).toFixed(1) + ' paused=' + (v.paused ? 1 : 0) + ' ready=' + v.readyState +
                ' rate=' + v.playbackRate + ' wireless=' + (wireless ? 1 : 0) + ' full=' + (v.webkitDisplayingFullscreen ? 1 : 0) : ' no video') +
            ' hidden=' + (document.hidden ? 1 : 0);
    }

    function buffered(v) {
        var out = [];
        try { for (var i = 0; i < v.buffered.length; i++) out.push(v.buffered.start(i).toFixed(1) + '-' + v.buffered.end(i).toFixed(1)); } catch (e) {}
        return out.join(',') || 'none';
    }

    // until the first 'playing': what a start that never plays waits on
    function watchStart(v) {
        clearInterval(starting);
        var since = Date.now();
        starting = setInterval(function () {
            if (!document.contains(v) || v.currentSrc !== opened) return stopWatch();
            note('not playing yet after ' + Math.round((Date.now() - since) / 1000) + 's, buffered ' + buffered(v) +
                (v.error ? ', error ' + v.error.code : ''), v, true);
        }, 10000);
    }

    function stopWatch() {
        clearInterval(starting);
        starting = 0;
    }

    // force: logged whatever the route (a stream opening, a route change). Also while an AirPlay screen is around
    // (screens): in case Safari doesn't say the video is on one (iOS's own full-screen player has its own button)
    function note(what, v, force) {
        v = v || Lampa.PlayerVideo.video();
        if (v && v.webkitCurrentPlaybackTargetIsWireless) wirelessAt = Date.now();
        else if (!force && !screens && (!wirelessAt || Date.now() - wirelessAt > AFTER_MS)) return;
        lines.push(line(what, v));
        // a page going away, or the route changing, can't wait for the batch
        clearTimeout(timer);
        if (force || /^(hidden|pagehide|destroy)/.test(what)) send(); else timer = setTimeout(send, 2000);
    }

    function send() {
        if (!lines.length) return;
        var body = lines.join('\n');
        lines = [];
        try { navigator.sendBeacon(Lampa.Torserver.url() + '/gst/log', body); } catch (e) {}
    }

    function onMedia(e) {
        var v = e.target;
        // the player's video, not compat.js's spare one (no source) nor a trailer
        if (!v || v.tagName !== 'VIDEO' || !/\/gst\//.test(v.currentSrc || '')) return;
        if (e.type === 'loadstart') {
            // once per stream: Safari sends loadstart again on a reload of the same source
            if (opened === v.currentSrc) return;
            opened = v.currentSrc;
            watchStart(v);
            var ua = navigator.userAgent, os = / OS (\d+_\d+)/.exec(ua);
            return note('open ' + ((/\(([^;)]+)/.exec(ua) || [])[1] || '?') + (os ? ' iOS ' + os[1] : '') + ' ' +
                ((/Version\/[\d.]+/.exec(ua) || [''])[0]), v, true);
        }
        if (e.type === 'webkitplaybacktargetavailabilitychanged') screens = e.availability === 'available';
        var what = e.type + (e.type === 'webkitplaybacktargetavailabilitychanged' ? ' ' + e.availability : '') +
            (e.type === 'error' && v.error ? ' ' + v.error.code + ' ' + (v.error.message || '') : '');
        note(what, v, ROUTE.test(e.type) || !!starting || e.type === 'error');
        if (e.type === 'playing') stopWatch();
    }

    function start() {
        EVENTS.forEach(function (name) { document.addEventListener(name, onMedia, true); });
        Lampa.Player.listener.follow('destroy', function () { note('destroy (player closed)', null, !!starting); opened = ''; stopWatch(); });
        document.addEventListener('visibilitychange', function () { note(document.hidden ? 'hidden' : 'visible'); });
        window.addEventListener('pagehide', function () { note('pagehide'); });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.Torserver) return;
        clearInterval(t);
        if (window.WebKitPlaybackTargetAvailabilityEvent && navigator.sendBeacon) start();
    }, 100);
})();
