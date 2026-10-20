// Home and the category pages' rows (desktop/README.md, "Rows"), simplicity review 2026-10-20:
//   * plain names: "Watching now" was films in cinemas (it read like your own progress), "Watch in cinemas"
//     was upcoming films, "Today in trend", "Continue browsing" next to Continue watching (continue.js)…
//   * each title in one row only: "Hope" was in four rows of Home. A row loses the titles another row on the
//     page already had, but never goes under MIN (they move to its end then), so no row disappears or thins
//     out (the user wanted no fewer rows).
// Active only where desktop.js is.
(function () {
    var MIN = 8;
    var NAMES = {
        title_now_watch: 'In cinemas now',
        title_trend_day: 'Trending today',
        title_trend_week: 'Trending this week',
        title_upcoming: 'Coming soon',
        title_popular_tv: 'Popular shows',
        title_top_movie: 'Top-rated films',
        title_top_tv: 'Top-rated shows',
        title_continue: 'Recently viewed',
        title_recomend_watch: 'Recommended for you',
        title_hight_voite: 'Highly rated',
        title_last_year: 'Last year\'s best',
        filter_keyword_disaster: 'Disaster'
    };

    function idOf(item) { return item && item.id ? (item.original_name || item.first_air_date ? 'tv' : 'm') + item.id : null; }

    // A page's rows load in parallel (Lampa hands their loaders to ContentRows.call, app.min.js main/category),
    // so each row's data is filtered as it arrives, before any card is drawn: titles another row already had go,
    // or, when that would leave fewer than MIN, move to the end of the row.
    function dedupe(json, have) {
        var res = json && json.results;
        if (!res || !res.length || res[0].ruby_cw) return;   // Continue watching may repeat what's below it
        var fresh = [], again = [];
        res.forEach(function (r) { (have[idOf(r)] ? again : fresh).push(r); });
        json.results = fresh.length >= MIN ? fresh : fresh.concat(again);
        res.forEach(function (r) { var k = idOf(r); if (k) have[k] = true; });
    }
    function wrap(parts, have) {
        parts.forEach(function (part, i) {
            if (typeof part !== 'function' || part._ruby) return;
            parts[i] = function (call) { return part(function (json) { dedupe(json, have); return call.apply(this, arguments); }); };
            parts[i]._ruby = true;
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Lang || !Lampa.Listener || !Lampa.ContentRows || !window.rubyDesktop || !rubyDesktop.active) return;
        clearInterval(t);
        if (!rubyDesktop.active()) return;
        var add = {};
        Object.keys(NAMES).forEach(function (k) { add[k] = { en: NAMES[k] }; });
        Lampa.Lang.add(add);
        var call = Lampa.ContentRows.call;
        Lampa.ContentRows.call = function (screen, params, parts) {
            var out = call.apply(this, arguments);
            if ((screen === 'main' || screen === 'category') && Array.isArray(parts)) {
                var have = {};
                wrap(parts, have);
                // the genre / keyword / people rows Lampa adds to the list right after this; they load on scroll
                setTimeout(function () { wrap(parts, have); }, 0);
            }
            return out;
        };
    }, 100);
})();
