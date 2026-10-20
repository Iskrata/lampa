// Movie/series page hero for Lampa on computers, Netflix/Apple TV style (desktop/README.md). Loaded by
// index.html. Lampa's title page is a TV layout: a small poster, the title, a dim backdrop behind it.
// Here the top of the page becomes a full-width hero: the backdrop (then the trailer, trailer.js)
// fills the screen up to under the top bar, the title's logo replaces the text title, the details and
// buttons sit bottom-left over a dark gradient, and the rest of the page follows below.
// The hero is one fixed layer under Lampa's content (the content must stay clickable), moved with the page
// scroll (by copying Lampa's own transform transition); its speaker button is moved into the page content
// so it can be clicked. Hovering a poster for a moment starts that title's trailer here, unseen and silent.
// Lampa's emoji reactions are hidden (thumbs ratings: ratings.js). Active only where
// desktop.js is; the trailer follows Settings -> Interface -> "Trailers".
(function () {
    var STOP_BELOW = -220;   // px of page scroll after which the trailer stops (the hero is mostly gone)

    var CSS = [
        '.ruby-titlehero{position:fixed;left:0;right:0;top:0;height:88vh;z-index:0;pointer-events:none;opacity:0;transition:opacity .4s;will-change:transform,opacity;' +
            '-webkit-mask-image:linear-gradient(180deg,#000 62%,transparent 100%);mask-image:linear-gradient(180deg,#000 62%,transparent 100%)}',
        '.ruby-titlehero.show{opacity:1}',
        '.ruby-titlehero__bg{position:absolute;inset:0;background:center 20%/cover no-repeat;opacity:0;transition:opacity .6s ease}',
        '.ruby-titlehero__bg.show{opacity:1}',
        'body.ruby-title .full-start-new__title{transition:opacity .3s}',
        'body.ruby-title .full-start-new__title.ruby-logo-wait{opacity:0}',
        '.ruby-titlehero::after{content:"";position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,rgba(0,0,0,.88) 0%,rgba(0,0,0,.55) 32%,rgba(0,0,0,0) 62%),linear-gradient(0deg,rgba(0,0,0,.6) 0%,rgba(0,0,0,0) 40%)}',
        // Lampa's own dim backdrop and TV poster give way to the hero
        'body.ruby-title .activity--active .full-start__background{display:none!important}',
        'body.ruby-title .full-start-new__left,body.ruby-title .full-start-new__reactions,body.ruby-title .button--reaction{display:none!important}',
        // only Play, My List and the thumbs (simplicity review 2026-10-20): not Lampa's Subscribe bell, "Platforms"
        // or "⋯" (whose menu held only Recommendations and Facts), for every profile
        'body.ruby-title .full-start-new__buttons .button--subscribe,body.ruby-title .full-start-new__buttons .button--options,' +
            'body.ruby-title .full-start-new__buttons .button--plaftorms{display:none!important}',
        'body.ruby-title .full-start-new{position:relative;min-height:calc(88vh - 9em);display:flex;flex-direction:column;justify-content:flex-end;padding:0 3.5% 1.5em;margin-bottom:2.5em}',
        'body.ruby-title .full-start-new__body{align-items:flex-end}',
        'body.ruby-title .full-start-new__right{padding-left:0;max-width:44em}',
        'body.ruby-title .full-start-new__title{font-size:3.4em;font-weight:700;letter-spacing:-.02em;line-height:1.05;text-shadow:0 .1em .5em rgba(0,0,0,.5)}',
        '.ruby-titlehero__logo{display:block;max-width:min(30em,100%);max-height:9em;object-fit:contain;object-position:left bottom;margin:.2em 0 .5em;filter:drop-shadow(0 .2em .6em rgba(0,0,0,.6))}',
        'body.ruby-title .full-start-new__title.has-logo{font-size:1em;text-shadow:none}',
        'body.ruby-title .full-start-new__tagline{font-size:1.15em;opacity:.85}',
        'body.ruby-title .full-start-new__head,body.ruby-title .full-start-new__details{text-shadow:0 1px 3px rgba(0,0,0,.6)}',
        'body.ruby-title .full-start-new .ruby-trailer__mute{right:3.5%;bottom:2em}',
        // Play keeps its label ("Resume") when another button has the focus: Lampa shows a button's
        // label only while it's focused (.full-start__button:not(.focus) span{display:none})
        'body.ruby-title .full-start-new__buttons .button--play span{display:inline!important}',
        // phones: Lampa's own phone layout (max-width 480px) pulls the details up into a rounded sheet with
        // negative margins, which here cut them off at the left edge; the hero fades from the bottom instead
        // of the left, and Play gets a whole line (a white button with its label, the rest stay icons)
        '@media (max-width: 600px){.ruby-titlehero{height:72vh}' +
            '.ruby-titlehero::after{background:linear-gradient(0deg,#000 0%,rgba(0,0,0,.7) 35%,rgba(0,0,0,0) 65%)}' +
            'body.ruby-title .full-start-new{min-height:calc(72vh - 4em);padding:0 4% 1em;margin-bottom:1em}' +
            'body.ruby-title .full-start-new__right{margin:0!important;padding:0!important;background:none!important;border-radius:0!important;overflow:visible;max-width:none;width:100%}' +
            'body.ruby-title .full-start-new__title{font-size:2.4em}.ruby-titlehero__logo{max-width:80%;max-height:6.5em}' +
            'body.ruby-title .full-start-new__buttons{flex-wrap:wrap;overflow:visible;gap:.7em 0}' +
            'body.ruby-title .full-start-new__buttons .button--play{flex:1 1 100%;justify-content:center;margin-right:0;padding:.75em;border-radius:.4em!important;background:#fff!important;color:#000!important}' +
            'body.ruby-title .full-start-new__buttons .button--play span{display:inline!important;font-weight:600}' +
            'body.ruby-title .full-start-new .ruby-trailer__mute{right:4%;bottom:auto;top:4.5em}}'
    ].join('\n');

    var host, bg, trailer, current = null;
    // warm-up: a poster rested on for WARM_MS starts its trailer silently in the (hidden) hero, so it is past
    // YouTube's start-up button when the page opens; dropped COOL_MS after the pointer leaves. Not while
    // scrolling, and not on a quick pass: every warm-up loads a whole YouTube player (in Safari on the
    // page's own thread), which made sweeping across rows stutter at 0.45 s
    var WARM_MS = 900, COOL_MS = 1200, QUIET_AFTER_WHEEL_MS = 1200, warmItem = null, warmUntil = 0, warmTimer = 0, lastWheel = 0;

    function active() {
        var a = Lampa.Activity.active && Lampa.Activity.active();
        return a && a.component === 'full' ? a : null;
    }
    function trailerVisible() {
        if (document.hidden || (Lampa.Player.opened && Lampa.Player.opened())) return false;
        if (active()) return rubyDesktop.pageY() > STOP_BELOW;
        return !!warmItem && Date.now() < warmUntil;
    }
    function playing(item) { var c = trailer.current(); return trailer.busy() && c && c.id === item.id; }

    // the title behind a hovered poster: Lampa cards carry it as card_data, ours (billboard, More like
    // this) as _rubyItem on an element marked data-ruby-item
    function itemOf(el) {
        var c = el && el.closest && el.closest('.card, [data-ruby-item]');
        var it = c && (c.card_data || c._rubyItem);
        return it && it.id ? it : null;
    }
    function warm(item) {
        if (active() || !rubyDesktop.active() || !rubyDesktop.settled() || Date.now() - lastWheel < QUIET_AFTER_WHEEL_MS) return;
        if (!host) build();
        warmItem = item;
        warmUntil = Infinity;
        if (!playing(item)) trailer.show(item);
    }
    function watchHover() {
        // on window: desktop.js stops wheel events at the document (stopImmediatePropagation)
        window.addEventListener('wheel', function () { lastWheel = Date.now(); clearTimeout(warmTimer); }, { capture: true, passive: true });
        document.addEventListener('mouseover', function (e) {
            if (rubyDesktop.touch()) return;   // a tap opens the title: nothing to warm up (mylist.js onPoster)
            var it = itemOf(e.target);
            if (!it) return;
            if (warmItem && warmItem.id === it.id) { warmUntil = Infinity; return; }
            clearTimeout(warmTimer);
            warmTimer = setTimeout(function () { warm(it); }, WARM_MS);
        }, true);
        document.addEventListener('mouseout', function (e) {
            var it = itemOf(e.target), to = itemOf(e.relatedTarget);
            if (!it || (to && to.id === it.id)) return;
            clearTimeout(warmTimer);
            if (warmItem && warmItem.id === it.id) warmUntil = Date.now() + COOL_MS;
        }, true);
    }

    // Follow the page's scroll offset without a per-frame loop: Lampa scrolls by setting the scroll body's
    // inline transform (translate3d(0, Ypx, 0)) and lets a CSS transition animate it, so copy the target
    // and the same transition onto the hero whenever that style changes - the compositor animates both.
    // On touch devices Lampa scrolls the page natively (rubyDesktop.touch): follow its scroll events.
    var watched = null, observer = null, scroller = null;
    function sync() {
        if (!watched) return;
        var m = (watched.style.transform || '').match(/translate3d\(\s*[-\d.]+px,\s*([-\d.]+)px/);
        var cs = getComputedStyle(watched);
        host.style.transition = 'transform ' + cs.transitionDuration.split(',')[0] + ' ' + cs.transitionTimingFunction.split(',')[0] + ', opacity .4s';
        host.style.transform = 'translateY(' + (m ? Math.min(0, parseFloat(m[1])) : 0) + 'px)';
    }
    function syncNative() {
        host.style.transition = 'opacity .4s';
        host.style.transform = 'translateY(' + -scroller.scrollTop + 'px)';
    }
    function follow(root) {
        var page = root && root.querySelector('.scroll:not(.scroll--horizontal)');
        if (rubyDesktop.touch()) {
            if (page === scroller) return;
            if (scroller) scroller.removeEventListener('scroll', syncNative);
            scroller = page;
            if (page) { page.addEventListener('scroll', syncNative, { passive: true }); syncNative(); }
            return;
        }
        var body = page && page.querySelector(':scope > .scroll__content > .scroll__body');
        if (body === watched) return;
        if (!observer) observer = new MutationObserver(sync);
        observer.disconnect();
        watched = body;
        if (body) { observer.observe(body, { attributes: true, attributeFilter: ['style'] }); sync(); }
    }

    function build() {
        host = document.createElement('div');
        host.className = 'ruby-titlehero';
        host.innerHTML = '<div class="ruby-titlehero__bg"></div>';
        bg = host.firstChild;
        var orbs = document.querySelector('.ruby-orbs');
        document.body.insertBefore(host, orbs ? orbs.nextSibling : document.body.firstChild);
        trailer = rubyTrailer.attach(host, { visible: trailerVisible, quiet: function () { return !active(); } });
    }

    // the logo replaces the text title; the text stays invisible while the logo is fetched (at most
    // LOGO_WAIT_MS), so the title doesn't jump from text to logo in front of you
    var LOGO_WAIT_MS = 1200;
    function setLogo(root, item) {
        var title = root.querySelector('.full-start-new__title');
        if (!title || title.querySelector('.ruby-titlehero__logo')) return;
        title.classList.add('ruby-logo-wait');
        var reveal = function () { title.classList.remove('ruby-logo-wait'); };
        var giveUp = setTimeout(reveal, LOGO_WAIT_MS);
        rubyDesktop.logo(item, function (src) {
            if (!src || current !== item) { clearTimeout(giveUp); return reveal(); }
            var img = new Image();
            img.className = 'ruby-titlehero__logo';
            img.alt = title.textContent;
            img.onload = function () { clearTimeout(giveUp); title.textContent = ''; title.appendChild(img); title.classList.add('has-logo'); reveal(); };
            img.onerror = function () { clearTimeout(giveUp); reveal(); };
            img.src = src;
        });
    }

    // the backdrop fades in once downloaded instead of painting in top to bottom
    function setBackdrop(item) {
        bg.classList.remove('show');
        if (!item.backdrop_path) return;
        var src = Lampa.TMDB.image('t/p/original' + item.backdrop_path), img = new Image();
        img.onload = function () { if (current === item) { bg.style.backgroundImage = 'url(' + src + ')'; bg.classList.add('show'); } };
        img.src = src;
    }

    function enter(item, root) {
        if (!rubyDesktop.active()) return;
        if (!host) build();
        document.body.classList.add('ruby-title');
        warmItem = null;
        clearTimeout(warmTimer);
        if (!current || current.id !== item.id) {
            current = item;
            setBackdrop(item);
        }
        if (playing(item)) trailer.loud(); else trailer.show(item);   // warmed up on hover: keep it
        host.classList.add('show');
        if (root) {
            var block = root.querySelector('.full-start-new');
            if (block) block.appendChild(trailer.muteButton);
            setLogo(root, item);
            follow(root);
        }
    }

    function leave() {
        document.body.classList.remove('ruby-title');
        if (!host) return;
        host.classList.remove('show');
        trailer.stop();
    }

    function start() {
        if (Lampa.Platform.tv()) return;
        var style = document.createElement('style');
        style.id = 'ruby-title';
        style.textContent = CSS;
        document.head.appendChild(style);
        watchHover();
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite' && e.data && e.data.movie && e.object && e.object.activity)
                enter(e.data.movie, e.object.activity.render(true));
        });
        // back to an already-built title page, or away from title pages
        Lampa.Listener.follow('activity', function (e) {
            if (e.type !== 'start') return;
            if (e.component !== 'full') return leave();
            var card = e.object && e.object.card, root = e.object && e.object.activity && e.object.activity.render(true);
            if (card && root && root.querySelector('.full-start-new')) enter(current && current.id === card.id ? current : card, root);
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Activity || !Lampa.Player || !Lampa.TMDB ||
            !window.rubyDesktop || !rubyDesktop.logo || !window.rubyTrailer) return;
        clearInterval(t);
        start();
    }, 100);
})();
