import { st } from './state.js';
import { fmtTok, lsGet } from './helpers.js';
import { LS, MODELS } from './config.js';
/* ============ SMART CONTEXT ENGINE ============
   Instead of sending every checked file whole (FULL mode), SMART mode:
     1. scores each file — type weight + recency + path depth + query relevance,
     2. always sends a compact PROJECT MAP (tree + key-file heads) so the model
        sees the whole project's shape,
     3. greedily packs the highest-scoring files into a token budget; files too
        large to send whole are excerpted with their TRUE line numbers kept, so
        evidence citations stay verifiable in the viewer.                      */

var SMART_DEFAULT_BUDGET = 120000; /* tokens per question, before user override */
var WHOLE_FILE_MAX = 12000;        /* files above this many tokens get excerpted */
var SMART_MAX_FILES = 60;          /* max files packed into one request */
var AUTO_SMART_FRAC = 0.7;         /* auto-enable smart above this fraction of model ctx */

/* Phase 2: budgets for the grounding evidence pack. The model reasons on findings
   plus a few high-value line-true excerpts — never the whole repo. Enforced in
   serializeInvestigationContext and subtracted from the smart-context budget so
   grounding + selected files stay within one ceiling. */
var GROUND_MAX_EVIDENCE = 8;      /* source excerpts carried whole in the pack */
var GROUND_EXCERPT_TOK  = 700;    /* per-excerpt token cap */
var GROUND_MAX_TOK      = 18000;  /* hard cap on the entire grounding pack */
var GROUND_MAX_CITES    = 40;     /* citation-only lines for evidence past the excerpt cap */
var GROUND_EXCERPT_PAD  = 6;      /* lines of context padded around a single-line hit */

var SRC_EXT = { ts: 9, tsx: 9, js: 9, jsx: 9, mjs: 9, cjs: 9, py: 9, go: 9, rs: 9, java: 8, rb: 8, php: 8, c: 8, h: 8, cc: 8, cpp: 8, hpp: 8, cs: 8, swift: 8, kt: 8, scala: 8, svelte: 9, vue: 9, html: 7, css: 6, scss: 6, less: 6, sql: 7, sh: 7, bash: 7, zsh: 7, md: 8, mdx: 8, rst: 7, txt: 5, json: 5, yml: 6, yaml: 6, toml: 6, xml: 4, ini: 5, cfg: 5, env: 5, graphql: 7, proto: 7, tf: 6, lua: 7, ex: 8, exs: 8, erl: 7, ml: 7, hs: 7, zig: 8, dart: 8, r: 7, jl: 7 };
var CONFIG_NAMES = /^(package\.json|tsconfig[^\/]*\.json|jsconfig\.json|pyproject\.toml|setup\.(py|cfg)|pipfile|go\.(mod|sum)|cargo\.toml|gemfile|mix\.exs|makefile|justfile|dockerfile|docker-compose\.ya?ml|\.env\.example|vite\.config\.[jt]s|webpack\.config\.[jt]s|next\.config\.[jt]s|rollup\.config\.[jt]s|requirements\.txt|composer\.json|build\.gradle(\.kts)?|pom\.xml|[^\/]+\.csproj|[^\/]+\.sln|cmakelists\.txt)$/i;
var ENTRY_NAMES = /^(index|main|__main__|app|server|cli|core|__init__|mod|lib)\.[a-z]+$/i;
var README_NAMES = /^readme(\.|$)/i;
var LOWVALUE_PATH = /(\.min\.|\.lock$|-lock\.|\.snap$|\.map$|\.d\.ts$|\bfixtures?\b|\b__snapshots__\b|\bmigrations\b|\bgenerated\b)/i;
/* test detection across ecosystems: JS/TS .test/.spec, Go/py _test., Ruby _spec.,
   Python test_*.py prefix, and tests/ or spec/ directories */
var TEST_PATH = /(\.test\.|\.spec\.|_test\.|_spec\.|\/test_[^\/]*\.py$|\btests?\/|\bspec\/|\b__tests__\b)/i;

/* language-aware token estimate — code tokenizes denser than prose, so one
   chars-per-token divisor per family beats a flat /4 */
