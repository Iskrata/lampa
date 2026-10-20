// What the remux service asks TorrServer besides the stream itself (server.js, download.js).
'use strict';
const cfg = require('./config');

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

module.exports = { post, file, describe };
