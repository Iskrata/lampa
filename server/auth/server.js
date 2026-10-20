// The login service (README.md): the password page of the public host, in place of the browser's basic-auth
// prompt. Caddy asks it about every request there (forward_auth → GET /auth/check); a request with a session
// cookie passes, a page load without one is sent to /login. Wrong passwords ban the address they came from.
// Node, no dependencies.
//   GET  /auth/check     forward_auth: 200 (pass) | 302 to /login or /auth/upgrade (page loads) | 401 (the rest)
//   GET  /login          the page; already signed in → back to ?next
//   POST /auth/login     password=…&next=…  → a session cookie and 303 to next, or back to /login with the reason
//   GET  /auth/upgrade   a browser that still holds the old basic-auth password: a session for it, then 303 to next
// Run: AUTH_PORT=8088 AUTH_DATA=<dir> AUTH_CREDENTIALS=<credentials.txt> [AUTH_TELEGRAM=<json>] [AUTH_BRAND=Ruby] node server.js
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net');
const { page } = require('./page');

const DAY = 864e5, MIN = 6e4;
const IDLE = 90 * DAY;                         // a session unused this long ends (each use renews it)
const COOKIE_AGE = 400 * DAY;                  // browsers' upper limit; the server's IDLE is what ends a session
const FAILS = 5, FAIL_WINDOW = 15 * MIN;       // this many wrong passwords from one address in the window: banned
const BANS = [60 * MIN, DAY, 7 * DAY];         // 1st, 2nd, 3rd+ ban
const BAN_MEMORY = 30 * DAY;                   // a ban this long ago no longer makes the next one longer
const GLOBAL_FAILS = 100, GLOBAL_WINDOW = 60 * MIN, GLOBAL_CLOSE = 60 * MIN;   // many addresses at once: login closes
const FAIL_DELAY = 1000, JOURNAL_DAYS = 90, FLUSH = 5 * MIN, MAX_BODY = 4096;

const sha = s => crypto.createHash('sha256').update(s).digest();
const hex = s => sha(s).toString('hex');
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// one key per address; IPv6 per /64, since a single home or server gets a whole /64 to rotate through
function addrKey(ip) {
    ip = String(ip || '').replace(/^::ffff:/, '');
    if (!net.isIPv6(ip)) return ip;
    let [head, tail] = ip.split('::');
    head = head ? head.split(':') : []; tail = tail !== undefined ? (tail ? tail.split(':') : []) : null;
    const full = tail ? head.concat(Array(8 - head.length - tail.length).fill('0'), tail) : head;
    return full.slice(0, 4).map(h => parseInt(h, 16).toString(16)).join(':') + '::/64';
}

function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
}

// a same-origin path to come back to after signing in; anything else (another site, the login itself) → /
function safeNext(n) {
    n = String(n || '/');
    return /^\/(?![\/\\])/.test(n) && !/^\/(login|auth\/)/.test(n) && !/[\r\n]/.test(n) ? n : '/';
}

