// Choosing a torrent without a list (desktop/README.md, "Play"): from the parser's results, keep English
// releases of this title that will stream, group them by resolution, and rank each group. Pure functions,
// no Lampa: rubyPick.choices(results, movie, target) -> [{ res, label, best, count }] best resolution first.
// target: { season, episode } for a series, else null.
(function () {
    var MIN_SEEDERS = { 2160: 15, 1080: 5, 720: 3 };
    var LABEL = { 2160: '4K', 1080: '1080p', 720: '720p' };
    // Mbit/s that streams well and still looks good, per resolution: below `low` is over-compressed, above
    // `high` is a remux or too heavy for the torrent and the uplink (docs/lampa.md, "How many people")
    var RATE = { 2160: { low: 8, high: 35 }, 1080: { low: 2.5, high: 14 }, 720: { low: 1.2, high: 8 } };

    // Not "dubbed": in English release names it means the English dub (anime: "COMPLETE.DUBBED.720p"); other
    // languages' dubs are caught by their language ("rus", Cyrillic...)
    var NOT_ENGLISH = new RegExp('[\\u0400-\\u04FF]|\\b(' + [
        'rus', 'russian', 'ukr', 'ukrainian', 'mvo', 'dvo', 'avo', 'lat(ino)?', 'castellano', 'spanish', 'esp',
        'french', 'truefrench', 'vff', 'vfq', 'vf2', 'vostfr', 'ita', 'italian', 'german', 'deutsch', 'hindi', 'tamil',
        'telugu', 'malayalam', 'kannada', 'turkish', 'polish', 'pl', 'czech', 'cz', 'hun', 'hungarian', 'korean',
        'chinese', 'chs', 'cht', 'jpn', 'japanese', 'portuguese', 'por', 'pt-br', 'dublado', 'legendado', 'arabic',
        'persian', 'thai', 'vietnamese', 'indonesian', 'hebrew', 'greek', 'dutch', 'nl', 'swedish', 'danish', 'norwegian',
        'finnish', 'romanian', 'bulgarian', 'subita', 'hardsub', 'hc', 'korsub'].join('|') + ')\\b', 'i');
    var MULTI_WITH_ENGLISH = /\b(multi|dual[ .-]?audio)\b|\beng\b|english/i;
    var JUNK = /\b(cam|camrip|hdcam|ts|hdts|telesync|tc|telecine|scr|screener|dvdscr|r5|workprint|xxx|3d|sbs|hsbs)\b/i;
    var SERIES = /\bs\d{1,2}(e\d{1,3})?\b|\bseason\b|\bcomplete\b|\b\d{1,2}x\d{2}\b|\bepisode\b/i;

    function words(s) {
        return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function resolution(t) {
        if (/\b(2160p|4k|uhd)\b/i.test(t)) return 2160;
        if (/\b1080[pi]\b/i.test(t)) return 1080;
        if (/\b720p\b/i.test(t)) return 720;
        return 0;
    }

    // "English" means: no other language named, or a multi-audio release that says it has English.
    // For anime watched in Japanese (audio 'ja'), Japanese releases count too.
    function english(t, audio) {
        var w = t.replace(/[._]/g, ' ');
        if (audio === 'ja') w = w.replace(/\b(japanese|jpn|jap)\b/ig, '');
        if (!NOT_ENGLISH.test(w)) return true;
        // a named other language next to MULTi/ENG still carries an English track; hard-coded subs never pass
        return MULTI_WITH_ENGLISH.test(w) && !/[Ѐ-ӿ]/.test(w) && !/\b(hardsub|hc|korsub|subita)\b/i.test(w);
    }

    // What may follow the title in a release name: a year, a season or episode, a resolution or an edition.
    // Anything else means a different title that starts the same ("Avatar" vs "Avatar Aang The Last
    // Airbender", "Avatar The Last Airbender" vs "Avatar The Legend of Aang").
    var AFTER = /^((19|20)\d\d|s\d{1,2}(e\d{1,3})?|e\d{1,3}|season|seasons|series|complete|\d{3,4}p|4k|uhd|hdr|extended|remastered|unrated|imax|directors|theatrical|repack|proper|web|webrip|bluray|hdtv|multi|dual|aka|\d{1,2}x\d{2})$/;

    // the release name starts with the title (or its original title), followed by one of AFTER or nothing.
    // Leading tags such as [LAMPA] or "www.site.org -" are skipped.
    function sameTitle(t, movie) {
        var name = words(t.replace(/^\s*(\[[^\]]*\]|\([^)]*\)|www\.\S+\s*-?)\s*/gi, ''));
        return [movie.title, movie.name, movie.original_title, movie.original_name].some(function (x) {
            var w = words(x);
            if (!w || name.indexOf(w) !== 0) return false;
            var next = name.slice(w.length).trim().split(' ')[0];
            return next === '' || AFTER.test(next);
        });
    }

    // a series' years on air, from TMDB (a release naming a year outside them is another show of that name)
    function aired(movie) {
        var from = +((movie.first_air_date || '') + '').slice(0, 4);
        var to = +((movie.last_air_date || '') + '').slice(0, 4) || new Date().getFullYear();
        return from ? [from - 1, to + 1] : null;
    }

    function year(t) { var m = t.match(/\b(19[2-9]\d|20\d\d)\b/g); return m ? +m[m.length - 1] : 0; }

    // seasons a release covers: [from, to], or null when it names none ("Complete Series" covers all)
    function seasons(t) {
        var w = t.replace(/[._]/g, ' '), m;
        if ((m = w.match(/\bs(\d{1,2})\s*-\s*s?(\d{1,2})\b/i))) return [+m[1], +m[2]];
        if ((m = w.match(/\bseasons?\s*(\d{1,2})\s*-\s*(\d{1,2})\b/i))) return [+m[1], +m[2]];
        if ((m = w.match(/\bs(\d{1,2})(?:e\d{1,3})?\b/i)) || (m = w.match(/\bseason\s*(\d{1,2})\b/i)) || (m = w.match(/\b(\d{1,2})x\d{2}\b/))) return [+m[1], +m[1]];
        return null;
    }

    function episode(t) {
        var m = t.replace(/[._]/g, ' ').match(/\bs\d{1,2}\s*e(\d{1,3})\b|\b\d{1,2}x(\d{2})\b/i);
        return m ? +(m[1] || m[2]) : 0;
    }

    // Does this release hold what we want to watch?
    function fits(t, movie, target) {
        if (!target) {                                         // a film: not a series, the right year
            if (SERIES.test(t)) return false;
            var y = year(t), want = +((movie.release_date || '') + '').slice(0, 4);
            return !y || !want || Math.abs(y - want) <= 1;
        }
        var span = aired(movie), y = year(t);
        if (span && y && (y < span[0] || y > span[1])) return false;
        var s = seasons(t);
        if (!s) return /\bcomplete\b/i.test(t) || /\bseries\b/i.test(t);
        if (target.season < s[0] || target.season > s[1]) return false;
        var e = episode(t);
        return !e || e === target.episode;
    }

    function source(t) {
        if (/\bremux\b/i.test(t)) return 0.5;
        if (/\bblu[ .-]?ray\b|\bbdrip\b|\bbrrip\b|\bbd\b/i.test(t)) return 2;
        if (/\bweb[ .-]?dl\b|\b(amzn|nf|atvp?|dsnp|hmax|max|hulu|pcok)\b/i.test(t)) return 1.5;
        if (/\bwebrip\b|\bweb\b/i.test(t)) return 1;
        if (/\bhdtv\b/i.test(t)) return 0.3;
        if (/\bdvdrip\b|\bdvd\b|\bxvid\b/i.test(t)) return -1;
        return 0;
    }

    // seconds of video in the release (a film's runtime, or the episodes it holds), for its bitrate
    function seconds(t, movie, target) {
        if (!target) return (movie.runtime || 110) * 60;
        // TMDB often leaves episode_run_time empty for newer shows: then the last aired episode's runtime
        var per = ((movie.episode_run_time && movie.episode_run_time[0]) ||
            (movie.last_episode_to_air && movie.last_episode_to_air.runtime) || 42) * 60;
        if (episode(t)) return per;
        var s = seasons(t), from = s ? s[0] : 1, to = s ? s[1] : movie.number_of_seasons || 1, eps = 0;
        // episodes in the seasons the release covers (the show's season list), else an even share
        for (var n = from; n <= to; n++) {
            var info = (movie.seasons || []).filter(function (x) { return x.season_number === n; })[0];
            eps += info && info.episode_count ? info.episode_count :
                movie.number_of_episodes && movie.number_of_seasons ? movie.number_of_episodes / movie.number_of_seasons : 10;
        }
        return per * eps;
    }

    // how much better a codec looks than H.264 at the same size
    function efficiency(t) { return /\bav1\b/i.test(t) ? 2 : /\b(x265|h[ .]?265|hevc)\b/i.test(t) ? 1.5 : 1; }

    // Picture quality first, then how well it will stream:
    //   * quality: source (Blu-ray > WEB-DL > WEBRip...) and the bitrate adjusted for the codec (an x265 file
    //     looks as good as an H.264 one 1.5x its size), up to 70 % of the band's top; 10-bit a little more
    //   * streaming: the real bitrate above the band's top is too heavy; seeders count, half as much as quality
    // anime: favour releases with the audio wanted (untagged anime releases are usually Japanese with subtitles)
    function audioFit(t, audio) {
        var dub = /\b(dubbed|dub|english audio|eng audio)\b/i.test(t), dual = /\b(dual|multi)[ .-]?(audio)?\b/i.test(t);
        if (audio === 'ja') return dual || /\b(japanese|jpn)\b/i.test(t) ? 1 : dub ? -2 : 0.5;
        return dub || dual ? 1 : -0.5;
    }

    function score(r, res, movie, target, audio) {
        var t = r.Title, rate = bitrate(r, movie, target), band = RATE[res], ideal = band.high * 0.7;
        var s = Math.log(1 + (r.Seeders || 0)) / Math.LN10 * 1.5 + source(t);
        s += 2 * Math.min(rate * efficiency(t), ideal) / ideal;
        if (/\b10[ .-]?bits?\b|\bhdr/i.test(t)) s += 0.3;
        if (rate < band.low) s -= (band.low - rate) / band.low * 3;
        if (rate > band.high) s -= Math.min(6, (rate - band.high) / band.high * 6);
        // Dolby Vision without an HDR10 base layer shows wrong colours on everything but a DV screen
        if (/\b(dv|dovi|dolby[ .]?vision)\b/i.test(t) && !/\bhdr/i.test(t)) s -= 5;
        if (/\bav1\b/i.test(t)) s -= 2;                         // no hardware decoding on older Macs/PCs
        if (target && !episode(t)) s += 0.5;                   // a season pack also has the next episodes
        if (audio) s += audioFit(t, audio);
        return s;
    }

    // a Japanese animated title (where dubbed vs. Japanese audio is a choice)
    function anime(movie) {
        var g = (movie.genre_ids || []).concat((movie.genres || []).map(function (x) { return x.id; }));
        return movie.original_language === 'ja' && g.indexOf(16) >= 0;
    }

    // audio: for anime, 'en' (dubbed) or 'ja' (Japanese, English subtitles); else leave out
    function choices(results, movie, target, audio) {
        var groups = {};
        (results || []).forEach(function (r) {
            var t = r.Title || '', res = resolution(t);
            if (!res || !r.Size || (r.Seeders || 0) < MIN_SEEDERS[res]) return;
            if (JUNK.test(t.replace(/[._]/g, ' ')) || !english(t, audio) || !sameTitle(t, movie) || !fits(t, movie, target)) return;
            var g = groups[res] = groups[res] || [];
            g.push({ r: r, score: score(r, res, movie, target, audio) });
        });
        return [2160, 1080, 720].filter(function (res) { return groups[res]; }).map(function (res) {
            var g = groups[res].sort(function (a, b) { return b.score - a.score; });
            return { res: res, label: LABEL[res], best: g[0].r, count: g.length };
        });
    }

    // what a release is, in a few words: "Blu-ray · HEVC 10-bit"
    function describe(t) {
        var src = /\bremux\b/i.test(t) ? 'Blu-ray remux' : /\bblu[ .-]?ray\b|\bbdrip\b|\bbrrip\b|\bbd\b/i.test(t) ? 'Blu-ray' :
            /\bweb[ .-]?dl\b|\b(amzn|nf|atvp?|dsnp|hmax|max|hulu|pcok)\b/i.test(t) ? 'WEB-DL' : /\bwebrip\b|\bweb\b/i.test(t) ? 'WEB' :
            /\bhdtv\b/i.test(t) ? 'TV' : '';
        var codec = /\bav1\b/i.test(t) ? 'AV1' : /\b(x265|h[ .]?265|hevc)\b/i.test(t) ? 'HEVC' : /\b(x264|h[ .]?264|avc)\b/i.test(t) ? 'H.264' : '';
        if (codec && /\b10[ .-]?bits?\b/i.test(t)) codec += ' 10-bit';
        return [src, codec].filter(Boolean).join(' · ');
    }

    // a release's average bitrate in Mbit/s
    function bitrate(r, movie, target) { return (r.Size || 0) * 8 / 1e6 / seconds(r.Title || '', movie, target); }

    window.rubyPick = { choices: choices, anime: anime, bitrate: bitrate, describe: describe, english: english, seasons: seasons, episode: episode };
})();
