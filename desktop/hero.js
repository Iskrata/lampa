// Featured billboard for Lampa's Home page on computers, Netflix/HBO style (desktop/README.md).
// Loaded by index.html. Shown only where desktop.js is active (not on TVs,
// not with Settings -> Interface -> Desktop look = Off) and toggled by Settings -> Interface -> Featured.
// Picks: the user's Trakt recommendations when this browser is signed in to Trakt (rubyDesktop.personalPicks,
// personal.js), else TMDB trending/all/week; each with its logo. Trailers come from the shared player
// (trailer.js); when one ends the next pick shows, and rotation waits while one plays.
(function () {
    var KEY = 'ruby_hero';
    var ROTATE_MS = 9000, PICKS = 6;
    var picks = null;

    function enabled() {
        return window.rubyDesktop && rubyDesktop.active() && Lampa.Storage.get(KEY, 'true') + '' !== 'false';
    }

    var CSS = [
        '.ruby-hero{position:relative;height:min(68vh,46em);margin:-1em 0 1.5em;border-radius:0 0 1em 1em;overflow:hidden;background:#000;cursor:default}',
        '.ruby-hero__bg{position:absolute;inset:0;background-size:cover;background-position:center 20%;transition:opacity .8s ease;opacity:0}',
        '.ruby-hero__bg.show{opacity:1}',
        '.ruby-hero::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(11,11,14,.95) 0%,rgba(11,11,14,.6) 38%,rgba(11,11,14,0) 70%),linear-gradient(0deg,#0b0b0e 0%,rgba(11,11,14,0) 35%)}',
        '.ruby-hero__body{position:absolute;left:3.5%;bottom:13%;width:min(42%,40em);z-index:2}',
        '.ruby-hero__logo{max-width:100%;max-height:9em;display:block;margin-bottom:1em;filter:drop-shadow(0 .2em .6em rgba(0,0,0,.6))}',
        '.ruby-hero__title{font-size:3.6em;font-weight:700;line-height:1.05;margin-bottom:.3em}',
        '.ruby-hero__meta{display:flex;gap:.8em;align-items:center;font-size:1.1em;opacity:.85;margin-bottom:.8em}',
        '.ruby-hero__badge{border:1px solid rgba(255,255,255,.5);border-radius:.3em;padding:0 .4em;font-size:.85em}',
        '.ruby-hero__text{font-size:1.15em;line-height:1.45;opacity:.9;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:1.4em}',
        '.ruby-hero__btns{display:flex;gap:.8em}',
        '.ruby-hero__btn{display:inline-flex;align-items:center;gap:.5em;padding:.65em 1.6em;border-radius:.4em;font-size:1.15em;font-weight:600;cursor:pointer;transition:filter .15s,transform .15s}',
        '.ruby-hero__btn .ruby-icon{font-size:1.35em}',
        '.ruby-hero__btn:hover{filter:brightness(.9);transform:scale(1.03)}',
        '.ruby-hero__btn--play{background:#fff;color:#000}',
        '.ruby-hero__btn--info{background:rgba(109,109,110,.7);color:#fff}',
        '.ruby-hero__dots{position:absolute;right:3.5%;bottom:13%;z-index:2;display:flex;gap:.45em}',
        '.ruby-hero__dot{width:.6em;height:.6em;border-radius:50%;background:rgba(255,255,255,.35);cursor:pointer}',
        '.ruby-hero__dot.active{background:#fff}',
        // shared trailer player (trailer.js): under the gradient, speaker button above the dots
        '.ruby-hero .ruby-trailer{z-index:auto}',
        '.ruby-hero .ruby-trailer__mute{right:3.5%;bottom:calc(13% + 2em)}'
    ].join('\n');

    // "visible" = Home is the active page (Lampa keeps Home's DOM alive, hidden, under an opened title
    // page - its trailer would play with sound behind the title's own), at least half of the billboard is
    // on screen (Lampa re-centres the last focused poster when you come back, so the page offset alone
    // says nothing), the tab is shown and the player is closed
    function heroVisible(el) {
        if (!document.body.contains(el) || !el.closest('.activity--active') || document.hidden) return false;
        if (Lampa.Player.opened && Lampa.Player.opened()) return false;
        var r = el.getBoundingClientRect(), shown = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
        return r.height > 0 && shown >= r.height * 0.5;
    }

    function loadPicks(done) {
        if (picks) return done(picks);
        if (rubyDesktop.personalPicks) return rubyDesktop.personalPicks(function (mine) {
            if (mine) { picks = mine.slice(0, PICKS); return done(picks); }
            trending(done);
        });
        trending(done);
    }

    function trending(done) {
        rubyDesktop.tmdb('trending/all/week', function (j) {
            picks = ((j && j.results) || []).filter(function (i) {
                return i.backdrop_path && i.overview && (i.media_type === 'movie' || i.media_type === 'tv');
            }).slice(0, PICKS);
            done(picks);
        });
    }

    function openTorrents(item) {
        var c = rubyDesktop.card(item);
        Lampa.Activity.push({ url: '', title: Lang('Torrents'), component: 'torrents', search: c.title, search_one: c.title,
            search_two: c.original_title, movie: c, page: 1 });
    }

    function Lang(s) { return (Lampa.Lang && Lampa.Lang.translate('title_torrents')) || s; }

    function build(list) {
        var el = document.createElement('div');
        el.className = 'ruby-hero';
        el.innerHTML = '<div class="ruby-hero__bg"></div><div class="ruby-hero__bg"></div>' +
            '<div class="ruby-hero__body"></div><div class="ruby-hero__dots"></div>';
        var bgs = el.querySelectorAll('.ruby-hero__bg'), body = el.querySelector('.ruby-hero__body'),
            dots = el.querySelector('.ruby-hero__dots'), idx = -1, front = 0, timer, hover = false;
        var trailer = window.rubyTrailer ? rubyTrailer.attach(el, {
            visible: function () { return heroVisible(el); },
            onEnded: function () { show(idx + 1); }
        }) : null;

        list.forEach(function (_, i) {
            var d = document.createElement('div');
            d.className = 'ruby-hero__dot';
            d.addEventListener('click', function () { show(i); });
            dots.appendChild(d);
        });

        function show(i) {
            idx = (i + list.length) % list.length;
            var item = list[idx], year = (item.release_date || item.first_air_date || '').slice(0, 4);
            front = 1 - front;
            bgs[front].style.backgroundImage = 'url(' + Lampa.TMDB.image('t/p/original' + item.backdrop_path) + ')';
            bgs[front].classList.add('show');
            bgs[1 - front].classList.remove('show');
            [].forEach.call(dots.children, function (d, n) { d.classList.toggle('active', n === idx); });
            body.innerHTML = '<div class="ruby-hero__title"></div>' +
                '<div class="ruby-hero__meta"><span class="ruby-hero__badge">' + (item.media_type === 'tv' ? 'Series' : 'Movie') + '</span>' +
                (year ? '<span>' + year + '</span>' : '') +
                (item.vote_average ? '<span>★ ' + item.vote_average.toFixed(1) + '</span>' : '') + '</div>' +
                '<div class="ruby-hero__text"></div>' +
                '<div class="ruby-hero__btns"><div class="ruby-hero__btn ruby-hero__btn--play">' + rubyIcons.svg('play') + 'Play</div>' +
                '<div class="ruby-hero__btn ruby-hero__btn--info">' + rubyIcons.svg('info') + 'More info</div></div>';
            body.querySelector('.ruby-hero__title').textContent = item.title || item.name;
            body.querySelector('.ruby-hero__text').textContent = item.overview;
            body.querySelector('.ruby-hero__btn--play').addEventListener('click', function () { openTorrents(item); });
            body.querySelector('.ruby-hero__btn--info').addEventListener('click', function () { rubyDesktop.openFull(item); });
            if (trailer) trailer.show(item);
            rubyDesktop.logo(item, function (src) {
                if (!src || list[idx] !== item) return;
                var img = new Image();
                img.className = 'ruby-hero__logo';
                img.alt = item.title || item.name;
                img.onload = function () { var t = body.querySelector('.ruby-hero__title'); if (t && list[idx] === item) t.replaceWith(img); };
                img.src = src;
            });
        }

        // Back on Home from a title page, Lampa re-focuses the last used poster and scrolls it into place,
        // which leaves ~46 of 535 px of the billboard on screen (measured 2026-10-13). If the billboard was
        // in view when Home was left, put it back in view, then pick the trailer up again straight away.
        var leftInView = true;
        var track = setInterval(function () {
            if (!document.body.contains(el)) return clearInterval(track);
            if (el.closest('.activity--active')) leftInView = heroVisible(el) || leftInView && document.hidden;
        }, 300);
        Lampa.Listener.follow('activity', function (e) {
            if (e.type !== 'start' || e.component !== 'main' || idx < 0 || !document.body.contains(el)) return;
            // Lampa's re-centring animates for ~600 ms and can be re-triggered, so keep correcting until the
            // billboard is really in view (max ~2 s), then resume the trailer
            var tries = 0, back = setInterval(function () {
                var page = el.closest('.scroll:not(.scroll--horizontal)');
                if (leftInView && !heroVisible(el) && page && page.Scroll && tries < 8) {
                    var p = page.Scroll.params(), was = p.scroll_by_item;
                    p.scroll_by_item = false;
                    try { page.Scroll.wheel(-100000); } finally { p.scroll_by_item = was; }
                }
                if (heroVisible(el) || ++tries >= 8) {
                    clearInterval(back);
                    if (trailer && heroVisible(el) && !trailer.busy()) trailer.show(list[idx]);
                }
            }, 250);
        });
        el.addEventListener('mouseenter', function () { hover = true; });
        el.addEventListener('mouseleave', function () { hover = false; });
        timer = setInterval(function () {
            if (!document.body.contains(el)) return clearInterval(timer);
            if (!hover && !(trailer && trailer.busy()) && !document.hidden) show(idx + 1);
        }, ROTATE_MS);
        show(0);
        return el;
    }

    function mount(object) {
        if (!enabled() || !object || !object.activity) return;
        var root = object.activity.render(true), tries = 0;
        var t = setInterval(function () {
            var first = root.querySelector('.items-line');
            if (!first && ++tries < 60) return;
            clearInterval(t);
            if (!first || root.querySelector('.ruby-hero')) return;
            loadPicks(function (list) {
                if (list.length && !root.querySelector('.ruby-hero')) first.parentNode.insertBefore(build(list), first);
            });
        }, 150);
    }

    function start() {
        if (Lampa.Platform.tv()) return;
        var style = document.createElement('style');
        style.id = 'ruby-hero';
        style.textContent = CSS;
        document.head.appendChild(style);
        Lampa.SettingsApi.addParam({
            component: 'interface',
            param: { name: KEY, type: 'trigger', default: true },
            field: { name: 'Featured on Home', description: 'Large rotating trending title at the top of Home' }
        });
        Lampa.Listener.follow('activity', function (e) {
            if (e.component === 'main' && (e.type === 'start' || e.type === 'create')) mount(e.object);
        });
        var cur = Lampa.Activity.active && Lampa.Activity.active();
        if (cur && cur.component === 'main') mount(cur);
    }

    var t = setInterval(function () {
        // wait for desktop.js (enabled() needs rubyDesktop) and trailer.js (rubyTrailer)
        if (!window.Lampa || !Lampa.Listener || !Lampa.TMDB || !Lampa.Activity || !Lampa.SettingsApi || !Lampa.Platform || !Lampa.Player ||
            !window.rubyDesktop || !rubyDesktop.tmdb || !window.rubyTrailer || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 100);
})();
