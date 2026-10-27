# server/remux: any torrent plays in a browser

Browsers play only some files. A 4K HEVC MKV with E-AC3 Atmos audio, which is a typical WEB-DL, never
starts in Safari: Lampa's player just spins. This service repackages what TorrServer streams into HLS:

- **Video:** copied as is, no re-encoding.
- **Audio:** English, converted to AAC.
- **Subtitles:** English, Bulgarian and Russian, in that order: the file's own text subtitles as WebVTT (also
  the ones the torrent carries as `.srt`/`.vtt` files next to the video, "Subtitle files in the torrent"), and
  from OpenSubtitles in a language the file has none in, or in place of English TV captions (ALL CAPS)
  ("Subtitles from OpenSubtitles" below). A "forced" track (only the lines for speech in another
  language) is left out where the language has a full one: TYSON S01 (TBK) lists English Forced, English,
  English SDH, and the player showed the Forced one, empty (2026-10-20).

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
| `GET /gst/pick?tmdb=<id>&kind=movie\|tv[&season=&episode=][&lang=ja]` | the releases to play, ranked: `{ audio, choices: [{ res, label, releases }], found, took }` ("Picking a release" below) |
| `POST /gst/pick/failed?hash=&tmdb=&kind=&why=[&title=]` | a player gave up on a release (no peers, too slow): never offered again (by hash; by `title` where a listing's hash isn't known) |
| `GET /gst/link?u=<Jackett .torrent link without its key>` | that link fetched from Jackett with the key, for TorrServer |
| `GET /gst/jackett/api/v2.0/indexers/<x>/results?...` | Lampa's own Jackett search, with the key added here and removed from the answer (every download link becomes a `/gst/link` one); other Jackett paths 404 |
| `GET /gst/remove?hash=<hash>` | stop, and drop the torrent from TorrServer (kept while a download reads it) |
| `GET /gst/src/<hash>/<file>[?rec=1]` | the file's bytes (HTTP ranges) for ffmpeg and ffprobe on this machine, not through Caddy (below, "Opening a file again") |
| `GET /gst/src/<hash>/<file>[?rec=1]` | the file's bytes (HTTP ranges) for ffmpeg and ffprobe on this machine; not through Caddy (below, "Opening a file again") |
| `POST /gst/download` `{hash, index, lang, tmdb, kind, season, episode, name}` | start a download (below); the job |
| `GET /gst/downloads` | every job: `{id, state, progress, size, subs, url, …}`, state `queued` / `fetching` / `subtitles` / `finishing` / `ready` / `failed` |
| `GET /gst/download/<id>/<name>.mp4` | the finished file, with byte ranges, as an attachment named `<name>.mp4` |
| `POST /gst/download/<id>/cancel` | stop it, or delete the file |

## Running it

Node 18.15+ (no dependencies; `fs.statfs`), plus ffmpeg and ffprobe 8.x. Environment variables:

| variable | default |
|---|---|
| `REMUX_PORT` / `REMUX_HOST` | `8092` / `127.0.0.1` |
| `TORRSERVER` | `http://127.0.0.1:8090` |
| `FFMPEG` / `FFPROBE` | `ffmpeg` / `ffprobe` on the PATH |
| `REMUX_CACHE` | `<tmp>/lampa-remux`, emptied at start |
| `REMUX_SUBS` | `<tmp>/lampa-remux-subs`: subtitles downloaded from OpenSubtitles, kept across restarts |
| `REMUX_DOWNLOADS` | `<tmp>/lampa-remux-downloads`: downloads (below), kept across restarts |
| `REMUX_SWARM` | `<tmp>/lampa-remux-swarm.json`: releases seen dead (below), kept across restarts |
| `REMUX_RELEASES` | `<tmp>/lampa-remux-releases.json`: releases that played or failed, per title (below), kept across restarts |
| `REMUX_SOURCES` / `REMUX_SOURCES_MB` | `<tmp>/lampa-remux-sources` / `4096`: what each file's first open read (its start and index) and its probe, kept across restarts, the least recently opened dropped past that many MB (below, "Opening a file again") |
| `JACKETT_URL` | `http://127.0.0.1:9117/jackett`: the Jackett `/gst/pick` searches |
| `JACKETT_KEY` / `JACKETT_CONFIG` | Jackett's API key, or the path of Jackett's `ServerConfig.json` to read it from (the home server: `C:\jackett\data\ServerConfig.json`). Without either, `/gst/pick` answers 503 and browsers search themselves |
| `TMDB_KEY` | Lampa's own public TMDB key (app.min.js `key()`): the title's names, dates and runtimes |
| `REMUX_TRACKERS` | `tracker.opentrackr.org:1337,open.stealth.si:80,tracker.torrent.eu.org:451,open.demonii.com:1337`: UDP trackers asked for real seeder counts |
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
- **The next process starts from the request,** with the segments made before the restart. It rebuilds the
  session from the first segment asked for (the probe and index are kept on disk, `REMUX_SOURCES`), and the
  title id in the path brings OpenSubtitles back too (below). Segments already made are served from disk, so
  the player sees nothing; one past them waits for a new ffmpeg run.
- **The cache is kept** while the code that cuts segments is the same (`session.js`, `media.js`, `mp4.js`,
  `mp4index.js`, `mkv.js`: their hash is in `<cache>/VERSION`; any change empties it, so two kinds of segment
  never mix). A segment is written whole (`.tmp`, then renamed); leftover `.tmp` files and sessions unused for 2
  h are deleted at start. Until 2026-10-26 a restart emptied the cache: on 2026-10-24 a deploy at 14:17:48
  (EEST) did, the next process read seg137 from the torrent again in 79 s, and the TV on AirPlay, which gives up
  on a request after 5 s (four tries in `access-public.log`), stopped. Checked 2026-10-26 on the Mac against
  ruby's TorrServer (Desperate Housewives S01 720p, file 1): seg0-2 made, SIGINT, a new process served seg2 in
  0.003 s (the same bytes) and seg1 in 0.17 s, with no ffmpeg run.
