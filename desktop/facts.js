// The loading card while a title starts (desktop/README.md, "Play"): from Play until the picture moves, a
// card at the top of the screen with a spinner, what's happening ("Finding the best release…") and Cancel.
// It used to show film trivia too ("Did you know?"); the user turned that off for the whole app on
// 2026-10-20. It is the only loading indicator: Lampa's own loading layer and its empty "loading torrent"
// window are hidden while it shows (a box behind the card with its own spinner, "ugly", 2026-10-18).
// How far it is, with a bar along the bottom: rubyFacts.progress(pct, detail) (progress.js).
// rubyFacts.start(status) / .status(text) / .progress(pct, detail) / .stop(). Runs where play.js does.
(function () {
    var CSS = [
        // at the top, just under the top bar, out of the way (at the bottom it covered the player's controls,
        // under the spinner it sat in the middle of the picture; the user's call 2026-10-17)
        '.ruby-facts{position:fixed;left:50%;top:4.5em;transform:translate(-50%,-1em);z-index:100000;width:min(30em,86vw);padding:.8em 1.1em;',
        '  border-radius:.8em;background:rgba(18,18,20,.92);border:1px solid rgba(255,255,255,.12);box-shadow:0 1em 3em rgba(0,0,0,.5);',
        '  font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#e5e5e5;opacity:0;transition:opacity .4s,transform .4s;pointer-events:none}',
        '.ruby-facts.show{opacity:1;transform:translate(-50%,0)}',
        '.ruby-facts__foot{display:flex;align-items:center;gap:.6em;font-size:1em;color:#c8c8c8}',
        '.ruby-facts__spin{flex:none;width:1em;height:1em;border-radius:50%;border:2px solid rgba(229,9,20,.2);border-top-color:#e50914;animation:ruby-facts-spin .8s linear infinite}',
        '@keyframes ruby-facts-spin{to{transform:rotate(360deg)}}',
        '.ruby-facts__status{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.ruby-facts__detail{flex:none;font-variant-numeric:tabular-nums;color:#e5e5e5}',
        '.ruby-facts__track{position:absolute;left:0;right:0;bottom:0;height:3px;border-radius:0 0 .8em .8em;overflow:hidden;opacity:0;transition:opacity .3s}',
        '.ruby-facts__track.on{opacity:1}',
        '.ruby-facts__bar{height:100%;width:0;background:#e50914;transition:width .8s ease-out}',
        '.ruby-facts__cancel{flex:none;pointer-events:auto;cursor:pointer;padding:.3em .8em;border-radius:.4em;color:#e5e5e5;background:rgba(255,255,255,.08)}',
        '.ruby-facts__cancel:hover{background:rgba(255,255,255,.2)}',
        // Lampa's loaders: the card says it instead (the layer stays where it is, for its keys)
        'body.ruby-facts-on .loading-layer{opacity:0!important;pointer-events:none!important}',
        'body.ruby-facts-on .modal:has(.modal-loading){opacity:0!important;pointer-events:none!important}'
    ].join('\n');

    var box = null, shown = 0;

    function start(text) {
        stop();
        if (!document.getElementById('ruby-facts-css')) {
            var st = document.createElement('style'); st.id = 'ruby-facts-css'; st.textContent = CSS; document.head.appendChild(st);
        }
        box = document.createElement('div');
        box.className = 'ruby-facts';
        box.innerHTML = '<div class="ruby-facts__foot"><div class="ruby-facts__spin"></div><div class="ruby-facts__status"></div>' +
            '<div class="ruby-facts__detail"></div><div class="ruby-facts__cancel">Cancel</div></div>' +
            '<div class="ruby-facts__track"><div class="ruby-facts__bar"></div></div>';
        shown = 0;
        // Back, as the key does: Lampa's loading layer, the torrent window or the player each cancel on it
        box.querySelector('.ruby-facts__cancel').addEventListener('click', function () { Lampa.Controller.back(); });
        document.body.appendChild(box);
        document.body.classList.add('ruby-facts-on');
        status(text || 'Loading…');
        requestAnimationFrame(function () { if (box) box.classList.add('show'); });
    }

    function status(text) {
        var el = box && box.querySelector('.ruby-facts__status');
        if (el && text) el.textContent = text;
    }

    // pct 0-100, or null for no bar (only the detail, e.g. how many peers); it never goes back within one start
    function progress(pct, detail) {
        if (!box) return;
        box.querySelector('.ruby-facts__detail').textContent = detail || '';
        var track = box.querySelector('.ruby-facts__track');
        track.classList.toggle('on', pct != null);
        if (pct == null) return;
        shown = Math.max(shown, Math.min(100, pct));
        box.querySelector('.ruby-facts__bar').style.width = shown + '%';
    }

    function stop() {
        document.body.classList.remove('ruby-facts-on');
        if (!box) return;
        var b = box; box = null;
        b.classList.remove('show');
        setTimeout(function () { b.remove(); }, 450);
    }

    // the order trivia was shown in, per browser: not needed any more
    try { localStorage.removeItem('ruby_facts_seen'); } catch (e) {}

    window.rubyFacts = { start: start, status: status, progress: progress, stop: stop };
})();
