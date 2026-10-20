// A series' episodes on its title page, as on Netflix (desktop/README.md, "Episodes"): a season picker and
// every episode of that season in a list, with its number, picture, name, length, a line of what happens
// and how much of it you've watched. A click plays it (play.js). Replaces Lampa's row of one season's
// untitled stills with a "More" tile that opened another page (simplicity review 2026-10-20). Opens at the
// season you're in (resume.js). Only seasons that have started airing. Active only where desktop.js is,
// with "Pick torrents for me" on (else an episode click is Lampa's own).
(function () {
    var CSS = [
        // lined up with Lampa's own rows (their heads are padded 1.5em; a row keeps 1em of it for its hover)
        '.ruby-eps{padding:0 1.5em 2.5em .5em;max-width:70em}',
        '.ruby-eps__head{display:flex;align-items:center;gap:1.2em;margin-bottom:1em;padding-left:1em}',
        '.ruby-eps__title{font-size:1.6em;font-weight:700}',
        '.ruby-eps__season{font:inherit;font-size:1.05em;color:#fff;background:#242424;border:1px solid rgba(255,255,255,.35);border-radius:.3em;padding:.4em 2em .4em .8em;cursor:pointer}',
        '.ruby-eps__list{display:flex;flex-direction:column}',
        '.ruby-ep{display:grid;grid-template-columns:2.2em 12em minmax(0,1fr);gap:1.2em;align-items:center;padding:1.1em 1em;border-bottom:1px solid rgba(255,255,255,.1);border-radius:.4em;cursor:pointer}',
        '.ruby-ep:hover,.ruby-ep.focus{background:rgba(255,255,255,.08)}',
        '.ruby-ep--soon{cursor:default;opacity:.55}.ruby-ep--soon:hover{background:none}',
        '.ruby-ep__num{font-size:1.5em;color:#bbb;text-align:center}',
        '.ruby-ep__img{position:relative;aspect-ratio:16/9;border-radius:.3em;overflow:hidden;background:#222 center/cover no-repeat}',
        '.ruby-ep__bar{position:absolute;left:0;right:0;bottom:0;height:.25em;background:rgba(255,255,255,.3)}',
        '.ruby-ep__bar i{display:block;height:100%;background:#e50914}',
        '.ruby-ep__top{display:flex;justify-content:space-between;gap:1em;margin-bottom:.35em}',
        '.ruby-ep__name{font-size:1.15em;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.ruby-ep__len{flex:none;color:#bbb}',
        '.ruby-ep__text{color:#bbb;font-size:.95em;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
        '@media (max-width: 600px){.ruby-ep{grid-template-columns:9em minmax(0,1fr);gap:.8em;padding:.8em .2em}.ruby-ep__num{display:none}}',
        // Lampa's own row of the season's stills and its "More" tile give way
        'body.ruby-title .items-line.ruby-eps-old{display:none!important}'
    ].join('\n');

    var FINISHED = 90;

    function hash(show, s, e) {
        return Lampa.Utils.hash([s, s > 10 ? ':' : '', e, show.original_name || show.original_title].join(''));
    }
    function today() { return new Date().toISOString().slice(0, 10); }
    function seasons(show) {
        return (show.seasons || []).filter(function (s) { return s.season_number > 0 && s.air_date && s.air_date <= today() && s.episode_count; });
    }
    function esc(t) { var d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }

    function row(show, ep) {
        var el = document.createElement('div'), aired = ep.air_date && ep.air_date <= today();
        var v = Lampa.Timeline.view(hash(show, ep.season_number, ep.episode_number)) || {};
        var pct = v.percent || 0;
        el.className = 'ruby-ep selector' + (aired ? '' : ' ruby-ep--soon');
        el.innerHTML = '<div class="ruby-ep__num">' + ep.episode_number + '</div>' +
            '<div class="ruby-ep__img"' + (ep.still_path ? ' style="background-image:url(' + Lampa.TMDB.image('t/p/w300' + ep.still_path) + ')"' : '') + '>' +
            (pct ? '<div class="ruby-ep__bar"><i style="width:' + Math.min(100, pct) + '%"></i></div>' : '') + '</div>' +
            '<div><div class="ruby-ep__top"><div class="ruby-ep__name">' + esc(ep.name) + '</div><div class="ruby-ep__len">' +
            (aired ? (ep.runtime ? ep.runtime + ' min' : '') : 'Coming ' + Lampa.Utils.parseTime(ep.air_date).full) + '</div></div>' +
            '<div class="ruby-ep__text">' + esc(ep.overview) + '</div></div>';
        if (aired) {
            var go = function () { rubyPlay.episode(show, { season: ep.season_number, episode: ep.episode_number }); };
            el.addEventListener('click', go);
            $(el).on('hover:enter', go);
        }
        return el;
    }

    function fill(box, show, n) {
        var list = box.querySelector('.ruby-eps__list');
        list.innerHTML = '';
        rubyDesktop.tmdb('tv/' + show.id + '/season/' + n, function (d) {
            if (!d || !d.episodes || box.dataset.season != n) return;
            d.episodes.forEach(function (ep) { list.appendChild(row(show, ep)); });
        });
    }

    function build(root, show) {
        var all = seasons(show), body = root.querySelector('.scroll__body');
        if (!all.length || !body) return;
        var old = [].filter.call(body.querySelectorAll(':scope > .items-line'), function (l) { return l.querySelector('.full-episode'); })[0];
        var box = root.querySelector('.ruby-eps') || document.createElement('div');
        box.className = 'ruby-eps';
        box.innerHTML = '<div class="ruby-eps__head"><div class="ruby-eps__title">Episodes</div>' +
            (all.length > 1 ? '<select class="ruby-eps__season" aria-label="Season">' + all.map(function (s) {
                return '<option value="' + s.season_number + '">Season ' + s.season_number + '</option>';
            }).join('') + '</select>' : '<div class="ruby-eps__one">Season ' + all[0].season_number + '</div>') +
            '</div><div class="ruby-eps__list"></div>';
        if (old) { old.classList.add('ruby-eps-old'); body.insertBefore(box, old); }
        else body.insertBefore(box, body.querySelector('.ruby-more'));
        var pickSeason = function (n) {
            box.dataset.season = n;
            var sel = box.querySelector('select');
            if (sel) sel.value = n;
            fill(box, show, n);
        };
        var sel = box.querySelector('select');
        if (sel) sel.addEventListener('change', function () { pickSeason(+sel.value); });
        // the season you're in: the episode Play would start (resume.js), else the first
        pickSeason(all[0].season_number);
        rubyResume.where(show, function (r) {
            if (r && r.season && r.season !== all[0].season_number && all.some(function (s) { return s.season_number === r.season; })) pickSeason(r.season);
        });
    }

    function start() {
        if (!rubyDesktop.active()) return;
        var st = document.createElement('style');
        st.id = 'ruby-eps';
        st.textContent = CSS;
        document.head.appendChild(st);
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite' || !e.object || e.object.method !== 'tv' || !e.data || !e.data.movie || !rubyPlay.on()) return;
            var root = e.object.activity.render(true);
            root = root.jquery ? root[0] : root;
            build(root, e.data.movie);
        });
        // progress saved while watching (or the player closed): the bars follow
        var soon = 0;
        Lampa.Listener.follow('state:changed', function (e) {
            if (!e || e.target !== 'timeline') return;
            clearTimeout(soon);
            soon = setTimeout(function () {
                var box = document.querySelector('.activity--active .ruby-eps'), a = Lampa.Activity.active() || {};
                if (box && a.card) fill(box, a.card, +box.dataset.season);
            }, 600);
        });
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Timeline || !window.rubyDesktop || !rubyDesktop.tmdb || !window.rubyPlay || !rubyPlay.episode || !window.rubyResume) return;
        clearInterval(t);
        start();
    }, 100);
})();
