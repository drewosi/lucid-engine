import { verifyEvidence, norm, quoteIn } from './verify.js';
import { exchangeMarkdown, extractTrace, renderIntegrity } from './trace.js';
/* ============ SELF-TESTS: EVIDENCE INTEGRITY ============
   The post-check on model answers: file exists, range is real, quote is inside
   the range; trace and prose citations; UNVERIFIED / UNCITED states and the UI. */

function table(map) {
  var m = new Map();
  Object.keys(map).forEach(function (k) { m.set(k, { content: map[k] }); });
  return m;
}
var A = ['export function add(a, b) {', '  return a + b;', '}', '', 'export const NAME = "calc";', 'const x = 1; // end'].join('\n');
var FILES = table({ 'src/calc.js': A, 'src/util/a.js': 'one\ntwo\nthree', 'lib/util/a.js': 'uno\ndos', 'README.md': '# T\n\nhello world' });
function trace(evs) { return { steps: [{ action: 'x', evidence: evs }] }; }
function ev(file, a, b, quote) { return { file: file, startLine: a, endLine: b, quote: quote }; }
function run(o) { return verifyEvidence(Object.assign({ files: FILES }, o)); }
function reasons(r) { return r.failures.map(function (f) { return f.reason; }).join(','); }

function fakeMsg() {
  var el = document.createElement('div');
  el.innerHTML = '<div class="term-hd"><span class="chip">TRACED</span></div><div class="bd"></div>';
  return el;
}

