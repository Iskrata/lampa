# desktop/: how Lampa Desktop works

Plain ES5 scripts, no build step. `index.html` loads them before Lampa's own loader, in this order. Each
one waits for the parts of `window.Lampa` it needs (Lampa loads `app.min.js` asynchronously) and then runs.
Everything visual is active only off TVs (`!Lampa.Platform.tv()`: computers, phones, tablets) with
**Settings → Interface → Desktop look** on, so Lampa on a TV stays as upstream ships it. Phones and tablets:
see "Touch devices and phones".

| file | what it does |
|---|---|
| `loading.js` | the startup intro (the wordmark, Netflix-style) and the red spinner in place of Lampa's loaders; first, and on every platform |
| `icons.js` | `rubyIcons.svg(name)`: shared SVG icons (no emoji or text glyphs as icons) |
| `store.js` | where profiles live (`rubyStore`): a WebDAV folder at `./sync/` if the server has one, else this browser |
| `profiles.js` | profiles and "Who's watching?" (`rubyProfiles`); must load **before** Lampa, see below |
| `desktop.js` | density, Apple TV dark CSS, full rows, pixel wheel scrolling, sharp images; shared helpers on `rubyDesktop` (`tmdb`, `details`, `logo`, `kind`, `card`, `pageY`, `openFull`) |
| `trakt.js` | `rubyTrakt`: Trakt API calls, related titles, the "Connect Trakt" device-code sign-in, the Client ID setting |
| `ratings.js` | thumbs down / up / love on title pages (`rubyRatings`), sent to Trakt when connected |
| `personal.js` | Home rows "Picked for you" and "From your watchlist" (Trakt), and the billboard's picks |
| `trailer.js` | the trailer player shared by the billboard and title pages (`rubyTrailer.attach`) |
| `hero.js` | the rotating featured billboard on Home |
| `title.js` | the full-screen hero at the top of movie/series pages |
| `glass.js` | colour light from the hovered poster, liquid-glass panels |
| `more.js` | "More like this" at the end of title pages |
| `rowload.js` | a shimmering placeholder row at the bottom while Lampa loads more rows/pages (wraps `Scroll.onEnd`) |
| `nav.js` | the Netflix-style top bar and profile menu |
| `avatars.js` | `rubyAvatars`: profile pictures, drawn characters (Simpsons, Rick and Morty, Pokémon) |
| `facts.js` | `rubyFacts`: the full-screen loading screen while a title starts |
| `progress.js` | how far it is, on that card: a percentage and a bar |
| `mylist.js` | `rubyMyList`: + My List on posters and the billboard |
| `pick.js` | `rubyPick`: from search results, the English releases that will stream, best per resolution |
| `resume.js` | `rubyResume`: where you are in a series; "Continue S2 E5" on its Play button and status line |
| `watched.js` | a title joins the watch history only after 10 minutes of watching ("Watched" below) |
| `play.js` | Play without a torrent list or a question: picks the release for this screen and connection, and the file; episodes play on click |
| `download.js` | `rubyDownload`: Download on title pages, a film or episode made into an MP4 to keep, for watching offline |
| `player.js` | the player's labelled Subtitles button, the Quality menu and an AirPlay button |
| `compat.js` | `rubyCompat`: plays on this device or says why: releases it can't decode left out, HDR it can't show as the video playlist, a stuck start ends in an error |
| `presence.js` | who's watching now, in the top bar (the shared `./sync/` folder) |

Torrents play in the browser through `server/remux` (its README): any file becomes HLS on the server, so an
MKV with HEVC and E-AC3 plays in Safari and Chrome, with subtitles, and AirPlays.

