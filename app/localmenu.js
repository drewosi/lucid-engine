import { $, rememberFocus, returnFocus, trap } from './helpers.js';
import { LOCAL_MENU, LOCAL_STARTERS } from './intents.js';
/* ============ LOCAL QUESTION MENU ============
   Discoverability for the deterministic engine: a modal catalog of everything you
   can ask ("what can I ask") plus a starter set of chips in the empty state. Both
   are generated from LOCAL_MENU / LOCAL_STARTERS in the intent registry, so they
   cannot drift from what the engine actually answers. A click drops the question
   into the composer (and selects an <arg> placeholder if present) — it never runs
   on its own, so it stays correct whichever provider is active.                */

var localmenuveil = $('localmenuveil');
var untrap = null;

/* drop a question into the composer, focus it, and if it carries an <arg>
   placeholder, select that placeholder so the next keystroke replaces it */
function fillComposer(text) {
  var el = $('prompt');
  if (!el) return;
  el.value = text;
  el.focus();
  var lt = text.indexOf('<'), gt = text.indexOf('>');
  if (lt !== -1 && gt > lt) { try { el.setSelectionRange(lt, gt + 1); } catch (e) {} }
  else { try { el.setSelectionRange(text.length, text.length); } catch (e) {} }
  try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
}

function renderMenuBody() {
  var body = $('localmenubody');
  if (!body || body.childElementCount) return; /* build once, then reuse */
  LOCAL_MENU.forEach(function (grp) {
    var h = document.createElement('div');
    h.className = 'lm-grp mono';
    h.textContent = grp.group;
    body.appendChild(h);
    var wrap = document.createElement('div');
    wrap.className = 'lm-items';
    grp.items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'lm-item';
      b.innerHTML = '<span class="lm-l"></span><span class="lm-c mono"></span>';
      b.querySelector('.lm-l').textContent = it.label;
      b.querySelector('.lm-c').textContent = it.fill;
      b.title = 'Drop “' + it.fill + '” into the composer';
      b.addEventListener('click', function () { closeLocalMenu(); fillComposer(it.fill); });
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
  });
}

function openLocalMenu() {
  renderMenuBody();
  rememberFocus();
  localmenuveil.classList.add('on');
  untrap = trap(localmenuveil.querySelector('.modal'));
  var first = localmenuveil.querySelector('.lm-item');
  if (first) first.focus();
}
function closeLocalMenu() {
  localmenuveil.classList.remove('on');
  if (untrap) { untrap(); untrap = null; }
  returnFocus();
}

/* empty-state starter chips — rendered once into #emptyasks. They fill the
   composer (not run), so they're safe before a project is even loaded. */
function renderStarters() {
  var host = $('emptyasks');
  if (!host || host.childElementCount) return;
  LOCAL_STARTERS.forEach(function (q) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'ask-chip mono';
    b.textContent = q;
    b.addEventListener('click', function () { fillComposer(q); });
    host.appendChild(b);
  });
}

function initLocalMenu() {
  renderStarters();
  var btn = $('localmenubtn');
  if (btn) btn.addEventListener('click', openLocalMenu);
  var close = $('localmenuclose');
  if (close) close.addEventListener('click', closeLocalMenu);
  if (localmenuveil) localmenuveil.addEventListener('click', function (e) { if (e.target === localmenuveil) closeLocalMenu(); });
}

export { initLocalMenu, openLocalMenu, closeLocalMenu, localmenuveil };