function handler(opts) {
    const data = opts.data, journal = path.join(data, 'journal'), now = opts.now || Date.now;
    fs.mkdirSync(journal, { recursive: true });
    const brand = opts.brand || 'Lampa', secure = opts.secure !== false;
    // __Host-: only ever set by this host over https, for the whole site (no Domain, Path=/)
    const COOKIE = secure ? '__Host-ruby_session' : 'ruby_session';
    const file = n => path.join(data, n);
    const load = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch (e) { return d; } };
    function save(n, obj) {
        const tmp = file(n) + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(obj));
        for (let i = 0; ; i++) {
            try { return fs.renameSync(tmp, file(n)); }
            catch (e) { if (i >= 20 || e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
        }
    }

    // the password: read from the credentials file each time it is needed, so a new one counts at once.
    // Sessions remember which password made them (a hash of it): a changed password signs every device out.
    function password() {
        const c = opts.credentials();
        return { user: c.user, pw: c.password, mark: hex('session:' + c.password).slice(0, 16) };
    }

    // sessions: the hash of each cookie's token → { at, seen, ip, country, ua, pw }. The token itself is never stored.
    const sessions = load('sessions.json', {});
    let dirty = false;
    function flush() { if (dirty) { dirty = false; save('sessions.json', sessions); } }
    function sweep() {
        const t = now(), mark = password().mark;
        for (const k of Object.keys(sessions)) if (t - sessions[k].seen > IDLE || sessions[k].pw !== mark) { delete sessions[k]; dirty = true; }
        flush();
    }
    const timer = setInterval(sweep, FLUSH); timer.unref();

    // bans: address key → { fails: [times], level, until, banned (when last banned) }
    const bans = load('bans.json', {});
    const globalFails = [];
    let closedUntil = 0;

    function log(entry) {
        const day = new Date(now()).toISOString().slice(0, 10);
        fs.appendFileSync(path.join(journal, day + '.jsonl'), JSON.stringify(Object.assign({ t: new Date(now()).toISOString() }, entry)) + '\n');
    }
    let pruned = '';
    function prune() {
        const today = new Date(now()).toISOString().slice(0, 10);
        if (pruned === today) return;
        pruned = today;
        const cut = new Date(now() - JOURNAL_DAYS * DAY).toISOString().slice(0, 10);
        for (const f of fs.readdirSync(journal)) if (f.slice(0, 10) < cut) fs.rmSync(path.join(journal, f), { force: true });
    }
    function alert(text) {
        const tg = opts.telegram && opts.telegram();
        if (!tg || !tg.token || !tg.chat_id) return;
        const body = JSON.stringify({ chat_id: tg.chat_id, text: brand + ': ' + text, disable_web_page_preview: true });
        const r = require('https').request({ host: 'api.telegram.org', path: '/bot' + tg.token + '/sendMessage', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 15000 });
        r.on('error', e => console.error(new Date().toISOString(), 'telegram:', e.message));
        r.on('timeout', () => r.destroy(new Error('timeout')));
        r.end(body);
    }

    // who: the visitor's real address. Only Cloudflare reaches the public listener (cloudflared on loopback),
    // and Cloudflare sets CF-Connecting-IP itself, replacing any a visitor sent.
    function who(req) {
        const ip = (opts.trustCf !== false && req.headers['cf-connecting-ip']) || req.socket.remoteAddress;
        return { ip: ip, key: addrKey(ip), country: req.headers['cf-ipcountry'] || '', ua: String(req.headers['user-agent'] || '').slice(0, 200) };
    }
    const where = w => w.ip + (w.country ? ' (' + w.country + ')' : '');
    function banned(w) {
        const b = bans[w.key];
        return b && b.until > now() ? b.until : 0;
    }
    // a wrong password: counted per address and overall; the fifth in 15 min bans the address
    function failed(w, how) {
        const t = now();
        const b = bans[w.key] || (bans[w.key] = { fails: [], level: 0, until: 0, banned: 0 });
        b.fails = b.fails.filter(x => t - x < FAIL_WINDOW).concat(t);
        log({ ev: 'fail', how: how, ip: w.ip, country: w.country, ua: w.ua, fails: b.fails.length });
        if (b.fails.length >= FAILS) {
            if (t - b.banned > BAN_MEMORY) b.level = 0;
            const ms = BANS[Math.min(b.level, BANS.length - 1)];
            b.level++; b.until = t + ms; b.banned = t; b.fails = [];
            log({ ev: 'ban', ip: w.ip, key: w.key, country: w.country, ua: w.ua, hours: ms / 36e5, level: b.level });
            alert('banned ' + where(w) + ' for ' + span(ms) + ' after ' + FAILS + ' wrong passwords (ban #' + b.level + ').\n' + w.ua);
        }
        globalFails.push(t);
        while (globalFails.length && t - globalFails[0] > GLOBAL_WINDOW) globalFails.shift();
        if (globalFails.length >= GLOBAL_FAILS && closedUntil < t) {
            closedUntil = t + GLOBAL_CLOSE;
            log({ ev: 'closed', fails: globalFails.length, minutes: GLOBAL_CLOSE / MIN });
            alert(globalFails.length + ' wrong passwords in an hour from many addresses: sign-in closed for ' + span(GLOBAL_CLOSE) +
                '. Signed-in devices keep working.');
        }
        // old entries go: an address with nothing pending and no ban to remember
        for (const k of Object.keys(bans)) if (!bans[k].fails.length && bans[k].until < t && t - bans[k].banned > BAN_MEMORY) delete bans[k];
        save('bans.json', bans);
    }
    function span(ms) {
        return ms >= DAY ? Math.round(ms / DAY) + (ms >= 2 * DAY ? ' days' : ' day') : ms >= 36e5 ? Math.round(ms / 36e5) + ' h' : Math.max(1, Math.round(ms / MIN)) + ' min';
    }

    function session(req) {
        const tok = cookies(req)[COOKIE];
        if (!tok) return null;
        const id = hex(tok), s = sessions[id], t = now();
        if (!s || t - s.seen > IDLE || s.pw !== password().mark) return null;
        if (t - s.seen > MIN) { s.seen = t; dirty = true; }
        return s;
    }
    function startSession(res, w, how) {
        const tok = crypto.randomBytes(32).toString('base64url'), t = now();
        sessions[hex(tok)] = { at: t, seen: t, ip: w.ip, country: w.country, ua: w.ua, pw: password().mark, how: how };
        dirty = true; flush();
        log({ ev: 'login', how: how, ip: w.ip, country: w.country, ua: w.ua });
        alert((how === 'basic' ? 'existing device moved to the new sign-in: ' : 'new sign-in: ') + where(w) + '\n' + w.ua);
        res.setHeader('Set-Cookie', COOKIE + '=' + tok + '; Path=/; Max-Age=' + COOKIE_AGE / 1000 + '; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : ''));
    }

    // a browser that signed in through the old basic-auth prompt sends that password with every request.
    // A distinct wrong one counts as a wrong password, once per address (a stale saved one would otherwise
    // be counted on every request and ban its owner).
    const seenWrong = new Map();
    function basic(req, w) {
        const h = String(req.headers.authorization || '');
        // a banned address gets no answer to its guesses, right or wrong
        if (!/^Basic /i.test(h) || banned(w)) return false;
        const c = password(), raw = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8'), i = raw.indexOf(':');
        const userOk = same(raw.slice(0, i), c.user || ''), pwOk = same(raw.slice(i + 1), c.pw);
        if (i >= 0 && userOk && pwOk) return true;
        const k = w.key + ' ' + hex(h);
        if (!seenWrong.has(k)) {
            seenWrong.set(k, now());
            if (seenWrong.size > 10000) seenWrong.delete(seenWrong.keys().next().value);
            failed(w, 'basic');
        }
        return false;
    }

    const isPage = (req, method) => req.headers['sec-fetch-mode'] ? req.headers['sec-fetch-mode'] === 'navigate'
        : method === 'GET' && /text\/html/.test(req.headers.accept || '');
    function send(res, code, body, headers) {
        res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers));
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
    }
    const go = (res, code, to) => send(res, code, '', { Location: to });
    const loginUrl = (next, e) => '/login?' + (e ? 'e=' + e + '&' : '') + 'next=' + encodeURIComponent(next);
    function showPage(res, o) {
        const nonce = crypto.randomBytes(16).toString('base64');
        send(res, 200, page(Object.assign({ brand: brand, nonce: nonce }, o)), {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; style-src 'nonce-" + nonce + "'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
            'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Robots-Tag': 'noindex'
        });
    }
    function body(req) {
        return new Promise((ok, fail) => {
            const parts = []; let size = 0;
            req.on('data', c => { size += c.length; if (size > MAX_BODY) { fail(new Error('too big')); req.destroy(); } else parts.push(c); });
            req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
            req.on('error', fail);
        });
    }
    // a form posted from another site (CSRF, login fixation): browsers say so in Sec-Fetch-Site, older ones in
    // Origin (which is "null" under a no-referrer policy: the page's is same-origin for that reason)
    function sameOrigin(req) {
        const site = req.headers['sec-fetch-site'], o = req.headers.origin;
        if (site) return site === 'same-origin';
        if (!o) return true;
        try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
    }

    async function login(req, res, w) {
        const f = new URLSearchParams(await body(req)), next = safeNext(f.get('next'));
        if (!sameOrigin(req)) return send(res, 403, { error: 'cross-site' });
        if (banned(w)) return go(res, 303, loginUrl(next, 'ban'));
        if (closedUntil > now()) return go(res, 303, loginUrl(next, 'closed'));
        const c = password();
        if (same(f.get('password') || '', c.pw)) {
            startSession(res, w, 'password');
            return go(res, 303, next);
        }
        failed(w, 'password');
        await new Promise(r => setTimeout(r, opts.failDelay !== undefined ? opts.failDelay : FAIL_DELAY));
        go(res, 303, loginUrl(next, banned(w) ? 'ban' : 'wrong'));
    }

    function loginPage(req, res, w, q) {
        const next = safeNext(q.get('next'));
        if (session(req)) return go(res, 302, next);
        const until = banned(w), e = q.get('e');
        if (until) return showPage(res, { next: next, closed: true, msg: 'Too many wrong passwords from this network. Try again in ' + span(until - now()) + '.' });
        if (closedUntil > now()) return showPage(res, { next: next, closed: true, msg: 'Sign-in is paused for ' + span(closedUntil - now()) + '. Devices already signed in keep working.' });
        showPage(res, { next: next, msg: e === 'wrong' ? 'Wrong password.' : '' });
    }

    function check(req, res, w) {
        if (session(req)) return send(res, 200, '');
        const method = req.headers['x-forwarded-method'] || 'GET', uri = req.headers['x-forwarded-uri'] || '/', page_ = isPage(req, method);
        // the old password still in the browser: requests keep working, and the next page load gets a session
        if (basic(req, w)) return page_ ? go(res, 302, '/auth/upgrade?next=' + encodeURIComponent(safeNext(uri))) : send(res, 200, '');
        if (page_) return go(res, 302, loginUrl(safeNext(uri)));
        send(res, 401, { error: 'sign in at /login' });
    }

    function upgrade(req, res, w, q) {
        const next = safeNext(q.get('next'));
        if (session(req)) return go(res, 303, next);
        if (!basic(req, w)) return go(res, 303, loginUrl(next));
        startSession(res, w, 'basic');
        go(res, 303, next);
    }

    const h = async function (req, res) {
        const u = new URL(req.url, 'http://x'), w = who(req);
        try {
            prune();
            if (u.pathname === '/auth/check') return check(req, res, w);
            if (u.pathname === '/login' && (req.method === 'GET' || req.method === 'HEAD')) return loginPage(req, res, w, u.searchParams);
            if (u.pathname === '/auth/login' && req.method === 'POST') return await login(req, res, w);
            if (u.pathname === '/auth/upgrade' && req.method === 'GET') return upgrade(req, res, w, u.searchParams);
            send(res, 404, { error: 'no' });
        } catch (e) {
            console.error(new Date().toISOString(), req.method, u.pathname, e.message);
            if (!res.headersSent) send(res, 500, { error: 'error' });
        }
    };
    h.flush = flush;
    return h;
}

