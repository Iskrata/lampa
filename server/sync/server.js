// The profile service (README.md): the server's copy of every profile is the one that counts. Browsers read
// files as before (GET), but change a profile only through POSTs that say what changed (ops.js); whole-file
// writes of profiles are refused, so a stale tab or old code can't put an old copy back. Every change is
// journaled with who sent it. Node, no dependencies.
//   GET    /<file>                    any file (profiles.json, profile-<id>.json, presence-*, events-*)
//   PUT    /presence-*.json, /events-*.json, /.probe     small per-device files, written whole as before
//   POST   /profile-<id>.json         { base, by, ops: [...] }   apply changes -> { v, t, stale }
//                                     { by, create: { keys } }  a new profile's data, only if it has none -> 409
//   POST   /profiles.json             { upsert: profile } | { add: [profiles] } (only ids it lacks) | { remove: id }
// Run: SYNC_PORT=8091 SYNC_DATA=<dir> SYNC_JOURNAL=<dir> SYNC_TRASH=<dir> node server.js
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { apply } = require('./ops');

const SIMPLE = /^(presence|events)-[\w-]+\.json$|^\.probe$/, PROFILE = /^profile-([\w-]+)\.json$/, NAME = /^[\w.-]+$/;
const MAX_BODY = 4 << 20, JOURNAL_DAYS = 30;

