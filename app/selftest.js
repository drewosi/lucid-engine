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
    'rustcrate/parser.rs': 'pub fn parse() {}',
    /* niche-intent terrain: an import cycle, a broken relative import, an orphan
       carrying a TODO tag + env read, and a symbol name defined twice */
    'cyc/a.js': "import { b } from './b.js';\nexport function a() { return b(); }",
    'cyc/b.js': "import { a } from './a.js';\nexport function b() { return a(); }",
    'src/brokenimp.js': "import { gone } from './missing-file';\nexport const BROKEN_DEMO = 1;",
    'src/orphanish.js': '// TODO: wire this module up\nexport function orphanHelper() { return process.env.DEMO_FLAG; }',
    'src/dupea.js': 'export function dupeSym() { return 1; }',
    'src/dupeb.js': 'export function dupeSym() { return 2; }',
    /* Java: Maven layout, plain + static import, methods, filename-convention test */
    'javapkg/src/main/java/com/acme/App.java':
      'package com.acme;\nimport com.acme.util.Strings;\nimport static com.acme.util.Strings.upper;\npublic class App {\n  public static void main(String[] args) { }\n  private int count() { return 1; }\n}',
    'javapkg/src/main/java/com/acme/util/Strings.java':
      'package com.acme.util;\npublic final class Strings {\n  public static String upper(String s) { return s; }\n}',
    'javapkg/src/main/java/com/acme/util/StringsTest.java':
      'package com.acme.util;\npublic class StringsTest {\n  public void testUpper() { }\n}',
    /* Ruby: require_relative + external require + module/class/self-def/attr */
    'rbapp/lib/widget.rb':
      "require_relative 'widget/helper'\nrequire 'json'\nmodule Widget\n  class Frame\n    attr_reader :size\n    def render\n    end\n  end\nend",
    'rbapp/lib/widget/helper.rb':
      'module Widget\n  def self.helper_fn\n    1\n  end\nend',
    /* C#: braced + file-scoped namespaces, using directive vs using statement */
    'csapp/Program.cs':
      'using System;\nusing Acme.Services;\n\nnamespace Acme {\n  internal sealed class Program {\n    public static void Main(string[] args) {\n      using (var g = new Greeter()) { }\n    }\n  }\n}',
    'csapp/Services/Greeter.cs':
      'namespace Acme.Services;\npublic class Greeter {\n  public string Greet(string name) => name;\n  public int Count { get; set; }\n}',
    'csapp/GreeterTests.cs':
      'namespace Acme.Tests;\npublic class GreeterTests {\n  public void GreetWorks() { }\n}',
    /* resolver depth: exports map (conditional + star), imports (#alias), main field */
    'wspkg/package.json': '{ "name": "@acme/tools", "main": "src/entry.js", "exports": { ".": "./src/entry.js", "./sub": { "types": "./x.d.ts", "import": "./src/sub.mjs" }, "./feat/*": "./src/feat/*.js" }, "imports": { "#util": "./src/u.js" } }',
    'wspkg/src/entry.js': "import u from '#util';\nexport const ENTRY = 1;",
    'wspkg/src/sub.mjs': 'export const SUB = 1;',
    'wspkg/src/feat/deep.js': 'export const DEEP = 1;',
    'wspkg/src/u.js': 'export const U = 1;',
    'mainpkg/package.json': '{ "name": "plainmain", "main": "lib/entry-main.js" }',
    'mainpkg/lib/entry-main.js': 'module.exports = { pm: 1 };',
    'src/usewspkg.js': "import { ENTRY } from '@acme/tools';\nimport { SUB } from '@acme/tools/sub';\nimport { DEEP } from '@acme/tools/feat/deep';\nimport pm from 'plainmain';",
    /* resolver depth: two Rust crates — crate::, super::, cross-crate, decoy name */
    'crates/alpha/Cargo.toml': '[package]\nname = "alpha"\n\n[dependencies]\nname = "decoy"',
    'crates/alpha/src/lib.rs': 'mod engine;\nuse crate::engine::start;\nuse beta_core::api::run;\nuse serde::Serialize;\npub fn alpha_main() {}',
    'crates/alpha/src/engine.rs': 'use super::alpha_main;\npub fn start() {}',
    'crates/beta/Cargo.toml': '[package]\nname = "beta-core"',
    'crates/beta/src/lib.rs': 'pub mod api;',
    'crates/beta/src/api.rs': 'pub fn run() {}',
    /* Kotlin: gradle-kotlin layout, data class/object/val, receiver fun, kt test */
    'ktapp/src/main/kotlin/com/acme/Main.kt':
      'package com.acme\nimport com.acme.util.Text\nimport kotlinx.coroutines.launch\nfun main() { }\ndata class Point(val x: Int)\nobject Registry\nval MAX_RETRIES = 3',
    'ktapp/src/main/kotlin/com/acme/util/Text.kt':
      'package com.acme.util\nclass Text {\n  fun shout(s: String) = s\n  private fun hidden() { }\n}',
    'ktapp/src/test/kotlin/com/acme/util/TextTest.kt':
      'package com.acme.util\nclass TextTest {\n  fun testShout() { }\n}',
    /* Swift: SwiftPM Sources/ modules, protocol/extension/open class, Tests/ */
    'swiftapp/Sources/Render/Render.swift':
      'import Foundation\nimport Helper\npublic protocol Drawable { }\nopen class Canvas { }\npublic func render() { }\nextension Canvas { }',
    'swiftapp/Sources/Helper/Helper.swift': 'public struct Palette { }',
    'swiftapp/Tests/RenderTests/RenderTests.swift': 'final class RenderTests { }',
    /* PHP: composer psr-4, backslashed use, paren-less require, Test.php suffix */
    'phpapp/composer.json': '{ "autoload": { "psr-4": { "App\\\\": "src/" } } }',
    'phpapp/src/Models/User.php': '<?php\nnamespace App\\Models;\nclass User {\n  public function name() { return "u"; }\n}',
    'phpapp/src/Service.php': '<?php\nnamespace App;\nuse App\\Models\\User;\nuse Symfony\\Component\\Console;\nrequire \'legacy.php\';\nclass Service { }\nfunction boot() { }',
    'phpapp/src/legacy.php': '<?php\nfunction legacy_fn() { }',
    'phpapp/tests/ServiceTest.php': '<?php\nclass ServiceTest { }'
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
  var savedDriftSig = st.driftSig, savedDriftPrev = st.driftPrev;
  function restore() {
    st.files = savedFiles; st.projectIndex = savedIndex; st.indexDirty = savedDirty;
    st.skipped = savedSkipped; st.skippedFiles = savedSkipList; st.totalBytes = savedBytes;
    st.driftSig = savedDriftSig; st.driftPrev = savedDriftPrev;
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
      ['summarize everything about it', 'plain'],
      /* niche intents — command + NL forms, including the cascade-collision pins */
      ['cycles', 'cycles'],
      ['are there circular dependencies', 'cycles'],   /* must beat importers' depend- regex */
      ['orphans', 'orphans'],
      ['show unused files', 'orphans'],                /* must beat listType's <word> files trap */
      ['dead code', 'orphans'],
      ['broken imports', 'broken'],                    /* must beat importers' import- regex */
      ['exports src/store.js', 'exports'],
      ['what does store.js export', 'exports'],
      ['todos', 'todos'],
      ['list the fixmes', 'todos'],
      ['env', 'env'],
      ['which environment variables are used', 'env'],
      ['hubs', 'hubs'],
      ['most imported files', 'hubs'],                 /* must beat importers' imported- regex */
      ['hotspots', 'hotspots'],
      ['largest files', 'hotspots'],
      ['untested', 'untested'],
      ['files without tests', 'untested'],             /* must beat the tests intent */
      ['dupes', 'dupes'],
      ['duplicate symbols', 'dupes'],                  /* must beat the symbols intent */
      ['path src/index.js src/store.js', 'path'],
      ['dependency path from index.js to store.js', 'path'],
      /* signals — command + NL, incl. pins vs hotspots ("biggest") and reason ("should i") */
      ['signals', 'signals'],
      ['top issues', 'signals'],
      ["what's wrong here", 'signals'],
      ['what should i look at', 'signals'],
      ['what matters', 'signals'],
      ['biggest problems', 'signals'],
      ['where is signalHandler defined', 'def'],
      /* drift — must beat recent's what-changed regex */
      ['drift', 'drift'],
      ['what changed since last session', 'drift']
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
    /* index extensions — exports, todos, env vars, per-file symbol counts */
    ok('index · exports JS declaration', (idx.exportsByFile.get('src/aliased.ts') || []).some(function (e) { return e.name === 'ALIASED'; }));
    ok('index · exports CommonJS braces', (idx.exportsByFile.get('src/store.js') || []).some(function (e) { return e.name === 'listTodos'; }));
    ok('index · exports Rust pub', (idx.exportsByFile.get('rustcrate/lib.rs') || []).some(function (e) { return e.name === 'compute'; }));
    ok('index · exports Go uppercase initial', (idx.exportsByFile.get('gopkg/server.go') || []).some(function (e) { return e.name === 'NewServer'; }));
    ok('index · TODO tag recorded', idx.todos.some(function (t) { return t.file === 'src/orphanish.js' && t.tag === 'TODO'; }));
    ok('index · env var read recorded', (idx.envVars.get('DEMO_FLAG') || []).length === 1);
    ok('index · symCountByFile counts store.js', (idx.symCountByFile['src/store.js'] || 0) >= 3, String(idx.symCountByFile['src/store.js']));
    /* niche investigations — run the real engine over the fixture terrain */
    function inv(qq) { return runInvestigation(qq, classifyIntent(qq)); }
    var cyc = inv('cycles');
    ok('intent · cycles finds the a↔b cycle', /cyc\/a\.js/.test(cyc.answer) && /cyc\/b\.js/.test(cyc.answer) && cyc.verdict.local === true);
    var orp = inv('orphans');
    ok('intent · orphans flags never-imported code', orp.answer.indexOf('src/orphanish.js') !== -1);
    ok('intent · orphans excludes imported files', orp.answer.indexOf('cyc/a.js') === -1);
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
    var pt = inv('path src/index.js src/store.js');
    ok('intent · path walks index → server → store', pt.answer.indexOf('src/index.js') !== -1 && pt.answer.indexOf('src/server.js') !== -1 && pt.answer.indexOf('src/store.js') !== -1);
    var sg = inv('signals');
    ok('intent · signals leads with the broken-import CRITICAL', /CRITICAL/.test(sg.answer) && /broken relative import/.test(sg.answer) && /`broken`/.test(sg.answer));
    ok('intent · signals includes the cycle finding', /import cycle/.test(sg.answer) && /`cycles`/.test(sg.answer));
    ok('intent · signals caps at five, verdict local', sg.steps.length <= 5 && sg.verdict.local === true);
    /* drift — baseline case, then a synthetic previous snapshot */
    st.driftPrev = null;
    ok('intent · drift baseline message on first run', /Baseline recorded/.test(inv('drift').answer));
    st.driftPrev = { sig: 'scratch', ts: 0, fileCount: 2, symbolCount: 3, importCount: 0,
      files: { 'ghost/old.js': [100, 2], 'src/store.js': [10, 1] } };
    var dr = inv('drift');
    ok('intent · drift detects removed files', /Removed:/.test(dr.answer) && dr.answer.indexOf('ghost/old.js') !== -1);
    ok('intent · drift detects new files', /New:/.test(dr.answer));
    ok('intent · drift detects reshaped files', /Reshaped:/.test(dr.answer) && /`src\/store\.js` — \+/.test(dr.answer));
    st.driftPrev = null;
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
