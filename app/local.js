import { sortedPaths, st } from './state.js';
import { queryTerms } from './smart-context.js';
import { dirOf, fileExt, getIndex } from './indexer.js';
import { localSearchData } from './actions.js';
import { addAiMsg, addUserMsg, attachCopy, renderRich, renderTrace, scrollEnd } from './trace.js';
import { $, announce, fmtTok, setStatus } from './helpers.js';
/* ============ LOCAL ENGINE (NO API · NO AI) ============
   The deterministic project-intelligence engine. A question is routed by intent
   (classifyIntent), an investigation runs real operations over the project index
   (runInvestigation), and the findings are surfaced through the same trace +
   evidence-chip UI the AI providers use — every claim pinned to a real file:line.
   Meridian understands the terrain first; a model is optional, and only for
   interpretation. Honestly labeled LOCAL · NO AI, with an explicit KNOWN-LOCALLY
   vs REQUIRES-MODEL verdict on every answer.                                    */

var CAP_LOCAL = ['Project structure', 'Search', 'Definitions', 'References', 'Imports & importers', 'File relationships', 'Recent changes', 'Evidence collection'];
var CAP_MODEL = ['Architectural reasoning', 'Natural-language synthesis', 'Root-cause analysis', 'Refactoring recommendations'];
var LOCAL_HELP = 'Ask in plain language ("where is X defined", "what references X", "what imports X", '
  + '"files related to app.js", "project structure", "where are the tests", "entry points", "what changed recently") '
  + 'or use a command: `def`, `refs`, `imports`, `importers`, `related`, `symbols`, `structure`, `tests`, `entries`, '
  + '`recent <n>`, `dir <path>`, `search <text|regex>`. Interpretation ("why…", "how should I…") needs a model — '
  + 'connect one in settings and Meridian sends only the relevant evidence, never the whole repo.';

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

/* ---- Intent router: deterministic kinds vs. reasoning vs. plain fallback ---- */
function classifyIntent(q) {
  var s = q.trim(), lo = s.toLowerCase(), idx = st.files.size ? getIndex() : null;
  var cmd = s.match(/^\s*(search|def|refs|dir|recent|imports|importers|importedby|symbols|related|structure|overview|tests|entries|entrypoints|help)\b\s*([\s\S]*)$/i);
  if (cmd) {
    var kmap = { search: 'search', def: 'def', refs: 'refs', dir: 'dir', recent: 'recent', imports: 'imports', importers: 'importers', importedby: 'importers', symbols: 'symbols', related: 'related', structure: 'structure', overview: 'structure', tests: 'tests', entries: 'entries', entrypoints: 'entries', help: 'help' };
    return { kind: kmap[cmd[1].toLowerCase()], arg: cmd[2].trim(), deterministic: true, needsModel: false };
  }
  function det(kind, arg) { return { kind: kind, arg: arg, deterministic: true, needsModel: false }; }
  /* distinctive deterministic nouns first */
  if (/\b(entry ?points?|entrypoints?|main file|entry file)\b/.test(lo)) return det('entries', '');
  if (/\b(recent(ly)?|latest|newest|last changed|what changed|changed recently)\b/.test(lo)) { var num = lo.match(/\b(\d{1,2})\b/); return det('recent', num ? num[1] : '10'); }
  if (/\b(project structure|structure of|overview|directories|packages|project map|top-?level|layout|organi[sz]ation|how is .* organi[sz]ed|what.*directories)\b/.test(lo)) return det('structure', '');
  if (/\btests?\b/.test(lo) && /\b(where|find|list|show|which|are|any)\b/.test(lo)) return det('tests', '');
  if (/\b(list|show|all)\b/.test(lo) && /\b(files?)\b/.test(lo) && /\b([a-z]{1,6})\b\s+files?\b/.test(lo)) return det('listType', s);
  if (/\brelated\b|\bconnected to\b|\bassociated with\b|\bneighbou?rs of\b/.test(lo)) return det('related', pickPathish(s));
  /* import direction */
  if (/\bwhat does\b[\s\S]*\bimport\b|\bimports of\b|\bdependencies of\b|\bwhat.*\bdepend(s)? on\b/.test(lo)) return det('imports', pickPathish(s));
  if (/\b(imports?|importe(rs|d)?|depend(s|ents?|encies)?|who (imports|uses|depends)|used by|includes)\b/.test(lo)) return det('importers', pickPathish(s));
  if (/\b(symbols?|functions?|classes|methods)\b/.test(lo) && !/\b(where|defined|definition|reference|references)\b/.test(lo)) return det('symbols', pickSymbol(s, idx));
  if (/\b(reference|references|referenced|callers?|call sites?|usages?|used by|who calls|what calls|uses of)\b/.test(lo)) return det('refs', pickSymbol(s, idx));
  if (/\b(where|location|find|definition|defined|declared|declaration)\b/.test(lo)) return det('def', pickSymbol(s, idx));
  /* reasoning — interpretation a deterministic engine cannot honestly provide */
  if (/\b(why|how (do|does|is|should|can|would)|root cause|recommend|refactor|improve|architect(ure)?|risk|risks|should i|would you|best way|design|rationale|trade-?offs?|explain)\b/.test(lo)) return { kind: 'reason', arg: pickSymbol(s, idx), deterministic: false, needsModel: true };
  return { kind: 'plain', arg: pickSymbol(s, idx), deterministic: true, needsModel: false };
}