function handler(opts) {
    const data = opts.data, journal = opts.journal, trash = opts.trash;
    for (const d of [data, journal, trash]) fs.mkdirSync(d, { recursive: true });
    const file = n => path.join(data, n);
    const read = n => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8').replace(/^﻿/, '')); } catch (e) { return null; } };
    // whole file or nothing: a reader (the watcher, a backup) never sees half a write. Windows refuses the
    // rename while another process has the file open for a moment, so it is retried.
    function write(n, obj) {
        const tmp = file(n) + '.tmp';
        fs.writeFileSync(tmp, typeof obj === 'string' ? obj : JSON.stringify(obj));
        for (let i = 0; ; i++) {
            try { return fs.renameSync(tmp, file(n)); }
            catch (e) { if (i >= 20 || e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
        }
    }
    function list() { const l = read('profiles.json'); return l && Array.isArray(l.list) ? l.list : []; }
    function log(entry) {
        const day = new Date().toISOString().slice(0, 10);
        fs.appendFileSync(path.join(journal, day + '.jsonl'), JSON.stringify(Object.assign({ t: new Date().toISOString() }, entry)) + '\n');
    }
    // journals older than JOURNAL_DAYS go, once a day is enough
    let pruned = '';
    function prune() {
        const today = new Date().toISOString().slice(0, 10);
        if (pruned === today) return;
        pruned = today;
        const cut = new Date(Date.now() - JOURNAL_DAYS * 864e5).toISOString().slice(0, 10);
        for (const f of fs.readdirSync(journal)) if (f.slice(0, 10) < cut) fs.rmSync(path.join(journal, f), { force: true });
    }

    function send(res, code, body, type) {
        res.writeHead(code, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
    }
    function body(req) {
        return new Promise((ok, fail) => {
            const parts = []; let size = 0;
            req.on('data', c => { size += c.length; if (size > MAX_BODY) { fail(new Error('too big')); req.destroy(); } else parts.push(c); });
            req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
            req.on('error', fail);
        });
    }

    function postProfile(n, id, msg, who) {
        const p = read(n), known = list().some(x => x.id === id);
        if (msg.create) {
            if (p) return [409, { error: 'exists', v: p.v }];
            if (!known) return [404, { error: 'no such profile in profiles.json' }];
            const doc = { t: Date.now(), v: 1, keys: msg.create.keys || {}, by: who };
            write(n, doc);
            log({ file: n, ip: who.ip, device: who.device, why: who.why, ua: who.ua, create: Object.keys(doc.keys) });
            return [200, { v: doc.v, t: doc.t }];
        }
        if (!Array.isArray(msg.ops)) return [400, { error: 'ops or create' }];
        if (!p && !known) return [404, { error: 'no such profile' }];   // deleted: never brought back by a stale tab
        const doc = p || { t: 0, v: 0, keys: {} }, prevV = doc.v || 0;
        const changed = apply(doc.keys, msg.ops);
        if (changed.length) {
            doc.v = prevV + 1;
            doc.t = Date.now();
            doc.by = who;
            write(n, doc);
        }
        log({ file: n, ip: who.ip, device: who.device, why: who.why, ua: who.ua, base: msg.base, v: doc.v, changed: changed, ops: msg.ops });
        return [200, { v: doc.v || 0, t: doc.t, stale: msg.base !== undefined && msg.base !== prevV }];
    }

    function postList(msg, who) {
        let l = list();
        const before = JSON.stringify(l);
        const clean = p => ({ id: String(p.id), name: String(p.name || '').slice(0, 40), color: +p.color || 0, img: p.img || undefined });
        if (msg.upsert && msg.upsert.id) {
            const p = clean(msg.upsert), i = l.findIndex(x => x.id === p.id);
            if (i >= 0) l[i] = p; else l.push(p);
        } else if (Array.isArray(msg.add)) {
            for (const p of msg.add) if (p && p.id && !l.some(x => x.id === String(p.id))) l.push(clean(p));
        } else if (msg.remove) {
            l = l.filter(x => x.id !== msg.remove);
            const n = 'profile-' + msg.remove + '.json';
            // kept, not deleted: a profile removed by mistake comes back from here
            if (fs.existsSync(file(n))) fs.renameSync(file(n), path.join(trash, n.replace('.json', '-' + Date.now() + '.json')));
        } else return [400, { error: 'upsert, add or remove' }];
        if (JSON.stringify(l) !== before) {
            write('profiles.json', { list: l });
            log({ file: 'profiles.json', ip: who.ip, device: who.device, why: who.why, ua: who.ua, msg: msg });
        }
        return [200, { list: l }];
    }

    return async function (req, res) {
        const n = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, ''));
        if (!NAME.test(n) || n.endsWith('.tmp')) return send(res, 400, { error: 'bad name' });
        try {
            if (req.method === 'GET' || req.method === 'HEAD') {
                if (!fs.existsSync(file(n))) return send(res, 404, { error: 'none' });
                return send(res, 200, fs.readFileSync(file(n), 'utf8'));
            }
            const ip = req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
            if (req.method === 'PUT' || req.method === 'DELETE') {
                // old code (a tab from before this service, or a rolled-back deploy) writes whole profiles: refused
                if (!SIMPLE.test(n)) {
                    log({ file: n, ip: ip, ua: req.headers['user-agent'], refused: req.method + ' (old code)' });
                    return send(res, 409, { error: 'profiles change only through POST: reload the page' });
                }
                if (req.method === 'DELETE') { fs.rmSync(file(n), { force: true }); return send(res, 204, ''); }
                write(n, await body(req));
                return send(res, 201, '');
            }
            if (req.method === 'POST') {
                const msg = JSON.parse(await body(req) || '{}'), by = msg.by || {};
                const who = { device: String(by.device || '?'), why: String(by.why || ''), ua: String(by.ua || req.headers['user-agent'] || ''), ip: ip };
                prune();
                const m = PROFILE.exec(n);
                const [code, out] = m ? postProfile(n, m[1], msg, who) : n === 'profiles.json' ? postList(msg, who) : [405, { error: 'no' }];
                return send(res, code, out);
            }
            send(res, 405, { error: 'method' });
        } catch (e) {
            console.error(new Date().toISOString(), req.method, n, e.message);
            send(res, 500, { error: e.message });
        }
    };
}

module.exports = { handler };

if (require.main === module) {
    const port = +(process.env.SYNC_PORT || 8091), root = process.cwd();
    const h = handler({
        data: process.env.SYNC_DATA || path.join(root, 'data'),
        journal: process.env.SYNC_JOURNAL || path.join(root, 'journal'),
        trash: process.env.SYNC_TRASH || path.join(root, 'trash')
    });
    http.createServer(h).listen(port, '127.0.0.1', () => console.log(new Date().toISOString(), 'lampa-sync on 127.0.0.1:' + port));
    // Caddy holds requests while the service restarts (lb_try_duration), so a stop only has to finish writes
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
}
