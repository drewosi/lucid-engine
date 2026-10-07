import { st } from './state.js';
import { $, toast, setStatus } from './helpers.js';
import { LOOSE, activeRepo, cleanLabel, dropRepoFiles, fullFiles, hasRepo, isMulti, repoList, repoName, scopeRepo, withRepo, workspaceFacts } from './repos.js';
import { capInfo, clearContext, loadHandle, pickFolder, refreshSkipUI, renderBudget, renderTree } from './ingest.js';
import { askLocal, renderOverview } from './local.js';
import { computeSignals } from './intents.js';
import { getIndex } from './indexer.js';
/* ============ WORKSPACE (RAIL UI) ============
   The WORKSPACE block under the drop zone: one row per loaded repo (click to
   make it active, ✕ to unload it), [ + ADD REPO ], the question-scope switch,
   and a meter showing the whole workspace against the ingest caps (the caps
   are shared by every repo, and the copy says so). It also drives the restore
   of a saved workspace: contents are never saved, so each folder is re-picked,
   one row at a time. The data layer is repos.js; this file is only the UI.  */

var SIGNAL_REPO_MAX_FILES = 4000; /* per-repo signals build one index per repo; skip on very large workspaces */
var SEV = { 5: 'CRITICAL', 4: 'HIGH', 3: 'MEDIUM', 2: 'LOW' };

function fmtMB(n) { return n >= 1024 * 1024 ? (n / (1024 * 1024)).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }
function shortLabel(label) { var s = repoName(label); return s.length > 16 ? s.slice(0, 15) + '…' : s; }
function repoHasFiles(label) {
  var pre = label + '/', found = false;
  fullFiles().forEach(function (f, p) { if (!found && p.indexOf(pre) === 0) found = true; });
  return found;
}

/* ---- active repo + scope ---- */
function setActiveRepo(label) {
  st.ws.active = label;
  renderWorkspace(); renderBudget(); renderOverview();
  toast('Active repo: ' + repoName(label) + '. ' + (st.ws.scope === 'repo'
    ? 'Questions go to ' + repoName(label) + ' only.'
    : 'Questions still cover all repos; switch [ ASK ] to narrow them to this one.'));
}
function setScope(scope) {
  st.ws.scope = scope === 'repo' ? 'repo' : 'all';
  renderWorkspace(); renderBudget();
  var s = scopeRepo();
  toast(s !== null ? 'Questions now go to ' + repoName(s) + ' only. The other repos stay loaded.' : 'Questions now cover all ' + repoList().length + ' repos.');
}
function removeRepo(label) {
  var n = dropRepoFiles(label);
  if (!st.files.size) { clearContext(); toast('“' + repoName(label) + '” unloaded. The workspace is empty.'); return; }
  renderTree(); renderBudget(); refreshSkipUI(); renderOverview();
  toast('“' + repoName(label) + '” unloaded from the workspace (' + n + ' file' + (n === 1 ? '' : 's') + '). Nothing on disk was touched.');
}
function addRepo() {
  if (st.shared) { toast('A shared project is read-only. Load your own folder to replace it, then add more repos.'); return; }
  pickFolder({ mode: 'add' });
}