var TOK_DIV = { js: 3.2, jsx: 3.2, ts: 3.2, tsx: 3.2, mjs: 3.2, cjs: 3.2, java: 3.2, c: 3.2, h: 3.2, cc: 3.2, cpp: 3.2, hpp: 3.2, cs: 3.2, rs: 3.2, swift: 3.2, kt: 3.2, scala: 3.2,
                py: 3.5, go: 3.5, rb: 3.5, php: 3.5, sh: 3.5, bash: 3.5, lua: 3.5, ex: 3.5, exs: 3.5,
                json: 3.0, yml: 3.0, yaml: 3.0, toml: 3.0, xml: 3.0, html: 3.0, css: 3.0, scss: 3.0, less: 3.0, svg: 3.0,
                md: 4.0, mdx: 4.0, txt: 4.0, rst: 4.0 };
function tokDiv(path) {
  if (path) {
    var nm = path.slice(path.lastIndexOf('/') + 1);
    var ex = nm.indexOf('.') === -1 ? '' : nm.slice(nm.lastIndexOf('.') + 1).toLowerCase();
    if (TOK_DIV[ex]) return TOK_DIV[ex];
  }
  return 3.6;
}
/* Token estimate. For small files a token-ish regex count tracks real BPE more
   closely than chars/divisor; for large files chars/divisor is faster and the
   per-language divisor is well-calibrated (see README calibration note). */
function estTokens(text, path) {
  var byChar = Math.ceil(text.length / tokDiv(path));
  if (text.length < 5000) {
    var byTok = (text.match(/\w+|[^\s\w]/g) || []).length;
    return Math.ceil((byChar + byTok) / 2);
  }
  return byChar;
}

/* query-independent importance, computed once per file at ingest */
function staticScore(path) {
  var name = path.slice(path.lastIndexOf('/') + 1);
  var ext = name.indexOf('.') === -1 ? '' : name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  var s = SRC_EXT[ext] || 2;
  if (CONFIG_NAMES.test(name)) s += 6;
  if (README_NAMES.test(name)) s += 7;
  if (ENTRY_NAMES.test(name)) s += 4;
  if (TEST_PATH.test(path)) s -= 3;
  if (LOWVALUE_PATH.test(path)) s -= 6;
  s -= Math.min(4, path.split('/').length - 1); /* mild depth penalty */
  return s;
}

var STOPWORDS = { the: 1, and: 1, for: 1, with: 1, this: 1, that: 1, are: 1, was: 1, does: 1, how: 1, what: 1, where: 1, why: 1, when: 1, which: 1, who: 1, can: 1, could: 1, would: 1, should: 1, you: 1, from: 1, into: 1, about: 1, file: 1, files: 1, code: 1, project: 1, please: 1, explain: 1, show: 1, tell: 1, work: 1, works: 1, use: 1, used: 1, using: 1, not: 1, all: 1, any: 1, here: 1 };
function queryTerms(q) {
  var seen = {}, out = [];
  var words = q.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
  words.forEach(function (w) { if (!STOPWORDS[w] && !seen[w]) { seen[w] = 1; out.push(w); } });
  return out.slice(0, 12);
}

