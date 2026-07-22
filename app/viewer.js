import { $, copyText, rememberFocus, returnFocus, trap } from './helpers.js';
import { st } from './state.js';
/* ============ FILE VIEWER ============
   ≥1100px the viewer docks as the deck's right detail column (non-modal — the
   chat stays reachable while reading evidence); below that it falls back to a
   focus-trapped overlay. The CSS switch lives in app.css under #viewveil. */
var viewveil = $('viewveil'), untrapView = null;
var dockMQ = window.matchMedia('(min-width: 1100px)');
var curPath = null, curA = 0, curB = 0;
function openViewer(path, a, b) {
  var f = st.files.get(path);
  if (!f) return;
  rememberFocus();
  curPath = path; curA = a; curB = b;
  $('vtitle').textContent = path;
  $('vtitle').title = path;
  $('vrange').textContent = 'L' + a + '–' + b;
  var vb = $('vbody');
  vb.innerHTML = '';
  var frag = document.createDocumentFragment();
  var lines = f.content.split('\n');
  var hitEl = null;
  lines.forEach(function (ln, i) {
    var n = i + 1;
    var row = document.createElement('div');
    row.className = 'ln' + (n >= a && n <= b ? ' hit' : '');
    var no = document.createElement('span'); no.className = 'no'; no.textContent = n;
    var tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = ln === '' ? ' ' : ln;
    row.appendChild(no); row.appendChild(tx);
    if (n === a) hitEl = row;
    frag.appendChild(row);
  });
  vb.appendChild(frag);
  viewveil.classList.add('on');
  applyModality();
  if (hitEl) hitEl.scrollIntoView({ block: 'center' });
  vb.focus();
}
/* docked = non-modal (no trap); overlay = modal + focus trap. Re-applied if the
   viewport crosses the dock boundary while the viewer is open. */
function applyModality() {
  var dialog = viewveil.querySelector('.viewer');
  if (untrapView) { untrapView(); untrapView = null; }
  if (dockMQ.matches) {
    dialog.setAttribute('aria-modal', 'false'); /* docked pane — chat stays interactive */
  } else {
    dialog.setAttribute('aria-modal', 'true');
    untrapView = trap(dialog);
  }
}
function closeViewer() {
  viewveil.classList.remove('on');
  curPath = null;
  if (untrapView) { untrapView(); untrapView = null; }
  returnFocus();
}
/* copy the highlighted range; whole file when the range is empty */
function copyViewed() {
  var f = curPath && st.files.get(curPath);
  if (!f) return;
  var whole = !(curA >= 1) || curB < curA;
  var text = whole ? f.content : f.content.split('\n').slice(curA - 1, curB).join('\n');
  copyText(text, whole
    ? '“' + curPath + '” copied (whole file).'
    : curPath + ' L' + curA + '–' + curB + ' copied.');
}
function initViewer() {
  $('vclose').addEventListener('click', closeViewer);
  $('vcopy').addEventListener('click', copyViewed);
  viewveil.addEventListener('click', function (e) { if (e.target === viewveil) closeViewer(); });
  if (dockMQ.addEventListener) dockMQ.addEventListener('change', function () {
    if (viewveil.classList.contains('on')) applyModality();
  });
}

export { closeViewer, openViewer, viewveil, initViewer };
