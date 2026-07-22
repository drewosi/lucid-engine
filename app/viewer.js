import { $, rememberFocus, returnFocus, trap } from './helpers.js';
import { st } from './state.js';
/* ============ FILE VIEWER ============ */
var viewveil = $('viewveil'), untrapView = null;
function openViewer(path, a, b) {
  var f = st.files.get(path);
  if (!f) return;
  rememberFocus();
  $('vtitle').textContent = path;
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
    var tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = ln === '' ? ' ' : ln;
    row.appendChild(no); row.appendChild(tx);
    if (n === a) hitEl = row;
    frag.appendChild(row);
  });
  vb.appendChild(frag);
  viewveil.classList.add('on');
  untrapView = trap(viewveil.querySelector('.viewer'));
  if (hitEl) hitEl.scrollIntoView({ block: 'center' });
  vb.focus();
}
function closeViewer() {
  viewveil.classList.remove('on');
  if (untrapView) { untrapView(); untrapView = null; }
  returnFocus();
}
function initViewer() {
  $('vclose').addEventListener('click', closeViewer);
  viewveil.addEventListener('click', function (e) { if (e.target === viewveil) closeViewer(); });
}

export { closeViewer, openViewer, viewveil, initViewer };
