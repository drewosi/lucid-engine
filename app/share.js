import { st, sortedPaths } from './state.js';
import { estTokens, staticScore } from './smart-context.js';
import { detectLang } from './indexer.js';
import { afterIngest, clearContext } from './ingest.js';
import { $, copyText, rememberFocus, returnFocus, setStatus, toast, trap } from './helpers.js';
import { convoIn } from './trace.js';
import { setProvider } from './shell.js';
import { download } from './export.js';
import { LOOSE, cleanLabel, isMulti, registerRepo, repoList, repoName, repoOf, scopeFilter, scopeRepo } from './repos.js';
/* ============ SHARE (LINK + BUNDLE, NO SERVER) ============
   Packs a snapshot of the loaded project (paths, file text, last-modified
   times, and a display name; nothing else) into either
     · a link: deflate-raw (CompressionStream) + base64url in the URL fragment,
       app.html#share=v1.<data>. Browsers never send the fragment in a request,
       so GitHub Pages never receives it; or
     · a bundle: the same payload as plain, readable JSON in a .meridian file,
       for projects too big for a link.
   The payload is built from st.files ONLY, through a field whitelist: no key,
   provider, model, conversation, saved project or other localStorage value can
   reach it (pinned by a self-test). The index is rebuilt on open; it is
   cheaper than shipping it. Opening either form loads a read-only SHARED
   project into tab memory: nothing is saved, drift is not recorded, and
   loading your own folder replaces it.
   Workspaces: paths already start with their repo label, so a share from
   several repos also carries an optional `repos` list of those labels (labels
   only, nothing else). The recipient gets the same repos, read-only. The
   default selection follows the question scope: the active repo when [ ASK ]
   is narrowed to it, every repo otherwise.                                  */

var SHARE_LINK_MAX_CHARS = 32000;      /* whole-URL ceiling: conservative so links survive chat apps and email */
var SHARE_FORMAT = 'meridian-share', SHARE_VERSION = 1;
var SHARE_HASH = '#share=', SHARE_DATA_PREFIX = 'v1.';
var SHARE_MAX_FILES = 8000, SHARE_MAX_FILE_CHARS = 512 * 1024; /* the same caps a folder load enforces */
var SHARE_MAX_TOTAL = 64 * 1024 * 1024;  /* decoded ceiling; also stops a decompression bomb mid-stream */
var BUNDLE_MAX_BYTES = 96 * 1024 * 1024;
var SHARE_EST_RATIO = 0.33;              /* encoded chars per text char for typical source (deflate ≈4x, base64 +33%) */
var PAYLOAD_FIELDS = ['format', 'v', 'name', 'created', 'files', 'repos'];
var SHARE_MAX_REPOS = 32;
var FILE_FIELDS = ['p', 'c', 'm'];
var BUNDLE_NOTE = 'MERIDIAN shared project. This file contains source code in plain text: anyone who has it can read it. Open it in the MERIDIAN workbench with [ OPEN SHARED ] or drop it on the context panel.';
/* likely-secret files start unticked: .env files, private keys, credential/secret/password files */
var SECRETISH = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx|keystore)|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*(secret|credential|password)s?[^/]*)$/i;

var SHARE_ERRORS = {
  corrupt: 'This share link is damaged or incomplete. Chat apps and email sometimes cut long links short. Ask the sender to send it again, or to send a .meridian bundle file instead.',
  version: 'This share was made by a newer version of MERIDIAN. Reload the page to get the latest version, then open it again.',
  invalid: 'This share does not contain a readable MERIDIAN project.',
  toobig: 'This share is bigger than MERIDIAN opens (512 KB per file, 8,000 files, 64 MB in total).',
  toolong: 'Too big for a link. Untick some files, or download a .meridian bundle instead.',
  unsupported: 'This browser cannot compress or decompress share links (it lacks CompressionStream). Try a current Chrome, Edge, Firefox or Safari.',
  bundle: 'That file is not a MERIDIAN share bundle (.meridian).'
};
function shareError(code) {
  var e = new Error(SHARE_ERRORS[code] || SHARE_ERRORS.corrupt);
  e.code = code; e.friendly = e.message;
  return e;
}

