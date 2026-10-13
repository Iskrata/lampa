// "More like this" section for Lampa on computers (desktop/README.md). Loaded by index.html.
// A liquid-glass block at the END of an opened movie/series page (it scrolls with the page - not sticky,
// by design), listing related titles from Trakt, else TMDB recommendations / "similar". Never on Home or
// browsing pages. Settings -> Interface -> "More like this". Active only where desktop.js is.
(function () {
    var KEY = 'ruby_drawer';
    var cache = {};

    var CSS = [
        '.ruby-more{margin:2em 1.5em 3em;border-radius:1.2em;padding:1em 1.2em 1.1em;' +
            'background:rgba(30,30,34,.45);-webkit-backdrop-filter:blur(30px) saturate(190%);backdrop-filter:blur(30px) saturate(190%);' +
            'border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}',
        '.ruby-more__title{font-weight:600;font-size:1.25em;margin-bottom:.8em}',
        '.ruby-more__title span{color:rgba(235,235,245,.6);font-weight:500}',
        '.ruby-more__list{display:flex;gap:.9em;overflow-x:auto;overflow-y:hidden;padding:.3em 0 .4em;scroll-behavior:smooth;scrollbar-width:none}',
        '.ruby-more__list::-webkit-scrollbar{display:none}',
        '.ruby-more__item{flex:0 0 auto;width:8.4em;cursor:pointer}',
        '.ruby-more__poster{width:8.4em;height:12.6em;border-radius:.7em;background:#1c1c1e center/cover;transition:transform .2s,box-shadow .2s;box-shadow:0 .2em .6em rgba(0,0,0,.35)}',
        '.ruby-more__item:hover .ruby-more__poster{transform:translateY(-.3em) scale(1.04);box-shadow:0 1em 2em rgba(0,0,0,.6)}',
        '.ruby-more__name{font-size:.9em;margin-top:.45em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ruby-more__meta{font-size:.78em;color:rgba(235,235,245,.6)}'
    ].join('\n');

    function enabled() { return rubyDesktop.active() && Lampa.Storage.get(KEY, 'true') + '' !== 'false'; }

    // Trakt's related titles (trakt.js) - TMDB's recommendations are much weaker - else TMDB's
    function recommendations(item, done) {
        var kind = rubyDesktop.kind(item), k = kind + item.id;
        if (cache[k]) return done(cache[k]);
        var keep = function (j) { return ((j && j.results) || []).filter(function (r) { return r.poster_path; }).slice(0, 20); };
        rubyTrakt.related(kind, item.id, function (refs) {
            rubyDesktop.details(refs, function (items) {
                if (items.length >= 4) return done(cache[k] = items);
                rubyDesktop.tmdb(kind + '/' + item.id + '/recommendations', function (j) {
                    var r = keep(j);
                    if (r.length) return done(cache[k] = r);
                    rubyDesktop.tmdb(kind + '/' + item.id + '/similar', function (j2) { done(cache[k] = keep(j2)); });
                });
            });
        });
    }

    function block(item, results) {
        var el = document.createElement('div');
        el.className = 'ruby-more';
        el.innerHTML = '<div class="ruby-more__title"><span>More like </span></div><div class="ruby-more__list"></div>';
        el.querySelector('.ruby-more__title').appendChild(document.createTextNode(item.title || item.name || ''));
        var list = el.querySelector('.ruby-more__list');
        results.forEach(function (r) {
            var it = document.createElement('div'), year = (r.release_date || r.first_air_date || '').slice(0, 4);
            it.className = 'ruby-more__item';
            it.dataset.rubyItem = '';   // title.js warms its trailer up on hover
            it._rubyItem = r;
            it.innerHTML = '<div class="ruby-more__poster"></div><div class="ruby-more__name"></div><div class="ruby-more__meta"></div>';
            it.querySelector('.ruby-more__poster').style.backgroundImage = 'url(' + Lampa.TMDB.image('t/p/w780' + r.poster_path) + ')';
            it.querySelector('.ruby-more__name').textContent = r.title || r.name;
            it.querySelector('.ruby-more__meta').textContent = [year, r.vote_average ? '★ ' + r.vote_average.toFixed(1) : ''].filter(Boolean).join(' · ');
            it.addEventListener('click', function () { rubyDesktop.openFull(r); });
            list.appendChild(it);
        });
        // vertical wheel over the strip scrolls it sideways; it is a native scroller, so keep Lampa's off it
        list.addEventListener('wheel', function (e) {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { list.scrollLeft += e.deltaY; e.preventDefault(); }
            e.stopPropagation();
        }, { passive: false });
        return el;
    }

    // append to the end of the title page's own scroller, and keep it last if Lampa adds rows afterwards
    function mount(e) {
        if (!enabled() || !e.data || !e.data.movie || !e.object || !e.object.activity) return;
        var item = e.data.movie, root = e.object.activity.render(true);
        var body = root.querySelector('.scroll:not(.scroll--horizontal) > .scroll__content > .scroll__body');
        if (!body || body.querySelector('.ruby-more')) return;
        recommendations(item, function (results) {
            if (!results.length || body.querySelector('.ruby-more')) return;
            var el = block(item, results);
            body.appendChild(el);
            new MutationObserver(function () { if (body.lastElementChild !== el && body.contains(el)) body.appendChild(el); })
                .observe(body, { childList: true });
        });
    }

    function start() {
        if (Lampa.Platform.tv()) return;
        var style = document.createElement('style');
        style.id = 'ruby-more';
        style.textContent = CSS;
        document.head.appendChild(style);
        Lampa.SettingsApi.addParam({
            component: 'interface',
            param: { name: KEY, type: 'trigger', default: true },
            field: { name: 'More like this', description: 'Recommendations at the end of movie/series pages' }
        });
        Lampa.Listener.follow('full', function (e) { if (e.type === 'complite') setTimeout(function () { mount(e); }, 300); });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.SettingsApi || !window.rubyDesktop || !rubyDesktop.details || !window.rubyTrakt) return;
        clearInterval(t);
        start();
    }, 100);
})();
