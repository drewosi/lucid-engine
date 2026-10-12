import { buildIndex, getIndex } from './indexer.js';
import { buildIndexCore } from './index-core.js';
import { cancelIndexing, indexingState, partialIndex, startBackgroundIndex } from './index-run.js';
import { runInvestigation } from './intents.js';
import { invalidateAll, st } from './state.js';
/* ============ SELF-TESTS: BACKGROUND INDEXING ============
   Worker progressive indexing: parity with the synchronous pass, progress,
   partial-index asks, cancel, stale-result rejection, no-Worker fallback and the
   responsiveness of the page while ~10k files index. Scratch state only. */

function synthProject(n) {
  var m = new Map();
  for (var i = 0; i < n; i++) {
    var dir = 'pkg' + Math.floor(i / 50), p = dir + '/f' + i + '.js';
    var prev = i % 50 !== 0 ? "import { fn" + (i - 1) + " } from './f" + (i - 1) + ".js';\n" : '';
    var content = prev + 'export function fn' + i + '() { return ' + i + '; }\n// TODO: tidy ' + i + '\n';
    m.set(p, { content: content, lines: 3, tokens: 20, mtime: 0, base: 1, checked: true });
  }
  return m;
}
function waitFor(evName, ms) {
  return new Promise(function (res) {
    var done = false;
    function on(e) { if (done) return; done = true; clearTimeout(t); document.removeEventListener(evName, on); res(e); }
    var t = setTimeout(function () { if (done) return; done = true; document.removeEventListener(evName, on); res(null); }, ms);
    document.addEventListener(evName, on);
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function shape(ix) {
  return { f: ix.fileCount, s: ix.symbolCount, i: ix.importCount, t: ix.todos.length, e: ix.entries.length, sn: ix.symbols.size, ib: ix.importedBy.size };
}

async function indexCases(ok) {
  var keep = { files: st.files, idx: st.projectIndex, dirty: st.indexDirty, noWorker: st.noWorker };
  var progress = [];
  function onProg(e) { progress.push(e.detail); }
  document.addEventListener('meridian:index-progress', onProg);
  try {
    /* the core is pure: same input, same index, whether or not a worker is involved */
    var small = synthProject(30);
    var a = buildIndexCore(small, {}), b = buildIndexCore(small, {});
    ok('index core · deterministic and DOM-free (pure function of its files)', JSON.stringify(shape(a)) === JSON.stringify(shape(b)) && a.partial === false && a.fileCount === 30, JSON.stringify(shape(a)));
    ok('index core · cancel hook aborts the pass (returns null)', buildIndexCore(synthProject(250), { shouldCancel: function () { return true; } }) === null);
    var snaps = [];
    buildIndexCore(synthProject(1000), { firstSnapshot: 100, onSnapshot: function (s) { snaps.push(s); } });
    ok('index core · partial snapshots at doubling checkpoints, flagged partial', snaps.length >= 2 && snaps.every(function (s) { return s.partial === true && s.scanned < s.fileCount; }) && snaps[1].scanned > snaps[0].scanned, snaps.map(function (s) { return s.scanned; }).join(','));

    /* worker run: parity, progress, flags */
    st.files = synthProject(600); invalidateAll(); st.noWorker = false;
    var sync = buildIndex(); st.indexDirty = true; st.projectIndex = null;
    progress.length = 0;
    var started = startBackgroundIndex();
    ok('worker · starts for a large project', started === true && indexingState().running === true);
    var firstAsk = getIndex();
    ok('worker · asks during the run get a flagged partial index without blocking', firstAsk.partial === true && firstAsk.fileCount === 600 && st.indexDirty === true, 'scanned ' + firstAsk.scanned);
    var ans = runInvestigation('todos', { kind: 'todos', arg: '' });
    ok('worker · LOCAL answers from a partial index say so', ans && /Partial index/.test(ans.answer || ''), (ans && ans.answer || '').slice(-120));
    var ready = await waitFor('meridian:index-ready', 20000);
    ok('worker · finishes and installs a complete, clean index', !!ready && st.indexDirty === false && st.projectIndex && st.projectIndex.partial === false);
    ok('worker · result matches the synchronous pass exactly', !!st.projectIndex && JSON.stringify(shape(st.projectIndex)) === JSON.stringify(shape(sync)), JSON.stringify(st.projectIndex && shape(st.projectIndex)) + ' vs ' + JSON.stringify(shape(sync)));
    ok('worker · progress events end at completion', progress.length >= 2 && progress[progress.length - 1].done === progress[progress.length - 1].total, progress.length + ' events');
    ok('worker · import edges survive the structured clone (Map of arrays)', st.projectIndex.importedBy instanceof Map && st.projectIndex.importedBy.size > 500 && st.projectIndex.importedBy.size === sync.importedBy.size);

    /* cancel keeps a partial, never blocks, and resets on content change */
    st.files = synthProject(600); invalidateAll();
    startBackgroundIndex();
    var cancelled = cancelIndexing();
    var afterCancel = getIndex();
    ok('cancel · stops the run and keeps asks answerable from a partial index', cancelled === true && indexingState().running === false && afterCancel.partial === true && st.indexDirty === true);
    ok('cancel · cancelling with nothing running is a no-op', cancelIndexing() === false);
    invalidateAll();
    ok('cancel · a content change discards the kept partial', partialIndex() === null);

    /* stale results are never applied */
    st.files = synthProject(600); invalidateAll();
    startBackgroundIndex();
    st.files = synthProject(310); invalidateAll(); st.projectIndex = null;
    await sleep(600);
    ok('stale · a result for replaced files is dropped', st.indexDirty === true && st.projectIndex === null && indexingState().running === false);

    /* graceful degradation: no worker -> synchronous regex path, same answers */
    st.files = synthProject(600); invalidateAll(); st.noWorker = true;
    ok('fallback · noWorker flag declines to start a worker', startBackgroundIndex() === false);
    var fb = getIndex();
    ok('fallback · synchronous pass builds a full, non-partial index', fb.partial === false && fb.fileCount === 600 && st.indexDirty === false);
    st.noWorker = false;

    /* small projects never pay for a worker */
    st.files = synthProject(40); invalidateAll();
    ok('worker · skipped below the size threshold', startBackgroundIndex() === false);

    /* ~10k files: the page keeps ticking while the worker indexes */
    st.files = synthProject(10000); invalidateAll();
    var ticks = [], last = performance.now(), timer = setInterval(function () { var n = performance.now(); ticks.push(n - last); last = n; }, 20);
    var t0 = performance.now();
    startBackgroundIndex();
    var startCost = performance.now() - t0;
    var done10k = await waitFor('meridian:index-ready', 60000);
    clearInterval(timer);
    var worst = Math.max.apply(null, ticks.length ? ticks : [0]);
    ok('10k files · worker completes with a full index', !!done10k && st.projectIndex && st.projectIndex.fileCount === 10000 && st.projectIndex.symbolCount === 10000, 'symbols ' + (st.projectIndex && st.projectIndex.symbolCount));
    ok('10k files · main thread stays responsive (handing off < 1s, worst gap < 500ms)', startCost < 1000 && worst < 500, 'handoff ' + Math.round(startCost) + 'ms · worst tick gap ' + Math.round(worst) + 'ms');
  } finally {
    document.removeEventListener('meridian:index-progress', onProg);
    cancelIndexing();
    st.files = keep.files; st.projectIndex = keep.idx; st.indexDirty = keep.dirty; st.noWorker = keep.noWorker;
    invalidateAll(); st.projectIndex = keep.idx; st.indexDirty = keep.dirty;
  }
}
export { indexCases };
