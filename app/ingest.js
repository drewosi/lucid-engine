import { invalidateAll, invalidateSelection, sortedPaths, st } from './state.js';
import { AUTO_SMART_FRAC, buildProjectMap, estTokens, getBudget, packSmartContext, staticScore } from './smart-context.js';
import { detectLang } from './indexer.js';
import { $, fmtTok, lsDel, lsGet, lsSet, rememberFocus, returnFocus, setStatus, toast, trap } from './helpers.js';
import { applyPendingProject, renderProjects, walkHandle } from './memory.js';
import { renderOverview } from './local.js';
import { LS, MODELS } from './config.js';
import { INSTRUCTIONS, buildInvestigationBlock } from './prompt.js';
/* ============ CONTEXT ENGINE ============ */
var SKIP_LIST_MAX = 500;
function recordSkip(path, reason, size, ref) {
  if (st.skippedFiles.length < SKIP_LIST_MAX) st.skippedFiles.push({ path: path, reason: reason, size: size || 0, ref: ref || null });
}
/* snapshot the skip counters at the start of an ingest batch, so the post-ingest
   toast reports THIS load's numbers. The skip note + review modal stay cumulative
   — they describe everything currently in memory, not one batch. */
var batchBase = null;
function beginBatch() {
  batchBase = { dirs: st.skipped.dirs, binary: st.skipped.binary, big: st.skipped.big, over: st.skipped.over, user: st.skipped.user, readerr: st.skipped.readerr };
}
function skipSummary(c) {
  var s = [];
  if (c.binary) s.push(c.binary + ' binary');
  if (c.big) s.push(c.big + ' oversized');
  if (c.dirs) s.push(c.dirs + ' ignored-dir');
  if (c.user) s.push(c.user + ' ignore-pattern');
  if (c.readerr) s.push(c.readerr + ' read-error');
  if (c.over) s.push(c.over + ' over the ' + MAX_FILES + '-file cap');
  return s;
}
var IGNORE_DIRS = ['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'target', 'vendor', '__pycache__', '.venv', 'venv', 'coverage', '.cache', '.idea', '.vscode',
                   'obj', '.gradle', 'pods', '.tox', '.mypy_cache', '.pytest_cache', '.terraform', '_build', '.dart_tool'];
var BIN_EXT = /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|svgz|woff2?|ttf|otf|eot|mp[34]|m4[av]|mov|avi|mkv|webm|ogg|wav|flac|zip|gz|bz2|xz|7z|rar|tar|jar|war|class|pyc|pyo|o|a|so|dylib|dll|exe|bin|dat|db|sqlite3?|pdf|doc[x]?|xls[x]?|ppt[x]?|ds_store|lockb|wasm)$/i;
var MAX_FILE = 512 * 1024, MAX_FILES = 8000;

function ignoredPath(path) {
  return path.split('/').some(function (seg) { return IGNORE_DIRS.indexOf(seg.toLowerCase()) !== -1 || (seg !== '.' && seg.charAt(0) === '.' && seg !== '.github' && seg !== '.env.example'); });
}
/* Encoding sniff over the head bytes. Honors UTF-16/UTF-8 BOMs (so UTF-16 text with
   its many 0x00 bytes is not misread as binary), otherwise flags binary on any null
   byte or a high control-character ratio. Returns a TextDecoder label or 'binary'. */
function sniffEncoding(v) {
  if (v.length >= 2 && v[0] === 0xFF && v[1] === 0xFE) return 'utf-16le';
  if (v.length >= 2 && v[0] === 0xFE && v[1] === 0xFF) return 'utf-16be';
  if (v.length >= 3 && v[0] === 0xEF && v[1] === 0xBB && v[2] === 0xBF) return 'utf-8';
  var nulls = 0, ctrl = 0;
  for (var i = 0; i < v.length; i++) {
    var b = v[i];
    if (b === 0) nulls++;
    else if (b < 9 || (b > 13 && b < 32)) ctrl++;
  }
  if (nulls > 0) return 'binary';
  if (v.length > 0 && ctrl / v.length > 0.3) return 'binary';
  return 'utf-8';
}
/* force=true (the include-back path) bypasses pattern/extension/size filters;
   the encoding sniff still applies — true binaries are never ingested */
