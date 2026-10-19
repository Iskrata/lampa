// Ruby's loading screens (desktop/README.md, "Loading screens"), on every platform (the user's call 2026-10-19:
// it's the brand). Loaded by index.html before Lampa.
//   * Startup intro, Netflix-style, instead of Lampa's splash picture (.welcome): the brand's letters drop in,
//     red and shaded; a light sweep runs while the app is still loading; once Lampa shows the app
//     (window.show_app, set when it fades its splash) the view flies into the letters and they burst into
//     ribbons of light. It never ends before the letters are in, and never outlasts MAX_MS.
//   * One spinner everywhere: a red arc on a faint red track, in place of Lampa's white ring (img/loader.svg,
//     which 14 of its rules draw as a background: page loads, player buffering, dialogs, episode stills).
(function () {
    var INTRO_MS = 1500;   // the last letter is in and shaded
    var MAX_MS = 15000;    // Lampa never said it's shown (a failed script, a blocked network): show what there is
    var POLL_MS = 100;
    var RED = '#e50914';
    // ribbons for the exit: reds, a little orange, pink and violet, as rgba so old browsers need no CSS variables
    var RIBBONS = [[229, 9, 20], [255, 43, 55], [178, 7, 16], [255, 90, 99], [122, 4, 16], [255, 138, 61], [194, 24, 91], [91, 43, 214], [255, 31, 107]];
    var RIBBON_COUNT = 46;

    // 94 px like Lampa's own: the rules that set no background-size draw it at that size
    var RING = '<svg xmlns="http://www.w3.org/2000/svg" width="94" height="94" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" r="40" fill="none" stroke="rgba(229,9,20,.2)" stroke-width="7"/>' +
        '<circle cx="50" cy="50" r="40" fill="none" stroke="' + RED + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="70 182">' +
        '<animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur=".9s" values="0 50 50;360 50 50"/></circle></svg>';
    var SPINNER = 'url("data:image/svg+xml,' + encodeURIComponent(RING) + '")';
    // every rule in css/app.css that draws img/loader.svg
    var LOADERS = ['.content-loading::after', '.processing__loader', '.activity__loader', '.full-start__button.loading:before',
        '.player-video__loader', '.birthday__poster', '.loading-layer__ico', '.search-source--loading .search-source__count',
        '.modal-loading', '.modal-pending__loading', '.season-episode__loader', '.screensaver__preload', '.extensions__item-check', '.iframe__body'];

    var CSS = [
        LOADERS.join(',') + '{background-image:' + SPINNER + '!important}',
        // buffering: the ring alone over the picture (Lampa puts it on a frosted grey disc)
        '.player-video__loader{background-color:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
        // Lampa's splash picture stays (it fades it out itself), just never seen
        '.welcome{background:#000!important}',
        '.ruby-intro{position:fixed;top:0;right:0;bottom:0;left:0;z-index:100000;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}',
        '.ruby-intro__mark{position:relative;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif;font-weight:900;' +
            'font-size:17vw;font-size:min(17vw,30vh);letter-spacing:-.03em;line-height:1;text-transform:uppercase;white-space:nowrap;' +
            '-webkit-transform:scaleY(1.12);transform:scaleY(1.12);will-change:transform,opacity}',
        // each letter drops in from the top, shading from a dark fold to bright red as it lands
        '.ruby-intro__l{display:inline-block;color:' + RED + ';-webkit-clip-path:inset(0 0 100% 0);clip-path:inset(0 0 100% 0)}',
        '.ruby-intro.go .ruby-intro__l{-webkit-animation:ruby-intro-drop .55s cubic-bezier(.3,.7,.2,1) forwards,ruby-intro-shade 1.1s ease-out forwards;' +
            'animation:ruby-intro-drop .55s cubic-bezier(.3,.7,.2,1) forwards,ruby-intro-shade 1.1s ease-out forwards}',
        '@-webkit-keyframes ruby-intro-drop{to{-webkit-clip-path:inset(0 0 0 0);clip-path:inset(0 0 0 0)}}',
        '@keyframes ruby-intro-drop{to{-webkit-clip-path:inset(0 0 0 0);clip-path:inset(0 0 0 0)}}',
        '@-webkit-keyframes ruby-intro-shade{from{background-position:0 100%}to{background-position:0 0}}',
        '@keyframes ruby-intro-shade{from{background-position:0 100%}to{background-position:0 0}}',
        // the light sweep while it waits
        '.ruby-intro__sheen{display:none}',
        // gradients through the letters only where text clipping works (elsewhere they would be red/white boxes)
        '@supports (-webkit-background-clip:text) or (background-clip:text){' +
            '.ruby-intro__l{color:transparent;-webkit-background-clip:text;background-clip:text;' +
                'background-image:linear-gradient(180deg,#ff3340 0%,' + RED + ' 38%,#b20710 62%,' + RED + ' 100%);background-size:100% 260%;background-position:0 100%}' +
            '.ruby-intro__sheen{display:block;position:absolute;top:0;right:0;bottom:0;left:0;pointer-events:none;color:transparent;-webkit-background-clip:text;background-clip:text;' +
                'background-image:linear-gradient(100deg,transparent 40%,rgba(255,255,255,.55) 50%,transparent 60%);background-size:250% 100%;background-position:150% 0;opacity:0}' +
        '}',
        '.ruby-intro.wait .ruby-intro__sheen{opacity:1;-webkit-animation:ruby-intro-sheen 1.6s ease-in-out infinite;animation:ruby-intro-sheen 1.6s ease-in-out infinite}',
        '@-webkit-keyframes ruby-intro-sheen{from{background-position:150% 0}to{background-position:-50% 0}}',
        '@keyframes ruby-intro-sheen{from{background-position:150% 0}to{background-position:-50% 0}}',
        // the exit: into the letters, ribbons fanning out from where they were, the black lifting off the app
        '.ruby-intro.out{pointer-events:none;-webkit-animation:ruby-intro-lift .5s .75s ease-out forwards;animation:ruby-intro-lift .5s .75s ease-out forwards}',
        '@-webkit-keyframes ruby-intro-lift{to{background-color:transparent}}',
        '@keyframes ruby-intro-lift{to{background-color:transparent}}',
        '.ruby-intro.out .ruby-intro__mark{-webkit-animation:ruby-intro-zoom .9s cubic-bezier(.6,0,.9,.4) forwards;animation:ruby-intro-zoom .9s cubic-bezier(.6,0,.9,.4) forwards}',
        '@-webkit-keyframes ruby-intro-zoom{0%{-webkit-transform:scaleY(1.12) scale(1);opacity:1}70%{opacity:1}100%{-webkit-transform:scaleY(1.12) scale(26);opacity:0}}',
        '@keyframes ruby-intro-zoom{0%{transform:scaleY(1.12) scale(1);opacity:1}70%{opacity:1}100%{transform:scaleY(1.12) scale(26);opacity:0}}',
        '.ruby-intro__ribbons{position:absolute;top:0;right:0;bottom:0;left:0;pointer-events:none}',
        '.ruby-intro__ribbons i{position:absolute;top:0;bottom:0;opacity:0;-webkit-transform:scale(0,.2);transform:scale(0,.2)}',
        '.ruby-intro.out .ruby-intro__ribbons i{-webkit-animation:ruby-intro-fan .9s cubic-bezier(.2,.8,.2,1) forwards;animation:ruby-intro-fan .9s cubic-bezier(.2,.8,.2,1) forwards}',
        '@-webkit-keyframes ruby-intro-fan{0%{-webkit-transform:scale(0,.2);opacity:0}35%{-webkit-transform:scale(1,1);opacity:1}100%{-webkit-transform:scale(1,1.2);opacity:0}}',
        '@keyframes ruby-intro-fan{0%{transform:scale(0,.2);opacity:0}35%{transform:scale(1,1);opacity:1}100%{transform:scale(1,1.2);opacity:0}}',
        '.ruby-intro.gone{opacity:0;-webkit-transition:opacity .3s;transition:opacity .3s}',
        '@media (prefers-reduced-motion: reduce){.ruby-intro.go .ruby-intro__l{-webkit-animation:none;animation:none;-webkit-clip-path:none;clip-path:none;background-position:0 0}' +
            '.ruby-intro.wait .ruby-intro__sheen{display:none}}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = 'ruby-loading-css';
    style.textContent = CSS;
    document.head.appendChild(style);

    // the black goes up at once, over Lampa's splash picture; the letters wait for the page's scripts, which
    // name the install (window.lampa_brand, set by the host's lampa-init.js after this file)
    var intro = document.createElement('div');
    intro.className = 'ruby-intro';
    document.body.appendChild(intro);

    function ribbons() {
        var html = '';
        for (var i = 0; i < RIBBON_COUNT; i++) {
            // crowded in the middle, where the letters were: the mean of three randoms is a rough bell curve
            var x = (Math.random() + Math.random() + Math.random()) / 3, c = RIBBONS[(Math.random() * RIBBONS.length) | 0];
            var delay = (0.3 + Math.random() * 0.3).toFixed(2) + 's';
            html += '<i style="left:' + (x * 100).toFixed(1) + '%;width:' + (0.2 + Math.random() * 1.3).toFixed(2) + '%;' +
                'background:rgba(' + c.join(',') + ',' + (0.4 + Math.random() * 0.5).toFixed(2) + ');' +
                '-webkit-animation-delay:' + delay + ';animation-delay:' + delay + '"></i>';
        }
        return html;
    }

    function start() {
        var word = window.lampa_brand || 'Lampa', letters = '';
        for (var i = 0; i < word.length; i++) {
            var d = (i * 0.11).toFixed(2) + 's';
            letters += '<span class="ruby-intro__l" style="-webkit-animation-delay:' + d + ',' + d + ';animation-delay:' + d + ',' + d + '">' + word.charAt(i) + '</span>';
        }
        var mark = document.createElement('div');
        mark.className = 'ruby-intro__mark';
        mark.innerHTML = letters;
        var sheen = document.createElement('span');
        sheen.className = 'ruby-intro__sheen';
        sheen.textContent = word;
        mark.appendChild(sheen);
        intro.appendChild(mark);
        void intro.offsetWidth;   // the letters' hidden state first, so the drop animates
        intro.className += ' go';

        var lettersIn = false, shown = false, left = false, started = Date.now();
        function leave() {
            if (left) return;
            left = true;
            clearInterval(poll);
            var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (still) intro.className = 'ruby-intro gone';
            else {
                var box = document.createElement('div');
                box.className = 'ruby-intro__ribbons';
                box.innerHTML = ribbons();
                intro.insertBefore(box, mark);
                intro.className = 'ruby-intro go out';
                setTimeout(function () { intro.className += ' gone'; }, 1250);
            }
            setTimeout(function () { if (intro.parentNode) intro.parentNode.removeChild(intro); }, still ? 350 : 1600);
        }
        function check() {
            // window.show_app: Lampa fades its splash (app.min.js showApp). .lang: its first-run language picker,
            // which waits for an answer before the app loads
            if (window.show_app || document.querySelector('.lang')) shown = true;
            if (shown && lettersIn) leave();
            else if (Date.now() - started > MAX_MS) leave();
        }
        var poll = setInterval(check, POLL_MS);
        setTimeout(function () {
            lettersIn = true;
            if (!shown) intro.className += ' wait';
            check();
        }, INTRO_MS);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
