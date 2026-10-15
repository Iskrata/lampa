// Desktop polish for Lampa (desktop/README.md). Loaded by index.html.
// Lampa is built for TVs: it sizes everything in em off one number (body font-size = window width / 84.17
// x 0.9/1/1.05 for Interface size small/normal/bigger, app.min.js function size()), lazily draws 7 cards
// per row (Line default items.view = 7), and binds the mouse wheel to "step along this row" / "jump a row".
// On computers (never on TVs, Lampa.Platform.tv()) this adds Settings -> Interface -> "Desktop look":
//   * density: a smaller factor, applied by stylesheet (beats Lampa's inline style, follows resizes)
//   * rows built as wide as the screen, the rest on the first sideways scroll (no wall, no freezes)
//   * Apple TV-style dark look: black-to-graphite canvas, system font, frosted header, soft poster lift
//   * wheel / trackpad scroll in real pixels: vertical moves the page, horizontal moves the row
(function () {
    var KEY = 'ruby_desktop_density';
    var FACTORS = { off: 0, comfortable: 0.8, compact: 0.68, dense: 0.58 };

    function factor() { return FACTORS[Lampa.Storage.get(KEY, 'compact')] || 0; }

    // Apple TV app dark palette: #000 canvas, #1c1c1e/#2c2c2e system grays, label/secondary-label greys.
    var CSS = [
        ':root{--rb-bg:#000;--rb-bg2:#1c1c1e;--rb-fill:rgba(118,118,128,.24);--rb-text:#fff;--rb-text2:rgba(235,235,245,.6);--rb-text3:rgba(235,235,245,.3)}',
        'body{background:var(--rb-bg);color:var(--rb-text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}',
        // header: no TV clock/date or status markers (its glass look and the colour orbs: glass.js)
        '.head__time,.head__markers{display:none!important}',
        '.head__title{font-weight:600}',
        '.head__action{opacity:.75;transition:opacity .15s}.head__action:hover,.head__action.focus{opacity:1}',
        // rows
        '.items-line__title{font-weight:600;font-size:1.25em;letter-spacing:-.01em;color:var(--rb-text)}',
        '.items-line__more{background:var(--rb-fill)!important;color:var(--rb-text2);border-radius:2em}',
        '.items-line__more:hover,.items-line__more.focus{color:var(--rb-text);background:rgba(118,118,128,.4)!important}',
        // cards: rounded posters that lift with a soft shadow (no thick TV frame)
        // only the transform animates (on the compositor); the deeper shadow switches in one repaint - animating a
        // 2.4em box-shadow repainted the card every frame of every hover
        '.card__view{border-radius:.75em;overflow:hidden;transition:transform .22s cubic-bezier(.2,.8,.2,1);box-shadow:0 .2em .6em rgba(0,0,0,.35)}',
        '.card__img{border-radius:.75em}',
        '.card.focus .card__view::after,.card:hover .card__view::after{border:none!important;box-shadow:none!important;opacity:0!important}',
        '.card.focus .card__view,.card:hover .card__view{transform:translateY(-.35em) scale(1.04);box-shadow:0 1.2em 2.4em rgba(0,0,0,.7)}',
        '.card__title{font-size:.95em;font-weight:500;color:var(--rb-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.card__age{color:var(--rb-text3)}',
        '.card__vote{font-size:.8em;font-weight:600;background:rgba(0,0,0,.6);border-radius:.5em;padding:.15em .5em}',
        // title page buttons and chips: Apple pill buttons
        '.full-start__button,.full-start-new__buttons .button{border-radius:2em!important;background:var(--rb-fill)!important}',
        '.full-start__button.focus,.full-start__button:hover{background:#fff!important;color:#000!important}',
        // with a mouse, only the button under the cursor lights up: Lampa leaves "focus" on the last one hovered
        // (and on Watch at first), which showed two white buttons or one stuck white
        'body.mouse--controll .full-start__button.focus:not(:hover){background:var(--rb-fill)!important;color:inherit!important}',
        '.full-start__button{transition:background-color .15s,color .15s,transform .15s!important}',
        'body.mouse--controll .full-start__button:hover{transform:scale(1.04)}',
        '.full-start__rate,.full-start__pg,.full-start__status{border-radius:.4em}',
        // grid pages (category / New & Popular / My List): Lampa fixes 6 columns in % of the width, which makes
        // posters huge on a computer screen - follow the rows' density instead (~8 at 1440 px)
        '@media (min-width: 1000px){.mapping--grid.cols--6>*{width:calc(100% / 7)}}',
        '@media (min-width: 1300px){.mapping--grid.cols--6>*{width:12.5%}}',
        '@media (min-width: 1700px){.mapping--grid.cols--6>*{width:10%}}',
        // phones: ~3 posters across, in rows and on grid pages (a 12.75 em card at the 10.6 px floor fit 2.7)
        '@media (max-width: 600px){.items-line .card{width:10em}.mapping--grid.cols--6>*{width:calc(100% / 3)}.card__title{font-size:1.05em}}',
        // the page scrolls under the top bar (Netflix): Lampa's page scroller clips at the bar's bottom edge
        // and fades its top/bottom 8 % with a mask; the bar is transparent at the top and solid once
        // scrolled (nav.js), so neither is needed - and the Home billboard can sit under the bar (hero.js)
        // On touch devices (phones, iPads: Lampa's body.touch-device) Lampa scrolls pages natively (scrollTop), not
        // by transform, so the scroller must keep its overflow there - visible made pages unscrollable
        '.activity .scroll.layer--wheight:not(.scroll--horizontal){-webkit-mask-image:none!important;mask-image:none!important}',
        'body:not(.touch-device) .activity .scroll.layer--wheight:not(.scroll--horizontal){overflow:visible!important}',
        // loading: posters fade in once loaded (Lampa adds card--loaded) over a graphite placeholder - as an
        // animation, never by hiding: cards Lampa doesn't mark (the Trakt plugin's episode cards) stay visible; rows
        // rise in as they arrive, and the TV header stays hidden until nav.js has replaced it
        '.card__view{background:#1c1c1e}',
        // a card still waiting for its poster (Lampa shows img/img_load.svg until then): a shimmering
        // skeleton instead of Lampa's grey logo. Only waiting cards animate, so it costs nothing at rest.
        '.card__img[src*="img_load"]{opacity:0}',
        '.card__view:has(.card__img[src*="img_load"]){background:linear-gradient(100deg,#161618 30%,#25252a 50%,#161618 70%);background-size:300% 100%;animation:rb-shimmer 1.4s linear infinite}',
        '@keyframes rb-fade{from{opacity:0}to{opacity:1}}',
        '@keyframes rb-shimmer{from{background-position:100% 0}to{background-position:0 0}}',   // placeholders (hero.js, rowload.js)
        '.card--loaded .card__img{animation:rb-fade .35s ease}',
        '@keyframes rb-rise{from{opacity:0;transform:translateY(.8em)}to{opacity:1;transform:none}}',
        '.items-line{animation:rb-rise .45s cubic-bezier(.2,.8,.2,1) both}',
        'body:not(.ruby-nav-ready) .head{opacity:0}',
        '.head{transition:opacity .3s}',
        // Lampa's own blurred backdrop (blurred in JS on a canvas on every focus change): the colour light
        // of glass.js replaces it, so it is switched off on computers (lighten() below)
        '.background{display:none!important}',
        // skip rendering what isn't on screen (the DOM stays: Lampa's navigation and scroll state rely on it):
        //  * pages left behind - Lampa only fades them to opacity 0, so Home (~700 nodes) kept being styled,
        //    laid out and painted under every title page
        //  * rows far above/below the view (content-visibility:auto; 'auto' remembers each row's real height
        //    once drawn, so scroll offsets don't jump). Not on cards: its paint containment would clip the
        //    hover lift and shadow.
        '.activity:not(.activity--active){content-visibility:hidden}',
        '.items-line{content-visibility:auto;contain-intrinsic-size:auto 22em}',
        // menus / settings panels: graphite sheets
        '.menu,.settings__content,.selectbox__content{background:rgba(28,28,30,.92)!important;-webkit-backdrop-filter:blur(30px);backdrop-filter:blur(30px)}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = 'ruby-desktop';

    function apply() {
        var f = factor();
        // touch devices (Lampa's body.true--mobile: phones, iPads) keep Lampa's own floor of 10.6 px (app.min.js
        // size()): its player, settings and keyboard are laid out for it, and at 8 px a phone showed 7.6 px titles
        var size = 'calc(100vw / 84.17 * ' + f + ')';
        style.textContent = f ? CSS + '\nbody{font-size:max(' + size + ', 8px)!important}' +
            '\nbody.true--mobile{font-size:max(' + size + ', 10.6px)!important}' : '';
        if (!style.parentNode) document.head.appendChild(style);
    }

    // Rows draw `items.view` cards up front (Lampa default 7) and the rest the first time the row is scrolled
    // sideways (Items onScroll: on computers it then builds all remaining ones). 7 leaves the right half of a
    // wide screen empty, so a row is built as wide as the screen plus two; the rest comes when you start
    // scrolling that row (wheelScrolls calls the row's onScroll first, so there is no wall at the 11th card).
    // Building whole rows (20+ cards each) up front froze Safari for 60-95 ms every time Lampa appended a row
    // while scrolling down - measured in real Safari 2026-10-13 (one freeze per row, ~3 per second).
    function screenRows() {
        var extend = Lampa.Arrays.extend;
        Lampa.Arrays.extend = function (target) {
            var r = extend.apply(this, arguments);
            var items = target && target.items;
            if (factor() && items && items.mapping === 'line' && items.view && items.view < screenful()) items.view = screenful();
            return r;
        };
    }
    function screenful() {
        var em = parseFloat(getComputedStyle(document.body).fontSize) || 12;
        return Math.ceil(window.innerWidth / (em * 12)) + 2;   // a card is ~12.75 em wide plus its gap
    }
    // Lampa's lazy loader, Layer.visible(container), runs synchronously every time a row is added: it
    // gathers every .layer--visible element under the container, reads each one's getBoundingClientRect
    // (forcing layout), hides those more than 2 screens away and triggers 'visible' on the rest so they
    // load their poster. Measured in real Safari 2026-10-13: 93 calls = 1.3 s while scrolling Home for 16 s,
    // up to 29 ms each, plus 0.7 s in the events it fires - the hitch on every new row. On computers an
    // IntersectionObserver does the same job off the main path: each element gets Lampa's own 'visible'
    // event once it comes within about two screens of the view. Far-away content is already skipped by
    // content-visibility, so nothing is hidden by hand.
    function lazyVisible() {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                var el = en.target;
                io.unobserve(el);
                if (el.style.visibility === 'hidden') el.style.visibility = '';
                if (!el.called_visible) { el.called_visible = true; el.visible = true; Lampa.Utils.trigger(el, 'visible'); }
            });
        }, { rootMargin: '200% 100%' });   // like Lampa's own: start ~2 screens ahead so posters are decoded before they show
        var waiting = [];
        watchVisible = function (root) {
            if (!root || !root.querySelectorAll) return;
            var list = [].slice.call(root.querySelectorAll('.layer--visible'));
            if (root.classList && root.classList.contains('layer--visible')) list.push(root);
            list.forEach(function (el) { if (!el.called_visible && !el._rubyIo) { el._rubyIo = true; io.observe(el); waiting.push(el); } });
        };
        // safety net: once a second, anything watched that is on screen but still waiting gets its event
        // (only the still-waiting elements are measured, so this stays cheap)
        setInterval(function () {
            if (document.hidden || !waiting.length) return;
            waiting = waiting.filter(function (el) { return !el.called_visible && document.body.contains(el); });
            waiting.forEach(function (el) {
                var r = el.getBoundingClientRect();
                if (r.width && r.bottom > -window.innerHeight && r.top < window.innerHeight * 2 && r.right > 0 && r.left < window.innerWidth) {
                    io.unobserve(el);
                    if (el.style.visibility === 'hidden') el.style.visibility = '';
                    el.called_visible = true; el.visible = true; Lampa.Utils.trigger(el, 'visible');
                }
            });
        }, 1000);
        var visible = Lampa.Layer.visible;
        Lampa.Layer.visible = function (combine) {
            if (!factor() || !combine) return visible.apply(this, arguments);
            watchVisible(combine.jquery ? combine[0] : combine);
        };
    }
    // Some rows (the Trakt plugin's, ContentRows like "Picked for you") put their cards in the page after
    // calling Layer.visible; Lampa's own scan found them on a later whole-page pass, so every element that
    // arrives is watched as it is added (asyncImages' observer) - without this their posters never loaded
    var watchVisible = function () {};

    // The posters Lampa adds: decoded off the main thread, and unloaded when far away. Every <img> stays
    // decoded while it is in the page, and Lampa never removes rows: a few minutes of scrolling held
    // ~550 MB of decoded posters in Safari and scrolling got slower and slower. A poster more than ~5
    // screens from the view swaps its image for an empty placeholder; coming back puts it back (from the
    // HTTP cache, no new download).
    var BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    function asyncImages() {
        var far = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                var img = en.target, src = img.getAttribute('src') || '';
                if (en.isIntersecting) {
                    // put it back only if the slot is still empty: Lampa may have set a newer image since
                    // (its loading logo first, the real poster on 'visible') - restoring then showed the logo
                    if (img._rubySrc && src === BLANK) img.src = img._rubySrc;
                    img._rubySrc = null;
                } else if (/^https?:\/\//.test(src) && src.indexOf('/t/p/') > 0 && img.complete) {   // TMDB posters only
                    img._rubySrc = src;
                    img.src = BLANK;
                }
            });
        }, { rootMargin: '500% 150%' });
        function added(n) {
            if (n.tagName === 'IMG') return take(n);
            if (!n.querySelectorAll) return;
            [].forEach.call(n.querySelectorAll('img'), take);
            if (n.classList.contains('layer--visible') || n.querySelector('.layer--visible')) watchVisible(n);
        }
        function take(img) {
            img.decoding = 'async';
            if (img.classList.contains('card__img') && !img._rubyFar) { img._rubyFar = true; far.observe(img); }
        }
        new MutationObserver(function (ms) {
            ms.forEach(function (m) {
                [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) added(n); });
            });
        }).observe(document.body, { childList: true, subtree: true });
    }

    // Lampa's own wheel handler (Scroll in app.min.js) reads the legacy e.wheelDelta, throttles to one step
    // per 200 ms, over a row steps the focus card by card, and Home's page scroller is scroll_by_item: each
    // wheel() call jumps a whole row whatever the size. So drive the scrollers directly through
    // element.Scroll.wheel(px) with scroll_by_item switched off for that call (Scroll.params() returns the
    // live params object). A trackpad fires ~60 events/s and Lampa animates every scroll with a CSS
    // transition, lazy-loading only when it ends: sum deltas per frame and shorten the transition to 90 ms
    // while the wheel moves (restored 250 ms after the last event) - short transitions still end.
    function wheelScrolls() {
        var pending = new Map(), frame = 0;
        function scrollBy(target, px) {
            var body = target.querySelector(':scope > .scroll__content > .scroll__body');
            if (body) {
                body.style.transitionDuration = '90ms';
                clearTimeout(body._rubyIdle);
                body._rubyIdle = setTimeout(function () { body.style.transitionDuration = ''; }, 250);
            }
            var p = target.Scroll.params(), was = p.scroll_by_item;
            p.scroll_by_item = false;
            try { target.Scroll.wheel(px); } finally { p.scroll_by_item = was; }
        }
        function flush() {
            frame = 0;
            pending.forEach(function (px, target) { scrollBy(target, px); });
            pending.clear();
        }
        document.addEventListener('wheel', function (e) {
            if (!factor() || !e.target.closest) return;
            var px = function (d) { return e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * window.innerHeight : d; };
            var vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
            var row = e.target.closest('.scroll--horizontal');
            var target = vertical
                ? (row ? row.parentElement : e.target).closest('.scroll:not(.scroll--horizontal)')
                : row;
            if (!target || !target.Scroll || !target.Scroll.params) return;
            e.stopImmediatePropagation();
            e.preventDefault();
            // first sideways scroll of a row: let Lampa build its remaining cards (screenRows)
            if (!vertical && !target._rubyBuilt && typeof target.Scroll.onScroll === 'function') { target._rubyBuilt = true; target.Scroll.onScroll(); }
            pending.set(target, (pending.get(target) || 0) + px(vertical ? e.deltaY : e.deltaX));
            if (!frame) frame = requestAnimationFrame(flush);
        }, { capture: true, passive: false });
    }

    // "Settled" = Lampa has drawn its first rows and the page has gone quiet (rows + 1.5 s + an idle
    // moment; the load event alone comes ~3 s before Lampa's first rows). Heavy extras wait for it - mainly
    // the YouTube player (1.8 MB of script, ~80 ms of main-thread work to start, and in Safari it runs on
    // the page's own thread), which otherwise competed with Lampa's own start-up.
    var settledCbs = [], isSettled = false;
    function settle() { if (isSettled) return; isSettled = true; settledCbs.splice(0).forEach(function (f) { f(); }); }
    (function () {
        var idle = window.requestIdleCallback || function (f) { setTimeout(f, 0); };
        var tries = 0, t = setInterval(function () {
            if (!document.querySelector('.activity--active .items-line, .activity--active .full-start-new') && ++tries < 100) return;
            clearInterval(t);
            setTimeout(function () { idle(settle, { timeout: 3000 }); }, 1500);
        }, 150);
    })();

    var logos = {}, DETAILS = 'ruby_tmdb_cache_v1', details = {};
    try { details = JSON.parse(sessionStorage.getItem(DETAILS) || '{}'); } catch (e) {}
    function keep() { try { sessionStorage.setItem(DETAILS, JSON.stringify(details)); } catch (e) {} }

    // Lampa asks TMDB for w200/w300 posters and w1280 backdrops (Settings "poster quality" tops out at w500).
    // On computers: posters/stills at w342 at least (a card is ~150 px wide = ~300 device px on Retina;
    // w500 doubled the decoded memory - measured ~550 MB of posters after a few minutes of scrolling in
    // Safari, with freezes growing to 150+ ms - and w780 was ~4x the pixels) and every
    // w1280+ image at the original file (backdrops up to 3840x2160). Lampa.TMDB is the object app.min.js
    // calls itself (var TMDB$1 = {api, key, image, broken}; exported as TMDB), so wrapping image() covers all.
    function sharpImages() {
        var image = Lampa.TMDB.image;
        Lampa.TMDB.image = function (path) {
            if (factor() && typeof path === 'string') {
                path = path.replace(/t\/p\/w(\d+)\//, function (m, w) {
                    return +w >= 1280 ? 't/p/original/' : +w < 342 ? 't/p/w342/' : m;
                });
            }
            return image.apply(this, [path].concat([].slice.call(arguments, 1)));
        };
    }

    // Lampa's "Background" setting blurs the focused title's image in JavaScript on every focus change;
    // it is invisible under glass.js's colour light, so turn it off on computers (Settings -> Interface ->
    // Background shows it). The header is shown after 4 s even if nav.js never takes it over.
    function lighten() {
        if (Lampa.Storage.field('background')) Lampa.Storage.set('background', false);
        setTimeout(function () { document.body.classList.add('ruby-nav-ready'); }, 4000);
    }

    function start() {
        // shared by hero.js / glass.js / more.js
        window.rubyDesktop = {
            // active on computers with Desktop look on
            active: function () { return !Lampa.Platform.tv() && !!factor(); },
            // TMDB GET through Lampa's own helpers (honours its TMDB proxy setting), in the catalogue language
            tmdb: function (path, done) {
                var sep = path.indexOf('?') < 0 ? '?' : '&';
                fetch(Lampa.TMDB.api(path + sep + 'api_key=' + Lampa.TMDB.key() + '&language=' + Lampa.Storage.get('tmdb_lang', 'en')))
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(done).catch(function () { done(null); });
            },
            // 'movie' | 'tv' for a TMDB result or a Lampa card_data (shows carry name/first_air_date)
            kind: function (item) { return item.media_type || (item.first_air_date || (item.name && !item.release_date) ? 'tv' : 'movie'); },
            // a card shaped the way Lampa's full/torrents components expect (shows get title/release_date too)
            card: function (item) {
                var c = Object.assign({}, item);
                if (rubyDesktop.kind(item) === 'tv') { c.title = c.title || item.name; c.original_title = c.original_title || item.original_name; c.release_date = c.release_date || item.first_air_date; }
                return c;
            },
            // the active page's own (vertical) scroller, its .scroll element
            page: function () { return document.querySelector('.activity--active .scroll:not(.scroll--horizontal)'); },
            // a touch device (Lampa's body.touch-device: phones, iPads): no hover, and Lampa scrolls pages natively
            // (scrollTop) there; elsewhere it moves the scroll body with a transform
            touch: function () { return document.body.classList.contains('touch-device'); },
            // vertical offset (px, <= 0) of the active page's own scroller; the transform is parsed by hand
            // because DOMMatrix('none') is not accepted everywhere
            pageY: function () {
                var page = rubyDesktop.page();
                if (rubyDesktop.touch()) return page ? -page.scrollTop : 0;
                var b = page && page.querySelector(':scope > .scroll__content > .scroll__body');
                var t = b ? getComputedStyle(b).transform : 'none', m = t && t.match(/^matrix(3d)?\((.+)\)$/);
                if (!m) return 0;
                var v = m[2].split(',').map(parseFloat);
                return (m[1] ? v[13] : v[5]) || 0;
            },
            // the title's logo (transparent PNG, English or language-less) from TMDB /images, or null; cached
            logo: function (item, done) {
                var k = rubyDesktop.kind(item) + item.id;
                if (k in logos) return done(logos[k]);
                rubyDesktop.tmdb(rubyDesktop.kind(item) + '/' + item.id + '/images?include_image_language=en,null', function (j) {
                    var l = j && j.logos && j.logos.filter(function (x) { return x.file_path.slice(-4) === '.png'; })[0];
                    logos[k] = l ? Lampa.TMDB.image('t/p/original' + l.file_path) : null;
                    done(logos[k]);
                });
            },
            // [{kind:'movie'|'tv', id:tmdbId}] -> TMDB result objects (media_type set), poster-less ones dropped;
            // cached for the browser session
            details: function (refs, done) {
                var out = new Array(refs.length), left = refs.length;
                if (!left) return done([]);
                refs.forEach(function (ref, i) {
                    var k = ref.kind + ref.id;
                    var finish = function (d) {
                        out[i] = d && d.poster_path ? Object.assign(d, { media_type: ref.kind, source: 'tmdb' }) : null;
                        if (--left === 0) { keep(); done(out.filter(Boolean)); }
                    };
                    if (details[k]) return finish(Object.assign({}, details[k]));
                    rubyDesktop.tmdb(ref.kind + '/' + ref.id, function (d) {
                        if (d && d.id) {
                            details[k] = { id: d.id, title: d.title, name: d.name, original_title: d.original_title, original_name: d.original_name,
                                poster_path: d.poster_path, backdrop_path: d.backdrop_path, overview: d.overview, vote_average: d.vote_average,
                                release_date: d.release_date, first_air_date: d.first_air_date, original_language: d.original_language,
                                genre_ids: (d.genres || []).map(function (g) { return g.id; }) };
                            finish(Object.assign({}, details[k]));
                        } else finish(null);
                    });
                });
            },
            // settled(cb): run cb once the page has settled (now, if it has); settled(): has it?
            settled: function (cb) { if (!cb) return isSettled; if (isSettled) cb(); else settledCbs.push(cb); },
            openFull: function (item) {
                Lampa.Activity.push({ url: '', component: 'full', id: item.id, method: rubyDesktop.kind(item), card: rubyDesktop.card(item), source: 'tmdb' });
            }
        };
        if (Lampa.Platform.tv()) return;
        Lampa.SettingsApi.addParam({
            component: 'interface',
            param: {
                name: KEY, type: 'select', default: 'compact',
                values: { off: 'Off (TV look)', comfortable: 'Comfortable', compact: 'Compact', dense: 'Dense' }
            },
            field: { name: 'Desktop look', description: 'Smaller, Apple TV-style interface on computers' },
            onChange: apply
        });
        screenRows();
        lazyVisible();
        asyncImages();
        sharpImages();
        if (factor()) lighten();
        wheelScrolls();
        apply();
    }

    // app.min.js is loaded asynchronously by Lampa's own loader; patch Arrays before the first rows exist.
    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Platform || !Lampa.SettingsApi || !Lampa.Storage || !Lampa.Arrays || !Lampa.TMDB || !Lampa.Layer || !Lampa.Utils) return;
        clearInterval(t);
        start();
    }, 50);
})();
