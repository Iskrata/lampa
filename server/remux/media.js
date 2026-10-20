// What to play from one torrent file: streams picked (video, English audio, English/Bulgarian/Russian text
// subtitles), the segment plan (cut at keyframes from the file's own index: Matroska Cues or the MP4 moov,
// else every SEGMENT_S), and the ffmpeg arguments that turn it into fragmented MP4 a browser plays (video copied,
// audio AAC unless it already is).
'use strict';
const { execFile } = require('child_process');
const mkv = require('./mkv');
const mp4 = require('./mp4index');
const source = require('./source');
const cfg = require('./config');

const SEGMENT_S = 4;
const HEAD_MARGIN = 1 << 20;   // kept past the probe's read of the file's start (probe())
const TEXT_SUBS = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
// a stream in a language (ISO 639-1), matched against the 2- and 3-letter tags and track titles
const LANGS = { en: /^(en|eng)$|english/i, ja: /^(ja|jpn)$|japanese/i, bg: /^(bg|bul)$|bulgarian|българск/i,
    ru: /^(ru|rus)$|russian|русск/i };
// the subtitle languages offered, in the order the player lists them
const SUB_LANGS = ['en', 'bg', 'ru'];
const inLang = (s, lang) => (LANGS[lang] || LANGS.en).test((s.tags && s.tags.language) || '') || (LANGS[lang] || LANGS.en).test((s.tags && s.tags.title) || '');
const english = s => inLang(s, 'en');
const subLang = s => SUB_LANGS.find(l => inLang(s, l));
const forced = s => !!(s.disposition && s.disposition.forced) || /forced/i.test((s.tags && s.tags.title) || '');
const commentary = s => /comment/i.test((s.tags && s.tags.title) || '') || (s.disposition && s.disposition.comment);

function ffprobe(url) {
    return new Promise((resolve, reject) => {
        execFile(cfg.ffprobe, ['-v', 'error', '-probesize', '20000000', '-analyzeduration', '3000000',
            '-show_format', '-show_streams', '-of', 'json', url], { maxBuffer: 16 << 20, timeout: 90000 },
        // why, not just "Command failed" (2026-10-20: a Vikings torrent that sent nothing for 90 s logged only that)
        (err, out, stderr) => err ? reject(new Error('ffprobe: ' + (err.killed ? 'no answer in 90 s (the torrent sent too little to read)' :
            'exit ' + err.code + ': ' + ((stderr || '').trim().split('\n').pop() || err.message)))) : resolve(JSON.parse(out)));
    });
}

// the track in the language asked for (English unless the player asks for e.g. Japanese), else the default
function pickAudio(streams, lang) {
    const audio = streams.filter(s => s.codec_type === 'audio');
    const eng = audio.filter(s => inLang(s, lang) && !commentary(s));
    return eng.find(s => s.disposition && s.disposition.default) || eng[0] ||
        audio.find(s => s.disposition && s.disposition.default) || audio[0] || null;
}

// segment start times, plus the end: [0, b1, b2, ..., duration]
function plan(keys, duration) {
    const b = [0];
    if (keys) {
        for (const t of keys) if (t - b[b.length - 1] >= SEGMENT_S && duration - t >= 1) b.push(t);
    } else {
        for (let t = SEGMENT_S; t < duration - 1; t += SEGMENT_S) b.push(t);
    }
    b.push(duration);
    return b;
}

// RFC 6381 codec strings for the HLS master playlist
function videoCodec(v) {
    const level = v.level > 0 ? v.level : 120;
    if (v.codec_name === 'hevc') return /10/.test(v.profile || '') ? `hvc1.2.4.L${level}.B0` : `hvc1.1.6.L${level}.B0`;
    if (v.codec_name === 'h264') {
        const p = { Baseline: 0x42, 'Constrained Baseline': 0x42, Main: 0x4D, High: 0x64, 'High 10': 0x6E }[v.profile] || 0x64;
        const hex = n => n.toString(16).padStart(2, '0').toUpperCase();
        return `avc1.${hex(p)}00${hex(v.level > 0 ? v.level : 40)}`;
    }
    if (v.codec_name === 'av1') return 'av01.0.08M.08';
    if (v.codec_name === 'vp9') return 'vp09.00.40.08';
    return null;
}

