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

## Restarts

A deploy restarts this service while people watch, and nobody should notice:
- **On SIGINT/SIGTERM** (a Windows service stop is a Ctrl+C, which Node sees as SIGINT):
  1. It stops listening.
  2. It closes the requests it hasn't started answering. Most of these are waiting for ffmpeg to write a segment.
  3. It lets the segments it is already sending finish, stops ffmpeg and exits. That takes 0.1 s.
- **Caddy covers the gap** (`lb_try_duration 30s` on `/gst/`):
  - A request arriving while nothing listens waits until the next process does.
  - A GET whose connection closed before an answer is sent again.
- **The next process starts from the request.** Its cache is empty. It rebuilds the session from the first
  segment asked for, and the title id in the path brings OpenSubtitles back too (below). The player sees one
  slow segment.

Tested 2026-10-19 on the Mac, with:
- Lampa's hls.js 1.4.7 with Lampa's settings, playing Big Buck Bunny from the home server's TorrServer;
- Caddy 2.11.7 with the home server's `/gst/` route;
- SIGINT, then a new process at once.

The waiting segment 27 was handed on. Caddy answered the player's retry with it from the new process in
1.5 s. There was no stall, no error status, and no ffmpeg left behind.

## How it works

| file | |
|---|---|
| `media.js` | ffprobe the file, choose the streams, plan the segments, build ffmpeg's arguments |
| `mkv.js` / `mp4index.js` | keyframe times from the file's own index (Matroska Cues / MP4 `stss`), read with a few HTTP range requests |
| `session.js` | one playing file: runs ffmpeg from the segment asked for, writes segments, follows seeks |
| `mp4.js` | splits ffmpeg's fragmented MP4 into the init segment and fragments, and fixes their times |
| `server.js` | the HTTP side |
| `startup.js` | how far a file is from playing, for the loading card (below, "Loading progress") |

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
- **Keyframes don't all have the same reorder delay.** In an x265 open-GOP file (*Gladiator* 2000, HDR10,
  2026-10-19) the first keyframe is shown 0.083 s after its decode time and the one at 10.427 s 0.25 s after.
  - Fragments are therefore placed by when their keyframe is *shown* (decode time + its composition offset
    − the file's delay), which is what the keyframe index lists. By decode time the 10.427 s fragment came
    out at 10.26 s and went into segment 0: every segment then held other times than the playlist said
    (seg0 0–20.8 s for 0–10.4 s, seg3 overlapping seg2).
  - Every run lines its video up on the file's delay (the first run's), not its own first keyframe's, so a
    run started at a 0.25 s keyframe doesn't show the picture 0.17 s late.
- **E-AC3 can't be copied into HLS fMP4.** ffmpeg's HLS muxer fails with "Cannot write moov atom before
  EAC3 packets parsed". Audio is therefore AAC: 5.1 kept at 384 kbit/s, otherwise stereo at 192 kbit/s.
  That also plays in Chrome, which has no E-AC3.
- **Chapters become a chapter track** in runs that start past the first chapter. Those runs' tracks then
  no longer match the init segment, so chapters and metadata are dropped.
- **Subtitles have no seekable index of their own.** They come out of the same ffmpeg run as WebVTT
  files, start at its `-ss`, and are shifted like the audio. A subtitle segment waits until the video is
  past it, so its cues are in.

**HDR.** The master's `VIDEO-RANGE` is `PQ` or `HLG` from the video's `color_transfer` (`SDR` otherwise),
which Apple's HLS spec asks for. Browsers that can't show HDR video then skip the variant, so the player uses
the video playlist and `/<track>.vtt` (each subtitle track whole, as far as known) there (desktop/README.md,
"HDR films").

## Why starting takes longer than a seek

