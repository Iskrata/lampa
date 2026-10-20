// What changed in a profile key, as the change the profile service applies (server/sync/ops.js, the same
// format; desktop/README.md "Profiles"). profiles.js notes the value a key had before Lampa (or a plugin)
// wrote it, and sends rubySync.ops(key, before, now): never the whole value of a JSON object, so a page
// with a stale copy can only add what it changed itself, not put its old copy back.
//   { k, set }   the whole value, for anything that isn't a JSON object
//   { k, del }   the key removed
//   { k, obj: { set, del, lists, items } }   a JSON object field by field: lists of ids by what moved to
//                the front and what went (My List, history), lists of objects by id (cards)
(function () {
    function parse(text) { try { return text == null ? null : JSON.parse(text); } catch (e) { return null; } }
    function isObject(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
    function same(a, b) { return String(a) === String(b); }
    function has(list, x) { return list.some(function (y) { return same(x, y); }); }
    function primitives(a) { return a.every(function (x) { return x === null || typeof x !== 'object'; }); }
    function withIds(a) { return a.every(function (x) { return isObject(x) && x.id != null; }); }

    // Lampa only ever puts an id at the front or takes one out: the new list is some ids at the front, then
    // the old list without them and without the removed ones. null when it isn't (then the field goes whole).
    function listChange(a, b) {
        var remove = a.filter(function (x) { return !has(b, x); });
        for (var k = 0; k <= b.length; k++) {
            var front = b.slice(0, k);
            var rest = a.filter(function (x) { return !has(remove, x) && !has(front, x); });
            if (JSON.stringify(rest.map(String)) === JSON.stringify(b.slice(k).map(String))) return { front: front, remove: remove };
        }
        return null;
    }
    function itemChange(a, b) {
        var put = b.filter(function (x) {
            var old = a.filter(function (y) { return same(y.id, x.id); })[0];
            return !old || JSON.stringify(old) !== JSON.stringify(x);
        });
        var remove = a.filter(function (x) { return !b.some(function (y) { return same(y.id, x.id); }); }).map(function (x) { return x.id; });
        return { put: put, remove: remove };
    }

    function ops(k, before, now) {
        if (before === now) return null;
        if (now == null) return { k: k, del: true };
        var b = parse(now), a = before == null ? {} : parse(before);   // a new key merges into the server's
        if (!isObject(b) || !isObject(a)) return { k: k, set: now };
        var o = { set: {}, del: [], lists: {}, items: {} }, any = false;
        Object.keys(a).concat(Object.keys(b)).forEach(function (f) {
            if (f in o.set || o.del.indexOf(f) >= 0 || f in o.lists || f in o.items) return;
            var x = a[f], y = b[f];
            if (JSON.stringify(x) === JSON.stringify(y)) return;
            any = true;
            if (y === undefined) return o.del.push(f);
            if (Array.isArray(y) && (x === undefined || Array.isArray(x))) {
                var old = x || [], l;
                if (primitives(old) && primitives(y) && (l = listChange(old, y))) return (o.lists[f] = l);
                if (withIds(old) && withIds(y)) return (o.items[f] = itemChange(old, y));
            }
            o.set[f] = y;
        });
        return any ? { k: k, obj: o } : null;
    }

    window.rubySync = { ops: ops };
})();
