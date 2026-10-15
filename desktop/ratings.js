// Netflix-style thumbs ratings for Lampa on computers (desktop/README.md). Loaded by index.html.
// A thumbs button among a title page's buttons; hovering opens Not for me / I like this / Love this!
// (clicking the current choice again clears it). Ratings belong to the profile (Lampa.Storage
// 'ruby_ratings', kept per profile by profiles.js) and feed "Picked for you" (personal.js).
// When the profile is connected to Trakt they are also sent there (thumbs down 3, up 7, love 10 out of 10,
// so Trakt's own recommendations learn too), and the Trakt ratings already there (e.g. an imported IMDb history)
// count as thumbs: 9-10 love, 6-8 up, 1-5 down. A local rating wins over the Trakt one.
(function () {
    var KEY = 'ruby_ratings', TRAKT_CACHE = 'ruby_trakt_ratings_v1_';
    var TO_TRAKT = { '-1': 3, '1': 7, '2': 10 };
    var LABEL = { '-1': 'Not for me', '1': 'I like this', '2': 'Love this!' };
    var ICON = { '-1': 'thumbDown', '1': 'thumbUp', '2': 'thumbsUp' };
    var listeners = [], fromTrakt = null;

    var CSS = [
        // every glass button is its own stacking context (backdrop-filter): lift the open one above its neighbours
        '.ruby-rate{position:relative;overflow:visible!important}',
        '.ruby-rate:hover{z-index:10}',
        '.ruby-rate>.ruby-icon{font-size:1.45em}',
        '.ruby-rate__pop{position:absolute;left:50%;top:50%;z-index:5;display:flex;gap:.15em;padding:.3em;border-radius:3em;background:#2b2b2b;border:1px solid rgba(255,255,255,.18);' +
            'box-shadow:0 .5em 1.6em rgba(0,0,0,.75);opacity:0;pointer-events:none;transform:translate(-50%,-50%) scale(.6);transition:opacity .15s,transform .15s}',
        '.ruby-rate:hover .ruby-rate__pop{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1)}',
        '.ruby-rate__opt{position:relative;width:2.5em;height:2.5em;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;transition:background .12s}',
        '.ruby-rate__opt .ruby-icon{font-size:1.45em}',
        '.ruby-rate__opt:hover{background:rgba(255,255,255,.16)}',
        '.ruby-rate__opt.on{background:#fff;color:#000}',
        '.ruby-rate__opt::after{content:attr(data-label);position:absolute;bottom:calc(100% + .7em);left:50%;transform:translateX(-50%);white-space:nowrap;' +
            'background:#e5e5e5;color:#141414;font-size:.8em;font-weight:600;padding:.25em .6em;border-radius:.25em;opacity:0;pointer-events:none;transition:opacity .12s}',
        '.ruby-rate__opt:hover::after{opacity:1}',
        // touch: nothing to hover, so the three choices sit in the button itself, without labels
        'body.touch-device .ruby-rate>.ruby-icon,body.touch-device .ruby-rate__opt::after{display:none}',
        'body.touch-device .ruby-rate{padding-left:.2em!important;padding-right:.2em!important}',
        'body.touch-device .ruby-rate__pop{position:static;opacity:1;pointer-events:auto;transform:none;background:none;border:0;box-shadow:none;padding:0}',
        'body.touch-device .ruby-rate__opt{width:2.2em;height:2.2em}'
    ].join('\n');

    function keyOf(kind, id) { return kind + ':' + id; }
    function local() { var r = Lampa.Storage.get(KEY, '{}'); return r && typeof r === 'object' ? r : {}; }

    // the profile's Trakt ratings as thumbs, fetched once per page session per profile
    function loadTrakt(done) {
        if (fromTrakt) return done(fromTrakt);
        if (!window.rubyTrakt || !rubyTrakt.connected()) return done({});
        var ck = TRAKT_CACHE + (window.rubyProfiles ? rubyProfiles.current().id : '');
        try { fromTrakt = JSON.parse(sessionStorage.getItem(ck)); } catch (e) {}
        if (fromTrakt) return done(fromTrakt);
        rubyTrakt.get('/sync/ratings/movies', function (movies) {
            rubyTrakt.get('/sync/ratings/shows', function (shows) {
                var out = {};
                [[movies, 'movie', 'movie'], [shows, 'tv', 'show']].forEach(function (x) {
                    (x[0] || []).forEach(function (e) {
                        var o = e[x[2]], id = o && o.ids && o.ids.tmdb;
                        if (!id) return;
                        out[keyOf(x[1], id)] = { r: e.rating >= 9 ? 2 : e.rating >= 6 ? 1 : -1, t: Date.parse(e.rated_at) || 0, kind: x[1], id: id, n: o.title };
                    });
                });
                fromTrakt = out;
                try { sessionStorage.setItem(ck, JSON.stringify(out)); } catch (e) {}
                done(out);
            });
        });
    }

    // every rating of the profile: {"movie:27205": {r, t, kind, id, n, g?}}; local ones win
    function all(done) {
        loadTrakt(function (tr) { done(Object.assign({}, tr, local())); });
    }

    function set(item, r) {
        var kind = rubyDesktop.kind(item), k = keyOf(kind, item.id), map = local(), had = map[k] || (fromTrakt && fromTrakt[k]);
        if (r) map[k] = { r: r, t: Date.now(), kind: kind, id: item.id, n: item.title || item.name, g: item.genre_ids || (item.genres || []).map(function (g) { return g.id; }) };
        else delete map[k];
        if (!r && fromTrakt) delete fromTrakt[k];
        Lampa.Storage.set(KEY, map);
        if (window.rubyTrakt && rubyTrakt.connected()) {
            var body = {}, list = kind === 'tv' ? 'shows' : 'movies';
            body[list] = [r ? { ids: { tmdb: item.id }, rating: TO_TRAKT[r] } : { ids: { tmdb: item.id } }];
            if (r || had) rubyTrakt.post(r ? '/sync/ratings' : '/sync/ratings/remove', body);
        }
        listeners.forEach(function (fn) { fn(item, r); });
    }

    function get(item, done) {
        var k = keyOf(rubyDesktop.kind(item), item.id);
        all(function (m) { done(m[k] ? m[k].r : 0); });
    }

    function button(item, buttons) {
        if (buttons.querySelector('.ruby-rate')) return;
        var b = document.createElement('div');
        b.className = 'full-start__button selector ruby-rate';
        var pop = '<div class="ruby-rate__pop">' + ['-1', '1', '2'].map(function (r) {
            return '<div class="ruby-rate__opt" data-r="' + r + '" data-label="' + LABEL[r] + '">' + rubyIcons.svg(ICON[r]) + '</div>';
        }).join('') + '</div>';
        function paint(r) {
            b.innerHTML = rubyIcons.svg(ICON[r] || 'thumbUp') + pop;
            b.title = r ? LABEL[r] : 'Rate';
            [].forEach.call(b.querySelectorAll('.ruby-rate__opt'), function (o) {
                o.classList.toggle('on', +o.dataset.r === r);
                o.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var nr = +o.dataset.r === r ? 0 : +o.dataset.r;
                    set(item, nr);
                    paint(nr);
                });
            });
        }
        paint(0);
        get(item, paint);
        var book = buttons.querySelector('.button--book');
        buttons.insertBefore(b, book ? book.nextSibling : null);
    }

    function start() {
        var style = document.createElement('style');
        style.id = 'ruby-ratings';
        style.textContent = CSS;
        document.head.appendChild(style);
        window.rubyRatings = { all: all, get: get, set: set, onChange: function (fn) { listeners.push(fn); } };
        if (Lampa.Platform.tv()) return;
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite' || !rubyDesktop.active() || !e.data || !e.data.movie || !e.object || !e.object.activity) return;
            var buttons = e.object.activity.render(true).querySelector('.full-start-new__buttons');
            if (buttons) button(e.data.movie, buttons);
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Storage || !window.rubyDesktop || !rubyDesktop.kind || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 50);
})();
