// Warming up what Play would start, so it starts from a warm torrent (desktop/README.md "Warming up",
// server/remux/warm.js): the remux service adds the release, opens the file and makes its first 60 s from where
// it will start, before anyone presses Play.
//   * a title page you stay on for DWELL_MS: the release Play would start (rubyPlay.choice, the same pick, which
//     Play then reuses), at the episode and place Play would start from (resume.js)
//   * Continue watching: its first title (continue.js)
//   * while an episode plays: the next one in the player's playlist, once AFTER_S of this one has played
// One at a time; a newer ask replaces one still waiting. Only through the remux service, with
// "Pick torrents for me" on.
(function () {
    var DWELL_MS = 1500, AFTER_S = 60;
    var busy = false, queued = null, done = {};

    function url() { return Lampa.Torserver.url(); }
    function isShow(c) { return !!(c.original_name || c.first_air_date || c.number_of_seasons); }

    // q: the query for /gst/warm; key: what it warms (asked once per page load)
    function ask(key, q) {
        if (done[key]) return;
        if (busy) { queued = { key: key, q: q }; return; }
        busy = done[key] = true;
        var t0 = Date.now();
        fetch(url() + '/gst/warm?' + q, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
            console.log('Ruby warm', key, j.error || 'segments ' + j.segments.join('-') + (j.again ? ' (warm already)' : ''), 'in', Date.now() - t0, 'ms');
        }, function () {}).then(function () {
            busy = false;
            var n = queued;
            queued = null;
            if (n) ask(n.key, n.q);
        });
    }

    // the release Play would start for this title, where it would start (r: rubyResume's answer, when known)
    function title(card, r) {
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
                    place + (rubyPlay.audio(card) === 'ja' ? '&lang=ja' : ''));
            });
        };
        if (r) go(r); else if (isShow(card)) rubyResume.where(card, go); else go(rubyResume.film(card));
    }

    // the next item of the player's playlist, by the file its stream names
    function nextEpisode() {
        var P = Lampa.PlayerPlaylist, list = P.get() || [], next = P.canNext && P.canNext() ? list[P.position() + 1] : null;
        var m = next && /\/gst\/([0-9a-f]{40})\/master\.m3u8\?index=(\d+)/i.exec(next.url || '');
        if (m) ask(m[1].slice(0, 8) + ':' + m[2], 'hash=' + m[1] + '&index=' + m[2] + (/[?&]lang=ja\b/.test(next.url) ? '&lang=ja' : ''));
    }

    function init() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite' || !e.data || !e.data.movie) return;
            var card = e.data.movie;
            setTimeout(function () {
                var a = Lampa.Activity.active() || {};
                if (a.component === 'full' && a.card && a.card.id === card.id && !Lampa.Player.opened()) title(card);
            }, DWELL_MS);
        });
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

    // title(card[, resume answer]): warm up what Play would start for it (continue.js)
    window.rubyWarm = { title: title };

    var timer = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.PlayerPlaylist || !Lampa.Torserver ||
            !window.rubyPlay || !rubyPlay.choice || !window.rubyResume) return;
        clearInterval(timer);
        init();
    }, 100);
})();
