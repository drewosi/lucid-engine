/* ============ EVIDENCE INTEGRITY (POST-CHECK) ============
   A model answer is only as good as its citations, so every answer is checked
   after the fact, by plain string work and no model:
     - each cited file exists in the loaded context
     - each cited line range is real (start >= 1, inside the file)
     - a quoted snippet actually appears inside the cited range (whitespace, quote
       style and line-number gutters are normalized; "..." in a quote skips text)
   Citations come from the structured trace when there is one, and ALSO from the
   prose (`path/to/file.js:12-14`, `file.js line 12`), so the check still runs when
   the model ignored the JSON trace format entirely.
   Any failure makes the whole answer UNVERIFIED and lists exactly what failed.
   An answer with no checkable citations is UNCITED: neither verified nor failed.
   Pure: no DOM, no app state. Callers pass the file table.                      */

var CODE_EXTS = /^(js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|rb|php|c|h|cc|cpp|hpp|cs|swift|kt|scala|ex|exs|lua|sh|bash|zsh|svelte|vue|html|css|scss|md|mdx|json|yml|yaml|toml|txt|sql|xml|gradle|proto|tf|dart|r|jl|zig)$/i;
var PATH = '((?:[\\w.@~+-]+\\/)*[\\w.@~+-]+\\.[A-Za-z]\\w{0,5})';
/* file.js:12 · file.js:12-20 · file.js:12–20 */
var PROSE_COLON = new RegExp('(?:^|[\\s`\'"(\\[])' + PATH + ':(\\d+)(?:\\s*[-–—]\\s*(\\d+))?(?![\\w/])', 'g');
/* file.js line 12 · file.js, lines 12-14 · file.js (lines 12 to 14) */
var PROSE_LINES = new RegExp('(?:^|[\\s`\'"(\\[])' + PATH + '[`\'")\\]]*\\s*,?\\s*\\(?\\s*lines?\\s+(\\d+)(?:\\s*(?:-|–|—|to)\\s*(\\d+))?', 'gi');

function stripGutter(line) { return line.replace(/^\s*\d+\s*[|:│]\s?/, ''); }
/* the comparison form: no whitespace, plain quotes and dashes, no gutters, no wrapping backticks */
function norm(s) {
  return String(s || '').split('\n').map(stripGutter).join('\n')
    .replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, '-').replace(/ /g, ' ')
    .replace(/^`+|`+$/g, '').replace(/\s+/g, '');
}
/* does quote q occur inside text? "..." / "…" splits it into ordered fragments */
function quoteIn(q, text) {
  var frags = String(q).split(/…|\.\.\./).map(norm).filter(function (f) { return f.length >= 3; });
  if (!frags.length) return true; /* too short to mean anything: not a failure */
  var hay = norm(text), at = 0;
  for (var i = 0; i < frags.length; i++) {
    var k = hay.indexOf(frags[i], at);
    if (k === -1) return false;
    at = k + frags[i].length;
  }
  return true;
}
/* where in the file a quote actually lives: [startLine, endLine] or null (diagnostic only) */
function locateQuote(q, content) {
  var frag = String(q).split(/…|\.\.\./).map(norm).filter(function (f) { return f.length >= 3; })[0];
  if (!frag) return null;
  var lines = content.split('\n'), acc = '', starts = [];
  for (var i = 0; i < lines.length; i++) { starts.push(acc.length); acc += norm(lines[i]); }
  var k = acc.indexOf(frag);
  if (k === -1) return null;
  var a = 0; while (a + 1 < starts.length && starts[a + 1] <= k) a++;
  var b = a; while (b + 1 < starts.length && starts[b + 1] < k + frag.length) b++;
  return [a + 1, b + 1];
}

/* unique file match for a cited path: exact, caller-resolved, or a single path suffix */
function findFile(files, cite, resolve) {
  if (files.has(cite)) return cite;
  var r = resolve ? resolve(cite) : cite;
  if (r && files.has(r)) return r;
  var clean = cite.replace(/^\.?\//, ''), hits = [];
  if (files.has(clean)) return clean;
  files.forEach(function (_, p) { if (p === clean || p.endsWith('/' + clean)) hits.push(p); });
  return hits.length === 1 ? hits[0] : null;
}

function collect(trace, answer) {
  var out = [], seen = Object.create(null);
  function add(c) {
    var key = c.source + '|' + c.file + '|' + c.start + '|' + c.end + '|' + (c.quote || '');
    if (seen[key]) return;
    seen[key] = 1; out.push(c);
  }
  if (trace && Array.isArray(trace.steps)) trace.steps.forEach(function (s) {
    (Array.isArray(s.evidence) ? s.evidence : []).forEach(function (ev) {
      if (!ev || typeof ev.file !== 'string') return;
      var a = parseInt(ev.startLine, 10), b = parseInt(ev.endLine, 10);
      add({ source: 'trace', file: ev.file, start: isFinite(a) ? a : 1, end: isFinite(b) ? b : (isFinite(a) ? a : 1), quote: typeof ev.quote === 'string' ? ev.quote : '' });
    });
  });
  var text = String(answer || ''), m;
  [PROSE_COLON, PROSE_LINES].forEach(function (re) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      var a = parseInt(m[2], 10), b = m[3] ? parseInt(m[3], 10) : a;
      add({ source: 'prose', file: m[1], start: a, end: b, quote: '' });
    }
  });
  return out;
}

/* opts: { trace, answer, files: Map(path -> {content}), resolve(cite) -> path } */
function verifyEvidence(opts) {
  var files = opts.files || new Map(), cites = collect(opts.trace, opts.answer), failures = [], checked = 0;
  cites.forEach(function (c) {
    var path = findFile(files, c.file, opts.resolve);
    if (!path) {
      /* an unresolvable PROSE path only counts when it looks like a source file: "example.com:443" is not a citation */
      if (c.source === 'prose' && !CODE_EXTS.test(c.file.slice(c.file.lastIndexOf('.') + 1))) return;
      checked++;
      failures.push({ source: c.source, file: c.file, start: c.start, end: c.end, quote: c.quote, reason: 'missing-file', detail: 'file is not in the loaded context' });
      return;
    }
    checked++;
    var content = files.get(path).content, lines = content.split('\n'), n = lines.length;
    var base = { source: c.source, file: path, start: c.start, end: c.end, quote: c.quote };
    if (c.start < 1 || c.end < c.start) { failures.push(Object.assign(base, { reason: 'bad-range', detail: 'lines ' + c.start + '–' + c.end + ' is not a valid range' })); return; }
    if (c.start > n) { failures.push(Object.assign(base, { reason: 'bad-range', detail: 'starts at line ' + c.start + ' but the file has ' + n + ' line' + (n === 1 ? '' : 's') })); return; }
    if (c.end > n) { failures.push(Object.assign(base, { reason: 'bad-range', detail: 'ends at line ' + c.end + ' but the file has ' + n + ' line' + (n === 1 ? '' : 's') })); return; }
    if (c.quote && !quoteIn(c.quote, lines.slice(c.start - 1, c.end).join('\n'))) {
      var at = locateQuote(c.quote, content);
      failures.push(Object.assign(base, { reason: 'quote-mismatch', detail: 'quoted text is not in lines ' + c.start + '–' + c.end + (at ? ' (it appears at ' + at[0] + (at[1] > at[0] ? '–' + at[1] : '') + ')' : ' or anywhere in the file') }));
    }
  });
  var status = !checked ? 'uncited' : failures.length ? 'unverified' : 'verified';
  return { status: status, checked: checked, passed: checked - failures.length, failures: failures };
}

export { norm, quoteIn, verifyEvidence };