// credentials.txt: user=…, password=…, stream_token=… (lampa-setup.ps1 on the host)
function readCredentials(f) {
    const out = {};
    for (const line of fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    if (!out.password) throw new Error('no password= in ' + f);
    return out;
}

module.exports = { handler, readCredentials, addrKey, safeNext };

if (require.main === module) {
    const port = +(process.env.AUTH_PORT || 8088), creds = process.env.AUTH_CREDENTIALS, tg = process.env.AUTH_TELEGRAM;
    if (!creds) throw new Error('AUTH_CREDENTIALS: the credentials file');
    readCredentials(creds);   // fail at start, not at the first login
    const h = handler({
        data: process.env.AUTH_DATA || path.join(process.cwd(), 'data'),
        credentials: () => readCredentials(creds),
        telegram: tg ? () => { try { return JSON.parse(fs.readFileSync(tg, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; } } : null,
        brand: process.env.AUTH_BRAND,
        secure: process.env.AUTH_INSECURE !== '1',
        trustCf: process.env.AUTH_TRUST_CF !== '0'
    });
    http.createServer(h).listen(port, '127.0.0.1', () => console.log(new Date().toISOString(), 'lampa-auth on 127.0.0.1:' + port));
    // Caddy holds requests while the service restarts (lb_try_duration); sessions touched since the last write are saved
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { h.flush(); process.exit(0); });
}