/* ---- saved workspace restore: re-pick every folder ---- */
function startWorkspaceRestore(rec) {
  clearContext();
  st.pendingWorkspace = {
    rec: rec,
    waiting: (rec.repos || []).map(function (r) { return { label: cleanLabel(r.label), handle: r.handle || null, fileCount: r.fileCount || 0 }; })
  };
  renderWorkspace();
  var n = st.pendingWorkspace.waiting.length;
  toast('“' + rec.name + '”: settings restored. Pick its ' + n + ' folder' + (n === 1 ? '' : 's') + ' again under WORKSPACE; file contents are never saved.');
  if (window.innerWidth <= 860 && !$('rail').classList.contains('open')) { $('rail').classList.add('open'); $('railbtn').setAttribute('aria-expanded', 'true'); }
}
/* a folder whose name matches a repo the saved workspace is waiting for joins under that label */
function pendingLabelFor(name) {
  var pw = st.pendingWorkspace;
  if (!pw) return null;
  var c = cleanLabel(name);
  for (var i = 0; i < pw.waiting.length; i++) if (pw.waiting[i].label === c) return c;
  return null;
}
function pickPending(r) {
  if (r.handle && r.handle.queryPermission) {
    r.handle.queryPermission({ mode: 'read' }).then(function (perm) {
      return perm === 'granted' ? perm : r.handle.requestPermission({ mode: 'read' });
    }).then(function (perm) {
      if (perm !== 'granted') { r.handle = null; renderWorkspace(); toast('Read permission declined for “' + r.label + '”. Click [ PICK ] to choose the folder instead.'); return; }
      setStatus('RELOADING “' + r.label + '”…');
      return loadHandle(r.handle, 'add', r.label);
    }).catch(function () {
      r.handle = null; renderWorkspace();
      toast('The saved folder for “' + r.label + '” was not found (it may have moved). Click [ PICK ] to choose it.');
    });
  } else pickFolder({ mode: 'add', label: r.label });
}
/* called by afterIngest: a waiting repo that now has files is restored — its
   saved selection applies to its own files only, once */
function afterWorkspaceIngest() {
  var pw = st.pendingWorkspace;
  if (!pw) return;
  var un = pw.rec.unchecked || [];
  pw.waiting = pw.waiting.filter(function (r) {
    if (!hasRepo(r.label) || !repoHasFiles(r.label)) return true;
    var pre = r.label + '/';
    un.forEach(function (p) { if (p.indexOf(pre) === 0) { var f = st.files.get(p); if (f) f.checked = false; } });
    return false;
  });
  if (pw.waiting.length) return;
  var prefs = pw.rec.prefs || {};
  if (prefs.active && hasRepo(prefs.active)) st.ws.active = prefs.active;
  st.ws.scope = prefs.scope === 'repo' ? 'repo' : 'all';
  st.pendingWorkspace = null;
  toast('Workspace “' + pw.rec.name + '” is back: ' + st.repos.length + ' repos, selection restored.');
}

