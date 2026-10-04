import { st } from './state.js';
import { $, lsDel, lsGet, lsSet, rememberFocus, returnFocus, toast, trap } from './helpers.js';
import { LS, MODELS, PROVIDERS } from './config.js';
import { download } from './export.js';
import { isMulti, repoList, scopeRepo } from './repos.js';
/* ============ USAGE ANALYTICS (OPT-IN · LOCAL-FIRST) ============
   OFF by default. While off, track() returns before building, storing or
   sending anything (pinned by a self-test). While on, each event is rebuilt
   through a field whitelist (sanitizeEvent) and kept in this browser's
   IndexedDB ('meridian-analytics', separate from project memory and drift).
   Every string field is an enum or a fixed-shape token, so code, file paths
   and keys have nowhere to go. The one free-text field, the question, is
   stored only when the separate "also store question text" switch is on, and
   is cut short with key-looking strings removed.
   Optional: the user can name their OWN collector URL (blank by default).
   Only then, and only while analytics is on and a model provider is selected,
   the same sanitized events are POSTed there in small batches. LOCAL-mode
   events are never sent, so LOCAL stays zero-network. A failed send is
   dropped (the local log keeps it) and sending pauses with a doubling
   back-off; there are no retries. There is no collection server anywhere in
   this code: the URL is whatever the user typed, or nothing.               */

var AN_DB = 'meridian-analytics', AN_STORE = 'events';
var AN_FORMAT = 'meridian-analytics', AN_VERSION = 1;
var AN_MAX_EVENTS = 5000;   /* the oldest are pruned past this */
var AN_Q_MAX = 300;         /* stored question text is cut to this many characters */
var EVENT_TYPES = ['question', 'share_link', 'share_bundle', 'repo_added'];
var EVENT_FIELDS = ['v', 'ts', 'type', 'intent', 'engine', 'provider', 'model', 'outcome', 'latencyMs', 'durationMs', 'tokensIn', 'tokensOut', 'repos', 'scope', 'files', 'q'];
var CSV_COLS = ['iso'].concat(EVENT_FIELDS.filter(function (k) { return k !== 'v'; }));
var NUM_FIELDS = ['latencyMs', 'durationMs', 'tokensIn', 'tokensOut', 'repos', 'files'];
var ENGINES = ['local', 'model'], OUTCOMES = ['ok', 'error', 'stopped'], SCOPES = ['single', 'all', 'repo'];
var INTENT_RE = /^[a-z][A-Za-z]{0,23}$/;           /* intent kinds: cycles, listType, … never a path or a sentence */
var MODEL_RE = /^[a-z0-9][a-z0-9.-]{0,40}$/;       /* built-in model ids only (checked against MODELS too) */
var SEND_DELAY = 2000, SEND_BATCH = 50, SEND_QUEUE_MAX = 200, SEND_TIMEOUT = 8000;
var BACKOFF_MIN = 60 * 1000, BACKOFF_MAX = 30 * 60 * 1000;

/* ---- settings (localStorage; listed in LS so clear-all removes them) ---- */
function analyticsOn() { return lsGet(LS.analytics) === '1'; }
function storeText() { return analyticsOn() && lsGet(LS.analyticsText) === '1'; }
function endpointUrl() { return lsGet(LS.analyticsUrl) || ''; }
/* https anywhere, plain http only to this machine; no credentials in the URL */
function validEndpoint(u) {
  if (!u) return { ok: false, msg: 'blank: nothing is sent' };
  var parsed;
  try { parsed = new URL(u); } catch (e) { return { ok: false, msg: 'not a valid URL' }; }
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) return { ok: false, msg: 'use https://, or http:// only for localhost' };
  if (parsed.username || parsed.password) return { ok: false, msg: 'remove the user:password part; put auth on your collector instead' };
  var warn = isLocal ? '' : 'this page’s security policy allows localhost only, so a remote collector works from a self-hosted copy with its origin added to connect-src in app.html.';
  return { ok: true, msg: warn, warn: warn };
}

