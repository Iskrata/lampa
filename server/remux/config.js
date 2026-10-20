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
    // what each file's first open read (its start and index) and its probe, so it opens again without waiting
    // for those pieces (source.js): kept across restarts, the oldest dropped past sourcesMax bytes
    sources: process.env.REMUX_SOURCES || path.join(os.tmpdir(), 'lampa-remux-sources'),
    sourcesMax: (parseInt(process.env.REMUX_SOURCES_MB || '4096', 10) || 4096) * 1048576,
    // films made into MP4s to keep (download.js): kept across restarts
    downloads: process.env.REMUX_DOWNLOADS || path.join(os.tmpdir(), 'lampa-remux-downloads'),
    // releases seen dead (swarm.js): kept across restarts
    swarm: process.env.REMUX_SWARM || path.join(os.tmpdir(), 'lampa-remux-swarm.json'),
    // releases that played or failed, per title (releases.js, /gst/pick): kept across restarts
    releases: process.env.REMUX_RELEASES || path.join(os.tmpdir(), 'lampa-remux-releases.json'),
    // Jackett, searched by /gst/pick (pick.js): its address, and its API key (JACKETT_KEY, else read from
    // Jackett's own ServerConfig.json at JACKETT_CONFIG). Never from a browser.
    jackett: (process.env.JACKETT_URL || 'http://127.0.0.1:9117/jackett').replace(/\/$/, ''),
    jackettKey: process.env.JACKETT_KEY || '',
    jackettConfig: process.env.JACKETT_CONFIG || '',
    // TMDB, for the title's names, years and runtimes: Lampa's own public key (app.min.js TMDB key()) unless set
    tmdbKey: process.env.TMDB_KEY || '4ef0d7355d9ffb5151e987764708ce96',
    // public UDP trackers asked for real seeder counts (swarm.js), host:port separated by commas
    trackers: (process.env.REMUX_TRACKERS || 'tracker.opentrackr.org:1337,open.stealth.si:80,tracker.torrent.eu.org:451,open.demonii.com:1337')
        .split(',').map(s => s.trim()).filter(Boolean),
    // private KEY=value file with OPENSUBTITLES_API_KEY / _USER / _PASSWORD (or set them in the environment)
    opensubtitlesEnv: process.env.OPENSUBTITLES_ENV || path.join(__dirname, '..', 'opensubtitles.env')
};
