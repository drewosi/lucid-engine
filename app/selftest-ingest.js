import { st } from './state.js';
import { DEFAULT_MAX_FILES, __setCapsForTest, capInfo, ingestFile, loadMaxFiles, parseMaxFiles, runIngestPool } from './ingest.js';
import { lsDel, lsGet, lsSet } from './helpers.js';
import { LS } from './config.js';
/* async ingest cases — drive the REAL ingestFile with synthetic files against
   the swapped-in scratch state. Sequential so counter assertions are ordered. */
function ingestCases(ok) {
  var big = new Array(600 * 1024).join('a'); /* ~600KB > the 512KB per-file cap */
  var binBytes = new Uint8Array([0x00, 0x01, 0x02, 0x00, 0x41]); /* null bytes → binary sniff */
  return ingestFile(new File(['x'], 'pic.png'), 'assets/pic.png').then(function () {
    ok('ingest · binary-ext skipped + recorded', !st.files.has('assets/pic.png') && st.skipped.binary === 1
      && st.skippedFiles.some(function (s) { return s.path === 'assets/pic.png' && s.reason === 'binary-ext'; }));
    return ingestFile(new File([big], 'big.txt'), 'big.txt');
  }).then(function () {
    ok('ingest · oversized skipped + recorded', !st.files.has('big.txt') && st.skipped.big === 1
      && st.skippedFiles.some(function (s) { return s.path === 'big.txt' && s.reason === 'oversized'; }));
    return ingestFile(new File([binBytes], 'weird.txt'), 'weird.txt');
  }).then(function () {
    ok('ingest · binary content sniffed', !st.files.has('weird.txt') && st.skipped.binary === 2);
    return ingestFile(new File(['\uFEFFhello BOM'], 'hello.txt'), 'src/hello.txt');
  }).then(function () {
    var f = st.files.get('src/hello.txt');
    ok('ingest · UTF-8 decoded, BOM stripped', !!f && f.content === 'hello BOM');
    return ingestFile(new File(['tiny'], 'pic2.png'), 'pic2.png', true); /* include-back force */
  }).then(function () {
    ok('ingest · force bypasses filters', st.files.has('pic2.png'));
    /* a File-like whose read rejects — must surface as read-error, not binary */
    var ghost = { name: 'ghost.txt', size: 5, arrayBuffer: function () { return Promise.reject(new Error('permission denied')); } };
    return ingestFile(ghost, 'ghost.txt');
  }).then(function () {
    ok('ingest · read failure → read-error skip', !st.files.has('ghost.txt') && st.skipped.readerr === 1
      && st.skippedFiles.some(function (s) { return s.path === 'ghost.txt' && s.reason === 'read-error'; }));
    ok('ingest · totalBytes tracks loaded text', st.totalBytes === 'hello BOM'.length + 'tiny'.length, String(st.totalBytes));
    /* bounded ingest pool (audit F1) — the caps must fire WITHIN one batch, the
       exact case the prior Promise.all fan-out could never enforce. Caps are
       lowered via the dev hook and restored by the harness's restore(). */
    var capFiles = st.files.size + 2;
    __setCapsForTest({ maxFiles: capFiles });
    var overBase = st.skipped.over;
    var items = [];
    for (var i = 0; i < 6; i++) (function (n) {
      items.push({ path: 'pool/f' + n + '.txt', getFile: function () { return Promise.resolve(new File(['pool' + n], 'f' + n + '.txt')); } });
    })(i);
    return runIngestPool(items, 2).then(function () {
      ok('ingest · pool enforces the file cap mid-batch', st.files.size === capFiles, st.files.size + ' vs cap ' + capFiles);
      ok('ingest · over-cap counted + reviewable', st.skipped.over - overBase === 4
        && st.skippedFiles.some(function (s) { return s.reason === 'over-cap'; }), 'over Δ=' + (st.skipped.over - overBase));
      __setCapsForTest({ maxFiles: DEFAULT_MAX_FILES, maxTotal: st.totalBytes + 3 });
      var memBase = st.skipped.memcap;
      return runIngestPool([
        { path: 'pool/m0.txt', getFile: function () { return Promise.resolve(new File(['abcdefgh'], 'm0.txt')); } },
        { path: 'pool/m1.txt', getFile: function () { return Promise.resolve(new File(['abcdefgh'], 'm1.txt')); } }
      ], 1).then(function () {
        ok('ingest · memory cap fires mid-batch + reviewable', st.skipped.memcap - memBase === 1
          && st.files.has('pool/m0.txt') && !st.files.has('pool/m1.txt')
          && st.skippedFiles.some(function (s) { return s.reason === 'mem-cap'; }), 'memcap Δ=' + (st.skipped.memcap - memBase));
      });
    });
  });
}
/* FILE CAP setting — the saved LS.maxfiles value drives the real ingest guard.
   Runs on its own scratch files map pre-filled to one below the cap, so a
   20,000-file cap is exercised without reading 20,000 Blobs. The saved setting
   is put back in finally; restore() puts the live caps back. */
function fileCapCases(ok) {
  var savedLS = lsGet(LS.maxfiles), keepFiles = st.files, keepBytes = st.totalBytes;
  var keepCaps = __setCapsForTest({ maxTotal: 300 * 1024 * 1024 }); /* undo the memory-cap case's tiny ceiling */
  function capRun(cap) {
    lsSet(LS.maxfiles, String(cap));
    loadMaxFiles();
    st.files = new Map(); st.totalBytes = 0;
    for (var i = 0; i < cap - 1; i++) st.files.set('capfill/' + i, { content: '', checked: true });
    var overBase = st.skipped.over, items = [];
    for (var k = 0; k < 3; k++) (function (n) {
      items.push({ path: 'capnew/f' + n + '.txt', getFile: function () { return Promise.resolve(new File(['cap' + n], 'f' + n + '.txt')); } });
    })(k);
    return runIngestPool(items, 1).then(function () {
      ok('file cap · custom ' + cap + ' honored by ingest', capInfo().maxFiles === cap && st.files.size === cap && st.skipped.over - overBase === 2,
        'size ' + st.files.size + ' · over Δ=' + (st.skipped.over - overBase));
    });
  }
  function done() {
    st.files = keepFiles; st.totalBytes = keepBytes;
    __setCapsForTest(keepCaps);
    if (savedLS === null) lsDel(LS.maxfiles); else lsSet(LS.maxfiles, savedLS);
  }
  try {
    lsDel(LS.maxfiles);
    ok('file cap · default is 8,000 when unset', DEFAULT_MAX_FILES === 8000 && loadMaxFiles() === 8000 && capInfo().maxFiles === 8000, String(capInfo().maxFiles));
    var bad = ['0', '-5', '-1', 'abc', '', '   ', '2.5', '1e4', '12abc', 'NaN', '99999999999999999999'];
    var leaked = bad.filter(function (v) { lsSet(LS.maxfiles, v); return loadMaxFiles() !== 8000; });
    ok('file cap · invalid saved values (0, negative, non-numeric, empty) fall back to 8,000', !leaked.length, leaked.join(' | '));
    ok('file cap · parse rejects junk + null, accepts whole numbers', parseMaxFiles(null) === 8000 && parseMaxFiles(undefined) === 8000 && parseMaxFiles(0) === 8000
      && parseMaxFiles(-3) === 8000 && parseMaxFiles(' 2000 ') === 2000 && parseMaxFiles(20000) === 20000);
  } catch (e) { done(); return Promise.reject(e); }
  return capRun(2000).then(function () { return capRun(20000); }).then(done, function (e) { done(); throw e; });
}
export { ingestCases, fileCapCases };
