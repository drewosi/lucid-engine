import { st } from './state.js';
import { fmtTok, lsGet } from './helpers.js';
import { LS, MODELS } from './config.js';
import { isMulti, repoOf, workspaceNote } from './repos.js';
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

/* null-prototype: keyed by project-supplied extensions — a file named
   `x.constructor` must miss cleanly, not return an inherited function */
var SRC_EXT = Object.assign(Object.create(null), { ts: 9, tsx: 9, js: 9, jsx: 9, mjs: 9, cjs: 9, py: 9, go: 9, rs: 9, java: 8, rb: 8, php: 8, c: 8, h: 8, cc: 8, cpp: 8, hpp: 8, cs: 8, swift: 8, kt: 8, scala: 8, svelte: 9, vue: 9, html: 7, css: 6, scss: 6, less: 6, sql: 7, sh: 7, bash: 7, zsh: 7, md: 8, mdx: 8, rst: 7, txt: 5, json: 5, yml: 6, yaml: 6, toml: 6, xml: 4, ini: 5, cfg: 5, env: 5, graphql: 7, proto: 7, tf: 6, lua: 7, ex: 8, exs: 8, erl: 7, ml: 7, hs: 7, zig: 8, dart: 8, r: 7, jl: 7 });
var CONFIG_NAMES = /^(package\.json|tsconfig[^\/]*\.json|jsconfig\.json|pyproject\.toml|setup\.(py|cfg)|pipfile|go\.(mod|sum)|cargo\.toml|gemfile|mix\.exs|makefile|justfile|dockerfile|docker-compose\.ya?ml|\.env\.example|vite\.config\.[jt]s|webpack\.config\.[jt]s|next\.config\.[jt]s|rollup\.config\.[jt]s|requirements\.txt|composer\.json|build\.gradle(\.kts)?|pom\.xml|[^\/]+\.csproj|[^\/]+\.sln|cmakelists\.txt)$/i;
var ENTRY_NAMES = /^(index|main|__main__|app|server|cli|core|__init__|mod|lib|program|application)\.[a-z]+$/i;
var README_NAMES = /^readme(\.|$)/i;
var LOWVALUE_PATH = /(\.min\.|\.lock$|-lock\.|\.snap$|\.map$|\.d\.ts$|\bfixtures?\b|\b__snapshots__\b|\bmigrations\b|\bgenerated\b)/i;
/* test detection across ecosystems: JS/TS .test/.spec, Go/py _test., Ruby _spec.,
   Python test_*.py prefix, tests/ or spec/ directories, Java FooTest / C# FooTests */
var TEST_PATH = /(\.test\.|\.spec\.|_test\.|_spec\.|\/test_[^\/]*\.py$|\btests?\/|\bspec\/|\b__tests__\b|tests?\.(java|cs|kt|swift|php)$)/i;

/* Token estimate — one function for every count the app shows or budgets.
   Calibrated against the Qwen3.5-9B tokenizer (GPT-style BPE: one token per
   digit, short operator runs, a newline of its own, spaces mostly absorbed
   into the next piece). A flat chars/token divisor undercounted C/C++ because
   those files — and the "123│" line-number prefixes SMART actually sends —
   are full of one-character tokens. The scan below counts that way.
   EST_BIAS_PCT is a deliberate overestimate on top of the scan, not a
   substitute for it. +8% is the pad that kept every measured C/C++ file
   (raw and with the "123│" prefixes SMART sends), plus JS, Python, GDScript
   demos, Markdown and JSON, at or above the Qwen3.5-9B tokenizer. The scan
   already sits high on one-character tokens, so the measured overshoot is
   wider than 8% — especially on C/C++. A larger pad would only have covered
   a few Godot GDScript test scripts with smashed identifiers. The path
   argument is accepted so existing callers keep working; the count comes
   from the text. */
var EST_BIAS_PCT = 108;
/* '$' '{' '}' '@' '|' ':' and tab do not fuse into the following word.
   ':' is the exception that matters: a colon glued to a letter ("m:match",
   ":property") is its own token unless the pair is a very common type name.
   Counting it separate is the high side of that coin-flip. '(' '.' '_' usually fuse. */
