import { st } from './state.js';
import { IGNORE_DIRS, afterIngest, getIgnoreText, ingestFile, recordSkip, setCtxMode, setIgnoreText, syncBudgetState } from './ingest.js';
import { $, fmtTok, lsDel, lsGet, lsSet, setStatus, toast } from './helpers.js';
import { LS } from './config.js';
/* ============ PROJECT MEMORY (IndexedDB) ============
   Saves named projects: selection, ignore patterns and context prefs —
   NEVER file contents. When the folder was opened through
   showDirectoryPicker() the directory handle itself is persisted too, so a
   saved project can be reloaded from disk in one click (after the browser
   re-confirms read permission). Drag-dropped projects restore settings only
   and ask you to re-drop the folder to hydrate contents.                   */

st.lastDirHandle = null;   /* set when the current project came from showDirectoryPicker */
st.pendingProject = null;  /* saved record waiting for its files to arrive */

var idb = null;
function idbOpen() {
  return new Promise(function (resolve, reject) {
    if (idb) return resolve(idb);
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    var req = indexedDB.open('meridian', 1);
    req.onupgradeneeded = function () { req.result.createObjectStore('projects', { keyPath: 'name' }); };
    req.onsuccess = function () { idb = req.result; resolve(idb); };
    req.onerror = function () { reject(req.error); };
  });
}
function idbPut(rec) {
  return idbOpen().then(function (db) {
    return new Promise(function (res, rej) {
      var tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(rec);
      tx.oncomplete = res;
      tx.onerror = tx.onabort = function () { rej(tx.error || new Error('write failed')); };
    });
  });
}
function idbAll() {
  return idbOpen().then(function (db) {
    return new Promise(function (res, rej) {
      var rq = db.transaction('projects', 'readonly').objectStore('projects').getAll();
      rq.onsuccess = function () { res(rq.result || []); };
      rq.onerror = function () { rej(rq.error); };
    });
  });
}
function idbDel(name) {
  return idbOpen().then(function (db) {
    return new Promise(function (res, rej) {
      var tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').delete(name);
      tx.oncomplete = res;
      tx.onerror = function () { rej(tx.error); };
    });
  });
}

/* re-read a directory handle's contents (File System Access API, Chromium) */
function walkHandle(dir, prefix) {
  if (!dir.values) return Promise.resolve();
  return (async function () {
    var jobs = [];
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        jobs.push((function (path) {
          return entry.getFile().then(function (f) { return ingestFile(f, path); }).catch(function (e) {
            /* getFile() failure (permissions, file vanished) is NOT binary —
               record it so the review modal shows it */
            console.warn('meridian: could not read', path, e);
            st.skipped.readerr++;
            recordSkip(path, 'read-error', 0, null);
          });
        })(prefix + entry.name));
      } else if (entry.kind === 'directory') {
        if (IGNORE_DIRS.indexOf(entry.name.toLowerCase()) !== -1 || (entry.name.charAt(0) === '.' && entry.name !== '.github')) { st.skipped.dirs++; continue; }
        jobs.push(walkHandle(entry, prefix + entry.name + '/'));
      }
    }
    return Promise.all(jobs);
  })();
}

function guessProjectName() {
  var it = st.files.keys().next();
  if (it.done) return 'project';
  var p = it.value;
  return p.indexOf('/') !== -1 ? p.slice(0, p.indexOf('/')) : 'project';
}

function applyPendingProject() {
  if (!st.pendingProject) return;
  var un = st.pendingProject.unchecked || [];
  un.forEach(function (p) { var f = st.files.get(p); if (f) f.checked = false; });
  st.pendingProject = null;
  $('projnote').hidden = true;
}

function applyProjectPrefs(rec) {
  if (rec.prefs) {
    if (rec.prefs.budget) lsSet(LS.ctxbudget, String(rec.prefs.budget)); else lsDel(LS.ctxbudget);
    setCtxMode(rec.prefs.ctxmode === 'smart' ? 'smart' : 'full');
    syncBudgetState();
  }
  setIgnoreText(rec.ignore || '');
}

