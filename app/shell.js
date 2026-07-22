import { st } from './state.js';
import { $, app, esc, lsDel, lsGet, lsSet, toast, trap } from './helpers.js';
import { LS, MODELS, PROVIDERS } from './config.js';
import { maybeAutoSmart, renderBudget } from './ingest.js';
import { wipeMemory } from './memory.js';
st.curProvider = lsGet(LS.provider);
if (!PROVIDERS[st.curProvider]) st.curProvider = 'anthropic';

/* the custom provider is one synthetic MODELS entry, refreshed from settings */
function syncCustomModel() {
  var id = lsGet(LS.cmodel) || '';
  MODELS.__custom = { provider: 'custom', label: (id || 'CUSTOM — SET MODEL').toUpperCase().slice(0, 24), ctx: 200000,
                      rIn: 0, rOut: 0, rCacheW: 0, rCacheR: 0, unknownRates: true,
                      note: (id ? id : 'custom endpoint') + ' — rates unknown; context window assumed 200K. configure under PROVIDER in settings.' };
}
syncCustomModel();

st.model = lsGet(LS.model);
if (!MODELS[st.model]) st.model = 'claude-sonnet-5';
if (MODELS[st.model].provider !== st.curProvider) {
  st.model = st.curProvider === 'custom' ? '__custom'
    : Object.keys(MODELS).filter(function (id) { return MODELS[id].provider === st.curProvider; })[0];
}

var modelsel = $('modelsel');
function syncModelSel() {
  modelsel.innerHTML = '';
  var ids = st.curProvider === 'custom' ? ['__custom']
    : Object.keys(MODELS).filter(function (id) { return MODELS[id].provider === st.curProvider; });
  ids.forEach(function (id) {
    var o = document.createElement('option');
    o.value = id; o.textContent = MODELS[id].label;
    modelsel.appendChild(o);
  });
  if (ids.indexOf(st.model) === -1) st.model = ids[0];
  modelsel.value = st.model;
  lsSet(LS.model, st.model);
  syncModelNote();
}
function syncModelNote() {
  var m = MODELS[st.model];
  $('modelnote').textContent = m.unknownRates
    ? '// ' + m.note
    : '// ' + m.note + ' rates ≈ $' + m.rIn + ' / $' + m.rOut + ' per MTok in/out, billed by ' + PROVIDERS[m.provider].label.toLowerCase() + '.';
}
modelsel.addEventListener('change', function () {
  st.model = modelsel.value; lsSet(LS.model, st.model);
  syncModelNote(); renderBudget(); maybeAutoSmart();
});
syncModelSel();

/* ============ MODE ============ */
var modebtn = $('modebtn'), modebtn2 = $('modebtn2');
function setMode(m) {
  app.dataset.mode = m; lsSet(LS.mode, m);
  var label = 'MODE: ' + (m === 'dark' ? 'CEREMONY' : 'DAYLIGHT');
  modebtn.textContent = label; modebtn2.textContent = label;
}
setMode(lsGet(LS.mode) === 'light' ? 'light' : 'dark');
function flipMode() { setMode(app.dataset.mode === 'dark' ? 'light' : 'dark'); }
modebtn.addEventListener('click', flipMode);
modebtn2.addEventListener('click', flipMode);

/* ============ FIRST RUN ============ */
var firstveil = $('firstveil');
var accepted = null;
try { accepted = JSON.parse(lsGet(LS.accepted) || 'null'); } catch (e) {}
var untrapFR = null;
if (!accepted || accepted.version !== 1) {
  firstveil.classList.add('on');
  untrapFR = trap($('firstrun'));
  $('fr-accept').focus();
}
/* accept the terms record and drop the veil — the demo path reuses this */
function dismissFirstRun() {
  lsSet(LS.accepted, JSON.stringify({ ts: Date.now(), version: 1 }));
  firstveil.classList.remove('on');
  if (untrapFR) untrapFR();
}
$('fr-accept').addEventListener('click', function () {
  dismissFirstRun();
  $('prompt').focus();
});

/* ============ SETTINGS DRAWER + KEY ============ */
var drawer = $('drawer'), setbtn = $('setbtn');
function keyMasked(k) { return k.length > 12 ? k.slice(0, 10) + '…' + k.slice(-4) : '…' + k.slice(-4); }
function curKeyLS() { return PROVIDERS[st.curProvider].keyLS; }
function syncKeyState() {
  var k = lsGet(curKeyLS());
  $('keystate').innerHTML = k
    ? 'key held: <span class="on">' + esc(keyMasked(k)) + '</span> — in this browser only'
    : (st.curProvider === 'custom' ? 'no key saved — fine for local endpoints that need none.' : 'no key saved. requests cannot run without one.');
}

/* provider switching */
var provsel = $('provsel');
provsel.value = st.curProvider;
function syncProviderUI() {
  provsel.value = st.curProvider;
  $('navprov').value = st.curProvider;
  $('provnote').textContent = PROVIDERS[st.curProvider].note;
  $('keysec').hidden = st.curProvider === 'local';
  if (st.curProvider !== 'local') {
    $('keyhd').textContent = PROVIDERS[st.curProvider].label + ' API KEY';
    $('keyin').placeholder = PROVIDERS[st.curProvider].keyHint;
  }
  $('customcfg').hidden = st.curProvider !== 'custom';
  if (st.curProvider === 'custom') {
    $('custurl').value = lsGet(LS.curl) || '';
    $('custmodel').value = lsGet(LS.cmodel) || '';
  }
  syncKeyState();
  syncModelSel();
  renderBudget();
}
/* setProvider is the single switch point — reused by the drawer select, the
   nav quick-switch, and the first-run demo. syncProviderUI keeps both selects
   and the key/model UI in agreement. */