var FUSE_BREAK = Object.assign(Object.create(null), { '$': 1, '{': 1, '}': 1, '@': 1, '|': 1, ':': 1, '\t': 1 });
/* endings of long English words that stay one token; a 12+ letter lowercase
   run with none of these is a handle or a smashed identifier */
var COMMON_ENDING = ['tion', 'sion', 'ment', 'ness', 'able', 'ible', 'ence', 'ance', 'ity', 'ing', 'ly', 'ous', 'ive', 'ate', 'ent', 'ant', 'ers', 'ies'];
function isLetterCP(cp) {
  if (cp < 128) return (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
  return cp >= 192 && /\p{L}/u.test(String.fromCharCode(cp));
}
function isUpperCP(cp) {
  if (cp < 128) return cp >= 65 && cp <= 90;
  return /\p{Lu}/u.test(String.fromCharCode(cp));
}
function isLowerCP(cp) {
  if (cp < 128) return cp >= 97 && cp <= 122;
  return /\p{Ll}/u.test(String.fromCharCode(cp));
}
function isDigitCP(cp) {
  if (cp < 128) return cp >= 48 && cp <= 57;
  return /\p{N}/u.test(String.fromCharCode(cp));
}
function commonLongWord(s) {
  for (var i = 0; i < COMMON_ENDING.length; i++) {
    var suf = COMMON_ENDING[i];
    if (s.length >= suf.length && s.slice(-suf.length) === suf) return true;
  }
  return false;
}
function camelParts(s) {
  var parts = [], start = 0, i;
  for (i = 1; i < s.length; i++) {
    var prev = s.charCodeAt(i - 1), cur = s.charCodeAt(i);
    if (isUpperCP(cur) && isLowerCP(prev)) { parts.push(s.slice(start, i)); start = i; }
    else if (isUpperCP(prev) && isLowerCP(cur) && i - start > 1) { parts.push(s.slice(start, i - 1)); start = i - 1; }
  }
  parts.push(s.slice(start));
  return parts;
}
function onePiece(s) {
  var L = s.length, i, hi = false;
  if (!L) return 0;
  for (i = 0; i < L; i++) if (s.charCodeAt(i) > 127) hi = true;
  if (hi) return Math.max(2, (L + 1) >> 1);
  var allUp = true;
  for (i = 0; i < L; i++) if (!isUpperCP(s.charCodeAt(i))) { allUp = false; break; }
  if (L >= 4 && allUp) return Math.max(2, Math.ceil(L / 3));
  var title = L >= 4 && isUpperCP(s.charCodeAt(0));
  if (title) for (i = 1; i < L; i++) if (!isLowerCP(s.charCodeAt(i))) { title = false; break; }
  if (title) return Math.max(2, Math.ceil(L / 3));
  if (L <= 14) return 1;
  return 1 + Math.ceil((L - 14) / 6);
}
function wordYield(leading, letters, dense) {
  var base = 0, parts, i, lower = true;
  if (dense && letters) base = Math.max(1, Math.ceil(letters.length / 3));
  else {
    parts = letters ? camelParts(letters) : [];
    for (i = 0; i < parts.length; i++) base += onePiece(parts[i]);
    if (letters) {
      for (i = 0; i < letters.length; i++) {
        var cp = letters.charCodeAt(i);
        if (cp > 127 || !isLowerCP(cp)) { lower = false; break; }
      }
      if (lower && letters.length >= 12 && !commonLongWord(letters)) base = Math.max(base, Math.ceil(letters.length / 3));
    }
    /* '.' before 4+ letters usually fails to fuse (".else", ".notest", ".gd" is
       shorter and handled as its own miss). '_' before a long run splits too. */
    if (leading === '.' && letters.length >= 4) base++;
    else if (leading === '_' && letters.length >= 8) base++;
  }
  if (leading && (FUSE_BREAK[leading] || leading.charCodeAt(0) > 127 || (dense && leading === '/'))) base++;
  if (base <= 0 && leading) base = 1;
  return letters || leading ? Math.max(1, base) : 0;
}
function punctYield(L) {
  if (L <= 0) return 0;
  if (L <= 3) return 1;
  return Math.ceil(L / 2);
}
/* raw scan, before the bias. One pass, no allocations beyond the words themselves. */
function rawTokens(text) {
  var n = text.length, i = 0, tok = 0, url = false;
  while (i < n) {
    var c = text.charCodeAt(i), ch = text.charAt(i);
    if ((c === 39 || c === 0x2019) && i + 1 < n) {
      var tail = text.slice(i + 1, i + 3).toLowerCase(), sufs = ['re', 've', 'll', 's', 't', 'm', 'd'], hit = 0;
      for (var si = 0; si < sufs.length; si++) {
        var suf = sufs[si];
        if (tail.slice(0, suf.length) === suf) {
          var after = i + 1 + suf.length;
          if (after >= n || !isLetterCP(text.charCodeAt(after))) { tok++; i = after; hit = 1; break; }
        }
      }
      if (hit) continue;
    }
    var lead = '', j = i;
    if (!isLetterCP(c) && c !== 10 && c !== 13 && !isDigitCP(c) && i + 1 < n && isLetterCP(text.charCodeAt(i + 1))) {
      lead = ch; j = i + 1;
    }
    if (j < n && isLetterCP(text.charCodeAt(j))) {
      var k = j;
      while (k < n && isLetterCP(text.charCodeAt(k))) k++;
      tok += wordYield(lead, text.slice(j, k), url || lead === '@');
      i = k;
      continue;
    }
    if (isDigitCP(c)) { tok++; i++; continue; }
    if (c === 32 && i + 1 < n) {
      var ncp = text.charCodeAt(i + 1);
      if (!isLetterCP(ncp) && !isDigitCP(ncp) && ncp !== 32 && ncp !== 9 && ncp !== 10 && ncp !== 13) {
        j = i + 1;
        while (j < n) {
          var pj = text.charCodeAt(j);
          if (isLetterCP(pj) || isDigitCP(pj) || pj === 32 || pj === 9 || pj === 10 || pj === 13) break;
          j++;
        }
        var plen = j - (i + 1), pstart = i + 1, nl = false;
        while (j < n && (text.charCodeAt(j) === 10 || text.charCodeAt(j) === 13)) { j++; nl = true; }
        tok += punctYield(plen) + (nl ? 1 : 0);
        if (text.slice(pstart, pstart + plen).indexOf('://') !== -1) url = true;
        if (nl) url = false;
        i = j;
        continue;
      }
    }
    if (!isLetterCP(c) && !isDigitCP(c) && c !== 32 && c !== 9 && c !== 10 && c !== 13) {
      j = i;
      while (j < n) {
        var qj = text.charCodeAt(j);
        if (isLetterCP(qj) || isDigitCP(qj) || qj === 32 || qj === 9 || qj === 10 || qj === 13) break;
        j++;
      }
      var plen2 = j - i, pstart2 = i, nl2 = false;
      while (j < n && (text.charCodeAt(j) === 10 || text.charCodeAt(j) === 13)) { j++; nl2 = true; }
      tok += punctYield(plen2) + (nl2 ? 1 : 0);
      if (text.slice(pstart2, pstart2 + plen2).indexOf('://') !== -1) url = true;
      if (nl2) url = false;
      i = j;
      continue;
    }
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      url = false;
      j = i;
      var hasNl = false;
      while (j < n) {
        var wj = text.charCodeAt(j);
        if (wj !== 32 && wj !== 9 && wj !== 10 && wj !== 13) break;
        if (wj === 10 || wj === 13) hasNl = true;
        j++;
      }
      if (!hasNl && j < n) {
        var nxt = text.charCodeAt(j);
        if (isLetterCP(nxt) || (!isDigitCP(nxt) && nxt !== 32 && nxt !== 9 && nxt !== 10 && nxt !== 13)) {
          var run = j - i;
          if (run > 1) { tok++; i = j - 1; continue; }
          if (text.charAt(i) === ' ') { i = j; continue; }
          tok++; i = j; continue;
        }
      }
      tok++;
      i = j;
      continue;
    }
    tok++; i++;
  }
  return tok;
}
function estTokens(text, path) {
  if (!text) return 0;
  var raw = rawTokens(text);
  if (!raw) return 0;
  return Math.ceil(raw * EST_BIAS_PCT / 100);
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
  /* provisional char cap, then trim with estTokens so the returned count is
     the same number the budget spends. Digits and the line-number bar are
     about one token each, so 3 chars/token still overshoots and gets trimmed. */
  var out = [], chars = 0, charCap = Math.max(200, maxTokens * 3), last = -1, truncated = false;
  for (var n = 0; n < lines.length; n++) {
    if (!keep[n]) continue;
    if (chars > charCap) { truncated = true; break; }
    if (n > last + 1) out.push('··· lines ' + (last + 2) + '–' + n + ' omitted ···');
    var row = (n + 1) + '│' + lines[n];
    out.push(row); chars += row.length + 1;
    last = n;
  }
  if (truncated || last < lines.length - 1) out.push('··· lines ' + (last + 2) + '–' + lines.length + ' omitted ···');
  var text = out.join('\n'), tokens = estTokens(text, path), guard = 0;
  while (out.length > 1 && tokens > maxTokens && guard++ < out.length + 2) {
    var trailer = out[out.length - 1].indexOf('omitted') !== -1;
    if (trailer && out.length > 2) out.splice(out.length - 2, 1);
    else out.pop();
    text = out.join('\n');
    tokens = estTokens(text, path);
  }
  if (tokens > maxTokens) return { text: '', tokens: maxTokens + 1 };
  return { text: text, tokens: tokens };
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

  /* pass 1 — cheap: static importance + recency + intent + path term hits.
     Each component that fires records a compact why-tag so the preview can say
     in plain language why a file scored in — same data, no second scorer. */
  var scored = paths.map(function (p) {
    var f = st.files.get(p), s = f.base + recRank[p], lp = p.toLowerCase();
    var why = [];
    var name = p.slice(p.lastIndexOf('/') + 1);
    if (f.pin) why.push('pinned');
    if (README_NAMES.test(name)) why.push('readme');
    else if (CONFIG_NAMES.test(name)) why.push('config');
    else if (ENTRY_NAMES.test(name)) why.push('entry');
    if (recRank[p] >= 4.5) why.push('recent');
    var d = p.indexOf('/') === -1 ? '.' : p.slice(0, p.lastIndexOf('/'));
    if (dirM[d] >= hotCut) { s += 3; if (why.indexOf('recent') === -1) why.push('hot dir'); }
    if (wantsTests && TEST_PATH.test(p)) { s += 7; why.push('test boost'); } /* cancels the static -3 and boosts */
    if (wantsDocs && (README_NAMES.test(name) || /\.(md|mdx|rst)$/i.test(p) || DOCS_PATH.test(p))) { s += 5; why.push('docs boost'); }
    var kwPath = 0;
    for (var i = 0; i < terms.length; i++) if (lp.indexOf(terms[i]) !== -1) { s += 30; kwPath++; }
    if (kwPath) why.push('kw in path');
    return { p: p, f: f, s: s, why: why, hits: 0 };
  });
  scored.sort(function (a, b) { return b.s - a.s; });

  /* pass 2 — content hits, but only for the top candidates (lowercase cached lazily) */
  if (terms.length) {
    var scan = Math.min(scored.length, 200);
    for (var si = 0; si < scan; si++) {
      var it = scored[si];
      /* recomputed per scan — memoizing this on the file object converged toward
         a full lowercase copy of the corpus in memory, and could go stale */
      var lc = it.f.content.toLowerCase();
      for (var t = 0; t < terms.length; t++) { var hn = Math.min(countHits(lc, terms[t]), 12); it.s += hn * 2; it.hits += hn; }
      if (it.hits) it.why.push('kw ×' + it.hits);
    }
    scored.sort(function (a, b) { return b.s - a.s; });
  }
  /* several repos in scope: the best-scoring file of every repo is guaranteed a
     slot right after the pins, so a cross-repo question sees each repo */
  var seats = [];
  if (isMulti()) {
    var seen = Object.create(null);
    scored.forEach(function (x) { var r = repoOf(x.p); if (!seen[r] && !x.f.pin) { seen[r] = 1; seats.push(x); } });
    if (seats.length < 2) seats = [];
    seats.forEach(function (x) { x.why.push('best in repo'); });
  }
  /* operator pins pack first (still budget-bounded) — the one explicit override */
  var pinnedFirst = scored.filter(function (x) { return x.f.pin; })
    .concat(seats)
    .concat(scored.filter(function (x) { return !x.f.pin && seats.indexOf(x) === -1; }));

  /* greedy pack: whole small files, excerpts for big ones */
  var parts = [], used = 0, count = 0, included = [], packedSet = Object.create(null);
  for (var k = 0; k < pinnedFirst.length && count < SMART_MAX_FILES; k++) {
    var remaining = budgetTokens - used;
    if (remaining < 400) break;
    var e = pinnedFirst[k], body = null, tok, whole;
    if (e.f.tokens <= WHOLE_FILE_MAX && e.f.tokens <= remaining) {
      /* count what is sent (header + line-number prefixes), not the bare file */
      body = numberLines(e.f.content, 1); tok = estTokens('═══ FILE: ' + e.p + ' ═══\n' + body, e.p); whole = true;
      if (tok > remaining) body = null;
    }
    if (body === null) {
      var ex = excerptFile(e.f, terms, Math.min(remaining, Math.max(1500, WHOLE_FILE_MAX / 2)), e.p);
      if (ex.tokens > remaining) continue;
      body = ex.text; tok = ex.tokens; whole = false;
    }
    parts.push('═══ FILE: ' + e.p + ' ═══\n' + body);
    included.push({ p: e.p, tok: tok, whole: whole, why: e.why });
    packedSet[e.p] = 1;
    used += tok; count++;
  }
  /* the top scorers that did NOT fit — so exclusion is explicit, never implied */
  var notPacked = [];
  for (var m = 0; m < scored.length && notPacked.length < 8; m++) {
    if (!packedSet[scored[m].p]) notPacked.push({ p: scored[m].p, s: Math.round(scored[m].s), tok: scored[m].f.tokens });
  }
  return { text: parts.join('\n\n'), count: count, total: paths.length, tokens: used, included: included, notPacked: notPacked };
}

