// The player's control bar (desktop/README.md, "Player"):
//   * Subtitles: Lampa's button is a speech-bubble icon that only appears once a stream reports subtitle
//     tracks (with server/remux: the file's English subtitles). It becomes a labelled "CC" button.
//     Safari only gets them since app.min.js keeps the HLS master when it lists subtitles (README "Changes to
//     Lampa itself"). English subtitles are on by default.
//   * F toggles fullscreen. Left/Right seek even while the control bar is up (Lampa moves between its buttons
//     then), media keys seek too, and the bar has back/forward buttons beside play/pause.
//   * AirPlay: a button next to picture-in-picture, in Safari when an AirPlay screen is around
//     (WebKitPlaybackTargetAvailabilityEvent). It hands the stream to an Apple TV: torrents play as HLS
//     from the server (server/remux), which the Apple TV fetches itself.
// Active only where desktop.js is.
(function () {
    var CSS = [
        '.player-panel__subs svg,.player-panel__airplay svg{width:1.6em;height:1.6em}',
        '.player-panel__subs .ruby-cc-label{margin-left:.35em;font-size:.85em;font-weight:600;letter-spacing:.02em}',
        '.player-panel__subs{display:flex;align-items:center;width:auto!important;padding:0 .6em}',
        '.player-panel__airplay.hide{display:none!important}',
        '.player-panel__center{display:flex;align-items:center;justify-content:center;gap:.4em}',
        '.player-panel .ruby-seek{position:relative;display:flex;align-items:center;justify-content:center;width:4.2em;height:4.2em;padding:0}',
        '.player-panel .button.ruby-seek svg{width:2.9em!important;height:2.9em!important}',
        '.ruby-seek__n{position:absolute;font-size:1.05em;font-weight:700;top:55%;left:50%;transform:translate(-50%,-50%)}'
    ].join('\n');

    // Lampa's seek step (Settings → Player → Rewind), with its own build-up on repeated presses
    function seek(forward) {
        if (Lampa.PlayerIPTV && Lampa.PlayerIPTV.playning && Lampa.PlayerIPTV.playning()) return;
        Lampa.PlayerVideo.rewind(forward);
    }

    // Lampa turns a click on a .selector into hover:enter, so both can arrive for one press
    function onPress(btn, fn) {
        var last = 0, go = function () {
            if (Date.now() - last < 500) return;
            last = Date.now();
            fn();
        };
        btn.addEventListener('hover:enter', go);    // remote / keyboard
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

    function isEnglish(s) {
        return /^en/i.test(s.language || s.lang || s.srclang || '') || /english/i.test(s.label || '');
    }

    // English subtitles on by default. Lampa only applies "subtitles on" to tracks the browser reports itself
    // (Safari); with hls.js (Chrome) it lists them and leaves them off, so pick one here for both.
    function autoSubs(subs) {
        if (!subs || !subs.length || !Lampa.Storage.field('subtitles_start')) return;
        for (var i = 0; i < subs.length; i++) if (subs[i].selected || subs[i].mode === 'showing') return;
        var want = Lampa.Storage.field('subtitles_lang'), pick = null;
        if (want === 'en' || want === 'auto') for (var k = 0; k < subs.length && !pick; k++) if (isEnglish(subs[k])) pick = subs[k];
        pick = pick || subs[0];
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
        // English unless the profile chose otherwise (Lampa's defaults, so Settings → Player still decides)
        Lampa.Params.defaults.subtitles_start = true;
        Lampa.Params.defaults.subtitles_lang = 'en';
        Lampa.PlayerVideo.listener.follow('subs', function (e) {
            var video = Lampa.PlayerVideo.video();
            if (video) video._rubySubsSeen = true;
            autoSubs(e.subs);
        });
        Lampa.Player.listener.follow('ready', function () {
            mediaKeys();
            lateTracks();
            var panel = document.querySelector('.player-panel');
            if (!panel) return;
            relabelSubs(panel);
            airplayButton(panel);
            seekButtons(panel);
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.Params || !Lampa.Controller || !window.rubyDesktop || !rubyDesktop.active || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 100);
})();
