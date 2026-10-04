import { estTokens, packSmartContext, staticScore } from './smart-context.js';
import { buildIndex, detectLang } from './indexer.js';
import { invalidateAll, st } from './state.js';
import { SAMPLE_PROJECT, wantsDemo } from './demo.js';
import { classifyIntent } from './local.js';
import { INTENTS, LOCAL_MENU, LOCAL_STARTERS, listOrphans, runInvestigation } from './intents.js';
import { extractTrace } from './trace.js';
import { httpErrorText, parseStreamEvent, splitSseEvents } from './chat.js';
import { __setCapsForTest, ignoredDirPrefix, ingestFile, runIngestPool } from './ingest.js';
import { localSearchData } from './actions.js';
import { buildContextBlocks } from './prompt.js';
import { app, esc, lsDel, lsGet, lsSet, rememberFocus, returnFocus, toast, trap } from './helpers.js';
import { LS } from './config.js';
import { BUNDLE_NOTE, FILE_FIELDS, PAYLOAD_FIELDS, SHARE_LINK_MAX_CHARS, bundleText, buildSharePayload, createShareLink, decodeShareData,
  defaultSharePaths, encodeShareData, isSecretish, measureLink, parseBundleText, payloadEntries, readBundleFile } from './share.js';
import { citeText, displayPath, dropRepoFiles, isMulti, registerRepo, remapRoot, repoList, repoOf, resetWorkspace, resolveCitePath, scopeRepo, uniqueLabel, withScope } from './repos.js';
import { claimLabel, selectedTokens } from './ingest.js';
import { buildSaveRecord } from './memory.js';
import { evidenceChip } from './trace.js';
import { closeViewer } from './viewer.js';
import { afterWorkspaceIngest, pendingLabelFor } from './workspace.js';
import { projectSig } from './drift.js';
import { AN_FORMAT, AN_Q_MAX, CSV_COLS, EVENT_FIELDS, __setAnalyticsForTest, analyticsCSV, analyticsJSON, analyticsOn, clearAnalytics, endpointUrl,
  flushAnalyticsSend, idbStore, percentile, readEvents, sanitizeEvent, storeText, summarize, track, validEndpoint } from './analytics.js';
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
    'phpapp/tests/ServiceTest.php': '<?php\nclass ServiceTest { }',
    /* long-line disclosure (F10): the import hides on a >400-char line the
       indexer skips — the file must be counted, and can appear orphaned */
    'src/minified.js': "import { addTodo } from './store.js';" + new Array(420).join(' ') + 'var mini=1;\nexport function todoCall() { todo(1); }',
    /* prototype-key hardening (F12): extension + dir named like Object.prototype members */
    'constructor/x.constructor': 'plain text in a hostile path\ncache control notes\ncache-control header'
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
    /* bounded ingest pool (audit F1) — the caps must fire WITHIN one batch, the
       exact case the prior Promise.all fan-out could never enforce. Caps are
       lowered via the dev hook and restored by the harness's restore(). */
    var capFiles = st.files.size + 2;
    __setCapsForTest({ maxFiles: capFiles });
    var overBase = st.skipped.over;
    var items = [];
    for (var i = 0; i < 6; i++) (function (n) {
      items.push({ path: 'pool/f' + n + '.txt', getFile: function () { return Promise.resolve(new File(['pool' + n], 'f' + n + '.txt')); } });
    })(i);
    return runIngestPool(items, 2).then(function () {
      ok('ingest · pool enforces the file cap mid-batch', st.files.size === capFiles, st.files.size + ' vs cap ' + capFiles);
      ok('ingest · over-cap counted + reviewable', st.skipped.over - overBase === 4
        && st.skippedFiles.some(function (s) { return s.reason === 'over-cap'; }), 'over Δ=' + (st.skipped.over - overBase));
      __setCapsForTest({ maxFiles: 8000, maxTotal: st.totalBytes + 3 });
      var memBase = st.skipped.memcap;
      return runIngestPool([
        { path: 'pool/m0.txt', getFile: function () { return Promise.resolve(new File(['abcdefgh'], 'm0.txt')); } },
        { path: 'pool/m1.txt', getFile: function () { return Promise.resolve(new File(['abcdefgh'], 'm1.txt')); } }
      ], 1).then(function () {
        ok('ingest · memory cap fires mid-batch + reviewable', st.skipped.memcap - memBase === 1
          && st.files.has('pool/m0.txt') && !st.files.has('pool/m1.txt')
          && st.skippedFiles.some(function (s) { return s.reason === 'mem-cap'; }), 'memcap Δ=' + (st.skipped.memcap - memBase));
      });
    });
  });
}
/* share links + bundles — real CompressionStream round-trips over the scratch
   fixture. A sentinel key is planted in the conversation and, only when that
   slot is EMPTY, in the Anthropic key slot (removed again before any await);
   neither may reach a payload. */
