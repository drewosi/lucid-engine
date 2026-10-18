import { sortedPaths, st } from './state.js';
import { tierNote } from './lang-tiers.js';
import { queryTerms } from './smart-context.js';
import { localSearchData } from './actions.js';
import { fmtTok } from './helpers.js';
import { isMulti, repoName, resolveCitePath, workspaceFacts } from './repos.js';
/* ============ INTENT HELPERS (shared by the intent groups) ============
   Evidence builders, symbol/path pickers, terrain gathering and the list/graph
   helpers every deterministic intent in intents-*.js is built from. Split out of
   intents.js unchanged; intents.js still owns the registry order and the router. */
var CAP_LOCAL = ['Project structure', 'Search', 'Definitions', 'References', 'Imports & importers', 'File relationships', 'Recent changes', 'Dependency graph (cycles · hubs · orphans · broken imports · paths)', 'Code health (TODOs · env vars · duplicates · hotspots)', 'Exports & coverage gaps', 'Signals digest', 'Session drift', 'Cross-repo comparison', 'Evidence collection'];
var CAP_MODEL = ['Architectural reasoning', 'Natural-language synthesis', 'Root-cause analysis', 'Refactoring recommendations'];

function localEvidence(h) {
  return { file: h.p, startLine: h.line, endLine: h.line, quote: String(h.text).trim().slice(0, 120), kind: 'evidence' };
}
function lineText(file, line) {
  var f = st.files.get(file); if (!f) return '';
  return (f.content.split('\n')[line - 1] || '').trim().slice(0, 120);
}
function evAt(file, line) { return { file: file, startLine: line, endLine: line, quote: lineText(file, line), kind: 'evidence' }; }

/* resolve a natural-language argument to a loaded file path (basename-aware) */
function resolveToFile(arg) {
  if (!arg) return null;
  arg = resolveCitePath(arg); /* accepts the workspace "repo:path" form */
  if (st.files.has(arg)) return arg;
  var base = arg.slice(arg.lastIndexOf('/') + 1).toLowerCase(), la = arg.toLowerCase();
  var exact = null, contains = null;
  st.files.forEach(function (f, p) {
    var b = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
    if (b === base) { if (!exact) exact = p; }
    else if (!contains && (b.indexOf(base) !== -1 || p.toLowerCase().indexOf(la) !== -1)) contains = p;
  });
  return exact || contains;
}
/* look a symbol up in the index: exact → last dotted segment → case-insensitive */
function symLookup(name, idx) {
  if (!name) return [];
  if (idx.symbols.has(name)) return idx.symbols.get(name);
  var last = name.split('.').pop();
  if (last !== name && idx.symbols.has(last)) return idx.symbols.get(last);
  var lc = name.toLowerCase(), out = [];
  idx.symbols.forEach(function (arr, k) { if (k.toLowerCase() === lc) out = out.concat(arr); });
  return out;
}

/* null-prototype: looked up with project-supplied tokens — a token named
   `constructor` must not be treated as a stop word */
var STOP_INTENT = Object.assign(Object.create(null), { where: 1, what: 1, which: 1, who: 1, does: 1, do: 1, is: 1, are: 1, the: 1, file: 1, files: 1, function: 1, functions: 1, method: 1, methods: 1, symbol: 1, symbols: 1, class: 1, classes: 1, defined: 1, definition: 1, declared: 1, reference: 1, references: 1, referenced: 1, import: 1, imports: 1, imported: 1, related: 1, project: 1, structure: 1, test: 1, tests: 1, entry: 1, point: 1, points: 1, recent: 1, recently: 1, show: 1, list: 1, find: 1, all: 1, call: 1, calls: 1, uses: 1, used: 1, depend: 1, depends: 1, this: 1, that: 1, for: 1, and: 1, with: 1 });
/* usage/dependency verbs — never the search target itself, so when pickSymbol
   falls back to bare query terms these are skipped in favor of the real noun
   ("who uses the store" must pick `store`, not the verb `uses`) */
