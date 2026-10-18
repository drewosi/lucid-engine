import { packSmartContext } from './smart-context.js';
import { buildIndex, detectLang } from './indexer.js';
import { st } from './state.js';
import { SAMPLE_PROJECT } from './demo.js';
import { classifyIntent } from './local.js';
import { listOrphans, runInvestigation } from './intents.js';
import { __setCapsForTest, ignoredDirPrefix } from './ingest.js';
import { localSearchData } from './actions.js';
import { buildContextBlocks } from './prompt.js';
import { app, esc, rememberFocus, returnFocus, toast, trap } from './helpers.js';
import { resetWorkspace } from './repos.js';
import { indexCases } from './selftest-index.js';
import { sealCases } from './selftest-seal.js';
import { verifyCases } from './selftest-verify.js';
import { diagCases } from './selftest-diag.js';
import { parityCases } from './selftest-parity.js';
import { __setAnalyticsForTest, summarize } from './analytics.js';
import { ingestCases, fileCapCases } from './selftest-ingest.js';
import { shareCases } from './selftest-share.js';
import { workspaceCases } from './selftest-workspace.js';
import { demoLinkCases, demoCatchCases } from './selftest-demo.js';
import { estBiasCases, smartBudgetCases, symbolPickCases } from './selftest-smart.js';
import { routingCases } from './selftest-routing.js';
import { wireCases } from './selftest-wire.js';
import { analyticsCases } from './selftest-analytics.js';
import { stEntry, selfTestFixture, memStore } from './selftest-fixture.js';
/* ============ SELF-TESTS (DEV · EXPERIMENTAL) ============
   Loads a scratch multi-language fixture into a swapped-in files map, runs the
   real index/packer/trace/SSE-adapter/ingest code, asserts, then restores state.
   No live API calls — streaming is tested with canned events, ingest with
   synthetic File objects. Async (the ingest cases read real Blobs): returns a
   Promise of results. Reach it via the palette ("Run self-tests") or ?selftest. */
