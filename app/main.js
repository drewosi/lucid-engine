/* MERIDIAN Engine v0.2-hardened — resilient trace parsing, multi-language indexing
   (Python/Go/Rust + JS/TS depth), selection-decoupled index, pragmatic CSP, custom-
   endpoint validation, BOM-aware encoding, streaming retries, a11y, and self-tests. */
import { st, sortedPaths, invalidateSelection, invalidateAll } from './state.js';
import { PROVIDERS, MODELS, LS } from './config.js';
import { $, app, esc, lsGet, lsSet, lsDel, toast, copyText, fmtTok, announce,
         rememberFocus, returnFocus, prefersReduced, trap, setStatus } from './helpers.js';
import { AUTO_SMART_FRAC, CONFIG_NAMES, DOCS_PATH, ENTRY_NAMES, GROUND_EXCERPT_PAD, GROUND_EXCERPT_TOK, GROUND_MAX_CITES, GROUND_MAX_EVIDENCE, GROUND_MAX_TOK, README_NAMES, TEST_PATH, buildProjectMap, detectPackages, estTokens, getBudget, numberLines, packSmartContext, queryTerms, staticScore } from './smart-context.js';
import { buildIndex, detectLang, dirOf, fileExt, getIndex } from './indexer.js';
import { closeViewer, openViewer, viewveil, initViewer } from './viewer.js';
import { localSearchData, renderActions } from './actions.js';
import { addAiMsg, addUserMsg, attachCopy, convoIn, evExcerpt, exchangeMarkdown, extractTrace, renderFound, renderRich, renderTrace, scrollEnd } from './trace.js';
import { exportTraces, initExport } from './export.js';

st.curProvider = lsGet(LS.provider);
if (!PROVIDERS[st.curProvider]) st.curProvider = 'anthropic';

/* the custom provider is one synthetic MODELS entry, refreshed from settings */
function syncCustomModel() {
  var id = lsGet(LS.cmodel) || '';
  MODELS.__custom = { provider: 'custom', label: (id || 'CUSTOM — SET MODEL').toUpperCase().slice(0, 24), ctx: 200000,
                      rIn: 0, rOut: 0, rCacheW: 0, rCacheR: 0, unknownRates: true,
                      note: (id ? id : 'custom endpoint') + ' — rates unknown; context window assumed 200K. configure under PROVIDER in settings.' };
}
syncCustomModel();

st.model = lsGet(LS.model);
if (!MODELS[st.model]) st.model = 'claude-sonnet-5';
if (MODELS[st.model].provider !== st.curProvider) {
  st.model = st.curProvider === 'custom' ? '__custom'
    : Object.keys(MODELS).filter(function (id) { return MODELS[id].provider === st.curProvider; })[0];
}

var modelsel = $('modelsel');
function syncModelSel() {
  modelsel.innerHTML = '';
  var ids = st.curProvider === 'custom' ? ['__custom']
    : Object.keys(MODELS).filter(function (id) { return MODELS[id].provider === st.curProvider; });
  ids.forEach(function (id) {
    var o = document.createElement('option');
    o.value = id; o.textContent = MODELS[id].label;
    modelsel.appendChild(o);
  });
  if (ids.indexOf(st.model) === -1) st.model = ids[0];
  modelsel.value = st.model;
  lsSet(LS.model, st.model);
  syncModelNote();
}
function syncModelNote() {
  var m = MODELS[st.model];
  $('modelnote').textContent = m.unknownRates
    ? '// ' + m.note
    : '// ' + m.note + ' rates ≈ $' + m.rIn + ' / $' + m.rOut + ' per MTok in/out, billed by ' + PROVIDERS[m.provider].label.toLowerCase() + '.';
}
modelsel.addEventListener('change', function () {
  st.model = modelsel.value; lsSet(LS.model, st.model);
  syncModelNote(); renderBudget(); maybeAutoSmart();
});
syncModelSel();

/* ============ MODE ============ */
var modebtn = $('modebtn'), modebtn2 = $('modebtn2');
function setMode(m) {
  app.dataset.mode = m; lsSet(LS.mode, m);
  var label = 'MODE: ' + (m === 'dark' ? 'CEREMONY' : 'DAYLIGHT');
  modebtn.textContent = label; modebtn2.textContent = label;
}
setMode(lsGet(LS.mode) === 'light' ? 'light' : 'dark');
function flipMode() { setMode(app.dataset.mode === 'dark' ? 'light' : 'dark'); }
modebtn.addEventListener('click', flipMode);
modebtn2.addEventListener('click', flipMode);

/* ============ FIRST RUN ============ */
var firstveil = $('firstveil');
var accepted = null;
try { accepted = JSON.parse(lsGet(LS.accepted) || 'null'); } catch (e) {}
var untrapFR = null;
if (!accepted || accepted.version !== 1) {
  firstveil.classList.add('on');
  untrapFR = trap($('firstrun'));
  $('fr-accept').focus();
}
$('fr-accept').addEventListener('click', function () {
  lsSet(LS.accepted, JSON.stringify({ ts: Date.now(), version: 1 }));
  firstveil.classList.remove('on');
  if (untrapFR) untrapFR();
  $('prompt').focus();
});

/* ============ SETTINGS DRAWER + KEY ============ */
var drawer = $('drawer'), setbtn = $('setbtn');
function keyMasked(k) { return k.length > 12 ? k.slice(0, 10) + '…' + k.slice(-4) : '…' + k.slice(-4); }
function curKeyLS() { return PROVIDERS[st.curProvider].keyLS; }
function syncKeyState() {
  var k = lsGet(curKeyLS());
  $('keystate').innerHTML = k
    ? 'key held: <span class="on">' + esc(keyMasked(k)) + '</span> — in this browser only'
    : (st.curProvider === 'custom' ? 'no key saved — fine for local endpoints that need none.' : 'no key saved. requests cannot run without one.');
}

/* provider switching */
var provsel = $('provsel');
provsel.value = st.curProvider;
function syncProviderUI() {
  provsel.value = st.curProvider;
  $('navprov').value = st.curProvider;
  $('provnote').textContent = PROVIDERS[st.curProvider].note;
  $('keysec').hidden = st.curProvider === 'local';
  if (st.curProvider !== 'local') {
    $('keyhd').textContent = PROVIDERS[st.curProvider].label + ' API KEY';
    $('keyin').placeholder = PROVIDERS[st.curProvider].keyHint;
  }
  $('customcfg').hidden = st.curProvider !== 'custom';
  if (st.curProvider === 'custom') {
    $('custurl').value = lsGet(LS.curl) || '';
    $('custmodel').value = lsGet(LS.cmodel) || '';
  }
  syncKeyState();
  syncModelSel();
  renderBudget();
}
/* setProvider is the single switch point — reused by the drawer select, the
   nav quick-switch, and the first-run demo. syncProviderUI keeps both selects
   and the key/model UI in agreement. */
function setProvider(p) {
  if (!PROVIDERS[p]) return;
  st.curProvider = p;
  lsSet(LS.provider, st.curProvider);
  syncProviderUI();
  maybeAutoSmart();
}
provsel.addEventListener('change', function () { setProvider(provsel.value); });
$('navprov').addEventListener('change', function () { setProvider($('navprov').value); });
function setCustState(msg, kind) {
  var el = $('custstate');
  el.textContent = msg ? '// ' + msg : '';
  el.style.color = kind === 'err' ? 'var(--err)' : kind === 'ok' ? 'var(--ok)' : 'var(--ink-3)';
}
/* validate + normalize a custom OpenAI-compatible base URL; warns (does not block)
   on a missing /v1 suffix and on non-localhost http:// (mixed-content on an https page) */
function validateCustomUrl(u) {
  if (!u) return { ok: false, msg: 'enter a base URL (e.g. http://localhost:11434/v1)' };
  var parsed;
  try { parsed = new URL(u); } catch (e) { return { ok: false, msg: 'not a valid URL' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, msg: 'URL must be http:// or https://' };
  var warn = '';
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(parsed.hostname);
  if (parsed.protocol === 'http:' && !isLocal) warn += 'http:// works only for localhost on this https page (browsers block mixed content). ';
  if (!/\/v\d+\/?$/.test(parsed.pathname)) warn += 'most OpenAI-compatible servers expect a /v1 suffix. ';
  return { ok: true, msg: warn.trim(), warn: warn.trim() };
}
$('custsave').addEventListener('click', function () {
  var u = $('custurl').value.trim().replace(/\/+$/, '');
  var m = $('custmodel').value.trim();
  var v = validateCustomUrl(u);
  if (u && !v.ok) { setCustState(v.msg, 'err'); toast('Endpoint URL invalid — ' + v.msg + '.'); return; }
  if (u) lsSet(LS.curl, u); else lsDel(LS.curl);
  if (m) lsSet(LS.cmodel, m); else lsDel(LS.cmodel);
  syncCustomModel(); syncModelSel(); renderBudget();
  setCustState(u && m ? ('saved.' + (v.warn ? ' ' + v.warn : '')) : '', v.warn ? 'note' : 'ok');
  toast(u && m ? 'Custom endpoint saved.' : 'Custom endpoint needs both a base URL and a model id.');
});
/* EXPERIMENTAL: probe the endpoint's /models to report reachability, CORS, and latency */
$('custtest').addEventListener('click', function () {
  var u = $('custurl').value.trim().replace(/\/+$/, '');
  var v = validateCustomUrl(u);
  if (!v.ok) { setCustState(v.msg, 'err'); return; }
  setCustState('testing…', 'note');
  var headers = {}, k = lsGet(LS.ckey) || '';
  if (k) headers.authorization = 'Bearer ' + k;
  var t0 = (window.performance && performance.now) ? performance.now() : 0;
  var ctrl = new AbortController(), to = setTimeout(function () { ctrl.abort(); }, 8000);
  fetch(u + '/models', { method: 'GET', headers: headers, signal: ctrl.signal }).then(function (res) {
    clearTimeout(to);
    var ms = t0 ? ' · ' + Math.round(performance.now() - t0) + ' ms' : '';
    if (res.ok || res.status === 401 || res.status === 400) setCustState('reachable' + ms + (res.status === 401 ? ' (needs a key)' : ''), 'ok');
    else setCustState('reached, HTTP ' + res.status + ' — check the base path' + ms, 'note');
  }).catch(function (err) {
    clearTimeout(to);
    setCustState(err.name === 'AbortError' ? 'timed out (>8s) — is the server running?' : 'unreachable or CORS-blocked — the server must allow browser CORS from this origin', 'err');
  });
});
/* syncProviderUI() is called in the init block at the end of the script —
   it touches the budget UI, which needs the context engine set up first. */
function openDrawer(open) {
  drawer.classList.toggle('open', open);
  setbtn.setAttribute('aria-expanded', String(open));
  if (open) $('keyin').focus();
}
setbtn.addEventListener('click', function () { openDrawer(!drawer.classList.contains('open')); });
$('savekey').addEventListener('click', function () {
  var v = $('keyin').value.trim();
  if (!v) { toast('Paste a key first.'); return; }
  if (st.curProvider === 'anthropic' && v.indexOf('sk-ant-') !== 0) { toast('That does not look like an Anthropic key (sk-ant-…). Saved anyway.'); }
  lsSet(curKeyLS(), v);
  $('keyin').value = '';
  syncKeyState();
  toast(PROVIDERS[st.curProvider].label + ' key saved — in this browser only.');
});
$('keyin').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); $('savekey').click(); }
});
$('clearkey').addEventListener('click', function () {
  lsDel(curKeyLS()); syncKeyState(); toast(PROVIDERS[st.curProvider].label + ' key removed from this browser.');
});
$('clearall').addEventListener('click', function () {
  Object.keys(LS).forEach(function (k) { lsDel(LS[k]); });
  lsDel('meridian.waitlist');
  try { if (idb) idb.close(); indexedDB.deleteDatabase('meridian'); } catch (e) {}
  toast('All Meridian data cleared from this browser.');
  setTimeout(function () { location.reload(); }, 600);
});

/* mobile rail toggle */
var railbtn = $('railbtn'), rail = $('rail');
railbtn.addEventListener('click', function () {
  var open = !rail.classList.contains('open');
  rail.classList.toggle('open', open);
  railbtn.setAttribute('aria-expanded', String(open));
});

/* ============ CONTEXT ENGINE ============ */
st.files = new Map();       /* path -> {content, lines, tokens, mtime, base, checked} */
st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0 };
st.skippedFiles = [];       /* {path, reason, size, ref} — File refs kept so users can include-back */
var SKIP_LIST_MAX = 500;
function recordSkip(path, reason, size, ref) {
  if (st.skippedFiles.length < SKIP_LIST_MAX) st.skippedFiles.push({ path: path, reason: reason, size: size || 0, ref: ref || null });
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
  }).catch(function () { st.skipped.binary++; });
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
  var s = [];
  if (st.skipped.binary) s.push(st.skipped.binary + ' binary');
  if (st.skipped.big) s.push(st.skipped.big + ' oversized');
  if (st.skipped.dirs) s.push(st.skipped.dirs + ' ignored-dir');
  if (st.skipped.user) s.push(st.skipped.user + ' ignore-pattern');
  if (st.skipped.over) s.push(st.skipped.over + ' over the ' + MAX_FILES + '-file cap');
  var totSkipped = st.skipped.binary + st.skipped.big + st.skipped.dirs + st.skipped.user + st.skipped.over;
  var note = $('skipnote');
  note.hidden = !s.length;
  if (s.length) note.textContent = '// ' + totSkipped + ' skipped: ' + s.join(' · ') + '. caps: ' + (MAX_FILE / 1024) + 'KB/file, ' + MAX_FILES + ' files.';
  $('skiprevrow').hidden = !st.skippedFiles.length;
  updateSkipBadge();
  var base = st.files.size + ' file' + (st.files.size === 1 ? '' : 's') + ' loaded into memory';
  if (totSkipped && st.skippedFiles.length) toast(base + ' · ' + totSkipped + ' skipped.', { label: '[ REVIEW ]', fn: openSkipReview });
  else toast(base + (totSkipped ? ' · ' + totSkipped + ' skipped.' : '.'));
  renderOverview();
  setStatus('CORE IDLE — ' + st.files.size + ' files in memory');
  /* graceful scaling: warn as the in-memory file cap approaches or is hit */
  if (st.skipped.over) toast('File cap reached (' + MAX_FILES + ') — ' + st.skipped.over + ' file' + (st.skipped.over === 1 ? '' : 's') + ' not loaded. Narrow the folder or add ignore patterns.');
  else if (st.files.size >= Math.floor(MAX_FILES * 0.9)) toast('Approaching the ' + MAX_FILES + '-file cap (' + st.files.size + ' loaded) — large repos may hit it; ignore patterns help.');
  maybeAutoSmart();
}

