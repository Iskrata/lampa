// The player's control bar (desktop/README.md, "Player"):
//   * Subtitles: Lampa's button is a speech-bubble icon that only appears once a stream reports subtitle
//     tracks (with server/remux: English, Bulgarian and Russian ones). It becomes a labelled "CC" button.
//     Safari only gets them since app.min.js keeps the HLS master when it lists subtitles (README "Changes to
//     Lampa itself"). On by default, in Settings → Player → Subtitle language (English unless chosen; those
//     three are at the top of its list).
//   * Full screen on iPhones: each stream starts in iOS's own player (Safari has no page full screen), and the
//     button opens it again.
//   * F toggles fullscreen, C subtitles. Left/Right seek even while the control bar is up (Lampa moves between its buttons
//     then), media keys seek too, and the bar has back/forward buttons beside play/pause. Seeks are exactly
//     the step (10 s by default) and never pause the video, also Continue's jump to the saved time.
//   * Quality: the resolutions Play found (play.js), switched where the video is; anime also switches audio.
//   * AirPlay to a TV with a 4K copy found: a "Play in 4K on your TV" button (play.js remembers it per device).
//   * AirPlay: a button next to picture-in-picture, in Safari when an AirPlay screen is around
//     (WebKitPlaybackTargetAvailabilityEvent). It hands the stream to an Apple TV: torrents play as HLS
//     from the server (server/remux), which the Apple TV fetches itself.
// Active only where desktop.js is.
(function () {
    var CSS = [
        '.player-panel__subs svg,.player-panel__airplay svg{width:1.6em;height:1.6em}',
        // the "⋯" menu on phones copies these icons; icons.js's 1em would beat Lampa's menu icon size
        '.selectbox-item__icon>.ruby-icon{width:2.7em!important;height:2.7em!important}',
        '.player-panel__subs .ruby-cc-label{margin-left:.35em;font-size:.85em;font-weight:600;letter-spacing:.02em}',
        '.player-panel__subs,.player-panel__tracks{display:flex;align-items:center;width:auto!important;padding:0 .6em}',
        '.player-panel__tracks svg{width:1.6em;height:1.6em}',
        '.player-panel__airplay.hide{display:none!important}',
        // no torrent numbers under the title ("1920x800 · 0 / 0 • 0 connected · 0 Byte"; simplicity review 2026-10-20)
        '.player-info__values .value--size,.player-info__values .value--stat,.player-info__values .value--speed,.player-info__values .value--pieces{display:none!important}',
        '.ruby-tv4k{position:absolute;top:5em;right:2em;z-index:40;display:flex;flex-direction:column;gap:.2em;padding:.9em 1.3em;border-radius:.6em;' +
            'background:rgba(20,20,20,.9);color:#fff;cursor:pointer;font-size:1.2em}',
        '.ruby-tv4k span{font-size:.8em;color:#bbb}',
        '.ruby-tv4k:hover,.ruby-tv4k.focus{background:#fff;color:#000}.ruby-tv4k:hover span,.ruby-tv4k.focus span{color:#444}',
        '.player-panel__center{display:flex;align-items:center;justify-content:center;gap:.4em}',
        '.player-panel .ruby-seek{position:relative;display:flex;align-items:center;justify-content:center;width:4.2em;height:4.2em;padding:0}',
        '.player-panel .button.ruby-seek svg{width:2.9em!important;height:2.9em!important}',
        '.ruby-seek__n{position:absolute;font-size:1.05em;font-weight:700;top:55%;left:50%;transform:translate(-50%,-50%)}',
        '.ruby-seekbadge{position:absolute;top:50%;z-index:30;display:flex;align-items:center;gap:.5em;padding:.6em 1.1em;border-radius:2em;' +
            'background:rgba(0,0,0,.55);color:#fff;font-size:1.6em;font-weight:600;pointer-events:none;opacity:0;transform:translateY(-50%) scale(.92);transition:opacity .25s,transform .25s}',
        '.ruby-seekbadge svg{width:1.4em!important;height:1.4em!important}',
        '.ruby-seekbadge--back{left:12%}.ruby-seekbadge--fwd{right:12%}',
        '.ruby-seekbadge--on{opacity:1;transform:translateY(-50%) scale(1);transition:opacity .1s,transform .1s}'
    ].join('\n');

    // Seeks the way other web players do: exactly the step (Settings → Player → Rewind, 10 s by default) per
    // press, presses add up, and the video keeps playing. Lampa's own rewind paused the video on each press,
    // grew the step 3 % a press, and played again a second after the last one; when that play() didn't take,
    // the video stayed paused (reported 2026-10-18 in Safari).
    var seekTarget = null, seekTimer = 0, seekSum = 0, badge = null, badgeTimer = 0;

    function seek(forward) {
        if (Lampa.PlayerIPTV && Lampa.PlayerIPTV.playning && Lampa.PlayerIPTV.playning()) return;
        var v = Lampa.PlayerVideo.video(), step = +Lampa.Storage.field('player_rewind') || 10;
        if (!v || !v.duration) return;
        if (seekTarget == null) { seekTarget = v.currentTime; seekSum = 0; }
        seekTarget = Math.max(0, Math.min(v.duration - 1, seekTarget + (forward ? step : -step)));
        seekSum += forward ? step : -step;
        showBadge(seekSum);
        Lampa.PlayerVideo.listener.send('timeupdate', { duration: v.duration, current: seekTarget });   // the panel's bar
        // presses close together make one seek (each far seek restarts the remux's ffmpeg)
        clearTimeout(seekTimer);
        seekTimer = setTimeout(function () {
            var t = seekTarget;
            seekTarget = null;
            seekNow(t);
        }, 350);
    }

    // currentTime only: no pause/play around it, so a playing video plays on and a paused one stays paused
    function seekNow(t) {
        var v = Lampa.PlayerVideo.video();
        if (!v) return;
        console.log('Ruby player', 'seek', v.currentTime.toFixed(1), '->', t.toFixed(1), v.paused ? 'paused' : 'playing');
        try { v.currentTime = t; } catch (e) { console.log('Ruby player', 'seek failed', e.message); }
    }

    function showBadge(sum) {
        var root = document.querySelector('.player');
        if (!root) return;
        if (!badge || !root.contains(badge)) {
            badge = document.createElement('div');
            badge.className = 'ruby-seekbadge';
            root.appendChild(badge);
        }
        badge.className = 'ruby-seekbadge ruby-seekbadge--' + (sum < 0 ? 'back' : 'fwd') + ' ruby-seekbadge--on';
        badge.innerHTML = rubyIcons.svg(sum < 0 ? 'seekBack' : 'seekForward') + '<span>' + (sum < 0 ? '−' : '+') + Math.abs(sum) + ' s</span>';
        clearTimeout(badgeTimer);
        badgeTimer = setTimeout(function () { badge.classList.remove('ruby-seekbadge--on'); }, 900);
    }

    // Lampa's PlayerVideo.to (resuming at the saved time on Continue, a click on the timeline, the skip
    // button) also paused, seeked and played again. While the video plays, it now only seeks.
    function seekWithoutPause() {
        var to = Lampa.PlayerVideo.to;
        Lampa.PlayerVideo.to = function (seconds) {
            var v = Lampa.PlayerVideo.video();
            if (!v || v.paused || !v.duration) return to.apply(this, arguments);
            seekNow(seconds == -1 ? Math.max(0, v.duration - 3) : Math.max(0, Math.min(seconds, v.duration)));
        };
    }

    // iPhone: Safari can't make a page full screen (no Element.requestFullscreen), only a <video>, in iOS's own
    // player. Lampa asks Utils.canFullScreen and so had no full-screen button there, and in landscape Safari's
    // bars stay (the page doesn't scroll): a friend couldn't get them away, 2026-10-21. While the player is open
    // its button (and Lampa's double tap in the middle) now opens the video in iOS's player, which rotates.
    // Lampa's own controls aren't in there; closing it comes back to them where the video is.
    // Each stream also starts there by itself (the user: "I don't see a case where someone would want it
    // portrait", 2026-10-21). Once per stream: after a swipe down Lampa's player stays until the next episode,
    // and a pause or a stall doesn't bring iOS's player back. A web page can't turn the picture to landscape;
    // iOS's player turns with the phone.
    function iphoneFullscreen() {
        var U = Lampa.Utils, can = U.canFullScreen, toggle = U.toggleFullscreen;
        var proto = window.HTMLVideoElement && HTMLVideoElement.prototype;
        if (!proto || !proto.webkitEnterFullscreen) return;
        // open from the player's `start` on: the panel decides on its button in its own `start` listener, which
        // runs before Lampa.Player.opened() turns true (iOS 27 simulator, 2026-10-21)
        var open = false, listener = Lampa.Player.listener, send = listener.send;
        listener.send = function (type) {
            if (type === 'start') open = true;
            else if (type === 'destroy') open = false;
            return send.apply(this, arguments);
        };
        function native() { return open && !can(); }
        U.canFullScreen = function () { return can.apply(this, arguments) || native(); };
        function enter(v) {
            // before the video's metadata iOS refuses (InvalidStateError): nothing to show yet
            try { if (v) v.webkitEnterFullscreen(); } catch (e) { console.log('Ruby', 'iOS full screen:', e.name); }
        }
        U.toggleFullscreen = function () {
            if (!native()) return toggle.apply(this, arguments);
            enter(Lampa.PlayerVideo.video());
        };
        // media events don't bubble: caught in the capture phase. Seconds after the tap is fine: in the iOS 27
        // simulator a start 5 s after it went full screen, and so did the next episode at the end of one.
        var autoSrc = null;
        document.addEventListener('playing', function (e) {
            var v = e.target;
            if (!native() || v !== Lampa.PlayerVideo.video() || v.webkitDisplayingFullscreen || v.currentSrc === autoSrc) return;
            autoSrc = v.currentSrc;
            enter(v);
            // the next episode's call comes while the last one's full screen is closing, and iOS sometimes ignores
            // it (no error, no webkitbeginfullscreen; 2 of 4 runs): a second try a second later caught it
            setTimeout(function () {
                if (native() && v === Lampa.PlayerVideo.video() && !v.webkitDisplayingFullscreen && !v.paused) enter(v);
            }, 1000);
        }, true);
    }

    // Lampa turns a click on a .selector into hover:enter, so both can arrive for one press
    function onPress(btn, fn) {
        var last = 0, go = function () {
            if (Date.now() - last < 500) return;
            last = Date.now();
            fn();
        };
        // remote / keyboard. Through jQuery: on phones the panel's "⋯" menu presses the button with jQuery's
        // trigger('hover:enter') (app.min.js mobile_more), which skips addEventListener listeners
        $(btn).on('hover:enter', go);
        btn.addEventListener('click', go);
    }

    function seekButtons(panel) {
        var center = panel.querySelector('.player-panel__center'), pp = panel.querySelector('.player-panel__playpause');
        if (!center || !pp || center.querySelector('.ruby-seek')) return;
        var step = Lampa.Storage.field('player_rewind') || 20;
        [false, true].forEach(function (forward) {
            var btn = document.createElement('div');
            btn.className = 'ruby-seek button selector';
            btn.innerHTML = rubyIcons.svg(forward ? 'seekForward' : 'seekBack') + '<span class="ruby-seek__n">' + step + '</span>' +
                '<div class="tooltip">' + (forward ? 'Forward ' : 'Back ') + step + ' s</div>';
            onPress(btn, function () { seek(forward); });
            if (forward) center.appendChild(btn);
            else center.insertBefore(btn, pp);
        });
    }

    // the subtitle languages server/remux offers, first in Settings → Player → Subtitle language
    var SUB_LANGS = { en: /english/i, bg: /bulgarian|българ/i, ru: /russian|русск/i };

    // a track in a language: Safari's text tracks have it, hls.js's (as Lampa lists them) only the name
    function inLang(s, code) {
        var tag = s.language || s.lang || s.srclang || '';
        return tag ? tag.slice(0, 2).toLowerCase() === code : !!(SUB_LANGS[code] && SUB_LANGS[code].test(s.label || ''));
    }

    // the profile's subtitle language ("auto": English), else English, else the first
    function preferred(list) {
        var want = Lampa.Storage.field('subtitles_lang');
        if (!want || want === 'auto') want = 'en';
        var byLang = function (code) { return list.filter(function (t) { return inLang(t, code); })[0]; };
        return byLang(want) || byLang('en') || list[0];
    }

    function subLangsFirst() {
        var values = Lampa.Params.values && Lampa.Params.values.subtitles_lang;
        if (!values) return;
        var ordered = { auto: values.auto };
        Object.keys(SUB_LANGS).forEach(function (code) { if (values[code]) ordered[code] = values[code]; });
        Object.keys(values).forEach(function (code) { if (!(code in ordered)) ordered[code] = values[code]; });
        Lampa.Params.values.subtitles_lang = ordered;
    }

    var subsList = null;   // the stream's subtitle tracks, as Lampa got them (its 'subs' event)

    // C: subtitles off if any are on, else on (the profile's language, see preferred), as Lampa's own menu does it
    function toggleSubs() {
        var list = (subsList || []).filter(function (t) { return t.index !== -1; });   // not the menu's "Disabled"
        if (!list.length) return Lampa.Noty.show('No subtitles in this video');
        var on = list.some(function (t) { return t.mode === 'showing' || t.selected; });
        (subsList || []).forEach(function (t) { t.mode = 'disabled'; t.selected = t.index === -1 && on; });
        if (!on) {
            var pick = preferred(list);
            pick.mode = 'showing';
            pick.selected = true;
        }
        Lampa.PlayerVideo.subsview(!on);
        Lampa.Noty.show(on ? 'Subtitles off' : 'Subtitles on');
    }

    // Subtitles on by default, in the profile's language. Lampa only applies "subtitles on" to tracks the
    // browser reports itself (Safari); with hls.js (Chrome) it lists them and leaves them off, so pick one here
    // for both.
    function autoSubs(subs) {
        if (!subs || !subs.length || !Lampa.Storage.field('subtitles_start')) return;
        for (var i = 0; i < subs.length; i++) if (subs[i].selected || subs[i].mode === 'showing') return;
        var pick = preferred(subs);
        pick.mode = 'showing';
        pick.selected = true;
        Lampa.PlayerVideo.subsview(true);
    }

    // Lampa looks for the browser's subtitle tracks once, when the video has loaded; tracks Safari adds later
    // are passed on here
    function lateTracks() {
        var video = Lampa.PlayerVideo.video();
        if (!video || !video.textTracks || video._rubySubs) return;
        video._rubySubs = true;
        video.textTracks.addEventListener('addtrack', function () {
            if (video._rubySubsSeen || video.readyState < 2) return;
            var list = [].filter.call(video.textTracks, function (t) { return t.kind === 'subtitles' || t.kind === 'captions'; });
            if (list.length) Lampa.PlayerVideo.listener.send('subs', { subs: list });
        });
    }

    function mediaKeys() {
        var ms = navigator.mediaSession;
        if (!ms || !ms.setActionHandler) return;
        [['seekbackward', false], ['seekforward', true], ['previoustrack', false], ['nexttrack', true]].forEach(function (a) {
            try { ms.setActionHandler(a[0], function () { if (Lampa.Player.opened()) seek(a[1]); }); } catch (e) {}
        });
    }

    function relabelSubs(panel) {
        var subs = panel.querySelector('.player-panel__subs');
        if (!subs || subs.querySelector('.ruby-cc-label')) return;
        var tip = subs.querySelector('.tooltip');
        subs.innerHTML = rubyIcons.svg('cc') + '<span class="ruby-cc-label">Subtitles</span>' + (tip ? tip.outerHTML : '');
    }

    // "Audio" with its label next to Subtitles (Lampa's is an unlabelled voice icon), and the tooltips in plain
    // words: the panel was built from its template before player.js could rename them (Lampa.Lang.add below)
    function plainWords(panel) {
        var tracks = panel.querySelector('.player-panel__tracks');
        if (tracks && !tracks.querySelector('.ruby-cc-label')) {
            var svg = tracks.querySelector('svg');
            tracks.innerHTML = (svg ? svg.outerHTML : '') + '<span class="ruby-cc-label">Audio</span>';
        }
        var tips = { '.player-panel__pip': 'Picture in picture', '.player-panel__fullscreen': 'Full screen', '.player-panel__next': 'Next episode',
            '.player-panel__playlist': 'Episodes', '.player-panel__settings': 'Settings', '.player-panel__volume': 'Volume' };
        Object.keys(tips).forEach(function (sel) {
            [].forEach.call(panel.querySelectorAll(sel + ' > .tooltip'), function (t) { t.textContent = tips[sel]; });
        });
    }

    // Quality: the resolutions Play found for this title (play.js), switched where it is; for anime also the
    // audio (simplicity review 2026-10-20: Play no longer asks "Play in"). Elsewhere (another source, "Pick
    // torrents for me" off) Lampa's own menu. Lampa's handler is taken over rather than raced: phones press
    // the button through jQuery's trigger from the "⋯" menu, which no capture listener sees.
    function qualityButton(panel) {
        var btn = panel.querySelector('.player-panel__quality');
        if (!btn) return;
        if (!btn._rubyQuality) {
            btn._rubyQuality = true;
            var own = (($._data(btn, 'events') || {})['hover:enter'] || []).map(function (h) { return h.handler; });
            $(btn).off('hover:enter').on('hover:enter', function (e) {
                if (qualityMenu()) return;
                var self = this, args = arguments;
                own.forEach(function (h) { h.apply(self, args); });
            });
            // Lampa writes the stream's own level ("FHD") into it when the stream loads
            new MutationObserver(function () { label(btn); }).observe(btn, { childList: true, characterData: true, subtree: true });
        }
        label(btn);
    }
    function label(btn) {
        var q = window.rubyPlay && rubyPlay.qualities(), cur = q && q.list.filter(function (c) { return c.on; })[0];
        if (cur && btn.textContent !== cur.label) btn.textContent = cur.label;
        if (cur) btn.classList.remove('hide');
    }
    function qualityMenu() {
        var q = window.rubyPlay && rubyPlay.qualities();
        if (!q) return false;
        var items = q.list.map(function (c) { return { title: c.label, res: c.res, selected: c.on }; });
        if (q.audio) items.push({ title: 'Audio', separator: true },
            { title: 'English dub', audio: 'en', selected: q.audio === 'en' },
            { title: 'Japanese with English subtitles', audio: 'ja', selected: q.audio === 'ja' });
        var back = Lampa.Controller.enabled().name;
        Lampa.Select.show({
            title: 'Quality',
            items: items,
            onSelect: function (a) {
                if (a.selected) return Lampa.Controller.toggle(back);
                rubyPlay.switchTo(a.res ? { res: a.res } : { audio: a.audio });
            },
            onBack: function () { Lampa.Controller.toggle(back); }
        });
        return true;
    }

    // On a TV through AirPlay, with a 4K copy found and something smaller playing: offer it (the user's call
    // 2026-10-20). Switching makes a new video element, which ends the AirPlay session, so it's a button, not
    // automatic: the user taps AirPlay once more after it. play.js then remembers it for this device.
    function tvOffer(video) {
        var old = document.querySelector('.ruby-tv4k');
        if (old) old.remove();
        var q = window.rubyPlay && rubyPlay.qualities(), cur = q && q.list.filter(function (c) { return c.on; })[0];
        if (!video.webkitCurrentPlaybackTargetIsWireless || !q || !cur || cur.res === 2160) return;
        if (!q.list.some(function (c) { return c.res === 2160; })) return;
        var b = document.createElement('div');
        b.className = 'ruby-tv4k selector';
        b.innerHTML = '<b>Play in 4K on your TV</b><span>Then tap AirPlay once more</span>';
        onPress(b, function () { b.remove(); rubyPlay.switchTo({ res: 2160, tv: true }); });
        (document.querySelector('.player') || document.body).appendChild(b);
        setTimeout(function () { b.remove(); }, 30000);
    }

    function airplayButton(panel) {
        if (!window.WebKitPlaybackTargetAvailabilityEvent) return;
        var btn = panel.querySelector('.player-panel__airplay'), pip = panel.querySelector('.player-panel__pip');
        if (!btn && pip) {
            btn = document.createElement('div');
            btn.className = 'player-panel__airplay button selector hide';
            btn.innerHTML = rubyIcons.svg('airplay') + '<div class="tooltip">AirPlay</div>';
            pip.parentNode.insertBefore(btn, pip);
            onPress(btn, function () {
                var v = Lampa.PlayerVideo.video();
                if (v && v.webkitShowPlaybackTargetPicker) v.webkitShowPlaybackTargetPicker();
            });
        }
        // the video element can be new for each stream: watch the current one for AirPlay screens
        var video = Lampa.PlayerVideo.video();
        if (btn && video && !video._rubyAirplay) {
            video._rubyAirplay = true;
            video.addEventListener('webkitplaybacktargetavailabilitychanged', function (e) {
                btn.classList.toggle('hide', e.availability !== 'available');
            });
            video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', function () { tvOffer(video); });
        }
    }

    function start() {
        if (!rubyDesktop.active()) return;
        var style = document.createElement('style');
        style.id = 'ruby-player';
        style.textContent = CSS;
        document.head.appendChild(style);
        // F = fullscreen, as in every web player (Lampa, built for remotes, has no such key). Same as its own button.
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'f' && e.key !== 'F' || e.metaKey || e.ctrlKey || e.altKey || !Lampa.Player.opened()) return;
            if (e.target && /^(input|textarea)$/i.test(e.target.tagName)) return;
            var doc = document, full = doc.fullscreenElement || doc.webkitFullscreenElement, el = doc.documentElement;
            e.preventDefault();
            e.stopPropagation();
            if (full) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
            else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        }, true);
        // C = subtitles on/off (as F is fullscreen)
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'c' && e.key !== 'C' || e.metaKey || e.ctrlKey || e.altKey || !Lampa.Player.opened()) return;
            if (e.target && /^(input|textarea)$/i.test(e.target.tagName)) return;
            e.preventDefault();
            e.stopPropagation();
            toggleSubs();
        }, true);
        // Left/Right seek as in every web player. Lampa only seeks with them while its control bar is hidden,
        // and with a mouse the bar is up whenever the pointer moves. Not in menus opened from the player.
        var SEEKING = { player: 1, player_panel: 1, player_rewind: 1 };
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
            if (!Lampa.Player.opened() || e.target && /^(input|textarea)$/i.test(e.target.tagName)) return;
            if (!SEEKING[Lampa.Controller.enabled().name]) return;
            e.preventDefault();
            e.stopPropagation();
            seek(e.key === 'ArrowRight');
        }, true);
        // plain words (simplicity review 2026-10-20): "Further", "Minimize", "Expand", "Plain"…
        Lampa.Lang.add({
            torrent_error_next: { en: 'Next episode' },
            player_tracks: { en: 'Audio' },
            player_pip: { en: 'Picture in picture' },
            player_size_cover_title: { en: 'Full screen' },
            player_speed_default_title: { en: 'Normal' },
            player_segments_title: { en: 'Skip intro' },
            player_segments_descr: { en: 'Skip openings and recaps' }
        });
        // English unless the profile chose otherwise (Lampa's defaults, so Settings → Player still decides)
        Lampa.Params.defaults.subtitles_start = true;
        Lampa.Params.defaults.subtitles_lang = 'en';
        subLangsFirst();
        Lampa.Params.defaults.player_rewind = '10';
        seekWithoutPause();
        iphoneFullscreen();
        Lampa.PlayerVideo.listener.follow('subs', function (e) {
            var video = Lampa.PlayerVideo.video();
            if (video) video._rubySubsSeen = true;
            subsList = e.subs;
            autoSubs(e.subs);
        });
        Lampa.Player.listener.follow('ready', function () {
            mediaKeys();
            lateTracks();
            var panel = document.querySelector('.player-panel');
            if (!panel) return;
            relabelSubs(panel);
            plainWords(panel);
            airplayButton(panel);
            seekButtons(panel);
            qualityButton(panel);
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.Params || !Lampa.Controller || !window.rubyDesktop || !rubyDesktop.active || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 100);
})();
