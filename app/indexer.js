import { sortedPaths, st } from './state.js';
import { CONFIG_NAMES, DOCS_PATH, ENTRY_NAMES, README_NAMES, TEST_PATH, detectPackages } from './smart-context.js';
import { setStatus } from './helpers.js';
/* ============ PROJECT INTELLIGENCE INDEX ============
   A deterministic, structured understanding of the loaded project, built in one
   pass over the in-memory files: symbol definitions, import/importer edges, and
   file classifications (entries, tests, configs, docs). This is the foundation the
   LOCAL engine's investigations read — Meridian understands the terrain before a
   model enters the room. Rebuilt lazily; invalidated (indexDirty) wherever the
   loaded/checked set changes.                                                    */

st.indexDirty = true; st.projectIndex = null;

/* definition-shaped lines across common languages — captures the declared name.
   Practical regex, not a parser: covers declarations and `NAME = function|class|(=>)`. */
/* declarations across JS/TS, Python, Go (top-level func), Rust (pub/mod), Java, C#, Ruby */
var DEF_DECL_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:pub(?:\([^)]*\))?\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|abstract\s+|final\s+|sealed\s+|partial\s+)*(?:async\s+)?(function\*?|class|interface|type|struct|enum|trait|impl|def|fn|func|module|mod|const|let|var|sub|proc|record)\s+([A-Za-z_$][\w$]*)/;
/* Java/C# method declarations: ≥1 modifier keeps call statements/`if (`/`return (` out;
   `=` excluded from the type-token class keeps field initializers out; `new` is
   deliberately not a modifier. Gated to .java/.cs files. */