/* ---- first-run demo: a tiny bundled project answered by the LOCAL engine, so a
   new visitor sees a real trace + evidence chips before committing an API key.
   File contents are line arrays (no template literals / backticks) to stay robust
   inside this single inline script. ---- */
var SAMPLE_PROJECT = {
  'README.md': [
    '# todo-api',
    '',
    'A tiny in-memory todo REST API — the sample project for MERIDIAN\'s demo.',
    '',
    '## Run',
    '',
    '    npm install',
    '    npm start',
    '',
    'The server boots from src/index.js, listens on the PORT from src/config.js,',
    'and mounts every route under API_BASE_URL.',
    '',
    '## Layout',
    '',
    '- src/index.js  — entry point; boots the server',
    '- src/server.js — HTTP routes, wired to the store',
    '- src/store.js  — in-memory todo store (addTodo, listTodos, removeTodo)',
    '- src/config.js — API_BASE_URL and PORT',
    '- src/util.js   — small response helpers',
    '- test/store.test.js — store unit tests'
  ].join('\n'),
  'package.json': [
    '{',
    '  "name": "todo-api",',
    '  "version": "1.0.0",',
    '  "description": "A tiny in-memory todo REST API (MERIDIAN demo project).",',
    '  "main": "src/index.js",',
    '  "scripts": {',
    '    "start": "node src/index.js",',
    '    "test": "node test/store.test.js"',
    '  }',
    '}'
  ].join('\n'),
  'src/config.js': [
    '// Central configuration for the todo API.',
    'const PORT = process.env.PORT || 3000;',
    '',
    '// The base URL every route is mounted under.',
    'const API_BASE_URL = process.env.API_BASE_URL || ("http://localhost:" + PORT + "/api/v1");',
    '',
    'module.exports = { PORT, API_BASE_URL };'
  ].join('\n'),
  'src/store.js': [
    '// In-memory todo store. No database — state lives for the process lifetime.',
    'let todos = [];',
    'let nextId = 1;',
    '',
    'function addTodo(title) {',
    '  const todo = { id: nextId++, title: title, done: false };',
    '  todos.push(todo);',
    '  return todo;',
    '}',
    '',
    'function listTodos() {',
    '  return todos.slice();',
    '}',
    '',
    'function removeTodo(id) {',
    '  const before = todos.length;',
    '  todos = todos.filter(function (t) { return t.id !== id; });',
    '  return todos.length < before;',
    '}',
    '',
    'module.exports = { addTodo, listTodos, removeTodo };'
  ].join('\n'),
  'src/server.js': [
    'const http = require("http");',
    'const { API_BASE_URL } = require("./config");',
    'const { addTodo, listTodos } = require("./store");',
    'const { json } = require("./util");',
    '',
    '// Build the HTTP server. Routes are mounted under API_BASE_URL.',
    'function createServer() {',
    '  return http.createServer(function (req, res) {',
    '    if (req.url === API_BASE_URL + "/todos" && req.method === "GET") {',
    '      return json(res, 200, listTodos());',
    '    }',
    '    if (req.url === API_BASE_URL + "/todos" && req.method === "POST") {',
    '      return json(res, 201, addTodo("new todo"));',
    '    }',
    '    json(res, 404, { error: "not found" });',
    '  });',
    '}',
    '',
    'module.exports = { createServer };'
  ].join('\n'),
  'src/util.js': [
    '// Small response helpers shared across routes.',
    'function json(res, status, body) {',
    '  res.writeHead(status, { "Content-Type": "application/json" });',
    '  res.end(JSON.stringify(body));',
    '}',
    '',
    'module.exports = { json };'
  ].join('\n'),
  'src/index.js': [
    '// Entry point: boot the todo API server.',
    'const { createServer } = require("./server");',
    'const { PORT, API_BASE_URL } = require("./config");',
    '',
    'const server = createServer();',
    'server.listen(PORT, function () {',
    '  console.log("todo-api listening — API at " + API_BASE_URL);',
    '});'
  ].join('\n'),
  'test/store.test.js': [
    'const assert = require("assert");',
    'const { addTodo, listTodos, removeTodo } = require("../src/store");',
    '',
    '// addTodo appends and returns the new record',
    'const a = addTodo("write docs");',
    'assert.strictEqual(a.done, false);',
    'assert.ok(listTodos().length >= 1);',
    '',
    '// removeTodo drops it',
    'assert.strictEqual(removeTodo(a.id), true);',
    'console.log("store tests passed");'
  ].join('\n')
};
var DEMO_QUESTIONS = ['where is API_BASE_URL defined?', 'what imports store.js?', 'show the entry points'];
st.demoMode = false;

function loadSampleProject() {
  st.files.clear();
  st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0 };
  st.skippedFiles.length = 0;
  Object.keys(SAMPLE_PROJECT).forEach(function (path) {
    var text = SAMPLE_PROJECT[path];
    st.files.set(path, {
      content: text,
      lines: text.split('\n').length,
      tokens: estTokens(text, path),
      mtime: 0,
      base: staticScore(path),
      checked: true
    });
  });
  afterIngest(); /* same post-ingest path as a real folder load */
}

function renderDemoBanner() {
  if ($('demobanner')) return;
  var b = document.createElement('div');
  b.id = 'demobanner'; b.className = 'demobanner';
  var top = document.createElement('div');
  top.innerHTML = '<span class="dm mono">DEMO · LOCAL ENGINE</span>';
  var dt = document.createElement('div');
  dt.className = 'dt';
  dt.innerHTML = 'A sample <b>todo-api</b> project is loaded and answered by the deterministic <b>LOCAL</b> engine — no key, no AI, nothing leaves this tab. Try a question, then load your own project when ready.';
  b.appendChild(top); b.appendChild(dt);
  var chips = document.createElement('div'); chips.className = 'demochips';
  DEMO_QUESTIONS.forEach(function (q) {
    var c = document.createElement('button');
    c.type = 'button'; c.className = 'demochip mono'; c.textContent = q;
    c.addEventListener('click', function () { promptEl.value = q; $('askform').requestSubmit(); });
    chips.appendChild(c);
  });
  b.appendChild(chips);
  var acts = document.createElement('div'); acts.className = 'demoacts';
  var load = document.createElement('button');
  load.type = 'button'; load.className = 'btn-quiet acc'; load.textContent = '[ LOAD YOUR OWN → ]';
  load.addEventListener('click', exitDemo);
  var dis = document.createElement('button');
  dis.type = 'button'; dis.className = 'btn-quiet'; dis.textContent = '[ dismiss ]';
  dis.addEventListener('click', function () { b.remove(); });
  acts.appendChild(load); acts.appendChild(dis);
  b.appendChild(acts);
  convoIn.insertBefore(b, convoIn.firstChild);
}

function exitDemo() {
  st.demoMode = false;
  var b = $('demobanner'); if (b) b.remove();
  $('clearctx').click(); /* unloads the sample project (and toasts) */
  if (window.innerWidth <= 860 && !rail.classList.contains('open')) { rail.classList.add('open'); railbtn.setAttribute('aria-expanded', 'true'); }
  var dz2 = $('dropzone'); if (dz2 && dz2.scrollIntoView) dz2.scrollIntoView({ block: 'nearest' });
}

function startDemo() {
  /* accept the same terms record the normal path writes, then hand the demo to LOCAL */
  lsSet(LS.accepted, JSON.stringify({ ts: Date.now(), version: 1 }));
  firstveil.classList.remove('on');
  if (untrapFR) untrapFR();
  st.demoMode = true;
  setProvider('local');
  loadSampleProject();
  renderDemoBanner();
  promptEl.value = DEMO_QUESTIONS[0];
  $('askform').requestSubmit(); /* LOCAL engine answers instantly — trace + evidence chips */
}
$('fr-demo').addEventListener('click', startDemo);
$('emptydemo').addEventListener('click', startDemo);

var dz = $('dropzone');
['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('hot'); }); });
['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('hot'); }); });
dz.addEventListener('drop', function (e) {
  st.lastDirHandle = null; /* dropped folders have no persistent handle */
  var items = e.dataTransfer.items;
  var jobs = [];
  if (items && items.length && items[0].webkitGetAsEntry) {
    for (var i = 0; i < items.length; i++) {
      var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (entry) jobs.push(walkEntry(entry, ''));
    }
  } else if (e.dataTransfer.files) {
    for (var j = 0; j < e.dataTransfer.files.length; j++) jobs.push(ingestFile(e.dataTransfer.files[j], null));
  }
  Promise.all(jobs).then(afterIngest);
});
/* Prefer the File System Access API when available — its directory handle can be
   persisted to IndexedDB, enabling one-click project reload later. */
$('dirbtn').addEventListener('click', function () {
  if (window.showDirectoryPicker) {
    window.showDirectoryPicker({ mode: 'read' }).then(function (h) {
      st.lastDirHandle = h;
      return walkHandle(h, h.name + '/').then(afterIngest);
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      toast('Folder pick failed — using the fallback picker.');
      $('dirpick').click();
    });
  } else $('dirpick').click();
});
$('filebtn').addEventListener('click', function () { $('filepick').click(); });
function pickHandler(input) {
  st.lastDirHandle = null;
  var list = Array.prototype.slice.call(input.files || []);
  Promise.all(list.map(function (f) { return ingestFile(f, f.webkitRelativePath || f.name); })).then(afterIngest);
  input.value = '';
}
$('dirpick').addEventListener('change', function () { pickHandler(this); });
$('filepick').addEventListener('change', function () { pickHandler(this); });


function renderTree() {
  var tree = $('tree');
  tree.innerHTML = '';
  var paths = sortedPaths();
  $('filecount').textContent = paths.length ? paths.length + ' FILES' : '';
  $('ctxactions').hidden = !paths.length;
  $('budget').hidden = !paths.length;
  $('ctxmoderow').hidden = !paths.length;
  $('smartnote').hidden = !paths.length || st.ctxMode !== 'smart';
  var lastDir = null;
  paths.forEach(function (p) {
    var dir = p.indexOf('/') === -1 ? '' : p.slice(0, p.lastIndexOf('/'));
    if (dir !== lastDir) {
      lastDir = dir;
      var d = document.createElement('button');
      d.type = 'button'; d.className = 'dir-row mono';
      d.textContent = (dir || './') + ' — toggle';
      d.setAttribute('aria-label', 'Toggle all files in ' + (dir || 'project root'));
      d.dataset.dir = dir;
      d.addEventListener('click', function () {
        var mine = paths.filter(function (q) { return (q.indexOf('/') === -1 ? '' : q.slice(0, q.lastIndexOf('/'))) === this.dataset.dir; }, this);
        var anyOff = mine.some(function (q) { return !st.files.get(q).checked; });
        mine.forEach(function (q) { st.files.get(q).checked = anyOff; });
        invalidateSelection(); renderTree(); renderBudget(); /* selection change: symbol/import index unaffected */
      });
      tree.appendChild(d);
    }
    var f = st.files.get(p);
    var row = document.createElement('div');
    row.className = 'file-row';
    var lab = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = f.checked;
    cb.addEventListener('change', function () { f.checked = cb.checked; invalidateSelection(); renderBudget(); });
    var nm = document.createElement('span');
    nm.className = 'nm'; nm.textContent = p.slice(dir ? dir.length + 1 : 0);
    nm.title = p;
    lab.appendChild(cb); lab.appendChild(nm);
    var tk = document.createElement('span');
    tk.className = 'tk'; tk.textContent = '≈' + fmtTok(f.tokens);
    row.appendChild(lab); row.appendChild(tk);
    tree.appendChild(row);
  });
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

$('selall').addEventListener('click', function () { st.files.forEach(function (f) { f.checked = true; }); invalidateSelection(); renderTree(); renderBudget(); });
$('selnone').addEventListener('click', function () { st.files.forEach(function (f) { f.checked = false; }); invalidateSelection(); renderTree(); renderBudget(); });
$('clearctx').addEventListener('click', function () {
  st.files.clear(); st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0 };
  st.skippedFiles.length = 0;
  invalidateAll(); renderTree(); renderBudget();
  renderOverview();
  $('skipnote').hidden = true;
  $('skiprevrow').hidden = true;
  updateSkipBadge();
  toast('Project unloaded from memory.');
});

/* ---- skipped-file review + include-back ---- */
var skipveil = $('skipveil'), untrapSkip = null;
var SKIP_LABEL = { oversized: 'OVERSIZED', 'ignore-pattern': 'IGNORE PATTERN', 'binary-ext': 'BINARY EXTENSION', 'binary-content': 'BINARY CONTENT — CANNOT INCLUDE' };
function openSkipReview() {
  var list = $('skiplist');
  list.innerHTML = '';
  var order = ['oversized', 'ignore-pattern', 'binary-ext', 'binary-content'];
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
$('skiprev').addEventListener('click', openSkipReview);
$('skipclose').addEventListener('click', closeSkipReview);
skipveil.addEventListener('click', function (e) { if (e.target === skipveil) closeSkipReview(); });

/* ---- context send preview ----
   Shows exactly what the next question will send, computed by the SAME
   functions the request uses (buildProjectMap / packSmartContext /
   assembleContext) — the preview cannot drift from reality. */
var prevveil = $('prevveil'), untrapPrev = null;
function openPreview() {
  if (!st.files.size) { toast('Load a project first.'); return; }
  var q = promptEl.value.trim();
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
$('prevbtn').addEventListener('click', openPreview);
$('prevclose').addEventListener('click', closePreview);
prevveil.addEventListener('click', function (e) { if (e.target === prevveil) closePreview(); });

st.ctxMode = lsGet(LS.ctxmode) === 'smart' ? 'smart' : 'full';
st.groundMode = lsGet(LS.ground) !== 'off'; /* Phase 5: ground model answers in the local investigation. default ON. */

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
ctxmodebtn.addEventListener('click', function () { setCtxMode(st.ctxMode === 'smart' ? 'full' : 'smart'); });

var groundbtn = $('groundbtn');
function setGround(on) {
  st.groundMode = on; lsSet(LS.ground, on ? 'on' : 'off');
  groundbtn.textContent = '[ GROUND: ' + (on ? 'ON' : 'OFF') + ' ]';
  groundbtn.setAttribute('aria-pressed', String(on));
  groundbtn.classList.toggle('on', on);
}
setGround(st.groundMode);
groundbtn.addEventListener('click', function () {
  setGround(!st.groundMode);
  toast(st.groundMode ? 'Grounding on — model answers build on the local investigation.' : 'Grounding off — model receives context only.');
});

/* Force Strict Trace — prepend the stricter trace instruction to every request */
var stricttracebtn = $('stricttracebtn');
function setStrictTrace(on) {
  lsSet(LS.strictTrace, on ? '1' : '0');
  stricttracebtn.textContent = '[ FORCE STRICT TRACE: ' + (on ? 'ON' : 'OFF') + ' ]';
  stricttracebtn.setAttribute('aria-pressed', String(on));
  stricttracebtn.classList.toggle('on', on);
}
setStrictTrace(lsGet(LS.strictTrace) === '1');
stricttracebtn.addEventListener('click', function () {
  setStrictTrace(lsGet(LS.strictTrace) !== '1');
  toast(lsGet(LS.strictTrace) === '1' ? 'Force strict trace on — stricter trace instruction each request.' : 'Force strict trace off.');
});

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
$('savebudget').addEventListener('click', function () {
  var v = parseInt($('budgetin').value, 10);
  if (!v || v < 4000) { lsDel(LS.ctxbudget); toast('Smart budget reset to auto.'); }
  else { lsSet(LS.ctxbudget, String(v)); toast('Smart budget set ≈ ' + fmtTok(v) + ' tokens.'); }
  $('budgetin').value = '';
  syncBudgetState(); setCtxMode(st.ctxMode);
});
syncBudgetState();

function syncSpendState() {
  var v = parseFloat(lsGet(LS.spendcap) || '0');
  $('spendin').value = v > 0 ? v : '';
  $('spendstate').textContent = v > 0 ? '// limit: $' + v.toFixed(2) + ' per session — you’ll be warned before crossing it.' : '// no spend limit set.';
}
$('savespend').addEventListener('click', function () {
  var v = parseFloat($('spendin').value);
  if (isNaN(v) || v <= 0) { lsDel(LS.spendcap); toast('Spend limit cleared.'); }
  else { lsSet(LS.spendcap, String(v)); toast('Spend limit set to $' + v.toFixed(2) + ' — warns before the estimate crosses it.'); }
  syncSpendState();
});
syncSpendState();

/* ============ PROJECT MEMORY (IndexedDB) ============
   Saves named projects: file-tree summary, selection, ignore patterns and
   context prefs — NEVER file contents. When the folder was opened through
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
        jobs.push(entry.getFile().then(function (f) { return ingestFile(f, prefix + entry.name); }).catch(function () { st.skipped.binary++; }));
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
      st.files.clear(); st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0 };
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

$('saveproj').addEventListener('click', function () {
  if (!st.files.size) { toast('Load a project first.'); return; }
  var name = window.prompt('Save project as:', guessProjectName());
  if (name === null) return;
  name = name.trim().slice(0, 60) || 'project';
  var tree = [], unchecked = [], total = 0;
  st.files.forEach(function (f, p) {
    tree.push({ path: p, tokens: f.tokens, mtime: f.mtime });
    total += f.tokens;
    if (!f.checked) unchecked.push(p);
  });
  var rec = {
    name: name, savedAt: Date.now(), fileCount: st.files.size, totalTokens: total,
    tree: tree, unchecked: unchecked, ignore: getIgnoreText(),
    prefs: { ctxmode: st.ctxMode, budget: parseInt(lsGet(LS.ctxbudget), 10) || 0 },
    handle: st.lastDirHandle || null
  };
  idbPut(rec).then(function () {
    toast(rec.handle
      ? '“' + name + '” saved — one-click reload enabled (tree + settings only, never contents).'
      : '“' + name + '” saved — settings + selection only; ' + (window.showDirectoryPicker ? 'open via [ PICK FOLDER ] to enable one-click reload.' : 'this browser can’t re-open folders — re-drop to reload.'));
    renderProjects();
  }).catch(function (e) {
    /* a handle that cannot be cloned (rare) — retry without it */
    rec.handle = null;
    idbPut(rec).then(function () { toast('“' + name + '” saved (without reload handle).'); renderProjects(); })
      .catch(function () { toast('Save failed: ' + ((e && e.message) || 'IndexedDB unavailable.')); });
  });
});

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
$('saveignore').addEventListener('click', function () {
  setIgnoreText($('ignorein').value);
  var removed = 0;
  Array.from(st.files.keys()).forEach(function (p) {
    if (matchesIgnore(p)) { st.files.delete(p); removed++; }
  });
  if (removed) { invalidateAll(); renderTree(); renderBudget(); }
  toast(removed ? removed + ' loaded file' + (removed === 1 ? '' : 's') + ' removed by patterns.' : 'Ignore patterns saved.');
});
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
$('suggestignore').addEventListener('click', suggestIgnore);
setIgnoreText(lsGet(LS.ignore) || '');
renderProjects();

