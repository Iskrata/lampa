// Play without choosing a torrent (desktop/README.md, "Play"). Whatever opens a title's torrent list
// (Play on a title page, the billboard's Play, an episode) instead:
//   1. searches like Lampa does, keeps English releases that will stream (pick.js)
//   2. plays the best of them for this screen and connection without asking (the player's Quality menu
//      switches); nothing found shows a calm message, never Lampa's torrent list
//   3. opens the chosen release with Lampa's own torrent flow and picks the file itself: the episode asked
//      for, or the film. Progress, the episode playlist and "next episode" stay Lampa's.
// Also: Play no longer offers trailers (the Trailers button is removed, so Play goes straight here), and
// clicking an episode plays it (upstream it only toggled "watched"). A series' Play continues where you
// are (resume.js). Runs everywhere (TV too); Settings → Interface → "Pick torrents for me" turns it off.
(function () {
    var SETTING = 'ruby_autopick';
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

    // download: the same search and pick (1080p, no question), then the file is made into an MP4 to keep
    // instead of played (download.js)
    function start(movie, target, params, download) {
        var series = !!(movie.original_name || movie.name && !movie.title);
        var back = Lampa.Controller.enabled().name, stopped = false;
        params = params || searchParams(movie);
        // Jackett's query reads movie.genres (names); a card from a list (the hero's trending picks) has only
        // genre_ids, and callers that pass their own params skip searchParams
        if (!params.movie.genres) params.movie.genres = [];
        rubyFacts.start('Getting it ready…', movie);
        Lampa.Loading.start(function () { stopped = true; rubyFacts.stop(); Lampa.Loading.stop(); Lampa.Controller.toggle(back); });
        Lampa.Loading.setText('Getting it ready…');

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
                Lampa.Loading.stop();
                unavailable(movie, back, 'Couldn\'t look for it just now. Try again in a minute.');
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

    // What plays (simplicity review 2026-10-20: Play no longer asks "Play in"): the screen's resolution, 4K only
    // where the screen has 2560+ physical pixels across, and no more than this connection carries with headroom
    // (else it keeps stopping to buffer); the lowest found when even that is too much. prefer.res (the player's
    // Quality menu) wins when that resolution was found. list: best resolution first (rubyPick.choices).
    var prefer = null, current = null;
    // AirPlay: a device that once switched to 4K for its TV (player.js) starts in 4K whenever an AirPlay screen
    // is around (the user's call 2026-10-20). Kept per device, not per profile.
    var TV4K = 'ruby_tv_4k', airplayNear = false;
    function tv4k() { try { return localStorage.getItem(TV4K) === '1'; } catch (e) { return false; } }
    function watchAirplay() {
        if (!window.WebKitPlaybackTargetAvailabilityEvent) return;
        var v = document.createElement('video');
        v.addEventListener('webkitplaybacktargetavailabilitychanged', function (e) { airplayNear = e.availability === 'available'; });
    }
    function autoPick(list, movie, target, mbps) {
        var want = prefer && prefer.res;
        prefer = null;
        var exact = list.filter(function (c) { return c.res === want; })[0];
        if (exact) return exact;
        var big = screen.width * (window.devicePixelRatio || 1) >= 2560 || (airplayNear && tv4k());
        var fits = function (c) { return !mbps || rubyPick.bitrate(c.best, movie, target) * 1.3 <= mbps; };
        return list.filter(function (c) { return (big || c.res < 2160) && fits(c); })[0] || list[list.length - 1];
    }

    function choose(movie, target, params, results, back, mbps, download) {
        var audio = animeAudio(movie), list = rubyPick.choices(results, movie, target, audio);
        if (!list.length && audio) {    // anime with none in the chosen audio: the other one rather than nothing
            var other = audio === 'ja' ? 'en' : 'ja', alt = rubyPick.choices(results, movie, target, other);
            if (alt.length) { audio = other; list = alt; }
        }
        streamLang = audio === 'ja' ? 'ja' : null;
        if (!list.length) return unavailable(movie, back, download ? 'There\'s no good English copy of it to download yet.' :
            'There\'s no good English copy of it yet. Try again in a few days.');
        // a download asks nothing: 1080p fits a phone (4K files are 10-20 GB), else 720p, else what there is
        // (the user's call, 2026-10-20)
        if (download) {
            var res = function (r) { return list.filter(function (x) { return x.res === r; })[0]; };
            return play(movie, target, (res(1080) || res(720) || list[0]).best, true);
        }
        var c = autoPick(list, movie, target, mbps);
        current = { movie: movie, list: list, res: c.res, audio: audio };
        play(movie, target, c.best);
    }

    // Nothing to play: a calm message in the middle of the screen, never Lampa's raw torrent list (it showed
    // other shows' torrents for Link Click, simplicity review 2026-10-20). The list stays reachable with
    // Settings → Interface → "Pick torrents for me" off.
    function unavailable(movie, back, why) {
        rubyFacts.stop();
        var items = [{ title: why, separator: true }];
        if (window.rubyMyList && !rubyMyList.has(movie)) items.push({ title: 'Add to My List', subtitle: 'To find it again later', add: true });
        items.push({ title: 'OK' });
        rubyDesktop.centred();
        Lampa.Select.show({
            title: 'Can\'t play this right now',
            items: items,
            onSelect: function (a) {
                if (a.add) { rubyMyList.toggle(movie); Lampa.Noty.show('Added to My List'); }
                Lampa.Controller.toggle(back);
            },
            onBack: function () { Lampa.Controller.toggle(back); }
        });
    }

    // the player's Quality menu (player.js): what was found for the title playing, and starting another of
    // those where it is now (Lampa keeps a film's place by its title and an episode's by its number, not by
    // the release, and goes back to it on its own)
    function qualities() {
        if (!current || !Lampa.Player.opened()) return null;
        return { list: current.list.map(function (c) { return { res: c.res, label: c.label, on: c.res === current.res }; }), audio: current.audio };
    }
    function switchTo(opt) {
        if (!current) return;
        if (opt.tv) try { localStorage.setItem(TV4K, '1'); } catch (e) {}
        var movie = current.movie;
        if (opt.audio) Lampa.Storage.set(ANIME_AUDIO, opt.audio);
        prefer = opt.res ? { res: opt.res } : null;
        Lampa.Player.close();
        // a series starts the episode it's on (resume.js), which may be a later one than first played
        setTimeout(function () { start(movie); }, 300);
    }

    function play(movie, target, release, download) {
        pending = { target: target, files: [], at: Date.now(), movie: movie, download: download };
        if (rubyFacts.open()) rubyFacts.status('Connecting…'); else rubyFacts.start('Connecting…', movie);
        // backed out of Lampa's torrent dialog before anything played: take the facts away. Lampa's window is
        // open from Torrent.start until the player opens; its connection-error window closes without the
        // list_close that clears `pending`, so the window alone tells (the card stayed up after one, 2026-10-20)
        var idle = 0, check = setInterval(function () {
            if (Lampa.Player.opened()) return clearInterval(check);
            idle = document.querySelector('.modal') ? 0 : idle + 1;
            if (idle >= 3) { clearInterval(check); rubyFacts.stop(); done(); }
        }, 700);
        Lampa.Torrent.start(prepare(release, movie), movie);
    }

    // the release as Lampa's torrent flow sends it to TorrServer
    function prepare(release, movie) {
        release.poster = movie.img || release.poster;
        release.title = release.title || release.Title;   // what TorrServer lists it as (the parser's field is Title)
        return release;
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
        var target = pending.target;
        var el = rubyPick.file(pending.files.map(function (f) { return f.element; }), target);
        var found = pending.files.filter(function (f) { return f.element === el; })[0];
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
        rubyFacts.status('Starting…');
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
            'body.ruby-autopicking .modal{opacity:0;pointer-events:none}'
        ].join('\n');
        document.head.appendChild(s);
    }

    function setting() {
        Lampa.SettingsApi.addParam({
            component: 'interface',
            param: { name: SETTING, type: 'trigger', default: true },
            field: { name: 'Pick torrents for me', description: 'Play picks the best English release for this screen and connection; off: Lampa\'s list of torrents' }
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
        watchAirplay();
    }

    // episode(show, {season, episode}): play that episode (episodes.js)
    window.rubyPlay = { on: on, audio: animeAudio, download: function (movie, target) { start(movie, target, null, true); },
        qualities: qualities, switchTo: switchTo, episode: function (show, target) { start(show, target); } };

    var timer = setInterval(function () {
        if (!window.Lampa || !Lampa.Activity || !Lampa.Api || !Lampa.Parser || !Lampa.Torrent || !Lampa.SettingsApi || !window.rubyPick || !window.rubyFacts || !window.rubyResume) return;
        clearInterval(timer);
        init();
    }, 100);
})();