**Name.** The top bar's wordmark and the tab title say "Lampa" unless the host sets `window.lampa_brand`
before the scripts run (the home server's `lampa-init.js` sets "Ruby").

The `ruby` prefix on globals (`rubyDesktop`), storage keys (`ruby_*`) and CSS classes (`.ruby-*`) comes
from the home server this was first built for. It keeps everything clear of Lampa's own names.

## Profiles

Lampa keeps all state in `localStorage` under fixed keys and has no local profiles (its own need a CUB
account). A profile is therefore a set of those keys. The active profile's values are the live keys that
Lampa and its plugins read. Every other profile's values are kept in `rubyStore` as `profile-<id>.json`
(the first local-only version kept them in `ruby_profile_data_<id>`; they move there on the next load).

Switching writes the target to `ruby_profile_switch` and reloads. The swap runs at the very start of the
next page load, before `app.min.js` has read anything and after the old page can no longer write, so
nothing leaks between profiles.

**English from the start.** Language is a device setting, shared by its profiles. Lampa opens a "Choose
your language" screen on first run when `language` is unset, and both `language` and `tmdb_lang`
default to `ru`. So at page start `profiles.js` sets both to `en` when they're unset, and a new device
goes straight to "Who's watching?" (the user's call, 2026-10-20). Settings → Interface → Language still
changes it. Verified 2026-10-20: dev server with `LAMPA_UPSTREAM=127.0.0.1` (the host's `lampa-init.js`
502s, so it has no preset), `localStorage` cleared: no `.lang` picker, both keys `en`, the app shown.

**Sharing profiles between devices.** Serve any WebDAV folder at `./sync/` on the same origin, for
example `rclone serve webdav <dir> --addr 127.0.0.1:8091` behind your web server's `/sync/` route.
`store.js` detects it with a test write, then keeps `profiles.json` and `profile-<id>.json` (`{t, keys, by}`;
`by` names the device that wrote it and why) there:
- **Reads** happen synchronously at page start, before Lampa.
- **Writes** go up every 15 s when something changed, and when the tab hides. Each first reads the
  server's copy. If another device wrote it since this page last read or wrote it, the two are merged
  key by key against what the page last had: a key only one side changed keeps that change; one both
  changed keeps this page's, except watch progress (`file_view`), merged per title by its `updated`. The
  page then reloads so Lampa reads the merge, but never during playback (nothing goes up until the player
  closes). Before 2026-10-20 the last write simply won: a Safari tab left open put back a title just
  removed on the server. A page being closed can't wait for the read and uploads blind, unless it
  already knows of a conflict. Checked 2026-10-20 in tools/dev-server.js: the other device's search and
  this page's timetable both survived, and the watch progress held all three titles.
- **Which profile a device is on** stays on the device.
- **A browser's first contact** merges in its own profiles. Its untouched default "Me" isn't added. A
  renamed first profile whose id `p1` is already taken by a differently named one gets a new id, and its
  data goes up under that id. A profile with the same id and name is the same one: the shared copy wins
  and the browser's own is dropped. Nothing a browser brings along ever replaces a shared profile's data:
  on 2026-10-18 an iPhone's first contact did exactly that (its old, empty local "Me" was `p1` too and went
  up as `profile-p1.json`, wiping Iskrata's history and list; seen in Caddy's access log as a
  17-byte PUT right after the iPhone's first `.probe`). Fixed 2026-10-20, replayed in tools/dev-server.js.

Without `./sync/`, everything stays in the browser.

**Profile logs.** Each browser keeps its last 100 profile events (`ruby_events`, a device id in
`ruby_device`): uploads of old local profiles, first contacts and what they merged, newer copies taken,
conflicts and merges (which keys, sizes before and after), switches, deleted profiles, and what went into
the watch history or was left out. With `./sync/` they also go up as `events-<device>.json`, and
`rubyProfiles.log(what, info)` adds one. On the home server a watcher journals them with every profile
change and alerts when a profile loses data (the deployment's notes).

Per profile: `favorite`, `file_view*` (progress), `online_view`, `torrents_view`, `timetable`,
`search_history`, `recomends_*`, `activity` and a few more, every `trakt*` key (the Trakt login and all
Trakt plugin state), and `ruby_ratings`. Shared: settings, servers, plugins, and `trakt_client_id` /
`trakt_client_secret`. The list is at the top of `profiles.js`.

**Who's watching now.** With `./sync/`, each profile writes `presence-<id>.json` when playback starts,
every minute while it goes on, and `{at: 0}` when it stops. The top bar shows the other profiles that wrote
one in the last 3 minutes: an avatar with a green dot, "Vik is watching Breaking Bad · S5 E14" on hover,
the title page on click. A TV writes too; only the top bar reads.

**Pictures.** Edit Profile offers rows of drawn characters, not photos of real people: The Simpsons
(thesimpsonsapi.com CDN), Rick and Morty (rickandmortyapi.com) and Pokémon (PokeAPI's official artwork on
GitHub). A fixed list of image URLs, no API calls; every one was checked to load in Chrome on 15 Oct 2026.
Not Disney: the Disney fandom wiki answers a browser loading its images from another site with a placeholder
(404 for a cross-site image request, 403 for a browser user agent; curl with its own user agent gets through). The choice is the image URL (`img` in the
profile), shared with the rest of `profiles.json`; without one, the face on the profile's colour. Profiles
saved before then hold a TMDB cast-portrait path (`/abc.jpg`), which `rubyAvatars.url` still resolves.

## My List

A round + on every poster while it's pointed at, and "My List" on the billboard, toggle the title in Lampa's
Bookmarks (`Lampa.Favorite` `book`): the same list as the title page's bookmark button, per profile. A tick
when it's in. The top bar's My List opens just that list (`component: 'favorite', type: 'book'`), not
Lampa's all-favourites overview. The button stops its clicks from reaching the card, which would open
the title. The title page's bookmark button saves with one click too: Lampa's menu of Bookmarks / Like /
Later / statuses is skipped. The thumbs are the ratings, so Lampa's own "Like" list was a duplicate.

No + on posters on touch devices (phones, iPads). A tap sends iOS Safari a `mouseover` first. When a
visible element appears during it (the +), Safari treats the tap as a hover and waits for a second tap
before the click. Titles took two taps to open (reported 2026-10-20). `glass.js` and `title.js` skip
mouseover on touch devices for the same reason. This rests on WebKit's documented behaviour; it wasn't
checked on a device that day because the simulator wouldn't take input.

## Play

Anything that would open a title's torrent list runs `play.js` instead: the title page's Play (the Trailers
source is removed, so Play no longer offers a choice of sources), the billboard's Play, and a click on an
episode.

1. **Search** the way Lampa's Torrents button does (`parse_lang`), through Lampa's parsers.
2. **Keep** (`pick.js`) releases that:
   - name a resolution (4K, 1080p, 720p) and have enough seeders (15 / 5 / 3);
   - aren't CAM/TS/screener/3D;
   - are English: no other language in the name, unless it's a MULTi/dual-audio release that says ENG;
     Cyrillic titles never pass;
   - are this title: the release name **starts** with the title (after tags like `[LAMPA]`), followed by a
     year, season, resolution or edition word, not by more words. "Avatar" doesn't match "Avatar Aang The
     Last Airbender", and "Avatar The Last Airbender" doesn't match "Avatar The Legend of Aang". A film:
     the year within one, no series packs. A series: a year in the name must be within its years on air,
     which tells the 2005 animated "Avatar: The Last Airbender" from the 2024 live-action one;
   - hold the episode wanted: a pack whose season range covers it, or that exact episode.
3. **Rank** each resolution's releases, picture quality first:
   - **Source:** Blu-ray > WEB-DL > WEBRip > HDTV.
   - **Bitrate adjusted for the codec:** x265/HEVC ×1.5, AV1 ×2 against H.264. It rewards a fuller
     picture up to 70 % of the resolution's band; 10-bit or HDR get a little more.
   - **Runtime:** the bitrate comes from size and runtime (TMDB's episode runtime, else the last aired
     episode's; the episode count of the seasons a pack covers).
   - **Seeders:** count half as much as quality. They still have to pass the minimum and the speed check.
   - **Penalties:** a real bitrate above the band (too heavy to stream), Dolby Vision without HDR10, AV1.
   - **Season packs:** a small bonus.
   - **Edgerunners S1:** the 1080p Blu-ray x265 (16 GB, 197 seeders) now beats the Netflix WEB H.264
     (8 GB, 273 seeders).

   Each line says what it is: "Blu-ray · HEVC 10-bit · 16 GB · 197 seeders".

   **Anime** (original language Japanese + Animation): one more line, "Audio: English dub" / "Audio:
   Japanese · English subtitles". It switches and redraws the choices, and is remembered per profile
   (`ruby_anime_audio`).
   - **English:** DUBBED and dual-audio releases rank higher; untagged anime releases are usually Japanese.
   - **Japanese:** JAPANESE releases pass the language filter. The stream asks the remux service for the
     Japanese track with English subtitles on (`&lang=ja`, added in `Lampa.Torserver.stream`).
4. **Pick** without asking (simplicity review 2026-10-20: friends shouldn't have to know what HEVC, seeders
   or 27 GB mean; until then a "Play in" popup offered every resolution with its release's details):
   - **Screen:** 4K only where the screen has 2560+ physical pixels across (`screen.width × devicePixelRatio`),
     else 1080p at most. 4K on a 1080p screen looks barely better and costs 2-3× the bandwidth (Inception:
     27 GB ≈ 24 Mbit/s against 12 GB ≈ 11 Mbit/s), fewer seeders (50 against 105) and HEVC decoding.
   - **Connection:** no release whose bitrate × 1.3 is more than this connection carries; when even the lowest
     is, the lowest. The speed is timed once per session, while the search runs, by downloading 4 MB of random
     bytes from the remux service (`/gst/speedtest`).
   - **Anime:** the audio remembered per profile; when that audio has nothing, the other one rather than nothing.
   - **Nothing found** (or the search failed): "Can't play this right now" in the middle of the screen, with
     Add to My List. Before, Lampa's raw torrent list opened (Link Click's showed The Simpsons and South Park
     torrents). That list stays reachable with "Pick torrents for me" off.
   - **Quality while watching:** the player's Quality button (`player.js`) lists the resolutions found and, for
     anime, the audio; a choice closes the player and plays that release, where it was: Lampa keeps a film's
     place under its original title and an episode's under its numbers (`Torserver.parse` `hash_string`), not
     per release, and goes back to it on its own (`player_timecode` "Proceed").
   Checked 2026-10-20 in the dev server with stubbed search results (ruby unreachable that day): Retina
   (3456 px), 50 Mbit/s → 4K; a 1920 px screen → 1080p; 10 Mbit/s → 720p; only other titles' releases → the
   message; Quality → 1080p closed the player and started the 1080p release. Not checked: that it resumes at
   the same place (the stand-in video never played).
   The release starts at once, so nothing is left to warm up while a question is open (`warm.js`, which
   started the preselected release while "Play in" showed, measured 0.3-4.3 s to the master that day, was
   removed with the question).
5. **Open** the release with Lampa's own flow (`Lampa.Torrent.start`) and, when Lampa's file list comes up
   (`torrent_file` events), start the right file: the episode by season/episode, or a film's largest video
   file. The list is hidden meanwhile. Resume, the episode playlist and "next episode" stay Lampa's.

A series' Play continues where you are (`resume.js`, "Where you are in a series" below).

Episode cards are built without a reference to their data, so a click reads the card: the episode number
and name. The episode is looked up by name in TMDB's own seasons, starting with the season the page shows
(the all-episodes page's season, else the latest aired). It doesn't use `Lampa.Api.seasons`: when asked
for season 1, that splits a show at any gap of more than 90 days between air dates into made-up seasons and
renumbers the episodes (`splitEpisodesIntoSeasons`). Torrent files, and the progress Lampa saves for them,
use the real numbers. The click is caught in
the capture phase, before the card's own handler, which upstream only toggled "watched". Episodes not
aired yet keep upstream behaviour.

**While it loads** (`facts.js`): from Play until the picture moves, the whole screen goes black: the
title's backdrop dimmed, its logo (its name until the logo loads), a large red spinner, the step in plain
words and Cancel. Until 2026-10-20 this was a small card at the top while the trailer played on behind it
(in the simplicity review Play looked like it did nothing; trailers now stop while it shows, `trailer.js`). It used to show a film trivia fact every 12 s
("Did you know?", from `facts-data.js`); the user turned the trivia off for the whole app on 2026-10-20, and
the facts file is gone (in git history before that date).

The screen is the only loading indicator: the step ("Getting it ready…", "Connecting…", "Starting…") and
Cancel, which does what Back does. Lampa's own
loading layer and its empty "loading torrent" window (`Torrent.loading()`, a large modal with a spinner)
are hidden while the card shows; error windows aren't. Before, the window sat behind the card with its
spinner showing through the card ("this loading screen is ugly", 2026-10-18). Checked in the built-in browser:
both loaders hidden under the card, Cancel closing each through its own Back handler.

**How far it is** (`progress.js`, asked for 2026-10-20): a percentage under a red bar, real numbers only
(peers and MB/s were shown too until the simplicity review the same day). The bar never goes back within one start. The numbers depend on the step:
- **Connecting:** the bar waits at 0. The torrent's hash comes from wrapping `Lampa.Torserver.hash`.
- **Starting through the remux:** the percentage of the file's opening bytes TorrServer holds. It comes from the remux heartbeat's `Startup` (server/remux/README.md "Loading progress").
  The file is the `index` in the player's URL: Lampa also asks for the torrent's other files' masters.
- **Before any byte arrives:** the bar at 0. This wait is most of a start on the home
  server (server/remux/README.md "Why starting takes longer than a seek").
- **TorrServer without the remux:** Lampa's own preload percentage (`Lampa.Loading.setProgress`). Its
  loading screen showed it before the card hid that screen.

Checked 2026-10-20 in the built-in browser with Big Buck Bunny from cold; numbers in server/remux/README.md.

**Stuck paused under the facts** (reported 2026-10-17, after Continue on an episode: the facts stayed
until the player's play button was clicked). `play.js` `untilPlaying`: a video paused for 1.5 s before it
ever played, with no key or click just before the pause, gets one more `play()`; if it's still paused,
the facts go so the player's play button shows. Not reproduced in Chromium: plain HLS and torrent → remux,
both resuming at a saved time, played on (2026-10-17, built-in browser). Checked by refusing `play()`
(`HTMLMediaElement.prototype.play` rejecting with NotAllowedError): refused once, the retry played it;
refused twice, the facts went. The video's play/pause/seek/stall events are logged as `Ruby play` to find
the real cause the next time it happens (Safari wasn't checked: safaridriver couldn't attach that day).
Still reported 2026-10-18. Likely cause: Continue's jump to the saved time paused the video and relied on a
later `play()`; Player → Seeking now jumps without pausing.

Settings → Interface → "Pick torrents for me" turns all of this off.

## Download

For watching offline, mostly on iPhones (the user's call, 2026-10-20). Title pages get a **Download** button
after Play, on computers and phones where the remux service is on (`torrserver_gts`), not on TVs. The
server makes the file (`server/remux/README.md`, "Downloads"): one MP4 with the video as is, AAC audio and
English/Bulgarian/Russian subtitles inside. On an iPhone, Safari saves it to Files → Downloads, and it plays
there or in the TV app without Lampa or a connection.

1. **Download** runs Play's own flow in download mode (`rubyPlay.download`, `play.js`):
   - the same search and ranking, and no question: the best 1080p release, else 720p, else what there is.
     1080p fits a phone (a film is about 2–8 GB; 4K files are 10–20 GB). The user's call, 2026-10-20;
   - nothing found: a message, never Lampa's torrent list (it plays what's picked in it);
   - Lampa's torrent flow then opens the release. When its file list comes, the file (the film, or the
     episode) goes to the server as a job, and the list is closed with its own Back.
2. **The button** shows where the job is: "Preparing 34%", "Adding subtitles", "Waiting for another
   download to finish", then "Ready to save". It asks the server every 5 s while a job is running, also
   after leaving the page and coming back.
3. **On a film,** the button then offers "Save to this device" (size and the subtitle languages inside) and
   "Delete from the server". Save is a link with `download`: the browser's own download.
4. **On a series,** it lists the episodes downloaded or being made, plus "Download S1 E4": the episode after
   the last one downloaded, by TMDB's season sizes. With none yet, it's the episode where you are
   (`resume.js`).

Files stay on the server for 3 days and are shared: a film someone else downloaded is ready at once. The
name on the device is "Title (Year).mp4" or "Show S01E03.mp4".

Checked 2026-10-20 in the built-in browser, through `tools/dev-server.js` with a local remux and a stand-in
TorrServer (the tailnet to ruby was down; Lampa's search was stubbed with one public-domain release, so
Jackett's key stays out of test browsers):
- **The flow:** Download → Lampa's torrent flow → the file sent to the server → Lampa's window closed.
  Offered a 4K and a 1080p release, it took the 1080p one without asking. After it, focus is back on
  the title page, with no loading card and no hidden-list class left.
- **The button:** "Preparing 0%" → "Ready to save".
- **The menu:** "Save to this device · 18 MB · subtitles: English, Bulgarian". Save makes a link to
  `/ts/gst/download/<id>/Big%20Buck%20Bunny%20(2008).mp4`, which answers 200 `video/mp4`, as an attachment.
  Delete set the button back to "Download".
- **Phone width** (375 px): the button sits in the button row with its label.

Also fixed on the way: after Lampa's "Failed to connect to TorrServer" window, Play's loading card stayed
up until Cancel. That window closes without `list_close`, so `pending` was never cleared. The card now
goes once no Lampa window has been open for 2 s.

## Where you are in a series

`resume.js` (`rubyResume.where`) works out where the current profile is in a show. There's no store of its
own: it reads the progress Lampa already saves per episode (`Lampa.Timeline.view(hash)`, `file_view`, kept
per profile by `profiles.js`). The hash is Lampa's own `Utils.hash(season + episode + original name)`.

- **Episodes:** every aired one, from the show's TMDB details (each season's `episode_count`, up to
  `last_episode_to_air`; specials left out). No per-season requests. A card from a list (the billboard) has
  no seasons, so the details are fetched once per session.
- **Last watched:** the episode with the newest saved progress (Lampa stamps each save with `updated`). Older
  saves have no stamp; for those, the latest episode in the show with progress counts.
- **What plays:**
  - under 90 %: that episode, "Continue S2 E5"; Lampa's player resumes it too, and only below 90 %;
  - 90 % or more: the next aired one, "Play S2 E6";
  - the last aired one finished: "Play S1 E1";
  - no progress: S1 E1.
- **Trakt:** with no progress here and Trakt connected, `/shows/:id/progress/watched` stands in: its
  `next_episode`, and its `last_episode` for the line. Asked at most once a minute per show.

The title page shows it (films too, from their saved place):
- **Play button:** "Resume" or "Play", as on Netflix (until 2026-10-20: "Continue S2 E5", "Play S2 E6", and
  "Watch" on films). The label stays when another button has the focus
  (Lampa shows a title-page button's label only while it's focused; `title.js`).
- **Line under the ratings:** "S2 E5 · 26 min left" and a progress bar, "Next: S1 E4" (was "Last watched
  S1 E3"; the user wanted the next one shown), or "Watched all 62 episodes". Films: "1 h 44 min left". Time left is the saved duration minus the saved time, else TMDB's runtime.
- **Trakt plugin's watched status ("Unwatched"):** the line goes inside it, and the plugin's own text is
  hidden, so the two can't disagree. A click still opens the plugin's Trakt menu. A mutation observer puts
  the line back each time the plugin rebuilds its status. With nothing watched, the plugin's text stays.
- **Updates:** live, on Lampa's `state:changed` timeline events (progress saved while playing, the player
  closing, a sync).

Play (`play.js`) asks `rubyResume.where` too, so the button starts the episode it names. With "Pick torrents
for me" off, Play opens Lampa's own list, so the button keeps its label.

Checked 2026-10-15 in the dev server (progress set with `Lampa.Timeline.update`):
- Desperate Housewives, S2 E4 100 % then S2 E5 40 % of 43 min: "Continue S2 E5", "S2 E5 · 26 min left".
- Breaking Bad, S1 E3 at 95 %: "Play S1 E4", "Last watched S1 E3". Play's picker got `{season: 1,
  episode: 4}`. S1 E4 saved at 12 % with the page open turned it into "Continue S1 E4" / "43 min left".
- Breaking Bad, S5 E16 finished: "Play S1 E1", "Watched all 62 episodes".
- Game of Thrones, nothing watched: "Play S1 E1", no line. Films keep "Watch".
- 2026-10-20, same way: Breaking Bad S1 E3 at 95 % → "Play" / "Next: S1 E4"; S1 E4 at 40 % → "Resume" /
  "S1 E4 · 28 min left". Inception at 30 % → "Resume" / "1 h 44 min left".
- The Trakt status line, rebuilt twice the way the plugin does it: the line stayed inside it, never doubled.

## Changes to Lampa itself (`app.min.js`)

Seven small edits, each marked `Lampa Desktop:`; re-apply them when updating from upstream:
- **`Episodes()`:** doesn't reverse the title page's episode row, so it reads oldest first with the next
  episode to air last. Upstream shows the newest first.
- **Search, `Results.cancel`:** clears the remembered query. Upstream, a search cancelled by the next
  keystroke dropped its results, but the same text was then never searched again. Typing "akame",
  deleting a letter and retyping it left the results empty.
- **Search, `Results.search`:** results 350 ms after you stop typing (upstream: 2.5 s, which looked as if
  Enter were needed).
- **Search, TMDB `search$5` + `fuzzySearch`:** TMDB matches whole words exactly, so "edge runners" found
  nothing ("Cyberpunk: Edgerunners") and typos found nothing. With fewer than 3 results, it also searches
  the words joined and the two longest words alone. It keeps results whose title is close to the query
  (letter-pair similarity of at least 0.5, or containing it), exact matches first. Verified: "edge
  runners" → Cyberpunk: Edgerunners, "brekaing bad" → Breaking Bad.
- **HLS, `createParser`:** where the browser plays HLS itself (Safari), Lampa first reads the master
  playlist with hls.js and, when it lists no separate audio tracks, gives the browser the video playlist
  instead of the master. That playlist has no subtitles, so Safari never reported any and the Subtitles
  button never appeared (the remux service's streams have audio inside the video playlist). It now keeps
  the master when it lists subtitle tracks.

- **Torrent, `files()`:** asks TorrServer for a new torrent's file list at once, then every 2 s (90 s in all,
  as before). Upstream's first ask came 2 s after the torrent was added, also when TorrServer already had
  it: every start lost up to 2 s there. Not faster than every 2 s: each ask aborts the one before
  (`Torserver.files` clears the shared request object) and times out after 2 s.
- **Torrent, `gstCheck()`:** the remux check (`/gst/echo`) goes on its own request object. On the shared one
  the file list, now asked for at once, could abort it, and an aborted check sets `gstWork()` false: the
  player would get TorrServer's plain stream instead of the remux.

## Player

**Playable on every device, or a clear error (`compat.js`).** Asked for on 2026-10-20 after *Gladiator*
(2000, HDR10 x265) loaded forever on a friend's iPhone (iOS 18.7). The remux copies the video as it is, so
whether it plays is up to the device's decoder. `rubyCompat.decodes(codecs)` asks the decoder the player will
use: hls.js's (`MediaSource.isTypeSupported`) where Lampa uses hls.js (Chrome 121+, Android, no native HLS,
or Settings → Player → HLS "hls.js"), else the browser's own (`canPlayType`), as `HlsStream.shouldUseProgram`
decides.
- **Picking:** `rubyPick.ranked` leaves out releases whose name says a codec this device can't decode (HEVC,
  HEVC 10-bit/HDR/DV, AV1), and XviD/DivX/VC-1/MPEG-2 everywhere. Untagged names count as H.264.
- **Starting:** `Lampa.PlayerVideo.url` is wrapped. A remux master is read before the player gets it:
  - the remux refused the file (500): Lampa's error screen with the remux's reason ("video codec not
    playable in a browser: mpeg4");
  - its `CODECS` video can't be decoded here: "This release is HEVC 10-bit video, which this browser can't
    play. Pick an H.264 (x264) release.";
  - no answer in 75 s: the reason from the heartbeat (0 peers, barely downloading, still reading);
  - HDR (`VIDEO-RANGE` PQ/HLG) where `(video-dynamic-range: high)` is false: the video playlist alone, and
    the master's subtitle tracks handed to Lampa as whole WebVTT files (`Lampa.Player.subtitles`, the remux's
    `<track>.vtt`), loaded again every 30 s while selected (the remux learns a file's own lines as ffmpeg
    reads ahead). Safari can't play an HDR10 stream behind the master there: marked SDR it fails at once
    ("Media failed to decode"), marked PQ it drops the only variant and loads nothing; the video playlist
    alone plays. Measured 2026-10-19/20 in macOS Safari 27 (XDR display) and the iOS 27 simulator, both
    with that query false. Where it's true the master stays (no such browser here to test).
  - This has to happen before Lampa's own reading of the master (`createParser`): that uses hls.js, which
    can't run on an iPhone (no MediaSource), so there Lampa handed Safari the master and it loaded forever
    (iOS 27 simulator, 2026-10-20). A first version hooked `createParser` and passed on macOS only.
- **Waiting:** while the player is open, a video that hasn't started 20 s after the remux holds its first
  segment (heartbeat `Startup.pct` 100), or after 120 s at all, or that stops for 90 s while not paused, ends
  in Lampa's error screen with the reason: the device didn't play it (and the codec), 0 peers, barely
  downloading, or this device's connection. `swarm.js` switches releases sooner when the torrent is the
  cause (60 s / 30 s), so this is what's left when it can't.
- **A decode error** from the video itself is reworded with the codec: "This browser couldn't play this
  release's HEVC 10-bit video. Pick an H.264 (x264) release."
- **Verified 2026-10-20:** iOS 27 simulator, a synthetic 2-minute HDR10 x265 MKV with English subtitles
  through the remux and the whole app: the video playlist played, English on by itself and on time (before:
  readyState 0 forever). macOS Safari 27: the same. Chromium made to answer like a phone without HEVC: the
  HEVC error at once. An MPEG-4 Part 2 file: the remux's reason. Not verified: a real iPhone or Android phone,
  the 30 s subtitle reload.

- **Subtitles.** Lampa shows its subtitles button only once the stream reports subtitle tracks, as a small
  speech-bubble icon. It's now a CC icon labelled "Subtitles". In Safari it only appears since the
  `createParser` change above.
- **Better subtitles.** When a file's English subtitles are TV captions (ALL CAPS) or missing, the remux
  service swaps in ones from OpenSubtitles, lined up with the file (server/remux/README.md, "Subtitles from
  OpenSubtitles"). `play.js` adds the title's TMDB id to the stream URL for it.
- **Subtitles on by default, in the profile's language.** `player.js` sets Lampa's defaults for Settings →
  Player → Subtitles (`subtitles_start` on, `subtitles_lang` `en`), so a profile that changes them there keeps
  its choice. English, Bulgarian and Russian (what the remux service offers) are at the top of that list, and
  the track in the chosen language comes on, else English, else the first. hls.js tracks reach Lampa with
  only a name, so the language is read from it ("Bulgarian"); Safari's have the language code.
  Lampa itself only switches on tracks the browser reports (Safari); with hls.js (Chrome) it lists them and
  leaves them off, so `player.js` picks the English one (or the first) when the list arrives. Tracks Safari
  adds after `loadeddata` (when Lampa looks) are passed on too.
- **Seeking.** Left/Right seek even while the control bar is up (Lampa only seeks with them while the bar
  is hidden, and with a mouse it's up whenever the pointer moves; it moves between buttons instead). Not
  in menus opened from the player. Media keys (`navigator.mediaSession` seek and previous/next track) seek
  too. Back/forward buttons beside play/pause show the step. All use `player.js`'s own seek, not Lampa's:
  - **Exactly the step** per press (Settings → Player → Rewind, now 10 s by default). Presses within 350 ms
    add up to one seek, so the remux restarts ffmpeg once. A badge on that side shows the total ("−30 s").
  - **No pause.** Lampa's rewind paused the video on every press, grew the step 3 % a press, and a second
    after the last one seeked and called `play()`; when that `play()` didn't take, the video stayed paused
    ("it pauses when I rewind sometimes", Safari, 2026-10-18). Now only `currentTime` changes.
  - **`Lampa.PlayerVideo.to`** (Continue's jump to the saved time, a click on the timeline, the skip button)
    did the same pause/seek/play. While the video plays it now only seeks. With Safari's native HLS,
    Continue starts at 0 and jumps on the first `timeupdate`, through `to`; hls.js (Chrome) starts at the
    saved time itself, which is why Continue never hung in Chromium.
  - Checked 2026-10-18 in the built-in browser (Chromium, local remux of a synthetic 15-min H.264 MKV):
    3 × Left from 5:19 → 4:50 then Right → +10 s, never paused; `to(600)` with
    `HTMLMediaElement.prototype.play` rejecting → 10:04 and still playing (Lampa's `to` stays paused there).
    Not yet checked in Safari (the user was watching in Safari on the same Mac).
- **Verified 2026-10-17** with a local HLS stream shaped like the remux service's (one variant with audio
  inside, an English WebVTT rendition, `DEFAULT=NO`), in the dev copy:
  - Safari 27: plain `<video>` with the master adds the track "English 1" (`en`) 1.9 s in, just before
    `loadeddata`, where Lampa looks. In Lampa, the browser got the master, the track was `showing` with a
    cue on screen and the Subtitles button visible. Before, Lampa gave it the video playlist (by the code;
    no subtitle tracks there).
  - Chrome 152 (hls.js): subtitles on in English without touching anything; Left with the bar up went
    37.6 → 17.9 s; the forward/back buttons 17.7 → 39.2 → 19.6 s, one seek per click.
- **Next episode countdown** (`nextup.js`), as on Netflix: in an episode's last 10 s a card in the corner says
  "Next episode in 7" with the next item's title, its white fill growing as the seconds run out; the next
  episode starts when this one ends (Lampa's own Settings → Player → "Next episode"). The button starts it
  now; the cross hides the card for this episode (seeking back brings it again). No card on the last
  episode or with "Next episode" off. The user asked for it "when the episode ends" (2026-10-18), not at
  the credits: credits times exist only for some shows (TheIntroDB). Checked 2026-10-18 in the built-in
  browser with a two-item playlist: card at 0:10 left, counted down, item 2 started at the end.
- **F** toggles fullscreen, as in other web players; **C** turns subtitles off and on (on: the profile's language as
  above), the way Lampa's own menu switches them, with a note "Subtitles off/on". Checked 2026-10-18
  in the built-in browser: the subtitle layer went away and came back with the downloaded text.
- **AirPlay.** In Safari, when an AirPlay screen is around (`webkitplaybacktargetavailabilitychanged`), a
  button next to picture-in-picture opens the picker. The Apple TV fetches the HLS stream itself, so it
  needs a URL that works without the browser: on the home server the stream path has no password.
  On phones Lampa hides that button row and lists its buttons in the panel's "⋯" menu, which presses them
  with jQuery's `trigger('hover:enter')`: that reaches only jQuery handlers, so ours are bound with jQuery.
  Before that (until 2026-10-19), picking AirPlay there only closed the menu: a friend's iPhone played
  fine, but no AirPlay receiver ever requested the stream (`access-public.log`), and a diagnostic beacon on
  the button never fired. Checked 2026-10-19 in the built-in browser at 375×812: the menu entry now calls
  the picker, and its icon is 2.7em like Lampa's (icons.js's `1em!important` had made it 11 px).
- **4K on the TV** (the user's call 2026-10-20). Play picks for the phone's screen (1080p at most), but an
  Apple TV fetches the stream itself and may be on a 4K TV. When AirPlay starts
  (`webkitcurrentplaybacktargetiswirelesschanged`) with a 4K copy found and something smaller playing, a "Play
  in 4K on your TV" button shows for 30 s. It isn't automatic: switching plays another release in a new video
  element (Lampa makes one per stream, app.min.js `videobox`), which ends the AirPlay session, so the user taps
  AirPlay once more. The device then remembers it (`localStorage` `ruby_tv_4k`, not per profile) and Play
  picks 4K on it whenever an AirPlay screen is around (`play.js`, a detached video element listening for
  `webkitplaybacktargetavailabilitychanged`). Checked 2026-10-20 in Chromium with the Safari events faked: the
  button shows over the player. Not checked with a real Apple TV, nor whether a detached video element gets
  the availability events.

## Watched

`watched.js`: a title joins Lampa's watch history (`Favorite` `history`) only after 10 minutes of real
watching, or half of anything under 20 minutes. Lampa adds it the moment a file is clicked, before
anything plays (`Favorite.add('history', movie, 100)` in its torrent list), and that history feeds Lampa's
"Recommended" row (TMDB recommendations of every history title) and Picked for you. On 2026-10-19, 13
seconds of a Spider-Man film opened on the wrong profile made a whole profile's recommendations Marvel.
Now the add waits: seconds count while the video advances by under 3 s per `timeupdate` (seeks don't
count), and closing the player before the mark leaves the title out. A title already in the history
moves to the front as before. On Android's own player (outside the page) nothing changes. Checked
2026-10-20 in tools/dev-server.js with simulated playback: 13 s left out, a seek to 50 min then 10 min
of playing added at 600 s, a 3-minute clip added at 90 s.

## Picked for you

Built once per page load, per profile (`personal.js`, `picks()`). The billboard draws 6 of the top 18 at random on each visit,
higher picks more likely, so it isn't the same title every time. Besides thumbs, what the profile watched
counts: the 6 most recent titles in Lampa's history (`Favorite` `history`, after 10 minutes of watching: "Watched")
that aren't rated each count as half a thumbs up, and anything watched is left out of the picks.

1. Seeds: the 10 most recent thumbs up, with a "love" counting as 60 days more recent. Ratings already on
   the profile's Trakt account count too: 9–10 is a love, 6–8 a thumbs up, 1–5 a thumbs down.
2. For each seed, Trakt's related titles (`/search/tmdb/{id}` for the Trakt id, then
   `/{movies|shows}/{id}/related`). These need only the app's Client ID, no login. They are far better than
   TMDB's `/recommendations`: for Inception, Trakt gives Minority Report, Looper, Dark City and The Matrix,
   while TMDB gives Paycheck, The Dark Tower and Push.
3. Score by position in each list, ×2 for a love. The 4 most recent thumbs down subtract (×0.8).
   Trakt's own `/recommendations` (when connected) count like a seed, ×1.3.
4. Genre taste from the profile's thumbs nudges each score by ±6 % per point, capped at ±30 %.
5. Anything already rated is left out. The top 30 get TMDB details (cached for the session).

## Trailers

- **Choice.** YouTube via TMDB `/videos`, in English, the title's own language, or no language. Ranked
  official Trailer > Trailer > official Teaser > Teaser, with English preferred.
- **When it shows.** YouTube draws its own pause button over the first seconds of every embed, even with
  `controls=0`, after any pause, and also when a player that was loaded paused starts playing. It then
  hides it (measured: there at 2.8 s, fading at 3.9 s; 3.6 s still showed it faintly). So the trailer
  fades in after 4 s of playback, and the backdrop shows until then.
- **Warm-up.** To hide that wait on title pages, hovering a poster for 0.45 s starts its trailer in the
  title hero, hidden and at volume 0 (`attach` option `quiet`). If you open the title, the trailer is
  already past the button and shows at once (measured: visible 0 ms after opening). If you don't, it's
  dropped 1.2 s after the pointer leaves. Lampa cards carry their title as `card_data`; the billboard's
  *More info* and the *More like this* posters set `_rubyItem` on an element marked `data-ruby-item`.
- **Preconnect.** The YouTube hosts are preconnected at startup.
- **Sound.** Off by default. The speaker button (or Settings → Interface → Trailer sound) turns it on, and
  the choice is remembered. Everyone started muted once when this became the default
  (`ruby_sound_default_off`).
- **Unmuting.** It's tried only after the page has had a user gesture (`navigator.userActivation`),
  while the picture is still hidden. If the browser refuses, YouTube pauses right after the unmute; the
  player then goes back to muted, plays on, and doesn't try again until the next click or keypress.
- **Subtitles.** English subtitles (`cc_load_policy=1&cc_lang_pref=en`) when the chosen trailer isn't in
  English.
- **Quality.** Picked by YouTube from the player's size, which is the whole screen. Forcing
  `highres`/`vq` made it re-buffer with a spinner, so it isn't forced.
- **Referrer.** Lampa's `index.html` sets `<meta name="referrer" content="never">`, and YouTube refuses
  embeds that send no referrer (error 153). Only the iframe gets `strict-origin-when-cross-origin`.

## Performance

What made scrolling laggy in Safari, and what replaced it:

- **Colour orbs.** The orbs were full-screen, always drifting, `filter: blur()` and
  `mix-blend-mode: screen`. Every frame the browser re-blurred and re-blended them, and re-rendered every
  `backdrop-filter` element above them. The orbs are now plain radial gradients, which are soft enough
  without the blur.
- **Glass blur.** `backdrop-filter` is kept only on a few large surfaces: title-page buttons, menus,
  settings. Things that come by the dozen get a tinted fill instead: the rating badge on every poster,
  chips, torrent rows. The top bar is nearly opaque once scrolled, so it has no blur either.
- **Title hero.** It follows the page scroll by copying Lampa's own transform and CSS transition, so
  there's no `requestAnimationFrame` loop reading styles every frame.

## Loading screens

`loading.js` replaces Lampa's look while things load, on **every platform** (unlike the rest of this folder:
it's the brand, the user's call 2026-10-19). It runs first, before the other modules.

- **Startup intro**, in place of Lampa's splash picture (`.welcome`, `img/welcome.jpg`, which stays and
  fades out under it). Black at once; at `DOMContentLoaded` (after the host's `lampa-init.js` has set
  `window.lampa_brand`) the wordmark's letters drop in one after another, red with a dark fold that
  brightens as they land (1.5 s). If the app isn't shown yet, a light sweep runs over the letters. When Lampa
  shows the app (`window.show_app`, set in `app.min.js` `showApp()` as it fades its splash) the view flies
  into the letters and they burst into ribbons of light (46, crowded in the middle) while the black lifts:
  1.6 s, the app usable from the start of it (the overlay stops taking clicks). It also ends on Lampa's
  first-run language picker (`.lang`) and after 15 s whatever happens. Reduced motion: no drop, a plain fade.
  Where text can't be clipped to a gradient (`@supports`), the letters are plain red.
- **Timing** (2026-10-19, `tools/dev-server.js` in the built-in browser, ruby over a relayed tailnet,
  `performance.timing`): `DOMContentLoaded` 0.6 s (most of it the proxied `lampa-init.js`, 0.33 s), app
  ready 2.2 s, shown 3.2 s (Lampa's own 1 s wait), intro gone ~4.8 s. Lampa's splash would have finished
  fading at ~3.7 s, so the intro costs about a second at startup when loading takes longer than the intro.
- **One spinner:** a red arc on a faint red track (Netflix's), as a data-URI SVG with Lampa's 94 px size,
  over the 14 rules in `css/app.css` that draw `img/loader.svg` (page loads, player buffering, dialogs,
  episode stills, the Watch button, extensions…; the list is `LOADERS`). Buffering drops Lampa's frosted
  grey disc: the ring alone over the picture. `facts.js`'s small spinner is the same red.
- **Not verified in Safari** yet: safaridriver needs Safari → Settings → Developer → "Allow remote
  automation", which was off on 2026-10-19.

## Loading

Page load measured on 2026-10-13 (headless Chrome, warm cache, ruby LAN):
- **Before:** first posters at 4.6 s.
- **After:** first posters at 2.7 s.
- **Trailer start:** the billboard trailer starts only once the page has *settled*: first rows drawn,
  then 1.5 s, then an idle moment (`rubyDesktop.settled`). The YouTube player is 1.8 MB of script with
  ~80 ms of start-up work, and in Safari it runs on the page's own thread.
- **Profile sync:** a normal load makes no blocking request; only a profile switch does.
- **Plugins:** when you host plugins yourself, load them as ordinary cached scripts once `Lampa.Listener`
  exists instead of through Lampa's plugin list. Lampa adds a random `?reset=` to plugin URLs (never
  cached), fetches each a second time to keep a copy in IndexedDB, and starts them only after a chain of
  requests to cub.best.

**Not rendering what isn't on screen** (`desktop.js`); the elements stay in place, because Lampa's
navigation and scroll state rely on them:
- **Pages you've left:** Lampa only fades them to `opacity: 0`, so Home (~700 elements) was still styled,
  laid out and painted under every title page. They get `content-visibility: hidden`.
- **Rows:** `content-visibility: auto` with a remembered height. Not cards: paint containment would clip
  their hover lift.
- **Side effect:** Home now takes a moment to come back, and Lampa re-centres the last poster later than
  before, so `hero.js` keeps correcting for the whole 2.5 s back-navigation window.

**Measured in real Safari** (2026-10-13, driven with safaridriver; scripted trackpad-like scrolling;
every frame interval and every main-thread freeze recorded). Results:
- **Freezes were per row:** each new row froze Safari for 60–90 ms. Plain upstream Lampa freezes the
  same way.
- **Biggest single cost:** Lampa's lazy loader `Layer.visible`, which reads the position of every poster
  on the page each time a row is added: 1.3 s per 16 s of scrolling. `desktop.js` replaces it on computers
  with an IntersectionObserver that fires the same `visible` event about 2 screens ahead. Total JavaScript
  time while scrolling went from ~2.3 s to ~0.25 s.
- **Rows are built as wide as the screen plus two cards;** the rest are built on the first sideways
  scroll of that row.
- **Decoded images were the slow build-up:** after a few minutes, ~550 MB of decoded posters, with
  freezes growing to 150+ ms. Posters more than ~5 screens away now swap their image for an empty
  placeholder and get it back from the cache when you return: 15–50 MB. Posters load at w342 (a card is
  ~300 device pixels wide).
- **What didn't matter:** the frosted glass, poster shadows and the fade-in animations (each tested
  switched off).
- **The automation session itself slowed down over many runs,** so before/after comparisons were made in
  a fresh session.

## Under the top bar

The pages scroll under the top bar, as on Netflix:

- **Scroller.** Lampa's page scroller clips at the bar's bottom edge and fades its top and bottom 8 % with
  a mask. On desktop it does neither.
- **Billboard.** It is pulled up to the window top. The distance depends on the interface size and Lampa
  is still laying the page out when the billboard goes in (124 px measured then, 17 px once settled), so
  `hero.js` measures it again at 0.4 s and 1.5 s and on resize.

## Touch devices and phones

Lampa marks phones and tablets with `body.touch-device` / `body.true--mobile` (iPads too: a touch screen
without "Windows NT"). Two things differ there, and `rubyDesktop.touch()` tells the modules:
- **Scrolling is native.** Lampa scrolls pages with `scrollTop` instead of a transform. The desktop rule
  that lets pages run under the top bar (`overflow: visible` on the page scroller) therefore made every page
  unscrollable on phones and iPads; it now applies off touch devices only. `rubyDesktop.pageY()` reads
  `scrollTop` there, and the title hero follows the scroller's `scroll` events instead of copying the
  transform (`title.js`).
- **No hover.** The profile menu opens and closes on tap (a tap elsewhere closes it), and the thumbs show
  all three choices inside the button, without the hover labels.

Sizes: Desktop look shrinks Lampa's base font to `100vw / 84.17 × density` with an 8 px floor. A 375 px
phone hit the floor, so card titles were 7.6 px and Lampa's own player, settings and keyboard were cramped.
Touch devices keep Lampa's own floor, 10.6 px (`size()` in `app.min.js`). At most 600 px wide (phones):
- **Posters:** 10 em wide in rows, three across on grid pages (~3⅓ visible per row at 375 px; 12.75 em fit
  2.7).
- **Top bar:** the links scroll sideways, faded at the right edge. Lampa's page counter ("4 / 500") is
  hidden.
- **Billboard:** details span the width at the bottom, the three buttons share one line, the dots sit
  under them, the speaker is at the top right.
- **Title page:** Lampa's own phone layout (≤ 480 px) pulls the details into a rounded sheet with negative
  margins, which cut them off at the left edge under the hero; that is undone. The hero fades from the
  bottom, and Watch gets a whole line as a white labelled button.

Checked on 2026-10-15 in the built-in browser at 375×812 (mobile emulation, Android Chrome UA) and again at
1440×900 to confirm the desktop look is unchanged. In emulation Lampa ignores clicks until a `touchstart`
has been seen (`DeviceInput.canClick`), which a real phone always sends first; tests dispatch one. Not yet
checked on a real iPhone or in iPad Safari.

## Things Lampa does that these modules work around

- **Trakt plugin card badges.** The Trakt plugin marks cards in your watchlist (bookmark), watched (tick) or
  in progress (half-filled) with a purple circle centred on the poster's bottom edge, half outside it. The
  desktop look rounds `.card__view` with `overflow:hidden`, which cut those into half-circles; desktop.js
  draws them as a dark chip in the poster's bottom-left corner instead, opposite the rating.

- **Interface size.** Lampa sizes everything from one number: `body` font-size = window width / 84.17 ×
  0.9, 1 or 1.05. Density is a stylesheet override of that number.
- **Wheel scrolling.** Lampa reads the legacy `wheelDelta`, throttles it to one step per 200 ms and jumps
  a whole row (`scroll_by_item`). `desktop.js` drives `element.Scroll.wheel(px)` with `scroll_by_item`
  off, summing the deltas once per animation frame.
- **Lazy rows.** Rows draw 7 cards and stop scrolling at the last drawn one. On desktop they're built in
  full.
- **Image sizes.** `Lampa.TMDB` is the same object `app.min.js` calls internally (`TMDB$1`), so wrapping
  `image()` upgrades every poster and backdrop Lampa requests.
- **Poster colours.** TMDB images send `Access-Control-Allow-Origin: *` but no `Vary: Origin`. A poster
  already cached from Lampa's own `<img>` therefore fails a CORS load, so `glass.js` adds a query string to
  get its own cache entry.
- **Back to Home.** When you come back to Home, Lampa re-centres the last focused poster, which scrolls
  the billboard off screen. `hero.js` scrolls it back if it was in view when you left.
