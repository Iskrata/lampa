// Dead swarms (desktop/README.md, "Dead swarms"). Through the remux service (server/remux/swarm.js):
//   * lists: every torrent search (Play and the manual list both use Lampa.Parser.get) shows the real seeder
//     counts from trackers instead of the indexers' stale ones, and leaves out releases nobody seeds (0 on the
//     trackers) or that Ruby saw send nothing in the last 7 days
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

    function hashOf(r) {
        var h = r.InfoHash || (/btih:([0-9a-f]{40})/i.exec(r.MagnetUri || r.Link || '') || [])[1];
        return h && /^[0-9a-f]{40}$/i.test(h) ? h.toLowerCase() : '';
    }
    // what was tried: the name and the hash (the same torrent is listed by several indexers under other names)
    function marks(r) { var h = hashOf(r); return [key(r.Title || r.title)].concat(h ? [h] : []); }
    // the same release on another indexer: "Spider Man No Way Home 2021 1080p ... WiKi" = "Spider-Man.No.Way.Home.2021.1080p....-WiKi"
    function key(t) { return (t || '').toLowerCase().replace(/^www\.\S+\s+-\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
    function same(a, b) { return !a.size || !b.size || Math.abs(a.size - b.size) / Math.max(a.size, b.size) < 0.02; }

    function ask(path) {
        var timeout = new Promise(function (r) { setTimeout(function () { r(null); }, ASK_MS); });
        return Promise.race([fetch(Lampa.Torserver.url() + '/gst/' + path, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; }, function () { return null; }), timeout]);
    }

    // real seeders in, dead releases out. A release without a hash (a .torrent link) takes its twin's: the
    // same name and size on an indexer that gives one.
    function check(results) {
        var twins = {};
        results.forEach(function (r) { var h = hashOf(r); if (h) twins[key(r.Title)] = { hash: h, size: r.Size }; });
        var hashes = Object.keys(twins).map(function (k) { return twins[k].hash; });
        results.forEach(function (r) { var h = hashOf(r); if (h && hashes.indexOf(h) < 0) hashes.push(h); });
        if (!hashes.length) return Promise.resolve(results);
        return ask('swarm?hash=' + hashes.join(',')).then(function (s) {
            if (!s) return results;
            var dead = {}, deadKeys = [];
            (s.dead || []).forEach(function (d) { dead[d.hash] = true; deadKeys.push({ key: key(d.title), size: d.size }); });
            var kept = results.filter(function (r) {
                var k = key(r.Title), twin = twins[k], h = hashOf(r) || (twin && same(twin, { size: r.Size }) ? twin.hash : '');
                if (h ? dead[h] : deadKeys.some(function (d) { return d.key === k && same(d, { size: r.Size }); })) return false;
                var n = h && s.seeders ? s.seeders[h] : null;
                if (n === 0) return false;
                if (n != null) r.Seeders = n;
                return true;
            });
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
            var cur = current = { release: release, movie: movie, target: c ? c.target : null, hash: '', at: c ? c.at : 0,
                tried: (c ? c.tried : []).concat(marks(release)), switches: c ? c.switches : 0 };
            clearTimeout(listTimer);
            // still in Lampa's "loading torrent" window (not backed out of, no list, no player)
            listTimer = setTimeout(function () {
                if (current === cur && !cur.listed && !Lampa.Player.opened() && Lampa.Modal.opened()) switchRelease('nopeers');
            }, LIST_MS);
            return start.apply(this, arguments);
        };
        Lampa.Listener.follow('torrent_file', function (e) {
            if (!current) return;
            if (e.type === 'list_open') current.listed = true;
            if (e.type === 'onenter' && e.element && e.element.episode)
                current.target = { season: +e.element.season, episode: +e.element.episode };
        });
    }

    // the next release of the same resolution: Play's ranking of the last search, without the ones tried
    function nextRelease() {
        var c = current, movie = c.movie || {};
        if (!last || !last.movie || last.movie.id !== movie.id || !window.rubyPick) return null;
        var res = rubyPick.resolution(c.release.Title || c.release.title || '');
        var audio = window.rubyPlay && rubyPlay.audio ? rubyPlay.audio(movie) : null;
        var list = (rubyPick.ranked(last.results, movie, c.target, audio)[res] || []);
        return list.filter(function (r) { return !marks(r).some(function (m) { return c.tried.indexOf(m) >= 0; }); })[0] || null;
    }

    function stop() { clearInterval(watch); watch = 0; }

    function switchRelease(why) {
        stop();
        var c = current, next = c && c.switches < MAX_SWITCHES ? nextRelease() : null;
        var v = Lampa.PlayerVideo.video(), at = v && v.currentTime > 5 ? v.currentTime : c && c.at || 0;
        var what = why === 'dead' ? 'This release stopped sending' : why === 'nopeers' ? 'Nobody is sharing this release' : 'This release is too slow to play';
        console.log('Ruby swarm', why, c && c.hash, 'at', Math.round(at), 'next:', next && next.Title);
        if (!next) return Lampa.Noty.show(what + ', and there is no other ' + (c ? rubyPick.resolution(c.release.Title || '') + 'p' : '') + ' release to switch to');
        carry = { target: c.target, at: at, tried: c.tried.concat(marks(next), c.hash ? [c.hash] : []), switches: c.switches + 1 };
        Lampa.Noty.show(what + ': switching to ' + (rubyPick.describe(next.Title) || 'another release') + ' · ' + next.Seeders + ' seeders');
        if (Lampa.Player.opened()) Lampa.Player.close();
        // the player closes back to Lampa's file list (or it's still the loading window); its Back closes it and
        // drops the old torrent
        setTimeout(function () {
            if (Lampa.Controller.enabled().name === 'modal') Lampa.Controller.back();
            setTimeout(function () { rubyPlay.release(c.movie, c.target, next); }, 300);
        }, 300);
    }

    // While the player is open: the remux's heartbeat says when the torrent is dead; a video that waits while
    // the torrent downloads slower than the release's bitrate is too slow. A video that waits while the
    // torrent keeps up is this device's own connection: no switch.
    function begin(data) {
        stop();
        var m = /\/gst\/([0-9a-f]{40})\//i.exec(data && data.url || '');
        if (!current || !m) return;
        current.hash = m[1].toLowerCase();
        var c = current, played = false, lastTime = -1, stuckSince = Date.now(), seekTo = c.at;
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
            ask(c.hash + '/heartbeat').then(function (h) {
                if (!h || current !== c || !watch) return;
                var stuck = Date.now() - stuckSince, mbps = (h.Torrent && h.Torrent.download_speed || 0) * 8 / 1e6;
                if (h.Swarm && h.Swarm.dead && stuck > POLL_MS) return switchRelease('dead');
                if (stuck > (played ? SLOW_STUCK_MS : START_STUCK_MS) && need && mbps < need) return switchRelease('slow');
            });
        }, POLL_MS);
        console.log('Ruby swarm', 'watching', c.hash, need ? need.toFixed(1) + ' Mbit/s needed' : '');
    }

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