function countHits(hay, needle) {
  var n = 0, i = 0;
  while (n < 20 && (i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function numberLines(text, startLineNo) {
  return text.split('\n').map(function (ln, i) { return (startLineNo + i) + '│' + ln; }).join('\n');
}

/* Line-number-true excerpt: file head + windows around query-term hits.
   Omitted ranges are marked so the model never cites lines it cannot see. */
function excerptFile(f, terms, maxTokens, path) {
  var div = tokDiv(path);
  var lines = f.content.split('\n');
  var keep = {}, HEAD = 50, WIN = 20, hits = 0, i;
  for (i = 0; i < Math.min(HEAD, lines.length); i++) keep[i] = 1;
  if (terms.length) {
    for (var li = HEAD; li < lines.length && hits < 8; li++) {
      var ll = lines[li].toLowerCase();
      for (var ti = 0; ti < terms.length; ti++) {
        if (ll.indexOf(terms[ti]) !== -1) {
          hits++;
          var hi = Math.min(lines.length - 1, li + WIN);
          for (var w = Math.max(0, li - WIN); w <= hi; w++) keep[w] = 1;
          li += WIN; /* jump ahead so clustered hits share one window */
          break;
        }
      }
    }
  }
  var out = [], chars = 0, budget = maxTokens * div, last = -1, truncated = false;
  for (var n = 0; n < lines.length; n++) {
    if (!keep[n]) continue;
    if (chars > budget) { truncated = true; break; }
    if (n > last + 1) out.push('··· lines ' + (last + 2) + '–' + n + ' omitted ···');
    var row = (n + 1) + '│' + lines[n];
    out.push(row); chars += row.length + 1;
    last = n;
  }
  if (truncated || last < lines.length - 1) out.push('··· lines ' + (last + 2) + '–' + lines.length + ' omitted ···');
  return { text: out.join('\n'), tokens: Math.ceil(chars / div) + 10 };
}

/* query intent — a debugging question wants tests; an onboarding question wants docs */
var DEBUG_RE = /\b(bug|bugs|error|errors|fix|fixes|fail|fails|failing|failure|crash|crashes|broken|debug|exception|traceback|stack\s?trace|regression|flaky)\b/i;
var ONBOARD_RE = /\b(overview|architecture|structure|onboard|onboarding|getting\s+started|introduction|intro|explain|understand|learn|documentation|docs|readme|tour|walkthrough)\b/i;
var DOCS_PATH = /(^|\/)docs?\//i;

/* Score all checked files against the question and pack the winners into the budget. */
function packSmartContext(q, budgetTokens) {
  var terms = queryTerms(q);
  var wantsTests = DEBUG_RE.test(q), wantsDocs = ONBOARD_RE.test(q);
  var paths = [];
  st.files.forEach(function (f, p) { if (f.checked) paths.push(p); });
  if (!paths.length) return { text: '', count: 0, total: 0, tokens: 0 };

  /* recency: rank-normalized mtime, worth up to 6 points */
  var byM = paths.slice().sort(function (a, b) { return st.files.get(a).mtime - st.files.get(b).mtime; });
  var recRank = {};
  byM.forEach(function (p, i) { recRank[p] = byM.length > 1 ? (i / (byM.length - 1)) * 6 : 3; });

  /* directory recency: files living in recently-touched directories get a boost,
     so active work areas surface even when an individual file is old */
  var dirM = {};
  paths.forEach(function (p) {
    var d = p.indexOf('/') === -1 ? '.' : p.slice(0, p.lastIndexOf('/'));
    var m = st.files.get(p).mtime;
    if (!(d in dirM) || m > dirM[d]) dirM[d] = m;
  });
  var dirVals = Object.keys(dirM).map(function (d) { return dirM[d]; }).sort(function (a, b) { return a - b; });
  var hotCut = dirVals.length > 3 ? dirVals[Math.floor(dirVals.length * 0.75)] : Infinity;

  /* pass 1 — cheap: static importance + recency + intent + path term hits */
  var scored = paths.map(function (p) {
    var f = st.files.get(p), s = f.base + recRank[p], lp = p.toLowerCase();
    var d = p.indexOf('/') === -1 ? '.' : p.slice(0, p.lastIndexOf('/'));
    if (dirM[d] >= hotCut) s += 3;
    if (wantsTests && TEST_PATH.test(p)) s += 7; /* cancels the static -3 and boosts */
    if (wantsDocs && (README_NAMES.test(p.slice(p.lastIndexOf('/') + 1)) || /\.(md|mdx|rst)$/i.test(p) || DOCS_PATH.test(p))) s += 5;
    for (var i = 0; i < terms.length; i++) if (lp.indexOf(terms[i]) !== -1) s += 30;
    return { p: p, f: f, s: s };
  });
  scored.sort(function (a, b) { return b.s - a.s; });

  /* pass 2 — content hits, but only for the top candidates (lowercase cached lazily) */
  if (terms.length) {
    var scan = Math.min(scored.length, 200);
    for (var si = 0; si < scan; si++) {
      var it = scored[si];
      if (it.f.lc === undefined) it.f.lc = it.f.content.toLowerCase();
      for (var t = 0; t < terms.length; t++) it.s += Math.min(countHits(it.f.lc, terms[t]), 12) * 2;
    }
    scored.sort(function (a, b) { return b.s - a.s; });
  }

  /* greedy pack: whole small files, excerpts for big ones */
  var parts = [], used = 0, count = 0, included = [];
  for (var k = 0; k < scored.length && count < SMART_MAX_FILES; k++) {
    var remaining = budgetTokens - used;
    if (remaining < 400) break;
    var e = scored[k], body, tok, whole;
    if (e.f.tokens <= WHOLE_FILE_MAX && e.f.tokens <= remaining) {
      body = numberLines(e.f.content, 1); tok = e.f.tokens; whole = true;
    } else {
      var ex = excerptFile(e.f, terms, Math.min(remaining, Math.max(1500, WHOLE_FILE_MAX / 2)), e.p);
      if (ex.tokens > remaining) continue;
      body = ex.text; tok = ex.tokens; whole = false;
    }
    parts.push('═══ FILE: ' + e.p + ' ═══\n' + body);
    included.push({ p: e.p, tok: tok, whole: whole });
    used += tok; count++;
  }
  return { text: parts.join('\n\n'), count: count, total: paths.length, tokens: used, included: included };
}

/* PROJECT MAP — full shape of the project in few tokens; cached until context changes */

/* monorepo awareness: a "package" is any directory holding a build manifest */
var MANIFEST_RE = /^(package\.json|cargo\.toml|pyproject\.toml|go\.mod|composer\.json|build\.gradle(\.kts)?|pom\.xml|gemfile|mix\.exs)$/i;
function detectPackages(paths) {
  var byDir = {};
  paths.forEach(function (p) {
    var name = p.slice(p.lastIndexOf('/') + 1);
    if (!MANIFEST_RE.test(name)) return;
    var dir = p.indexOf('/') === -1 ? '.' : p.slice(0, p.lastIndexOf('/'));
    if (byDir[dir]) return; /* one manifest per dir is enough */
    var label = '', f = st.files.get(p), m;
    if (f) {
      if (/(package|composer)\.json$/i.test(name)) { m = f.content.match(/"name"\s*:\s*"([^"]+)"/); if (m) label = m[1]; }
      else if (/\.(toml)$/i.test(name)) { m = f.content.match(/^\s*name\s*=\s*["']([^"']+)["']/m); if (m) label = m[1]; }
      else if (/go\.mod$/i.test(name)) { m = f.content.match(/^module\s+(\S+)/m); if (m) label = m[1]; }
      else if (/pom\.xml$/i.test(name)) { m = f.content.match(/<artifactId>([^<]+)<\/artifactId>/); if (m) label = m[1]; }
      else if (/mix\.exs$/i.test(name)) { m = f.content.match(/app:\s*:(\w+)/); if (m) label = m[1]; }
    }
    byDir[dir] = { dir: dir, manifest: p, name: label };
  });
  return Object.keys(byDir).sort().map(function (d) { return byDir[d]; });
}

function pickKeyFiles(paths, pkgs) {
  var picks = [];
  function add(p) { if (p && picks.indexOf(p) === -1) picks.push(p); }
  function firstMatch(re) {
    var best = null, bestDepth = 99;
    paths.forEach(function (p) {
      var name = p.slice(p.lastIndexOf('/') + 1), d = p.split('/').length;
      if (re.test(name) && d < bestDepth && picks.indexOf(p) === -1) { best = p; bestDepth = d; }
    });
    return best;
  }
  add(firstMatch(README_NAMES));
  add(firstMatch(/^(package\.json|pyproject\.toml|go\.mod|cargo\.toml|composer\.json)$/i));
  add(firstMatch(ENTRY_NAMES));
  /* monorepo: also head the manifests of the largest sub-packages */
  var subs = (pkgs || []).filter(function (pk) { return pk.dir !== '.' && picks.indexOf(pk.manifest) === -1; });
  if (subs.length > 1) {
    subs.forEach(function (pk) {
      pk.tok = 0;
      var prefix = pk.dir + '/';
      paths.forEach(function (p) { if (p.indexOf(prefix) === 0) pk.tok += st.files.get(p).tokens; });
    });
    subs.sort(function (a, b) { return b.tok - a.tok; });
    subs.slice(0, 3).forEach(function (pk) { add(pk.manifest); });
  }
  return picks.slice(0, 6);
}

st.mapDirty = true; st.mapCache = '';
function buildProjectMap() {
  if (!st.mapDirty) return st.mapCache;
  var paths = [];
  st.files.forEach(function (f, p) { if (f.checked) paths.push(p); });
  paths.sort();
  if (!paths.length) { st.mapCache = ''; st.mapDirty = false; return ''; }
  var pkgs = detectPackages(paths);
  var pkgByDir = {};
  pkgs.forEach(function (pk) { pkgByDir[pk.dir] = pk; });
  var byDir = {};
  paths.forEach(function (p) {
    var dir = p.indexOf('/') === -1 ? '.' : p.slice(0, p.lastIndexOf('/'));
    (byDir[dir] = byDir[dir] || []).push(p);
  });
  var out = [], collapse = paths.length > 400;
  Object.keys(byDir).sort().forEach(function (d) {
    var list = byDir[d];
    var pkg = pkgByDir[d];
    var hd = (d === '.' ? './' : d + '/') + (pkg ? '  ◆ PACKAGE' + (pkg.name ? ' — ' + pkg.name : '') : '');
    if (collapse && list.length > 8 && !pkg) {
      var tot = 0;
      list.forEach(function (p) { tot += st.files.get(p).tokens; });
      var top = list.slice().sort(function (a, b) { return st.files.get(b).base - st.files.get(a).base; })
        .slice(0, 3).map(function (p) { return p.slice(p.lastIndexOf('/') + 1); });
      out.push(d + '/ — ' + list.length + ' files ≈' + fmtTok(tot) + ' tok (incl. ' + top.join(', ') + ')');
    } else {
      out.push(hd);
      list.forEach(function (p) {
        var nm = p.slice(p.lastIndexOf('/') + 1);
        var mark = MANIFEST_RE.test(nm) || README_NAMES.test(nm) || ENTRY_NAMES.test(nm) ? ' ◇' : '';
        out.push('  ' + nm + ' ≈' + fmtTok(st.files.get(p).tokens) + mark);
      });
    }
  });
  var keyTxt = [];
  var keys = pickKeyFiles(paths, pkgs);
  var headLen = keys.length > 3 ? 30 : 40; /* more heads → shorter heads, map stays lean */
  keys.forEach(function (p) {
    var f = st.files.get(p), lines = f.content.split('\n');
    var n = Math.min(headLen, lines.length);
    keyTxt.push('--- KEY FILE HEAD (' + (lines.length > n ? 'first ' + n + ' of ' + lines.length + ' lines' : n + ' lines') + '): ' + p + ' ---\n'
      + numberLines(lines.slice(0, n).join('\n'), 1));
  });
  st.mapCache = 'PROJECT MAP — the full shape of the loaded project (' + paths.length + ' files, path ≈tokens). "◆ PACKAGE" marks a directory with its own build manifest; "◇" marks manifests, READMEs and entry points. Only a question-relevant subset of files is included in full after the map. If a mapped file you cannot see would answer better, say which one.\n\n'
    + out.join('\n') + (keyTxt.length ? '\n\n' + keyTxt.join('\n\n') : '');
  st.mapDirty = false;
  return st.mapCache;
}
function getBudget() {
  var cap = MODELS[st.model] ? MODELS[st.model].ctx : 200000;
  var v = parseInt(lsGet(LS.ctxbudget), 10);
  if (!v || v < 4000) v = Math.min(Math.floor(cap * 0.4), SMART_DEFAULT_BUDGET);
  return Math.min(v, cap);
}

export { AUTO_SMART_FRAC, CONFIG_NAMES, DOCS_PATH, ENTRY_NAMES, GROUND_EXCERPT_PAD, GROUND_EXCERPT_TOK, GROUND_MAX_CITES, GROUND_MAX_EVIDENCE, GROUND_MAX_TOK, README_NAMES, TEST_PATH, buildProjectMap, detectPackages, estTokens, getBudget, numberLines, packSmartContext, queryTerms, staticScore };
