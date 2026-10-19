// Profile pictures, Netflix-style (desktop/README.md, "Profiles"): in the profile editor, rows of drawn
// characters (not photos of real people) from free public image sources. The choice is the picture's URL, kept
// with the profile (p.img) and so shared like the rest of profiles.json. Profiles saved before this (Oct 2026)
// hold a TMDB portrait path ("/abc.jpg"), which url() still resolves.
// rubyAvatars.url(img) -> image URL; rubyAvatars.gallery(host, current, onPick(url|null)).
// Loaded with profiles.js, before Lampa.
(function () {
    // [row title, URL with {} for the key, [[key, character], ...]]; every URL checked to load in Chrome (15 Oct 2026; the
    // Pokémon added 19 Oct 2026 checked with curl, all HTTP 200)
    var ROWS = [
        ['Pokémon', 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{}.png', [[25, 'Pikachu'],
            [1, 'Bulbasaur'], [4, 'Charmander'], [7, 'Squirtle'], [39, 'Jigglypuff'], [54, 'Psyduck'], [94, 'Gengar'], [133, 'Eevee'],
            [143, 'Snorlax'], [150, 'Mewtwo'], [6, 'Charizard'], [9, 'Blastoise'], [3, 'Venusaur'], [26, 'Raichu'], [172, 'Pichu'],
            [35, 'Clefairy'], [37, 'Vulpix'], [52, 'Meowth'], [58, 'Growlithe'], [79, 'Slowpoke'], [92, 'Gastly'], [104, 'Cubone'],
            [129, 'Magikarp'], [130, 'Gyarados'], [131, 'Lapras'], [132, 'Ditto'], [149, 'Dragonite'], [151, 'Mew'], [175, 'Togepi'],
            [196, 'Espeon'], [197, 'Umbreon'], [249, 'Lugia'], [384, 'Rayquaza'], [448, 'Lucario'], [658, 'Greninja'], [700, 'Sylveon'],
            [778, 'Mimikyu']]],
        ['The Simpsons', 'https://cdn.thesimpsonsapi.com/200/character/{}.webp', [[1, 'Homer'], [2, 'Marge'], [3, 'Bart'],
            [4, 'Lisa'], [5, 'Maggie'], [6, 'Grampa'], [9, 'Ned Flanders'], [13, 'Mr. Burns'], [15, 'Krusty'], [16, 'Moe']]],
        ['Rick and Morty', 'https://rickandmortyapi.com/api/character/avatar/{}.jpeg', [[1, 'Rick'], [2, 'Morty'], [3, 'Summer'],
            [4, 'Beth'], [5, 'Jerry'], [47, 'Birdperson'], [118, 'Evil Morty'], [242, 'Mr. Meeseeks'], [244, 'Mr. Poopybutthole'], [265, 'Pickle Rick']]]
    ];

    var CSS = [
        '.ruby-avs{margin-top:1.6em;max-height:46vh;overflow-y:auto;padding-right:.5em}',
        '.ruby-avs__title{font-size:1.05em;color:#ccc;margin:1em 0 .5em}',
        '.ruby-avs__row{display:flex;gap:.7em;overflow-x:auto;padding:.2em .2em .6em}',
        '.ruby-avs__p{flex:0 0 auto;width:5.4em;cursor:pointer;text-align:center;font-size:.8em;color:#999}',
        '.ruby-avs__img{width:100%;aspect-ratio:1;border-radius:.3em;background:#333 center/cover;box-shadow:0 0 0 2px transparent;transition:box-shadow .15s,transform .15s}',
        '.ruby-avs__p:hover .ruby-avs__img{transform:scale(1.06)}',
        '.ruby-avs__p.on .ruby-avs__img{box-shadow:0 0 0 2px #141414,0 0 0 4px #fff}',
        '.ruby-avs__name{margin-top:.35em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ruby-avs__none .ruby-avs__img{display:flex;align-items:center;justify-content:center;color:#999;font-size:1.6em}'
    ].join('\n');

    function url(img) { return img.charAt(0) === '/' ? 'https://image.tmdb.org/t/p/w185' + img : img; }

    function gallery(host, current, onPick) {
        if (!document.getElementById('ruby-avs-css')) {
            var st = document.createElement('style'); st.id = 'ruby-avs-css'; st.textContent = CSS; document.head.appendChild(st);
        }
        var box = document.createElement('div');
        box.className = 'ruby-avs';
        host.appendChild(box);
        var mark = function (el) { [].forEach.call(box.querySelectorAll('.ruby-avs__p'), function (x) { x.classList.toggle('on', x === el); }); };
        var person = function (path, label, row) {
            var el = document.createElement('div');
            el.className = 'ruby-avs__p' + (path ? '' : ' ruby-avs__none') + (path === current ? ' on' : '');
            el.innerHTML = '<div class="ruby-avs__img"' + (path ? ' style="background-image:url(' + url(path) + ')"' : '') + '>' + (path ? '' : '–') + '</div><div class="ruby-avs__name"></div>';
            el.querySelector('.ruby-avs__name').textContent = label;
            el.title = label;
            el.addEventListener('click', function () { mark(el); onPick(path); });
            row.appendChild(el);
        };
        var plain = document.createElement('div');
        plain.className = 'ruby-avs__row';
        box.insertAdjacentHTML('beforeend', '<div class="ruby-avs__title">Choose a picture</div>');
        box.appendChild(plain);
        person(null, 'Colour only', plain);
        ROWS.forEach(function (r) {
            var h = document.createElement('div');
            h.className = 'ruby-avs__title';
            h.textContent = r[0];
            var row = document.createElement('div');
            row.className = 'ruby-avs__row';
            box.appendChild(h);
            box.appendChild(row);
            r[2].forEach(function (c) { person(r[1].replace('{}', c[0]), c[1], row); });
        });
    }

    window.rubyAvatars = { url: url, gallery: gallery };
})();
