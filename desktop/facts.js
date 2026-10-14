// "Did you know?" while a title loads (desktop/README.md, "Play"): from Play until the picture moves, a card
// at the bottom of the screen shows a fact every ROTATE_MS. First facts about this title (from TMDB:
// director, cast, budget and box office, seasons...), then general film and TV trivia (facts-data.js),
// each browser going through all of those before any repeats (ruby_facts_seen).
// rubyFacts.start(card) / .stop(). Runs where play.js does.
(function () {
    var ROTATE_MS = 7000, SEEN = 'ruby_facts_seen';
    var CSS = [
        '.ruby-facts{position:fixed;left:50%;bottom:6vh;transform:translate(-50%,1em);z-index:100000;width:min(46em,86vw);padding:1.1em 1.5em 1.2em;',
        '  border-radius:.8em;background:rgba(18,18,20,.92);border:1px solid rgba(255,255,255,.12);box-shadow:0 1em 3em rgba(0,0,0,.5);',
        '  font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#e5e5e5;opacity:0;transition:opacity .4s,transform .4s;pointer-events:none}',
        '.ruby-facts.show{opacity:1;transform:translate(-50%,0)}',
        '.ruby-facts__head{font-size:.9em;letter-spacing:.12em;text-transform:uppercase;color:#a3a3a3;margin-bottom:.45em}',
        '.ruby-facts__text{font-size:1.3em;line-height:1.45;transition:opacity .35s}',
        '.ruby-facts__bar{position:absolute;left:0;bottom:0;height:2px;background:#e50914;border-radius:0 0 .8em .8em}',
        '.ruby-facts__bar.run{animation:ruby-facts-bar linear forwards}',
        '@keyframes ruby-facts-bar{from{width:0}to{width:100%}}'
    ].join('\n');

    var box = null, timer = 0, queue = [], token = 0;

    function money(n) { return n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + ' billion' : '$' + Math.round(n / 1e6) + ' million'; }
    function list(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

    // facts about this title from its TMDB details
    function about(card, done) {
        var tv = !!(card.original_name || card.first_air_date || card.media_type === 'tv');
        var url = Lampa.TMDB.api((tv ? 'tv/' : 'movie/') + card.id + '?append_to_response=credits,keywords&api_key=' + Lampa.TMDB.key() + '&language=' + (Lampa.Storage.field('tmdb_lang') || 'en'));
        fetch(url).then(function (r) { return r.json(); }).then(function (d) {
            var f = [], name = d.title || d.name;
            var cast = ((d.credits && d.credits.cast) || []).filter(function (c) { return c.character; }).slice(0, 4);
            var end = function (t) { return /[.!?]$/.test(t) ? t : t + '.'; };
            cast.forEach(function (c) { f.push(end(c.name + ' plays ' + c.character.replace(/\s*\(voice\)/i, '') + (/voice/i.test(c.character) ? ' (voice)' : ''))); });
            if (tv) {
                if (d.created_by && d.created_by.length) f.push(name + ' was created by ' + list(d.created_by.map(function (c) { return c.name; })) + '.');
                if (d.number_of_seasons) f.push(name + ' has ' + d.number_of_seasons + ' season' + (d.number_of_seasons > 1 ? 's' : '') +
                    (d.number_of_episodes ? ' and ' + d.number_of_episodes + ' episodes' : '') + '.');
                if (d.networks && d.networks.length) f.push('It first aired on ' + d.networks[0].name + (d.first_air_date ? ' in ' + d.first_air_date.slice(0, 4) : '') + '.');
                if (d.status === 'Ended' && d.last_air_date) f.push('Its final episode aired in ' + d.last_air_date.slice(0, 4) + '.');
            } else {
                var dir = ((d.credits && d.credits.crew) || []).filter(function (c) { return c.job === 'Director'; }).map(function (c) { return c.name; });
                if (dir.length) f.push(name + ' was directed by ' + list(dir) + '.');
                if (d.budget > 1e6 && d.revenue > 1e6) f.push('It cost about ' + money(d.budget) + ' to make and took ' + money(d.revenue) + ' worldwide.');
                if (d.belongs_to_collection) f.push('It is part of ' + d.belongs_to_collection.name.replace(/^the /i, 'the ') + '.');
                if (d.runtime) f.push('It runs ' + Math.floor(d.runtime / 60) + ' h ' + d.runtime % 60 + ' min.');
            }
            var kw = ((d.keywords && (d.keywords.keywords || d.keywords.results)) || []).map(function (k) { return k.name; });
            if (kw.indexOf('based on novel or book') >= 0) f.push('It is based on a book.');
            if (kw.indexOf('based on manga') >= 0) f.push('It is based on a manga.');
            if (kw.indexOf('based on comic') >= 0) f.push('It is based on a comic.');
            if (kw.indexOf('based on true story') >= 0) f.push('It is based on a true story.');
            var made = (d.production_countries || []).map(function (c) { return c.name; });
            if (made.length && made.length < 4) f.push('It was made in ' + list(made) + '.');
            if (d.tagline) f.push('Its tagline: "' + d.tagline + '"');
            done(shuffle(f));
        }, function () { done([]); });
    }

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

    function start(card) {
        stop();
        var my = ++token;
        if (!document.getElementById('ruby-facts-css')) {
            var st = document.createElement('style'); st.id = 'ruby-facts-css'; st.textContent = CSS; document.head.appendChild(st);
        }
        box = document.createElement('div');
        box.className = 'ruby-facts';
        box.innerHTML = '<div class="ruby-facts__head">Did you know?</div><div class="ruby-facts__text"></div><div class="ruby-facts__bar"></div>';
        document.body.appendChild(box);
        requestAnimationFrame(function () { if (box) box.classList.add('show'); });
        queue = trivia();
        // this title's facts first: wait a moment for TMDB before showing anything
        var begun = false, begin = function () { if (!begun && my === token) { begun = true; next(); } };
        setTimeout(begin, 1500);
        if (card && card.id) about(card, function (f) {
            if (my !== token) return;
            queue = f.map(function (t) { return { text: t }; }).concat(queue);
            begin();
        }); else begin();
    }

    function stop() {
        token++;
        clearTimeout(timer);
        if (!box) return;
        var b = box; box = null;
        b.classList.remove('show');
        setTimeout(function () { b.remove(); }, 450);
    }

    window.rubyFacts = { start: start, stop: stop };
})();
