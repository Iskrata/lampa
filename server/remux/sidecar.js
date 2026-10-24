// Subtitle files that come with a torrent next to its videos (README "Subtitle files in the torrent"). Desperate
// Housewives S01 by KONTRAST (2026-10-24) has none inside its MP4s but English ones in
// Subs/<episode>/2_eng,English (SDH).srt; without them the player showed OpenSubtitles' best guess as it was,
// from another release: 10 s early at the start, 108 s late at 40 min.
//   files(hash, index) -> [{ id, words }]: the subtitle files of torrent file `index`, `words` the words of their
//     names that aren't the video's (what says the language: "eng", "English", "SDH")
//   cues(hash, id, lang) -> cues
'use strict';
const cfg = require('./config');
const { post } = require('./torrserver');
const { parseSrt, episodeOf } = require('./opensubs');

const SUB = /\.(srt|vtt)$/i, VIDEO = /\.(mkv|mp4|m4v|avi|mov|ts|webm)$/i;
const stem = p => p.split('/').pop().replace(/\.[^.]+$/, '');
const words = s => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const stream = (hash, id) => `${cfg.torrserver}/stream/file?link=${encodeURIComponent(hash)}&index=${encodeURIComponent(id)}&play`;
const same = (x, y) => !!x && !!y && x.season === y.season && x.episode === y.episode;

// A subtitle file is this video's when its path has the video's name in it (next to it, or in a folder named
// after it), names the same episode, or is the only video's in a torrent of one film. One naming another episode
// never is.
async function files(hash, index) {
    let t = await post('/torrents', { action: 'get', hash });
    // a torrent TorrServer has dropped (nobody read it for a while) lists no files until something reads it, and
    // a reopen reads nothing before this (the probe is kept, source.js): 79655332 had "subtitles none" so on
    // 2026-10-24. One byte of the video loads it.
    if (!(t && t.file_stats && t.file_stats.length)) {
        await fetch(stream(hash, index), { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(30000) })
            .then(r => r.arrayBuffer()).catch(() => null);
        t = await post('/torrents', { action: 'get', hash });
    }
    const all = (t && t.file_stats) || [], video = all.find(f => String(f.id) === String(index));
    if (!video) return [];
    const name = stem(video.path).toLowerCase(), ep = episodeOf(video.path), mine = new Set(words(name));
    const alone = !ep && all.filter(f => VIDEO.test(f.path)).length === 1;
    return all.filter(f => SUB.test(f.path)).filter(f => {
        const e = episodeOf(f.path);
        if (e && ep && !same(e, ep)) return false;
        return f.path.toLowerCase().includes(name) || same(e, ep) || (alone && !e);
    }).map(f => ({ id: f.id, words: words(stem(f.path)).filter(w => !mine.has(w)) }));
}

// UTF-8, else the usual 8-bit code page for the language (Bulgarian and Russian subtitles are often Windows-1251)
function decode(buf, lang) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) {
        return new TextDecoder(lang === 'bg' || lang === 'ru' ? 'windows-1251' : 'windows-1252').decode(buf);
    }
}

async function cues(hash, id, lang) {
    const r = await fetch(stream(hash, id));
    if (!r.ok) throw new Error(`subtitle file ${id}: TorrServer HTTP ${r.status}`);
    return parseSrt(decode(Buffer.from(await r.arrayBuffer()), lang));
}

module.exports = { files, cues };
