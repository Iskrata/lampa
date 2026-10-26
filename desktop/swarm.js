// Dead swarms (desktop/README.md, "Dead swarms"). Through the remux service (server/remux/swarm.js):
//   * lists: every torrent search (Play and the manual list both use Lampa.Parser.get) shows the real seeder
//     counts from trackers instead of the indexers' stale ones, and leaves out releases nobody seeds (0 on the
//     trackers) or that Ruby saw send nothing in the last 7 days
//   * opening: a release whose file list has no video in it (a fake: Clayface's 1080p releases were each one
//     .exe on 2026-10-20) or that nobody sends the file list of switches to the next one
//   * another film: the server refused it, its video's length isn't this title's (server/remux/pick.js
//     sameFilm): the next one, as many times as there are releases (each costs a few seconds of probing)
//   * playing: when the release stops sending (the remux says so) or can't keep up while the video waits, it
//     switches to the next best release of the same resolution and goes on at the same moment, up to 3 times
// Without the remux service (plain TorrServer) none of this runs.
(function () {
    var POLL_MS = 5000, ASK_MS = 2500, SLOW_STUCK_MS = 30000, START_STUCK_MS = 60000, MAX_SWITCHES = 3;
    // no file list this long after a release is opened: TorrServer found nobody to get the torrent's file list
    // from (Lampa itself gives up after 90 s with "torrent_parser_timeout")
    var LIST_MS = 45000;
    var last = null;        // { movie, results }: the last search, where the next release comes from
    var current = null;     // the release playing: { release, movie, target, hash, tried: [keys], switches, at }
    var carry = null;       // what a switch hands to the next release's start
    var watch = 0, listTimer = 0;

    // a plain TorrServer answers /gst/ with an error at once: the lists stay as they are
    function remux() { return !!Lampa.Torserver.url(); }

    // what was tried: the name and the hash (the same torrent is listed by several indexers under other names),
    // and the .torrent link of one without a hash (when the name doesn't count, nextRelease)
    function marks(r) {
        var h = rubyPick.hashOf(r);
        return [rubyPick.key(r.Title || r.title)].concat(h ? [h] : r.Link ? [r.Link] : []);
    }

    function ask(path) {
        var timeout = new Promise(function (r) { setTimeout(function () { r(null); }, ASK_MS); });
        return Promise.race([fetch(Lampa.Torserver.url() + '/gst/' + path, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; }, function () { return null; }), timeout]);
    }

    // real seeders in, dead releases out (rubyPick.alive)
    function check(results) {
        var known = rubyPick.twins(results);
        if (!known.hashes.length) return Promise.resolve(results);
        return ask('swarm?hash=' + known.hashes.join(',')).then(function (s) {
            if (!s) return results;
            var kept = rubyPick.alive(results, s, known);
            if (kept.length < results.length) console.log('Ruby swarm', 'left out', results.length - kept.length, 'dead releases of', results.length);
            return kept;
        });
    }

    function wrapParser() {
        var get = Lampa.Parser.get;
        Lampa.Parser.get = function (params, oncomplite, onerror) {
            var self = this, args = arguments;
            if (!remux()) return get.apply(self, args);
            return get.call(self, params, function (data) {
                check((data && data.Results) || []).then(function (kept) {
                    data.Results = kept;
                    last = { movie: params.movie, results: kept };
                    oncomplite(data);
                });
            }, onerror);
        };
    }

    // the release Lampa opens (Play's choice or a pick from the list)
    function wrapStart() {
        var start = Lampa.Torrent.start;
        Lampa.Torrent.start = function (release, movie) {
            var c = carry;
            carry = null;
            // the episode: a switch carries it, else Play's (without it a series pack's bitrate was worked out over
            // a film's 110 min: Friends S01-S10, 182 GB, "220.6 Mbit/s needed" instead of 2.2, 2026-10-20)
            var target = c ? c.target : window.rubyPlay && rubyPlay.target ? rubyPlay.target() : null;
            var cur = current = { release: release, movie: movie, target: target, hash: '', at: c ? c.at : 0,
                tried: (c ? c.tried : []).concat(marks(release)), switches: c ? c.switches : 0 };
            clearTimeout(listTimer);
            // still in Lampa's "loading torrent" window (not backed out of, no list, no player)
            listTimer = setTimeout(function () {
                if (current === cur && !cur.listed && !Lampa.Player.opened() && Lampa.Modal.opened()) switchRelease('nopeers');
            }, LIST_MS);
            return start.apply(this, arguments);
        };
        // the hash of a release given as a .torrent link (no hash in the search results): TorrServer tells it.
        // TorrServer refusing the add (its link failed: POST /torrents 400) is the next release at once. Lampa's
        // "no hash" window sat under the loading card, which said "Connecting…" until LIST_MS switched: 45 s
        // for Desperate Housewives S1E1 on 2026-10-26, its LimeTorrents link failing in Jackett (access log 16:54:00
        // add 400, 16:54:46 the next release added).
        var hash = Lampa.Torserver.hash;
        Lampa.Torserver.hash = function (params, oncomplite, onerror) {
            var cur = current;
            return hash.call(this, params, function (json) {
                if (cur && cur === current && json && json.hash) cur.hash = String(json.hash).toLowerCase();
                oncomplite.apply(this, arguments);
            }, function () {
                var r = onerror && onerror.apply(this, arguments);
                // once: closing Lampa's window aborts the request, which ends here again (it looped when there was
                // no next release)
                if (cur && cur === current && !cur.listed && !cur.refused) {
                    cur.refused = true;
                    setTimeout(function () { if (current === cur) switchRelease('nolink'); }, 0);
                }
                return r;
            });
        };
        Lampa.Listener.follow('torrent_file', function (e) {
            if (!current) return;
            if (e.type === 'list_open') current.listed = true;
            // nothing Lampa can play in it: it shows "Empty" right after this, which the switch closes
            if (e.type === 'list_open' && !(e.items || []).length) {
                var cur = current;
                setTimeout(function () { if (current === cur) switchRelease('nofiles'); }, 0);
            }
            if (e.type === 'onenter' && e.element && e.element.episode)
                current.target = { season: +e.element.season, episode: +e.element.episode };
        });
    }

    // the next release of the same resolution: Play's ranking (the server's or this browser's), else the
    // ranking of the last search (a release picked from the list), without the ones tried
    // A fake goes by a real release's name (Clayface's four 1080p were all "...-FLUX", three of them one .exe
    // each): after one, the others of that name are tried, by hash.
    function nextRelease(why) {
        var c = current, movie = c.movie || {};
        var tried = why === 'nofiles' ? c.tried.filter(function (m) { return m !== rubyPick.key(c.release.Title || c.release.title); }) : c.tried;
        var res = rubyPick.resolution(c.release.Title || c.release.title || '');
        var groups = rubyPlay.ranked(movie);
        if (!groups && last && last.movie && last.movie.id === movie.id)
            groups = rubyPick.ranked(last.results, movie, c.target, rubyPlay.audio ? rubyPlay.audio(movie) : null);
        return ((groups || {})[res] || []).filter(function (r) { return !marks(r).some(function (m) { return tried.indexOf(m) >= 0; }); })[0] || null;
    }

    // the server remembers it for the title: never offered for it again (server/remux/releases.js). A dead one
    // it saw itself.
    function report(c, why) {
        var h = c.hash || rubyPick.hashOf(c.release), movie = c.movie || {};
        // a link that failed may work again (LimeTorrents refuses bursts): not remembered
        if (!h || !movie.id || why === 'dead' || why === 'other' || why === 'nolink') return;
        fetch(Lampa.Torserver.url() + '/gst/pick/failed?hash=' + h + '&tmdb=' + movie.id + '&kind=' +
            (movie.original_name || movie.name && !movie.title ? 'tv' : 'movie') + '&why=' + why +
            '&title=' + encodeURIComponent(c.release.Title || c.release.title || ''), { method: 'POST' }).catch(function () {});
    }

    function stop() { clearInterval(watch); watch = 0; }

    function switchRelease(why) {
        stop();
        // a switch away from another film or a link that failed isn't the swarm's fault and costs no wait: it
        // doesn't count (the list runs out instead)
        var free = why === 'other' || why === 'nolink';
        var c = current, next = c && (free || c.switches < MAX_SWITCHES) ? nextRelease(why) : null;
        var v = Lampa.PlayerVideo.video(), at = v && v.currentTime > 5 ? v.currentTime : c && c.at || 0;
        var what = why === 'dead' ? 'This release stopped sending' : why === 'nopeers' ? 'Nobody is sharing this release' :
            why === 'nofiles' ? 'This release has no video in it' : why === 'nolink' ? "This release couldn't be fetched" : why === 'other' ? 'This release is a different film with the same name' :
            'This release is too slow to play';
        console.log('Ruby swarm', why, c && c.hash, 'at', Math.round(at), 'next:', next && next.Title);
        if (c) report(c, why);
        if (!next) {
            // still in Lampa's window (loading, or its "Empty"): close it, or Lampa's own message stays (or comes
            // at 90 s, "Timeout expired")
            if (!Lampa.Player.opened() && Lampa.Controller.enabled().name === 'modal') Lampa.Controller.back();
            return Lampa.Noty.show(what + ', and there is no other ' + (c ? rubyPick.resolution(c.release.Title || '') + 'p' : '') + ' release to switch to');
        }
        carry = { target: c.target, at: at, tried: c.tried.concat(marks(next), c.hash ? [c.hash] : []), switches: c.switches + (free ? 0 : 1) };
        Lampa.Noty.show(what + ': switching to ' + (rubyPick.describe(next.Title) || 'another release') + ' · ' + next.Seeders + ' seeders');
        if (Lampa.Player.opened()) Lampa.Player.close();
        // the player closes back to Lampa's file list (or it's still the loading window); its Back closes it and
        // drops the old torrent
        setTimeout(function () {
            if (Lampa.Controller.enabled().name === 'modal') Lampa.Controller.back();
            setTimeout(function () { rubyPlay.release(c.movie, c.target, next); }, 300);
        }, 300);
    }

    // While the player is open: the remux's heartbeat says when the torrent is dead; a video that waits for the
    // torrent (the remux holds one of its requests: Swarm.waiting) while it downloads slower than the release's
    // bitrate is too slow. A video that waits while the torrent keeps up is this device's own connection, and
    // one that asks for nothing is this device not loading it (compat.js says so): no switch. On 2026-10-20 an
    // iPhone that never asked for a segment (Safari refused to load the video) got Desperate Housewives' S1 pack
    // and the next release called too slow, so neither was offered again. The clock starts when the player has
    // its stream: compat.js reads the master first, which can take a minute (a0191e41, 61 s, then switched 3 s
    // into playing, iOS 27 simulator the same day).
    function begin(data) {
        stop();
        var m = /\/gst\/([0-9a-f]{40})\//i.exec(data && data.url || '');
        if (!current || !m) return;
        current.hash = m[1].toLowerCase();
        var c = current, played = false, lastTime = -1, stuckSince = Date.now(), slowSince = stuckSince, seekTo = c.at;
        // a switch goes on where the last release stopped, whatever Settings → Player → timecode says
        if (seekTo && data.timeline) data.timeline.continued = true;
        var need = rubyPick.bitrate(c.release, c.movie || {}, c.target) || 0;
        watch = setInterval(function () {
            var v = Lampa.PlayerVideo.video();
            if (!v) return;
            if (seekTo && v.duration > 0) { Lampa.PlayerVideo.to(seekTo); seekTo = c.at = 0; }
            var moving = v.currentTime !== lastTime && !v.paused && v.readyState >= 3;
            if (moving && v.currentTime > 0.2) played = true;
            lastTime = v.currentTime;
            if (moving || (played && v.paused)) stuckSince = Date.now();
            if (moving || (played && v.paused) || !v.currentSrc) slowSince = Date.now();
            ask(c.hash + '/heartbeat').then(function (h) {
                if (!h || current !== c || !watch) return;
                var stuck = Date.now() - stuckSince, slow = Date.now() - slowSince, mbps = (h.Torrent && h.Torrent.download_speed || 0) * 8 / 1e6;
                // (a remux older than Swarm.waiting: as before)
                var held = !h.Swarm || h.Swarm.waiting == null || h.Swarm.waiting > 0;
                if (h.Swarm && h.Swarm.dead && stuck > POLL_MS) return switchRelease('dead');
                if (slow > (played ? SLOW_STUCK_MS : START_STUCK_MS) && held && need && mbps < need) return switchRelease('slow');
            });
        }, POLL_MS);
        console.log('Ruby swarm', 'watching', c.hash, need ? need.toFixed(1) + ' Mbit/s needed' : '');
    }

    // compat.js, when the server couldn't open the file because the torrent sent too little (its probe's 90 s
    // ran out, or 75 s of reading): the next release, as for one too slow to play. False when there's none or
    // the stream isn't this release's: compat.js shows its error then. Before, the player showed the error and
    // stopped: Desperate Housewives' S1 pack, 1-2 peers for its first 20 s, took over 90 s to open S1E15 on a
    // Windows PC and 44 s when tried again (2026-10-20), while its other 1080p release was never tried.
    function unopened(url, why) {
        var m = /\/gst\/([0-9a-f]{40})\//i.exec(url || ''), c = current;
        if (!c || !m || c.hash && c.hash !== m[1].toLowerCase() || why !== 'other' && c.switches >= MAX_SWITCHES || !nextRelease(why)) return false;
        c.hash = m[1].toLowerCase();
        switchRelease(why);
        return true;
    }
    window.rubySwarm = { unopened: unopened };

    function init() {
        wrapParser();
        wrapStart();
        Lampa.Player.listener.follow('start', begin);
        Lampa.Player.listener.follow('destroy', stop);
    }

    var timer = setInterval(function () {
        if (!window.Lampa || !Lampa.Parser || !Lampa.Torrent || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.Torserver || !window.rubyPick || !window.rubyPlay) return;
        clearInterval(timer);
        init();
    }, 100);
})();
