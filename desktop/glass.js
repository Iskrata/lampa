// Ambient colour + liquid glass for Lampa on computers (desktop/README.md). Loaded by index.html.
// A web port of spotifast's album-art background (github.com/Iskrata/spotifast, src/ui/art_background.rs):
// five soft orbs, one per quarter of the hovered poster plus one for its average, each giving 25 % of its
// colour up to the average ("harmony"), resting at fixed homes (no drift, see CSS), capped at 70 % opacity so
// text reads over them, and fading to new colours in 0.6 s. Panels float over them as frosted glass.
// Active only where desktop.js is (window.rubyDesktop.active()); never on TVs.
(function () {
    var HARMONY = 0.25, MAX_OPACITY = 0.7;
    // homes as a share of the page, radii as a share of its longer side (same numbers as spotifast)
    var HOMES = [[0.18, 0.2], [0.82, 0.16], [0.28, 0.72], [0.8, 0.68], [0.52, 0.4]];
    var RADII = [0.42, 0.38, 0.4, 0.36, 0.3];

    var CSS = [
        // @property makes the orb colour a real <color>, so it can transition (Safari 16.4+, Chrome 85+)
        '@property --rb-orb{syntax:"<color>";inherits:false;initial-value:rgba(40,40,48,1)}',
        '.ruby-orbs{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:#000}',
        'body.ruby-noglow{background:#0d0d0f!important}',
        // no filter:blur / mix-blend-mode, and no drifting (spotifast's orbs wander; here 5 full-screen layers
        // animating forever kept the GPU busy even with nothing happening): plain gradients that only change
        // colour, over 0.6 s, when another poster is hovered
        '.ruby-orb{position:absolute;border-radius:50%;opacity:' + MAX_OPACITY + ';' +
            'background:radial-gradient(circle at center,var(--rb-orb) 0%,color-mix(in srgb,var(--rb-orb) 45%,transparent) 38%,transparent 70%);' +
            'transition:--rb-orb .6s ease}',
        // a gentle veil keeps white text readable over bright posters
        '.ruby-orbs::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(0,0,0,.15),rgba(0,0,0,.55) 75%)}',
        // Lampa's own blurred-backdrop canvases would fight the orbs: dim them to a hint
        '.background{opacity:.18!important}',
        '.wrap{position:relative;z-index:1}',
        // liquid glass: translucent fill, strong blur + saturation, hairline border, top highlight
        ':root{--rb-glass:rgba(38,38,44,.42);--rb-fill-solid:rgba(30,30,36,.72);--rb-glass-strong:rgba(28,28,32,.72);--rb-glass-edge:rgba(255,255,255,.14);' +
            '--rb-glass-shine:inset 0 1px 0 rgba(255,255,255,.18),inset 0 -1px 0 rgba(255,255,255,.04)}',
        '.head{background:var(--rb-glass)!important;-webkit-backdrop-filter:blur(28px) saturate(190%);backdrop-filter:blur(28px) saturate(190%);' +
            'border-bottom:1px solid var(--rb-glass-edge);box-shadow:var(--rb-glass-shine)}',
        // real blur (backdrop-filter) only on the few big surfaces; things that come by the dozen (rating
        // badges on every poster, chips, torrent rows) get a tinted fill - each backdrop-filter is re-rendered
        // whenever anything behind it moves, and with ~100 of them scrolling was laggy in Safari
        '.full-start__button,.ruby-hero__btn--info{' +
            'background:var(--rb-glass)!important;-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);' +
            'border:1px solid var(--rb-glass-edge)!important;box-shadow:var(--rb-glass-shine)}',
        '.items-line__more,.card__vote,.full-start__rate,.full-start__pg,.full-start__status,.simple-button,.torrent-filter .simple-button{' +
            'background:var(--rb-fill-solid)!important;border:1px solid var(--rb-glass-edge)!important;box-shadow:var(--rb-glass-shine)}',
        '.full-start__button.focus,.full-start__button:hover,.simple-button.focus,.simple-button:hover{background:rgba(255,255,255,.92)!important;color:#000!important}',
        '.torrent-item,.online,.files__item{background:var(--rb-fill-solid)!important;' +
            'border:1px solid var(--rb-glass-edge);box-shadow:var(--rb-glass-shine);border-radius:1em}',
        '.torrent-item.focus,.torrent-item:hover{background:rgba(255,255,255,.14)!important}',
        '.menu,.settings__content,.selectbox__content,.modal__content{background:var(--rb-glass-strong)!important;' +
            '-webkit-backdrop-filter:blur(40px) saturate(180%);backdrop-filter:blur(40px) saturate(180%);border-left:1px solid var(--rb-glass-edge)}'
    ].join('\n');

    var root, orbs = [], avgCache = {}, current = '', pending = 0;

    // Settings -> Interface -> "Colour light", off by default since 2026-10-13 (testing whether it is what
    // still makes Safari feel heavy): then the page is a plain Apple TV-style near-black and only the glass
    // panels remain
    var GLOW = 'ruby_glow';
    function glowOn() { return Lampa.Storage.get(GLOW, 'false') + '' === 'true'; }

    function build() {
        var style = document.createElement('style');
        style.id = 'ruby-glass';
        style.textContent = CSS;
        document.head.appendChild(style);
        if (!glowOn()) return document.body.classList.add('ruby-noglow');
        root = document.createElement('div');
        root.className = 'ruby-orbs';
        HOMES.forEach(function (h, i) {
            var o = document.createElement('div');
            o.className = 'ruby-orb';
            root.appendChild(o);
            orbs.push(o);
        });
        document.body.insertBefore(root, document.body.firstChild);
        layout();
        window.addEventListener('resize', layout);
    }

    function layout() {
        var side = Math.max(window.innerWidth, window.innerHeight);
        orbs.forEach(function (o, i) {
            var d = RADII[i] * side * 2;
            o.style.width = o.style.height = d + 'px';
            o.style.left = (HOMES[i][0] * window.innerWidth - d / 2) + 'px';
            o.style.top = (HOMES[i][1] * window.innerHeight - d / 2) + 'px';
        });
    }

    // Posters are mostly dark and their averages muddy: in HSL, boost saturation and keep lightness in a
    // mid band so each orb reads as a colour (checked on The Fix / Buddy: raw averages came out brown-grey).
    function lift(c) {
        var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min, h = 0, s = 0;
        if (d) {
            s = d / (1 - Math.abs(2 * l - 1));
            h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            h *= 60; if (h < 0) h += 360;
        }
        s = Math.min(1, s * 1.6 + 0.12);
        l = Math.min(0.56, Math.max(0.34, l));
        var C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = l - C / 2;
        var rgb = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
        return rgb.map(function (v) { return Math.round((v + m) * 255); });
    }

    // Quarter colours + average, by drawing the poster into a 2x2 and a 1x1 canvas. TMDB images send
    // Access-Control-Allow-Origin: *, so a crossOrigin load can be read back.
    // The poster is usually already in the HTTP cache from Lampa's own <img>, fetched without CORS; TMDB
    // sends ACAO * but no "Vary: Origin", so that cached copy fails a crossOrigin load. A query string
    // (ignored by TMDB's CDN) gives the CORS copy its own cache entry.
    function colours(src, done) {
        if (avgCache[src]) return done(avgCache[src]);
        var img = new Image(), url = src + (src.indexOf('?') < 0 ? '?' : '&') + 'cors=1';
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            try {
                var cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
                cv.width = cv.height = 2; cx.drawImage(img, 0, 0, 2, 2);
                var q = cx.getImageData(0, 0, 2, 2).data;
                cv.width = cv.height = 1; cx.drawImage(img, 0, 0, 1, 1);
                var a = cx.getImageData(0, 0, 1, 1).data;
                var avg = [a[0], a[1], a[2]], out = [];
                for (var i = 0; i < 4; i++) {
                    var c = [q[i * 4], q[i * 4 + 1], q[i * 4 + 2]];
                    out.push(lift(c.map(function (v, k) { return v * (1 - HARMONY) + avg[k] * HARMONY; })));
                }
                out.push(lift(avg));
                avgCache[src] = out;
                done(out);
            } catch (e) { done(null); }   // tainted canvas (image proxy without CORS): keep current colours
        };
        img.onerror = function () { done(null); };
        img.src = url;
    }

    function paint(src) {
        if (!src || src === current || !root) return;
        current = src;
        colours(src, function (cs) {
            if (!cs || current !== src) return;
            // quarters: top-left, top-right, bottom-left, bottom-right -> homes 0..3; average -> centre orb
            [0, 1, 2, 3, 4].forEach(function (i) {
                orbs[i].style.setProperty('--rb-orb', 'rgb(' + cs[i].join(',') + ')');
            });
        });
    }

    function posterOf(el) {
        var img = el && el.querySelector && el.querySelector('.card__img, .full-start-new__poster img, .full-start__poster img');
        return img && img.currentSrc || (img && img.src) || '';
    }

    function track() {
        // hovering or keyboard-focusing a card; debounce so sweeping the mouse across a row stays calm
        document.addEventListener('mouseover', function (e) {
            if (rubyDesktop.touch()) return;   // a tap's fake mouseover: the focus observer below covers it
            var card = e.target.closest && e.target.closest('.card');
            if (!card) return;
            clearTimeout(pending);
            pending = setTimeout(function () { paint(posterOf(card)); }, 120);
        }, true);
        new MutationObserver(function (ms) {
            ms.forEach(function (m) {
                var t = m.target;
                if (t.classList && t.classList.contains('card') && t.classList.contains('focus')) paint(posterOf(t));
            });
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
        // title page: its poster; Home billboard: its backdrop (hero.js sets the bg image)
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') setTimeout(function () { paint(posterOf(e.object.activity.render(true))); }, 300);
        });
    }

    function start() {
        if (!window.rubyDesktop || !rubyDesktop.active()) return;
        build();
        Lampa.SettingsApi.addParam({
            component: 'interface',
            param: { name: GLOW, type: 'trigger', default: false },
            field: { name: 'Colour light', description: 'The background takes the colours of the poster you point at (uses more graphics power)' },
            onChange: function () { location.reload(); }
        });
        if (!glowOn()) return;
        track();
        var first = document.querySelector('.card__img');
        if (first) paint(first.currentSrc || first.src);
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.SettingsApi || !Lampa.Storage || !window.rubyDesktop) return;
        clearInterval(t);
        start();
    }, 100);
})();
