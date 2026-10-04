import { invalidateAll, st } from './state.js';
/* ============ WORKSPACE REPOS (DATA · SCOPE · LABELS) ============
   A workspace is several project folders loaded side by side. Every repo's
   files live in the one st.files map under a path namespace: the repo label is
   the path's first segment ("web/src/app.js"), and labels are unique, so two
   repos with the same relative path never collide. Files outside any
   registered folder (picked one by one, the demo) form a "loose files"
   pseudo-repo once a real repo exists.
   Scope: questions go to ALL repos, or to the active repo only. A scoped
   question runs inside withScope(), which swaps a per-repo file map, index and
   context caches in for the duration of one synchronous call (the swap the
   state.js note describes), so every existing engine works per repo unchanged.
   DOM-free on purpose: imports state.js only, so any module can use it without
   forming an import cycle. The rail UI lives in workspace.js.               */

var LOOSE = ''; /* label of the pseudo-repo for files outside any registered folder */
var LABEL_MAX = 60;

function hasRepo(label) {
  for (var i = 0; i < st.repos.length; i++) if (st.repos[i].label === label) return true;
  return false;
}
/* the full workspace map, even while a scoped swap is active */
var swap = null; /* { label, full, cache } while withRepo() runs */
function fullFiles() { return swap ? swap.full.files : st.files; }

/* repo label for a path: its first segment when that is a registered repo, else LOOSE */
function repoOf(p) {
  var i = p.indexOf('/');
  if (i === -1 || !st.repos.length) return LOOSE;
  var r = p.slice(0, i);
  return hasRepo(r) ? r : LOOSE;
}
/* the path inside its repo, label stripped */
function relOf(p) {
  var r = repoOf(p);
  return r === LOOSE ? p : p.slice(r.length + 1);
}
/* registered repos with live file counts, plus the loose pseudo-repo when it has
   files and a real repo exists. Cached until the next invalidateAll(). */
function repoList() {
  if (!st.repos.length) return [];
  if (st.wsCache) return st.wsCache;
  var counts = Object.create(null), bytes = Object.create(null), loose = 0, looseBytes = 0;
  fullFiles().forEach(function (f, p) {
    var r = repoOf(p);
    if (r === LOOSE) { loose++; looseBytes += f.content.length; }
    else { counts[r] = (counts[r] || 0) + 1; bytes[r] = (bytes[r] || 0) + f.content.length; }
  });
  var out = st.repos.map(function (r) { return { label: r.label, files: counts[r.label] || 0, bytes: bytes[r.label] || 0, handle: r.handle || null, loose: false }; });
  if (loose) out.push({ label: LOOSE, files: loose, bytes: looseBytes, handle: null, loose: true });
  st.wsCache = out;
  return out;
}
function isMulti() { return repoList().length >= 2; }
function repoName(label) { return label === LOOSE ? 'loose files' : label; }

/* a label no loaded path already uses as its first segment: name, name-2, name-3… */
function cleanLabel(name) {
  var s = String(name || '').replace(/[\u0000-\u001f/\\:]/g, '').trim().slice(0, LABEL_MAX);
  return s || 'repo';
}
function labelTaken(label) {
  if (hasRepo(label)) return true;
  var pre = label + '/', taken = false;
  fullFiles().forEach(function (f, p) { if (!taken && p.indexOf(pre) === 0) taken = true; });
  return taken;
}
function uniqueLabel(name) {
  var base = cleanLabel(name), label = base, n = 2;
  while (labelTaken(label)) label = base.slice(0, LABEL_MAX - 4) + '-' + (n++);
  return label;
}
/* move a path under a repo label: the folder's own name segment is replaced */
function remapRoot(path, label) {
  var i = path.indexOf('/');
  return label + (i === -1 ? '/' + path : path.slice(i));
}