Measured 2026-10-20 on the home server (scripts run there against its TorrServer and this service's modules),
*Gladiator* (`414ee48b`, 1080p HEVC MKV, ~140 known peers), the torrent dropped before each run:

| run | file list (torrent metadata) | probe + Cues (`media.load`) | segment 0 | seek, a few seconds later |
|---|---|---|---|---|
| 1 | 0.5 s | 10.8 s (Cues alone 10.8 s) | 1.0 s | 4.2 s to 85 min |
| 2 | 10 s | ffprobe alone 5.0 s, then Cues 0.03 s | | |
| 3 (the live service: master, then segments) | 0.6 s | master 14.5 s | 1.0 s | |
| 4 | 8.9 s | 2.2 s (subtitles and init 0.05 s more) | | |

- **The total stays at 12-16 s, but the step that pays for it moves.** Whatever comes first waits for TorrServer
  to find peers: 1-2 connected and ~0 MB/s in the first seconds, 5 connected and ~9 MB/s 10-15 s later. The
  bytes themselves are few: ffprobe reads ~20 MB of the start, the Cues one piece at the end, segment 0 ~5 MB.
- **A seek comes after that warm-up.** The file's start and index are already in TorrServer's cache, the
  session (probe, segment plan) exists, and one segment's bytes are needed.
- **Why the warm-up is slow:** the home server is behind CGNAT with no IPv6, so TorrServer can only dial out.
  Only peers that accept incoming connections are reachable. It connected to 1-5 of the 120-148 peers it knew
  about.

## Loading progress

`/gst/<hash>/heartbeat?index=<file>` adds `Startup: { pct }` (`startup.js`), which the loading card shows as a
percentage and a bar (desktop/progress.js). Lampa's own heartbeat (no `index`) is unchanged. `pct` is the share
of the bytes starting needs that TorrServer already holds: the first 20 MB of the file (ffprobe's
`-probesize`) until the probe is done, then up to the end of segment 0 (bitrate × its length). The count
comes from TorrServer's `/cache` piece map (`PiecesLength`, each piece's `Size` / `Completed`), from where the
file starts in the torrent, so bytes already cached count. It stays at 99 until segment 0 is written, then 100.
It doesn't count the Cues piece at the end of a Matroska file (one piece).

Checked 2026-10-20: `report()` on a made-up piece map (a film starting inside piece 3; 13 pieces of 1 MiB
done = 49 %, plus half a piece = 52 %). End to end with Big Buck Bunny from cold, this service on the Mac
against the home server's TorrServer, in the built-in browser: "Connecting to the torrent… 1 peer, 3 peers",
then 0 % → 4 % → 60 % → 99 % within 3 s, and 100 % once segment 0 was written. In that test the time
after 99 % was the Mac reading from the home server over the tailnet (~1 MB/s). On the home server this service
reads TorrServer over localhost.

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
track per language found. Downloaded (quota) only when someone picks the track. Of the same release as an
English download that was lined up, it follows the same map; otherwise it's lined up by timing (below).
Picking, on top of the rules above:
- **Same title.** OpenSubtitles files other releases under a film's TMDB id: for "The Odyssey" (2026) the
  Bulgarian "The.Odyssey.The.Making.of.an.Epic.2026.1080p.AMZN.WEB-DL...-Kitsune" won on matching tags
  (AMZN, WEB, group) against a file of the film itself. A release whose title (the words before the year or
  episode) has words the file's title doesn't is now last.
- **Not a cinema copy** (CAM, TS, TELESYNC, TC) unless the file is one: their timing is a cinema
  recording's. Still used when nothing else exists (then lined up by timing).
- **Checked 2026-10-19** through the service and Lampa's player (built-in browser, hls.js) with that WEB-DL
  file: the Bulgarian pick (YTS WEBRip) is within 0.1 s of the file's own English lines at 10:05-10:16
  ("Но сега когато войната свърши" 10:05.15 vs "But now that the war is over" 10:05.25); with Settings →
  Player → Subtitle language set to Bulgarian, it came on by itself. The master took 2 s with both searches.

