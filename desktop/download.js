// Download (desktop/README.md "Download"): a title page button that makes the film, or an episode, into an MP4
// to keep on this device for watching offline (server/remux/download.js); on an iPhone it lands in Files.
//   1. The release is picked like Play's ("Download in", play.js), and the remux service builds the file.
//   2. The button shows how far it is ("Preparing 34%"), also after leaving and coming back.
//   3. Then "Save to this device".
// Files are kept on the server for 3 days, shared by everyone: one made by someone else is ready at once.
// Computers and phones with the remux service (Settings → TorrServer → transcoding), not TVs.
(function () {
    var POLL_MS = 5000;
    var jobs = [], timer = 0;

    function base() { return Lampa.Torserver.url() + '/gst/'; }
    function available() { return !Lampa.Platform.tv() && !!Lampa.Storage.field('torrserver_gts') && !!Lampa.Torserver.url(); }
    function kindOf(card) { return card.original_name || card.first_air_date ? 'tv' : 'movie'; }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function gb(bytes) { return bytes < 1e9 ? Math.max(1, Math.round(bytes / 1e6)) + ' MB' : (bytes / 1e9).toFixed(1) + ' GB'; }
    function busy(j) { return j.state !== 'ready' && j.state !== 'failed'; }

    // the file's name on the device: "Gladiator (2000)", "Severance S01E03"
    function nameOf(card, target) {
        var title = card.title || card.name || 'Film';
        if (target) return title + ' S' + pad(target.season) + 'E' + pad(target.episode);
        var year = (card.release_date || '').slice(0, 4);
        return title + (year ? ' (' + year + ')' : '');
    }

    function label(j) {
        var ep = j.season ? 'S' + j.season + ' E' + j.episode + ' · ' : '';
        if (j.state === 'ready') return ep + 'Ready · ' + gb(j.size);
        if (j.state === 'failed') return ep + 'Failed: ' + j.error;
        if (j.state === 'queued') return ep + 'Waiting for another download to finish';
        if (j.state === 'fetching') return ep + 'Preparing ' + Math.floor(j.progress * 100) + '%';
        return ep + 'Adding subtitles';
    }

    var LANG_NAMES = { en: 'English', bg: 'Bulgarian', ru: 'Russian' };
    function subsText(langs) {
        // one entry per track: a language can have two (the file's own and a second in it)
        var names = (langs || []).map(function (l) { return LANG_NAMES[l] || l; })
            .filter(function (n, i, all) { return all.indexOf(n) === i; });
        return names.length ? 'subtitles: ' + names.join(', ') : 'no subtitles';
    }

    function forCard(card) {
        return jobs.filter(function (j) { return String(j.tmdb) === String(card.id) && j.kind === kindOf(card); })
            .sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); });
    }

    function refresh(done) {
        fetch(base() + 'downloads', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (list) { jobs = list; }, function () {})
            .then(function () { if (done) done(); });
    }

    function call(path, body) {
        return fetch(base() + path, { method: 'POST', body: JSON.stringify(body || {}), headers: { 'Content-Type': 'application/json' } })
            .then(function (r) { return r.json().then(function (v) { if (!r.ok) throw new Error(v.error || r.status); return v; }); });
    }

    // from play.js once the release is open in TorrServer and the file is known
    function begin(element, card, target) {
        call('download', {
            hash: element.torrent_hash, index: element.id, lang: rubyPlay.audio(card) === 'ja' ? 'ja' : 'en',
            tmdb: card.id, kind: kindOf(card), season: target ? target.season : null, episode: target ? target.episode : null,
            name: nameOf(card, target)
        }).then(function (j) {
            Lampa.Noty.show(j.state === 'ready' ? 'Already prepared: tap Download to save it' :
                'Preparing "' + j.name + '" on the server. Come back to this page to save it');
            refresh(paint);
        }, function (e) { Lampa.Noty.show('Download failed: ' + e.message); });
    }

    // the browser's own download (on an iPhone Safari asks, then it goes to Files → Downloads)
    function save(j) {
        var a = document.createElement('a');
        a.href = base() + j.url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    // a series: the episode after the last one downloaded (TMDB's season sizes), else where you are (play.js)
    function nextTarget(card, list) {
        var last = list.filter(function (j) { return j.season; }).pop();
        if (!last) return null;
        var season = (card.seasons || []).filter(function (s) { return s.season_number === last.season; })[0];
        if (season && last.episode < season.episode_count) return { season: last.season, episode: last.episode + 1 };
        var later = (card.seasons || []).filter(function (s) { return s.season_number === last.season + 1 && s.episode_count; })[0];
        return later ? { season: later.season_number, episode: 1 } : null;
    }

    function menu(card) {
        var list = forCard(card), back = Lampa.Controller.enabled().name, series = kindOf(card) === 'tv';
        if (!list.length) return rubyPlay.download(card);
        if (!series) return actions(list[0], back);
        var items = list.map(function (j) {
            return { title: j.season ? 'S' + j.season + ' E' + j.episode : j.name, subtitle: label(j), job: j };
        });
        var next = series ? nextTarget(card, list) : null;
        if (series) items.push({ title: next ? 'Download S' + next.season + ' E' + next.episode : 'Download an episode', subtitle: next ? 'The next one' : 'Where you are in the series', start: next || true });
        Lampa.Select.show({
            title: 'Downloads',
            items: items,
            onBack: function () { Lampa.Controller.toggle(back); },
            onSelect: function (a) {
                if (a.start) { Lampa.Controller.toggle(back); return rubyPlay.download(card, a.start === true ? null : a.start); }
                actions(a.job, back);
            }
        });
    }

    function actions(j, back) {
        var items = [];
        if (j.state === 'ready') items.push({ title: 'Save to this device', subtitle: gb(j.size) + ' · ' + subsText(j.subs), save: true });
        items.push({ title: busy(j) ? 'Stop preparing' : 'Delete from the server', subtitle: j.state === 'ready' ? 'Copies already saved stay' : '', remove: true });
        Lampa.Select.show({
            title: label(j),
            items: items,
            onBack: function () { Lampa.Controller.toggle(back); },
            onSelect: function (a) {
                Lampa.Controller.toggle(back);
                if (a.save) return save(j);
                call('download/' + j.id + '/cancel').then(function () { refresh(paint); }, function (e) { Lampa.Noty.show(e.message); });
            }
        });
    }

    // the button's text: what's happening with this title's downloads
    var current = null;   // { card, button }
    function paint() {
        clearTimeout(timer);
        if (!current || !document.body.contains(current.button)) return (current = null);
        var list = forCard(current.card), going = list.filter(busy)[0], ready = list.filter(function (j) { return j.state === 'ready'; });
        var text = going ? label(going).replace(/^S\d+ E\d+ · /, '') : ready.length ? (ready.length > 1 ? ready.length + ' ready' : 'Ready to save') : 'Download';
        current.button.querySelector('span').textContent = text;
        if (going) timer = setTimeout(function () { refresh(paint); }, POLL_MS);
    }

    function addButton(card, root) {
        var buttons = root.querySelector('.full-start-new__buttons');
        if (!buttons || buttons.querySelector('.button--ruby-download')) return;
        var b = document.createElement('div');
        b.className = 'full-start__button selector button--ruby-download';
        b.innerHTML = rubyIcons.svg('download') + '<span>Download</span>';
        var play = buttons.querySelector('.button--play');
        buttons.insertBefore(b, play ? play.nextSibling : buttons.firstChild);
        $(b).on('hover:enter', function () { refresh(function () { paint(); menu(card); }); });
        current = { card: card, button: b };
        refresh(paint);
    }

    function init() {
        var s = document.createElement('style');
        s.id = 'ruby-download';
        s.textContent = '.full-start-new__buttons .button--ruby-download span{display:inline!important}' +
            '.button--ruby-download .ruby-icon{width:1.5em!important;height:1.5em!important}';
        document.head.appendChild(s);
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite' || !e.object || !e.object.activity || !available()) return;
            var root = e.object.activity.render(true), card = e.data && e.data.movie;
            root = root.jquery ? root[0] : root;
            if (card && card.id) addButton(card, root);
        });
        // back to an already-built title page: its button is current again
        Lampa.Listener.follow('activity', function (e) {
            if (e.type !== 'start' || e.component !== 'full' || !e.object || !e.object.activity) return;
            var root = e.object.activity.render(true);
            root = root.jquery ? root[0] : root;
            var b = root.querySelector('.button--ruby-download');
            if (b && e.object.card) { current = { card: e.object.card, button: b }; refresh(paint); }
        });
    }

    window.rubyDownload = { begin: begin };

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Torserver || !Lampa.Select || !window.rubyPlay || !window.rubyIcons || !window.$) return;
        clearInterval(t);
        init();
    }, 100);
})();