function ingestFile(file, path, force) {
  path = (path || file.name).replace(/^\.?\//, '');
  if (st.files.size >= MAX_FILES) { st.skipped.over++; return Promise.resolve(); }
  if (!force && ignoredPath(path)) { st.skipped.dirs++; return Promise.resolve(); }
  if (!force && matchesIgnore(path)) { st.skipped.user++; recordSkip(path, 'ignore-pattern', file.size, file); return Promise.resolve(); }
  if (!force && BIN_EXT.test(path)) { st.skipped.binary++; recordSkip(path, 'binary-ext', file.size, file); return Promise.resolve(); }
  if (!force && file.size > MAX_FILE) { st.skipped.big++; recordSkip(path, 'oversized', file.size, file); return Promise.resolve(); }
  return file.arrayBuffer().then(function (buf) {
    var enc = sniffEncoding(new Uint8Array(buf, 0, Math.min(buf.byteLength, 8192)));
    if (enc === 'binary') { st.skipped.binary++; recordSkip(path, 'binary-content', file.size, null); return; }
    var text;
    try { text = new TextDecoder(enc, { fatal: false }).decode(buf); }
    catch (e) { text = new TextDecoder('utf-8', { fatal: false }).decode(buf); }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); /* strip a leading BOM */
    st.files.set(path, {
      content: text,
      lines: text.split('\n').length,
      tokens: estTokens(text, path),
      mtime: file.lastModified || 0,
      base: staticScore(path),
      checked: true,
      lang: detectLang(path, text)
    });
    if (st.files.size % 100 === 0) setStatus('INGESTING — ' + st.files.size + ' FILES…');
  }).catch(function (e) {
    /* read/decode failure is NOT binary — record it so the review modal shows it */
    console.warn('meridian: could not read', path, e);
    st.skipped.readerr++;
    recordSkip(path, 'read-error', file.size, null);
  });
}

function walkEntry(entry, prefix) {
  return new Promise(function (resolve) {
    if (entry.isFile) {
      entry.file(function (f) { ingestFile(f, prefix + entry.name).then(resolve); }, function () { resolve(); });
    } else if (entry.isDirectory) {
      if (IGNORE_DIRS.indexOf(entry.name.toLowerCase()) !== -1 || (entry.name.charAt(0) === '.' && entry.name !== '.github')) { st.skipped.dirs++; resolve(); return; }
      var reader = entry.createReader(), all = [];
      (function read() {
        reader.readEntries(function (batch) {
          /* Chrome returns ≤100 entries per call — keep reading until empty */
          if (batch.length) { all = all.concat(Array.prototype.slice.call(batch)); read(); }
          else {
            Promise.all(all.map(function (e2) { return walkEntry(e2, prefix + entry.name + '/'); })).then(resolve);
          }
        }, function () { resolve(); });
      })();
    } else resolve();
  });
}

/* surface reviewable skips as a badge on the rail toggle (for when the rail is
   collapsed on mobile) and as a count on the [ REVIEW SKIPPED ] control */
function updateSkipBadge() {
  var n = st.skippedFiles.length;
  var rb = $('railbtn');
  var badge = rb.querySelector('.railbadge');
  if (n > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'railbadge'; rb.appendChild(badge); }
    badge.textContent = n > 99 ? '99+' : String(n);
    rb.title = n + ' skipped file' + (n === 1 ? '' : 's') + ' — open CONTEXT to review';
  } else if (badge) { badge.remove(); rb.removeAttribute('title'); }
  var sr = $('skiprev');
  if (sr) sr.textContent = n ? '[ REVIEW SKIPPED · ' + n + ' ]' : '[ REVIEW SKIPPED ]';
}
function afterIngest() {
  applyPendingProject();
  invalidateAll();
  renderTree(); renderBudget();
  renderProjects();
  /* this batch's skips = counters minus the batch-start snapshot; callers that
     reset the counters themselves (project reload, demo) have no snapshot, so
     the delta is simply the totals */
  var b0 = batchBase || { dirs: 0, binary: 0, big: 0, over: 0, user: 0, readerr: 0 };
  batchBase = null;
  var batchSkipped = (st.skipped.binary - b0.binary) + (st.skipped.big - b0.big) + (st.skipped.dirs - b0.dirs)
    + (st.skipped.user - b0.user) + (st.skipped.over - b0.over) + (st.skipped.readerr - b0.readerr);
  var s = skipSummary(st.skipped);
  var totSkipped = st.skipped.binary + st.skipped.big + st.skipped.dirs + st.skipped.user + st.skipped.over + st.skipped.readerr;
  var note = $('skipnote');
  note.hidden = !s.length;
  if (s.length) note.textContent = '// ' + totSkipped + ' skipped: ' + s.join(' · ') + '. caps: ' + (MAX_FILE / 1024) + 'KB/file, ' + MAX_FILES + ' files.';
  $('skiprevrow').hidden = !st.skippedFiles.length;
  updateSkipBadge();
  var base = st.files.size + ' file' + (st.files.size === 1 ? '' : 's') + ' loaded into memory';
  if (batchSkipped && st.skippedFiles.length) toast(base + ' · ' + batchSkipped + ' skipped in this load.', { label: '[ REVIEW ]', fn: openSkipReview });
  else toast(base + (batchSkipped ? ' · ' + batchSkipped + ' skipped in this load.' : '.'));
  renderOverview();
  setStatus('CORE IDLE — ' + st.files.size + ' files in memory');
  /* graceful scaling: warn as the in-memory file cap approaches or is hit */
  if (st.skipped.over) toast('File cap reached (' + MAX_FILES + ') — ' + st.skipped.over + ' file' + (st.skipped.over === 1 ? '' : 's') + ' not loaded. Narrow the folder or add ignore patterns.');
  else if (st.files.size >= Math.floor(MAX_FILES * 0.9)) toast('Approaching the ' + MAX_FILES + '-file cap (' + st.files.size + ' loaded) — large repos may hit it; ignore patterns help.');
  maybeAutoSmart();
}

