// TheIntroDB (desktop/README.md, "Player"): where a TV episode's intro, recap and end credits are, by TMDB id,
// season and episode, asked once per episode when the player starts it. The intro and the recap go to Lampa's
// own skip segments (its "Skip" button: "Skip in 5", then a button with the time left); the end credits are for
// nextup.js (rubyIntroDB.credits()). A source that brings its own segments keeps them.
// Runs everywhere (TVs too: Lampa's skip button works with a remote).
(function () {
    'use strict';

    var API = 'https://api.theintrodb.org/v2/media';
    // an intro or recap ending later than this into the file is someone's mistake, not an intro
    var EARLY = 20 * 60;
    var asked = {}, playing = '';

    // TheIntroDB's [{ start_ms, end_ms }] as [{ start, end }] in seconds: start null is the file's start,
    // end null its end; 0/0 is how it says "none"
    function spans(list) {
        return (list || []).map(function (s) {
            return { start: (s.start_ms || 0) / 1000, end: s.end_ms == null ? Infinity : s.end_ms / 1000 };
        }).filter(function (s) { return s.end > s.start + 1; });
    }

    // what nextup.js and the segments need from an answer
    function read(j) {
        var credits = null;
        // the end credits: the latest entry starting after 0 (opening credits start near 0)
        spans(j && j.credits).forEach(function (s) {
            if (s.start > 0 && (!credits || s.start > credits.start)) credits = { start: s.start, end: isFinite(s.end) ? s.end : 0 };
        });
        var skip = spans(j && j.intro).concat(spans(j && j.recap)).filter(function (s) { return s.end <= EARLY; });
        return { credits: credits, skip: skip };
    }

    function key(data) {
        var c = data && data.card;
        if (!c || !c.id || !(c.name || c.original_name) || !(data.season > 0) || !(data.episode > 0)) return '';
        return c.id + '/' + data.season + '/' + data.episode;
    }

    function apply(k, own) {
        var a = asked[k];
        if (!a || playing !== k || own || !a.skip.length || !Lampa.PlayerSegments) return;
        Lampa.PlayerSegments.set({ skip: a.skip.map(function (s) { return { start: s.start, end: s.end }; }) });
    }

    function start(data) {
        var k = playing = key(data), own = !!data.segments;
        if (!k) return;
        if (k in asked) return apply(k, own);
        asked[k] = null;
        var p = data.card.id, q = '?tmdb_id=' + p + '&season=' + data.season + '&episode=' + data.episode;
        fetch(API + q).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
            asked[k] = read(j);
            var a = asked[k];
            console.log('Ruby introdb', k, 'credits', a.credits ? a.credits.start.toFixed(0) + ' s' : 'unknown',
                'skip', a.skip.map(function (s) { return s.start.toFixed(0) + '-' + s.end.toFixed(0); }).join(' ') || 'none');
            apply(k, own);
        }, function () { delete asked[k]; });
    }

    function init() {
        // Lampa skips a segment without asking unless the profile chose otherwise; a button instead (the user,
        // 2026-10-26: "a button skip intro"). Settings → Player → Segments still decides.
        if (!Lampa.Storage.get('player_segments_skip', '')) Lampa.Storage.set('player_segments_skip', 'user');
        Lampa.Player.listener.follow('start', start);
        Lampa.Player.listener.follow('destroy', function () { playing = ''; });
    }

    window.rubyIntroDB = {
        // the playing episode's end credits { start, end (0: to the end) } in seconds, or null
        credits: function () { var a = playing && asked[playing]; return a ? a.credits : null; }
    };

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Player || !Lampa.Storage) return;
        clearInterval(t);
        init();
    }, 100);
})();