**Lined up by timing** (`alignTiming`, 2026-10-19). Words can't be matched across languages, but the
lines' starts can: where people talk and pause is the same in any translation. The reference is English in
step with the video: the download lined up by words, else the file's own English, else the English download as
it is. Each line's start and those of its 8 neighbours on each side form a pattern; a pair (download time ->
video time) is a line whose pattern lands on reference starts (within 0.3 s) for at least 9 of its 16
neighbours at one shift, and at least 3 fewer at any other. Shifts tried: the most common differences of
starts around that line (6 peaks of a 0.2 s histogram, up to 15 min either way), each at the speeds a release
is commonly converted by (1, 25/23.976 and back, 1.001 and back; the one with most pairs wins). From there as
for words: the longest chain moving forward in both, runs of 3+ whose shift changes by at most 1.5 s, the shift
followed from anchor to anchor. From 20 English lines, again every 40 more (about 0.15 s each for a film).
- **Between two runs** (an edit: a shift jump of more than 1.5 s) a line now takes the nearer run's shift
  instead of sliding from one to the other over the gap (that put lines up to 38 s off below). This applies to
  the English word fit too; its numbers above were measured before.
- **No fit** when fewer than 20 % of the download's lines that land among the reference's (within 10 s of one)
  are paired. With 200+ English lines (about 10 min) read and no fit, it isn't this video: the track shows no
  lines (log: "not this video"); with fewer, as it is until the next try.
- **Measured 2026-10-19** (scratch scripts, srt files from OpenSubtitles and the file's own English extracted
  with ffmpeg):
  - **Real, two cinema copies of Nolan's "The Odyssey"**: the Bulgarian for "...TELESYNC.x264-DKS" onto the
    English for "...TELESYNC.HEVC.AAC2.0-SPLiCE". Truth from words: the Bulgarian for SPLiCE is in step with
    its English, and the two Bulgarian translations share 587 3-word runs, which give DKS -> SPLiCE: +12 s,
    then +106 s from 5:30, +126 s from 93:50, +140 s from 98:30 (different recordings with different cuts). By
    timing: 1,019 anchors, 0.15 s. On the 1,402 lines the truth is sure of (its anchors on both sides with the
    same shift): median error 0.08 s, 90 % within 0.49 s, worst 1.47 s; as it was, 106-140 s. The 365 lines in
    the 4 jump gaps can't be checked. With only the first 60 English lines (5 min): 29 anchors, median 0.10 s;
    first 20 (3 min): 6 anchors, no fit yet.
  - **The file from the task** ("The Odyssey 2026 1080p AMZN WEB-DL DDP5 1 H 264-Kitsune", torrent 51090985)
    is The Asylum's 86-minute "The Odyssey", not Nolan's 165-minute film that TMDB 1368337 and every Russian
    subtitle under it are: that's why "Odyssey.2026.1080p.TELESYNC.x264-DKS" showed different lines at 10:05.
    Against the file's own English it gets 17 chance anchors (no fit, "not this video"); so do the Bulgarian
    DKS (16) and SPLiCE (22). The Bulgarian pick ("...WEBRip...YTS", 1:22:56 long, "АСИЛУМ ПРЕДСТАВЯ") is of
    The Asylum's film, filed under Nolan's id: 1,386 anchors, shift 0.02 s, median change 0.01 s.
  - **Known distortion**: that Bulgarian slowed to 25 fps (x 23.976/25), +7 s, and 5 s cut out at 40 min: speed
    found 1.0427 (25/23.976), median error 0.013 s, 90 % within 0.023 s, worst 5.0 s (one line at the cut); as it
    was, 99-201 s. With only pieces of the English (the first 3 min and 60-63 min, as after a seek): 94
    anchors, median 0.013 s at 60-63 min.
  - The Russian for DKS is timed to a SPLiCE-like copy already: against SPLiCE's English, shift -0.3 s.
  - **End to end** through the service (local, TorrServer on the home server, that file with `tmdb=1368337`,
    segments and both tracks asked for in order to 14 min): the Bulgarian lined up at 20, 61, 101, 141, 182 and
    223 English lines with 17 to 217 anchors, shift 0.1 s (0.08 s more than against the extracted srt: the session
    shows the file's own lines in step with the video, mp4.js); "Но сега когато войната свърши" at 10:05.20 vs "But now that" 10:05.17. The Russian:
    0-12 anchors, as it was until 223 English lines, then "not this video: no lines".

Not handled: video codecs a browser can't decode (MPEG-4 Part 2/Xvid, VC-1) get an error instead of a
playlist. Dolby Vision profile 5 (no HDR10 base layer) shows wrong colours. Bitmap subtitles (PGS,
VobSub) are skipped. The pickers in `desktop/pick.js` steer away from these.
