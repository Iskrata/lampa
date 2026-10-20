// "Continue watching" (desktop/README.md, "Continue watching"): the first row on Home, with films, series and
// anime you're part-way through, the one watched last first, each with a red bar of how far you are and, for
// a series, the episode ("S2 E5"). A click plays it from there (play.js). On TV Shows / Movies / Animation it
// shows that page's kind. Lampa's own row (content_rows_continue_watch) put only series on Home, films in a
// "Watched" row on the Movies page and anime on Animation, in history order, without bars (simplicity review
// 2026-10-20). Built from Lampa's history (a title enters it after 10 minutes, watched.js) and the progress
// it saves (resume.js). Active only where desktop.js is, with "Pick torrents for me" on.
(function () {
    var MAX = 20;
    var CSS = [
        '.ruby-cw{position:absolute;left:0;right:0;bottom:0;z-index:3;padding:1.6em .5em .45em;border-radius:0 0 .6em .6em;' +
            'background:linear-gradient(0deg,rgba(0,0,0,.85),rgba(0,0,0,0));pointer-events:none}',
        '.ruby-cw__ep{font-size:.9em;font-weight:600;color:#fff;margin-bottom:.35em;text-shadow:0 1px 2px #000}',
        '.ruby-cw__bar{height:.25em;border-radius:.2em;background:rgba(255,255,255,.3);overflow:hidden}',
        '.ruby-cw__bar i{display:block;height:100%;background:#e50914}',
        // Lampa's own "Episode 2" badge and history mark say it again
        '.ruby-cw-card .card-watched,.ruby-cw-card .card__icons{display:none!important}'
    ].join('\n');

    function anime(c) { return c.original_language === 'ja' && (c.genre_ids || (c.genres || []).map(function (g) { return g.id; })).indexOf(16) >= 0; }
    function isShow(c) { return !!(c.original_name || c.first_air_date || c.number_of_seasons); }
    // which titles a page shows: Home everything, the category pages their own kind
    function fits(c, params, screen) {
        if (screen === 'main') return true;
        if (params.url === 'movie') return !isShow(c) && !anime(c);
        if (params.url === 'tv') return isShow(c) && !anime(c);
        return anime(c);
    }

    // [{card, r}] of what's in progress, the one watched last first
    function inProgress(cards, done) {
        var out = [], left = cards.length;
        if (!left) return done(out);
        cards.forEach(function (card, i) {
            var take = function (r) {
                // series: an episode under way, or the next one after a finished episode; films: under way
                if (r && (r.state === 'continue' || (r.state === 'next' && r.from === 'lampa'))) out.push({ card: card, r: r, order: i });
                if (--left === 0) done(out.sort(function (a, b) { return (b.r.updated || 0) - (a.r.updated || 0) || a.order - b.order; }));
            };
            if (isShow(card)) rubyResume.where(card, take); else take(rubyResume.film(card));
        });
    }

    function row(params, screen) {
        if (!rubyDesktop.active() || !rubyPlay.on()) return;
        var cards = (Lampa.Favorite.get({ type: 'history' }) || []).filter(function (c) { return c && c.id && fits(c, params, screen); }).slice(0, MAX * 2);
        if (!cards.length) return;
        return function (call) {
            inProgress(cards, function (list) {
                if (!list.length) return call({ results: [] });
                call({
                    title: 'Continue watching',
                    results: list.slice(0, MAX).map(function (x) {
                        var item = Object.assign({}, x.card, { ruby_cw: { percent: x.r.state === 'continue' ? x.r.percent : 0, ep: x.r.season ? 'S' + x.r.season + ' E' + x.r.episode : '' } });
                        item.params = { emit: { onlyEnter: function () { rubyPlay.play(x.card); } } };
                        return item;
                    })
                });
            });
        };
    }

    // the bar and the episode on each card of the row, once Lampa has drawn it
    function paint(card) {
        var d = card.card_data, info = d && d.ruby_cw, view = card.querySelector('.card__view');
        if (!info || !view || view.querySelector('.ruby-cw')) return;
        var el = document.createElement('div');
        el.className = 'ruby-cw';
        el.innerHTML = (info.ep ? '<div class="ruby-cw__ep">' + info.ep + '</div>' : '') +
            '<div class="ruby-cw__bar"><i style="width:' + Math.max(3, Math.min(100, info.percent)) + '%"></i></div>';
        view.appendChild(el);
        card.classList.add('ruby-cw-card');
    }

    function start() {
        var st = document.createElement('style');
        st.id = 'ruby-cw';
        st.textContent = CSS;
        document.head.appendChild(st);
        if (!rubyDesktop.active()) return;
        // Lampa's own row off here (TVs keep it). Its switch can't be stored: Storage.get(key, 'true') reads a
        // stored false as missing and returns the default (app.min.js ContentRows.call), so it's answered here
        var get = Lampa.Storage.get;
        Lampa.Storage.get = function (name) {
            if (name === 'content_rows_continue_watch' && rubyDesktop.active()) return false;
            return get.apply(this, arguments);
        };
        Lampa.ContentRows.add({ name: 'ruby_continue', title: 'Continue watching', index: 0, screen: ['main', 'category'], call: row });
        // only this row's cards, as Lampa builds them (it draws a row's far cards on the first sideways scroll)
        Lampa.Listener.follow('line', function (e) {
            var d = e.data, r = d && d.results && d.results[0];
            if (!r || !r.ruby_cw || !e.line || !e.line.render) return;
            var root = e.line.render(true);
            root = root && root.jquery ? root[0] : root;
            if (root) setTimeout(function () { [].forEach.call(root.querySelectorAll('.card'), paint); }, 0);
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.ContentRows || !Lampa.Favorite || !Lampa.Storage || !window.rubyDesktop || !rubyDesktop.active ||
            !window.rubyResume || !rubyResume.film || !window.rubyPlay || !rubyPlay.play) return;
        clearInterval(t);
        start();
    }, 100);
})();