/* ---- payload ---- */
function shareName() {
  if (isMulti()) {
    var sr = scopeRepo();
    if (sr !== null) return repoName(sr);
    return repoList().filter(function (r) { return !r.loose; }).map(function (r) { return r.label; }).join(' + ') || 'workspace';
  }
  var it = st.files.keys().next();
  if (it.done) return 'project';
  var p = it.value;
  return p.indexOf('/') !== -1 ? p.slice(0, p.indexOf('/')) : (st.shared ? st.shared.name : 'project');
}
/* whitelist build: only path, text and mtime per file, plus a name, a timestamp
   and (workspaces only) the repo labels the shared paths start with */
function buildSharePayload(paths, opts) {
  opts = opts || {};
  var files = [], repos = [];
  var multi = isMulti();
  paths.slice().sort().forEach(function (p) {
    var f = st.files.get(p);
    if (!f) return;
    var e = { p: p, c: f.content };
    if (f.mtime) e.m = f.mtime;
    files.push(e);
    var r = multi ? repoOf(p) : LOOSE;
    if (r !== LOOSE && repos.indexOf(r) === -1) repos.push(r);
  });
  var out = { format: SHARE_FORMAT, v: SHARE_VERSION, name: String(opts.name || shareName()).slice(0, 60), created: opts.now != null ? opts.now : Date.now(), files: files };
  if (repos.length) out.repos = repos;
  return out;
}
/* decoded input is untrusted: rebuild a clean copy, field by field */
function validatePayload(o) {
  if (!o || typeof o !== 'object' || o.format !== SHARE_FORMAT) throw shareError('invalid');
  if (typeof o.v !== 'number') throw shareError('invalid');
  if (o.v > SHARE_VERSION) throw shareError('version');
  if (!Array.isArray(o.files) || !o.files.length) throw shareError('invalid');
  if (o.files.length > SHARE_MAX_FILES) throw shareError('toobig');
  var seen = new Set(), files = [], total = 0;
  for (var i = 0; i < o.files.length; i++) {
    var e = o.files[i];
    if (!e || typeof e.p !== 'string' || typeof e.c !== 'string') throw shareError('invalid');
    var p = e.p.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!p || p.length > 1024 || /[\u0000-\u001f]/.test(p) || p.split('/').some(function (s) { return s === '..'; })) throw shareError('invalid');
    if (e.c.length > SHARE_MAX_FILE_CHARS) throw shareError('toobig');
    total += e.c.length;
    if (total > SHARE_MAX_TOTAL) throw shareError('toobig');
    if (seen.has(p)) continue;
    seen.add(p);
    files.push({ p: p, c: e.c, m: typeof e.m === 'number' && isFinite(e.m) && e.m > 0 ? e.m : 0 });
  }
  var name = typeof o.name === 'string' ? o.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) : '';
  var out = { format: SHARE_FORMAT, v: o.v, name: name || 'shared project', created: typeof o.created === 'number' && isFinite(o.created) ? o.created : 0, files: files };
  /* optional repo labels: kept only when clean and actually the first segment of a shared path */
  if (Array.isArray(o.repos)) {
    var tops = Object.create(null), repos = [];
    files.forEach(function (f) { if (f.p.indexOf('/') !== -1) tops[f.p.slice(0, f.p.indexOf('/'))] = 1; });
    o.repos.slice(0, SHARE_MAX_REPOS).forEach(function (r) {
      if (typeof r === 'string' && r === cleanLabel(r) && tops[r] && repos.indexOf(r) === -1) repos.push(r);
    });
    if (repos.length) out.repos = repos;
  }
  return out;
}

