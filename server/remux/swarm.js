// Is a torrent's swarm alive? (README "Dead swarms")
//   * seeders: real counts from public trackers (BEP 15 UDP scrape). Indexers' counts go stale: on 2026-10-20
//     LimeTorrents listed Spider-Man No Way Home's WiKi release with 19 seeders, the trackers had 2-4.
//   * dead: a torrent that sends nothing while someone waits for it. A request (the probe, a segment) has
//     waited STALL_MS and TorrServer's bytes haven't grown in that time. Remembered for DEAD_KEEP_MS, for
//     everyone, so the lists hide it (desktop/swarm.js). The WiKi release had 2 seeders connected and sent
//     0 bytes after its first 44 MB.
'use strict';
const dgram = require('dgram');
const crypto = require('crypto');
const fs = require('fs');
const cfg = require('./config');
const { post: torrserver } = require('./torrserver');
const releases = require('./releases');

// trackers that answer do so in 0.1-0.65 s (measured from the home server, 2026-10-20); one that never does costs this
const SCRAPE_MS = 1000, SCRAPE_KEEP_MS = 15 * 60000, PER_PACKET = 70;
// starting takes 12-16 s of swarm warm-up on the home server before any byte comes (README "Why starting a
// torrent takes longer than a seek"), so a little more than that
const STALL_MS = 25000, SAMPLE_MS = 5000, GAP_MS = 5000, DEAD_KEEP_MS = 7 * 24 * 3600e3;

// one tracker's counts for hashes (hex): Map hash -> { seeders, leechers, completed }, empty when it doesn't answer
function scrapeTracker(tracker, hashes) {
    const [host, port] = tracker.split(':');
    return new Promise(done => {
        const sock = dgram.createSocket('udp4'), out = new Map(), tid = crypto.randomBytes(4);
        let left = Math.ceil(hashes.length / PER_PACKET), finished = false;
        const finish = () => { if (finished) return; finished = true; clearTimeout(timer); try { sock.close(); } catch (e) {} done(out); };
        const timer = setTimeout(finish, SCRAPE_MS);
        sock.on('error', finish);
        const chunks = new Map();   // transaction id (hex) -> the hashes asked in that packet
        sock.on('message', m => {
            if (m.length < 8) return;
            const action = m.readUInt32BE(0), id = m.slice(4, 8);
            if (action === 0 && m.length >= 16 && id.equals(tid)) {
                for (let i = 0; i < hashes.length; i += PER_PACKET) {
                    const chunk = hashes.slice(i, i + PER_PACKET), b = Buffer.alloc(16 + 20 * chunk.length), t = crypto.randomBytes(4);
                    chunks.set(t.toString('hex'), chunk);
                    m.copy(b, 0, 8, 16);
                    b.writeUInt32BE(2, 8);
                    t.copy(b, 12);
                    chunk.forEach((h, k) => Buffer.from(h, 'hex').copy(b, 16 + 20 * k));
                    sock.send(b, +port, host);
                }
            } else if (action === 2 && chunks.has(id.toString('hex'))) {
                const chunk = chunks.get(id.toString('hex'));
                chunks.delete(id.toString('hex'));
                chunk.forEach((h, k) => {
                    if (m.length < 20 + 12 * k) return;
                    out.set(h, { seeders: m.readUInt32BE(8 + 12 * k), completed: m.readUInt32BE(12 + 12 * k), leechers: m.readUInt32BE(16 + 12 * k) });
                });
                if (--left === 0) finish();
            } else if (action === 3) finish();
        });
        const c = Buffer.alloc(16);
        c.writeBigUInt64BE(0x41727101980n, 0);
        tid.copy(c, 12);
        sock.send(c, +port, host, e => { if (e) finish(); });
    });
}

// { hash: seeders | null } for lower-case hex hashes. null: no tracker knows it (all zero) or none answered;
// a tracker that doesn't know a hash answers 0/0/0, so only a hash some tracker has seen gets a count.
const scraped = new Map();   // hash -> { at, seeders }
async function seeders(hashes, fresh) {
    const now = Date.now(), want = hashes.filter(h => fresh || !scraped.has(h) || now - scraped.get(h).at > SCRAPE_KEEP_MS);
    let answered = 0;
    if (want.length) {
        const all = await Promise.all(cfg.trackers.map(t => scrapeTracker(t, want)));
        answered = all.filter(m => m.size).length;
        for (const h of want) {
            let best = null;
            for (const m of all) {
                const x = m.get(h);
                if (x && (x.seeders || x.leechers || x.completed)) best = Math.max(best || 0, x.seeders);
            }
            // nothing answered (no internet, trackers down): don't keep "unknown" for long
            if (answered) scraped.set(h, { at: now, seeders: best });
        }
    }
    const out = {};
    for (const h of hashes) out[h] = scraped.has(h) ? scraped.get(h).seeders : null;
    return { seeders: out, answered: want.length ? answered : null };
}

