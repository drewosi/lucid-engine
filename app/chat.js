import { st } from './state.js';
import { LS, MODELS, PROVIDERS } from './config.js';
import { $, announce, fmtTok, lsGet, setStatus, toast } from './helpers.js';
import { curKeyLS, openDrawer } from './shell.js';
import { estTokens, getBudget } from './smart-context.js';
import { selectedTokens } from './ingest.js';
import { askLocal } from './local.js';
import { addAiMsg, addUserMsg, atBottom, attachCopy, extractTrace, renderFound, renderRich, renderTrace, scrollEnd } from './trace.js';
import { FENCE, INSTRUCTIONS, STRICT_SUFFIX, buildContextBlocks } from './prompt.js';
/* ============ COST ============ */
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

/* ============ CHAT ============ */
var promptEl = $('prompt'), sendbtn = $('sendbtn'), stopbtn = $('stopbtn'), statusEl = $('status');

/* tokens the request carries beyond the selected context — the instruction
   block plus every prior turn. Both guards below count them, so a long session
   can't sail past a window check that measured context alone. */
function overheadTokens() {
  var t = estTokens(INSTRUCTIONS);
  for (var i = 0; i < st.history.length; i++) t += estTokens(String(st.history[i].content || ''));
  return t;
}
/* rough per-request cost estimate (input context + history/instructions + a small output allowance) */
function estRequestUSD() {
  var m = MODELS[st.model];
  if (!m || m.unknownRates) return 0;
  var inTok = (st.ctxMode === 'smart' ? getBudget() : selectedTokens().tokens) + overheadTokens();
  return (inTok * m.rIn + 800 * m.rOut) / 1e6;
}
/* pre-send guards — one-time confirms, nothing is hard-blocked */
function preSendOK() {
  var m = MODELS[st.model];
  if (st.ctxMode === 'full' && !m.local) {
    var sel = selectedTokens().tokens + overheadTokens();
    if (sel > m.ctx && !confirm('Selected context + conversation ≈ ' + fmtTok(sel) + ' tokens exceeds ' + m.label + '’s ' + fmtTok(m.ctx) + '-token window — the provider will likely reject it. Deselect files, clear the conversation, or switch to SMART.\n\nSend anyway?')) return false;
  }
  var cap = parseFloat(lsGet(LS.spendcap) || '0');
  if (cap > 0 && !m.unknownRates) {
    var spentUSD = (st.spent.in * m.rIn + st.spent.out * m.rOut + st.spent.cacheW * m.rCacheW + st.spent.cacheR * m.rCacheR) / 1e6;
    var projected = spentUSD + estRequestUSD();
    if (projected > cap && !confirm('Estimated session total (~$' + projected.toFixed(2) + ') would exceed your $' + cap.toFixed(2) + ' limit by ~$' + (projected - cap).toFixed(2) + '. Costs are estimates; your provider bills actuals.\n\nSend anyway?')) return false;
  }
  return true;
}

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

/* One parsed SSE event → a plain effect object. Pure — shared by the live pump
   below and the self-tests, so the provider adapters' event handling is testable
   with canned events and no network. Returns { text, usage, stopReason, errorMsg }
   with nulls where the event carries nothing; usage is a delta the caller adds. */
