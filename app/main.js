/* MERIDIAN Engine v0.2-hardened — resilient trace parsing, multi-language indexing
   (Python/Go/Rust + JS/TS depth), selection-decoupled index, pragmatic CSP, custom-
   endpoint validation, BOM-aware encoding, streaming retries, a11y, and self-tests. */
import { st, sortedPaths, invalidateSelection, invalidateAll } from './state.js';
import { PROVIDERS, MODELS, LS } from './config.js';
import { $, app, esc, lsGet, lsSet, lsDel, toast, copyText, fmtTok, announce,
         rememberFocus, returnFocus, prefersReduced, trap, setStatus } from './helpers.js';
import { AUTO_SMART_FRAC, CONFIG_NAMES, DOCS_PATH, ENTRY_NAMES, GROUND_EXCERPT_PAD, GROUND_EXCERPT_TOK, GROUND_MAX_CITES, GROUND_MAX_EVIDENCE, GROUND_MAX_TOK, README_NAMES, TEST_PATH, buildProjectMap, detectPackages, estTokens, getBudget, numberLines, packSmartContext, queryTerms, staticScore } from './smart-context.js';
import { buildIndex, detectLang, dirOf, fileExt, getIndex } from './indexer.js';
import { closeViewer, openViewer, viewveil, initViewer } from './viewer.js';
import { localSearchData, renderActions } from './actions.js';
import { addAiMsg, addUserMsg, attachCopy, convoIn, evExcerpt, exchangeMarkdown, extractTrace, renderFound, renderRich, renderTrace, scrollEnd } from './trace.js';
import { exportTraces, initExport } from './export.js';
import { askLocal, classifyIntent, pickSymbol, renderOverview, runInvestigation, symLookup } from './local.js';
import { FENCE, INSTRUCTIONS, STRICT_SUFFIX, buildContextBlocks, buildInvestigationBlock } from './prompt.js';
import { IGNORE_DIRS, afterIngest, closePreview, closeSkipReview, getIgnoreText, ingestFile, maybeAutoSmart, openPreview, openSkipReview, prevveil, renderBudget, selectedTokens, setCtxMode, setIgnoreText, skipveil, suggestIgnore, syncBudgetState } from './ingest.js';
import { wipeMemory, initMemory } from './memory.js';
import { SAMPLE_PROJECT, startDemo } from './demo.js';

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





initMemory();

/* ============ COST ============ */
st.spent = { in: 0, out: 0, cacheW: 0, cacheR: 0 };
function renderCost() {
  var m = MODELS[st.model];
  var navc = $('navcost'), navv = $('navcostval');
  if (st.spent.in + st.spent.out + st.spent.cacheW + st.spent.cacheR === 0) {
    $('costline').textContent = '';
    if (navc) navc.hidden = true;
    return;
  }
  var head = 'SESSION ≈ in ' + fmtTok(st.spent.in + st.spent.cacheW + st.spent.cacheR) + ' · out ' + fmtTok(st.spent.out);
  var breakdown = 'in ' + fmtTok(st.spent.in) + ' · cache-write ' + fmtTok(st.spent.cacheW) + ' · cache-read ' + fmtTok(st.spent.cacheR) + ' · out ' + fmtTok(st.spent.out);
  if (navc) navc.hidden = false;
  if (m.unknownRates) {
    $('costline').textContent = head + ' · rates unknown';
    if (navc) { navv.textContent = '≈ ' + fmtTok(st.spent.in + st.spent.cacheW + st.spent.cacheR) + ' tok'; navc.title = 'Rates unknown for ' + m.label + '. Tokens this session — ' + breakdown + '. ↺ resets.'; }
    return;
  }
  var usd = (st.spent.in * m.rIn + st.spent.out * m.rOut + st.spent.cacheW * m.rCacheW + st.spent.cacheR * m.rCacheR) / 1e6;
  var usdStr = '$' + (usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2));
  $('costline').textContent = head + ' · ' + usdStr + ' est';
  if (navc) { navv.textContent = usdStr; navc.title = usdStr + ' estimated this session (' + m.label + ') — ' + breakdown + '. Your provider bills actuals. ↺ resets.'; }
}
/* cost accumulates across clearConversation() by design — this is the explicit reset */
function resetCost() {
  st.spent.in = st.spent.out = st.spent.cacheW = st.spent.cacheR = 0;
  renderCost();
  toast('Session cost reset to zero.');
}
$('navcostbtn').addEventListener('click', function () { openDrawer(true); });
$('navcostrst').addEventListener('click', function (e) { e.stopPropagation(); resetCost(); });