- **Idle sessions:** ffmpeg stops after 60 s without a request or heartbeat; the session and its segments go
  after 2 h (10 min until 2026-10-26). A TV on AirPlay asks for nothing while paused, and the phone that sent
  it may be locked, so with 10 min a longer pause came back to a torrent read from scratch, past the TV's 5 s.

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
| `download.js` | a file made into one MP4 to keep (below, "Downloads") |
| `torrserver.js` | what the service asks TorrServer besides the stream (a torrent's files, drop) |
| `source.js` | the file's bytes for ffmpeg and ffprobe (`/gst/src/`), from disk where an earlier open read them (below, "Opening a file again") |
| `pick.js` / `releases.js` | which release to play (`/gst/pick`), and what played or failed (below, "Picking a release") |

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
  stops reading from TorrServer, so a paused film doesn't download to the end. A subtitle segment the
  player waits for, just past ffmpeg, lets it on to there: Safari reads subtitles minutes ahead of the
  video, and after two subtitle requests time out (its limit is 10 s) it stops loading anything, video too.
  Held 30 segments ahead, the next subtitle segment never came: TYSON S01E01 froze for a viewer on
  2026-10-20 (access log: `sub0-34.vtt` 499 after 10.2 s twice, then no request for 90 s; reproduced with
  a script against a local test file, `sub0-32` timing out without the change, up to `sub0-49` served with
  it; the iOS 27 simulator's Safari played, seeked and showed the full English track with it).

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
"Playable on every device").

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
- **What is done about it:** the browser starts the release "Play in" has selected while the question is
  open (desktop/README.md, "Play"), so this wait runs while you choose.
- **In the log** (every line has its time): one line per file started, `master in 14.9 s: probe 10.4 s, index
  12.6 s, then init and subtitles 2.2 s (peers 9/115, 0.1 MB/s)` (probe and index run side by side, timed
  from the start), and any segment the player waited over 3 s for, `seg0 in 6.4 s (peers 10/97, 12.5 MB/s)`
  (the first one, a seek, or the download falling behind). A request that times out adds the peers too;
  ffprobe's failures say whether it was stopped at 90 s and what it printed.
- **Why the warm-up is slow:** the home server is behind CGNAT with no IPv6, so TorrServer can only dial out.
  Only peers that accept incoming connections are reachable. It connected to 1-5 of the 120-148 peers it knew
  about.

## Opening a file again (`source.js`)

**Why a reopen was as slow as the first open.** Lampa drops the torrent when the player closes (`/gst/remove`),
and TorrServer keeps its pieces only in memory. Every open then probed the file again and ffmpeg read it from
TorrServer, and both read the file's start *and* its index at the end. Measured 2026-10-20 on the home server
(scripts there against its TorrServer), Friends S01-S10 (1080p x265 Silence, `1a6558e5`, 182 GB, file 68 =
S01E01, 767 MB), the torrent dropped before each run:
- **Pieces are 16 MiB**, and the episode starts 15,041,329 bytes into piece 1187: its first 1.7 MB share a
  piece with the previous file. Its Cues are in its last piece, 1233. Reading the start means a whole piece of
  other data, and so does the index.
- **The probe waits for both:** the file's first 64 KB came after 8.9 s (peers connecting), the Cues 24.9 s
  later, ffprobe finished at the same moment as the Cues (34.0 s, at 1-2 MB/s from 5-10 of ~500 peers).
  ffprobe reads the index too (Matroska's SeekHead).
- **So does every ffmpeg run, even one from 0:** after a cold add, ffmpeg from the start touched pieces 1187,
  1188 and 1233 and gave its first output after 45 s (that time 30 s of 0 MB/s with 9-12 peers connected).
- In the service's log the three opens that day took 40.1, 33.2 and 52.4 s ("probe ~33-52 s, index ~33-52 s").

**What is kept.** The first open's probe reads the file through this service (`/gst/src/<hash>/<file>?rec=1`,
HTTP ranges), and every byte it reads is kept on disk in `REMUX_SOURCES/<hash>-<file>/`: the file's start up to
where ffprobe stopped (2.8 MB for that episode, 0.9 MB for Big Buck Bunny's MP4) plus 1 MiB (ffmpeg reads 68 KB
past ffprobe), the index (Cues 107 KB; an MP4's moov), and the last 64 KiB (OpenSubtitles' file hash). The probe's
answer and the keyframe times go into its `meta.json`. At most 64 MB per file; the least recently opened files
go once all of them pass `REMUX_SOURCES_MB` (4 GB). A torrent's bytes never change, so nothing kept goes stale.
- **A reopen** answers the master from `meta.json` (no ffprobe, no Cues read), and ffmpeg reads the file through
  the same address: the start, the index and the tail from disk, the rest from TorrServer. Only the pieces of
  the segment asked for are waited for.
- **The file list:** each torrent played is saved in TorrServer's database (`torrserver.js keep`: a second `add`
  with only the hash and `save_to_db`; Lampa adds torrents unsaved). After a drop TorrServer lists it "in db"
  without peers or memory, and the next add has its file list at once. Measured 2026-10-20 on the home server
  with Big Buck Bunny: re-added after a drop, the file list came in 32-35 ms and peers came from its trackers
  (360 known after 2 s). The Friends pack: 2.1-11.5 s cold, 0.1 s saved (the runs below). Saved torrents not
  played for 30 days are removed (`forget`, at start and daily; `REMUX_SOURCES/torrents.json`).
