import { evAt, resolveToFile, symLookup, pickPathish, LOCAL_VERDICT, longLineNote, listBroken, assetNote, listUntestedGaps, listOrphans, SEV_LABEL, computeSignals, findCycles, bfsPath, edgeLine, plural } from './intents-core.js';
/* ============ INTENTS: HEALTH ============
   signals, untested, tests, cycles, orphans, broken, impact, hubs, path. Entries are verbatim from the registry in intents.js; array order is the
   routing cascade, so intents.js concatenates the groups in a fixed order. */
var HEALTH = [
  /* before `hotspots` ("biggest") and `reason` ("should i"): the ranked digest */
  { kind: 'signals', aliases: ['signals'], ground: 'signal', helpCmd: '`signals`', needsModel: false,
    route: function (s, lo) { return /\b(signal extraction|what matters|worth (my |your |the )?attention|top issues|what should i (look at|fix|worry about)|what['’]?s wrong|biggest (problems?|issues?))\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [], sigs = computeSignals(idx);
      if (!sigs.length) {
        steps.push({ action: 'extract signals from the index', note: 'no high-signal findings', evidence: [], status: 'done' });
        return { steps: steps, verdict: LOCAL_VERDICT(),
          answer: 'No high-signal findings: no broken relative imports, no import cycles, no untested high-fan-in files, and no unusual debt concentration. That is a real reading of the terrain, not a placeholder.' };
      }
      sigs.forEach(function (g) { steps.push({ action: 'signal · ' + SEV_LABEL[g.severity], note: g.title, evidence: [g.evidence], status: 'done' }); });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: 'Signal extraction: the ' + plural(sigs.length, 'finding') + ' worth your attention, ranked (not thirty):\n\n'
          + sigs.map(function (g, i) { return (i + 1) + '. **' + SEV_LABEL[g.severity] + '**: ' + g.title + ' → drill in: `' + g.drill + '`'; }).join('\n')
          + '\n\nEach step\'s chip opens the first piece of evidence; run the named command for the full list. Deterministic: computed from the index, no model.' };
    } },

  /* before `tests`: "files without tests" must not be answered with the test list */
  { kind: 'untested', aliases: ['untested'], ground: 'coverage-gap', helpCmd: '`untested`', needsModel: false,
    route: function (s, lo) { return /\b(untested|without tests?|missing tests?|coverage gaps?|lack(s|ing)? tests?|no tests? for)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      if (!idx.tests.length) {
        steps.push({ action: 'read test classification from the index', note: '0 test files', evidence: [], status: 'done' });
        return { steps: steps, verdict: LOCAL_VERDICT(),
          answer: 'No test files detected by the standard patterns (`.test.` `.spec.` `_test` `tests/` `__tests__`): every code file is a coverage gap. That is a real finding about this project, not a limitation.' };
      }
      var gaps = listUntestedGaps(idx);
      steps.push({ action: 'match test files to sources (name stems + what tests import)', note: plural(idx.tests.length, 'test file') + ' · ' + plural(gaps.length, 'uncovered code file'), evidence: gaps.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: gaps.length
          ? plural(gaps.length, 'code file') + ' with no matching test (no shared name stem, not imported by any test file):\n\n' + gaps.slice(0, 40).map(function (p) { return '- `' + p + '`'; }).join('\n') + '\n\nMatched by test-file name stems and test imports: integration tests that exercise code indirectly are not traced.'
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
          ? 'Found ' + plural(cycles.length, 'import cycle') + (cycles.length >= 10 ? ' (search capped at 10)' : '') + ':\n\n' + cycles.slice(0, 10).map(function (c) { return '- ' + c.nodes.map(function (n) { return '`' + n + '`'; }).join(' → '); }).join('\n') + '\n\nChips open the import statement that closes each cycle. Static resolved edges only: dynamic loading is not traced.'
          : 'No circular imports among the ' + plural(idx.importCount, 'indexed import') + ': the resolved dependency graph is acyclic.' };
    } },

  /* before `listType`: "unused files" would otherwise be read as a list-by-type query */
  { kind: 'orphans', aliases: ['orphans', 'dead'], ground: 'orphan', helpCmd: '`orphans`', needsModel: false,
    route: function (s, lo) { return /\b(orphan(ed)?s?|dead (files?|code)|unused files?|never imported|unreferenced files?)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var orphans = listOrphans(idx);
      steps.push({ action: 'scan importer edges for unreferenced code files', note: plural(orphans.length, 'candidate'), evidence: orphans.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: (orphans.length
          ? plural(orphans.length, 'code file') + ' ' + (orphans.length === 1 ? 'is' : 'are') + ' never imported by any loaded file (and not classified as entry point, test, config, or doc):\n\n' + orphans.slice(0, 20).map(function (p) { return '- `' + p + '`'; }).join('\n') + '\n\nStatic import edges only: files loaded dynamically, from HTML, or by a bundler config can appear here without being dead.'
          : 'Every loaded code file is either imported somewhere or classified as an entry point, test, config, or doc.') + longLineNote(idx) };
    } },

  { kind: 'broken', aliases: ['broken', 'unresolved'], ground: 'broken-import', helpCmd: '`broken`', needsModel: false,
    route: function (s, lo) { return /\b(broken|unresolved|missing|dangling)\b[\s\S]*\bimports?\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var broken = listBroken(idx);
      steps.push({ action: 'scan relative imports that resolve to no loaded file', note: plural(broken.length, 'unresolved relative import'), evidence: broken.slice(0, 12).map(function (b) { return evAt(b.file, b.line); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: (broken.length
          ? plural(broken.length, 'relative import') + ' resolve' + (broken.length === 1 ? 's' : '') + ' to no loaded file:\n\n' + broken.slice(0, 20).map(function (b) { return '- `' + b.file + '` line ' + b.line + ' → `' + b.raw + '`'; }).join('\n') + '\n\nEither the target is genuinely missing, or it was not loaded (check ignore filters). Bare specifiers (npm/stdlib packages) are treated as external, not broken.'
          : 'Every relative import resolves to a loaded file. Bare module specifiers (packages, stdlib) are treated as external by design.') + assetNote(idx) + longLineNote(idx) };
    } },

  /* before `hubs`/`importers`: blast-radius phrasings ("what breaks", "transitively",
     "who would notice") must not fall into the direct-importer or plain routes */
  { kind: 'impact', aliases: ['impact', 'blast'], ground: 'impact', helpCmd: '`impact <file>`', needsModel: false,
    route: function (s, lo) { return /\b(blast radius|what (would )?breaks?|breaks? if|impact of|transitive(ly)?( dependents?| dependen(ts|cies))?|ripple effect|who would (notice|be affected))\b/.test(lo) ? { arg: pickPathish(s) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var tf = resolveToFile(arg);
      /* a symbol, not a file — impact is file-granular, so analyze its defining file (disclosed) */
      if (!tf && arg) {
        var sd = symLookup(arg, idx);
        if (sd.length) {
          tf = sd[0].file;
          steps.push({ action: '“' + arg + '” names a symbol: analyze its defining file', note: tf, evidence: [evAt(sd[0].file, sd[0].line)], status: 'done' });
        }
      }
      steps.push({ action: 'resolve “' + (arg || '?') + '” to a file', note: tf || 'unresolved', evidence: [], status: 'done' });
      if (!tf) return { steps: steps, verdict: LOCAL_VERDICT(), answer: '`impact` needs a loaded file (or an indexed symbol), e.g. `impact src/store.js`, or ask “what breaks if I change store.js”.' };
      /* BFS over reverse (importer) edges: depth 1 = direct, ≥2 = transitive */
      var depth = Object.create(null), order = [], queue = [tf], qi = 0, CAP = 200, capped = false;
      depth[tf] = 0;
      while (qi < queue.length) {
        var n = queue[qi++];
        var imps = idx.importedBy.get(n) || [];
        for (var i = 0; i < imps.length; i++) {
          var e = imps[i];
          if (depth[e.file] !== undefined) continue;
          if (order.length >= CAP) { capped = true; break; }
          depth[e.file] = depth[n] + 1;
          order.push({ file: e.file, via: n, line: e.line, d: depth[e.file] });
          queue.push(e.file);
        }
        if (capped) break;
      }
      var direct = order.filter(function (x) { return x.d === 1; });
      var trans = order.filter(function (x) { return x.d >= 2; });
      steps.push({ action: 'read direct importers', note: plural(direct.length, 'file'), evidence: direct.slice(0, 10).map(function (x) { return evAt(x.file, x.line); }), status: 'done' });
      steps.push({ action: 'walk the transitive closure (reverse import edges)', note: plural(trans.length, 'deeper dependent') + (capped ? ' (walk capped at ' + CAP + ')' : ''), evidence: trans.slice(0, 10).map(function (x) { return evAt(x.file, x.line); }), status: 'done' });
      var testSet = Object.create(null); idx.tests.forEach(function (p) { testSet[p] = 1; });
      var entrySet = Object.create(null); idx.entries.forEach(function (p) { entrySet[p] = 1; });
      var testsHit = order.filter(function (x) { return testSet[x.file]; });
      var entriesHit = order.filter(function (x) { return entrySet[x.file]; });
      steps.push({ action: 'classify the affected set', note: plural(testsHit.length, 'test file') + ' · ' + plural(entriesHit.length, 'entry point'), evidence: testsHit.slice(0, 4).map(function (x) { return evAt(x.file, x.line); }).concat(entriesHit.slice(0, 4).map(function (x) { return evAt(x.file, x.line); })), status: 'done' });
      if (!order.length) {
        return { steps: steps, verdict: LOCAL_VERDICT(),
          answer: 'Nothing imports `' + tf + '`: its static blast radius is **the file itself**. ' + ((idx.importedBy.get(tf) || []).length ? '' : 'If it is not an entry point, test, config, or doc, `orphans` will list it too.') + '\n\nStatic import edges only: dynamic loading, DI, or bundler wiring could still depend on it invisibly.' + longLineNote(idx) };
      }
      function li(x) { return '- `' + x.file + '`: imports ' + (x.via === tf ? 'it' : '`' + x.via + '`') + ' at line ' + x.line + (testSet[x.file] ? ' · **test**' : '') + (entrySet[x.file] ? ' · **entry point**' : ''); }
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: '**Blast radius of `' + tf + '`**: ' + plural(order.length, 'dependent file') + (capped ? ' (walk capped at ' + CAP + ')' : '') + ': '
          + direct.length + ' direct, ' + trans.length + ' transitive.\n\n'
          + '**Direct importers (break immediately):**\n' + direct.slice(0, 15).map(li).join('\n') + (direct.length > 15 ? '\n… +' + (direct.length - 15) + ' more' : '') + '\n'
          + (trans.length ? '\n**Transitive dependents (break through the chain):**\n' + trans.slice(0, 15).map(li).join('\n') + (trans.length > 15 ? '\n… +' + (trans.length - 15) + ' more' : '') + '\n' : '')
          + '\n' + (testsHit.length ? plural(testsHit.length, 'test file') + ' ' + (testsHit.length === 1 ? 'is' : 'are') + ' in the blast radius: a break would be caught there. ' : 'No test file is in the blast radius: a break here would surface at runtime, not in tests. ')
          + (entriesHit.length ? plural(entriesHit.length, 'entry point') + ' reached: the break is user-visible.' : '')
          + '\n\nStatic resolved import edges only: dynamic loading, DI and bundler wiring are not traced.' + longLineNote(idx) };
    } },

  /* before `importers`: "most imported files" would otherwise match its import- regex */
  { kind: 'hubs', aliases: ['hubs'], ground: 'hub', helpCmd: '`hubs`', needsModel: false,
    route: function (s, lo) { return /\b(most (imported|depended[- ]on|used)|central files?|hubs?|fan-?in|(?:dependency|import) graph)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var ranked = [];
      idx.importedBy.forEach(function (arr, p) { if (arr.length) ranked.push({ p: p, n: arr.length }); });
      ranked.sort(function (a, b) { return b.n - a.n || (a.p < b.p ? -1 : 1); });
      var top = ranked.slice(0, 10);
      steps.push({ action: 'rank files by importer fan-in', note: plural(ranked.length, 'imported file') + ' · top ' + top.length, evidence: top.map(function (r) { return evAt(r.p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: top.length
          ? 'Most-imported files (fan-in: the load-bearing walls of this project):\n\n' + top.map(function (r, i) { return (i + 1) + '. `' + r.p + '`: imported by ' + plural(r.n, 'file'); }).join('\n')
          : 'No file is imported by another loaded file: either a single-file project or a bundling style with no static imports.' };
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
          : 'No static import path connects `' + a + '` and `' + b + '` in either direction. They may be linked at runtime (DI, dynamic import, config): the index only traces static edges.' };
    } },
];
export { HEALTH };