function settleCode(p) { return p.then(function () { return 'loaded'; }, function (e) { return (e && e.code) || 'raw:' + (e && e.message); }); }
function shareCases(ok) {
  var SENT = 'sk-ant-SELFTEST-SENTINEL-0000';
  var small = Object.keys(SAMPLE_PROJECT);
  st.files.set('src/unicode.txt', stEntry('src/unicode.txt', 'naïve café — 日本語 ✓\r\nline two'));
  st.files.set('config/.env', stEntry('config/.env', 'API_KEY=hunter2'));
  small.push('src/unicode.txt');
  var planted = !lsGet(LS.key);
  if (planted) lsSet(LS.key, SENT);
  st.history.push({ role: 'user', content: 'my key is ' + SENT });
  var pl, json, btxt;
  try {
    pl = buildSharePayload(small, { name: 'selftest', now: 1 });
    json = JSON.stringify(pl); btxt = bundleText(pl);
  } finally {
    st.history.pop();
    if (planted) lsDel(LS.key);
  }
  ok('share · payload carries only whitelisted fields', Object.keys(pl).every(function (k) { return PAYLOAD_FIELDS.indexOf(k) !== -1; })
    && pl.files.every(function (f) { return Object.keys(f).every(function (k) { return FILE_FIELDS.indexOf(k) !== -1; }); }));
  var keyNames = Object.keys(pl).concat(Object.keys(JSON.parse(btxt)));
  pl.files.forEach(function (f) { keyNames = keyNames.concat(Object.keys(f)); });
  var stored = [LS.key, LS.okey, LS.ckey, LS.curl].map(lsGet).filter(function (v) { return v && v.length >= 6; });
  ok('share · no secrets: no key/provider/history fields, no stored key values',
    !keyNames.some(function (k) { return /key|token|secret|provider|model|history|transcript|setting/i.test(k); })
    && json.indexOf(SENT) === -1 && btxt.indexOf(SENT) === -1
    && stored.every(function (v) { return json.indexOf(v) === -1 && btxt.indexOf(v) === -1; }), keyNames.length + ' field names checked');
  ok('share · secret-looking paths are flagged', ['.env', 'config/.env.local', 'certs/server.pem', 'home/.ssh/id_rsa', 'app/credentials.json'].every(isSecretish)
    && !['src/env.js', 'src/keyboard.js', 'README.md', '.env.example.md/x.js'].some(isSecretish));
  /* deterministic high-entropy text: no compressor fits 60K of it under the limit */
  var seed = 12345, noise = '';
  for (var i = 0; i < 60000; i++) { seed = (Math.imul(seed, 1103515245) + 12345) | 0; noise += String.fromCharCode(33 + ((seed >>> 16) % 90)); }
  st.files.set('share/noise.txt', stEntry('share/noise.txt', noise));
  var d1;
  return encodeShareData(pl).then(function (d) {
    d1 = d;
    ok('share · link data is versioned base64url', /^v1\.[A-Za-z0-9_-]+$/.test(d), d.slice(0, 12));
    return decodeShareData(d);
  }).then(function (back) {
    ok('share · round-trip keeps every path and byte', back.name === 'selftest' && back.created === 1 && back.files.length === pl.files.length
      && back.files.every(function (f, n) { return f.p === pl.files[n].p && f.c === pl.files[n].c; }), back.files.length + ' files');
    ok('share · unicode + CRLF survive the round-trip', back.files.some(function (f) { return f.p === 'src/unicode.txt' && f.c === st.files.get('src/unicode.txt').content; }));
    var ents = payloadEntries(back);
    ok('share · decoded files rebuild as checked entries', ents.length === back.files.length
      && ents.every(function (kv) { return kv[1].checked === true && kv[1].lines >= 1 && typeof kv[1].tokens === 'number'; }));
    return Promise.all([measureLink(small), measureLink(['share/noise.txt']), settleCode(createShareLink(['share/noise.txt']))]);
  }).then(function (r) {
    ok('share · small project fits in a link under the limit', r[0].fits && r[0].url.length <= SHARE_LINK_MAX_CHARS && r[0].url.indexOf('#share=v1.') !== -1, r[0].chars + ' / ' + SHARE_LINK_MAX_CHARS);
    ok('share · oversize selection measured over the limit, no url', !r[1].fits && r[1].url === null && r[1].chars > SHARE_LINK_MAX_CHARS, r[1].chars + ' chars');
    ok('share · createShareLink refuses over the limit', r[2] === 'toolong', r[2]);
    return defaultSharePaths();
  }).then(function (def) {
    ok('share · default selection skips secret-looking + oversize files', def.length > 0 && def.indexOf('config/.env') === -1 && def.indexOf('share/noise.txt') === -1, def.length + ' files');
    return measureLink(def).then(function (m) { ok('share · default selection actually fits', m.fits, m.chars + ' chars'); });
  }).then(function () {
    var trunc = d1.slice(0, Math.floor(d1.length / 2));
    return Promise.all([
      decodeShareData(trunc).catch(function (e) { return e; }),
      settleCode(decodeShareData(trunc)),
      settleCode(decodeShareData('v1.@@not*base64')),
      settleCode(decodeShareData('v1.QUJDREVGR0hJSktMTU5PUA')),
      settleCode(decodeShareData('v9.' + d1.slice(3))),
      settleCode(decodeShareData('')),
      settleCode(decodeShareData('garbage'))
    ]);
  }).then(function (c) {
    ok('share · truncated link → friendly error', c[1] === 'corrupt' && /damaged or incomplete/.test((c[0] && c[0].friendly) || ''), c[1]);
    ok('share · invalid characters → corrupt', c[2] === 'corrupt', c[2]);
    ok('share · non-deflate bytes → corrupt', c[3] === 'corrupt', c[3]);
    ok('share · newer format version → version error', c[4] === 'version', c[4]);
    ok('share · empty / unprefixed input → corrupt', c[5] === 'corrupt' && c[6] === 'corrupt', c[5] + ' · ' + c[6]);
    function crafted(o) { return settleCode(encodeShareData(o).then(decodeShareData)); }
    return Promise.all([
      crafted({ format: 'not-meridian', v: 1, files: [{ p: 'a.js', c: 'x' }] }),
      crafted({ format: 'meridian-share', v: 1, name: 'x', files: [{ p: 'a.js', c: 42 }] }),
      crafted({ format: 'meridian-share', v: 1, name: 'x', files: [{ p: '../etc/passwd', c: 'x' }] }),
      crafted({ format: 'meridian-share', v: 1, name: 'x', files: [{ p: 'big.txt', c: new Array(600 * 1024).join('a') }] }),
      encodeShareData({ format: 'meridian-share', v: 1, name: 'x', apiKey: SENT, files: [{ p: 'a.js', c: 'x', key: SENT }] }).then(decodeShareData)
    ]);
  }).then(function (c) {
    ok('share · wrong format / non-string content / ../ path refused', c[0] === 'invalid' && c[1] === 'invalid' && c[2] === 'invalid', c.slice(0, 3).join(' · '));
    ok('share · oversized file in a link refused (decompression cap)', c[3] === 'toobig', c[3]);
    ok('share · decoder drops unknown fields', !('apiKey' in c[4]) && !('key' in c[4].files[0]) && JSON.stringify(c[4]).indexOf(SENT) === -1);
    ok('share · bundle note says the code is readable', JSON.parse(btxt).note === BUNDLE_NOTE && /anyone who has it can read it/.test(BUNDLE_NOTE));
    return readBundleFile(new File([btxt], 'selftest.meridian'));
  }).then(function (back) {
    ok('share · bundle round-trip through a File', back.name === 'selftest' && back.files.length === pl.files.length
      && back.files.every(function (f, n) { return f.p === pl.files[n].p && f.c === pl.files[n].c; }));
    function bcode(t) { try { parseBundleText(t); return 'loaded'; } catch (e) { return e.code; } }
    ok('share · bad bundles → friendly errors', bcode('{not json') === 'bundle' && bcode('{"format":"x"}') === 'bundle'
      && bcode(JSON.stringify({ format: 'meridian-share', v: 99, files: [{ p: 'a', c: 'b' }] })) === 'version');
  });
}
/* multi-repo workspace — two repos that share a relative path (src/util.js), a
   dependency (react), a package link (beta depends on alpha's @acme/alpha) and an
   exported name (formatDate). Runs on its own scratch state and restores it. */