initViewer();


initExport();

/* ============ CHAT ============ */
st.history = [];   /* {role, content} for the API */
st.transcript = []; /* {q, answer, trace, model, provider, ts} for export */
st.streaming = false; st.aborter = null;
var promptEl = $('prompt'), sendbtn = $('sendbtn'), stopbtn = $('stopbtn'), statusEl = $('status');

promptEl.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('askform').requestSubmit(); }
});

/* rough per-request cost estimate (input context + a small output allowance) */
function estRequestUSD() {
  var m = MODELS[st.model];
  if (!m || m.unknownRates) return 0;
  var inTok = (st.ctxMode === 'smart' ? getBudget() : selectedTokens().tokens) + 800;
  return (inTok * m.rIn + 800 * m.rOut) / 1e6;
}
/* pre-send guards — one-time confirms, nothing is hard-blocked */
function preSendOK() {
  var m = MODELS[st.model];
  if (st.ctxMode === 'full' && !m.local) {
    var sel = selectedTokens().tokens;
    if (sel > m.ctx && !confirm('Selected context ≈ ' + fmtTok(sel) + ' tokens exceeds ' + m.label + '’s ' + fmtTok(m.ctx) + '-token window — the provider will likely reject it. Deselect files or switch to SMART.\n\nSend anyway?')) return false;
  }
  var cap = parseFloat(lsGet(LS.spendcap) || '0');
  if (cap > 0 && !m.unknownRates) {
    var spentUSD = (st.spent.in * m.rIn + st.spent.out * m.rOut + st.spent.cacheW * m.rCacheW + st.spent.cacheR * m.rCacheR) / 1e6;
    var projected = spentUSD + estRequestUSD();
    if (projected > cap && !confirm('Estimated session total (~$' + projected.toFixed(2) + ') would exceed your $' + cap.toFixed(2) + ' limit by ~$' + (projected - cap).toFixed(2) + '. Costs are estimates; your provider bills actuals.\n\nSend anyway?')) return false;
  }
  return true;
}
$('askform').addEventListener('submit', function (e) {
  e.preventDefault();
  if (st.streaming) return;
  var q = promptEl.value.trim();
  if (!q) return;
  if (st.curProvider === 'local') { promptEl.value = ''; askLocal(q); return; }
  var key = lsGet(curKeyLS()) || '';
  if (!key && st.curProvider !== 'custom') {
    setStatus('NO KEY — add your ' + PROVIDERS[st.curProvider].label + ' API key in settings', true);
    openDrawer(true);
    toast('Add your ' + PROVIDERS[st.curProvider].label + ' API key first — it stays in this browser.');
    return;
  }
  if (st.curProvider === 'custom' && (!lsGet(LS.curl) || !lsGet(LS.cmodel))) {
    setStatus('CUSTOM ENDPOINT NOT CONFIGURED — set base URL + model in settings', true);
    openDrawer(true);
    return;
  }
  if (!preSendOK()) return;
  promptEl.value = '';
  ask(q, key);
});

stopbtn.addEventListener('click', function () { if (st.aborter) st.aborter.abort(); });

function httpErrorText(status, body, retryAfter) {
  var detail = '';
  try { detail = JSON.parse(body).error.message || ''; } catch (e) {}
  if (status === 401) return 'KEY REJECTED (401) — check it in settings.';
  if (status === 403) return 'FORBIDDEN (403) — this key cannot use this model. ' + detail;
  if (status === 404) return 'MODEL NOT FOUND (404) — ' + detail;
  if (status === 429) return 'RATE LIMITED (429) — ' + (retryAfter ? 'retry in ' + retryAfter + 's. ' : 'slow down or raise your provider limits. ') + detail;
  if (status === 400 && /token|context|length/i.test(detail)) return 'CONTEXT TOO LARGE (400) — deselect some files and retry.';
  if (status === 400) return 'BAD REQUEST (400) — ' + detail;
  if (status === 529 || status >= 500) return 'PROVIDER OVERLOADED (' + status + ') — retry in a moment.';
  return 'HTTP ' + status + ' — ' + detail;
}

