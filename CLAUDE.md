# Lampa Desktop (fork of yumata/lampa)

Lampa is a prebuilt web app (`app.min.js`, not minified despite the name: ~57k lines, readable). This fork
adds a desktop layer in `desktop/` (plain ES5 scripts, no build step) and a small back end in `server/`.
Read these first:

| file | what |
|---|---|
| [README.md](README.md) | what the fork adds, for users |
| [desktop/README.md](desktop/README.md) | **how every module works**, measured facts, the patches to `app.min.js` |
| [server/remux/README.md](server/remux/README.md) | the HLS repackaging service (Node + ffmpeg), with the timing facts it rests on |
| [server/auth/README.md](server/auth/README.md) | the public host's sign-in page: sessions, bans, the move from basic auth |

`CLAUDE.local.md` (not in git) has the deployment this fork runs on, if present.

## Layout

- `index.html`: loads `desktop/*.js` before Lampa. The order matters (store.js and profiles.js must run
  before `app.min.js` reads localStorage).
- `desktop/`: one module per concern. Each waits for the parts of `window.Lampa` it needs, then runs. The
  look is only on computers (`!Lampa.Platform.tv()` and Settings → Interface → Desktop look);
  `play.js`/`pick.js` also run on TVs.
- `server/remux/`: Node (no dependencies) + ffmpeg/ffprobe 8.x. Speaks Lampa's TorrServer-GStreamer
  protocol at `<TorrServer>/gst/`.
- `server/auth/`: Node (no dependencies). The public host's sign-in page, behind Caddy's `forward_auth`.
- `app.min.js`: upstream, plus ten small edits marked `Lampa Desktop:`. Keep it that way. Prefer a
  `desktop/` module; patch upstream only when a module can't reach the code (closures). Document each
  patch in desktop/README.md ("Changes to Lampa itself").

## Conventions

- ES5 in `desktop/` (TVs run old browsers): `var`, `function`, no arrow functions or template strings.
  Node code in `server/` can be modern.
- Globals, storage keys and CSS classes use the `ruby` prefix (`rubyDesktop`, `ruby_*`, `.ruby-*`), to stay
  clear of Lampa's names.
- Shared helpers live on `rubyDesktop` (desktop.js), icons in `rubyIcons` (icons.js, SVG only, no emoji).
  Reuse them instead of duplicating.
- Lampa internals: `Lampa.X` is the same object the bundle uses internally (`Lampa.TMDB === TMDB$1`,
  `Lampa.Torserver`, `Lampa.Activity`…), so wrapping a method on it changes Lampa's own calls.
  `Lampa.Listener` events (`full`, `activity`, `torrent_file`…) and `Lampa.Player.listener` are the hooks.
  Lampa fires its own `hover:enter` events (non-bubbling): catch them in the capture phase on `document`.
- Comments say why, not what. Every measured number in a doc says when and how it was measured.

## Testing

No test suite. Check changes in a real browser:
- Syntax: `node -e 'new Function(require("fs").readFileSync("desktop/x.js","utf8"))'`.
- Pure logic (`desktop/pick.js`) runs in Node with `global.window = {}`.
- The app: `node tools/dev-server.js` serves this checkout with a TorrServer/Jackett host proxied
  (`LAMPA_UPSTREAM`, see the file) and a throwaway in-memory `/sync/`, so test data never reaches real
  shared profiles. Drive it with the built-in browser or chrome-devtools. `DEV_CONSOLE=1` prints the page's
  console in its terminal, for the iOS simulator's Safari (no console to reach otherwise).
- Phones: start playback with real taps (the simulator tool's `tap`), not scripted clicks. Safari plays a
  `<video>` only after a tap, and a start comes seconds after it (desktop/README.md "A start Safari refused").
- Safari behaves differently (native HLS, scrolling performance): verify there before calling something
  done. desktop/README.md "Performance" describes the safaridriver method.