/* ---- the rail block ---- */
function repoRow(r, active, readOnly) {
  var row = document.createElement('div');
  row.className = 'proj-row';
  var pn = document.createElement('button');
  pn.type = 'button'; pn.className = 'pn' + (active ? ' on' : '');
  pn.textContent = (active ? '▸ ' : '') + repoName(r.label);
  pn.setAttribute('aria-pressed', String(active));
  pn.title = active ? repoName(r.label) + ' is the active repo' : 'Make ' + repoName(r.label) + ' the active repo';
  pn.addEventListener('click', function () { if (!active) setActiveRepo(r.label); });
  var pm = document.createElement('span');
  pm.className = 'pm';
  pm.textContent = r.files + 'f · ' + fmtMB(r.bytes);
  row.appendChild(pn); row.appendChild(pm);
  if (!readOnly) {
    var px = document.createElement('button');
    px.type = 'button'; px.className = 'px'; px.textContent = '✕';
    px.setAttribute('aria-label', 'Unload repo ' + repoName(r.label));
    px.title = 'Unload this repo from the workspace (nothing on disk is touched)';
    px.addEventListener('click', function () { removeRepo(r.label); });
    row.appendChild(px);
  }
  return row;
}
function pendingRow(r) {
  var row = document.createElement('div');
  row.className = 'proj-row';
  var pn = document.createElement('span');
  pn.className = 'pn wait';
  pn.textContent = r.label;
  var pm = document.createElement('span');
  pm.className = 'pm'; pm.textContent = 'saved ' + r.fileCount + 'f';
  var pb = document.createElement('button');
  pb.type = 'button'; pb.className = 'btn-quiet acc';
  pb.textContent = r.handle ? '[ ⟳ RELOAD ]' : '[ PICK ]';
  pb.title = r.handle ? 'Reload “' + r.label + '” from the remembered folder (the browser asks for read permission)' : 'Pick the folder for “' + r.label + '”';
  pb.setAttribute('aria-label', (r.handle ? 'Reload ' : 'Pick folder for ') + r.label);
  pb.addEventListener('click', function () { pickPending(r); });
  row.appendChild(pn); row.appendChild(pm); row.appendChild(pb);
  return row;
}
function renderWorkspace() {
  var shelf = $('wsshelf');
  if (!shelf) return;
  var list = repoList(), pw = st.pendingWorkspace;
  shelf.hidden = !list.length && !pw;
  if (shelf.hidden) return;
  var multi = list.length >= 2, act = activeRepo(), ro = !!st.shared;
  $('wscount').textContent = list.length ? list.length + ' REPO' + (list.length === 1 ? '' : 'S') : '';
  var box = $('wslist');
  box.innerHTML = '';
  list.forEach(function (r) { box.appendChild(repoRow(r, multi && r.label === act, ro)); });
  if (pw) pw.waiting.forEach(function (r) { box.appendChild(pendingRow(r)); });
  $('wsadd').hidden = ro;
  var sc = $('wsscope'), scoped = scopeRepo();
  sc.hidden = !multi;
  sc.textContent = scoped !== null ? '[ ASK: ' + shortLabel(scoped).toUpperCase() + ' ONLY ]' : '[ ASK: ALL REPOS ]';
  sc.setAttribute('aria-pressed', String(scoped !== null));
  sc.classList.toggle('on', scoped !== null);
  /* the caps are global: one meter for the whole workspace */
  var cap = capInfo(), bytes = st.totalBytes, n = st.files.size;
  var frac = Math.max(n / cap.maxFiles, bytes / cap.maxTotal);
  $('wscap').hidden = !list.length;
  var bar = $('wscapbar');
  bar.querySelector('i').style.width = Math.min(100, frac * 100) + '%';
  bar.classList.toggle('full', frac > 0.9);
  $('wscaptxt').textContent = n + ' / ' + cap.maxFiles + ' FILES';
  $('wscapmax').textContent = fmtMB(bytes) + ' / ' + Math.round(cap.maxTotal / (1024 * 1024)) + 'MB';
  var note = $('wsnote');
  if (pw) {
    note.textContent = '// “' + pw.rec.name + '”: settings restored. file contents are never saved, so pick each folder again'
      + (pw.waiting.some(function (r) { return r.handle; }) ? ' (⟳ = the browser remembers it; one click after it asks for read permission)' : '') + '.'
      + (pw.rec.loose ? ' it also had ' + pw.rec.loose + ' loose file' + (pw.rec.loose === 1 ? '' : 's') + '; re-add those with [ PICK FILES ].' : '');
  } else if (multi) {
    note.textContent = '// each repo keeps its own files and index. paths start with the repo name, so identical paths never collide. the caps cover the whole workspace, not each repo: '
      + cap.maxFiles + ' files and ~' + Math.round(cap.maxTotal / (1024 * 1024)) + 'MB of text in total, so a repo added near the cap loads only partly ([ REVIEW SKIPPED ] lists what was left out).';
  } else {
    note.textContent = ro ? '// a shared snapshot, read-only.' : '// [ + ADD REPO ] loads another folder beside this one, so you can ask across repos. the caps above cover every repo together.';
  }
}