var PICK_SKIP = Object.assign(Object.create(null), { uses: 1, use: 1, used: 1, using: 1, call: 1, calls: 1, called: 1, calling: 1, import: 1, imports: 1, imported: 1, importing: 1, depend: 1, depends: 1, depended: 1, reference: 1, references: 1, referenced: 1 });
/* question grammar — never the symbol a question is about, even when the project
   happens to define a symbol with that name (Godot defines `where`). A grammar
   word is only picked when it is the one explicitly named: "where is where defined". */
var GRAMMAR = Object.assign(Object.create(null), STOP_INTENT, PICK_SKIP, { how: 1, why: 1, when: 1, whom: 1, whose: 1, was: 1, were: 1, be: 1, been: 1, did: 1, done: 1,
  a: 1, an: 1, of: 1, to: 1, in: 1, on: 1, at: 1, by: 1, from: 1, into: 1, or: 1, it: 1, its: 1, me: 1, my: 1, i: 1, you: 1, can: 1, could: 1, would: 1, should: 1,
  we: 1, us: 1, our: 1, your: 1, they: 1, them: 1, there: 1, here: 1, any: 1, some: 1, not: 1, no: 1,
  define: 1, defines: 1, declare: 1, declares: 1, declaration: 1, location: 1, located: 1, locate: 1, live: 1, lives: 1, implemented: 1, get: 1, gets: 1,
  variable: 1, var: 1, const: 1, type: 1, struct: 1, enum: 1, interface: 1, called: 1, invoked: 1, invokes: 1 });
var KIND_WORDS = '(?:(?:the|a|an)\\s+)?(?:(?:function|method|class|symbol|variable|const|constant|type|struct|enum|interface|field|property|signal)\\s+)?';
var IDENT = '([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)';
/* positional slots, strongest first: "is X defined", "where is X", "define X",
   "who calls X", "references to X", "find X". The first slot holding a
   non-grammar word names the symbol; `is X defined` accepts any X but a pronoun. */
var SLOT_RES = [
  new RegExp('\\b(?:is|are|was)\\s+' + KIND_WORDS + IDENT + '\\s+(?:defined|declared|implemented|created|set|used|called|referenced|imported)\\b', 'i'),
  new RegExp('\\bwhere(?:\'s|\\s+is|\\s+are|\\s+was|\\s+does|\\s+do)?\\s+' + KIND_WORDS + IDENT, 'i'),
  new RegExp('\\b(?:define[sd]?|declares?|definition\\s+of|declaration\\s+of)\\s+' + KIND_WORDS + IDENT, 'i'),
  new RegExp('\\b(?:who|what|which)\\s+(?:calls|uses|references|invokes|imports|depends\\s+on)\\s+' + KIND_WORDS + IDENT, 'i'),
  new RegExp('\\b(?:references?|refs|callers|usages?|uses|call\\s+sites?)\\s+(?:to|of|for)\\s+' + KIND_WORDS + IDENT, 'i'),
  new RegExp('\\b(?:find|locate|show)\\s+' + KIND_WORDS + IDENT, 'i')
];
var PRONOUN = Object.assign(Object.create(null), { it: 1, this: 1, that: 1, them: 1, they: 1, the: 1, a: 1, an: 1 });
function slotSymbol(q) {
  for (var i = 0; i < SLOT_RES.length; i++) {
    var m = q.match(SLOT_RES[i]);
    if (!m) continue;
    var w = m[1], lw = w.toLowerCase();
    if (i === 0 ? !PRONOUN[lw] : !GRAMMAR[lw]) return w;
  }
  return '';
}
/* pick the most identifier-like token from a question (for def/refs/symbols) */
function pickSymbol(q, idx) {
  var bt = q.match(/`([^`]+)`/); if (bt) return bt[1].trim();
  var qq = q.match(/["“”']([^"“”']+)["“”']/); if (qq) return qq[1].trim();
  var slot = slotSymbol(q); if (slot) return slot;
  var toks = q.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) || [];
  if (idx) { for (var i = 0; i < toks.length; i++) { if (!GRAMMAR[toks[i].toLowerCase()] && symLookup(toks[i], idx).length) return toks[i]; } }
  var fancy = toks.filter(function (t) { return (/[A-Z]/.test(t) || t.indexOf('_') !== -1 || t.indexOf('.') !== -1 || /\d/.test(t)) && !STOP_INTENT[t.toLowerCase()]; });
  if (fancy.length) return fancy.sort(function (a, b) { return b.length - a.length; })[0];
  var terms = queryTerms(q);
  for (var ti = 0; ti < terms.length; ti++) if (!PICK_SKIP[terms[ti]]) return terms[ti]; /* prefer the noun over a usage verb */
  return terms.length ? terms[0] : '';
}
/* pick a path-ish token from a question (for imports/importers/related/dir) */
function pickPathish(q) {
  var bt = q.match(/`([^`]+)`/); if (bt) return bt[1].trim();
  var qq = q.match(/["“”']([^"“”']+)["“”']/); if (qq) return qq[1].trim();
  var withExt = q.match(/[\w./:-]*[\w-]\.[A-Za-z]{1,6}\b/); if (withExt) return withExt[0]; /* ':' keeps a "repo:path" whole */
  var withSlash = q.match(/[\w.-]+\/[\w./-]+/); if (withSlash) return withSlash[0];
  return pickSymbol(q);
}

