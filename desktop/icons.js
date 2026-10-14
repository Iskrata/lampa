// Shared SVG icons for the Lampa Desktop modules (desktop/README.md). Loaded by index.html before them.
// No emoji or text glyphs as icons: they render differently per OS and look out of place.
// rubyIcons.svg(name, cls) -> '<svg ...>' string; currentColor, 24x24 viewBox, sized by CSS (1em default).
(function () {
    var P = {
        play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
        info: '<circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10.8v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.3" fill="currentColor"/>',
        soundOn: '<path d="M4 9.2h3.6L12.5 5v14l-4.9-4.2H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.3a8 8 0 0 1 0 11.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        soundOff: '<path d="M4 9.2h3.6L12.5 5v14l-4.9-4.2H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        thumbUp: '<path d="M7.5 10.5v9H4.5v-9zM7.5 19.5h9.2a2 2 0 0 0 2-1.6l1.2-6a1.8 1.8 0 0 0-1.8-2.1h-5l.7-3.6A1.8 1.8 0 0 0 12 4l-.4-.1L7.5 10.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
        thumbDown: '<g transform="rotate(180 12 12)"><path d="M7.5 10.5v9H4.5v-9zM7.5 19.5h9.2a2 2 0 0 0 2-1.6l1.2-6a1.8 1.8 0 0 0-1.8-2.1h-5l.7-3.6A1.8 1.8 0 0 0 12 4l-.4-.1L7.5 10.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></g>',
        thumbsUp: '<g transform="translate(-2.2 1.6) scale(.86)"><path d="M7.5 10.5v9H4.5v-9zM7.5 19.5h9.2a2 2 0 0 0 2-1.6l1.2-6a1.8 1.8 0 0 0-1.8-2.1h-5l.7-3.6A1.8 1.8 0 0 0 12 4l-.4-.1L7.5 10.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></g>' +
            '<path d="M14.6 3.3l.4.1a1.6 1.6 0 0 1 1.2 1.8l-.6 3.1h4.3a1.6 1.6 0 0 1 1.6 1.9l-1 5.2a1.8 1.8 0 0 1-1.8 1.4h-1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>',
        search: '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
        caret: '<path d="M6 9.5l6 6 6-6z" fill="currentColor"/>',
        back: '<path d="M15 4.5L7.5 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
        pencil: '<path d="M4 20h4L19.5 8.5l-4-4L4 16z M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
        plus: '<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
        gear: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4.3l2.8 1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        cc: '<rect x="2.8" y="5" width="18.4" height="14" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.6 10.2a2.4 2.4 0 1 0 0 3.6M17.2 10.2a2.4 2.4 0 1 0 0 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        airplay: '<path d="M6.5 17H5a2.2 2.2 0 0 1-2.2-2.2V6.2A2.2 2.2 0 0 1 5 4h14a2.2 2.2 0 0 1 2.2 2.2v8.6A2.2 2.2 0 0 1 19 17h-1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 13.5l5 6.5H7z" fill="currentColor"/>',
        // Netflix-style profile face, drawn on the avatar's colour
        face: '<circle cx="8.2" cy="9.4" r="1.5" fill="currentColor"/><circle cx="15.8" cy="9.4" r="1.5" fill="currentColor"/><path d="M6.5 14.2c3.2 3 7.8 3 11 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
    };
    // Lampa styles bare <svg> elements in places (e.g. 46 px wide inside buttons): pin the size here
    var style = document.createElement('style');
    style.textContent = '.ruby-icon{width:1em!important;height:1em!important;flex:none;display:inline-block;vertical-align:middle}';
    (document.head || document.documentElement).appendChild(style);
    window.rubyIcons = {
        svg: function (name, cls) {
            return '<svg class="ruby-icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">' + (P[name] || '') + '</svg>';
        }
    };
})();
