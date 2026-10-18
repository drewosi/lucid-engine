import { st } from './state.js';
import { extractTrace } from './trace.js';
import { httpErrorText, parseStreamEvent, splitSseEvents } from './chat.js';
/* ============ SELF-TESTS: TRACE + WIRE FORMATS ============
   Trace-fence parsing, provider SSE adapters, SSE buffer splitting and the HTTP error taxonomy.
   Runs inside the shared scratch project that runSelfTests (selftest.js) has already loaded. */
function wireCases(ok) {
  /* trace parser fallbacks */
  ok('trace · clean fence', extractTrace('a\n```meridian-trace\n{"steps":[{"action":"x"}]}\n```').degraded === null);
  ok('trace · ```json salvaged', extractTrace('a\n```json\n{"steps":[{"action":"x"}]}\n```').degraded === 'salvaged');
  ok('trace · fenceless salvaged', extractTrace('a\n{"steps":[{"action":"x"}]}').degraded === 'salvaged');
  ok('trace · truncated detected', extractTrace('a\n```meridian-trace\n{"steps":[{"action":"x"').degraded === 'truncated');
  ok('trace · no-trace', extractTrace('just prose').degraded === 'no-trace');
  /* answers ABOUT the trace format must survive intact — a quoted example whose
     citations don't resolve in the loaded context is prose, not a trace */
  var quoted = extractTrace('the format looks like:\n```json\n{"steps":[{"action":"x","evidence":[{"file":"not/loaded.js","startLine":1,"endLine":2}]}]}\n```\nthat is the shape.');
  ok('trace · quoted example not stripped', quoted.degraded === 'no-trace' && quoted.answer.indexOf('"steps"') !== -1);
  var pad = new Array(40).join('long explanatory prose follows here\n');
  ok('trace · mid-answer "steps" mention untouched', extractTrace('code uses {"steps": internally\n' + pad).degraded === 'no-trace');
  /* grounding roundtrip: a canned grounded answer yields a live (known) chip */
  var canned = 'API_BASE_URL is in config.\n```meridian-trace\n{"steps":[{"action":"locate","evidence":[{"file":"src/config.js","startLine":5,"endLine":5,"quote":"API_BASE_URL"}]}],"confidence":0.9}\n```';
  var pr = extractTrace(canned);
  var ev0 = pr.trace && pr.trace.steps[0] && pr.trace.steps[0].evidence[0];
  ok('grounding · cited file resolves to loaded context', !!(ev0 && st.files.has(ev0.file)), ev0 ? ev0.file : 'no evidence');
  /* SSE adapters — canned provider events through the real parseStreamEvent */
  var sa = parseStreamEvent({ type: 'message_start', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 } } }, true);
  ok('sse · anthropic message_start usage', !!sa.usage && sa.usage.in === 10 && sa.usage.cacheW === 3 && sa.usage.cacheR === 2);
  ok('sse · anthropic text_delta', parseStreamEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }, true).text === 'hi');
  ok('sse · anthropic thinking_delta not rendered', parseStreamEvent({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } }, true).text === null);
  var sb = parseStreamEvent({ type: 'message_delta', usage: { output_tokens: 7 }, delta: { stop_reason: 'end_turn' } }, true);
  ok('sse · anthropic message_delta usage+stop', !!sb.usage && sb.usage.out === 7 && sb.stopReason === 'end_turn');
  ok('sse · anthropic error event', parseStreamEvent({ type: 'error', error: { message: 'overloaded' } }, true).errorMsg === 'overloaded');
  ok('sse · openai delta content', parseStreamEvent({ choices: [{ delta: { content: 'ok' } }] }, false).text === 'ok');
  ok('sse · openai length→max_tokens', parseStreamEvent({ choices: [{ delta: {}, finish_reason: 'length' }] }, false).stopReason === 'max_tokens');
  var sc = parseStreamEvent({ usage: { prompt_tokens: 5, completion_tokens: 6 } }, false);
  ok('sse · openai usage', !!sc.usage && sc.usage.in === 5 && sc.usage.out === 6);
  ok('sse · openai error event', parseStreamEvent({ error: { message: 'bad' } }, false).errorMsg === 'bad');
  /* SSE buffer splitting (audit F4) — CRLF endpoints and unterminated tails */
  var spA = splitSseEvents('data: a\n\ndata: b\n\ndata: c');
  ok('sse · LF split keeps the tail', spA.events.length === 2 && spA.rest === 'data: c');
  var spB = splitSseEvents('data: a\r\n\r\ndata: b\r\n\r\n');
  ok('sse · CRLF separators split', spB.events.length === 2 && spB.rest === '');
  var spC = splitSseEvents('data: a\n\r\ndata: b');
  ok('sse · mixed separators split', spC.events.length === 1 && spC.rest === 'data: b');
  /* HTTP error taxonomy */
  ok('http · 401 key rejected', httpErrorText(401, '').indexOf('KEY REJECTED') === 0);
  ok('http · 429 uses retry-after', httpErrorText(429, '', '12').indexOf('retry in 12s') !== -1);
  ok('http · 400 context too large', httpErrorText(400, JSON.stringify({ error: { message: 'prompt exceeds context length' } })).indexOf('CONTEXT TOO LARGE') === 0);
  ok('http · 529 overloaded', httpErrorText(529, '').indexOf('PROVIDER OVERLOADED') === 0);
  /* LM Studio-style 400: the error is a bare string, not { message } */
  var lmBody = JSON.stringify({ error: 'Trying to keep the first 130985 tokens when context the overflows. However, the model is loaded with context length of 32768' });
  var ctxSaved = st.ctxMode;
  st.ctxMode = 'smart';
  var lmSmart = httpErrorText(400, lmBody);
  st.ctxMode = 'full';
  var lmFull = httpErrorText(400, lmBody);
  st.ctxMode = ctxSaved;
  ok('http · 400 over-context (string error) hints at the SMART budget', lmSmart.indexOf('CONTEXT TOO LARGE') === 0 && /lower the SMART budget in settings/.test(lmSmart), lmSmart);
  ok('http · 400 over-context in FULL hints at fewer files or SMART', lmFull.indexOf('CONTEXT TOO LARGE') === 0 && /SMART/.test(lmFull) && !/budget/.test(lmFull), lmFull);
}
export { wireCases };
