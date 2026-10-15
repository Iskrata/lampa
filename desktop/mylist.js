// "My List" from anywhere (desktop/README.md, "My List"): a round + on every poster while it is pointed at,
// a My List button on the Home billboard (hero.js: rubyMyList.button(item)), and the title page's bookmark
// button saving with one click (no menu of lists). Both are Lampa's own
// Bookmarks list (Lampa.Favorite 'book'), the one the title page's bookmark button and the top bar's My List
// show, per profile. A tick when the title is in it; the click toggles.
// Active only where desktop.js is.
(function () {
    var CSS = [
        '.ruby-add{position:absolute;z-index:4;top:.5em;right:.5em;width:2em;height:2em;border-radius:50%;display:flex;align-items:center;justify-content:center;',
        '  background:rgba(20,20,20,.75);border:1.5px solid rgba(255,255,255,.7);color:#fff;cursor:pointer;opacity:0;transition:opacity .15s,transform .15s}',
        '.ruby-add .ruby-icon{font-size:1.15em}',
        '.card:hover .ruby-add,.card.focus .ruby-add,.ruby-add.in{opacity:1}',
        '.ruby-add:hover{transform:scale(1.12);border-color:#fff}',
        '.ruby-hero__btn--list{background:rgba(109,109,110,.7);color:#fff}'
    ].join('\n');

    // what Lampa stores and matches (by id; name/original_name/first_air_date tell it a series)
    function card(item) { return Object.assign(rubyDesktop.card(item), { source: item.source || 'tmdb' }); }
    function has(item) { return !!(item && item.id && Lampa.Favorite.check(item).book); }
    function toggle(item) { Lampa.Favorite.toggle('book', card(item)); }

    function paint(el, item) {
        var on = has(item);
        el.classList.toggle('in', on);
        el.title = on ? 'Remove from My List' : 'Add to My List';
        var label = el.querySelector('.ruby-add__label');
        el.innerHTML = rubyIcons.svg(on ? 'check' : 'plus') + (label ? '<span class="ruby-add__label">My List</span>' : '');
    }

    // a click on the button must not reach the card (that opens the title) nor start a long-press
    function own(el, item) {
        ['mousedown', 'pointerdown', 'contextmenu', 'touchstart'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.stopPropagation(); }); });
        el.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); toggle(item); });
        el._rubyItem = item;
        paint(el, item);
    }

    // the + on a poster, added the first time it is pointed at
    function onPoster(e) {
        var c = e.target.closest && e.target.closest('.card');
        if (!c || !c.card_data || c.querySelector('.ruby-add')) return;
        var view = c.querySelector('.card__view');
        if (!view || !c.card_data.id) return;
        var b = document.createElement('div');
        b.className = 'ruby-add';
        view.appendChild(b);
        own(b, c.card_data);
    }

    // the billboard's button: hero.js puts it after Play / More info
    function button(item) {
        var b = document.createElement('div');
        b.className = 'ruby-hero__btn ruby-hero__btn--list';
        b.innerHTML = '<span class="ruby-add__label"></span>';
        own(b, item);
        return b;
    }

    function start() {
        if (!rubyDesktop.active()) return;
        var style = document.createElement('style');
        style.id = 'ruby-mylist';
        style.textContent = CSS;
        document.head.appendChild(style);
        document.addEventListener('mouseover', onPoster, true);
        // the title page's bookmark button: one click saves to (or removes from) My List, instead of Lampa's
        // menu of Bookmarks / Like / Later / history / statuses. Capture phase: before Lampa's own handler.
        document.addEventListener('hover:enter', function (e) {
            if (!e.target.closest || !e.target.closest('.button--book')) return;
            var a = Lampa.Activity.active() || {}, item = a.card || a.movie;
            if (!item || !item.id) return;
            e.stopImmediatePropagation();
            toggle(item);
            Lampa.Noty.show(has(item) ? 'Added to My List' : 'Removed from My List');
        }, true);
        // added or removed anywhere (here, the title page, another tab of this profile): repaint what's shown
        Lampa.Listener.follow('state:changed', function (e) {
            if (e.target !== 'favorite') return;
            [].forEach.call(document.querySelectorAll('.ruby-add, .ruby-hero__btn--list'), function (el) { if (el._rubyItem) paint(el, el._rubyItem); });
        });
    }

    window.rubyMyList = { button: button, has: has, toggle: toggle };

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Favorite || !Lampa.Listener || !window.rubyDesktop || !rubyDesktop.active || !rubyDesktop.card || !window.rubyIcons) return;
        clearInterval(t);
        start();
    }, 100);
})();
