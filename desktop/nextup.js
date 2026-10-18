// "Next episode" countdown, as on Netflix (desktop/README.md, "Player"): in an episode's last LEAD seconds a
// card in the corner counts down to the next episode in the player's playlist, which starts when this one
// ends (Lampa's own Settings → Player → "Next episode", playlist_next, does that). "Next episode" starts it
// now; the cross hides the card for this episode. Without playlist_next, or on the last episode, no card.
// Active only where desktop.js is.
(function () {
    var LEAD = 10;
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

    function show(item, left) {
        if (!build()) return;
        var title = item.title && item.title.length < 60 ? item.title : '';
        label.innerHTML = 'Next episode in ' + Math.max(0, Math.ceil(left)) +
            (title ? '<div class="ruby-nextup__title">' + title.replace(/</g, '&lt;') + '</div>' : '');
        fill.style.transform = 'scaleX(' + Math.min(1, Math.max(0, 1 - left / LEAD)) + ')';
        if (!showing) { showing = true; card.classList.add('ruby-nextup--on'); }
    }

    function hide() {
        showing = false;
        if (card) card.classList.remove('ruby-nextup--on');
    }

    function update(e) {
        var left = e.duration - e.current;
        if (!e.duration || left > LEAD + 5) dismissed = false;   // seeked back: offer it again
        if (!e.duration || left > LEAD || left < 0 || dismissed || !Lampa.Storage.field('playlist_next')) return hide();
        var item = nextItem();
        if (item) show(item, left); else hide();
    }

    function start() {
        if (!rubyDesktop.active()) return;
        var style = document.createElement('style');
        style.id = 'ruby-nextup';
        style.textContent = CSS;
        document.head.appendChild(style);
        Lampa.PlayerVideo.listener.follow('timeupdate', update);
        Lampa.Player.listener.follow('start', function () { dismissed = false; hide(); });
        Lampa.Player.listener.follow('destroy', function () { dismissed = false; hide(); });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.PlayerPlaylist || !window.rubyDesktop || !rubyDesktop.active || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 100);
})();
