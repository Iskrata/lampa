// A title goes into Lampa's history (Favorite 'history') only once it has really been watched: 10 minutes,
// or half of anything shorter than 20 (desktop/README.md "Watched"). Lampa adds it the moment a file is
// clicked, before anything plays (app.min.js, Torrent: Favorite.add('history', movie, 100)), and the history
// seeds Lampa's "Recommended" row (TMDB recommendations of every history title) and Picked for you
// (personal.js). On 2026-10-19, 13 seconds of a Spider-Man film opened on the wrong profile made all of
// Iskrata's recommendations Marvel. Asked for on 2026-10-20 ("10 min is fine").
// A title already in the history just moves to the front, as before. Android's own player
// (Android.openTorrent) plays outside the page, where nothing can be measured: unchanged there.
// Runs where play.js does.
(function () {
    var MIN_S = 600;
    var pending = null, played = 0, last = -1, add;

    function inHistory(card) {
        return (Lampa.Favorite.get({ type: 'history' }) || []).some(function (c) { return c && c.id == card.id; });
    }
    function note(what, card) {   // in the profile logs (profiles.js), so a history that looks wrong can be explained
        var info = { id: card.id, title: card.title || card.name || '', played: Math.round(played) };
        if (window.rubyProfiles) rubyProfiles.log('watched: ' + what, info); else console.log('watched:', what, info);
    }

    function init() {
        add = Lampa.Favorite.add;
        Lampa.Favorite.add = function (where, card, limit) {
            if (where !== 'history' || !card || !card.id || Lampa.Platform.is('android') || inHistory(card)) return add.apply(this, arguments);
            pending = { card: card, limit: limit };
            played = 0;
            last = -1;
        };
        Lampa.PlayerVideo.listener.follow('timeupdate', function (e) {
            if (!pending || !e) return;
            var step = last < 0 ? 0 : e.current - last;
            last = e.current;
            if (step > 0 && step < 3) played += step;   // playing, not a seek
            if (played < Math.min(MIN_S, e.duration > 0 ? e.duration / 2 : MIN_S)) return;
            var p = pending;
            pending = null;
            add.call(Lampa.Favorite, 'history', p.card, p.limit);
            note('into the history', p.card);
        });
        Lampa.Player.listener.follow('destroy', function () {
            if (!pending) return;
            note('left out of the history', pending.card);
            pending = null;
        });
    }

    var wait = setInterval(function () {
        if (!window.Lampa || !Lampa.Favorite || !Lampa.Favorite.add || !Lampa.Player || !Lampa.PlayerVideo || !Lampa.Platform) return;
        clearInterval(wait);
        init();
    }, 100);
})();
