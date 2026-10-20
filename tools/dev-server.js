// A local copy of a Lampa Desktop install, for testing this checkout (CLAUDE.md, "Testing"):
//   * this repo's files, index.html with the host's lampa-init.js / lampa-imdb.js injected (as a real install
//     injects them)
//   * the host's back end proxied: /ts/* (TorrServer), /jackett, /jr, /imdb, /plugins, lampa-init.js
//   * /ts/gst/* to a local remux service (node server/remux/server.js, REMUX_PORT)
//   * /sync/ is an in-memory folder that dies with this process: test data never reaches real shared profiles
// LAMPA_UPSTREAM=host (default "ruby"; TorrServer on :8090, the rest on :80), DEV_PORT (8095), REMUX_PORT (8092).
// node tools/dev-server.js, then open http://127.0.0.1:8095/
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PORT = +(process.env.DEV_PORT || 8095), SYNC = {};
const UP = process.env.LAMPA_UPSTREAM || 'ruby', REMUX = +(process.env.REMUX_PORT || 8092);
const TYPES = { html: 'text/html', js: 'application/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2', ico: 'image/x-icon' };

function proxy(req, res, host, port, p, slow) {
    const up = http.request({ host, port, path: p, method: req.method, headers: Object.assign({}, req.headers, { host: host + ':' + port }) }, r => {
        res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    up.on('error', e => { if (!res.headersSent) res.writeHead(502); res.end(String(e)); });
    // the remux's answers wait for the torrent (a master for ffprobe, a segment for ffmpeg): no limit, as Caddy
    if (!slow) up.setTimeout(3000, () => up.destroy(new Error('upstream timeout')));
    req.pipe(up);
}

http.createServer((req, res) => {
    const u = req.url;
    if (u.startsWith('/sync/')) {   // in-memory stand-in for the shared WebDAV folder: never the real one
        const name = decodeURIComponent(u.slice(6).split('?')[0]);
        if (req.method === 'PUT') { let d = ''; req.on('data', c => d += c); return req.on('end', () => { SYNC[name] = d; res.writeHead(201); res.end(); }); }
        if (req.method === 'DELETE') { delete SYNC[name]; res.writeHead(204); return res.end(); }
        if (name === '__all') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(SYNC)); }
        if (!(name in SYNC)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(SYNC[name]);
    }
    if (u.startsWith('/ts/gst/')) return proxy(req, res, '127.0.0.1', REMUX, u.slice(3), true);
    if (u.startsWith('/ts/')) return proxy(req, res, UP, 8090, u.slice(3));
    if (/^\/(jackett|jr|imdb|plugins|lampa-init\.js|lampa-imdb\.js)/.test(u)) return proxy(req, res, UP, 80, u);
    let p = decodeURIComponent(u.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(file);
    if (p === '/index.html') body = body.toString().replace('<script src="./webos/webOSTV.js"></script>',
        '<script src="./lampa-init.js"></script>\n    <script src="./lampa-imdb.js"></script>\n    <script src="./webos/webOSTV.js"></script>');
    res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log('dev copy on http://127.0.0.1:' + PORT));
process.on('uncaughtException', e => console.error('dev error:', e.message));
