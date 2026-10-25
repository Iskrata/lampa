// How a profile change is applied on the server (README.md "Changes"). Browsers never send a whole profile:
// each sends what it changed, key by key, and the server applies that to its own copy, the only one that
// counts. A stale browser's copy therefore can't put old data back: it can only add what it changed.
//
// A profile file: { t, v, keys: { <Lampa localStorage key>: <string> }, by }. Most values are JSON text.
// A change ("op") names one key:
//   { k, set: "<text>" }            the whole value (anything that isn't a JSON object)
//   { k, del: true }                the key removed (a logout, a cleared list)
//   { k, obj: {                     a JSON object changed field by field (favorite, file_view, ratings...)
//       set:   { field: value },    fields added or changed
//       del:   [ field ],           fields removed
//       lists: { field: { front: [ids], remove: [ids] } },   lists of ids (My List, history): what moved to
//                                   the front (Lampa adds at the front) and what was removed
//       items: { field: { put: [objects with id], remove: [ids] } } }   lists of objects (cards), by id
'use strict';

const parse = s => { try { return s == null ? null : JSON.parse(s); } catch (e) { return null; } };
const same = (a, b) => String(a) === String(b);   // ids come as numbers and as strings
const isObject = o => o !== null && typeof o === 'object' && !Array.isArray(o);

const older = (v, kept) => isObject(v) && isObject(kept) && typeof v.updated === 'number' && typeof kept.updated === 'number' && v.updated < kept.updated;

function applyObject(text, o) {
    const cur = parse(text), out = isObject(cur) ? cur : {};
    // a stamped field (file_view's progress, Lampa's `updated`) older than the one kept is a stale page's
    // copy: it can't put an old place back over a newer one (2026-10-25, a tab paused since 22 Oct)
    for (const [f, v] of Object.entries(o.set || {})) {
        if (older(v, out[f])) continue;
        out[f] = v;
    }
    for (const f of o.del || []) delete out[f];
    for (const [f, l] of Object.entries(o.lists || {})) {
        const front = l.front || [], remove = l.remove || [];
        const list = Array.isArray(out[f]) ? out[f] : [];
        out[f] = front.concat(list.filter(x => !front.some(y => same(x, y)) && !remove.some(y => same(x, y))));
    }
    for (const [f, l] of Object.entries(o.items || {})) {
        let list = (Array.isArray(out[f]) ? out[f] : []).filter(x => !(l.remove || []).some(id => x && same(x.id, id)));
        for (const item of l.put || []) {
            const i = list.findIndex(x => x && same(x.id, item.id));
            if (i >= 0) list[i] = item; else list.push(item);
        }
        out[f] = list;
    }
    return JSON.stringify(out);
}

// apply ops to a profile's keys (changed in place); returns the keys changed
function apply(keys, ops) {
    const changed = [];
    for (const op of ops || []) {
        if (!op || typeof op.k !== 'string') continue;
        const before = keys[op.k];
        if (op.del) delete keys[op.k];
        else if (typeof op.set === 'string') keys[op.k] = op.set;
        else if (isObject(op.obj)) keys[op.k] = applyObject(keys[op.k], op.obj);
        else continue;
        if (keys[op.k] !== before) changed.push(op.k);
    }
    return changed;
}

module.exports = { apply, applyObject, parse };
