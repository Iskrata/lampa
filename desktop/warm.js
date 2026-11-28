// Warming up what Play would start, so it starts from a warm torrent (desktop/README.md "Warming up",
// server/remux/warm.js): the remux service adds the release, opens the file and makes its first 60 s from where
// it will start, before anyone presses Play.
//   * a title page you stay on for DWELL_MS: the release Play would start (rubyPlay.choice, the same pick, which
//     Play then reuses), at the episode and place Play would start from (resume.js)
//   * Continue watching: its first 3 titles, in order (continue.js)
//   * while an episode plays: the next one in the player's playlist, once AFTER_S of this one has played
//   * back on a title page from the player, as when opening it: what Play would start now (the saved place)
// One at a time. A title page's or next episode's ask goes first and replaces such an ask still waiting;
// Continue watching's 2nd and 3rd wait behind (later). Only through the remux service, with
// "Pick torrents for me" on.
(function () {
    // AGAIN_MS: the same warm-up is asked again after this long, as the remux service answers "warm already" for
    // 30 min (server/remux/warm.js AGAIN_MS) and a torrent left alone goes cold. Once per page load kept the Ruby
    // Mac app, open all day, from warming Desperate Housewives S3E20 at 14:03 UTC: it had warmed it at 08:59
    // (2026-11-27, the start then waited 59 s for a cold torrent)
    var DWELL_MS = 1500, AFTER_S = 60, AGAIN_MS = 30 * 60000;
    var busy = false, queue = [], done = {};   // key -> when it was asked

    function url() { return Lampa.Torserver.url(); }
    function isShow(c) { return !!(c.original_name || c.first_air_date || c.number_of_seasons); }

    // q: the query for /gst/warm; key: what it warms (asked once per page load); later: after the others, kept
    function ask(key, q, later) {
        if (Date.now() - (done[key] || 0) < AGAIN_MS) return;
        if (busy) {
            if (later) queue.push({ key: key, q: q, later: true });
            else queue = [{ key: key, q: q }].concat(queue.filter(function (x) { return x.later; }));
            return;
        }
        busy = true;
        done[key] = Date.now();
        var t0 = Date.now();
        fetch(url() + '/gst/warm?' + q, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
            console.log('Ruby warm', key, j.error || 'segments ' + j.segments.join('-') + (j.again ? ' (warm already)' : ''), 'in', Date.now() - t0, 'ms');
        }, function () {}).then(function () {
            busy = false;
            var n = queue.shift();
            if (n) ask(n.key, n.q, n.later);
        });
    }

    // the release Play would start for this title, where it would start (r: rubyResume's answer, when known;
    // later: see ask)
    function title(card, r, later) {
        if (!card || !card.id || !url() || !rubyPlay.on()) return;
        var go = function (r) {
            var target = isShow(card) ? { season: r.season, episode: r.episode } : null;
            // where Lampa will resume: its saved time (the percent of its own idea of the length landed a segment late:
            // 30 % of Breaking Bad S2E8 was 850 s, the saved place 845 s, 2026-10-26); Trakt's progress has only a percent
            var place = r.state !== 'continue' ? '' : r.time ? '&at=' + Math.floor(r.time) : r.percent ? '&pct=' + Math.round(r.percent) : '';
            rubyPlay.choice(card, target).then(function (rel) {
                var link = rel && (rel.MagnetUri || rel.Link);
                if (!link) return;
                ask(card.id + (target ? ' S' + target.season + 'E' + target.episode : ''), 'link=' + encodeURIComponent(link) +
                    '&title=' + encodeURIComponent(rel.Title || '') + (target ? '&season=' + target.season + '&episode=' + target.episode : '') +
                    place + (rubyPlay.audio(card) === 'ja' ? '&lang=ja' : ''), later);
            });
        };
        if (r) go(r); else if (isShow(card)) rubyResume.where(card, go); else go(rubyResume.film(card));
    }

    // the next item of the player's playlist, by the file its stream names
    function nextEpisode() {
        var P = Lampa.PlayerPlaylist, list = P.get() || [], next = P.canNext && P.canNext() ? list[P.position() + 1] : null;
        // in the release switched to, when the player moved to another (swap.js)
        var u = next && (window.rubySwap ? rubySwap.moveUrl(next.url) : next.url);
        var m = u && /\/gst\/([0-9a-f]{40})\/master\.m3u8\?index=(\d+)/i.exec(u);
        if (m) ask(m[1].slice(0, 8) + ':' + m[2], 'hash=' + m[1] + '&index=' + m[2] + (/[?&]lang=ja\b/.test(u) ? '&lang=ja' : ''));
    }

    // the title page `card` (or whichever is open), if it is still open and no player is, after DWELL_MS
    function dwell(card) {
        setTimeout(function () {
            var a = Lampa.Activity.active() || {};
            if (a.component === 'full' && a.card && (!card || a.card.id === card.id) && !Lampa.Player.opened()) title(a.card);
        }, DWELL_MS);
    }

    function init() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite' && e.data && e.data.movie) dwell(e.data.movie);
        });
        // closing the player shows the title page again without a new 'complite'; a release switch (swarm.js)
        // opens the next player within DWELL_MS
        Lampa.Player.listener.follow('destroy', function () { dwell(null); });
        // AFTER_S played since the start, not the position: a resumed episode is past 60 s at once, and the next
        // one's warm-up then competed with its start (Safari, Breaking Bad S2E8 resumed at 845 s, 2026-10-26: the
        // first segment past the warm ones took 37.7 s while the next episode opened)
        // A jump (the resume to the saved place, a seek) starts the count again
        var watched = false, from = null, last = 0;
        Lampa.Player.listener.follow('start', function () { watched = false; from = null; });
        Lampa.PlayerVideo.listener.follow('timeupdate', function () {
            var v = Lampa.PlayerVideo.video();
            if (watched || !v || v.paused || !url()) return;
            if (from === null || v.currentTime < last || v.currentTime - last > 5) from = v.currentTime;
            last = v.currentTime;
            if (v.currentTime - from < AFTER_S) return;
            watched = true;
            nextEpisode();
        });
    }

    // title(card[, resume answer[, later]]): warm up what Play would start for it (continue.js)
    window.rubyWarm = { title: title };

    var timer = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.PlayerPlaylist || !Lampa.Torserver ||
            !window.rubyPlay || !rubyPlay.choice || !window.rubyResume) return;
        clearInterval(timer);
        init();
    }, 100);
})();
