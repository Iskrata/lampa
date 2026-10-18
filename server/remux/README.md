# server/remux: any torrent plays in a browser

Browsers play only some files. A 4K HEVC MKV with E-AC3 Atmos audio, which is a typical WEB-DL, never
starts in Safari: Lampa's player just spins. This service repackages what TorrServer streams into HLS:

- **Video:** copied as is, no re-encoding.
- **Audio:** English, converted to AAC.
- **Subtitles:** the file's English text subtitles as WebVTT; better ones from OpenSubtitles when the file's
  are TV captions (ALL CAPS) or missing ("Subtitles from OpenSubtitles" below).

Safari plays it natively (so AirPlay works), Chrome plays it through Lampa's hls.js, and seeking works
everywhere.

It speaks the protocol Lampa already has for TorrServer's GStreamer build ("Settings → TorrServer →
transcoding", storage key `torrserver_gts`), so Lampa itself is unchanged. Serve this service at
`<TorrServer URL>/gst/` and turn that setting on.

| request | answer |
|---|---|
| `GET /gst/echo` | JSON. Lampa checks it before using `/gst/` (app.min.js `gstCheck`, it parses JSON) |
| `GET /gst/<hash>/master.m3u8?index=<file>[&lang=ja][&tmdb=<id>&kind=tv\|movie]` | HLS master: one video+audio stream (English audio, or the `lang` asked for: `ja`), English subtitle tracks, on by default when the audio isn't English |
| `GET /gst/<hash>/<file>.<lang>/video.m3u8`, `init.mp4`, `seg<n>.m4s` | the stream |
| `GET /gst/<hash>/<file>.<lang>/sub<k>.m3u8`, `sub<k>-<n>.vtt` | subtitles |
| `GET /gst/<hash>/heartbeat` | TorrServer's stats for the player's info panel (`{Torrent, Readers, Pieces}`) |
| `GET /gst/remove?hash=<hash>` | stop, and drop the torrent from TorrServer |

## Running it

Node 18+ (no dependencies), plus ffmpeg and ffprobe 8.x. Environment variables:

| variable | default |
|---|---|
| `REMUX_PORT` / `REMUX_HOST` | `8092` / `127.0.0.1` |
| `TORRSERVER` | `http://127.0.0.1:8090` |
| `FFMPEG` / `FFPROBE` | `ffmpeg` / `ffprobe` on the PATH |
| `REMUX_CACHE` | `<tmp>/lampa-remux`, emptied at start |
| `REMUX_SUBS` | `<tmp>/lampa-remux-subs`: subtitles downloaded from OpenSubtitles, kept across restarts |
| `OPENSUBTITLES_ENV` | `../opensubtitles.env` (next to the app folder): private `KEY=value` lines `OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USER`, `OPENSUBTITLES_PASSWORD` (the same names work as environment variables). Without a key, no OpenSubtitles |
| `REMUX_DEBUG` | set it to log every fragment's time and segment |

`node server.js`. On the home server it's a Windows service; see the ruby repo's `scripts/lampa-setup.ps1`.

## How it works

| file | |
|---|---|
| `media.js` | ffprobe the file, choose the streams, plan the segments, build ffmpeg's arguments |
| `mkv.js` / `mp4index.js` | keyframe times from the file's own index (Matroska Cues / MP4 `stss`), read with a few HTTP range requests |
| `session.js` | one playing file: runs ffmpeg from the segment asked for, writes segments, follows seeks |
| `mp4.js` | splits ffmpeg's fragmented MP4 into the init segment and fragments, and fixes their times |
| `server.js` | the HTTP side |

**Segments are cut at keyframes, planned before anything plays.** A seekable playlist has to list every
segment's length up front. `mkv.js` reads the Cues, about 700 KB at the end of a 20 GB file, giving every
keyframe's time. The plan is a new segment at the first keyframe 4 s or more after the last one. Files
without an index get fixed 4 s steps, which drift by up to a keyframe interval.

**One ffmpeg per playing file, started at the segment asked for:**
- **Fragments:** `-movflags frag_keyframe` gives one MP4 fragment per keyframe. Fragments are grouped into
  the planned segments by their time.
- **A segment ahead:** a request just ahead of ffmpeg waits for it.
- **A seek:** anything else restarts ffmpeg there.
- **Throttling:** when ffmpeg gets 30 segments ahead of the player, its output stops being read. It then
  stops reading from TorrServer, so a paused film doesn't download to the end.

**Facts this depends on** (measured 2026-10-14 with ffmpeg 8.1):
- **ffmpeg seeks early.** For inputs with B-frames, ffmpeg seeks 3/23 s before `-ss`
  (`fftools/ffmpeg_demux.c`, its DTS heuristic) unless the container seeks by presentation time.
  - Matroska doesn't; MP4 does.
  - From exactly a keyframe, that lands on the keyframe before. A first version cut every segment one
    GOP late (1.2 s).
  - So for Matroska the seek asks for 0.141 s past the keyframe.
