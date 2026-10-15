// "Did you know?" while a title loads (desktop/README.md, "Play"): from Play until the picture moves, a card
// at the bottom of the screen shows a fun fact about films and TV every ROTATE_MS (facts-data.js), each
// browser going through all of them before any repeats (ruby_facts_seen). Not about the title being opened
// (the user's call 2026-10-15: fun facts, not cast lists). rubyFacts.start() / .stop(). Runs where play.js does.
(function () {
    var ROTATE_MS = 12000, SEEN = 'ruby_facts_seen';
    var CSS = [
        // centred, just under the loading spinner (at the bottom it covered the player's controls)
        '.ruby-facts{position:fixed;left:50%;top:calc(50% + 4.5em);transform:translate(-50%,1em);z-index:100000;width:min(46em,86vw);padding:1.1em 1.5em 1.2em;',
        '  border-radius:.8em;background:rgba(18,18,20,.92);border:1px solid rgba(255,255,255,.12);box-shadow:0 1em 3em rgba(0,0,0,.5);',
        '  font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#e5e5e5;opacity:0;transition:opacity .4s,transform .4s;pointer-events:none}',
        '.ruby-facts.show{opacity:1;transform:translate(-50%,0)}',
        '.ruby-facts__head{font-size:.9em;letter-spacing:.12em;text-transform:uppercase;color:#a3a3a3;margin-bottom:.45em}',
        '.ruby-facts__text{font-size:1.3em;line-height:1.45;transition:opacity .35s}',
        '.ruby-facts__bar{position:absolute;left:0;bottom:0;height:2px;background:#e50914;border-radius:0 0 .8em .8em}',
        '.ruby-facts__bar.run{animation:ruby-facts-bar linear forwards}',
        '@keyframes ruby-facts-bar{from{width:0}to{width:100%}}'
    ].join('\n');

    var box = null, timer = 0, queue = [];

    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

    // general trivia, the ones this browser hasn't seen first
    function trivia() {
        var all = window.rubyFactsData || [], seen = {};
        try { (JSON.parse(localStorage.getItem(SEEN) || '[]')).forEach(function (i) { seen[i] = true; }); } catch (e) {}
        var fresh = all.map(function (_, i) { return i; }).filter(function (i) { return !seen[i]; });
        if (!fresh.length) { try { localStorage.removeItem(SEEN); } catch (e) {} fresh = all.map(function (_, i) { return i; }); }
        return shuffle(fresh).map(function (i) { return { i: i, text: all[i] }; });
    }

    function markSeen(i) {
        try {
            var s = JSON.parse(localStorage.getItem(SEEN) || '[]');
            if (s.indexOf(i) < 0) { s.push(i); localStorage.setItem(SEEN, JSON.stringify(s)); }
        } catch (e) {}
    }

    function next() {
        if (!box) return;
        if (!queue.length) queue = trivia();
        var f = queue.shift();
        if (!f) return;
        var text = box.querySelector('.ruby-facts__text'), bar = box.querySelector('.ruby-facts__bar');
        text.style.opacity = 0;
        setTimeout(function () {
            if (!box) return;
            text.textContent = f.text;
            text.style.opacity = 1;
            bar.classList.remove('run'); void bar.offsetWidth; bar.style.animationDuration = ROTATE_MS + 'ms'; bar.classList.add('run');
        }, 350);
        if (f.i != null) markSeen(f.i);
        timer = setTimeout(next, ROTATE_MS);
    }

    function start() {
        stop();
        if (!document.getElementById('ruby-facts-css')) {
            var st = document.createElement('style'); st.id = 'ruby-facts-css'; st.textContent = CSS; document.head.appendChild(st);
        }
        box = document.createElement('div');
        box.className = 'ruby-facts';
        box.innerHTML = '<div class="ruby-facts__head">Did you know?</div><div class="ruby-facts__text"></div><div class="ruby-facts__bar"></div>';
        document.body.appendChild(box);
        requestAnimationFrame(function () { if (box) box.classList.add('show'); });
        queue = trivia();
        next();
    }

    function stop() {
        clearTimeout(timer);
        if (!box) return;
        var b = box; box = null;
        b.classList.remove('show');
        setTimeout(function () { b.remove(); }, 450);
    }

    window.rubyFacts = { start: start, stop: stop };
})();