function registerRepo(label, handle) {
  for (var i = 0; i < st.repos.length; i++) {
    if (st.repos[i].label === label) { if (handle) st.repos[i].handle = handle; st.wsCache = null; return; }
  }
  st.repos.push({ label: label, handle: handle || null });
  if (!st.ws.active || !hasRepo(st.ws.active)) st.ws.active = label;
  st.wsCache = null;
}
function resetWorkspace() {
  st.repos = [];
  st.ws = { active: '', scope: 'all' };
  st.pendingWorkspace = null;
  st.wsCache = null;
  st.scopeCache = Object.create(null);
}
/* the active repo: the stored one while it still exists, else the first */
function activeRepo() {
  var list = repoList();
  if (!list.length) return null;
  for (var i = 0; i < list.length; i++) if (list[i].label === st.ws.active) return st.ws.active;
  return list[0].label;
}

/* unload one repo's files, skip records and pins; unregister it. Pure data —
   the rail re-render is the caller's job. Returns the number of files removed. */
var SKIP_COUNTER = { oversized: 'big', 'ignore-pattern': 'user', 'binary-ext': 'binary', 'binary-content': 'binary', 'read-error': 'readerr', 'over-cap': 'over', 'mem-cap': 'memcap' };
function dropRepoFiles(label) {
  var removed = 0;
  Array.from(st.files.keys()).forEach(function (p) {
    if (repoOf(p) !== label) return;
    st.totalBytes -= st.files.get(p).content.length;
    st.files.delete(p);
    removed++;
  });
  st.skippedFiles = st.skippedFiles.filter(function (s) {
    if (repoOf(s.path) !== label) return true;
    var k = SKIP_COUNTER[s.reason];
    if (k && st.skipped[k] > 0) st.skipped[k]--;
    return false;
  });
  st.pinnedEv = st.pinnedEv.filter(function (ev) { return repoOf(ev.file) !== label; });
  if (label !== LOOSE) st.repos = st.repos.filter(function (r) { return r.label !== label; });
  invalidateAll();
  if (!hasRepo(st.ws.active)) { st.ws.active = st.repos.length ? st.repos[0].label : ''; }
  return removed;
}

/* ---- scope ---- */
/* the repo questions are scoped to, or null when they cover everything */
function scopeRepo() {
  if (st.ws.scope !== 'repo' || !isMulti()) return null;
  return activeRepo();
}
/* predicate over paths for the current scope (computed once per call site) */
function scopeFilter() {
  var s = scopeRepo();
  return s === null ? function () { return true; } : function (p) { return repoOf(p) === s; };
}
/* run fn with st.files (and the index/context caches) narrowed to one repo.
   Synchronous only: the swap is restored before this returns, even on throw.
   Each repo keeps its own cached index in st.scopeCache. */
function withRepo(label, fn) {
  if (swap && swap.label === label) return fn();
  var outer = swap;
  var saved = { files: st.files, idx: st.projectIndex, idxDirty: st.indexDirty, ctx: st.contextCache, ctxDirty: st.contextDirty, map: st.mapCache, mapDirty: st.mapDirty };
  /* at the top level the saved state IS the full state, so caches withFull() builds survive the restore */
  var full = outer ? outer.full : saved;
  var c = st.scopeCache[label];
  if (!c) {
    c = st.scopeCache[label] = { files: new Map(), idx: null, ctx: '', ctxDirty: true, map: '', mapDirty: true };
    full.files.forEach(function (f, p) { if (repoOf(p) === label) c.files.set(p, f); });
  }
  var cacheRef = st.scopeCache;
  st.files = c.files; st.projectIndex = c.idx; st.indexDirty = !c.idx;
  st.contextCache = c.ctx; st.contextDirty = c.ctxDirty; st.mapCache = c.map; st.mapDirty = c.mapDirty;
  swap = { label: label, full: full, cache: c };
  try { return fn(); }
  finally {
    /* keep what was built for next time, unless an invalidation replaced the cache meanwhile */
    if (st.scopeCache === cacheRef && !st.indexDirty) c.idx = st.projectIndex;
    c.ctx = st.contextCache; c.ctxDirty = st.contextDirty; c.map = st.mapCache; c.mapDirty = st.mapDirty;
    st.files = saved.files; st.projectIndex = saved.idx; st.indexDirty = saved.idxDirty;
    st.contextCache = saved.ctx; st.contextDirty = saved.ctxDirty; st.mapCache = saved.map; st.mapDirty = saved.mapDirty;
    swap = outer;
  }
}
function withScope(fn) {
  var s = scopeRepo();
  return s === null ? fn() : withRepo(s, fn);
}
/* the inverse: run fn over the whole workspace even from inside a scoped call
   (the cross-repo intent needs every repo whatever the scope says) */
