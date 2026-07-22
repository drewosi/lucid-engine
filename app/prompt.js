import { sortedPaths, st } from './state.js';
import { GROUND_EXCERPT_PAD, GROUND_EXCERPT_TOK, GROUND_MAX_CITES, GROUND_MAX_EVIDENCE, GROUND_MAX_TOK, buildProjectMap, estTokens, getBudget, numberLines, packSmartContext } from './smart-context.js';
import { dirOf, getIndex } from './indexer.js';
import { classifyIntent, pickSymbol, runInvestigation, symLookup } from './local.js';
import { fmtTok } from './helpers.js';
/* ============ PROMPT ASSEMBLY ============ */
var FENCE = '```meridian-trace';
var INSTRUCTIONS = [
  'You are MERIDIAN, an AI instrument that answers questions with full evidence traces.',
  '',
  'Rules:',
  '- Ground answers in the provided project files whenever they are relevant. If the loaded context is insufficient to answer, say so plainly and lower your confidence.',
  '- Be precise and concise. Plain prose; short code snippets only when they help.',
  '- After the answer, output exactly one fenced code block tagged meridian-trace containing only valid JSON of this shape:',
  '',
  FENCE,
  '{"steps":[{"n":1,"action":"short verb phrase","note":"what this step established","evidence":[{"file":"path/exactly/as/given.js","startLine":12,"endLine":30,"quote":"short verbatim excerpt"}]}],"confidence":0.87}',
  '```',
  '',
  '- steps: 1 to 6 items, in reasoning order.',
  '- evidence: each item MUST cite a file path exactly as it appears after "FILE:" in the context, with 1-indexed line numbers matching the numbered lines, and a verbatim quote of at most 120 characters. Never invent files or line numbers. A pure-reasoning step may have an empty evidence array.',
  '- Context may include a PROJECT MAP block (file tree + key-file heads) and a question-relevant subset of files. Excerpted files keep their true line numbers; gaps are marked "··· lines A–B omitted ···". Cite only line ranges you can actually see.',
  '- Context may include a <MERIDIAN_PROJECT_INTELLIGENCE> block produced by Meridian\'s deterministic local engine before your turn. It has typed sections: DETERMINISTIC FINDINGS, SYMBOLS, RELATED FILES, TESTS, RECENT CHANGES (all facts read from the project index — treat as verified, not your own inference), SOURCE EVIDENCE (attributed, line-true excerpts, each tagged "[Evidence NN]" with File / Lines / Kind), and MODEL TASK. Build your reasoning on these findings and excerpts, reuse their exact path:line ranges in your evidence, and clearly separate evidence-backed conclusions from hypotheses — never assert a fact the provided evidence does not support.',
  '- If the map shows a file you cannot see that would answer better, name it and suggest the user ask again mentioning it.',
  '- confidence: a number from 0 to 1 — your honest estimate.',
  '- Optionally include "actions": up to 4 read-only items {"kind","command","filter"?,"why"} that run only after the user clicks. Kinds — search (substring/regex over loaded files; optional "filter" path glob with *), def / refs (definition sites / references of a symbol), dir (summarize a loaded dir; command = path), recent (list recent files; command = a count like "10"), open (a context file worth inspecting), git (read-only status/diff/log/show/blame for the user\'s terminal). Never propose anything that writes, deletes, or installs.',
  '- If no project files are loaded, still emit the block with reasoning steps and empty evidence arrays.',
  '- Emit exactly ONE meridian-trace block and output nothing after its closing fence. Do not tag it ```json or anything else.',
  '- The trace MUST be valid JSON: double-quoted keys and strings, no comments, no trailing commas. If you cannot produce valid trace JSON, still give your prose answer and emit a minimal valid trace (one step, empty evidence) — never emit broken JSON.'
].join('\n');
/* appended on demand (RE-GROUND) or when the user enables Force Strict Trace */
var STRICT_SUFFIX = '\n\nSTRICT MODE: A prior response could not be parsed into a trace. End with exactly one ```meridian-trace fenced block of strictly valid JSON — no prose, comments, or trailing commas after it. Prefer fewer steps over invalid JSON.';

var CTX_PREAMBLE = 'The user\'s loaded project files follow. Each file begins with "═══ FILE: <path> ═══" and every line is prefixed with its 1-indexed line number and "│".';

st.contextDirty = true; st.contextCache = '';
function assembleContext() {
  if (!st.contextDirty) return st.contextCache;
  var parts = [];
  sortedPaths().forEach(function (p) {
    var f = st.files.get(p);
    if (!f.checked) return;
    parts.push('═══ FILE: ' + p + ' ═══\n' + numberLines(f.content, 1));
  });
  st.contextCache = parts.length ? CTX_PREAMBLE + '\n\n' + parts.join('\n\n') : '';
  st.contextDirty = false;
  return st.contextCache;
}

