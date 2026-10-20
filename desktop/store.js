// Where profiles live (desktop/README.md). Loaded by index.html before profiles.js, before Lampa.
// With a WebDAV folder at ./sync/ on the same origin (any server that answers GET and PUT for files),
// profiles and each profile's data are kept there, so every browser and device sees the same profiles.
// Without one (a plain static host), they stay in this browser's localStorage, as before.
// A normal page load makes no synchronous request: profiles.js reads in the background (getAsync) and
// only switching profile reads synchronously (get), because the next page must start with the right
// data. Writes are asynchronous; the last write wins.
// rubyStore.get(name) / .getAsync(name) -> string | null (missing) | undefined (server unreachable),
// .put(name, text, keepalive), .putNow(name, text), .del(name), .remote (the server folder is in use).
// On the home server ./sync/ is the profile service (server/sync/): profiles change only through
// .post(name, msg, keepalive) -> Promise of { status, body } (status 0: unreachable) and .postNow (synchronous).
(function () {
    var BASE = './sync/', LOCAL = 'ruby_store_', PROBE = 'ruby_store_mode';
    var ls = window.localStorage;

    function request(method, name, body, sync) {
        var x = new XMLHttpRequest();
        try {
            x.open(method, BASE + encodeURIComponent(name) + (method === 'GET' ? '?t=' + Date.now() : ''), !sync);
            if (body != null) x.setRequestHeader('Content-Type', 'application/json');
            x.send(body == null ? null : body);
        } catch (e) { return null; }
        return x;
    }

    // Is ./sync/ a writable folder here? A static server answers 404 for a missing file too, so a write is
    // the real test (one synchronous request, on a browser's first visit). "remote" is remembered for good,
    // "local" for a day, so a host without the folder doesn't pay for the test on every load.
    var LOCAL_RECHECK_MS = 864e5;
    function probe() {
        var known = ls.getItem(PROBE) || '';
        if (known === 'remote') return true;
        if (known.indexOf('local:') === 0 && Date.now() - +known.slice(6) < LOCAL_RECHECK_MS) return false;
        var x = request('PUT', '.probe', '{}', true);
        var ok = !!x && x.status >= 200 && x.status < 300;
        ls.setItem(PROBE, ok ? 'remote' : 'local:' + Date.now());
        return ok;
    }
    var remote = probe();
    function parseJson(t) { try { return JSON.parse(t); } catch (e) { return null; } }

    window.rubyStore = {
        remote: remote,
        get: function (name) {
            if (!remote) return ls.getItem(LOCAL + name);
            var x = request('GET', name, null, true);
            if (!x || x.status === 0 || x.status >= 500) return undefined;
            return x.status === 200 ? x.responseText : null;
        },
        getAsync: function (name) {
            if (!remote) return Promise.resolve(ls.getItem(LOCAL + name));
            return fetch(BASE + encodeURIComponent(name) + '?t=' + Date.now(), { cache: 'no-store' })
                .then(function (r) { return r.status === 200 ? r.text() : r.status === 404 ? null : undefined; })
                .catch(function () { return undefined; });
        },
        put: function (name, text, keepalive) {
            if (!remote) return ls.setItem(LOCAL + name, text);
            // keepalive: still delivered while the page unloads (switching profile, closing the tab)
            fetch(BASE + encodeURIComponent(name), { method: 'PUT', body: text, keepalive: !!keepalive && text.length < 60000,
                headers: { 'Content-Type': 'application/json' } }).catch(function () {});
        },
        putNow: function (name, text) {   // synchronous: before a reload that will read it straight back
            if (!remote) return ls.setItem(LOCAL + name, text);
            request('PUT', name, text, true);
        },
        post: function (name, msg, keepalive) {
            var text = JSON.stringify(msg);
            return fetch(BASE + encodeURIComponent(name), { method: 'POST', body: text, keepalive: !!keepalive && text.length < 60000,
                headers: { 'Content-Type': 'application/json' } })
                .then(function (r) { return r.text().then(function (t) { return { status: r.status, body: parseJson(t) }; }); })
                .catch(function () { return { status: 0, body: null }; });
        },
        postNow: function (name, msg) {
            var x = request('POST', name, JSON.stringify(msg), true);
            return { status: x ? x.status : 0, body: x ? parseJson(x.responseText) : null };
        },
        del: function (name) {
            if (!remote) return ls.removeItem(LOCAL + name);
            fetch(BASE + encodeURIComponent(name), { method: 'DELETE' }).catch(function () {});
        }
    };
})();