var LOCAL_VERDICT = function () { return { local: true, text: 'KNOWN LOCALLY' }; };

/* the index is still being built (or its build was cancelled): say so on every answer */
function partialNote(idx) {
  return '\n\n**Partial index:** ' + idx.scanned + ' of ' + idx.fileCount + ' files indexed so far. Counts, orphans and import edges can change when indexing finishes; ask again then for a complete answer.';
}

/* honest-labeling note for graph answers: the indexer skips >400-char lines, so
   import edges on them are invisible — orphans/broken must say so, not imply certainty */
function longLineNote(idx) {
  var out = tierNote(idx.langs);
  if (idx.longLineCount) {
    out += '\n\nNote: ' + plural(idx.longLineCount, 'line') + ' over 400 chars in ' + plural(Object.keys(idx.longLinesByFile).length, 'file')
      + ' were not indexed (minified/one-line content): imports on those lines are invisible, so such files can appear orphaned or their targets unresolved.';
    var pct = idx.lineCount ? idx.longLineCount * 100 / idx.lineCount : 0;
    if (pct > 10) out += '\n\n**Warning:** ' + Math.round(pct) + '% of all lines were skipped as over-long. This index is unreliable for this project; treat counts and graph answers as lower bounds.';
  }
  if (idx.generated && idx.generated.length) {
    out += '\n\nNote: ' + plural(idx.generated.length, 'generated/minified/vendored file') + ' (e.g. `' + idx.generated.slice(0, 3).map(function (g) { return g.file; }).join('`, `')
      + '`) were not mined for symbols or imports.';
  }
  return out;
}

/* shared evidence-gathering used by plain + reason: term search → ranked files.
   When the operator has pinned citations, the search scopes to the pinned files
   (disclosed as the first step) — precise intents (def/refs/…) stay unscoped. */
function gatherTerrain(q, steps) {
  var terms = queryTerms(q), perFile = Object.create(null);
  var pinFiles = null;
  if (st.pinnedEv && st.pinnedEv.length) {
    pinFiles = Object.create(null);
    st.pinnedEv.forEach(function (ev) { pinFiles[ev.file] = 1; });
    var pfN = Object.keys(pinFiles).length;
    steps.push({ action: 'scope to pinned evidence', note: plural(st.pinnedEv.length, 'pinned citation') + ' across ' + plural(pfN, 'file'),
      evidence: st.pinnedEv.slice(0, 8).map(function (ev) { return { file: ev.file, startLine: ev.startLine || 1, endLine: ev.endLine || ev.startLine || 1, quote: ev.quote || '', kind: 'evidence' }; }), status: 'done' });
  }
  steps.push({ action: 'extract search terms', note: terms.length ? terms.join(', ') : 'none', evidence: [], status: 'done' });
  terms.slice(0, 4).forEach(function (t) {
    var r = localSearchData(t, 'text');
    var hits = pinFiles ? r.hits.filter(function (h) { return pinFiles[h.p]; }) : r.hits;
    steps.push({ action: 'search “' + t + '”' + (pinFiles ? ' (pinned files only)' : ''), note: hits.length ? hits.length + ' hit' + (hits.length === 1 ? '' : 's') : 'no matches', evidence: hits.slice(0, 4).map(localEvidence), status: 'done' });
    hits.forEach(function (h) { (perFile[h.p] || (perFile[h.p] = { count: 0, first: h })).count++; });
  });
  var ranked = Object.keys(perFile).map(function (p) {
    return { p: p, count: perFile[p].count, first: perFile[p].first, score: perFile[p].count * 10 + (st.files.has(p) ? st.files.get(p).base : 0) };
  }).sort(function (a, b) { return b.score - a.score; }).slice(0, 8);
  if (ranked.length) steps.push({ action: 'rank relevant files', note: ranked.length + ' file' + (ranked.length === 1 ? '' : 's') + ' · hits + importance', evidence: ranked.map(function (r) { return localEvidence(r.first); }), status: 'done' });
  return { terms: terms, ranked: ranked };
}