function ask(q, key, opts) {
  opts = opts || {};
  addUserMsg(q);
  var msgEl = addAiMsg();
  var txtEl = msgEl.querySelector('.txt');
  var raw = '', fenceIdx = -1, waitShown = false;
  st.streaming = true;
  sendbtn.hidden = true; stopbtn.hidden = false;
  st.aborter = new AbortController();

  var cb = buildContextBlocks(q);
  /* Phase 2: show what Meridian deterministically FOUND before the model interprets it
     — separate layer, navigable evidence. Never allowed to break the streaming path. */
  try { if (st.groundMode && cb.ground) renderFound(msgEl, cb.ground); } catch (e) {}
  setStatus('CORE REASONING — ' + MODELS[st.model].label + (cb.note ? ' · ' + cb.note : ''));
  var anthro = st.curProvider === 'anthropic';
  /* strict trace: on demand (RE-GROUND) or when the user enables Force Strict Trace */
  var strict = opts.strict || lsGet(LS.strictTrace) === '1';
  var instrBlock = { type: 'text', text: INSTRUCTIONS + (strict ? STRICT_SUFFIX : '') };
  /* the instruction block is stable across turns — cache it (Anthropic ≤4 breakpoints) */
  if (anthro) instrBlock.cache_control = { type: 'ephemeral' };
  var system = [instrBlock].concat(cb.blocks);
  var msgs = st.history.concat([{ role: 'user', content: q }]);

  /* provider adapters share one streaming pump below; only the request
     shape and the SSE event schema differ */
  var url, headers, body;
  if (anthro) {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    body = { model: st.model, max_tokens: 8192, stream: true, system: system, messages: msgs };
  } else {
    /* OpenAI-compatible: system blocks flatten to one system message; cache_control is Anthropic-only */
    var sysTxt = system.map(function (b) { return b.text; }).join('\n\n');
    headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = 'Bearer ' + key;
    body = { messages: [{ role: 'system', content: sysTxt }].concat(msgs), stream: true };
    if (st.curProvider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      body.model = st.model;
      body.max_completion_tokens = 8192;
      body.stream_options = { include_usage: true };
    } else {
      url = (lsGet(LS.curl) || '').replace(/\/+$/, '') + '/chat/completions';
      body.model = lsGet(LS.cmodel) || '';
      body.max_tokens = 8192;
    }
  }

  function paint(final) {
    /* hide the trace fence (and any partial fence tail) while streaming */
    var shown = raw;
    fenceIdx = raw.indexOf(FENCE);
    if (fenceIdx === -1) { var altF = raw.indexOf('~~~meridian-trace'); if (altF !== -1) fenceIdx = altF; }
    if (fenceIdx === -1) { var bare = raw.search(/\n\s*\{\s*"steps"\s*:/); if (bare !== -1) fenceIdx = bare; } /* leaked/fenceless trace JSON */
    if (fenceIdx !== -1) {
      shown = raw.slice(0, fenceIdx);
      if (!waitShown && !final) {
        waitShown = true;
        var w = document.createElement('div');
        w.className = 'trace-wait mono';
        w.innerHTML = '<i></i>TRACE // ASSEMBLING…';
        msgEl.querySelector('.bd').appendChild(w);
      }
    } else if (!final) {
      /* hold back a partial fence opener at the tail */
      var nl = shown.lastIndexOf('\n');
      var tail = shown.slice(nl + 1);
      if (tail && FENCE.indexOf(tail) === 0) shown = shown.slice(0, nl + 1);
    }
    txtEl.innerHTML = renderRich(shown.replace(/\s+$/, '')) + (final ? '' : '<span class="cursor"></span>');
    scrollEnd();
  }

  fetch(url, {
    method: 'POST',
    signal: st.aborter.signal,
    headers: headers,
    body: JSON.stringify(body)
  }).then(function (res) {
    if (!res.ok) {
      var ra = res.headers.get('retry-after');
      return res.text().then(function (t) {
        var he = new Error('http error'); he.httpStatus = res.status; he.httpBody = t; he.retryAfter = ra; throw he;
      });
    }
    if (!res.body) { var nb = new Error('no stream'); nb.streamMsg = 'the response had no readable body stream'; throw nb; }
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
    var stopReason = null, badEvents = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return finish();
        buf += dec.decode(r.value, { stream: true });
        var events = buf.split('\n\n');
        buf = events.pop();
        events.forEach(function (evt) {
          var data = null;
          evt.split('\n').forEach(function (line) {
            if (line.indexOf('data:') === 0) data = line.slice(5).trim();
          });
          if (!data || data === '[DONE]') return;
          var p;
          try { p = JSON.parse(data); } catch (e) {
            if (++badEvents === 3) { var mw = document.createElement('div'); mw.className = 'errline'; mw.textContent = '// some stream data could not be parsed — the answer may be incomplete'; msgEl.querySelector('.bd').appendChild(mw); }
            return;
          }
          if (anthro) {
            if (p.type === 'message_start' && p.message && p.message.usage) {
              var u = p.message.usage;
              st.spent.in += u.input_tokens || 0;
              st.spent.cacheW += u.cache_creation_input_tokens || 0;
              st.spent.cacheR += u.cache_read_input_tokens || 0;
              renderCost();
            } else if (p.type === 'content_block_delta' && p.delta) {
              if (p.delta.type === 'text_delta') { raw += p.delta.text; paint(false); }
              /* thinking_delta blocks are skipped — not rendered */
            } else if (p.type === 'message_delta') {
              if (p.usage) { st.spent.out += p.usage.output_tokens || 0; renderCost(); }
              if (p.delta && p.delta.stop_reason) stopReason = p.delta.stop_reason;
            } else if (p.type === 'error') {
              var se = new Error('stream error'); se.streamMsg = (p.error && p.error.message) || 'stream error'; throw se;
            }
          } else {
            /* OpenAI-compatible chat-completions stream */
            if (p.error) { var se2 = new Error('stream error'); se2.streamMsg = p.error.message || 'stream error'; throw se2; }
            if (p.usage) {
              st.spent.in += p.usage.prompt_tokens || 0;
              st.spent.out += p.usage.completion_tokens || 0;
              renderCost();
            }
            var c = p.choices && p.choices[0];
            if (c) {
              if (c.delta && typeof c.delta.content === 'string' && c.delta.content) { raw += c.delta.content; paint(false); }
              if (c.finish_reason) stopReason = c.finish_reason === 'length' ? 'max_tokens' : c.finish_reason;
            }
          }
        });
        return pump();
      });
    }
    function finish() {
      var parsed = extractTrace(raw);
      raw = parsed.answer;
      paint(true);
      /* offer RE-GROUND when the model produced text but no usable trace */
      var canRetry = !parsed.trace && parsed.answer && parsed.answer !== '(empty)';
      renderTrace(msgEl, parsed.trace, {
        degraded: parsed.degraded,
        retry: canRetry ? function () { ask(q, key, { strict: true }); } : null
      });
      if (stopReason === 'max_tokens') {
        var n = document.createElement('div');
        n.className = 'errline'; n.textContent = '// output truncated at max_tokens';
        msgEl.querySelector('.bd').appendChild(n);
      }
      if (stopReason === 'refusal') {
        var n2 = document.createElement('div');
        n2.className = 'errline'; n2.textContent = '// the model declined this request';
        msgEl.querySelector('.bd').appendChild(n2);
      }
      if (!parsed.answer && !parsed.trace && stopReason !== 'max_tokens') {
        var ne = document.createElement('div'); ne.className = 'errline'; ne.textContent = '// the model returned no content — try again or rephrase'; msgEl.querySelector('.bd').appendChild(ne);
      }
      st.history.push({ role: 'user', content: q });
      st.history.push({ role: 'assistant', content: parsed.answer || '(empty)' });
      st.transcript.push({ q: q, answer: parsed.answer || '(empty)', trace: parsed.trace, model: MODELS[st.model].label, provider: PROVIDERS[st.curProvider].label, ts: Date.now() });
      attachCopy(msgEl, st.transcript.length - 1);
      setStatus('CORE IDLE — response complete');
      announce('Response complete.' + (parsed.trace ? ' Trace available.' : ''));
      scrollEnd();
    }
    return pump();
  }).catch(function (err) {
    var line;
    if (err.name === 'AbortError') {
      line = '// stopped by operator';
      paint(true);
      renderTrace(msgEl, null);
      if (raw.trim()) {
        var pa = extractTrace(raw);
        st.history.push({ role: 'user', content: q });
        st.history.push({ role: 'assistant', content: pa.answer || '(stopped)' });
        st.transcript.push({ q: q, answer: (pa.answer || '(stopped)') + '\n\n_(stopped by operator)_', trace: pa.trace, model: MODELS[st.model].label, provider: PROVIDERS[st.curProvider].label, ts: Date.now() });
        attachCopy(msgEl, st.transcript.length - 1);
      }
      setStatus('STOPPED BY OPERATOR');
    } else if (err.httpStatus) {
      line = '// ' + httpErrorText(err.httpStatus, err.httpBody || '', err.retryAfter);
      if (err.httpStatus === 401) openDrawer(true);
      setStatus('REQUEST FAILED', true);
    } else if (err.streamMsg) {
      line = '// stream error — ' + err.streamMsg;
      setStatus('STREAM ERROR', true);
    } else {
      line = '// network unreachable — check your connection and any ad/tracker blocker. requests go straight from this browser to the provider endpoint' + (st.curProvider === 'custom' ? ' — custom endpoints must allow browser CORS.' : '.');
      setStatus('NETWORK ERROR', true);
    }
    var d = document.createElement('div');
    d.className = 'errline'; d.textContent = line;
    msgEl.querySelector('.bd').appendChild(d);
    var chip = msgEl.querySelector('.term-hd .chip');
    if (!raw.trim()) { chip.className = 'chip err'; chip.textContent = 'FAILED'; }
    /* one-click retry for anything but auth/not-found/bad-request and operator stops */
    if (err.name !== 'AbortError' && err.httpStatus !== 401 && err.httpStatus !== 403 && err.httpStatus !== 404 && err.httpStatus !== 400) {
      var rrow = document.createElement('div'); rrow.className = 'reground-row';
      var rb = document.createElement('button'); rb.type = 'button'; rb.className = 'btn-quiet acc'; rb.textContent = '[ RETRY ]';
      rb.title = 'Re-send this question';
      rb.addEventListener('click', function () { rb.disabled = true; ask(q, key, opts); });
      rrow.appendChild(rb); msgEl.querySelector('.bd').appendChild(rrow);
    }
    scrollEnd();
  }).finally(function () {
    st.streaming = false; st.aborter = null;
    sendbtn.hidden = false; stopbtn.hidden = true;
    promptEl.focus();
  });
}

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
  { g: 'SETTINGS', n: 'Open settings', k: 'ctrl .', f: function () { openDrawer(true); } },
  { g: 'SETTINGS', n: 'Load the demo project (LOCAL)', k: '', f: function () { startDemo(); } },
  { g: 'SETTINGS', n: 'Toggle ceremony / daylight', k: '', f: flipMode },
  { g: 'SETTINGS', n: 'Show keymap', k: '?', f: openKeymap },
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
palIn.addEventListener('input', function () { palSel = 0; palRender(); });
palIn.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palMatches.length - 1); palRender(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); palRender(); }
  else if (e.key === 'Enter') { e.preventDefault(); palExec(palSel); }
  else if (e.key === 'Escape') { palClose(); }
});
palOv.addEventListener('click', function (e) { if (e.target === palOv) palClose(); });

