import { sortedPaths, st } from './state.js';
import { dirOf, getIndex } from './indexer.js';
import { localSearchData, searchLimitNote } from './actions.js';
import { makeFingerprint, projectSig } from './drift.js';
import { isMulti, withFull } from './repos.js';
import { CAP_LOCAL, CAP_MODEL, localEvidence, evAt, LOCAL_VERDICT, localDirData, localRecentData, plural, workspaceRun, localHelp } from './intents-core.js';
/* ============ INTENTS: OVERVIEW ============
   help, workspace, entries, drift, recent, dir, search, structure. Entries are verbatim from the registry in intents.js; array order is the
   routing cascade, so intents.js concatenates the groups in a fixed order. */
var OVERVIEW = [
  { kind: 'help', aliases: ['help'], ground: 'evidence', helpCmd: '', needsModel: false,
    route: null,
    run: function () {
      return { steps: [{ action: 'list capabilities', note: 'local engine reference', evidence: [], status: 'done' }],
        verdict: LOCAL_VERDICT(),
        answer: '**Meridian LOCAL engine**: deterministic project intelligence, no AI, no network.\n\n**Known locally:** ' + CAP_LOCAL.join(' · ') + '.\n**Requires a model:** ' + CAP_MODEL.join(' · ') + '.\n\n**Intentional limits:** the graph analyses (cycles, orphans, hubs, untested, path) read static import edges only: regex extraction per language, lines over 400 chars not indexed: so dynamic loading, DI and bundler wiring are invisible. Each analysis states its own caveats in its answer.\n\n' + localHelp() };
    } },

  /* cross-repo comparison — routes only when 2+ repos are loaded, and always
     reads the whole workspace, whatever the question scope says */
  { kind: 'workspace', aliases: ['workspace', 'repos'], ground: 'workspace', helpCmd: '`workspace`', needsModel: false,
    route: function (s, lo) { return isMulti() && /\b(workspace|repos|repositories|across (all |the |both |my )?(repos|projects)|cross-repo|between (the |both |my )?(repos|projects)|shared (dependencies|deps|packages))\b/.test(lo) ? { arg: '' } : null; },
    run: function () { return withFull(function () { return workspaceRun(getIndex()); }); } },

  { kind: 'entries', aliases: ['entries', 'entrypoints'], ground: 'entry-point', helpCmd: '`entries`', needsModel: false,
    route: function (s, lo) { return /\b(entry ?points?|entrypoints?|main file|entry file)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      steps.push({ action: 'read entry-point classification', note: idx.entries.length + ' entry point' + (idx.entries.length === 1 ? '' : 's'), evidence: idx.entries.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: idx.entries.length ? 'Likely entry points (index/main/app/server/cli/core/lib):\n\n' + idx.entries.slice(0, 20).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No conventional entry-point filenames detected.' };
    } },

  /* before `recent`: "what changed since last session" would otherwise match its
     what-changed regex. Reads only st.driftPrev (loaded at ingest by drift.js) —
     the run itself is synchronous and deterministic. */
  { kind: 'drift', aliases: ['drift'], ground: 'drift', helpCmd: '`drift`', needsModel: false,
    route: function (s, lo) { return /\b(drift(ed)?|what changed since (my |the |your )?last (session|time)|since (my |the )?last session)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [], sig = projectSig();
      if (st.driftPending) {
        steps.push({ action: 'read the last session\'s snapshot', note: 'still loading from IndexedDB', evidence: [], status: 'done' });
        return { steps: steps, verdict: LOCAL_VERDICT(),
          answer: 'Still reading the last session\'s snapshot from disk: ask `drift` again in a moment.' };
      }
      if (!st.driftPrev) {
        steps.push({ action: 'record drift baseline', note: 'paths + counts only, never contents', evidence: [], status: 'done' });
        return { steps: steps, verdict: LOCAL_VERDICT(),
          answer: 'Baseline recorded for `' + sig + '`: no earlier snapshot to compare against. Ask `drift` again in your next session and Meridian will report what changed: new, removed, and reshaped files, from a local metadata fingerprint (paths and counts, never file contents), identified by top-level folder name.' };
      }
      var prev = st.driftPrev, cur = makeFingerprint(idx);
      var added = [], removed = [], reshaped = [];
      /* prev comes back from IndexedDB as a normal-prototype clone — guard key reads */
      var prevHas = function (p) { return Object.prototype.hasOwnProperty.call(prev.files, p); };
      Object.keys(cur.files).forEach(function (p) {
        var a = prevHas(p) ? prev.files[p] : null, b = cur.files[p];
        if (!a) { added.push(p); return; }
        var tokD = b[0] - a[0], symD = b[1] - a[1];
        if (symD !== 0 || Math.abs(tokD) >= Math.max(30, a[0] * 0.1)) reshaped.push({ p: p, tokD: tokD, symD: symD, mag: Math.abs(tokD) + 40 * Math.abs(symD) });
      });
      Object.keys(prev.files).forEach(function (p) { if (prevHas(p) && !cur.files[p]) removed.push(p); });
      reshaped.sort(function (x, y) { return y.mag - x.mag; });
      var topR = reshaped.slice(0, 15);
      steps.push({ action: 'compare the index against the last session\'s snapshot', note: plural(added.length, 'new file') + ' · ' + plural(removed.length, 'removed file') + ' · ' + plural(reshaped.length, 'reshaped file'),
        evidence: added.slice(0, 6).map(function (p) { return evAt(p, 1); }).concat(topR.slice(0, 6).map(function (r) { return evAt(r.p, 1); })), status: 'done' });
      var when = prev.ts ? new Date(prev.ts).toISOString().slice(0, 10) : 'unknown date';
      function delta(n) { return (n >= 0 ? '+' : '') + n; }
      if (!added.length && !removed.length && !reshaped.length) {
        return { steps: steps, verdict: LOCAL_VERDICT(),
          answer: 'No drift: `' + sig + '` matches the snapshot from ' + when + ' (' + prev.fileCount + ' files, ' + prev.symbolCount + ' symbols). Session-over-session comparison from paths and counts only.' };
      }
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: '**Drift since the last session** (`' + sig + '`, vs snapshot from ' + when + '):\n\n'
          + '**Net:** ' + delta(cur.fileCount - prev.fileCount) + ' files · ' + delta(cur.symbolCount - prev.symbolCount) + ' symbols · ' + delta(cur.importCount - prev.importCount) + ' imports\n'
          + (added.length ? '**New:** ' + added.slice(0, 10).map(function (p) { return '`' + p + '`'; }).join(', ') + (added.length > 10 ? ' (+' + (added.length - 10) + ' more)' : '') + '\n' : '')
          + (removed.length ? '**Removed:** ' + removed.slice(0, 10).map(function (p) { return '`' + p + '`'; }).join(', ') + (removed.length > 10 ? ' (+' + (removed.length - 10) + ' more)' : '') + '\n' : '')
          + (topR.length ? '**Reshaped:**\n' + topR.map(function (r) { return '- `' + r.p + '`: ' + delta(r.tokD) + ' tokens, ' + delta(r.symD) + ' symbols'; }).join('\n') + '\n' : '')
          + '\nSession-over-session comparison from a local metadata fingerprint (paths + counts, never contents), keyed by top-level folder name: not continuous monitoring.' };
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
    run: function (arg, q, idx, intent) {
      if (!arg) return { steps: [{ action: 'parse command', note: 'search needs a pattern', evidence: [], status: 'done' }], verdict: LOCAL_VERDICT(), answer: '`search` needs a pattern, e.g. `search cache_control`: quote it (`search "foo bar"`) to match literally.' };
      var steps = [];
      var sr = localSearchData(arg, 'text', null, { literal: !!(intent && intent.literal) });
      var lim = searchLimitNote(sr);
      steps.push({ action: 'search “' + arg + '”', note: sr.hits.length + ' hit' + (sr.hits.length === 1 ? '' : 's') + ' in ' + sr.filesHit + ' file' + (sr.filesHit === 1 ? '' : 's') + (lim ? ' · ' + lim : ''), evidence: sr.hits.slice(0, 12).map(localEvidence), status: 'done' });
      return { steps: steps, verdict: LOCAL_VERDICT(),
        answer: (sr.hits.length ? 'Found ' + (sr.hits.length >= sr.cap ? sr.cap + '+' : sr.hits.length) + ' match' + (sr.hits.length === 1 ? '' : 'es') + ' for `' + arg + '`. Chips open each at its line.' : 'No matches for `' + arg + '`.')
          + (lim ? '\n\nNote: ' + lim + '.' : '') };
    } },

  { kind: 'structure', aliases: ['structure', 'overview'], ground: 'structure', helpCmd: '`structure`', needsModel: false,
    route: function (s, lo) { return /\b(project structure|structure of|overview|directories|packages|project map|top-?level|layout|organi[sz]ation|how is .* organi[sz]ed|what.*directories)\b/.test(lo) ? { arg: '' } : null; },
    run: function (arg, q, idx) {
      var steps = [];
      var paths = sortedPaths(), dirCounts = Object.create(null);
      paths.forEach(function (p) { var d = dirOf(p) || '.'; dirCounts[d] = (dirCounts[d] || 0) + 1; });
      var topDirs = Object.keys(dirCounts).sort(function (a, b) { return dirCounts[b] - dirCounts[a]; }).slice(0, 8);
      var langs = Object.keys(idx.byExt).sort(function (a, b) { return idx.byExt[b] - idx.byExt[a]; }).slice(0, 6);
      steps.push({ action: 'read the project index', note: idx.fileCount + ' files · ' + idx.packages.length + ' packages · ' + idx.symbolCount + ' symbols', evidence: idx.entries.slice(0, 4).map(function (p) { return evAt(p, 1); }), status: 'done' });
      steps.push({ action: 'map directories & languages', note: topDirs.length + ' directories', evidence: idx.packages.slice(0, 4).map(function (pk) { return evAt(pk.manifest, 1); }), status: 'done' });
      var sans = '**Project structure**: ' + idx.fileCount + ' files, ' + idx.symbolCount + ' symbols.\n\n'
        + '**Packages:** ' + (idx.packages.length ? idx.packages.map(function (pk) { return '`' + (pk.name || pk.dir) + '`'; }).join(', ') : 'none detected (no build manifests)') + '\n'
        + '**Entry points:** ' + (idx.entries.length ? idx.entries.map(function (p) { return '`' + p + '`'; }).join(', ') : 'none detected') + '\n'
        + '**Tests:** ' + (idx.tests.length ? idx.tests.length + ' file' + (idx.tests.length === 1 ? '' : 's') : 'none detected') + '\n'
        + '**Top directories:** ' + topDirs.map(function (d) { return '`' + d + '` (' + dirCounts[d] + ')'; }).join(', ') + '\n'
        + '**Languages:** ' + langs.map(function (e) { return e + ' (' + idx.byExt[e] + ')'; }).join(', ');
      return { steps: steps, verdict: LOCAL_VERDICT(), answer: sans };
    } },
];
export { OVERVIEW };
