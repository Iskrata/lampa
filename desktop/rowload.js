// "More is loading" placeholder at the bottom of a page (desktop/README.md). Loaded by index.html.
// Lampa loads a page's next rows (Home) or next page of posters (grids) when its scroller reaches the end:
// Scroll.onEnd -> 'loadNext' -> fetch -> append. Nothing shows while it fetches, so the page just seemed to
// end. Here onEnd also puts a shimmering placeholder row at the bottom, removed as soon as new content is
// appended. If nothing arrives within GIVE_UP_MS the page has run out: the placeholder goes and isn't
// shown again for that page until new content does arrive. Active only where desktop.js is.
(function () {
    var GIVE_UP_MS = 6000, CARDS = 9;

    var CSS = [
        '.ruby-rowload{padding:1.6em 0 3em}',
        '.ruby-rowload__title{width:11em;height:1.15em;border-radius:.4em;margin:0 0 .9em}',
        '.ruby-rowload__cards{display:flex;gap:1em;overflow:hidden}',
        '.ruby-rowload__card{flex:0 0 auto;width:var(--rb-card,10.5em);aspect-ratio:2/3;border-radius:.75em}',
        '.ruby-rowload .rb-skel{background:linear-gradient(100deg,#141416 30%,#232327 50%,#141416 70%);background-size:300% 100%;animation:rb-shimmer 1.4s linear infinite}'
    ].join('\n');

    function body(page) { return page.querySelector(':scope > .scroll__content > .scroll__body'); }

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

    function show(page) {
        var b = body(page);
        if (!b || b._rubyDone || b.querySelector(':scope > .ruby-rowload')) return;
        var el = placeholder(b);
        b.appendChild(el);
        var observer = new MutationObserver(function (ms) {
            var arrived = ms.some(function (m) { return [].some.call(m.addedNodes, function (n) { return n !== el && n.nodeType === 1; }); });
            if (arrived) finish(false);
        });
        var timer = setTimeout(function () { finish(true); }, GIVE_UP_MS);
        function finish(exhausted) {
            clearTimeout(timer);
            observer.disconnect();
            el.remove();
            b._rubyDone = exhausted;
        }
        observer.observe(b, { childList: true });
    }

    // wrap the active page's Scroll.onEnd once it exists (Lampa sets it when the page is built)
    function hook() {
        var page = document.querySelector('.activity--active .scroll:not(.scroll--horizontal)');
        var sc = page && page.Scroll;
        if (!sc || sc._rubyEnd || typeof sc.onEnd !== 'function') return !!(sc && sc._rubyEnd);
        var orig = sc.onEnd;
        sc._rubyEnd = true;
        sc.onEnd = function () { show(page); return orig.apply(this, arguments); };
        // new content after an "exhausted" verdict (e.g. a slow fetch) re-enables the placeholder
        var b = body(page);
        if (b) new MutationObserver(function (ms) {
            if (ms.some(function (m) { return [].some.call(m.addedNodes, function (n) { return n.nodeType === 1 && !n.classList.contains('ruby-rowload'); }); }))
                b._rubyDone = false;
        }).observe(b, { childList: true });
        return true;
    }

    function start() {
        if (!rubyDesktop.active()) return;
        var style = document.createElement('style');
        style.id = 'ruby-rowload';
        style.textContent = CSS;
        document.head.appendChild(style);
        var watch = function () {
            var tries = 0, t = setInterval(function () { if (hook() || ++tries > 30) clearInterval(t); }, 500);
        };
        Lampa.Listener.follow('activity', function (e) { if (e.type === 'start') watch(); });
        watch();
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !window.rubyDesktop || !rubyDesktop.active) return;
        clearInterval(t);
        start();
    }, 100);
})();