- **The log** says `master in 0.1 s: probe and index kept from an earlier open`. `REMUX_DEBUG` also logs each
  read of `/gst/src/`: how much came from disk, how much from TorrServer, and how long it took.

**Measured** on the home server, 2026-10-20 (two copies of this service side by side on its TorrServer: the one
then deployed, and this one; a script did what Lampa's player does: add the torrent, wait for its file list,
master, init, the segments, then `/gst/remove`; each run started once the previous one's torrent was unloaded).
Friends S01E01 resumed at 0:51 (segment 8). "Before" is the deployed service with the old player (seg0, then seg8,
desktop/README.md "Starting where you left off") and the torrent not in TorrServer's database; "reopen" is this
service with the new player (seg8 only) after an earlier open. Total is from the add to the resume segment:

| run (22:36-22:45 local) | file list | master | segments | total |
|---|---|---|---|---|
| first open | 11.5 s | 9.0 s | seg8 2.7 s | 23.2 s |
| before | 9.0 s | 23.9 s | seg0 0.1 s, seg8 12.0 s | 45.0 s |
| reopen | 0.1 s | 0.04 s | seg8 10.0 s | **10.1 s** |
| before | 2.1 s | 35.3 s | seg0 0.1 s, seg8 10.4 s | 47.9 s |
| reopen | 0.1 s | 0.06 s | seg8 6.1 s | **6.2 s** |
| before | 2.7 s | 27.1 s | seg0 0.1 s, seg8 6.7 s | 36.6 s |
| reopen | 0.1 s | 0.05 s | seg8 27.4 s | **27.6 s** |
| before | 4.8 s | 10.4 s | seg0 0.1 s, seg8 1.3 s | 16.7 s |
| reopen | 0.1 s | 0.05 s | seg8 11.1 s | **11.3 s** |

- **Median 41 s before, 11 s after.** What is left is the resume segment's own piece: in every reopen
  `REMUX_DEBUG` shows the start, Cues and tail served from disk and one read from TorrServer, at the segment
  (`37757024-…: disk 0, TorrServer 4004975 in 10.0 s`). Its time is the swarm's warm-up: 0 peers connected at the
  master; the 27.4 s run downloaded at 0 MB/s for most of it with 17 peers.
- **Earlier the same evening** (before two fixes): the Cues were kept as two ranges (their 16-byte header, then
  the body), and the first version served one kept range and then went to TorrServer, so a seek still waited for
  the Cues piece (14.8 s of a 17.4 s seg8). Kept ranges are now served one after another. ffmpeg's open also read
  68 KB past where ffprobe stopped, in the next piece (4.0 s): the start is now kept 1 MiB further. Those
  reopens took 17.5-31.1 s for seg8, against 20.9-42.7 s before.
- A first open costs what it did (the probe waits for the start's and the index's pieces), minus segment 0 on a
  resume.

## Warming up (`warm.js`)

**Doing a first open before Play** (the user asked on 2026-10-26 for faster starts). A first open waits for peers, the
file's start and its index ("Why starting takes longer than a seek"). `GET /gst/warm` does that wait before
anyone presses Play. The browser asks for it from a title page, for Continue watching's first title and for the
next episode while one plays (desktop/README.md "Warming up").
- `?link=<magnet or /gst/link>&season=&episode=&at=`: the release Play would start, from `at` seconds (the
  place Lampa saved; `pct=` for a percent, Trakt's progress having no time). It is added to TorrServer and,
  once the file list is in, the file is picked the way Play picks it (the episode by `SxxEyy`/`NxNN` in its name,
  else the largest video).
- `?hash=&index=`: a file of a torrent already added (the next episode in the player's playlist).
- The file is then opened as the master opens it (probe and index, kept on disk by `source.js`), with its init
  segment. After that come the segments of the first 60 s from where Play will start (`at`), one after another as a player asks. If nobody else asked for anything meanwhile, ffmpeg is stopped
  there. Subtitles aren't looked up: that waits for the master, so OpenSubtitles' 20 downloads a day aren't
  spent on titles nobody plays. The torrent is saved for its file list (`torrserver.js keep`).
- TorrServer closes a torrent 30 s after nobody reads it (`TorrentDisconnectTimeout`) and keeps its pieces in
  memory (`UseDisk` off). So what a warm-up leaves for Play is on disk: the file list, the start and index, the
  session and those segments.
- At most 2 at once (429 otherwise), one per torrent (409). A file whose same segments were warmed in the last
  30 min answers at once (`again`).
- The log has one line per warm-up: `warm b43df67a:255 S2E3 in 64.4 s: file list 0.1 s, open 23.6 s, seg0-4 40.7 s`.

**Measured** 2026-10-26 on the home server. A test copy of this service (port 8098, its own cache and sources)
ran on its TorrServer, and a script there did what Play does: pick, add the torrent, wait for its file list, then
the master, init and segments up to 60 s of video, then `/gst/remove`. Breaking Bad S01-S05 1080p x265
(`b43df67a`, 515 seeders), season 2. Times are from the press of Play:

| episode | how | first video | 30 s of video | 60 s of video |
|---|---|---|---|---|
| E2 | cold, the torrent's first open (pick 2.6 s) | 63.9 s | 64.0 s | 71.7 s |
| E4 | no warm-up, same pack later (pick 3.2 s) | 63.6 s | 72.6 s | 82.0 s |
| E3 | warmed (30 s then), Play 40 s later, torrent closed meanwhile | **0.1 s** | 0.3 s | 57.1 s |
| E5 | warmed (30 s then), Play 10 s later | **0.1 s** | 0.2 s | 41.7 s |
| E6 | warmed 60 s, Play 40 s later | **0.1 s** | 0.3 s | **0.4 s** |
| E7 | warmed 60 s, Play 40 s later | **0.1 s** | 0.2 s | **0.3 s** |

- Without a warm-up, the master waited 52 s for the probe (the file's start and Cues pieces at 1.5 MB/s from 20
  of 354 peers). The second episode's file list came at once (the pack saved in TorrServer's database), but the
  probe still took 52 s.
- With one, Play got its master, init and first segments from disk at once. Those warm-ups took 64.5 s (the
  torrent closed since the last run) and 18.8 s (still connected).
- The first segment past the warm ones took 41 s with the torrent closed (E3: peers found again) and 19.6 s
  with it still connected (E5: a new ffmpeg run from there). Warmed 30 s, E3 would have stopped for ~10 s at
  0:31, so warm-ups make 60 s. E6 and E7's warm-ups took 39.5 and 60.0 s (opening 25.7 and 45.4 s, the segments
  13.8 and 14.5 s), all of it before Play.
- In the browser (tools/dev-server.js, TorrServer and the test copy tunnelled from the home server, Chromium on a
  3456 px screen): Better Call Saul's title page warmed its 4K S1E1 release (`8cfa3d13`) in 115 s: file list 2.1 s,
  open 26.0 s, 60 s of 4K video 87.4 s. Play then reused the warm-up's pick (no `/gst/pick`), had the file list in
  0.3 s and the master in 0.24 s. The video moved 3.4 s after Play; 1.9 s of that was the 4K segment crossing the
  tunnel to the Mac.

## Loading progress

`/gst/<hash>/heartbeat?index=<file>` adds `Startup: { pct }` (`startup.js`), which the loading card shows as a
percentage and a bar (desktop/progress.js). Lampa's own heartbeat (no `index`) is unchanged. `pct` is the share
of the bytes starting needs that TorrServer already holds: the first 20 MB of the file (ffprobe's
`-probesize`) until the probe is done, then up to the end of segment 0 (bitrate × its length). The count
comes from TorrServer's `/cache` piece map (`PiecesLength`, each piece's `Size` / `Completed`), from where the
file starts in the torrent, so bytes already cached count, and so do bytes an earlier open kept on disk
("Opening a file again"). It stays at 99 until the first segment the player asks for is written (segment 0, or
the one it resumes at), then 100. It doesn't count the Cues piece at the end of a Matroska file (one piece).

