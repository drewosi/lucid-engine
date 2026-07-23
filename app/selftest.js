import { estTokens, packSmartContext, staticScore } from './smart-context.js';
import { buildIndex, detectLang } from './indexer.js';
import { st } from './state.js';
import { SAMPLE_PROJECT } from './demo.js';
import { classifyIntent } from './local.js';
import { INTENTS, runInvestigation } from './intents.js';
import { extractTrace } from './trace.js';
import { httpErrorText, parseStreamEvent } from './chat.js';
import { ingestFile } from './ingest.js';
import { app, esc, rememberFocus, returnFocus, toast, trap } from './helpers.js';
/* ============ SELF-TESTS (DEV · EXPERIMENTAL) ============
   Loads a scratch multi-language fixture into a swapped-in files map, runs the
   real index/packer/trace/SSE-adapter/ingest code, asserts, then restores state.
   No live API calls — streaming is tested with canned events, ingest with
   synthetic File objects. Async (the ingest cases read real Blobs): returns a
   Promise of results. Reach it via the palette ("Run self-tests") or ?selftest. */
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
/* async ingest cases — drive the REAL ingestFile with synthetic files against
   the swapped-in scratch state. Sequential so counter assertions are ordered. */
function ingestCases(ok) {
  var big = new Array(600 * 1024).join('a'); /* ~600KB > the 512KB per-file cap */
  var binBytes = new Uint8Array([0x00, 0x01, 0x02, 0x00, 0x41]); /* null bytes → binary sniff */
  return ingestFile(new File(['x'], 'pic.png'), 'assets/pic.png').then(function () {
    ok('ingest · binary-ext skipped + recorded', !st.files.has('assets/pic.png') && st.skipped.binary === 1
      && st.skippedFiles.some(function (s) { return s.path === 'assets/pic.png' && s.reason === 'binary-ext'; }));
    return ingestFile(new File([big], 'big.txt'), 'big.txt');
  }).then(function () {
    ok('ingest · oversized skipped + recorded', !st.files.has('big.txt') && st.skipped.big === 1
      && st.skippedFiles.some(function (s) { return s.path === 'big.txt' && s.reason === 'oversized'; }));
    return ingestFile(new File([binBytes], 'weird.txt'), 'weird.txt');
  }).then(function () {
    ok('ingest · binary content sniffed', !st.files.has('weird.txt') && st.skipped.binary === 2);
    return ingestFile(new File(['\uFEFFhello BOM'], 'hello.txt'), 'src/hello.txt');
  }).then(function () {
    var f = st.files.get('src/hello.txt');
    ok('ingest · UTF-8 decoded, BOM stripped', !!f && f.content === 'hello BOM');
    return ingestFile(new File(['tiny'], 'pic2.png'), 'pic2.png', true); /* include-back force */
  }).then(function () {
    ok('ingest · force bypasses filters', st.files.has('pic2.png'));
    /* a File-like whose read rejects — must surface as read-error, not binary */
    var ghost = { name: 'ghost.txt', size: 5, arrayBuffer: function () { return Promise.reject(new Error('permission denied')); } };
    return ingestFile(ghost, 'ghost.txt');
  }).then(function () {
    ok('ingest · read failure → read-error skip', !st.files.has('ghost.txt') && st.skipped.readerr === 1
      && st.skippedFiles.some(function (s) { return s.path === 'ghost.txt' && s.reason === 'read-error'; }));
    ok('ingest · totalBytes tracks loaded text', st.totalBytes === 'hello BOM'.length + 'tiny'.length, String(st.totalBytes));
  });
}
function runSelfTests() {
  var results = [];
  function ok(name, cond, extra) { results.push({ name: name, pass: !!cond, extra: extra || '' }); }
  var savedFiles = st.files, savedIndex = st.projectIndex, savedDirty = st.indexDirty;
  var savedSkipped = st.skipped, savedSkipList = st.skippedFiles, savedBytes = st.totalBytes;
  function restore() {
    st.files = savedFiles; st.projectIndex = savedIndex; st.indexDirty = savedDirty;
    st.skipped = savedSkipped; st.skippedFiles = savedSkipList; st.totalBytes = savedBytes;
  }
  try {
    st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0, readerr: 0, memcap: 0 };
    st.skippedFiles = [];
    st.totalBytes = 0;
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
    /* intent routing — the full query → kind table, command grammar + NL cascade.
       Order-sensitive: several rows exist purely to pin cascade precedence. */
    var ROUTES = [
      ['def addTodo', 'def'],
      ['where is addTodo defined', 'def'],
      ['refs addTodo', 'refs'],
      ['what references addTodo', 'refs'],
      ['who calls addTodo', 'refs'],
      ['importers store.js', 'importers'],
      ['what imports store.js', 'importers'],
      ['what does server.js import', 'imports'],
      ['files related to store.js', 'related'],
      ['project structure', 'structure'],
      ['where are the tests', 'tests'],
      ['entry points', 'entries'],
      ['what changed recently', 'recent'],
      ['recent 5', 'recent'],
      ['list js files', 'listType'],
      ['search API_BASE_URL', 'search'],
      ['dir src', 'dir'],
      ['symbols', 'symbols'],
      ['help', 'help'],
      ['why is the store slow', 'reason'],
      ['summarize everything about it', 'plain']
    ];
    ROUTES.forEach(function (rc) {
      var got = classifyIntent(rc[0]) || {};
      ok('route · “' + rc[0] + '” → ' + rc[1], got.kind === rc[1], got.kind !== rc[1] ? 'got ' + got.kind : '');
    });
    ok('route · reason needs a model', classifyIntent('why is the store slow').needsModel === true);
    ok('route · def arg picks the symbol', classifyIntent('where is addTodo defined').arg === 'addTodo');
    ok('route · importers arg picks the path', classifyIntent('what imports store.js').arg === 'store.js');
    /* registry consistency — every reasoning instance is a complete entry */
    ok('registry · entries complete (kind/ground/run)', INTENTS.every(function (it) {
      return typeof it.kind === 'string' && it.kind && typeof it.ground === 'string' && typeof it.run === 'function'
        && (it.route === null || typeof it.route === 'function') && Array.isArray(it.aliases);
    }));
    ok('registry · kinds unique', new Set(INTENTS.map(function (it) { return it.kind; })).size === INTENTS.length);
    ok('registry · plain is the terminal fallback', INTENTS[INTENTS.length - 1].kind === 'plain');
    /* trace parser fallbacks */
    ok('trace · clean fence', extractTrace('a\n```meridian-trace\n{"steps":[{"action":"x"}]}\n```').degraded === null);
    ok('trace · ```json salvaged', extractTrace('a\n```json\n{"steps":[{"action":"x"}]}\n```').degraded === 'salvaged');
    ok('trace · fenceless salvaged', extractTrace('a\n{"steps":[{"action":"x"}]}').degraded === 'salvaged');
    ok('trace · truncated detected', extractTrace('a\n```meridian-trace\n{"steps":[{"action":"x"').degraded === 'truncated');
    ok('trace · no-trace', extractTrace('just prose').degraded === 'no-trace');
    /* answers ABOUT the trace format must survive intact — a quoted example whose
       citations don't resolve in the loaded context is prose, not a trace */
    var quoted = extractTrace('the format looks like:\n```json\n{"steps":[{"action":"x","evidence":[{"file":"not/loaded.js","startLine":1,"endLine":2}]}]}\n```\nthat is the shape.');
    ok('trace · quoted example not stripped', quoted.degraded === 'no-trace' && quoted.answer.indexOf('"steps"') !== -1);
    var pad = new Array(40).join('long explanatory prose follows here\n');
    ok('trace · mid-answer "steps" mention untouched', extractTrace('code uses {"steps": internally\n' + pad).degraded === 'no-trace');
    /* grounding roundtrip: a canned grounded answer yields a live (known) chip */
    var canned = 'API_BASE_URL is in config.\n```meridian-trace\n{"steps":[{"action":"locate","evidence":[{"file":"src/config.js","startLine":5,"endLine":5,"quote":"API_BASE_URL"}]}],"confidence":0.9}\n```';
    var pr = extractTrace(canned);
    var ev0 = pr.trace && pr.trace.steps[0] && pr.trace.steps[0].evidence[0];
    ok('grounding · cited file resolves to loaded context', !!(ev0 && st.files.has(ev0.file)), ev0 ? ev0.file : 'no evidence');
    /* SSE adapters — canned provider events through the real parseStreamEvent */
    var sa = parseStreamEvent({ type: 'message_start', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 } } }, true);
    ok('sse · anthropic message_start usage', !!sa.usage && sa.usage.in === 10 && sa.usage.cacheW === 3 && sa.usage.cacheR === 2);
    ok('sse · anthropic text_delta', parseStreamEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }, true).text === 'hi');
    ok('sse · anthropic thinking_delta not rendered', parseStreamEvent({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } }, true).text === null);
    var sb = parseStreamEvent({ type: 'message_delta', usage: { output_tokens: 7 }, delta: { stop_reason: 'end_turn' } }, true);
    ok('sse · anthropic message_delta usage+stop', !!sb.usage && sb.usage.out === 7 && sb.stopReason === 'end_turn');
    ok('sse · anthropic error event', parseStreamEvent({ type: 'error', error: { message: 'overloaded' } }, true).errorMsg === 'overloaded');
    ok('sse · openai delta content', parseStreamEvent({ choices: [{ delta: { content: 'ok' } }] }, false).text === 'ok');
    ok('sse · openai length→max_tokens', parseStreamEvent({ choices: [{ delta: {}, finish_reason: 'length' }] }, false).stopReason === 'max_tokens');
    var sc = parseStreamEvent({ usage: { prompt_tokens: 5, completion_tokens: 6 } }, false);
    ok('sse · openai usage', !!sc.usage && sc.usage.in === 5 && sc.usage.out === 6);
    ok('sse · openai error event', parseStreamEvent({ error: { message: 'bad' } }, false).errorMsg === 'bad');
    /* HTTP error taxonomy */
    ok('http · 401 key rejected', httpErrorText(401, '').indexOf('KEY REJECTED') === 0);
    ok('http · 429 uses retry-after', httpErrorText(429, '', '12').indexOf('retry in 12s') !== -1);
    ok('http · 400 context too large', httpErrorText(400, JSON.stringify({ error: { message: 'prompt exceeds context length' } })).indexOf('CONTEXT TOO LARGE') === 0);
    ok('http · 529 overloaded', httpErrorText(529, '').indexOf('PROVIDER OVERLOADED') === 0);
  } catch (e) {
    ok('harness executed without throwing', false, String(e && e.message || e));
    restore();
    return Promise.resolve(results);
  }
  /* the ingest cases are async (real Blob reads) — run them, then restore state */
  return ingestCases(ok).catch(function (e) {
    ok('ingest harness executed without throwing', false, String(e && e.message || e));
  }).then(function () {
    restore();
    return results;
  });
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
    + '<p class="note mono" style="color:var(--ink-3)">// deterministic checks of the index, packer, trace parser, stream adapters and ingest filters on a scratch fixture — no network, no API.</p>'
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
function runAndShowSelfTests() { runSelfTests().then(showSelfTestResults); }
export { runAndShowSelfTests, runSelfTests };