/* ---- sanitizing: every event is rebuilt from the whitelist ---- */
function num(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0) return null;
  return Math.min(1e15, Math.round(v)); /* well above any ms timestamp (Date.now() ≈ 1.8e12) */
}
function pick(v, list, dflt) { return list.indexOf(v) !== -1 ? v : dflt; }
function modelId(m, provider) {
  if (typeof m === 'string' && MODEL_RE.test(m) && MODELS[m]) return m;
  return provider === 'custom' || provider === 'local' ? provider : 'other';
}
/* question text, only when the user asked for it: one line, key-looking strings
   removed (provider key shapes, the keys saved in this browser, and any long
   unbroken token), cut to AN_Q_MAX */
function scrubText(s) {
  var t = String(s || '').replace(/\s+/g, ' ').trim();
  [LS.key, LS.okey, LS.ckey].forEach(function (k) {
    var v = lsGet(k);
    if (v && v.length >= 6) t = t.split(v).join('[key removed]');
  });
  t = t.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[key removed]')
       .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[removed]');
  return t.length > AN_Q_MAX ? t.slice(0, AN_Q_MAX) + '…' : t;
}
function sanitizeEvent(raw, opts) {
  raw = raw || {};
  if (EVENT_TYPES.indexOf(raw.type) === -1) return null;
  var ev = { v: AN_VERSION, ts: num(raw.ts) || Date.now(), type: raw.type };
  if (raw.type === 'question') {
    ev.intent = typeof raw.intent === 'string' && INTENT_RE.test(raw.intent) ? raw.intent : 'other';
    ev.engine = pick(raw.engine, ENGINES, 'model');
    ev.provider = pick(raw.provider, Object.keys(PROVIDERS), 'other');
    ev.model = modelId(raw.model, ev.provider);
    ev.outcome = pick(raw.outcome, OUTCOMES, 'ok');
  }
  NUM_FIELDS.forEach(function (k) { var n = num(raw[k]); if (n !== null) ev[k] = n; });
  if (raw.scope != null) ev.scope = pick(raw.scope, SCOPES, 'single');
  if (raw.type === 'question' && opts && opts.text && typeof raw.q === 'string') {
    var q = scrubText(raw.q);
    if (q) ev.q = q;
  }
  return ev;
}
/* repo count, question scope and loaded-file count: numbers and an enum, never names */
function wsFacts() {
  var multi = isMulti();
  return { repos: multi ? repoList().length : (st.files.size ? 1 : 0), scope: !multi ? 'single' : (scopeRepo() !== null ? 'repo' : 'all'), files: st.files.size };
}

/* ---- storage: IndexedDB, own database ---- */
function idbStore(name) {
  var db = null;
  function open() {
    return new Promise(function (resolve, reject) {
      if (db) return resolve(db);
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      var req = indexedDB.open(name, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(AN_STORE, { keyPath: 'id', autoIncrement: true }); };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function run(mode, fn) {
    return open().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(AN_STORE, mode), rq = fn(tx.objectStore(AN_STORE));
        tx.oncomplete = function () { res(rq && rq.result); };
        tx.onerror = tx.onabort = function () { rej(tx.error || new Error('analytics store failed')); };
      });
    });
  }
  return {
    /* add, then prune the oldest past the cap, in one transaction */
    add: function (ev) {
      return run('readwrite', function (s) {
        var rq = s.add(ev), c = s.count();
        c.onsuccess = function () {
          var over = c.result - AN_MAX_EVENTS;
          if (over <= 0) return;
          var cur = s.openCursor();
          cur.onsuccess = function () { var k = cur.result; if (k && over-- > 0) { k.delete(); k.continue(); } };
        };
        return rq;
      });
    },
    all: function () { return run('readonly', function (s) { return s.getAll(); }).then(function (r) { return r || []; }); },
    clear: function () { return run('readwrite', function (s) { return s.clear(); }); },
    close: function () { if (db) db.close(); db = null; }
  };
}
var store = null;
var fetchImpl = function (u, o) { return fetch(u, o); };
function getStore() { return store || (store = idbStore(AN_DB)); }