Checked 2026-10-20: `report()` on a made-up piece map (a film starting inside piece 3; 13 pieces of 1 MiB
done = 49 %, plus half a piece = 52 %). End to end with Big Buck Bunny from cold, this service on the Mac
against the home server's TorrServer, in the built-in browser: "Connecting to the torrent… 1 peer, 3 peers",
then 0 % → 4 % → 60 % → 99 % within 3 s, and 100 % once segment 0 was written. In that test the time
after 99 % was the Mac reading from the home server over the tailnet (~1 MB/s). On the home server this service
reads TorrServer over localhost.

## Dead swarms (`swarm.js`)

What Lampa's lists show and what the player switches on (desktop/README.md, "Dead swarms").

- **Real seeder counts.** `GET /gst/swarm?hash=<h>,<h>…` scrapes the public trackers in `REMUX_TRACKERS` (BEP 15
  over UDP, up to 70 hashes a packet) and answers `{ seeders: { hash: n | null }, dead: [{ hash, title, size }] }`.
  `n` is the highest count among the trackers that know the hash. A tracker answers 0/0/0 for a hash it has
  never seen, so `null` means unknown, and the list keeps the indexer's number. Counts are cached 15 minutes.
  Why: indexers' counts go stale. On 2026-10-20 LimeTorrents listed Spider-Man No Way Home's WiKi release
  (x265 10-bit, TrueHD, 16.5 GB) with 19 seeders, and the trackers had 2–5. From the home server the four
  trackers answered in 0.1–0.65 s (exodus.desync.com didn't, so it's not in the list), so a tracker that
  never answers costs at most 1 s. This Mac's network blocked outbound UDP that day, so only the home server
  could be tested. Measured through this service: 4 hashes in 0.86 s cold and 0.19 s cached, 221 releases
  in 1.66 s. A random hash gives `null`. The service's own TorrServer announcing a hash makes it known with
  0 seeders.