var dz = $('dropzone');
/* Prefer the File System Access API when available — its directory handle can be
   persisted to IndexedDB, enabling one-click project reload later. */
function pickHandler(input) {
  st.lastDirHandle = null;
  beginBatch();
  var list = Array.prototype.slice.call(input.files || []);
  Promise.all(list.map(function (f) { return ingestFile(f, f.webkitRelativePath || f.name); })).then(afterIngest);
  input.value = '';
}
/* full unload — shared by the [ CLEAR ] control and the REPLACE ingest path */
function clearContext() {
  st.files.clear(); st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0, readerr: 0 };
  st.skippedFiles.length = 0;
  collapsedDirs = {}; treeQuery = '';
  var ts = $('treesearch'); if (ts) ts.value = '';
  invalidateAll(); renderTree(); renderBudget();
  renderOverview();
  $('skipnote').hidden = true;
  $('skiprevrow').hidden = true;
  updateSkipBadge();
}

/* ---- project tree ----
   Rows are cloned from the <template> components in app.html (tpl-dir-row /
   tpl-file-row). Collapse state survives re-renders; the search filter matches
   path substrings and always shows matches expanded. */
var collapsedDirs = {}, treeQuery = '';
function parentDir(p) { return p.indexOf('/') === -1 ? '' : p.slice(0, p.lastIndexOf('/')); }
function syncDirCheck(check, mine) {
  var on = 0;
  mine.forEach(function (x) { if (st.files.get(x).checked) on++; });
  check.checked = mine.length > 0 && on === mine.length;
  check.indeterminate = on > 0 && on < mine.length;
}
function renderTree() {
  var tree = $('tree');
  tree.innerHTML = '';
  var allPaths = sortedPaths();
  $('filecount').textContent = allPaths.length ? allPaths.length + ' FILES' : '';
  $('ctxactions').hidden = !allPaths.length;
  $('budget').hidden = !allPaths.length;
  $('ctxmoderow').hidden = !allPaths.length;
  $('treesearchrow').hidden = !allPaths.length;
  $('smartnote').hidden = !allPaths.length || st.ctxMode !== 'smart';
  var q = treeQuery.trim().toLowerCase();
  var paths = q ? allPaths.filter(function (p) { return p.toLowerCase().indexOf(q) !== -1; }) : allPaths;
  if (q && !paths.length) {
    var none = document.createElement('div');
    none.className = 'tree-empty';
    none.textContent = '// no loaded path matches “' + treeQuery.trim() + '”';
    tree.appendChild(none);
    return;
  }
  var dirTpl = $('tpl-dir-row'), fileTpl = $('tpl-file-row');
  var frag = document.createDocumentFragment();
  var lastDir = null, dirClosed = false, curCheck = null, curMine = null;
  paths.forEach(function (p) {
    var dir = parentDir(p);
    if (dir !== lastDir) {
      lastDir = dir;
      dirClosed = !q && !!collapsedDirs[dir]; /* filtering always shows matches expanded */
      var mine = allPaths.filter(function (x) { return parentDir(x) === dir; });
      var row = dirTpl.content.firstElementChild.cloneNode(true);
      row.classList.toggle('closed', dirClosed);
      var tgl = row.querySelector('.dir-tgl');
      tgl.querySelector('.dn').textContent = dir || './';
      tgl.querySelector('.dc').textContent = '· ' + mine.length;
      tgl.setAttribute('aria-expanded', String(!dirClosed));
      tgl.setAttribute('aria-label', (dirClosed ? 'Expand ' : 'Collapse ') + (dir || 'project root') + ' — ' + mine.length + ' file' + (mine.length === 1 ? '' : 's'));
      tgl.addEventListener('click', function () {
        if (treeQuery.trim()) return; /* collapse is moot while filtering */
        collapsedDirs[dir] = !collapsedDirs[dir];
        renderTree();
      });
      var check = row.querySelector('.dir-check');
      syncDirCheck(check, mine);
      check.setAttribute('aria-label', 'Select or deselect all files in ' + (dir || 'project root'));
      check.addEventListener('change', function () {
        var anyOff = mine.some(function (x) { return !st.files.get(x).checked; });
        mine.forEach(function (x) { st.files.get(x).checked = anyOff; });
        invalidateSelection(); renderTree(); renderBudget(); /* selection change: symbol/import index unaffected */
      });
      curCheck = check; curMine = mine;
      frag.appendChild(row);
    }
    if (dirClosed) return;
    var f = st.files.get(p);
    var frow = fileTpl.content.firstElementChild.cloneNode(true);
    var cb = frow.querySelector('input');
    cb.checked = f.checked;
    (function (dirCheck, mine) {
      cb.addEventListener('change', function () {
        f.checked = cb.checked;
        syncDirCheck(dirCheck, mine); /* keep the tri-state dir box honest without a re-render */
        invalidateSelection(); renderBudget();
      });
    })(curCheck, curMine);
    var nm = frow.querySelector('.nm');
    nm.textContent = p.slice(dir ? dir.length + 1 : 0);
    nm.title = p;
    frow.querySelector('.tk').textContent = '≈' + fmtTok(f.tokens);
    frag.appendChild(frow);
  });
  tree.appendChild(frag);
}

