import { st } from './state.js';
import { setStatus } from './helpers.js';
import { buildIndexCore } from './index-core.js';
/* ============ BACKGROUND INDEXING ============
   Large projects index in a Web Worker so the page stays responsive: progress in
   the status bar, a cancel command, and a usable PARTIAL index for LOCAL asks while
   it runs. Everything degrades to the synchronous regex path in indexer.js when
   Workers are unavailable, the worker fails, or the project is small.

   Invariants:
   - one job at a time; a content change (invalidateAll) kills it, and stale results
     are never applied (job.files must still be st.files and the index still dirty)
   - a partial index is flagged `partial: true` and LOCAL answers say so
   - cancel keeps the last partial index for that file set; it never leaves asks
     blocked on a rebuild the user just refused                                    */

var WORKER_MIN_FILES = 300;           /* below this the sync pass is instant */
var job = null;                       /* {id, files, worker, done, total, partial} */
var kept = null;                      /* {files, index}: partial kept after a cancel */
var nextId = 1;
var lastError = '';
var stats = { runs: 0, workerRuns: 0, cancelled: 0, fallbacks: 0, lastMs: 0, lastMode: 'none' };

function workersOk() {
  if (typeof Worker === 'undefined') return false;
  try { if (new URLSearchParams(location.search).get('noworker') === '1') return false; } catch (e) {}
  return !st.noWorker;
}

function emit(name, detail) { try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }

function stopWorker(j) { if (j && j.worker) { try { j.worker.terminate(); } catch (e) {} j.worker = null; } }

/* content changed: whatever is running (or kept) describes files that no longer exist */
function invalidate() {
  if (job) { stopWorker(job); job = null; emit('meridian:index-progress', { done: 1, total: 1 }); }
  kept = null;
}
st.onInvalidate = invalidate;

function progressText(j) {
  var pct = j.total ? Math.floor(j.done * 100 / j.total) : 0;
  return 'INDEXING ' + j.done + '/' + j.total + ' files (' + pct + '%) · background · cancel from the palette';
}

function startBackgroundIndex(force) {
  if (job || !st.indexDirty || !st.files.size) return false;
  if (!force && st.files.size < WORKER_MIN_FILES) return false;
  if (!workersOk()) return false;
  var files = st.files, w;
  try { w = new Worker(new URL('./index-worker.js', import.meta.url), { type: 'module' }); }
  catch (e) { lastError = 'worker start: ' + e.message; stats.fallbacks++; return false; }
  var me = job = { id: nextId++, files: files, worker: w, done: 0, total: files.size, partial: null, t0: Date.now() };
  stats.runs++;
  var payload = []; files.forEach(function (f, p) { payload.push([p, f.content]); });
  w.onmessage = function (e) {
    var m = e.data;
    if (job !== me || m.job !== me.id) return;
    if (m.type === 'progress') { me.done = m.done; me.total = m.total; setStatus(progressText(me)); emit('meridian:index-progress', { done: m.done, total: m.total }); }
    else if (m.type === 'snapshot') { me.partial = m.index; }
    else if (m.type === 'done') finish(me, m.index);
    else if (m.type === 'error') fail(me, m.message);
  };
  w.onerror = function (e) { if (job === me) fail(me, (e && e.message) || 'worker crashed'); };
  w.postMessage({ type: 'build', job: me.id, files: payload });
  setStatus(progressText(me));
  emit('meridian:index-progress', { done: 0, total: me.total });
  return true;
}

function finish(me, index) {
  stopWorker(me); job = null;
  emit('meridian:index-progress', { done: 1, total: 1 });
  if (st.files !== me.files || !st.indexDirty) return; /* superseded while running */
  st.projectIndex = index; st.indexDirty = false; kept = null;
  stats.workerRuns++; stats.lastMs = Date.now() - me.t0; stats.lastMode = 'worker';
  setStatus('IDLE: ' + st.files.size + ' files in memory');
  emit('meridian:index-ready', { files: index.fileCount });
}

/* worker failed: drop to the synchronous path on next demand */
function fail(me, message) {
  stopWorker(me); job = null; lastError = message; stats.fallbacks++; st.noWorker = true;
  setStatus('INDEXING: worker unavailable, using the in-page indexer…');
  emit('meridian:index-progress', { done: 1, total: 1 });
  emit('meridian:index-failed', { message: message });
}

function cancelIndexing() {
  if (!job) return false;
  var me = job;
  kept = { files: me.files, index: me.partial || emptyPartial(me.files) };
  stopWorker(me); job = null; stats.cancelled++;
  setStatus('INDEXING CANCELLED: LOCAL answers use a partial index (' + kept.index.scanned + '/' + kept.index.fileCount + ' files)');
  emit('meridian:index-progress', { done: 1, total: 1, cancelled: true });
  return true;
}

function emptyPartial(files) {
  var ix = buildIndexCore(new Map(), {});
  ix.fileCount = files.size; ix.scanned = 0; ix.partial = true;
  return ix;
}

/* the index to answer from while the real one isn't ready, or null if the caller
   should build synchronously (no job, no kept partial) */
function partialIndex() {
  if (job && job.files === st.files) return job.partial || (job.partial = emptyPartial(job.files));
  if (kept && kept.files === st.files) return kept.index;
  return null;
}

function indexingState() { return job ? { running: true, done: job.done, total: job.total } : { running: false }; }
function recordSyncRun(ms) { stats.runs++; stats.lastMs = ms; stats.lastMode = 'sync'; }
function indexRunInfo() { return { stats: Object.assign({}, stats), lastError: lastError, workerCapable: workersOk() }; }

export { WORKER_MIN_FILES, cancelIndexing, indexRunInfo, indexingState, partialIndex, recordSyncRun, startBackgroundIndex };
