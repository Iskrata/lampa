// Play without choosing a torrent (desktop/README.md, "Play"). Whatever opens a title's torrent list
// (Play on a title page, the billboard's Play, an episode) instead:
//   1. searches like Lampa does, keeps English releases that will stream (pick.js)
//   2. asks only for the resolution: 4K / 1080p / 720p (all of them, whatever the screen), each with its best release,
//      warning when this connection is too slow for it; "Pick a torrent manually" opens Lampa's list
//   3. opens the chosen release with Lampa's own torrent flow and picks the file itself: the episode asked
//      for, or the film. Progress, the episode playlist and "next episode" stay Lampa's.
// Also: Play no longer offers trailers (the Trailers button is removed, so Play goes straight here), and
// clicking an episode plays it (upstream it only toggled "watched"). A series' Play continues where you
// are (resume.js). Runs everywhere (TV too); Settings → Interface → "Pick torrents for me" turns it off.
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
        return { url: '', title: Lampa.Lang.translate('title_torrents'), component: 'torrents',
            search: combos[Lampa.Storage.field('parse_lang')] || orig, search_one: title, search_two: orig, movie: movie, page: 1 };
    }

    function openList(params) { params.ruby_list = true; push.call(Lampa.Activity, params); }

    // A show's seasons as TMDB numbers them. Not Lampa.Api.seasons: for season 1 it splits a show at any
    // 90-day gap in air dates into made-up seasons and renumbers the episodes (app.min.js splitEpisodesIntoSeasons),
    // while torrent files - and the progress Lampa saves for them - use the real numbers.
    // done({ <season number>: [episodes] })
    function realSeasons(card, nums, done) {
        var out = {}, left = nums.length;
        if (!left) return done(out);
        nums.forEach(function (n) {
            var url = Lampa.TMDB.api('tv/' + card.id + '/season/' + n + '?api_key=' + Lampa.TMDB.key() + '&language=' + (Lampa.Storage.field('tmdb_lang') || 'en'));
            fetch(url).then(function (r) { return r.json(); }).then(function (j) { out[n] = j.episodes || []; }, function () { out[n] = []; })
                .then(function () { if (--left === 0) done(out); });
        });
    }

    // where a series continues (resume.js): the episode last watched, or the next once it's finished
    function nextEpisode(card, done) {
        rubyResume.where(card, function (r) { done({ season: r.season, episode: r.episode }); });
    }

    function sizeText(bytes) { return (bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1) + ' GB'; }

    // download: the same search and pick (1080p, no question), then the file is made into an MP4 to keep
    // instead of played (download.js)
    function start(movie, target, params, download) {
        var series = !!(movie.original_name || movie.name && !movie.title);
        var back = Lampa.Controller.enabled().name, stopped = false;
        params = params || searchParams(movie);
        // Jackett's query reads movie.genres (names); a card from a list (the hero's trending picks) has only
        // genre_ids, and callers that pass their own params skip searchParams
        if (!params.movie.genres) params.movie.genres = [];
        rubyFacts.start('Finding the best release…');
        Lampa.Loading.start(function () { stopped = true; rubyFacts.stop(); Lampa.Loading.stop(); Lampa.Controller.toggle(back); });
        Lampa.Loading.setText('Finding the best release…');

        var go = function (target) {
            var timed = speed();
            Lampa.Parser.get(params, function (data) {
                if (stopped) return;
                timed.then(function (mbps) {
                    if (stopped) return;
                    Lampa.Loading.stop();
                    choose(movie, target, params, data.Results, back, mbps, download);
                });
            }, function () {
                if (stopped) return;
                rubyFacts.stop();
                Lampa.Loading.stop();
                openList(params);
            });
        };
        if (series && !target) nextEpisode(movie, go); else go(series ? target : null);
    }

    // This browser's speed to the server (Mbit/s), timed once per session with the remux service's
    // /gst/speedtest (random bytes). null when it can't tell (no remux service, TV, error).
    var SPEED = 'ruby_speed_mbps', speedTest = null;
    function speed() {
        if (speedTest) return speedTest;
        var known = +sessionStorage.getItem(SPEED);
        if (known) return (speedTest = Promise.resolve(known));
        var t0 = performance.now();
        speedTest = fetch(Lampa.Torserver.url() + '/gst/speedtest?mb=4', { cache: 'no-store' })
            .then(function (r) { if (!r.ok) throw new Error('no speedtest'); return r.arrayBuffer(); })
            .then(function (b) {
                if (b.byteLength < 1 << 20) return null;
                var mbps = b.byteLength * 8 / 1e6 / ((performance.now() - t0) / 1000);
                try { sessionStorage.setItem(SPEED, mbps.toFixed(1)); } catch (e) {}
                return mbps;
            }, function () { return null; });
        return speedTest;
    }

    // anime: English dub or Japanese with English subtitles, remembered per profile (ruby_anime_audio);
    // the stream asks the remux service for that audio (Torserver.stream, see init)
    var ANIME_AUDIO = 'ruby_anime_audio', streamLang = null;
    function animeAudio(movie) { return rubyPick.anime(movie) ? (Lampa.Storage.get(ANIME_AUDIO, 'en') === 'ja' ? 'ja' : 'en') : null; }

    function choose(movie, target, params, results, back, mbps, download) {
        rubyFacts.stop();     // not over the question; back once a release is chosen
        var audio = animeAudio(movie);
        streamLang = audio === 'ja' ? 'ja' : null;
        var list = rubyPick.choices(results, movie, target, audio);
        // Lampa's own list plays what's picked in it, so a download has no manual pick
        if (!list.length && download) return Lampa.Noty.show('No English release with enough seeders to download');
        // a download asks nothing: 1080p fits a phone (4K files are 10-20 GB), else 720p, else what there is
        // (the user's call, 2026-10-20)
        if (download) {
            var res = function (r) { return list.filter(function (c) { return c.res === r; })[0]; };
            return play(movie, target, (res(1080) || res(720) || list[0]).best, true);
        }
        if (!list.length && !audio) {   // (anime: still show the sheet, to switch the audio)
            Lampa.Noty.show('No English release with enough seeders: showing all torrents');
            return openList(params);
        }
        var last = +Lampa.Storage.get(LAST_RES, 1080);
        var items = list.map(function (c) {
            var kind = rubyPick.describe(c.best.Title || '');
            var line = (kind ? kind + ' · ' : '') + sizeText(c.best.Size) + ' · ' + c.best.Seeders + ' seeders';
            // the release's bitrate, with headroom, against this connection: it would keep stopping to buffer
            var need = rubyPick.bitrate(c.best, movie, target) * 1.3, slow = mbps && mbps < need;
            if (slow) line = 'Your connection (' + Math.round(mbps) + ' Mbit/s) is too slow for this · ' + line;
            return { title: c.label, subtitle: line, choice: c, slow: slow };
        });
        // preselect the last resolution chosen, unless this connection can't carry it
        var pre = items.filter(function (i) { return i.choice.res === last && !i.slow; })[0] ||
            items.filter(function (i) { return !i.slow; })[0] || items[0];
        if (pre) pre.selected = true;
        if (audio) items.push({ title: audio === 'ja' ? 'Audio: Japanese · English subtitles' : 'Audio: English dub',
            subtitle: 'Switch to ' + (audio === 'ja' ? 'the English dub' : 'Japanese with English subtitles'), audio: true });
        items.push({ title: 'Pick a torrent manually', subtitle: 'All releases, sorted and filtered your way', all: true });
        centred();
        Lampa.Select.show({
            title: (target ? 'S' + target.season + ' E' + target.episode + ' · ' : '') + 'Play in',
            items: items,
            onSelect: function (a) {
                if (a.audio) {
                    Lampa.Storage.set(ANIME_AUDIO, audio === 'ja' ? 'en' : 'ja');
                    return setTimeout(function () { choose(movie, target, params, results, back, mbps); }, 50);
                }
                if (a.all) return openList(params);
                Lampa.Storage.set(LAST_RES, a.choice.res);
                play(movie, target, a.choice.best);
            },
            onBack: function () { Lampa.Controller.toggle(back); }
        });
    }

    // "Play in" as a popup in the middle of the screen (computers), not Lampa's side panel: its own Select,
    // restyled while this one is open (keys and remote work as before); back to normal once it closes
    function centred() {
        if (!window.rubyDesktop || !rubyDesktop.active || !rubyDesktop.active()) return;
        var body = document.body;
        body.classList.add('ruby-playin');
        var seen = false, watch = new MutationObserver(function () {
            if (body.classList.contains('selectbox--open')) seen = true;
            else if (seen) { watch.disconnect(); setTimeout(function () { body.classList.remove('ruby-playin'); }, 250); }
        });
        watch.observe(body, { attributes: true, attributeFilter: ['class'] });
    }

    function play(movie, target, release, download) {
        pending = { target: target, files: [], at: Date.now(), movie: movie, download: download };
        rubyFacts.start('Connecting to the torrent…');
        // backed out of Lampa's torrent dialog before anything played: take the facts away. Lampa's window is
        // open from Torrent.start until the player opens; its connection-error window closes without the
        // list_close that clears `pending`, so the window alone tells (the card stayed up after one, 2026-10-20)
        var idle = 0, check = setInterval(function () {
            if (Lampa.Player.opened()) return clearInterval(check);
            idle = document.querySelector('.modal') ? 0 : idle + 1;
            if (idle >= 3) { clearInterval(check); rubyFacts.stop(); done(); }
        }, 700);
        release.poster = movie.img || release.poster;
        release.title = release.title || release.Title;   // what TorrServer lists it as (the parser's field is Title)
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
        if (found && pending.download) {
            rubyDownload.begin(found.element, pending.movie, target);
            rubyFacts.stop();
            // out through the list's own Back (it closes Lampa's torrent screen; the remux keeps the torrent)
            Lampa.Controller.back();
            setTimeout(done, 0);
        } else if (found) {
            found.item.trigger('hover:enter');
            // by now the player (or Lampa's preload screen) covers the list; if playback never starts
            // (preload cancelled), the list must not stay invisible
            setTimeout(done, 1500);
        } else {
            Lampa.Noty.show('Episode not found in this release: pick it from the list');
            rubyFacts.stop();
            done();
        }
        pending = null;
    }

    // The facts stay until the picture moves (Lampa's player shows only a spinner until then). A video that
    // ends up paused before it ever played, without anyone pressing pause, gets one more play(), then the
    // facts go so the player's own play button shows. Reported 2026-10-17: after Continue an episode stayed
    // paused under the facts until the player's play button was clicked. Not reproduced in Chromium (plain HLS
    // and torrent → remux, both resuming at a saved time, played on), so what the video did is logged
    // ("Ruby play") to find the cause.
    var watching = 0, untrace = null, lastInput = 0;
    function untraced() { if (untrace) untrace(); untrace = null; }
    function stopWatching() { clearInterval(watching); untraced(); rubyFacts.stop(); }
    function untilPlaying() {
        var since = Date.now(), pausedSince = 0, retried = false, userPaused = false, traced = null;
        rubyFacts.status('Starting playback…');
        clearInterval(watching);
        untraced();
        watching = setInterval(function () {
            var v = Lampa.PlayerVideo.video();
            if (v && v !== traced) {
                untraced();
                traced = v;
                untrace = trace(v, function () { if (Date.now() - lastInput < 1000) userPaused = true; });
            }
            if ((v && v.readyState >= 3 && v.currentTime > 0.2 && !v.paused) || userPaused || Date.now() - since > 300000) return stopWatching();
            if (!v || !v.paused || v.readyState < 1) return (pausedSince = 0);
            if (!pausedSince) return (pausedSince = Date.now());
            if (Date.now() - pausedSince < 1500) return;
            if (retried) { console.log('Ruby play', 'still paused, showing the player'); return stopWatching(); }
            retried = true;
            pausedSince = 0;
            console.log('Ruby play', 'paused before it played, playing again');
            Lampa.PlayerVideo.play();
        }, 500);
    }

    // logs the video's playback events; returns the function that stops it
    function trace(v, onPause) {
        var t0 = Date.now(), names = ['play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'stalled', 'error'];
        var log = function (e) {
            console.log('Ruby play', e.type, 'at', v.currentTime.toFixed(1), 'ready', v.readyState, 'paused', v.paused, '+' + (Date.now() - t0) + 'ms');
            if (e.type === 'pause') onPause();
        };
        names.forEach(function (n) { v.addEventListener(n, log); });
        return function () { names.forEach(function (n) { v.removeEventListener(n, log); }); };
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

    // the clicked card's episode in TMDB's real numbering: by name (Lampa may show renumbered, made-up
    // seasons, see realSeasons), in the season the page shows first, then in all of them
    function resolveEpisode(show, guess, clicked, done) {
        var nums = (show.seasons || []).map(function (x) { return x.season_number; }).filter(function (n) { return n > 0; });
        if (nums.indexOf(guess) < 0) nums.unshift(guess);
        realSeasons(show, nums, function (data) {
            var order = [guess].concat(nums.filter(function (n) { return n !== guess; })), ep = null;
            order.some(function (n) { ep = (data[n] || []).filter(function (e) { return clicked.name && e.name === clicked.name; })[0]; return !!ep; });
            if (!ep && clicked.num) ep = (data[guess] || []).filter(function (e) { return e.episode_number === clicked.num; })[0];
            done(ep ? { season: ep.season_number, episode: ep.episode_number } : null);
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
        s.textContent = [
            'body.ruby-autopicking .modal{opacity:0;pointer-events:none}',
            'body.ruby-playin .selectbox__layer{display:block!important;background:rgba(0,0,0,.55)}',
            'body.ruby-playin .selectbox__content{left:50%!important;top:50%!important;right:auto!important;bottom:auto!important;width:min(30em,88vw)!important;',
            '  height:auto!important;max-height:80vh;border-radius:1em;box-shadow:0 2em 5em rgba(0,0,0,.6);transform:translate(-50%,-46%)!important;opacity:0;',
            '  transition:opacity .2s,transform .2s!important;padding-bottom:.8em}',
            'body.ruby-playin.selectbox--open .selectbox__content{transform:translate(-50%,-50%)!important;opacity:1}',
            // Lampa gives the panel and its list a full-screen height inline (layer--height / layer--wheight)
            'body.ruby-playin .selectbox__body{max-height:none!important;height:auto!important}',
            'body.ruby-playin .selectbox__content.layer--height{height:auto!important}'
        ].join('\n');
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
        // anime in Japanese: ask the remux service for the Japanese track (and subtitles on) - server/remux.
        // The title's TMDB id goes along, for subtitles from OpenSubtitles (server/remux/opensubs.js).
        var stream = Lampa.Torserver.stream;
        Lampa.Torserver.stream = function () {
            var u = stream.apply(this, arguments);
            if (!/\/gst\/.*master\.m3u8/.test(u)) return u;
            var a = Lampa.Activity.active() || {}, card = a.card || a.movie;
            if (card && card.id && !/[?&]tmdb=/.test(u))
                u += '&tmdb=' + card.id + '&kind=' + (card.original_name || card.first_air_date ? 'tv' : 'movie');
            return streamLang ? u + '&lang=' + streamLang : u;
        };
        Lampa.Activity.push = function (params) {
            if (params && params.component === 'torrents' && params.movie && !params.ruby_list && !params.from_search && on())
                return start(params.movie, null, params);
            return push.apply(this, arguments);
        };
        Lampa.Listener.follow('torrent_file', files);
        Lampa.Player.listener.follow('start', function () { done(); untilPlaying(); });
        Lampa.Player.listener.follow('destroy', stopWatching);
        // a pause right after a key or click is the user's (untilPlaying leaves that alone)
        var touched = function () { lastInput = Date.now(); };
        document.addEventListener('keydown', touched, true);
        document.addEventListener('pointerdown', touched, true);
        // no Trailers source: Play then has one source and goes straight to it (no chooser)
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite' || !e.object || !e.object.activity) return;
            var root = e.object.activity.render(true);
            root = root.jquery ? root[0] : root;
            if (on()) $(root).find('.view--trailer').remove();
        });
        episodeClicks();
    }

    window.rubyPlay = { on: on, audio: animeAudio, download: function (movie, target) { start(movie, target, null, true); } };

    var timer = setInterval(function () {
        if (!window.Lampa || !Lampa.Activity || !Lampa.Api || !Lampa.Parser || !Lampa.Torrent || !Lampa.SettingsApi || !window.rubyPick || !window.rubyFacts || !window.rubyResume) return;
        clearInterval(timer);
        init();
    }, 100);
})();