- **Dead.** A torrent is dead when a request has waited on its data (the probe or a segment) for 25 s and
  TorrServer's byte count (`bytes_read_useful_data`) hasn't changed in that time. Warm-up behind CGNAT takes
  12–16 s ("Why starting takes longer than a seek"), hence 25 s. Sampled every 5 s. A player retrying within
  5 s keeps the wait going: Lampa gives up on a master after 20 s and asks again (Caddy's 499s in the
  Vikings case below). Before marking, a tracker must answer, so this server's own outage never counts. Dead
  releases are kept 7 days in `REMUX_SWARM`, for everyone, unless one plays (120 s, releases.js) after it was
  seen dead: then it isn't. On 2026-10-27 `23609c03` (Desperate Housewives S2 720p PROTON) was called dead at
  07:32:59 and played 120 s ten seconds later, `167a5870` (the S01-08 720p pack) the same at 13:20, and both
  stayed hidden as dead, so S2E12 had nothing to offer. A test copy on the home server with the real memory
  offered both for S2E12 again. The heartbeat adds `Swarm: { dead, stalled, waiting }` (`waiting`: requests held for the torrent now; desktop/swarm.js calls a release too slow only while one is, since a player that asks for nothing makes any torrent look slow).
  - The count compared is "changed", not "grew": a torrent closed for being idle and added again starts
    at 0. The first version compared "grew". It called WiKi dead while it downloaded 2.6 → 11.7 MB, because
    its count from an earlier try was higher.
  - Cases: WiKi on 2026-10-20 at 10:02 (2 seeders connected, 0 bytes after the first 44 MB). Vikings
    (`bbbc0a68…`, 2026-10-20 at 00:57): three master requests got 499 after 20 s, then a 500 when ffprobe gave
    up at 90 s. In the tests on 2026-10-20 (a test copy of this service on the home server), a random
    hash (nobody seeds it) was marked dead 25 s after its probe began waiting. WiKi, alive again at about
    3 Mbit/s, never was (`stalled` stayed under 5 s for 3 minutes): that's "too slow", the player's call.
  - **Only a wait on the torrent counts.** A request counts while its connection is open (a closed tab's
    request doesn't) and, for a segment, while ffmpeg runs unpaused for it (`session.js` `reading()`). Data
    coming is TorrServer's count changing *or* ffmpeg writing a fragment: for a file TorrServer already holds
    whole the count stands still (Big Buck Bunny's for minutes while it played, 2026-10-20). `/gst/remove`
    answers the requests waiting on the session it closes at once, instead of after 90 s.
  - Why: VisionQuest S01E01 720p SYLiX (`4e5a2c99…`) was marked dead on 2026-10-20 at 14:29:22 UTC with 21/295
    peers and 237 seeders, minutes after playing 70+ segments to the iOS simulator. A new tab (14:28:50, after
    Safari was force-quit) asked seg0 of the session whose ffmpeg was near seg70. seg0 had been pruned (40
    behind), but it was inside the run (`start ≤ n ≤ cur + 6`), so the request waited for ffmpeg to write it,
    which it never would, and `flow()` paused ffmpeg (70 ahead of the "player" at 0). Nothing read the
    torrent, the count stood still, and the tab's retries every 4 s kept the wait going: ten seg0 requests
    timed out at 90 s from 14:30:22 on, with no "ffmpeg from segment 0" in the log. Any seek back more than 40
    segments into a run did the same. Now a missing segment behind ffmpeg starts a new run there. Reproduced on
    the Mac (this service with ruby's TorrServer, Big Buck Bunny: segments 0–50, then seg0 four times, aborted
    after 20 s each): before the fix no new run, `stalled` 140 → 178 s and `waiting` 4 after all four were
    aborted; after it, "ffmpeg from segment 0" and seg0 in 5–9 s, `stalled` 0. (This Mac can't reach the
    trackers over UDP, so the mark itself can't happen here; `stalled` past 25 s with a tracker answering is
    what marks.)

## Picking a release (`pick.js`, `releases.js`)

Which torrent Play starts used to be decided by each browser (desktop/README.md "Play"); since 2026-10-20 it
is decided here, so every device, the TV included, gets the same releases in the same order, and the
browser no longer needs Jackett's key. `GET /gst/pick?tmdb=&kind=[&season=&episode=][&lang=ja]`:

1. **The title** from TMDB (`tv/<id>` or `movie/<id>`, cached 6 h): names, dates, runtimes, seasons, genres.
2. **The search** Lampa's own parser makes (app.min.js `jackett()` with `parse_lang` "df"): the original
   title, `Category[]` 2000 (films) or 5000 (TV), plus 5070 for anime. Jackett ignores the other parameters
   Lampa sends (`title`, `year`, `genres`), so the results are the same. Cached 10 minutes, so the player's
   Quality menu and the next episode don't search again.
3. **The swarm** (`swarm.js`): the trackers' real seeder counts, and releases seen dead left out. That needs
   each release's info-hash. LimeTorrents and TorrentGalaxyClone give only a `.torrent` link, so `pick.js`
   fetches each such link from Jackett once (16 at a time) and keeps its hash (in memory, the last 20,000
   links). Only the links of releases Play could start are fetched: `rubyPick.ranked` over them with the seeders
   set aside (title, resolution, language, the episode). Until 2026-10-26 every one was: 741-987 links per pick
   for six series that day, which waited the full 2.5 s (LimeTorrents was refusing the bursts, 0 hashes in time
   for four of the six), and the bursts made LimeTorrents refuse Play's own release too. Measured the same day on
   the home server, the deployed service and a test copy with the filter, the same six series (Desperate
   Housewives S3E4, Friends S5E2, The Office S3E3, Game of Thrones S2E1, Better Call Saul S1E2, The Big Bang
   Theory S4E5), each picked twice: 0-35 links instead, the pick 1.3-2.4 s on first ask (was 3.9-4.6 s) and
   0.04-1.3 s with the search cached (was 2.5-2.9 s), the same top release each time. The log line says where a
   pick's time went: `(search 577 ms, links 300 ms, trackers 627 ms)`. Jackett answers with a redirect to the magnet (both indexers, 2026-10-20), or with the file,
   whose hash is the sha1 of its bencoded `info`. The pick waits at most 2.5 s for these; a link not done
   by then takes a twin's hash (same name and size on another indexer) as before, and is ready for the
   next pick.
4. **The ranking:** `desktop/pick.js` itself, run here in a `vm` sandbox (`rubyPick.alive`, `rubyPick.best`:
   English, this title, this episode, enough seeders, ranked by picture quality). The home server's copy
   is `desktop-pick.js` next to `server.js`, copied in by `lampa-setup.ps1`; in the repo it's
   `../../desktop/pick.js`. So the browser's fallback and the server can't drift apart.
5. **Memory** (`releases.js`, `REMUX_RELEASES`):
   - **Played:** this service sent 120 s of the release's video for that title, counting each segment
     once. The title comes from the master's `tmdb`/`kind`, or the `.t<id>` / `.m<id>` in a segment's
     path. A played release comes first in its resolution for that title.
   - **Failed:** `swarm.js` saw it dead, or a player switched away from it and said so
     (`/gst/pick/failed`: no peers within 45 s, or too slow). It is never offered again, for any title:
     a torrent that sends nothing does so whatever it was opened for. A later "played" (picked by hand
     from the list) clears it. Matched by hash; a release whose hash isn't known (its link not resolved
     in time, no twin) is matched by the failed release's name (`rubyPick.key`), which the report sends.
     **Unless nothing else is left:** when every release the ranking would offer failed once, those are
     offered again (the log line says `(offered again: nothing else left)`). "Too slow" and "dead" describe a
     moment: on 2026-10-27 Desperate Housewives S2E12 said "no good English copy" because both S2 1080p packs
     (`739a093b` SiGMA, `4b3e45fe` KONTRAST) had played for the title and then each had one slow minute.
     Checked the same day with a test copy on the home server and the real memory, with the two 720p releases
     marked failed: S2E12 got 1080p 2 and 720p 3 instead of nothing.
6. **The answer:** each resolution's releases, best first, at most 10, one listing per torrent (several
   indexers list the same one). Each is what Lampa's torrent flow reads (`Title`, `Size`, `Seeders`,
   `MagnetUri` or `Link`, `InfoHash`, `played`). Jackett's `.torrent` links carry its key
   (`jackett_apikey=`), so they are handed out as `http://127.0.0.1:<port>/gst/link?u=<the link without
   the key>`. TorrServer, on the same machine, fetches that, and this service fetches Jackett's link with
   the key and passes on the file or the redirect to a magnet. It only fetches links under `JACKETT_URL`.