/* ---- recording ---- */
/* the single entry point. Off: returns before touching storage or the network. */
function track(raw) {
  if (!analyticsOn()) return Promise.resolve(null);
  var facts = wsFacts(), base = { ts: Date.now() };
  for (var k in facts) base[k] = facts[k];
  for (var r in raw) if (raw[r] != null) base[r] = raw[r];
  var ev = sanitizeEvent(base, { text: storeText() });
  if (!ev) return Promise.resolve(null);
  /* LOCAL stays zero-network: neither LOCAL answers nor anything done while LOCAL is selected is sent */
  if (endpointUrl() && st.curProvider !== 'local' && ev.engine !== 'local') queueSend(ev);
  return getStore().add(ev).then(function () { return ev; }, function () { return ev; });
}
function readEvents() { return getStore().all().catch(function () { return []; }); }
function clearAnalytics() { return getStore().clear(); }
/* clear-all: close our connection so the browser can delete the database */
function wipeAnalytics() {
  resetSend();
  try { if (store && store.close) store.close(); store = null; indexedDB.deleteDatabase(AN_DB); } catch (e) {}
}

/* ---- the optional own endpoint ---- */
var sendQ = [], sendTimer = null, sendBusy = false, sendBlockedUntil = 0, sendFails = 0, lastSend = null;
function resetSend() {
  clearTimeout(sendTimer);
  sendQ = []; sendTimer = null; sendBusy = false; sendBlockedUntil = 0; sendFails = 0; lastSend = null;
}
function queueSend(ev) {
  if (Date.now() < sendBlockedUntil) return; /* paused after a failure: the local log still has it */
  sendQ.push(ev);
  if (sendQ.length > SEND_QUEUE_MAX) sendQ.shift();
  if (!sendTimer) sendTimer = setTimeout(flushSend, SEND_DELAY);
}
/* one POST per batch; failure drops the batch and pauses (60s, doubling to 30 min) */
function flushSend() {
  clearTimeout(sendTimer); sendTimer = null;
  var url = endpointUrl();
  if (!analyticsOn() || !validEndpoint(url).ok) { sendQ = []; return Promise.resolve(false); }
  if (sendBusy || !sendQ.length) return Promise.resolve(false);
  var batch = sendQ.splice(0, SEND_BATCH);
  sendBusy = true;
  var ctrl = new AbortController(), to = setTimeout(function () { ctrl.abort(); }, SEND_TIMEOUT);
  return Promise.resolve().then(function () {
    return fetchImpl(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: AN_FORMAT, v: AN_VERSION, events: batch }),
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ctrl.signal
    });
  }).then(function (res) {
    if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
    sendFails = 0; lastSend = { ok: true, ts: Date.now(), n: batch.length };
    return true;
  }).catch(function () {
    sendFails++;
    sendBlockedUntil = Date.now() + Math.min(BACKOFF_MAX, BACKOFF_MIN * Math.pow(2, sendFails - 1));
    sendQ = [];
    lastSend = { ok: false, ts: Date.now(), until: sendBlockedUntil };
    return false;
  }).finally(function () {
    clearTimeout(to);
    sendBusy = false;
    if (sendQ.length && !sendTimer) sendTimer = setTimeout(flushSend, SEND_DELAY);
  });
}