var DEF_CJ_METHOD_RE = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|override|virtual|async|partial|synchronized|native)\s+)+(?:[\w$.<>\[\],?]+\s+)*([A-Za-z_$][\w$]*)\s*\(/;
/* C# properties: `public int Count { get; set; }` — the `{ get|set|init` tail is the gate */
var DEF_CS_PROP_RE = /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|required)\s+)+(?:[\w$.<>\[\],?]+\s+)*([A-Za-z_$][\w$]*)\s*\{\s*(?:get|set|init)\b/;
/* Ruby attribute declarations are the class's public surface */
var DEF_RB_ATTR_RE = /^\s*attr_(?:accessor|reader|writer)\s+(:\w+(?:\s*,\s*:\w+)*)/;
/* C# namespace declarations (braced and file-scoped) — recorded for using-resolution */
var CS_NAMESPACE_RE = /^\s*namespace\s+([\w.]+)/;
var DEF_ASSIGN_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:const|let|var|public|private|protected|static|readonly)?\s*([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?(?:function\*?\b|\([^()]*\)\s*(?::[^={]+)?=>|class\b|\([^)]*\)\s*\{)/;
var DEF_GO_METHOD_RE = /^\s*func\s*\([^)]*\)\s*([A-Za-z_]\w*)/;       /* Go receiver methods: func (r *R) M() */
var DEF_PY_ASSIGN_RE = /^([A-Za-z_]\w*)\s*(?::[^=\n]+)?=(?!=)\s*\S/;  /* Python module-level NAME = … (no indent, not ==) */
function assignKind(ln) {
  if (/=>\s*/.test(ln) && /\([^()]*\)\s*(?::[^={]+)?=>/.test(ln)) return 'arrow';
  if (/\bclass\b/.test(ln)) return 'class';
  if (/\bfunction\b/.test(ln)) return 'function';
  return 'const';
}
/* import-shaped lines. `lang: null` applies to every file; otherwise the entry only
   runs when the file's detected language matches — gating stops the Python `import`
   rule from mangling Java lines and keeps C#'s `using` away from C/C++. */
var IMPORT_RES = [
  { re: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/, lang: null },                      /* dynamic import('m') — check before static */
  { re: /\bimport\s+(?:[\w${},*\s]+\s+from\s+)?['"]([^'"]+)['"]/, lang: null },     /* import x from 'm' | import 'm' */
  { re: /\bexport\s+(?:[\w${},*\s]+)\s+from\s+['"]([^'"]+)['"]/, lang: null },      /* export … from 'm' */
  { re: /\brequire\(\s*['"]([^'"]+)['"]\s*\)/, lang: null },                        /* require('m') */
  { re: /^\s*(?:pub\s+)?use\s+([A-Za-z_][\w:]*)/, lang: { rust: 1, php: 1 } },      /* rust: use crate::a::b (php `use` kept as before) */
  { re: /^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/, lang: { rust: 1 } },             /* rust: mod foo; */
  { re: /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/, lang: { ruby: 1 } },        /* ruby: require 'x' | require_relative 'x' */
  { re: /^\s*(?:global\s+)?using\s+(?:static\s+)?(?:\w+\s*=\s*)?([A-Za-z_][\w.]*)\s*;/, lang: { 'c#': 1 } }, /* c#: using Ns; — shape excludes using-statements */
  { re: /^\s*import\s+(?:static\s+)?([\w.]+?)(?:\.\*)?\s*;/, lang: { java: 1 } },   /* java: import a.b.C; | import static a.b.C.m; | a.b.* */
  { re: /^\s*from\s+([.\w]+)\s+import\b/, lang: { python: 1 } },                    /* py: from m import … (incl. relative) */
  { re: /^\s*import\s+([\w.]+)/, lang: { python: 1 } }                              /* py: import m */
];
var RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb', '.php', '.java', '.cs', '.vue', '.svelte'];
/* export-shaped lines the definition regexes don't cover: JS/TS named re-exports
   and CommonJS. Declaration exports (export function x / pub fn / Go capitals)
   are detected off the already-matched definition instead — no second pass. */
var EXPORT_BRACES_RE = /^\s*(?:export\s*\{([^}]+)\}|module\.exports\s*=\s*\{([^}]+)\})/;
var EXPORT_ASSIGN_RE = /^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/;
/* code-health scans, same single pass */
var TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/;
var ENV_RE = /\bprocess\.env\.([A-Z_][A-Z0-9_]*)|\bprocess\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]|\bimport\.meta\.env\.([A-Z_][A-Z0-9_]*)|\bos\.environ(?:\.get)?\s*[([]\s*['"]([A-Z_][A-Z0-9_]*)['"]|\bos\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]|\bos\.Getenv\(\s*"([A-Z_][A-Z0-9_]*)"|\benv::var\(\s*"([A-Z_][A-Z0-9_]*)"|\bENV\[['"]([A-Z_][A-Z0-9_]*)['"]\]/;
var TODO_CAP = 500, ENV_NAME_CAP = 200, ENV_REF_CAP = 50, EXPORT_FILE_CAP = 100;
/* language id by extension (+ shebang for extensionless scripts) — powers the
   index-size stat and lets the LOCAL engine phrase results by language */
var LANG_BY_EXT = { js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'ts', tsx: 'ts', py: 'python', go: 'go', rs: 'rust',
  java: 'java', rb: 'ruby', php: 'php', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'c#', swift: 'swift',
  kt: 'kotlin', scala: 'scala', ex: 'elixir', exs: 'elixir', lua: 'lua', sh: 'shell', bash: 'shell', zsh: 'shell',
  svelte: 'svelte', vue: 'vue', html: 'html', css: 'css', scss: 'css', md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml' };
function detectLang(path, content) {
  var ex = fileExt(path);
  if (LANG_BY_EXT[ex]) return LANG_BY_EXT[ex];
  if (!ex && content) {
    var first = content.slice(0, 80);
    if (/^#!.*\b(python[0-9.]*)\b/.test(first)) return 'python';
    if (/^#!.*\b(bash|sh|zsh)\b/.test(first)) return 'shell';
    if (/^#!.*\bnode\b/.test(first)) return 'js';
    if (/^#!.*\b(ruby)\b/.test(first)) return 'ruby';
  }
  return ex || 'other';
}

function fileExt(path) {
  var nm = path.slice(path.lastIndexOf('/') + 1);
  return nm.indexOf('.') === -1 ? '' : nm.slice(nm.lastIndexOf('.') + 1).toLowerCase();
}
function dirOf(path) { return path.indexOf('/') === -1 ? '' : path.slice(0, path.lastIndexOf('/')); }

/* ---- import resolvers: tsconfig paths, Go module prefix, workspace packages.
   Rebuilt each index pass from the loaded manifests. ---- */
var idxAlias = [], idxGoModule = '', idxWorkspace = [];
var idxPkgMeta = {};  /* package.json dir -> { exports, imports, main } */
var idxCrates = [];   /* Cargo.toml [package] names (hyphens→underscores) -> crate dir */
function joinPath(a, b) {
  var parts = (a ? a.split('/') : []).concat(b ? b.split('/') : []), stack = [];
  parts.forEach(function (s) { if (s === '' || s === '.') return; if (s === '..') stack.pop(); else stack.push(s); });
  return stack.join('/');
}
/* conditional-exports value → concrete path: import > default > require > node >
   browser, recursively; the 'types' condition is never taken. */
function pickCond(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    var order = ['import', 'default', 'require', 'node', 'browser'];
    for (var i = 0; i < order.length; i++) if (v[order[i]] !== undefined) return pickCond(v[order[i]]);
  }
  return null;
}
/* package.json "exports" (string | conditional object | dotted-key map) → flat
   { '.': path, './sub': path, './feat/*': path } map, or null */
function normExports(ex) {
  if (!ex) return null;
  if (typeof ex === 'string') return { '.': ex };
  var keys = Object.keys(ex), map = {}, dotted = keys.some(function (k) { return k.charAt(0) === '.'; });
  if (!dotted) { var one = pickCond(ex); return one ? { '.': one } : null; }
  keys.forEach(function (k) { if (k.charAt(0) === '.') { var t = pickCond(ex[k]); if (t) map[k] = t; } });
  return map;
}
/* look a subpath up in a flat exports map: exact key first, then single-* patterns */
function lookupExports(map, sub) {
  var key = sub ? './' + sub : '.';
  if (map[key]) return map[key];
  var ks = Object.keys(map);
  for (var i = 0; i < ks.length; i++) {
    var star = ks[i].indexOf('*');
    if (star === -1) continue;
    var pre = ks[i].slice(2, star), suf = ks[i].slice(star + 1);
    if (sub.indexOf(pre) === 0 && sub.length >= pre.length + suf.length
        && (suf === '' || sub.slice(sub.length - suf.length) === suf))
      return map[ks[i]].replace('*', sub.slice(pre.length, sub.length - suf.length));
  }
  return null;
}
/* the crate a file belongs to: longest Cargo.toml dir prefix */
function crateFor(f) {
  var best = null, bestLen = -1;
  for (var i = 0; i < idxCrates.length; i++) {
    var dd = idxCrates[i].dir === '' ? '' : idxCrates[i].dir + '/';
    if ((dd === '' || f.indexOf(dd) === 0) && dd.length > bestLen) { best = idxCrates[i]; bestLen = dd.length; }
  }
  return best;
}
/* the directory a Rust file's own module owns: mod.rs/lib.rs/main.rs own their dir;
   foo.rs owns foo/ by convention */
function selfModDir(f) {
  var b = f.slice(f.lastIndexOf('/') + 1);
  return (b === 'mod.rs' || b === 'lib.rs' || b === 'main.rs') ? dirOf(f) : f.slice(0, -3);
}
function buildResolvers(paths) {
  idxAlias = []; idxGoModule = ''; idxWorkspace = []; idxPkgMeta = {}; idxCrates = [];
  paths.forEach(function (p) {
    var nm = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
    if (nm === 'package.json') {
      try {
        var pj = JSON.parse(st.files.get(p).content), pdir = dirOf(p) || '.';
        idxPkgMeta[pdir] = { exports: normExports(pj.exports), imports: pj.imports || null, main: typeof pj.main === 'string' ? pj.main : '' };
      } catch (e) {}
    } else if (nm === 'cargo.toml') {
      /* section-split so a `name =` under [dependencies] can't masquerade as the package */
      var sects = st.files.get(p).content.split(/^\s*\[/m);
      for (var cs = 0; cs < sects.length; cs++) {
        if (!/^package\]/.test(sects[cs])) continue;
        var cn = sects[cs].match(/^\s*name\s*=\s*["']([^"']+)["']/m);
        if (cn) idxCrates.push({ name: cn[1].replace(/-/g, '_'), dir: dirOf(p) });
      }
    } else if (nm === 'tsconfig.json' || nm === 'jsconfig.json') {
      try {
        var raw = st.files.get(p).content.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var cfg = JSON.parse(raw), co = cfg.compilerOptions || {};
        var baseUrl = joinPath(dirOf(p), co.baseUrl || '.');
        if (co.paths) Object.keys(co.paths).forEach(function (k) {
          var targets = (co.paths[k] || []).map(function (t) { return joinPath(baseUrl, t.replace(/\/?\*$/, '')); });
          var reStr = '^' + k.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/, '(.*)') + '$';
          idxAlias.push({ re: new RegExp(reStr), targets: targets, star: k.indexOf('*') !== -1 });
        });
      } catch (e) {}
    } else if (nm === 'go.mod') {
      var mm = st.files.get(p).content.match(/^\s*module\s+(\S+)/m);
      if (mm) idxGoModule = mm[1].replace(/\/+$/, '');
    }
  });
  detectPackages(paths).forEach(function (pk) { if (pk.name) idxWorkspace.push({ name: pk.name, dir: pk.dir === '.' ? '' : pk.dir }); });
}
/* try a resolved base against known extensions and index-file conventions */
function resolveCand(cand) {
  if (cand === null || cand === undefined) return null;
  for (var i = 0; i < RESOLVE_EXTS.length; i++) if (st.files.has(cand + RESOLVE_EXTS[i])) return cand + RESOLVE_EXTS[i];
  var idxNames = ['/index', '/mod', '/__init__', '/lib'];
  for (var n = 0; n < idxNames.length; n++)
    for (var j = 1; j < RESOLVE_EXTS.length; j++) if (st.files.has(cand + idxNames[n] + RESOLVE_EXTS[j])) return cand + idxNames[n] + RESOLVE_EXTS[j];
  return null;
}
/* resolve a module specifier to a real loaded path — relative paths, Python
   dotted-relative, tsconfig aliases, Go module prefix, workspace packages.
   Returns null for truly external modules. */
function resolveImport(fromFile, mod) {
  if (!mod) return null;
  var ext = fileExt(fromFile);
  /* package.json "imports" (#alias) — resolved against the nearest ancestor
     package.json that declares an imports map; never falls through */
  if (mod.charAt(0) === '#') {
    var bestDir = null, bestLen = -1;
    Object.keys(idxPkgMeta).forEach(function (d) {
      if (!idxPkgMeta[d].imports) return;
      var dd = d === '.' ? '' : d + '/';
      if ((dd === '' || fromFile.indexOf(dd) === 0) && dd.length > bestLen) { bestDir = d; bestLen = dd.length; }
    });
    if (bestDir !== null) {
      var iv = pickCond(idxPkgMeta[bestDir].imports[mod]);
      if (iv) return resolveCand(joinPath(bestDir === '.' ? '' : bestDir, iv));
    }
    return null;
  }
  /* Python dotted imports: from .mod / from ..pkg.mod / import pkg.mod */
  if (ext === 'py' && mod.indexOf('/') === -1 && /^[.\w]/.test(mod)) {
    if (mod.charAt(0) === '.') {
      var up = 0; while (mod.charAt(up) === '.') up++;
      var baseDir = dirOf(fromFile);
      for (var u = 1; u < up; u++) baseDir = dirOf(baseDir);
      return resolveCand(joinPath(baseDir, mod.slice(up).replace(/\./g, '/')));
    }
    var pr = resolveCand(mod.replace(/\./g, '/')); if (pr) return pr;
  }
  /* Java dotted imports: com.foo.Bar under a source root aligned off the importer's
     own path, then repo root and Maven conventions; `import static a.b.C.m` retries
     with the member segment dropped. */
  if (ext === 'java' && mod.indexOf('.') !== -1 && mod.indexOf('/') === -1) {
    var jsegs = mod.split('.');
    var jroots = [], jdir = dirOf(fromFile) + '/';
    var jcut = jdir.lastIndexOf('/' + jsegs[0] + '/');
    if (jcut !== -1) jroots.push(jdir.slice(0, jcut + 1));
    jroots.push('', 'src/main/java/', 'src/test/java/', 'src/');
    for (var jr = 0; jr < jroots.length; jr++) {
      var jc = resolveCand(jroots[jr] + jsegs.join('/'));
      if (!jc && jsegs.length > 1) jc = resolveCand(jroots[jr] + jsegs.slice(0, -1).join('/'));
      if (jc && jc !== fromFile) return jc;
    }
    return null;
  }
  /* Ruby: require_relative resolves beside the importer; bare require tries the
     repo root and a root-level lib/ (deeper lib dirs are not searched — disclosed). */
  if (ext === 'rb' && mod.charAt(0) !== '.' && mod.charAt(0) !== '/') {
    var rb1 = resolveCand(joinPath(dirOf(fromFile), mod));
    if (rb1 && rb1 !== fromFile) return rb1;
    var rb2 = resolveCand(mod) || resolveCand(joinPath('lib', mod));
    if (rb2 && rb2 !== fromFile) return rb2;
    return null;
  }
  if (mod.charAt(0) === '.' || mod.charAt(0) === '/') {
    var base = mod.charAt(0) === '/' ? '' : dirOf(fromFile);
    return resolveCand(joinPath(base, mod.charAt(0) === '/' ? mod.slice(1) : mod));
  }
  /* Rust: mod foo; resolves beside the file */
  if (ext === 'rs' && /^[A-Za-z_]\w*$/.test(mod)) { var rc = resolveCand(joinPath(dirOf(fromFile), mod)); if (rc) return rc; }
  /* Rust ::-paths: crate:: / self:: / super:: / cross-crate via Cargo.toml names.
     Longest module-path prefix wins (use paths name items, not files); every
     return guards !== fromFile so `use crate::{…}` can't self-edge. */
  if (ext === 'rs' && mod.indexOf('::') !== -1) {
    var segs = mod.replace(/:+$/, '').split('::').filter(Boolean);
    var head = segs.shift(), rbase = null;
    if (head === 'crate') { var cr = crateFor(fromFile); rbase = cr ? joinPath(cr.dir, 'src') : 'src'; }
    else if (head === 'self') { rbase = selfModDir(fromFile); }
    else if (head === 'super') {
      rbase = dirOf(fromFile);
      while (segs.length && segs[0] === 'super') { segs.shift(); rbase = dirOf(rbase); }
    } else {
      for (var ci = 0; ci < idxCrates.length; ci++) if (idxCrates[ci].name === head) { rbase = joinPath(idxCrates[ci].dir, 'src'); break; }
      if (rbase === null) return null; /* std::, serde:: … external */
    }
    for (var rk = segs.length; rk >= 1; rk--) {
      var rcand = resolveCand(joinPath(rbase, segs.slice(0, rk).join('/')));
      if (rcand && rcand !== fromFile) return rcand;
    }
    if (head !== 'crate') { var rlz = resolveCand(rbase); if (rlz && rlz !== fromFile) return rlz; }
    return null;
  }
  /* tsconfig/jsconfig path aliases (@/x, ~/x, etc.) */
  for (var a = 0; a < idxAlias.length; a++) {
    var m = idxAlias[a].re.exec(mod);
    if (!m) continue;
    for (var t = 0; t < idxAlias[a].targets.length; t++) {
      var full = idxAlias[a].star && m[1] ? joinPath(idxAlias[a].targets[t], m[1]) : idxAlias[a].targets[t];
      var rr = resolveCand(full); if (rr) return rr;
    }
  }
  /* Go module-prefix: <module>/pkg/x -> pkg/x inside the repo */
  if (idxGoModule && mod.indexOf(idxGoModule + '/') === 0) { var gr = resolveCand(mod.slice(idxGoModule.length + 1)); if (gr) return gr; }
  /* workspace package: bare 'pkg' or '@scope/pkg[/sub]' -> its dir, honoring the
     package's exports map first, then its main field, then dir/src conventions */
  for (var w = 0; w < idxWorkspace.length; w++) {
    var wp = idxWorkspace[w];
    if (mod === wp.name || mod.indexOf(wp.name + '/') === 0) {
      var sub = mod === wp.name ? '' : mod.slice(wp.name.length + 1);
      var meta = idxPkgMeta[wp.dir === '' ? '.' : wp.dir];
      if (meta && meta.exports) {
        var xt = lookupExports(meta.exports, sub);
        if (xt) { var xr = resolveCand(joinPath(wp.dir, xt)); if (xr) return xr; }
      }
      if (sub === '' && meta && meta.main) { var mr = resolveCand(joinPath(wp.dir, meta.main)); if (mr) return mr; }
      var wr = resolveCand(joinPath(wp.dir, sub)) || resolveCand(joinPath(wp.dir, joinPath('src', sub)));
      if (wr) return wr;
    }
  }
  return null;
}

function buildIndex() {
  var symbols = new Map();      /* name -> [{file, line, kind}] */
  var importsByFile = new Map(); /* file -> [{raw, resolved, line}] */
  var importedBy = new Map();    /* resolvedFile -> [{file, line}] */
  var exportsByFile = new Map(); /* file -> [{name, line, kind}] */
  var todos = [];                /* [{file, line, tag, text}] */
  var envVars = new Map();       /* NAME -> [{file, line}] */
  var symCountByFile = {};       /* file -> definition count */
  var entries = [], tests = [], configs = [], docs = [], byExt = {}, langs = {};
  var csNamespaces = {}, csNsCount = 0; /* C# namespace -> first declaring file */
  var paths = sortedPaths(), symbolCount = 0, importCount = 0;
  buildResolvers(paths);
  var big = paths.length > 1500;

  function recordImport(file, raw, line) {
    var resolved = resolveImport(file, raw);
    (importsByFile.get(file) || (importsByFile.set(file, []), importsByFile.get(file))).push({ raw: raw, resolved: resolved, line: line });
    if (resolved) (importedBy.get(resolved) || (importedBy.set(resolved, []), importedBy.get(resolved))).push({ file: file, line: line });
    importCount++;
  }
  function recordExport(file, name, line, kind) {
    var arr = exportsByFile.get(file) || (exportsByFile.set(file, []), exportsByFile.get(file));
    if (arr.length < EXPORT_FILE_CAP) arr.push({ name: name, line: line, kind: kind });
  }

  paths.forEach(function (p, pi) {
    if (big && pi % 500 === 0) setStatus('INDEXING SYMBOLS — ' + pi + '/' + paths.length + ' files…');
    var f = st.files.get(p);
    var name = p.slice(p.lastIndexOf('/') + 1), ext = fileExt(p);
    byExt[ext || '·'] = (byExt[ext || '·'] || 0) + 1;
    var lang = f.lang || (f.lang = detectLang(p, f.content));
    langs[lang] = (langs[lang] || 0) + 1;
    if (TEST_PATH.test(p)) tests.push(p);
    if (CONFIG_NAMES.test(name)) configs.push(p);
    if (README_NAMES.test(name) || DOCS_PATH.test(p) || /\.(md|mdx|rst)$/i.test(name)) docs.push(p);
    if (ENTRY_NAMES.test(name) && !TEST_PATH.test(p)) entries.push(p);

    var isGo = ext === 'go', inGoImport = false;
    var lines = f.content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (ln.length > 400) continue; /* skip minified/one-liners */

      /* Go import blocks: import ( "a"\n "b" ) — stateful, plus single-line form */
      if (isGo) {
        if (inGoImport) {
          if (/^\s*\)/.test(ln)) inGoImport = false;
          else { var gm = ln.match(/"([^"]+)"/); if (gm) recordImport(p, gm[1], i + 1); }
          continue;
        }
        if (/^\s*import\s*\(/.test(ln)) { inGoImport = true; continue; }
        var gs = ln.match(/^\s*import\s+"([^"]+)"/); if (gs) { recordImport(p, gs[1], i + 1); continue; }
      }

      var md = DEF_DECL_RE.exec(ln), sym = null, kind = null;
      if (md) {
        kind = md[1]; sym = md[2];
        /* Ruby class methods: `def self.helper` captures `self` — take the real name */
        if (ext === 'rb' && sym === 'self') { var mrs = ln.match(/\bdef\s+self\.([A-Za-z_]\w*)/); sym = mrs ? mrs[1] : null; }
      }
      else if (isGo) { var mgo = DEF_GO_METHOD_RE.exec(ln); if (mgo) { kind = 'method'; sym = mgo[1]; } }
      else if (ext === 'java' || ext === 'cs') {
        var mcj = DEF_CJ_METHOD_RE.exec(ln);
        if (mcj) { kind = 'method'; sym = mcj[1]; }
        else if (ext === 'cs') { var mcp = DEF_CS_PROP_RE.exec(ln); if (mcp) { kind = 'property'; sym = mcp[1]; } }
      }
      if (!sym) {
        if (ext === 'py') { var mp = DEF_PY_ASSIGN_RE.exec(ln); if (mp) { kind = 'const'; sym = mp[1]; } }
        else { var ma = DEF_ASSIGN_RE.exec(ln); if (ma) { kind = assignKind(ln); sym = ma[1]; } }
      }
      if (sym && sym.length > 1) {
        var arr = symbols.get(sym) || (symbols.set(sym, []), symbols.get(sym));
        if (arr.length < 200) { arr.push({ file: p, line: i + 1, kind: kind }); symbolCount++; symCountByFile[p] = (symCountByFile[p] || 0) + 1; }
        /* declaration exports, off the definition just matched: JS/TS `export …`,
           Rust `pub …`, Go's uppercase-initial convention, Java/C# `public` */
        if (/^\s*export\b/.test(ln)) recordExport(p, sym, i + 1, kind);
        else if (ext === 'rs' && /^\s*pub\b/.test(ln)) recordExport(p, sym, i + 1, kind);
        else if (isGo && /^[A-Z]/.test(sym)) recordExport(p, sym, i + 1, kind);
        else if ((ext === 'java' || ext === 'cs') && /^\s*public\b/.test(ln)) recordExport(p, sym, i + 1, kind);
      }
      /* Ruby attr declarations: each :name is a public accessor */
      if (ext === 'rb') {
        var mra = DEF_RB_ATTR_RE.exec(ln);
        if (mra) mra[1].split(',').forEach(function (piece) {
          var an = piece.trim().replace(/^:/, '');
          if (an.length > 1) {
            var aArr = symbols.get(an) || (symbols.set(an, []), symbols.get(an));
            if (aArr.length < 200) { aArr.push({ file: p, line: i + 1, kind: 'attr' }); symbolCount++; symCountByFile[p] = (symCountByFile[p] || 0) + 1; }
          }
        });
      }
      /* C# namespace declarations feed using-directive resolution (first file wins) */
      if (ext === 'cs' && csNsCount < 500) {
        var mns = CS_NAMESPACE_RE.exec(ln);
        if (mns && !csNamespaces[mns[1]]) { csNamespaces[mns[1]] = p; csNsCount++; }
      }

      /* non-declaration export forms: export { a, b as c }, module.exports = {…}, exports.x = */
      var eb = EXPORT_BRACES_RE.exec(ln);
      if (eb) {
        (eb[1] || eb[2]).split(',').forEach(function (piece) {
          var nm = piece.trim().split(/\s+as\s+/).pop().split(':')[0].trim();
          if (/^[A-Za-z_$][\w$]*$/.test(nm)) recordExport(p, nm, i + 1, 'named');
        });
      } else {
        var ea = EXPORT_ASSIGN_RE.exec(ln);
        if (ea) recordExport(p, ea[1], i + 1, 'commonjs');
        else if (!sym && /^\s*export\s+default\b/.test(ln)) recordExport(p, 'default', i + 1, 'default');
      }

      /* code-health: TODO-style tags and environment-variable reads */
      if (todos.length < TODO_CAP) {
        var tm = TODO_RE.exec(ln);
        if (tm) todos.push({ file: p, line: i + 1, tag: tm[1], text: ln.trim().slice(0, 120) });
      }
      var em = ENV_RE.exec(ln);
      if (em) {
        var envName = em[1] || em[2] || em[3] || em[4] || em[5] || em[6] || em[7] || em[8];
        if (envName && (envVars.has(envName) || envVars.size < ENV_NAME_CAP)) {
          var evs = envVars.get(envName) || (envVars.set(envName, []), envVars.get(envName));
          if (evs.length < ENV_REF_CAP) evs.push({ file: p, line: i + 1 });
        }
      }

      for (var r = 0; r < IMPORT_RES.length; r++) {
        if (IMPORT_RES[r].lang && !IMPORT_RES[r].lang[lang]) continue;
        var im = IMPORT_RES[r].re.exec(ln);
        if (im) { recordImport(p, im[1], i + 1); break; }
      }
    }
  });

  /* C# fixup: `using Acme.Services;` can't resolve until every namespace is seen —
     patch still-null .cs imports to the namespace's representative (first) file.
     `using Static.Ns.Type` retries with the type segment dropped. */
  importsByFile.forEach(function (list, file) {
    if (fileExt(file) !== 'cs') return;
    list.forEach(function (e) {
      if (e.resolved !== null) return;
      var hit = csNamespaces[e.raw] || csNamespaces[e.raw.replace(/\.[A-Za-z_]\w*$/, '')];
      if (hit && hit !== file) {
        e.resolved = hit;
        (importedBy.get(hit) || (importedBy.set(hit, []), importedBy.get(hit))).push({ file: file, line: e.line });
      }
    });
  });

  return {
    fileCount: paths.length, symbols: symbols, symbolCount: symbolCount, importCount: importCount,
    importsByFile: importsByFile, importedBy: importedBy,
    exportsByFile: exportsByFile, todos: todos, envVars: envVars, symCountByFile: symCountByFile,
    entries: entries, tests: tests, configs: configs, docs: docs,
    byExt: byExt, langs: langs, packages: detectPackages(paths)
  };
}

function getIndex() {
  if (!st.indexDirty && st.projectIndex) return st.projectIndex;
  setStatus('INDEXING — reading project structure…');
  st.projectIndex = buildIndex();
  st.indexDirty = false;
  setStatus('CORE IDLE — ' + st.files.size + ' files in memory');
  return st.projectIndex;
}

export { buildIndex, detectLang, dirOf, fileExt, getIndex };
