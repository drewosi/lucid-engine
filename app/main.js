/* MERIDIAN Engine v0.2-hardened — resilient trace parsing, multi-language indexing
   (Python/Go/Rust + JS/TS depth), selection-decoupled index, pragmatic CSP, custom-
   endpoint validation, BOM-aware encoding, streaming retries, a11y, and self-tests.

   Entry point. Modules own their functions and wiring; this file fixes the one
   thing that must stay global: the order things initialize in. The init*() calls
   run in the same relative order the statements had in the original single-file
   script — provider/model state first, then context UI, then the final sync pass. */
import { st } from './state.js';
import { $ } from './helpers.js';
import { initShell, syncProviderUI, openDrawer, drawer, rail, railbtn, toggleRail } from './shell.js';
import { initIngest, setCtxMode, closePreview, closeSkipReview, prevveil, skipveil } from './ingest.js';
import { initDemo } from './demo.js';
import { initMemory } from './memory.js';
import { initChat } from './chat.js';
import { initViewer, closeViewer, viewveil } from './viewer.js';
import { initExport, exportTraces } from './export.js';
import { initPalette, palOpen, palClose, palOv, openKeymap, closeKeymap, keymapveil } from './palette.js';
import { runSelfTests, runAndShowSelfTests } from './selftest.js';

initShell();    /* provider + model from localStorage, theme, first-run veil, settings drawer, rail */
initIngest();   /* pickers/dropzone/tree wiring, ground + strict-trace + budget/spend state, ignore patterns */
initDemo();     /* first-run demo buttons */
initMemory();   /* saved-projects list + save wiring */
initChat();     /* composer + streaming controls + cost chip */
initViewer();
initExport();
initPalette();

/* ============ GLOBAL KEYS ============ */
document.addEventListener('keydown', function (e) {
  var mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palOv.classList.contains('on') ? palClose() : palOpen();
    return;
  }
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault(); exportTraces('md'); return;
  }
  if (mod && !e.altKey && !e.shiftKey && e.key === '.') {
    e.preventDefault(); openDrawer(!drawer.classList.contains('open')); return;
  }
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault(); toggleRail(); return;
  }
  if (mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault(); $('dirbtn').click(); return;
  }
  var tag = (document.activeElement && document.activeElement.tagName) || '';
  var inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (e.key === '?' && !inField && !mod) {
    keymapveil.classList.contains('on') ? closeKeymap() : openKeymap();
    return;
  }
  if (e.key === 'Escape') {
    if (palOv.classList.contains('on')) { palClose(); return; }
    if (keymapveil.classList.contains('on')) { closeKeymap(); return; }
    if (viewveil.classList.contains('on')) { closeViewer(); return; }
    if (prevveil.classList.contains('on')) { closePreview(); return; }
    if (skipveil.classList.contains('on')) { closeSkipReview(); return; }
    if (drawer.classList.contains('open')) { openDrawer(false); return; }
    if (rail.classList.contains('open')) { rail.classList.remove('open'); railbtn.setAttribute('aria-expanded', 'false'); return; }
  }
});

syncProviderUI();
setCtxMode(st.ctxMode); /* also renders the budget */
window.__meridianSelfTest = runSelfTests; /* L3: run from the console */
if (/[?&]selftest\b/.test(location.search)) setTimeout(runAndShowSelfTests, 300);
console.log('%cMERIDIAN WORKBENCH', 'color:#FF5C0A;font-weight:bold', '— Engine v0.2-hardened · free beta. zero egress to us; requests go browser → api.anthropic.com under your key. Run __meridianSelfTest() or add ?selftest.');