- **The MP4 muxer starts every run at time 0.** It does this per track, even with `-copyts` or
  `frag_discont`. `mp4.js` therefore writes each fragment's `tfdt` itself:
  - **Video:** moved to the segment's start.
  - **Audio:** moved to where ffmpeg was told to seek (audio is trimmed there), minus the AAC encoder's
    1024 priming samples.
  - **Both:** plus the video's reorder delay (its first sample's composition offset, 0.167 s for that
    file). Without this, audio was 0.3 s off the picture.
  - Checked against ffmpeg's MPEG-TS output with `-copyts`, which keeps the source times: equal to within
    one sample.
- **E-AC3 can't be copied into HLS fMP4.** ffmpeg's HLS muxer fails with "Cannot write moov atom before
  EAC3 packets parsed". Audio is therefore AAC: 5.1 kept at 384 kbit/s, otherwise stereo at 192 kbit/s.
  That also plays in Chrome, which has no E-AC3.
- **Chapters become a chapter track** in runs that start past the first chapter. Those runs' tracks then
  no longer match the init segment, so chapters and metadata are dropped.
- **Subtitles have no seekable index of their own.** They come out of the same ffmpeg run as WebVTT
  files, start at its `-ss`, and are shifted like the audio. A subtitle segment waits until the video is
  past it, so its cues are in.

## Subtitles from OpenSubtitles (`opensubs.js`)

Some releases carry only the US broadcast captions as English subtitles. Desperate Housewives S01
(`AMZN.WEBRip.x265-SiGMA`, 2026-10-18): ALL CAPS, speaker labels ("Mary Alice:"), sentences cut into 1-2 s
pieces. Their timing is right: on 37 s of S1E12 the speech energy lined up best with the captions shifted
0.25 s, so the "weird timing" is the cutting, not a delay. Better subtitles come from OpenSubtitles:

- **When.** The browser sends the title's TMDB id with the stream (`desktop/play.js`, `&tmdb=&kind=`); the
  episode comes from the torrent file's name (`S01E12`, `1x12`). A file with no English text subtitles asks
  at once, and the master playlist waits up to 8 s to list the result. Otherwise, once subtitle 0 has 15
  lines, mostly upper-case text (under 10 % lower-case letters, speaker labels aside) means TV captions;
  then it asks, and so do later episodes of the same torrent, right at the start.
- **Which.** One search (`/subtitles`, parameters in alphabetical order or the API answers with a redirect)
  by OpenSubtitles' file hash (size + first and last 64 KiB) and the title + season/episode. Best: made for
  this file (hash match), then the same source (WEB / DVD / Blu-ray / TV: timings and cuts differ) and
  release tags (service, codec, resolution, group), not for the hearing impaired, most downloaded. Only
  tags count: the show's and episode's words are in most names, and with them S1E12's DVD rips beat the
  WEB rip.
- **Quota.** A download counts against the account's daily quota (about 20 a day free, 1,000 VIP; anonymous
  downloads are off for this key). Each one is kept in `REMUX_SUBS` (`os-<file id>.srt`, and the pick per
  torrent file), so an episode is downloaded once for everyone. The log line says how many are left.
- **Lined up** with the file's own captions, which are in step with the video: on a 0.2 s grid, the shift
  (±90 s) and speed (1, or 25/23.976 either way, for PAL DVDs) where "someone is talking" overlaps most
  (overlap / union, at least 0.45). From 60 caption lines (about 4 minutes) and again at 3x as many; until
  then the captions show. Fewer lines don't work: S1E12's first 20 (the dense "previously on" recap) matched
  a shift of 59 s at 0.96, and within ±5 s always the edge. Checked 2026-10-18 on S1E12's captions against a
  copy cut into pairs of lines, shifted and sped to 25 fps: shift and speed found from 60 lines; and end to
  end through the service (a test file with ALL CAPS lines and a stand-in download shifted 3 s): "TV
  captions" after 15 lines, shift -3.0 s, overlap 0.95 at 74 lines, later subtitle segments from the
  download. On the home server the same day, S1E12 played through its remux: TV captions found, signed in (20
  downloads a day), one download (19 left), "...DVDRip.NonHI.cc.en.BNVST" lined up against 149 caption lines
  at shift 10.6 s, speed 0.959 (a PAL DVD), overlap 0.87; segment 70 then read "I'd love to." at 6:54.36,
  the captions' "I'D LOVE TO." at 6:54.58. (That pick was before the source rule above.)
- With no captions to line up with, a hash match is used as it is, and otherwise the best guess as it is.

Not handled: video codecs a browser can't decode (MPEG-4 Part 2/Xvid, VC-1) get an error instead of a
playlist. Dolby Vision profile 5 (no HDR10 base layer) shows wrong colours. Bitmap subtitles (PGS,
VobSub) are skipped. The pickers in `desktop/pick.js` steer away from these.
