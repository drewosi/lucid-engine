import { $, app, copyText, esc, prefersReduced, toast } from './helpers.js';
import { MODELS } from './config.js';
import { st } from './state.js';
import { openViewer } from './viewer.js';
import { renderActions } from './actions.js';
/* ============ RENDERING ============ */
function renderRich(raw) {
  /* markdown-lite: fenced code blocks, inline code, bold — everything HTML-escaped first */
  var out = '', rest = raw;
  while (true) {
    var m = rest.match(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)(```|$)/);
    if (!m) { out += inline(rest); break; }
    out += inline(rest.slice(0, m.index));
    out += '<pre><code>' + esc(m[2]) + '</code></pre>';
    rest = rest.slice(m.index + m[0].length);
  }
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    return s;
  }
  return out;
}

var convo = $('convo'), convoIn = convo.querySelector('.convo-in');
function scrollEnd() { convo.scrollTop = convo.scrollHeight; }

function addUserMsg(text) {
  $('empty') && $('empty').remove();
  var d = document.createElement('div');
  d.className = 'msg msg-u'; d.textContent = text;
  convoIn.appendChild(d); scrollEnd();
}
function addAiMsg() {
  var d = document.createElement('div');
  d.className = 'msg msg-a';
  d.innerHTML = '<div class="term-hd mono">MERIDIAN CORE — ' + MODELS[st.model].label + ' <span class="chip"><span></span>LIVE</span></div>'
    + '<div class="bd"><div class="txt"></div></div>';
  convoIn.appendChild(d); scrollEnd();
  return d;
}
/* per-answer copy — a [ COPY ] control in the message header that copies that one
   exchange as Markdown (same formatter as the full export). idx is the transcript
   index; transcript and the DOM are cleared together, so the index never goes stale. */
function attachCopy(msgEl, idx) {
  var hd = msgEl.querySelector('.term-hd');
  if (!hd) return;
  var b = document.createElement('button');
  b.type = 'button'; b.className = 'hdcopy mono'; b.textContent = '[ COPY ]';
  b.title = 'Copy this answer, its trace and cited lines as Markdown';
  b.addEventListener('click', function () {
    var x = st.transcript[idx];
    if (!x) { toast('Nothing to copy yet.'); return; }
    copyText(exchangeMarkdown(x, idx), 'Answer copied as Markdown.');
  });
  hd.appendChild(b);
}

/* ============ TRACE ============ */
/* JSON.parse, then a lenient retry that strips a BOM, // line-comments and trailing
   commas — models routinely emit those despite instructions. */
function tolerantJSONParse(s) {
  if (typeof s !== 'string') return null;
  try { return JSON.parse(s); } catch (e) {}
  try {
    var cleaned = s.replace(/^﻿/, '').replace(/\/\/[^\n\r]*/g, '').replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned);
  } catch (e2) {}
  return null;
}
/* balanced {…} starting at i (string/escape aware); returns the slice, or the tail
   if the braces never close (a truncated stream). */
function sliceBalanced(str, i) {
  var depth = 0, inStr = false, esc = false;
  for (var j = i; j < str.length; j++) {
    var ch = str.charAt(j);
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return str.slice(i, j + 1); }
  }
  return str.slice(i);
}
/* validate + repair a parsed trace object: steps must be an array of objects;
   backfill n, default evidence to [], drop junk items. */
function coerceTrace(t) {
  if (!t || !Array.isArray(t.steps)) return null;
  var steps = [];
  t.steps.forEach(function (s, i) {
    if (!s || typeof s !== 'object') return;
    if (!Array.isArray(s.evidence)) s.evidence = [];
    if (typeof s.n !== 'number') s.n = i + 1;
    steps.push(s);
  });
  if (Array.isArray(t.actions)) t.actions = t.actions.filter(function (a) { return a && typeof a === 'object'; });
  t.steps = steps;
  return t;
}
/* Resilient trace extraction. Returns {answer, trace, degraded} where degraded is
   null (clean) | 'salvaged' (non-standard format recovered) | 'truncated'
   (cut off mid-JSON) | 'unparseable' (fence present, JSON broken) | 'no-trace'. */
function extractTrace(raw) {
  raw = raw || '';
  /* (a) primary meridian-trace fence — tolerant of ~~~ fences, missing trailing
     newline, and a missing closing fence at EOF (truncated stream). */
  var m = raw.match(/(?:```|~~~)meridian-trace[ \t]*\r?\n([\s\S]*?)(?:\r?\n?(?:```|~~~)|$)/);
  if (m) {
    var hadClose = /(?:```|~~~)\s*$/.test(m[0]);
    var t = coerceTrace(tolerantJSONParse(m[1]));
    var answer = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim();
    if (t) return { answer: answer, trace: t, degraded: null };
    return { answer: answer, trace: null, degraded: hadClose ? 'unparseable' : 'truncated' };
  }
  /* (b) fallback: any fenced block (```json / bare ```) whose JSON has "steps". */
  var fences = raw.match(/(?:```|~~~)[a-z0-9_-]*[ \t]*\r?\n[\s\S]*?(?:```|~~~)/gi) || [];
  for (var i = 0; i < fences.length; i++) {
    if (fences[i].indexOf('"steps"') === -1) continue;
    var inner = fences[i].replace(/^(?:```|~~~)[a-z0-9_-]*[ \t]*\r?\n/i, '').replace(/(?:```|~~~)\s*$/, '');
    var t2 = coerceTrace(tolerantJSONParse(inner));
    if (t2) return { answer: raw.replace(fences[i], '').trim(), trace: t2, degraded: 'salvaged' };
  }
  /* (c) fallback: a bare top-level {…"steps"…} with no fence at all. */
  var si = raw.indexOf('"steps"');
  if (si !== -1) {
    var open = raw.lastIndexOf('{', si);
    if (open !== -1) {
      var t3 = coerceTrace(tolerantJSONParse(sliceBalanced(raw, open)));
      if (t3) return { answer: raw.slice(0, open).trim() || '(trace only)', trace: t3, degraded: 'salvaged' };
      return { answer: raw.slice(0, open).trim() || raw, trace: null, degraded: 'truncated' };
    }
  }
  return { answer: raw, trace: null, degraded: 'no-trace' };
}

/* One navigable evidence chip — shared by the model trace and the MERIDIAN FOUND
   panel so both render (and navigate to source) identically. (Named to avoid the
   Proposed-Actions evChip(resEl,…) below, a different helper.) */
function evidenceChip(ev) {
  if (!ev || typeof ev.file !== 'string') return null;
  var known = st.files.has(ev.file);
  var a = Math.max(1, parseInt(ev.startLine, 10) || 1);
  var b = Math.max(a, parseInt(ev.endLine, 10) || a);
  if (known) { var len = st.files.get(ev.file).lines; a = Math.min(a, len); b = Math.min(b, len); }
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ev mono' + (known ? '' : ' dead');
  /* typed evidence: deterministic 'evidence' stays unmarked; other kinds get a tag */
  if (ev.kind && ev.kind !== 'evidence') {
    var km = document.createElement('span');
    km.className = 'kind ' + (ev.kind === 'inference' || ev.kind === 'uncertain' ? ev.kind : '');
    km.textContent = ev.kind === 'inference' ? 'INFERENCE' : ev.kind === 'uncertain' ? 'UNCERTAIN' : String(ev.kind).toUpperCase();
    btn.appendChild(km);
  }
  var srcSpan = document.createElement('span');
  srcSpan.className = 'src'; srcSpan.textContent = 'ctx://';
  btn.appendChild(srcSpan);
  btn.appendChild(document.createTextNode(ev.file + ':' + a + '–' + b));
  if (known) {
    var title = 'Open ' + ev.file + ' at ' + a + '–' + b;
    if (ev.quote) {
      var q60 = String(ev.quote).trim().slice(0, 60);
      if (q60 && st.files.get(ev.file).content.indexOf(q60) === -1) { title = 'Quote not found in this file — the model may have paraphrased or mis-cited these lines'; btn.classList.add('unverified'); }
    }
    btn.title = title;
    btn.addEventListener('click', function () { openViewer(ev.file, a, b, ev.quote); });
  } else { btn.disabled = true; btn.title = 'File is not in the loaded context — the citation cannot be verified.'; }
  return btn;
}
/* copy one citation as `path:a–b` + its quote — for pasting into an issue or a doc */
function evCopyBtn(ev) {
  if (!ev || typeof ev.file !== 'string') return null;
  var a = Math.max(1, parseInt(ev.startLine, 10) || 1);
  var b = Math.max(a, parseInt(ev.endLine, 10) || a);
  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'evcopy mono'; btn.textContent = '⧉';
  btn.title = 'Copy this citation (path:line' + (ev.quote ? ' + quote' : '') + ')';
  btn.setAttribute('aria-label', 'Copy citation ' + ev.file + ':' + a + '–' + b);
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var txt = '`' + ev.file + ':' + a + '–' + b + '`' + (ev.quote ? ' — “' + String(ev.quote) + '”' : '');
    copyText(txt, 'Citation copied.');
  });
  return btn;
}
function evidenceChipRow(evList, max) {
  var row = document.createElement('div');
  row.className = 'ev-row';
  var n = 0, lim = max || 8;
  (evList || []).forEach(function (ev) {
    if (n >= lim) return;
    var c = evidenceChip(ev);
    if (!c) return;
    var cell = document.createElement('span');
    cell.className = 'ev-cell';
    cell.appendChild(c);
    var cp = evCopyBtn(ev);
    if (cp) cell.appendChild(cp);
    row.appendChild(cell);
    n++;
  });
  return row;
}