/* data-level directory summary + recent, mirroring runDirSummary / runRecent */
function localDirData(dirPath) {
  var clean = dirPath.replace(/\/+$/, '');
  var prefix = clean === '.' || clean === '' ? '' : clean + '/';
  var items = [];
  st.files.forEach(function (f, p) { if (!prefix || p.indexOf(prefix) === 0) items.push({ p: p, f: f }); });
  if (!items.length) return { answer: 'No loaded files under “' + dirPath + '”.', steps: [{ n: 1, action: 'summarize ' + (prefix || './'), note: 'no files', evidence: [] }] };
  var tok = 0;
  items.forEach(function (it) { tok += it.f.tokens; });
  var largest = items.slice().sort(function (a, b) { return b.f.tokens - a.f.tokens; }).slice(0, 5);
  var ans = '`' + (prefix || './') + '`: ' + items.length + ' file' + (items.length === 1 ? '' : 's') + ' ≈' + fmtTok(tok) + ' tokens. Largest:\n\n'
    + largest.map(function (it, i) { return (i + 1) + '. `' + it.p + '` ≈' + fmtTok(it.f.tokens); }).join('\n');
  return { answer: ans, steps: [{
    n: 1, action: 'summarize ' + (prefix || './'),
    note: items.length + ' files ≈' + fmtTok(tok) + ' tokens',
    evidence: largest.map(function (it) { return { file: it.p, startLine: 1, endLine: 1, quote: '' }; })
  }] };
}
function localRecentData(countStr) {
  var n = Math.min(Math.max(parseInt(countStr, 10) || 10, 1), 20);
  var all = [];
  st.files.forEach(function (f, p) { all.push({ p: p, m: f.mtime }); });
  all.sort(function (a, b) { return b.m - a.m; });
  var top = all.slice(0, n);
  var ans = top.length
    ? 'Most recently modified (from file mtimes):\n\n' + top.map(function (it, i) {
        return (i + 1) + '. `' + it.p + '`' + (it.m ? ' · ' + new Date(it.m).toISOString().slice(0, 10) : '');
      }).join('\n')
    : 'No files loaded.';
  return { answer: ans, steps: [{
    n: 1, action: 'list recent files', note: top.length + ' file' + (top.length === 1 ? '' : 's'),
    evidence: top.map(function (it) { return { file: it.p, startLine: 1, endLine: 1, quote: '' }; })
  }] };
}

/* ---- graph + classification helpers for the niche reasoning instances.
   All computed on demand from the already-built index — nothing stored,
   nothing re-parsed. Iterative traversals only (no recursion depth risk). ---- */
var CODE_LANGS = Object.assign(Object.create(null), { js: 1, ts: 1, python: 1, go: 1, rust: 1, java: 1, ruby: 1, php: 1, c: 1, cpp: 1, 'c#': 1, swift: 1, kotlin: 1, scala: 1, elixir: 1, lua: 1, svelte: 1, vue: 1 });
function isCodeFile(p) { var f = st.files.get(p); return !!(f && CODE_LANGS[f.lang || '']); }
function classifiedSet(idx) {
  var s = Object.create(null);
  idx.entries.concat(idx.tests, idx.configs, idx.docs).forEach(function (p) { s[p] = 1; });
  return s;
}
/* unresolved relative imports — shared by the broken investigation and signals */
/* images, video, audio and fonts are never loaded (text files only), so an import of
   one can't be checked: listed separately instead of being called broken */
