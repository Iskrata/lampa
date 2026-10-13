// Netflix-style top bar for Lampa on computers (desktop/README.md). Loaded by index.html.
// Lampa's header is a TV header: hamburger + "Home - TMDB" title + a row of small icons. On computers it
// becomes: red wordmark, text links that drive Lampa's own menu items (each .menu__item has a
// data-action; clicking goes through Lampa's 'hover:enter' so its own navigation runs), the active page
// in bold, then search and the profile avatar with its menu (switch profile, manage profiles, Trakt,
// history, settings) on the right. A soft dark gradient over the page top, solid once the page scrolls.
// Lampa's own back arrow is kept (there is no other way back for a mouse) but hidden on Home.
// Active only where desktop.js is (rubyDesktop.active()); never on TVs.
(function () {
    var NEW_POPULAR = { url: 'trending/all/week', title: 'New & Popular', component: 'category_full', source: 'tmdb', card_type: true, page: 1 };
    // label -> how to open it, and which activity counts as "on this page"
    var LINKS = [
        { label: 'Home',          action: 'main',     is: function (a) { return a.component === 'main'; } },
        { label: 'TV Shows',      action: 'tv',       is: function (a) { return a.url === 'tv' && a.component !== 'main'; } },
        { label: 'Movies',        action: 'movie',    is: function (a) { return a.url === 'movie' && a.component !== 'main'; } },
        { label: 'Animation',     action: 'cartoon',  is: function (a) { return a.url === 'cartoon' || (a.genres + '') === '16'; } },
        { label: 'New & Popular', open: NEW_POPULAR,  is: function (a) { return a.url === NEW_POPULAR.url; } },
        { label: 'My List',       action: 'favorite', is: function (a) { return a.component === 'favorite' || a.component === 'bookmarks'; } },
        { label: 'Trakt',         trakt: true,        is: function (a) { return /trakt/i.test(a.component || '') || /trakt/i.test(a.source || ''); } }
    ];
    var HISTORY = { action: 'history' };

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
        '.ruby-nav__me:hover .ruby-nav__menu{display:block}',
        '.ruby-nav__panel{min-width:17em;background:rgba(0,0,0,.92);border:1px solid rgba(255,255,255,.15);font-size:1.1em;position:relative}',
        '.ruby-nav__panel::before{content:"";position:absolute;right:1.6em;top:-.9em;border:.45em solid transparent;border-bottom-color:#e5e5e5}',
        '.ruby-nav__item{display:flex;align-items:center;gap:.8em;padding:.55em 1em;color:#e5e5e5;white-space:nowrap}',
        '.ruby-nav__item:hover span{text-decoration:underline}',
        '.ruby-nav__item .ruby-avatar{width:2.4em;height:2.4em}',
        '.ruby-nav__item>.ruby-icon{font-size:1.5em;margin:0 .05em;color:#b3b3b3}',
        '.ruby-nav__sep{border-top:1px solid rgba(255,255,255,.25);margin:.4em 0}',
        '.ruby-nav__foot{padding:.8em 1em;text-align:center;font-size:.95em;color:#e5e5e5;border-top:1px solid rgba(255,255,255,.25)}',
        '.ruby-nav__foot:hover{text-decoration:underline}',
        '@media (max-width: 1000px){.ruby-nav__link:nth-of-type(n+6){display:none}}'
    ].join('\n');

    var nav, menu;

    function menuItem(link) {
        var items = document.querySelectorAll('.menu .menu__item');
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (link.action && it.dataset.action === link.action) return it;
            if (link.trakt && (it.classList.contains('trakt-menu') || /trakt/i.test(it.innerText + it.className + (it.dataset.component || '')))) return it;
        }
        // the Trakt plugin's menu entry has no data-action: fall back to the item without one, before Settings
        if (link.trakt) return [].filter.call(items, function (it) { return !it.dataset.action; })[0] || null;
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
        el.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
        return el;
    }
    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    // rebuilt on every open: profiles and the Trakt state can change
    function fillMenu() {
        var panel = menu.firstChild, me = rubyProfiles.current();
        panel.innerHTML = '';
        rubyProfiles.list().filter(function (p) { return p.id !== me.id; }).forEach(function (p) {
            panel.appendChild(item(rubyProfiles.avatar(p) + '<span>' + esc(p.name) + '</span>', function () { rubyProfiles.switchTo(p.id); }));
        });
        panel.appendChild(item(rubyIcons.svg('pencil') + '<span>Manage Profiles</span>', rubyProfiles.manage));
        var sep = document.createElement('div'); sep.className = 'ruby-nav__sep'; panel.appendChild(sep);
        var tk = item(rubyIcons.svg('link') + '<span>' + (rubyTrakt.connected() ? 'Trakt' : 'Connect Trakt') + '</span>', function () {
            if (rubyTrakt.connected()) go(LINKS[6]); else rubyTrakt.connect();
        });
        panel.appendChild(tk);
        rubyTrakt.user(function (u) { if (u) tk.querySelector('span').textContent = 'Trakt: ' + u; });
        panel.appendChild(item(rubyIcons.svg('history') + '<span>History</span>', function () { go(HISTORY); }));
        panel.appendChild(item(rubyIcons.svg('gear') + '<span>Settings</span>', function () { action('open--settings'); }));
        var foot = document.createElement('div');
        foot.className = 'ruby-nav__foot';
        foot.textContent = 'Switch profile';
        foot.addEventListener('click', function (e) { e.stopPropagation(); rubyProfiles.picker(); });
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
        brand.textContent = 'Lampa';
        brand.addEventListener('click', function () { go(LINKS[0]); });
        nav.appendChild(brand);
        LINKS.forEach(function (l) {
            var a = document.createElement('div');
            a.className = 'ruby-nav__link';
            a.textContent = l.label;
            a.addEventListener('click', function () { go(l); });
            nav.appendChild(a);
        });
        var right = document.createElement('div'), me = rubyProfiles.current();
        right.className = 'ruby-nav__right';
        right.innerHTML = '<div class="ruby-nav__icon" title="Search">' + rubyIcons.svg('search') + '</div>' +
            '<div class="ruby-nav__me" title="' + esc(me.name) + '">' + rubyProfiles.avatar(me) + '<span class="ruby-nav__caret">' + rubyIcons.svg('caret') + '</span>' +
            '<div class="ruby-nav__menu"><div class="ruby-nav__panel"></div></div></div>';
        right.firstChild.addEventListener('click', function () { action('open--search'); });
        menu = right.querySelector('.ruby-nav__menu');
        right.querySelector('.ruby-nav__me').addEventListener('mouseenter', fillMenu);
        right.querySelector('.ruby-nav__me').addEventListener('click', function () { fillMenu(); });
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

    function start() {
        if (!rubyDesktop.active()) return;
        var tries = 0, t = setInterval(function () {
            if (build() || ++tries > 50) {
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
            !window.rubyProfiles || !window.rubyTrakt || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 100);
})();
