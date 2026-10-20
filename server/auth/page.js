// The login page (README.md): one password field, in the desktop look (desktop/desktop.js palette, the red
// wordmark of desktop/nav.js). No script and nothing loaded from anywhere: the CSP allows only its own inline
// style, and the form posts to /auth/login on this origin.
'use strict';

const RED = '#e50914';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:center;padding:16px;
  background-image:radial-gradient(ellipse at 50% -10%,rgba(229,9,20,.28),transparent 60%)}
main{width:100%;max-width:380px}
h1{margin:0 0 .9em;text-align:center;font-weight:900;font-size:64px;letter-spacing:-.03em;line-height:1;color:${RED};text-transform:uppercase;transform:scaleY(1.12)}
form{background:rgba(28,28,30,.82);border-radius:18px;padding:28px 24px 24px;box-shadow:0 24px 60px rgba(0,0,0,.6)}
label{display:block;font-size:14px;color:rgba(235,235,245,.6);margin:0 0 8px}
input[type=password]{width:100%;font:inherit;font-size:18px;color:#fff;background:rgba(118,118,128,.24);border:2px solid transparent;border-radius:12px;padding:14px 16px;outline:none}
input[type=password]:focus{border-color:rgba(255,255,255,.55)}
button{width:100%;margin-top:18px;font:inherit;font-size:17px;font-weight:600;color:#fff;background:${RED};border:0;border-radius:12px;padding:14px;cursor:pointer}
button:hover,button:focus{background:#f6121d;outline:none;box-shadow:0 0 0 3px rgba(255,255,255,.35)}
button:disabled{background:rgba(118,118,128,.4);color:rgba(235,235,245,.6);cursor:default;box-shadow:none}
.msg{margin:0 0 16px;padding:12px 14px;border-radius:12px;font-size:15px;line-height:1.35;background:rgba(229,9,20,.16);color:#ff8a90}
.hint{margin:18px 0 0;text-align:center;font-size:13px;color:rgba(235,235,245,.3)}
.u{position:absolute;left:-10000px;width:1px;height:1px;opacity:0}
`;

// msg: shown above the field; closed: no field (banned or the login closed for a while)
function page(o) {
    const brand = esc(o.brand), field = o.closed ? '' : `
      <label for="pw">Password</label>
      <input class="u" type="text" name="username" autocomplete="username" value="${brand.toLowerCase()}" tabindex="-1" aria-hidden="true">
      <input id="pw" type="password" name="password" autocomplete="current-password" autofocus required>`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#000000">
<title>${brand}</title>
<link rel="icon" href="data:,">
<style nonce="${o.nonce}">${CSS}</style>
</head>
<body>
<main>
  <h1>${brand}</h1>
  <form method="post" action="/auth/login">
    ${o.msg ? `<p class="msg" role="alert">${esc(o.msg)}</p>` : ''}
    <input type="hidden" name="next" value="${esc(o.next)}">${field}
    <button type="submit"${o.closed ? ' disabled' : ''}>Sign in</button>
  </form>
  <p class="hint">You stay signed in on this device.</p>
</main>
</body>
</html>`;
}

module.exports = { page };