// releases seen dead: { hash: { at, title, size } }, kept across restarts
let dead = {};
try { dead = JSON.parse(fs.readFileSync(cfg.swarm, 'utf8')); } catch (e) {}
function save() {
    const now = Date.now();
    for (const h of Object.keys(dead)) if (now - dead[h].at > DEAD_KEEP_MS) delete dead[h];
    fs.writeFile(cfg.swarm, JSON.stringify(dead), () => {});
}
function deadList() {
    const now = Date.now();
    return Object.keys(dead).filter(h => now - dead[h].at <= DEAD_KEEP_MS).map(h => ({ hash: h, title: dead[h].title, size: dead[h].size }));
}
function isDead(h) { return !!dead[h] && Date.now() - dead[h].at <= DEAD_KEEP_MS; }

// requests waiting on a torrent: hash -> { n, since, idleAt, bytes, grewAt }
const watched = new Map();
// call when a request starts waiting on the torrent's data; returns the function to call when it's done
function waiting(hash) {
    const now = Date.now();
    let w = watched.get(hash);
    if (!w) watched.set(hash, w = { n: 0, since: now, idleAt: 0, bytes: -1, grewAt: now });
    // a player retrying (hls.js gives up on a segment and asks again) keeps the wait going
    // (TorrServer's byte count starts again at 0 when a torrent closed for being idle is added again)
    if (w.n === 0 && w.idleAt && now - w.idleAt > GAP_MS) { w.since = now; w.grewAt = now; w.bytes = -1; }
    w.n++;
    let ended = false;
    return () => { if (ended) return; ended = true; if (--w.n === 0) w.idleAt = Date.now(); };
}

async function sample() {
    const now = Date.now();
    for (const [hash, w] of watched) {
        if (w.n === 0) { if (now - w.idleAt > 10 * 60000) watched.delete(hash); continue; }
        const t = await torrserver('/torrents', { action: 'get', hash });
        if (!t) continue;
        const bytes = t.bytes_read_useful_data || t.loaded_size || 0;
        if (bytes !== w.bytes) { w.bytes = bytes; w.grewAt = now; }
        if (isDead(hash) || now - w.since < STALL_MS || now - w.grewAt < STALL_MS) continue;
        // no bytes at all from anyone may be this server's own connection: only a tracker answering says it isn't
        const check = await seeders([hash], true);
        if (!check.answered) continue;
        dead[hash] = { at: now, title: t.title || t.name || '', size: t.torrent_size || 0 };
        console.log(`${hash.slice(0, 8)} dead: nothing downloaded for ${Math.round((now - w.grewAt) / 1000)} s while ` +
            `${w.n} request(s) waited, ${t.active_peers || 0}/${t.total_peers || 0} peers, trackers say ${check.seeders[hash]} seeders`);
        save();
        // and for the title it was played for: never offered for it again (releases.js)
        releases.failed(hash, 'dead', null, t.title || t.name);
    }
}
setInterval(() => { sample().catch(e => console.error('swarm:', e.message)); }, SAMPLE_MS).unref();

// what the heartbeat adds: { dead, stalled } (stalled: ms the torrent has sent nothing while a request waits)
function state(hash) {
    const w = watched.get(hash), now = Date.now();
    return { dead: isDead(hash), stalled: w && w.n ? Math.min(now - w.since, now - w.grewAt) : 0 };
}

// GET /gst/swarm?hash=<h>,<h>...: { seeders: { hash: n | null }, dead: [{ hash, title, size }] } (also /gst/pick's)
async function report(list) {
    const hashes = [...new Set((Array.isArray(list) ? list : list.split(',')).map(h => h.trim().toLowerCase()).filter(h => /^[0-9a-f]{40}$/.test(h)))];
    const s = hashes.length ? await seeders(hashes) : { seeders: {} };
    return { seeders: s.seeders, dead: deadList() };
}

module.exports = { waiting, state, report };