function loadProject(rec) {
  applyProjectPrefs(rec);
  st.pendingProject = rec;
  if (rec.handle && rec.handle.queryPermission) {
    rec.handle.queryPermission({ mode: 'read' }).then(function (perm) {
      return perm === 'granted' ? perm : rec.handle.requestPermission({ mode: 'read' });
    }).then(function (perm) {
      if (perm !== 'granted') { toast('Read permission declined — drop the folder instead.'); return; }
      st.files.clear(); st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0, readerr: 0, memcap: 0 };
      st.totalBytes = 0;
      st.skippedFiles.length = 0;
      st.lastDirHandle = rec.handle;
      setStatus('RELOADING “' + rec.name + '”…');
      return walkHandle(rec.handle, rec.handle.name + '/').then(afterIngest);
    }).catch(function (e) {
      /* stale handle — folder moved/deleted since it was saved */
      var gone = e && (e.name === 'NotFoundError' || /not found|no longer exists|GONE/i.test(e.message || ''));
      if (gone && st.lastDirHandle === rec.handle) st.lastDirHandle = null;
      var note = $('projnote'); note.hidden = false;
      note.textContent = '// “' + rec.name + '”: settings restored. ' + (gone ? 'the saved folder was not found — it may have moved. ' : '') + 'drop the folder to reload its files.';
      toast(gone ? '“' + rec.name + '” folder not found — drop it again to reload.' : 'Reload failed: ' + ((e && e.message) || 'unknown error') + ' — drop the folder instead.');
    });
  } else {
    var note = $('projnote');
    note.hidden = false;
    note.textContent = '// “' + rec.name + '”: settings + selection restored. drop the folder (or pick it) to reload its files — contents are never stored.';
    toast('“' + rec.name + '” restored — re-drop the folder to hydrate files.');
  }
}

function renderProjects() {
  idbAll().then(function (recs) {
    recs.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
    var shelf = $('projshelf'), list = $('projlist');
    shelf.hidden = !recs.length && !st.files.size;
    $('projcount').textContent = recs.length ? recs.length + ' SAVED' : '';
    list.innerHTML = '';
    recs.forEach(function (rec) {
      var row = document.createElement('div');
      row.className = 'proj-row';
      var pn = document.createElement('button');
      pn.type = 'button'; pn.className = 'pn';
      pn.textContent = rec.name + (rec.handle ? ' ⟳' : '');
      pn.title = rec.handle ? 'Reload from disk (one click)' : 'Restore settings; re-drop folder for contents';
      pn.addEventListener('click', function () { loadProject(rec); });
      var pm = document.createElement('span');
      pm.className = 'pm';
      pm.textContent = rec.fileCount + 'f · ' + fmtTok(rec.totalTokens || 0) + ' · ' + new Date(rec.savedAt).toISOString().slice(0, 10);
      var px = document.createElement('button');
      px.type = 'button'; px.className = 'px'; px.textContent = '✕';
      px.setAttribute('aria-label', 'Delete saved project ' + rec.name);
      px.addEventListener('click', function () {
        idbDel(rec.name).then(renderProjects);
        toast('“' + rec.name + '” deleted from saved projects.');
      });
      row.appendChild(pn); row.appendChild(pm); row.appendChild(px);
      list.appendChild(row);
    });
  }).catch(function () { $('projshelf').hidden = !st.files.size; });
}

function initMemory() {
  $('saveproj').addEventListener('click', function () {
    if (!st.files.size) { toast('Load a project first.'); return; }
    var name = window.prompt('Save project as:', guessProjectName());
    if (name === null) return;
    name = name.trim().slice(0, 60) || 'project';
    /* older records also carried a full per-file `tree` array — it was never
       read back, so it is no longer written (old records still load fine) */
    var unchecked = [], total = 0;
    st.files.forEach(function (f, p) {
      total += f.tokens;
      if (!f.checked) unchecked.push(p);
    });
    var rec = {
      name: name, savedAt: Date.now(), fileCount: st.files.size, totalTokens: total,
      unchecked: unchecked, ignore: getIgnoreText(),
      prefs: { ctxmode: st.ctxMode, budget: parseInt(lsGet(LS.ctxbudget), 10) || 0 },
      handle: st.lastDirHandle || null
    };
    idbPut(rec).then(function () {
      toast(rec.handle
        ? '“' + name + '” saved — one-click reload enabled (selection + settings only, never contents).'
        : '“' + name + '” saved — settings + selection only; ' + (window.showDirectoryPicker ? 'open via [ PICK FOLDER ] to enable one-click reload.' : 'this browser can’t re-open folders — re-drop to reload.'));
      renderProjects();
    }).catch(function (e) {
      /* a handle that cannot be cloned (rare) — retry without it */
      rec.handle = null;
      idbPut(rec).then(function () { toast('“' + name + '” saved (without reload handle).'); renderProjects(); })
        .catch(function () { toast('Save failed: ' + ((e && e.message) || 'IndexedDB unavailable.')); });
    });
  });

  renderProjects();
}

/* full teardown for the settings CLEAR-ALL control: close the connection so the
   browser can actually delete the database */
function wipeMemory() {
  try { if (idb) idb.close(); indexedDB.deleteDatabase('meridian'); } catch (e) {}
  try { indexedDB.deleteDatabase('meridian-drift'); } catch (e) {} /* drift snapshots (drift.js) */
}

export { applyPendingProject, renderProjects, walkHandle, loadProject, initMemory, wipeMemory };
