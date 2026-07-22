/* ============ PROVIDERS + MODELS ============ */
/* rates are USD per million tokens, approximate as of JUL 2026 — verify at your provider's pricing page */
var PROVIDERS = {
  anthropic: { label: 'ANTHROPIC', keyLS: 'meridian.key', keyHint: 'sk-ant-…',
               note: '// requests go straight from this browser to api.anthropic.com. supports prompt caching.' },
  openai:    { label: 'OPENAI', keyLS: 'meridian.key.openai', keyHint: 'sk-…',
               note: '// requests go straight from this browser to api.openai.com via the chat-completions API, streamed.' },
  custom:    { label: 'CUSTOM', keyLS: 'meridian.key.custom', keyHint: 'api key (optional for local servers)',
               note: '// any OpenAI-compatible endpoint: ollama, LM Studio, vLLM, openrouter… the server must allow browser CORS. cost estimates are unavailable.' },
  local:     { label: 'LOCAL', keyLS: 'meridian.key.local', keyHint: '', /* keyLS is never read — local needs no key */
               note: '// no API, no key, no AI. questions run as deterministic keyword/symbol search over the loaded files — nothing ever leaves this tab.' }
};
var MODELS = {
  'claude-sonnet-5':  { provider: 'anthropic', label: 'SONNET 5',  ctx: 1000000, rIn: 3.00, rOut: 15.00, rCacheW: 3.75, rCacheR: 0.30,
                        note: 'claude-sonnet-5 — 1M-token context. best reasoning per dollar for traces.' },
  'claude-haiku-4-5': { provider: 'anthropic', label: 'HAIKU 4.5', ctx: 200000,  rIn: 1.00, rOut: 5.00,  rCacheW: 1.25, rCacheR: 0.10,
                        note: 'claude-haiku-4-5 — 200K-token context. fast and cheap; traces are shallower.' },
  'gpt-5.1':          { provider: 'openai', label: 'GPT-5.1', ctx: 400000, rIn: 1.25, rOut: 10.00, rCacheW: 0, rCacheR: 0.125,
                        note: 'gpt-5.1 — 400K-token context, OpenAI flagship.' },
  'gpt-5-mini':       { provider: 'openai', label: 'GPT-5 MINI', ctx: 400000, rIn: 0.25, rOut: 2.00, rCacheW: 0, rCacheR: 0.025,
                        note: 'gpt-5-mini — 400K-token context. cheap; traces are shallower.' },
  '__local':          { provider: 'local', label: 'LOCAL ENGINE', ctx: 200000, rIn: 0, rOut: 0, rCacheW: 0, rCacheR: 0, unknownRates: true, local: true,
                        note: 'deterministic keyword/symbol search over the loaded files — no AI, no network, free. answers cite exact lines.' }
};
var LS = { key: 'meridian.key', model: 'meridian.model', mode: 'meridian.app.mode', accepted: 'meridian.accepted', ctxmode: 'meridian.ctxmode', ctxbudget: 'meridian.ctxbudget', ignore: 'meridian.ignore',
           provider: 'meridian.provider', okey: 'meridian.key.openai', ckey: 'meridian.key.custom', curl: 'meridian.custom.url', cmodel: 'meridian.custom.model', ground: 'meridian.ground',
           strictTrace: 'meridian.stricttrace', spendcap: 'meridian.spendcap' };

export { PROVIDERS, MODELS, LS };