/* ---- cross-repo intelligence, appended to the PROJECT INTELLIGENCE panel ---- */
function repoSignals(label) {
  return withRepo(label, function () { return computeSignals(getIndex()); });
}
function line(cls, text) { var d = document.createElement('div'); d.className = cls + ' mono'; d.textContent = text; return d; }
function renderWorkspaceOverview(ov, idx) {
  if (!isMulti()) return;
  var facts = workspaceFacts(idx), act = activeRepo();
  var wantSignals = fullFiles().size <= SIGNAL_REPO_MAX_FILES;
  var box = document.createElement('div');
  box.className = 'ov-ws';
  var hd = document.createElement('div');
  hd.className = 'ov-hd mono';
  hd.innerHTML = 'WORKSPACE // <b></b>, each with its own index. ALL scope reads them together';
  hd.querySelector('b').textContent = facts.repos.length + ' repos';
  box.appendChild(hd);
  var grid = document.createElement('div');
  grid.className = 'stat-grid';
  facts.repos.forEach(function (r) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'stat-tile' + (r.label === act ? ' on' : '');
    b.title = r.label === act ? r.name + ' is the active repo' : 'Make ' + r.name + ' the active repo';
    b.innerHTML = '<span class="sl"></span><span class="sv"></span>';
    b.querySelector('.sl').textContent = r.name.toUpperCase();
    b.querySelector('.sv').textContent = String(r.files);
    b.addEventListener('click', function () { if (r.label !== act) setActiveRepo(r.label); });
    grid.appendChild(b);
  });
  box.appendChild(grid);
  facts.repos.forEach(function (r) {
    var langs = Object.keys(r.langs).filter(function (l) { return l !== 'other'; }).sort(function (a, b) { return r.langs[b] - r.langs[a]; }).slice(0, 3);
    var sig = '';
    if (wantSignals && r.label !== LOOSE) {
      var sigs = repoSignals(r.label);
      sig = ' · signals ' + sigs.length + (sigs.length ? ' (top: ' + SEV[sigs[0].severity] + ')' : '');
    }
    box.appendChild(line('ov-langs', '// ' + r.name + ': ' + (langs.map(function (l) { return l + ' ·' + r.langs[l]; }).join('  ') || 'no code')
      + ' · ' + r.entries.length + ' entr' + (r.entries.length === 1 ? 'y' : 'ies') + ' · ' + r.tests + ' test' + (r.tests === 1 ? '' : 's') + sig));
  });
  function names(rs) { return rs.map(repoName).join(', '); }
  box.appendChild(line('ov-langs', '// shared dependencies: ' + (facts.sharedDeps.length
    ? facts.sharedDeps.slice(0, 6).map(function (d) { return d.name + ' (' + names(d.repos) + ')'; }).join(' · ') + (facts.sharedDeps.length > 6 ? ' · +' + (facts.sharedDeps.length - 6) + ' more' : '')
    : 'none declared by more than one repo')));
  if (facts.links.length) box.appendChild(line('ov-langs', '// repo links: ' + facts.links.slice(0, 4).map(function (l) { return repoName(l.from) + ' → ' + repoName(l.to) + ' (' + l.pkg + ')'; }).join(' · ')));
  if (facts.crossImports.length) box.appendChild(line('ov-langs', '// cross-repo imports: ' + facts.crossImports.slice(0, 4).map(function (c) { return repoName(c.from) + ' → ' + repoName(c.to) + ' ×' + c.count; }).join(' · ')));
  if (facts.sharedNames.length) box.appendChild(line('ov-langs', '// exported in 2+ repos: ' + facts.sharedNames.slice(0, 5).map(function (n) { return n.name + ' (' + names(n.repos) + ')'; }).join(' · ')));
  if (!wantSignals) box.appendChild(line('ov-cap', '// per-repo signals skipped above ' + SIGNAL_REPO_MAX_FILES + ' files in total; set [ ASK ] to one repo and ask `signals`.'));
  var ask = document.createElement('div');
  ask.className = 'ov-skip mono';
  var ab = document.createElement('button');
  ab.type = 'button'; ab.className = 'kbd-link mono'; ab.textContent = '[ COMPARE REPOS ]';
  ab.title = 'Run the cross-repo investigation: per-repo stats, shared dependencies, links and imports, with evidence';
  ab.addEventListener('click', function () { askLocal('workspace'); });
  ask.appendChild(document.createTextNode('// with evidence chips: '));
  ask.appendChild(ab);
  box.appendChild(ask);
  ov.appendChild(box);
}

export { addRepo, afterWorkspaceIngest, pendingLabelFor, removeRepo, renderWorkspace, renderWorkspaceOverview, setActiveRepo, setScope, startWorkspaceRestore };

export function initWorkspace() {
  $('wsadd').addEventListener('click', addRepo);
  $('wsscope').addEventListener('click', function () { setScope(st.ws.scope === 'repo' ? 'all' : 'repo'); });
  renderWorkspace();
}
