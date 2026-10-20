// Settings for everyone (desktop/README.md, "Settings"): a short list in the middle of the screen with what a
// viewer may want to change, and "Advanced settings" (Lampa's whole control panel: Parser, TorrServer,
// Extensions, "Desktop look"…) behind a PIN. Simplicity review 2026-10-20: Lampa's 13 technical sections were
// one click from the profile menu, with the Jackett key in plain text, and two switches in them turn the
// friendly app off. The PIN guards against accidents, not people: a host sets it with window.lampa_admin_pin
// (as lampa_brand, before the scripts run); without one, the first person to open Advanced on a device
// chooses it (kept in that browser). rubySettings.open(). Active only where desktop.js is.
(function () {
    var PIN = 'ruby_admin_pin';
    var SUBS = { off: 'Off', en: 'English', bg: 'Bulgarian', ru: 'Russian' };

    function local(k, v) {
        try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
    }
    function onOff(v) { return v ? 'On' : 'Off'; }

    // [{title, subtitle, run}] -> the list; each choice comes back to it
    function open() {
        var back = Lampa.Controller.enabled().name;
        var subs = Lampa.Storage.field('subtitles_start') ? Lampa.Storage.field('subtitles_lang') || 'en' : 'off';
        var anime = Lampa.Storage.get('ruby_anime_audio', 'en') === 'ja' ? 'Japanese with English subtitles' : 'English dub';
        var items = [
            { title: 'Subtitles', subtitle: SUBS[subs] || subs, run: function () {
                choose('Subtitles', Object.keys(SUBS).map(function (k) { return { title: SUBS[k], value: k, selected: k === subs }; }), function (v) {
                    Lampa.Storage.set('subtitles_start', v !== 'off');
                    if (v !== 'off') Lampa.Storage.set('subtitles_lang', v);
                });
            } },
            { title: 'Anime audio', subtitle: anime, run: function () {
                choose('Anime audio', [{ title: 'English dub', value: 'en', selected: anime === 'English dub' },
                    { title: 'Japanese with English subtitles', value: 'ja', selected: anime !== 'English dub' }], function (v) { Lampa.Storage.set('ruby_anime_audio', v); });
            } },
            toggle('Play the next episode automatically', 'playlist_next'),
            toggle('Trailers', 'ruby_hero_trailers'),
            toggle('Trailer sound', 'ruby_trailer_sound'),
            { title: rubyTrakt.connected() ? 'Trakt' : 'Connect Trakt', subtitle: rubyTrakt.connected() ? 'Connected' : 'Sync what you watch with trakt.tv', run: function () {
                if (!rubyTrakt.connected()) rubyTrakt.connect();
                else again();
            } },
            { title: 'Manage profiles', run: function () { rubyProfiles.manage(); } },
            { title: 'Advanced settings', subtitle: 'Needs the PIN', run: advanced }
        ];
        function toggle(title, key) {
            var on = Lampa.Storage.field(key) !== false && Lampa.Storage.field(key) !== 'false';
            return { title: title, subtitle: onOff(on), run: function () { Lampa.Storage.set(key, !on); again(); } };
        }
        function again() { setTimeout(open, 50); }
        function choose(title, opts, set) {
            rubyDesktop.centred();
            Lampa.Select.show({
                title: title, items: opts,
                onSelect: function (a) { set(a.value); again(); },
                onBack: again
            });
        }
        rubyDesktop.centred();
        Lampa.Select.show({
            title: 'Settings',
            items: items,
            onSelect: function (a) { a.run(); },
            onBack: function () { Lampa.Controller.toggle(back === 'select' ? 'content' : back); }
        });
    }

    // Lampa's own settings once the PIN is right; the first time on a device without a host PIN, it's chosen
    function advanced() {
        Lampa.Select.close();
        var pin = window.lampa_admin_pin || local(PIN);
        var ask = function (title, done) {
            // the system keyboard where there is one (Lampa's own on-screen pad took one typed digit of four)
            Lampa.Input.edit({ free: true, title: title, nosave: true, value: '', password: true }, function (v) {
                Lampa.Controller.toggle('content');
                done((v || '').trim());
            });
        };
        if (!pin) return ask('Choose a PIN for Advanced settings', function (v) {
            if (v.length < 4) return Lampa.Noty.show('Use at least 4 digits');
            local(PIN, v);
            lampaSettings();
        });
        ask('PIN for Advanced settings', function (v) {
            if (v === String(pin)) lampaSettings();
            else if (v) Lampa.Noty.show('Wrong PIN');
        });
    }
    function lampaSettings() {
        var el = document.querySelector('.head__actions .open--settings');
        if (el) $(el).trigger('hover:enter');
    }

    var t = setInterval(function () {
        if (!window.Lampa || !Lampa.Select || !Lampa.Input || !Lampa.Storage || !window.rubyDesktop || !rubyDesktop.centred || !window.rubyTrakt || !window.rubyProfiles) return;
        clearInterval(t);
        window.rubySettings = { open: open };
    }, 100);
})();
