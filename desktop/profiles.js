// Netflix-style profiles for Lampa (desktop/README.md). Loaded by index.html after store.js, before Lampa.
// Lampa keeps everything in localStorage under fixed keys and has no local profiles (its own need a CUB
// account). So a profile is a set of those keys: the active profile's values are the live keys Lampa and
// its plugins use; every profile's values are also kept as profile-<id>.json in rubyStore (store.js) -
// a ./sync/ folder on the server when there is one, so all devices share the profiles, else this browser.
// Switching sends what changed, marks the target in ruby_profile_switch and reloads; the swap runs here at
// the start of the next page load, before app.min.js has read anything, so nothing leaks.
// With the profile service on the server (server/sync/) the server's copy is the one that counts: this page
// sends only what it changed, as changes (rubySync.ops, every 2 s), and takes the server's copy at start,
// when the tab comes back and after playback. A page can't send a whole profile, so a stale tab, old code or
// another device can't put an old copy back (they did, three times on 2026-10-18..20).
// Per profile: bookmarks/My List, watch history and progress, search history, thumbs ratings
// (ratings.js) and the Trakt login with all Trakt plugin state - so one person's IMDb/Trakt taste
// never reaches another. Shared: settings, servers, plugins, the Trakt app id.
// Which profile a device is on stays on the device: the picker ("Who's watching?") shows on its first
// visit, the choice is remembered, and the top bar's profile menu changes it (rubyProfiles.picker()).
(function () {
    var ls = window.localStorage, STATE = 'ruby_profiles', OLD_DATA = 'ruby_profile_data_', SWITCH = 'ruby_profile_switch';
    var OWN = ['favorite', 'file_view', 'online_view', 'online_watched_last', 'torrents_view', 'timetable', 'search_history',
        'recomends_list', 'recomends_scan', 'mine_reactions', 'user_clarifys', 'person_subscribes_id', 'discuss_voited', 'activity'];
    var OWN_PREFIX = ['file_view_', 'trakt', 'ruby_ratings'];
    // the viewer's settings (settings.js), per profile since 2026-10-20: each person's subtitles and autoplay
    // on every device, instead of one set per browser shared by whoever uses it
    var SETTINGS = ['subtitles_start', 'subtitles_lang', 'ruby_anime_audio', 'playlist_next', 'ruby_hero_trailers', 'ruby_trailer_sound'];
    OWN = OWN.concat(SETTINGS);
    var SHARED = ['trakt_client_id', 'trakt_client_secret'];
    var MAX = 10;
    // per profile, but rebuilt on their own: not worth uploading. activity (the screen Lampa is on) and
    // trakt_last_card are this page's own: uploaded, every start found the server's copy "changed" (the last
    // page wrote them closing) and reloaded the page to Home, dropping a link to a title (2026-10-20)
    var NOT_SYNCED = /cache|_log$|debug|^activity$|^trakt_last_card$/;
    var COLORS = ['#2f6fdf', '#e50914', '#1f9d55', '#8b3fd9', '#e8730c', '#0e9aa7'];

    function own(key) {
        if (SHARED.indexOf(key) >= 0) return false;
        return OWN.indexOf(key) >= 0 || OWN_PREFIX.some(function (p) { return key.indexOf(p) === 0; });
    }
    // the synced keys of two copies equal, in any order (copies uploaded before a key joined NOT_SYNCED have it)
    function sameKeys(a, b) {
        var ka = Object.keys(a).filter(function (k) { return !NOT_SYNCED.test(k); }).sort();
        var kb = Object.keys(b).filter(function (k) { return !NOT_SYNCED.test(k); }).sort();
        return ka.join('\n') === kb.join('\n') && ka.every(function (k) { return a[k] === b[k]; });
    }
    function parse(text) { try { return text ? JSON.parse(text) : null; } catch (e) { return null; } }
    function load() {
        var s = parse(ls.getItem(STATE));
        if (!s || !s.list || !s.list.length) s = { list: [{ id: 'p1', name: 'Me', color: 0 }], current: 'p1', chosen: false };
        return s;
    }
    function save() { ls.setItem(STATE, JSON.stringify(state)); }
    // the list changes only by what this page did ({ upsert: profile } | { add: [profiles] } | { remove: id })
    function saveList(msg) {
        save();
        if (!rubyStore.remote) return rubyStore.put('profiles.json', JSON.stringify({ list: state.list }));
        msg.by = by('profiles');
        rubyStore.post('profiles.json', msg).then(function (r) {
            if (r.status === 200 && r.body) state.list = r.body.list, save();
            else log('profile list change failed', { status: r.status, answer: r.body });
        });
    }
    function find(id) { return state.list.filter(function (p) { return p.id === id; })[0]; }

    // ---- what happened to profiles on this device, to work out later what went wrong (desktop/README.md
    // "Profile logs"): the last 100 events, here and in events-<device>.json beside the profiles, which ruby's
    // watcher journals. Every profile file also names the device that wrote it and why (snapshot's "by").
    var DEVICE = 'ruby_device', EVENTS = 'ruby_events', MAX_EVENTS = 100;
    var device = ls.getItem(DEVICE) || 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    ls.setItem(DEVICE, device);
    function log(what, info) {
        var list = parse(ls.getItem(EVENTS)) || [], e = { t: Date.now(), p: state ? state.current : null, what: what };
        Object.keys(info || {}).forEach(function (k) { e[k] = info[k]; });
        list = list.concat([e]).slice(-MAX_EVENTS);
        ls.setItem(EVENTS, JSON.stringify(list));
        console.log('profiles:', what, info || '');
        if (rubyStore.remote) rubyStore.put('events-' + device + '.json', JSON.stringify({ device: device, ua: navigator.userAgent, events: list }));
    }
    function by(why) { return { device: device, why: why, ua: navigator.userAgent }; }

    function liveKeys() {
        var keys = [];
        for (var i = 0; i < ls.length; i++) keys.push(ls.key(i));
        return keys.filter(own);
    }
    // the live profile's data as profile-<id>.json content
    function snapshot(why) {
        var keys = {};
        liveKeys().filter(function (k) { return !NOT_SYNCED.test(k); }).forEach(function (k) { keys[k] = ls.getItem(k); });
        return { t: Date.now(), keys: keys, by: by(why || '') };
    }
    function apply(blob) {
        quiet++;
        try {
            liveKeys().forEach(function (k) { ls.removeItem(k); });
            var keys = (blob && blob.keys) || {};
            // a copy uploaded before a key joined NOT_SYNCED has another page's (its activity: that page's screen)
            Object.keys(keys).forEach(function (k) { if (!NOT_SYNCED.test(k)) ls.setItem(k, keys[k]); });
        } finally { quiet--; }
        state.dataV = (blob && blob.v) || 0;
    }
    // has this browser ever loaded the current profile's data (dataT: before the profile service)
    function loaded() { return state.dataV !== undefined || !!state.dataT; }
    // which keys differ, for the logs (sizes, not contents)
    function diff(a, b) {
        var out = {};
        Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
            if (a[k] !== b[k]) out[k] = (a[k] || '').length + ' -> ' + (b[k] || '').length;
        });
        return out;
    }

    // ---- what this page changes. Every write to the profile's keys (Lampa's, plugins', ours) goes through
    // localStorage.setItem/removeItem: the value a key had before its first write since the last send is
    // kept (in ruby_sync_pending, so a tab closed too early sends it on the next load), and every 2 s the
    // changes go to the server as changes (rubySync.ops), never as a copy. apply() is quiet: loading a
    // profile isn't a change.
    var PENDING = 'ruby_sync_pending', SEND_MS = 2000, quiet = 0;
    var pending = parse(ls.getItem(PENDING)) || { p: null, base: {} };
    function dirty() { return Object.keys(pending.base).length > 0; }
    function keep() { ls.setItem(PENDING, JSON.stringify(pending)); }
    var proto = Object.getPrototypeOf(ls), setItem = proto.setItem, removeItem = proto.removeItem;
    function note(k) {
        if (quiet || !state || !state.chosen || !own(k) || NOT_SYNCED.test(k)) return;
        if (pending.p !== state.current) pending = { p: state.current, base: {} };
        if (k in pending.base) return;
        pending.base[k] = ls.getItem(k);
        keep();
    }
    proto.setItem = function (k) { if (this === ls) note(k); return setItem.apply(this, arguments); };
    proto.removeItem = function (k) { if (this === ls) note(k); return removeItem.apply(this, arguments); };

    // ---- page start (before Lampa): only a profile switch reads from the store, synchronously, because the
    // page must start with the target's data. Everything else is checked in the background (syncList).
    var state = load();
    try {
        // English everywhere (user's call 2026-10-20): the fork's own text is English only, so another language
        // gave half-translated screens (a friend's browser in Bulgarian). Set on every load, also over an earlier
        // choice; lang_use false is Lampa's own switch that drops its first-run picker and the Interface row.
        ls.setItem('language', 'en');
        ls.setItem('tmdb_lang', 'en');
        window.lampa_settings = window.lampa_settings || {};
        window.lampa_settings.lang_use = false;
        var target = ls.getItem(SWITCH);
        ls.removeItem(SWITCH);
        // (also "switching" to the same id when this browser has never loaded that profile's data: a new
        // browser picking the profile it happened to start on)
        if (target && find(target) && (target !== state.current || !loaded())) {
            apply(parse(rubyStore.get('profile-' + target + '.json')));
            state.current = target;
            state.chosen = true;
        }
        save();
    } catch (e) {
        console.error('profiles: start failed', e);
    }

    // ---- after start: the shared list, then the server's copy of this profile
    function syncList() {
        rubyStore.getAsync('profiles.json').then(function (shared) {
            if (shared === undefined) return;
            var server = parse(shared), list = server && server.list ? server.list : [];
            if (!state.synced) return firstContact(list);
            if (list.length) state.list = list;
            else saveList({ add: state.list });   // the server's list is gone: seed it again
            listed();
        });
    }
    function listed() {
        save();
        if (root && !root.classList.contains('manage') && !root.querySelector('.ruby-who__form')) picker(false);   // refresh an open picker
        if (!find(state.current)) {   // deleted on another device: move to the first profile, then pick again
            state.chosen = false;
            ls.setItem(SWITCH, state.list[0].id);
            save();
            return location.replace(location.pathname);
        }
        refresh('start');
    }
    // this browser's first contact with the shared list: its own profiles join it. Every browser's first profile
    // is 'p1', so a local profile whose id is taken by a differently named one gets a new id (and keeps its data)
    // instead of landing on someone else's; a new browser's untouched default "Me" isn't added at all. One with
    // the same id and name is the same profile: the server's data counts, refresh() takes it. A profile's data
    // goes up only as a new profile's (the service refuses it for an id that has data: 2026-10-18 an iPhone's
    // empty old "Me", also p1, replaced Iskrata's history and list).
    function firstContact(list) {
        var fresh = !state.chosen && state.list.length === 1 && list.length > 0, add = [], data = {}, renamed = {};
        state.list.forEach(function (p) {
            if (fresh) return;
            var same = list.filter(function (q) { return q.id === p.id; })[0];
            if (same && same.name === p.name) return;
            var id = p.id;
            if (same) {
                id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                renamed[p.id] = id;
                if (state.current === p.id) state.current = id;
            }
            var old = ls.getItem(OLD_DATA + p.id);   // the first local-only version kept other profiles here
            if (state.current === id) data[id] = snapshot().keys; else if (old) data[id] = parse(old) || {};
            add.push({ id: id, name: p.name, color: p.color, img: p.img });
        });
        add = add.slice(0, Math.max(0, MAX - list.length));
        log('first contact', { fresh: fresh, added: add.map(function (p) { return p.id; }), renamed: renamed, shared: list.length });
        if (!rubyStore.remote) {
            state.list = list.concat(add);
            state.synced = true;
            rubyStore.put('profiles.json', JSON.stringify({ list: state.list }));
            Object.keys(data).forEach(function (id) { rubyStore.put('profile-' + id + '.json', JSON.stringify({ t: Date.now(), keys: data[id] })); });
            return listed();
        }
        rubyStore.post('profiles.json', { add: add, by: by('first contact') }).then(function (r) {
            if (r.status !== 200 || !r.body) return log('first contact failed, again on the next load', { status: r.status });
            state.list = r.body.list;
            state.synced = true;
            Object.keys(ls).filter(function (k) { return k.indexOf(OLD_DATA) === 0; }).forEach(function (k) { ls.removeItem(k); });
            Object.keys(data).forEach(function (id) {
                rubyStore.post('profile-' + id + '.json', { create: { keys: data[id] }, by: by('first contact') }).then(function (c) {
                    if (c.status === 200 && id === state.current) { state.dataV = c.body.v; save(); }
                    else if (c.status !== 200) log('first contact: data not created', { id: id, status: c.status });
                });
            });
            listed();
        });
    }

    // ---- the server's copy is the one that counts: taken at start, when the tab comes back and after playback
    // (never during it), whenever it isn't what this page has. Lampa has read its storage already, so the page
    // reloads once. Unsent changes go first.
    var retry = false, needRefresh = false;
    function playing() { return !!(window.Lampa && Lampa.Player && Lampa.Player.opened && Lampa.Player.opened()); }
    function refresh(why) {
        if (!rubyStore.remote || !state.chosen) return;
        if (dirty() || sending) { retry = true; return flush('before refresh'); }
        if (playing()) { needRefresh = true; return; }
        retry = needRefresh = false;
        rubyStore.getAsync(file()).then(function (text) {
            var s = parse(text);
            if (!s) return;
            // settings this device had before they became per profile, which the profile doesn't have yet: kept,
            // by sending them, instead of losing them to the server's copy (once per setting and profile)
            var adopt = SETTINGS.filter(function (k) { return !(k in (s.keys || {})) && ls.getItem(k) !== null && !(k in pending.base); });
            if (adopt.length) {
                if (pending.p !== state.current) pending = { p: state.current, base: {} };
                adopt.forEach(function (k) { pending.base[k] = null; });
                keep();
                log('settings kept for this profile', { keys: adopt });
                retry = true;
                return flush('settings');
            }
            if ((s.v || 0) === state.dataV) return;
            var mine = snapshot().keys;
            if (sameKeys(s.keys || {}, mine)) { state.dataV = s.v || 0; return save(); }
            if (dirty() || playing()) { needRefresh = true; return; }
            log('took the server copy', { why: why, v: s.v || 0, had: state.dataV, by: s.by || null, diff: diff(mine, s.keys || {}) });
            apply(s);
            save();
            // the same profile: the page it was on still applies (a link to a title stays one)
            location.replace(location.pathname + location.search + location.hash);
        });
    }

    // ---- sending: one request at a time, so the server applies changes in the order they were made
    var sending = false;
    function file() { return 'profile-' + state.current + '.json'; }
    function flush(why, keepalive) {
        if (!dirty() || !state.chosen || (sending && why !== 'closing' && why !== 'switch')) return;
        if (pending.p !== state.current) {
            log('unsent changes of another profile dropped', { p: pending.p, keys: Object.keys(pending.base) });
            pending = { p: null, base: {} };
            return keep();
        }
        if (!rubyStore.remote) {   // this browser only: no one else writes, the copy is the data
            pending.base = {};
            keep();
            return rubyStore.put(file(), JSON.stringify(snapshot(why)));
        }
        var sent = pending, ops = [];
        Object.keys(sent.base).forEach(function (k) { var op = rubySync.ops(k, sent.base[k], ls.getItem(k)); if (op) ops.push(op); });
        pending = { p: sent.p, base: {} };
        keep();
        if (!ops.length) return;
        var msg = { base: state.dataV, by: by(why), ops: ops };
        if (why === 'switch') return done(rubyStore.postNow(file(), msg));
        sending = true;
        rubyStore.post(file(), msg, keepalive).then(done);
        function done(r) {
            sending = false;
            if (r.status === 200 && r.body) {
                // someone else changed it since this page's copy: their part reaches this page on its next refresh
                if (r.body.stale) needRefresh = true;
                state.dataV = r.body.stale ? -1 : r.body.v;
                save();
                if (retry && !dirty()) refresh('after sending');
                return;
            }
            // 405: the folder answering isn't the profile service yet (a deploy in progress): kept, like an outage
            if (r.status >= 400 && r.status < 500 && r.status !== 405) return log('changes refused', { status: r.status, answer: r.body, keys: ops.map(function (o) { return o.k; }) });
            // unreachable, a server error, or no service yet: back in the queue, from the value the server still has
            Object.keys(sent.base).forEach(function (k) { pending.base[k] = sent.base[k]; });
            pending.p = sent.p;
            keep();
        }
    }
    setInterval(function () { flush('changed'); }, SEND_MS);
    document.addEventListener('visibilitychange', function () { if (document.hidden) flush('hidden', true); else refresh('back'); });
    window.addEventListener('pagehide', function () { flush('closing', true); });
    var waitPlayer = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.Player.listener) return;
        clearInterval(waitPlayer);
        Lampa.Player.listener.follow('destroy', function () { if (needRefresh) setTimeout(function () { refresh('after playback'); }, 500); });
    }, 500);

    function switchTo(id) {
        if (id === state.current && (loaded() || !rubyStore.remote)) { state.chosen = true; save(); close(); return; }
        log('switch', { to: id });
        if (state.chosen) flush('switch');
        save();
        ls.setItem(SWITCH, id);
        location.replace(location.pathname);   // start on Home, the old page's activity belongs to the old profile
    }

    // ---- UI
    var CSS = [
        '.ruby-who{position:fixed;inset:0;z-index:10000;background:#141414;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
            'font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff;opacity:0;transition:opacity .25s}',
        '.ruby-who.show{opacity:1}',
        '.ruby-who h1{font-size:max(3.4vw,28px);font-weight:500;margin:0 0 1.2em;letter-spacing:-.01em}',
        '.ruby-who__list{display:flex;flex-wrap:wrap;justify-content:center;gap:max(2vw,16px);max-width:90vw}',
        '.ruby-who__p{width:max(10vw,96px);cursor:pointer;text-align:center;color:#808080;font-size:max(1.3vw,13px);transition:color .15s}',
        '.ruby-who__p:hover,.ruby-who__p:focus{color:#e5e5e5;outline:none}',
        '.ruby-who__p:hover .ruby-avatar,.ruby-who__p:focus .ruby-avatar{box-shadow:0 0 0 .2em #e5e5e5}',
        '.ruby-who__name{margin-top:.7em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ruby-avatar{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:1;border-radius:.3em;color:#fff;overflow:hidden}',
        '.ruby-avatar>.ruby-icon{position:absolute;left:14%;top:14%;width:72%!important;height:72%!important}',
        '.ruby-who__p .ruby-avatar{width:100%}',
        '.ruby-who__add .ruby-avatar{background:transparent;color:#808080}',
        '.ruby-who__add .ruby-avatar>.ruby-icon{left:27.5%;top:27.5%;width:45%!important;height:45%!important}',
        '.ruby-who__add:hover .ruby-avatar{background:#e5e5e5;color:#141414}',
        '.ruby-who__edit{position:absolute;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center}',
        '.ruby-who__edit .ruby-icon{width:32%!important;height:32%!important}',
        '.ruby-who.manage .ruby-who__edit{display:flex}',
        '.ruby-who__btn{margin-top:4em;padding:.5em 1.5em;border:1px solid #808080;color:#808080;background:transparent;font-size:max(1.1vw,13px);letter-spacing:.15em;text-transform:uppercase;cursor:pointer}',
        '.ruby-who__btn:hover{border-color:#fff;color:#fff}',
        '.ruby-who__btn--white{background:#fff;color:#141414;border-color:#fff;font-weight:600}',
        '.ruby-who__btn--white:hover{background:#e50914;border-color:#e50914;color:#fff}',
        '.ruby-who__form{width:min(36em,90vw);text-align:left}',
        '.ruby-who__form h1{text-align:left;margin-bottom:.4em}',
        '.ruby-who__row{display:flex;gap:1.5em;align-items:flex-start;border-top:1px solid #333;border-bottom:1px solid #333;padding:1.5em 0}',
        '.ruby-who__row .ruby-avatar{width:7.5em;flex:0 0 auto}',
        '.ruby-who__input{width:100%;box-sizing:border-box;background:#666;border:0;color:#fff;font-size:1.2em;padding:.5em .7em;outline:none}',
        '.ruby-who__input:focus{outline:2px solid #fff}',
        '.ruby-who__colors{display:flex;gap:.6em;margin-top:1em}',
        '.ruby-who__color{width:2.2em;height:2.2em;border-radius:.25em;cursor:pointer;box-shadow:0 0 0 2px transparent}',
        '.ruby-who__color.on{box-shadow:0 0 0 2px #141414,0 0 0 4px #fff}',
        '.ruby-who__actions{display:flex;gap:1em;flex-wrap:wrap}',
        '.ruby-who__actions .ruby-who__btn{margin-top:2em}'
    ].join('\n');

    // the chosen picture (avatars.js, a TMDB portrait path), else the face on the profile's colour
    function avatar(p) {
        if (p.img && window.rubyAvatars) return '<div class="ruby-avatar" style="background:' + COLORS[p.color % COLORS.length] +
            ' url(' + rubyAvatars.url(p.img) + ') center/cover"></div>';
        return '<div class="ruby-avatar" style="background:' + COLORS[p.color % COLORS.length] + '">' + rubyIcons.svg('face') + '</div>';
    }
    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    var root = null;
    function close() {
        if (!root) return;
        var r = root; root = null;
        r.classList.remove('show');
        setTimeout(function () { r.remove(); }, 250);
    }
    function css() {   // avatars are also drawn by the top bar, so this goes in at boot
        if (document.getElementById('ruby-who-css')) return;
        var st = document.createElement('style');
        st.id = 'ruby-who-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }
    function mount() {
        css();
        if (!root) {
            root = document.createElement('div');
            root.className = 'ruby-who';
            // keep Lampa's remote-control key handling out of the picker (typing a name, Enter, arrows)
            ['keydown', 'keyup', 'keypress'].forEach(function (ev) { root.addEventListener(ev, function (e) { e.stopPropagation(); }); });
            document.body.appendChild(root);
            requestAnimationFrame(function () { if (root) root.classList.add('show'); });
        }
        return root;
    }

    function picker(manage) {
        var r = mount();
        r.classList.toggle('manage', !!manage);
        r.innerHTML = '<h1>' + (manage ? 'Manage Profiles:' : 'Who’s watching?') + '</h1><div class="ruby-who__list"></div>' +
            '<button class="ruby-who__btn' + (manage ? ' ruby-who__btn--white' : '') + '">' + (manage ? 'Done' : 'Manage Profiles') + '</button>';
        var list = r.querySelector('.ruby-who__list');
        state.list.forEach(function (p) {
            var el = document.createElement('div');
            el.className = 'ruby-who__p';
            el.tabIndex = 0;
            el.innerHTML = avatar(p) + '<div class="ruby-who__name">' + esc(p.name) + '</div>';
            el.querySelector('.ruby-avatar').insertAdjacentHTML('beforeend', '<div class="ruby-who__edit">' + rubyIcons.svg('pencil') + '</div>');
            var go = function () { if (r.classList.contains('manage')) edit(p); else switchTo(p.id); };
            el.addEventListener('click', go);
            el.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
            list.appendChild(el);
        });
        if (state.list.length < MAX) {
            var add = document.createElement('div');
            add.className = 'ruby-who__p ruby-who__add';
            add.tabIndex = 0;
            add.innerHTML = '<div class="ruby-avatar">' + rubyIcons.svg('plus') + '</div><div class="ruby-who__name">Add Profile</div>';
            add.addEventListener('click', function () { edit(null); });
            list.appendChild(add);
        }
        r.querySelector('.ruby-who__btn').addEventListener('click', function () { picker(!manage); });
    }

    // add (p = null) or edit a profile: name + colour; delete for any profile but the one in use
    function edit(p) {
        var r = mount(), draft = p ? { name: p.name, color: p.color, img: p.img || null } : { name: '', color: state.list.length % COLORS.length, img: null };
        r.classList.remove('manage');
        r.innerHTML = '<div class="ruby-who__form"><h1>' + (p ? 'Edit Profile' : 'Add Profile') + '</h1>' +
            (p ? '' : '<div style="color:#999;margin-bottom:1.2em">Add a profile for another person watching. It starts with its own empty list, history and taste.</div>') +
            '<div class="ruby-who__row"><div class="ruby-who__av"></div><div style="flex:1"><input class="ruby-who__input" maxlength="20" placeholder="Name"><div class="ruby-who__colors"></div></div></div>' +
            '<div class="ruby-who__actions"><button class="ruby-who__btn ruby-who__btn--white" data-a="save">Save</button><button class="ruby-who__btn" data-a="cancel">Cancel</button>' +
            (p && p.id !== state.current ? '<button class="ruby-who__btn" data-a="delete">Delete Profile</button>' : '') + '</div></div>';
        var input = r.querySelector('.ruby-who__input'), av = r.querySelector('.ruby-who__av'), colors = r.querySelector('.ruby-who__colors');
        input.value = draft.name;
        function paint() {
            av.innerHTML = avatar(draft);
            [].forEach.call(colors.children, function (c, i) { c.classList.toggle('on', i === draft.color); });
        }
        COLORS.forEach(function (c, i) {
            var sw = document.createElement('div');
            sw.className = 'ruby-who__color';
            sw.style.background = c;
            sw.addEventListener('click', function () { draft.color = i; paint(); });
            colors.appendChild(sw);
        });
        paint();
        if (window.rubyAvatars) {
            var form = r.querySelector('.ruby-who__form');
            rubyAvatars.gallery(form, draft.img, function (path) { draft.img = path; paint(); });
            form.appendChild(form.querySelector('.ruby-who__actions'));   // Save / Cancel under the pictures
        }
        setTimeout(function () { input.focus(); }, 50);
        function commit() {
            var name = input.value.trim();
            if (!name) return input.focus();
            if (p) { p.name = name; p.color = draft.color; p.img = draft.img || undefined; }
            else state.list.push(p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, color: draft.color, img: draft.img || undefined });
            saveList({ upsert: p });
            picker(true);
        }
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') commit(); if (e.key === 'Escape') picker(true); });
        r.querySelector('[data-a=save]').addEventListener('click', commit);
        r.querySelector('[data-a=cancel]').addEventListener('click', function () { picker(true); });
        var del = r.querySelector('[data-a=delete]');
        if (del) del.addEventListener('click', function () {
            if (!confirm('Delete the profile "' + p.name + '"? Its list, history, ratings and Trakt login are removed on every device.')) return;
            log('deleted profile', { id: p.id, name: p.name });
            state.list = state.list.filter(function (x) { return x.id !== p.id; });
            if (!rubyStore.remote) rubyStore.del('profile-' + p.id + '.json');   // the service keeps it in its trash
            saveList({ remove: p.id });
            picker(true);
        });
    }

    window.rubyProfiles = {
        list: function () { return state.list.slice(); },
        current: function () { return find(state.current); },
        avatar: avatar,
        switchTo: switchTo,
        log: log,
        picker: function () { picker(false); },
        manage: function () { picker(true); }
    };

    // TVs (Samsung/LG through MSX, Android TV): the picker is built for a mouse, and Lampa's TV look has
    // no top bar to switch from - stay on the remembered profile there
    var TV = /Tizen|Web0S|webOS|SMART-TV|SmartTV|NetCast|Android TV|BRAVIA|AFT[BMST]/i.test(navigator.userAgent);
    function boot() { css(); if (!state.chosen && !TV) picker(false); syncList(); }
    if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
