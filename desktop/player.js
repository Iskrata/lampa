// The player's control bar (desktop/README.md, "Player"):
//   * Subtitles: Lampa's button is a speech-bubble icon that only appears once a stream reports subtitle
//     tracks (with server/remux: the file's English subtitles). It becomes a labelled "CC" button.
//   * AirPlay: a button next to picture-in-picture, in Safari when an AirPlay screen is around
//     (WebKitPlaybackTargetAvailabilityEvent). It hands the stream to an Apple TV: torrents play as HLS
//     from the server (server/remux), which the Apple TV fetches itself.
// Active only where desktop.js is.
(function () {
    var CSS = [
        '.player-panel__subs svg,.player-panel__airplay svg{width:1.6em;height:1.6em}',
        '.player-panel__subs .ruby-cc-label{margin-left:.35em;font-size:.85em;font-weight:600;letter-spacing:.02em}',
        '.player-panel__subs{display:flex;align-items:center;width:auto!important;padding:0 .6em}',
        '.player-panel__airplay.hide{display:none!important}'
    ].join('\n');

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
            // Lampa turns a click on a .selector into hover:enter, so both can arrive for one press
            var last = 0, pick = function () {
                var v = Lampa.PlayerVideo.video();
                if (Date.now() - last < 500 || !v || !v.webkitShowPlaybackTargetPicker) return;
                last = Date.now();
                v.webkitShowPlaybackTargetPicker();
            };
            btn.addEventListener('hover:enter', pick);    // remote / keyboard
            btn.addEventListener('click', pick);
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
        Lampa.Player.listener.follow('ready', function () {
            var panel = document.querySelector('.player-panel');
            if (!panel) return;
            relabelSubs(panel);
            airplayButton(panel);
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo || !window.rubyDesktop || !rubyDesktop.active || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 100);
})();
