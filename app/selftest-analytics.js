import { st } from './state.js';
import { INTENTS } from './intents.js';
import { lsDel, lsGet, lsSet } from './helpers.js';
import { LS } from './config.js';
import { AN_FORMAT, AN_Q_MAX, CSV_COLS, EVENT_FIELDS, __setAnalyticsForTest, analyticsCSV, analyticsJSON, analyticsOn, clearAnalytics, endpointUrl, flushAnalyticsSend, idbStore, percentile, readEvents, sanitizeEvent, storeText, summarize, track, validEndpoint } from './analytics.js';
import { memStore } from './selftest-fixture.js';
/* usage analytics — an in-memory store that counts every call stands in for
   IndexedDB, and a recording fetch stands in for the network. The user's own
   analytics settings are saved first and put back in finally; a sentinel key
   is planted only when the Anthropic slot is empty, as in shareCases. */
function analyticsCases(ok) {
  var SENT = 'sk-ant-SELFTEST-SENTINEL-0000';
  var KEYS = [LS.analytics, LS.analyticsText, LS.analyticsUrl];
  var savedLS = KEYS.map(lsGet), savedProv = st.curProvider;
  var planted = !lsGet(LS.key);
  var mem = memStore(), calls = [], failNext = false;
  var prev = __setAnalyticsForTest({ store: mem, fetch: function (u, o) {
    calls.push({ u: u, o: o });
    return failNext ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ ok: true, status: 204 });
  } });
  function finish() {
    KEYS.forEach(function (k, i) { if (savedLS[i] === null) lsDel(k); else lsSet(k, savedLS[i]); });
    if (planted) lsDel(LS.key);
    st.curProvider = savedProv;
    __setAnalyticsForTest(prev);
  }
  var POISON = { type: 'question', engine: 'model', provider: 'anthropic', model: 'claude-sonnet-5', intent: 'src/store.js', outcome: 'ok',
    latencyMs: 420, durationMs: 1800, tokensIn: 1200, tokensOut: 300, q: 'where is addTodo? key ' + SENT + ' and sk-proj-abcdefghijklmnopqrstuv',
    path: 'src/secret/store.js', file: 'src/store.js', content: 'function addTodo() { return 1; }', code: 'const API_KEY = 1', apiKey: SENT, key: SENT, url: 'https://evil.example/x' };
  var ev1, ev2;
  KEYS.forEach(lsDel); /* fresh browser: nothing stored */
  if (planted) lsSet(LS.key, SENT);
  st.curProvider = 'anthropic';
  ok('analytics · off by default (no switch, no text, no endpoint)', !analyticsOn() && !storeText() && endpointUrl() === '');
  return Promise.all([
    track(POISON), track({ type: 'share_link', files: 3 }), track({ type: 'repo_added', repos: 2 }), track({ type: 'question', engine: 'local', intent: 'cycles' })
  ]).then(function (r) {
    ok('analytics · off: no writes, no reads, no network', r.every(function (x) { return x === null; }) && mem.ops() === 0 && calls.length === 0, 'store ops=' + mem.ops() + ' fetch=' + calls.length);
    lsSet(LS.analytics, '1');
    return track(POISON);
  }).then(function (e) {
    ev1 = e;
    var js = JSON.stringify(mem.rows());
    ok('analytics · on: one event stored', !!ev1 && mem.rows().length === 1 && mem.rows()[0].type === 'question', mem.rows().length + ' rows');
    ok('analytics · timestamp is the real current time', Math.abs(ev1.ts - Date.now()) < 60000, new Date(ev1.ts).toISOString());
    ok('analytics · sanitized to whitelisted fields only', Object.keys(ev1).every(function (k) { return EVENT_FIELDS.indexOf(k) !== -1; })
      && ['path', 'file', 'content', 'code', 'apiKey', 'key', 'url'].every(function (k) { return !(k in ev1); }), Object.keys(ev1).join(','));
    ok('analytics · no code, paths or keys in what is stored', js.indexOf(SENT) === -1 && js.indexOf('src/') === -1 && js.indexOf('function') === -1
      && js.indexOf('API_KEY') === -1 && js.indexOf('sk-proj') === -1 && js.indexOf('evil.example') === -1, js.length + ' chars');
    ok('analytics · a path in the intent slot becomes "other"', ev1.intent === 'other' && ev1.engine === 'model' && ev1.provider === 'anthropic' && ev1.model === 'claude-sonnet-5', ev1.intent);
    ok('analytics · question text absent while its switch is off', !('q' in ev1) && js.indexOf('addTodo') === -1);
    ok('analytics · numbers kept, repo count + scope recorded', ev1.latencyMs === 420 && ev1.durationMs === 1800 && ev1.tokensIn === 1200 && ev1.tokensOut === 300
      && typeof ev1.repos === 'number' && ev1.scope === 'single' && typeof ev1.files === 'number');
    var odd = sanitizeEvent({ type: 'question', provider: 'evil', model: '../../etc', engine: 'x', outcome: 'pwned', latencyMs: -5, tokensIn: 'lots', scope: 'everything' });
    ok('analytics · unknown enums and bad numbers are dropped or defaulted', odd.provider === 'other' && odd.model === 'other' && odd.engine === 'model' && odd.outcome === 'ok'
      && !('latencyMs' in odd) && !('tokensIn' in odd) && odd.scope === 'single' && sanitizeEvent({ type: 'upload_files' }) === null);
    ok('analytics · every real intent kind survives sanitizing', INTENTS.every(function (it) { return sanitizeEvent({ type: 'question', intent: it.kind }).intent === it.kind; }));
    lsSet(LS.analyticsText, '1');
    return track(POISON);
  }).then(function (e) {
    ev2 = e;
    ok('analytics · text switch on: question kept, keys removed', typeof ev2.q === 'string' && ev2.q.indexOf('where is addTodo?') === 0
      && ev2.q.indexOf(SENT) === -1 && ev2.q.indexOf('sk-proj') === -1 && /key removed/.test(ev2.q), ev2.q);
    return track({ type: 'question', engine: 'local', provider: 'local', intent: 'search', q: new Array(80).join('long question ') });
  }).then(function (e) {
    ok('analytics · stored question text is capped', e.q.length <= AN_Q_MAX + 1, e.q.length + ' chars');
    ok('analytics · feature events carry counts only', !('q' in sanitizeEvent({ type: 'share_link', files: 4, q: 'secret' }, { text: true }))
      && sanitizeEvent({ type: 'share_link', files: 4 }).files === 4);
    ok('analytics · endpoint blank: no network at all', calls.length === 0, calls.length + ' requests');
    lsSet(LS.analyticsText, '0');
    return flushAnalyticsSend();
  }).then(function (sent) {
    ok('analytics · flushing with no endpoint sends nothing', sent === false && calls.length === 0);
    /* summaries over a fixed event set */
    var evs = [100, 200, 300, 400, 1000].map(function (ms, i) { return { type: 'question', engine: 'model', provider: i < 3 ? 'anthropic' : 'openai', intent: i < 2 ? 'def' : 'reason', outcome: i === 4 ? 'error' : 'ok', latencyMs: ms, durationMs: ms * 2, ts: 1000 + i }; })
      .concat([{ type: 'question', engine: 'local', provider: 'local', intent: 'def', outcome: 'ok', latencyMs: 7, ts: 2000 }, { type: 'share_link', files: 2, ts: 3000 }, { type: 'repo_added', repos: 2, ts: 4000 }]);
    var s = summarize(evs);
    ok('analytics · totals + LOCAL vs model', s.total === 8 && s.questions === 6 && s.model === 5 && s.local === 1 && s.errors === 1 && s.features.share_link === 1 && s.features.repo_added === 1);
    ok('analytics · breakdown by intent and provider', s.byIntent.def === 3 && s.byIntent.reason === 3 && s.byProvider.anthropic === 3 && s.byProvider.openai === 2 && s.byProvider.local === 1);
    ok('analytics · median / p90 latency (nearest rank)', s.latency.model.median === 300 && s.latency.model.p90 === 1000 && s.latency.modelDuration.median === 600
      && s.latency.local.median === 7 && percentile([], 50) === null && percentile([5], 90) === 5, s.latency.model.median + ' / ' + s.latency.model.p90);
    var stored = evs.map(function (e, i) { var c = JSON.parse(JSON.stringify(e)); c.id = i + 1; c.v = 1; return c; });
    stored[0].q = '=HYPERLINK("http://x","click"), with a comma';
    stored[1].junk = 'src/leak.js';
    var j = JSON.parse(analyticsJSON(stored));
    ok('analytics · JSON export shape', j.format === AN_FORMAT && j.v === 1 && j.count === 8 && j.events.length === 8 && typeof j.exported === 'string'
      && j.events.every(function (e) { return Object.keys(e).every(function (k) { return EVENT_FIELDS.indexOf(k) !== -1; }); })
      && JSON.stringify(j).indexOf('src/leak.js') === -1 && !('id' in j.events[0]));
    var csv = analyticsCSV(stored), lines = csv.split('\r\n');
    ok('analytics · CSV export: header, one row per event', lines[0] === CSV_COLS.join(',') && lines.length === 10 && lines[9] === '' && lines[1].indexOf('1970-01-01T00:00:01.000Z,1000,question,def,model,anthropic') === 0, lines[0]);
    ok('analytics · CSV quotes commas and defuses formulas', lines[1].indexOf('"\'=HYPERLINK(""http://x"",""click""), with a comma"') !== -1 && csv.indexOf('src/leak.js') === -1);
    return readEvents();
  }).then(function (rows) {
    ok('analytics · the log reads back what was stored', rows.length === 3 && rows.every(function (r) { return r.type === 'question'; }));
    return clearAnalytics().then(readEvents);
  }).then(function (rows) {
    ok('analytics · clear empties the log', rows.length === 0 && mem.rows().length === 0);
    /* own endpoint: validation, sanitized batches, LOCAL never sent, back-off */
    ok('analytics · endpoint URL validation', !validEndpoint('').ok && !validEndpoint('javascript:alert(1)').ok && !validEndpoint('ftp://x.example/e').ok
      && !validEndpoint('http://collector.example/e').ok && !validEndpoint('https://u:p@collector.example/e').ok
      && validEndpoint('http://localhost:8787/e').ok && !validEndpoint('http://localhost:8787/e').warn
      && validEndpoint('https://collector.example/e').ok && /connect-src/.test(validEndpoint('https://collector.example/e').warn));
    lsSet(LS.analyticsUrl, 'http://localhost:8787/events');
    return track(POISON).then(flushAnalyticsSend);
  }).then(function (sent) {
    var body = calls[0] && JSON.parse(calls[0].o.body);
    ok('analytics · own endpoint gets one sanitized POST', sent === true && calls.length === 1 && calls[0].u === 'http://localhost:8787/events' && calls[0].o.method === 'POST'
      && calls[0].o.credentials === 'omit' && body.format === AN_FORMAT && body.events.length === 1 && !('q' in body.events[0])
      && calls[0].o.body.indexOf(SENT) === -1 && calls[0].o.body.indexOf('src/') === -1, calls.length + ' requests');
    st.curProvider = 'local';
    return Promise.all([track({ type: 'question', engine: 'local', provider: 'local', intent: 'def' }), track({ type: 'share_link', files: 1 })]).then(flushAnalyticsSend);
  }).then(function () {
    ok('analytics · LOCAL mode never sends, even with an endpoint', calls.length === 1 && mem.rows().length === 3, calls.length + ' requests');
    st.curProvider = 'openai';
    return track({ type: 'question', engine: 'local', provider: 'local', intent: 'def' }).then(flushAnalyticsSend);
  }).then(function () {
    ok('analytics · LOCAL answers are not sent from a model provider either', calls.length === 1);
    failNext = true;
    return track(POISON).then(flushAnalyticsSend);
  }).then(function (sent) {
    failNext = false;
    var n = calls.length;
    return track(POISON).then(flushAnalyticsSend).then(function (again) {
      ok('analytics · a failed send is dropped and pauses, no retries', sent === false && n === 2 && again === false && calls.length === 2, calls.length + ' requests');
      ok('analytics · failures never block the local log', mem.rows().length === 6, mem.rows().length + ' rows');
    });
  }).then(function () {
    var before = mem.ops();
    lsSet(LS.analytics, '0');
    return track(POISON).then(function (r) {
      ok('analytics · switched off again: nothing stored or sent', r === null && mem.ops() === before && calls.length === 2);
    });
  }).then(function () {
    /* the real IndexedDB path, on a throwaway database that is deleted afterwards */
    var db = idbStore('meridian-analytics-selftest');
    return db.clear().then(function () { return db.add(sanitizeEvent({ type: 'share_link', files: 1 })); })
      .then(function () { return db.add(sanitizeEvent({ type: 'repo_added', repos: 2 })); })
      .then(db.all).then(function (rows) {
        ok('analytics · IndexedDB round-trip (throwaway db)', rows.length === 2 && rows[0].type === 'share_link' && typeof rows[0].id === 'number', rows.length + ' rows');
        return db.clear().then(db.all);
      }).then(function (rows) {
        ok('analytics · IndexedDB clear', rows.length === 0);
      }).catch(function (e) {
        ok('analytics · IndexedDB round-trip (throwaway db)', false, String(e && e.message || e));
      }).then(function () { db.close(); try { indexedDB.deleteDatabase('meridian-analytics-selftest'); } catch (e) {} });
  }).then(finish, function (e) { finish(); throw e; });
}
export { analyticsCases };