function workspaceFixture() {
  return {
    'alpha/package.json': '{ "name": "@acme/alpha", "dependencies": { "react": "^18.0.0", "lodash": "^4.17.0" } }',
    'alpha/README.md': '# alpha\nthe shared library',
    'alpha/src/index.js': "import { formatDate } from './util.js';\nexport function startAlpha() { return formatDate(1); }",
    'alpha/src/util.js': 'export function formatDate(d) { return String(d); }\n// ALPHA_ONLY_MARKER',
    'beta/package.json': '{\n  "name": "beta-web",\n  "dependencies": {\n    "react": "^18.2.0",\n    "@acme/alpha": "1.0.0"\n  }\n}',
    'beta/src/index.js': "import { startAlpha } from '@acme/alpha';\nexport function startBeta() { return startAlpha(); }",
    'beta/src/util.js': 'export function formatDate(d) { return "beta" + d; }\n// BETA_ONLY_MARKER'
  };
}
/* the landing page's demo link (app.html?demo): which URLs start the demo, and
   that a #share= link is never shadowed by it */
function demoLinkCases(ok) {
  ok('demo link · ?demo starts the demo', wantsDemo('?demo', '') === true);
  ok('demo link · ?demo=1 and a later ?x&demo param also work', wantsDemo('?demo=1', '') && wantsDemo('?x=1&demo', ''));
  ok('demo link · no param, no demo', wantsDemo('', '') === false && wantsDemo('?selftest', '') === false);
  ok('demo link · a longer param name is not a match', wantsDemo('?demolition', '') === false && wantsDemo('?nodemo', '') === false);
  ok('demo link · a #share= link wins over ?demo', wantsDemo('?demo', '#share=v1.abc') === false);
  ok('demo link · an unrelated hash does not block it', wantsDemo('?demo', '#top') === true);
}
function workspaceCases(ok) {
  var keep = { files: st.files, idx: st.projectIndex, dirty: st.indexDirty, bytes: st.totalBytes, skipList: st.skippedFiles, skipped: st.skipped,
    ctxMode: st.ctxMode, groundMode: st.groundMode, pins: st.pinnedEv };
  var W = workspaceFixture();
  function inv(q) { var it = classifyIntent(q); return runInvestigation(q, it); }
  function load() {
    resetWorkspace();
    st.files = new Map(); st.totalBytes = 0; st.pinnedEv = [];
    st.skippedFiles = []; st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0, readerr: 0, memcap: 0 };
    Object.keys(W).forEach(function (p) { st.files.set(p, stEntry(p, W[p])); st.totalBytes += W[p].length; });
    registerRepo('alpha', null); registerRepo('beta', null);
    invalidateAll();
  }
  try {
    /* one project, no repos: nothing changes for single-project users */
    resetWorkspace();
    ok('workspace · single project stays unlabelled', !isMulti() && citeText('src/x.js', 1, 2) === 'src/x.js:1–2' && displayPath('src/x.js') === 'src/x.js');
    load();
    /* add / remove */
    ok('workspace · two repos registered with live counts', isMulti() && repoList().length === 2 && repoList()[0].files === 4 && repoList()[1].files === 3,
      repoList().map(function (r) { return r.label + ':' + r.files; }).join(' '));
    var added = claimLabel('alpha', null, null); /* a second folder also named "alpha" */
    st.files.set('alpha-2/src/util.js', stEntry('alpha-2/src/util.js', 'export const THIRD = 3;')); st.totalBytes += 'export const THIRD = 3;'.length;
    invalidateAll();
    ok('workspace · same-name folder joins as a new repo (alpha-2)', added === 'alpha-2' && repoList().length === 3 && repoOf('alpha-2/src/util.js') === 'alpha-2', added);
    var bytesBefore = st.totalBytes;
    var removed = dropRepoFiles('alpha-2');
    ok('workspace · removing a repo unloads only its files', removed === 1 && repoList().length === 2 && !st.files.has('alpha-2/src/util.js')
      && st.files.has('alpha/src/util.js') && st.files.has('beta/src/util.js') && st.totalBytes === bytesBefore - 'export const THIRD = 3;'.length, removed + ' removed');
    st.ws.active = 'beta';
    claimLabel('beta', 'beta', null); /* RELOAD: refill beta in place */
    ok('workspace · reload empties the repo in place, keeps it active', !st.files.has('beta/src/util.js') && repoList().some(function (r) { return r.label === 'beta'; }) && st.ws.active === 'beta');
    load();
    /* path namespacing */
    ok('workspace · identical relative paths never collide', st.files.has('alpha/src/util.js') && st.files.has('beta/src/util.js')
      && st.files.get('alpha/src/util.js').content !== st.files.get('beta/src/util.js').content);
    ok('workspace · unique labels + root remap', uniqueLabel('alpha') === 'alpha-2' && uniqueLabel('gamma') === 'gamma' && uniqueLabel('a/b:c') === 'abc'
      && remapRoot('alpha/src/x.js', 'alpha-2') === 'alpha-2/src/x.js', uniqueLabel('alpha'));
    ok('workspace · citations read repo:path:line', citeText('beta/src/util.js', 2, 2) === 'beta:src/util.js:2–2' && displayPath('alpha/README.md') === 'alpha:README.md');
    ok('workspace · cited paths resolve (repo:path · unique bare · ambiguous kept)', resolveCitePath('beta:src/util.js') === 'beta/src/util.js'
      && resolveCitePath('README.md') === 'alpha/README.md' && resolveCitePath('src/util.js') === 'src/util.js', resolveCitePath('README.md'));
    /* cross-repo query scope */
    st.ws.scope = 'all';
    var allHits = inv('search ONLY_MARKER');
    ok('scope · ALL searches every repo', /ALPHA_ONLY|alpha\/src\/util\.js/.test(JSON.stringify(allHits.steps)) && /beta\/src\/util\.js/.test(JSON.stringify(allHits.steps)));
    st.ws.scope = 'repo'; st.ws.active = 'beta';
    var filesRef = st.files;
    var scopedHits = withScope(function () { return inv('search ONLY_MARKER'); });
    var scopedEv = JSON.stringify(scopedHits.steps);
    ok('scope · active repo only searches that repo', scopeRepo() === 'beta' && /beta\/src\/util\.js/.test(scopedEv) && scopedEv.indexOf('alpha/') === -1);
    ok('scope · the swap is restored after the call', st.files === filesRef && st.files.size === 7);
    ok('scope · budget counts only the scoped repo', selectedTokens().count === 3, selectedTokens().count + ' files');
    st.ctxMode = 'full'; st.groundMode = false;
    st.ws.scope = 'all';
    var cbAll = buildContextBlocks('where is formatDate');
    var allText = cbAll.blocks.map(function (b) { return b.text; }).join('\n');
    ok('scope · model context (ALL) carries both repos + workspace note', allText.indexOf('FILE: alpha/src/util.js') !== -1 && allText.indexOf('FILE: beta/src/util.js') !== -1
      && /WORKSPACE: 2 repositories are in scope/.test(allText) && /2 REPOS/.test(cbAll.note || ''), cbAll.note);
    st.ws.scope = 'repo';
    var cbOne = buildContextBlocks('where is formatDate');
    var oneText = cbOne.blocks.map(function (b) { return b.text; }).join('\n');
    ok('scope · model context (one repo) sends only that repo', oneText.indexOf('FILE: beta/src/util.js') !== -1 && oneText.indexOf('FILE: alpha/') === -1
      && /scoped to the repository "beta"/.test(oneText) && /REPO BETA ONLY/.test(cbOne.note || ''), cbOne.note);
    st.ws.scope = 'all';
    var pk = packSmartContext('startBeta', 1000);
    ok('scope · SMART packing seats the best file of every repo', pk.included.length >= 2 && repoOf(pk.included[0].p) !== repoOf(pk.included[1].p)
      && pk.included.slice(0, 2).every(function (x) { return x.why.indexOf('best in repo') !== -1; }), pk.included.map(function (x) { return x.p; }).join(' '));
    /* repo-labelled evidence chips */
    var chip = evidenceChip({ file: 'beta/src/util.js', startLine: 2, endLine: 2, quote: 'BETA_ONLY_MARKER' });
    ok('chips · labelled repo:path:line', chip.textContent === 'ctx://beta:src/util.js:2–2' && chip.querySelector('.repo') && chip.querySelector('.repo').textContent === 'beta'
      && !chip.disabled && /^Open beta:src\/util\.js at 2–2/.test(chip.title), chip.textContent);
    chip.click();
    var vt = document.getElementById('vtitle').textContent, vb = document.getElementById('vbody').textContent;
    closeViewer();
    ok('chips · open the right file in the right repo', vt === 'beta:src/util.js' && vb.indexOf('BETA_ONLY_MARKER') !== -1 && vb.indexOf('ALPHA_ONLY_MARKER') === -1, vt);
    var mt = extractTrace('x\n```meridian-trace\n{"steps":[{"action":"a","evidence":[{"file":"alpha:src/util.js","startLine":1,"endLine":1},{"file":"src/util.js","startLine":1,"endLine":1}]}]}\n```');
    var mev = mt.trace.steps[0].evidence;
    ok('chips · model "repo:path" citation maps to the loaded file; ambiguous stays dead', mev[0].file === 'alpha/src/util.js' && mev[1].file === 'src/util.js'
      && evidenceChip(mev[1]).disabled === true, mev[0].file + ' · ' + mev[1].file);
    /* the cross-repo intent */
    ok('intent · workspace routes only with 2+ repos', classifyIntent('compare the repos').kind === 'workspace');
    var wsInv = inv('workspace');
    ok('intent · workspace finds the shared dependency', /`react` \(`alpha`, `beta`\)/.test(wsInv.answer), wsInv.answer.slice(0, 80));
    ok('intent · workspace finds the repo link + cross-repo import', /`beta` → `alpha` via `@acme\/alpha`/.test(wsInv.answer) && /`beta` → `alpha` ×1/.test(wsInv.answer));
    ok('intent · workspace finds names exported in both repos', /`formatDate` \(`alpha`, `beta`\)/.test(wsInv.answer));
    ok('intent · workspace evidence points at real files', wsInv.steps.some(function (s) { return (s.evidence || []).some(function (e) { return e.file === 'beta/package.json' && e.startLine > 1; }); }));
    st.ws.scope = 'repo'; st.ws.active = 'beta';
    var wsScoped = withScope(function () { return inv('workspace'); });
    ok('intent · workspace reads every repo even when scoped', /`alpha`/.test(wsScoped.answer) && /2 repos/.test(wsScoped.answer));
    st.ws.scope = 'all';
    ok('drift · a workspace is identified by its repo labels', projectSig() === 'workspace:alpha+beta', projectSig());
    /* saved workspace: metadata only */
    st.files.get('beta/src/util.js').checked = false;
    var rec = buildSaveRecord('ws selftest');
    var recJson = JSON.stringify(rec);
    var TOP = ['name', 'savedAt', 'fileCount', 'totalTokens', 'unchecked', 'ignore', 'prefs', 'handle', 'kind', 'repos', 'loose'];
    ok('saved workspace · records repos, counts and selection', rec.kind === 'workspace' && rec.repos.length === 2 && rec.repos[0].label === 'alpha' && rec.repos[0].fileCount === 4
      && rec.repos[1].fileCount === 3 && rec.unchecked.length === 1 && rec.unchecked[0] === 'beta/src/util.js', rec.repos.map(function (r) { return r.label + ':' + r.fileCount; }).join(' '));
    ok('saved workspace · persists no file contents', Object.keys(rec).every(function (k) { return TOP.indexOf(k) !== -1; })
      && rec.repos.every(function (r) { return Object.keys(r).every(function (k) { return ['label', 'fileCount', 'totalTokens', 'handle'].indexOf(k) !== -1; }); })
      && Object.keys(W).every(function (p) { return recJson.indexOf(W[p]) === -1; }) && recJson.indexOf('ONLY_MARKER') === -1 && recJson.indexOf('formatDate') === -1, recJson.length + ' chars');
    /* restore: re-picked folders join under their saved labels, selection comes back */
    st.files.get('beta/src/util.js').checked = true;
    st.pendingWorkspace = { rec: { name: 'ws selftest', unchecked: ['beta/src/util.js'], prefs: { active: 'beta', scope: 'repo' } }, waiting: [{ label: 'beta', handle: null, fileCount: 3 }] };
    var pend = pendingLabelFor('beta');
    afterWorkspaceIngest();
    ok('saved workspace · re-picked repo restores its selection + scope', pend === 'beta' && st.pendingWorkspace === null
      && st.files.get('beta/src/util.js').checked === false && st.ws.scope === 'repo' && st.ws.active === 'beta');
    st.files.get('beta/src/util.js').checked = true;
    st.ws.scope = 'all';
    /* share: repo labels travel, untrusted labels are dropped */
    var spl = buildSharePayload(['alpha/src/util.js', 'beta/src/util.js'], { name: 'ws', now: 1 });
    var sback = parseBundleText(bundleText(spl));
    ok('share · a workspace share carries its repo labels', JSON.stringify(spl.repos) === '["alpha","beta"]' && JSON.stringify(sback.repos) === '["alpha","beta"]');
    var bogus = parseBundleText(JSON.stringify({ format: 'meridian-share', v: 1, name: 'x', repos: ['alpha', '../x', 'nope', 'a/b', 42], files: [{ p: 'alpha/a.js', c: 'x' }] }));
    ok('share · repo labels are validated against the shared paths', JSON.stringify(bogus.repos) === '["alpha"]', JSON.stringify(bogus.repos));
    resetWorkspace();
    ok('intent · workspace with one project is honest', !isMulti() && classifyIntent('compare the repos').kind !== 'workspace' && /Only one project is loaded/.test(inv('workspace').answer));
  } finally {
    resetWorkspace();
    st.files = keep.files; st.projectIndex = keep.idx; st.indexDirty = keep.dirty; st.totalBytes = keep.bytes;
    st.skippedFiles = keep.skipList; st.skipped = keep.skipped; st.ctxMode = keep.ctxMode; st.groundMode = keep.groundMode; st.pinnedEv = keep.pins;
    st.contextDirty = true; st.mapDirty = true;
  }
}
/* usage analytics — an in-memory store that counts every call stands in for
   IndexedDB, and a recording fetch stands in for the network. The user's own
   analytics settings are saved first and put back in finally; a sentinel key
   is planted only when the Anthropic slot is empty, as in shareCases. */
