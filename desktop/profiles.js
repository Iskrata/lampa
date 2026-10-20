// Netflix-style profiles for Lampa (desktop/README.md). Loaded by index.html after store.js, before Lampa.
// Lampa keeps everything in localStorage under fixed keys and has no local profiles (its own need a CUB
// account). So a profile is a set of those keys: the active profile's values are the live keys Lampa and
// its plugins use; every profile's values are also kept as profile-<id>.json in rubyStore (store.js) -
// a ./sync/ folder on the server when there is one, so all devices share the profiles, else this browser.
// Switching uploads the current profile, marks the target in ruby_profile_switch and reloads; the swap
// runs here at the start of the next page load, before app.min.js has read anything, so nothing leaks.
// While a profile is in use its data is uploaded every 15 s when it changed and when the tab is hidden;
// at page start a newer copy from another device replaces the local one (the last write wins).
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
    var SHARED = ['trakt_client_id', 'trakt_client_secret'];
    var MAX = 10;
    var NOT_SYNCED = /cache|_log$|debug/;   // per profile, but rebuilt on their own: not worth uploading
    var COLORS = ['#2f6fdf', '#e50914', '#1f9d55', '#8b3fd9', '#e8730c', '#0e9aa7'];
    var UPLOAD_MS = 15000;

    function own(key) {
        if (SHARED.indexOf(key) >= 0) return false;
        return OWN.indexOf(key) >= 0 || OWN_PREFIX.some(function (p) { return key.indexOf(p) === 0; });
    }
    function parse(text) { try { return text ? JSON.parse(text) : null; } catch (e) { return null; } }
    function load() {
        var s = parse(ls.getItem(STATE));
        if (!s || !s.list || !s.list.length) s = { list: [{ id: 'p1', name: 'Me', color: 0 }], current: 'p1', chosen: false };
        return s;
    }
    function save() { ls.setItem(STATE, JSON.stringify(state)); }
    function saveList() { save(); rubyStore.put('profiles.json', JSON.stringify({ list: state.list })); }
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
        liveKeys().forEach(function (k) { ls.removeItem(k); });
        var keys = (blob && blob.keys) || {};
        Object.keys(keys).forEach(function (k) { ls.setItem(k, keys[k]); });
        state.dataT = (blob && blob.t) || 0;
    }

    // ---- page start (before Lampa): only a profile switch reads from the store, synchronously, because the
    // page must start with the target's data. Everything else is checked in the background (syncList).
    var state = load();
    try {
        // profiles kept by the old local-only version (ruby_profile_data_<id>) move into the store, but only
        // under an id it has nothing for: every browser's first profile is p1, so in a shared folder the id can
        // be someone else's (on 2026-10-18 an iPhone's empty old "Me" replaced Iskrata's history and list this
        // way). A taken id waits here for the first contact with the shared list (syncList), which moves a
        // differently named profile's data to its new id.
        Object.keys(ls).filter(function (k) { return k.indexOf(OLD_DATA) === 0; }).forEach(function (k) {
            var name = 'profile-' + k.slice(OLD_DATA.length) + '.json', stored = rubyStore.get(name);
            if (stored !== null) return;   // taken, or the server is unreachable (try again next time)
            rubyStore.put(name, JSON.stringify({ t: 1, keys: parse(ls.getItem(k)) || {}, by: by('old local profile') }));
            ls.removeItem(k);
            log('old local profile uploaded', { file: name });
        });
        var target = ls.getItem(SWITCH);
        ls.removeItem(SWITCH);
        // (also "switching" to the same id when this browser has never loaded that profile's data: a new
        // browser picking the profile it happened to start on)
        if (target && find(target) && (target !== state.current || !state.dataT)) {
            apply(parse(rubyStore.get('profile-' + target + '.json')));
            state.current = target;
            state.chosen = true;
        }
        save();
    } catch (e) {
        console.error('profiles: start failed', e);
    }

    // ---- after start: the shared list, and a newer copy of this profile from another device
    function syncList() {
        rubyStore.getAsync('profiles.json').then(function (shared) {
            if (shared === undefined) return;
            var server = parse(shared);
            if (!state.synced) {
                // this browser's first contact with the shared list: keep its own profiles too. Every browser's
                // first profile is 'p1', so a local profile whose id is taken by a differently named one on the
                // server gets a new id (and keeps its data) instead of landing on someone else's profile; a new
                // browser's untouched default "Me" is not added at all.
                // A profile already in the shared list under the same id and name is the same one: its shared data
                // wins over this browser's (dataT 0 makes the check below take it), never the other way round.
                var list = server && server.list ? server.list : [];
                var fresh = !state.chosen && state.list.length === 1 && list.length > 0;
                var added = {}, renamed = {};
                state.list.forEach(function (p) {
                    if (fresh) return;
                    var same = list.filter(function (q) { return q.id === p.id; })[0];
                    if (same && same.name === p.name) { if (state.current === p.id) state.dataT = 0; return; }
                    if (same) {
                        var id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                        if (state.current === p.id) state.current = id;
                        var old = ls.getItem(OLD_DATA + p.id);
                        if (old) rubyStore.put('profile-' + id + '.json', JSON.stringify({ t: 1, keys: parse(old) || {}, by: by('old local profile') }));
                        renamed[p.id] = id;
                        p = { id: id, name: p.name, color: p.color, img: p.img };
                    }
                    added[p.id] = true;
                    list.push(p);
                });
                Object.keys(ls).filter(function (k) { return k.indexOf(OLD_DATA) === 0; }).forEach(function (k) { ls.removeItem(k); });
                state.list = list.slice(0, MAX);
                state.synced = true;
                rubyStore.put('profiles.json', JSON.stringify({ list: state.list }));
                if (added[state.current]) rubyStore.put('profile-' + state.current + '.json', JSON.stringify(snapshot('first contact')));
                log('first contact', { fresh: fresh, added: Object.keys(added), renamed: renamed, shared: list.length });
            } else if (server && server.list && server.list.length) state.list = server.list;
            else if (shared === null) rubyStore.put('profiles.json', JSON.stringify({ list: state.list }));   // server copy gone: re-seed
            save();
            if (root && !root.classList.contains('manage') && !root.querySelector('.ruby-who__form')) picker(false);   // refresh an open picker
            if (!find(state.current)) {   // deleted on another device: move to the first profile, then pick again
                state.chosen = false;
                ls.setItem(SWITCH, state.list[0].id);
                save();
                return location.replace(location.pathname);
            }
            if (!rubyStore.remote || !state.chosen) return;   // nothing to refresh before someone has picked
            rubyStore.getAsync('profile-' + state.current + '.json').then(function (text) {
                var latest = parse(text);
                if (!latest || !(latest.t > (state.dataT || 0))) return;
                // changed on another device since this browser last saw it: take it over (Lampa has read its
                // storage already, so reload once), unless the content is the same anyway
                if (JSON.stringify(latest.keys) === JSON.stringify(snapshot().keys)) { state.dataT = latest.t; return save(); }
                log('took the newer copy', { t: latest.t, had: state.dataT || 0, by: latest.by || null, diff: diff(snapshot().keys, latest.keys) });
                apply(latest);
                save();
                location.replace(location.pathname);
            });
        });
    }

    // ---- while in use: upload the profile's data when it changed. Another device on the same profile may have
    // written it since this page last read or wrote it, and the last write wins: a tab left open used to undo
    // what the other device did (2026-10-20: an open Safari tab put a title removed on the server straight
    // back). So each upload first reads the server's copy. When another device wrote it, the two are merged
    // key by key against what this page last had: a key only one side changed keeps that change; one both
    // changed keeps this page's, except watch progress (file_view), merged per title. The page then reloads so
    // Lampa reads the merge, but never during playback: until the player closes, nothing is uploaded.
    // A page being closed ('closing') can't wait for the read; it skips the upload once a conflict is known.
    var lastSent = '', checking = false, conflict = false;
    function file() { return 'profile-' + state.current + '.json'; }
    function send(snap, keepalive) {
        lastSent = JSON.stringify(snap.keys);
        state.dataT = snap.t;
        save();
        rubyStore.put(file(), JSON.stringify(snap), keepalive);
    }
    // which keys differ, for the logs (sizes, not contents)
    function diff(a, b) {
        var out = {};
        Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
            if (a[k] !== b[k]) out[k] = (a[k] || '').length + ' -> ' + (b[k] || '').length;
        });
        return out;
    }
    function mergeViews(a, b) {   // per title, the more recently watched
        var x = parse(a) || {}, y = parse(b) || {};
        Object.keys(y).forEach(function (h) { if (!x[h] || (y[h].updated || 0) > (x[h].updated || 0)) x[h] = y[h]; });
        return JSON.stringify(x);
    }
    function merge(base, ours, theirs) {
        var out = {};
        Object.keys(base).concat(Object.keys(ours), Object.keys(theirs)).forEach(function (k) {
            var v = ours[k] === base[k] ? theirs[k] : theirs[k] === base[k] ? ours[k] :
                k.indexOf('file_view') === 0 ? mergeViews(ours[k], theirs[k]) : ours[k];
            if (v !== undefined) out[k] = v;
        });
        return out;
    }
    function upload(why) {
        if (!state.chosen || checking) return;   // a new browser before its first pick holds nobody's data
        var snap = snapshot(why);
        if (JSON.stringify(snap.keys) === lastSent) return;
        if (!rubyStore.remote) return send(snap);
        if (why === 'closing') return conflict ? log('closed with a conflict, not uploaded') : send(snap, true);
        checking = true;
        rubyStore.getAsync(file()).then(function (text) {
            checking = false;
            if (text === undefined) return;   // server unreachable: next round
            var server = parse(text), now = snapshot(why);
            if (!server || server.t === state.dataT || (server.by && server.by.device === device)) return send(now, why === 'hidden');
            if (!conflict) log('conflict', { theirs: server.by || null, t: server.t, had: state.dataT || 0, diff: diff(parse(lastSent) || {}, server.keys || {}) });
            conflict = true;
            if (window.Lampa && Lampa.Player && Lampa.Player.opened()) return;   // after the player closes
            var merged = { t: Date.now(), keys: merge(parse(lastSent) || {}, now.keys, server.keys || {}), by: by('merged') };
            log('merged', { diff: diff(now.keys, merged.keys) });
            apply(merged);
            lastSent = JSON.stringify(merged.keys);
            conflict = false;
            save();
            rubyStore.putNow(file(), JSON.stringify(merged));
            location.replace(location.pathname);
        });
    }
    lastSent = JSON.stringify(snapshot().keys);
    setInterval(function () { upload('changed'); }, UPLOAD_MS);
    document.addEventListener('visibilitychange', function () { if (document.hidden) upload('hidden'); });
    window.addEventListener('pagehide', function () { upload('closing'); });

    function switchTo(id) {
        if (id === state.current && (state.dataT || !rubyStore.remote)) { state.chosen = true; save(); close(); return; }
        log('switch', { to: id, conflict: conflict });
        if (state.chosen && !conflict) {   // (with a conflict pending, this page's copy is stale: leave the server's)
            var snap = snapshot('switch');
            rubyStore.putNow('profile-' + state.current + '.json', JSON.stringify(snap));
            state.dataT = snap.t;
        }
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
            else state.list.push({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, color: draft.color, img: draft.img || undefined });
            saveList();
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
            rubyStore.del('profile-' + p.id + '.json');
            saveList();
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