/* ---- summaries ---- */
/* nearest-rank percentile over an ascending array */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  var i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, i))];
}
function spread(vals) {
  var s = vals.slice().sort(function (a, b) { return a - b; });
  return { n: s.length, median: percentile(s, 50), p90: percentile(s, 90) };
}
function summarize(events) {
  var out = { total: events.length, questions: 0, local: 0, model: 0, errors: 0, tokensIn: 0, tokensOut: 0,
    byIntent: Object.create(null), byProvider: Object.create(null), features: { share_link: 0, share_bundle: 0, repo_added: 0 }, first: 0, last: 0 };
  var lat = { local: [], model: [], modelDur: [] };
  events.forEach(function (e) {
    if (e.ts && (!out.first || e.ts < out.first)) out.first = e.ts;
    if (e.ts > out.last) out.last = e.ts;
    if (e.type !== 'question') { if (e.type in out.features) out.features[e.type]++; return; }
    out.questions++;
    out[e.engine === 'local' ? 'local' : 'model']++;
    if (e.outcome === 'error') out.errors++;
    out.byIntent[e.intent || 'other'] = (out.byIntent[e.intent || 'other'] || 0) + 1;
    out.byProvider[e.provider || 'other'] = (out.byProvider[e.provider || 'other'] || 0) + 1;
    out.tokensIn += e.tokensIn || 0; out.tokensOut += e.tokensOut || 0;
    if (typeof e.latencyMs === 'number') lat[e.engine === 'local' ? 'local' : 'model'].push(e.latencyMs);
    if (e.engine !== 'local' && typeof e.durationMs === 'number') lat.modelDur.push(e.durationMs);
  });
  out.latency = { local: spread(lat.local), model: spread(lat.model), modelDuration: spread(lat.modelDur) };
  return out;
}