function selectedTokens() {
  var t = 0, n = 0;
  st.files.forEach(function (f) { if (f.checked) { t += f.tokens; n++; } });
  return { tokens: t, count: n };
}
function renderBudget() {
  var sel = selectedTokens();
  var cap = MODELS[st.model].ctx;
  var smart = st.ctxMode === 'smart';
  /* in smart mode the bar shows the per-question send target, not the raw pile */
  var pct = Math.min(100, ((smart ? Math.min(sel.tokens, getBudget()) : sel.tokens) / cap) * 100);
  var bar = $('budgetbar');
  bar.querySelector('i').style.width = pct + '%';
  bar.classList.toggle('full', !smart && pct > 90);
  $('budgettxt').textContent = smart
    ? '≈ ' + fmtTok(sel.tokens) + ' loaded · sends ≤ ' + fmtTok(getBudget())
    : '≈ ' + fmtTok(sel.tokens) + ' tokens · ' + sel.count + ' selected';
  $('budgetmax').textContent = MODELS[st.model].local ? 'LOCAL — NOTHING SENT' : MODELS[st.model].label + ' · ' + fmtTok(cap);
  $('ctxreadout').innerHTML = smart
    ? 'CTX <b>SMART</b> · <b>' + sel.count + '</b> files · sends ≤ <b>' + fmtTok(getBudget()) + '</b>'
    : 'CTX ≈ <b>' + fmtTok(sel.tokens) + '</b> tokens · <b>' + sel.count + '</b> files';
}

/* ---- skipped-file review + include-back ---- */
var skipveil = $('skipveil'), untrapSkip = null;
var SKIP_LABEL = { oversized: 'OVERSIZED', 'ignore-pattern': 'IGNORE PATTERN', 'binary-ext': 'BINARY EXTENSION', 'binary-content': 'BINARY CONTENT — CANNOT INCLUDE', 'read-error': 'READ ERROR — COULD NOT LOAD' };
function openSkipReview() {
  var list = $('skiplist');
  list.innerHTML = '';
  var order = ['oversized', 'ignore-pattern', 'binary-ext', 'binary-content', 'read-error'];
  var groups = {};
  st.skippedFiles.forEach(function (s) { (groups[s.reason] = groups[s.reason] || []).push(s); });
  $('skipsum').textContent = '// ' + st.skippedFiles.length + ' file' + (st.skippedFiles.length === 1 ? '' : 's') + ' recorded'
    + (st.skipped.dirs ? ' — plus ' + st.skipped.dirs + ' inside ignored/dot directories (not listed)' : '')
    + '. INCLUDE pulls a file into memory despite the filter; true binaries stay out.';
  order.forEach(function (g) {
    var rows = groups[g];
    if (!rows || !rows.length) return;
    var hd = document.createElement('div');
    hd.className = 'skip-grp';
    hd.textContent = SKIP_LABEL[g] + ' — ' + rows.length + (g === 'oversized' ? ' (>' + (MAX_FILE / 1024) + 'KB)' : '');
    list.appendChild(hd);
    rows.slice(0, 200).forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'skip-row';
      var sp = document.createElement('span');
      sp.className = 'sp'; sp.textContent = s.path; sp.title = s.path;
      var sz = document.createElement('span');
      sz.className = 'sz'; sz.textContent = s.size >= 1024 ? Math.round(s.size / 1024) + 'KB' : s.size + 'B';
      row.appendChild(sp); row.appendChild(sz);
      if (s.ref) {
        var inc = document.createElement('button');
        inc.type = 'button'; inc.className = 'ev mono'; inc.textContent = '[ INCLUDE ]';
        inc.addEventListener('click', function () {
          inc.disabled = true;
          ingestFile(s.ref, s.path, true).then(function () {
            if (st.files.has(s.path)) {
              var ix = st.skippedFiles.indexOf(s);
              if (ix !== -1) st.skippedFiles.splice(ix, 1);
              invalidateAll();
              renderTree(); renderBudget();
              row.remove();
              $('skiprevrow').hidden = !st.skippedFiles.length;
              updateSkipBadge();
              toast('“' + s.path + '” included in context.');
            } else {
              inc.disabled = false;
              toast('Could not include — the file content reads as binary.');
            }
          });
        });
        row.appendChild(inc);
      }
      list.appendChild(row);
    });
    if (rows.length > 200) {
      var more = document.createElement('div');
      more.className = 'skip-grp';
      more.textContent = '… ' + (rows.length - 200) + ' more not shown';
      list.appendChild(more);
    }
  });
  rememberFocus();
  skipveil.classList.add('on');
  untrapSkip = trap(skipveil.querySelector('.modal'));
}
function closeSkipReview() {
  skipveil.classList.remove('on');
  if (untrapSkip) { untrapSkip(); untrapSkip = null; }
  returnFocus();
}

