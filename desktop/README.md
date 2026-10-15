# desktop/: how Lampa Desktop works

Plain ES5 scripts, no build step. `index.html` loads them before Lampa's own loader, in this order. Each
one waits for the parts of `window.Lampa` it needs (Lampa loads `app.min.js` asynchronously) and then runs.
Everything visual is active only on computers (`!Lampa.Platform.tv()`) with **Settings → Interface →
Desktop look** on, so Lampa on a TV stays as upstream ships it.

| file | what it does |
|---|---|
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
| `avatars.js` | `rubyAvatars`: profile pictures, characters from popular titles (TMDB portraits) |
| `facts-data.js` / `facts.js` | `rubyFacts`: "Did you know?" while a title loads |
| `mylist.js` | `rubyMyList`: + My List on posters and the billboard |
| `pick.js` | `rubyPick`: from search results, the English releases that will stream, best per resolution |
| `play.js` | Play without a torrent list: asks only for the resolution, picks the release and the file; episodes play on click |
| `player.js` | the player's labelled Subtitles button and an AirPlay button |
| `presence.js` | who's watching now, in the top bar (the shared `./sync/` folder) |

Torrents play in the browser through `server/remux` (its README): any file becomes HLS on the server, so an
MKV with HEVC and E-AC3 plays in Safari and Chrome, with subtitles, and AirPlays.

The `ruby` prefix on globals (`rubyDesktop`), storage keys (`ruby_*`) and CSS classes (`.ruby-*`) comes
from the home server this was first built for. It keeps everything clear of Lampa's own names.

## Profiles

Lampa keeps all state in `localStorage` under fixed keys and has no local profiles (its own need a CUB
account). A profile is therefore a set of those keys. The active profile's values are the live keys that
Lampa and its plugins read. Every other profile's values wait in `ruby_profile_data_<id>`.

Switching writes the target to `ruby_profile_switch` and reloads. The swap runs at the very start of the
next page load, before `app.min.js` has read anything and after the old page can no longer write, so
nothing leaks between profiles.

**Sharing profiles between devices.** Serve any WebDAV folder at `./sync/` on the same origin, for
example `rclone serve webdav <dir> --addr 127.0.0.1:8091` behind your web server's `/sync/` route.
`store.js` detects it with a test write, then keeps `profiles.json` and `profile-<id>.json` (`{t, keys}`)
there:
- **Reads** happen synchronously at page start, before Lampa.
- **Writes** go up every 15 s when something changed, and when the tab hides. The last write wins.
- **Which profile a device is on** stays on the device.
- **A browser's first contact** merges in its own profiles. Its untouched default "Me" isn't added. A
  renamed first profile whose id `p1` is already taken by a differently named one gets a new id.

Without `./sync/`, everything stays in the browser.

Per profile: `favorite`, `file_view*` (progress), `online_view`, `torrents_view`, `timetable`,
`search_history`, `recomends_*`, `activity` and a few more, every `trakt*` key (the Trakt login and all
Trakt plugin state), and `ruby_ratings`. Shared: settings, servers, plugins, and `trakt_client_id` /
`trakt_client_secret`. The list is at the top of `profiles.js`.

**Who's watching now.** With `./sync/`, each profile writes `presence-<id>.json` when playback starts,
every minute while it goes on, and `{at: 0}` when it stops. The top bar shows the other profiles that wrote
one in the last 3 minutes: an avatar with a green dot, "Vik is watching Breaking Bad · S5 E14" on hover,
the title page on click. A TV writes too; only the top bar reads.

**Pictures.** Edit Profile offers rows of characters from popular series and films (Stranger Things,
Breaking Bad, Game of Thrones, The Office…): TMDB cast portraits, labelled with the character, the first 8 of
each title's cast. The choice is the portrait's TMDB path (`img` in the profile), shared with the rest of
`profiles.json`; without one, the face on the profile's colour.

## My List