function withFull(fn) {
  if (!swap) return fn();
  var inner = swap;
  var saved = { files: st.files, idx: st.projectIndex, idxDirty: st.indexDirty, ctx: st.contextCache, ctxDirty: st.contextDirty, map: st.mapCache, mapDirty: st.mapDirty };
  var f = inner.full;
  st.files = f.files; st.projectIndex = f.idx; st.indexDirty = f.idxDirty;
  st.contextCache = f.ctx; st.contextDirty = f.ctxDirty; st.mapCache = f.map; st.mapDirty = f.mapDirty;
  swap = null;
  try { return fn(); }
  finally {
    f.idx = st.projectIndex; f.idxDirty = st.indexDirty; f.ctx = st.contextCache; f.ctxDirty = st.contextDirty; f.map = st.mapCache; f.mapDirty = st.mapDirty;
    st.files = saved.files; st.projectIndex = saved.idx; st.indexDirty = saved.idxDirty;
    st.contextCache = saved.ctx; st.contextDirty = saved.ctxDirty; st.mapCache = saved.map; st.mapDirty = saved.mapDirty;
    swap = inner;
  }
}
function inScopedCall() { return !!swap; }

/* ---- labels: how a path or citation reads in a multi-repo workspace ---- */
/* "web:src/app.js" when several repos are loaded, the plain path otherwise */
function displayPath(p) {
  if (!isMulti()) return p;
  var r = repoOf(p);
  return r === LOOSE ? p : r + ':' + p.slice(r.length + 1);
}
function citeText(file, a, b) { return displayPath(file) + ':' + a + '–' + b; }
/* map a cited path to a loaded one: the "repo:path" display form, or a bare
   repo-relative path that exists in exactly one repo. Ambiguous or unknown
   paths come back unchanged (their chips stay unverifiable, honestly). */
