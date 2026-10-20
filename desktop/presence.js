// Who's watching now (desktop/README.md, "Profiles"): the top bar shows the other profiles that are playing
// something, with a green dot; hover says what, a click opens that title. Each profile writes
// presence-<id>.json ({ name, color, title, season, episode, id, kind, at }) to the shared ./sync/ folder, and
// the profile service on the server says who's watching from those (GET ./sync/watching)
// when playback starts, every minute while it goes on, and { at: 0 } when it stops. Only with ./sync/
// (store.js): without it there is nobody else to see. Writing runs everywhere (a TV counts as watching);
// the top-bar part only where nav.js is.
(function () {
    var BEAT_MS = 60000, READ_MS = 30000, FRESH_MS = 3 * 60000;
    var playing = null, beat = 0;

    function file(id) { return 'presence-' + id + '.json'; }

    function write(keepalive) {
        var me = rubyProfiles.current();
        if (!me) return;
        rubyStore.put(file(me.id), JSON.stringify(playing ? Object.assign({ name: me.name, color: me.color, at: Date.now() }, playing) :
            { name: me.name, color: me.color, at: 0 }), keepalive);
    }

    function started() {
        var d = Lampa.Player.playdata() || {}, card = d.card || {};
        playing = {
            title: card.title || card.name || d.first_title || d.title || '',
            season: d.season || 0, episode: d.episode || 0,
            id: card.id || 0, kind: card.name && !card.title ? 'tv' : 'movie'
        };
        write();
        clearInterval(beat);
        beat = setInterval(function () { if (Lampa.Player.opened()) write(); }, BEAT_MS);
    }

    function stopped() {
        if (!playing) return;
        playing = null;
        clearInterval(beat);
        write(true);
    }

    // ---- the top bar
    var CSS = [
        '.ruby-live{display:flex;align-items:center;gap:.7em}',
        '.ruby-live__p{position:relative;width:1.9em;cursor:pointer}',
        '.ruby-live__p .ruby-avatar{font-size:1em}',
        '.ruby-live__p::after{content:"";position:absolute;right:-.15em;bottom:-.15em;width:.6em;height:.6em;border-radius:50%;background:#46d369;box-shadow:0 0 0 .15em #141414}',
        '.ruby-live__tip{position:absolute;top:calc(100% + .7em);right:0;white-space:nowrap;padding:.6em .9em;border-radius:.45em;background:rgba(20,20,20,.95);border:1px solid rgba(255,255,255,.15);font-size:1.05em;color:#e5e5e5;opacity:0;pointer-events:none;transition:opacity .15s}',
        '.ruby-live__p:hover .ruby-live__tip{opacity:1}',
        '.ruby-live__tip b{color:#fff;font-weight:600}'
    ].join('\n');

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function describe(w) {
        var ep = w.season && w.episode ? ' · S' + w.season + ' E' + w.episode : '';
        return '<b>' + esc(w.name) + '</b> is watching ' + esc(w.title) + ep;
    }

    function render(box, watching) {
        box.innerHTML = '';
        watching.forEach(function (w) {
            var el = document.createElement('div');
            el.className = 'ruby-live__p';
            el.innerHTML = rubyProfiles.avatar(w) + '<div class="ruby-live__tip">' + describe(w) + '</div>';
            if (w.id) el.addEventListener('click', function () {
                rubyDesktop.openFull(w.kind === 'tv' ? { id: w.id, media_type: 'tv', name: w.title } : { id: w.id, media_type: 'movie', title: w.title });
            });
            box.appendChild(el);
        });
    }

    // the profile service answers who's watching in one request (server/sync, GET /watching); a plain folder
    // has each profile's file read instead
    function read(box) {
        if (document.hidden) return;
        var me = rubyProfiles.current();
        rubyStore.getAsync('watching').then(function (text) {
            var all = null;
            try { all = JSON.parse(text || 'null'); } catch (e) { all = null; }
            if (!Array.isArray(all)) return readEach(box, me);
            render(box, all.filter(function (w) { return !me || w.profile !== me.id; }));
        });
    }
    function readEach(box, me) {
        var others = rubyProfiles.list().filter(function (p) { return !me || p.id !== me.id; });
        Promise.all(others.map(function (p) {
            return rubyStore.getAsync(file(p.id)).then(function (text) {
                try { var w = JSON.parse(text || 'null'); } catch (e) { w = null; }
                // the profile's current name and colour, in case they changed since
                return w && w.at && Date.now() - w.at < FRESH_MS ? Object.assign(w, { name: p.name, color: p.color, img: p.img }) : null;
            });
        })).then(function (list) { render(box, list.filter(Boolean)); });
    }

    function topBar() {
        var t = setInterval(function () {
            var right = document.querySelector('.ruby-nav__right');
            if (!right) return;
            clearInterval(t);
            var style = document.createElement('style');
            style.id = 'ruby-presence';
            style.textContent = CSS;
            document.head.appendChild(style);
            var box = document.createElement('div');
            box.className = 'ruby-live';
            right.insertBefore(box, right.firstChild);
            read(box);
            setInterval(function () { read(box); }, READ_MS);
            document.addEventListener('visibilitychange', function () { if (!document.hidden) read(box); });
        }, 500);
    }

    function start() {
        if (!rubyStore.remote) return;
        Lampa.Player.listener.follow('start', started);
        Lampa.Player.listener.follow('destroy', stopped);
        window.addEventListener('pagehide', stopped);
        if (rubyDesktop.active()) topBar();
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.Player.listener || !window.rubyStore || !window.rubyProfiles || !window.rubyIcons ||
            !window.rubyDesktop || !rubyDesktop.active) return;
        clearInterval(t);
        start();
    }, 100);
})();
