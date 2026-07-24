import { st } from './state.js';
import { getIndex } from './indexer.js';
/* ============ DRIFT WATCH (SESSION-OVER-SESSION) ============
   Compares this session's project index against a fingerprint stored the last
   time the same project was loaded. Fingerprints are METADATA ONLY — paths and
   counts, never file contents — kept in a dedicated IndexedDB database
   ('meridian-drift', separate from project memory so renderProjects() and the
   drift store never mix, and no module cycle forms: this file imports only
   state + indexer). Projects are identified by their top-level folder name —
   disclosed in every drift answer. This is session-over-session comparison,
   not continuous monitoring; the copy everywhere says so.                    */

st.driftSig = null;     /* project signature whose baseline this session holds */
st.driftPrev = null;    /* the snapshot that existed when this project was first loaded this session */
st.driftPending = false; /* true while the last session's snapshot is still being read from IndexedDB */

var ddb = null;
function driftOpen() {
  return new Promise(function (resolve, reject) {
    if (ddb) return resolve(ddb);
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    var req = indexedDB.open('meridian-drift', 1);
    req.onupgradeneeded = function () { req.result.createObjectStore('snapshots', { keyPath: 'sig' }); };
    req.onsuccess = function () { ddb = req.result; resolve(ddb); };
    req.onerror = function () { reject(req.error); };
  });
}
function driftGet(sig) {
  return driftOpen().then(function (db) {
    return new Promise(function (res, rej) {
      var rq = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(sig);
      rq.onsuccess = function () { res(rq.result || null); };
      rq.onerror = function () { rej(rq.error); };
    });
  });
}
function driftPut(rec) {
  return driftOpen().then(function (db) {
    return new Promise(function (res, rej) {
      var tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put(rec);
      tx.oncomplete = res;
      tx.onerror = tx.onabort = function () { rej(tx.error || new Error('write failed')); };
    });
  });
}

/* same identity logic as memory.js's guessProjectName — duplicated (three lines)
   rather than imported, because importing memory.js from here would create the
   cycle memory → ingest → local → intents → drift → memory */
function projectSig() {
  var it = st.files.keys().next();
  if (it.done) return 'project';
  var p = it.value;
  return p.indexOf('/') !== -1 ? p.slice(0, p.indexOf('/')) : 'project';
}

/* compact metadata fingerprint: path → [tokens, symbolCount] plus totals */
function makeFingerprint(idx) {
  var files = Object.create(null); /* keyed by project paths — no prototype collisions */
  st.files.forEach(function (f, p) { files[p] = [f.tokens, idx.symCountByFile[p] || 0]; });
  return { sig: projectSig(), ts: Date.now(), fileCount: idx.fileCount, symbolCount: idx.symbolCount, importCount: idx.importCount, files: files };
}

/* called after every ingest: capture the previous session's snapshot (once per
   project per session — get-then-put so it is read before being overwritten),
   then store the current one. All failures are silent: drift degrades to the
   honest "baseline recorded" answer. */
function recordSession() {
  if (!st.files.size || !window.indexedDB) return;
  var sig = projectSig(), cur;
  try { cur = makeFingerprint(getIndex()); } catch (e) { return; }
  if (st.driftSig !== sig) {
    st.driftSig = sig; st.driftPrev = null; st.driftPending = true;
    driftGet(sig)
      .then(function (rec) { st.driftPrev = rec || null; st.driftPending = false; return driftPut(cur); })
      .catch(function () { st.driftPending = false; });
  } else {
    driftPut(cur).catch(function () {});
  }
}

export { makeFingerprint, projectSig, recordSession };