function parseStreamEvent(p, anthro) {
  var out = { text: null, usage: null, stopReason: null, errorMsg: null };
  if (anthro) {
    if (p.type === 'message_start' && p.message && p.message.usage) {
      var u = p.message.usage;
      out.usage = { in: u.input_tokens || 0, out: 0, cacheW: u.cache_creation_input_tokens || 0, cacheR: u.cache_read_input_tokens || 0 };
    } else if (p.type === 'content_block_delta' && p.delta) {
      if (p.delta.type === 'text_delta') out.text = p.delta.text;
      /* thinking_delta blocks are skipped — not rendered */
    } else if (p.type === 'message_delta') {
      if (p.usage) out.usage = { in: 0, out: p.usage.output_tokens || 0, cacheW: 0, cacheR: 0 };
      if (p.delta && p.delta.stop_reason) out.stopReason = p.delta.stop_reason;
    } else if (p.type === 'error') {
      out.errorMsg = (p.error && p.error.message) || 'stream error';
    }
  } else {
    /* OpenAI-compatible chat-completions stream */
    if (p.error) { out.errorMsg = p.error.message || 'stream error'; return out; }
    if (p.usage) out.usage = { in: p.usage.prompt_tokens || 0, out: p.usage.completion_tokens || 0, cacheW: 0, cacheR: 0 };
    var c = p.choices && p.choices[0];
    if (c) {
      if (c.delta && typeof c.delta.content === 'string' && c.delta.content) out.text = c.delta.content;
      if (c.finish_reason) out.stopReason = c.finish_reason === 'length' ? 'max_tokens' : c.finish_reason;
    }
  }
  return out;
}

function ask(q, key, opts) {
  opts = opts || {};
  /* concurrency guard — a stale [ RETRY ] / [ RE-GROUND & RETRY ] click while an
     answer is streaming would race two streams over one aborter and one flag */
  if (st.streaming) { toast('One answer at a time — stop the current stream first.'); return; }
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

  function paintNow(final) {
    /* hide the trace fence (and any partial fence tail) while streaming */
    var shown = raw;
    fenceIdx = raw.indexOf(FENCE);
    if (fenceIdx === -1) { var altF = raw.indexOf('~~~meridian-trace'); if (altF !== -1) fenceIdx = altF; }
    /* leaked/fenceless trace JSON — only near the tail, where a real trace lives;
       an answer QUOTING {"steps": mid-text (e.g. auditing meridian itself) stays visible */
    if (fenceIdx === -1) { var bare = raw.search(/\n\s*\{\s*"steps"\s*:/); if (bare !== -1 && bare >= raw.length - 600) fenceIdx = bare; }
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
    var pinned = atBottom();
    txtEl.innerHTML = renderRich(shown.replace(/\s+$/, '')) + (final ? '' : '<span class="cursor"></span>');
    /* only follow the stream if the operator was already at the bottom */
    if (pinned || final) scrollEnd();
  }
  /* streaming repaints coalesce to one per animation frame — repainting the whole
     answer per SSE delta is quadratic and janks long answers */
  var paintQueued = false;
  function paint(final) {
    if (final) { paintQueued = false; paintNow(true); return; }
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(function () {
      if (!paintQueued) return; /* a final paint already landed */
      paintQueued = false;
      paintNow(false);
    });
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
          var eff = parseStreamEvent(p, anthro);
          if (eff.errorMsg) { var se = new Error('stream error'); se.streamMsg = eff.errorMsg; throw se; }
          if (eff.usage) {
            st.spent.in += eff.usage.in; st.spent.out += eff.usage.out;
            st.spent.cacheW += eff.usage.cacheW; st.spent.cacheR += eff.usage.cacheR;
            renderCost();
          }
          if (eff.text) { raw += eff.text; paint(false); }
          if (eff.stopReason) stopReason = eff.stopReason;
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
      line = '// network unreachable — check your connection and any ad/tracker blocker. requests go straight from this browser to the provider endpoint' + (st.curProvider === 'custom' ? ' — custom endpoints must allow browser CORS, and remote (non-localhost) endpoints are blocked by this page\'s CSP unless you self-host with a widened connect-src.' : '.');
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
export { httpErrorText, parseStreamEvent, promptEl, resetCost };

export function initChat() {
  st.spent = { in: 0, out: 0, cacheW: 0, cacheR: 0 };
  $('navcostbtn').addEventListener('click', function () { openDrawer(true); });
  $('navcostrst').addEventListener('click', function (e) { e.stopPropagation(); resetCost(); });
  st.history = [];   /* {role, content} for the API */
  st.transcript = []; /* {q, answer, trace, model, provider, ts} for export */
  st.streaming = false; st.aborter = null;
  promptEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('askform').requestSubmit(); }
  });
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
}
