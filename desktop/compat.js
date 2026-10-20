// Playable on this device, or a clear error (desktop/README.md "Playable on every device"). Asked for on
// 2026-10-20 after Gladiator (HDR10 HEVC) loaded forever on a friend's iPhone: "ensure we won't face this
// bug where some stuff won't play on iOS/Android Safari/Chrome, and if it happens, a concrete error, not an
// infinite loader". The remux copies the video as it is, so whether it plays is up to this device's decoder:
//  * picking: rubyPick leaves out releases whose video this device can't decode (playable(title), from the
//    release name: HEVC, HEVC 10-bit, AV1; XviD/DivX/VC-1/MPEG-2 nowhere)
//  * starting: before the player gets a remux stream, its master is read (Lampa.PlayerVideo.url is wrapped):
//    a file the remux refused stops the player with the remux's reason; a codec (CODECS) this device can't
//    decode, with that reason; HDR (VIDEO-RANGE PQ/HLG) where the browser can't show HDR video plays the video
//    playlist alone, the master's subtitles handed to Lampa as files (below)
//  * waiting: a video that doesn't start, or stops, while the torrent keeps up (swarm.js switches releases when
//    the torrent is the cause) ends in an error that says what is known, instead of the spinner; one whose
//    player asks the remux for nothing for IDLE_MS says this device didn't load it
//  * a tap readies the <video> the player will use, so Safari lets a start that comes seconds later play (below)
// The decoder asked is the one the player will use (Lampa's HlsStream.shouldUseProgram): hls.js through Media
// Source Extensions in Chrome, Android and with Settings → Player → HLS "hls.js"; else the browser's own HLS.
// HDR: Safari skips an HDR10 variant marked VIDEO-RANGE=PQ where it can't show HDR video, and fails at once on
// one marked SDR; the video playlist alone plays (macOS Safari 27 on an XDR display and the iOS 27 simulator,
// 2026-10-19/20, both reporting `(video-dynamic-range: high)` false). Its subtitles: the remux's <track>.vtt,
// each track whole as far as known (a file's own lines come in as ffmpeg reads ahead, fits improve), loaded
// again every 30 s while selected. This happens here and not in Lampa's own reading of the master
// (createParser): that uses hls.js, which can't run on an iPhone (no MediaSource), so there Lampa handed
// Safari the master and it loaded forever (iOS 27 simulator, 2026-10-20).
// Runs where play.js does (TVs too).
(function () {
    'use strict';

    // a stuck start: the first segment's bytes are in (the heartbeat's Startup.pct 100) this long and no picture
    var START_READY_MS = 20000;
    // ... or no picture at all this long: a start takes 12-16 s of swarm warm-up (server/remux/README.md),
    // swarm.js gives a slow one 60 s before switching
    var START_MS = 120000;
    // ... or the player has had its stream this long and asked the remux for nothing (Swarm.waiting 0, no start):
    // this device isn't loading it (the iPhone of 2026-10-20 never asked for the video playlist)
    var IDLE_MS = 30000;
    // stopped mid-film this long while not paused (swarm.js switches a slow torrent after 30 s)
    var STALL_MS = 90000;
    var POLL_MS = 3000;
    // the master waits for ffprobe, which waits for the torrent's first bytes (Lampa itself gives it 60 s)
    var MASTER_MS = 75000;

    var TYPES = {
        hevc: 'hvc1.1.6.L120.90', hevc10: 'hvc1.2.4.L120.90', h264: 'avc1.640028', av1: 'av01.0.08M.08', vp9: 'vp09.00.40.08'
    };
    var NAMES = { hevc: 'HEVC (H.265)', hevc10: 'HEVC 10-bit', h264: 'H.264', av1: 'AV1', vp9: 'VP9' };
    var known = null;

    // hls.js (Media Source Extensions) or the browser's own HLS, as Lampa decides it
    function usesMse(video) {
        var Hls = window.Hls, P = Lampa.Platform;
        if (!Hls || !Hls.isSupported()) return false;
        var native = !!video.canPlayType('application/vnd.apple.mpegurl');
        return Lampa.Storage.field('player_hls_method') === 'hlsjs' || (P.chromeVersion && P.chromeVersion() > 120) || !native;
    }

    // can this device's player decode `codecs` (an RFC 6381 string, e.g. from the master's CODECS)?
    function decodes(codecs) {
        var video = document.createElement('video'), type = 'video/mp4; codecs="' + codecs + '"';
        if (usesMse(video)) {
            var MS = window.ManagedMediaSource || window.MediaSource;
            return !!(MS && MS.isTypeSupported && MS.isTypeSupported(type));
        }
        return video.canPlayType(type) !== '';
    }

    function caps() {
        if (known) return known;
        known = {};
        Object.keys(TYPES).forEach(function (k) { known[k] = decodes(TYPES[k]); });
        console.log('Ruby compat', 'decodes', JSON.stringify(known), usesMse(document.createElement('video')) ? '(hls.js)' : '(native HLS)');
        return known;
    }

    // the video codec a release name says ('' when it doesn't: most untagged releases are H.264)
    function codecOf(t) {
        if (/\b(xvid|divx|vc-?1|mpeg-?2)\b/i.test(t)) return 'old';
        if (/\bav1\b/i.test(t)) return 'av1';
        if (/\b(x265|h[ .]?265|hevc)\b/i.test(t)) return /\b10[ .-]?bits?\b|\bhdr|\b(dv|dovi|dolby[ .]?vision)\b/i.test(t) ? 'hevc10' : 'hevc';
        if (/\b(x264|h[ .]?264|avc)\b/i.test(t)) return 'h264';
        return '';
    }

    function playable(t) {
        var c = codecOf(t || '');
        if (c === 'old') return false;
        return !c || caps()[c] !== false;
    }

    // what to tell the viewer about a codec this device can't decode
    function codecName(codecs) {
        var c = (codecs || '').split(',')[0];
        if (/^avc[13]/.test(c)) return NAMES.h264;
        if (/^(hvc1|hev1)\.2/.test(c)) return NAMES.hevc10;
        if (/^(hvc1|hev1)/.test(c)) return NAMES.hevc;
        if (/^av01/.test(c)) return NAMES.av1;
        if (/^vp09/.test(c)) return NAMES.vp9;
        return c;
    }

    function fail(text) {
        console.log('Ruby compat', 'error:', text);
        stopWatching();
        var v = Lampa.PlayerVideo.video();
        if (v) { try { v.pause(); } catch (e) {} }
        // Lampa's own error screen on the player (its Noise), as for a video it couldn't decode
        Lampa.PlayerVideo.listener.send('error', { error: text, fatal: true });
    }

    var watch = 0, current = null;
    function stopWatching() { clearInterval(watch); watch = 0; current = null; }

    // the stream's file index goes along: only with it does the remux say Startup (how far the file is from
    // playing), without it START_READY_MS never applied
    function heartbeat(url) {
        var m = /^(.*\/gst\/[0-9a-f]{40})\//i.exec(url), index = /[?&]index=(\d+)/.exec(url);
        if (!m) return Promise.resolve(null);
        var late = new Promise(function (r) { setTimeout(function () { r(null); }, 8000); });
        return Promise.race([fetch(m[1] + '/heartbeat' + (index ? '?index=' + index[1] : ''), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; }), late]);
    }

    function attr(line, name) {
        var m = new RegExp('(?:^|,)' + name + '=("([^"]*)"|[^,]*)').exec(line);
        return m ? (m[2] != null ? m[2] : m[1]) : '';
    }

    // what the player should open for a remux master: { url, subs } or { error }
    function readMaster(src, body) {
        var lines = body.split(/\r?\n/), inf = '', variant = '', subs = [];
        lines.forEach(function (l, i) {
            if (/^#EXT-X-STREAM-INF:/.test(l) && !inf) { inf = l.slice(18); variant = lines[i + 1] || ''; }
            if (/^#EXT-X-MEDIA:/.test(l) && attr(l.slice(13), 'TYPE') === 'SUBTITLES') subs.push(l.slice(13));
        });
        var codecs = attr(inf, 'CODECS'), range = attr(inf, 'VIDEO-RANGE'), video = codecs.split(',')[0];
        if (video && !decodes(video)) return { codecs: codecs, error: 'This release is ' + codecName(codecs) + ' video, which this ' + device() + ' can\'t play. ' + pickOther(codecs) };
        var out = { codecs: codecs, url: src };
        if ((range === 'PQ' || range === 'HLG') && variant && !showsHdr()) {
            var base = src.split('?')[0].replace(/[^/]*$/, '');
            out.url = base + variant;
            out.subs = subs.map(function (l, i) {
                return { index: i, label: attr(l, 'NAME'), language: attr(l, 'LANGUAGE'), ruby_reload: true,
                    url: base + attr(l, 'URI').replace(/\.m3u8(\?.*)?$/, '.vtt$1') };
            });
            console.log('Ruby compat', 'HDR video this browser can\'t show: the video playlist, subtitles as files', out.subs.length);
        }
        return out;
    }

    function showsHdr() {
        return !!(window.matchMedia && matchMedia('(video-dynamic-range: high)').matches);
    }

    // the player opens a remux master only after it is read (readMaster)
    function wrapUrl() {
        var url = Lampa.PlayerVideo.url;
        Lampa.PlayerVideo.url = function (src, change) {
            var self = this, args = arguments;
            if (change || !/\/gst\/[0-9a-f]{40}\/master\.m3u8/i.test(src || '')) return url.apply(self, args);
            var c = current;
            var late = new Promise(function (r) { setTimeout(function () { r({ late: true }); }, MASTER_MS); });
            Promise.race([fetch(src, { cache: 'no-store' }).then(function (r) {
                return r.text().then(function (body) { return { ok: r.ok, body: body }; });
            }), late]).then(function (res) {
                if (res.late) return heartbeat(src).then(function (h) { return { error: 'The server didn\'t open the file in ' + MASTER_MS / 1000 + ' s: ' + why(h, false, false, true) }; });
                if (res.ok) return readMaster(src, res.body);
                return { error: 'The server couldn\'t play this file: ' + (res.body || 'error ' + res.status).slice(0, 200) + '. Pick another release.' };
            }, function () { return { url: src }; }).then(function (o) {
                if (c && c !== current) return;
                if (current) current.codecs = o.codecs || '';
                if (o.error) return fail(o.error);
                url.call(self, o.url || src);
                if (o.subs && o.subs.length) Lampa.Player.subtitles(o.subs);
            });
        };
    }

    // the selected subtitle file again (Lampa's mode setter loads its url)
    function reloadSubs() {
        if (!Lampa.Player.opened()) return;
        var video = Lampa.PlayerVideo.video();
        ((video && video.customSubs) || []).forEach(function (s) { if (s.ruby_reload && s.selected) s.mode = 'showing'; });
    }

    function device() {
        var ua = navigator.userAgent;
        return /iPhone|iPad/.test(ua) ? 'device' : /Android/.test(ua) ? 'phone' : 'browser';
    }

    // the advice for a video this device didn't play: another codec, unless it already is the common one
    function pickOther(codecs) {
        return /^avc1/.test(codecs || '') || !codecs ? 'Pick another release.' : 'Pick an H.264 (x264) release.';
    }

    function why(h, played, ready, opening, loading) {
        var t = (h && h.Torrent) || {}, peers = +t.active_peers || 0, speed = (t.download_speed || 0) * 8 / 1e6;
        var codecs = current && current.codecs;
        if (!played && ready) return 'the server has sent its start, but this ' + device() + ' didn\'t play it' +
            (codecs ? ' (' + codecName(codecs) + ' video)' : '') + '. ' + pickOther(codecs);
        if (h && !peers) return 'nobody is sharing this release right now (0 peers). Pick another release.';
        if (h && speed < 0.5) return 'the torrent is barely downloading (' + peers + ' peers, ' + speed.toFixed(1) + ' Mbit/s). Pick another release.';
        if (!h && /\/gst\//.test(current && current.url || '')) return 'the server isn\'t answering. Try again in a minute.';
        if (opening) return 'it is still reading the torrent (' + peers + ' peers, ' + speed.toFixed(1) + ' Mbit/s). Try again, or pick another release.';
        if (!played && loading) return 'this ' + device() + ' is loading it too slowly: its connection is too slow for this release. Try a smaller one (720p).';
        if (!played) return 'it is downloading, but this ' + device() + ' didn\'t start it' +
            (codecs ? ' (' + codecName(codecs) + ' video)' : '') + '. ' + pickOther(codecs);
        return 'the server has it, so this ' + device() + '\'s connection is too slow for this release. Try a smaller one (720p or 1080p).';
    }

    function begin(data) {
        stopWatching();
        var url = (data && data.url) || '';
        var c = current = { url: url, at: Date.now(), stuckSince: Date.now(), readySince: 0, idleSince: 0, played: false, lastTime: -1, codecs: '' };
        watch = setInterval(function () {
            var v = Lampa.PlayerVideo.video();
            if (!v || current !== c) return;
            var moving = v.currentTime !== c.lastTime && !v.paused && v.readyState >= 3;
            if (moving && v.currentTime > 0.2) c.played = true;
            c.lastTime = v.currentTime;
            if (moving || v.paused && (c.played || v.readyState >= 3)) c.stuckSince = Date.now();
            var stuck = Date.now() - c.stuckSince;
            if (c.played ? stuck < STALL_MS : stuck < POLL_MS) return;
            heartbeat(url).then(function (h) {
                if (current !== c) return;
                var ready = !!(h && h.Startup && h.Startup.pct >= 100);
                var idle = !c.played && !ready && !!v.currentSrc && !!(h && h.Swarm) && h.Swarm.waiting === 0;
                c.idleSince = idle ? c.idleSince || Date.now() : 0;
                if (idle && Date.now() - c.idleSince >= IDLE_MS)
                    return fail('The video didn\'t start: this ' + device() + ' didn\'t load it. Press play, or close the player and start it again.');
                // "sent but not played" only for a video with no picture at all (readyState under 2, as on the
                // iPhone that loaded nothing): one that has data is loading, slowly (the iOS simulator on a shared
                // link was called "didn't play it" 25 s in and played 2 s later, 2026-10-20)
                var blank = ready && v.readyState < 2;
                if (!c.played) {
                    c.readySince = blank ? c.readySince || Date.now() : 0;
                    if (!(blank && Date.now() - c.readySince >= START_READY_MS) && stuck < START_MS) return;
                }
                fail((c.played ? 'Playback stopped: ' : 'The video didn\'t start: ') + why(h, c.played, blank, false, v.readyState >= 2));
            });
        }, POLL_MS);
    }

    // Safari lets a <video> load and play only from a tap on it, or once a tap has called its play()/load().
    // A start's stream comes seconds after the tap (the pick, the torrent, the master), and Lampa makes a new
    // <video> for each, so Safari refused every start (play(): NotAllowedError). The iOS 27 simulator loaded it
    // anyway and showed a paused player; an iPhone (iOS 18.7, Desperate Housewives, 2026-10-20) loaded nothing,
    // not even the video playlist, and the spinner stayed. So each tap and key press readies one <video>
    // (load() with no source), and Lampa's player takes it (app.min.js create$9, "Lampa Desktop:"): in the
    // simulator the same start then played by itself, no refusal.
    var spare = null;
    // each time: an event that isn't a tap (a swipe's touchend) readies nothing, the next tap must
    function ready() {
        if (!spare) spare = document.createElement('video');
        try { spare.load(); } catch (e) {}
    }
    function video() { var v = spare; spare = null; return v; }
    ['touchend', 'click', 'keydown'].forEach(function (e) { document.addEventListener(e, ready, true); });

    window.rubyCompat = { caps: caps, playable: playable, decodes: decodes, video: video };

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.Storage || !Lampa.Platform) return;
        clearInterval(t);
        wrapUrl();
        setInterval(reloadSubs, 30000);
        Lampa.Player.listener.follow('start', begin);
        Lampa.Player.listener.follow('destroy', stopWatching);
        // a decoding error from the video itself: Lampa's "Failed to decode video", with the codec said
        Lampa.PlayerVideo.listener.follow('error', function (e) {
            if (!current || !e.fatal || e.ruby || !current.codecs) return;
            var c = current;
            setTimeout(function () {
                if (current !== c) return;
                stopWatching();
                Lampa.PlayerVideo.listener.send('error', { fatal: true, ruby: true,
                    error: 'This ' + device() + ' couldn\'t play this release\'s ' + codecName(c.codecs) + ' video. ' + pickOther(c.codecs) });
            }, 0);
        });
    }, 100);
})();