function resolveCitePath(file) {
  var files = fullFiles();
  if (typeof file !== 'string' || files.has(file) || !st.repos.length) return file;
  var m = /^([^:/]+):(.+)$/.exec(file);
  if (m && hasRepo(m[1]) && files.has(m[1] + '/' + m[2].replace(/^\.?\//, ''))) return m[1] + '/' + m[2].replace(/^\.?\//, '');
  if (!isMulti()) return file;
  var rel = file.replace(/^\.?\//, ''), hits = [];
  st.repos.forEach(function (r) { if (files.has(r.label + '/' + rel)) hits.push(r.label + '/' + rel); });
  return hits.length === 1 ? hits[0] : file;
}

/* the workspace paragraph a model receives ahead of the files, '' for one repo */
function workspaceNote() {
  if (!isMulti()) return '';
  var list = repoList();
  if (swap) {
    var others = list.filter(function (r) { return r.label !== swap.label; }).map(function (r) { return repoName(r.label); });
    return 'WORKSPACE: this question is scoped to the repository "' + repoName(swap.label) + '" (' + st.files.size + ' files). '
      + 'Other loaded repositories (' + others.join(', ') + ') are out of scope and not included. Paths begin with the repository label; cite them exactly as given.';
  }
  return 'WORKSPACE: ' + list.length + ' repositories are in scope: ' + list.map(function (r) { return repoName(r.label) + ' (' + r.files + ' files)'; }).join(', ') + '. '
    + 'Every path begins with its repository label (for example "' + (list[0].loose ? 'file.js' : list[0].label + '/src/file.js') + '"); cite paths exactly as given, label included. '
    + 'When an answer draws on more than one repository, say which repository each fact comes from.';
}

/* ---- cross-repo facts: per-repo stats + what the repos share, read from the
   already-built full index and the manifests. Cheap passes only. ---- */
function lineOf(lines, re, from) {
  for (var i = from || 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return 1;
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/* dependency names declared by one manifest: [{ eco, name, line }] */
function manifestDeps(path, content) {
  var name = path.slice(path.lastIndexOf('/') + 1).toLowerCase(), lines = content.split('\n'), out = [];
  function add(eco, n, line) { if (n) out.push({ eco: eco, name: n, line: line }); }
  if (name === 'package.json' || name === 'composer.json') {
    var o; try { o = JSON.parse(content); } catch (e) { return out; }
    var secs = name === 'package.json' ? ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] : ['require', 'require-dev'];
    var eco = name === 'package.json' ? 'npm' : 'composer';
    secs.forEach(function (s) {
      if (!o || !o[s] || typeof o[s] !== 'object') return;
      Object.keys(o[s]).forEach(function (d) {
        if (eco === 'composer' && (d === 'php' || d.indexOf('ext-') === 0)) return;
        add(eco, d, lineOf(lines, new RegExp('"' + escRe(d) + '"\\s*:')));
      });
    });
  } else if (name === 'requirements.txt') {
    lines.forEach(function (ln, i) {
      var m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(ln);
      if (m && !/^\s*[#-]/.test(ln)) add('pip', m[1].toLowerCase().replace(/_/g, '-'), i + 1);
    });
  } else if (name === 'go.mod') {
    var inReq = false;
    lines.forEach(function (ln, i) {
      if (/^\s*require\s*\(/.test(ln)) { inReq = true; return; }
      if (inReq && /^\s*\)/.test(ln)) { inReq = false; return; }
      var m = inReq ? /^\s*([^\s/]+\/\S+)\s+v/.exec(ln) : /^\s*require\s+(\S+)\s+v/.exec(ln);
      if (m) add('go', m[1], i + 1);
    });
  } else if (name === 'cargo.toml') {
    var inDeps = false;
    lines.forEach(function (ln, i) {
      var sec = /^\s*\[([^\]]+)\]/.exec(ln);
      if (sec) { inDeps = /(^|\.)(dev-|build-)?dependencies$/.test(sec[1].trim()); return; }
      var m = inDeps && /^\s*([A-Za-z0-9_-]+)\s*=/.exec(ln);
      if (m) add('cargo', m[1].replace(/_/g, '-'), i + 1);
    });
  } else if (name === 'gemfile') {
    lines.forEach(function (ln, i) { var m = /^\s*gem\s+['"]([^'"]+)['"]/.exec(ln); if (m) add('gem', m[1], i + 1); });
  }
  return out;
}
var MANIFESTS = /^(package\.json|composer\.json|requirements\.txt|go\.mod|cargo\.toml|gemfile)$/i;
function workspaceFacts(idx) {
  var files = fullFiles(), list = repoList();
  var stats = Object.create(null);
  list.forEach(function (r) { stats[r.label] = { label: r.label, name: repoName(r.label), files: r.files, bytes: r.bytes, langs: Object.create(null), entries: [], tests: 0, symbols: 0, todos: 0, packages: [] }; });
  files.forEach(function (f, p) { var s = stats[repoOf(p)]; if (s && f.lang) s.langs[f.lang] = (s.langs[f.lang] || 0) + 1; });
  idx.entries.forEach(function (p) { var s = stats[repoOf(p)]; if (s) s.entries.push(p); });
  idx.tests.forEach(function (p) { var s = stats[repoOf(p)]; if (s) s.tests++; });
  idx.todos.forEach(function (t) { var s = stats[repoOf(t.file)]; if (s) s.todos++; });
  Object.keys(idx.symCountByFile).forEach(function (p) { var s = stats[repoOf(p)]; if (s) s.symbols += idx.symCountByFile[p]; });
  /* packages each repo publishes (manifest names), for repo → repo links */
  var publishedBy = Object.create(null);
  idx.packages.forEach(function (pk) {
    var s = stats[repoOf(pk.manifest)];
    if (!s || !pk.name) return;
    s.packages.push(pk.name);
    publishedBy[pk.name.toLowerCase().replace(/_/g, '-')] = repoOf(pk.manifest);
  });
  /* dependencies: shared (declared by 2+ repos, same ecosystem) and links (a dep
     that another loaded repo publishes) */
  var depRepos = Object.create(null), links = [], linkSeen = Object.create(null);
  files.forEach(function (f, p) {
    var nm = p.slice(p.lastIndexOf('/') + 1);
    if (!MANIFESTS.test(nm)) return;
    var r = repoOf(p);
    manifestDeps(p, f.content).forEach(function (d) {
      var key = d.eco + ':' + d.name;
      var e = depRepos[key] || (depRepos[key] = { name: d.name, eco: d.eco, repos: [], ev: [] });
      if (e.repos.indexOf(r) === -1) { e.repos.push(r); e.ev.push({ file: p, line: d.line }); }
      var owner = publishedBy[d.name.toLowerCase().replace(/_/g, '-')];
      if (owner !== undefined && owner !== r && !linkSeen[r + '>' + owner + '>' + d.name]) {
        linkSeen[r + '>' + owner + '>' + d.name] = 1;
        links.push({ from: r, to: owner, pkg: d.name, file: p, line: d.line });
      }
    });
  });
  var sharedDeps = Object.keys(depRepos).map(function (k) { return depRepos[k]; })
    .filter(function (e) { return e.repos.length >= 2; })
    .sort(function (a, b) { return b.repos.length - a.repos.length || (a.name < b.name ? -1 : 1); });
  /* resolved imports whose target lives in another repo */
  var cross = Object.create(null);
  idx.importsByFile.forEach(function (arr, file) {
    var from = repoOf(file);
    arr.forEach(function (x) {
      if (!x.resolved) return;
      var to = repoOf(x.resolved);
      if (to === from) return;
      var k = from + '>' + to;
      if (!cross[k]) cross[k] = { from: from, to: to, count: 0, file: file, line: x.line, raw: x.raw };
      cross[k].count++;
    });
  });
  var crossImports = Object.keys(cross).map(function (k) { return cross[k]; }).sort(function (a, b) { return b.count - a.count; });
  /* exported names defined in 2+ repos (public surface only, so locals don't count) */
  var byName = Object.create(null);
  idx.exportsByFile.forEach(function (arr, file) {
    var r = repoOf(file);
    arr.forEach(function (e) {
      if (e.name.length < 4 || e.name === 'default') return;
      var n = byName[e.name] || (byName[e.name] = { name: e.name, repos: [], ev: [] });
      if (n.repos.indexOf(r) === -1) { n.repos.push(r); n.ev.push({ file: file, line: e.line }); }
    });
  });
  var sharedNames = Object.keys(byName).map(function (k) { return byName[k]; })
    .filter(function (n) { return n.repos.length >= 2; })
    .sort(function (a, b) { return b.repos.length - a.repos.length || (a.name < b.name ? -1 : 1); });
  return { repos: list.map(function (r) { return stats[r.label]; }), sharedDeps: sharedDeps, links: links, crossImports: crossImports, sharedNames: sharedNames };
}

export { LOOSE, activeRepo, citeText, cleanLabel, displayPath, dropRepoFiles, fullFiles, hasRepo, inScopedCall, isMulti, manifestDeps, registerRepo, relOf, remapRoot,
  repoList, repoName, repoOf, resetWorkspace, resolveCitePath, scopeFilter, scopeRepo, uniqueLabel, withFull, withRepo, withScope, workspaceFacts, workspaceNote };