/* PROJECT MAP — full shape of the project in few tokens; cached until context changes */

/* monorepo awareness: a "package" is any directory holding a build manifest */
var MANIFEST_RE = /^(package\.json|cargo\.toml|pyproject\.toml|go\.mod|composer\.json|build\.gradle(\.kts)?|pom\.xml|gemfile|mix\.exs|[^\/]+\.csproj)$/i;
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
      else if (/\.csproj$/i.test(name)) { label = name.replace(/\.csproj$/i, ''); }
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
    var hd = (d === '.' ? './' : d + '/') + (pkg ? '  ◆ PACKAGE' + (pkg.name ? ': ' + pkg.name : '') : '');
    if (collapse && list.length > 8 && !pkg) {
      var tot = 0;
      list.forEach(function (p) { tot += st.files.get(p).tokens; });
      var top = list.slice().sort(function (a, b) { return st.files.get(b).base - st.files.get(a).base; })
        .slice(0, 3).map(function (p) { return p.slice(p.lastIndexOf('/') + 1); });
      out.push(d + '/: ' + list.length + ' files ≈' + fmtTok(tot) + ' tok (incl. ' + top.join(', ') + ')');
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
  var wn = workspaceNote();
  st.mapCache = (wn ? wn + '\n\n' : '') + 'PROJECT MAP: the full shape of the loaded project (' + paths.length + ' files, path ≈tokens). "◆ PACKAGE" marks a directory with its own build manifest; "◇" marks manifests, READMEs and entry points. Only a question-relevant subset of files is included in full after the map. If a mapped file you cannot see would answer better, say which one.\n\n'
    + out.join('\n') + (keyTxt.length ? '\n\n' + keyTxt.join('\n\n') : '');
  st.mapDirty = false;
  return st.mapCache;
}