/* ---- context send preview ----
   Shows exactly what the next question will send, computed by the SAME
   functions the request uses (buildProjectMap / packSmartContext /
   assembleContext) — the preview cannot drift from reality. */
var prevveil = $('prevveil'), untrapPrev = null;
function openPreview() {
  if (!st.files.size) { toast('Load a project first.'); return; }
  var q = $('prompt').value.trim();
  var body = $('prevbody');
  body.innerHTML = '';
  function sec(txt) { var d = document.createElement('div'); d.className = 'prev-sec'; d.textContent = txt; body.appendChild(d); }
  function note(txt) { var p = document.createElement('p'); p.className = 'prev-note'; p.textContent = txt; body.appendChild(p); }
  function fileRow(path, tok, whole) {
    var r = document.createElement('div');
    r.className = 'prev-row';
    var pk = document.createElement('span'); pk.className = 'pk' + (whole ? '' : ' ex'); pk.textContent = whole ? 'WHOLE' : 'EXCERPT';
    var pp = document.createElement('span'); pp.className = 'pp'; pp.textContent = path; pp.title = path;
    var pt = document.createElement('span'); pt.className = 'pt'; pt.textContent = '≈' + fmtTok(tok);
    r.appendChild(pk); r.appendChild(pp); r.appendChild(pt);
    body.appendChild(r);
  }
  var smart = st.ctxMode === 'smart';
  if (smart) {
    var map = buildProjectMap();
    var packed = packSmartContext(q, getBudget());
    var mapTok = estTokens(map);
    $('prevstat').textContent = 'SMART · ' + packed.count + '/' + packed.total + ' FILES · ≈' + fmtTok(packed.tokens + mapTok) + ' TOK';
    note(q ? '// packed for the question currently in the composer: “' + q.slice(0, 80) + (q.length > 80 ? '…' : '') + '”'
           : '// no question typed — packed by importance and recency alone. type a question first for a query-aware preview.');
    note('// budget ≈' + fmtTok(getBudget()) + ' tokens · instructions block adds ≈' + fmtTok(estTokens(INSTRUCTIONS)) + ' more.');
    sec('BLOCK 1 — PROJECT MAP ≈' + fmtTok(mapTok) + ' TOK (cached between questions)');
    var pre = document.createElement('pre');
    pre.className = 'mapview';
    pre.textContent = map.length > 20000 ? map.slice(0, 20000) + '\n… truncated for display — the full map is sent' : map;
    body.appendChild(pre);
    sec('BLOCK 2 — SELECTED FILES · ' + packed.count + ' OF ' + packed.total + ' · ≈' + fmtTok(packed.tokens) + ' TOK');
    packed.included.forEach(function (it) { fileRow(it.p, it.tok, it.whole); });
    if (!packed.included.length) note('// nothing fit the budget — raise it in settings.');
  } else {
    var sel = selectedTokens();
    $('prevstat').textContent = 'FULL · ' + sel.count + ' FILES · ≈' + fmtTok(sel.tokens) + ' TOK';
    note('// FULL mode sends every checked file whole, no map. switch to SMART in the rail for budgeted selection.');
    note('// instructions block adds ≈' + fmtTok(estTokens(INSTRUCTIONS)) + ' more.');
    sec('ALL CHECKED FILES — ' + sel.count + ' · ≈' + fmtTok(sel.tokens) + ' TOK');
    var shown = 0;
    sortedPaths().some(function (p) {
      var f = st.files.get(p);
      if (!f.checked) return false;
      fileRow(p, f.tokens, true);
      return ++shown >= 300;
    });
    if (sel.count > shown) note('// … ' + (sel.count - shown) + ' more files not listed here (all are sent).');
  }
  /* grounding block — same helper the real request uses, so the preview cannot drift */
  if (st.groundMode) {
    var invB = buildInvestigationBlock(q);
    if (invB) {
      sec('GROUNDING — MERIDIAN EVIDENCE PACK · ' + invB.count + ' ITEM' + (invB.count === 1 ? '' : 'S') + ' ≈' + fmtTok(estTokens(invB.text)) + ' TOK (per question, uncached)');
      note(q ? '// deterministic findings + attributed source excerpts for the composed question — sent after the cached context so the model reasons on verified path:line evidence.'
             : '// type a question to preview the grounding evidence pack this engine will attach.');
      var gpre = document.createElement('pre');
      gpre.className = 'mapview';
      gpre.textContent = invB.text.length > 8000 ? invB.text.slice(0, 8000) + '\n… truncated for display — the full block is sent' : invB.text;
      body.appendChild(gpre);
    } else {
      note('// GROUND is ON, but this question produced no deterministic evidence — no grounding block will be sent.');
    }
  } else {
    note('// GROUND is OFF — no investigation block is attached. Toggle [ GROUND: ON ] in the rail to send verified evidence.');
  }
  rememberFocus();
  prevveil.classList.add('on');
  untrapPrev = trap(prevveil.querySelector('.viewer'));
  body.focus();
}
function closePreview() {
  prevveil.classList.remove('on');
  if (untrapPrev) { untrapPrev(); untrapPrev = null; }
  returnFocus();
}