function runSelfTests() {
  var results = [];
  function ok(name, cond, extra) { results.push({ name: name, pass: !!cond, extra: extra || '' }); }
  var savedFiles = st.files, savedIndex = st.projectIndex, savedDirty = st.indexDirty;
  var savedSkipped = st.skipped, savedSkipList = st.skippedFiles, savedBytes = st.totalBytes;
  var savedDriftSig = st.driftSig, savedDriftPrev = st.driftPrev, savedDriftPending = st.driftPending;
  var savedPins = st.pinnedEv;
  var savedWs = { repos: st.repos, ws: st.ws, pending: st.pendingWorkspace, wsCache: st.wsCache, scopeCache: st.scopeCache };
  var savedCaps = __setCapsForTest({}); /* read-only snapshot — cap tests lower them, restore() puts them back */
  /* the whole run uses a scratch analytics store and no network, so the
     scratch fixtures can never land in the user's real usage log */
  var savedAn = __setAnalyticsForTest({ store: memStore(), fetch: function () { return Promise.reject(new Error('self-tests make no network requests')); } });
  function restore() {
    __setAnalyticsForTest(savedAn);
    st.files = savedFiles; st.projectIndex = savedIndex; st.indexDirty = savedDirty;
    st.skipped = savedSkipped; st.skippedFiles = savedSkipList; st.totalBytes = savedBytes;
    st.driftSig = savedDriftSig; st.driftPrev = savedDriftPrev; st.driftPending = savedDriftPending;
    st.pinnedEv = savedPins;
    st.repos = savedWs.repos; st.ws = savedWs.ws; st.pendingWorkspace = savedWs.pending; st.wsCache = savedWs.wsCache; st.scopeCache = savedWs.scopeCache;
    st.contextDirty = true; st.mapDirty = true; /* scratch context never leaks into the next real request */
    __setCapsForTest(savedCaps);
  }
  try {
    resetWorkspace(); /* the scratch fixture is one project — no repos */
    st.driftPending = false;
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
    ok('index · languages counted', idx.langs && Object.keys(idx.langs).length >= 7, Object.keys(idx.langs || {}).join(','));
    /* Java / Ruby / C# depth */
    var JAPP = 'javapkg/src/main/java/com/acme/App.java', JSTR = 'javapkg/src/main/java/com/acme/util/Strings.java';
    ok('java · class + method symbols', idx.symbols.has('App') && (idx.symbols.get('count') || []).some(function (d) { return d.file === JAPP && d.kind === 'method'; }));
    ok('java · static method symbol', (idx.symbols.get('upper') || []).some(function (d) { return d.file === JSTR && d.kind === 'method'; }));
    ok('java · import resolves via Maven root', (idx.importsByFile.get(JAPP) || []).filter(function (e) { return e.resolved === JSTR; }).length === 2, 'plain + static rows');
    ok('java · public members exported', (idx.exportsByFile.get(JSTR) || []).some(function (e) { return e.name === 'upper'; }));
    ok('ruby · module/class/def symbols', idx.symbols.has('Widget') && idx.symbols.has('Frame') && idx.symbols.has('render'));
    ok('ruby · def self.x captures the name', (idx.symbols.get('helper_fn') || []).some(function (d) { return d.file === 'rbapp/lib/widget/helper.rb'; }));
    ok('ruby · attr_reader recorded', (idx.symbols.get('size') || []).some(function (d) { return d.kind === 'attr'; }));
    ok('ruby · require_relative resolves', (idx.importsByFile.get('rbapp/lib/widget.rb') || []).some(function (e) { return e.resolved === 'rbapp/lib/widget/helper.rb'; }));
    ok('ruby · bare require stays external', (idx.importsByFile.get('rbapp/lib/widget.rb') || []).some(function (e) { return e.raw === 'json' && e.resolved === null; }));
    ok('c# · internal sealed class symbol', (idx.symbols.get('Program') || []).some(function (d) { return d.file === 'csapp/Program.cs'; }));
    ok('c# · method + property symbols', (idx.symbols.get('Greet') || []).some(function (d) { return d.kind === 'method'; }) && (idx.symbols.get('Count') || []).some(function (d) { return d.kind === 'property'; }));
    ok('c# · using resolves via namespace map', (idx.importsByFile.get('csapp/Program.cs') || []).some(function (e) { return e.raw === 'Acme.Services' && e.resolved === 'csapp/Services/Greeter.cs'; }));
    ok('c# · using System stays external', (idx.importsByFile.get('csapp/Program.cs') || []).some(function (e) { return e.raw === 'System' && e.resolved === null; }));
    ok('c# · using-statement not an import', !(idx.importsByFile.get('csapp/Program.cs') || []).some(function (e) { return e.raw === 'var' || e.raw === 'g'; }));
    ok('c# · public members exported, internal not', (idx.exportsByFile.get('csapp/Services/Greeter.cs') || []).some(function (e) { return e.name === 'Greet'; })
      && (idx.exportsByFile.get('csapp/Services/Greeter.cs') || []).some(function (e) { return e.name === 'Count'; })
      && !(idx.exportsByFile.get('csapp/Program.cs') || []).some(function (e) { return e.name === 'Program'; }));
    ok('classify · Java/C# test filenames detected', idx.tests.indexOf('javapkg/src/main/java/com/acme/util/StringsTest.java') !== -1 && idx.tests.indexOf('csapp/GreeterTests.cs') !== -1);
    ok('classify · Program.cs is an entry point', idx.entries.indexOf('csapp/Program.cs') !== -1);
    /* resolver depth — package.json exports/imports/main maps */
    var USEW = idx.importsByFile.get('src/usewspkg.js') || [];
    ok('resolve · exports map "." entry', USEW.some(function (e) { return e.raw === '@acme/tools' && e.resolved === 'wspkg/src/entry.js'; }));
    ok('resolve · conditional exports pick import, never types', USEW.some(function (e) { return e.raw === '@acme/tools/sub' && e.resolved === 'wspkg/src/sub.mjs'; }));
    ok('resolve · star pattern exports', USEW.some(function (e) { return e.raw === '@acme/tools/feat/deep' && e.resolved === 'wspkg/src/feat/deep.js'; }));
    ok('resolve · main field for bare specifier', USEW.some(function (e) { return e.raw === 'plainmain' && e.resolved === 'mainpkg/lib/entry-main.js'; }));
    ok('resolve · #imports alias', (idx.importsByFile.get('wspkg/src/entry.js') || []).some(function (e) { return e.raw === '#util' && e.resolved === 'wspkg/src/u.js'; }));
    /* resolver depth — Rust ::-paths */
    var ALIB = idx.importsByFile.get('crates/alpha/src/lib.rs') || [];
    ok('resolve · rust crate:: path', ALIB.some(function (e) { return e.raw === 'crate::engine::start' && e.resolved === 'crates/alpha/src/engine.rs'; }));
    ok('resolve · rust cross-crate via Cargo name', ALIB.some(function (e) { return e.raw === 'beta_core::api::run' && e.resolved === 'crates/beta/src/api.rs'; }), 'hyphen→underscore');
    ok('resolve · rust external crate stays null', ALIB.some(function (e) { return e.raw === 'serde::Serialize' && e.resolved === null; }));
    ok('resolve · rust super:: to crate root', (idx.importsByFile.get('crates/alpha/src/engine.rs') || []).some(function (e) { return e.raw === 'super::alpha_main' && e.resolved === 'crates/alpha/src/lib.rs'; }));
    ok('resolve · [dependencies] name is not a crate', !ALIB.some(function (e) { return e.resolved !== null && e.resolved.indexOf('decoy') !== -1; }));
    /* Kotlin / Swift / PHP depth */
    var KMAIN = 'ktapp/src/main/kotlin/com/acme/Main.kt', KTEXT = 'ktapp/src/main/kotlin/com/acme/util/Text.kt';
    ok('kotlin · fun/data class/object/val symbols', (idx.symbols.get('main') || []).some(function (d) { return d.file === KMAIN && d.kind === 'fun'; })
      && idx.symbols.has('Point') && idx.symbols.has('Registry') && (idx.symbols.get('MAX_RETRIES') || []).some(function (d) { return d.kind === 'val'; }));
    ok('kotlin · member fun indexed', (idx.symbols.get('shout') || []).some(function (d) { return d.file === KTEXT; }));
    ok('kotlin · import resolves via kotlin source root', (idx.importsByFile.get(KMAIN) || []).some(function (e) { return e.raw === 'com.acme.util.Text' && e.resolved === KTEXT; }));
    ok('kotlin · external import stays null', (idx.importsByFile.get(KMAIN) || []).some(function (e) { return e.raw === 'kotlinx.coroutines.launch' && e.resolved === null; }));
    ok('kotlin · public exported, private not', (idx.exportsByFile.get(KTEXT) || []).some(function (e) { return e.name === 'shout'; })
      && !(idx.exportsByFile.get(KTEXT) || []).some(function (e) { return e.name === 'hidden'; }));
    ok('kotlin · TextTest.kt classified as a test', idx.tests.indexOf('ktapp/src/test/kotlin/com/acme/util/TextTest.kt') !== -1);
    var SREND = 'swiftapp/Sources/Render/Render.swift';
    ok('swift · protocol/extension/open class symbols', (idx.symbols.get('Drawable') || []).some(function (d) { return d.kind === 'protocol'; })
      && (idx.symbols.get('Canvas') || []).filter(function (d) { return d.file === SREND; }).length === 2
      && idx.symbols.has('render'));
    ok('swift · import resolves via Sources convention', (idx.importsByFile.get(SREND) || []).some(function (e) { return e.raw === 'Helper' && e.resolved === 'swiftapp/Sources/Helper/Helper.swift'; }));
    ok('swift · Foundation stays external', (idx.importsByFile.get(SREND) || []).some(function (e) { return e.raw === 'Foundation' && e.resolved === null; }));
    ok('swift · RenderTests.swift classified as a test', idx.tests.indexOf('swiftapp/Tests/RenderTests/RenderTests.swift') !== -1);
    var PSVC = 'phpapp/src/Service.php';
    ok('php · class/function symbols', idx.symbols.has('Service') && idx.symbols.has('boot') && idx.symbols.has('legacy_fn')
      && (idx.symbols.get('name') || []).some(function (d) { return d.file === 'phpapp/src/Models/User.php'; }));
    ok('php · use resolves via composer psr-4', (idx.importsByFile.get(PSVC) || []).some(function (e) { return e.raw === 'App\\Models\\User' && e.resolved === 'phpapp/src/Models/User.php'; }));
    ok('php · external namespace stays null', (idx.importsByFile.get(PSVC) || []).some(function (e) { return e.raw.indexOf('Symfony') === 0 && e.resolved === null; }));
    ok('php · paren-less require resolves beside importer', (idx.importsByFile.get(PSVC) || []).some(function (e) { return e.raw === 'legacy.php' && e.resolved === 'phpapp/src/legacy.php'; }));
    ok('php · ServiceTest.php classified as a test', idx.tests.indexOf('phpapp/tests/ServiceTest.php') !== -1);
    ok('index · importCount > 0', (idx.importCount || 0) > 0, String(idx.importCount));
    /* packer respects budget and never emits a line number past a file's length */
    var packed = packSmartContext('where is API_BASE_URL defined', 4000);
    ok('packer · within budget', packed.tokens <= 4000, packed.tokens + ' / 4000');
    ok('packer · emits FILE markers', /═══ FILE:/.test(packed.text));
    ok('packer · line-numbered content present', /\d+│/.test(packed.text) || packed.included.every(function (x) { return x.whole; }));
    routingCases(ok);
    /* index extensions — exports, todos, env vars, per-file symbol counts */
    ok('index · exports JS declaration', (idx.exportsByFile.get('src/aliased.ts') || []).some(function (e) { return e.name === 'ALIASED'; }));
    ok('index · exports CommonJS braces', (idx.exportsByFile.get('src/store.js') || []).some(function (e) { return e.name === 'listTodos'; }));
    ok('index · exports Rust pub', (idx.exportsByFile.get('rustcrate/lib.rs') || []).some(function (e) { return e.name === 'compute'; }));
    ok('index · exports Go uppercase initial', (idx.exportsByFile.get('gopkg/server.go') || []).some(function (e) { return e.name === 'NewServer'; }));
    ok('index · TODO tag recorded', idx.todos.some(function (t) { return t.file === 'src/orphanish.js' && t.tag === 'TODO'; }));
    ok('index · env var read recorded', (idx.envVars.get('DEMO_FLAG') || []).length === 1);
    ok('index · symCountByFile counts store.js', (idx.symCountByFile['src/store.js'] || 0) >= 3, String(idx.symCountByFile['src/store.js']));
    /* long-line skip disclosure (audit F10) */
    ok('index · >400-char lines counted per file', idx.longLineCount >= 1 && (idx.longLinesByFile['src/minified.js'] || 0) >= 1, 'total=' + idx.longLineCount);
    ok('index · long line NOT scanned for imports', !(idx.importsByFile.get('src/minified.js') || []).some(function (e) { return e.raw === './store.js'; }));
    /* prototype-key hardening (audit F12) — project-supplied names must never
       collide with Object.prototype members */
    ok('hardening · index maps are null-prototype', Object.getPrototypeOf(idx.byExt) === null && Object.getPrototypeOf(idx.symCountByFile) === null && Object.getPrototypeOf(idx.langs) === null);
    ok('hardening · detectLang survives a constructor ext', typeof detectLang('x.constructor', '') === 'string');
    ok('hardening · byExt counts the constructor ext as data', typeof idx.byExt.constructor !== 'function' && idx.byExt['constructor'] === 1, String(idx.byExt['constructor']));
    /* niche investigations — run the real engine over the fixture terrain */
    function inv(qq) { return runInvestigation(qq, classifyIntent(qq)); }
    var cyc = inv('cycles');
    ok('intent · cycles finds the a↔b cycle', /cyc\/a\.js/.test(cyc.answer) && /cyc\/b\.js/.test(cyc.answer) && cyc.verdict.local === true);
    var orp = inv('orphans');
    ok('intent · orphans flags never-imported code', orp.answer.indexOf('src/orphanish.js') !== -1);
    ok('intent · orphans excludes imported files', orp.answer.indexOf('cyc/a.js') === -1);
    ok('intent · orphans discloses skipped long lines', /over 400 chars/.test(orp.answer));
    ok('intent · structure survives a constructor directory', /Project structure/.test(inv('structure').answer));
    var brk = inv('broken');
    ok('intent · broken finds the unresolved relative import', brk.answer.indexOf('./missing-file') !== -1);
    var exp1 = inv('exports src/store.js');
    ok('intent · exports reads module.exports names', /addTodo/.test(exp1.answer) && /removeTodo/.test(exp1.answer));
    var exp2 = inv('exports pkg/util.py');
    ok('intent · exports Python surface fallback', /helper/.test(exp2.answer));
    var exp3 = inv('exports rbapp/lib/widget/helper.rb');
    ok('intent · exports Ruby surface fallback', /helper_fn/.test(exp3.answer));
    var tds = inv('todos');
    ok('intent · todos lists the tagged line', tds.answer.indexOf('src/orphanish.js') !== -1 && /TODO/.test(tds.answer));
    var env1 = inv('env');
    ok('intent · env finds DEMO_FLAG and PORT', /DEMO_FLAG/.test(env1.answer) && /`PORT`/.test(env1.answer));
    var hb = inv('hubs');
    ok('intent · hubs ranks the most-imported files', hb.answer.indexOf('src/store.js') !== -1 && hb.answer.indexOf('src/config.js') !== -1);
    var hs = inv('hotspots');
    ok('intent · hotspots ranks code files with metrics', /`src\//.test(hs.answer) && /importer/.test(hs.answer));
    var ut = inv('files without tests');
    ok('intent · untested flags util.js but not store.js', ut.answer.indexOf('src/util.js') !== -1 && ut.answer.indexOf('src/store.js') === -1);
    var dp = inv('dupes');
    ok('intent · dupes finds dupeSym in both files', dp.answer.indexOf('dupeSym') !== -1 && /dupea/.test(dp.answer) && /dupeb/.test(dp.answer));
    ok('intent · broken ignores import text in strings, templates and comments', !/nope-/.test(brk.answer), (brk.answer.match(/nope-\w/g) || []).join(','));
    ok('intent · broken lists asset imports as not checked, not broken', brk.answer.indexOf('Not checked') !== -1 && brk.answer.indexOf('missing-logo.png') > brk.answer.indexOf('Not checked'));
    ok('intent · dupes skips function-local variables', dp.answer.indexOf('rowsLocal') === -1);
    ok('intent · dupes catches top-level arrow functions', dp.answer.indexOf('makeWidget') !== -1);
    ok('intent · dupes ignores definitions inside template literals', dp.answer.indexOf('insideTemplate') === -1);
    /* routing-robustness run-level checks — the fixed routes produce real answers */
    var wu = inv('what uses addTodo');
    ok('intent · what-uses a symbol redirects to references', /referenced/.test(wu.answer) && wu.verdict.local === true, wu.answer.slice(0, 60));
    var wf = inv('what uses store.js');
    ok('intent · what-uses a file lists importers', /imported by/.test(wf.answer) && wf.answer.indexOf('src/server.js') !== -1, wf.answer.slice(0, 60));
    var laf = inv('list all files');
    ok('intent · list-all-files lists every loaded path', /loaded/.test(laf.answer) && laf.answer.indexOf('README.md') !== -1, laf.answer.slice(0, 60));
    var dg = inv('show the dependency graph');
    ok('intent · dependency-graph answers fan-in ranking', /Most-imported|No file is imported/.test(dg.answer) && dg.verdict.local === true, dg.answer.slice(0, 60));
    var hlp = inv('help');
    ok('intent · help states the machinery limits', /Intentional limits/.test(hlp.answer) && /static import edges/.test(hlp.answer));
    /* blast radius — direct vs transitive, classification, and the honest zero case */
    var imp = inv('what breaks if I change store.js');
    ok('intent · impact finds direct importers', /Blast radius/.test(imp.answer) && imp.answer.indexOf('src/server.js') !== -1 && imp.verdict.local === true, imp.answer.slice(0, 60));
    ok('intent · impact walks to transitive dependents', imp.answer.indexOf('src/index.js') !== -1 && /Transitive dependents/.test(imp.answer));
    ok('intent · impact counts tests in the radius', /1 test file is in the blast radius/.test(imp.answer));
    ok('intent · impact discloses the static-edges limit', /Static resolved import edges only/.test(imp.answer));
    var imp0 = inv('impact test/store.test.js');
    ok('intent · impact zero-dependents is honest', /the file itself/.test(imp0.answer) && imp0.verdict.local === true, imp0.answer.slice(0, 60));
    var impSym = inv('impact addTodo');
    ok('intent · impact resolves a symbol to its defining file', /src\/store\.js/.test(impSym.answer) && impSym.steps.some(function (s) { return /names a symbol/.test(s.action); }));
    /* pinned-evidence scoping — plain/reason terrain filters to pinned files, disclosed as a step */
    st.pinnedEv = [{ file: 'src/config.js', startLine: 2, endLine: 5, quote: '' }];
    var pinInv = inv('summarize everything about the port configuration');
    var scopeStep = pinInv.steps[0];
    ok('pins · scope step discloses the pinned set', /scope to pinned evidence/.test(scopeStep.action) && /1 pinned citation across 1 file/.test(scopeStep.note), scopeStep.note);
    var searchHitsOutside = pinInv.steps.some(function (s) {
      return /^search /.test(s.action) && (s.evidence || []).some(function (ev) { return ev.file !== 'src/config.js'; });
    });
    ok('pins · terrain search hits only pinned files', !searchHitsOutside);
    st.pinnedEv = [];
    var unpinInv = inv('summarize everything about the port configuration');
    ok('pins · clearing pins restores full search', !/scope to pinned evidence/.test(unpinInv.steps[0].action));
    /* demo seeding — legacy.js gives the signals-first demo real, honest findings */
    ok('demo · legacy.js is a real orphan', listOrphans(idx).indexOf('src/legacy.js') !== -1);
    ok('demo · legacy.js carries the debt tags', idx.todos.filter(function (t) { return t.file === 'src/legacy.js'; }).length >= 5);
    /* packer legibility — why-tags, pin-first packing, exclusion honesty */
    var pk1 = packSmartContext('where is API_BASE_URL defined', 4000);
    ok('packer · included entries carry why-tags', pk1.included.length > 0 && pk1.included.every(function (x) { return Array.isArray(x.why); })
      && pk1.included.some(function (x) { return x.why.length > 0; }));
    ok('packer · keyword scorers say kw', pk1.included.some(function (x) { return x.why.some(function (w) { return w.indexOf('kw') === 0; }); }));
    var pinTarget = 'src/legacy.js'; /* low-score file — without a pin it loses under a tight budget */
    st.files.get(pinTarget).pin = true;
    var pk2 = packSmartContext('where is API_BASE_URL defined', 600);
    st.files.get(pinTarget).pin = false;
    ok('packer · pinned file packs first under a tight budget', pk2.included.length > 0 && pk2.included[0].p === pinTarget
      && pk2.included[0].why.indexOf('pinned') !== -1, pk2.included.length ? pk2.included[0].p : 'none');
    var savedChecked = st.files.get('src/store.js').checked;
    st.files.get('src/store.js').checked = false;
    var pk3 = packSmartContext('where is addTodo defined', 200000);
    st.files.get('src/store.js').checked = savedChecked;
    ok('packer · unchecked file never packs', !pk3.included.some(function (x) { return x.p === 'src/store.js'; }));
    ok('packer · notPacked lists top scorers left out', Array.isArray(pk2.notPacked) && pk2.notPacked.length > 0
      && pk2.notPacked.every(function (x) { return typeof x.s === 'number' && !pk2.included.some(function (y) { return y.p === x.p; }); }));
    var pt = inv('path src/index.js src/store.js');
    ok('intent · path walks index → server → store', pt.answer.indexOf('src/index.js') !== -1 && pt.answer.indexOf('src/server.js') !== -1 && pt.answer.indexOf('src/store.js') !== -1);
    var sg = inv('signals');
    ok('intent · signals leads with the broken-import CRITICAL', /CRITICAL/.test(sg.answer) && /broken relative import/.test(sg.answer) && /`broken`/.test(sg.answer));
    ok('intent · signals includes the cycle finding', /import cycle/.test(sg.answer) && /`cycles`/.test(sg.answer));
    ok('intent · signals caps at five, verdict local', sg.steps.length <= 5 && sg.verdict.local === true);
    /* routing-collision fixes (audit 3) — natural phrasings that used to dead-end */
    var wu = inv('who uses addTodo');
    ok('intent · "who uses <symbol>" answers references, not a file dead-end', /referenced\s+\d+\s+time/.test(wu.answer) && wu.answer.indexOf('Could not resolve') === -1, wu.answer.split('\n')[0]);
    var wd = inv('what depends on store.js');
    ok('intent · "what depends on X" answers dependents, not X\'s own imports', /imported by \d+ file/.test(wd.answer), wd.answer.split('\n')[0]);
    var la = inv('list all files');
    ok('intent · "list all files" lists files, not a `.all` filter', /files loaded:/.test(la.answer) && la.answer.indexOf('.all') === -1, la.answer.split('\n')[0]);
    var lj = inv('list js files');
    ok('intent · "list js files" still filters by extension', /`\.js` file/.test(lj.answer), lj.answer.split('\n')[0]);
    var wts = inv('who uses the store');
    ok('intent · "who uses the store" resolves the noun, not the verb', /imported by \d+ file/.test(wts.answer) && wts.answer.indexOf('Could not resolve') === -1, wts.answer.split('\n')[0]);
    /* ignored-dir skip counting (audit 4 · M4) — the picker path must classify an
       ignored directory by its dir prefix, matching drop/FSA; dot-files are not dirs */
    ok('ingest · ignoredDirPrefix flags an IGNORE_DIRS segment once', ignoredDirPrefix('proj/node_modules/x/y.js') === 'proj/node_modules', ignoredDirPrefix('proj/node_modules/x/y.js'));
    ok('ingest · ignoredDirPrefix flags a dot-directory', ignoredDirPrefix('a/.cache/b.js') === 'a/.cache', ignoredDirPrefix('a/.cache/b.js'));
    ok('ingest · ignoredDirPrefix ignores a clean path', ignoredDirPrefix('src/app.js') === '', ignoredDirPrefix('src/app.js'));
    ok('ingest · ignoredDirPrefix does not match a dot-file basename', ignoredDirPrefix('foo/.env') === '', ignoredDirPrefix('foo/.env'));
    /* bounded search (audit F5) — invalid patterns are flagged, quoted queries
       match literally, and the scan aborts honestly instead of hanging the tab */
    var sInv = localSearchData('todo(', 'text');
    ok('search · invalid regex flagged + literal fallback', sInv.invalidPattern === true && sInv.hits.some(function (h) { return h.p === 'src/minified.js'; }), sInv.hits.length + ' hits');
    var sLit = localSearchData('"cache control"', 'text');
    ok('search · quoted query matches literally', sLit.literal === true && sLit.invalidPattern === false
      && sLit.hits.some(function (h) { return /cache control notes/.test(h.text); })
      && !sLit.hits.some(function (h) { return /cache-control header/.test(h.text); }), sLit.hits.length + ' hits');
    st.files.set('scan/huge.txt', stEntry('scan/huge.txt', new Array(400050).join('x\n')));
    var sCap = localSearchData('zzz_nothing_matches_this', 'text');
    ok('search · scan aborts at the line cap', sCap.aborted === true && sCap.hits.length === 0, 'scanned=' + sCap.scanned);
    st.files.delete('scan/huge.txt');
    /* SMART-mode grounding with nothing checked (audit F3) — what the FOUND
       panel shows must be what the model receives */
    (function () {
      var mSaved = { ctxMode: st.ctxMode, groundMode: st.groundMode, mapCache: st.mapCache, mapDirty: st.mapDirty };
      st.ctxMode = 'smart'; st.groundMode = true; st.mapDirty = true;
      st.files.forEach(function (f) { f.checked = false; });
      var cbb = buildContextBlocks('where is addTodo defined');
      ok('smart-ctx · grounding survives empty selection', !!cbb.ground && cbb.blocks.length === 1 && /GROUNDED \d+ EV/.test(cbb.note || ''),
        cbb.ground ? cbb.blocks.length + ' blocks · ' + (cbb.note || 'no note') : 'no ground');
      st.files.forEach(function (f) { f.checked = true; });
      st.ctxMode = mSaved.ctxMode; st.groundMode = mSaved.groundMode; st.mapCache = mSaved.mapCache; st.mapDirty = mSaved.mapDirty;
    })();
    /* drift — pending window, baseline case, then a synthetic previous snapshot */
    st.driftPending = true;
    ok('intent · drift pending window is honest', /Still reading/.test(inv('drift').answer));
    st.driftPending = false;
    st.driftPrev = null;
    ok('intent · drift baseline message on first run', /Baseline recorded/.test(inv('drift').answer));
    st.driftPrev = { sig: 'scratch', ts: 0, fileCount: 2, symbolCount: 3, importCount: 0,
      files: { 'ghost/old.js': [100, 2], 'src/store.js': [10, 1] } };
    var dr = inv('drift');
    ok('intent · drift detects removed files', /Removed:/.test(dr.answer) && dr.answer.indexOf('ghost/old.js') !== -1);
    ok('intent · drift detects new files', /New:/.test(dr.answer));
    ok('intent · drift detects reshaped files', /Reshaped:/.test(dr.answer) && /`src\/store\.js`: \+/.test(dr.answer));
    st.driftPrev = null;
    wireCases(ok);
    symbolPickCases(ok);
    estBiasCases(ok);
    smartBudgetCases(ok);
    /* multi-repo workspace — self-contained scratch state, restored on exit */
    workspaceCases(ok);
    demoLinkCases(ok);
    demoCatchCases(ok);
    verifyCases(ok);
    diagCases(ok);
  } catch (e) {
    ok('harness executed without throwing', false, String(e && e.message || e));
    restore();
    return Promise.resolve(results);
  }
  /* the ingest cases are async (real Blob reads) — run them, then restore state */
  return ingestCases(ok).catch(function (e) {
    ok('ingest harness executed without throwing', false, String(e && e.message || e));
  }).then(function () {
    return fileCapCases(ok).catch(function (e) { ok('file cap harness executed without throwing', false, String(e && e.message || e)); });
  }).then(function () {
    return shareCases(ok).catch(function (e) { ok('share harness executed without throwing', false, String(e && e.message || e)); });
  }).then(function () {
    return analyticsCases(ok).catch(function (e) { ok('analytics harness executed without throwing', false, String(e && e.message || e)); });
  }).then(function () {
    return indexCases(ok).catch(function (e) { ok('index worker harness executed without throwing', false, String(e && e.message || e)); });
  }).then(function () {
    return sealCases(ok).catch(function (e) { ok('protected share harness executed without throwing', false, String(e && e.message || e)); });
  }).then(function () {
    return parityCases(ok).catch(function (e) { ok('load-path parity harness executed without throwing', false, String(e && e.message || e)); });
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
    + '<p class="note mono" style="color:var(--ink-3)">// deterministic checks of the index, packer, trace parser, stream adapters, ingest filters, share links, multi-repo workspaces and usage analytics on scratch fixtures. no network, no API.</p>'
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