/* the map within a token cap: the full map when it fits, otherwise a condensed
   one (directories collapsed to a shallower depth, then key-file heads dropped,
   then the listing capped). Deterministic for a given project + cap, so the
   cached-prefix behavior of the map block is kept. */
var MAP_MAX_FRAC = 0.2; /* share of the SMART budget the project map may use */
var fitMemo = { src: null, cap: 0, out: '' };
function fitProjectMap(maxTok) {
  var full = buildProjectMap();
  if (!full || estTokens(full) <= maxTok) return full;
  if (fitMemo.src === full && fitMemo.cap === maxTok) return fitMemo.out;
  var paths = [];
  st.files.forEach(function (f, p) { if (f.checked) paths.push(p); });
  paths.sort();
  var pkgs = detectPackages(paths), pkgByDir = {};
  pkgs.forEach(function (pk) { pkgByDir[pk.dir] = pk; });
  var heads = [], keys = pickKeyFiles(paths, pkgs);
  keys.slice(0, 3).forEach(function (p) {
    var lines = st.files.get(p).content.split('\n'), n = Math.min(20, lines.length);
    heads.push('--- KEY FILE HEAD (first ' + n + ' of ' + lines.length + ' lines): ' + p + ' ---\n' + numberLines(lines.slice(0, n).join('\n'), 1));
  });
  var wn = workspaceNote();
  function render(depth, withHeads, maxRows) {
    var agg = Object.create(null);
    paths.forEach(function (p) {
      var segs = p.split('/'); segs.pop();
      var key = segs.slice(0, depth).join('/') || '.';
      var g = agg[key] || (agg[key] = { files: 0, tok: 0, subs: Object.create(null) });
      g.files++; g.tok += st.files.get(p).tokens;
      if (segs.length > depth) g.subs[segs[depth]] = 1;
    });
    var rows = Object.keys(agg).sort(), hidden = null;
    if (rows.length > maxRows) {
      var keep = rows.slice().sort(function (a, b) { return agg[b].files - agg[a].files; }).slice(0, maxRows), kept = Object.create(null);
      keep.forEach(function (k) { kept[k] = 1; });
      hidden = { dirs: 0, files: 0 };
      rows = rows.filter(function (k) { if (kept[k]) return true; hidden.dirs++; hidden.files += agg[k].files; return false; });
    }
    var out = rows.map(function (k) {
      var g = agg[k], ns = Object.keys(g.subs).length, pkg = pkgByDir[k];
      return (k === '.' ? './' : k + '/') + '  ' + g.files + ' file' + (g.files === 1 ? '' : 's') + ' ≈' + fmtTok(g.tok) + ' tok'
        + (ns ? ' · ' + ns + ' subdir' + (ns === 1 ? '' : 's') : '') + (pkg ? '  ◆ PACKAGE' + (pkg.name ? ': ' + pkg.name : '') : '');
    });
    if (hidden) out.push('… ' + hidden.dirs + ' smaller directories (' + hidden.files + ' files) not listed');
    return (wn ? wn + '\n\n' : '') + 'PROJECT MAP (condensed): ' + paths.length + ' files is too many to list within the context budget, so directories are collapsed to '
      + depth + ' level' + (depth === 1 ? '' : 's') + ' deep (directory ≈tokens · file count). "◆ PACKAGE" marks a directory with its own build manifest. Only a question-relevant subset of files is included in full after the map. If a directory you cannot see would answer better, say which one.\n\n'
      + out.join('\n') + (withHeads && heads.length ? '\n\n' + heads.join('\n\n') : '');
  }
  var ladder = [[3, true, 400], [2, true, 400], [1, true, 400], [2, false, 200], [1, false, 200], [1, false, 80], [1, false, 30], [1, false, 10]];
  var best = '';
  for (var i = 0; i < ladder.length; i++) {
    best = render(ladder[i][0], ladder[i][1], ladder[i][2]);
    if (estTokens(best) <= maxTok) break;
  }
  fitMemo = { src: full, cap: maxTok, out: best };
  return best;
}
function getBudget() {
  var cap = MODELS[st.model] ? MODELS[st.model].ctx : 200000;
  var v = parseInt(lsGet(LS.ctxbudget), 10);
  if (!v || v < 4000) v = Math.min(Math.floor(cap * 0.4), SMART_DEFAULT_BUDGET);
  return Math.min(v, cap);
}

export { AUTO_SMART_FRAC, CONFIG_NAMES, DOCS_PATH, ENTRY_NAMES, GROUND_EXCERPT_PAD, GROUND_EXCERPT_TOK, GROUND_MAX_CITES, GROUND_MAX_EVIDENCE, GROUND_MAX_TOK, MAP_MAX_FRAC, README_NAMES, TEST_PATH, buildProjectMap, detectPackages, estTokens, fitProjectMap, getBudget, numberLines, packSmartContext, queryTerms, staticScore };
