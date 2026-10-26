// "Next episode" countdown, as on Netflix (desktop/README.md, "Player"): when an episode's end credits start, a
// card in the corner counts down LEAD seconds to the next episode in the player's playlist and then starts it,
// skipping the rest of the credits. "Next episode" starts it now; the cross hides the card and lets the episode
// play on. Credits times come from TheIntroDB (by TMDB id, season, episode); where it has none, or its time
// doesn't fit this file, the card comes in the last LEAD seconds and the next episode starts when this one ends
// (Lampa's own Settings → Player → "Next episode", playlist_next). When TheIntroDB says something follows the
// credits (they end before the file does), the card stays without a countdown and the episode plays out.
// Without playlist_next, or on the last episode, no card. Active only where desktop.js is.
(function () {
    var LEAD = 10;
    var API = 'https://api.theintrodb.org/v2/media';
    // a file's own content after the credits this long: a scene to see, not credits to skip
    var AFTER = 15;
    var CSS = [
        '.ruby-nextup{position:absolute;right:3%;bottom:7.5em;z-index:40;display:flex;align-items:center;gap:.6em;opacity:0;transform:translateY(.6em);transition:opacity .3s,transform .3s;pointer-events:none}',
        '.ruby-nextup--on{opacity:1;transform:none;pointer-events:auto}',
        '.ruby-nextup__go{position:relative;overflow:hidden;display:flex;align-items:center;gap:.55em;padding:.75em 1.3em;border-radius:.35em;background:rgba(255,255,255,.28);color:#fff;font-size:1.3em;font-weight:600;cursor:pointer}',
        '.ruby-nextup__go svg{width:1.1em!important;height:1.1em!important}',
        // the white fill grows over the countdown, so the button turns white as the next episode comes
        '.ruby-nextup__fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:#fff;transform-origin:left;transform:scaleX(0)}',
        '.ruby-nextup__go span,.ruby-nextup__go svg{position:relative;mix-blend-mode:difference}',
        '.ruby-nextup__title{font-size:.75em;font-weight:500;opacity:.85;max-width:16em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.ruby-nextup__x{width:2.4em;height:2.4em;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);color:#fff;cursor:pointer;font-size:1.1em}',
        '.ruby-nextup__x svg{width:1em!important;height:1em!important}'
    ].join('\n');

    var card = null, fill = null, label = null, dismissed = false, showing = false;
    var credits = null, asked = {}, playing = '', fired = false;   // credits: { start, end } in seconds, for the playing episode

    // TheIntroDB's end credits for a TV episode: the last credits entry that doesn't start at 0 (0/0 is how it
    // says "none", and opening credits start near 0). Answers are kept for the page's life: one ask per episode.
    function askCredits(data) {
        credits = null;
        playing = '';
        var c = data && data.card, key;
        if (!c || !c.id || !(c.name || c.original_name) || !(data.season > 0) || !(data.episode > 0)) return;
        key = playing = c.id + '/' + data.season + '/' + data.episode;
        if (key in asked) { credits = asked[key]; return; }
        asked[key] = null;
        fetch(API + '?tmdb_id=' + c.id + '&season=' + data.season + '&episode=' + data.episode)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                var best = null;
                ((j && j.credits) || []).forEach(function (seg) {
                    if (seg.start_ms > 0 && (!best || seg.start_ms > best.start)) best = { start: seg.start_ms / 1000, end: seg.end_ms > 0 ? seg.end_ms / 1000 : 0 };
                });
                asked[key] = best;
                if (playing === key) credits = best;
                console.log('Ruby nextup', 'credits of', key, best ? 'at ' + best.start.toFixed(0) + ' s' : 'unknown');
            }, function () {});
    }

    // where the card comes and whether it counts down: { at, auto } for a video of `duration` s. TheIntroDB's time
    // is for its own copy: it's used only when it lands in this file's last 30 % (Lampa's own rule for an end
    // segment, app.min.js draw$6) and before its last LEAD s.
    function plan(duration) {
        var c = credits;
        if (c && c.start >= duration * 0.7 && c.start < duration - LEAD)
            return { at: c.start, auto: !(c.end && c.end < duration - AFTER) };
        return { at: duration - LEAD, auto: false };
    }

    function nextItem() {
        var P = Lampa.PlayerPlaylist;
        if (!P.canNext || !P.canNext()) return null;
        return (P.get() || [])[P.position() + 1] || null;
    }

    function build() {
        var root = document.querySelector('.player');
        if (!root) return null;
        if (card && root.contains(card)) return card;
        card = document.createElement('div');
        card.className = 'ruby-nextup';
        card.innerHTML = '<div class="ruby-nextup__go"><div class="ruby-nextup__fill"></div>' + rubyIcons.svg('play') +
            '<span class="ruby-nextup__label"></span></div><div class="ruby-nextup__x" title="Hide">' + rubyIcons.svg('plus') + '</div>';
        card.querySelector('.ruby-nextup__x svg').style.transform = 'rotate(45deg)';
        fill = card.querySelector('.ruby-nextup__fill');
        label = card.querySelector('.ruby-nextup__label');
        card.querySelector('.ruby-nextup__go').addEventListener('click', function () { hide(); Lampa.PlayerPlaylist.next(); });
        card.querySelector('.ruby-nextup__x').addEventListener('click', function () { dismissed = true; hide(); });
        root.appendChild(card);
        return card;
    }

    // left: seconds until the next episode, or null when it comes only with the end of this one
    function show(item, left) {
        if (!build()) return;
        var title = item.title && item.title.length < 60 ? item.title : '';
        label.innerHTML = (left == null ? 'Next episode' : 'Next episode in ' + Math.max(0, Math.ceil(left))) +
            (title ? '<div class="ruby-nextup__title">' + title.replace(/</g, '&lt;') + '</div>' : '');
        fill.style.transform = 'scaleX(' + (left == null ? 0 : Math.min(1, Math.max(0, 1 - left / LEAD))) + ')';
        if (!showing) { showing = true; card.classList.add('ruby-nextup--on'); }
    }

    function hide() {
        showing = false;
        if (card) card.classList.remove('ruby-nextup--on');
    }

    function update(e) {
        if (!e.duration || !isFinite(e.duration)) return hide();
        var p = plan(e.duration), into = e.current - p.at;
        if (into < -5) { dismissed = false; fired = false; }   // seeked back: offer it again
        if (into < 0 || e.current > e.duration || dismissed || !Lampa.Storage.field('playlist_next')) return hide();
        var item = nextItem();
        if (!item) return hide();
        // the end of the file: Lampa's own `ended` starts the next one
        var left = p.auto ? LEAD - into : p.at === e.duration - LEAD ? e.duration - e.current : null;
        show(item, left);
        if (p.auto && left <= 0 && !fired) {
            fired = true;
            hide();
            Lampa.PlayerPlaylist.next();
        }
    }

    function start() {
        if (!rubyDesktop.active()) return;
        var style = document.createElement('style');
        style.id = 'ruby-nextup';
        style.textContent = CSS;
        document.head.appendChild(style);
        Lampa.PlayerVideo.listener.follow('timeupdate', update);
        Lampa.Player.listener.follow('start', function (data) { dismissed = false; fired = false; hide(); askCredits(data); });
        Lampa.Player.listener.follow('destroy', function () { dismissed = false; fired = false; credits = null; playing = ''; hide(); });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.PlayerPlaylist || !window.rubyDesktop || !rubyDesktop.active || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 100);
})();