/* Phase 2 — evidence-kind label for a step/intent, so every excerpt in the pack
   is attributed by what produced it. The engine's evidence.kind stays 'evidence';
   this is a display/label mapping only, never a change to the deterministic data. */
var GROUND_KIND = { def: 'definition', refs: 'reference', importers: 'importer', imports: 'import',
  related: 'related', symbols: 'symbol', structure: 'structure', tests: 'test', entries: 'entry-point',
  recent: 'recent-change', dir: 'directory', search: 'match', listType: 'file',
  reason: 'evidence', plain: 'evidence', help: 'evidence' };

/* Line-true excerpt around an evidence span. Reuses numberLines so the numbers the
   model sees are the file's real 1-indexed lines — never altered. A bare single line
   is padded for context; the window is trimmed from the end to fit the token cap. */
function groundExcerpt(file, startLine, endLine) {
  var f = st.files.get(file); if (!f) return null;
  var arr = f.content.split('\n'), total = arr.length;
  var a = Math.max(1, Math.min((startLine | 0) || 1, total));
  var b = Math.max(a, Math.min((endLine | 0) || a, total));
  if (b - a < 2) { a = Math.max(1, a - GROUND_EXCERPT_PAD); b = Math.min(total, b + GROUND_EXCERPT_PAD); }
  var slice = arr.slice(a - 1, b);
  while (slice.length > 4 && estTokens(slice.join('\n'), file) > GROUND_EXCERPT_TOK) { slice.pop(); b--; }
  return { text: numberLines(slice.join('\n'), a), startLine: a, endLine: b };
}

/* Phase 2 (loop completion) — the ONE structured representation of a completed
   investigation: findings + typed terrain (symbols · related files · tests · recent)
   + evidence, all read from the ALREADY-built index. No second index, no second
   evidence system. Pure (no DOM). Returns null when the question yields no evidence. */