function verifyCases(ok) {
  /* the happy path */
  var good = run({ trace: trace([ev('src/calc.js', 1, 2, 'return a + b;')]), answer: 'add() sums.' });
  ok('verify · a real file, real range and a matching quote is VERIFIED', good.status === 'verified' && good.checked === 1 && good.passed === 1);
  ok('verify · whitespace and quote-style differences in a quote are normalized', run({ trace: trace([ev('src/calc.js', 1, 1, 'export  function add( a,b )  {')]) }).status === 'verified'
    && run({ trace: trace([ev('src/calc.js', 5, 5, 'export const NAME = “calc”;')]) }).status === 'verified');
  ok('verify · line-number gutters inside a quote are ignored', run({ trace: trace([ev('src/calc.js', 1, 2, '1| export function add(a, b) {\n2|   return a + b;')]) }).status === 'verified');
  ok('verify · "..." in a quote skips text but keeps order', run({ trace: trace([ev('src/calc.js', 1, 3, 'export function add... return a + b;')]) }).status === 'verified'
    && run({ trace: trace([ev('src/calc.js', 1, 3, 'return a + b;... export function add')]) }).status === 'unverified');

  /* every failure mode */
  var miss = run({ trace: trace([ev('src/ghost.js', 1, 2, '')]) });
  ok('verify · a file that is not loaded fails (missing-file)', miss.status === 'unverified' && reasons(miss) === 'missing-file');
  ok('verify · a range past the end of the file fails (bad-range) with the real length', /file has 6 lines/.test(run({ trace: trace([ev('src/calc.js', 4, 40, '')]) }).failures[0].detail));
  ok('verify · start past the end, start < 1 and end < start all fail (bad-range)', ['src/calc.js'].every(function () {
    return reasons(run({ trace: trace([ev('src/calc.js', 99, 99, '')]) })) === 'bad-range' && reasons(run({ trace: trace([ev('src/calc.js', 0, 2, '')]) })) === 'bad-range' && reasons(run({ trace: trace([ev('src/calc.js', 5, 2, '')]) })) === 'bad-range';
  }));
  var wrong = run({ trace: trace([ev('src/calc.js', 4, 6, 'return a + b;')]) });
  ok('verify · a quote outside the cited range fails and says where it really is', wrong.status === 'unverified' && reasons(wrong) === 'quote-mismatch' && /appears at 2/.test(wrong.failures[0].detail), wrong.failures[0] && wrong.failures[0].detail);
  var inv = run({ trace: trace([ev('src/calc.js', 1, 6, 'function subtract(a, b)')]) });
  ok('verify · an invented quote fails and says it is nowhere in the file', reasons(inv) === 'quote-mismatch' && /anywhere in the file/.test(inv.failures[0].detail));
  ok('verify · one failing citation makes the whole answer UNVERIFIED and the good ones still count', (function () {
    var r = run({ trace: trace([ev('src/calc.js', 1, 2, 'return a + b;'), ev('src/ghost.js', 1, 1, '')]) });
    return r.status === 'unverified' && r.checked === 2 && r.passed === 1 && r.failures.length === 1;
  })());
  ok('verify · a trivially short quote is not treated as a failure', run({ trace: trace([ev('src/calc.js', 1, 1, 'ab')]) }).status === 'verified');

  /* prose citations: no JSON trace needed */
  ok('prose · file:line and file:a-b / a–b citations are checked with no trace at all', run({ answer: 'See `src/calc.js:2` and src/calc.js:1–3.' }).status === 'verified'
    && run({ answer: 'See src/calc.js:1-3' }).checked === 1);
  ok('prose · "file line N" and "file, lines a to b" forms', run({ answer: 'In src/calc.js line 2 and README.md, lines 1 to 3.' }).checked === 2);
  var pr = run({ answer: 'It is defined at src/calc.js:77 and used in src/ghost.js:3.' });
  ok('prose · bad prose citations are UNVERIFIED with each failure listed', pr.status === 'unverified' && pr.failures.length === 2 && pr.failures.every(function (f) { return f.source === 'prose'; }), reasons(pr));
  ok('prose · host:port and version-like strings are not citations', run({ answer: 'Listens on example.com:443 and localhost:8080, v1.2:3' }).status === 'uncited');
  ok('prose · an ambiguous suffix does not guess a file', reasons(run({ answer: 'See util/a.js:1' })) === 'missing-file');
  ok('prose · a unique suffix does resolve', run({ answer: 'See calc.js:2' }).status === 'verified');
  ok('prose · the same citation in trace and prose is counted once per source, deduped within a source', run({ answer: 'src/calc.js:2 and again src/calc.js:2' }).checked === 1);
  ok('verify · an answer with nothing to check is UNCITED, never VERIFIED', run({ answer: 'It adds two numbers.' }).status === 'uncited' && run({ trace: { steps: [] }, answer: '' }).status === 'uncited');
  ok('verify · evidence without a file (an uncertain/inference step) is ignored', run({ trace: trace([{ kind: 'uncertain', note: 'no file' }]) }).status === 'uncited');

  /* from raw model output, end to end */
  var raw = 'The sum happens in `src/calc.js:2`.\n\n```meridian-trace\n{"steps":[{"action":"read","evidence":[{"file":"src/calc.js","startLine":2,"endLine":2,"quote":"return a - b;"}]}]}\n```';
  var parsed = extractTrace(raw);
  var rr = run({ trace: parsed.trace, answer: parsed.answer });
  ok('end-to-end · raw model output with a fabricated quote is caught', rr.status === 'unverified' && reasons(rr) === 'quote-mismatch');
  var rr2 = run({ trace: extractTrace('plain answer, ignoring the format: src/calc.js:99').trace, answer: 'plain answer, ignoring the format: src/calc.js:99' });
  ok('end-to-end · an answer that ignored the trace format is still checked', rr2.status === 'unverified');

  /* helpers */
  ok('norm · strips gutters, quotes, dashes and whitespace', norm('  12 | a – b  “c”') === 'a-b"c"');
  ok('quoteIn · requires ordered fragments', quoteIn('bbb ... ddd', 'aaa bbb ccc ddd eee') && !quoteIn('ddd ... bbb', 'aaa bbb ccc ddd eee'));

  /* the UI strip */
  var m1 = fakeMsg(), retried = 0;
  renderIntegrity(m1, wrong, function () { retried++; });
  var chip1 = m1.querySelector('.chip');
  ok('ui · UNVERIFIED shows the failing list, flips the header chip and offers RE-GROUND', /UNVERIFIED/.test(m1.querySelector('.integrity-hd').textContent) && m1.querySelectorAll('.integrity li').length === 1 && chip1.textContent === 'UNVERIFIED' && !!m1.querySelector('.reground-row'));
  m1.querySelector('.reground-row button').click();
  ok('ui · RE-GROUND runs the supplied retry exactly once', retried === 1 && m1.querySelector('.reground-row button').disabled);
  var m2 = fakeMsg(); renderIntegrity(m2, good, function () {});
  ok('ui · VERIFIED shows a green strip with no failures and no retry button', /VERIFIED/.test(m2.querySelector('.integrity-hd').textContent) && !m2.querySelector('.integrity li') && !m2.querySelector('.reground-row') && m2.querySelector('.chip').textContent === 'TRACED');
  var m3 = fakeMsg(); renderIntegrity(m3, run({ answer: 'nothing cited' }), null);
  ok('ui · UNCITED says so plainly', /UNCITED/.test(m3.querySelector('.integrity-hd').textContent) && /unsupported/.test(m3.querySelector('.integrity-hd').textContent));
  var m4 = fakeMsg(); renderIntegrity(m4, pr, null);
  ok('ui · no retry closure (trace-less answer) means no duplicate re-ground button', !m4.querySelector('.reground-row') && m4.querySelectorAll('.integrity li').length === 2);
  var xs = fakeMsg(); renderIntegrity(xs, run({ answer: '<img src=x onerror=alert(1)>.js:1 src/ghost<b>.js:1' }), null);
  ok('ui · citation text is rendered as text, never markup', !xs.querySelector('img') && !xs.querySelector('b'));

  /* export carries the verdict */
  var md = exchangeMarkdown({ q: 'q', answer: 'a', trace: null, model: 'M', provider: 'P', ts: 0, integrity: wrong }, 0);
  ok('export · Markdown records the evidence check and each failure', /Evidence check:\*\* UNVERIFIED/.test(md) && /src\/calc\.js:4-6/.test(md));
}
export { verifyCases };
