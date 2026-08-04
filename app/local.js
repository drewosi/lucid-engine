import { sortedPaths, st } from './state.js';
import { dirOf, getIndex } from './indexer.js';
import { CAP_LOCAL, CAP_MODEL, LOCAL_HELP, classifyIntent, computeSignals, listOrphans, pickSymbol, runInvestigation, symLookup } from './intents.js';
import { addAiMsg, addUserMsg, attachCopy, renderRich, renderTrace, scrollEnd } from './trace.js';
import { $, announce, fmtTok, setStatus } from './helpers.js';
/* ============ LOCAL ENGINE (NO API · NO AI) ============
   The deterministic project-intelligence engine. A question is routed by intent
   (classifyIntent), an investigation runs real operations over the project index
   (runInvestigation), and the findings are surfaced through the same trace +
   evidence-chip UI the AI providers use — every claim pinned to a real file:line.
   Meridian understands the terrain first; a model is optional, and only for
   interpretation. Honestly labeled LOCAL · NO AI, with an explicit KNOWN-LOCALLY
   vs REQUIRES-MODEL verdict on every answer.
   The reasoning instances themselves live in the intent registry (intents.js);
   this module is the UI shell around them.                                     */

function renderVerdict(msgEl, verdict) {
  if (!verdict) return;
  var bd = msgEl.querySelector('.bd');
  var v = document.createElement('div');
  v.className = 'verdict ' + (verdict.local ? 'ok' : 'model');
  v.title = verdict.local
    ? 'Answered entirely from the deterministic project index — no model, no network'
    : 'Meridian gathered the evidence; interpreting it needs a model — connect one in settings';
  v.innerHTML = '<span class="vk mono"></span><span class="vt"></span>';
  v.querySelector('.vk').textContent = verdict.local ? '✓ ' + verdict.text : '○ ' + verdict.text;
  v.querySelector('.vt').textContent = verdict.local ? 'answered from the project index — zero inference, zero network' : 'evidence gathered locally — connect a model to synthesize';
  bd.appendChild(v);
}

/* one-time, in-the-seam orientation after the first LOCAL answer of the session:
   reinforce the core model (index answered, no model ran) and hand the curious a
   door (the "what can I ask" catalog). Session-scoped by design — no storage. */
function renderOrientation(msgEl) {
  if (st.orientShown || !st.files.size) return;
  st.orientShown = true;
  var bd = msgEl.querySelector('.bd');
  var o = document.createElement('div');
  o.className = 'orient mono';
  o.appendChild(document.createTextNode('// this answer came from the deterministic index — no model was used. '));
  o.appendChild(document.createElement('br'));
  o.appendChild(document.createTextNode('// ✓ KNOWN LOCALLY = answered from the index · ○ REQUIRES MODEL REASONING = evidence gathered, a model synthesizes · '));
  var b = document.createElement('button');
  b.type = 'button'; b.className = 'kbd-link mono'; b.textContent = '▤ what can I ask';
  b.title = 'Everything the deterministic engine answers';
  b.addEventListener('click', function () { var m = $('localmenubtn'); if (m) m.click(); });
  o.appendChild(b);
  bd.appendChild(o);
}

function askLocal(q) {
  addUserMsg(q);
  var msgEl = addAiMsg();
  var txtEl = msgEl.querySelector('.txt');
  setStatus('LOCAL ENGINE — investigating…');

  var answer, trace, verdict;
  if (!st.files.size) {
    answer = 'No project is loaded, so there is no terrain to analyze yet. Drop a folder into CONTEXT and Meridian will index it — or switch to an AI provider in settings.\n\n**Known locally:** ' + CAP_LOCAL.join(' · ') + '.\n**Requires a model:** ' + CAP_MODEL.join(' · ') + '.\n\n' + LOCAL_HELP;
    trace = { steps: [{ action: 'check loaded context', note: 'no files in memory', evidence: [] }] };
    verdict = { local: true, text: 'KNOWN LOCALLY' };
  } else {
    var intent = classifyIntent(q);
    var inv = runInvestigation(q, intent);
    answer = inv.answer;
    trace = { steps: inv.steps, actions: inv.actions || null };
    verdict = inv.verdict;
  }

  txtEl.innerHTML = renderRich(answer);
  renderVerdict(msgEl, verdict);
  renderTrace(msgEl, trace);
  renderOrientation(msgEl);
  /* the header chip defaults to TRACED — relabel it so nobody mistakes this for a model */
  var chip = msgEl.querySelector('.term-hd .chip');
  if (chip) { chip.className = 'chip'; chip.textContent = 'LOCAL · NO AI'; }
  var hd = msgEl.querySelector('.term-hd');
  if (hd && hd.firstChild) hd.firstChild.textContent = 'MERIDIAN LOCAL ENGINE — NO AI ';

  st.history.push({ role: 'user', content: q });
  st.history.push({ role: 'assistant', content: answer });
  st.transcript.push({ q: q, answer: answer, trace: trace, model: 'LOCAL ENGINE', provider: 'LOCAL', ts: Date.now() });
  attachCopy(msgEl, st.transcript.length - 1);
  setStatus('LOCAL ENGINE IDLE — deterministic · zero network');
  announce('Local answer ready.');
  scrollEnd();
}