/* ---- export ---- */
/* stored rows carry an IndexedDB id; exports re-run the whitelist so only event fields leave */
function cleanForExport(e) { return sanitizeEvent(e, { text: typeof e.q === 'string' }); }
function analyticsJSON(events) {
  var evs = events.map(cleanForExport).filter(Boolean);
  return JSON.stringify({ format: AN_FORMAT, v: AN_VERSION, exported: new Date().toISOString(), count: evs.length, events: evs }, null, 1);
}
/* RFC 4180 quoting, plus a leading ' on cells a spreadsheet would run as a formula */
function csvCell(v) {
  if (v == null) return '';
  var s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function analyticsCSV(events) {
  var rows = [CSV_COLS.join(',')];
  events.map(cleanForExport).filter(Boolean).forEach(function (e) {
    rows.push(CSV_COLS.map(function (c) { return csvCell(c === 'iso' ? new Date(e.ts).toISOString() : e[c]); }).join(','));
  });
  return rows.join('\r\n') + '\r\n';
}

/* ---- settings UI ---- */
function setTgl(id, label, on, disabled) {
  var b = $(id);
  b.textContent = '[ ' + label + ': ' + (on ? 'ON' : 'OFF') + ' ]';
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('on', on);
  b.disabled = !!disabled;
}
function syncAnalyticsUI() {
  var on = analyticsOn();
  setTgl('anbtn', 'USAGE ANALYTICS', on);
  setTgl('antextbtn', 'ALSO STORE QUESTION TEXT', lsGet(LS.analyticsText) === '1', !on);
  var url = endpointUrl(), v = validEndpoint(url);
  if (document.activeElement !== $('anurl')) $('anurl').value = url;
  $('anurlstate').textContent = !url ? '// blank: analytics makes no network requests.'
    : !on ? '// saved, but analytics is off, so nothing is sent.'
    : '// sending model-mode events to this URL.' + (v.warn ? ' ' + v.warn : '');
}

/* ---- the panel ---- */
var anveil = $('anveil'), untrapAn = null;
function fmtMs(n) { return n == null ? '·' : n >= 10000 ? (n / 1000).toFixed(0) + ' s' : n >= 1000 ? (n / 1000).toFixed(1) + ' s' : n + ' ms'; }
function pct(n, of) { return of ? Math.round((n / of) * 100) + '%' : '0%'; }
function el(tag, cls, text) { var d = document.createElement(tag); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; }
function row(label, value, extra) {
  var r = el('div', 'prev-row');
  r.appendChild(el('span', 'pp', label));
  if (extra) r.appendChild(el('span', 'pw', extra));
  r.appendChild(el('span', 'pt', value));
  return r;
}
function breakdown(box, title, map, total) {
  box.appendChild(el('div', 'prev-sec', title));
  var keys = Object.keys(map).sort(function (a, b) { return map[b] - map[a] || (a < b ? -1 : 1); });
  if (!keys.length) { box.appendChild(el('p', 'prev-note', '// no questions yet.')); return; }
  keys.slice(0, 12).forEach(function (k) { box.appendChild(row(k, map[k] + ' · ' + pct(map[k], total))); });
  if (keys.length > 12) box.appendChild(el('p', 'prev-note', '// +' + (keys.length - 12) + ' more in the export.'));
}
function eventLabel(e) {
  if (e.type === 'question') return (e.engine === 'local' ? 'LOCAL' : String(e.provider || '').toUpperCase()) + ' · ' + e.intent + (e.outcome !== 'ok' ? ' · ' + e.outcome : '');
  return { share_link: 'share link created', share_bundle: 'share bundle saved', repo_added: 'repo added to workspace' }[e.type] || e.type;
}
function renderAnalytics(events) {
  var on = analyticsOn(), url = endpointUrl();
  var s = summarize(events);
  $('anstate').textContent = (on ? 'ON. Recording in this browser only' : 'OFF. Nothing is being recorded')
    + (on && url && validEndpoint(url).ok ? ', and sending model-mode events to your endpoint' : '') + '. '
    + s.total + ' event' + (s.total === 1 ? '' : 's') + ' stored'
    + (s.first ? ', ' + new Date(s.first).toISOString().slice(0, 10) + ' to ' + new Date(s.last).toISOString().slice(0, 10) : '') + '.';
  var box = $('anbody');
  box.innerHTML = '';
  if (!s.total) {
    box.appendChild(el('p', 'prev-note', on ? '// nothing recorded yet. ask a question and it shows up here.' : '// turn on USAGE ANALYTICS in settings to start a log. it stays in this browser.'));
    return;
  }
  var grid = el('div', 'stat-grid');
  [['QUESTIONS', s.questions], ['LOCAL', s.local], ['MODEL', s.model], ['ERRORS', s.errors], ['SHARE LINKS', s.features.share_link], ['BUNDLES', s.features.share_bundle], ['REPOS ADDED', s.features.repo_added]].forEach(function (t) {
    var d = el('div', 'stat-tile');
    d.appendChild(el('span', 'sl', t[0])); d.appendChild(el('span', 'sv', String(t[1])));
    grid.appendChild(d);
  });
  box.appendChild(grid);
  box.appendChild(el('div', 'prev-sec', 'LATENCY · MEDIAN / P90'));
  [['model · first token', s.latency.model], ['model · full answer', s.latency.modelDuration], ['LOCAL · answer', s.latency.local]].forEach(function (l) {
    box.appendChild(row(l[0], l[1].n ? fmtMs(l[1].median) + ' / ' + fmtMs(l[1].p90) : '·', 'n=' + l[1].n));
  });
  if (s.tokensIn || s.tokensOut) box.appendChild(el('p', 'prev-note', '// tokens reported by providers: ' + s.tokensIn + ' in · ' + s.tokensOut + ' out.'));
  box.appendChild(el('div', 'prev-sec', 'LOCAL VS MODEL'));
  box.appendChild(row('LOCAL engine (no AI)', s.local + ' · ' + pct(s.local, s.questions)));
  box.appendChild(row('model', s.model + ' · ' + pct(s.model, s.questions)));
  breakdown(box, 'BY INTENT', s.byIntent, s.questions);
  breakdown(box, 'BY PROVIDER', s.byProvider, s.questions);
  box.appendChild(el('div', 'prev-sec', 'RECENT EVENTS'));
  events.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 15).forEach(function (e) {
    var d = new Date(e.ts);
    var when = d.toISOString().slice(5, 10) + ' ' + d.toTimeString().slice(0, 5);
    var r = row(when + '  ' + eventLabel(e), e.type === 'question' ? fmtMs(e.latencyMs) : (e.files != null ? e.files + 'f' : ''), e.repos > 1 ? e.repos + ' repos · ' + e.scope : null);
    if (e.q) { var qn = el('div', 'prev-note', '“' + e.q + '”'); box.appendChild(r); box.appendChild(qn); }
    else box.appendChild(r);
  });
}
function openAnalytics() {
  rememberFocus();
  anveil.classList.add('on');
  untrapAn = trap(anveil.querySelector('.modal'));
  $('anclose').focus();
  $('anbody').innerHTML = '';
  $('anstate').textContent = 'Reading the log…';
  readEvents().then(renderAnalytics);
}
function closeAnalytics() {
  anveil.classList.remove('on');
  if (untrapAn) { untrapAn(); untrapAn = null; }
  returnFocus();
}
function exportAnalytics(fmt) {
  readEvents().then(function (evs) {
    if (!evs.length) { toast('The usage log is empty. Nothing to export.'); return; }
    var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    if (fmt === 'csv') download('meridian-usage-' + stamp + '.csv', 'text/csv', analyticsCSV(evs));
    else download('meridian-usage-' + stamp + '.json', 'application/json', analyticsJSON(evs));
    toast('Exported ' + evs.length + ' event' + (evs.length === 1 ? '' : 's') + ' as ' + (fmt === 'csv' ? 'CSV' : 'JSON') + '.');
  });
}

