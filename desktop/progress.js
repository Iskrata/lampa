// How far a title is from playing, on the loading card (facts.js; desktop/README.md "Play"). Asked for on
// 2026-10-20 ("show a percentage or a progress bar when we start a show"). Real numbers only:
//  * through the remux (TorrServer's /gst/, how ruby plays torrents): its heartbeat's Startup.pct, the share
//    of the bytes the probe and segment 0 need that TorrServer holds (server/remux/startup.js). Until the
//    first bytes come, how many peers are connected: that wait is most of the start (server/remux/README.md).
//  * TorrServer without the remux: Lampa's own preload percentage (Lampa.Loading.setProgress), which its
//    loading screen showed before the card hid it.
// Runs where play.js does.
(function () {
    var POLL_MS = 1000;
    // index: the file the player opened (from the player's start), the one Startup is asked for
    var hash = '', index = '', net = null;

    function on() { return document.body.classList.contains('ruby-facts-on'); }

    function speed(bps) { return bps > 0 ? (bps / 1e6).toFixed(1) + ' MB/s' : ''; }

    function show(res) {
        var t = (res && res.Torrent) || {}, st = res && res.Startup, peers = +t.active_peers || 0;
        if (!st) return rubyFacts.progress(null, peers ? peers + (peers === 1 ? ' peer' : ' peers') : '');
        if (st.pct <= 0 && !(t.download_speed > 0)) return rubyFacts.progress(0, peers ? 'Finding peers · ' + peers + ' connected' : 'Finding peers');
        var s = speed(t.download_speed);
        rubyFacts.progress(st.pct, st.pct + '%' + (s && st.pct < 100 ? ' · ' + s : ''));
    }

    function poll() {
        if (!on() || !hash || !Lampa.Torserver.gstWork()) return;
        if (!net) net = new Lampa.Reguest();
        net.timeout(2000);
        net.silent(Lampa.Torserver.url() + '/gst/' + encodeURIComponent(hash) + '/heartbeat' + (index ? '?index=' + index : ''), function (res) { if (on()) show(res); }, function () {});
    }

    function init() {
        // the torrent being started: Lampa adds it to TorrServer (Torrent.start), then the player gets its hash
        var add = Lampa.Torserver.hash;
        Lampa.Torserver.hash = function (object, ok, fail) {
            hash = '';
            index = '';
            return add.call(this, object, function (json) { if (json && json.hash) hash = json.hash; if (ok) ok.apply(this, arguments); }, fail);
        };
        Lampa.Player.listener.follow('start', function (data) {
            if (!data || !data.torrent_hash) return;
            hash = data.torrent_hash;
            index = ((data.url || '').match(/[?&]index=(\d+)/) || [])[1] || '';
        });
        var setProgress = Lampa.Loading.setProgress;
        Lampa.Loading.setProgress = function (pct, detail) {
            if (on()) rubyFacts.progress(Math.round(pct), Math.round(pct) + '%' + (detail && detail.speed ? ' · ' + detail.speed : ''));
            return setProgress.apply(this, arguments);
        };
        setInterval(poll, POLL_MS);
    }

    var wait = setInterval(function () {
        if (!window.Lampa || !Lampa.Torserver || !Lampa.Player || !Lampa.Loading || !Lampa.Reguest || !window.rubyFacts) return;
        clearInterval(wait);
        init();
    }, 100);
})();
