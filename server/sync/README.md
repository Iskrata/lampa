# Profile service (`server/sync/`)

Shared profiles for Lampa Desktop (`desktop/profiles.js`, `desktop/README.md` "Profiles"). Node, no
dependencies. It sits at `/sync/` on the same origin as the site. The server's copy of each profile is the
one that counts.

## Why

Until 2026-10-20, `/sync/` was a plain WebDAV folder (rclone). Every browser uploaded its whole copy of a
profile and the last upload won, so a browser with an old copy put it back over newer data. It happened
three times in three days, each time to the same profile:
- **2026-10-18:** an iPhone's empty local "Me" (also id `p1`) replaced the history and My List.
- **2026-10-20 10:37:** a `ruby.iskrata.dev` tab with the previous day's near-empty copy wiped the Trakt
  login and history.
- **2026-10-20 14:50:** the same tab added one title to My List and put its old lists back.

The fixes in the browser could be bypassed by any page still running old code. Now the server decides.

## Changes, not copies

A browser never sends a profile. It sends what it changed, key by key (`ops.js`; computed in the browser
by `desktop/profilesync.js`):

| change | for |
|---|---|
| `{ k, set }` | a whole value that isn't a JSON object (a token, `activity`) |
| `{ k, del }` | a key removed (a logout) |
| `{ k, obj: { set, del } }` | object fields: watch progress per title (`file_view`), ratings |
| `{ k, obj: { lists: { f: { front, remove } } } }` | lists of ids (My List, history): what moved to the front, what went |
| `{ k, obj: { items: { f: { put, remove } } } }` | lists of objects by id (`favorite.card`) |

The server applies each change to its own copy. A stale page can therefore only add what it changed
itself. Its old copy of everything else never leaves the browser.

## API

| request | does |
|---|---|
| `GET /<file>` | any file, as before (`profiles.json`, `profile-<id>.json`, `presence-*`, `events-*`) |
| `PUT /presence-*.json`, `/events-*.json`, `/.probe` | small per-device files, whole |
| `PUT` of a profile or `profiles.json` | **409**: old page code. Its write is refused, and the journal records it |
| `POST /profile-<id>.json` `{ base, by, ops }` | applies the changes; answers `{ v, t, stale }`. `stale`: someone else changed it since `base`, the version the page had |
| `POST /profile-<id>.json` `{ by, create: { keys } }` | a new profile's data; **409** if it already has some |
| `GET /watching` | who's watching now: each profile whose `presence-<id>.json` is under 3 minutes old, with the profile's current name, colour and picture. Presence files are still written by the pages (`desktop/presence.js`) |
| `POST /profiles.json` `{ upsert }` / `{ add: [...] }` / `{ remove: id }` | one profile added or edited / profiles added only if their id is new / a profile removed. Its file moves to `trash/`, and changes for it then get **404**, so an open tab can't bring it back |

A profile file is `{ t, v, keys, by }`. `v` goes up by one with each change, and `by` is the device, reason,
browser and IP of the last change.

## Journal

`journal/<date>.jsonl` gets one line per write, kept 30 days. Each line has the time, IP, device, reason,
browser, version, the keys changed, and the changes themselves. Old-code writes that were refused are
logged there too. This is where to look when a profile looks wrong. Every change can be read back, in
order, with who made it.

## Running

```bash
SYNC_PORT=8091 SYNC_DATA=./data SYNC_JOURNAL=./journal SYNC_TRASH=./trash node server/sync/server.js
```

`tools/dev-server.js` runs the same handler over a temporary folder. On the home server it is the
`LampaSync` service (deployment notes).

Checked 2026-10-20 in `tools/dev-server.js`, with two origins standing in for two devices:
- A device with a stale copy took the server's copy on load, and again when its tab came back.
- Both devices added a different title to My List while open: both titles stayed, along with the history
  and the Trakt login.
- Progress sent by a tab as it closed merged with the other title's.
- A removal made just before a profile switch arrived.
- An old browser's "Me" (`p1`) became a new profile with its own data.
- A deleted profile refused an open tab's change (404).
- An old-code PUT got 409.
