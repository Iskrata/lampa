// "More is loading" placeholder at the bottom of a page, and building rows ahead (desktop/README.md).
// Lampa loads a page's next rows (Home) or next page of posters (grids) only when its scroller reaches the
// end: Scroll.onEnd -> 'loadNext' -> fetch -> append, with nothing shown meanwhile, so new rows appeared
// out of nowhere. Here the page always ends in a shimmering placeholder row:
//   * when it comes into view, the next rows are asked for right away; new rows go in above it
//   * if nothing arrives for GIVE_UP_MS while it is in view, the page has run out and it is removed (it
//     comes back if new content still arrives)
// Also builds ahead: building a row costs Safari 60-90 ms (measured 2026-10-13 in real Safari, the same with
// plain upstream Lampa), felt as a hitch every ~340 px of scrolling. So while the page is still (no wheel
// for IDLE_MS) the next rows are loaded until AHEAD_SCREENS screens are ready below the view; rows off
// screen cost nothing to draw (desktop.js content-visibility). Lampa allows one load per second.
// Home and grid pages only. Active only where desktop.js is.
(function () {
    var GIVE_UP_MS = 8000, CARDS = 9, IDLE_MS = 400, AHEAD_SCREENS = 2.5, PAGES = ['main', 'category_full', 'category'];
    var lastWheel = 0;

    var CSS = [
        '.ruby-rowload{padding:1.6em 0 3em}',
        '.ruby-rowload__title{width:11em;height:1.15em;border-radius:.4em;margin:0 0 .9em}',
        '.ruby-rowload__cards{display:flex;gap:1em;overflow:hidden}',
        '.ruby-rowload__card{flex:0 0 auto;width:var(--rb-card,10.5em);aspect-ratio:2/3;border-radius:.75em}',
        '.ruby-rowload .rb-skel{background:linear-gradient(100deg,#141416 30%,#232327 50%,#141416 70%);background-size:300% 100%;animation:rb-shimmer 1.4s linear infinite}'
    ].join('\n');

    function body(page) { return page.querySelector(':scope > .scroll__content > .scroll__body'); }
    function activePage() {
        var a = Lampa.Activity.active && Lampa.Activity.active();
        if (!a || PAGES.indexOf(a.component) < 0) return null;
        return document.querySelector('.activity--active .scroll:not(.scroll--horizontal)');
    }

    function placeholder(b) {
        var el = document.createElement('div');
        el.className = 'ruby-rowload';
        var card = b.querySelector('.card'), w = card ? card.getBoundingClientRect().width : 0;
        if (w) el.style.setProperty('--rb-card', w + 'px');
        var pad = b.querySelector('.items-line__head, .category-full');
        el.style.paddingLeft = pad ? getComputedStyle(pad).paddingLeft : '1.5em';
        el.innerHTML = '<div class="ruby-rowload__title rb-skel"></div><div class="ruby-rowload__cards">' +
            new Array(CARDS + 1).join('<div class="ruby-rowload__card rb-skel"></div>') + '</div>';
        return el;
    }

    // one placeholder per page, kept as the last child of its scroll body
    function attach(page) {
        var b = body(page), sc = page.Scroll;
        if (!b || !sc || typeof sc.onEnd !== 'function' || b._rubyRowload) return !!(b && b._rubyRowload);
        var load = sc.onEnd, el = null, lastArrival = Date.now(), check = 0;
        b._rubyRowload = true;
        page._rubyLoad = function () { load.call(sc); };
        function place() {
            if (b._rubyDone) return;
            if (!el) { el = placeholder(b); io.observe(el); }
            if (b.lastElementChild !== el) b.appendChild(el);
        }
        var io = new IntersectionObserver(function (entries) {
            var inView = entries[entries.length - 1].isIntersecting;
            clearInterval(check);
            if (!inView) return;
            page._rubyLoad();
            var since = Date.now();
            check = setInterval(function () {
                if (!document.body.contains(b)) return clearInterval(check);
                if (Date.now() - Math.max(since, lastArrival) < GIVE_UP_MS) return page._rubyLoad();
                clearInterval(check);   // nothing more is coming: the page has ended
                b._rubyDone = true;
                io.unobserve(el);
                el.remove();
                el = null;
            }, 1000);
        });
        new MutationObserver(function (ms) {
            var arrived = ms.some(function (m) { return [].some.call(m.addedNodes, function (n) { return n.nodeType === 1 && n !== el; }); });
            if (!arrived) return;
            lastArrival = Date.now();
            b._rubyDone = false;
            place();
        }).observe(b, { childList: true });
        place();
        return true;
    }

    // while the page is still, load the next rows until AHEAD_SCREENS screens are ready below the view
    function ahead() {
        if (document.hidden || Date.now() - lastWheel < IDLE_MS || !rubyDesktop.settled()) return;
        var page = activePage(), b = page && body(page);
        if (!page || !page._rubyLoad || !b || b._rubyDone) return;
        if (b.getBoundingClientRect().bottom - window.innerHeight < window.innerHeight * AHEAD_SCREENS) page._rubyLoad();
    }

    function start() {
        if (!rubyDesktop.active()) return;
        var style = document.createElement('style');
        style.id = 'ruby-rowload';
        style.textContent = CSS;
        document.head.appendChild(style);
        var watch = function () {
            var tries = 0, t = setInterval(function () {
                var page = activePage();
                if ((page && attach(page)) || ++tries > 30) clearInterval(t);
            }, 500);
        };
        Lampa.Listener.follow('activity', function (e) { if (e.type === 'start') watch(); });
        watch();
        // on window: desktop.js stops wheel events at the document
        window.addEventListener('wheel', function () { lastWheel = Date.now(); }, { capture: true, passive: true });
        setInterval(ahead, 500);
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Activity || !window.rubyDesktop || !rubyDesktop.active || !rubyDesktop.settled) return;
        clearInterval(t);
        start();
    }, 100);
})();
