import { estTokens, staticScore } from './smart-context.js';
import { detectLang } from './indexer.js';
import { app } from './helpers.js';
/* ============ SELF-TESTS: SHARED FIXTURES ============
   Scratch-project builders and the in-memory analytics store the other selftest-*.js files use. */
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
    /* noise guards (post-merge audit): import text inside strings, template literals
       and comments is not an import; function-local variables are not duplicates */
    'src/samplecode.js': [
      'var SAMPLE = [',
      "  'const { x } = require(\"./nope-a\");',",
      "  \"import y from './nope-b';\"",
      "].join('\\n');",
      'var TPL = `',
      "import z from './nope-c';",
      'function insideTemplate() {}',
      '`;',
      "// import w from './nope-d';",
      "/* import v from './nope-e'; */",
      'export function useSample() { return SAMPLE + TPL; }'
    ].join('\n'),
    'src/assetuse.js': "import logo from './missing-logo.png';\nexport function showLogo() { return logo; }",
    'src/localsa.js': 'export function alphaOne() {\n  var rowsLocal = 1;\n  return rowsLocal;\n}\nexport const makeWidget = () => 1;',
    'src/localsb.js': 'export function betaTwo() {\n  var rowsLocal = 2;\n  return rowsLocal;\n}\nexport const makeWidget = () => 2;\nfunction insideTemplate() {}',
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
function memStore() {
  var rows = [], id = 0, ops = 0;
  return {
    add: function (ev) { ops++; var r = JSON.parse(JSON.stringify(ev)); r.id = ++id; rows.push(r); return Promise.resolve(id); },
    all: function () { ops++; return Promise.resolve(rows.slice()); },
    clear: function () { ops++; rows = []; return Promise.resolve(); },
    ops: function () { return ops; }, rows: function () { return rows; }
  };
}
export { stEntry, selfTestFixture, memStore };