var ASSET_IMPORT_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|pdf|glb|gltf)(\?.*)?$/i;
function unresolvedRelative(idx, wantAssets) {
  var out = [];
  idx.importsByFile.forEach(function (list, f) {
    list.forEach(function (x) {
      if (x.resolved || (x.raw.charAt(0) !== '.' && x.raw.charAt(0) !== '/')) return;
      if (ASSET_IMPORT_RE.test(x.raw) === !!wantAssets) out.push({ file: f, raw: x.raw, line: x.line });
    });
  });
  return out;
}
function listBroken(idx) { return unresolvedRelative(idx, false); }
function listAssetImports(idx) { return unresolvedRelative(idx, true); }
function assetNote(idx) {
  var a = listAssetImports(idx);
  return a.length ? '\n\nNot checked: ' + plural(a.length, 'import') + ' of images, video, audio or fonts (first: `' + a[0].file + '` line ' + a[0].line + ' → `' + a[0].raw + '`). Meridian only loads text files, so it cannot tell whether those exist.' : '';
}
/* duplicate definitions, shared by the dupes investigation and signals. Counts only
   top-level functions, classes and types (and variables holding one), outside test
   files, and skips conventional entry-point names every script repeats. Local
   variables like `rows` or `base` in two files are normal code, not a finding. */
var DUPE_CONVENTION = Object.assign(Object.create(null), { main: 1, init: 1, __init__: 1, setup: 1, teardown: 1, render: 1, constructor: 1, toString: 1, handler: 1 });
function listDupes(idx) {
  var testSet = Object.create(null), dupes = [];
  idx.tests.forEach(function (t) { testSet[t] = 1; });
  idx.symbols.forEach(function (defsArr, name) {
    if (name.length < 4 || DUPE_CONVENTION[name]) return;
    var perFile = Object.create(null);
    defsArr.forEach(function (d) { if (d.top && d.unit && !testSet[d.file] && !perFile[d.file]) perFile[d.file] = d; });
    var files = Object.keys(perFile);
    if (files.length > 1) dupes.push({ name: name, defs: files.map(function (f) { return perFile[f]; }) });
  });
  dupes.sort(function (a, b) { return b.defs.length - a.defs.length || (a.name < b.name ? -1 : 1); });
  return dupes;
}
/* code files with no matching test — shared by the untested investigation and signals */
function listUntestedGaps(idx) {
  var stems = Object.create(null), testedByImport = Object.create(null), skip = Object.create(null);
  idx.tests.forEach(function (t) {
    stems[testStem(t)] = 1; skip[t] = 1;
    (idx.importsByFile.get(t) || []).forEach(function (x) { if (x.resolved) testedByImport[x.resolved] = 1; });
  });
  idx.configs.concat(idx.docs).forEach(function (p) { skip[p] = 1; });
  var gaps = [];
  sortedPaths().forEach(function (p) {
    if (skip[p] || !isCodeFile(p)) return;
    if (stems[baseStem(p)] || testedByImport[p]) return;
    gaps.push(p);
  });
  return gaps;
}
/* code files never imported and not classified — shared by the orphans
   investigation and the overview tile so both always agree */
function listOrphans(idx) {
  var skip = classifiedSet(idx), orphans = [];
  sortedPaths().forEach(function (p) {
    if (skip[p] || !isCodeFile(p)) return;
    if ((idx.importedBy.get(p) || []).length) return;
    orphans.push(p);
  });
  return orphans;
}
/* ---- Signal extraction: the top findings worth attention, ranked by severity.
   Every signal is computed from analyses the niche intents already run — the
   digest and its drill-in intents always agree. Cached on index identity so the
   overview tile and the intent share one computation per index build. ---- */
