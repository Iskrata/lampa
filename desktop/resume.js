// Where you are in a series (desktop/README.md, "Where you are in a series"). Loaded by index.html before
// play.js. rubyResume.where(show) reads the progress Lampa already saves per episode (Lampa.Timeline,
// file_view, which profiles.js keeps per profile) and says what to play next: the episode last watched if
// it isn't finished, else the one after it, else S1 E1. Without any progress here, the profile's Trakt
// progress (rubyTrakt.showProgress) stands in. A series' title page shows it: the Play button says
// "Continue S2 E5" / "Play S2 E6", and a line under the ratings says "S2 E5 · 23 min left". That line takes
// the place of the Trakt plugin's watched status ("Unwatched"), whose menu still opens on click. play.js's
// Play starts the same episode. Runs everywhere play.js does (TV too).
(function () {
    // an episode at or past this is finished: Lampa's player doesn't resume it either (app.min.js player
    // Timeline init: it seeks to the saved time only while percent < 90)
    var FINISHED = 90;
    var shows = {};        // TMDB id -> the show's details (seasons, last aired episode), for the session
    var traktSeen = {};    // TMDB id -> { at, progress }: Trakt asked at most once a minute per show

    // the key Lampa saves an episode's progress under (its torrent/online players hash the same string)
    function hash(card, s, e) {
        return Lampa.Utils.hash([s, s > 10 ? ':' : '', e, card.original_name || card.original_title].join(''));
    }

    // a card from a list (the billboard) has no seasons: the show's TMDB details have them
    function details(card, done) {
        if (card.seasons && card.seasons.length && 'last_episode_to_air' in card) return done(card);
        if (shows[card.id]) return done(shows[card.id]);
        rubyDesktop.tmdb('tv/' + card.id, function (d) {
            if (d && d.seasons) shows[card.id] = d;
            done(d && d.seasons ? d : card);
        });
    }

    // every aired episode in order, as TMDB numbers them (seasons' episode counts up to the last aired one)
    function aired(d) {
        var last = d.last_episode_to_air, out = [];
        (d.seasons || []).slice().sort(function (a, b) { return a.season_number - b.season_number; }).forEach(function (s) {
            var n = s.episode_count || 0;
            if (!s.season_number) return;   // specials
            if (last && s.season_number > last.season_number) n = 0;
            else if (last && s.season_number === last.season_number) n = Math.min(n, last.episode_number);
            for (var e = 1; e <= n; e++) out.push({ season: s.season_number, episode: e });
        });
        return out;
    }

    function runtime(d) {
        var r = (d.episode_run_time && d.episode_run_time[0]) || (d.last_episode_to_air && d.last_episode_to_air.runtime);
        return r ? r * 60 : 0;
    }

    // -> { state: 'new'|'continue'|'next'|'done', season, episode (what to play), percent, left (s),
    //      last: {season, episode} (last watched), count (aired episodes), from: 'lampa'|'trakt'|null }
    function where(card, done) {
        details(card, function (d) {
            var eps = aired(d), at = -1, latest = -1, views = [];
            var first = eps[0] || { season: 1, episode: 1 };
            var out = function (state, ep, extra) {
                var r = { state: state, season: ep.season, episode: ep.episode, percent: 0, left: 0, last: null, count: eps.length, from: null };
                for (var k in extra) r[k] = extra[k];
                done(r);
            };
            // the episode watched most recently (Lampa stamps each save, `updated`); progress saved
            // before stamps existed has 0, and then the latest episode with progress wins
            eps.forEach(function (ep, i) {
                var v = views[i] = Lampa.Timeline.view(hash(card.original_name ? card : d, ep.season, ep.episode));
                if (v.percent > 0 && (v.updated || 0) >= latest) { latest = v.updated || 0; at = i; }
            });
            if (at < 0) return fromTrakt(d, eps, first, out);
            var v = views[at], ep = eps[at];
            if (v.percent < FINISHED) {
                var left = v.duration ? v.duration - v.time : runtime(d) * (1 - v.percent / 100);
                return out('continue', ep, { percent: v.percent, left: Math.max(0, Math.round(left)), last: ep, from: 'lampa' });
            }
            out(eps[at + 1] ? 'next' : 'done', eps[at + 1] || first, { last: ep, from: 'lampa' });
        });
    }

    function fromTrakt(d, eps, first, out) {
        var seen = traktSeen[d.id];
        var use = function (p) {
            var last = p && p.last_episode, next = p && p.next_episode;
            var lastEp = last ? { season: last.season, episode: last.number } : null;
            if (!p || !p.completed || !lastEp) return out('new', first);
            var nextEp = next && eps.filter(function (e) { return e.season === next.season && e.episode === next.number; })[0];
            if (nextEp) return out('next', nextEp, { last: lastEp, from: 'trakt' });
            out(p.completed >= p.aired ? 'done' : 'new', first, { last: lastEp, from: 'trakt' });
        };
        if (!window.rubyTrakt || !rubyTrakt.connected()) return out('new', first);
        if (seen && Date.now() - seen.at < 60000) return use(seen.progress);
        rubyTrakt.showProgress(d.id, function (p) { traktSeen[d.id] = { at: Date.now(), progress: p }; use(p); });
    }

    // ---- the title page

    function se(ep) { return 'S' + ep.season + ' E' + ep.episode; }

    function label(r) { return (r.state === 'continue' ? 'Continue ' : 'Play ') + se(r); }

    function status(r) {
        if (r.state === 'continue') {
            var mins = Math.round(r.left / 60);
            return se(r) + ' · ' + (mins >= 1 ? mins + ' min left' : r.percent + '% watched') +
                '<span class="ruby-resume__bar"><i style="width:' + r.percent + '%"></i></span>';
        }
        if (r.state === 'next') return 'Last watched ' + se(r.last);
        if (r.state === 'done') return 'Watched all ' + r.count + ' episodes';
        return '';
    }

    var page = null;    // { root, card, result } of the series page on screen

    // the status line: inside the Trakt plugin's watched-status line when it is there (its own text
    // hidden), else a line of its own under the ratings. Idempotent: the observer below calls it again
    // whenever the plugin replaces its line.
    function paint() {
        if (!page || !page.result) return;
        var right = page.root.querySelector('.full-start-new__right');
        if (!right) return;
        var html = status(page.result), trakt = right.querySelector('.full-start-new__details.trakt');
        var own = right.querySelector('.ruby-resume-line'), el = right.querySelector('.ruby-resume');
        if (!html) {
            if (el) el.remove();
            if (own) own.remove();
            if (trakt) trakt.classList.remove('ruby-resumed');
            return;
        }
        if (!el) { el = document.createElement('span'); el.className = 'ruby-resume'; }
        if (el.innerHTML !== html) el.innerHTML = html;
        var host = trakt;
        if (trakt) {
            if (own) own.remove();
            trakt.classList.add('ruby-resumed');
        } else {
            if (!own) {
                own = document.createElement('div');
                own.className = 'full-start-new__details ruby-resume-line';
                var rate = right.querySelector('.full-start-new__rate-line');
                right.insertBefore(own, rate ? rate.nextSibling : right.firstChild);
            }
            host = own;
        }
        if (el.parentNode !== host) host.appendChild(el);
    }

    var observer = null;
    function render(root, card) {
        if (!window.rubyPlay || !rubyPlay.on()) return;   // Play opens Lampa's own torrent list then
        root = root && root.jquery ? root[0] : root;
        if (!root || !card || !card.id) return;
        if (!page || page.root !== root) {
            page = { root: root, card: card, result: null };
            if (!observer) observer = new MutationObserver(paint);
            observer.disconnect();
            var right = root.querySelector('.full-start-new__right');
            if (right) observer.observe(right, { childList: true });
        }
        var mine = page;
        where(card, function (r) {
            if (page !== mine || !document.body.contains(root)) return;
            mine.result = r;
            var btn = root.querySelector('.full-start-new__buttons .button--play span');
            if (btn) btn.textContent = label(r);
            paint();
        });
    }

    function css() {
        var s = document.createElement('style');
        s.id = 'ruby-resume';
        s.textContent = [
            '.full-start-new__details.trakt.ruby-resumed>span:not(.ruby-resume){display:none}',
            '.ruby-resume{display:inline-flex;align-items:center}',
            '.ruby-resume__bar{display:inline-block;width:7em;height:.28em;margin-left:.8em;border-radius:.2em;background:rgba(255,255,255,.3);overflow:hidden}',
            '.ruby-resume__bar i{display:block;height:100%;background:#fff;border-radius:.2em}'
        ].join('\n');
        document.head.appendChild(s);
    }

    function isShow(obj) { return obj && obj.method === 'tv'; }

    function init() {
        css();
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite' && isShow(e.object) && e.data && e.data.movie && e.object.activity)
                render(e.object.activity.render(true), e.data.movie);
        });
        // back to a series page that was already built
        Lampa.Listener.follow('activity', function (e) {
            if (e.type !== 'start' || e.component !== 'full' || !isShow(e.object) || !e.object.activity) return;
            var root = e.object.activity.render(true);
            root = root.jquery ? root[0] : root;
            if (root && root.querySelector('.full-start-new')) render(root, page && page.root === root ? page.card : e.object.card);
        });
        // progress saved (every 2 min while playing, and when the player closes) or synced in
        var soon = 0;
        Lampa.Listener.follow('state:changed', function (e) {
            if (!e || e.target !== 'timeline' || !page) return;
            clearTimeout(soon);
            soon = setTimeout(function () { if (page && document.body.contains(page.root)) render(page.root, page.card); }, 400);
        });
    }

    window.rubyResume = { where: where };

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Timeline || !Lampa.Utils || !window.rubyDesktop || !rubyDesktop.tmdb) return;
        clearInterval(t);
        init();
    }, 100);
})();
