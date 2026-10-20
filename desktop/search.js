// Search as on Netflix (desktop/README.md, "Search"), simplicity review 2026-10-20:
//   * no source tabs (TMDB / CUB / TraktTV / AI Assistant): TMDB answers, as one list of films and shows
//     (app.min.js oneList)
//   * before anything is typed, what's trending today instead of an empty page; a click opens the title
// The box takes typing at once (nav.js). Active only where desktop.js is.
(function () {
    var CSS = [
        'body.ruby-desk .search__sources,body.ruby-desk .search__history{display:none!important}',
        '.ruby-trend{padding:1em 1.5em}',
        '.ruby-trend__title{font-size:1.25em;font-weight:600;margin-bottom:.8em}',
        '.ruby-trend__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(9em,1fr));gap:1em}',
        '.ruby-trend__item{cursor:pointer;min-width:0}',
        '.ruby-trend__img{aspect-ratio:2/3;border-radius:.6em;background:#1c1c1e center/cover no-repeat;transition:transform .2s}',
        '.ruby-trend__item:hover .ruby-trend__img{transform:scale(1.04)}',
        '.ruby-trend__name{margin-top:.4em;font-size:.95em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.search__input.filled~.ruby-trend,.search__body:has(.search__input.filled) .ruby-trend{display:none}',
        // with the box empty, the last search's results stayed under it
        'body.ruby-desk .search__body:not(:has(.search__input.filled)) .search__results{display:none}'
    ].join('\n');

    var trending = null;   // TMDB trending/all/day, once per session

    function fill(body) {
        if (body.querySelector('.ruby-trend')) return;
        var box = document.createElement('div');
        box.className = 'ruby-trend';
        box.innerHTML = '<div class="ruby-trend__title">Trending today</div><div class="ruby-trend__grid"></div>';
        var results = body.querySelector('.search__results');
        body.insertBefore(box, results);
        var show = function (list) {
            var grid = box.querySelector('.ruby-trend__grid');
            list.forEach(function (it) {
                var el = document.createElement('div');
                el.className = 'ruby-trend__item';
                el.innerHTML = '<div class="ruby-trend__img" style="background-image:url(' + Lampa.TMDB.image('t/p/w342' + it.poster_path) + ')"></div>' +
                    '<div class="ruby-trend__name"></div>';
                el.querySelector('.ruby-trend__name').textContent = it.title || it.name;
                el.addEventListener('click', function () { Lampa.Search.close(); rubyDesktop.openFull(it); });
                grid.appendChild(el);
            });
        };
        if (trending) return show(trending);
        rubyDesktop.tmdb('trending/all/day', function (j) {
            trending = ((j && j.results) || []).filter(function (r) { return r.poster_path && (r.media_type === 'movie' || r.media_type === 'tv'); }).slice(0, 18);
            show(trending);
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Search || !Lampa.Controller || !window.rubyDesktop || !rubyDesktop.active || !rubyDesktop.tmdb) return;
        clearInterval(t);
        if (!rubyDesktop.active()) return;
        document.body.classList.add('ruby-desk');
        var st = document.createElement('style');
        st.id = 'ruby-search';
        st.textContent = CSS;
        document.head.appendChild(st);
        // search opens with its keyboard (Lampa's 'keybord' controller); its body is built by then
        var toggle = Lampa.Controller.toggle;
        Lampa.Controller.toggle = function (name) {
            var out = toggle.apply(this, arguments);
            if (name === 'keybord') { var body = document.querySelector('.search .search__body'); if (body) fill(body); }
            return out;
        };
    }, 100);
})();
