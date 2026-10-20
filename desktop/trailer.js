// Background trailer player for Lampa on computers (desktop/README.md). Loaded by index.html.
// One player, used in two places (Settings -> Interface -> "Trailers"):
//   * the Home billboard (hero.js)
//   * the hero at the top of an opened movie/series page (title.js)
// rubyTrailer.attach(host, {visible, onEnded, quiet}) -> {show(item), stop(), busy(), current(), loud(), muteButton}.
// A trailer loads as soon as the title is shown and fades in after a few seconds of playback, once
// YouTube's own pause button has auto-hidden and the sound question is settled (no black frame, no badge).
// Sound is off by default; the speaker button (or Settings -> Interface -> "Trailer sound") turns it on and
// that choice is remembered (user's call 2026-10-14: trailers kept starting loud). Browsers only
// allow audible autoplay after the user has interacted with the page (Safari: per-site "Auto-Play: Allow
// All Auto-Play"), so a trailer always starts muted; unmute is tried only once the page has had a user
// gesture (navigator.userActivation). If the browser still refuses (YouTube pauses right after unMute) the
// trailer goes back to muted and plays on, and no further attempts are made until the next click/keypress.
// Trailers not in English get English subtitles when YouTube has them (cc_load_policy / cc_lang_pref).
// Removed as soon as its place leaves the view (page scrolled, another tab, the player open, page left).
// YouTube refuses embeds that send no referrer (onError 153) and Lampa's index.html sets
// <meta name="referrer" content="never">, so the iframe alone gets strict-origin-when-cross-origin.
(function () {
    var KEY = 'ruby_hero_trailers', SOUND = 'ruby_trailer_sound', DELAY_MS = 100, VOLUME = 70;
    // YouTube draws its own pause button over the first seconds of every embed (also with controls=0) and
    // after any pause, then auto-hides it - also when the player was loaded paused first (measured
    // 2026-10-13: there at 2.8 s, fading at 3.9 s; 3.6 s still showed it faintly), so the picture fades in (0.8 s) from
    // CONTROLS_S seconds of playback; the backdrop shows until then. title.js hides this wait by starting
    // a title's trailer silently while its poster is hovered (attach opts.quiet).
    var CONTROLS_S = 4, SETTLE_MS = 700;
    var videos = {}, blocked = false;

    var CSS = [
        '.ruby-trailer{position:absolute;inset:0;opacity:0;transition:opacity .8s ease;pointer-events:none;overflow:hidden;z-index:1}',
        '.ruby-trailer.show{opacity:1}',
        '.ruby-trailer iframe{position:absolute;top:50%;left:50%;width:max(100%,177.78vh);height:max(100%,56.25vw);transform:translate(-50%,-50%) scale(1.18);border:0}',
        // with subtitles: no extra zoom and the video's bottom edge kept in the frame, so captions stay visible
        '.ruby-trailer--cc iframe{top:auto;bottom:0;transform:translateX(-50%)}',
        '.ruby-trailer__mute{position:absolute;z-index:6;width:2.7em;height:2.7em;border-radius:50%;display:none;align-items:center;justify-content:center;cursor:pointer;color:#fff;' +
            'background:rgba(20,20,20,.35);border:1.5px solid rgba(255,255,255,.7);pointer-events:auto;transition:background .15s}',
        '.ruby-trailer__mute:hover{background:rgba(255,255,255,.18)}',
        '.ruby-trailer__mute .ruby-icon{font-size:1.35em}',
        '.ruby-trailer__mute.on{display:flex}'
    ].join('\n');

    function on() { return rubyDesktop.active() && Lampa.Storage.get(KEY, 'true') + '' !== 'false'; }
    function soundOn() { return Lampa.Storage.get(SOUND, 'false') + '' === 'true'; }
    function hadGesture() { return !navigator.userActivation || navigator.userActivation.hasBeenActive; }

    // best YouTube trailer: official Trailer > Trailer > official Teaser > Teaser, preferring English, from
    // English, the title's own language or none (TMDB filters /videos by &language unless
    // include_video_language is given). -> {key, lang} or null
    function video(item, done) {
        var kind = rubyDesktop.kind(item), k = kind + item.id;
        if (k in videos) return done(videos[k]);
        var langs = ['en', item.original_language, 'null'].filter(Boolean).join(',');
        rubyDesktop.tmdb(kind + '/' + item.id + '/videos?include_video_language=' + langs, function (j) {
            var v = ((j && j.results) || []).filter(function (x) { return x.site === 'YouTube' && (x.type === 'Trailer' || x.type === 'Teaser'); });
            var rank = function (x) { return (x.type === 'Trailer' ? 4 : 2) + (x.official ? 1 : 0) + (x.iso_639_1 === 'en' ? 0.5 : 0); };
            v.sort(function (a, b) { return rank(b) - rank(a); });
            // language-less videos of a non-English title are almost always in the original language
            videos[k] = v.length ? { key: v[0].key, lang: v[0].iso_639_1 && v[0].iso_639_1 !== 'xx' ? v[0].iso_639_1 : item.original_language || 'en' } : null;
            done(videos[k]);
        });
    }

    function attach(host, opts) {
        var layer = document.createElement('div'), mute = document.createElement('div');
        layer.className = 'ruby-trailer';
        mute.className = 'ruby-trailer__mute';
        mute.title = 'Sound';
        host.appendChild(layer);
        host.appendChild(mute);
        var frame = null, timer = 0, playing = false, muted = true, current = null, unmutedAt = 0, revealAt = CONTROLS_S;
        // never under the loading screen (facts.js): once Play is pressed the trailer goes
        var visible = function () { return !document.body.classList.contains('ruby-facts-on') && opts.visible(); };

        function yt(func, args) {
            if (frame && frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*');
        }
        function setMute(m) {
            muted = m;
            yt(m ? 'mute' : 'unMute');
            // quiet = playing ahead of time, unseen (title.js): unmuted, so sound is ready, but at volume 0
            if (!m) yt('setVolume', [opts.quiet && opts.quiet() ? 0 : VOLUME]);
            mute.innerHTML = rubyIcons.svg(m ? 'soundOff' : 'soundOn');
        }
        function reveal() { layer.classList.add('show'); mute.classList.add('on'); }
        function stop() {
            clearTimeout(timer);
            playing = false;
            revealAt = CONTROLS_S;
            current = null;
            mute.classList.remove('on');
            layer.classList.remove('show');
            if (frame) { var f = frame; frame = null; setTimeout(function () { f.remove(); }, 1000); }
        }
        function play(item) {
            if (!on() || !visible()) return;
            video(item, function (v) {
                if (!v || current !== item || !visible()) return;
                var cc = v.lang !== 'en';
                frame = document.createElement('iframe');
                frame.allow = 'autoplay; encrypted-media';
                frame.referrerPolicy = 'strict-origin-when-cross-origin';
                frame.src = 'https://www.youtube-nocookie.com/embed/' + v.key + '?autoplay=1&mute=1&controls=0&disablekb=1&fs=0' +
                    '&iv_load_policy=3&modestbranding=1&playsinline=1&rel=0&enablejsapi=1&hl=en' +
                    (cc ? '&cc_load_policy=1&cc_lang_pref=en' : '') + '&origin=' + encodeURIComponent(location.origin);
                frame.onload = function () { if (frame) frame.contentWindow.postMessage(JSON.stringify({ event: 'listening' }), '*'); };
                layer.classList.toggle('ruby-trailer--cc', cc);
                layer.innerHTML = '';
                layer.appendChild(frame);
                setMute(true);
            });
        }
        function show(item) {
            stop();
            current = item;
            timer = setTimeout(function () { play(item); }, DELAY_MS);
        }
        window.addEventListener('message', function (e) {
            if (!frame || e.source !== frame.contentWindow || typeof e.data !== 'string') return;
            var d; try { d = JSON.parse(e.data); } catch (x) { return; }
            var st = d.event === 'onStateChange' ? d.info : d.info && d.info.playerState;
            if (st === 1 && !playing) {
                playing = true;
                if (layer.classList.contains('ruby-trailer--cc')) yt('setOption', ['captions', 'track', { languageCode: 'en' }]);
                // unmute now, while the picture is still hidden: a refusal (and its pause) stays unseen
                if (soundOn() && !blocked && hadGesture()) { unmutedAt = Date.now(); setMute(false); }
            }
            // the browser refused audible playback (it pauses right after unMute): muted again, play on, and
            // wait for YouTube's pause button to auto-hide again
            if (st === 2 && !muted && Date.now() - unmutedAt < 1500) {
                blocked = true;
                setMute(true);
                yt('playVideo');
                playing = false;
                revealAt = (d.info && d.info.currentTime || 0) + CONTROLS_S;
            }
            var time = d.info && d.info.currentTime;
            if (playing && time >= revealAt && Date.now() - unmutedAt >= SETTLE_MS && !layer.classList.contains('show')) reveal();
            if (st === 0) { stop(); if (opts.onEnded) opts.onEnded(); }
            if (d.event === 'onError' && current) { videos[rubyDesktop.kind(current) + current.id] = null; stop(); }
        });
        // the speaker button is also the remembered preference (a click is a user gesture: unmute is allowed)
        mute.addEventListener('click', function (e) {
            e.stopPropagation();
            blocked = false;
            setMute(!muted);
            Lampa.Storage.set(SOUND, !muted);
        });
        var watch = setInterval(function () {
            if (!document.body.contains(host)) { clearInterval(watch); stop(); return; }
            if ((frame || timer) && !visible()) stop();
        }, 400);
        // the speaker button may be moved elsewhere (title.js puts it above the page content)
        return {
            show: show, stop: stop, busy: function () { return !!frame; }, muteButton: mute,
            current: function () { return current; },
            loud: function () { if (!muted) yt('setVolume', [VOLUME]); }   // leave quiet mode
        };
    }

    function start() {
        var style = document.createElement('style');
        style.id = 'ruby-trailer';
        style.textContent = CSS;
        document.head.appendChild(style);
        window.rubyTrailer = { attach: attach, video: video };
        if (Lampa.Platform.tv()) return;
        // open the connections a trailer needs before the first one is asked for (~0.3-0.5 s per host)
        ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://i.ytimg.com', 'https://www.google.com'].forEach(function (h) {
            var l = document.createElement('link');
            l.rel = 'preconnect'; l.href = h; l.crossOrigin = '';
            document.head.appendChild(l);
        });
        // a new user gesture may lift the browser's audible-autoplay block
        // once: everyone starts muted under the new default; the speaker button's choice sticks from then on
        if (!Lampa.Storage.get('ruby_sound_default_off')) { Lampa.Storage.set(SOUND, false); Lampa.Storage.set('ruby_sound_default_off', true); }
        ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { blocked = false; }, true); });
        Lampa.SettingsApi.addParam({
            component: 'interface',
            param: { name: KEY, type: 'trigger', default: true },
            field: { name: 'Trailers', description: 'Play trailers in the Home billboard and at the top of title pages' }
        });
        Lampa.SettingsApi.addParam({
            component: 'interface',
            param: { name: SOUND, type: 'trigger', default: false },
            field: { name: 'Trailer sound', description: 'Trailers play with sound when the browser allows it' }
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Player || !Lampa.SettingsApi || !window.rubyDesktop || !rubyDesktop.pageY || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 100);
})();