var ctxmodebtn = $('ctxmodebtn');
function setCtxMode(m) {
  st.ctxMode = m; lsSet(LS.ctxmode, m);
  ctxmodebtn.textContent = '[ CONTEXT: ' + (m === 'smart' ? 'SMART' : 'FULL') + ' ]';
  ctxmodebtn.setAttribute('aria-pressed', String(m === 'smart'));
  ctxmodebtn.classList.toggle('on', m === 'smart');
  var note = $('smartnote');
  note.hidden = m !== 'smart' || !st.files.size;
  if (m === 'smart') note.textContent = '// smart select: each question sends a project map plus the most relevant files, packed into ≈' + fmtTok(getBudget()) + ' tokens. unchecked files are always excluded.';
  renderBudget();
}

var groundbtn = $('groundbtn');
function setGround(on) {
  st.groundMode = on; lsSet(LS.ground, on ? 'on' : 'off');
  groundbtn.textContent = '[ GROUND: ' + (on ? 'ON' : 'OFF') + ' ]';
  groundbtn.setAttribute('aria-pressed', String(on));
  groundbtn.classList.toggle('on', on);
}

/* Force Strict Trace — prepend the stricter trace instruction to every request */
var stricttracebtn = $('stricttracebtn');
function setStrictTrace(on) {
  lsSet(LS.strictTrace, on ? '1' : '0');
  stricttracebtn.textContent = '[ FORCE STRICT TRACE: ' + (on ? 'ON' : 'OFF') + ' ]';
  stricttracebtn.setAttribute('aria-pressed', String(on));
  stricttracebtn.classList.toggle('on', on);
}

function maybeAutoSmart() {
  if (st.ctxMode === 'smart') return;
  if (MODELS[st.model].local) return; /* local mode sends nothing — smart/full is moot */
  var sel = selectedTokens();
  if (sel.tokens > MODELS[st.model].ctx * AUTO_SMART_FRAC) {
    setCtxMode('smart');
    toast(sel.count + ' files ≈ ' + fmtTok(sel.tokens) + ' tokens — smart selection enabled.');
  }
}

function syncBudgetState() {
  $('budgetstate').textContent = '// current smart budget ≈ ' + fmtTok(getBudget()) + ' tokens per question' + (lsGet(LS.ctxbudget) ? ' (custom).' : ' (auto: 40% of model ctx, max 120K).');
}