function memStore() {
  var rows = [], id = 0, ops = 0;
  return {
    add: function (ev) { ops++; var r = JSON.parse(JSON.stringify(ev)); r.id = ++id; rows.push(r); return Promise.resolve(id); },
    all: function () { ops++; return Promise.resolve(rows.slice()); },
    clear: function () { ops++; rows = []; return Promise.resolve(); },
    ops: function () { return ops; }, rows: function () { return rows; }
  };
}
function analyticsCases(ok) {
  var SENT = 'sk-ant-SELFTEST-SENTINEL-0000';
  var KEYS = [LS.analytics, LS.analyticsText, LS.analyticsUrl];
  var savedLS = KEYS.map(lsGet), savedProv = st.curProvider;
  var planted = !lsGet(LS.key);
  var mem = memStore(), calls = [], failNext = false;
  var prev = __setAnalyticsForTest({ store: mem, fetch: function (u, o) {
    calls.push({ u: u, o: o });
    return failNext ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ ok: true, status: 204 });
  } });
  function finish() {
    KEYS.forEach(function (k, i) { if (savedLS[i] === null) lsDel(k); else lsSet(k, savedLS[i]); });
    if (planted) lsDel(LS.key);
    st.curProvider = savedProv;
    __setAnalyticsForTest(prev);
  }
  var POISON = { type: 'question', engine: 'model', provider: 'anthropic', model: 'claude-sonnet-5', intent: 'src/store.js', outcome: 'ok',
    latencyMs: 420, durationMs: 1800, tokensIn: 1200, tokensOut: 300, q: 'where is addTodo? key ' + SENT + ' and sk-proj-abcdefghijklmnopqrstuv',
    path: 'src/secret/store.js', file: 'src/store.js', content: 'function addTodo() { return 1; }', code: 'const API_KEY = 1', apiKey: SENT, key: SENT, url: 'https://evil.example/x' };
  var ev1, ev2;
  KEYS.forEach(lsDel); /* fresh browser: nothing stored */
  if (planted) lsSet(LS.key, SENT);
  st.curProvider = 'anthropic';
  ok('analytics · off by default (no switch, no text, no endpoint)', !analyticsOn() && !storeText() && endpointUrl() === '');
  return Promise.all([
    track(POISON), track({ type: 'share_link', files: 3 }), track({ type: 'repo_added', repos: 2 }), track({ type: 'question', engine: 'local', intent: 'cycles' })
  ]).then(function (r) {
    ok('analytics · off: no writes, no reads, no network', r.every(function (x) { return x === null; }) && mem.ops() === 0 && calls.length === 0, 'store ops=' + mem.ops() + ' fetch=' + calls.length);
    lsSet(LS.analytics, '1');
    return track(POISON);
  }).then(function (e) {
    ev1 = e;
    var js = JSON.stringify(mem.rows());
    ok('analytics · on: one event stored', !!ev1 && mem.rows().length === 1 && mem.rows()[0].type === 'question', mem.rows().length + ' rows');
    ok('analytics · timestamp is the real current time', Math.abs(ev1.ts - Date.now()) < 60000, new Date(ev1.ts).toISOString());
    ok('analytics · sanitized to whitelisted fields only', Object.keys(ev1).every(function (k) { return EVENT_FIELDS.indexOf(k) !== -1; })
      && ['path', 'file', 'content', 'code', 'apiKey', 'key', 'url'].every(function (k) { return !(k in ev1); }), Object.keys(ev1).join(','));
    ok('analytics · no code, paths or keys in what is stored', js.indexOf(SENT) === -1 && js.indexOf('src/') === -1 && js.indexOf('function') === -1
      && js.indexOf('API_KEY') === -1 && js.indexOf('sk-proj') === -1 && js.indexOf('evil.example') === -1, js.length + ' chars');
    ok('analytics · a path in the intent slot becomes "other"', ev1.intent === 'other' && ev1.engine === 'model' && ev1.provider === 'anthropic' && ev1.model === 'claude-sonnet-5', ev1.intent);
    ok('analytics · question text absent while its switch is off', !('q' in ev1) && js.indexOf('addTodo') === -1);
    ok('analytics · numbers kept, repo count + scope recorded', ev1.latencyMs === 420 && ev1.durationMs === 1800 && ev1.tokensIn === 1200 && ev1.tokensOut === 300
      && typeof ev1.repos === 'number' && ev1.scope === 'single' && typeof ev1.files === 'number');
    var odd = sanitizeEvent({ type: 'question', provider: 'evil', model: '../../etc', engine: 'x', outcome: 'pwned', latencyMs: -5, tokensIn: 'lots', scope: 'everything' });
    ok('analytics · unknown enums and bad numbers are dropped or defaulted', odd.provider === 'other' && odd.model === 'other' && odd.engine === 'model' && odd.outcome === 'ok'
      && !('latencyMs' in odd) && !('tokensIn' in odd) && odd.scope === 'single' && sanitizeEvent({ type: 'upload_files' }) === null);
    ok('analytics · every real intent kind survives sanitizing', INTENTS.every(function (it) { return sanitizeEvent({ type: 'question', intent: it.kind }).intent === it.kind; }));
    lsSet(LS.analyticsText, '1');
    return track(POISON);
  }).then(function (e) {
    ev2 = e;
    ok('analytics · text switch on: question kept, keys removed', typeof ev2.q === 'string' && ev2.q.indexOf('where is addTodo?') === 0
      && ev2.q.indexOf(SENT) === -1 && ev2.q.indexOf('sk-proj') === -1 && /key removed/.test(ev2.q), ev2.q);
    return track({ type: 'question', engine: 'local', provider: 'local', intent: 'search', q: new Array(80).join('long question ') });
  }).then(function (e) {
    ok('analytics · stored question text is capped', e.q.length <= AN_Q_MAX + 1, e.q.length + ' chars');
    ok('analytics · feature events carry counts only', !('q' in sanitizeEvent({ type: 'share_link', files: 4, q: 'secret' }, { text: true }))
      && sanitizeEvent({ type: 'share_link', files: 4 }).files === 4);
    ok('analytics · endpoint blank: no network at all', calls.length === 0, calls.length + ' requests');
    lsSet(LS.analyticsText, '0');
    return flushAnalyticsSend();
  }).then(function (sent) {
    ok('analytics · flushing with no endpoint sends nothing', sent === false && calls.length === 0);
    /* summaries over a fixed event set */
    var evs = [100, 200, 300, 400, 1000].map(function (ms, i) { return { type: 'question', engine: 'model', provider: i < 3 ? 'anthropic' : 'openai', intent: i < 2 ? 'def' : 'reason', outcome: i === 4 ? 'error' : 'ok', latencyMs: ms, durationMs: ms * 2, ts: 1000 + i }; })
      .concat([{ type: 'question', engine: 'local', provider: 'local', intent: 'def', outcome: 'ok', latencyMs: 7, ts: 2000 }, { type: 'share_link', files: 2, ts: 3000 }, { type: 'repo_added', repos: 2, ts: 4000 }]);
    var s = summarize(evs);
    ok('analytics · totals + LOCAL vs model', s.total === 8 && s.questions === 6 && s.model === 5 && s.local === 1 && s.errors === 1 && s.features.share_link === 1 && s.features.repo_added === 1);
    ok('analytics · breakdown by intent and provider', s.byIntent.def === 3 && s.byIntent.reason === 3 && s.byProvider.anthropic === 3 && s.byProvider.openai === 2 && s.byProvider.local === 1);
    ok('analytics · median / p90 latency (nearest rank)', s.latency.model.median === 300 && s.latency.model.p90 === 1000 && s.latency.modelDuration.median === 600
      && s.latency.local.median === 7 && percentile([], 50) === null && percentile([5], 90) === 5, s.latency.model.median + ' / ' + s.latency.model.p90);
    var stored = evs.map(function (e, i) { var c = JSON.parse(JSON.stringify(e)); c.id = i + 1; c.v = 1; return c; });
    stored[0].q = '=HYPERLINK("http://x","click"), with a comma';
    stored[1].junk = 'src/leak.js';
    var j = JSON.parse(analyticsJSON(stored));
    ok('analytics · JSON export shape', j.format === AN_FORMAT && j.v === 1 && j.count === 8 && j.events.length === 8 && typeof j.exported === 'string'
      && j.events.every(function (e) { return Object.keys(e).every(function (k) { return EVENT_FIELDS.indexOf(k) !== -1; }); })
      && JSON.stringify(j).indexOf('src/leak.js') === -1 && !('id' in j.events[0]));
    var csv = analyticsCSV(stored), lines = csv.split('\r\n');
    ok('analytics · CSV export: header, one row per event', lines[0] === CSV_COLS.join(',') && lines.length === 10 && lines[9] === '' && lines[1].indexOf('1970-01-01T00:00:01.000Z,1000,question,def,model,anthropic') === 0, lines[0]);
    ok('analytics · CSV quotes commas and defuses formulas', lines[1].indexOf('"\'=HYPERLINK(""http://x"",""click""), with a comma"') !== -1 && csv.indexOf('src/leak.js') === -1);
    return readEvents();
  }).then(function (rows) {
    ok('analytics · the log reads back what was stored', rows.length === 3 && rows.every(function (r) { return r.type === 'question'; }));
    return clearAnalytics().then(readEvents);
  }).then(function (rows) {
    ok('analytics · clear empties the log', rows.length === 0 && mem.rows().length === 0);
    /* own endpoint: validation, sanitized batches, LOCAL never sent, back-off */
    ok('analytics · endpoint URL validation', !validEndpoint('').ok && !validEndpoint('javascript:alert(1)').ok && !validEndpoint('ftp://x.example/e').ok
      && !validEndpoint('http://collector.example/e').ok && !validEndpoint('https://u:p@collector.example/e').ok
      && validEndpoint('http://localhost:8787/e').ok && !validEndpoint('http://localhost:8787/e').warn
      && validEndpoint('https://collector.example/e').ok && /connect-src/.test(validEndpoint('https://collector.example/e').warn));
    lsSet(LS.analyticsUrl, 'http://localhost:8787/events');
    return track(POISON).then(flushAnalyticsSend);
  }).then(function (sent) {
    var body = calls[0] && JSON.parse(calls[0].o.body);
    ok('analytics · own endpoint gets one sanitized POST', sent === true && calls.length === 1 && calls[0].u === 'http://localhost:8787/events' && calls[0].o.method === 'POST'
      && calls[0].o.credentials === 'omit' && body.format === AN_FORMAT && body.events.length === 1 && !('q' in body.events[0])
      && calls[0].o.body.indexOf(SENT) === -1 && calls[0].o.body.indexOf('src/') === -1, calls.length + ' requests');
    st.curProvider = 'local';
    return Promise.all([track({ type: 'question', engine: 'local', provider: 'local', intent: 'def' }), track({ type: 'share_link', files: 1 })]).then(flushAnalyticsSend);
  }).then(function () {
    ok('analytics · LOCAL mode never sends, even with an endpoint', calls.length === 1 && mem.rows().length === 3, calls.length + ' requests');
    st.curProvider = 'openai';
    return track({ type: 'question', engine: 'local', provider: 'local', intent: 'def' }).then(flushAnalyticsSend);
  }).then(function () {
    ok('analytics · LOCAL answers are not sent from a model provider either', calls.length === 1);
    failNext = true;
    return track(POISON).then(flushAnalyticsSend);
  }).then(function (sent) {
    failNext = false;
    var n = calls.length;
    return track(POISON).then(flushAnalyticsSend).then(function (again) {
      ok('analytics · a failed send is dropped and pauses, no retries', sent === false && n === 2 && again === false && calls.length === 2, calls.length + ' requests');
      ok('analytics · failures never block the local log', mem.rows().length === 6, mem.rows().length + ' rows');
    });
  }).then(function () {
    var before = mem.ops();
    lsSet(LS.analytics, '0');
    return track(POISON).then(function (r) {
      ok('analytics · switched off again: nothing stored or sent', r === null && mem.ops() === before && calls.length === 2);
    });
  }).then(function () {
    /* the real IndexedDB path, on a throwaway database that is deleted afterwards */
    var db = idbStore('meridian-analytics-selftest');
    return db.clear().then(function () { return db.add(sanitizeEvent({ type: 'share_link', files: 1 })); })
      .then(function () { return db.add(sanitizeEvent({ type: 'repo_added', repos: 2 })); })
      .then(db.all).then(function (rows) {
        ok('analytics · IndexedDB round-trip (throwaway db)', rows.length === 2 && rows[0].type === 'share_link' && typeof rows[0].id === 'number', rows.length + ' rows');
        return db.clear().then(db.all);
      }).then(function (rows) {
        ok('analytics · IndexedDB clear', rows.length === 0);
      }).catch(function (e) {
        ok('analytics · IndexedDB round-trip (throwaway db)', false, String(e && e.message || e));
      }).then(function () { db.close(); try { indexedDB.deleteDatabase('meridian-analytics-selftest'); } catch (e) {} });
  }).then(finish, function (e) { finish(); throw e; });
}
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
      ['what depends on store.js', 'importers'],       /* dependents, NOT imports — must beat the imports route */
      ['what does store.js depend on', 'imports'],     /* the "what does X depend on" form stays with imports */
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
      ['what changed since last session', 'drift'],
      /* command-grammar gate (audit F2) — prose that merely STARTS with a command
         alias must fall through to the NL cascade, never swallow the sentence as
         an argument. A trailing "why?" is interpretation → reason, always. */
      ['Help me understand the auth flow', 'reason'],
      ['Tests are failing after the refactor, why?', 'reason'],   /* trailing-why beats the tests route */
      ['Search performance is terrible, how do I fix it?', 'reason'],
      ['Dead simple question: why is login slow', 'reason'],
      ['Path forward for the auth rewrite?', 'plain'],            /* no interpretation marker — honest deterministic search */
      ['Imports are slow, why?', 'reason'],                       /* trailing-why beats the importers route */
      ['Related work on this?', 'plain'],
      ['Recent regressions in checkout?', 'recent'],
      ['Structure of payments confuses me, why?', 'reason'],      /* trailing-why beats the structure route */
      ['Exports keep breaking', 'plain'],                         /* two prose tokens — the gate declines */
      ['search "cache control"', 'search'],                       /* quoted arg = the literal escape hatch */
      ['why do we have circular imports', 'cycles'],              /* leading why stays with the cascade */
      /* natural-language collision & edge cases (audit: routing robustness pass) */
      ['what uses store.js', 'importers'],                        /* "what uses" — was falling to plain */
      ['what uses addTodo', 'importers'],                         /* symbol arg — the run redirects to references */
      ['who uses addTodo', 'importers'],
      ['who uses the store', 'importers'],                        /* determiner + usage verb — arg must be the noun */
      ['what depends on the store', 'importers'],
      ['who imports util.js', 'importers'],
      ['show the dependency graph', 'hubs'],                      /* was falling to plain — fan-in is the honest answer */
      ['list all files', 'listType'],                             /* determiner guard lists everything */
      ['list every file', 'listType'],
      ['show all python files', 'listType'],
      ['list all functions', 'symbols'],                          /* not listType — no real extension present */
      ['uses of json', 'refs'],                                   /* bare "uses of" stays with refs, not importers */
      ['what calls listTodos', 'refs'],
      ['where is the config', 'def'],                             /* determiner question still lands on def */
      ['what does the server import', 'imports'],                 /* determiner + no extension resolves via basename */
      /* blast radius / transitive impact — must beat importers' depend- regex and plain */
      ['impact src/store.js', 'impact'],
      ['blast radius of store.js', 'impact'],                     /* alias + prose rest declines the command gate */
      ['what breaks if I change store.js', 'impact'],
      ['what depends on store.js transitively', 'impact'],
      ['who would notice if store.js disappeared', 'impact']
    ];
    ROUTES.forEach(function (rc) {
      var got = classifyIntent(rc[0]) || {};
      ok('route · “' + rc[0] + '” → ' + rc[1], got.kind === rc[1], got.kind !== rc[1] ? 'got ' + got.kind : '');
    });
    ok('route · reason needs a model', classifyIntent('why is the store slow').needsModel === true);
    ok('route · def arg picks the symbol', classifyIntent('where is addTodo defined').arg === 'addTodo');
    ok('route · importers arg picks the path', classifyIntent('what imports store.js').arg === 'store.js');
    var qs = classifyIntent('search "cache control"');
    ok('route · quoted search arg unwrapped + literal', qs.arg === 'cache control' && qs.literal === true, qs.arg);
    ok('route · path keeps two tokens', classifyIntent('path src/index.js src/store.js').arg === 'src/index.js src/store.js');
    ok('route · trailing-why is not deterministic', classifyIntent('Imports are slow, why?').needsModel === true);
    ok('route · determiner arg picks the noun (who uses the store)', classifyIntent('who uses the store').arg === 'store', classifyIntent('who uses the store').arg);
    ok('route · determiner arg picks the noun (what depends on the store)', classifyIntent('what depends on the store').arg === 'store', classifyIntent('what depends on the store').arg);
    ok('route · def determiner arg (where is the config)', classifyIntent('where is the config').arg === 'config', classifyIntent('where is the config').arg);
    /* registry consistency — every reasoning instance is a complete entry */
    ok('registry · entries complete (kind/ground/run)', INTENTS.every(function (it) {
      return typeof it.kind === 'string' && it.kind && typeof it.ground === 'string' && typeof it.run === 'function'
        && (it.route === null || typeof it.route === 'function') && Array.isArray(it.aliases);
    }));
    ok('registry · kinds unique', new Set(INTENTS.map(function (it) { return it.kind; })).size === INTENTS.length);
    ok('registry · plain is the terminal fallback', INTENTS[INTENTS.length - 1].kind === 'plain');
    /* LOCAL question menu — the "what can I ask" catalog is well-formed and every
       ready-to-send (no-placeholder) entry routes to a real deterministic intent */
    ok('localmenu · catalog well-formed', LOCAL_MENU.length > 0 && LOCAL_MENU.every(function (g) {
      return typeof g.group === 'string' && g.group && Array.isArray(g.items) && g.items.length > 0
        && g.items.every(function (it) { return it && typeof it.label === 'string' && it.label && typeof it.fill === 'string' && it.fill; });
    }));
    ok('localmenu · no-placeholder fills route to a real intent', LOCAL_MENU.every(function (g) {
      return g.items.every(function (it) {
        if (it.fill.indexOf('<') !== -1) return true; /* templates need an arg — skip */
        var k = classifyIntent(it.fill).kind;
        return k !== 'plain' && k !== 'reason';
      });
    }), 'every menu command resolves');
    ok('localmenu · starters are non-empty strings', LOCAL_STARTERS.length > 0 && LOCAL_STARTERS.every(function (s) { return typeof s === 'string' && s.length > 0; }));
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
    /* SSE buffer splitting (audit F4) — CRLF endpoints and unterminated tails */
    var spA = splitSseEvents('data: a\n\ndata: b\n\ndata: c');
    ok('sse · LF split keeps the tail', spA.events.length === 2 && spA.rest === 'data: c');
    var spB = splitSseEvents('data: a\r\n\r\ndata: b\r\n\r\n');
    ok('sse · CRLF separators split', spB.events.length === 2 && spB.rest === '');
    var spC = splitSseEvents('data: a\n\r\ndata: b');
    ok('sse · mixed separators split', spC.events.length === 1 && spC.rest === 'data: b');
    /* HTTP error taxonomy */
    ok('http · 401 key rejected', httpErrorText(401, '').indexOf('KEY REJECTED') === 0);
    ok('http · 429 uses retry-after', httpErrorText(429, '', '12').indexOf('retry in 12s') !== -1);
    ok('http · 400 context too large', httpErrorText(400, JSON.stringify({ error: { message: 'prompt exceeds context length' } })).indexOf('CONTEXT TOO LARGE') === 0);
    ok('http · 529 overloaded', httpErrorText(529, '').indexOf('PROVIDER OVERLOADED') === 0);
    /* multi-repo workspace — self-contained scratch state, restored on exit */
    workspaceCases(ok);
    demoLinkCases(ok);
  } catch (e) {
    ok('harness executed without throwing', false, String(e && e.message || e));
    restore();
    return Promise.resolve(results);
  }
  /* the ingest cases are async (real Blob reads) — run them, then restore state */
  return ingestCases(ok).catch(function (e) {
    ok('ingest harness executed without throwing', false, String(e && e.message || e));
  }).then(function () {
    return shareCases(ok).catch(function (e) { ok('share harness executed without throwing', false, String(e && e.message || e)); });
  }).then(function () {
    return analyticsCases(ok).catch(function (e) { ok('analytics harness executed without throwing', false, String(e && e.message || e)); });
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
