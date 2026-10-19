# server/remux: any torrent plays in a browser

Browsers play only some files. A 4K HEVC MKV with E-AC3 Atmos audio, which is a typical WEB-DL, never
starts in Safari: Lampa's player just spins. This service repackages what TorrServer streams into HLS:

- **Video:** copied as is, no re-encoding.
- **Audio:** English, converted to AAC.
- **Subtitles:** English, Bulgarian and Russian, in that order: the file's own text subtitles as WebVTT, and
  from OpenSubtitles in a language the file has none in, or in place of English TV captions (ALL CAPS)
  ("Subtitles from OpenSubtitles" below).

Safari plays it natively (so AirPlay works), Chrome plays it through Lampa's hls.js, and seeking works
everywhere.

It speaks the protocol Lampa already has for TorrServer's GStreamer build ("Settings → TorrServer →
transcoding", storage key `torrserver_gts`), so Lampa itself is unchanged. Serve this service at
`<TorrServer URL>/gst/` and turn that setting on.

| request | answer |
|---|---|
| `GET /gst/echo` | JSON. Lampa checks it before using `/gst/` (app.min.js `gstCheck`, it parses JSON) |
| `GET /gst/<hash>/master.m3u8?index=<file>[&lang=ja][&tmdb=<id>&kind=tv\|movie]` | HLS master: one video+audio stream (English audio, or the `lang` asked for: `ja`), English/Bulgarian/Russian subtitle tracks (`NAME` English/Bulgarian/Russian, `LANGUAGE` en/bg/ru), English on by default when the audio isn't English |
| `GET /gst/<hash>/<file>.<lang>/video.m3u8`, `init.mp4`, `seg<n>.m4s` | the stream |
| `GET /gst/<hash>/<file>.<lang>/<track>.m3u8`, `<track>-<n>.vtt` | subtitles: `sub<k>` the file's own (k: its place among them, English first), `os<lang>` from OpenSubtitles |
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

- **When.** The browser sends the title's TMDB id with the stream (`desktop/play.js`, `&tmdb=&kind=`), and the
  master puts it into every path below it (`<file>.<lang>.t<id>/`, `m` for a film): after a restart of this
  service Safari carries on by asking for the next segment, not the master, and the session made again from
  that request didn't know the episode (2026-10-18: S1E14 kept its captions after the restart; a session
  without it now logs "no title id"); the
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
- **Lined up** with the file's own captions, which are in step with the video, **by their words**: both are
  transcripts of the same dialogue, so a run of 3 words found in exactly one caption anchors that moment.
  Anchors must move forward in both files (the longest such chain), and only runs of 3+ anchors whose shift
  changes by at most 1.5 s count (a chance match of a phrase said twice is a run of one). The shift is
  followed from anchor to anchor, so a different speed and edits are covered; past the last anchor, the last
  shift at the anchors' overall speed; 0.25 s earlier than the captions (they come up that late: on 37 s of
  S1E12 the speech energy lined up best with them shifted 0.25 s). From 20 caption lines (about a minute),
  again every 40 more.
  - **Why not one shift:** the first version found one shift and speed (overlap of "someone is talking" on
    a 0.2 s grid, from 60 lines). S1E14's WEB rip ("...WEBRip.x264-ION10") runs 25/23.976 fast, and on top of
    that its shift moves 12.0 -> 10.7 s, jumps to 12.4 s at 11 min and to 6.4 s at 14:40 (about 5 s of footage
    the Amazon file doesn't have): up to 4 s off ("the subs are a bit out of sync", 2026-10-18). S1E13's DVD
    rip got no fit at all and kept its captions. Broadcast captions run back to back, so "someone is talking"
    is on almost all the time and many shifts score alike.
  - **Checked 2026-10-18** on the real files from the home server, lining up with every other caption line and
    measuring on the lines it never saw: S1E14 WEB rip median error 0.04 s, 90 % within 0.10 s, worst 1.1 s;
    S1E12 DVD rip median 0.32 s, 90 % within 1.0 s; S1E13 DVD rip median 0.38 s, 90 % within 1.2 s (DVD
    subtitles reword lines, and part of that is the measurement's own noise). End to end through the service
    (test file, ALL CAPS lines, a stand-in download in mixed case shifted 3 s): 45 anchors, shift -2.9 s.
- With no captions to line up with, a hash match is used as it is, and otherwise the best guess as it is.

**Bulgarian and Russian** (2026-10-19), for a file without its own in that language. Searched (free) as soon as
the master is asked for, by the same hash and title; the master waits up to 8 s for the answers and lists a
track per language found. Downloaded (quota) only when someone picks the track. Its words can't be lined up
with English captions, so it plays as it is, unless it's of the same release as an English download that was
lined up: then it follows the same map. Picking, on top of the rules above:
- **Same title.** OpenSubtitles files other releases under a film's TMDB id: for "The Odyssey" (2026) the
  Bulgarian "The.Odyssey.The.Making.of.an.Epic.2026.1080p.AMZN.WEB-DL...-Kitsune" won on matching tags
  (AMZN, WEB, group) against a file of the film itself. A release whose title (the words before the year or
  episode) has words the file's title doesn't is now last.
- **Not a cinema copy** (CAM, TS, TELESYNC, TC) unless the file is one: their timing is a cinema
  recording's. Still used when nothing else exists: for that film the only Russian one,
  "Odyssey.2026.1080p.TELESYNC.x264-DKS", is out of step (different lines at 10:05).
- **Checked 2026-10-19** through the service and Lampa's player (built-in browser, hls.js) with that WEB-DL
  file: the Bulgarian pick (YTS WEBRip) is within 0.1 s of the file's own English lines at 10:05-10:16
  ("Но сега когато войната свърши" 10:05.15 vs "But now that the war is over" 10:05.25); with Settings →
  Player → Subtitle language set to Bulgarian, it came on by itself. The master took 2 s with both searches.

Not handled: video codecs a browser can't decode (MPEG-4 Part 2/Xvid, VC-1) get an error instead of a
playlist. Dolby Vision profile 5 (no HDR10 base layer) shows wrong colours. Bitmap subtitles (PGS,
VobSub) are skipped. The pickers in `desktop/pick.js` steer away from these.
