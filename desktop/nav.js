// Netflix-style top bar for Lampa on computers (desktop/README.md). Loaded by index.html.
// Lampa's header is a TV header: hamburger + "Home - TMDB" title + a row of small icons. On computers it
// becomes: red wordmark, text links that drive Lampa's own menu items (each .menu__item has a
// data-action; clicking goes through Lampa's 'hover:enter' so its own navigation runs), the active page
// in bold, then search and the profile avatar with its menu (who you are, other profiles, manage profiles,
// settings, switch profile) on the right. Lampa's side menu never opens here (noSideMenu). A soft dark gradient over the page top, solid once the page scrolls.
// Lampa's own back arrow is kept (there is no other way back for a mouse) but hidden on Home.
// Active only where desktop.js is (rubyDesktop.active()); never on TVs.
(function () {
    var MY_LIST = { url: '', title: 'My List', component: 'favorite', type: 'book', page: 1 };
    var NEW_POPULAR = { url: 'trending/all/week', title: 'New & Popular', component: 'category_full', source: 'tmdb', card_type: true, page: 1 };
    // label -> how to open it, and which activity counts as "on this page"
    var LINKS = [
        { label: 'Home',          action: 'main',     is: function (a) { return a.component === 'main'; } },
        { label: 'TV Shows',      action: 'tv',       is: function (a) { return a.url === 'tv' && a.component !== 'main'; } },
        { label: 'Movies',        action: 'movie',    is: function (a) { return a.url === 'movie' && a.component !== 'main'; } },
        { label: 'Animation',     action: 'cartoon',  is: function (a) { return a.url === 'cartoon' || (a.genres + '') === '16'; } },
        { label: 'New & Popular', open: NEW_POPULAR,  is: function (a) { return a.url === NEW_POPULAR.url; } },
        // only the Bookmarks list (what the + buttons add to), not Lampa's all-favourites overview
        { label: 'My List',       open: MY_LIST,      is: function (a) { return a.component === 'favorite' || a.component === 'bookmarks'; } }
    ];
    // No Trakt link (simplicity review 2026-10-20): its menu of nine lists repeated My List and History, friends
    // don't use Trakt, and closing that menu landed in Lampa's side menu. Trakt keeps working underneath.

    // no bottom border: a gradient background repeats into a transparent border (background-origin is the
    // padding box), which drew a dark 1 px line under the bar. No backdrop blur either: the bar is nearly
    // opaque once scrolled, and a blur over the always-moving colour orbs costs a re-render every frame
    var CSS = [
        '.head{transition:background .35s;background:rgba(20,20,20,.94)!important;border-bottom:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
        'body.ruby-nav-top .head{background:linear-gradient(180deg,rgba(0,0,0,.75) 10%,rgba(0,0,0,0))!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
        // TV-only header parts; Lampa's own action icons are replaced by ours (they are still clicked through)
        '.head__title,.head__logo-icon,.head__menu-icon,.head__actions>.head__action{display:none!important}',
        'body.ruby-at-home .head__backward{display:none!important}',
        '.head__backward{opacity:.8}.head__backward:hover{opacity:1}',
        '.ruby-nav{display:flex;align-items:center;gap:1.7em;margin-left:2.5%;flex:1;min-width:0}',
        '.ruby-nav__links{display:flex;align-items:center;gap:1.7em;min-width:0}',
        '.ruby-nav__brand{font-weight:900;font-size:2em;letter-spacing:-.02em;color:#e50914;text-transform:uppercase;margin-right:1em;cursor:pointer;white-space:nowrap;transform:scaleY(1.12)}',
        '.ruby-nav__link{font-size:1.2em;color:#e5e5e5;cursor:pointer;white-space:nowrap;transition:color .3s}',
        '.ruby-nav__link:hover{color:#b3b3b3}',
        '.ruby-nav__link.active{color:#fff;font-weight:700;cursor:default}',
        '.ruby-nav__right{display:flex;align-items:center;gap:1.6em;margin-left:auto;padding-right:3.5%}',
        '.ruby-nav__icon{font-size:1.8em;color:#fff;cursor:pointer;display:flex}',
        '.ruby-nav__me{position:relative;display:flex;align-items:center;gap:.5em;cursor:pointer}',
        '.ruby-nav__me>.ruby-avatar{width:2.5em;height:2.5em}',
        '.ruby-nav__caret{color:#fff;font-size:1.3em;display:flex;transition:transform .3s}',
        '.ruby-nav__me:hover .ruby-nav__caret{transform:rotate(180deg)}',
        // the menu: Netflix's black dropdown, kept open while the pointer travels into it
        '.ruby-nav__menu{position:absolute;right:0;top:100%;padding-top:1.4em;display:none;z-index:50}',
        'body:not(.touch-device) .ruby-nav__me:hover .ruby-nav__menu,.ruby-nav__me.open .ruby-nav__menu{display:block}',
        '.ruby-nav__panel{min-width:17em;background:rgba(0,0,0,.92);border:1px solid rgba(255,255,255,.15);font-size:1.1em;position:relative}',
        '.ruby-nav__panel::before{content:"";position:absolute;right:1.6em;top:-.9em;border:.45em solid transparent;border-bottom-color:#e5e5e5}',
        '.ruby-nav__item{display:flex;align-items:center;gap:.8em;padding:.55em 1em;color:#e5e5e5;white-space:nowrap}',
        '.ruby-nav__item:hover span{text-decoration:underline}',
        '.ruby-nav__who{font-weight:700;color:#fff}.ruby-nav__who:hover span{text-decoration:none}',
        '.ruby-nav__item .ruby-avatar{width:2.4em;height:2.4em}',
        '.ruby-nav__item>.ruby-icon{font-size:1.5em;margin:0 .05em;color:#b3b3b3}',
        '.ruby-nav__sep{border-top:1px solid rgba(255,255,255,.25);margin:.4em 0}',
        '.ruby-nav__foot{padding:.8em 1em;text-align:center;font-size:.95em;color:#e5e5e5;border-top:1px solid rgba(255,255,255,.25)}',
        '.ruby-nav__foot:hover{text-decoration:underline}',
        '@media (max-width: 1000px){body:not(.touch-device) .ruby-nav__link:nth-of-type(n+5){display:none}}',
        // touch: the links scroll sideways instead of being cut (all seven fit nowhere on a phone), faded at the
        // right edge; the profile menu opens on tap (no hover), and taps on the page close it
        'body.touch-device .ruby-nav__links{flex:1;overflow-x:auto;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 85%,transparent);mask-image:linear-gradient(90deg,#000 85%,transparent);padding-right:2em}',
        'body.touch-device .ruby-nav__links::-webkit-scrollbar{display:none}',
        'body.touch-device .ruby-nav__caret{display:none}',
        // phones: a tighter bar, and no room for Lampa's page counter ("4 / 500" on grid pages)
        '@media (max-width: 600px){.head__navigator{display:none!important}.ruby-nav{gap:1em;margin-left:0}.ruby-nav__brand{font-size:1.6em;margin-right:0}.ruby-nav__links{gap:1.3em}.ruby-nav__link{font-size:1.15em}.ruby-nav__right{gap:1.1em;padding-right:0}.ruby-nav__icon{font-size:1.6em}.ruby-nav__me>.ruby-avatar{width:2.2em;height:2.2em}}'
    ].join('\n');

    var nav, menu;

    function menuItem(link) {
        var items = document.querySelectorAll('.menu .menu__item');
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (link.action && it.dataset.action === link.action) return it;
        }
        return null;
    }

    function go(link) {
        if (link.open) return Lampa.Activity.push(Object.assign({}, link.open));
        var it = menuItem(link);
        if (it && window.$) $(it).trigger('hover:enter');
    }
    function action(cls) { var el = document.querySelector('.head__actions .' + cls); if (el && window.$) $(el).trigger('hover:enter'); }

    function markActive() {
        if (!nav) return;
        var a = (Lampa.Activity.active && Lampa.Activity.active()) || {};
        [].forEach.call(nav.querySelectorAll('.ruby-nav__link'), function (el, i) {
            var on = false;
            try { on = LINKS[i].is(a); } catch (e) {}
            el.classList.toggle('active', on);
        });
        document.body.classList.toggle('ruby-at-home', a.component === 'main');
    }

    function item(html, onClick) {
        var el = document.createElement('div');
        el.className = 'ruby-nav__item';
        el.innerHTML = html;
        el.addEventListener('click', function (e) { e.stopPropagation(); close(); onClick(); });
        return el;
    }
    function close() { var m = document.querySelector('.ruby-nav__me.open'); if (m) m.classList.remove('open'); }
    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    // rebuilt on every open: profiles can change. Netflix's order (simplicity review 2026-10-20): who you are,
    // the other profiles, Manage Profiles, Settings, Switch profile. Trakt moved into Settings, and History
    // into Home's Continue watching.
    function fillMenu() {
        var panel = menu.firstChild, me = rubyProfiles.current();
        panel.innerHTML = '';
        var who = document.createElement('div');
        who.className = 'ruby-nav__item ruby-nav__who';
        who.innerHTML = rubyProfiles.avatar(me) + '<span>' + esc(me.name) + '</span>';
        panel.appendChild(who);
        var sep0 = document.createElement('div'); sep0.className = 'ruby-nav__sep'; panel.appendChild(sep0);
        rubyProfiles.list().filter(function (p) { return p.id !== me.id; }).forEach(function (p) {
            panel.appendChild(item(rubyProfiles.avatar(p) + '<span>' + esc(p.name) + '</span>', function () { rubyProfiles.switchTo(p.id); }));
        });
        panel.appendChild(item(rubyIcons.svg('pencil') + '<span>Manage Profiles</span>', rubyProfiles.manage));
        panel.appendChild(item(rubyIcons.svg('gear') + '<span>Settings</span>', function () { if (window.rubySettings) rubySettings.open(); else action('open--settings'); }));
        var foot = document.createElement('div');
        foot.className = 'ruby-nav__foot';
        foot.textContent = 'Switch profile';
        foot.addEventListener('click', function (e) { e.stopPropagation(); close(); rubyProfiles.picker(); });
        panel.appendChild(foot);
    }

    function build() {
        var body = document.querySelector('.head__body'), actions = document.querySelector('.head__actions');
        if (!body || !actions) return false;
        var style = document.createElement('style');
        style.id = 'ruby-nav';
        style.textContent = CSS;
        document.head.appendChild(style);
        nav = document.createElement('div');
        nav.className = 'ruby-nav';
        var brand = document.createElement('div');
        brand.className = 'ruby-nav__brand';
        brand.textContent = window.lampa_brand || 'Lampa';   // a host can name its install (window.lampa_brand, set before Lampa loads)
        brand.addEventListener('click', function () { go(LINKS[0]); });
        if (window.lampa_brand) document.title = window.lampa_brand;
        nav.appendChild(brand);
        var links = document.createElement('div');
        links.className = 'ruby-nav__links';
        LINKS.forEach(function (l) {
            var a = document.createElement('div');
            a.className = 'ruby-nav__link';
            a.textContent = l.label;
            a.addEventListener('click', function () { go(l); });
            links.appendChild(a);
        });
        nav.appendChild(links);
        var right = document.createElement('div'), me = rubyProfiles.current();
        right.className = 'ruby-nav__right';
        right.innerHTML = '<div class="ruby-nav__icon" title="Search">' + rubyIcons.svg('search') + '</div>' +
            '<div class="ruby-nav__me" title="' + esc(me.name) + '">' + rubyProfiles.avatar(me) + '<span class="ruby-nav__caret">' + rubyIcons.svg('caret') + '</span>' +
            '<div class="ruby-nav__menu"><div class="ruby-nav__panel"></div></div></div>';
        right.firstChild.addEventListener('click', function () { action('open--search'); });
        menu = right.querySelector('.ruby-nav__menu');
        right.querySelector('.ruby-nav__me').addEventListener('mouseenter', fillMenu);
        var meEl = right.querySelector('.ruby-nav__me');
        meEl.addEventListener('click', function (e) {
            if (e.target.closest('.ruby-nav__menu')) return;
            fillMenu();
            if (rubyDesktop.touch()) meEl.classList.toggle('open');
        });
        document.addEventListener('click', function (e) { if (!meEl.contains(e.target)) meEl.classList.remove('open'); }, true);
        nav.appendChild(right);
        body.insertBefore(nav, actions);
        return true;
    }

    // "top" = the active page's own scroller is at (or near) its start; then the bar is transparent
    function watchScroll() {
        setInterval(function () {
            document.body.classList.toggle('ruby-nav-top', rubyDesktop.pageY() > -24);
        }, 200);
    }

    // Lampa's side menu (Persons, Catalog, Torrents, Console, Edit…) opens on Back from some sheets and on Left
    // at a row's first poster (app.min.js Controller.toggle('menu')). Here the top bar is the menu, so those
    // go to the top bar (simplicity review 2026-10-20: Esc after the Trakt menu opened it). TVs keep it.
    // Also: Lampa's text box (search, PINs) puts the focus in the box only on phones (app.min.js keyboard toggle,
    // collectionFocus(mobile ? input : false)), so on a computer typing went nowhere until the box was clicked
    // (simplicity review 2026-10-20).
    function noSideMenu() {
        var toggle = Lampa.Controller.toggle;
        Lampa.Controller.toggle = function (name) {
            if (name === 'menu' && rubyDesktop.active()) name = 'head';
            var out = toggle.apply(this, [name].concat([].slice.call(arguments, 1)));
            if (name === 'keybord' && rubyDesktop.active() && !rubyDesktop.touch()) {
                var box = document.querySelector('.simple-keyboard-input');
                if (box) { box.removeAttribute('disabled'); box.focus(); }
            }
            return out;
        };
    }

    function start() {
        if (!rubyDesktop.active()) return;
        noSideMenu();
        var tries = 0, t = setInterval(function () {
            // Lampa's header can take a while (a slow plugin or server): keep trying for a minute, not 5 s
            if (build() || ++tries > 600) {
                clearInterval(t);
                document.body.classList.add('ruby-nav-ready');   // desktop.js keeps the TV header hidden until now
                markActive();
                Lampa.Listener.follow('activity', function (e) { if (e.type === 'start') setTimeout(markActive, 50); });
                watchScroll();
            }
        }, 100);
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Activity || !window.rubyDesktop || !rubyDesktop.active ||
            !window.rubyProfiles || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 100);
})();