function buildInvestigationContext(q, intent, inv) {
  if (!inv) return null;
  var idx = null; try { idx = getIndex(); } catch (e) { idx = null; }

  /* evidence — flatten inv.steps[].evidence, dedup by file:startLine, label by step */
  var evidence = [], seen = {};
  (inv.steps || []).forEach(function (step) {
    var kind = GROUND_KIND[intent.kind] || 'evidence';
    var act = (step.action || '').toLowerCase();
    if (/defin/.test(act)) kind = 'definition';
    else if (/referenc/.test(act)) kind = 'reference';
    else if (/import/.test(act)) kind = 'import';
    else if (/relationship|related/.test(act)) kind = 'related';
    else if (/rank|relevant file/.test(act)) kind = 'relevant-file';
    (step.evidence || []).forEach(function (ev) {
      if (!ev || typeof ev.file !== 'string') return;
      var key = ev.file + ':' + ev.startLine;
      if (seen[key]) return; seen[key] = 1;
      evidence.push({ file: ev.file, startLine: (ev.startLine | 0) || 1, endLine: (ev.endLine | 0) || (ev.startLine | 0) || 1,
                      quote: ev.quote || '', kind: kind, known: st.files.has(ev.file) });
    });
  });
  if (!evidence.length) return null;

  /* findings — the investigation's own answer (cleaned) + one project-shape line */
  var findings = [];
  String(inv.answer || '').split('\n')
    .map(function (l) { return l.replace(/\*\*/g, '').replace(/^[-\d.]+\s+/, '').trim(); })
    .filter(function (l) { return l.length > 2 && !/^(Evidence chips|Chips open|Connect a model|Ask `)/.test(l); })
    .slice(0, 6).forEach(function (l) { findings.push(l); });
  if (idx) findings.push('project shape: ' + idx.fileCount + ' files · ' + idx.symbolCount + ' symbols · '
    + idx.packages.length + ' package' + (idx.packages.length === 1 ? '' : 's') + ' · '
    + idx.entries.length + ' entry point' + (idx.entries.length === 1 ? '' : 's') + ' · '
    + idx.tests.length + ' test file' + (idx.tests.length === 1 ? '' : 's'));

  /* symbols — the key symbol's definitions, straight from the index */
  var symbols = [];
  if (idx) {
    var sym = pickSymbol(q, idx);
    if (sym) symLookup(sym, idx).slice(0, 8).forEach(function (d) { symbols.push({ name: sym, file: d.file, line: d.line, kind: d.kind }); });
  }

  /* relatedFiles — edges of the top evidence file (imports · importers · dir · name),
     reusing the same relation logic the `related` investigation uses */
  var relatedFiles = [];
  if (idx && evidence[0]) {
    var rf = evidence[0].file, rel = {};
    (idx.importsByFile.get(rf) || []).forEach(function (x) { if (x.resolved) rel[x.resolved] = 'imports'; });
    (idx.importedBy.get(rf) || []).forEach(function (x) { rel[x.file] = 'imported by'; });
    var d = dirOf(rf), bn = rf.slice(rf.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase();
    st.files.forEach(function (f, p) {
      if (p === rf || rel[p]) return;
      if (dirOf(p) === d) rel[p] = 'same directory';
      else if (bn.length > 2 && p.toLowerCase().indexOf(bn) !== -1) rel[p] = 'name match';
    });
    Object.keys(rel).slice(0, 12).forEach(function (p) { relatedFiles.push({ file: p, relation: rel[p] }); });
  }

  /* tests + recent — from the index and file mtimes, capped */
  var tests = idx ? idx.tests.slice(0, 12) : [];
  var recent = [];
  st.files.forEach(function (f, p) { recent.push({ file: p, mtime: f.mtime || 0 }); });
  recent.sort(function (a, b) { return b.mtime - a.mtime; });
  recent = recent.slice(0, 8);

  return { question: q, intent: intent.kind, verdict: inv.verdict || { local: true, text: 'KNOWN LOCALLY' },
           findings: findings, evidence: evidence, symbols: symbols, relatedFiles: relatedFiles,
           tests: tests, recent: recent, context: [] };
}

/* Phase 2 (loop completion) — serialize the structured investigation context into a
   budget-aware <MERIDIAN_PROJECT_INTELLIGENCE> envelope with explicit typed sections
   (FINDINGS · SYMBOLS · RELATED FILES · TESTS · RECENT · SOURCE EVIDENCE · MODEL TASK).
   Pure (no DOM). The returned object is the single source of truth for both the request
   text and the MERIDIAN FOUND panel. Returns null when there is no evidence. */
function serializeInvestigationContext(ctx, budgetTok) {
  if (!ctx || !ctx.evidence || !ctx.evidence.length) return null;
  var cap = Math.min(budgetTok || GROUND_MAX_TOK, GROUND_MAX_TOK);
  var verdict = ctx.verdict || { local: true, text: 'KNOWN LOCALLY' };
  function section(title, lines) { return '── ' + title + ' ──\n' + (lines.length ? lines.join('\n') : 'none detected') + '\n\n'; }

  var head = '<MERIDIAN_PROJECT_INTELLIGENCE>\n'
    + 'Meridian analyzed the project index for this question before your turn. Everything below is deterministic — read from the project, not inferred.\n\n'
    + 'USER QUESTION: ' + ctx.question + '\n'
    + 'INTENT: ' + ctx.intent + '    VERDICT: ' + verdict.text + '\n\n'
    + section('DETERMINISTIC FINDINGS', ctx.findings.map(function (f) { return '- ' + f; }))
    + section('SYMBOLS', ctx.symbols.map(function (s) { return '- ' + s.name + ' (' + s.kind + ') — ' + s.file + ':' + s.line; }))
    + section('RELATED FILES', ctx.relatedFiles.map(function (r) { return '- ' + r.file + ' — ' + r.relation; }))
    + section('TESTS', ctx.tests.map(function (t) { return '- ' + t; }))
    + section('RECENT CHANGES', ctx.recent.map(function (r) { return '- ' + r.file; }))
    + '── SOURCE EVIDENCE ──\n'
    + 'Files and exact line ranges supporting the findings. Line numbers are authoritative and unchanged.\n\n';

  /* attributed, line-true excerpts within the token budget; overflow → citation lines */
  var evBlocks = [], cites = [], evOut = [], contextOut = [], used = estTokens(head);
  for (var i = 0; i < ctx.evidence.length; i++) {
    var it = ctx.evidence[i];
    if (evOut.length < GROUND_MAX_EVIDENCE && it.known) {
      var ex = groundExcerpt(it.file, it.startLine, it.endLine);
      if (ex) {
        var num = String(evOut.length + 1).padStart(2, '0');
        var block = '[Evidence ' + num + ']\nFile: ' + it.file + '\nLines: ' + ex.startLine + '–' + ex.endLine + '\nKind: ' + it.kind + '\n' + ex.text + '\n';
        var t = estTokens(block, it.file);
        if (used + t <= cap) {
          evBlocks.push(block);
          evOut.push({ file: it.file, startLine: ex.startLine, endLine: ex.endLine, kind: it.kind, quote: it.quote });
          contextOut.push({ file: it.file, startLine: ex.startLine, endLine: ex.endLine, text: ex.text });
          used += t;
          continue;
        }
      }
    }
    if (cites.length < GROUND_MAX_CITES) {
      cites.push(it.file + ':' + it.startLine + (it.endLine > it.startLine ? '-' + it.endLine : '')
        + '  [' + it.kind + ']' + (it.quote ? '  « ' + it.quote + ' »' : ''));
      evOut.push({ file: it.file, startLine: it.startLine, endLine: it.endLine, kind: it.kind, quote: it.quote });
    }
  }

  var task = '\n── MODEL TASK ──\n'
    + 'Using Meridian\'s findings and source evidence above, reason about the user\'s question.\n'
    + '- Distinguish evidence-backed conclusions from your own hypotheses; label inference as inference.\n'
    + '- Do not claim a fact is true unless the provided evidence supports it.\n'
    + '- Prefer citing these exact files and line ranges (path:line) in your trace evidence.\n'
    + '</MERIDIAN_PROJECT_INTELLIGENCE>\n';

  var citeText = cites.length ? '\nAdditional verified citations (no excerpt shown):\n' + cites.join('\n') + '\n' : '';
  var text = head + (evBlocks.join('\n') || '(no excerpts fit the budget; verified citations follow)\n') + citeText + task;
  return { text: text, count: evOut.length, evidence: evOut, findings: ctx.findings, verdict: verdict, intent: ctx.intent,
           symbols: ctx.symbols, relatedFiles: ctx.relatedFiles, tests: ctx.tests, recent: ctx.recent, context: contextOut };
}

/* Phase 5/2 bridge: run the deterministic investigation for q, then serialize it.
   The single entry both the model request and the PREVIEW use, so they cannot drift.
   Returns null on any failure or when no evidence is found — an empty block is never
   sent and the existing model path proceeds unchanged. */
function buildInvestigationBlock(q, budgetTok) {
  if (!st.files.size) return null;
  try {
    var intent = classifyIntent(q);
    var inv = runInvestigation(q, intent);
    var ctx = buildInvestigationContext(q, intent, inv);
    return serializeInvestigationContext(ctx, budgetTok);
  } catch (e) { return null; }
}

/* Builds the system blocks for one question, honoring the context mode.
   Returns { blocks, note } — note is a short human-readable summary for the statusline.
   A grounding block (per-question, uncached) is always placed AFTER the cached map/ctx
   block so Anthropic prompt caching of the stable prefix is preserved. */
function buildContextBlocks(q) {
  var groundBudget = Math.min(GROUND_MAX_TOK, Math.floor(getBudget() * 0.25));
  var invBlock = st.groundMode ? buildInvestigationBlock(q, groundBudget) : null;
  var groundTok = invBlock ? estTokens(invBlock.text) : 0;
  var gNote = invBlock ? ' · GROUNDED ' + invBlock.count + ' EV' : '';
  if (st.ctxMode !== 'smart') {
    var ctx = assembleContext();
    var fblocks = ctx ? [{ type: 'text', text: ctx, cache_control: { type: 'ephemeral' } }] : [];
    if (invBlock) fblocks.push({ type: 'text', text: invBlock.text });
    return { blocks: fblocks, note: invBlock ? ('GROUNDED ' + invBlock.count + ' EV') : null, ground: invBlock };
  }
  var map = buildProjectMap();
  if (!map) return { blocks: [], note: null, ground: invBlock };
  /* grounding is counted against the one budget so grounding + selected files stay bounded */
  var packed = packSmartContext(q, Math.max(4000, getBudget() - groundTok));
  /* cache the stable map block; grounding + packed subset vary per question */
  var blocks = [{ type: 'text', text: map, cache_control: { type: 'ephemeral' } }];
  if (invBlock) blocks.push({ type: 'text', text: invBlock.text });
  if (packed.text) {
    blocks.push({ type: 'text', text: 'SELECTED FILES — the subset most relevant to this question. ' + CTX_PREAMBLE + ' Excerpted files keep true line numbers; omitted ranges are marked.\n\n' + packed.text });
  }
  var mapTok = estTokens(map);
  return { blocks: blocks, note: 'SMART CTX ' + packed.count + '/' + packed.total + ' FILES ≈ ' + fmtTok(packed.tokens + mapTok + groundTok) + ' TOK' + gNote, ground: invBlock };
}
export { FENCE, INSTRUCTIONS, STRICT_SUFFIX, buildContextBlocks, buildInvestigationBlock };
