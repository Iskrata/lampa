// Where profiles live (desktop/README.md). Loaded by index.html before profiles.js, before Lampa.
// With a WebDAV folder at ./sync/ on the same origin (any server that answers GET and PUT for files),
// profiles and each profile's data are kept there, so every browser and device sees the same profiles.
// Without one (a plain static host), they stay in this browser's localStorage, as before.
// Reads happen at page start, before Lampa reads its own storage, so they are synchronous requests (a
// few small JSON files from the same server). Writes are asynchronous; the last write wins.
// rubyStore.get(name) -> string | null (missing) | undefined (server unreachable), .put(name, text),
// .del(name), .remote (true when the server folder is in use).
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
    // the real test; the answer is remembered per browser (re-tested when it was "local").
    function probe() {
        var known = ls.getItem(PROBE);
        if (known === 'remote') return true;
        var x = request('PUT', '.probe', '{}', true);
        var ok = !!x && x.status >= 200 && x.status < 300;
        ls.setItem(PROBE, ok ? 'remote' : 'local');
        return ok;
    }
    var remote = probe();

    window.rubyStore = {
        remote: remote,
        get: function (name) {
            if (!remote) return ls.getItem(LOCAL + name);
            var x = request('GET', name, null, true);
            if (!x || x.status === 0 || x.status >= 500) return undefined;
            return x.status === 200 ? x.responseText : null;
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
        del: function (name) {
            if (!remote) return ls.removeItem(LOCAL + name);
            fetch(BASE + encodeURIComponent(name), { method: 'DELETE' }).catch(function () {});
        }
    };
})();
