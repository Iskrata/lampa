// Personal Home for Lampa (desktop/README.md). Loaded by index.html. Everything here is per profile
// (profiles.js): the thumbs ratings and the Trakt login live with the profile.
// Adds two native Home rows through Lampa.ContentRows (real Lampa cards, focus, hover, drawer...):
//   * "Picked for you"      a blend, see picks() below; shown once the profile has rated something or
//                           is connected to Trakt
//   * "From your watchlist" Trakt /sync/watchlist, newest first (Trakt-connected profiles)
// and gives the billboard (hero.js) the same picks through rubyDesktop.personalPicks().
// Trakt returns ids only; TMDB details come from rubyDesktop.details (desktop.js), cached per session.
(function () {
    var SEEDS = 10, DISLIKE_SEEDS = 4, LOVE_BOOST_MS = 60 * 864e5, MAX = 30, WATCHED_SEEDS = 6, WATCHED_WEIGHT = 0.5;

    function trakt() { return window.rubyTrakt && rubyTrakt.connected(); }
    function rated() { var r = Lampa.Storage.get('ruby_ratings', '{}'); return r && typeof r === 'object' && Object.keys(r).length > 0; }

    function refOf(entry) {   // a Trakt movie/show object (or a watchlist entry wrapping one)
        var kind = entry.type === 'show' || entry.show ? 'tv' : 'movie';
        var obj = entry.movie || entry.show || entry;
        return obj && obj.ids && obj.ids.tmdb ? { kind: kind, id: obj.ids.tmdb } : null;
    }

    function traktRecs(done) {
        if (!trakt()) return done([]);
        var q = '?limit=20&ignore_collected=true&ignore_watchlisted=true';
        rubyTrakt.get('/recommendations/movies' + q, function (movies) {
            rubyTrakt.get('/recommendations/shows' + q, function (shows) {
                done((movies || []).map(function (x) { return refOf({ movie: x }); })
                    .concat((shows || []).map(function (x) { return refOf({ show: x }); })).filter(Boolean));
            });
        });
    }

    // "Picked for you", per profile, once per page session (reset when a rating changes):
    //   * seeds: the 10 most recent thumbs up (a "love" counts as 60 days more recent), including Trakt
    //     ratings (e.g. an imported IMDb history); each seed's related titles score by position, x2 for a love
    //   * the 4 most recent thumbs down push their related titles down
    //   * Trakt's own recommendations (Trakt-connected profiles) score like a seed and a bit
    //   * genre taste from the profile's own thumbs nudges the score (+-6 % per point, capped)
    //   * what the profile watched (Lampa's history, most recent first): the 6 latest not rated count as half a
    //     thumbs up each; a rating of the same title wins
    //   * anything already rated or watched is left out; only the top 30 get TMDB details
    var picked = null, waiting = [];
    function picks(done) {
        if (picked) return done(picked);
        if (!window.rubyRatings || !window.rubyDesktop || !window.rubyTrakt) return setTimeout(function () { picks(done); }, 100);
        waiting.push(done);
        if (waiting.length > 1) return;
        rubyRatings.all(function (ratings) {
            var list = Object.keys(ratings).map(function (k) { return ratings[k]; });
            var weight = function (r) { return r.t + (r.r === 2 ? LOVE_BOOST_MS : 0); };
            var likes = list.filter(function (r) { return r.r > 0; }).sort(function (a, b) { return weight(b) - weight(a); }).slice(0, SEEDS);
            var dislikes = list.filter(function (r) { return r.r < 0; }).sort(function (a, b) { return b.t - a.t; }).slice(0, DISLIKE_SEEDS);
            var taste = {};
            list.forEach(function (r) { (r.g || []).forEach(function (g) { taste[g] = (taste[g] || 0) + r.r; }); });
            var score = {}, refs = {}, seen = {};
            var watched = history().filter(function (h) { seen[h.kind + ':' + h.id] = true; return !ratings[h.kind + ':' + h.id]; }).slice(0, WATCHED_SEEDS);
            function add(found, w) {
                found.forEach(function (x, i) {
                    var k = x.kind + ':' + x.id;
                    if (ratings[k] || seen[k]) return;
                    refs[k] = refs[k] || x;
                    score[k] = (score[k] || 0) + w * (1 - i / (found.length + 5));
                });
            }
            var jobs = likes.map(function (s) { return { s: s, w: s.r }; })
                .concat(watched.map(function (s) { return { s: s, w: WATCHED_WEIGHT }; }))
                .concat(dislikes.map(function (s) { return { s: s, w: -0.8 }; }));
            var left = jobs.length + 1;
            function finish() {
                if (--left > 0) return;
                var top = Object.keys(score).filter(function (k) { return score[k] > 0; })
                    .sort(function (a, b) { return score[b] - score[a]; }).slice(0, MAX + 10).map(function (k) { return refs[k]; });
                rubyDesktop.details(top, function (items) {
                    var out = items.map(function (it) {
                        var g = (it.genre_ids || []).reduce(function (a, id) { return a + (taste[id] || 0); }, 0);
                        return { it: it, v: score[rubyDesktop.kind(it) + ':' + it.id] * (1 + 0.06 * Math.max(-5, Math.min(5, g))) };
                    }).sort(function (a, b) { return b.v - a.v; }).slice(0, MAX).map(function (x) { return x.it; });
                    picked = out;
                    waiting.splice(0).forEach(function (cb) { cb(out); });
                });
            }
            jobs.forEach(function (j) { rubyTrakt.related(j.s.kind, j.s.id, function (r) { add(r, j.w); finish(); }); });
            traktRecs(function (r) { add(r, 1.3); finish(); });
        });
    }

    // titles this profile played, most recent first ({kind, id}); Lampa adds one each time a torrent plays
    function history() {
        return (Lampa.Favorite.get({ type: 'history' }) || []).filter(function (c) { return c && c.id; })
            .map(function (c) { return { kind: rubyDesktop.kind(c), id: c.id }; });
    }

    function watchlist(done) {
        rubyTrakt.get('/sync/watchlist?sort_by=added&sort_how=desc&page=1&limit=30', function (list) {
            rubyDesktop.details((list || []).map(refOf).filter(Boolean), done);
        });
    }

    function row(name, title, index, when, source) {
        Lampa.ContentRows.add({
            name: name, title: title, index: index, screen: ['main'],
            call: function () {
                if (!when()) return;
                return function (call) {
                    source(function (results) { call(results && results.length ? { title: title, results: results } : { results: [] }); });
                };
            }
        });
    }

    function start() {
        row('ruby_picked', 'Picked for you', 0, function () { return trakt() || rated() || history().length > 0; }, picks);
        row('ruby_watchlist', 'From your watchlist', 1, trakt, watchlist);
        // for hero.js: personal billboard picks, or null without enough of them
        var expose = function () {
            if (!window.rubyDesktop || !window.rubyRatings) return setTimeout(expose, 100);
            rubyRatings.onChange(function () { picked = null; });
            rubyDesktop.personalPicks = function (done) {
                if (!trakt() && !rated() && !history().length) return done(null);
                picks(function (items) {
                    var withArt = items.filter(function (i) { return i.backdrop_path && i.overview; });
                    done(withArt.length >= 3 ? withArt : null);
                });
            };
        };
        expose();
    }

    // register before Home builds its rows: start as soon as Lampa's ContentRows exists
    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.ContentRows || !Lampa.Storage || !Lampa.TMDB) return;
        clearInterval(t);
        start();
    }, 20);
})();