/* Phase 2 — the MERIDIAN FOUND panel: the deterministic findings and navigable
   source evidence that grounded this model answer, rendered ABOVE the model's
   interpretation so the two layers never blur. Reuses the evidence-chip UI, so
   every citation is click-to-source. Caller wraps this so a render error never
   interrupts streaming. */
function renderFound(msgEl, ground) {
  if (!ground) return;
  var bd = msgEl.querySelector('.bd'), txt = bd.querySelector('.txt');
  if (!bd || !txt) return;
  var panel = document.createElement('div');
  panel.className = 'found';
  var head = document.createElement('div');
  head.className = 'found-hd mono';
  var vt = ground.verdict ? ground.verdict.text : 'KNOWN LOCALLY';
  head.innerHTML = '<span class="fk">▣ MERIDIAN FOUND</span><span class="ft"></span>';
  head.querySelector('.ft').textContent = 'deterministic · ' + ground.count + ' evidence item' + (ground.count === 1 ? '' : 's') + ' · ' + vt;
  panel.appendChild(head);
  if (ground.findings && ground.findings.length) {
    var ul = document.createElement('ul');
    ul.className = 'found-list';
    ground.findings.slice(0, 6).forEach(function (f) { var li = document.createElement('li'); li.textContent = f; ul.appendChild(li); });
    panel.appendChild(ul);
  }
  /* compact typed-terrain line — the same structured intelligence sent to the model */
  var terrain = [];
  if (ground.symbols && ground.symbols.length) terrain.push(ground.symbols.length + ' symbol' + (ground.symbols.length === 1 ? '' : 's'));
  if (ground.relatedFiles && ground.relatedFiles.length) terrain.push(ground.relatedFiles.length + ' related');
  if (ground.tests && ground.tests.length) terrain.push(ground.tests.length + ' test' + (ground.tests.length === 1 ? '' : 's'));
  if (ground.recent && ground.recent.length) terrain.push(ground.recent.length + ' recent');
  if (terrain.length) {
    var tl = document.createElement('div');
    tl.className = 'found-terrain mono';
    tl.textContent = 'terrain · ' + terrain.join(' · ');
    panel.appendChild(tl);
  }
  if (ground.evidence && ground.evidence.length) panel.appendChild(evidenceChipRow(ground.evidence, 12));
  var lbl = document.createElement('div');
  lbl.className = 'found-model mono';
  lbl.textContent = '○ MODEL INTERPRETATION';
  bd.insertBefore(panel, txt);
  bd.insertBefore(lbl, txt);
}