const PLAYABLE_VIDEO = new Set(['hevc', 'h264', 'av1', 'vp9']);

// the probe and the keyframe index, read through source.js the first time (which keeps what they read), from
// its disk after that: { info, keys, mp4, took }
async function probe(hash, index) {
    const kept = source.probe(hash, index);
    if (kept) return Object.assign({ took: { probe: 0, index: 0, kept: true } }, kept);
    const url = source.url(hash, index, true);
    const none = () => null, failed = {};
    // how long each read took, for the log (README "Why starting takes longer than a seek")
    const t0 = Date.now(), took = {}, timed = (k, p) => p.finally(() => { took[k] = (Date.now() - t0) / 1000; });
    const [info, mkvKeys, mp4Keys] = await Promise.all([timed('probe', ffprobe(url)),
        timed('mkv', mkv.keyframes(url).catch(() => failed)), timed('mp4', mp4.keyframes(url).catch(() => failed))]);
    // OpenSubtitles' file hash reads the last 64 KiB (opensubs.js moviehash): kept with the rest. The index at
    // the end has usually brought that piece in already
    const size = parseInt(info.format && info.format.size, 10);
    const read = (a, z) => fetch(url, { headers: { Range: `bytes=${a}-${z}` } }).then(r => r.arrayBuffer()).catch(none);
    if (size > 65536) await read(size - 65536, size - 1);
    // ffmpeg reads a little past where ffprobe stopped (68 KB for Friends S01E01, in the next 16 MiB piece: 4 s on
    // a reopen, 2026-10-20). Not waited for: past the pieces the probe brought in, it may wait for another one
    const head = source.headEnd(hash, index);
    if (head && head < size) read(head, Math.min(size, head + HEAD_MARGIN) - 1);
    const ok = k => k !== failed && k;
    const keys = ok(mkvKeys) || ok(mp4Keys) || null, mp4Index = !ok(mkvKeys) && !!ok(mp4Keys);
    // an index that couldn't be read this time (the torrent stopped sending) isn't kept as "no index": the
    // next open reads it again
    if (keys || (mkvKeys !== failed && mp4Keys !== failed)) source.probe(hash, index, { info, keys, mp4: mp4Index });
    return { info, keys, mp4: mp4Index, took: { probe: took.probe, index: mp4Index ? took.mp4 : took.mkv } };
}

