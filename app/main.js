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
import { askLocal, classifyIntent, pickSymbol, renderOverview, runInvestigation, symLookup } from './local.js';
import { FENCE, INSTRUCTIONS, STRICT_SUFFIX, buildContextBlocks, buildInvestigationBlock } from './prompt.js';
import { IGNORE_DIRS, afterIngest, closePreview, closeSkipReview, getIgnoreText, ingestFile, maybeAutoSmart, openPreview, openSkipReview, prevveil, renderBudget, selectedTokens, setCtxMode, setIgnoreText, skipveil, suggestIgnore, syncBudgetState } from './ingest.js';
import { wipeMemory, initMemory } from './memory.js';
import { SAMPLE_PROJECT, startDemo } from './demo.js';
import { curKeyLS, drawer, flipMode, openDrawer, rail, railbtn, syncProviderUI } from './shell.js';
import { promptEl, resetCost } from './chat.js';






initMemory();

initViewer();


initExport();

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


