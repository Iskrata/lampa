// Bulgarian subtitles translated from the English ones by an OpenAI model, for a film or episode that has none
// of its own and none on OpenSubtitles (server/remux/README.md, "Translated subtitles"). The lines are
// translated in the order the player needs them, CHUNK at a time, each call with what keeps a film consistent:
// the title's story and characters (TMDB, with the actors' genders: Bulgarian verbs agree with the speaker), a
// glossary of names and terms and notes (who says ти or Вие to whom) that the calls add to, and the lines just
// before. Each translation is kept (by its English text) for everyone, and a file costs at most cfg.translateBudget.
//   book(f, lang) -> Book for a torrent file f = { hash, index, tmdb, kind, name }
//   Book.text(en) -> the translation or undefined; Book.pending(en): not translated yet, and it will be
//   Book.next(cues, from) -> a Promise for the next lines from `from` on, or null: nothing to do (or over budget)
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { json } = require('./pick');

const API = 'https://api.openai.com/v1/chat/completions';
// The models tried (README "Translated subtitles": Fjord, 2026-11-24): USD per 1M tokens (standard tier,
// developers.openai.com/api/docs/pricing, read that day) and the reasoning effort sent ('none': half the cost
// and time of their default, as good)
const MODELS = {
    'gpt-6-luna': { in: 0.10, out: 0.50, effort: 'none' },
    'gpt-5.6-luna': { in: 0.20, out: 1.20, effort: 'none' }
};
const LANGS = { bg: 'Bulgarian' };
const CHUNK = 40, CONTEXT = 8, CAST = 20, NOTES = 40, CALL_MS = 60000, PAUSE_MS = 60000, TRIES = 2;

const key = () => cfg.privateEnv(cfg.openaiEnv, ['OPENAI_API_KEY']).OPENAI_API_KEY;
const configured = () => !!key() && !!MODELS[cfg.translateModel];

function read(file, empty) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return empty; } }
function write(file, o) { fs.mkdirSync(cfg.subs, { recursive: true }); fs.writeFileSync(file, JSON.stringify(o)); }

// The title: its story and characters, once from TMDB; the glossary and notes grow with every call (a series
// shares one across its episodes)
const sheets = new Map();
function sheet(kind, tmdb, lang) {
    const k = `${kind}${tmdb}-${lang}`;
    if (sheets.has(k)) return sheets.get(k);
    const file = path.join(cfg.subs, `tr-${k}.json`);
    const p = (async () => {
        const kept = read(file, null);
        if (kept) return Object.assign(kept, { file });
        const tv = kind === 'tv';
        const d = await json(`https://api.themoviedb.org/3/${kind}/${tmdb}?api_key=${cfg.tmdbKey}&language=en` +
            `&append_to_response=${tv ? 'aggregate_credits' : 'credits'}`, 10000);
        const cast = ((tv ? d.aggregate_credits : d.credits) || {}).cast || [];
        const s = {
            title: d.title || d.name, year: (d.release_date || d.first_air_date || '').slice(0, 4), kind, overview: d.overview || '',
            characters: cast.slice(0, CAST).map(c => ({ name: tv ? ((c.roles || [])[0] || {}).character : c.character, gender: c.gender }))
                .filter(c => c.name),
            glossary: {}, notes: []
        };
        write(file, s);
        return Object.assign(s, { file });
    })();
    sheets.set(k, p);
    p.catch(() => sheets.delete(k));
    return p;
}

const books = new Map();
function book(f, lang) {
    const k = `${f.hash}-${f.index}-${lang}`;
    if (!books.has(k)) books.set(k, new Book(f, lang, path.join(cfg.subs, `tr-${k}.json`)));
    return books.get(k);
}

class Book {
    constructor(f, lang, file) {
        this.f = f;
        this.lang = lang;
        this.file = file;
        this.tag = `${f.hash.slice(0, 8)}:${f.index} ${lang}`;
        this.kept = read(file, { cost: 0, calls: 0, lines: {} });
        this.tries = {};   // English text -> calls that left it out
        this.busy = null;
        this.pauseUntil = 0;
    }

    text(en) { return this.kept.lines[en]; }
    over() { return this.kept.cost >= cfg.translateBudget; }
    pending(en) { return this.kept.lines[en] === undefined && (this.tries[en] || 0) < TRIES && !this.over(); }

    // (n: lines per call; fewer answer sooner: 40 lines took 7.1 s on average with gpt-6-luna. soon: the time
    // by which lines are needed)
    next(cues, from, n = CHUNK, soon = Infinity) {
        if (this.busy) return this.busy;
        if (Date.now() < this.pauseUntil) return null;
        if (this.over()) {
            if (!this.said) console.log(`${this.tag} translation stopped: $${this.kept.cost.toFixed(4)} spent, the limit is $${cfg.translateBudget}`);
            this.said = true;
            return null;
        }
        const at = cues.findIndex(c => c.end > from);
        if (at < 0) return null;
        const todo = [];
        for (let i = at; i < cues.length && todo.length < n; i++) {
            if (this.pending(cues[i].text) && !todo.some(c => c.text === cues[i].text)) todo.push(cues[i]);
        }
        // fewer than a call's worth that nobody needs before `soon`: wait for more (each call sends the title's
        // ~800 tokens again; ffmpeg's English came in 2-6 lines at a time on ruby, 2026-11-24)
        if (!todo.length || (todo.length < n && todo[0].start > soon)) return null;
        // the lines translated just before the first one, for the scene
        const first = cues.indexOf(todo[0]), before = [];
        for (let i = first - 1; i >= 0 && before.length < CONTEXT; i--) if (this.text(cues[i].text)) before.unshift(cues[i]);
        this.busy = this.call(todo, before).catch(e => {
            console.error(`${this.tag} translation: ${e.message}`);
            this.pauseUntil = Date.now() + PAUSE_MS;
        }).finally(() => { this.busy = null; });
        return this.busy;
    }