async function load(hash, index, lang) {
    const url = source.url(hash, index);
    const { info, keys, mp4: mp4Index, took } = await probe(hash, index);
    const streams = info.streams || [];
    const video = streams.find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    if (!video) throw new Error('no video stream');
    if (!PLAYABLE_VIDEO.has(video.codec_name)) throw new Error('video codec not playable in a browser: ' + video.codec_name);
    const audio = pickAudio(streams, lang);
    // English first (subtitle 0 is the one OpenSubtitles' are lined up with), then Bulgarian, Russian.
    // A "forced" track has only the lines for speech in another language: left out where the language has a
    // full one (TYSON S01 by TBK lists English Forced first, and the player showed it: empty, 2026-10-20)
    const text = streams.filter(s => s.codec_type === 'subtitle' && TEXT_SUBS.has(s.codec_name) && subLang(s))
        .map(s => Object.assign({ lang: subLang(s) }, s));
    const subs = text.filter(s => !forced(s) || !text.some(f => f.lang === s.lang && !forced(f)))
        .sort((x, y) => SUB_LANGS.indexOf(x.lang) - SUB_LANGS.indexOf(y.lang));
    const duration = parseFloat(info.format.duration) || 0;
    if (!duration) throw new Error('unknown duration');
    const bitrate = parseInt(info.format.bit_rate, 10) || 8e6;
    const aac = !audio || (audio.codec_name === 'aac' && (audio.channels || 2) <= 6);
    const channels = audio ? Math.min(audio.channels || 2, 6) : 0;
    // ffmpeg seeks 3/23 s before -ss for inputs with B-frames, unless the container seeks by presentation
    // time (MP4 does, Matroska doesn't): its DTS heuristic, fftools/ffmpeg_demux.c. From exactly a keyframe
    // that lands on the one before, so ask for just past it (the next keyframe can't be within 0.011 s).
    const heuristic = !mp4Index && video.has_b_frames > 0;
    return {
        hash, index, lang, url, duration, video, audio, subs,
        took,
        // audio not in English (e.g. anime in Japanese): the English subtitles come on by themselves
        subsOn: !!audio && !english(audio),
        seekPast: heuristic ? 3 / 23 + 0.011 : 0.001,
        // the AAC encoder puts 1024 samples of priming before the first real one
        audioLead: audio && !aac ? 1024 / (parseInt(audio.sample_rate, 10) || 48000) : 0,
        bounds: plan(keys, duration), cuesUsed: !!keys,
        bandwidth: Math.round(bitrate * 1.1),
        codecs: [videoCodec(video), audio ? 'mp4a.40.2' : null].filter(Boolean).join(','),
        resolution: video.width && video.height ? `${video.width}x${video.height}` : null,
        // Safari fails an HDR10 variant listed without it ("Media failed to decode", macOS Safari and the iOS 27
        // simulator, 2026-10-19); with it, Safari skips the variant where it can't show HDR video, and
        // desktop/compat.js plays the media playlist there
        videoRange: { smpte2084: 'PQ', 'arib-std-b67': 'HLG' }[video.color_transfer] || 'SDR',
        audioArgs: !audio ? [] : aac ? ['-c:a', 'copy'] :
            ['-c:a', 'aac', '-ac', String(channels > 2 ? 6 : 2), '-b:a', channels > 2 ? '384k' : '192k']
    };
}

// where ffmpeg is told to start for a segment starting at `start`
const seekTime = (m, start) => start > 0 ? start + m.seekPast : 0;

// ffmpeg arguments: fragmented MP4 to stdout from segment start, plus one WebVTT file per subtitle.
// Every output starts at time 0 (the MP4 muxer rebases even with -copyts): session.js moves the fragments
// to their place in the film, and the subtitle cues by seekTime(). With opts.file: the whole film as one
// plain MP4 file instead (download.js).
function ffmpegArgs(m, start, opts) {
    const a = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-probesize', '20000000', '-analyzeduration', '3000000'];
    if (start > 0) a.push('-ss', seekTime(m, start).toFixed(3));
    a.push('-i', m.url, '-map', `0:${m.video.index}`);
    if (m.audio) a.push('-map', `0:${m.audio.index}`);
    a.push('-c:v', 'copy');
    if (m.video.codec_name === 'hevc') a.push('-tag:v', 'hvc1');
    a.push(...m.audioArgs);
    if (opts.duration) a.push('-t', String(opts.duration));
    // no chapters/metadata: chapters become an extra track once past the first one, and every run's tracks
    // must match the one init segment
    a.push('-map_chapters', '-1', '-map_metadata', '-1', '-max_muxing_queue_size', '4096', '-f', 'mp4');
    a.push(...(opts.file ? [opts.file] : ['-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1']));
    (opts.subFiles || []).forEach((file, k) =>
        a.push('-map', `0:${m.subs[k].index}`, '-c:s', 'webvtt', '-flush_packets', '1', '-f', 'webvtt', file));
    return a;
}

module.exports = { load, ffmpegArgs, seekTime, SUB_LANGS };
