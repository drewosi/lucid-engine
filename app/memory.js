import { st } from './state.js';
import { IGNORE_DIRS, getIgnoreText, loadHandle, runIngestPool, setCtxMode, setIgnoreText, syncBudgetState } from './ingest.js';
import { $, fmtTok, lsDel, lsGet, lsSet, toast } from './helpers.js';
import { LS } from './config.js';
import { LOOSE, isMulti, repoList, repoOf } from './repos.js';
import { startWorkspaceRestore } from './workspace.js';
/* ============ PROJECT MEMORY (IndexedDB) ============
   Saves named projects: selection, ignore patterns and context prefs —
   NEVER file contents. When the folder was opened through
   showDirectoryPicker() the directory handle itself is persisted too, so a
   saved project can be reloaded from disk in one click (after the browser
   re-confirms read permission). Drag-dropped projects restore settings only
   and ask you to re-drop the folder to hydrate contents.
   A multi-repo workspace saves the same way (kind 'workspace'): repo labels,
   per-repo counts and folder handles, the selection and settings. Reloading
   it asks you to pick each folder again; contents are never stored.        */

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

/* re-read a directory handle's contents (File System Access API, Chromium).
   Collect descriptors first (enumeration is cheap), then read through the
   bounded pool — the same shape as the dropzone walk, so the ingest caps
   stay honest here too. getFile() failures are recorded by the pool. */
function collectHandle(dir, prefix, out) {
  if (!dir.values) return Promise.resolve();
  return (async function () {
    var jobs = [];
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        out.push({ path: prefix + entry.name, getFile: function () { return entry.getFile(); } });
      } else if (entry.kind === 'directory') {
        if (IGNORE_DIRS.indexOf(entry.name.toLowerCase()) !== -1 || (entry.name.charAt(0) === '.' && entry.name !== '.github')) { st.skipped.dirs++; continue; }
        jobs.push(collectHandle(entry, prefix + entry.name + '/', out));
      }
    }
    return Promise.all(jobs);
  })();
}
function walkHandle(dir, prefix) {
  var items = [];
  return collectHandle(dir, prefix, items).then(function () { return runIngestPool(items); });
}

function guessProjectName() {
  if (isMulti()) return repoList().filter(function (r) { return !r.loose; }).map(function (r) { return r.label; }).join(' + ').slice(0, 60) || 'workspace';
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
  if (rec.kind === 'workspace') { startWorkspaceRestore(rec); return; }
  st.pendingProject = rec;
  if (rec.handle && rec.handle.queryPermission) {
    rec.handle.queryPermission({ mode: 'read' }).then(function (perm) {
      return perm === 'granted' ? perm : rec.handle.requestPermission({ mode: 'read' });
    }).then(function (perm) {
      if (perm !== 'granted') {
        /* blocked or forgotten by the browser — leave standing guidance, not just a toast */
        var pn = $('projnote'); pn.hidden = false;
        pn.textContent = '// “' + rec.name + '”: read permission declined — the browser blocked or forgot folder access. click the project again to re-authorize, or drop the folder to reload it.';
        toast('Read permission declined — click the project again to re-authorize, or drop the folder.');
        return;
      }
      /* a full unload, then the folder as the workspace's one repo */
      return loadHandle(rec.handle, 'replace');
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

/* the record a save writes — metadata only: names, counts, the unchecked paths,
   ignore patterns, prefs and folder handles. Never a file's text (pinned by a
   self-test). Several repos loaded → a 'workspace' record with one entry per repo.
   Older records also carried a full per-file `tree` array — it was never read
   back, so it is no longer written (old records still load fine). */
function buildSaveRecord(name) {
  name = String(name || '').trim().slice(0, 60) || 'project';
  var unchecked = [], total = 0;
  st.files.forEach(function (f, p) {
    total += f.tokens;
    if (!f.checked) unchecked.push(p);
  });
  var rec = {
    name: name, savedAt: Date.now(), fileCount: st.files.size, totalTokens: total,
    unchecked: unchecked, ignore: getIgnoreText(),
    prefs: { ctxmode: st.ctxMode, budget: parseInt(lsGet(LS.ctxbudget), 10) || 0 },
    /* the one repo's own handle when the workspace has one (lastDirHandle can
       outlive a repo that was unloaded) */
    handle: (st.repos.length === 1 ? st.repos[0].handle : st.lastDirHandle) || null
  };
  if (isMulti()) {
    var tok = Object.create(null);
    st.files.forEach(function (f, p) { var r = repoOf(p); tok[r] = (tok[r] || 0) + f.tokens; });
    rec.kind = 'workspace';
    rec.handle = null;
    rec.prefs.active = st.ws.active || '';
    rec.prefs.scope = st.ws.scope === 'repo' ? 'repo' : 'all';
    rec.repos = [];
    rec.loose = 0;
    repoList().forEach(function (r) {
      if (r.label === LOOSE) { rec.loose = r.files; return; }
      rec.repos.push({ label: r.label, fileCount: r.files, totalTokens: tok[r.label] || 0, handle: r.handle || null });
    });
  }
  return rec;
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
      var ws = rec.kind === 'workspace';
      pn.textContent = rec.name + (ws ? ' ⧉' : rec.handle ? ' ⟳' : '');
      pn.title = ws ? 'Workspace of ' + (rec.repos || []).length + ' repos: restore settings, then pick each folder again'
        : rec.handle ? 'Reload from disk (one click)' : 'Restore settings; re-drop folder for contents';
      pn.addEventListener('click', function () { loadProject(rec); });
      var pm = document.createElement('span');
      pm.className = 'pm';
      pm.textContent = (ws ? (rec.repos || []).length + ' repos · ' : '') + rec.fileCount + 'f · ' + fmtTok(rec.totalTokens || 0) + ' · ' + new Date(rec.savedAt).toISOString().slice(0, 10);
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
    /* a shared snapshot is not on this disk and has nothing to reload from */
    if (st.shared) { toast('Shared projects are read-only and are not saved. Ask the sender for a .meridian bundle to keep a copy.'); return; }
    var name = window.prompt(isMulti() ? 'Save workspace as:' : 'Save project as:', guessProjectName());
    if (name === null) return;
    var rec = buildSaveRecord(name);
    name = rec.name;
    idbPut(rec).then(function () {
      toast(rec.kind === 'workspace'
        ? '“' + name + '” saved as a workspace of ' + rec.repos.length + ' repos: names, counts, selection and settings only, never contents. Reloading asks you to pick each folder again.'
        : rec.handle
        ? '“' + name + '” saved — one-click reload enabled (selection + settings only, never contents).'
        : '“' + name + '” saved — settings + selection only; ' + (window.showDirectoryPicker ? 'open via [ PICK FOLDER ] to enable one-click reload.' : 'this browser can’t re-open folders — re-drop to reload.'));
      renderProjects();
    }).catch(function (e) {
      /* a handle that cannot be cloned (rare) — retry without it */
      rec.handle = null;
      (rec.repos || []).forEach(function (r) { r.handle = null; });
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

export { applyPendingProject, buildSaveRecord, renderProjects, walkHandle, loadProject, initMemory, wipeMemory };