### Another film of the same name

On 2026-10-21 Play on Nolan's "The Odyssey" (tmdb 1368337, 173 min) played `f4f90193` "The Odyssey (2026)
(1080p AMZN WEB-DL x265 10bit EAC3 5.1 Celdra)": The Asylum's mockbuster (tmdb 1698863, 86 min, 2026). Same
name, same year, so `desktop/pick.js` kept it, and its 940 seeders ranked it first. Every one of the 13
releases offered was that film (ffprobe on ruby of four of them: 86 min each; two said "NOT The Chris Nolan
FILM"). An AI reading the names wouldn't help: they are the same names. Two checks:

- **Not out at home** (`pick.js` `notOut`): the pick asks TMDB for the film's `release_dates` too. Before its
  first digital, physical or TV release anywhere (types 4/5/6) minus 7 days for leaks, the answer is
  `{ choices: [], notOut: "2026-11-17" }` without a search (0.5 s), and Play says when it comes out. A film
  TMDB has no such date for is searched as before, unless it hasn't come out anywhere yet (`notOut: "soon"`;
  The Mongoose, in US cinemas 2026-10-30). `GET /gst/home?tmdb=` answers just `{ notOut }`, for the Play buttons
  (desktop/README.md "Play").
- **The length** (`pick.js` `sameFilm`, at `master.m3u8` with `tmdb`/`kind=movie`): the probe already knows the
  file's duration. Under 0.7× or over 1.5× TMDB's runtime and 20+ min off, the master answers `409 another
  film: this video is 86 min, The Odyssey is 173 min` and `releases.js` marks it `wrong` for this title only
  (it is the right film for the other one); the pick leaves it out for this title from then on. The margins
  leave room for other cuts (Kingdom of Heaven's director's cut 1.35×, Apocalypse Now Final Cut 1.24×). TMDB
  runtimes under 40 min and series are not checked. Measured 2026-10-21 with a local remux against ruby's
  TorrServer: `f4f90193` refused in 7.8 s.

What stays with the device: the resolution (screen and measured speed) and video it can't decode
(`compat.js`), so the answer lists every resolution.

**The concrete case.** On 2026-10-20 at 00:57 `bbbc0a68…` (Vikings S06, NF WEB-DL H.265, G66) sent nothing
for 90 s: three masters got 499 after 20 s, then ffprobe failed. It was opened from Vikings: Athelstan's
Journal's page (tv 65491), and is Vikings S06 (tv 44217). Checked 2026-10-20 with a local copy of this
service against the home server's Jackett: Vikings S6E1 offered it second at 1080p (35 seeders, three
listings). After `POST /gst/pick/failed?hash=bbbc0a68…&tmdb=65491&kind=tv&why=dead`, all three listings were
gone for tv 44217 too. On the home server, after deploying 20c24c1 (2026-10-20 16:40 local), the same
report was made for the real failure, with the same result: `317 found, 19 dead, 3 failed before, 1080p 2,
720p 2`. The pick took 1.0 s there with a real tracker scrape (19 releases had 0 seeders on the trackers),
29 ms cached. A `/gst/link` link fetched on the home server answered 302 to the release's magnet (a
TorrentGalaxyClone listing), and no link in the answer carried the key.

