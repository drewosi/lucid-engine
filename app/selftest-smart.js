import { estTokens, numberLines } from './smart-context.js';
import { getIndex } from './indexer.js';
import { invalidateAll, st } from './state.js';
import { classifyIntent } from './local.js';
import { pickSymbol, runInvestigation, symLookup } from './intents.js';
import { INSTRUCTIONS, buildContextBlocks } from './prompt.js';
import { fmtTok, lsDel, lsGet, lsSet } from './helpers.js';
import { LS } from './config.js';
import { stEntry } from './selftest-fixture.js';
/* "where is X defined" on a project that defines a symbol named `where` (real
   Godot + GDScript reports): the named identifier must win over grammar words,
   and a name missing from the index is said to be missing, never swapped */
function symbolPickCases(ok) {
  var keep = { files: st.files, idx: st.projectIndex, dirty: st.indexDirty };
  var F = {
    'src/where.js': 'export const where = 1;\nexport function main() { return where; }',
    'tools/gles3_builders.py': 'import os\n\n\nclass GLES3HeaderStruct:\n    pass',
    'notes.txt': 'connect the _on_talk_submitted handler in the talk scene'
  };
  function inv(q) { var it = classifyIntent(q); return { it: it, r: runInvestigation(q, it) }; }
  try {
    st.files = new Map();
    Object.keys(F).forEach(function (p) { st.files.set(p, stEntry(p, F[p])); });
    invalidateAll();
    var idx = getIndex();
    ok('pick · fixture defines a symbol named `where`', symLookup('where', idx).length === 1);
    var a = inv('where is GLES3HeaderStruct defined');
    ok('pick · named identifier beats the grammar word "where"', a.it.arg === 'GLES3HeaderStruct' && /tools\/gles3_builders\.py` line 4 \(class\)/.test(a.r.answer), a.it.arg + ' · ' + a.r.answer.split('\n')[0]);
    var b = inv('where is _on_talk_submitted defined');
    ok('pick · a name missing from the index is reported missing', b.it.arg === '_on_talk_submitted' && /No indexed definition named `_on_talk_submitted`/.test(b.r.answer)
      && b.r.answer.indexOf('src/where.js') === -1, b.it.arg + ' · ' + b.r.answer.split('\n')[0]);
    ok('pick · the missing case offers the text search', (b.r.actions || []).some(function (x) { return x.kind === 'search' && x.command === '_on_talk_submitted'; }));
    var c = inv('where is ghostFn defined in main');
    ok('pick · the "where is X" slot wins over a later indexed word', c.it.arg === 'ghostFn' && /No indexed definition named `ghostFn`/.test(c.r.answer), c.it.arg);
    ok('pick · grammar words never picked from the index', pickSymbol('where is it', idx) !== 'where' && pickSymbol('find the definition', idx) !== 'where', pickSymbol('where is it', idx));
    ok('pick · "who calls X" / "find X" slots', pickSymbol('who calls main', idx) === 'main' && pickSymbol('find GLES3HeaderStruct', idx) === 'GLES3HeaderStruct'
      && pickSymbol('where is the class GLES3HeaderStruct', idx) === 'GLES3HeaderStruct');
    var d = inv('where is where defined');
    ok('pick · an explicitly named grammar-word symbol still resolves', d.it.arg === 'where' && /src\/where\.js/.test(d.r.answer), d.it.arg);
  } finally {
    st.files = keep.files; st.projectIndex = keep.idx; st.indexDirty = keep.dirty;
    invalidateAll();
  }
}
/* SMART on a huge project (8000-file Godot report): map + grounding + packed
   files + instructions must fit the configured budget, and the totals the
   preview reads (cb.plan) are the totals of what is sent */
/* Canonical estimate. Reference lengths are Qwen3.5-9B token counts (no special
   tokens) for these exact strings. The estimate must be at least that count and
   not a runaway (more than double), on C/C++ — including the line-number prefix
   SMART sends — plus JS, Python, GDScript, markdown and JSON. */
function estBiasCases(ok) {
  ok('est · empty is zero', estTokens('') === 0 && estTokens('', 'a.cpp') === 0);
  var cpp = 'int main() {\n  int mask = 0x0062;\n  if (mask == 0) return 1;\n  return mask;\n}\n';
  ok('est · path does not change the count', estTokens(cpp, 'a.cpp') === estTokens(cpp, 'a.md') && estTokens(cpp) === estTokens(cpp, 'a.cpp'));
  /* five digits are five tokens before the pad; ceil(5 * 108 / 100) is 6 */
  ok('est · each digit is a token, then the bias', estTokens('12345') === 6, String(estTokens('12345')));
  var samples = [
    ['C/C++', cpp, 'src/main.cpp', 38],
    ['numbered C/C++', numberLines(cpp, 1), 'src/main.cpp', 50],
    ['JS', 'export function addTodo(title) {\n  const id = Date.now();\n  return { id: id, title: title, done: false };\n}\n', 'src/add.js', 34],
    ['Python', 'def helper(name: str) -> int:\n    return len(name) + 1\n', 'pkg/helper.py', 19],
    ['GDScript', 'extends Node\n\nfunc _ready() -> void:\n\tvar count := 3\n\tprint(count)\n', 'player.gd', 21],
    ['markdown', '# Title\n\nA short paragraph about the project, with a [link](https://example.com).\n', 'README.md', 21],
    ['JSON', '{"name":"lucid","version":"1.2.3","deps":{"left":"1.0.0"}}\n', 'package.json', 25]
  ];
  var fails = [];
  samples.forEach(function (row) {
    var est = estTokens(row[1], row[2]);
    if (est < row[3] || est > row[3] * 2) fails.push(row[0] + ' est ' + est + ' ref ' + row[3]);
  });
  ok('est · at or above the tokenizer on C/C++, JS, Python, GDScript, markdown, JSON', fails.length === 0,
    fails.join('; ') || samples.map(function (row) { return row[0] + ' ' + estTokens(row[1], row[2]) + '>=' + row[3]; }).join(' · '));
}
function smartBudgetCases(ok) {
  var keep = { files: st.files, idx: st.projectIndex, dirty: st.indexDirty, ctxMode: st.ctxMode, groundMode: st.groundMode, pins: st.pinnedEv,
    history: st.history, budget: lsGet(LS.ctxbudget), mapCache: st.mapCache, mapDirty: st.mapDirty };
  try {
    st.files = new Map(); st.pinnedEv = []; st.history = [];
    var body = new Array(40).join('  int value_x = compute_thing(alpha, beta) + offset;\n');
    for (var i = 0; i < 3000; i++) {
      var p = 'engine/mod' + (i % 30) + '/sub' + (i % 7) + '/deep' + (i % 5) + '/file' + i + '.cpp';
      st.files.set(p, stEntry(p, 'void fn_' + i + '() {\n' + body + '}\n'));
    }
    invalidateAll();
    lsSet(LS.ctxbudget, '20000');
    st.ctxMode = 'smart'; st.groundMode = true;
    var q = 'where is fn_12 used';
    var cb = buildContextBlocks(q);
    var sent = cb.blocks.reduce(function (a, b) { return a + estTokens(b.text); }, 0) + estTokens(INSTRUCTIONS) + estTokens(q);
    ok('smart-ctx · whole send fits the budget on a huge project', sent <= 20000, '≈' + sent + ' tok sent vs 20000 budget');
    ok('smart-ctx · huge project map is condensed', /condensed/.test(cb.blocks[0].text) && estTokens(cb.blocks[0].text) < 20000 * 0.25, '≈' + estTokens(cb.blocks[0].text) + ' tok map');
    ok('smart-ctx · plan totals match the send', !!cb.plan && cb.plan.total <= 20000 && Math.abs(cb.plan.total - sent) <= sent * 0.1
      && (cb.note || '').indexOf(fmtTok(cb.plan.total)) !== -1, cb.plan ? cb.plan.total + ' vs ' + sent + ' · ' + cb.note : 'no plan');
    ok('smart-ctx · files still pack under the shrunk budget', cb.plan && cb.plan.packed.count > 0, cb.plan ? cb.plan.packed.count + ' files' : '');
  } finally {
    if (keep.budget === null) lsDel(LS.ctxbudget); else lsSet(LS.ctxbudget, keep.budget);
    st.files = keep.files; st.projectIndex = keep.idx; st.indexDirty = keep.dirty; st.ctxMode = keep.ctxMode; st.groundMode = keep.groundMode;
    st.pinnedEv = keep.pins; st.history = keep.history;
    invalidateAll();
  }
}
export { symbolPickCases, estBiasCases, smartBudgetCases };