/* a recoverable-failure affordance: re-run the LOCAL investigation and re-ask with
   a stricter trace instruction (opts.retry supplies the closure) */
function appendRegroundBtn(bd, retry) {
  var row = document.createElement('div');
  row.className = 'reground-row';
  var b = document.createElement('button');
  b.type = 'button'; b.className = 'btn-quiet acc'; b.textContent = '[ RE-GROUND & RETRY ]';
  b.title = 'Re-run Meridian\'s deterministic investigation and ask again with a stricter trace instruction';
  b.addEventListener('click', function () { b.disabled = true; retry(); });
  row.appendChild(b);
  bd.appendChild(row);
}
function renderTrace(msgEl, trace, opts) {
  opts = opts || {};
  var deg = opts.degraded;
  var bd = msgEl.querySelector('.bd');
  var wait = bd.querySelector('.trace-wait');
  if (wait) wait.remove();
  var chip = msgEl.querySelector('.term-hd .chip');
  if (!trace) {
    /* honest degradation states — the "showing raw response" surface */
    if (deg === 'truncated' || deg === 'unparseable' || deg === 'no-trace') {
      chip.className = 'chip dim';
      chip.textContent = deg === 'truncated' ? 'TRACE TRUNCATED' : deg === 'unparseable' ? 'TRACE UNREADABLE' : 'RAW RESPONSE';
      var note = document.createElement('div');
      note.className = 'errline';
      note.textContent = deg === 'truncated'
        ? '// trace truncated mid-output — showing the partial response'
        : deg === 'unparseable'
          ? '// trace present but unreadable — showing the model\'s raw response'
          : '// trace unavailable — showing the model\'s raw response';
      bd.appendChild(note);
      if (typeof opts.retry === 'function') appendRegroundBtn(bd, opts.retry);
    } else {
      /* neutral (aborted stream / no-op) */
      chip.className = 'chip dim'; chip.textContent = 'TRACE UNAVAILABLE';
    }
    return;
  }
  chip.className = 'chip';
  if (deg === 'salvaged') { chip.textContent = 'TRACED ~'; chip.title = 'Trace recovered from a non-standard format'; }
  else { chip.textContent = 'TRACED'; chip.title = ''; }
  var tree = document.createElement('div');
  tree.className = 'trace-tree';
  var conf = (typeof trace.confidence === 'number') ? Math.max(0, Math.min(1, trace.confidence)).toFixed(2) : null;
  tree.innerHTML = '<div class="tt mono">TRACE // EVIDENCE CHAIN' + (conf ? '<span class="cf">confidence <b>' + conf + '</b></span>' : '') + '</div>'
    + '<svg class="linkcanvas" aria-hidden="true"></svg>';
  trace.steps.slice(0, 8).forEach(function (step, i) {
    var s = document.createElement('div');
    s.className = 'tstep';
    s.innerHTML = '<span class="sn mono">' + String(i + 1).padStart(2, '0') + '</span><div class="sb"></div>';
    var sb = s.querySelector('.sb');
    var sa = document.createElement('div'); sa.className = 'sa'; sa.textContent = String(step.action || 'step'); sb.appendChild(sa);
    if (step.note) { var sd = document.createElement('div'); sd.className = 'sd'; sd.textContent = String(step.note); sb.appendChild(sd); }
    var evs = Array.isArray(step.evidence) ? step.evidence : [];
    if (evs.length) sb.appendChild(evidenceChipRow(evs, 8));
    tree.appendChild(s);
  });
  bd.appendChild(tree);
  renderActions(bd, trace.actions);

  /* aggregate honesty: how many citations point at files not in context */
  var dead = 0, totalCites = 0;
  trace.steps.forEach(function (step) {
    (Array.isArray(step.evidence) ? step.evidence : []).forEach(function (ev) {
      if (ev && typeof ev.file === 'string') { totalCites++; if (!st.files.has(ev.file)) dead++; }
    });
  });
  if (dead) {
    var dn = document.createElement('div');
    dn.className = 'errline';
    dn.textContent = '// ' + dead + ' of ' + totalCites + ' citation' + (totalCites === 1 ? '' : 's') + ' reference files not in the loaded context — those chips are not verifiable';
    bd.appendChild(dn);
  }

  /* Constellation Link — lines from the trace header to hovered evidence */
  var svg = tree.querySelector('.linkcanvas');
  function drawLinks(activeEl) {
    svg.innerHTML = '';
    svg.setAttribute('width', tree.clientWidth); svg.setAttribute('height', tree.clientHeight);
    var tr = tree.getBoundingClientRect();
    tree.querySelectorAll('.ev:not(.dead)').forEach(function (ev) {
      var er = ev.getBoundingClientRect();
      var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', 14); ln.setAttribute('y1', 10);
      ln.setAttribute('x2', er.left - tr.left + er.width / 2); ln.setAttribute('y2', er.top - tr.top);
      ln.setAttribute('stroke', ev === activeEl ? getComputedStyle(app).getPropertyValue('--accent').trim() : getComputedStyle(app).getPropertyValue('--line').trim());
      ln.setAttribute('stroke-width', '1');
      svg.appendChild(ln);
    });
  }
  if (!prefersReduced()) {
    drawLinks(null);
    tree.querySelectorAll('.ev').forEach(function (ev) {
      ev.addEventListener('mouseenter', function () { drawLinks(ev); });
      ev.addEventListener('mouseleave', function () { drawLinks(null); });
      ev.addEventListener('focus', function () { drawLinks(ev); });
      ev.addEventListener('blur', function () { drawLinks(null); });
    });
  }
}