/* dev hook (self-tests): swap the store and the fetch, and reset the sender. Returns the previous pair. */
function __setAnalyticsForTest(o) {
  var prev = { store: store, fetch: fetchImpl };
  if (o && 'store' in o) store = o.store;
  if (o && 'fetch' in o) fetchImpl = o.fetch;
  resetSend();
  return prev;
}

export { AN_FORMAT, AN_Q_MAX, CSV_COLS, EVENT_FIELDS, __setAnalyticsForTest, analyticsCSV, analyticsJSON, analyticsOn, anveil, clearAnalytics, closeAnalytics,
  endpointUrl, flushSend as flushAnalyticsSend, idbStore, openAnalytics, percentile, readEvents, sanitizeEvent, storeText, summarize, track, validEndpoint, wipeAnalytics };

export function initAnalytics() {
  syncAnalyticsUI();
  $('anbtn').addEventListener('click', function () {
    var on = !analyticsOn();
    lsSet(LS.analytics, on ? '1' : '0');
    if (!on) resetSend();
    syncAnalyticsUI();
    toast(on ? 'Usage analytics on. Events are kept in this browser only' + (endpointUrl() ? ', plus your own endpoint for model-mode events.' : '.')
      : 'Usage analytics off. Nothing new is recorded or sent. The existing log stays until you clear it.');
  });
  $('antextbtn').addEventListener('click', function () {
    var on = lsGet(LS.analyticsText) !== '1';
    lsSet(LS.analyticsText, on ? '1' : '0');
    syncAnalyticsUI();
    toast(on ? 'Question text will be stored with each question (cut to ' + AN_Q_MAX + ' characters, key-looking strings removed).' : 'Question text off. New events carry no question text.');
  });
  $('anurlsave').addEventListener('click', function () {
    var u = $('anurl').value.trim();
    if (!u) { lsDel(LS.analyticsUrl); resetSend(); $('anurl').blur(); syncAnalyticsUI(); toast('Endpoint cleared. Analytics makes no network requests.'); return; }
    var v = validEndpoint(u);
    if (!v.ok) { $('anurlstate').textContent = '// ' + v.msg + '.'; toast('Endpoint not saved: ' + v.msg + '.'); return; }
    lsSet(LS.analyticsUrl, u); resetSend();
    $('anurl').blur(); syncAnalyticsUI();
    toast('Endpoint saved.' + (analyticsOn() ? '' : ' Analytics is off, so nothing is sent until you turn it on.'));
  });
  $('anurl').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('anurlsave').click(); } });
  $('anopen').addEventListener('click', openAnalytics);
  $('anclose').addEventListener('click', closeAnalytics);
  anveil.addEventListener('click', function (e) { if (e.target === anveil) closeAnalytics(); });
  $('anjson').addEventListener('click', function () { exportAnalytics('json'); });
  $('ancsv').addEventListener('click', function () { exportAnalytics('csv'); });
  $('anclear').addEventListener('click', function () {
    if (!confirm('Delete every usage event stored in this browser? This cannot be undone. Export first if you want a copy.')) return;
    clearAnalytics().then(function () { toast('Usage log cleared.'); }, function () { toast('Could not clear the usage log: IndexedDB is unavailable.'); }).then(function () { return readEvents(); }).then(renderAnalytics);
  });
}
