/* ============ HELPERS ============ */
var $ = function (id) { return document.getElementById(id); };
var app = $('app');
/* reduced-motion: live so an OS toggle mid-session takes effect */
var reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
var reduced = reducedMQ.matches;
if (reducedMQ.addEventListener) reducedMQ.addEventListener('change', function (e) { reduced = e.matches; });
/* a11y: return focus to the control that opened a modal/palette when it closes */
var layerReturnFocus = null;
function rememberFocus() { layerReturnFocus = document.activeElement; }
function returnFocus() { try { if (layerReturnFocus && layerReturnFocus.focus) layerReturnFocus.focus(); } catch (e) {} layerReturnFocus = null; }
/* a11y: announce completion to screen readers (streamed text isn't in a live region) */
function announce(msg) { var el = $('sr-announce'); if (el) { el.textContent = ''; setTimeout(function () { el.textContent = msg; }, 30); } }
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
function toast(msg, action) {
  var d = document.createElement('div');
  d.className = 'toast';
  var dismiss = function () { d.classList.remove('in'); setTimeout(function () { d.remove(); }, 400); };
  var span = document.createElement('span');
  span.className = 'toast-msg'; span.textContent = msg;
  d.appendChild(span);
  var life = 3600;
  /* optional action button — backward-compatible: single-arg calls are unchanged */
  if (action && action.label && typeof action.fn === 'function') {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-act mono'; b.textContent = action.label;
    b.addEventListener('click', function () { action.fn(); dismiss(); });
    d.appendChild(b);
    d.classList.add('has-act');
    life = 6000; /* give the operator time to reach the action */
  }
  $('toasts').appendChild(d);
  requestAnimationFrame(function () { d.classList.add('in'); });
  setTimeout(dismiss, life);
}
/* one clipboard path for every copy affordance — Clipboard API with a legacy fallback */
function copyText(str, okMsg) {
  var done = function () { toast(okMsg || 'Copied to clipboard.'); };
  var fail = function () { toast('Copy failed — your browser blocked clipboard access.'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(str).then(done, fail);
    return;
  }
  try {
    var ta = document.createElement('textarea');
    ta.value = str; ta.setAttribute('readonly', '');
    ta.style.position = 'absolute'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    var ok = document.execCommand('copy'); document.body.removeChild(ta);
    ok ? done() : fail();
  } catch (e) { fail(); }
}
function fmtTok(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function trap(container) {
  function onKey(e) {
    if (e.key !== 'Tab') return;
    var els = container.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!els.length) return;
    var first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  container.addEventListener('keydown', onKey);
  return function () { container.removeEventListener('keydown', onKey); };
}


/* status line (composer) — lives here so ingest/indexer can report without importing chat */
var statusEl = $('status');
function setStatus(txt, isErr) {
  statusEl.textContent = txt;
  statusEl.className = isErr ? 'err' : '';
}

/* reduced-motion is tracked live; expose a getter so other modules see updates */
export function prefersReduced() { return reduced; }

export { $, app, esc, lsGet, lsSet, lsDel, toast, copyText, fmtTok, announce, rememberFocus, returnFocus, trap, setStatus };
