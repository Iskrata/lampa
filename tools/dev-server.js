// A local copy of a Lampa Desktop install, for testing this checkout (CLAUDE.md, "Testing"):
//   * this repo's files, index.html with the host's lampa-init.js / lampa-imdb.js injected (as a real install
//     injects them)
//   * the host's back end proxied: /ts/* (TorrServer), /jackett, /jr, /imdb, /plugins, lampa-init.js
//   * /ts/gst/* to a local remux service (node server/remux/server.js, REMUX_PORT)
//   * /sync/ is the profile service (server/sync/server.js) over a temporary folder that goes with this process:
//     test data never reaches real shared profiles. /sync/__all lists every file in it, for tests.
//   * DEV_CONSOLE=1: the page's console.log/warn/error and uncaught errors are printed here too, for browsers
//     whose console can't be reached (the iOS simulator's Safari)
// LAMPA_UPSTREAM=host (default "ruby"; TorrServer on :8090, the rest on :80), DEV_PORT (8095), REMUX_PORT (8092).
// node tools/dev-server.js, then open http://127.0.0.1:8095/
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PORT = +(process.env.DEV_PORT || 8095);
const SYNC_TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lampa-sync-')), SYNC_DIR = path.join(SYNC_TMP, 'data');
const sync = require('../server/sync/server').handler({ data: SYNC_DIR, journal: path.join(SYNC_TMP, 'journal'), trash: path.join(SYNC_TMP, 'trash') });
process.on('exit', () => fs.rmSync(SYNC_TMP, { recursive: true, force: true }));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
const UP = process.env.LAMPA_UPSTREAM || 'ruby', REMUX = +(process.env.REMUX_PORT || 8092);
const CONSOLE = process.env.DEV_CONSOLE === '1';
// sends the page's console to /__console (ES5: it runs before everything else, on old browsers too)
const CONSOLE_JS = '<script>(function(){var t0=Date.now();function send(k,a){try{var s=[].map.call(a,function(x){' +
    'try{return typeof x==="string"?x:JSON.stringify(x)}catch(e){return String(x)}}).join(" ");' +
    'navigator.sendBeacon("./__console",((Date.now()-t0)/1000).toFixed(1)+" "+k+" "+s.slice(0,2000))}catch(e){}}' +
    '["log","warn","error"].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);return o.apply(console,arguments)}});' +
    'addEventListener("error",function(e){send("uncaught",[e.message+" "+(e.filename||"")+":"+e.lineno])});' +
    'addEventListener("unhandledrejection",function(e){send("rejection",[String(e.reason)])});' +
    // where the page itself goes (Chromium): a navigation away leaves nothing else to inspect
    'if(window.navigation)navigation.addEventListener("navigate",function(e){send("navigate",[e.destination.url])});' +
    // ... also by a link's click() or window.open (a magnet: or a download leaves no navigate event), and leaving
    'var ck=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){send("link-click",[this.href]);return ck.apply(this,arguments)};' +
    'var wo=window.open;window.open=function(u){send("window.open",[String(u)]);return wo.apply(window,arguments)};' +
    'addEventListener("pagehide",function(){send("pagehide",[location.href])})})()</script>';
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
    if (CONSOLE && u === '/__console') {
        let b = '';
        req.on('data', d => b += d).on('end', () => { console.log('page', b); res.end(); });
        return;
    }
    if (u.startsWith('/sync/')) {
        if (u.startsWith('/sync/__all')) {
            const all = {};
            for (const f of fs.readdirSync(SYNC_DIR)) if (!f.endsWith('.tmp')) all[f] = fs.readFileSync(path.join(SYNC_DIR, f), 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(all));
        }
        req.url = u.slice(5);
        return sync(req, res);
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
        '<script src="./lampa-init.js"></script>\n    <script src="./lampa-imdb.js"></script>\n    <script src="./webos/webOSTV.js"></script>')
        .replace('<head>', '<head>' + (CONSOLE ? CONSOLE_JS : ''));
    res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log('dev copy on http://127.0.0.1:' + PORT));
process.on('uncaughtException', e => console.error('dev error:', e.message));