function evExcerpt(ev) {
  if (!ev || typeof ev.file !== 'string' || !st.files.has(ev.file)) return null;
  var lines = st.files.get(ev.file).content.split('\n');
  var a = Math.max(1, parseInt(ev.startLine, 10) || 1);
  var b = Math.max(a, parseInt(ev.endLine, 10) || a);
  b = Math.min(b, lines.length, a + 19); /* cap excerpts at 20 lines */
  if (a > lines.length) return null;
  var out = [];
  for (var i = a; i <= b; i++) out.push(i + '│' + lines[i - 1]);
  return out.join('\n');
}

/* one exchange as Markdown — shared by the full-session export and the per-answer
   [ COPY ] button so both stay identical. i is the 0-based index within the session. */
function exchangeMarkdown(x, i) {
  var L = [];
  L.push('## ' + (i + 1) + '. ' + x.q.replace(/\s+/g, ' ').slice(0, 120));
  L.push('');
  L.push('`' + x.model + ' · ' + x.provider + ' · ' + new Date(x.ts).toISOString() + '`');
  L.push('');
  L.push('> ' + x.q.replace(/\n/g, '\n> '));
  L.push('');
  L.push(x.answer);
  L.push('');
  if (x.trace && Array.isArray(x.trace.steps)) {
    L.push('### Trace' + (typeof x.trace.confidence === 'number' ? ' — confidence ' + x.trace.confidence.toFixed(2) : ''));
    L.push('');
    x.trace.steps.forEach(function (step, n) {
      L.push((n + 1) + '. **' + String(step.action || 'step') + '**' + (step.note ? ' — ' + String(step.note) : ''));
      (Array.isArray(step.evidence) ? step.evidence : []).forEach(function (ev) {
        if (!ev || typeof ev.file !== 'string') return;
        L.push('   - `' + ev.file + ':' + ev.startLine + '–' + ev.endLine + '`' + (ev.quote ? ' — “' + String(ev.quote) + '”' : ''));
        var ex = evExcerpt(ev);
        if (ex) {
          L.push('');
          L.push('     ```');
          ex.split('\n').forEach(function (l) { L.push('     ' + l); });
          L.push('     ```');
          L.push('');
        }
      });
    });
    if (Array.isArray(x.trace.actions) && x.trace.actions.length) {
      L.push('');
      L.push('### Proposed actions (never executed by meridian)');
      x.trace.actions.forEach(function (a) {
        if (a && a.command) L.push('- `' + String(a.command) + '`' + (a.why ? ' — ' + String(a.why) : ''));
      });
    }
    L.push('');
  } else {
    L.push('_trace unavailable for this exchange_');
    L.push('');
  }
  return L.join('\n');
}
export { addAiMsg, addUserMsg, attachCopy, convoIn, evExcerpt, exchangeMarkdown, extractTrace, renderFound, renderRich, renderTrace, scrollEnd };
