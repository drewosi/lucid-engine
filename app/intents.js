import { sortedPaths, st } from './state.js';
import { queryTerms } from './smart-context.js';
import { dirOf, fileExt, getIndex } from './indexer.js';
import { localSearchData } from './actions.js';
import { fmtTok } from './helpers.js';
/* ============ INTENT REGISTRY (DETERMINISTIC REASONING INSTANCES) ============
   The single source of truth for every deterministic reasoning instance the
   LOCAL engine knows. Each entry is one self-contained intent:
     kind       — stable id used across router, dispatch and grounding
     aliases    — command-grammar first words (`def x`, `refs y`, …)
     ground     — evidence-kind label the grounding bridge attributes excerpts by
     helpCmd    — the command's entry in the LOCAL help text ('' = no command)
     needsModel — true only for intents that honestly require model reasoning
     route(s, lo, idx) — natural-language matcher; returns {arg} or null.
                  ARRAY ORDER IS THE ROUTING CASCADE — earlier entries win.
     run(arg, q, idx)  — the investigation: real operations over the index,
                  returning { steps, verdict, actions?, answer }. No fabrication.
   Adding a reasoning instance = adding ONE entry here. DOM-free by design so
   the registry is reusable from the grounding bridge and the self-tests.     */

var CAP_LOCAL = ['Project structure', 'Search', 'Definitions', 'References', 'Imports & importers', 'File relationships', 'Recent changes', 'Dependency graph (cycles · hubs · orphans · broken imports · paths)', 'Code health (TODOs · env vars · duplicates · hotspots)', 'Exports & coverage gaps', 'Evidence collection'];
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

var STOP_INTENT = { where: 1, what: 1, which: 1, who: 1, does: 1, do: 1, is: 1, are: 1, the: 1, file: 1, files: 1, function: 1, functions: 1, method: 1, methods: 1, symbol: 1, symbols: 1, class: 1, classes: 1, defined: 1, definition: 1, declared: 1, reference: 1, references: 1, referenced: 1, import: 1, imports: 1, imported: 1, related: 1, project: 1, structure: 1, test: 1, tests: 1, entry: 1, point: 1, points: 1, recent: 1, recently: 1, show: 1, list: 1, find: 1, all: 1, call: 1, calls: 1, uses: 1, used: 1, depend: 1, depends: 1, this: 1, that: 1, for: 1, and: 1, with: 1 };
/* pick the most identifier-like token from a question (for def/refs/symbols) */
function pickSymbol(q, idx) {
  var bt = q.match(/`([^`]+)`/); if (bt) return bt[1].trim();
  var qq = q.match(/["“”']([^"“”']+)["“”']/); if (qq) return qq[1].trim();
  var toks = q.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) || [];
  if (idx) { for (var i = 0; i < toks.length; i++) { if (symLookup(toks[i], idx).length) return toks[i]; } }
  var fancy = toks.filter(function (t) { return (/[A-Z]/.test(t) || t.indexOf('_') !== -1 || t.indexOf('.') !== -1 || /\d/.test(t)) && !STOP_INTENT[t.toLowerCase()]; });
  if (fancy.length) return fancy.sort(function (a, b) { return b.length - a.length; })[0];
  var terms = queryTerms(q); return terms.length ? terms[0] : '';
}
/* pick a path-ish token from a question (for imports/importers/related/dir) */
function pickPathish(q) {
  var bt = q.match(/`([^`]+)`/); if (bt) return bt[1].trim();
  var qq = q.match(/["“”']([^"“”']+)["“”']/); if (qq) return qq[1].trim();
  var withExt = q.match(/[\w./-]*[\w-]\.[A-Za-z]{1,6}\b/); if (withExt) return withExt[0];
  var withSlash = q.match(/[\w.-]+\/[\w./-]+/); if (withSlash) return withSlash[0];
  return pickSymbol(q);
}

var LOCAL_VERDICT = function () { return { local: true, text: 'KNOWN LOCALLY' }; };