var SEV_LABEL = { 5: 'CRITICAL', 4: 'HIGH', 3: 'MEDIUM', 2: 'LOW' };
var sigCache = { idx: null, out: null };
function computeSignals(idx) {
  if (sigCache.idx === idx) return sigCache.out;
  var out = [];
  var broken = listBroken(idx);
  if (broken.length) {
    /* CRITICAL only when production code is affected; broken imports confined to
       test files are real but lower stakes */
    var testSet = Object.create(null); idx.tests.forEach(function (t) { testSet[t] = 1; });
    var prod = broken.filter(function (b) { return !testSet[b.file]; });
    if (prod.length) out.push({ severity: 5, count: broken.length, title: plural(broken.length, 'broken relative import') + ': likely real breakage, or files not loaded', evidence: evAt(prod[0].file, prod[0].line), drill: 'broken' });
    else out.push({ severity: 3, count: broken.length, title: plural(broken.length, 'broken relative import') + ' in test files only', evidence: evAt(broken[0].file, broken[0].line), drill: 'broken' });
  }
  var cycles = findCycles(idx, 10);
  if (cycles.length) out.push({ severity: 4, count: cycles.length, title: plural(cycles.length, 'import cycle') + (cycles.length >= 10 ? ' (search capped at 10: more may exist)' : '') + ' in the dependency graph', evidence: evAt(cycles[0].from, cycles[0].line), drill: 'cycles' });
  var hubGaps = listUntestedGaps(idx).filter(function (p) { return (idx.importedBy.get(p) || []).length >= 3; });
  if (hubGaps.length) {
    hubGaps.sort(function (a, b) { return (idx.importedBy.get(b) || []).length - (idx.importedBy.get(a) || []).length; });
    out.push({ severity: 3, count: hubGaps.length, title: plural(hubGaps.length, 'untested load-bearing file') + ' (imported by 3+, no test)', evidence: evAt(hubGaps[0], 1), drill: 'untested' });
  }
  var dupeNames = listDupes(idx);
  if (dupeNames.length >= 3) out.push({ severity: 2, count: dupeNames.length, title: plural(dupeNames.length, 'top-level function or class name') + ' defined in more than one file', evidence: evAt(dupeNames[0].defs[0].file, dupeNames[0].defs[0].line), drill: 'dupes' });
  var orphans = listOrphans(idx);
  if (orphans.length) out.push({ severity: 2, count: orphans.length, title: plural(orphans.length, 'code file') + ' never imported: possible dead weight', evidence: evAt(orphans[0], 1), drill: 'orphans' });
  var byFileTodo = Object.create(null), maxOneFile = 0;
  idx.todos.forEach(function (t) { byFileTodo[t.file] = (byFileTodo[t.file] || 0) + 1; if (byFileTodo[t.file] > maxOneFile) maxOneFile = byFileTodo[t.file]; });
  if (idx.todos.length >= 10 || maxOneFile >= 5) out.push({ severity: 2, count: idx.todos.length, title: plural(idx.todos.length, 'debt tag') + (maxOneFile >= 5 ? ': one file carries ' + maxOneFile : ' across the project'), evidence: evAt(idx.todos[0].file, idx.todos[0].line), drill: 'todos' });
  out.sort(function (a, b) { return b.severity - a.severity || b.count - a.count; });
  out = out.slice(0, 5);
  sigCache.idx = idx; sigCache.out = out;
  return out;
}

/* iterative 3-color DFS over resolved import edges; returns up to cap cycles,
   each with the node ring and the import line that closes it */
