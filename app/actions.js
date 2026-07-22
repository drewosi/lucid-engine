import { openViewer } from './viewer.js';
import { st } from './state.js';
import { fmtTok, toast } from './helpers.js';
/* ============ PROPOSED ACTIONS (EXPERIMENTAL INSTRUMENT) ============
   The model may suggest read-only actions in its trace JSON. Nothing runs
   without an explicit click:
     search → executed HERE, against the in-memory files only
     open   → opens the built-in file viewer
     git    → display + copy only; meridian never executes shell commands  */

function actGlobToRe(g) {
  return new RegExp('(^|/)' + g.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*') + '($|/)', 'i');
}
function evChip(resEl, label, path, line) {
  var b = document.createElement('button');
  b.type = 'button'; b.className = 'ev mono';
  b.textContent = label;
  b.addEventListener('click', function () { openViewer(path, line || 1, line || 1); });
  resEl.appendChild(b);
  return b;
}
function resNote(resEl, txt) {
  var d = document.createElement('div');
  d.className = 'sumline';
  d.textContent = txt;
  resEl.appendChild(d);
}

/* one engine behind search / def / refs — all in-memory, nothing touches disk.
   localSearchData is DOM-free so the LOCAL ENGINE provider can reuse it. */
function localSearchData(query, mode, filterGlob) {
  var fRe = null;
  if (filterGlob) { try { fRe = actGlobToRe(filterGlob); } catch (e) {} }
  var re = null, lq = query.toLowerCase();
  var sym = query.replace(/[^\w$.]/g, '').replace(/^.*\./, ''); /* last segment of a dotted symbol */
  var symEsc = sym.replace(/\$/g, '\\$');
  if (mode === 'def' && sym) {
    /* definition-ish lines across common languages */
    re = new RegExp('\\b(function|class|def|interface|type|struct|enum|trait|impl|const|let|var|fn|func|module|package|sub|proc)\\b[^\\n]{0,80}\\b' + symEsc + '\\b'
      + '|\\b' + symEsc + '\\s*[:=]\\s*(async\\s+)?(function|class|\\()', '');
  } else if (mode === 'refs' && sym) {
    re = new RegExp('\\b' + symEsc + '\\b');
  } else {
    try { re = new RegExp(query, 'i'); } catch (e) { re = null; }
  }
  var cap = mode === 'refs' ? 40 : 30, hits = [], filesHit = 0;
  st.files.forEach(function (f, p) {
    if (hits.length >= cap) return;
    if (fRe && !fRe.test(p)) return;
    var lines = f.content.split('\n'), had = false;
    for (var i = 0; i < lines.length && hits.length < cap; i++) {
      var hit = re ? re.test(lines[i]) : lines[i].toLowerCase().indexOf(lq) !== -1;
      if (!hit) continue;
      had = true;
      hits.push({ p: p, line: i + 1, text: lines[i] });
    }
    if (had) filesHit++;
  });
  return { hits: hits, filesHit: filesHit, cap: cap };
}
function runLocalSearch(query, resEl, mode, filterGlob) {
  resEl.innerHTML = '';
  var r = localSearchData(query, mode, filterGlob);
  r.hits.forEach(function (h) { evChip(resEl, h.p + ':' + h.line, h.p, h.line); });
  if (!r.hits.length) resNote(resEl, '// no matches in loaded files' + (filterGlob ? ' under filter ' + filterGlob : ''));
  else resNote(resEl, '// ' + (r.hits.length >= r.cap ? r.cap + '+ ' : r.hits.length + ' ') + (mode === 'def' ? 'definition-shaped ' : '') + 'match' + (r.hits.length === 1 ? '' : 'es') + ' in ' + r.filesHit + ' file' + (r.filesHit === 1 ? '' : 's') + ' — click a chip to inspect');
}

/* local directory summary — file count, tokens, largest, newest */
function runDirSummary(dirPath, resEl) {
  resEl.innerHTML = '';
  var clean = dirPath.replace(/\/+$/, '');
  var prefix = clean === '.' || clean === '' ? '' : clean + '/';
  var items = [];
  st.files.forEach(function (f, p) {
    if (!prefix || p.indexOf(prefix) === 0) items.push({ p: p, f: f });
  });
  if (!items.length) { resNote(resEl, '// no loaded files under “' + dirPath + '”'); return; }
  var tok = 0;
  items.forEach(function (it) { tok += it.f.tokens; });
  resNote(resEl, '// ' + (prefix || './') + ' — ' + items.length + ' files ≈' + fmtTok(tok) + ' tokens');
  resNote(resEl, '// largest:');
  items.slice().sort(function (a, b) { return b.f.tokens - a.f.tokens; }).slice(0, 3)
    .forEach(function (it) { evChip(resEl, it.p + ' ≈' + fmtTok(it.f.tokens), it.p, 1); });
  resNote(resEl, '// most recently modified:');
  items.slice().sort(function (a, b) { return b.f.mtime - a.f.mtime; }).slice(0, 3)
    .forEach(function (it) { evChip(resEl, it.p + (it.f.mtime ? ' · ' + new Date(it.f.mtime).toISOString().slice(0, 10) : ''), it.p, 1); });
}

/* recent changes across the whole loaded project, from file mtimes */
function runRecent(countStr, resEl) {
  resEl.innerHTML = '';
  var n = Math.min(Math.max(parseInt(countStr, 10) || 10, 1), 20);
  var all = [];
  st.files.forEach(function (f, p) { all.push({ p: p, m: f.mtime }); });
  if (!all.length) { resNote(resEl, '// no files loaded'); return; }
  all.sort(function (a, b) { return b.m - a.m; });
  resNote(resEl, '// ' + Math.min(n, all.length) + ' most recently modified (from file mtimes):');
  all.slice(0, n).forEach(function (it) {
    evChip(resEl, it.p + (it.m ? ' · ' + new Date(it.m).toISOString().slice(0, 10) : ''), it.p, 1);
  });
}

/* kind registry: badge label + how to run it locally (null = copy-only) */
var ACT_KINDS = {
  search: { badge: 'SEARCH',    run: function (a, res) { runLocalSearch(a.command, res, 'text', a.filter); } },
  def:    { badge: 'FIND DEF',  run: function (a, res) { runLocalSearch(a.command, res, 'def'); } },
  refs:   { badge: 'FIND REFS', run: function (a, res) { runLocalSearch(a.command, res, 'refs'); } },
  dir:    { badge: 'DIR SUM',   run: function (a, res) { runDirSummary(a.command, res); } },
  recent: { badge: 'RECENT',    run: function (a, res) { runRecent(a.command, res); } },
  open:   { badge: 'OPEN',      run: null },
  git:    { badge: 'TERMINAL',  run: null }
};

function renderActions(bd, actions) {
  if (!Array.isArray(actions) || !actions.length) return;
  var card = document.createElement('div');
  card.className = 'act-card';
  var hd = document.createElement('div');
  hd.className = 'act-hd';
  hd.innerHTML = 'PROPOSED ACTIONS <span class="exp">EXPERIMENTAL</span><span style="margin-left:auto">nothing runs without your click · all local · read-only</span>';
  card.appendChild(hd);
  actions.slice(0, 4).forEach(function (a) {
    if (!a || typeof a.command !== 'string' || !a.command.trim()) return;
    var kind = ACT_KINDS[a.kind] ? a.kind : 'git'; /* unknown kinds degrade to copy-only */
    var K = ACT_KINDS[kind];
    var row = document.createElement('div');
    row.className = 'act';
    var badge = document.createElement('span');
    badge.className = 'abadge' + (K.run || kind === 'open' ? '' : ' dim');
    badge.textContent = K.badge;
    badge.title = kind === 'git' ? 'Copy-only — meridian never executes shell commands' : 'Runs locally, against in-memory files only';
    row.appendChild(badge);
    var cmd = document.createElement('code');
    cmd.className = 'cmd mono';
    cmd.textContent = (kind === 'git' ? '$ ' : '') + a.command + (kind === 'search' && a.filter ? '   [' + a.filter + ']' : '');
    row.appendChild(cmd);
    var res = document.createElement('div');
    res.className = 'ev-row ares';
    if (K.run) {
      var run = document.createElement('button');
      run.type = 'button'; run.className = 'ev mono'; run.textContent = '[ RUN LOCALLY ]';
      run.addEventListener('click', function () { K.run(a, res); });
      row.appendChild(run);
    } else if (kind === 'open') {
      var op = document.createElement('button');
      op.type = 'button'; op.className = 'ev mono' + (st.files.has(a.command) ? '' : ' dead');
      op.textContent = '[ OPEN ]';
      if (st.files.has(a.command)) op.addEventListener('click', function () { openViewer(a.command, 1, 1); });
      else { op.disabled = true; op.title = 'File is not in the loaded context.'; }
      row.appendChild(op);
    } else {
      var cp = document.createElement('button');
      cp.type = 'button'; cp.className = 'ev mono'; cp.textContent = '[ COPY ]';
      cp.addEventListener('click', function () {
        (navigator.clipboard ? navigator.clipboard.writeText(a.command) : Promise.reject())
          .then(function () { toast('Copied — review it, then run it in your own terminal.'); })
          .catch(function () { toast('Copy failed — select the command text manually.'); });
      });
      row.appendChild(cp);
      var lbl = document.createElement('span');
      lbl.className = 'rail-note'; lbl.style.margin = '0';
      lbl.textContent = '// display only — meridian never executes shell commands';
      row.appendChild(lbl);
    }
    if (a.why) {
      var why = document.createElement('p');
      why.className = 'why'; why.textContent = '// ' + a.why;
      row.appendChild(why);
    }
    row.appendChild(res);
    card.appendChild(row);
  });
  bd.appendChild(card);
}

export { localSearchData, renderActions };
