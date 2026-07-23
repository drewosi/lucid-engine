import { $, copyText, rememberFocus, returnFocus, trap } from './helpers.js';
import { st } from './state.js';
/* ============ FILE VIEWER ============
   ≥1100px the viewer docks as the deck's right detail column (non-modal — the
   chat stays reachable while reading evidence); below that it falls back to a
   focus-trapped overlay. The CSS switch lives in app.css under #viewveil. */
var viewveil = $('viewveil'), untrapView = null;
var dockMQ = window.matchMedia('(min-width: 1100px)');
var curPath = null, curA = 0, curB = 0;
/* Windowed rendering: a 512KB file is 15-20K lines — building a DOM row for
   every one froze the tab on exactly the files evidence points into. Render
   ±WIN lines around the highlight anchor; sentinel buttons extend the window.
   Line numbers stay true, so citations remain verifiable. */
var WIN = 400;
var curQuote = '', quoteDone = false;
function buildRow(lines, n) {
  var row = document.createElement('div');
  row.className = 'ln' + (n >= curA && n <= curB ? ' hit' : '');
  var no = document.createElement('span'); no.className = 'no'; no.textContent = n;
  var tx = document.createElement('span'); tx.className = 'tx';
  var text = lines[n - 1] === '' ? ' ' : lines[n - 1];
  var qi;
  /* the cited quote, highlighted once, inside the cited range only */
  if (!quoteDone && curQuote && n >= curA && n <= curB && (qi = text.indexOf(curQuote)) !== -1) {
    quoteDone = true;
    tx.appendChild(document.createTextNode(text.slice(0, qi)));
    var mk = document.createElement('mark');
    mk.className = 'qhit'; mk.textContent = curQuote;
    tx.appendChild(mk);
    tx.appendChild(document.createTextNode(text.slice(qi + curQuote.length)));
  } else tx.textContent = text;
  row.appendChild(no); row.appendChild(tx);
  return row;
}
function buildRows(lines, from, to) {
  var frag = document.createDocumentFragment();
  for (var n = from; n <= to; n++) frag.appendChild(buildRow(lines, n));
  return frag;
}
function openViewer(path, a, b, quote) {
  var f = st.files.get(path);
  if (!f) return;
  rememberFocus();
  curPath = path; curA = a; curB = b;
  /* normalized exactly like the chip-tooltip verification, so what verified is what highlights */
  curQuote = quote ? String(quote).trim().slice(0, 60) : '';
  quoteDone = false;
  $('vtitle').textContent = path;
  $('vtitle').title = path;
  $('vrange').textContent = 'L' + a + '–' + b;
  var vb = $('vbody');
  vb.innerHTML = '';
  var lines = f.content.split('\n');
  var anchor = a >= 1 ? Math.min(a, lines.length) : 1;
  var winFrom = Math.max(1, anchor - WIN);
  var winTo = Math.min(lines.length, anchor + WIN);
  var up = document.createElement('button');
  up.type = 'button'; up.className = 'vmore mono'; up.id = 'vmoreup';
  var down = document.createElement('button');
  down.type = 'button'; down.className = 'vmore mono'; down.id = 'vmoredown';
  function syncSentinels() {
    var upN = Math.min(WIN, winFrom - 1), downN = Math.min(WIN, lines.length - winTo);
    up.hidden = upN <= 0;
    up.textContent = '[ SHOW ' + upN + ' EARLIER LINE' + (upN === 1 ? '' : 'S') + ' ]';
    down.hidden = downN <= 0;
    down.textContent = '[ SHOW ' + downN + ' MORE LINE' + (downN === 1 ? '' : 'S') + ' ]';
  }
  up.addEventListener('click', function () {
    var newFrom = Math.max(1, winFrom - WIN);
    /* prepending grows scrollHeight above the viewport — compensate so the view doesn't jump */
    var prevH = vb.scrollHeight;
    vb.insertBefore(buildRows(lines, newFrom, winFrom - 1), up.nextSibling);
    vb.scrollTop += vb.scrollHeight - prevH;
    winFrom = newFrom;
    syncSentinels();
  });
  down.addEventListener('click', function () {
    var newTo = Math.min(lines.length, winTo + WIN);
    vb.insertBefore(buildRows(lines, winTo + 1, newTo), down);
    winTo = newTo;
    syncSentinels();
  });
  vb.appendChild(up);
  vb.appendChild(buildRows(lines, winFrom, winTo));
  vb.appendChild(down);
  syncSentinels();
  var hitEl = null;
  if (a >= 1) {
    var rows = vb.querySelectorAll('.ln');
    hitEl = rows[anchor - winFrom] || null; /* row for line `anchor` within the window */
  }
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
