// Netflix-style profiles for Lampa (desktop/README.md). Loaded FIRST by index.html, before Lampa.
// Lampa keeps everything in this browser's localStorage under fixed keys and has no local profiles (its
// own "profiles" need a CUB account). So a profile is a set of those keys: the active profile's values
// are the live keys Lampa and its plugins use, and every other profile's values wait in
// ruby_profile_data_<id>. Switching marks the target in ruby_profile_switch and reloads; the swap runs
// here at the start of the next page load, before app.min.js has read anything (and after the old page
// can no longer write), so nothing leaks between profiles.
// Per profile: bookmarks/My List, watch history and progress, search history, thumbs ratings
// (ratings.js) and the Trakt login with all Trakt plugin state - so one person's IMDb/Trakt taste
// never reaches another. Shared: settings, servers, plugins, the Trakt app id.
// The picker ("Who's watching?") shows on the first visit in a browser; the choice is remembered in
// localStorage and changed from the top bar's profile menu (rubyProfiles.picker()).
(function () {
    var ls = window.localStorage, STATE = 'ruby_profiles', DATA = 'ruby_profile_data_', SWITCH = 'ruby_profile_switch';
    var OWN = ['favorite', 'file_view', 'online_view', 'online_watched_last', 'torrents_view', 'timetable', 'search_history',
        'recomends_list', 'recomends_scan', 'mine_reactions', 'user_clarifys', 'person_subscribes_id', 'discuss_voited', 'activity'];
    var OWN_PREFIX = ['file_view_', 'trakt', 'ruby_ratings'];
    var SHARED = ['trakt_client_id', 'trakt_client_secret'];
    var COLORS = ['#2f6fdf', '#e50914', '#1f9d55', '#8b3fd9', '#e8730c', '#0e9aa7'];

    function own(key) {
        if (SHARED.indexOf(key) >= 0) return false;
        return OWN.indexOf(key) >= 0 || OWN_PREFIX.some(function (p) { return key.indexOf(p) === 0; });
    }
    function load() {
        var s = null;
        try { s = JSON.parse(ls.getItem(STATE)); } catch (e) {}
        if (!s || !s.list || !s.list.length) s = { list: [{ id: 'p1', name: 'Me', color: 0 }], current: 'p1', chosen: false };
        return s;
    }
    function save() { ls.setItem(STATE, JSON.stringify(state)); }
    function find(id) { return state.list.filter(function (p) { return p.id === id; })[0]; }

    // ---- the swap, at page start
    var state = load();
    try {
        var target = ls.getItem(SWITCH);
        ls.removeItem(SWITCH);
        if (target && target !== state.current && find(target)) {
            var mine = {}, keys = [];
            for (var i = 0; i < ls.length; i++) keys.push(ls.key(i));
            keys.filter(own).forEach(function (k) { mine[k] = ls.getItem(k); ls.removeItem(k); });
            ls.setItem(DATA + state.current, JSON.stringify(mine));
            var theirs = {};
            try { theirs = JSON.parse(ls.getItem(DATA + target) || '{}'); } catch (e) {}
            Object.keys(theirs).forEach(function (k) { ls.setItem(k, theirs[k]); });
            ls.removeItem(DATA + target);
            state.current = target;
            state.chosen = true;
        }
        save();
    } catch (e) {
        console.error('lampa-profiles: switch failed', e);
    }

    function switchTo(id) {
        if (id === state.current) { state.chosen = true; save(); close(); return; }
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

    function avatar(p) {
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
        if (state.list.length < 5) {
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
        var r = mount(), draft = p ? { name: p.name, color: p.color } : { name: '', color: state.list.length % COLORS.length };
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
        setTimeout(function () { input.focus(); }, 50);
        function commit() {
            var name = input.value.trim();
            if (!name) return input.focus();
            if (p) { p.name = name; p.color = draft.color; }
            else state.list.push({ id: 'p' + Date.now().toString(36), name: name, color: draft.color });
            save();
            picker(true);
        }
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') commit(); if (e.key === 'Escape') picker(true); });
        r.querySelector('[data-a=save]').addEventListener('click', commit);
        r.querySelector('[data-a=cancel]').addEventListener('click', function () { picker(true); });
        var del = r.querySelector('[data-a=delete]');
        if (del) del.addEventListener('click', function () {
            if (!confirm('Delete the profile "' + p.name + '"? Its list, history, ratings and Trakt login in this browser are removed.')) return;
            state.list = state.list.filter(function (x) { return x.id !== p.id; });
            ls.removeItem(DATA + p.id);
            save();
            picker(true);
        });
    }

    window.rubyProfiles = {
        list: function () { return state.list.slice(); },
        current: function () { return find(state.current); },
        avatar: avatar,
        switchTo: switchTo,
        picker: function () { picker(false); },
        manage: function () { picker(true); }
    };

    function boot() { css(); if (!state.chosen) picker(false); }
    if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