/* ---- Project Intelligence overview: the deterministic terrain, shown on load
   for every provider. Tiles are real queries into the same engine. ---- */
function renderOverview() {
  var ov = $('overview'), emptyEl = $('empty');
  if (!st.files.size) { ov.hidden = true; ov.innerHTML = ''; if (emptyEl) emptyEl.hidden = false; return; }
  if (emptyEl) emptyEl.hidden = true; /* overview is the orientation once a project is loaded */
  var idx = getIndex();
  var dirs = {}; sortedPaths().forEach(function (p) { dirs[dirOf(p) || '.'] = 1; });
  var langs = Object.keys(idx.byExt).filter(function (e) { return e !== '·'; }).sort(function (a, b) { return idx.byExt[b] - idx.byExt[a]; });
  var tiles = [
    { label: 'FILES', value: idx.fileCount, q: 'project structure' },
    { label: 'DIRECTORIES', value: Object.keys(dirs).length, q: 'project structure' },
    { label: 'PACKAGES', value: idx.packages.length, q: 'project structure' },
    { label: 'ENTRY POINTS', value: idx.entries.length, q: 'entry points' },
    { label: 'TESTS', value: idx.tests.length, q: 'where are the tests' },
    { label: 'SYMBOLS', value: idx.symbolCount, q: 'symbols' },
    { label: 'TODOS', value: idx.todos.length, q: 'todos' },
    { label: 'ORPHANS', value: listOrphans(idx).length, q: 'orphans' },
    { label: 'SIGNALS', value: computeSignals(idx).length, q: 'signals' }
  ];
  ov.hidden = false;
  ov.innerHTML = '<div class="ov-hd mono">PROJECT INTELLIGENCE // <b>deterministic</b> — Meridian understands the terrain before a model enters the room</div>'
    + '<div class="stat-grid"></div><div class="ov-index mono"></div><div class="ov-langs mono"></div><div class="ov-cap mono"></div>';
  var grid = ov.querySelector('.stat-grid');
  tiles.forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'stat-tile';
    b.title = 'Run a local investigation: ' + t.q;
    b.innerHTML = '<span class="sl"></span><span class="sv"></span>';
    b.querySelector('.sl').textContent = t.label;
    b.querySelector('.sv').textContent = t.value >= 1000 ? fmtTok(t.value) : String(t.value);
    b.addEventListener('click', function () { askLocal(t.q); });
    grid.appendChild(b);
  });
  var langCount = idx.langs ? Object.keys(idx.langs).length : langs.length;
  ov.querySelector('.ov-index').textContent = '// indexed ' + idx.symbolCount + ' symbol' + (idx.symbolCount === 1 ? '' : 's') + ' · ' + (idx.importCount || 0) + ' import' + ((idx.importCount || 0) === 1 ? '' : 's') + ' · ' + langCount + ' language' + (langCount === 1 ? '' : 's');
  ov.querySelector('.ov-langs').textContent = '// languages: ' + (langs.slice(0, 6).map(function (e) { return e + ' ·' + idx.byExt[e]; }).join('  ') || 'none');
  ov.querySelector('.ov-cap').textContent = '// ✓ known locally: ' + CAP_LOCAL.join(' · ') + '   ○ requires a model: ' + CAP_MODEL.join(' · ');
  /* skipped files belong on the orientation surface, not only in the rail — the
     same review modal, reached through the already-wired control */
  if (st.skippedFiles.length) {
    var sk = document.createElement('div');
    sk.className = 'ov-skip mono';
    sk.appendChild(document.createTextNode('// ' + st.skippedFiles.length + ' file' + (st.skippedFiles.length === 1 ? '' : 's') + ' skipped during load (binary · oversized · ignored · caps) — '));
    var sb = document.createElement('button');
    sb.type = 'button'; sb.className = 'kbd-link mono'; sb.textContent = '[ REVIEW SKIPPED ]';
    sb.title = 'List every skipped file and pull specific ones back in';
    sb.addEventListener('click', function () { var r = $('skiprev'); if (r) r.click(); });
    sk.appendChild(sb);
    ov.appendChild(sk);
  }
  /* honest machinery limits, stated once where orientation happens — each
     analysis repeats its own caveat in its answer */
  var lim = document.createElement('div');
  lim.className = 'ov-lim mono';
  lim.textContent = '// machinery limits: static import edges only (regex extraction per language · >400-char lines not indexed) — cycles/orphans/hubs/untested read that graph; dynamic loading, DI and bundler wiring are invisible. each analysis states its own caveats in its answer.';
  ov.appendChild(lim);
}

export { askLocal, classifyIntent, pickSymbol, renderOverview, runInvestigation, symLookup };
