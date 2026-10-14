// Profile pictures, Netflix-style (desktop/README.md, "Profiles"): in the profile editor, rows of characters
// from popular series and films (TMDB cast portraits, labelled with the character). The choice is the
// portrait's TMDB path, kept with the profile (p.img) and so shared like the rest of profiles.json.
// rubyAvatars.url(path) -> image URL; rubyAvatars.gallery(host, current, onPick(path|null)).
// Loaded with profiles.js, before Lampa; the gallery waits for Lampa's TMDB key.
(function () {
    // [kind, TMDB id] - shows and films whose casts make recognisable avatars
    var TITLES = [['tv', 66732], ['tv', 1396], ['tv', 1399], ['tv', 2316], ['tv', 1668], ['tv', 119051], ['tv', 93405],
        ['tv', 94605], ['tv', 246], ['tv', 60625], ['tv', 71912], ['tv', 71446], ['movie', 299534], ['movie', 120]];
    var PER_TITLE = 8, IMG = 'https://image.tmdb.org/t/p/';

    var CSS = [
        '.ruby-avs{margin-top:1.6em;max-height:46vh;overflow-y:auto;padding-right:.5em}',
        '.ruby-avs__title{font-size:1.05em;color:#ccc;margin:1em 0 .5em}',
        '.ruby-avs__row{display:flex;gap:.7em;overflow-x:auto;padding:.2em .2em .6em}',
        '.ruby-avs__p{flex:0 0 auto;width:5.4em;cursor:pointer;text-align:center;font-size:.8em;color:#999}',
        '.ruby-avs__img{width:100%;aspect-ratio:1;border-radius:.3em;background:#333 center/cover;box-shadow:0 0 0 2px transparent;transition:box-shadow .15s,transform .15s}',
        '.ruby-avs__p:hover .ruby-avs__img{transform:scale(1.06)}',
        '.ruby-avs__p.on .ruby-avs__img{box-shadow:0 0 0 2px #141414,0 0 0 4px #fff}',
        '.ruby-avs__name{margin-top:.35em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ruby-avs__none .ruby-avs__img{display:flex;align-items:center;justify-content:center;color:#999;font-size:1.6em}'
    ].join('\n');

    function url(path, size) { return IMG + (size || 'w185') + path; }

    function api(path, done) {
        var go = function () {
            if (!window.Lampa || !Lampa.TMDB || !Lampa.TMDB.key) return setTimeout(go, 200);
            fetch(Lampa.TMDB.api(path + (path.indexOf('?') < 0 ? '?' : '&') + 'api_key=' + Lampa.TMDB.key() + '&language=en'))
                .then(function (r) { return r.json(); }).then(done, function () { done(null); });
        };
        go();
    }

    // one title's row: its name, and its first cast members that have a portrait
    function title(t, done) {
        var credits = t[0] === 'tv' ? 'aggregate_credits' : 'credits';
        api(t[0] + '/' + t[1] + '?append_to_response=' + credits, function (d) {
            if (!d) return done(null);
            var cast = ((d[credits] && d[credits].cast) || []).filter(function (c) { return c.profile_path; }).slice(0, PER_TITLE);
            done({
                name: d.name || d.title,
                people: cast.map(function (c) {
                    var who = c.character || (c.roles && c.roles[0] && c.roles[0].character) || c.name;
                    return { path: c.profile_path, label: who.split('/')[0].replace(/\s*\(voice\)/i, '').trim() };
                })
            });
        });
    }

    var cache = null;
    function rows(done) {
        if (cache) return done(cache);
        var out = new Array(TITLES.length), left = TITLES.length;
        TITLES.forEach(function (t, i) { title(t, function (r) { out[i] = r; if (--left === 0) done(cache = out.filter(function (x) { return x && x.people.length; })); }); });
    }

    function gallery(host, current, onPick) {
        if (!document.getElementById('ruby-avs-css')) {
            var st = document.createElement('style'); st.id = 'ruby-avs-css'; st.textContent = CSS; document.head.appendChild(st);
        }
        var box = document.createElement('div');
        box.className = 'ruby-avs';
        box.innerHTML = '<div class="ruby-avs__title">Choose a picture</div><div style="color:#777">Loading…</div>';
        host.appendChild(box);
        rows(function (list) {
            box.innerHTML = '';
            var mark = function (el) { [].forEach.call(box.querySelectorAll('.ruby-avs__p'), function (x) { x.classList.toggle('on', x === el); }); };
            var person = function (path, label, row) {
                var el = document.createElement('div');
                el.className = 'ruby-avs__p' + (path ? '' : ' ruby-avs__none') + (path === current ? ' on' : '');
                el.innerHTML = '<div class="ruby-avs__img"' + (path ? ' style="background-image:url(' + url(path) + ')"' : '') + '>' + (path ? '' : '–') + '</div><div class="ruby-avs__name"></div>';
                el.querySelector('.ruby-avs__name').textContent = label;
                el.title = label;
                el.addEventListener('click', function () { mark(el); onPick(path); });
                row.appendChild(el);
            };
            var plain = document.createElement('div');
            plain.className = 'ruby-avs__row';
            box.insertAdjacentHTML('beforeend', '<div class="ruby-avs__title">Choose a picture</div>');
            box.appendChild(plain);
            person(null, 'Colour only', plain);
            list.forEach(function (r) {
                var h = document.createElement('div');
                h.className = 'ruby-avs__title';
                h.textContent = r.name;
                var row = document.createElement('div');
                row.className = 'ruby-avs__row';
                box.appendChild(h);
                box.appendChild(row);
                r.people.forEach(function (p) { person(p.path, p.label, row); });
            });
        });
    }

    window.rubyAvatars = { url: url, gallery: gallery };
})();