/* ============ PROMPT ASSEMBLY ============ */
var FENCE = '```meridian-trace';
var INSTRUCTIONS = [
  'You are MERIDIAN, an AI instrument that answers questions with full evidence traces.',
  '',
  'Rules:',
  '- Ground answers in the provided project files whenever they are relevant. If the loaded context is insufficient to answer, say so plainly and lower your confidence.',
  '- Be precise and concise. Plain prose; short code snippets only when they help.',
  '- After the answer, output exactly one fenced code block tagged meridian-trace containing only valid JSON of this shape:',
  '',
  FENCE,
  '{"steps":[{"n":1,"action":"short verb phrase","note":"what this step established","evidence":[{"file":"path/exactly/as/given.js","startLine":12,"endLine":30,"quote":"short verbatim excerpt"}]}],"confidence":0.87}',
  '```',
  '',
  '- steps: 1 to 6 items, in reasoning order.',
  '- evidence: each item MUST cite a file path exactly as it appears after "FILE:" in the context, with 1-indexed line numbers matching the numbered lines, and a verbatim quote of at most 120 characters. Never invent files or line numbers. A pure-reasoning step may have an empty evidence array.',
  '- Context may include a PROJECT MAP block (file tree + key-file heads) and a question-relevant subset of files. Excerpted files keep their true line numbers; gaps are marked "··· lines A–B omitted ···". Cite only line ranges you can actually see.',
  '- Context may include a <MERIDIAN_PROJECT_INTELLIGENCE> block produced by Meridian\'s deterministic local engine before your turn. It has typed sections: DETERMINISTIC FINDINGS, SYMBOLS, RELATED FILES, TESTS, RECENT CHANGES (all facts read from the project index — treat as verified, not your own inference), SOURCE EVIDENCE (attributed, line-true excerpts, each tagged "[Evidence NN]" with File / Lines / Kind), and MODEL TASK. Build your reasoning on these findings and excerpts, reuse their exact path:line ranges in your evidence, and clearly separate evidence-backed conclusions from hypotheses — never assert a fact the provided evidence does not support.',
  '- If the map shows a file you cannot see that would answer better, name it and suggest the user ask again mentioning it.',
  '- confidence: a number from 0 to 1 — your honest estimate.',
  '- Optionally include "actions": up to 4 read-only items {"kind","command","filter"?,"why"} that run only after the user clicks. Kinds — search (substring/regex over loaded files; optional "filter" path glob with *), def / refs (definition sites / references of a symbol), dir (summarize a loaded dir; command = path), recent (list recent files; command = a count like "10"), open (a context file worth inspecting), git (read-only status/diff/log/show/blame for the user\'s terminal). Never propose anything that writes, deletes, or installs.',
  '- If no project files are loaded, still emit the block with reasoning steps and empty evidence arrays.',
  '- Emit exactly ONE meridian-trace block and output nothing after its closing fence. Do not tag it ```json or anything else.',
  '- The trace MUST be valid JSON: double-quoted keys and strings, no comments, no trailing commas. If you cannot produce valid trace JSON, still give your prose answer and emit a minimal valid trace (one step, empty evidence) — never emit broken JSON.'
].join('\n');
/* appended on demand (RE-GROUND) or when the user enables Force Strict Trace */
var STRICT_SUFFIX = '\n\nSTRICT MODE: A prior response could not be parsed into a trace. End with exactly one ```meridian-trace fenced block of strictly valid JSON — no prose, comments, or trailing commas after it. Prefer fewer steps over invalid JSON.';

var CTX_PREAMBLE = 'The user\'s loaded project files follow. Each file begins with "═══ FILE: <path> ═══" and every line is prefixed with its 1-indexed line number and "│".';

st.contextDirty = true; st.contextCache = '';
function assembleContext() {
  if (!st.contextDirty) return st.contextCache;
  var parts = [];
  sortedPaths().forEach(function (p) {
    var f = st.files.get(p);
    if (!f.checked) return;
    parts.push('═══ FILE: ' + p + ' ═══\n' + numberLines(f.content, 1));
  });
  st.contextCache = parts.length ? CTX_PREAMBLE + '\n\n' + parts.join('\n\n') : '';
  st.contextDirty = false;
  return st.contextCache;
}

/* Phase 2 — evidence-kind label for a step/intent, so every excerpt in the pack
   is attributed by what produced it. The engine's evidence.kind stays 'evidence';
   this is a display/label mapping only, never a change to the deterministic data. */
var GROUND_KIND = { def: 'definition', refs: 'reference', importers: 'importer', imports: 'import',
  related: 'related', symbols: 'symbol', structure: 'structure', tests: 'test', entries: 'entry-point',
  recent: 'recent-change', dir: 'directory', search: 'match', listType: 'file',
  reason: 'evidence', plain: 'evidence', help: 'evidence' };

/* Line-true excerpt around an evidence span. Reuses numberLines so the numbers the
   model sees are the file's real 1-indexed lines — never altered. A bare single line
   is padded for context; the window is trimmed from the end to fit the token cap. */
function groundExcerpt(file, startLine, endLine) {
  var f = st.files.get(file); if (!f) return null;
  var arr = f.content.split('\n'), total = arr.length;
  var a = Math.max(1, Math.min((startLine | 0) || 1, total));
  var b = Math.max(a, Math.min((endLine | 0) || a, total));
  if (b - a < 2) { a = Math.max(1, a - GROUND_EXCERPT_PAD); b = Math.min(total, b + GROUND_EXCERPT_PAD); }
  var slice = arr.slice(a - 1, b);
  while (slice.length > 4 && estTokens(slice.join('\n'), file) > GROUND_EXCERPT_TOK) { slice.pop(); b--; }
  return { text: numberLines(slice.join('\n'), a), startLine: a, endLine: b };
}

/* Phase 2 (loop completion) — the ONE structured representation of a completed
   investigation: findings + typed terrain (symbols · related files · tests · recent)
   + evidence, all read from the ALREADY-built index. No second index, no second
   evidence system. Pure (no DOM). Returns null when the question yields no evidence. */
