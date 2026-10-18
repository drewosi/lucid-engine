import { sortedPaths, st } from './state.js';
import { dirOf, fileExt } from './indexer.js';
import { fmtTok } from './helpers.js';
import { evAt, resolveToFile, pickPathish, LOCAL_VERDICT, isCodeFile, listDupes, plural } from './intents-core.js';
/* ============ INTENTS: INVENTORY ============
   exports, hotspots, todos, env, dupes, listType, related. Entries are verbatim from the registry in intents.js; array order is the
   routing cascade, so intents.js concatenates the groups in a fixed order. */
var INVENTORY = [
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
            ? '`' + tf + '` (' + (tfLang === 'python' ? 'Python' : 'Ruby') + ': no export keyword) has ' + plural(pub.length, 'module-level definition') + ' as its public surface (underscore-prefixed names excluded):\n\n' + pub.map(function (x) { return '- `' + x.name + '` (' + x.kind + '): line ' + x.line; }).join('\n')
            : 'No module-level definitions found in `' + tf + '`.' };
      }
      steps.push({ action: 'read exported symbols from the index', note: plural(list.length, 'export'), evidence: list.slice(0, 12).map(function (x) { return evAt(tf, x.line); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: list.length
          ? '`' + tf + '` exports ' + plural(list.length, 'symbol') + ':\n\n' + list.slice(0, 20).map(function (x) { return '- `' + x.name + '` (' + x.kind + '): line ' + x.line; }).join('\n')
          : 'No exports recorded for `' + tf + '`. Tracking covers JS/TS (`export`, `module.exports`), Rust (`pub`), Go (uppercase initials), Java/C# (`public`), and Kotlin (non-private/internal declarations), or the file genuinely exports nothing.' };
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
          ? 'Hotspots: the files where change is most expensive (size + symbol density + fan-in):\n\n' + top.map(function (r, i) { return (i + 1) + '. `' + r.p + '`: ≈' + fmtTok(r.tok) + ' tokens · ' + plural(r.symN, 'symbol') + ' · ' + plural(r.fanIn, 'importer'); }).join('\n')
          : 'No code files loaded to rank.' };
    } },

  { kind: 'todos', aliases: ['todos'], ground: 'todo', helpCmd: '`todos`', needsModel: false,
    route: function (s, lo) { return /\b(todos?|fixmes?|hacks?|tech(nical)? debt)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var byTag = Object.create(null);
      idx.todos.forEach(function (t) { byTag[t.tag] = (byTag[t.tag] || 0) + 1; });
      var tagNote = Object.keys(byTag).map(function (t) { return t + ' ' + byTag[t]; }).join(' · ');
      steps.push({ action: 'read TODO/FIXME/HACK/XXX tags from the index', note: idx.todos.length ? plural(idx.todos.length, 'tag') + (idx.todos.length >= 500 ? ' (capped)' : '') + ' · ' + tagNote : 'none found', evidence: idx.todos.slice(0, 12).map(function (t) { return evAt(t.file, t.line); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: idx.todos.length
          ? plural(idx.todos.length, 'debt tag') + ' (' + tagNote + '):\n\n' + idx.todos.slice(0, 15).map(function (t) { return '- `' + t.file + '` line ' + t.line + ': **' + t.tag + '**'; }).join('\n') + '\n\nChips open each tag at its line.'
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
          ? plural(names.length, 'environment variable') + ' read by the code: the project\'s implicit configuration surface:\n\n' + names.slice(0, 20).map(function (n) { return '- `' + n.name + '`: ' + plural(n.refs.length, 'read') + ', first at `' + n.refs[0].file + '` line ' + n.refs[0].line; }).join('\n')
          : 'No environment-variable reads detected (patterns: `process.env`, `import.meta.env`, `os.environ`/`getenv`, `os.Getenv`, `env::var`, `ENV[…]`).' };
    } },

  /* before `symbols`: "duplicate symbols" would otherwise match its symbol- regex */
  { kind: 'dupes', aliases: ['dupes', 'duplicates'], ground: 'duplicate-symbol', helpCmd: '`dupes`', needsModel: false,
    route: function (s, lo) { return /\b(duplicate|colliding|shadow(ed|ing)?)\b[\s\S]*\b(symbols?|names?|definitions?|functions?|classes)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var dupes = listDupes(idx);
      var top = dupes.slice(0, 15), evs = [];
      top.forEach(function (d) { d.defs.slice(0, 2).forEach(function (x) { if (evs.length < 12) evs.push(evAt(x.file, x.line)); }); });
      steps.push({ action: 'scan the symbol index for top-level functions, classes and types defined in multiple files', note: plural(dupes.length, 'duplicated name'), evidence: evs, status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: dupes.length
          ? plural(dupes.length, 'top-level function, class or type name') + ' (≥4 chars) defined in more than one file: a helper may have been rewritten instead of reused:\n\n' + top.map(function (d) { return '- `' + d.name + '`: ' + d.defs.map(function (x) { return '`' + x.file + '` line ' + x.line; }).join(', '); }).join('\n')
            + '\n\nCounted: top-level functions, classes, types, and variables that hold a function or class. Not counted: local variables, methods, test files, and entry-point names like `main`.'
          : 'No top-level function, class or type name (≥4 chars) is defined in more than one file. Local variables, methods and test files are not counted.' };
    } },

  { kind: 'listType', aliases: [], ground: 'file', helpCmd: '', needsModel: false,
    route: function (s, lo) { return /\b(list|show|all)\b/.test(lo) && /\b(files?)\b/.test(lo) && /\b([a-z]{1,6})\b\s+files?\b/.test(lo) ? { arg: s } : null; },
    run: function (arg, q) {
      var steps = [];
      var em = q.toLowerCase().match(/\b(typescript|javascript|python|golang|go|rust|java|ruby|markdown|html|css|json|yaml|c\+\+|c#|[a-z]{1,6})\s+files?\b/);
      var alias = { typescript: 'ts', javascript: 'js', python: 'py', golang: 'go', rust: 'rs', java: 'java', ruby: 'rb', markdown: 'md', 'c++': 'cpp', 'c#': 'cs' };
      var want = em ? (alias[em[1]] || em[1]) : '';
      /* "list all files" / "show the files" — the captured word is a determiner, not
         an extension; list every loaded path instead of filtering by a bogus ext */
      var DETERMINER = { all: 1, every: 1, the: 1, these: 1, those: 1, any: 1, my: 1, our: 1, your: 1 };
      if (!want || DETERMINER[want]) {
        var everything = sortedPaths();
        steps.push({ action: 'list all loaded files', note: everything.length + ' file' + (everything.length === 1 ? '' : 's'), evidence: everything.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
        return { steps: steps, verdict: LOCAL_VERDICT(),
          answer: everything.length
            ? everything.length + ' file' + (everything.length === 1 ? '' : 's') + ' loaded:\n\n' + everything.slice(0, 40).map(function (p) { return '- `' + p + '`'; }).join('\n') + (everything.length > 40 ? '\n\n… +' + (everything.length - 40) + ' more.' : '')
            : 'No files loaded.' };
      }
      var matched = sortedPaths().filter(function (p) { return fileExt(p) === want; });
      steps.push({ action: 'filter files by extension “' + want + '”', note: matched.length + ' file' + (matched.length === 1 ? '' : 's'), evidence: matched.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(), answer: matched.length ? matched.length + ' `.' + want + '` file' + (matched.length === 1 ? '' : 's') + ':\n\n' + matched.slice(0, 25).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No `.' + want + '` files loaded.' };
    } },

  { kind: 'related', aliases: ['related'], ground: 'related', helpCmd: '`related`', needsModel: false,
    route: function (s, lo) { return /\brelated (to|files?)\b|\bfiles related\b|\bconnected to\b|\bassociated with\b|\bneighbou?rs of\b/.test(lo) ? { arg: pickPathish(s) } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var rf = resolveToFile(arg);
      steps.push({ action: 'resolve “' + arg + '” to a file', note: rf || 'unresolved', evidence: [], status: 'done' });
      var rel = Object.create(null);
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
        : relList.length ? 'Files related to `' + rf + '`:\n\n' + relList.map(function (p) { return '- `' + p + '`: ' + rel[p]; }).join('\n')
        : 'No related files found for `' + rf + '` (no import edges, no directory siblings, no name matches).';
      return { steps: steps, verdict: LOCAL_VERDICT(), answer: rans };
    } },
];
export { INVENTORY };