function syncSpendState() {
  var v = parseFloat(lsGet(LS.spendcap) || '0');
  $('spendin').value = v > 0 ? v : '';
  $('spendstate').textContent = v > 0 ? '// limit: $' + v.toFixed(2) + ' per session — you’ll be warned before crossing it.' : '// no spend limit set.';
}
/* ---- ignore patterns (glob-lite: * matches anything) ---- */
var ignoreRes = [];
function compileIgnore(txt) {
  ignoreRes = [];
  (txt || '').split('\n').forEach(function (ln) {
    ln = ln.trim();
    if (!ln || ln.charAt(0) === '#') return;
    var re = ln.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*');
    try { ignoreRes.push(new RegExp('(^|/)' + re + '($|/)', 'i')); } catch (e) {}
  });
}
function matchesIgnore(path) {
  for (var i = 0; i < ignoreRes.length; i++) if (ignoreRes[i].test(path)) return true;
  return false;
}
function setIgnoreText(txt) {
  $('ignorein').value = txt || '';
  lsSet(LS.ignore, txt || '');
  compileIgnore(txt);
}
function getIgnoreText() { return $('ignorein').value; }
/* one-click junk-glob suggestions. Directory-level junk (node_modules, dist, .git…)
   is already covered by IGNORE_DIRS, so these target file-level noise the user would
   otherwise type by hand. When a project is loaded we only propose globs that actually
   match something present — grounded, not a wall of boilerplate. */
var IGNORE_SUGGESTIONS = ['*.min.js', '*.min.css', '*.map', '*.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '*.log', '.env', '*.snap', '__snapshots__/*', '*.wasm', '*.tsbuildinfo'];
function globTestRe(glob) {
  var re = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*');
  try { return new RegExp('(^|/)' + re + '($|/)', 'i'); } catch (e) { return null; }
}
function suggestIgnore() {
  var existing = {};
  getIgnoreText().split('\n').forEach(function (l) { l = l.trim(); if (l) existing[l] = 1; });
  var haveFiles = st.files.size > 0 || st.skippedFiles.length > 0;
  var paths = haveFiles ? Array.from(st.files.keys()).concat(st.skippedFiles.map(function (s) { return s.path; })) : null;
  var add = [];
  IGNORE_SUGGESTIONS.forEach(function (g) {
    if (existing[g]) return;
    if (paths) {
      var re = globTestRe(g);
      if (!re || !paths.some(function (p) { return re.test(p); })) return; /* grounded: only globs that hit a real path */
    }
    add.push(g);
  });
  if (!add.length) {
    toast(haveFiles ? 'No common junk files found to suggest.' : 'Common patterns are already in the list.');
    return;
  }
  var cur = getIgnoreText().replace(/\s*$/, '');
  $('ignorein').value = (cur ? cur + '\n' : '') + add.join('\n');
  $('ignorein').focus();
  toast(add.length + ' pattern' + (add.length === 1 ? '' : 's') + ' suggested — review, then Apply.', { label: '[ APPLY ]', fn: function () { $('saveignore').click(); } });
}
export { IGNORE_DIRS, afterIngest, closePreview, closeSkipReview, getIgnoreText, ingestFile, maybeAutoSmart, openPreview, openSkipReview, prevveil, recordSkip, renderBudget, selectedTokens, setCtxMode, setIgnoreText, skipveil, suggestIgnore, syncBudgetState };

