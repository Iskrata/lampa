// Play without choosing a torrent (desktop/README.md, "Play"). Whatever opens a title's torrent list
// (Play on a title page, the billboard's Play, an episode) instead:
//   1. searches like Lampa does, keeps English releases that will stream (pick.js)
//   2. asks only for the resolution: 4K / 1080p / 720p, each with its best release; "All torrents" opens
//      Lampa's list as before
//   3. opens the chosen release with Lampa's own torrent flow and picks the file itself: the episode asked
//      for, or the film. Progress, the episode playlist and "next episode" stay Lampa's.
// Also: Play no longer offers trailers (the Trailers button is removed, so Play goes straight here), and
// clicking an episode plays it (upstream it only toggled "watched"). A series' Play continues from the
// last episode watched. Runs everywhere (TV too); Settings → Interface → "Pick torrents for me" turns it off.
(function () {
    var SETTING = 'ruby_autopick', LAST_RES = 'ruby_pick_res', VIDEO = /\.(mkv|mp4|m4v|avi|mov|ts|m2ts|webm|wmv)$/i;
    var pending = null;     // { target, files: [{element, item}] } while Lampa's file list is coming up
    var push = null;        // Lampa.Activity.push before we wrapped it

    function on() { return Lampa.Storage.field(SETTING) !== false; }

    // the search Lampa's own Torrents button would make (Storage parse_lang)
    function searchParams(movie) {
        var year = ((movie.first_air_date || movie.release_date || '0000') + '').slice(0, 4);
        var title = movie.title || movie.name, orig = movie.original_title || movie.original_name || title;
        var combos = {
            df: orig, df_year: orig + ' ' + year, df_lg: orig + ' ' + title, df_lg_year: orig + ' ' + title + ' ' + year,
            lg: title, lg_year: title + ' ' + year, lg_df: title + ' ' + orig, lg_df_year: title + ' ' + orig + ' ' + year
        };
        // Jackett's query reads movie.genres (names); a card from a list only has genre_ids
        if (!movie.genres) movie.genres = [];
        return { url: '', title: Lampa.Lang.translate('title_torrents'), component: 'torrents',
            search: combos[Lampa.Storage.field('parse_lang')] || orig, search_one: title, search_two: orig, movie: movie, page: 1 };
    }

    function openList(params) { params.ruby_list = true; push.call(Lampa.Activity, params); }

    function hash(card, s, e) {
        return Lampa.Utils.hash([s, s > 10 ? ':' : '', e, card.original_name || card.original_title].join(''));
    }

    // where a series continues: the last episode with progress (or the one after, once it is ~finished)
    function nextEpisode(card, done) {
        // a card from a list (the billboard) has no seasons yet: get the show's details first
        if (!card.seasons && window.rubyDesktop && rubyDesktop.details) return rubyDesktop.details([{ kind: 'tv', id: card.id }], function (d) {
            card.seasons = (d[0] && d[0].seasons) || [];
            nextEpisode(card, done);
        });
        var nums = (card.seasons || []).map(function (s) { return s.season_number; }).filter(function (n) { return n > 0; });
        if (!nums.length) return done({ season: 1, episode: 1 });
        Lampa.Api.seasons(card, nums, function (data) {
            var all = [], today = new Date();
            nums.forEach(function (n) {
                ((data[n] || data['' + n] || {}).episodes || []).forEach(function (ep) {
                    if (!ep.air_date || new Date(ep.air_date.replace(/-/g, '/')) <= today) all.push(ep);
                });
            });
            if (!all.length) return done({ season: nums[0], episode: 1 });
            var last = -1;
            all.forEach(function (ep, i) { if (Lampa.Timeline.view(hash(card, ep.season_number, ep.episode_number)).percent > 0) last = i; });
            var pick = last < 0 ? all[0] :
                Lampa.Timeline.view(hash(card, all[last].season_number, all[last].episode_number)).percent >= 90 && all[last + 1] ? all[last + 1] : all[last];
            done({ season: pick.season_number, episode: pick.episode_number });
        });
    }

    function sizeText(bytes) { return (bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1) + ' GB'; }

    function start(movie, target, params) {
        var series = !!(movie.original_name || movie.name && !movie.title);
        var back = Lampa.Controller.enabled().name, stopped = false;
        params = params || searchParams(movie);
        Lampa.Loading.start(function () { stopped = true; Lampa.Loading.stop(); Lampa.Controller.toggle(back); });
        Lampa.Loading.setText('Finding the best release…');

        var go = function (target) {
            Lampa.Parser.get(params, function (data) {
                if (stopped) return;
                Lampa.Loading.stop();
                choose(movie, target, params, rubyPick.choices(data.Results, movie, target), back);
            }, function () {
                if (stopped) return;
                Lampa.Loading.stop();
                openList(params);
            });
        };
        if (series && !target) nextEpisode(movie, go); else go(series ? target : null);
    }

    function choose(movie, target, params, list, back) {
        if (!list.length) {
            Lampa.Noty.show('No English release with enough seeders: showing all torrents');
            return openList(params);
        }
        var last = +Lampa.Storage.get(LAST_RES, 1080);
        var items = list.map(function (c) {
            return { title: c.label, subtitle: c.best.Seeders + ' seeders · ' + sizeText(c.best.Size), choice: c, selected: c.res === last };
        });
        if (!items.some(function (i) { return i.selected; })) items[0].selected = true;
        items.push({ title: 'All torrents', subtitle: 'Choose a release yourself', all: true });
        Lampa.Select.show({
            title: (target ? 'S' + target.season + ' E' + target.episode + ' · ' : '') + 'Play in',
            items: items,
            onSelect: function (a) {
                if (a.all) return openList(params);
                Lampa.Storage.set(LAST_RES, a.choice.res);
                play(movie, target, a.choice.best);
            },
            onBack: function () { Lampa.Controller.toggle(back); }
        });
    }

    function play(movie, target, release) {
        pending = { target: target, files: [], at: Date.now() };
        release.poster = movie.img || release.poster;
        Lampa.Torrent.start(release, movie);
    }

    // Lampa's file list for the release we opened: start the right file instead of showing the list
    function files(e) {
        if (!pending || Date.now() - pending.at > 120000) { pending = null; return; }
        if (e.type === 'list_open') {
            pending.files = [];
            document.body.classList.add('ruby-autopicking');
            setTimeout(pickFile, 0);    // after the list is built (the renders come in the same tick)
        } else if (e.type === 'render') pending.files.push({ element: e.element, item: e.item });
        else if (e.type === 'list_close') done();
    }

    function pickFile() {
        if (!pending) return;
        var target = pending.target, found = null;
        var videos = pending.files.filter(function (f) { return VIDEO.test(f.element.path || ''); });
        if (target) found = videos.filter(function (f) { return +f.element.season === target.season && +f.element.episode === target.episode; })[0];
        else found = videos.sort(function (a, b) { return (b.element.length || 0) - (a.element.length || 0); })[0];
        if (found) {
            found.item.trigger('hover:enter');
            // by now the player (or Lampa's preload screen) covers the list; if playback never starts
            // (preload cancelled), the list must not stay invisible
            setTimeout(done, 1500);
        } else {
            Lampa.Noty.show('Episode not found in this release: pick it from the list');
            done();
        }
        pending = null;
    }

    function done() {
        pending = null;
        document.body.classList.remove('ruby-autopicking');
    }

    // Episode cards (the title page's row: .full-episode; the all-episodes page: .season-episode) are built
    // without a reference to their data, so the episode is read from the card: its number and name, in the
    // season the page shows (the episodes page's season, else the latest aired), checked against TMDB.
    function clickedEpisode(el) {
        var card = el.closest('.full-episode, .season-episode');
        if (!card || card.classList.contains('full-episode--next') || card.style.opacity === '0.5') return null;   // not aired yet
        var text = function (sel) { var x = card.querySelector(sel); return x ? x.textContent.trim() : ''; };
        return {
            num: +(text('.full-episode__num') || text('.season-episode__episode-number')) || 0,
            name: text('.full-episode__name') || text('.season-episode__title')
        };
    }

    function resolveEpisode(show, guess, clicked, done) {
        var match = function (eps) {
            return eps.filter(function (e) { return clicked.name && e.name === clicked.name && (!clicked.num || e.episode_number === clicked.num); })[0] ||
                eps.filter(function (e) { return !clicked.name && e.episode_number === clicked.num; })[0];
        };
        Lampa.Api.seasons(show, [guess], function (data) {
            var ep = match(((data[guess] || {}).episodes) || []);
            if (ep) return done({ season: ep.season_number, episode: ep.episode_number });
            // not in that season: look through all of them
            var nums = (show.seasons || []).map(function (x) { return x.season_number; }).filter(function (n) { return n > 0; });
            Lampa.Api.seasons(show, nums, function (all) {
                for (var i = 0; i < nums.length; i++) {
                    ep = match(((all[nums[i]] || {}).episodes) || []);
                    if (ep) return done({ season: ep.season_number, episode: ep.episode_number });
                }
                done(null);
            });
        });
    }

    function episodeClicks() {
        // capture phase: runs before the card's own handler (which only toggled "watched")
        document.addEventListener('hover:enter', function (e) {
            if (!on() || !e.target.closest) return;
            var clicked = clickedEpisode(e.target), a = Lampa.Activity.active() || {}, show = a.card;
            if (!clicked || !show || !(clicked.num || clicked.name)) return;
            e.stopImmediatePropagation();
            var guess = a.component === 'episodes' ? a.season || Lampa.Utils.countSeasons(show) :
                (show.last_episode_to_air && show.last_episode_to_air.season_number) || Lampa.Utils.countSeasons(show);
            resolveEpisode(show, guess, clicked, function (target) {
                if (target) start(show, target);
                else Lampa.Noty.show('Could not tell which episode this is');
            });
        }, true);
    }

    function css() {
        var s = document.createElement('style');
        s.id = 'ruby-play';
        s.textContent = 'body.ruby-autopicking .modal{opacity:0;pointer-events:none}';
        document.head.appendChild(s);
    }

    function setting() {
        Lampa.SettingsApi.addParam({
            component: 'interface',
            param: { name: SETTING, type: 'trigger', default: true },
            field: { name: 'Pick torrents for me', description: 'Play asks only for the resolution and picks the best English release' }
        });
    }

    function init() {
        css();
        setting();
        push = Lampa.Activity.push;
        Lampa.Activity.push = function (params) {
            if (params && params.component === 'torrents' && params.movie && !params.ruby_list && !params.from_search && on())
                return start(params.movie, null, params);
            return push.apply(this, arguments);
        };
        Lampa.Listener.follow('torrent_file', files);
        Lampa.Player.listener.follow('start', done);
        // no Trailers source: Play then has one source and goes straight to it (no chooser)
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite' && on() && e.object && e.object.activity) $(e.object.activity.render(true)).find('.view--trailer').remove();
        });
        episodeClicks();
    }

    var timer = setInterval(function () {
        if (!window.Lampa || !Lampa.Activity || !Lampa.Api || !Lampa.Parser || !Lampa.Torrent || !Lampa.SettingsApi || !window.rubyPick) return;
        clearInterval(timer);
        init();
    }, 100);
})();