function findCycles(idx, cap) {
  var adj = new Map();
  idx.importsByFile.forEach(function (list, f) {
    var t = [], seen = Object.create(null);
    list.forEach(function (x) { if (x.resolved && x.resolved !== f && !seen[x.resolved]) { seen[x.resolved] = 1; t.push({ to: x.resolved, line: x.line }); } });
    adj.set(f, t);
  });
  var color = new Map(), cycles = [];
  adj.forEach(function (_, start) {
    if (color.get(start) || cycles.length >= cap) return;
    var stack = [{ node: start, i: 0 }], path = [start], onPath = Object.create(null);
    onPath[start] = 1; color.set(start, 1);
    while (stack.length && cycles.length < cap) {
      var top = stack[stack.length - 1];
      var edges = adj.get(top.node) || [];
      if (top.i < edges.length) {
        var e = edges[top.i++];
        if (onPath[e.to]) cycles.push({ nodes: path.slice(path.indexOf(e.to)).concat([e.to]), from: top.node, line: e.line });
        else if (!color.get(e.to)) { color.set(e.to, 1); onPath[e.to] = 1; path.push(e.to); stack.push({ node: e.to, i: 0 }); }
      } else {
        color.set(top.node, 2); delete onPath[top.node]; path.pop(); stack.pop();
      }
    }
  });
  return cycles;
}
/* BFS shortest chain from `from` to `to` over resolved import edges */
function bfsPath(idx, from, to) {
  var prev = new Map(); prev.set(from, null);
  var queue = [from], qi = 0;
  while (qi < queue.length) {
    var n = queue[qi++];
    if (n === to) break;
    (idx.importsByFile.get(n) || []).forEach(function (x) {
      if (x.resolved && !prev.has(x.resolved)) { prev.set(x.resolved, n); queue.push(x.resolved); }
    });
  }
  if (!prev.has(to)) return null;
  var chain = [], cur = to;
  while (cur !== null) { chain.unshift(cur); cur = prev.get(cur); }
  return chain;
}
/* the import line that realizes the edge a → b, for hop-level evidence */
function edgeLine(idx, a, b) {
  var list = idx.importsByFile.get(a) || [];
  for (var i = 0; i < list.length; i++) if (list[i].resolved === b) return list[i].line;
  return 1;
}
/* strip test decorations from a basename so store.test.js covers store.js */
function baseStem(p) {
  return p.slice(p.lastIndexOf('/') + 1).toLowerCase().replace(/\.[^.]+$/, '');
}
function testStem(p) {
  return baseStem(p).replace(/^test[_-]?/, '').replace(/[._-]?(test|spec)s?$/, '');
}
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

/* the cross-repo investigation: per-repo stats, shared dependencies, repo links,
   cross-repo imports and shared exported names, every row pinned to evidence */
