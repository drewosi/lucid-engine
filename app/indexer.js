import { st } from './state.js';
import { setStatus } from './helpers.js';
import { partialIndex, recordSyncRun } from './index-run.js';
import { buildIndexCore, detectLang, dirOf, fileExt } from './index-core.js';
/* ============ PROJECT INTELLIGENCE INDEX ============
   A deterministic, structured understanding of the loaded project, built in one
   pass over the in-memory files: symbol definitions, import/importer edges, and
   file classifications (entries, tests, configs, docs). This is the foundation the
   LOCAL engine's investigations read — Meridian understands the terrain before a
   model enters the room. Rebuilt lazily; invalidated (indexDirty) wherever the
   loaded/checked set changes. The scan itself lives in index-core.js.            */

st.indexDirty = true; st.projectIndex = null;

function buildIndex() {
  var big = st.files.size > 1500;
  return buildIndexCore(st.files, big ? { onProgress: function (d, t) { if (d % 500 === 0) setStatus('INDEXING SYMBOLS: ' + d + '/' + t + ' files…'); } } : {});
}

function getIndex() {
  if (!st.indexDirty && st.projectIndex) return st.projectIndex;
  /* a worker run (or a cancelled one) may already hold a usable partial index:
     answer from it rather than block the page on a synchronous rebuild */
  var part = partialIndex();
  if (part) return part;
  setStatus('INDEXING: reading project structure…');
  var t0 = Date.now();
  st.projectIndex = buildIndex();
  recordSyncRun(Date.now() - t0);
  st.indexDirty = false;
  setStatus('IDLE: ' + st.files.size + ' files in memory');
  return st.projectIndex;
}

export { buildIndex, detectLang, dirOf, fileExt, getIndex };
