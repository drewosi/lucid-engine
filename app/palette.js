import { $, rememberFocus, returnFocus, setStatus, toast } from './helpers.js';
import { st } from './state.js';
import { convoIn } from './trace.js';
import { openPreview, openSkipReview, setCtxMode, suggestIgnore } from './ingest.js';
import { promptEl, resetCost } from './chat.js';
import { exportTraces } from './export.js';
import { flipMode, openDrawer, toggleRail } from './shell.js';
import { startDemo } from './demo.js';
import { askLocal } from './local.js';
import { runAndShowSelfTests } from './selftest.js';

/* ============ COMMAND PALETTE (Ctrl/Cmd-K) ============
   Every palette action also exists as a visible control — the palette is
   the L2 power path, never the only path. */
var palOv = $('palette'), palIn = $('pal-in'), palList = $('pal-list');
function clearConversation() {
  if (st.streaming && st.aborter) st.aborter.abort();
  st.history.length = 0; st.transcript.length = 0;
  convoIn.innerHTML = '';
  setStatus('CORE IDLE — conversation cleared');
  toast('Conversation cleared — loaded files stay in memory.');
}
var ACTIONS = [
  { g: 'CONTEXT', n: 'Show / hide the context sidebar', k: 'ctrl B', f: toggleRail },
  { g: 'CONTEXT', n: 'Pick project folder', k: 'ctrl⇧O', f: function () { $('dirbtn').click(); } },
  { g: 'CONTEXT', n: 'Pick files', k: '', f: function () { $('filepick').click(); } },
  { g: 'CONTEXT', n: 'Toggle smart / full context', k: '', f: function () { setCtxMode(st.ctxMode === 'smart' ? 'full' : 'smart'); toast('Context mode: ' + st.ctxMode.toUpperCase() + '.'); } },
  { g: 'CONTEXT', n: 'Preview what will be sent', k: '', f: openPreview },
  { g: 'CONTEXT', n: 'Review skipped files', k: '', f: function () { if (st.skippedFiles.length) openSkipReview(); else toast('No skipped files recorded.'); } },
  { g: 'CONTEXT', n: 'Select all files', k: '', f: function () { $('selall').click(); } },
  { g: 'CONTEXT', n: 'Select no files', k: '', f: function () { $('selnone').click(); } },
  { g: 'CONTEXT', n: 'Unload project', k: '', f: function () { $('clearctx').click(); } },
  { g: 'PROJECTS', n: 'Save project (tree + settings)', k: '', f: function () { $('saveproj').click(); } },
  { g: 'CONVERSE', n: 'Focus composer', k: '', f: function () { promptEl.focus(); } },
  { g: 'CONVERSE', n: 'Stop streaming', k: '', f: function () { if (st.aborter) st.aborter.abort(); } },
  { g: 'CONVERSE', n: 'Clear conversation', k: '', f: clearConversation },
  { g: 'EXPORT', n: 'Export session as Markdown', k: 'ctrl E', f: function () { exportTraces('md'); } },
  { g: 'EXPORT', n: 'Export session as HTML', k: '', f: function () { exportTraces('html'); } },
  { g: 'CONTEXT', n: 'Suggest ignore patterns', k: '', f: function () { openDrawer(true); suggestIgnore(); } },
  { g: 'CONVERSE', n: 'Reset session cost', k: '', f: resetCost },
  { g: 'LOCAL', n: 'Scan for TODO / FIXME tags', k: '', f: function () { askLocal('todos'); } },
  { g: 'LOCAL', n: 'Find circular imports', k: '', f: function () { askLocal('cycles'); } },
  { g: 'LOCAL', n: 'Find orphan (never-imported) files', k: '', f: function () { askLocal('orphans'); } },
  { g: 'LOCAL', n: 'List env vars the code reads', k: '', f: function () { askLocal('env'); } },
  { g: 'LOCAL', n: 'Find files without tests', k: '', f: function () { askLocal('untested'); } },
  { g: 'SETTINGS', n: 'Open settings', k: 'ctrl .', f: function () { openDrawer(true); } },
  { g: 'SETTINGS', n: 'Load the demo project (LOCAL)', k: '', f: function () { startDemo(); } },
  { g: 'SETTINGS', n: 'Toggle ceremony / daylight', k: '', f: flipMode },
  { g: 'SETTINGS', n: 'Show keymap', k: '?', f: openKeymap },
  { g: 'SETTINGS', n: 'Open the user guide (GitHub)', k: '', f: function () { window.open('https://github.com/drewosi/lucid-engine/blob/main/USER-GUIDE.md', '_blank', 'noopener'); } },
  { g: 'SETTINGS', n: 'Run self-tests (dev)', k: '', f: runAndShowSelfTests }
];
var palSel = 0, palMatches = [];
function fuzzy(q, s) {
  q = q.toLowerCase(); s = s.toLowerCase();
  var i = 0, j = 0;
  while (i < q.length && j < s.length) { if (q[i] === s[j]) i++; j++; }
  return i === q.length;
}
function palRender() {
  var q = palIn.value.trim();
  palMatches = ACTIONS.filter(function (a) { return !q || fuzzy(q, a.g + ' ' + a.n); });
  palSel = Math.min(palSel, Math.max(0, palMatches.length - 1));
  palList.innerHTML = '';
  if (!palMatches.length) {
    palList.innerHTML = '<div class="pal-empty">// no matching command — esc to close</div>';
    return;
  }
  palMatches.forEach(function (a, i) {
    var d = document.createElement('div');
    d.className = 'pal-row' + (i === palSel ? ' sel' : '');
    d.setAttribute('role', 'option');
    d.setAttribute('aria-selected', String(i === palSel));
    d.innerHTML = '<span class="grp mono"></span><span class="nm"></span>' + (a.k ? '<kbd></kbd>' : '');
    d.children[0].textContent = a.g;
    d.children[1].textContent = a.n;
    if (a.k) d.children[2].textContent = a.k;
    d.addEventListener('click', function () { palExec(i); });
    d.addEventListener('mousemove', function () { if (palSel !== i) { palSel = i; palRender(); } });
    palList.appendChild(d);
  });
}
function palOpen() { rememberFocus(); palOv.classList.add('on'); palIn.value = ''; palSel = 0; palRender(); palIn.focus(); }
function palClose() { palOv.classList.remove('on'); palIn.blur(); returnFocus(); }
function palExec(i) { var a = palMatches[i]; if (!a) return; palClose(); a.f(); }

var keymapveil = $('keymapveil');
function openKeymap() { rememberFocus(); keymapveil.classList.add('on'); $('keymapclose').focus(); }
function closeKeymap() { keymapveil.classList.remove('on'); returnFocus(); }
export { closeKeymap, keymapveil, openKeymap, palClose, palOpen, palOv };

export function initPalette() {
  palIn.addEventListener('input', function () { palSel = 0; palRender(); });
  palIn.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palMatches.length - 1); palRender(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); palRender(); }
    else if (e.key === 'Enter') { e.preventDefault(); palExec(palSel); }
    else if (e.key === 'Escape') { palClose(); }
  });
  palOv.addEventListener('click', function (e) { if (e.target === palOv) palClose(); });
  $('palbtn').addEventListener('click', palOpen);
  $('keysbtn').addEventListener('click', openKeymap);
  $('keymaphint').addEventListener('click', openKeymap);
  $('keymapclose').addEventListener('click', closeKeymap);
  keymapveil.addEventListener('click', function (e) { if (e.target === keymapveil) closeKeymap(); });
}