export function initIngest() {
  st.files = new Map();       /* path -> {content, lines, tokens, mtime, base, checked} */
  st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0, readerr: 0 };
  st.skippedFiles = [];       /* {path, reason, size, ref} — File refs kept so users can include-back */
  ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('hot'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('hot'); }); });
  dz.addEventListener('drop', function (e) {
    st.lastDirHandle = null; /* dropped folders have no persistent handle */
    var items = e.dataTransfer.items;
    /* entries must be collected synchronously inside the drop event; the walk
       itself can run later (after the REPLACE/ADD choice below) */
    var entries = [], files = [], hasDir = false;
    if (items && items.length && items[0].webkitGetAsEntry) {
      for (var i = 0; i < items.length; i++) {
        var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
        if (entry) { entries.push(entry); if (entry.isDirectory) hasDir = true; }
      }
    } else if (e.dataTransfer.files) {
      for (var j = 0; j < e.dataTransfer.files.length; j++) files.push(e.dataTransfer.files[j]);
    }
    function run(replace) {
      if (replace) clearContext();
      beginBatch();
      var jobs = entries.map(function (en) { return walkEntry(en, ''); })
        .concat(files.map(function (f) { return ingestFile(f, null); }));
      Promise.all(jobs).then(afterIngest);
    }
    /* a whole folder dropped onto an already-loaded project is ambiguous — ask
       instead of silently merging (dismissing the toast = no-op; loose-file
       drops stay silently additive) */
    if (hasDir && st.files.size) {
      toast('Folder dropped onto a loaded project — replace it, or add to it?', [
        { label: '[ REPLACE ]', fn: function () { run(true); } },
        { label: '[ ADD ]', fn: function () { run(false); } }
      ]);
    } else run(false);
  });
  $('dirbtn').addEventListener('click', function () {
    if (window.showDirectoryPicker) {
      window.showDirectoryPicker({ mode: 'read' }).then(function (h) {
        function run(replace) {
          if (replace) clearContext();
          st.lastDirHandle = h;
          beginBatch();
          return walkHandle(h, h.name + '/').then(afterIngest);
        }
        /* same replace-or-add choice as the dropzone when a project is loaded */
        if (st.files.size) {
          toast('Folder picked with a project already loaded — replace it, or add to it?', [
            { label: '[ REPLACE ]', fn: function () { run(true); } },
            { label: '[ ADD ]', fn: function () { run(false); } }
          ]);
          return;
        }
        return run(false);
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        toast('Folder pick failed — using the fallback picker.');
        $('dirpick').click();
      });
    } else $('dirpick').click();
  });
  $('filebtn').addEventListener('click', function () { $('filepick').click(); });
  $('dirpick').addEventListener('change', function () { pickHandler(this); });
  $('filepick').addEventListener('change', function () { pickHandler(this); });
  /* tree search — debounced filter over loaded paths; Escape clears the filter
     without bubbling to the global layer-closing handler */
  var treesearch = $('treesearch'), tsTimer = null;
  treesearch.addEventListener('input', function () {
    clearTimeout(tsTimer);
    tsTimer = setTimeout(function () { treeQuery = treesearch.value; renderTree(); }, 120);
  });
  treesearch.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && treesearch.value) {
      e.stopPropagation();
      treesearch.value = ''; treeQuery = ''; renderTree();
    }
  });
  $('selall').addEventListener('click', function () { st.files.forEach(function (f) { f.checked = true; }); invalidateSelection(); renderTree(); renderBudget(); });
  $('selnone').addEventListener('click', function () { st.files.forEach(function (f) { f.checked = false; }); invalidateSelection(); renderTree(); renderBudget(); });
  $('clearctx').addEventListener('click', function () {
    clearContext();
    toast('Project unloaded from memory.');
  });
  $('skiprev').addEventListener('click', openSkipReview);
  $('skipclose').addEventListener('click', closeSkipReview);
  skipveil.addEventListener('click', function (e) { if (e.target === skipveil) closeSkipReview(); });
  $('prevbtn').addEventListener('click', openPreview);
  $('prevclose').addEventListener('click', closePreview);
  prevveil.addEventListener('click', function (e) { if (e.target === prevveil) closePreview(); });
  st.ctxMode = lsGet(LS.ctxmode) === 'smart' ? 'smart' : 'full';
  st.groundMode = lsGet(LS.ground) !== 'off'; /* Phase 5: ground model answers in the local investigation. default ON. */
  ctxmodebtn.addEventListener('click', function () { setCtxMode(st.ctxMode === 'smart' ? 'full' : 'smart'); });
  setGround(st.groundMode);
  groundbtn.addEventListener('click', function () {
    setGround(!st.groundMode);
    toast(st.groundMode ? 'Grounding on — model answers build on the local investigation.' : 'Grounding off — model receives context only.');
  });
  setStrictTrace(lsGet(LS.strictTrace) === '1');
  stricttracebtn.addEventListener('click', function () {
    setStrictTrace(lsGet(LS.strictTrace) !== '1');
    toast(lsGet(LS.strictTrace) === '1' ? 'Force strict trace on — stricter trace instruction each request.' : 'Force strict trace off.');
  });
  $('savebudget').addEventListener('click', function () {
    var v = parseInt($('budgetin').value, 10);
    if (!v || v < 4000) { lsDel(LS.ctxbudget); toast('Smart budget reset to auto.'); }
    else { lsSet(LS.ctxbudget, String(v)); toast('Smart budget set ≈ ' + fmtTok(v) + ' tokens.'); }
    $('budgetin').value = '';
    syncBudgetState(); setCtxMode(st.ctxMode);
  });
  syncBudgetState();
  $('savespend').addEventListener('click', function () {
    var v = parseFloat($('spendin').value);
    if (isNaN(v) || v <= 0) { lsDel(LS.spendcap); toast('Spend limit cleared.'); }
    else { lsSet(LS.spendcap, String(v)); toast('Spend limit set to $' + v.toFixed(2) + ' — warns before the estimate crosses it.'); }
    syncSpendState();
  });
  syncSpendState();
  $('saveignore').addEventListener('click', function () {
    setIgnoreText($('ignorein').value);
    var removed = 0;
    Array.from(st.files.keys()).forEach(function (p) {
      if (matchesIgnore(p)) { st.files.delete(p); removed++; }
    });
    if (removed) { invalidateAll(); renderTree(); renderBudget(); }
    toast(removed ? removed + ' loaded file' + (removed === 1 ? '' : 's') + ' removed by patterns.' : 'Ignore patterns saved.');
  });
  $('suggestignore').addEventListener('click', suggestIgnore);
  setIgnoreText(lsGet(LS.ignore) || '');
}