A round + on every poster while it's pointed at, and "My List" on the billboard, toggle the title in Lampa's
Bookmarks (`Lampa.Favorite` `book`): the same list as the title page's bookmark button, per profile. A tick
when it's in. The top bar's My List opens just that list (`component: 'favorite', type: 'book'`), not
Lampa's all-favourites overview. The button stops its clicks from reaching the card, which would open
the title. The title page's bookmark button saves with one click too: Lampa's menu of Bookmarks / Like /
Later / statuses is skipped. The thumbs are the ratings, so Lampa's own "Like" list was a duplicate.

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
3. **Rank** each resolution's releases:
   - log of seeders;
   - source (WEB-DL/Blu-ray over WEBRip over HDTV);
   - a bitrate band per resolution, from size and runtime (too small is over-compressed, too big is a
     remux that won't stream from a 110 Mbit/s uplink);
   - penalties for Dolby Vision without HDR10 and for AV1;
   - a small bonus for season packs.
4. **Ask** "Play in", a popup in the middle of the screen on computers (Lampa's own side sheet, restyled while
   it's open, so keys and remote still work): one line per resolution with its best release's seeders and size, then "Pick a torrent
   manually" (Lampa's list). Only resolutions up to the screen's are offered:
   - **Screen:** physical width of 2560 px or more → up to 4K; otherwise 1080p; 720p under 1280. Phones
     stop at 1080p.
   - **Connection:** a release whose bitrate × 1.3 is more than this connection carries says "Your
     connection (N Mbit/s) is too slow for this". The speed is timed once per session, while the search
     runs, by downloading 4 MB of random bytes from the remux service (`/gst/speedtest`).
   - **Preselected:** the last resolution chosen, unless it's too slow.
5. **Open** the release with Lampa's own flow (`Lampa.Torrent.start`) and, when Lampa's file list comes up
   (`torrent_file` events), start the right file: the episode by season/episode, or a film's largest video
   file. The list is hidden meanwhile. Resume, the episode playlist and "next episode" stay Lampa's.

A series' Play continues where you are: the last episode with progress, or the next one once that's
past 90 %. A fresh show starts at S1 E1. Measured on Breaking Bad: S1 E1 → S2 E3 at 40 % → S2 E4 at 95 %.

Episode cards are built without a reference to their data, so a click reads the card: the episode number
and name. The episode is looked up by name in TMDB's own seasons, starting with the season the page shows
(the all-episodes page's season, else the latest aired). It doesn't use `Lampa.Api.seasons`: when asked
for season 1, that splits a show at any gap of more than 90 days between air dates into made-up seasons and
renumbers the episodes (`splitEpisodesIntoSeasons`). Torrent files, and the progress Lampa saves for them,
use the real numbers. The click is caught in
the capture phase, before the card's own handler, which upstream only toggled "watched". Episodes not
aired yet keep upstream behaviour.

**While it loads** (`facts.js`): from Play until the picture moves, except while the "Play in" question is
open, a card at the bottom shows a fact every 7 s. This title's facts come first, from TMDB: cast and
characters, director, budget and box office, seasons, network, collection, "based on a book". Then general
film and TV trivia from `facts-data.js` (110+ facts), each browser seeing all of them before any repeats
(`ruby_facts_seen`).

Settings → Interface → "Pick torrents for me" turns all of this off.

## Changes to Lampa itself (`app.min.js`)

Four small edits, each marked `Lampa Desktop:`; re-apply them when updating from upstream:
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

## Player

- **Subtitles.** Lampa shows its subtitles button only once the stream reports subtitle tracks, as a small
  speech-bubble icon. It's now a CC icon labelled "Subtitles".
- **AirPlay.** In Safari, when an AirPlay screen is around (`webkitplaybacktargetavailabilitychanged`), a
  button next to picture-in-picture opens the picker. The Apple TV fetches the HLS stream itself, so it
  needs a URL that works without the browser: on the home server the stream path has no password.

## Picked for you

Built once per page load, per profile (`personal.js`, `picks()`). The billboard draws 6 of the top 18 at random on each visit,
higher picks more likely, so it isn't the same title every time. Besides thumbs, what the profile watched
counts: the 6 most recent titles in Lampa's history (`Favorite` `history`, added each time a torrent plays)
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

## Things Lampa does that these modules work around

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
