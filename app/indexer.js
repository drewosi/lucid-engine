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
/* declarations across JS/TS, Python, Go (top-level func), Rust (pub/mod), Java-ish */
var DEF_DECL_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:pub(?:\([^)]*\))?\s+|public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+)*(?:async\s+)?(function\*?|class|interface|type|struct|enum|trait|impl|def|fn|func|module|mod|const|let|var|sub|proc)\s+([A-Za-z_$][\w$]*)/;
var DEF_ASSIGN_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:const|let|var|public|private|protected|static|readonly)?\s*([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?(?:function\*?\b|\([^()]*\)\s*(?::[^={]+)?=>|class\b|\([^)]*\)\s*\{)/;
var DEF_GO_METHOD_RE = /^\s*func\s*\([^)]*\)\s*([A-Za-z_]\w*)/;       /* Go receiver methods: func (r *R) M() */
var DEF_PY_ASSIGN_RE = /^([A-Za-z_]\w*)\s*(?::[^=\n]+)?=(?!=)\s*\S/;  /* Python module-level NAME = … (no indent, not ==) */
function assignKind(ln) {
  if (/=>\s*/.test(ln) && /\([^()]*\)\s*(?::[^={]+)?=>/.test(ln)) return 'arrow';
  if (/\bclass\b/.test(ln)) return 'class';
  if (/\bfunction\b/.test(ln)) return 'function';
  return 'const';
}
var IMPORT_RES = [
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/,                      /* dynamic import('m') — check before static */
  /\bimport\s+(?:[\w${},*\s]+\s+from\s+)?['"]([^'"]+)['"]/,     /* import x from 'm' | import 'm' */
  /\bexport\s+(?:[\w${},*\s]+)\s+from\s+['"]([^'"]+)['"]/,      /* export … from 'm' */
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/,                        /* require('m') */
  /^\s*(?:pub\s+)?use\s+([A-Za-z_][\w:]*)/,                     /* rust: use crate::a::b */
  /^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/,                    /* rust: mod foo; */
  /^\s*from\s+([.\w]+)\s+import\b/,                             /* py: from m import … (incl. relative) */
  /^\s*import\s+([\w.]+)/                                       /* py: import m */
];
var RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb', '.php', '.java', '.vue', '.svelte'];
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
function joinPath(a, b) {
  var parts = (a ? a.split('/') : []).concat(b ? b.split('/') : []), stack = [];
  parts.forEach(function (s) { if (s === '' || s === '.') return; if (s === '..') stack.pop(); else stack.push(s); });
  return stack.join('/');
}
function buildResolvers(paths) {
  idxAlias = []; idxGoModule = ''; idxWorkspace = [];
  paths.forEach(function (p) {
    var nm = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
    if (nm === 'tsconfig.json' || nm === 'jsconfig.json') {
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
  if (mod.charAt(0) === '.' || mod.charAt(0) === '/') {
    var base = mod.charAt(0) === '/' ? '' : dirOf(fromFile);
    return resolveCand(joinPath(base, mod.charAt(0) === '/' ? mod.slice(1) : mod));
  }
  /* Rust: mod foo; resolves beside the file */
  if (ext === 'rs' && /^[A-Za-z_]\w*$/.test(mod)) { var rc = resolveCand(joinPath(dirOf(fromFile), mod)); if (rc) return rc; }
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
  /* workspace package: bare 'pkg' or '@scope/pkg[/sub]' -> its dir */
  for (var w = 0; w < idxWorkspace.length; w++) {
    var wp = idxWorkspace[w];
    if (mod === wp.name || mod.indexOf(wp.name + '/') === 0) {
      var sub = mod === wp.name ? '' : mod.slice(wp.name.length + 1);
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
      if (md) { kind = md[1]; sym = md[2]; }
      else if (isGo) { var mgo = DEF_GO_METHOD_RE.exec(ln); if (mgo) { kind = 'method'; sym = mgo[1]; } }
      if (!sym) {
        if (ext === 'py') { var mp = DEF_PY_ASSIGN_RE.exec(ln); if (mp) { kind = 'const'; sym = mp[1]; } }
        else { var ma = DEF_ASSIGN_RE.exec(ln); if (ma) { kind = assignKind(ln); sym = ma[1]; } }
      }
      if (sym && sym.length > 1) {
        var arr = symbols.get(sym) || (symbols.set(sym, []), symbols.get(sym));
        if (arr.length < 200) { arr.push({ file: p, line: i + 1, kind: kind }); symbolCount++; symCountByFile[p] = (symCountByFile[p] || 0) + 1; }
        /* declaration exports, off the definition just matched: JS/TS `export …`,
           Rust `pub …`, Go's uppercase-initial convention */
        if (/^\s*export\b/.test(ln)) recordExport(p, sym, i + 1, kind);
        else if (ext === 'rs' && /^\s*pub\b/.test(ln)) recordExport(p, sym, i + 1, kind);
        else if (isGo && /^[A-Z]/.test(sym)) recordExport(p, sym, i + 1, kind);
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
        var im = IMPORT_RES[r].exec(ln);
        if (im) { recordImport(p, im[1], i + 1); break; }
      }
    }
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