/* shared evidence-gathering used by plain + reason: term search → ranked files */
function gatherTerrain(q, steps) {
  var terms = queryTerms(q), perFile = {};
  steps.push({ action: 'extract search terms', note: terms.length ? terms.join(', ') : 'none', evidence: [], status: 'done' });
  terms.slice(0, 4).forEach(function (t) {
    var r = localSearchData(t, 'text');
    steps.push({ action: 'search “' + t + '”', note: r.hits.length ? r.hits.length + ' hit' + (r.hits.length === 1 ? '' : 's') : 'no matches', evidence: r.hits.slice(0, 4).map(localEvidence), status: 'done' });
    r.hits.forEach(function (h) { (perFile[h.p] || (perFile[h.p] = { count: 0, first: h })).count++; });
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
  var ans = '`' + (prefix || './') + '` — ' + items.length + ' file' + (items.length === 1 ? '' : 's') + ' ≈' + fmtTok(tok) + ' tokens. Largest:\n\n'
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
var CODE_LANGS = { js: 1, ts: 1, python: 1, go: 1, rust: 1, java: 1, ruby: 1, php: 1, c: 1, cpp: 1, 'c#': 1, swift: 1, kotlin: 1, scala: 1, elixir: 1, lua: 1, svelte: 1, vue: 1 };
function isCodeFile(p) { var f = st.files.get(p); return !!(f && CODE_LANGS[f.lang || '']); }
function classifiedSet(idx) {
  var s = {};
  idx.entries.concat(idx.tests, idx.configs, idx.docs).forEach(function (p) { s[p] = 1; });
  return s;
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
/* iterative 3-color DFS over resolved import edges; returns up to cap cycles,
   each with the node ring and the import line that closes it */
function findCycles(idx, cap) {
  var adj = new Map();
  idx.importsByFile.forEach(function (list, f) {
    var t = [], seen = {};
    list.forEach(function (x) { if (x.resolved && x.resolved !== f && !seen[x.resolved]) { seen[x.resolved] = 1; t.push({ to: x.resolved, line: x.line }); } });
    adj.set(f, t);
  });
  var color = new Map(), cycles = [];
  adj.forEach(function (_, start) {
    if (color.get(start) || cycles.length >= cap) return;
    var stack = [{ node: start, i: 0 }], path = [start], onPath = {};
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

/* ---- The registry. Array order IS the natural-language routing cascade. ---- */
var INTENTS = [

  { kind: 'help', aliases: ['help'], ground: 'evidence', helpCmd: '', needsModel: false,
    route: null,
    run: function () {
      return { steps: [{ action: 'list capabilities', note: 'local engine reference', evidence: [], status: 'done' }],
        verdict: LOCAL_VERDICT(),
        answer: '**Meridian LOCAL engine** — deterministic project intelligence, no AI, no network.\n\n**Known locally:** ' + CAP_LOCAL.join(' · ') + '.\n**Requires a model:** ' + CAP_MODEL.join(' · ') + '.\n\n' + LOCAL_HELP };
    } },

  { kind: 'entries', aliases: ['entries', 'entrypoints'], ground: 'entry-point', helpCmd: '`entries`', needsModel: false,
    route: function (s, lo) { return /\b(entry ?points?|entrypoints?|main file|entry file)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      steps.push({ action: 'read entry-point classification', note: idx.entries.length + ' entry point' + (idx.entries.length === 1 ? '' : 's'), evidence: idx.entries.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: idx.entries.length ? 'Likely entry points (index/main/app/server/cli/core/lib):\n\n' + idx.entries.slice(0, 20).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No conventional entry-point filenames detected.' };
    } },

  { kind: 'recent', aliases: ['recent'], ground: 'recent-change', helpCmd: '`recent <n>`', needsModel: false,
    route: function (s, lo) {
      if (!/\b(recent(ly)?|latest|newest|last changed|what changed|changed recently)\b/.test(lo)) return null;
      var num = lo.match(/\b(\d{1,2})\b/); return { arg: num ? num[1] : '10' };
    },
    run: function (arg) {
      var rr = localRecentData(arg || '10'); rr.steps.forEach(function (step) { step.status = 'done'; });
      return { steps: rr.steps, verdict: LOCAL_VERDICT(), answer: rr.answer };
    } },

  { kind: 'dir', aliases: ['dir'], ground: 'directory', helpCmd: '`dir <path>`', needsModel: false,
    route: null,
    run: function (arg) {
      var dd = localDirData(arg || '.'); dd.steps.forEach(function (step) { step.status = 'done'; });
      return { steps: dd.steps, verdict: LOCAL_VERDICT(), answer: dd.answer };
    } },

  { kind: 'search', aliases: ['search'], ground: 'match', helpCmd: '`search <text|regex>`', needsModel: false,
    route: null,
    run: function (arg) {
      if (!arg) return { steps: [{ action: 'parse command', note: 'search needs a pattern', evidence: [], status: 'done' }], verdict: LOCAL_VERDICT(), answer: '`search` needs a pattern, e.g. `search cache_control`.' };
      var steps = [];
      var sr = localSearchData(arg, 'text');
      steps.push({ action: 'search “' + arg + '”', note: sr.hits.length + ' hit' + (sr.hits.length === 1 ? '' : 's') + ' in ' + sr.filesHit + ' file' + (sr.filesHit === 1 ? '' : 's'), evidence: sr.hits.slice(0, 12).map(localEvidence), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(), answer: sr.hits.length ? 'Found ' + (sr.hits.length >= sr.cap ? sr.cap + '+' : sr.hits.length) + ' match' + (sr.hits.length === 1 ? '' : 'es') + ' for `' + arg + '`. Chips open each at its line.' : 'No matches for `' + arg + '`.' };
    } },

  { kind: 'structure', aliases: ['structure', 'overview'], ground: 'structure', helpCmd: '`structure`', needsModel: false,
    route: function (s, lo) { return /\b(project structure|structure of|overview|directories|packages|project map|top-?level|layout|organi[sz]ation|how is .* organi[sz]ed|what.*directories)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var paths = sortedPaths(), dirCounts = {};
      paths.forEach(function (p) { var d = dirOf(p) || '.'; dirCounts[d] = (dirCounts[d] || 0) + 1; });
      var topDirs = Object.keys(dirCounts).sort(function (a, b) { return dirCounts[b] - dirCounts[a]; }).slice(0, 8);
      var langs = Object.keys(idx.byExt).sort(function (a, b) { return idx.byExt[b] - idx.byExt[a]; }).slice(0, 6);
      steps.push({ action: 'read the project index', note: idx.fileCount + ' files · ' + idx.packages.length + ' packages · ' + idx.symbolCount + ' symbols', evidence: idx.entries.slice(0, 4).map(function (p) { return evAt(p, 1); }), status: 'done' });
      steps.push({ action: 'map directories & languages', note: topDirs.length + ' directories', evidence: idx.packages.slice(0, 4).map(function (pk) { return evAt(pk.manifest, 1); }), status: 'done' });
      var sans = '**Project structure** — ' + idx.fileCount + ' files, ' + idx.symbolCount + ' symbols.\n\n'
        + '**Packages:** ' + (idx.packages.length ? idx.packages.map(function (pk) { return '`' + (pk.name || pk.dir) + '`'; }).join(', ') : 'none detected (no build manifests)') + '\n'
        + '**Entry points:** ' + (idx.entries.length ? idx.entries.map(function (p) { return '`' + p + '`'; }).join(', ') : 'none detected') + '\n'
        + '**Tests:** ' + (idx.tests.length ? idx.tests.length + ' file' + (idx.tests.length === 1 ? '' : 's') : 'none detected') + '\n'
        + '**Top directories:** ' + topDirs.map(function (d) { return '`' + d + '` (' + dirCounts[d] + ')'; }).join(', ') + '\n'
        + '**Languages:** ' + langs.map(function (e) { return e + ' (' + idx.byExt[e] + ')'; }).join(', ');
      return { steps: steps, verdict: LOCAL_VERDICT(), answer: sans };
    } },

  /* before `tests`: "files without tests" must not be answered with the test list */
  { kind: 'untested', aliases: ['untested'], ground: 'coverage-gap', helpCmd: '`untested`', needsModel: false,
    route: function (s, lo) { return /\b(untested|without tests?|missing tests?|coverage gaps?|lack(s|ing)? tests?|no tests? for)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      if (!idx.tests.length) {
        steps.push({ action: 'read test classification from the index', note: '0 test files', evidence: [], status: 'done' });
        return { steps: steps, verdict: LOCAL_VERDICT(),
          answer: 'No test files detected by the standard patterns (`.test.` `.spec.` `_test` `tests/` `__tests__`) — every code file is a coverage gap. That is a real finding about this project, not a limitation.' };
      }
      var stems = {}, testedByImport = {}, skip = {};
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
      steps.push({ action: 'match test files to sources (name stems + what tests import)', note: plural(idx.tests.length, 'test file') + ' · ' + plural(gaps.length, 'uncovered code file'), evidence: gaps.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: gaps.length
          ? plural(gaps.length, 'code file') + ' with no matching test (no shared name stem, not imported by any test file):\n\n' + gaps.slice(0, 40).map(function (p) { return '- `' + p + '`'; }).join('\n') + '\n\nMatched by test-file name stems and test imports — integration tests that exercise code indirectly are not traced.'
          : 'Every loaded code file is matched by a test name stem or imported by a test file.' };
    } },

  { kind: 'tests', aliases: ['tests'], ground: 'test', helpCmd: '`tests`', needsModel: false,
    route: function (s, lo) { return /\btests?\b/.test(lo) && /\b(where|find|list|show|which|are|any)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      steps.push({ action: 'read test classification from the index', note: idx.tests.length + ' test file' + (idx.tests.length === 1 ? '' : 's'), evidence: idx.tests.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: idx.tests.length ? 'Detected ' + idx.tests.length + ' test file' + (idx.tests.length === 1 ? '' : 's') + ' (patterns: `.test.` `.spec.` `_test` `tests/` `__tests__`):\n\n' + idx.tests.slice(0, 20).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No test files detected by the standard patterns (`.test.` `.spec.` `_test` `tests/` `__tests__`). That is a real finding about this project, not a limitation.' };
    } },

  /* before `importers`: "circular dependencies" would otherwise match its depend- regex */
  { kind: 'cycles', aliases: ['cycles'], ground: 'import-cycle', helpCmd: '`cycles`', needsModel: false,
    route: function (s, lo) { return /\b(circular|cycles?|cyclic)\b/.test(lo) && /\b(import|imports|depend|depends|dependency|dependencies)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var cycles = findCycles(idx, 10);
      steps.push({ action: 'trace cycles over resolved import edges', note: cycles.length ? plural(cycles.length, 'cycle') + (cycles.length >= 10 ? ' (capped at 10)' : '') : 'no cycles', evidence: cycles.slice(0, 10).map(function (c) { return evAt(c.from, c.line); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: cycles.length
          ? 'Found ' + plural(cycles.length, 'import cycle') + (cycles.length >= 10 ? ' (search capped at 10)' : '') + ':\n\n' + cycles.slice(0, 10).map(function (c) { return '- ' + c.nodes.map(function (n) { return '`' + n + '`'; }).join(' → '); }).join('\n') + '\n\nChips open the import statement that closes each cycle. Static resolved edges only — dynamic loading is not traced.'
          : 'No circular imports among the ' + plural(idx.importCount, 'indexed import') + ' — the resolved dependency graph is acyclic.' };
    } },

  /* before `listType`: "unused files" would otherwise be read as a list-by-type query */
  { kind: 'orphans', aliases: ['orphans', 'dead'], ground: 'orphan', helpCmd: '`orphans`', needsModel: false,
    route: function (s, lo) { return /\b(orphan(ed)?s?|dead (files?|code)|unused files?|never imported|unreferenced files?)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var orphans = listOrphans(idx);
      steps.push({ action: 'scan importer edges for unreferenced code files', note: plural(orphans.length, 'candidate'), evidence: orphans.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: orphans.length
          ? plural(orphans.length, 'code file') + ' ' + (orphans.length === 1 ? 'is' : 'are') + ' never imported by any loaded file (and not classified as entry point, test, config, or doc):\n\n' + orphans.slice(0, 20).map(function (p) { return '- `' + p + '`'; }).join('\n') + '\n\nStatic import edges only — files loaded dynamically, from HTML, or by a bundler config can appear here without being dead.'
          : 'Every loaded code file is either imported somewhere or classified as an entry point, test, config, or doc.' };
    } },

  { kind: 'broken', aliases: ['broken', 'unresolved'], ground: 'broken-import', helpCmd: '`broken`', needsModel: false,
    route: function (s, lo) { return /\b(broken|unresolved|missing|dangling)\b[\s\S]*\bimports?\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var broken = [];
      idx.importsByFile.forEach(function (list, f) {
        list.forEach(function (x) { if (!x.resolved && (x.raw.charAt(0) === '.' || x.raw.charAt(0) === '/')) broken.push({ file: f, raw: x.raw, line: x.line }); });
      });
      steps.push({ action: 'scan relative imports that resolve to no loaded file', note: plural(broken.length, 'unresolved relative import'), evidence: broken.slice(0, 12).map(function (b) { return evAt(b.file, b.line); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: broken.length
          ? plural(broken.length, 'relative import') + ' resolve' + (broken.length === 1 ? 's' : '') + ' to no loaded file:\n\n' + broken.slice(0, 20).map(function (b) { return '- `' + b.file + '` line ' + b.line + ' → `' + b.raw + '`'; }).join('\n') + '\n\nEither the target is genuinely missing, or it was not loaded (check ignore filters). Bare specifiers (npm/stdlib packages) are treated as external, not broken.'
          : 'Every relative import resolves to a loaded file. Bare module specifiers (packages, stdlib) are treated as external by design.' };
    } },

  /* before `importers`: "most imported files" would otherwise match its import- regex */
  { kind: 'hubs', aliases: ['hubs'], ground: 'hub', helpCmd: '`hubs`', needsModel: false,
    route: function (s, lo) { return /\b(most (imported|depended[- ]on|used)|central files?|hubs?|fan-?in)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var ranked = [];
      idx.importedBy.forEach(function (arr, p) { if (arr.length) ranked.push({ p: p, n: arr.length }); });
      ranked.sort(function (a, b) { return b.n - a.n || (a.p < b.p ? -1 : 1); });
      var top = ranked.slice(0, 10);
      steps.push({ action: 'rank files by importer fan-in', note: plural(ranked.length, 'imported file') + ' · top ' + top.length, evidence: top.map(function (r) { return evAt(r.p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: top.length
          ? 'Most-imported files (fan-in — the load-bearing walls of this project):\n\n' + top.map(function (r, i) { return (i + 1) + '. `' + r.p + '` — imported by ' + plural(r.n, 'file'); }).join('\n')
          : 'No file is imported by another loaded file — either a single-file project or a bundling style with no static imports.' };
    } },

  /* before `importers`: "import path/chain" would otherwise match its import- regex */
  { kind: 'path', aliases: ['path', 'chain'], ground: 'dependency-path', helpCmd: '`path <a> <b>`', needsModel: false,
    route: function (s, lo) { return /\b(dependency|import) (path|chain)\b|\b(path|chain) (from|between)\b/.test(lo) ? { arg: s } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var toks = String(arg || q).match(/[\w./-]*[\w-]\.[A-Za-z]{1,6}\b|[\w.-]+\/[\w./-]+/g) || [];
      var a = toks.length > 1 ? resolveToFile(toks[0]) : null, b = toks.length > 1 ? resolveToFile(toks[1]) : null;
      steps.push({ action: 'resolve the two endpoints', note: (a || '?') + ' → ' + (b || '?'), evidence: [], status: 'done' });
      if (!a || !b || a === b) {
        return { steps: steps, verdict: LOCAL_VERDICT(), answer: '`path` needs two loaded files, e.g. `path src/index.js src/store.js`.' };
      }
      var chain = bfsPath(idx, a, b), reversed = false;
      if (!chain) { chain = bfsPath(idx, b, a); reversed = !!chain; }
      var evs = [];
      if (chain) for (var i = 0; i < chain.length - 1; i++) evs.push(evAt(chain[i], edgeLine(idx, chain[i], chain[i + 1])));
      steps.push({ action: 'breadth-first search over resolved import edges', note: chain ? plural(chain.length - 1, 'hop') + (reversed ? ' (reverse direction)' : '') : 'no path in either direction', evidence: evs, status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: chain
          ? 'Shortest import chain' + (reversed ? ' (found in the reverse direction, `' + b + '` → `' + a + '`)' : '') + ':\n\n' + chain.map(function (n) { return '`' + n + '`'; }).join(' → ') + '\n\nChips open each hop\'s import statement.'
          : 'No static import path connects `' + a + '` and `' + b + '` in either direction. They may be linked at runtime (DI, dynamic import, config) — the index only traces static edges.' };
    } },

  { kind: 'exports', aliases: ['exports'], ground: 'export', helpCmd: '`exports <file>`', needsModel: false,
    route: function (s, lo) { return /\bwhat does\b[\s\S]*\bexports?\b|\bexports? (of|from)\b|\bpublic (api|surface) of\b/.test(lo) ? { arg: pickPathish(s) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      if (!arg) return { steps: [{ action: 'parse command', note: 'exports needs a file', evidence: [], status: 'done' }], verdict: LOCAL_VERDICT(), answer: '`exports` needs a file, e.g. `exports src/store.js`.' };
      var tf = resolveToFile(arg);
      steps.push({ action: 'resolve “' + arg + '” to a file', note: tf || 'unresolved', evidence: [], status: 'done' });
      if (!tf) return { steps: steps, verdict: LOCAL_VERDICT(), answer: 'Could not resolve `' + arg + '` to a loaded file.' };
      var list = idx.exportsByFile.get(tf) || [];
      var tfLang = (st.files.get(tf) || {}).lang;
      if (!list.length && (tfLang === 'python' || tfLang === 'ruby')) {
        /* Python/Ruby have no export keyword — module-level definitions are the surface */
        var pub = [];
        idx.symbols.forEach(function (defsArr, name) {
          if (name.charAt(0) === '_') return;
          defsArr.forEach(function (d) { if (d.file === tf && pub.length < 15) pub.push({ name: name, line: d.line, kind: d.kind }); });
        });
        pub.sort(function (x, y) { return x.line - y.line; });
        steps.push({ action: 'read module-level definitions (no export keyword)', note: plural(pub.length, 'definition'), evidence: pub.slice(0, 12).map(function (x) { return evAt(tf, x.line); }), status: 'done' });
        return { steps: steps, verdict: LOCAL_VERDICT(),
          answer: pub.length
            ? '`' + tf + '` (' + (tfLang === 'python' ? 'Python' : 'Ruby') + ' — no export keyword) has ' + plural(pub.length, 'module-level definition') + ' as its public surface (underscore-prefixed names excluded):\n\n' + pub.map(function (x) { return '- `' + x.name + '` (' + x.kind + ') — line ' + x.line; }).join('\n')
            : 'No module-level definitions found in `' + tf + '`.' };
      }
      steps.push({ action: 'read exported symbols from the index', note: plural(list.length, 'export'), evidence: list.slice(0, 12).map(function (x) { return evAt(tf, x.line); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: list.length
          ? '`' + tf + '` exports ' + plural(list.length, 'symbol') + ':\n\n' + list.slice(0, 20).map(function (x) { return '- `' + x.name + '` (' + x.kind + ') — line ' + x.line; }).join('\n')
          : 'No exports recorded for `' + tf + '`. Tracking covers JS/TS (`export`, `module.exports`), Rust (`pub`), and Go (uppercase initials) — or the file genuinely exports nothing.' };
    } },

  /* before `listType`/`structure` regexes see them: size/complexity questions */
  { kind: 'hotspots', aliases: ['hotspots', 'largest'], ground: 'hotspot', helpCmd: '`hotspots`', needsModel: false,
    route: function (s, lo) { return /\b(largest|biggest|hotspots?|most complex|densest)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var rows = [];
      sortedPaths().forEach(function (p) {
        if (!isCodeFile(p)) return;
        var f = st.files.get(p);
        var symN = idx.symCountByFile[p] || 0, fanIn = (idx.importedBy.get(p) || []).length;
        rows.push({ p: p, tok: f.tokens, symN: symN, fanIn: fanIn, score: f.tokens + symN * 40 + fanIn * 200 });
      });
      rows.sort(function (a, b) { return b.score - a.score; });
      var top = rows.slice(0, 8);
      steps.push({ action: 'rank code files by size · symbol density · fan-in', note: plural(rows.length, 'code file') + ' scored', evidence: top.map(function (r) { return evAt(r.p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: top.length
          ? 'Hotspots — the files where change is most expensive (size + symbol density + fan-in):\n\n' + top.map(function (r, i) { return (i + 1) + '. `' + r.p + '` — ≈' + fmtTok(r.tok) + ' tokens · ' + plural(r.symN, 'symbol') + ' · ' + plural(r.fanIn, 'importer'); }).join('\n')
          : 'No code files loaded to rank.' };
    } },

  { kind: 'todos', aliases: ['todos'], ground: 'todo', helpCmd: '`todos`', needsModel: false,
    route: function (s, lo) { return /\b(todos?|fixmes?|hacks?|tech(nical)? debt)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var byTag = {};
      idx.todos.forEach(function (t) { byTag[t.tag] = (byTag[t.tag] || 0) + 1; });
      var tagNote = Object.keys(byTag).map(function (t) { return t + ' ' + byTag[t]; }).join(' · ');
      steps.push({ action: 'read TODO/FIXME/HACK/XXX tags from the index', note: idx.todos.length ? plural(idx.todos.length, 'tag') + (idx.todos.length >= 500 ? ' (capped)' : '') + ' · ' + tagNote : 'none found', evidence: idx.todos.slice(0, 12).map(function (t) { return evAt(t.file, t.line); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: idx.todos.length
          ? plural(idx.todos.length, 'debt tag') + ' (' + tagNote + '):\n\n' + idx.todos.slice(0, 15).map(function (t) { return '- `' + t.file + '` line ' + t.line + ' — **' + t.tag + '**'; }).join('\n') + '\n\nChips open each tag at its line.'
          : 'No TODO / FIXME / HACK / XXX tags in the loaded files. Either the debt is paid, or it is not written down.' };
    } },

  /* before `refs`/`def`: "where are env vars used" would otherwise match their regexes */
  { kind: 'env', aliases: ['env'], ground: 'env-var', helpCmd: '`env`', needsModel: false,
    route: function (s, lo) { return /\benv(ironment)? ?var(iable)?s?\b|\bprocess\.env\b|\bos\.environ\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var names = [];
      idx.envVars.forEach(function (refs, name) { names.push({ name: name, refs: refs }); });
      names.sort(function (a, b) { return b.refs.length - a.refs.length || (a.name < b.name ? -1 : 1); });
      steps.push({ action: 'read environment-variable reads from the index', note: plural(names.length, 'variable'), evidence: names.slice(0, 12).map(function (n) { return evAt(n.refs[0].file, n.refs[0].line); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: names.length
          ? plural(names.length, 'environment variable') + ' read by the code — the project\'s implicit configuration surface:\n\n' + names.slice(0, 20).map(function (n) { return '- `' + n.name + '` — ' + plural(n.refs.length, 'read') + ', first at `' + n.refs[0].file + '` line ' + n.refs[0].line; }).join('\n')
          : 'No environment-variable reads detected (patterns: `process.env`, `import.meta.env`, `os.environ`/`getenv`, `os.Getenv`, `env::var`, `ENV[…]`).' };
    } },

  /* before `symbols`: "duplicate symbols" would otherwise match its symbol- regex */
  { kind: 'dupes', aliases: ['dupes', 'duplicates'], ground: 'duplicate-symbol', helpCmd: '`dupes`', needsModel: false,
    route: function (s, lo) { return /\b(duplicate|colliding|shadow(ed|ing)?)\b[\s\S]*\b(symbols?|names?|definitions?|functions?|classes)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var dupes = [];
      idx.symbols.forEach(function (defsArr, name) {
        if (name.length < 4) return;
        var perFile = {};
        defsArr.forEach(function (d) { if (!perFile[d.file]) perFile[d.file] = d; });
        var files = Object.keys(perFile);
        if (files.length > 1) dupes.push({ name: name, defs: files.map(function (f) { return perFile[f]; }) });
      });
      dupes.sort(function (a, b) { return b.defs.length - a.defs.length || (a.name < b.name ? -1 : 1); });
      var top = dupes.slice(0, 15), evs = [];
      top.forEach(function (d) { d.defs.slice(0, 2).forEach(function (x) { if (evs.length < 12) evs.push(evAt(x.file, x.line)); }); });
      steps.push({ action: 'scan the symbol index for names defined in multiple files', note: plural(dupes.length, 'duplicated name'), evidence: evs, status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: dupes.length
          ? plural(dupes.length, 'symbol name') + ' (≥4 chars) defined in more than one file — collision and confusion candidates:\n\n' + top.map(function (d) { return '- `' + d.name + '` — ' + d.defs.map(function (x) { return '`' + x.file + '` line ' + x.line; }).join(', '); }).join('\n')
          : 'No symbol name (≥4 chars) is defined in more than one file.' };
    } },

  { kind: 'listType', aliases: [], ground: 'file', helpCmd: '', needsModel: false,
    route: function (s, lo) { return /\b(list|show|all)\b/.test(lo) && /\b(files?)\b/.test(lo) && /\b([a-z]{1,6})\b\s+files?\b/.test(lo) ? { arg: s } : null; },
    run: function (arg, q) {
      var steps = [];
      var em = q.toLowerCase().match(/\b(typescript|javascript|python|golang|go|rust|java|ruby|markdown|html|css|json|yaml|c\+\+|c#|[a-z]{1,6})\s+files?\b/);
      var alias = { typescript: 'ts', javascript: 'js', python: 'py', golang: 'go', rust: 'rs', java: 'java', ruby: 'rb', markdown: 'md', 'c++': 'cpp', 'c#': 'cs' };
      var want = em ? (alias[em[1]] || em[1]) : '';
      var matched = sortedPaths().filter(function (p) { return fileExt(p) === want; });
      steps.push({ action: 'filter files by extension “' + want + '”', note: matched.length + ' file' + (matched.length === 1 ? '' : 's'), evidence: matched.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(), answer: matched.length ? matched.length + ' `.' + want + '` file' + (matched.length === 1 ? '' : 's') + ':\n\n' + matched.slice(0, 25).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No `.' + want + '` files loaded.' };
    } },

  { kind: 'related', aliases: ['related'], ground: 'related', helpCmd: '`related`', needsModel: false,
    route: function (s, lo) { return /\brelated\b|\bconnected to\b|\bassociated with\b|\bneighbou?rs of\b/.test(lo) ? { arg: pickPathish(s) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var rf = resolveToFile(arg);
      steps.push({ action: 'resolve “' + arg + '” to a file', note: rf || 'unresolved', evidence: [], status: 'done' });
      var rel = {};
      if (rf) {
        (idx.importsByFile.get(rf) || []).forEach(function (x) { if (x.resolved) rel[x.resolved] = 'imports'; });
        (idx.importedBy.get(rf) || []).forEach(function (x) { rel[x.file] = 'imported by'; });
        var d = dirOf(rf), bn = rf.slice(rf.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase();
        st.files.forEach(function (f, p) {
          if (p === rf) return;
          if (dirOf(p) === d && !rel[p]) rel[p] = 'same directory';
          else if (!rel[p] && bn.length > 2 && p.toLowerCase().indexOf(bn) !== -1) rel[p] = 'name match';
        });
      }
      var relList = Object.keys(rel).slice(0, 20);
      steps.push({ action: 'gather relationships (imports · importers · directory · name)', note: relList.length + ' related file' + (relList.length === 1 ? '' : 's'), evidence: relList.map(function (p) { return evAt(p, 1); }), status: 'done' });
      var rans = !rf ? 'Could not resolve `' + arg + '` to a loaded file.'
        : relList.length ? 'Files related to `' + rf + '`:\n\n' + relList.map(function (p) { return '- `' + p + '` — ' + rel[p]; }).join('\n')
        : 'No related files found for `' + rf + '` (no import edges, no directory siblings, no name matches).';
      return { steps: steps, verdict: LOCAL_VERDICT(), answer: rans };
    } },

  { kind: 'imports', aliases: ['imports'], ground: 'import', helpCmd: '`imports`', needsModel: false,
    route: function (s, lo) { return /\bwhat does\b[\s\S]*\bimport\b|\bimports of\b|\bdependencies of\b|\bwhat.*\bdepend(s)? on\b/.test(lo) ? { arg: pickPathish(s) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var tf2 = resolveToFile(arg);
      var list = tf2 ? (idx.importsByFile.get(tf2) || []) : [];
      var resolved = list.filter(function (x) { return x.resolved; }), external = list.filter(function (x) { return !x.resolved; });
      steps.push({ action: 'resolve “' + arg + '” to a file', note: tf2 || 'unresolved', evidence: [], status: 'done' });
      steps.push({ action: 'read import statements', note: list.length + ' import' + (list.length === 1 ? '' : 's') + ' · ' + resolved.length + ' internal, ' + external.length + ' external', evidence: list.slice(0, 12).map(function (x) { return evAt(tf2, x.line); }), status: 'done' });
      var mans = !tf2 ? 'Could not resolve `' + arg + '` to a loaded file.'
        : list.length ? '`' + tf2 + '` has ' + list.length + ' import' + (list.length === 1 ? '' : 's') + '.\n\n**Internal:** ' + (resolved.map(function (x) { return '`' + x.resolved + '`'; }).join(', ') || 'none') + '\n**External:** ' + (external.map(function (x) { return '`' + x.raw + '`'; }).join(', ') || 'none')
        : 'No import statements found in `' + tf2 + '`.';
      return { steps: steps, verdict: LOCAL_VERDICT(), answer: mans };
    } },

  { kind: 'importers', aliases: ['importers', 'importedby'], ground: 'importer', helpCmd: '`importers`', needsModel: false,
    route: function (s, lo) { return /\b(imports?|importe(rs|d)?|depend(s|ents?|encies)?|who (imports|uses|depends)|used by|includes)\b/.test(lo) ? { arg: pickPathish(s) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var tf = resolveToFile(arg);
      var imps = tf ? (idx.importedBy.get(tf) || []) : [];
      steps.push({ action: 'resolve “' + arg + '” to a file', note: tf || 'unresolved', evidence: [], status: 'done' });
      steps.push({ action: 'read importer edges from the index', note: imps.length + ' importer' + (imps.length === 1 ? '' : 's'), evidence: imps.slice(0, 12).map(function (x) { return evAt(x.file, x.line); }), status: 'done' });
      var ians = !tf ? 'Could not resolve `' + arg + '` to a loaded file.'
        : imps.length ? '`' + tf + '` is imported by ' + imps.length + ' file' + (imps.length === 1 ? '' : 's') + ':\n\n' + imps.slice(0, 12).map(function (x) { return '- `' + x.file + '` line ' + x.line; }).join('\n')
        : 'No loaded file imports `' + tf + '`. Either nothing depends on it, or the project uses a bundling/single-file style with no import statements between files (a real architectural fact, not a gap).';
      return { steps: steps, verdict: LOCAL_VERDICT(), answer: ians };
    } },

  { kind: 'symbols', aliases: ['symbols'], ground: 'symbol', helpCmd: '`symbols`', needsModel: false,
    route: function (s, lo, idx) { return /\b(symbols?|functions?|classes|methods)\b/.test(lo) && !/\b(where|defined|definition|reference|references)\b/.test(lo) ? { arg: pickSymbol(s, idx) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      if (arg) {
        var matches = [];
        idx.symbols.forEach(function (defsArr, name) { if (name.toLowerCase().indexOf(arg.toLowerCase()) !== -1) matches.push({ name: name, def: defsArr[0], n: defsArr.length }); });
        matches.sort(function (a, b) { return a.name.length - b.name.length; });
        var top = matches.slice(0, 15);
        steps.push({ action: 'search the symbol index for “' + arg + '”', note: matches.length + ' matching symbol' + (matches.length === 1 ? '' : 's'), evidence: top.map(function (mm) { return evAt(mm.def.file, mm.def.line); }), status: 'done' });
        return { steps: steps, verdict: LOCAL_VERDICT(),
          answer: top.length ? matches.length + ' symbol' + (matches.length === 1 ? '' : 's') + ' match `' + arg + '`:\n\n' + top.map(function (mm) { return '- `' + mm.name + '` (' + mm.def.kind + ') — `' + mm.def.file + '` line ' + mm.def.line + (mm.n > 1 ? ' (+' + (mm.n - 1) + ' more)' : ''); }).join('\n') : 'No indexed symbol matches `' + arg + '`.' };
      }
      var byFile = {};
      idx.symbols.forEach(function (defsArr) { defsArr.forEach(function (d) { byFile[d.file] = (byFile[d.file] || 0) + 1; }); });
      var topFiles = Object.keys(byFile).sort(function (a, b) { return byFile[b] - byFile[a]; }).slice(0, 8);
      steps.push({ action: 'summarize the symbol index', note: idx.symbolCount + ' definitions · ' + idx.symbols.size + ' unique names', evidence: topFiles.map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: 'The index holds **' + idx.symbolCount + ' symbol definitions** (' + idx.symbols.size + ' unique names). Densest files:\n\n' + topFiles.map(function (p) { return '- `' + p + '` — ' + byFile[p] + ' symbols'; }).join('\n') + '\n\nAsk `symbols <name>` to find a specific one.' };
    } },

  { kind: 'refs', aliases: ['refs'], ground: 'reference', helpCmd: '`refs`', needsModel: false,
    route: function (s, lo, idx) { return /\b(reference|references|referenced|callers?|call sites?|usages?|used by|who calls|what calls|uses of)\b/.test(lo) ? { arg: pickSymbol(s, idx) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var r = localSearchData(arg, 'refs');
      steps.push({ action: 'find references to “' + arg + '”', note: r.hits.length + ' hit' + (r.hits.length === 1 ? '' : 's') + ' in ' + r.filesHit + ' file' + (r.filesHit === 1 ? '' : 's'), evidence: r.hits.slice(0, 10).map(localEvidence), status: 'done' });
      var d2 = symLookup(arg, idx);
      if (d2.length) steps.push({ action: 'locate its definition', note: d2.length + ' definition' + (d2.length === 1 ? '' : 's'), evidence: d2.slice(0, 4).map(function (d) { return evAt(d.file, d.line); }), status: 'done' });
      var actions = [{ kind: 'def', command: arg, why: 'jump to where ' + arg + ' is defined' }];
      return { steps: steps, verdict: LOCAL_VERDICT(), actions: actions,
        answer: r.hits.length ? '`' + arg + '` is referenced ' + (r.hits.length >= r.cap ? r.cap + '+' : r.hits.length) + ' time' + (r.hits.length === 1 ? '' : 's') + ' across ' + r.filesHit + ' file' + (r.filesHit === 1 ? '' : 's') + '. Chips open each at its line.' : 'No references to `' + arg + '` in the loaded files.' };
    } },

  { kind: 'def', aliases: ['def'], ground: 'definition', helpCmd: '`def`', needsModel: false,
    route: function (s, lo, idx) { return /\b(where|location|find|definition|defined|declared|declaration)\b/.test(lo) ? { arg: pickSymbol(s, idx) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var defs = symLookup(arg, idx);
      steps.push({ action: 'look up “' + arg + '” in the symbol index', note: defs.length + ' definition' + (defs.length === 1 ? '' : 's'), evidence: defs.slice(0, 8).map(function (d) { return evAt(d.file, d.line); }), status: 'done' });
      var refs = localSearchData(arg, 'refs');
      steps.push({ action: 'scan for references', note: refs.hits.length + ' reference' + (refs.hits.length === 1 ? '' : 's'), evidence: refs.hits.slice(0, 6).map(localEvidence), status: 'done' });
      var actions = [{ kind: 'refs', command: arg, why: 'list every reference to ' + arg }];
      var ans = defs.length
        ? '`' + arg + '` is defined in ' + defs.length + ' place' + (defs.length === 1 ? '' : 's') + ':\n\n' + defs.slice(0, 8).map(function (d) { return '- `' + d.file + '` line ' + d.line + ' (' + d.kind + ')'; }).join('\n') + '\n\nEvidence chips open each definition at its exact line.'
        : 'No indexed definition named `' + arg + '`. It may be an external symbol, a dynamic name, or spelled differently. The reference scan above shows where the term appears.';
      return { steps: steps, verdict: LOCAL_VERDICT(), actions: actions, answer: ans };
    } },

  { kind: 'reason', aliases: [], ground: 'evidence', helpCmd: '', needsModel: true,
    route: function (s, lo, idx) { return /\b(why|how (do|does|is|should|can|would)|root cause|recommend|refactor|improve|architect(ure)?|risk|risks|should i|would you|best way|design|rationale|trade-?offs?|explain)\b/.test(lo) ? { arg: pickSymbol(s, idx) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var t = gatherTerrain(q, steps);
      var sym = arg && symLookup(arg, idx).length ? arg : (t.terms[0] || '');
      if (sym) {
        var sd = symLookup(sym, idx);
        if (sd.length) steps.push({ action: 'locate “' + sym + '”', note: sd.length + ' definition' + (sd.length === 1 ? '' : 's'), evidence: sd.slice(0, 4).map(function (d) { return evAt(d.file, d.line); }), status: 'done' });
      }
      var actions = [];
      if (sym) actions.push({ kind: 'def', command: sym, why: 'inspect where ' + sym + ' is defined' }, { kind: 'refs', command: sym, why: 'see everywhere ' + sym + ' is used' });
      actions.push({ kind: 'recent', command: '10', why: 'check what changed recently' });
      var top5 = t.ranked.slice(0, 5).map(function (r) { return '- `' + r.p + '`'; }).join('\n');
      return {
        steps: steps, actions: actions,
        verdict: { local: false, text: 'REQUIRES MODEL REASONING' },
        answer: 'This question asks for **interpretation** (root cause / recommendation / explanation) — that is where a model reasons, and Meridian will not fabricate it. What Meridian **can** tell you is the terrain: it gathered ' + (t.ranked.length) + ' relevant file' + (t.ranked.length === 1 ? '' : 's') + ' and ' + steps.reduce(function (a, s) { return a + (s.evidence ? s.evidence.length : 0); }, 0) + ' pieces of evidence.\n\n'
          + (top5 ? 'Most relevant files:\n\n' + top5 + '\n\n' : '')
          + 'Connect a model in settings to synthesize an answer — Meridian will send only this evidence, not the whole repo.'
      };
    } },

  /* plain: deterministic ranked search; synthesis optional. Terminal fallback. */
  { kind: 'plain', aliases: [], ground: 'evidence', helpCmd: '', needsModel: false,
    route: function (s, lo, idx) { return { arg: pickSymbol(s, idx) }; },
    run: function (arg, q) {
      var steps = [];
      var tp = gatherTerrain(q, steps);
      if (!tp.terms.length) return { steps: steps, verdict: LOCAL_VERDICT(), answer: 'That question has no distinctive terms to search for. Name a symbol, filename, or keyword — or use a command.\n\n' + LOCAL_HELP };
      var topSym = tp.terms[0];
      var actions = [{ kind: 'def', command: topSym, why: 'where “' + topSym + '” is defined' }, { kind: 'refs', command: topSym, why: 'every reference to “' + topSym + '”' }, { kind: 'recent', command: '10', why: 'recently modified files' }];
      return { steps: steps, verdict: LOCAL_VERDICT(), actions: actions,
        answer: tp.ranked.length ? 'Deterministic search — the files below best match your words (match count, then importance). Open a chip to inspect, or ask `def`/`refs`. Interpreting *why* would benefit from a model.\n\n' + tp.ranked.slice(0, 5).map(function (r, i) { return (i + 1) + '. `' + r.p + '` — ' + r.count + ' match' + (r.count === 1 ? '' : 'es'); }).join('\n') : 'None of your terms appear in the loaded files. Try different wording or check what is selected in CONTEXT.' };
    } }
];

/* derived lookups — built once from the registry */
var BY_KIND = {};
INTENTS.forEach(function (it) { BY_KIND[it.kind] = it; });
var ALIAS_TO_KIND = {};
INTENTS.forEach(function (it) { (it.aliases || []).forEach(function (a) { ALIAS_TO_KIND[a] = it.kind; }); });
var CMD_RE = new RegExp('^\\s*(' + Object.keys(ALIAS_TO_KIND).join('|') + ')\\b\\s*([\\s\\S]*)$', 'i');
var LOCAL_HELP = 'Ask in plain language ("where is X defined", "what references X", "what imports X", '
  + '"files related to app.js", "project structure", "where are the tests", "entry points", "what changed recently") '
  + 'or use a command: ' + INTENTS.filter(function (it) { return it.helpCmd; }).map(function (it) { return it.helpCmd; }).join(', ')
  + '. Interpretation ("why…", "how should I…") needs a model — '
  + 'connect one in settings and Meridian sends only the relevant evidence, never the whole repo.';

/* ---- Intent router: deterministic kinds vs. reasoning vs. plain fallback ---- */
function classifyIntent(q) {
  var s = q.trim(), lo = s.toLowerCase(), idx = st.files.size ? getIndex() : null;
  var cmd = s.match(CMD_RE);
  if (cmd) {
    var k = ALIAS_TO_KIND[cmd[1].toLowerCase()];
    return { kind: k, arg: cmd[2].trim(), deterministic: true, needsModel: false };
  }
  for (var i = 0; i < INTENTS.length; i++) {
    var it = INTENTS[i];
    if (!it.route) continue;
    var m = it.route(s, lo, idx);
    if (m) return { kind: it.kind, arg: m.arg || '', deterministic: !it.needsModel, needsModel: !!it.needsModel };
  }
  /* unreachable — 'plain' is a catch-all — kept as a hard fallback */
  return { kind: 'plain', arg: pickSymbol(s, idx), deterministic: true, needsModel: false };
}

/* ---- Investigation engine: real operations over the index, collecting evidence.
   Returns { steps, verdict:{local,text}, actions, answer }. No fabricated work. ---- */
function runInvestigation(q, intent) {
  var idx = getIndex();
  var entry = BY_KIND[intent.kind] || BY_KIND.plain;
  return entry.run(intent.arg, q, idx, intent);
}

/* grounding label map for prompt.js — kind → evidence-kind, from the registry */
function groundKinds() {
  var out = {};
  INTENTS.forEach(function (it) { out[it.kind] = it.ground || 'evidence'; });
  return out;
}

export { CAP_LOCAL, CAP_MODEL, INTENTS, LOCAL_HELP, classifyIntent, evAt, groundKinds, listOrphans, localEvidence, pickPathish, pickSymbol, resolveToFile, runInvestigation, symLookup };
