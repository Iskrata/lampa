// Shared Trakt access for the Lampa Desktop modules (desktop/README.md). Loaded by index.html.
// Uses the same login as the Trakt plugin (Lampa.Storage trakt_token / trakt_refresh_token / expiry keys,
// written in the plugin's own format - saveTokens() in the Trakt plugin trakttv.js - so the plugin keeps it
// refreshed) and your own Trakt API app (trakt_client_id; a public PKCE client works with an empty secret).
// The login is per profile (profiles.js keeps every trakt* key with the profile).
// rubyTrakt.connect() is a direct device-code sign-in (the plugin's own button is deep in its settings
// under Multi-account -> "Not linked"). api.trakt.tv answers CORS preflights with ACAO: *.
(function () {
    var API = 'https://api.trakt.tv', USER = 'trakt_ruby_user', RELATED = 'ruby_related_v1';
    var recs = {};
    try { recs = JSON.parse(sessionStorage.getItem(RELATED) || '{}'); } catch (e) {}

    function token() { return Lampa.Storage.get('trakt_token', '') || ''; }
    function clientId() { return Lampa.Storage.get('trakt_client_id', '') || ''; }
    function connected() { return !!(token() && clientId()); }

    function call(method, path, body, done) {
        var headers = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': clientId() };
        if (token()) headers.Authorization = 'Bearer ' + token();
        fetch(API + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
            .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
            .then(function (j) { if (done) done(j); })
            .catch(function () { if (done) done(null); });
    }

    // the signed-in Trakt username (cached with the profile), or null
    function user(done) {
        if (!connected()) return done(null);
        var u = Lampa.Storage.get(USER, '');
        if (u) return done(u);
        call('GET', '/users/settings', null, function (j) {
            var name = j && j.user && j.user.username;
            if (name) Lampa.Storage.set(USER, name);
            done(name || null);
        });
    }

    // Titles related to one title: Trakt's /related (works without a login, only the app id; far better
    // than TMDB's - for Inception: Minority Report, Looper, Dark City, The Matrix... vs TMDB's Paycheck,
    // The Dark Tower, Push..., checked 2026-10-13). Trakt needs its own id: /search/tmdb first. Cached.
    // -> [{kind, id}] (TMDB ids); without a Trakt app id: []
    function related(kind, id, done) {
        if (!clientId()) return done([]);
        var k = kind + id;
        if (recs[k]) return done(recs[k]);
        var type = kind === 'tv' ? 'show' : 'movie';
        call('GET', '/search/tmdb/' + id + '?type=' + type, null, function (found) {
            var o = found && found[0] && found[0][type];
            if (!o || !o.ids || !o.ids.trakt) return done(recs[k] = []);
            call('GET', '/' + type + 's/' + o.ids.trakt + '/related?limit=15', null, function (list) {
                recs[k] = (list || []).map(function (x) { return x.ids && x.ids.tmdb ? { kind: kind, id: x.ids.tmdb } : null; }).filter(Boolean);
                try { sessionStorage.setItem(RELATED, JSON.stringify(recs)); } catch (e) {}
                done(recs[k]);
            });
        });
    }

    // ---- device-code sign-in
    var CSS = [
        '.ruby-tk{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);' +
            '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:#fff}',
        '.ruby-tk__box{width:min(30em,90vw);background:#181818;border-radius:.6em;padding:2.2em 2.4em;box-shadow:0 1.5em 4em rgba(0,0,0,.6);text-align:center;font-size:16px}',
        '.ruby-tk__box h2{margin:0 0 .4em;font-size:1.6em;font-weight:600}',
        '.ruby-tk__box p{color:#b3b3b3;margin:.4em 0;line-height:1.45}',
        '.ruby-tk__code{font:600 2.4em ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;margin:.5em 0;padding:.3em;background:#262626;border-radius:.25em;user-select:all}',
        '.ruby-tk__btns{display:flex;gap:.8em;justify-content:center;margin-top:1.4em}',
        '.ruby-tk__btn{padding:.6em 1.4em;border-radius:.3em;border:0;font-size:1em;font-weight:600;cursor:pointer;background:#fff;color:#000}',
        '.ruby-tk__btn--ghost{background:rgba(109,109,110,.7);color:#fff}'
    ].join('\n');

    function connect() {
        if (!clientId()) return Lampa.Noty.show('Trakt app id missing (Settings -> Trakt.TV -> Client ID)');
        if (!document.getElementById('ruby-tk-css')) {
            var st = document.createElement('style'); st.id = 'ruby-tk-css'; st.textContent = CSS; document.head.appendChild(st);
        }
        var box = document.createElement('div'), poll = 0, done = false;
        box.className = 'ruby-tk';
        box.innerHTML = '<div class="ruby-tk__box"><h2>Connect Trakt</h2><p>Getting a code…</p></div>';
        ['keydown', 'keyup'].forEach(function (ev) { box.addEventListener(ev, function (e) { e.stopPropagation(); if (e.key === 'Escape') close(); }); });
        document.body.appendChild(box);
        function close() { done = true; clearTimeout(poll); box.remove(); }
        box.addEventListener('click', function (e) { if (e.target === box) close(); });
        call('POST', '/oauth/device/code', { client_id: clientId() }, function (d) {
            if (done) return;
            if (!d || !d.user_code) { box.querySelector('p').textContent = 'Trakt did not answer. Try again in a minute.'; return; }
            var url = d.verification_url || 'https://trakt.tv/activate';
            box.firstChild.innerHTML = '<h2>Connect Trakt</h2><p>Open <b>' + url.replace(/^https?:\/\//, '') + '</b> and enter this code:</p>' +
                '<div class="ruby-tk__code"></div><p>This profile gets your Trakt watchlist, history, ratings and recommendations. Waiting for Trakt…</p>' +
                '<div class="ruby-tk__btns"><button class="ruby-tk__btn" data-a="open">Copy code &amp; open Trakt</button><button class="ruby-tk__btn ruby-tk__btn--ghost" data-a="cancel">Cancel</button></div>';
            box.querySelector('.ruby-tk__code').textContent = d.user_code;
            box.querySelector('[data-a=open]').addEventListener('click', function () {
                try { navigator.clipboard.writeText(d.user_code); } catch (e) {}
                window.open(url, '_blank', 'noopener');
            });
            box.querySelector('[data-a=cancel]').addEventListener('click', close);
            var until = Date.now() + (d.expires_in || 600) * 1000, every = (d.interval || 5) * 1000;
            (function check() {
                if (done || Date.now() > until) return;
                fetch(API + '/oauth/device/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: d.device_code, client_id: clientId(), client_secret: Lampa.Storage.get('trakt_client_secret', '') || '' }) })
                    .then(function (r) { return r.status === 200 ? r.json() : null; })
                    .then(function (t) {
                        if (done) return;
                        if (!t || !t.access_token) { poll = setTimeout(check, every); return; }
                        // the Trakt plugin's own token format (saveTokens in trakttv.js)
                        var created = t.created_at || Math.floor(Date.now() / 1000);
                        Lampa.Storage.set('trakt_token', t.access_token);
                        Lampa.Storage.set('trakt_refresh_token', t.refresh_token);
                        Lampa.Storage.set('trakt_token_created_at', created);
                        Lampa.Storage.set('trakt_token_expires_in', t.expires_in);
                        Lampa.Storage.set('trakt_token_expires_at', created * 1000 + t.expires_in * 1000);
                        Lampa.Storage.set(USER, '');
                        box.firstChild.innerHTML = '<h2>Trakt connected</h2><p>Loading your Home…</p>';
                        setTimeout(function () { location.replace(location.pathname); }, 900);
                    })
                    .catch(function () { poll = setTimeout(check, every); });
            })();
        });
    }

    // the Trakt API app id, shared with the Trakt plugin when that is installed (same key)
    function settings() {
        if (!Lampa.SettingsApi || Lampa.Platform.tv()) return;
        Lampa.SettingsApi.addParam({
            component: 'interface',
            param: { name: 'trakt_client_id', type: 'input', values: '', default: '', placeholder: 'Client ID from trakt.tv/oauth/applications' },
            field: { name: 'Trakt Client ID', description: 'Your Trakt API app (trakt.tv/oauth/applications/new, redirect urn:ietf:wg:oauth:2.0:oob) - enables Connect Trakt and better recommendations' }
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Storage || !Lampa.Platform) return;
        clearInterval(t);
        settings();
        window.rubyTrakt = { connected: connected, get: function (p, cb) { call('GET', p, null, cb); }, post: function (p, b, cb) { call('POST', p, b, cb); },
            user: user, connect: connect, related: related };
    }, 20);
})();