**Releases with only a link** (2026-10-20). Play on *Matchbox the Movie* (movie 1148365) at 17:34 UTC put
first in 1080p LimeTorrents' "Matchbox The Movie 2026 1080p WEB DL HEVC x265 5 1 BONE" with 3079 seeders. It
was `b317b439`, which the trackers say has 4 seeders; it produced no file list in 45 s, the browser switched
and reported it (`b317b439 failed (nopeers)`), and the next picks still said "0 failed before" and offered it
first. Jackett gave it no hash, so neither the scrape nor the failed mark could reach it, and its twin by name
was another torrent (Knaben's `d9576d60`, same name and size). Checked on the home server the same day with
this code and the old in a copy next to the service (its own Jackett, a copy of `releases.json`), each run a
fresh process:

| title | results (link-only) | old: pick cold / cached | new: pick cold / cached | what changed |
|---|---|---|---|---|
| Matchbox the Movie | 185 (85) | 0.9 s / 0 ms, 0 failed before | 1.3 s / 0 ms, 85/85 hashed, 1 failed before | BONE `b317b439` gone; the 1080p BONE offered is `d9576d60` with the trackers' 3087; LimeTorrents' 2160p "WEB DV HDR H 265" 116 → 191 seeders (`839e6500`), 1080p "WEB H 264" 309 → 605; two 720p listings found to be torrents already listed |
| Vikings S6E1 | 317 (84) | 1.8 s / 0 ms | 1.7 s / 0 ms, 84/84 hashed | one more release dead on the trackers |

From the Mac through the home server's `/gst/link`, Matchbox's 85 links answered in 0.27-0.77 s each, all 85
at once in 0.81 s, every one a 302 to a magnet. The `.torrent` path was checked on Big Buck Bunny's file
(`dd8255ec…`, as its magnet says).

**Measured 2026-10-20** (local copy on the Mac, the home server's Jackett over the tailnet; the Mac blocks
UDP, so each scrape waited its 1 s timeout): Vikings S6E1 317 results, the pick 1.9 s cold, 1.0 s with the
search cached; Inception 206 results, 1.8 s; Cyberpunk: Edgerunners 392, 2.1 s; Frieren (anime) 253, 4.3 s,
`lang=ja` → audio `ja`. Played: Big Buck Bunny played through the dev server was recorded
(`dd8255ec played 122 s of m10378`) 43 s after its master (13:29:20 → 13:30:03 UTC), the player having
buffered ahead. A release
marked played in `REMUX_RELEASES` (GalaxyTV 720p of Vikings S6) moved ahead of the BluRay one ranked
above it.

## Downloads (`download.js`)

For watching offline, mostly on iPhones (the user's call, 2026-10-20): one torrent file becomes one MP4 that
the phone keeps and plays without Lampa, in Files or the TV app. Chosen over two alternatives:
- **The raw torrent file:** no work, but an MKV with E-AC3 doesn't play on an iPhone.
- **Offline inside Lampa** (a service worker storing the HLS segments): Safari's storage limits and its
  eviction of a site's data after 7 days unused, for multi-GB films.

**A job, three steps:**
1. **Pass 1:** one ffmpeg run reads the whole file from TorrServer (`media.ffmpegArgs` with `file:`). Video
   copied (`hvc1` tag for HEVC), audio as for streaming, the file's own subtitles as WebVTT.
2. **Subtitles:** a `Session` reads those (one run from 0, `delay` 0: pass 1's output is already on its own
   timing). It makes the tracks exactly as for the player: OpenSubtitles searched, fitted, TV captions
   replaced. Tracks with no cue that fits this video are left out.
3. **Pass 2:** a second ffmpeg run on local disk puts them in as `mov_text`, tagged `eng`/`bul`/`rus`, and
   moves the index to the front (`+faststart`). English is on by default when the audio isn't English, as
   in the player.

**State and limits:**
- **On disk:** each job is `<REMUX_DOWNLOADS>/<id>.json` plus `<id>/film.mp4`, so finished files survive a
  restart. An unfinished job starts over after one: a deploy that restarts the service costs it the time
  so far.
- **Two at a time:** each holds a torrent (up to 1 GB of TorrServer's RAM) and shares the download speed
  with people watching. Others wait (`queued`).
- **Disk:** refused when the free space minus what unfinished jobs will still write (2.1 × their file
  size, pass 1 plus pass 2's copy) would fall under 20 GB.
- **Expiry:** a ready file is deleted after 3 days, a failed job after 1. A job whose ffmpeg reads nothing
  for 10 minutes fails: "The torrent stopped downloading".
- **Sharing:** jobs are shared by everyone using the server; the same file and audio language is one job.
- **The torrent:** Lampa drops the torrent when its file list or player closes (`/gst/remove`). The service
  keeps it while a download reads it, and drops it when the job ends unless a player is using it.

**Measured** (2026-10-20):
- **On ruby** (i7-4790, SSD), Big Buck Bunny 1080p H.264, 276 MB, already in TorrServer: pass 1 took
  17.5 s (about 16 MB/s), pass 2 0.5 s. So pass 1 is bound by how fast the torrent downloads (a 1080p
  WEB-DL of 7.7 GB at the 1.7–4.8 MB/s seen for a 4K release would take 30–75 min). Pass 2 is a local
  copy: about 500 MB/s on that SSD.
- **On the Mac, through this service,** a 30 s 10-bit HEVC HDR10 MKV with E-AC3 5.1 and English + Bulgarian
  SRT: the MP4 has `hvc1` HEVC with PQ kept, AAC 5.1, two `mov_text` tracks with the cues on their original
  times. AVFoundation (macOS) reports it playable, with English and Bulgarian as subtitle options. It also
  lists a "Forced" variant of each, which Apple's players hide from the menu.
- **In the iOS 27 simulator:** Safari asked "Do you want to download …?" and saved it as `Test Film
  (2026).mp4` in Files → Downloads, and it played from there. The subtitle menu couldn't be read: the Mac
  was overloaded (load 140) and the simulator too slow. Check it on a real iPhone.

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
  A subtitle whose own data (`feature_details`) or release name (`S01E24`, `1x24`, "124 - <title>") names
  another episode is left out, hash match or not, and a kept pick like that is picked again (`otherEpisode`).
  Found 2026-10-20: Friends S01E01 in the S01-S10 Silence pack (1a6558e5, file 68) got the hash match "124 -
  The One Where Rachel Finds Out", S1E24's lines ("Here's little Ben nodding off"); the file has no captions
  of its own, so nothing lined them up. Its Bulgarian (S01E01, hash match) and Russian picks were right.
- **Quota.** A download counts against the account's daily quota (about 20 a day free, 1,000 VIP; anonymous
  downloads are off for this key). Each one is kept in `REMUX_SUBS` (`os-<file id>.srt`, and the pick per
  torrent file), so an episode is downloaded once for everyone. The log line says how many are left.
- **Signed in** once, kept 20 h. A download answered 401 signs in again and is asked once more: on 2026-10-20 a
  token from 17:55 UTC got "401 invalid token" by 19:43, and every download failed until a restart. Why is
  unknown: the token's own `exp` says 24 h, and another sign-in doesn't end an older token (three in a row all
  answered `/infos/user`, measured that evening). The log says the refused token's age and whether a new one
  helped. A failed
  download is tried again after 10 min; before, every subtitle request of the player retried it (once a second,
  `f3647aee:15 bg`).
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
- With no captions to line up with, a hash match is used as it is, and otherwise the best guess as it is. That
  guess is often far off: another release's timing ("Subtitle files in the torrent" below: 108 s by 40 min).
  Lining it up with the speech in the audio instead was tried on 2026-10-24 and doesn't work with a loudness
  detector ("Lining up with the audio" below).

**Subtitle files in the torrent** (`sidecar.js`, 2026-10-24). Some releases put their subtitles next to the
video instead of inside it. Desperate Housewives S01 by KONTRAST (torrent 79655332) has MP4s with none inside and
`Subs/<episode name>/2_eng,English (SDH).srt`. This service didn't look at them, so the player got OpenSubtitles'
best guess as it was, "Desperate.Housewives.S01E22.WEBRip.x264-ION10": another release, which runs at 23.976/25 of
the speed and has 3-5 s more at each ad break. Against the release's own captions (lined up by words, 626
anchors) it was 10 s early at 1 min, 13 s late at 10 min, 45 s at 20 min and 108 s at 40 min ("a bit out of
sync again", Choko boko, 2026-10-24).
- **Which files.** A `.srt` or `.vtt` of the torrent whose path has the video's name in it (next to it, or in a
  folder named after it), or that names the same episode (`S01E22`), or the only one of a torrent with one video
  and no episode in its name. One that names another episode never is.
- **Language** from the words of its name that aren't the video's (`eng`, `English`, `bul`, `rus`...: the same
  patterns as the file's own tracks); a name with no letters left (`<video>.srt`, `2.srt`) is English. One per
  language the file has none inside: a full one before a forced one, plain before SDH (`SDH`, `HI`, `CC`).
- **Then they are the file's own:** subtitle `sub<k>` like an embedded one, but read whole at once from
  TorrServer (UTF-8, else Windows-1251 for Bulgarian/Russian and Windows-1252 otherwise), not from ffmpeg's
  runs. KONTRAST's are TV captions (ALL CAPS), so OpenSubtitles' English is lined up with them by words as
  above.
- **A dropped torrent lists no files**: once nobody has read it for a while, TorrServer's `get` answers "in db"
  without `file_stats` until something reads the torrent, and a reopen reads nothing before this (the probe is
  kept, `source.js`). The first local test after TorrServer dropped it said "subtitles none". One byte of the
  video is read first then (reproduced with TorrServer's `drop`: "subtitles en" after).
- **A player that got the master before** (with `osen`, the English from OpenSubtitles) carries on after a
  restart without asking for it again: `osen` is then answered with the file's own English track.
- **Checked 2026-10-24** with a local service against ruby's TorrServer, on S1E22: the master lists English as
  `sub0`, the captions were found to be ALL CAPS, and the ION10 download was lined up with them: 626 anchors,
  speed 0.9496, shift 12.2 -> -114.7 s. "Obviously." at 35:01.60 against the captions' 35:01.77 (0.25 s earlier
  on purpose, `CAPTION_LAG`). The Bulgarian (DVD, "1x22 - Goodbye For Now") got 69 anchors by timing and no fit
  ("not this video"): that file has no Bulgarian track.

**Lining up with the audio** (tried 2026-10-24, not built). With no subtitles in the file or the torrent, the only
in-step reference is the speech itself. Measured on KONTRAST S1E22 (the audio extracted with ffmpeg at 8 kHz, a
"someone is talking" score per 10 ms from loudness against the 20th-80th percentile of the 30 s around it, also
band-passed to 300-3000 Hz): over the whole episode the in-step captions single out the right shift (score 3232 at
0 s against about -1900 at ±4 s). That doesn't help: the download has another speed and four edits, and a single
shift and speed picked 25/23.976 at -25 s (median error 73 s). Per window it fails: in windows of 30 lines (about
2 min), searched ±20 s, even the in-step captions came out right (within 0.5 s) in only 7 of 26; ±300 s, in none.
Music and effects under the dialogue score like speech. It needs a real speech detector (a neural VAD, a
dependency this service doesn't have).

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