/* ---- Investigation engine: real operations over the index, collecting evidence.
   Returns { steps, verdict:{local,text}, actions, answer }. No fabricated work. ---- */
function gatherTerrain(q, steps) {
  /* shared evidence-gathering used by plain + reason: term search → ranked files */
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

function runInvestigation(q, intent) {
  var idx = getIndex(), steps = [], actions = null;
  var localVerdict = { local: true, text: 'KNOWN LOCALLY' };
  var arg = intent.arg;

  if (intent.kind === 'help') {
    return { steps: [{ action: 'list capabilities', note: 'local engine reference', evidence: [], status: 'done' }],
      verdict: localVerdict,
      answer: '**Meridian LOCAL engine** — deterministic project intelligence, no AI, no network.\n\n**Known locally:** ' + CAP_LOCAL.join(' · ') + '.\n**Requires a model:** ' + CAP_MODEL.join(' · ') + '.\n\n' + LOCAL_HELP };
  }

  if (intent.kind === 'def') {
    var defs = symLookup(arg, idx);
    steps.push({ action: 'look up “' + arg + '” in the symbol index', note: defs.length + ' definition' + (defs.length === 1 ? '' : 's'), evidence: defs.slice(0, 8).map(function (d) { return evAt(d.file, d.line); }), status: 'done' });
    var refs = localSearchData(arg, 'refs');
    steps.push({ action: 'scan for references', note: refs.hits.length + ' reference' + (refs.hits.length === 1 ? '' : 's'), evidence: refs.hits.slice(0, 6).map(localEvidence), status: 'done' });
    actions = [{ kind: 'refs', command: arg, why: 'list every reference to ' + arg }];
    var ans = defs.length
      ? '`' + arg + '` is defined in ' + defs.length + ' place' + (defs.length === 1 ? '' : 's') + ':\n\n' + defs.slice(0, 8).map(function (d) { return '- `' + d.file + '` line ' + d.line + ' (' + d.kind + ')'; }).join('\n') + '\n\nEvidence chips open each definition at its exact line.'
      : 'No indexed definition named `' + arg + '`. It may be an external symbol, a dynamic name, or spelled differently. The reference scan above shows where the term appears.';
    return { steps: steps, verdict: localVerdict, actions: actions, answer: ans };
  }

  if (intent.kind === 'refs') {
    var r = localSearchData(arg, 'refs');
    steps.push({ action: 'find references to “' + arg + '”', note: r.hits.length + ' hit' + (r.hits.length === 1 ? '' : 's') + ' in ' + r.filesHit + ' file' + (r.filesHit === 1 ? '' : 's'), evidence: r.hits.slice(0, 10).map(localEvidence), status: 'done' });
    var d2 = symLookup(arg, idx);
    if (d2.length) steps.push({ action: 'locate its definition', note: d2.length + ' definition' + (d2.length === 1 ? '' : 's'), evidence: d2.slice(0, 4).map(function (d) { return evAt(d.file, d.line); }), status: 'done' });
    actions = [{ kind: 'def', command: arg, why: 'jump to where ' + arg + ' is defined' }];
    return { steps: steps, verdict: localVerdict, actions: actions,
      answer: r.hits.length ? '`' + arg + '` is referenced ' + (r.hits.length >= r.cap ? r.cap + '+' : r.hits.length) + ' time' + (r.hits.length === 1 ? '' : 's') + ' across ' + r.filesHit + ' file' + (r.filesHit === 1 ? '' : 's') + '. Chips open each at its line.' : 'No references to `' + arg + '` in the loaded files.' };
  }

  if (intent.kind === 'importers') {
    var tf = resolveToFile(arg);
    var imps = tf ? (idx.importedBy.get(tf) || []) : [];
    steps.push({ action: 'resolve “' + arg + '” to a file', note: tf || 'unresolved', evidence: [], status: 'done' });
    steps.push({ action: 'read importer edges from the index', note: imps.length + ' importer' + (imps.length === 1 ? '' : 's'), evidence: imps.slice(0, 12).map(function (x) { return evAt(x.file, x.line); }), status: 'done' });
    var ians = !tf ? 'Could not resolve `' + arg + '` to a loaded file.'
      : imps.length ? '`' + tf + '` is imported by ' + imps.length + ' file' + (imps.length === 1 ? '' : 's') + ':\n\n' + imps.slice(0, 12).map(function (x) { return '- `' + x.file + '` line ' + x.line; }).join('\n')
      : 'No loaded file imports `' + tf + '`. Either nothing depends on it, or the project uses a bundling/single-file style with no import statements between files (a real architectural fact, not a gap).';
    return { steps: steps, verdict: localVerdict, answer: ians };
  }

  if (intent.kind === 'imports') {
    var tf2 = resolveToFile(arg);
    var list = tf2 ? (idx.importsByFile.get(tf2) || []) : [];
    var resolved = list.filter(function (x) { return x.resolved; }), external = list.filter(function (x) { return !x.resolved; });
    steps.push({ action: 'resolve “' + arg + '” to a file', note: tf2 || 'unresolved', evidence: [], status: 'done' });
    steps.push({ action: 'read import statements', note: list.length + ' import' + (list.length === 1 ? '' : 's') + ' · ' + resolved.length + ' internal, ' + external.length + ' external', evidence: list.slice(0, 12).map(function (x) { return evAt(tf2, x.line); }), status: 'done' });
    var mans = !tf2 ? 'Could not resolve `' + arg + '` to a loaded file.'
      : list.length ? '`' + tf2 + '` has ' + list.length + ' import' + (list.length === 1 ? '' : 's') + '.\n\n**Internal:** ' + (resolved.map(function (x) { return '`' + x.resolved + '`'; }).join(', ') || 'none') + '\n**External:** ' + (external.map(function (x) { return '`' + x.raw + '`'; }).join(', ') || 'none')
      : 'No import statements found in `' + tf2 + '`.';
    return { steps: steps, verdict: localVerdict, answer: mans };
  }

  if (intent.kind === 'related') {
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
    return { steps: steps, verdict: localVerdict, answer: rans };
  }

  if (intent.kind === 'symbols') {
    if (arg) {
      var matches = [];
      idx.symbols.forEach(function (defsArr, name) { if (name.toLowerCase().indexOf(arg.toLowerCase()) !== -1) matches.push({ name: name, def: defsArr[0], n: defsArr.length }); });
      matches.sort(function (a, b) { return a.name.length - b.name.length; });
      var top = matches.slice(0, 15);
      steps.push({ action: 'search the symbol index for “' + arg + '”', note: matches.length + ' matching symbol' + (matches.length === 1 ? '' : 's'), evidence: top.map(function (mm) { return evAt(mm.def.file, mm.def.line); }), status: 'done' });
      return { steps: steps, verdict: localVerdict,
        answer: top.length ? matches.length + ' symbol' + (matches.length === 1 ? '' : 's') + ' match `' + arg + '`:\n\n' + top.map(function (mm) { return '- `' + mm.name + '` (' + mm.def.kind + ') — `' + mm.def.file + '` line ' + mm.def.line + (mm.n > 1 ? ' (+' + (mm.n - 1) + ' more)' : ''); }).join('\n') : 'No indexed symbol matches `' + arg + '`.' };
    }
    var byFile = {};
    idx.symbols.forEach(function (defsArr) { defsArr.forEach(function (d) { byFile[d.file] = (byFile[d.file] || 0) + 1; }); });
    var topFiles = Object.keys(byFile).sort(function (a, b) { return byFile[b] - byFile[a]; }).slice(0, 8);
    steps.push({ action: 'summarize the symbol index', note: idx.symbolCount + ' definitions · ' + idx.symbols.size + ' unique names', evidence: topFiles.map(function (p) { return evAt(p, 1); }), status: 'done' });
    return { steps: steps, verdict: localVerdict,
      answer: 'The index holds **' + idx.symbolCount + ' symbol definitions** (' + idx.symbols.size + ' unique names). Densest files:\n\n' + topFiles.map(function (p) { return '- `' + p + '` — ' + byFile[p] + ' symbols'; }).join('\n') + '\n\nAsk `symbols <name>` to find a specific one.' };
  }

  if (intent.kind === 'structure') {
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
    return { steps: steps, verdict: localVerdict, answer: sans };
  }

  if (intent.kind === 'tests') {
    steps.push({ action: 'read test classification from the index', note: idx.tests.length + ' test file' + (idx.tests.length === 1 ? '' : 's'), evidence: idx.tests.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
    return { steps: steps, verdict: localVerdict,
      answer: idx.tests.length ? 'Detected ' + idx.tests.length + ' test file' + (idx.tests.length === 1 ? '' : 's') + ' (patterns: `.test.` `.spec.` `_test` `tests/` `__tests__`):\n\n' + idx.tests.slice(0, 20).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No test files detected by the standard patterns (`.test.` `.spec.` `_test` `tests/` `__tests__`). That is a real finding about this project, not a limitation.' };
  }

  if (intent.kind === 'entries') {
    steps.push({ action: 'read entry-point classification', note: idx.entries.length + ' entry point' + (idx.entries.length === 1 ? '' : 's'), evidence: idx.entries.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
    return { steps: steps, verdict: localVerdict,
      answer: idx.entries.length ? 'Likely entry points (index/main/app/server/cli/core/lib):\n\n' + idx.entries.slice(0, 20).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No conventional entry-point filenames detected.' };
  }

  if (intent.kind === 'recent') {
    var rr = localRecentData(arg || '10'); rr.steps.forEach(function (step) { step.status = 'done'; });
    return { steps: rr.steps, verdict: localVerdict, answer: rr.answer };
  }
  if (intent.kind === 'dir') {
    var dd = localDirData(arg || '.'); dd.steps.forEach(function (step) { step.status = 'done'; });
    return { steps: dd.steps, verdict: localVerdict, answer: dd.answer };
  }
  if (intent.kind === 'search') {
    if (!arg) return { steps: [{ action: 'parse command', note: 'search needs a pattern', evidence: [], status: 'done' }], verdict: localVerdict, answer: '`search` needs a pattern, e.g. `search cache_control`.' };
    var sr = localSearchData(arg, 'text');
    steps.push({ action: 'search “' + arg + '”', note: sr.hits.length + ' hit' + (sr.hits.length === 1 ? '' : 's') + ' in ' + sr.filesHit + ' file' + (sr.filesHit === 1 ? '' : 's'), evidence: sr.hits.slice(0, 12).map(localEvidence), status: 'done' });
    return { steps: steps, verdict: localVerdict, answer: sr.hits.length ? 'Found ' + (sr.hits.length >= sr.cap ? sr.cap + '+' : sr.hits.length) + ' match' + (sr.hits.length === 1 ? '' : 'es') + ' for `' + arg + '`. Chips open each at its line.' : 'No matches for `' + arg + '`.' };
  }

  if (intent.kind === 'listType') {
    var em = q.toLowerCase().match(/\b(typescript|javascript|python|golang|go|rust|java|ruby|markdown|html|css|json|yaml|c\+\+|c#|[a-z]{1,6})\s+files?\b/);
    var alias = { typescript: 'ts', javascript: 'js', python: 'py', golang: 'go', rust: 'rs', java: 'java', ruby: 'rb', markdown: 'md', 'c++': 'cpp', 'c#': 'cs' };
    var want = em ? (alias[em[1]] || em[1]) : '';
    var matched = sortedPaths().filter(function (p) { return fileExt(p) === want; });
    steps.push({ action: 'filter files by extension “' + want + '”', note: matched.length + ' file' + (matched.length === 1 ? '' : 's'), evidence: matched.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
    return { steps: steps, verdict: localVerdict, answer: matched.length ? matched.length + ' `.' + want + '` file' + (matched.length === 1 ? '' : 's') + ':\n\n' + matched.slice(0, 25).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No `.' + want + '` files loaded.' };
  }

  if (intent.kind === 'reason') {
    var t = gatherTerrain(q, steps);
    var sym = intent.arg && symLookup(intent.arg, idx).length ? intent.arg : (t.terms[0] || '');
    if (sym) {
      var sd = symLookup(sym, idx);
      if (sd.length) steps.push({ action: 'locate “' + sym + '”', note: sd.length + ' definition' + (sd.length === 1 ? '' : 's'), evidence: sd.slice(0, 4).map(function (d) { return evAt(d.file, d.line); }), status: 'done' });
    }
    actions = [];
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
  }

  /* plain: deterministic ranked search; synthesis optional */
  var tp = gatherTerrain(q, steps);
  if (!tp.terms.length) return { steps: steps, verdict: localVerdict, answer: 'That question has no distinctive terms to search for. Name a symbol, filename, or keyword — or use a command.\n\n' + LOCAL_HELP };
  var topSym = tp.terms[0];
  actions = [{ kind: 'def', command: topSym, why: 'where “' + topSym + '” is defined' }, { kind: 'refs', command: topSym, why: 'every reference to “' + topSym + '”' }, { kind: 'recent', command: '10', why: 'recently modified files' }];
  return { steps: steps, verdict: localVerdict, actions: actions,
    answer: tp.ranked.length ? 'Deterministic search — the files below best match your words (match count, then importance). Open a chip to inspect, or ask `def`/`refs`. Interpreting *why* would benefit from a model.\n\n' + tp.ranked.slice(0, 5).map(function (r, i) { return (i + 1) + '. `' + r.p + '` — ' + r.count + ' match' + (r.count === 1 ? '' : 'es'); }).join('\n') : 'None of your terms appear in the loaded files. Try different wording or check what is selected in CONTEXT.' };
}

function renderVerdict(msgEl, verdict) {
  if (!verdict) return;
  var bd = msgEl.querySelector('.bd');
  var v = document.createElement('div');
  v.className = 'verdict ' + (verdict.local ? 'ok' : 'model');
  v.innerHTML = '<span class="vk mono"></span><span class="vt"></span>';
  v.querySelector('.vk').textContent = verdict.local ? '✓ ' + verdict.text : '○ ' + verdict.text;
  v.querySelector('.vt').textContent = verdict.local ? 'answered from the project index — zero inference, zero network' : 'evidence gathered locally — connect a model to synthesize';
  bd.appendChild(v);
}

function askLocal(q) {
  addUserMsg(q);
  var msgEl = addAiMsg();
  var txtEl = msgEl.querySelector('.txt');
  setStatus('LOCAL ENGINE — investigating…');

  var answer, trace, verdict;
  if (!st.files.size) {
    answer = 'No project is loaded, so there is no terrain to analyze yet. Drop a folder into CONTEXT and Meridian will index it — or switch to an AI provider in settings.\n\n**Known locally:** ' + CAP_LOCAL.join(' · ') + '.\n**Requires a model:** ' + CAP_MODEL.join(' · ') + '.\n\n' + LOCAL_HELP;
    trace = { steps: [{ action: 'check loaded context', note: 'no files in memory', evidence: [] }] };
    verdict = { local: true, text: 'KNOWN LOCALLY' };
  } else {
    var intent = classifyIntent(q);
    var inv = runInvestigation(q, intent);
    answer = inv.answer;
    trace = { steps: inv.steps, actions: inv.actions || null };
    verdict = inv.verdict;
  }

  txtEl.innerHTML = renderRich(answer);
  renderVerdict(msgEl, verdict);
  renderTrace(msgEl, trace);
  /* the header chip defaults to TRACED — relabel it so nobody mistakes this for a model */
  var chip = msgEl.querySelector('.term-hd .chip');
  if (chip) { chip.className = 'chip'; chip.textContent = 'LOCAL · NO AI'; }
  var hd = msgEl.querySelector('.term-hd');
  if (hd && hd.firstChild) hd.firstChild.textContent = 'MERIDIAN LOCAL ENGINE — NO AI ';

  st.history.push({ role: 'user', content: q });
  st.history.push({ role: 'assistant', content: answer });
  st.transcript.push({ q: q, answer: answer, trace: trace, model: 'LOCAL ENGINE', provider: 'LOCAL', ts: Date.now() });
  attachCopy(msgEl, st.transcript.length - 1);
  setStatus('LOCAL ENGINE IDLE — deterministic · zero network');
  announce('Local answer ready.');
  scrollEnd();
}

/* ---- Project Intelligence overview: the deterministic terrain, shown on load
   for every provider. Tiles are real queries into the same engine. ---- */
function renderOverview() {
  var ov = $('overview'), emptyEl = $('empty');
  if (!st.files.size) { ov.hidden = true; ov.innerHTML = ''; if (emptyEl) emptyEl.hidden = false; return; }
  if (emptyEl) emptyEl.hidden = true; /* overview is the orientation once a project is loaded */
  var idx = getIndex();
  var dirs = {}; sortedPaths().forEach(function (p) { dirs[dirOf(p) || '.'] = 1; });
  var langs = Object.keys(idx.byExt).filter(function (e) { return e !== '·'; }).sort(function (a, b) { return idx.byExt[b] - idx.byExt[a]; });
  var tiles = [
    { label: 'FILES', value: idx.fileCount, q: 'project structure' },
    { label: 'DIRECTORIES', value: Object.keys(dirs).length, q: 'project structure' },
    { label: 'PACKAGES', value: idx.packages.length, q: 'project structure' },
    { label: 'ENTRY POINTS', value: idx.entries.length, q: 'entry points' },
    { label: 'TESTS', value: idx.tests.length, q: 'where are the tests' },
    { label: 'SYMBOLS', value: idx.symbolCount, q: 'symbols' }
  ];
  ov.hidden = false;
  ov.innerHTML = '<div class="ov-hd mono">PROJECT INTELLIGENCE // <b>deterministic</b> — Meridian understands the terrain before a model enters the room</div>'
    + '<div class="stat-grid"></div><div class="ov-index mono"></div><div class="ov-langs mono"></div><div class="ov-cap mono"></div>';
  var grid = ov.querySelector('.stat-grid');
  tiles.forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'stat-tile';
    b.title = 'Run a local investigation: ' + t.q;
    b.innerHTML = '<span class="sl"></span><span class="sv"></span>';
    b.querySelector('.sl').textContent = t.label;
    b.querySelector('.sv').textContent = t.value >= 1000 ? fmtTok(t.value) : String(t.value);
    b.addEventListener('click', function () { askLocal(t.q); });
    grid.appendChild(b);
  });
  var langCount = idx.langs ? Object.keys(idx.langs).length : langs.length;
  ov.querySelector('.ov-index').textContent = '// indexed ' + idx.symbolCount + ' symbol' + (idx.symbolCount === 1 ? '' : 's') + ' · ' + (idx.importCount || 0) + ' import' + ((idx.importCount || 0) === 1 ? '' : 's') + ' · ' + langCount + ' language' + (langCount === 1 ? '' : 's');
  ov.querySelector('.ov-langs').textContent = '// languages: ' + (langs.slice(0, 6).map(function (e) { return e + ' ·' + idx.byExt[e]; }).join('  ') || 'none');
  ov.querySelector('.ov-cap').textContent = '// ✓ known locally: ' + CAP_LOCAL.join(' · ') + '   ○ requires a model: ' + CAP_MODEL.join(' · ');
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

export { askLocal, classifyIntent, pickSymbol, renderOverview, runInvestigation, symLookup };
