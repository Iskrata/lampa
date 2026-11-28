// Play without choosing a torrent (desktop/README.md, "Play"). Whatever opens a title's torrent list
// (Play on a title page, the billboard's Play, an episode) instead:
//   1. asks the remux service which releases to play (server/remux/pick.js: the same answer on every device),
//      else searches like Lampa does and keeps English releases that will stream (pick.js)
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
    var opened = null;      // the title Play last opened a release of (its stream names it, init)
    var push = null;        // Lampa.Activity.push before we wrapped it
    var entered = false;    // Play entered a file in Lampa's list itself, and its onenter hasn't come yet

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
            var ready = function (list) {
                timed.then(function (mbps) {
                    if (stopped) return;
                    Lampa.Loading.stop();
                    choose(movie, target, list, back, mbps, download);
                });
            };
            // the server's pick (the same for every device); a plain TorrServer, or a remux that can't search,
            // gets this browser's own search
            picked(movie, series ? 'tv' : 'movie', target).then(function (list) {
                if (stopped) return;
                if (list) return ready(list);
                Lampa.Parser.get(params, function (data) {
                    if (!stopped) ready(fromResults(data.Results, movie, target));
                }, function () {
                    if (stopped) return;
                    Lampa.Loading.stop();
                    unavailable(movie, back, 'Couldn\'t look for it just now. Try again in a minute.');
                });
            });
        };
        if (series && !target) nextEpisode(movie, go); else go(series ? target : null);
    }

    // What can play, best resolution first: { audio, groups: { <res>: [releases, best first] },
    // list: [{ res, label, best }] }
    function listOf(audio, groups) {
        var list = [2160, 1080, 720].filter(function (res) { return groups[res] && groups[res].length; }).map(function (res) {
            return { res: res, label: rubyPick.LABEL[res], best: groups[res][0] };
        });
        return { audio: audio, groups: groups, list: list };
    }
    // ... from this browser's search (pick.js)
    function fromResults(results, movie, target) {
        var b = rubyPick.best(results, movie, target, animeAudio(movie));
        return listOf(b.audio, b.groups);
    }
    // ... from the remux service (server/remux/pick.js: the search, the swarm and what played or failed, ranked
    // by pick.js there too), without video this device can't decode (compat.js). null: no answer, use our own.
    var PICK_MS = 45000;
    function serverPick(movie, kind, target) {
        if (!Lampa.Torserver.url() || !movie.id) return Promise.resolve(null);
        var u = Lampa.Torserver.url() + '/gst/pick?tmdb=' + movie.id + '&kind=' + kind +
            (target ? '&season=' + target.season + '&episode=' + target.episode : '') +
            (Lampa.Storage.get(ANIME_AUDIO, 'en') === 'ja' ? '&lang=ja' : '');
        var t0 = Date.now(), timeout = new Promise(function (r) { setTimeout(function () { r(null); }, PICK_MS); });
        var asked = fetch(u, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
            if (!p || !p.choices) return null;
            var groups = {}, upgrade = {}, playable = function (r) { return !window.rubyCompat || rubyCompat.playable(r.Title); };
            p.choices.forEach(function (c) {
                var ok = c.releases.filter(playable), up = (c.upgrade || []).filter(playable);
                if (ok.length) groups[c.res] = ok;
                if (up.length) upgrade[c.res] = up;
            });
            console.log('Ruby play', 'server pick in', Date.now() - t0, 'ms:', p.choices.map(function (c) { return c.label + ' ' + c.releases.length; }).join(', ') || 'nothing');
            var found = listOf(p.audio, groups);
            found.notOut = p.notOut || '';
            found.upgrade = upgrade;
            return found;
        }, function () { return null; });
        return Promise.race([asked, timeout]).then(function (x) {
            if (!x) console.log('Ruby play', 'no server pick, searching here');
            return x;
        });
    }

    // The server's picks the warm-ups made for these titles and episodes (warm.js), each used once by a Play within
    // PICKED_MS: Play then starts the release that was warmed, without asking again (3.5-4.2 s on ruby, 2026-10-26).
    // Several: Continue watching warms its first first 3 titles one after another (2026-11-19), and kept only the
    // last, a Play of the first asked the server again and could start another release than the warmed one
    var PICKED_MS = 5 * 60000, warmPicks = {};
    function pickKey(movie, kind, target) {
        return [movie.id, kind, target ? target.season + 'x' + target.episode : '', Lampa.Storage.get(ANIME_AUDIO, 'en')].join('|');
    }
    function picked(movie, kind, target) {
        var key = pickKey(movie, kind, target), w = warmPicks[key];
        delete warmPicks[key];
        if (w && Date.now() - w.at < PICKED_MS) return w.p;
        return serverPick(movie, kind, target);
    }
    // what Play would start for this title (and episode): the server's pick, then the resolution for this screen
    // and connection. -> Promise of the release, or null (no server pick, nothing found)
    function choice(movie, target) {
        var kind = movie.original_name || movie.name && !movie.title ? 'tv' : 'movie';
        var p = serverPick(movie, kind, target);
        var now = Date.now();
        Object.keys(warmPicks).forEach(function (k) { if (now - warmPicks[k].at >= PICKED_MS) delete warmPicks[k]; });
        warmPicks[pickKey(movie, kind, target)] = { at: now, p: p };
        return Promise.all([p, speed(true)]).then(function (x) {
            var found = x[0];
            if (!found || !found.list.length) return null;
            return autoPick(found.list, movie, target, x[1], prefer && prefer.res).best;
        });
    }

    // This browser's speed to the server (Mbit/s) now, timed with the remux service's /gst/speedtest (random
    // bytes) for every Play: up to 4 MB, at most SPEED_MS from the request (headers included). null when it
    // can't tell (no remux service, an error). It was timed once per tab and kept in sessionStorage: a Mac tab
    // left open from a fast evening (2026-11-14) picked 1080p the next evening on a link carrying 2-3.5 Mbit/s,
    // and Safari gave up twice with "Media failed to decode" (The Phantom of the Opera, 2026-11-15 20:33 UTC,
    // no speedtest request that day). The search runs meanwhile (~6 s), so usually nothing waits on it.
    // any: the card's warm-up (choice), which takes the last timing of any age rather than 4 MB of a phone's
    // data for every title opened; a Play takes one started in the last SPEED_REUSE_MS (the warm-up's).
    // Nothing in SPEED_MS is a very slow link (the lowest release), not "can't tell" (which fits everything).
    // A browser that can't read a response as it comes (old TVs) gets the whole 4 MB, at most SPEED_OLD_MS.
    var SPEED_MS = 3000, SPEED_OLD_MS = 15000, SPEED_REUSE_MS = 60000, speedTest = null, speedAt = 0;
    function speed(any) {
        if (speedTest && (any || Date.now() - speedAt < SPEED_REUSE_MS)) return speedTest;
        var t0 = performance.now(), MAX = 4 << 20, got = 0, reader = null, over = false;
        var streams = !!(window.ReadableStream && window.Response && 'body' in Response.prototype);
        speedAt = Date.now();
        speedTest = new Promise(function (done) {
            var finish = function (failed) {
                if (over) return;
                over = true;
                clearTimeout(cap);
                if (reader) try { reader.cancel().catch(function () {}); } catch (e) {}
                var ms = performance.now() - t0;
                if (failed || !streams && got < MAX) return done(null);
                var mbps = Math.max(got, 1) * 8 / 1e6 / (ms / 1000);
                console.log('Ruby play', 'speed', mbps.toFixed(1), 'Mbit/s (' + (got / 1048576).toFixed(1) + ' MB in', Math.round(ms), 'ms)');
                done(mbps);
            };
            var cap = setTimeout(function () { finish(); }, streams ? SPEED_MS : SPEED_OLD_MS);
            fetch(Lampa.Torserver.url() + '/gst/speedtest?mb=4', { cache: 'no-store' }).then(function (r) {
                if (!r.ok) return finish(true);
                if (over) return;
                if (!streams || !r.body || !r.body.getReader) {
                    streams = false;
                    return r.arrayBuffer().then(function (b) { got = b.byteLength; finish(); });
                }
                reader = r.body.getReader();
                (function next() {
                    reader.read().then(function (x) {
                        if (x.done) return finish();
                        got += x.value.byteLength;
                        if (got >= MAX) return finish();
                        next();
                    }, function () { finish(); });
                })();
            }).catch(function () { finish(true); });
        });
        return speedTest;
    }

    // anime: English dub or Japanese with English subtitles, remembered per profile (ruby_anime_audio);
    // the stream asks the remux service for that audio (Torserver.stream, see init)
    var ANIME_AUDIO = 'ruby_anime_audio', streamLang = null;
    function animeAudio(movie) { return rubyPick.anime(movie) ? (Lampa.Storage.get(ANIME_AUDIO, 'en') === 'ja' ? 'ja' : 'en') : null; }

    // What plays (simplicity review 2026-10-20: Play no longer asks "Play in"): the screen's resolution, 4K only
    // where the screen has 2560+ physical pixels across, and no more than this connection carries with headroom
    // (else it keeps stopping to buffer); the lowest found when even that is too much. prefer.res (the player's
    // Quality menu) wins when that resolution was found. list: best resolution first (listOf).
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
    function autoPick(list, movie, target, mbps, want) {
        var exact = list.filter(function (c) { return c.res === want; })[0];
        if (exact) return exact;
        var big = screen.width * (window.devicePixelRatio || 1) >= 2560 || (airplayNear && tv4k());
        var fits = function (c) { return !mbps || rubyPick.bitrate(c.best, movie, target) * 1.3 <= mbps; };
        return list.filter(function (c) { return (big || c.res < 2160) && fits(c); })[0] || list[list.length - 1];
    }

    function choose(movie, target, found, back, mbps, download) {
        var list = found.list, audio = found.audio;
        streamLang = audio === 'ja' ? 'ja' : null;
        // a film not out at home yet (server/remux/pick.js notOut): whatever goes by its name is another film
        if (!list.length && found.notOut) return unavailable(movie, back, 'It isn\'t out to watch at home yet.' + (found.notOut === 'soon' ? '' :
            ' It comes out on ' + day(found.notOut, { day: 'numeric', month: 'long', year: 'numeric' }) + '.'));
        if (!list.length) return unavailable(movie, back, download ? 'There\'s no good English copy of it to download yet.' :
            'There\'s no good English copy of it yet. Try again in a few days.');
        // a download asks nothing: 1080p fits a phone (4K files are 10-20 GB), else 720p, else what there is
        // (the user's call, 2026-10-20)
        if (download) {
            var res = function (r) { return list.filter(function (x) { return x.res === r; })[0]; };
            return play(movie, target, (res(1080) || res(720) || list[0]).best, true);
        }
        var c = autoPick(list, movie, target, mbps, prefer && prefer.res);
        prefer = null;
        current = { movie: movie, list: list, groups: found.groups, upgrade: found.upgrade || {}, res: c.res, audio: audio, target: target, mbps: mbps };
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
    // what upgrade.js could move up to while this plays: the releases of resolutions above the one playing, up to
    // what this screen and connection take (autoPick), best first, then those that failed lately (the server hands
    // them out only for this: upgrade.js measures before it moves); `skip(release)` leaves one out. Nothing when the
    // player isn't on the title Play picked for (a release opened from Lampa's list since)
    function better(skip) {
        if (!current || !Lampa.Player.opened() || !playingIt()) return [];
        var res = {}, out = [];
        current.list.forEach(function (c) { res[c.res] = 1; });
        Object.keys(current.upgrade).forEach(function (r) { res[r] = 1; });
        var top = autoPick(current.list.concat(Object.keys(current.upgrade).map(function (r) { return { res: +r, best: current.upgrade[r][0] }; }))
            .sort(function (a, b) { return b.res - a.res; }), current.movie, current.target, current.mbps, null).res;
        Object.keys(res).map(Number).filter(function (r) { return r > current.res && r <= top; }).sort(function (a, b) { return b - a; }).forEach(function (r) {
            out = out.concat(current.groups[r] || [], current.upgrade[r] || []);
        });
        return out.filter(function (r) { return !skip || !skip(r); });
    }
    // the player's stream is for the title Play picked for (play.js puts its TMDB id in every stream it starts)
    function playingIt() {
        var m = /[?&]tmdb=(\d+)/.exec(window.rubySwap && rubySwap.stream() || '');
        return !!m && +m[1] === +current.movie.id;
    }

    // the release playing is more than this connection carries right now (compat.js: Safari gave up on it):
    // the next smaller resolution found, where it was (the user's call 2026-11-18), inside the open player
    // (swap.js) with no question. Until 2026-11-28 Safari was asked with a tap ("Play in 720p, from where you
    // are"), since a new <video> plays there only from one; swap.js keeps the <video>. The user, 2026-11-28: "I
    // don't want prompts or to choose myself". false when there is nothing smaller.
    function smaller() {
        if (!current || !Lampa.Player.opened() || !playingIt()) return false;
        var res = current.res, lower = current.list.filter(function (c) { return c.res < res; })[0];
        if (!lower) return false;
        console.log('Ruby play', 'too slow for', res + 'p: switching to', lower.res + 'p');
        Lampa.Noty.show('The connection is too slow for ' + rubyPick.LABEL[res] + ' right now. Playing ' + lower.label + '.');
        if (!window.rubySwap || !rubySwap.stream()) { switchTo({ res: lower.res }); return true; }
        // that resolution's releases in turn, then smaller ones; none: it plays on as it was (closing the player and
        // opening another left Safari's new <video> paused, iOS simulator 2026-11-28)
        var list = [];
        current.list.filter(function (c) { return c.res < res; }).forEach(function (c) { list = list.concat(current.groups[c.res] || []); });
        rubySwap.toAny(list.slice(0, 4), 12, 'smaller').catch(function (e) {
            console.log('Ruby play', 'no smaller release could be opened:', e.message);
            if (Lampa.Player.opened()) Lampa.Noty.show('No smaller release could be opened right now');
        });
        return true;
    }

    function play(movie, target, release, download) {
        pending = { target: target, files: [], at: Date.now(), movie: movie, download: download };
        entered = false;
        opened = movie;
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
        // the file Play entered itself is starting: Lampa's callback for when the player closes brings its file
        // list back up (Controller.toggle('modal')), a list nobody chose from ("some weird drawer" after backing
        // out of an episode, 2026-11-18). Close it through its own Back instead, which ends on the title page.
        if (e.type === 'onenter') {
            if (entered) Lampa.Player.callback(closeList);
            entered = false;
            return;
        }
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
            entered = true;     // Lampa's onenter comes after its preload, asynchronously
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

    function closeList() {
        if (!Lampa.Modal.opened()) return Lampa.Controller.toggle('content');
        Lampa.Controller.toggle('modal');
        Lampa.Controller.back();
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

    // ---- not out at home yet (server/remux/pick.js notOut): the title page's and billboard's Play are greyed
    // out and say when ("Out 17 Nov"); a click still says why (choose). Films only: a series' next episode is
    // the question there. Asked for 2026-10-22: keep such films in the rows, not Play into a knock-off.
    var LATER_MS = 6 * 3600e3, laters = {};
    function day(d, opts) { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', opts); }
    // later(movie, done): done('' | 'YYYY-MM-DD' | 'soon'); '' also when there's no remux to ask
    function later(movie, done) {
        if (!movie || !movie.id || movie.original_name || movie.name && !movie.title || !on() || !Lampa.Torserver.url()) return done('');
        var c = laters[movie.id];
        if (c && Date.now() - c.at < LATER_MS) return c.p.then(done);
        var p = fetch(Lampa.Torserver.url() + '/gst/home?tmdb=' + movie.id, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) { return j.notOut || ''; }, function () { return ''; });
        laters[movie.id] = { at: Date.now(), p: p };
        p.then(done);
    }
    // the button's words: "Out 17 Nov" (the year too when it isn't this one), "Coming soon"
    function laterLabel(v) {
        if (v === 'soon') return 'Coming soon';
        var opts = { day: 'numeric', month: 'short' };
        if (v.slice(0, 4) !== String(new Date().getFullYear())) opts.year = 'numeric';
        return 'Out ' + day(v, opts);
    }

    function css() {
        var s = document.createElement('style');
        s.id = 'ruby-play';
        s.textContent = [
            'body.ruby-autopicking .modal{opacity:0;pointer-events:none}',
            '.ruby-later{opacity:.55}'
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
        // The title's TMDB id goes along, for subtitles from OpenSubtitles (server/remux/opensubs.js) and the
        // server's memory of releases (releases.js). The page's card, else the title Play opened: a start from
        // Continue watching is on Home, which has none (Desperate Housewives S1E15 went without, 2026-10-20).
        var stream = Lampa.Torserver.stream;
        Lampa.Torserver.stream = function () {
            var u = stream.apply(this, arguments);
            if (!/\/gst\/.*master\.m3u8/.test(u)) return u;
            var a = Lampa.Activity.active() || {}, card = a.card || a.movie || opened;
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
        // a switch inside the player (swap.js): the resolution it plays now, for the Quality menu and better()
        rubySwap.follow(function (e) {
            if (e.type === 'swapped' && current) current.res = rubyPick.resolution(e.release.Title || '') || current.res;
        });
        Lampa.Player.listener.follow('start', function () { done(); untilPlaying(); });
        Lampa.Player.listener.follow('destroy', stopWatching);
        // the player's error screen is up (compat.js gave up): don't play the video again behind it
        Lampa.PlayerVideo.listener.follow('error', function (e) { if (e && e.fatal) stopWatching(); });
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
    // play(card): Play as on its title page (a series where you are), from Continue watching (continue.js)
    window.rubyPlay = { on: on, audio: animeAudio, download: function (movie, target) { start(movie, target, null, true); },
        qualities: qualities, switchTo: switchTo, smaller: smaller, episode: function (show, target) { start(show, target); },
        play: function (card) { start(card); } };
    // release(movie, target, release): open that release and start the same file (swarm.js, when one fails)
    rubyPlay.release = function (movie, target, release) { play(movie, target, release); };
    // ranked(movie): { <res>: [releases, best first] } Play chose from for this title, else null (swarm.js
    // switches to the next of these)
    // target(): the { season, episode } Play is opening (swarm.js: a pack's bitrate is per episode)
    rubyPlay.target = function () { return pending && pending.target || null; };
    // later(movie, done(notOut)), laterLabel(notOut): a film not out at home yet (resume.js, hero.js)
    rubyPlay.later = later;
    rubyPlay.laterLabel = laterLabel;
    // choice(movie, target): the release Play would start (warm.js warms it up)
    rubyPlay.choice = choice;
    rubyPlay.better = better;
    rubyPlay.ranked = function (movie) { return current && movie && current.movie.id === movie.id ? current.groups : null; };

    var timer = setInterval(function () {
        if (!window.Lampa || !Lampa.Activity || !Lampa.Api || !Lampa.Parser || !Lampa.Torrent || !Lampa.SettingsApi || !window.rubyPick || !window.rubyFacts || !window.rubyResume || !window.rubySwap) return;
        clearInterval(timer);
        init();
    }, 100);
})();
