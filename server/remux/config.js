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
    cache: process.env.REMUX_CACHE || path.join(os.tmpdir(), 'lampa-remux')
};
