// Settings, from the environment (the Windows service sets them; see server/remux/README.md).
'use strict';
const os = require('os');
const path = require('path');

module.exports = {
    port: parseInt(process.env.REMUX_PORT || '8092', 10),
    host: process.env.REMUX_HOST || '127.0.0.1',
    torrserver: (process.env.TORRSERVER || 'http://127.0.0.1:8090').replace(/\/$/, ''),
    ffmpeg: process.env.FFMPEG || 'ffmpeg',
    ffprobe: process.env.FFPROBE || 'ffprobe',
    cache: process.env.REMUX_CACHE || path.join(os.tmpdir(), 'lampa-remux'),
    // subtitles downloaded from OpenSubtitles: kept across restarts (the cache above is wiped at start)
    subs: process.env.REMUX_SUBS || path.join(os.tmpdir(), 'lampa-remux-subs'),
    // films made into MP4s to keep (download.js): kept across restarts
    downloads: process.env.REMUX_DOWNLOADS || path.join(os.tmpdir(), 'lampa-remux-downloads'),
    // releases seen dead (swarm.js): kept across restarts
    swarm: process.env.REMUX_SWARM || path.join(os.tmpdir(), 'lampa-remux-swarm.json'),
    // public UDP trackers asked for real seeder counts (swarm.js), host:port separated by commas
    trackers: (process.env.REMUX_TRACKERS || 'tracker.opentrackr.org:1337,open.stealth.si:80,tracker.torrent.eu.org:451,open.demonii.com:1337')
        .split(',').map(s => s.trim()).filter(Boolean),
    // private KEY=value file with OPENSUBTITLES_API_KEY / _USER / _PASSWORD (or set them in the environment)
    opensubtitlesEnv: process.env.OPENSUBTITLES_ENV || path.join(__dirname, '..', 'opensubtitles.env')
};