/* ---- bytes: deflate-raw + base64url ---- */
function readAll(stream, max) {
  var reader = stream.getReader(), parts = [], total = 0;
  function step() {
    return reader.read().then(function (r) {
      if (r.done) {
        var out = new Uint8Array(total), off = 0;
        parts.forEach(function (b) { out.set(b, off); off += b.byteLength; });
        return out;
      }
      total += r.value.byteLength;
      if (total > max) { reader.cancel().catch(function () {}); throw shareError('toobig'); }
      parts.push(r.value);
      return step();
    });
  }
  return step();
}
function hasStreams() { return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'; }
function deflate(bytes) { return readAll(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')), Infinity); }
function inflate(bytes, max) { return readAll(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')), max); }
function b64urlEncode(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  if (!/^[A-Za-z0-9_-]+$/.test(str)) throw shareError('corrupt');
  var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  var bin;
  try { bin = atob(b64); } catch (e) { throw shareError('corrupt'); }
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/* payload → 'v1.<base64url>' */
function encodeShareData(payload) {
  if (!hasStreams()) return Promise.reject(shareError('unsupported'));
  return deflate(new TextEncoder().encode(JSON.stringify(payload))).then(function (z) { return SHARE_DATA_PREFIX + b64urlEncode(z); });
}
/* 'v1.<base64url>' → validated payload; every failure is a shareError with a friendly message */
function decodeShareData(data) {
  return Promise.resolve().then(function () {
    if (!hasStreams()) throw shareError('unsupported');
    data = String(data || '').trim();
    try { data = decodeURIComponent(data); } catch (e) { throw shareError('corrupt'); }
    var m = /^v(\d+)\.(.*)$/.exec(data);
    if (!m) throw shareError('corrupt');
    if (+m[1] !== SHARE_VERSION) throw shareError(+m[1] > SHARE_VERSION ? 'version' : 'corrupt');
    return inflate(b64urlDecode(m[2]), SHARE_MAX_TOTAL);
  }).then(function (bytes) {
    var obj;
    try { obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch (e) { throw shareError('corrupt'); }
    return validatePayload(obj);
  }).catch(function (e) {
    throw (e && e.friendly) ? e : shareError('corrupt'); /* stream errors (truncated / not deflate) surface as TypeErrors */
  });
}

/* ---- links ---- */
function shareBase() { return location.origin + location.pathname; }
function rawChars(paths) {
  var n = 0;
  paths.forEach(function (p) { var f = st.files.get(p); if (f) n += f.content.length + p.length; });
  return n;
}
/* the encoded link size for a selection: { chars, fits, url (only when it fits), estimated }.
   Selections far past any plausible compression are estimated instead of encoded. */
function measureLink(paths) {
  if (!paths.length) return Promise.resolve({ chars: 0, fits: false, url: null, estimated: false, empty: true });
  var raw = rawChars(paths);
  if (raw > SHARE_LINK_MAX_CHARS * 64) return Promise.resolve({ chars: Math.round(raw * SHARE_EST_RATIO), fits: false, url: null, estimated: true });
  return encodeShareData(buildSharePayload(paths)).then(function (d) {
    var url = shareBase() + SHARE_HASH + d;
    var fits = url.length <= SHARE_LINK_MAX_CHARS;
    return { chars: url.length, fits: fits, url: fits ? url : null, estimated: false };
  });
}
/* the only path that hands out a link: refuses anything over the limit */
function createShareLink(paths) {
  return measureLink(paths).then(function (m) {
    if (!m.fits) throw shareError(m.empty ? 'invalid' : 'toolong');
    return m;
  });
}
function isSecretish(p) { return SECRETISH.test(p); }
/* default selection: everything (minus secret-looking files) when it fits;
   otherwise the checked files ranked by importance, greedily packed toward the
   limit using the measured compression ratio, shrinking until it really fits */
function defaultSharePaths() {
  var inScope = scopeFilter(); /* a workspace narrowed to one repo shares that repo */
  var all = sortedPaths().filter(function (p) { return !isSecretish(p) && inScope(p); });
  return measureLink(all).then(function (m) {
    if (m.fits || !all.length) return all;
    var pool = all.filter(function (p) { return st.files.get(p).checked; });
    if (!pool.length) pool = all;
    pool.sort(function (a, b) { return (st.files.get(b).base || 0) - (st.files.get(a).base || 0) || (a < b ? -1 : 1); });
    var ratio = Math.max(0.05, m.chars / Math.max(1, rawChars(all)));
    var target = SHARE_LINK_MAX_CHARS * 0.9 / ratio;
    function attempt(n) {
      var pick = [], sum = 0;
      pool.forEach(function (p) {
        var sz = st.files.get(p).content.length + p.length;
        if (sum + sz <= target) { pick.push(p); sum += sz; }
      });
      if (!pick.length) return Promise.resolve([]);
      return measureLink(pick).then(function (r) {
        if (r.fits || n >= 6) return r.fits ? pick.sort() : [];
        target *= 0.8;
        return attempt(n + 1);
      });
    }
    return attempt(0);
  });
}

/* ---- bundles (.meridian): the same payload as readable JSON ---- */
function bundleText(payload) {
  var o = { format: payload.format, v: payload.v, note: BUNDLE_NOTE, name: payload.name, created: payload.created };
  if (payload.repos) o.repos = payload.repos;
  o.files = payload.files;
  return JSON.stringify(o, null, 1);
}
function parseBundleText(text) {
  var obj;
  try { obj = JSON.parse(text); } catch (e) { throw shareError('bundle'); }
  if (!obj || obj.format !== SHARE_FORMAT) throw shareError('bundle');
  return validatePayload(obj);
}
function readBundleFile(file) {
  if (!file || file.size > BUNDLE_MAX_BYTES) return Promise.reject(shareError(file ? 'toobig' : 'bundle'));
  return file.text().then(parseBundleText, function () { throw shareError('bundle'); });
}

/* ---- opening: a read-only SHARED project in tab memory ---- */
function payloadEntries(payload) {
  return payload.files.map(function (f) {
    return [f.p, { content: f.c, lines: f.c.split('\n').length, tokens: estTokens(f.c, f.p), mtime: f.m || 0, base: staticScore(f.p), checked: true, lang: detectLang(f.p, f.c) }];
  });
}
function loadSharedPayload(payload, source) {
  clearContext();
  st.lastDirHandle = null; st.pendingProject = null;
  payloadEntries(payload).forEach(function (kv) { st.totalBytes += kv[1].content.length; st.files.set(kv[0], kv[1]); });
  (payload.repos || []).forEach(function (r) { registerRepo(r, null); }); /* a shared workspace keeps its repos */
  st.shared = { name: payload.name, count: payload.files.length, created: payload.created, source: source, repos: (payload.repos || []).length };
  var db = $('demobanner'); if (db) db.remove();
  afterIngest();
  syncSharedUI();
  renderShareBanner();
}
/* opening over a project the user loaded themselves replaces it, so ask first */
function confirmOpen(payload, source) {
  if (st.files.size && !st.shared) {
    setStatus('IDLE · shared project waiting for [ OPEN ]');
    toast('Open the shared project “' + payload.name + '”? It replaces the project loaded now.', { label: '[ OPEN ]', fn: function () { loadSharedPayload(payload, source); } });
  } else loadSharedPayload(payload, source);
}
function showShareError(e) {
  var msg = (e && e.friendly) || SHARE_ERRORS.corrupt;
  setStatus('SHARE NOT OPENED', true);
  renderShareBanner(msg);
  toast(msg);
}
/* read #share=… once, then strip it from the address bar so it is not re-shared by accident */
function openShareFromHash() {
  var h = location.hash;
  if (h.indexOf(SHARE_HASH) !== 0) return;
  var data = h.slice(SHARE_HASH.length);
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  setStatus('OPENING SHARED PROJECT…');
  decodeShareData(data).then(function (p) { confirmOpen(p, 'link'); }).catch(showShareError);
}
function openBundleFile(file) {
  setStatus('OPENING SHARED BUNDLE…');
  readBundleFile(file).then(function (p) { confirmOpen(p, 'bundle'); }).catch(showShareError);
}

/* rail chip + banner reflect st.shared; called on load and by clearContext() */
function syncSharedUI() {
  var note = $('sharednote');
  if (note) {
    note.hidden = !st.shared;
    if (st.shared) $('sharedname').textContent = '“' + st.shared.name + '”, a snapshot shared with you. in this tab only; nothing is saved. load your own folder to replace it.';
  }
  if (!st.shared) { var b = $('sharebanner'); if (b && !b.classList.contains('err')) b.remove(); }
}
function renderShareBanner(errMsg) {
  var old = $('sharebanner'); if (old) old.remove();
  var b = document.createElement('div');
  b.id = 'sharebanner'; b.className = 'demobanner' + (errMsg ? ' err' : '');
  var top = document.createElement('div');
  var dm = document.createElement('span'); dm.className = 'dm mono';
  dm.textContent = errMsg ? 'SHARED PROJECT · COULD NOT OPEN' : 'SHARED · READ-ONLY';
  top.appendChild(dm); b.appendChild(top);
  var dt = document.createElement('div'); dt.className = 'dt';
  var acts = document.createElement('div'); acts.className = 'demoacts';
  if (errMsg) {
    dt.textContent = errMsg + ' Nothing was loaded.';
  } else {
    var nm = document.createElement('b'); nm.textContent = st.shared.name; /* sender-controlled: text only, never markup */
    dt.appendChild(document.createTextNode('You are viewing '));
    dt.appendChild(nm);
    dt.appendChild(document.createTextNode(': ' + st.shared.count + ' file' + (st.shared.count === 1 ? '' : 's') + (st.shared.repos >= 2 ? ' from ' + st.shared.repos + ' repos' : '') + ' someone shared with you'
      + (st.shared.created ? ' on ' + new Date(st.shared.created).toISOString().slice(0, 10) : '')
      + '. It lives in this tab only. Nothing was uploaded or saved, and closing the tab discards it. Ask about it with the LOCAL engine (no key) or your own key.'));
    var chips = document.createElement('div'); chips.className = 'demochips';
    ['signals', 'project structure', 'entry points'].forEach(function (q) {
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'demochip mono'; c.textContent = q;
      c.addEventListener('click', function () { $('prompt').value = q; $('askform').requestSubmit(); });
      chips.appendChild(c);
    });
    if (st.curProvider !== 'local') {
      var loc = document.createElement('button');
      loc.type = 'button'; loc.className = 'btn-quiet acc'; loc.textContent = '[ ASK WITH LOCAL ]';
      loc.addEventListener('click', function () { setProvider('local'); loc.remove(); toast('Provider: LOCAL. No key, and nothing leaves this tab.'); });
      acts.appendChild(loc);
    }
    var cl = document.createElement('button');
    cl.type = 'button'; cl.className = 'btn-quiet'; cl.textContent = '[ CLOSE SHARED PROJECT ]';
    cl.addEventListener('click', function () { $('clearctx').click(); });
    acts.appendChild(cl);
  }
  b.appendChild(dt);
  if (chips) b.appendChild(chips);
  var dis = document.createElement('button');
  dis.type = 'button'; dis.className = 'btn-quiet'; dis.textContent = '[ dismiss ]';
  dis.addEventListener('click', function () { b.remove(); });
  acts.appendChild(dis);
  b.appendChild(acts);
  convoIn.insertBefore(b, convoIn.firstChild);
}

/* ---- the share modal ---- */
var shareveil = $('shareveil'), untrapShare = null;
var shareSel = new Set(), shareGen = 0, shareLast = null;
function fmtSize(n) { return n >= 1024 ? (n / 1024).toFixed(1) + 'KB' : n + 'B'; }
function fmtK(n) { return (n / 1000).toFixed(1) + 'K'; }
function renderShareList() {
  var list = $('sharelist'), tpl = $('tpl-file-row');
  list.innerHTML = '';
  var frag = document.createDocumentFragment();
  sortedPaths().forEach(function (p) {
    var f = st.files.get(p);
    var row = tpl.content.firstElementChild.cloneNode(true);
    var cb = row.querySelector('input');
    cb.checked = shareSel.has(p);
    cb.setAttribute('aria-label', 'Include ' + p);
    cb.addEventListener('change', function () { if (cb.checked) shareSel.add(p); else shareSel.delete(p); remeasure(); });
    var nm = row.querySelector('.nm'); nm.textContent = p; nm.title = p;
    var tk = row.querySelector('.tk');
    tk.textContent = (isSecretish(p) ? 'SECRET? · ' : '') + fmtSize(f.content.length);
    if (isSecretish(p)) { row.classList.add('secret'); tk.title = 'Looks like a secrets file, so it starts unticked. Tick it only if you mean to share it.'; }
    frag.appendChild(row);
  });
  list.appendChild(frag);
}
function remeasure() {
  var gen = ++shareGen, paths = Array.from(shareSel);
  shareLast = null;
  $('sharelinkrow').hidden = true;
  $('sharecount').textContent = paths.length + ' OF ' + st.files.size;
  $('sharetxt').textContent = 'LINK · measuring…';
  measureLink(paths).then(function (m) {
    if (gen !== shareGen) return;
    shareLast = { m: m, paths: paths };
    var bar = $('sharebar');
    bar.querySelector('i').style.width = Math.min(100, (m.chars / SHARE_LINK_MAX_CHARS) * 100) + '%';
    bar.classList.toggle('full', !m.fits && !m.empty);
    $('sharetxt').textContent = 'LINK ' + (m.estimated ? '≈ ' : '') + fmtK(m.chars) + ' / ' + fmtK(SHARE_LINK_MAX_CHARS) + ' CHARS';
    $('sharemax').textContent = paths.length + ' FILE' + (paths.length === 1 ? '' : 'S') + ' · ' + fmtSize(rawChars(paths)) + ' OF TEXT';
    $('sharenote').textContent = m.empty ? '// tick at least one file.'
      : m.fits ? '// fits in a link. a bundle works too, and has no size limit.'
      : '// too big for a link by ' + (m.estimated ? '≈ ' : '') + fmtK(m.chars - SHARE_LINK_MAX_CHARS) + ' chars. untick files, or download a .meridian bundle (no size limit; send it as a file).';
  }).catch(function (e) {
    if (gen !== shareGen) return;
    $('sharetxt').textContent = 'LINK · unavailable';
    $('sharenote').textContent = '// ' + ((e && e.friendly) || 'could not measure the link.') + ' the bundle still works.';
  });
}
function needAck() {
  if ($('shareack').checked) return false;
  toast('Tick the box first: the link or bundle contains the code itself.');
  $('shareack').focus();
  return true;
}
function copyShareLink() {
  if (needAck()) return;
  if (!shareSel.size) { toast('Tick at least one file to share.'); return; }
  function give(m) {
    var inp = $('sharelink'); inp.value = m.url;
    $('sharelinkrow').hidden = false;
    copyText(m.url, 'Share link copied. Anyone who has it can read the ' + shareSel.size + ' file' + (shareSel.size === 1 ? '' : 's') + ' inside.');
    inp.focus(); inp.select();
  }
  /* reuse the measurement when it is current, so the copy stays inside the click */
  if (shareLast && shareLast.paths.length === shareSel.size) {
    if (shareLast.m.fits) give(shareLast.m); else toast(SHARE_ERRORS.toolong);
    return;
  }
  createShareLink(Array.from(shareSel)).then(give).catch(function (e) { toast((e && e.friendly) || SHARE_ERRORS.toolong); });
}
function downloadBundle() {
  if (needAck()) return;
  if (!shareSel.size) { toast('Tick at least one file to share.'); return; }
  var payload = buildSharePayload(Array.from(shareSel));
  var fname = (payload.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project') + '.meridian';
  download(fname, 'application/json', bundleText(payload));
  toast('Bundle saved as ' + fname + '. Anyone who has the file can read the ' + payload.files.length + ' file' + (payload.files.length === 1 ? '' : 's') + ' inside.');
}
function openShare() {
  if (!st.files.size) { toast('Load a project first.'); return; }
  $('shareack').checked = false;
  $('sharelinkrow').hidden = true; $('sharelink').value = '';
  shareSel = new Set(); shareLast = null;
  $('sharelist').innerHTML = '';
  $('sharetxt').textContent = 'LINK · choosing files that fit…';
  $('sharemax').textContent = ''; $('sharenote').textContent = '';
  /* workspaces: say which repos the default covers, and that their labels travel */
  var wsn = $('sharerepos'), sr = scopeRepo();
  wsn.hidden = !isMulti();
  if (isMulti()) {
    wsn.textContent = sr !== null
      ? '// questions are scoped to ' + repoName(sr) + ', so only its files start ticked. [ ALL ] adds every repo. repo labels travel with the files, so the recipient sees the same repos, read-only.'
      : '// ' + repoList().length + ' repos loaded. each file keeps its repo label (repo/path), so the recipient sees the same repos, read-only.';
  }
  rememberFocus();
  shareveil.classList.add('on');
  untrapShare = trap(shareveil.querySelector('.modal'));
  $('shareclose').focus();
  var gen = ++shareGen;
  defaultSharePaths().then(function (paths) {
    if (gen !== shareGen) return;
    shareSel = new Set(paths);
    renderShareList(); remeasure();
  }).catch(function () {
    if (gen !== shareGen) return;
    renderShareList(); remeasure();
  });
}
function closeShare() {
  shareGen++;
  shareveil.classList.remove('on');
  if (untrapShare) { untrapShare(); untrapShare = null; }
  returnFocus();
}

export { BUNDLE_NOTE, FILE_FIELDS, PAYLOAD_FIELDS, SHARE_LINK_MAX_CHARS, bundleText, buildSharePayload, closeShare, createShareLink, decodeShareData, defaultSharePaths, encodeShareData, isSecretish, measureLink, openBundleFile, openShare, openShareFromHash, parseBundleText, payloadEntries, readBundleFile, shareveil, syncSharedUI };

export function initShare() {
  $('sharebtn').addEventListener('click', openShare);
  $('shareclose').addEventListener('click', closeShare);
  shareveil.addEventListener('click', function (e) { if (e.target === shareveil) closeShare(); });
  $('sharecopy').addEventListener('click', copyShareLink);
  $('sharebundle').addEventListener('click', downloadBundle);
  $('shareall').addEventListener('click', function () { shareSel = new Set(sortedPaths()); renderShareList(); remeasure(); });
  $('sharenone').addEventListener('click', function () { shareSel = new Set(); renderShareList(); remeasure(); });
  $('sharefit').addEventListener('click', function () {
    var gen = ++shareGen;
    $('sharetxt').textContent = 'LINK · choosing files that fit…';
    defaultSharePaths().then(function (paths) { if (gen !== shareGen) return; shareSel = new Set(paths); renderShareList(); remeasure(); });
  });
  $('bundlebtn').addEventListener('click', function () { $('bundlepick').click(); });
  $('bundlepick').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (f) openBundleFile(f);
  });
  /* a share link pasted into an already-open tab changes only the hash */
  window.addEventListener('hashchange', openShareFromHash);
}
