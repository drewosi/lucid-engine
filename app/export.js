import { st } from './state.js';
import { evExcerpt, exchangeMarkdown, renderRich } from './trace.js';
import { $, esc, toast } from './helpers.js';
/* ============ EXPORT TRACES ============
   Exports the whole session — questions, answers, traces, and the ACTUAL
   cited lines pulled live from the loaded files — as Markdown or a
   self-contained HTML page with zero external assets. */

function download(name, mime, text) {
  var a = document.createElement('a');
  var url = URL.createObjectURL(new Blob([text], { type: mime }));
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
}

function buildMarkdown() {
  var L = ['# MERIDIAN session trace', '',
    '_exported ' + new Date().toISOString() + ' — AI output can be wrong or incomplete; verify before relying on it._', ''];
  st.transcript.forEach(function (x, i) { L.push(exchangeMarkdown(x, i)); });
  return L.join('\n');
}

function buildExportHTML() {
  var css = 'body{background:#0A0B0D;color:#EDECE7;font-family:"Helvetica Neue","Segoe UI",Arial,sans-serif;line-height:1.6;max-width:860px;margin:40px auto;padding:0 20px}'
    + '.mono,code,pre,h2 .n,.meta{font-family:"Cascadia Code","JetBrains Mono",ui-monospace,Consolas,monospace}'
    + 'h1{font-size:22px;letter-spacing:.02em}h1 .tag{font-size:10px;color:#6C6B66;letter-spacing:.14em;margin-left:10px}'
    + '.note,.meta{font-size:11px;color:#6C6B66;letter-spacing:.04em}'
    + 'section{border:1px solid #34363E;border-radius:4px;padding:18px 20px;margin:22px 0;background:#101216}'
    + 'h2{font-size:14px;margin:0 0 6px}h2 .n{color:#FF5C0A;font-size:11px;margin-right:8px}'
    + '.q{color:#A9A8A1;font-size:12.5px;white-space:pre-wrap;border-left:2px solid #34363E;padding:6px 12px;margin:10px 0}'
    + '.answer{font-size:13px;white-space:pre-wrap;word-break:break-word}'
    + '.answer code{background:#14171C;border:1px solid #22242A;border-radius:3px;padding:0 5px;font-size:12px}'
    + '.answer pre{background:#0A0B0D;border:1px solid #22242A;border-radius:3px;padding:12px 14px;overflow-x:auto}'
    + '.answer pre code{background:none;border:none;padding:0}'
    + '.trace{border-top:1px dashed #34363E;margin-top:14px;padding-top:12px}'
    + '.trace h3{font-size:10px;letter-spacing:.14em;color:#6C6B66;margin:0 0 10px}.trace h3 b{color:#FF5C0A}'
    + '.step{margin:8px 0}.step .sn{color:#FF5C0A;font-size:10px;margin-right:8px}'
    + '.step .sa{font-size:12.5px}.step .sd{font-size:11.5px;color:#A9A8A1}'
    + '.evb{font-size:10.5px;color:#A9A8A1;margin:6px 0 2px}.evb code{color:#EDECE7}'
    + 'pre.ex{background:#0A0B0D;border:1px solid #22242A;border-left:2px solid #FF5C0A;border-radius:3px;padding:10px 12px;font-size:11.5px;overflow-x:auto;margin:4px 0 10px}'
    + '.acts{border-top:1px dashed #34363E;margin-top:12px;padding-top:10px;font-size:11.5px;color:#A9A8A1}';
  var h = ['<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MERIDIAN session trace</title><style>' + css + '</style></head><body>'];
  h.push('<h1>MERIDIAN<span class="tag">SESSION TRACE — SELF-CONTAINED EXPORT</span></h1>');
  h.push('<p class="note">exported ' + esc(new Date().toISOString()) + ' — AI output can be wrong or incomplete; verify before relying on it. evidence excerpts were pulled from the files as loaded at export time.</p>');
  st.transcript.forEach(function (x, i) {
    h.push('<section>');
    h.push('<h2><span class="n">' + String(i + 1).padStart(2, '0') + '</span>' + esc(x.q.replace(/\s+/g, ' ').slice(0, 120)) + '</h2>');
    h.push('<p class="meta">' + esc(x.model + ' · ' + x.provider + ' · ' + new Date(x.ts).toISOString()) + '</p>');
    h.push('<div class="q mono">&gt; ' + esc(x.q) + '</div>');
    h.push('<div class="answer mono">' + renderRich(x.answer) + '</div>');
    if (x.trace && Array.isArray(x.trace.steps)) {
      h.push('<div class="trace"><h3 class="mono">TRACE // EVIDENCE CHAIN' + (typeof x.trace.confidence === 'number' ? ' — CONFIDENCE <b>' + x.trace.confidence.toFixed(2) + '</b>' : '') + '</h3>');
      x.trace.steps.forEach(function (step, n) {
        h.push('<div class="step"><span class="sn mono">' + String(n + 1).padStart(2, '0') + '</span><span class="sa">' + esc(String(step.action || 'step')) + '</span>'
          + (step.note ? '<div class="sd">' + esc(String(step.note)) + '</div>' : ''));
        (Array.isArray(step.evidence) ? step.evidence : []).forEach(function (ev) {
          if (!ev || typeof ev.file !== 'string') return;
          h.push('<div class="evb mono">ctx://<code>' + esc(ev.file + ':' + ev.startLine + '–' + ev.endLine) + '</code>' + (ev.quote ? ' — “' + esc(String(ev.quote)) + '”' : '') + '</div>');
          var ex = evExcerpt(ev);
          if (ex) h.push('<pre class="ex mono">' + esc(ex) + '</pre>');
        });
        h.push('</div>');
      });
      h.push('</div>');
      if (Array.isArray(x.trace.actions) && x.trace.actions.length) {
        h.push('<div class="acts mono">proposed actions (never executed): ' + x.trace.actions.map(function (a) {
          return a && a.command ? '<code>' + esc(String(a.command)) + '</code>' : '';
        }).join(' · ') + '</div>');
      }
    }
    h.push('</section>');
  });
  h.push('<p class="note">generated by the MERIDIAN workbench — a browser-only instrument. no servers, no tracking, zero external assets in this file.</p>');
  h.push('</body></html>');
  return h.join('\n');
}

function exportTraces(fmt) {
  if (!st.transcript.length) { toast('Nothing to export yet — ask something first.'); return; }
  var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  if (fmt === 'html') download('meridian-trace-' + stamp + '.html', 'text/html', buildExportHTML());
  else download('meridian-trace-' + stamp + '.md', 'text/markdown', buildMarkdown());
  toast('Exported ' + st.transcript.length + ' exchange' + (st.transcript.length === 1 ? '' : 's') + ' as ' + (fmt === 'html' ? 'HTML' : 'Markdown') + '.');
}
function initExport() {
  $('exportmd').addEventListener('click', function () { exportTraces('md'); });
  $('exporthtml').addEventListener('click', function () { exportTraces('html'); });
}
export { exportTraces, initExport };