function setProvider(p) {
  if (!PROVIDERS[p]) return;
  st.curProvider = p;
  lsSet(LS.provider, st.curProvider);
  syncProviderUI();
  maybeAutoSmart();
}
provsel.addEventListener('change', function () { setProvider(provsel.value); });
$('navprov').addEventListener('change', function () { setProvider($('navprov').value); });
function setCustState(msg, kind) {
  var el = $('custstate');
  el.textContent = msg ? '// ' + msg : '';
  el.style.color = kind === 'err' ? 'var(--err)' : kind === 'ok' ? 'var(--ok)' : 'var(--ink-3)';
}
/* validate + normalize a custom OpenAI-compatible base URL; warns (does not block)
   on a missing /v1 suffix and on non-localhost http:// (mixed-content on an https page) */
function validateCustomUrl(u) {
  if (!u) return { ok: false, msg: 'enter a base URL (e.g. http://localhost:11434/v1)' };
  var parsed;
  try { parsed = new URL(u); } catch (e) { return { ok: false, msg: 'not a valid URL' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, msg: 'URL must be http:// or https://' };
  var warn = '';
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(parsed.hostname);
  if (parsed.protocol === 'http:' && !isLocal) warn += 'http:// works only for localhost on this https page (browsers block mixed content). ';
  if (!/\/v\d+\/?$/.test(parsed.pathname)) warn += 'most OpenAI-compatible servers expect a /v1 suffix. ';
  return { ok: true, msg: warn.trim(), warn: warn.trim() };
}
$('custsave').addEventListener('click', function () {
  var u = $('custurl').value.trim().replace(/\/+$/, '');
  var m = $('custmodel').value.trim();
  var v = validateCustomUrl(u);
  if (u && !v.ok) { setCustState(v.msg, 'err'); toast('Endpoint URL invalid — ' + v.msg + '.'); return; }
  if (u) lsSet(LS.curl, u); else lsDel(LS.curl);
  if (m) lsSet(LS.cmodel, m); else lsDel(LS.cmodel);
  syncCustomModel(); syncModelSel(); renderBudget();
  setCustState(u && m ? ('saved.' + (v.warn ? ' ' + v.warn : '')) : '', v.warn ? 'note' : 'ok');
  toast(u && m ? 'Custom endpoint saved.' : 'Custom endpoint needs both a base URL and a model id.');
});
/* EXPERIMENTAL: probe the endpoint's /models to report reachability, CORS, and latency */
$('custtest').addEventListener('click', function () {
  var u = $('custurl').value.trim().replace(/\/+$/, '');
  var v = validateCustomUrl(u);
  if (!v.ok) { setCustState(v.msg, 'err'); return; }
  setCustState('testing…', 'note');
  var headers = {}, k = lsGet(LS.ckey) || '';
  if (k) headers.authorization = 'Bearer ' + k;
  var t0 = (window.performance && performance.now) ? performance.now() : 0;
  var ctrl = new AbortController(), to = setTimeout(function () { ctrl.abort(); }, 8000);
  fetch(u + '/models', { method: 'GET', headers: headers, signal: ctrl.signal }).then(function (res) {
    clearTimeout(to);
    var ms = t0 ? ' · ' + Math.round(performance.now() - t0) + ' ms' : '';
    if (res.ok || res.status === 401 || res.status === 400) setCustState('reachable' + ms + (res.status === 401 ? ' (needs a key)' : ''), 'ok');
    else setCustState('reached, HTTP ' + res.status + ' — check the base path' + ms, 'note');
  }).catch(function (err) {
    clearTimeout(to);
    setCustState(err.name === 'AbortError' ? 'timed out (>8s) — is the server running?' : 'unreachable or CORS-blocked — the server must allow browser CORS from this origin', 'err');
  });
});
/* syncProviderUI() is called in the init block at the end of the script —
   it touches the budget UI, which needs the context engine set up first. */
function openDrawer(open) {
  drawer.classList.toggle('open', open);
  setbtn.setAttribute('aria-expanded', String(open));
  if (open) $('keyin').focus();
}
setbtn.addEventListener('click', function () { openDrawer(!drawer.classList.contains('open')); });
$('savekey').addEventListener('click', function () {
  var v = $('keyin').value.trim();
  if (!v) { toast('Paste a key first.'); return; }
  if (st.curProvider === 'anthropic' && v.indexOf('sk-ant-') !== 0) { toast('That does not look like an Anthropic key (sk-ant-…). Saved anyway.'); }
  lsSet(curKeyLS(), v);
  $('keyin').value = '';
  syncKeyState();
  toast(PROVIDERS[st.curProvider].label + ' key saved — in this browser only.');
});
$('keyin').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); $('savekey').click(); }
});
$('clearkey').addEventListener('click', function () {
  lsDel(curKeyLS()); syncKeyState(); toast(PROVIDERS[st.curProvider].label + ' key removed from this browser.');
});
$('clearall').addEventListener('click', function () {
  Object.keys(LS).forEach(function (k) { lsDel(LS[k]); });
  lsDel('meridian.waitlist');
  wipeMemory();
  toast('All Meridian data cleared from this browser.');
  setTimeout(function () { location.reload(); }, 600);
});

/* mobile rail toggle */
var railbtn = $('railbtn'), rail = $('rail');
railbtn.addEventListener('click', function () {
  var open = !rail.classList.contains('open');
  rail.classList.toggle('open', open);
  railbtn.setAttribute('aria-expanded', String(open));
});
export { curKeyLS, drawer, flipMode, openDrawer, rail, railbtn, syncProviderUI, dismissFirstRun, setProvider, syncModelSel };