    async call(todo, before) {
        const s = await sheet(this.f.kind, this.f.tmdb, this.lang), model = cfg.translateModel, m = MODELS[model];
        const t0 = Date.now();
        const body = {
            model,
            messages: [{ role: 'system', content: instructions(LANGS[this.lang]) }, { role: 'user', content: prompt(s, this, todo, before) }],
            response_format: { type: 'json_schema', json_schema: { name: 'subtitles', strict: true, schema: SCHEMA } }
        };
        if (m.effort) body.reasoning_effort = m.effort;
        const r = await fetch(API, {
            method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_MS),
            headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' }
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`${model} answered ${r.status}: ${(j.error && j.error.message) || ''}`.slice(0, 300));
        const u = j.usage || {}, cost = ((u.prompt_tokens || 0) * m.in + (u.completion_tokens || 0) * m.out) / 1e6;
        this.kept.cost += cost;
        this.kept.calls++;
        this.kept.model = model;
        const out = JSON.parse(j.choices[0].message.content);
        let got = 0;
        for (const l of out.lines) {
            const c = todo[l.id - 1];
            if (c && l.text.trim()) { this.kept.lines[c.text] = l.text.trim().replace(/\\n/g, '\n'); got++; }
        }
        for (const c of todo) if (this.kept.lines[c.text] === undefined) this.tries[c.text] = (this.tries[c.text] || 0) + 1;
        write(this.file, this.kept);
        for (const g of out.glossary) if (g.english && g.translation && !s.glossary[g.english]) s.glossary[g.english] = g.translation;
        s.notes = s.notes.concat(out.notes.filter(n => n && !s.notes.includes(n))).slice(-NOTES);
        const { file, ...kept } = s;
        write(file, kept);
        const thought = (u.completion_tokens_details || {}).reasoning_tokens;
        console.log(`${this.tag} translated ${got}/${todo.length} lines with ${model} in ${((Date.now() - t0) / 1000).toFixed(1)} s: ` +
            `${u.prompt_tokens}+${u.completion_tokens}${thought ? ` (${thought} reasoning)` : ''} tokens, $${cost.toFixed(4)} (this file $${this.kept.cost.toFixed(4)})`);
    }
}

const SCHEMA = {
    type: 'object', additionalProperties: false, required: ['lines', 'glossary', 'notes'],
    properties: {
        lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'],
            properties: { id: { type: 'integer' }, text: { type: 'string' } } } },
        glossary: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['english', 'translation'],
            properties: { english: { type: 'string' }, translation: { type: 'string' } } } },
        notes: { type: 'array', items: { type: 'string' } }
    }
};

function instructions(language) {
    return [
        `You translate film and TV subtitles from English into ${language}, the way a good professional ${language} subtitle reads.`,
        `- Natural spoken ${language}, not word for word. About as short as the English, so it can be read in time; at most two lines (\\n), split where the English splits when the line is long.`,
        '- Each line keeps its own meaning: never move words from one line to another. Keep <i>...</i> tags, and the leading "-" of two speakers in one line.',
        `- Names and recurring terms: use the glossary's spelling. A new name or term goes into "glossary" with its ${language} form (names transliterated the usual way for ${language}). A name someone gets wrong (a teacher calling Elia "Ella") stays wrong, transliterated as said, and stays out of the glossary.`,
        `- ${language} verbs and adjectives agree with the speaker's and the listener's gender. Work out who speaks to whom from the scene and the characters list, and stay consistent.`,
        language === 'Bulgarian' ? '- ти or Вие: family, friends and children say ти; strangers, officials, police, doctors, lawyers and teachers speaking to parents say Вие, unless the scene shows otherwise. Keep each pair\'s choice the same all through.' : '',
        '- "notes": short facts the next lines need to stay consistent and that the notes don\'t have yet (who says ти or Вие to whom, who is whose relative, a character\'s gender when the characters list doesn\'t give it). Usually none.',
        '- Translate sound descriptions in brackets too. Give back every id exactly once.'
    ].filter(Boolean).join('\n');
}

const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function prompt(s, b, todo, before) {
    const ep = /S(\d{1,2})[ ._-]?E(\d{1,3})/i.exec(b.f.name || '');
    const g = Object.entries(s.glossary);
    return [
        `Title: ${s.title}${s.year ? ` (${s.year})` : ''}, ${s.kind === 'tv' ? 'TV series' + (ep ? `, season ${+ep[1]} episode ${+ep[2]}` : '') : 'film'}`,
        s.overview && `Story: ${s.overview}`,
        s.characters.length && `Characters (the actor's gender): ${s.characters.map(c => `${c.name} (${['?', 'f', 'm', 'nb'][c.gender] || '?'})`).join('; ')}`,
        g.length && `Glossary: ${g.map(([e, t]) => `${e} = ${t}`).join('; ')}`,
        s.notes.length && `Notes:\n${s.notes.map(n => `- ${n}`).join('\n')}`,
        before.length && `Lines just before (already translated):\n${before.map(c => `[${clock(c.start)}] ${oneLine(c.text)} => ${oneLine(b.text(c.text))}`).join('\n')}`,
        `Translate (id [time] text):\n${todo.map((c, i) => `${i + 1} [${clock(c.start)}] ${oneLine(c.text)}`).join('\n')}`
    ].filter(Boolean).join('\n\n');
}

// one subtitle per prompt line: its own line breaks as \n
const oneLine = t => t.replace(/\r?\n/g, '\\n');

module.exports = { book, configured, LANGS, MODELS };