function buildInvestigationContext(q, intent, inv) {
  if (!inv) return null;
  var idx = null; try { idx = getIndex(); } catch (e) { idx = null; }

  /* evidence — flatten inv.steps[].evidence, dedup by file:startLine, label by step */
  var evidence = [], seen = {};
  (inv.steps || []).forEach(function (step) {
    var kind = GROUND_KIND[intent.kind] || 'evidence';
    var act = (step.action || '').toLowerCase();
    if (/defin/.test(act)) kind = 'definition';
    else if (/referenc/.test(act)) kind = 'reference';
    else if (/import/.test(act)) kind = 'import';
    else if (/relationship|related/.test(act)) kind = 'related';
    else if (/rank|relevant file/.test(act)) kind = 'relevant-file';
    (step.evidence || []).forEach(function (ev) {
      if (!ev || typeof ev.file !== 'string') return;
      var key = ev.file + ':' + ev.startLine;
      if (seen[key]) return; seen[key] = 1;
      evidence.push({ file: ev.file, startLine: (ev.startLine | 0) || 1, endLine: (ev.endLine | 0) || (ev.startLine | 0) || 1,
                      quote: ev.quote || '', kind: kind, known: st.files.has(ev.file) });
    });
  });
  if (!evidence.length) return null;

  /* findings — the investigation's own answer (cleaned) + one project-shape line */
  var findings = [];
  String(inv.answer || '').split('\n')
    .map(function (l) { return l.replace(/\*\*/g, '').replace(/^[-\d.]+\s+/, '').trim(); })
    .filter(function (l) { return l.length > 2 && !/^(Evidence chips|Chips open|Connect a model|Ask `)/.test(l); })
    .slice(0, 6).forEach(function (l) { findings.push(l); });
  if (idx) findings.push('project shape: ' + idx.fileCount + ' files · ' + idx.symbolCount + ' symbols · '
    + idx.packages.length + ' package' + (idx.packages.length === 1 ? '' : 's') + ' · '
    + idx.entries.length + ' entry point' + (idx.entries.length === 1 ? '' : 's') + ' · '
    + idx.tests.length + ' test file' + (idx.tests.length === 1 ? '' : 's'));

  /* symbols — the key symbol's definitions, straight from the index */
  var symbols = [];
  if (idx) {
    var sym = pickSymbol(q, idx);
    if (sym) symLookup(sym, idx).slice(0, 8).forEach(function (d) { symbols.push({ name: sym, file: d.file, line: d.line, kind: d.kind }); });
  }

  /* relatedFiles — edges of the top evidence file (imports · importers · dir · name),
     reusing the same relation logic the `related` investigation uses */
  var relatedFiles = [];
  if (idx && evidence[0]) {
    var rf = evidence[0].file, rel = {};
    (idx.importsByFile.get(rf) || []).forEach(function (x) { if (x.resolved) rel[x.resolved] = 'imports'; });
    (idx.importedBy.get(rf) || []).forEach(function (x) { rel[x.file] = 'imported by'; });
    var d = dirOf(rf), bn = rf.slice(rf.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase();
    st.files.forEach(function (f, p) {
      if (p === rf || rel[p]) return;
      if (dirOf(p) === d) rel[p] = 'same directory';
      else if (bn.length > 2 && p.toLowerCase().indexOf(bn) !== -1) rel[p] = 'name match';
    });
    Object.keys(rel).slice(0, 12).forEach(function (p) { relatedFiles.push({ file: p, relation: rel[p] }); });
  }

  /* tests + recent — from the index and file mtimes, capped */
  var tests = idx ? idx.tests.slice(0, 12) : [];
  var recent = [];
  st.files.forEach(function (f, p) { recent.push({ file: p, mtime: f.mtime || 0 }); });
  recent.sort(function (a, b) { return b.mtime - a.mtime; });
  recent = recent.slice(0, 8);

  return { question: q, intent: intent.kind, verdict: inv.verdict || { local: true, text: 'KNOWN LOCALLY' },
           findings: findings, evidence: evidence, symbols: symbols, relatedFiles: relatedFiles,
           tests: tests, recent: recent, context: [] };
}

/* Phase 2 (loop completion) — serialize the structured investigation context into a
   budget-aware <MERIDIAN_PROJECT_INTELLIGENCE> envelope with explicit typed sections
   (FINDINGS · SYMBOLS · RELATED FILES · TESTS · RECENT · SOURCE EVIDENCE · MODEL TASK).
   Pure (no DOM). The returned object is the single source of truth for both the request
   text and the MERIDIAN FOUND panel. Returns null when there is no evidence. */
function serializeInvestigationContext(ctx, budgetTok) {
  if (!ctx || !ctx.evidence || !ctx.evidence.length) return null;
  var cap = Math.min(budgetTok || GROUND_MAX_TOK, GROUND_MAX_TOK);
  var verdict = ctx.verdict || { local: true, text: 'KNOWN LOCALLY' };
  function section(title, lines) { return '── ' + title + ' ──\n' + (lines.length ? lines.join('\n') : 'none detected') + '\n\n'; }

  var head = '<MERIDIAN_PROJECT_INTELLIGENCE>\n'
    + 'Meridian analyzed the project index for this question before your turn. Everything below is deterministic — read from the project, not inferred.\n\n'
    + 'USER QUESTION: ' + ctx.question + '\n'
    + 'INTENT: ' + ctx.intent + '    VERDICT: ' + verdict.text + '\n\n'
    + section('DETERMINISTIC FINDINGS', ctx.findings.map(function (f) { return '- ' + f; }))
    + section('SYMBOLS', ctx.symbols.map(function (s) { return '- ' + s.name + ' (' + s.kind + ') — ' + s.file + ':' + s.line; }))
    + section('RELATED FILES', ctx.relatedFiles.map(function (r) { return '- ' + r.file + ' — ' + r.relation; }))
    + section('TESTS', ctx.tests.map(function (t) { return '- ' + t; }))
    + section('RECENT CHANGES', ctx.recent.map(function (r) { return '- ' + r.file; }))
    + '── SOURCE EVIDENCE ──\n'
    + 'Files and exact line ranges supporting the findings. Line numbers are authoritative and unchanged.\n\n';

  /* attributed, line-true excerpts within the token budget; overflow → citation lines */
  var evBlocks = [], cites = [], evOut = [], contextOut = [], used = estTokens(head);
  for (var i = 0; i < ctx.evidence.length; i++) {
    var it = ctx.evidence[i];
    if (evOut.length < GROUND_MAX_EVIDENCE && it.known) {
      var ex = groundExcerpt(it.file, it.startLine, it.endLine);
      if (ex) {
        var num = String(evOut.length + 1).padStart(2, '0');
        var block = '[Evidence ' + num + ']\nFile: ' + it.file + '\nLines: ' + ex.startLine + '–' + ex.endLine + '\nKind: ' + it.kind + '\n' + ex.text + '\n';
        var t = estTokens(block, it.file);
        if (used + t <= cap) {
          evBlocks.push(block);
          evOut.push({ file: it.file, startLine: ex.startLine, endLine: ex.endLine, kind: it.kind, quote: it.quote });
          contextOut.push({ file: it.file, startLine: ex.startLine, endLine: ex.endLine, text: ex.text });
          used += t;
          continue;
        }
      }
    }
    if (cites.length < GROUND_MAX_CITES) {
      cites.push(it.file + ':' + it.startLine + (it.endLine > it.startLine ? '-' + it.endLine : '')
        + '  [' + it.kind + ']' + (it.quote ? '  « ' + it.quote + ' »' : ''));
      evOut.push({ file: it.file, startLine: it.startLine, endLine: it.endLine, kind: it.kind, quote: it.quote });
    }
  }

  var task = '\n── MODEL TASK ──\n'
    + 'Using Meridian\'s findings and source evidence above, reason about the user\'s question.\n'
    + '- Distinguish evidence-backed conclusions from your own hypotheses; label inference as inference.\n'
    + '- Do not claim a fact is true unless the provided evidence supports it.\n'
    + '- Prefer citing these exact files and line ranges (path:line) in your trace evidence.\n'
    + '</MERIDIAN_PROJECT_INTELLIGENCE>\n';

  var citeText = cites.length ? '\nAdditional verified citations (no excerpt shown):\n' + cites.join('\n') + '\n' : '';
  var text = head + (evBlocks.join('\n') || '(no excerpts fit the budget; verified citations follow)\n') + citeText + task;
  return { text: text, count: evOut.length, evidence: evOut, findings: ctx.findings, verdict: verdict, intent: ctx.intent,
           symbols: ctx.symbols, relatedFiles: ctx.relatedFiles, tests: ctx.tests, recent: ctx.recent, context: contextOut };
}

/* Phase 5/2 bridge: run the deterministic investigation for q, then serialize it.
   The single entry both the model request and the PREVIEW use, so they cannot drift.
   Returns null on any failure or when no evidence is found — an empty block is never
   sent and the existing model path proceeds unchanged. */
function buildInvestigationBlock(q, budgetTok) {
  if (!st.files.size) return null;
  try {
    var intent = classifyIntent(q);
    var inv = runInvestigation(q, intent);
    var ctx = buildInvestigationContext(q, intent, inv);
    return serializeInvestigationContext(ctx, budgetTok);
  } catch (e) { return null; }
}

/* Builds the system blocks for one question, honoring the context mode.
   Returns { blocks, note } — note is a short human-readable summary for the statusline.
   A grounding block (per-question, uncached) is always placed AFTER the cached map/ctx
   block so Anthropic prompt caching of the stable prefix is preserved. */
function buildContextBlocks(q) {
  var groundBudget = Math.min(GROUND_MAX_TOK, Math.floor(getBudget() * 0.25));
  var invBlock = st.groundMode ? buildInvestigationBlock(q, groundBudget) : null;
  var groundTok = invBlock ? estTokens(invBlock.text) : 0;
  var gNote = invBlock ? ' · GROUNDED ' + invBlock.count + ' EV' : '';
  if (st.ctxMode !== 'smart') {
    var ctx = assembleContext();
    var fblocks = ctx ? [{ type: 'text', text: ctx, cache_control: { type: 'ephemeral' } }] : [];
    if (invBlock) fblocks.push({ type: 'text', text: invBlock.text });
    return { blocks: fblocks, note: invBlock ? ('GROUNDED ' + invBlock.count + ' EV') : null, ground: invBlock };
  }
  var map = buildProjectMap();
  if (!map) return { blocks: [], note: null, ground: invBlock };
  /* grounding is counted against the one budget so grounding + selected files stay bounded */
  var packed = packSmartContext(q, Math.max(4000, getBudget() - groundTok));
  /* cache the stable map block; grounding + packed subset vary per question */
  var blocks = [{ type: 'text', text: map, cache_control: { type: 'ephemeral' } }];
  if (invBlock) blocks.push({ type: 'text', text: invBlock.text });
  if (packed.text) {
    blocks.push({ type: 'text', text: 'SELECTED FILES — the subset most relevant to this question. ' + CTX_PREAMBLE + ' Excerpted files keep true line numbers; omitted ranges are marked.\n\n' + packed.text });
  }
  var mapTok = estTokens(map);
  return { blocks: blocks, note: 'SMART CTX ' + packed.count + '/' + packed.total + ' FILES ≈ ' + fmtTok(packed.tokens + mapTok + groundTok) + ' TOK' + gNote, ground: invBlock };
}

/* ============ COST ============ */
st.spent = { in: 0, out: 0, cacheW: 0, cacheR: 0 };
function renderCost() {
  var m = MODELS[st.model];
  var navc = $('navcost'), navv = $('navcostval');
  if (st.spent.in + st.spent.out + st.spent.cacheW + st.spent.cacheR === 0) {
    $('costline').textContent = '';
    if (navc) navc.hidden = true;
    return;
  }
  var head = 'SESSION ≈ in ' + fmtTok(st.spent.in + st.spent.cacheW + st.spent.cacheR) + ' · out ' + fmtTok(st.spent.out);
  var breakdown = 'in ' + fmtTok(st.spent.in) + ' · cache-write ' + fmtTok(st.spent.cacheW) + ' · cache-read ' + fmtTok(st.spent.cacheR) + ' · out ' + fmtTok(st.spent.out);
  if (navc) navc.hidden = false;
  if (m.unknownRates) {
    $('costline').textContent = head + ' · rates unknown';
    if (navc) { navv.textContent = '≈ ' + fmtTok(st.spent.in + st.spent.cacheW + st.spent.cacheR) + ' tok'; navc.title = 'Rates unknown for ' + m.label + '. Tokens this session — ' + breakdown + '. ↺ resets.'; }
    return;
  }
  var usd = (st.spent.in * m.rIn + st.spent.out * m.rOut + st.spent.cacheW * m.rCacheW + st.spent.cacheR * m.rCacheR) / 1e6;
  var usdStr = '$' + (usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2));
  $('costline').textContent = head + ' · ' + usdStr + ' est';
  if (navc) { navv.textContent = usdStr; navc.title = usdStr + ' estimated this session (' + m.label + ') — ' + breakdown + '. Your provider bills actuals. ↺ resets.'; }
}
/* cost accumulates across clearConversation() by design — this is the explicit reset */
function resetCost() {
  st.spent.in = st.spent.out = st.spent.cacheW = st.spent.cacheR = 0;
  renderCost();
  toast('Session cost reset to zero.');
}
$('navcostbtn').addEventListener('click', function () { openDrawer(true); });
$('navcostrst').addEventListener('click', function (e) { e.stopPropagation(); resetCost(); });

initViewer();


initExport();

/* ============ CHAT ============ */
st.history = [];   /* {role, content} for the API */
st.transcript = []; /* {q, answer, trace, model, provider, ts} for export */
st.streaming = false; st.aborter = null;
var promptEl = $('prompt'), sendbtn = $('sendbtn'), stopbtn = $('stopbtn'), statusEl = $('status');

promptEl.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('askform').requestSubmit(); }
});

/* rough per-request cost estimate (input context + a small output allowance) */
function estRequestUSD() {
  var m = MODELS[st.model];
  if (!m || m.unknownRates) return 0;
  var inTok = (st.ctxMode === 'smart' ? getBudget() : selectedTokens().tokens) + 800;
  return (inTok * m.rIn + 800 * m.rOut) / 1e6;
}
/* pre-send guards — one-time confirms, nothing is hard-blocked */
function preSendOK() {
  var m = MODELS[st.model];
  if (st.ctxMode === 'full' && !m.local) {
    var sel = selectedTokens().tokens;
    if (sel > m.ctx && !confirm('Selected context ≈ ' + fmtTok(sel) + ' tokens exceeds ' + m.label + '’s ' + fmtTok(m.ctx) + '-token window — the provider will likely reject it. Deselect files or switch to SMART.\n\nSend anyway?')) return false;
  }
  var cap = parseFloat(lsGet(LS.spendcap) || '0');
  if (cap > 0 && !m.unknownRates) {
    var spentUSD = (st.spent.in * m.rIn + st.spent.out * m.rOut + st.spent.cacheW * m.rCacheW + st.spent.cacheR * m.rCacheR) / 1e6;
    var projected = spentUSD + estRequestUSD();
    if (projected > cap && !confirm('Estimated session total (~$' + projected.toFixed(2) + ') would exceed your $' + cap.toFixed(2) + ' limit by ~$' + (projected - cap).toFixed(2) + '. Costs are estimates; your provider bills actuals.\n\nSend anyway?')) return false;
  }
  return true;
}
$('askform').addEventListener('submit', function (e) {
  e.preventDefault();
  if (st.streaming) return;
  var q = promptEl.value.trim();
  if (!q) return;
  if (st.curProvider === 'local') { promptEl.value = ''; askLocal(q); return; }
  var key = lsGet(curKeyLS()) || '';
  if (!key && st.curProvider !== 'custom') {
    setStatus('NO KEY — add your ' + PROVIDERS[st.curProvider].label + ' API key in settings', true);
    openDrawer(true);
    toast('Add your ' + PROVIDERS[st.curProvider].label + ' API key first — it stays in this browser.');
    return;
  }
  if (st.curProvider === 'custom' && (!lsGet(LS.curl) || !lsGet(LS.cmodel))) {
    setStatus('CUSTOM ENDPOINT NOT CONFIGURED — set base URL + model in settings', true);
    openDrawer(true);
    return;
  }
  if (!preSendOK()) return;
  promptEl.value = '';
  ask(q, key);
});

stopbtn.addEventListener('click', function () { if (st.aborter) st.aborter.abort(); });

function httpErrorText(status, body, retryAfter) {
  var detail = '';
  try { detail = JSON.parse(body).error.message || ''; } catch (e) {}
  if (status === 401) return 'KEY REJECTED (401) — check it in settings.';
  if (status === 403) return 'FORBIDDEN (403) — this key cannot use this model. ' + detail;
  if (status === 404) return 'MODEL NOT FOUND (404) — ' + detail;
  if (status === 429) return 'RATE LIMITED (429) — ' + (retryAfter ? 'retry in ' + retryAfter + 's. ' : 'slow down or raise your provider limits. ') + detail;
  if (status === 400 && /token|context|length/i.test(detail)) return 'CONTEXT TOO LARGE (400) — deselect some files and retry.';
  if (status === 400) return 'BAD REQUEST (400) — ' + detail;
  if (status === 529 || status >= 500) return 'PROVIDER OVERLOADED (' + status + ') — retry in a moment.';
  return 'HTTP ' + status + ' — ' + detail;
}

function ask(q, key, opts) {
  opts = opts || {};
  addUserMsg(q);
  var msgEl = addAiMsg();
  var txtEl = msgEl.querySelector('.txt');
  var raw = '', fenceIdx = -1, waitShown = false;
  st.streaming = true;
  sendbtn.hidden = true; stopbtn.hidden = false;
  st.aborter = new AbortController();

  var cb = buildContextBlocks(q);
  /* Phase 2: show what Meridian deterministically FOUND before the model interprets it
     — separate layer, navigable evidence. Never allowed to break the streaming path. */
  try { if (st.groundMode && cb.ground) renderFound(msgEl, cb.ground); } catch (e) {}
  setStatus('CORE REASONING — ' + MODELS[st.model].label + (cb.note ? ' · ' + cb.note : ''));
  var anthro = st.curProvider === 'anthropic';
  /* strict trace: on demand (RE-GROUND) or when the user enables Force Strict Trace */
  var strict = opts.strict || lsGet(LS.strictTrace) === '1';
  var instrBlock = { type: 'text', text: INSTRUCTIONS + (strict ? STRICT_SUFFIX : '') };
  /* the instruction block is stable across turns — cache it (Anthropic ≤4 breakpoints) */
  if (anthro) instrBlock.cache_control = { type: 'ephemeral' };
  var system = [instrBlock].concat(cb.blocks);
  var msgs = st.history.concat([{ role: 'user', content: q }]);

  /* provider adapters share one streaming pump below; only the request
     shape and the SSE event schema differ */
  var url, headers, body;
  if (anthro) {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    body = { model: st.model, max_tokens: 8192, stream: true, system: system, messages: msgs };
  } else {
    /* OpenAI-compatible: system blocks flatten to one system message; cache_control is Anthropic-only */
    var sysTxt = system.map(function (b) { return b.text; }).join('\n\n');
    headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = 'Bearer ' + key;
    body = { messages: [{ role: 'system', content: sysTxt }].concat(msgs), stream: true };
    if (st.curProvider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      body.model = st.model;
      body.max_completion_tokens = 8192;
      body.stream_options = { include_usage: true };
    } else {
      url = (lsGet(LS.curl) || '').replace(/\/+$/, '') + '/chat/completions';
      body.model = lsGet(LS.cmodel) || '';
      body.max_tokens = 8192;
    }
  }

  function paint(final) {
    /* hide the trace fence (and any partial fence tail) while streaming */
    var shown = raw;
    fenceIdx = raw.indexOf(FENCE);
    if (fenceIdx === -1) { var altF = raw.indexOf('~~~meridian-trace'); if (altF !== -1) fenceIdx = altF; }
    if (fenceIdx === -1) { var bare = raw.search(/\n\s*\{\s*"steps"\s*:/); if (bare !== -1) fenceIdx = bare; } /* leaked/fenceless trace JSON */
    if (fenceIdx !== -1) {
      shown = raw.slice(0, fenceIdx);
      if (!waitShown && !final) {
        waitShown = true;
        var w = document.createElement('div');
        w.className = 'trace-wait mono';
        w.innerHTML = '<i></i>TRACE // ASSEMBLING…';
        msgEl.querySelector('.bd').appendChild(w);
      }
    } else if (!final) {
      /* hold back a partial fence opener at the tail */
      var nl = shown.lastIndexOf('\n');
      var tail = shown.slice(nl + 1);
      if (tail && FENCE.indexOf(tail) === 0) shown = shown.slice(0, nl + 1);
    }
    txtEl.innerHTML = renderRich(shown.replace(/\s+$/, '')) + (final ? '' : '<span class="cursor"></span>');
    scrollEnd();
  }

  fetch(url, {
    method: 'POST',
    signal: st.aborter.signal,
    headers: headers,
    body: JSON.stringify(body)
  }).then(function (res) {
    if (!res.ok) {
      var ra = res.headers.get('retry-after');
      return res.text().then(function (t) {
        var he = new Error('http error'); he.httpStatus = res.status; he.httpBody = t; he.retryAfter = ra; throw he;
      });
    }
    if (!res.body) { var nb = new Error('no stream'); nb.streamMsg = 'the response had no readable body stream'; throw nb; }
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
    var stopReason = null, badEvents = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return finish();
        buf += dec.decode(r.value, { stream: true });
        var events = buf.split('\n\n');
        buf = events.pop();
        events.forEach(function (evt) {
          var data = null;
          evt.split('\n').forEach(function (line) {
            if (line.indexOf('data:') === 0) data = line.slice(5).trim();
          });
          if (!data || data === '[DONE]') return;
          var p;
          try { p = JSON.parse(data); } catch (e) {
            if (++badEvents === 3) { var mw = document.createElement('div'); mw.className = 'errline'; mw.textContent = '// some stream data could not be parsed — the answer may be incomplete'; msgEl.querySelector('.bd').appendChild(mw); }
            return;
          }
          if (anthro) {
            if (p.type === 'message_start' && p.message && p.message.usage) {
              var u = p.message.usage;
              st.spent.in += u.input_tokens || 0;
              st.spent.cacheW += u.cache_creation_input_tokens || 0;
              st.spent.cacheR += u.cache_read_input_tokens || 0;
              renderCost();
            } else if (p.type === 'content_block_delta' && p.delta) {
              if (p.delta.type === 'text_delta') { raw += p.delta.text; paint(false); }
              /* thinking_delta blocks are skipped — not rendered */
            } else if (p.type === 'message_delta') {
              if (p.usage) { st.spent.out += p.usage.output_tokens || 0; renderCost(); }
              if (p.delta && p.delta.stop_reason) stopReason = p.delta.stop_reason;
            } else if (p.type === 'error') {
              var se = new Error('stream error'); se.streamMsg = (p.error && p.error.message) || 'stream error'; throw se;
            }
          } else {
            /* OpenAI-compatible chat-completions stream */
            if (p.error) { var se2 = new Error('stream error'); se2.streamMsg = p.error.message || 'stream error'; throw se2; }
            if (p.usage) {
              st.spent.in += p.usage.prompt_tokens || 0;
              st.spent.out += p.usage.completion_tokens || 0;
              renderCost();
            }
            var c = p.choices && p.choices[0];
            if (c) {
              if (c.delta && typeof c.delta.content === 'string' && c.delta.content) { raw += c.delta.content; paint(false); }
              if (c.finish_reason) stopReason = c.finish_reason === 'length' ? 'max_tokens' : c.finish_reason;
            }
          }
        });
        return pump();
      });
    }
    function finish() {
      var parsed = extractTrace(raw);
      raw = parsed.answer;
      paint(true);
      /* offer RE-GROUND when the model produced text but no usable trace */
      var canRetry = !parsed.trace && parsed.answer && parsed.answer !== '(empty)';
      renderTrace(msgEl, parsed.trace, {
        degraded: parsed.degraded,
        retry: canRetry ? function () { ask(q, key, { strict: true }); } : null
      });
      if (stopReason === 'max_tokens') {
        var n = document.createElement('div');
        n.className = 'errline'; n.textContent = '// output truncated at max_tokens';
        msgEl.querySelector('.bd').appendChild(n);
      }
      if (stopReason === 'refusal') {
        var n2 = document.createElement('div');
        n2.className = 'errline'; n2.textContent = '// the model declined this request';
        msgEl.querySelector('.bd').appendChild(n2);
      }
      if (!parsed.answer && !parsed.trace && stopReason !== 'max_tokens') {
        var ne = document.createElement('div'); ne.className = 'errline'; ne.textContent = '// the model returned no content — try again or rephrase'; msgEl.querySelector('.bd').appendChild(ne);
      }
      st.history.push({ role: 'user', content: q });
      st.history.push({ role: 'assistant', content: parsed.answer || '(empty)' });
      st.transcript.push({ q: q, answer: parsed.answer || '(empty)', trace: parsed.trace, model: MODELS[st.model].label, provider: PROVIDERS[st.curProvider].label, ts: Date.now() });
      attachCopy(msgEl, st.transcript.length - 1);
      setStatus('CORE IDLE — response complete');
      announce('Response complete.' + (parsed.trace ? ' Trace available.' : ''));
      scrollEnd();
    }
    return pump();
  }).catch(function (err) {
    var line;
    if (err.name === 'AbortError') {
      line = '// stopped by operator';
      paint(true);
      renderTrace(msgEl, null);
      if (raw.trim()) {
        var pa = extractTrace(raw);
        st.history.push({ role: 'user', content: q });
        st.history.push({ role: 'assistant', content: pa.answer || '(stopped)' });
        st.transcript.push({ q: q, answer: (pa.answer || '(stopped)') + '\n\n_(stopped by operator)_', trace: pa.trace, model: MODELS[st.model].label, provider: PROVIDERS[st.curProvider].label, ts: Date.now() });
        attachCopy(msgEl, st.transcript.length - 1);
      }
      setStatus('STOPPED BY OPERATOR');
    } else if (err.httpStatus) {
      line = '// ' + httpErrorText(err.httpStatus, err.httpBody || '', err.retryAfter);
      if (err.httpStatus === 401) openDrawer(true);
      setStatus('REQUEST FAILED', true);
    } else if (err.streamMsg) {
      line = '// stream error — ' + err.streamMsg;
      setStatus('STREAM ERROR', true);
    } else {
      line = '// network unreachable — check your connection and any ad/tracker blocker. requests go straight from this browser to the provider endpoint' + (st.curProvider === 'custom' ? ' — custom endpoints must allow browser CORS.' : '.');
      setStatus('NETWORK ERROR', true);
    }
    var d = document.createElement('div');
    d.className = 'errline'; d.textContent = line;
    msgEl.querySelector('.bd').appendChild(d);
    var chip = msgEl.querySelector('.term-hd .chip');
    if (!raw.trim()) { chip.className = 'chip err'; chip.textContent = 'FAILED'; }
    /* one-click retry for anything but auth/not-found/bad-request and operator stops */
    if (err.name !== 'AbortError' && err.httpStatus !== 401 && err.httpStatus !== 403 && err.httpStatus !== 404 && err.httpStatus !== 400) {
      var rrow = document.createElement('div'); rrow.className = 'reground-row';
      var rb = document.createElement('button'); rb.type = 'button'; rb.className = 'btn-quiet acc'; rb.textContent = '[ RETRY ]';
      rb.title = 'Re-send this question';
      rb.addEventListener('click', function () { rb.disabled = true; ask(q, key, opts); });
      rrow.appendChild(rb); msgEl.querySelector('.bd').appendChild(rrow);
    }
    scrollEnd();
  }).finally(function () {
    st.streaming = false; st.aborter = null;
    sendbtn.hidden = false; stopbtn.hidden = true;
    promptEl.focus();
  });
}

/* ============ LOCAL ENGINE (NO API · NO AI) ============
   The deterministic project-intelligence engine. A question is routed by intent
   (classifyIntent), an investigation runs real operations over the project index
   (runInvestigation), and the findings are surfaced through the same trace +
   evidence-chip UI the AI providers use — every claim pinned to a real file:line.
   Meridian understands the terrain first; a model is optional, and only for
   interpretation. Honestly labeled LOCAL · NO AI, with an explicit KNOWN-LOCALLY
   vs REQUIRES-MODEL verdict on every answer.                                    */

var CAP_LOCAL = ['Project structure', 'Search', 'Definitions', 'References', 'Imports & importers', 'File relationships', 'Recent changes', 'Evidence collection'];
var CAP_MODEL = ['Architectural reasoning', 'Natural-language synthesis', 'Root-cause analysis', 'Refactoring recommendations'];
var LOCAL_HELP = 'Ask in plain language ("where is X defined", "what references X", "what imports X", '
  + '"files related to app.js", "project structure", "where are the tests", "entry points", "what changed recently") '
  + 'or use a command: `def`, `refs`, `imports`, `importers`, `related`, `symbols`, `structure`, `tests`, `entries`, '
  + '`recent <n>`, `dir <path>`, `search <text|regex>`. Interpretation ("why…", "how should I…") needs a model — '
  + 'connect one in settings and Meridian sends only the relevant evidence, never the whole repo.';

function localEvidence(h) {
  return { file: h.p, startLine: h.line, endLine: h.line, quote: String(h.text).trim().slice(0, 120), kind: 'evidence' };
}
function lineText(file, line) {
  var f = st.files.get(file); if (!f) return '';
  return (f.content.split('\n')[line - 1] || '').trim().slice(0, 120);
}
function evAt(file, line) { return { file: file, startLine: line, endLine: line, quote: lineText(file, line), kind: 'evidence' }; }

/* resolve a natural-language argument to a loaded file path (basename-aware) */
function resolveToFile(arg) {
  if (!arg) return null;
  if (st.files.has(arg)) return arg;
  var base = arg.slice(arg.lastIndexOf('/') + 1).toLowerCase(), la = arg.toLowerCase();
  var exact = null, contains = null;
  st.files.forEach(function (f, p) {
    var b = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
    if (b === base) { if (!exact) exact = p; }
    else if (!contains && (b.indexOf(base) !== -1 || p.toLowerCase().indexOf(la) !== -1)) contains = p;
  });
  return exact || contains;
}
/* look a symbol up in the index: exact → last dotted segment → case-insensitive */
function symLookup(name, idx) {
  if (!name) return [];
  if (idx.symbols.has(name)) return idx.symbols.get(name);
  var last = name.split('.').pop();
  if (last !== name && idx.symbols.has(last)) return idx.symbols.get(last);
  var lc = name.toLowerCase(), out = [];
  idx.symbols.forEach(function (arr, k) { if (k.toLowerCase() === lc) out = out.concat(arr); });
  return out;
}

var STOP_INTENT = { where: 1, what: 1, which: 1, who: 1, does: 1, do: 1, is: 1, are: 1, the: 1, file: 1, files: 1, function: 1, functions: 1, method: 1, methods: 1, symbol: 1, symbols: 1, class: 1, classes: 1, defined: 1, definition: 1, declared: 1, reference: 1, references: 1, referenced: 1, import: 1, imports: 1, imported: 1, related: 1, project: 1, structure: 1, test: 1, tests: 1, entry: 1, point: 1, points: 1, recent: 1, recently: 1, show: 1, list: 1, find: 1, all: 1, call: 1, calls: 1, uses: 1, used: 1, depend: 1, depends: 1, this: 1, that: 1, for: 1, and: 1, with: 1 };
/* pick the most identifier-like token from a question (for def/refs/symbols) */
function pickSymbol(q, idx) {
  var bt = q.match(/`([^`]+)`/); if (bt) return bt[1].trim();
  var qq = q.match(/["“”']([^"“”']+)["“”']/); if (qq) return qq[1].trim();
  var toks = q.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) || [];
  if (idx) { for (var i = 0; i < toks.length; i++) { if (symLookup(toks[i], idx).length) return toks[i]; } }
  var fancy = toks.filter(function (t) { return (/[A-Z]/.test(t) || t.indexOf('_') !== -1 || t.indexOf('.') !== -1 || /\d/.test(t)) && !STOP_INTENT[t.toLowerCase()]; });
  if (fancy.length) return fancy.sort(function (a, b) { return b.length - a.length; })[0];
  var terms = queryTerms(q); return terms.length ? terms[0] : '';
}
/* pick a path-ish token from a question (for imports/importers/related/dir) */
function pickPathish(q) {
  var bt = q.match(/`([^`]+)`/); if (bt) return bt[1].trim();
  var qq = q.match(/["“”']([^"“”']+)["“”']/); if (qq) return qq[1].trim();
  var withExt = q.match(/[\w./-]*[\w-]\.[A-Za-z]{1,6}\b/); if (withExt) return withExt[0];
  var withSlash = q.match(/[\w.-]+\/[\w./-]+/); if (withSlash) return withSlash[0];
  return pickSymbol(q);
}

/* ---- Intent router: deterministic kinds vs. reasoning vs. plain fallback ---- */
function classifyIntent(q) {
  var s = q.trim(), lo = s.toLowerCase(), idx = st.files.size ? getIndex() : null;
  var cmd = s.match(/^\s*(search|def|refs|dir|recent|imports|importers|importedby|symbols|related|structure|overview|tests|entries|entrypoints|help)\b\s*([\s\S]*)$/i);
  if (cmd) {
    var kmap = { search: 'search', def: 'def', refs: 'refs', dir: 'dir', recent: 'recent', imports: 'imports', importers: 'importers', importedby: 'importers', symbols: 'symbols', related: 'related', structure: 'structure', overview: 'structure', tests: 'tests', entries: 'entries', entrypoints: 'entries', help: 'help' };
    return { kind: kmap[cmd[1].toLowerCase()], arg: cmd[2].trim(), deterministic: true, needsModel: false };
  }
  function det(kind, arg) { return { kind: kind, arg: arg, deterministic: true, needsModel: false }; }
  /* distinctive deterministic nouns first */
  if (/\b(entry ?points?|entrypoints?|main file|entry file)\b/.test(lo)) return det('entries', '');
  if (/\b(recent(ly)?|latest|newest|last changed|what changed|changed recently)\b/.test(lo)) { var num = lo.match(/\b(\d{1,2})\b/); return det('recent', num ? num[1] : '10'); }
  if (/\b(project structure|structure of|overview|directories|packages|project map|top-?level|layout|organi[sz]ation|how is .* organi[sz]ed|what.*directories)\b/.test(lo)) return det('structure', '');
  if (/\btests?\b/.test(lo) && /\b(where|find|list|show|which|are|any)\b/.test(lo)) return det('tests', '');
  if (/\b(list|show|all)\b/.test(lo) && /\b(files?)\b/.test(lo) && /\b([a-z]{1,6})\b\s+files?\b/.test(lo)) return det('listType', s);
  if (/\brelated\b|\bconnected to\b|\bassociated with\b|\bneighbou?rs of\b/.test(lo)) return det('related', pickPathish(s));
  /* import direction */
  if (/\bwhat does\b[\s\S]*\bimport\b|\bimports of\b|\bdependencies of\b|\bwhat.*\bdepend(s)? on\b/.test(lo)) return det('imports', pickPathish(s));
  if (/\b(imports?|importe(rs|d)?|depend(s|ents?|encies)?|who (imports|uses|depends)|used by|includes)\b/.test(lo)) return det('importers', pickPathish(s));
  if (/\b(symbols?|functions?|classes|methods)\b/.test(lo) && !/\b(where|defined|definition|reference|references)\b/.test(lo)) return det('symbols', pickSymbol(s, idx));
  if (/\b(reference|references|referenced|callers?|call sites?|usages?|used by|who calls|what calls|uses of)\b/.test(lo)) return det('refs', pickSymbol(s, idx));
  if (/\b(where|location|find|definition|defined|declared|declaration)\b/.test(lo)) return det('def', pickSymbol(s, idx));
  /* reasoning — interpretation a deterministic engine cannot honestly provide */
  if (/\b(why|how (do|does|is|should|can|would)|root cause|recommend|refactor|improve|architect(ure)?|risk|risks|should i|would you|best way|design|rationale|trade-?offs?|explain)\b/.test(lo)) return { kind: 'reason', arg: pickSymbol(s, idx), deterministic: false, needsModel: true };
  return { kind: 'plain', arg: pickSymbol(s, idx), deterministic: true, needsModel: false };
}

/* ---- Investigation engine: real operations over the index, collecting evidence.
   Returns { steps, verdict:{local,text}, actions, answer }. No fabricated work. ---- */
function gatherTerrain(q, steps) {
  /* shared evidence-gathering used by plain + reason: term search → ranked files */
  var terms = queryTerms(q), perFile = {};
  steps.push({ action: 'extract search terms', note: terms.length ? terms.join(', ') : 'none', evidence: [], status: 'done' });
  terms.slice(0, 4).forEach(function (t) {
    var r = localSearchData(t, 'text');
    steps.push({ action: 'search “' + t + '”', note: r.hits.length ? r.hits.length + ' hit' + (r.hits.length === 1 ? '' : 's') : 'no matches', evidence: r.hits.slice(0, 4).map(localEvidence), status: 'done' });
    r.hits.forEach(function (h) { (perFile[h.p] || (perFile[h.p] = { count: 0, first: h })).count++; });
  });
  var ranked = Object.keys(perFile).map(function (p) {
    return { p: p, count: perFile[p].count, first: perFile[p].first, score: perFile[p].count * 10 + (st.files.has(p) ? st.files.get(p).base : 0) };
  }).sort(function (a, b) { return b.score - a.score; }).slice(0, 8);
  if (ranked.length) steps.push({ action: 'rank relevant files', note: ranked.length + ' file' + (ranked.length === 1 ? '' : 's') + ' · hits + importance', evidence: ranked.map(function (r) { return localEvidence(r.first); }), status: 'done' });
  return { terms: terms, ranked: ranked };
}

function runInvestigation(q, intent) {
  var idx = getIndex(), steps = [], actions = null;
  var localVerdict = { local: true, text: 'KNOWN LOCALLY' };
  var arg = intent.arg;

  if (intent.kind === 'help') {
    return { steps: [{ action: 'list capabilities', note: 'local engine reference', evidence: [], status: 'done' }],
      verdict: localVerdict,
      answer: '**Meridian LOCAL engine** — deterministic project intelligence, no AI, no network.\n\n**Known locally:** ' + CAP_LOCAL.join(' · ') + '.\n**Requires a model:** ' + CAP_MODEL.join(' · ') + '.\n\n' + LOCAL_HELP };
  }

  if (intent.kind === 'def') {
    var defs = symLookup(arg, idx);
    steps.push({ action: 'look up “' + arg + '” in the symbol index', note: defs.length + ' definition' + (defs.length === 1 ? '' : 's'), evidence: defs.slice(0, 8).map(function (d) { return evAt(d.file, d.line); }), status: 'done' });
    var refs = localSearchData(arg, 'refs');
    steps.push({ action: 'scan for references', note: refs.hits.length + ' reference' + (refs.hits.length === 1 ? '' : 's'), evidence: refs.hits.slice(0, 6).map(localEvidence), status: 'done' });
    actions = [{ kind: 'refs', command: arg, why: 'list every reference to ' + arg }];
    var ans = defs.length
      ? '`' + arg + '` is defined in ' + defs.length + ' place' + (defs.length === 1 ? '' : 's') + ':\n\n' + defs.slice(0, 8).map(function (d) { return '- `' + d.file + '` line ' + d.line + ' (' + d.kind + ')'; }).join('\n') + '\n\nEvidence chips open each definition at its exact line.'
      : 'No indexed definition named `' + arg + '`. It may be an external symbol, a dynamic name, or spelled differently. The reference scan above shows where the term appears.';
    return { steps: steps, verdict: localVerdict, actions: actions, answer: ans };
  }

  if (intent.kind === 'refs') {
    var r = localSearchData(arg, 'refs');
    steps.push({ action: 'find references to “' + arg + '”', note: r.hits.length + ' hit' + (r.hits.length === 1 ? '' : 's') + ' in ' + r.filesHit + ' file' + (r.filesHit === 1 ? '' : 's'), evidence: r.hits.slice(0, 10).map(localEvidence), status: 'done' });
    var d2 = symLookup(arg, idx);
    if (d2.length) steps.push({ action: 'locate its definition', note: d2.length + ' definition' + (d2.length === 1 ? '' : 's'), evidence: d2.slice(0, 4).map(function (d) { return evAt(d.file, d.line); }), status: 'done' });
    actions = [{ kind: 'def', command: arg, why: 'jump to where ' + arg + ' is defined' }];
    return { steps: steps, verdict: localVerdict, actions: actions,
      answer: r.hits.length ? '`' + arg + '` is referenced ' + (r.hits.length >= r.cap ? r.cap + '+' : r.hits.length) + ' time' + (r.hits.length === 1 ? '' : 's') + ' across ' + r.filesHit + ' file' + (r.filesHit === 1 ? '' : 's') + '. Chips open each at its line.' : 'No references to `' + arg + '` in the loaded files.' };
  }

  if (intent.kind === 'importers') {
    var tf = resolveToFile(arg);
    var imps = tf ? (idx.importedBy.get(tf) || []) : [];
    steps.push({ action: 'resolve “' + arg + '” to a file', note: tf || 'unresolved', evidence: [], status: 'done' });
    steps.push({ action: 'read importer edges from the index', note: imps.length + ' importer' + (imps.length === 1 ? '' : 's'), evidence: imps.slice(0, 12).map(function (x) { return evAt(x.file, x.line); }), status: 'done' });
    var ians = !tf ? 'Could not resolve `' + arg + '` to a loaded file.'
      : imps.length ? '`' + tf + '` is imported by ' + imps.length + ' file' + (imps.length === 1 ? '' : 's') + ':\n\n' + imps.slice(0, 12).map(function (x) { return '- `' + x.file + '` line ' + x.line; }).join('\n')
      : 'No loaded file imports `' + tf + '`. Either nothing depends on it, or the project uses a bundling/single-file style with no import statements between files (a real architectural fact, not a gap).';
    return { steps: steps, verdict: localVerdict, answer: ians };
  }

  if (intent.kind === 'imports') {
    var tf2 = resolveToFile(arg);
    var list = tf2 ? (idx.importsByFile.get(tf2) || []) : [];
    var resolved = list.filter(function (x) { return x.resolved; }), external = list.filter(function (x) { return !x.resolved; });
    steps.push({ action: 'resolve “' + arg + '” to a file', note: tf2 || 'unresolved', evidence: [], status: 'done' });
    steps.push({ action: 'read import statements', note: list.length + ' import' + (list.length === 1 ? '' : 's') + ' · ' + resolved.length + ' internal, ' + external.length + ' external', evidence: list.slice(0, 12).map(function (x) { return evAt(tf2, x.line); }), status: 'done' });
    var mans = !tf2 ? 'Could not resolve `' + arg + '` to a loaded file.'
      : list.length ? '`' + tf2 + '` has ' + list.length + ' import' + (list.length === 1 ? '' : 's') + '.\n\n**Internal:** ' + (resolved.map(function (x) { return '`' + x.resolved + '`'; }).join(', ') || 'none') + '\n**External:** ' + (external.map(function (x) { return '`' + x.raw + '`'; }).join(', ') || 'none')
      : 'No import statements found in `' + tf2 + '`.';
    return { steps: steps, verdict: localVerdict, answer: mans };
  }

  if (intent.kind === 'related') {
    var rf = resolveToFile(arg);
    steps.push({ action: 'resolve “' + arg + '” to a file', note: rf || 'unresolved', evidence: [], status: 'done' });
    var rel = {};
    if (rf) {
      (idx.importsByFile.get(rf) || []).forEach(function (x) { if (x.resolved) rel[x.resolved] = 'imports'; });
      (idx.importedBy.get(rf) || []).forEach(function (x) { rel[x.file] = 'imported by'; });
      var d = dirOf(rf), bn = rf.slice(rf.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase();
      st.files.forEach(function (f, p) {
        if (p === rf) return;
        if (dirOf(p) === d && !rel[p]) rel[p] = 'same directory';
        else if (!rel[p] && bn.length > 2 && p.toLowerCase().indexOf(bn) !== -1) rel[p] = 'name match';
      });
    }
    var relList = Object.keys(rel).slice(0, 20);
    steps.push({ action: 'gather relationships (imports · importers · directory · name)', note: relList.length + ' related file' + (relList.length === 1 ? '' : 's'), evidence: relList.map(function (p) { return evAt(p, 1); }), status: 'done' });
    var rans = !rf ? 'Could not resolve `' + arg + '` to a loaded file.'
      : relList.length ? 'Files related to `' + rf + '`:\n\n' + relList.map(function (p) { return '- `' + p + '` — ' + rel[p]; }).join('\n')
      : 'No related files found for `' + rf + '` (no import edges, no directory siblings, no name matches).';
    return { steps: steps, verdict: localVerdict, answer: rans };
  }

  if (intent.kind === 'symbols') {
    if (arg) {
      var matches = [];
      idx.symbols.forEach(function (defsArr, name) { if (name.toLowerCase().indexOf(arg.toLowerCase()) !== -1) matches.push({ name: name, def: defsArr[0], n: defsArr.length }); });
      matches.sort(function (a, b) { return a.name.length - b.name.length; });
      var top = matches.slice(0, 15);
      steps.push({ action: 'search the symbol index for “' + arg + '”', note: matches.length + ' matching symbol' + (matches.length === 1 ? '' : 's'), evidence: top.map(function (mm) { return evAt(mm.def.file, mm.def.line); }), status: 'done' });
      return { steps: steps, verdict: localVerdict,
        answer: top.length ? matches.length + ' symbol' + (matches.length === 1 ? '' : 's') + ' match `' + arg + '`:\n\n' + top.map(function (mm) { return '- `' + mm.name + '` (' + mm.def.kind + ') — `' + mm.def.file + '` line ' + mm.def.line + (mm.n > 1 ? ' (+' + (mm.n - 1) + ' more)' : ''); }).join('\n') : 'No indexed symbol matches `' + arg + '`.' };
    }
    var byFile = {};
    idx.symbols.forEach(function (defsArr) { defsArr.forEach(function (d) { byFile[d.file] = (byFile[d.file] || 0) + 1; }); });
    var topFiles = Object.keys(byFile).sort(function (a, b) { return byFile[b] - byFile[a]; }).slice(0, 8);
    steps.push({ action: 'summarize the symbol index', note: idx.symbolCount + ' definitions · ' + idx.symbols.size + ' unique names', evidence: topFiles.map(function (p) { return evAt(p, 1); }), status: 'done' });
    return { steps: steps, verdict: localVerdict,
      answer: 'The index holds **' + idx.symbolCount + ' symbol definitions** (' + idx.symbols.size + ' unique names). Densest files:\n\n' + topFiles.map(function (p) { return '- `' + p + '` — ' + byFile[p] + ' symbols'; }).join('\n') + '\n\nAsk `symbols <name>` to find a specific one.' };
  }

  if (intent.kind === 'structure') {
    var paths = sortedPaths(), dirCounts = {};
    paths.forEach(function (p) { var d = dirOf(p) || '.'; dirCounts[d] = (dirCounts[d] || 0) + 1; });
    var topDirs = Object.keys(dirCounts).sort(function (a, b) { return dirCounts[b] - dirCounts[a]; }).slice(0, 8);
    var langs = Object.keys(idx.byExt).sort(function (a, b) { return idx.byExt[b] - idx.byExt[a]; }).slice(0, 6);
    steps.push({ action: 'read the project index', note: idx.fileCount + ' files · ' + idx.packages.length + ' packages · ' + idx.symbolCount + ' symbols', evidence: idx.entries.slice(0, 4).map(function (p) { return evAt(p, 1); }), status: 'done' });
    steps.push({ action: 'map directories & languages', note: topDirs.length + ' directories', evidence: idx.packages.slice(0, 4).map(function (pk) { return evAt(pk.manifest, 1); }), status: 'done' });
    var sans = '**Project structure** — ' + idx.fileCount + ' files, ' + idx.symbolCount + ' symbols.\n\n'
      + '**Packages:** ' + (idx.packages.length ? idx.packages.map(function (pk) { return '`' + (pk.name || pk.dir) + '`'; }).join(', ') : 'none detected (no build manifests)') + '\n'
      + '**Entry points:** ' + (idx.entries.length ? idx.entries.map(function (p) { return '`' + p + '`'; }).join(', ') : 'none detected') + '\n'
      + '**Tests:** ' + (idx.tests.length ? idx.tests.length + ' file' + (idx.tests.length === 1 ? '' : 's') : 'none detected') + '\n'
      + '**Top directories:** ' + topDirs.map(function (d) { return '`' + d + '` (' + dirCounts[d] + ')'; }).join(', ') + '\n'
      + '**Languages:** ' + langs.map(function (e) { return e + ' (' + idx.byExt[e] + ')'; }).join(', ');
    return { steps: steps, verdict: localVerdict, answer: sans };
  }

  if (intent.kind === 'tests') {
    steps.push({ action: 'read test classification from the index', note: idx.tests.length + ' test file' + (idx.tests.length === 1 ? '' : 's'), evidence: idx.tests.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
    return { steps: steps, verdict: localVerdict,
      answer: idx.tests.length ? 'Detected ' + idx.tests.length + ' test file' + (idx.tests.length === 1 ? '' : 's') + ' (patterns: `.test.` `.spec.` `_test` `tests/` `__tests__`):\n\n' + idx.tests.slice(0, 20).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No test files detected by the standard patterns (`.test.` `.spec.` `_test` `tests/` `__tests__`). That is a real finding about this project, not a limitation.' };
  }

  if (intent.kind === 'entries') {
    steps.push({ action: 'read entry-point classification', note: idx.entries.length + ' entry point' + (idx.entries.length === 1 ? '' : 's'), evidence: idx.entries.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
    return { steps: steps, verdict: localVerdict,
      answer: idx.entries.length ? 'Likely entry points (index/main/app/server/cli/core/lib):\n\n' + idx.entries.slice(0, 20).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No conventional entry-point filenames detected.' };
  }

  if (intent.kind === 'recent') {
    var rr = localRecentData(arg || '10'); rr.steps.forEach(function (step) { step.status = 'done'; });
    return { steps: rr.steps, verdict: localVerdict, answer: rr.answer };
  }
  if (intent.kind === 'dir') {
    var dd = localDirData(arg || '.'); dd.steps.forEach(function (step) { step.status = 'done'; });
    return { steps: dd.steps, verdict: localVerdict, answer: dd.answer };
  }
  if (intent.kind === 'search') {
    if (!arg) return { steps: [{ action: 'parse command', note: 'search needs a pattern', evidence: [], status: 'done' }], verdict: localVerdict, answer: '`search` needs a pattern, e.g. `search cache_control`.' };
    var sr = localSearchData(arg, 'text');
    steps.push({ action: 'search “' + arg + '”', note: sr.hits.length + ' hit' + (sr.hits.length === 1 ? '' : 's') + ' in ' + sr.filesHit + ' file' + (sr.filesHit === 1 ? '' : 's'), evidence: sr.hits.slice(0, 12).map(localEvidence), status: 'done' });
    return { steps: steps, verdict: localVerdict, answer: sr.hits.length ? 'Found ' + (sr.hits.length >= sr.cap ? sr.cap + '+' : sr.hits.length) + ' match' + (sr.hits.length === 1 ? '' : 'es') + ' for `' + arg + '`. Chips open each at its line.' : 'No matches for `' + arg + '`.' };
  }

  if (intent.kind === 'listType') {
    var em = q.toLowerCase().match(/\b(typescript|javascript|python|golang|go|rust|java|ruby|markdown|html|css|json|yaml|c\+\+|c#|[a-z]{1,6})\s+files?\b/);
    var alias = { typescript: 'ts', javascript: 'js', python: 'py', golang: 'go', rust: 'rs', java: 'java', ruby: 'rb', markdown: 'md', 'c++': 'cpp', 'c#': 'cs' };
    var want = em ? (alias[em[1]] || em[1]) : '';
    var matched = sortedPaths().filter(function (p) { return fileExt(p) === want; });
    steps.push({ action: 'filter files by extension “' + want + '”', note: matched.length + ' file' + (matched.length === 1 ? '' : 's'), evidence: matched.slice(0, 12).map(function (p) { return evAt(p, 1); }), status: 'done' });
    return { steps: steps, verdict: localVerdict, answer: matched.length ? matched.length + ' `.' + want + '` file' + (matched.length === 1 ? '' : 's') + ':\n\n' + matched.slice(0, 25).map(function (p) { return '- `' + p + '`'; }).join('\n') : 'No `.' + want + '` files loaded.' };
  }

  if (intent.kind === 'reason') {
    var t = gatherTerrain(q, steps);
    var sym = intent.arg && symLookup(intent.arg, idx).length ? intent.arg : (t.terms[0] || '');
    if (sym) {
      var sd = symLookup(sym, idx);
      if (sd.length) steps.push({ action: 'locate “' + sym + '”', note: sd.length + ' definition' + (sd.length === 1 ? '' : 's'), evidence: sd.slice(0, 4).map(function (d) { return evAt(d.file, d.line); }), status: 'done' });
    }
    actions = [];
    if (sym) actions.push({ kind: 'def', command: sym, why: 'inspect where ' + sym + ' is defined' }, { kind: 'refs', command: sym, why: 'see everywhere ' + sym + ' is used' });
    actions.push({ kind: 'recent', command: '10', why: 'check what changed recently' });
    var top5 = t.ranked.slice(0, 5).map(function (r) { return '- `' + r.p + '`'; }).join('\n');
    return {
      steps: steps, actions: actions,
      verdict: { local: false, text: 'REQUIRES MODEL REASONING' },
      answer: 'This question asks for **interpretation** (root cause / recommendation / explanation) — that is where a model reasons, and Meridian will not fabricate it. What Meridian **can** tell you is the terrain: it gathered ' + (t.ranked.length) + ' relevant file' + (t.ranked.length === 1 ? '' : 's') + ' and ' + steps.reduce(function (a, s) { return a + (s.evidence ? s.evidence.length : 0); }, 0) + ' pieces of evidence.\n\n'
        + (top5 ? 'Most relevant files:\n\n' + top5 + '\n\n' : '')
        + 'Connect a model in settings to synthesize an answer — Meridian will send only this evidence, not the whole repo.'
    };
  }

  /* plain: deterministic ranked search; synthesis optional */
  var tp = gatherTerrain(q, steps);
  if (!tp.terms.length) return { steps: steps, verdict: localVerdict, answer: 'That question has no distinctive terms to search for. Name a symbol, filename, or keyword — or use a command.\n\n' + LOCAL_HELP };
  var topSym = tp.terms[0];
  actions = [{ kind: 'def', command: topSym, why: 'where “' + topSym + '” is defined' }, { kind: 'refs', command: topSym, why: 'every reference to “' + topSym + '”' }, { kind: 'recent', command: '10', why: 'recently modified files' }];
  return { steps: steps, verdict: localVerdict, actions: actions,
    answer: tp.ranked.length ? 'Deterministic search — the files below best match your words (match count, then importance). Open a chip to inspect, or ask `def`/`refs`. Interpreting *why* would benefit from a model.\n\n' + tp.ranked.slice(0, 5).map(function (r, i) { return (i + 1) + '. `' + r.p + '` — ' + r.count + ' match' + (r.count === 1 ? '' : 'es'); }).join('\n') : 'None of your terms appear in the loaded files. Try different wording or check what is selected in CONTEXT.' };
}

function renderVerdict(msgEl, verdict) {
  if (!verdict) return;
  var bd = msgEl.querySelector('.bd');
  var v = document.createElement('div');
  v.className = 'verdict ' + (verdict.local ? 'ok' : 'model');
  v.innerHTML = '<span class="vk mono"></span><span class="vt"></span>';
  v.querySelector('.vk').textContent = verdict.local ? '✓ ' + verdict.text : '○ ' + verdict.text;
  v.querySelector('.vt').textContent = verdict.local ? 'answered from the project index — zero inference, zero network' : 'evidence gathered locally — connect a model to synthesize';
  bd.appendChild(v);
}

function askLocal(q) {
  addUserMsg(q);
  var msgEl = addAiMsg();
  var txtEl = msgEl.querySelector('.txt');
  setStatus('LOCAL ENGINE — investigating…');

  var answer, trace, verdict;
  if (!st.files.size) {
    answer = 'No project is loaded, so there is no terrain to analyze yet. Drop a folder into CONTEXT and Meridian will index it — or switch to an AI provider in settings.\n\n**Known locally:** ' + CAP_LOCAL.join(' · ') + '.\n**Requires a model:** ' + CAP_MODEL.join(' · ') + '.\n\n' + LOCAL_HELP;
    trace = { steps: [{ action: 'check loaded context', note: 'no files in memory', evidence: [] }] };
    verdict = { local: true, text: 'KNOWN LOCALLY' };
  } else {
    var intent = classifyIntent(q);
    var inv = runInvestigation(q, intent);
    answer = inv.answer;
    trace = { steps: inv.steps, actions: inv.actions || null };
    verdict = inv.verdict;
  }

  txtEl.innerHTML = renderRich(answer);
  renderVerdict(msgEl, verdict);
  renderTrace(msgEl, trace);
  /* the header chip defaults to TRACED — relabel it so nobody mistakes this for a model */
  var chip = msgEl.querySelector('.term-hd .chip');
  if (chip) { chip.className = 'chip'; chip.textContent = 'LOCAL · NO AI'; }
  var hd = msgEl.querySelector('.term-hd');
  if (hd && hd.firstChild) hd.firstChild.textContent = 'MERIDIAN LOCAL ENGINE — NO AI ';

  st.history.push({ role: 'user', content: q });
  st.history.push({ role: 'assistant', content: answer });
  st.transcript.push({ q: q, answer: answer, trace: trace, model: 'LOCAL ENGINE', provider: 'LOCAL', ts: Date.now() });
  attachCopy(msgEl, st.transcript.length - 1);
  setStatus('LOCAL ENGINE IDLE — deterministic · zero network');
  announce('Local answer ready.');
  scrollEnd();
}

/* ---- Project Intelligence overview: the deterministic terrain, shown on load
   for every provider. Tiles are real queries into the same engine. ---- */
function renderOverview() {
  var ov = $('overview'), emptyEl = $('empty');
  if (!st.files.size) { ov.hidden = true; ov.innerHTML = ''; if (emptyEl) emptyEl.hidden = false; return; }
  if (emptyEl) emptyEl.hidden = true; /* overview is the orientation once a project is loaded */
  var idx = getIndex();
  var dirs = {}; sortedPaths().forEach(function (p) { dirs[dirOf(p) || '.'] = 1; });
  var langs = Object.keys(idx.byExt).filter(function (e) { return e !== '·'; }).sort(function (a, b) { return idx.byExt[b] - idx.byExt[a]; });
  var tiles = [
    { label: 'FILES', value: idx.fileCount, q: 'project structure' },
    { label: 'DIRECTORIES', value: Object.keys(dirs).length, q: 'project structure' },
    { label: 'PACKAGES', value: idx.packages.length, q: 'project structure' },
    { label: 'ENTRY POINTS', value: idx.entries.length, q: 'entry points' },
    { label: 'TESTS', value: idx.tests.length, q: 'where are the tests' },
    { label: 'SYMBOLS', value: idx.symbolCount, q: 'symbols' }
  ];
  ov.hidden = false;
  ov.innerHTML = '<div class="ov-hd mono">PROJECT INTELLIGENCE // <b>deterministic</b> — Meridian understands the terrain before a model enters the room</div>'
    + '<div class="stat-grid"></div><div class="ov-index mono"></div><div class="ov-langs mono"></div><div class="ov-cap mono"></div>';
  var grid = ov.querySelector('.stat-grid');
  tiles.forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'stat-tile';
    b.title = 'Run a local investigation: ' + t.q;
    b.innerHTML = '<span class="sl"></span><span class="sv"></span>';
    b.querySelector('.sl').textContent = t.label;
    b.querySelector('.sv').textContent = t.value >= 1000 ? fmtTok(t.value) : String(t.value);
    b.addEventListener('click', function () { askLocal(t.q); });
    grid.appendChild(b);
  });
  var langCount = idx.langs ? Object.keys(idx.langs).length : langs.length;
  ov.querySelector('.ov-index').textContent = '// indexed ' + idx.symbolCount + ' symbol' + (idx.symbolCount === 1 ? '' : 's') + ' · ' + (idx.importCount || 0) + ' import' + ((idx.importCount || 0) === 1 ? '' : 's') + ' · ' + langCount + ' language' + (langCount === 1 ? '' : 's');
  ov.querySelector('.ov-langs').textContent = '// languages: ' + (langs.slice(0, 6).map(function (e) { return e + ' ·' + idx.byExt[e]; }).join('  ') || 'none');
  ov.querySelector('.ov-cap').textContent = '// ✓ known locally: ' + CAP_LOCAL.join(' · ') + '   ○ requires a model: ' + CAP_MODEL.join(' · ');
}

/* data-level directory summary + recent, mirroring runDirSummary / runRecent */
function localDirData(dirPath) {
  var clean = dirPath.replace(/\/+$/, '');
  var prefix = clean === '.' || clean === '' ? '' : clean + '/';
  var items = [];
  st.files.forEach(function (f, p) { if (!prefix || p.indexOf(prefix) === 0) items.push({ p: p, f: f }); });
  if (!items.length) return { answer: 'No loaded files under “' + dirPath + '”.', steps: [{ n: 1, action: 'summarize ' + (prefix || './'), note: 'no files', evidence: [] }] };
  var tok = 0;
  items.forEach(function (it) { tok += it.f.tokens; });
  var largest = items.slice().sort(function (a, b) { return b.f.tokens - a.f.tokens; }).slice(0, 5);
  var ans = '`' + (prefix || './') + '` — ' + items.length + ' file' + (items.length === 1 ? '' : 's') + ' ≈' + fmtTok(tok) + ' tokens. Largest:\n\n'
    + largest.map(function (it, i) { return (i + 1) + '. `' + it.p + '` ≈' + fmtTok(it.f.tokens); }).join('\n');
  return { answer: ans, steps: [{
    n: 1, action: 'summarize ' + (prefix || './'),
    note: items.length + ' files ≈' + fmtTok(tok) + ' tokens',
    evidence: largest.map(function (it) { return { file: it.p, startLine: 1, endLine: 1, quote: '' }; })
  }] };
}
function localRecentData(countStr) {
  var n = Math.min(Math.max(parseInt(countStr, 10) || 10, 1), 20);
  var all = [];
  st.files.forEach(function (f, p) { all.push({ p: p, m: f.mtime }); });
  all.sort(function (a, b) { return b.m - a.m; });
  var top = all.slice(0, n);
  var ans = top.length
    ? 'Most recently modified (from file mtimes):\n\n' + top.map(function (it, i) {
        return (i + 1) + '. `' + it.p + '`' + (it.m ? ' · ' + new Date(it.m).toISOString().slice(0, 10) : '');
      }).join('\n')
    : 'No files loaded.';
  return { answer: ans, steps: [{
    n: 1, action: 'list recent files', note: top.length + ' file' + (top.length === 1 ? '' : 's'),
    evidence: top.map(function (it) { return { file: it.p, startLine: 1, endLine: 1, quote: '' }; })
  }] };
}

/* ============ COMMAND PALETTE (Ctrl/Cmd-K) ============
   Every palette action also exists as a visible control — the palette is
   the L2 power path, never the only path. */
var palOv = $('palette'), palIn = $('pal-in'), palList = $('pal-list');
function clearConversation() {
  if (st.streaming && st.aborter) st.aborter.abort();
  st.history.length = 0; st.transcript.length = 0;
  convoIn.innerHTML = '';
  setStatus('CORE IDLE — conversation cleared');
  toast('Conversation cleared — loaded files stay in memory.');
}
var ACTIONS = [
  { g: 'CONTEXT', n: 'Pick project folder', k: 'ctrl⇧O', f: function () { $('dirbtn').click(); } },
  { g: 'CONTEXT', n: 'Pick files', k: '', f: function () { $('filepick').click(); } },
  { g: 'CONTEXT', n: 'Toggle smart / full context', k: '', f: function () { setCtxMode(st.ctxMode === 'smart' ? 'full' : 'smart'); toast('Context mode: ' + st.ctxMode.toUpperCase() + '.'); } },
  { g: 'CONTEXT', n: 'Preview what will be sent', k: '', f: openPreview },
  { g: 'CONTEXT', n: 'Review skipped files', k: '', f: function () { if (st.skippedFiles.length) openSkipReview(); else toast('No skipped files recorded.'); } },
  { g: 'CONTEXT', n: 'Select all files', k: '', f: function () { $('selall').click(); } },
  { g: 'CONTEXT', n: 'Select no files', k: '', f: function () { $('selnone').click(); } },
  { g: 'CONTEXT', n: 'Unload project', k: '', f: function () { $('clearctx').click(); } },
  { g: 'PROJECTS', n: 'Save project (tree + settings)', k: '', f: function () { $('saveproj').click(); } },
  { g: 'CONVERSE', n: 'Focus composer', k: '', f: function () { promptEl.focus(); } },
  { g: 'CONVERSE', n: 'Stop streaming', k: '', f: function () { if (st.aborter) st.aborter.abort(); } },
  { g: 'CONVERSE', n: 'Clear conversation', k: '', f: clearConversation },
  { g: 'EXPORT', n: 'Export session as Markdown', k: 'ctrl E', f: function () { exportTraces('md'); } },
  { g: 'EXPORT', n: 'Export session as HTML', k: '', f: function () { exportTraces('html'); } },
  { g: 'CONTEXT', n: 'Suggest ignore patterns', k: '', f: function () { openDrawer(true); suggestIgnore(); } },
  { g: 'CONVERSE', n: 'Reset session cost', k: '', f: resetCost },
  { g: 'SETTINGS', n: 'Open settings', k: 'ctrl .', f: function () { openDrawer(true); } },
  { g: 'SETTINGS', n: 'Load the demo project (LOCAL)', k: '', f: function () { startDemo(); } },
  { g: 'SETTINGS', n: 'Toggle ceremony / daylight', k: '', f: flipMode },
  { g: 'SETTINGS', n: 'Show keymap', k: '?', f: openKeymap },
  { g: 'SETTINGS', n: 'Run self-tests (dev)', k: '', f: runAndShowSelfTests }
];
var palSel = 0, palMatches = [];
function fuzzy(q, s) {
  q = q.toLowerCase(); s = s.toLowerCase();
  var i = 0, j = 0;
  while (i < q.length && j < s.length) { if (q[i] === s[j]) i++; j++; }
  return i === q.length;
}
function palRender() {
  var q = palIn.value.trim();
  palMatches = ACTIONS.filter(function (a) { return !q || fuzzy(q, a.g + ' ' + a.n); });
  palSel = Math.min(palSel, Math.max(0, palMatches.length - 1));
  palList.innerHTML = '';
  if (!palMatches.length) {
    palList.innerHTML = '<div class="pal-empty">// no matching command — esc to close</div>';
    return;
  }
  palMatches.forEach(function (a, i) {
    var d = document.createElement('div');
    d.className = 'pal-row' + (i === palSel ? ' sel' : '');
    d.setAttribute('role', 'option');
    d.setAttribute('aria-selected', String(i === palSel));
    d.innerHTML = '<span class="grp mono"></span><span class="nm"></span>' + (a.k ? '<kbd></kbd>' : '');
    d.children[0].textContent = a.g;
    d.children[1].textContent = a.n;
    if (a.k) d.children[2].textContent = a.k;
    d.addEventListener('click', function () { palExec(i); });
    d.addEventListener('mousemove', function () { if (palSel !== i) { palSel = i; palRender(); } });
    palList.appendChild(d);
  });
}
function palOpen() { rememberFocus(); palOv.classList.add('on'); palIn.value = ''; palSel = 0; palRender(); palIn.focus(); }
function palClose() { palOv.classList.remove('on'); palIn.blur(); returnFocus(); }
function palExec(i) { var a = palMatches[i]; if (!a) return; palClose(); a.f(); }
palIn.addEventListener('input', function () { palSel = 0; palRender(); });
palIn.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palMatches.length - 1); palRender(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); palRender(); }
  else if (e.key === 'Enter') { e.preventDefault(); palExec(palSel); }
  else if (e.key === 'Escape') { palClose(); }
});
palOv.addEventListener('click', function (e) { if (e.target === palOv) palClose(); });

var keymapveil = $('keymapveil');
function openKeymap() { rememberFocus(); keymapveil.classList.add('on'); $('keymapclose').focus(); }
function closeKeymap() { keymapveil.classList.remove('on'); returnFocus(); }
$('keysbtn').addEventListener('click', openKeymap);
$('keymaphint').addEventListener('click', openKeymap);
$('keymapclose').addEventListener('click', closeKeymap);
keymapveil.addEventListener('click', function (e) { if (e.target === keymapveil) closeKeymap(); });

/* ============ SELF-TESTS (DEV · EXPERIMENTAL) ============
   Loads a scratch multi-language fixture into a swapped-in files map, runs the
   real index/packer/trace code, asserts, then restores state. No live API calls.
   Reach it via the palette ("Run self-tests") or ?selftest in the URL. */
function stEntry(p, t) { return { content: t, lines: t.split('\n').length, tokens: estTokens(t, p), mtime: 0, base: staticScore(p), checked: true, lang: detectLang(p, t) }; }
function selfTestFixture() {
  return {
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
    'src/aliased.ts': "import { addTodo } from '@/store';\nexport const ALIASED = 1;",
    'pkg/app.py': "from .util import helper\nAPP_NAME = 'demo'\ndef run():\n    return helper()",
    'pkg/util.py': "def helper():\n    return 1",
    'gopkg/server.go': 'package main\nimport (\n  "fmt"\n)\nfunc NewServer() {}\nfunc (s *Server) Start() error { fmt.Println("x"); return nil }',
    'rustcrate/lib.rs': 'pub fn compute(x: i32) -> i32 { x }\npub struct Engine {}\nmod parser;',
    'rustcrate/parser.rs': 'pub fn parse() {}'
  };
}
function runSelfTests() {
  var results = [];
  function ok(name, cond, extra) { results.push({ name: name, pass: !!cond, extra: extra || '' }); }
  var savedFiles = st.files, savedIndex = st.projectIndex, savedDirty = st.indexDirty;
  try {
    st.files = new Map();
    Object.keys(SAMPLE_PROJECT).forEach(function (p) { st.files.set(p, stEntry(p, SAMPLE_PROJECT[p])); });
    var FIX = selfTestFixture();
    Object.keys(FIX).forEach(function (p) { st.files.set(p, stEntry(p, FIX[p])); });
    st.indexDirty = true; st.projectIndex = null;
    var idx = buildIndex();
    ok('symbols · JS addTodo', idx.symbols.has('addTodo'));
    ok('symbols · JS API_BASE_URL const', idx.symbols.has('API_BASE_URL'));
    ok('symbols · Rust pub fn compute', idx.symbols.has('compute'));
    ok('symbols · Rust struct Engine', idx.symbols.has('Engine'));
    ok('symbols · Go func NewServer', idx.symbols.has('NewServer'));
    ok('symbols · Go receiver method Start', idx.symbols.has('Start'), 'receiver methods');
    ok('symbols · Python def run', idx.symbols.has('run'));
    ok('symbols · Python const APP_NAME', idx.symbols.has('APP_NAME'));
    ok('imports · store.js importedBy server.js', (idx.importedBy.get('src/store.js') || []).some(function (e) { return e.file === 'src/server.js'; }));
    ok('imports · tsconfig @/ alias resolves', (idx.importsByFile.get('src/aliased.ts') || []).some(function (e) { return e.resolved === 'src/store.js'; }), '@/store → src/store.js');
    ok('imports · Python relative from .util', (idx.importsByFile.get('pkg/app.py') || []).some(function (e) { return e.resolved === 'pkg/util.py'; }));
    ok('imports · Go block import recorded', (idx.importsByFile.get('gopkg/server.go') || []).some(function (e) { return e.raw === 'fmt'; }));
    ok('imports · Rust mod parser resolves', (idx.importsByFile.get('rustcrate/lib.rs') || []).some(function (e) { return e.resolved === 'rustcrate/parser.rs'; }));
    ok('index · languages counted', idx.langs && Object.keys(idx.langs).length >= 4, Object.keys(idx.langs || {}).join(','));
    ok('index · importCount > 0', (idx.importCount || 0) > 0, String(idx.importCount));
    /* packer respects budget and never emits a line number past a file's length */
    var packed = packSmartContext('where is API_BASE_URL defined', 4000);
    ok('packer · within budget', packed.tokens <= 4000, packed.tokens + ' / 4000');
    ok('packer · emits FILE markers', /═══ FILE:/.test(packed.text));
    ok('packer · line-numbered content present', /\d+│/.test(packed.text) || packed.included.every(function (x) { return x.whole; }));
    /* intent routing returns a decision */
    ok('intent · classifyIntent returns a kind', !!(classifyIntent('where is addTodo defined') || {}).kind);
    /* trace parser fallbacks */
    ok('trace · clean fence', extractTrace('a\n```meridian-trace\n{"steps":[{"action":"x"}]}\n```').degraded === null);
    ok('trace · ```json salvaged', extractTrace('a\n```json\n{"steps":[{"action":"x"}]}\n```').degraded === 'salvaged');
    ok('trace · fenceless salvaged', extractTrace('a\n{"steps":[{"action":"x"}]}').degraded === 'salvaged');
    ok('trace · truncated detected', extractTrace('a\n```meridian-trace\n{"steps":[{"action":"x"').degraded === 'truncated');
    ok('trace · no-trace', extractTrace('just prose').degraded === 'no-trace');
    /* grounding roundtrip: a canned grounded answer yields a live (known) chip */
    var canned = 'API_BASE_URL is in config.\n```meridian-trace\n{"steps":[{"action":"locate","evidence":[{"file":"src/config.js","startLine":5,"endLine":5,"quote":"API_BASE_URL"}]}],"confidence":0.9}\n```';
    var pr = extractTrace(canned);
    var ev0 = pr.trace && pr.trace.steps[0] && pr.trace.steps[0].evidence[0];
    ok('grounding · cited file resolves to loaded context', !!(ev0 && st.files.has(ev0.file)), ev0 ? ev0.file : 'no evidence');
  } catch (e) {
    ok('harness executed without throwing', false, String(e && e.message || e));
  } finally {
    st.files = savedFiles; st.projectIndex = savedIndex; st.indexDirty = savedDirty;
  }
  return results;
}
function showSelfTestResults(results) {
  var pass = results.filter(function (r) { return r.pass; }).length;
  var veil = document.createElement('div'); veil.className = 'veil on'; veil.id = 'selftestveil';
  var modal = document.createElement('div'); modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Self-test results');
  var rows = results.map(function (r) {
    return '<tr><td class="' + (r.pass ? 'st-pass' : 'st-fail') + '">' + (r.pass ? '✓' : '✗') + '</td><td>' + esc(r.name) + '</td><td class="mono" style="color:var(--ink-3)">' + esc(r.extra || '') + '</td></tr>';
  }).join('');
  modal.innerHTML = '<div class="k mono">MERIDIAN // SELF-TESTS<span class="st-badge mono">DEV</span></div>'
    + '<h2>' + pass + ' / ' + results.length + ' passed</h2>'
    + '<p class="note mono" style="color:var(--ink-3)">// deterministic checks of the index, packer and trace parser on a scratch fixture — no network, no API.</p>'
    + '<table>' + rows + '</table>'
    + '<div class="row"><button class="btn btn-hairline" type="button" id="selftestclose">Close</button></div>';
  veil.appendChild(modal);
  app.appendChild(veil); /* inside #app so the CSS variables resolve */
  rememberFocus();
  var untrap = trap(modal);
  function close() { veil.remove(); if (untrap) untrap(); returnFocus(); }
  modal.querySelector('#selftestclose').addEventListener('click', close);
  veil.addEventListener('click', function (e) { if (e.target === veil) close(); });
  modal.querySelector('#selftestclose').focus();
  try { console.table(results.map(function (r) { return { test: r.name, pass: r.pass, detail: r.extra }; })); } catch (e) {}
  var fails = results.length - pass;
  toast(fails ? 'Self-tests: ' + pass + '/' + results.length + ' passed · ' + fails + ' FAILED.' : 'Self-tests: all ' + pass + ' passed.');
}
function runAndShowSelfTests() { showSelfTestResults(runSelfTests()); }

/* ============ GLOBAL KEYS ============ */
document.addEventListener('keydown', function (e) {
  var mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palOv.classList.contains('on') ? palClose() : palOpen();
    return;
  }
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault(); exportTraces('md'); return;
  }
  if (mod && !e.altKey && !e.shiftKey && e.key === '.') {
    e.preventDefault(); openDrawer(!drawer.classList.contains('open')); return;
  }
  if (mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault(); $('dirbtn').click(); return;
  }
  var tag = (document.activeElement && document.activeElement.tagName) || '';
  var inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (e.key === '?' && !inField && !mod) {
    keymapveil.classList.contains('on') ? closeKeymap() : openKeymap();
    return;
  }
  if (e.key === 'Escape') {
    if (palOv.classList.contains('on')) { palClose(); return; }
    if (keymapveil.classList.contains('on')) { closeKeymap(); return; }
    if (viewveil.classList.contains('on')) { closeViewer(); return; }
    if (prevveil.classList.contains('on')) { closePreview(); return; }
    if (skipveil.classList.contains('on')) { closeSkipReview(); return; }
    if (drawer.classList.contains('open')) { openDrawer(false); return; }
    if (rail.classList.contains('open')) { rail.classList.remove('open'); railbtn.setAttribute('aria-expanded', 'false'); return; }
  }
});

syncProviderUI();
setCtxMode(st.ctxMode); /* also renders the budget */
window.__meridianSelfTest = runSelfTests; /* L3: run from the console */
if (/[?&]selftest\b/.test(location.search)) setTimeout(runAndShowSelfTests, 300);
console.log('%cMERIDIAN WORKBENCH', 'color:#FF5C0A;font-weight:bold', '— Engine v0.2-hardened · free beta. zero egress to us; requests go browser → api.anthropic.com under your key. Run __meridianSelfTest() or add ?selftest.');
