// The loading screen while a title starts (desktop/README.md, "Play"): from Play until the picture moves, the
// whole screen goes black with the title's logo, a spinner, what's happening ("Getting it ready…") and Cancel.
// It used to show film trivia too ("Did you know?"); the user turned that off for the whole app on
// 2026-10-20. It is the only loading indicator: Lampa's own loading layer and its empty "loading torrent"
// window are hidden while it shows (a box behind the card with its own spinner, "ugly", 2026-10-18).
// How far it is, with a bar along the bottom: rubyFacts.progress(pct, detail) (progress.js).
// rubyFacts.start(status, card) / .open() / .status(text) / .progress(pct, detail) / .stop(). Runs where play.js does.
(function () {
    var CSS = [
        // the whole screen, from the moment Play is pressed: the title's picture dimmed, its logo, a large spinner,
        // what's happening in plain words, Cancel. Was a small card at the top while the trailer played on behind
        // it ("looks like nothing happened", simplicity review 2026-10-20)
        '.ruby-facts{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.4em;',
        '  background:#000 center/cover no-repeat;color:#e5e5e5;font-size:clamp(14px,1.3vw,24px);opacity:0;transition:opacity .35s;pointer-events:none;',
        '  font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif}',
        '.ruby-facts::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,.72),rgba(0,0,0,.95))}',
        '.ruby-facts>*{position:relative}',
        '.ruby-facts.show{opacity:1;pointer-events:auto}',
        '.ruby-facts__logo{max-width:min(30em,70vw);max-height:10em;object-fit:contain}',
        '.ruby-facts__name{font-size:2.2em;font-weight:700;text-align:center;max-width:80vw}',
        '.ruby-facts__spin{width:6em;height:6em;border-radius:50%;border:.35em solid rgba(229,9,20,.2);border-top-color:#e50914;animation:ruby-facts-spin .9s linear infinite}',
        '@keyframes ruby-facts-spin{to{transform:rotate(360deg)}}',
        '@media (prefers-reduced-motion:reduce){.ruby-facts__spin{animation-duration:2.5s}}',
        '.ruby-facts__status{font-size:1.5em;text-align:center;min-height:1.4em}',
        '.ruby-facts__track{width:min(20em,70vw);height:4px;border-radius:2px;background:rgba(255,255,255,.15);overflow:hidden;visibility:hidden}',
        '.ruby-facts__track.on{visibility:visible}',
        '.ruby-facts__bar{height:100%;width:0;background:#e50914;transition:width .8s ease-out}',
        '.ruby-facts__detail{font-size:.95em;color:#bdbdbd;font-variant-numeric:tabular-nums;min-height:1.3em;margin-top:-1em}',
        '.ruby-facts__cancel{cursor:pointer;padding:.6em 1.6em;border-radius:.4em;font-size:1.05em;color:#fff;background:rgba(255,255,255,.14)}',
        '.ruby-facts__cancel:hover,.ruby-facts__cancel.focus{background:rgba(255,255,255,.3)}',
        // Lampa's loaders: the screen says it instead (the layer stays where it is, for its keys)
        'body.ruby-facts-on .loading-layer{opacity:0!important;pointer-events:none!important}',
        'body.ruby-facts-on .modal:has(.modal-loading){opacity:0!important;pointer-events:none!important}'
    ].join('\n');

    var box = null, shown = 0;

    // card: the title being started (its backdrop and logo), optional
    function start(text, card) {
        stop();
        if (!document.getElementById('ruby-facts-css')) {
            var st = document.createElement('style'); st.id = 'ruby-facts-css'; st.textContent = CSS; document.head.appendChild(st);
        }
        box = document.createElement('div');
        box.className = 'ruby-facts';
        box.innerHTML = '<div class="ruby-facts__head"></div><div class="ruby-facts__spin"></div><div class="ruby-facts__status"></div>' +
            '<div class="ruby-facts__track"><div class="ruby-facts__bar"></div></div><div class="ruby-facts__detail"></div>' +
            '<div class="ruby-facts__cancel">Cancel</div>';
        shown = 0;
        if (card) dress(box, card);
        // Back, as the key does: Lampa's loading layer, the torrent window or the player each cancel on it
        box.querySelector('.ruby-facts__cancel').addEventListener('click', function () { Lampa.Controller.back(); });
        document.body.appendChild(box);
        document.body.classList.add('ruby-facts-on');
        status(text || 'Loading…');
        requestAnimationFrame(function () { if (box) box.classList.add('show'); });
    }

    // the title's backdrop behind everything and its logo on top (its name until the logo comes, or without one)
    function dress(el, card) {
        if (card.backdrop_path) el.style.backgroundImage = 'url(' + Lampa.TMDB.image('t/p/w1280' + card.backdrop_path) + ')';
        var head = el.querySelector('.ruby-facts__head'), name = document.createElement('div');
        name.className = 'ruby-facts__name';
        name.textContent = card.title || card.name || '';
        head.appendChild(name);
        if (!window.rubyDesktop || !card.id) return;
        rubyDesktop.logo(card, function (src) {
            if (!src || box !== el) return;
            var img = new Image();
            img.className = 'ruby-facts__logo';
            img.alt = name.textContent;
            img.onload = function () { if (box === el) head.replaceChild(img, name); };
            img.src = src;
        });
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

    window.rubyFacts = { start: start, status: status, progress: progress, stop: stop, open: function () { return !!box; } };
})();