function workspaceRun(idx) {
  if (!isMulti()) {
    return { steps: [{ action: 'read the workspace', note: 'one project loaded', evidence: [], status: 'done' }], verdict: LOCAL_VERDICT(),
      answer: 'Only one project is loaded, so there is nothing to compare across repos. Add another folder with **[ + ADD REPO ]** under WORKSPACE in the rail, then ask `workspace` again.' };
  }
  var f = workspaceFacts(idx), steps = [];
  function names(rs) { return rs.map(function (r) { return '`' + repoName(r) + '`'; }).join(', '); }
  var total = 0;
  f.repos.forEach(function (r) { total += r.files; });
  var entryEv = [];
  f.repos.forEach(function (r) { r.entries.slice(0, 2).forEach(function (p) { entryEv.push(evAt(p, 1)); }); });
  steps.push({ action: 'read each repo\'s index', note: plural(f.repos.length, 'repo') + ' · ' + plural(total, 'file'), evidence: entryEv.slice(0, 8), status: 'done' });
  var depEv = [];
  f.sharedDeps.slice(0, 4).forEach(function (d) { d.ev.forEach(function (e) { depEv.push(evAt(e.file, e.line)); }); });
  f.links.slice(0, 4).forEach(function (l) { depEv.push(evAt(l.file, l.line)); });
  steps.push({ action: 'compare dependency manifests', note: f.sharedDeps.length + ' shared ' + (f.sharedDeps.length === 1 ? 'dependency' : 'dependencies') + ' · ' + plural(f.links.length, 'repo link'), evidence: depEv.slice(0, 8), status: 'done' });
  steps.push({ action: 'trace imports that cross repos', note: f.crossImports.length ? plural(f.crossImports.length, 'repo pair') : 'none resolved', evidence: f.crossImports.slice(0, 6).map(function (c) { return evAt(c.file, c.line); }), status: 'done' });
  var nameEv = [];
  f.sharedNames.slice(0, 4).forEach(function (n) { n.ev.forEach(function (e) { nameEv.push(evAt(e.file, e.line)); }); });
  steps.push({ action: 'match exported names across repos', note: plural(f.sharedNames.length, 'name'), evidence: nameEv.slice(0, 8), status: 'done' });
  var ans = '**Workspace:** ' + plural(f.repos.length, 'repo') + ', ' + plural(total, 'file') + '. Each repo has its own index; this answer reads them together.\n\n'
    + '**Repos**\n' + f.repos.map(function (r) {
      var langs = Object.keys(r.langs).filter(function (l) { return l !== 'other'; }).sort(function (a, b) { return r.langs[b] - r.langs[a]; }).slice(0, 3);
      return '- `' + r.name + '`: ' + plural(r.files, 'file') + (langs.length ? ' · ' + langs.map(function (l) { return l + ' (' + r.langs[l] + ')'; }).join(', ') : '')
        + ' · ' + plural(r.entries.length, 'entry point') + ' · ' + plural(r.tests, 'test file') + ' · ' + plural(r.symbols, 'symbol')
        + (r.packages.length ? ' · publishes ' + r.packages.slice(0, 3).map(function (p) { return '`' + p + '`'; }).join(', ') : '');
    }).join('\n') + '\n\n'
    + '**Shared dependencies** (declared by 2+ repos): ' + (f.sharedDeps.length
      ? f.sharedDeps.slice(0, 12).map(function (d) { return '`' + d.name + '` (' + names(d.repos) + ')'; }).join(', ') + (f.sharedDeps.length > 12 ? ', +' + (f.sharedDeps.length - 12) + ' more' : '')
      : 'none found in package.json, requirements.txt, go.mod, Cargo.toml, composer.json or Gemfile') + '\n'
    + (f.links.length ? '**Repo links** (a dependency another loaded repo publishes): ' + f.links.slice(0, 8).map(function (l) { return '`' + repoName(l.from) + '` → `' + repoName(l.to) + '` via `' + l.pkg + '`'; }).join(', ') + '\n' : '')
    + '**Cross-repo imports:** ' + (f.crossImports.length
      ? f.crossImports.slice(0, 8).map(function (c) { return '`' + repoName(c.from) + '` → `' + repoName(c.to) + '` ×' + c.count; }).join(', ')
      : 'none resolved. Each repo\'s imports stay inside it, or point at packages that are not loaded here') + '\n'
    + '**Exported in 2+ repos:** ' + (f.sharedNames.length
      ? f.sharedNames.slice(0, 10).map(function (n) { return '`' + n.name + '` (' + names(n.repos) + ')'; }).join(', ')
      : 'none') + '\n\n'
    + 'For one repo\'s own `signals`, `cycles` or `orphans`, set [ ASK ] under WORKSPACE to that repo. Deterministic, from the index and the manifests; manifest parsing is line-based, so unusual formats can be missed.';
  return { steps: steps, verdict: LOCAL_VERDICT(), answer: ans };
}

var registry = { intents: [] }; /* filled by intents.js once INTENTS is assembled; read lazily so the groups never import intents.js */
function localHelp() {
  return 'Ask in plain language ("where is X defined", "what references X", "what imports X", '
  + '"files related to app.js", "project structure", "where are the tests", "entry points", "what changed recently") '
  + 'or use a command: ' + registry.intents.filter(function (it) { return it.helpCmd; }).map(function (it) { return it.helpCmd; }).join(', ')
  + '. Interpretation ("why…", "how should I…") needs a model: '
  + 'connect one in settings. It receives your question, the files you ticked (or the SMART selection) and the evidence Meridian found, and [ PREVIEW SEND ] shows the exact payload.';
}
export { CAP_LOCAL, CAP_MODEL, localEvidence, evAt, resolveToFile, symLookup, pickSymbol, pickPathish, LOCAL_VERDICT, partialNote, longLineNote, gatherTerrain, localDirData, localRecentData, isCodeFile, listBroken, assetNote, listDupes, listUntestedGaps, listOrphans, SEV_LABEL, computeSignals, findCycles, bfsPath, edgeLine, plural, workspaceRun, registry, localHelp };
