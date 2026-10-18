import { localSearchData } from './actions.js';
import { localEvidence, evAt, resolveToFile, symLookup, pickSymbol, pickPathish, LOCAL_VERDICT, plural } from './intents-core.js';
/* ============ INTENTS: SYMBOLS ============
   imports, importers, symbols, refs, def. Entries are verbatim from the registry in intents.js; array order is the
   routing cascade, so intents.js concatenates the groups in a fixed order. */
var SYMBOLS = [
  { kind: 'imports', aliases: ['imports'], ground: 'import', helpCmd: '`imports`', needsModel: false,
    route: function (s, lo) { return /\bwhat does\b[\s\S]*\bimport\b|\bimports of\b|\bdependencies of\b|\bwhat (?:do|does)\b[\s\S]*\bdepend on\b/.test(lo) ? { arg: pickPathish(s) } : null; },
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
    route: function (s, lo) { return /\b(imports?|importe(rs|d)?|depend(s|ents?|encies)?|(?:who|what) (imports|uses|depends)|used by|includes)\b/.test(lo) ? { arg: pickPathish(s) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var tf = resolveToFile(arg);
      /* "who uses <symbol>" — the arg names no file but is a known symbol, so the
         user wants references, not importer edges. Answer refs instead of dead-ending. */
      if (!tf && symLookup(arg, idx).length) {
        var rr = localSearchData(arg, 'refs');
        steps.push({ action: 'no file named “' + arg + '”: treat as a symbol', note: rr.hits.length + ' reference' + (rr.hits.length === 1 ? '' : 's') + ' in ' + rr.filesHit + ' file' + (rr.filesHit === 1 ? '' : 's'), evidence: rr.hits.slice(0, 10).map(localEvidence), status: 'done' });
        return { steps: steps, verdict: LOCAL_VERDICT(),
          actions: [{ kind: 'def', command: arg, why: 'jump to where ' + arg + ' is defined' }],
          answer: rr.hits.length
            ? '`' + arg + '` is referenced ' + (rr.hits.length >= rr.cap ? rr.cap + '+' : rr.hits.length) + ' time' + (rr.hits.length === 1 ? '' : 's') + ' across ' + rr.filesHit + ' file' + (rr.filesHit === 1 ? '' : 's') + '. (No loaded file is named `' + arg + '`, so this is a symbol-reference search.) Chips open each at its line.'
            : 'No references to `' + arg + '` in the loaded files.' };
      }
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
          answer: top.length ? matches.length + ' symbol' + (matches.length === 1 ? '' : 's') + ' match `' + arg + '`:\n\n' + top.map(function (mm) { return '- `' + mm.name + '` (' + mm.def.kind + '): `' + mm.def.file + '` line ' + mm.def.line + (mm.n > 1 ? ' (+' + (mm.n - 1) + ' more)' : ''); }).join('\n') : 'No indexed symbol matches `' + arg + '`.' };
      }
      var byFile = Object.create(null);
      idx.symbols.forEach(function (defsArr) { defsArr.forEach(function (d) { byFile[d.file] = (byFile[d.file] || 0) + 1; }); });
      var topFiles = Object.keys(byFile).sort(function (a, b) { return byFile[b] - byFile[a]; }).slice(0, 8);
      steps.push({ action: 'summarize the symbol index', note: idx.symbolCount + ' definitions · ' + idx.symbols.size + ' unique names', evidence: topFiles.map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: 'The index holds **' + idx.symbolCount + ' symbol definitions** (' + idx.symbols.size + ' unique names). Densest files:\n\n' + topFiles.map(function (p) { return '- `' + p + '`: ' + byFile[p] + ' symbols'; }).join('\n') + '\n\nAsk `symbols <name>` to find a specific one.' };
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
      var actions = defs.length ? [{ kind: 'refs', command: arg, why: 'list every reference to ' + arg }]
        : [{ kind: 'search', command: arg, why: 'plain text search for ' + arg + ' (finds it in docs, comments and code blocks too)' }];
      var ans = defs.length
        ? '`' + arg + '` is defined in ' + defs.length + ' place' + (defs.length === 1 ? '' : 's') + ':\n\n' + defs.slice(0, 8).map(function (d) { return '- `' + d.file + '` line ' + d.line + ' (' + d.kind + ')'; }).join('\n') + '\n\nEvidence chips open each definition at its exact line.'
        : 'No indexed definition named `' + arg + '`. It may be external, generated at runtime, spelled differently, or only written in a doc or code sample the index does not read. '
          + (refs.hits.length ? 'The name does appear in ' + plural(refs.filesHit, 'file') + ' (see the reference scan above).'
            : refs.aborted || refs.timedOut ? 'The reference scan stopped early on this large project, so it may still appear.' : 'The name does not appear as a whole word in any loaded file.')
          + ' Run the text search below to look for it anywhere.';
      return { steps: steps, verdict: LOCAL_VERDICT(), actions: actions, answer: ans };
    } },
];
export { SYMBOLS };
