// Changing the release under the open player, with no tap and no question (desktop/README.md "Switching releases
// while playing"). The user, 2026-11-28, after Desperate Housewives S3E20 stalled at 0:08 with its only 1080p
// release too slow and three 720p ones never tried: "it should've auto switched to a better one ... I don't want
// prompts or to choose myself".
//   prepare(release, at, secs): the remux service adds the release, opens the same episode (by the playing file's
//     name: /gst/warm like=), finds the moment `at` of the playing video in it (its cut may differ: server/remux/
//     align.js) and makes `secs` of it from there. -> { url, hash, index, made, seconds, duration, at, shift, aligned }
//   apply(p, at, release, why): the player plays p.url from `at` (in the new release's time), in the same <video>
// The same <video>: Safari plays a new one only from a tap (desktop/README.md "A start Safari refused"), so closing
// the player and opening the next release, as switches did until now, left Safari waiting for one. Lampa's own
// picture-in-picture path keeps the element: PlayerVideo.destroy(savemeta, keepPip) leaves it in place and the
// next PlayerVideo.url() takes it as it is (create$9's retainedPipVideo), without binding Lampa's listeners twice.
// Lampa's playlist (the next episodes) still names the old torrent: its later starts are sent to the same episode
// in the new one (remap).
(function () {
    var RE = /\/gst\/([0-9a-f]{40})\/master\.m3u8\?index=(\d+)/i;
    var PREPARE_MS = 150000;   // the warm-up's file list (60 s) and open (the probe, 90 s) at most
    var stream = '';           // the stream the player has now
    var followers = [];
    var early = null;          // { key, stream, at: when, promise }: a release readied ahead of a switch (ready)
    var moved = {};            // old hash -> { hash, files: { old index: new index } } (remap)

    function base() { return Lampa.Torserver.url(); }
    function send(e) { followers.forEach(function (f) { try { f(e); } catch (x) { console.log('Ruby swap', 'follower', x.message); } }); }

    // S03E20, 3x20 (server/remux/warm.js episodeOf)
    function episodeOf(p) {
        var m = /s(\d{1,2})[ ._-]?e(\d{1,3})/i.exec(p) || /\b(\d{1,2})x(\d{2,3})\b/i.exec(p);
        return m ? +m[1] + 'x' + +m[2] : null;
    }

    function files(hash) {
        return fetch(base() + '/torrents', { method: 'POST', body: JSON.stringify({ action: 'get', hash: hash }) })
            .then(function (r) { return r.json(); }).then(function (t) { return (t && t.file_stats) || []; }, function () { return []; });
    }

    function prepare(release, at, secs) {
        var m = RE.exec(stream), link = release && (release.MagnetUri || release.Link);
        if (!m || !link) return Promise.reject(new Error(m ? 'no link' : 'not a remux stream'));
        var q = 'link=' + encodeURIComponent(link) + '&title=' + encodeURIComponent(release.Title || '') + '&like=' + m[1] + ':' + m[2] +
            '&at=' + Math.floor(at || 0) + '&secs=' + (secs || 60) + (/[?&]lang=ja\b/.test(stream) ? '&lang=ja' : '');
        var late = new Promise(function (r, no) { setTimeout(function () { no(new Error('no answer in ' + PREPARE_MS / 1000 + ' s')); }, PREPARE_MS); });
        var ask = function (again) {
            return fetch(base() + '/gst/warm?' + q, { cache: 'no-store' }).then(function (r) {
                // two warm-ups run at a time (a next episode's may be one): once more a little later
                if (r.status === 429 && !again) return new Promise(function (ok) { setTimeout(ok, 4000); }).then(function () { return ask(true); });
                return r.json().then(function (j) {
                    if (!r.ok || !j.hash) throw new Error(j.error || 'warm ' + r.status);
                    return j;
                });
            });
        };
        return Promise.race([ask(false), late]).then(function (j) {
            // Torserver.stream: play.js adds the title's id (and the anime audio) to it, as to every stream
            j.url = Lampa.Torserver.stream('', j.hash, j.index);
            return j;
        });
    }

    function apply(p, at, release, why, announced) {
        var old = stream, m = RE.exec(old), v = Lampa.PlayerVideo.video();
        if (!Lampa.Player.opened() || !m) return false;
        if (!announced) send({ type: 'swapping', release: release, why: why });
        console.log('Ruby swap', why, m[1].slice(0, 8), '->', p.hash.slice(0, 8), 'at', Math.round(at),
            p.aligned ? '(' + p.aligned + ', shift ' + p.shift + ' s)' : '');
        // where the new stream starts (startat.js: hls.js's startPosition, Safari's time right after load())
        if (window.rubyStartAt) rubyStartAt.next(at);
        // player.js passes Safari's late subtitle tracks on once per <video>: this one gets new tracks
        if (v) v._rubySubsSeen = false;
        Lampa.PlayerVideo.destroy(true, true);
        Lampa.PlayerVideo.url(p.url, true);
        stream = p.url;
        // the old torrent stops downloading on the home server (Lampa drops only the one it opened, when it closes),
        // once its file list is read for the playlist: TorrServer lists no files for a torrent it holds only in its
        // database (an empty map would send the next episode back to the release switched away from)
        var oldHash = m[1].toLowerCase();
        remember(oldHash, p.hash.toLowerCase()).then(function () { Lampa.Torserver.drop(oldHash, function () {}, function () {}); });
        send({ type: 'swapped', url: p.url, hash: p.hash.toLowerCase(), old: m[1].toLowerCase(), release: release, why: why });
        return true;
    }

    function keyOf(release) { return (release.MagnetUri || release.Link || release.Title || '') + ''; }

    // the next release readied while the playing one only falls behind (swarm.js, before it calls it too slow): a
    // cold file takes as long to open as a cold start (167a5870, Desperate Housewives' S01-08 720p pack: its probe
    // 77.5 s on 2026-11-28), and the video waits that long only if the switch waits to begin it. to() takes it
    // when it is that release and the player still plays the same stream, within READY_MS
    var READY_MS = 180000;
    function ready(release, secs) {
        var v = Lampa.PlayerVideo.video(), k = keyOf(release);
        if (early && early.key === k && early.stream === stream && Date.now() - early.at < READY_MS) return;
        var e = early = { key: k, stream: stream, at: Date.now(), t: v ? v.currentTime : 0, promise: prepare(release, v ? v.currentTime : 0, secs) };
        e.promise.catch(function () { if (early === e) early = null; });
        console.log('Ruby swap', 'readying', release.Title);
    }

    // prepare, then apply where the video is by then (a switch away from a release that stalls). 'swapping' goes
    // out first: the watchers of the old stream (swarm.js, compat.js) stand down while the next one is readied,
    // which can take minutes for a cold torrent; 'failed' when it can't be
    function to(release, secs, why) {
        var v = Lampa.PlayerVideo.video(), from = stream, at = v ? v.currentTime : 0, e = early;
        send({ type: 'swapping', release: release, why: why });
        var readied = e && e.key === keyOf(release) && e.stream === stream && Date.now() - e.at < READY_MS;
        early = null;
        return (readied ? e.promise : prepare(release, at, secs)).then(function (p) {
            var now = Lampa.PlayerVideo.video();
            if (stream !== from || !Lampa.Player.opened()) throw new Error('the player moved on');
            // where the video is by now, moved onto the new release's time
            if (!apply(p, Math.max((now ? now.currentTime : at) + (p.shift || 0), 0), release, why, true)) throw new Error('not applied');
            return p;
        }).catch(function (e) {
            if (stream === from && Lampa.Player.opened()) send({ type: 'failed', url: from, release: release, why: why });
            throw e;
        });
    }

    // the first of `list` that can be opened, each in turn (to()); when none can, the player plays on as it was
    // each(r): told before each is tried (swarm.js marks it tried then, not before)
    function toAny(list, secs, why, each) {
        var i = 0, from = stream;
        var next = function () {
            if (i >= list.length) return Promise.reject(new Error('none of ' + list.length + ' could be opened'));
            var r = list[i++];
            if (each) each(r);
            return to(r, secs, why).then(function (p) { p.release = r; return p; }, function (e) {
                console.log('Ruby swap', (r.Title || '').slice(0, 60), 'failed:', e.message);
                if (stream !== from || !Lampa.Player.opened()) throw e;
                return next();
            });
        };
        return next();
    }

    // the old torrent's files -> the new one's, by episode, for Lampa's playlist (a film has none to send on).
    // One hop per switch; remap follows them. The torrent playing now leads nowhere (a switch back up to the first
    // release would otherwise send its episodes round in a circle).
    function remember(old, hash) {
        delete moved[hash];
        var hop = moved[old] = { hash: hash, files: null };
        return Promise.all([files(old), files(hash)]).then(function (both) {
            var to = {}, map = {};
            both[1].forEach(function (f) { var e = episodeOf((f.path || '').split('/').pop()); if (e) to[e] = f.id; });
            both[0].forEach(function (f) { var e = episodeOf((f.path || '').split('/').pop()); if (e && to[e] != null) map[f.id] = to[e]; });
            hop.files = map;
        });
    }

    // a stream of a torrent switched away from: the same episode in the release it went to
    function moveUrl(u) {
        var m = RE.exec(u || ''), hops = 0;
        while (m && moved[m[1].toLowerCase()] && hops++ < 4) {
            var mv = moved[m[1].toLowerCase()], to = mv.files && mv.files[m[2]];
            if (to == null) break;
            u = u.replace(m[1], mv.hash).replace(/([?&]index=)\d+/, '$1' + to);
            m = RE.exec(u);
        }
        return u;
    }

    // a start from Lampa's playlist on a torrent switched away from
    function remap(data) {
        var u = moveUrl(data && data.url);
        if (data && u !== data.url) { console.log('Ruby swap', 'playlist', data.url, '->', u); data.url = u; }
        stream = (data && data.url) || '';
    }

    function init() {
        // registered before the other modules' 'start' (index.html loads this first): they read the remapped url
        Lampa.Player.listener.follow('start', remap);
        Lampa.Player.listener.follow('destroy', function () { stream = ''; });
    }

    // follow(fn): fn({ type: 'swapping' | 'swapped' | 'failed', url, hash, old, release, why })
    // moveUrl(url): that stream in the release switched to (warm.js warms the next episode there)
    window.rubySwap = { prepare: prepare, apply: apply, to: to, toAny: toAny, ready: ready, moveUrl: moveUrl, follow: function (f) { followers.push(f); },
        stream: function () { return stream; } };

    var timer = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.Player.listener || !Lampa.PlayerVideo || !Lampa.Torserver) return;
        clearInterval(timer);
        init();
    }, 100);
})();
