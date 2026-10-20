// Starts the release "Play in" has selected while the question is open (desktop/README.md, "Play"). Starting
// a torrent waits mostly on TorrServer finding peers (server/remux/README.md, "Why starting takes longer than
// a seek"); this puts the seconds spent on the question towards that. It does what pressing Enter would: adds
// the torrent as Lampa does (Torserver.hash, so TorrServer lists it the same), waits for its file list, and,
// through the remux, asks for the master playlist of the file play.js will pick, so the probe and the index
// are done when the player asks for the same master. Picking another line or going back drops it again
// through the remux, unless someone is reading it (another viewer of the same release); without the remux
// nothing tells, so TorrServer disconnects it by itself (30 s after its last reader on ruby).
// rubyWarm.start(release, movie, target) / .keep(release) (the line chosen) / .cancel(). Runs where play.js does.
(function () {
    var warm = null;   // { release, movie, target, hash, file, asked: { lang: true }, timer }

    // what Lampa sends for a release (torrent.js hash()); play.js prepares the release the same way
    function object(release, movie) {
        return { title: release.title, link: release.MagnetUri || release.Link, poster: release.poster,
            data: { lampa: true, movie: movie } };
    }

    // Lampa.Torserver.connected, .hash and .files abort that object's other requests: called only while the question is
    // open, when Lampa has none (stop() ends them before Lampa opens the release)
    function start(release, movie, target) {
        if (warm && warm.release === release) return ask(warm);   // the same line again (the anime audio switched)
        cancel();
        var w = warm = { release: release, movie: movie, target: target, hash: '', file: null, asked: {}, timer: 0 };
        // connected first, as Lampa does (torrent.js connect): it also checks the remux (gstWork), which until
        // then reads false in a page that hasn't opened a torrent yet
        Lampa.Torserver.connected(function () {
            if (warm !== w) return;
            Lampa.Torserver.hash(object(release, movie), function (json) {
                if (warm !== w || !json || !json.hash) return;
                w.hash = json.hash;
                files(w, 0);
            }, function () {});
        }, function () {});
    }

    // the file list comes once TorrServer has the torrent's metadata from peers. Torserver.files answers only
    // when it's there (nothing otherwise), so the next ask is set up before each one.
    function files(w, tries) {
        if (warm !== w || tries > 45) return;   // 90 s, as Lampa waits
        w.timer = setTimeout(function () { files(w, tries + 1); }, 2000);   // its timeout is 2 s
        Lampa.Torserver.files(w.hash, function (json) {
            if (warm !== w || w.file) return;
            clearTimeout(w.timer);
            // the names as Lampa's file list reads them (torrent.js show/list): episode numbers for a series
            var plays = Lampa.Torserver.clearFileName(json.file_stats.slice());
            plays.forEach(function (f) {
                var info = Lampa.Torserver.parse({ movie: w.movie, files: plays, filename: f.path_human, path: f.path });
                f.season = info.season;
                f.episode = info.episode;
            });
            w.file = rubyPick.file(plays, w.target);
            ask(w);
        }, function () {});
    }

    // the master for this file in the audio play.js will ask for (Torserver.stream adds the title and language),
    // once per language. Only through the remux: without it the player streams the file itself.
    function ask(w) {
        if (!w.file || !Lampa.Torserver.gstWork()) return;
        var url = Lampa.Torserver.stream(w.file.path, w.hash, w.file.id), lang = (/[?&]lang=(\w+)/.exec(url) || [])[1] || 'en';
        if (w.asked[lang]) return;
        w.asked[lang] = true;
        fetch(url, { cache: 'no-store' }).catch(function () {});
    }

    // the line chosen: the release warmed stays (Lampa opens it next), any other is dropped
    function keep(release) {
        if (warm && warm.release !== release) cancel();
        else stop();
    }

    function stop() {
        if (warm) clearTimeout(warm.timer);
        warm = null;
    }

    function cancel() {
        var w = warm;
        stop();
        if (!w || !w.hash) return;
        var hash = w.hash;
        if (!Lampa.Torserver.gstWork()) return;
        // the remux's heartbeat has TorrServer's readers of this torrent: someone else may be watching it.
        // Not through Lampa.Torserver: its requests share one object that each of Lampa's next calls aborts.
        var gst = Lampa.Torserver.url() + '/gst/';
        fetch(gst + encodeURIComponent(hash) + '/heartbeat', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!(j.Readers && j.Readers.length)) return fetch(gst + 'remove?hash=' + encodeURIComponent(hash), { cache: 'no-store' });
            }).catch(function () {});
    }

    window.rubyWarm = { start: start, keep: keep, cancel: cancel };
})();
