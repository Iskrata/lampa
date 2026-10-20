// What the remux service asks TorrServer besides the stream itself (server.js, download.js).
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const KEEP_DAYS = 30;

function post(route, body) {
    return fetch(cfg.torrserver + route, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
        .then(r => r.ok ? r.json() : null).catch(() => null);
}

// one file of a torrent: { id, path, length }, or {} when TorrServer doesn't know it
async function file(hash, index) {
    const t = await post('/torrents', { action: 'get', hash });
    return ((t && t.file_stats) || []).find(x => String(x.id) === String(index)) || {};
}

// the title, for subtitles from OpenSubtitles: the torrent file's name says the episode
async function describe(s, hash, tmdb, kind) {
    if (!tmdb || s.source) return;
    const f = await file(hash, s.m.index);
    s.describe({ tmdb, kind: kind === 'movie' ? 'movie' : 'tv', name: f.path || '', size: f.length || 0 });
}

// A torrent played here is saved in TorrServer's database, so the next time Lampa adds it TorrServer has its file
// list at once instead of asking peers for it (README "Opening a file again"). Lampa adds torrents unsaved, and
// a drop (/gst/remove) keeps a saved one listed "in db", without peers or memory. Those unused for KEEP_DAYS go.
const savedFile = () => path.join(cfg.sources, 'torrents.json');
let saved = null;
function readSaved() {
    if (!saved) try { saved = JSON.parse(fs.readFileSync(savedFile(), 'utf8')); } catch (e) { saved = {}; }
    return saved;
}
function writeSaved() {
    try { fs.writeFileSync(savedFile(), JSON.stringify(saved)); } catch (e) { console.error('torrents.json:', e.message); }
}

async function keep(hash) {
    hash = hash.toLowerCase();
    readSaved()[hash] = Date.now();
    writeSaved();
    // an add of a torrent TorrServer has keeps it as it is (trackers, title) and saves it with save_to_db
    await post('/torrents', { action: 'add', link: 'magnet:?xt=urn:btih:' + hash, save_to_db: true });
}

async function forget() {
    const s = readSaved(), old = Object.keys(s).filter(h => Date.now() - s[h] > KEEP_DAYS * 86400000);
    if (!old.length) return;
    const list = await post('/torrents', { action: 'list' });
    if (!list) return;
    for (const h of old) {
        const t = list.find(x => x.hash === h);
        if (t && t.stat !== 5) continue;   // loaded (someone is watching it): next time
        if (t) await post('/torrents', { action: 'rem', hash: h });
        delete s[h];
    }
    writeSaved();
}

module.exports = { post, file, describe, keep, forget };