var keymapveil = $('keymapveil');
function openKeymap() { rememberFocus(); keymapveil.classList.add('on'); $('keymapclose').focus(); }
function closeKeymap() { keymapveil.classList.remove('on'); returnFocus(); }
$('keysbtn').addEventListener('click', openKeymap);
$('keymaphint').addEventListener('click', openKeymap);
$('keymapclose').addEventListener('click', closeKeymap);
keymapveil.addEventListener('click', function (e) { if (e.target === keymapveil) closeKeymap(); });

/* ============ SELF-TESTS (DEV · EXPERIMENTAL) ============
   Loads a scratch multi-language fixture into a swapped-in files map, runs the
   real index/packer/trace code, asserts, then restores state. No live API calls.
   Reach it via the palette ("Run self-tests") or ?selftest in the URL. */
function stEntry(p, t) { return { content: t, lines: t.split('\n').length, tokens: estTokens(t, p), mtime: 0, base: staticScore(p), checked: true, lang: detectLang(p, t) }; }
function selfTestFixture() {
  return {
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
    'src/aliased.ts': "import { addTodo } from '@/store';\nexport const ALIASED = 1;",
    'pkg/app.py': "from .util import helper\nAPP_NAME = 'demo'\ndef run():\n    return helper()",
    'pkg/util.py': "def helper():\n    return 1",
    'gopkg/server.go': 'package main\nimport (\n  "fmt"\n)\nfunc NewServer() {}\nfunc (s *Server) Start() error { fmt.Println("x"); return nil }',
    'rustcrate/lib.rs': 'pub fn compute(x: i32) -> i32 { x }\npub struct Engine {}\nmod parser;',
    'rustcrate/parser.rs': 'pub fn parse() {}'
  };
}
function runSelfTests() {
  var results = [];
  function ok(name, cond, extra) { results.push({ name: name, pass: !!cond, extra: extra || '' }); }
  var savedFiles = st.files, savedIndex = st.projectIndex, savedDirty = st.indexDirty;
  try {
    st.files = new Map();
    Object.keys(SAMPLE_PROJECT).forEach(function (p) { st.files.set(p, stEntry(p, SAMPLE_PROJECT[p])); });
    var FIX = selfTestFixture();
    Object.keys(FIX).forEach(function (p) { st.files.set(p, stEntry(p, FIX[p])); });
    st.indexDirty = true; st.projectIndex = null;
    var idx = buildIndex();
    ok('symbols · JS addTodo', idx.symbols.has('addTodo'));
    ok('symbols · JS API_BASE_URL const', idx.symbols.has('API_BASE_URL'));
    ok('symbols · Rust pub fn compute', idx.symbols.has('compute'));
    ok('symbols · Rust struct Engine', idx.symbols.has('Engine'));
    ok('symbols · Go func NewServer', idx.symbols.has('NewServer'));
    ok('symbols · Go receiver method Start', idx.symbols.has('Start'), 'receiver methods');
    ok('symbols · Python def run', idx.symbols.has('run'));
    ok('symbols · Python const APP_NAME', idx.symbols.has('APP_NAME'));
    ok('imports · store.js importedBy server.js', (idx.importedBy.get('src/store.js') || []).some(function (e) { return e.file === 'src/server.js'; }));
    ok('imports · tsconfig @/ alias resolves', (idx.importsByFile.get('src/aliased.ts') || []).some(function (e) { return e.resolved === 'src/store.js'; }), '@/store → src/store.js');
    ok('imports · Python relative from .util', (idx.importsByFile.get('pkg/app.py') || []).some(function (e) { return e.resolved === 'pkg/util.py'; }));
    ok('imports · Go block import recorded', (idx.importsByFile.get('gopkg/server.go') || []).some(function (e) { return e.raw === 'fmt'; }));
    ok('imports · Rust mod parser resolves', (idx.importsByFile.get('rustcrate/lib.rs') || []).some(function (e) { return e.resolved === 'rustcrate/parser.rs'; }));
    ok('index · languages counted', idx.langs && Object.keys(idx.langs).length >= 4, Object.keys(idx.langs || {}).join(','));
    ok('index · importCount > 0', (idx.importCount || 0) > 0, String(idx.importCount));
    /* packer respects budget and never emits a line number past a file's length */
    var packed = packSmartContext('where is API_BASE_URL defined', 4000);
    ok('packer · within budget', packed.tokens <= 4000, packed.tokens + ' / 4000');
    ok('packer · emits FILE markers', /═══ FILE:/.test(packed.text));
    ok('packer · line-numbered content present', /\d+│/.test(packed.text) || packed.included.every(function (x) { return x.whole; }));
    /* intent routing returns a decision */
    ok('intent · classifyIntent returns a kind', !!(classifyIntent('where is addTodo defined') || {}).kind);
    /* trace parser fallbacks */
    ok('trace · clean fence', extractTrace('a\n```meridian-trace\n{"steps":[{"action":"x"}]}\n```').degraded === null);
    ok('trace · ```json salvaged', extractTrace('a\n```json\n{"steps":[{"action":"x"}]}\n```').degraded === 'salvaged');
    ok('trace · fenceless salvaged', extractTrace('a\n{"steps":[{"action":"x"}]}').degraded === 'salvaged');
    ok('trace · truncated detected', extractTrace('a\n```meridian-trace\n{"steps":[{"action":"x"').degraded === 'truncated');
    ok('trace · no-trace', extractTrace('just prose').degraded === 'no-trace');
    /* grounding roundtrip: a canned grounded answer yields a live (known) chip */
    var canned = 'API_BASE_URL is in config.\n```meridian-trace\n{"steps":[{"action":"locate","evidence":[{"file":"src/config.js","startLine":5,"endLine":5,"quote":"API_BASE_URL"}]}],"confidence":0.9}\n```';
    var pr = extractTrace(canned);
    var ev0 = pr.trace && pr.trace.steps[0] && pr.trace.steps[0].evidence[0];
    ok('grounding · cited file resolves to loaded context', !!(ev0 && st.files.has(ev0.file)), ev0 ? ev0.file : 'no evidence');
  } catch (e) {
    ok('harness executed without throwing', false, String(e && e.message || e));
  } finally {
    st.files = savedFiles; st.projectIndex = savedIndex; st.indexDirty = savedDirty;
  }
  return results;
}
function showSelfTestResults(results) {
  var pass = results.filter(function (r) { return r.pass; }).length;
  var veil = document.createElement('div'); veil.className = 'veil on'; veil.id = 'selftestveil';
  var modal = document.createElement('div'); modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Self-test results');
  var rows = results.map(function (r) {
    return '<tr><td class="' + (r.pass ? 'st-pass' : 'st-fail') + '">' + (r.pass ? '✓' : '✗') + '</td><td>' + esc(r.name) + '</td><td class="mono" style="color:var(--ink-3)">' + esc(r.extra || '') + '</td></tr>';
  }).join('');
  modal.innerHTML = '<div class="k mono">MERIDIAN // SELF-TESTS<span class="st-badge mono">DEV</span></div>'
    + '<h2>' + pass + ' / ' + results.length + ' passed</h2>'
    + '<p class="note mono" style="color:var(--ink-3)">// deterministic checks of the index, packer and trace parser on a scratch fixture — no network, no API.</p>'
    + '<table>' + rows + '</table>'
    + '<div class="row"><button class="btn btn-hairline" type="button" id="selftestclose">Close</button></div>';
  veil.appendChild(modal);
  app.appendChild(veil); /* inside #app so the CSS variables resolve */
  rememberFocus();
  var untrap = trap(modal);
  function close() { veil.remove(); if (untrap) untrap(); returnFocus(); }
  modal.querySelector('#selftestclose').addEventListener('click', close);
  veil.addEventListener('click', function (e) { if (e.target === veil) close(); });
  modal.querySelector('#selftestclose').focus();
  try { console.table(results.map(function (r) { return { test: r.name, pass: r.pass, detail: r.extra }; })); } catch (e) {}
  var fails = results.length - pass;
  toast(fails ? 'Self-tests: ' + pass + '/' + results.length + ' passed · ' + fails + ' FAILED.' : 'Self-tests: all ' + pass + ' passed.');
}
function runAndShowSelfTests() { showSelfTestResults(runSelfTests()); }

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


export { dismissFirstRun, setProvider }; /* TEMP: pending module extraction */