import { st } from './state.js';
import { DEFAULT_MAX_FILES, __setCapsForTest, collectEntry, collectFromFileList, runIngestPool } from './ingest.js';
import { walkHandle } from './memory.js';
/* ============ SELF-TESTS: LOAD-PATH PARITY ============
   The same folder, loaded through the drag-and-drop entry walk, the File System
   Access handle walk and the webkitdirectory picker, must load the same files and
   report the same skip counts. A tree with every skip class feeds all three. */

var TREE = {
  'src/a.js': 'export const a = 1;', 'src/b.ts': 'export const b = 2;', 'README.md': '# t',
  'node_modules/x/i.js': 'x', 'node_modules/x/j.js': 'y', 'node_modules/y/k.js': 'z',
  '.git/config': 'c', '.git/HEAD': 'h', '.cache/z.js': 'z', 'src/.hidden/q.js': 'q',
  '.env': 'KEY=1', '.github/w.yml': 'on: push', 'img.png': 'PNGDATA', 'src/deep/ok.py': 'print(1)'
};
function mkFile(rel, text) {
  var f = new File([text], rel.slice(rel.lastIndexOf('/') + 1));
  Object.defineProperty(f, 'webkitRelativePath', { value: 'proj/' + rel });
  return f;
}
/* nested object tree from the flat TREE */
function nest() {
  var root = {};
  Object.keys(TREE).forEach(function (p) {
    var parts = p.split('/'), cur = root;
    parts.forEach(function (seg, i) { if (i === parts.length - 1) cur[seg] = mkFile(p, TREE[p]); else cur = cur[seg] = cur[seg] || {}; });
  });
  return root;
}
function entryFor(name, node) {
  if (node instanceof File) return { isFile: true, isDirectory: false, name: name, file: function (ok) { ok(node); } };
  var kids = Object.keys(node).map(function (k) { return entryFor(k, node[k]); });
  return { isFile: false, isDirectory: true, name: name, createReader: function () { var done = false; return { readEntries: function (cb) { if (done) cb([]); else { done = true; cb(kids); } } }; } };
}
function handleFor(name, node) {
  if (node instanceof File) return { kind: 'file', name: name, getFile: function () { return Promise.resolve(node); } };
  return { kind: 'directory', name: name, values: function () {
    var ks = Object.keys(node).map(function (k) { return handleFor(k, node[k]); }), i = 0;
    return { [Symbol.asyncIterator]: function () { return this; }, next: function () { return Promise.resolve(i < ks.length ? { value: ks[i++], done: false } : { value: undefined, done: true }); } };
  } };
}
function fresh() {
  st.files = new Map(); st.totalBytes = 0; st.skippedFiles = [];
  st.skipped = { dirs: 0, binary: 0, big: 0, over: 0, user: 0, readerr: 0, memcap: 0 };
}
function snapshot() { return { files: Array.from(st.files.keys()).sort().join(','), skipped: JSON.stringify(st.skipped) }; }

async function parityCases(ok) {
  var keep = { files: st.files, bytes: st.totalBytes, list: st.skippedFiles, skipped: st.skipped, idx: st.projectIndex, dirty: st.indexDirty };
  var keepCaps = __setCapsForTest({ maxFiles: DEFAULT_MAX_FILES, maxTotal: 300 * 1024 * 1024 }); /* earlier cap cases may have lowered them */
  try {
    var tree = nest(), results = {};

    fresh();
    var dropItems = [];
    await collectEntry(entryFor('proj', tree), '', dropItems);
    await runIngestPool(dropItems);
    results.drop = snapshot();

    fresh();
    var fsaItems = [];
    var h = handleFor('proj', tree);
    await walkHandle(h, 'proj/');
    results.fsa = snapshot();

    fresh();
    var flat = Object.keys(TREE).map(function (p) { return mkFile(p, TREE[p]); });
    await runIngestPool(collectFromFileList(flat, 'proj'));
    results.picker = snapshot();

    ok('parity · drag-drop, File System Access and folder picker load the same files', results.drop.files === results.fsa.files && results.fsa.files === results.picker.files, results.drop.files);
    ok('parity · all three report identical skip counts', results.drop.skipped === results.fsa.skipped && results.fsa.skipped === results.picker.skipped, results.drop.skipped + ' | ' + results.fsa.skipped + ' | ' + results.picker.skipped);
    var want = 'proj/.github/w.yml,proj/README.md,proj/src/a.js,proj/src/b.ts,proj/src/deep/ok.py';
    ok('parity · the loaded set is exactly the source files (ignored dirs, dot dirs, dot files and binaries are out)', results.drop.files === want, results.drop.files);
    var sk = JSON.parse(results.drop.skipped);
    ok('parity · each ignored directory counts once, plus the dot-file and the binary', sk.dirs === 5 && sk.binary === 1 /* 4 ignored directories (node_modules, .git, .cache, src/.hidden) + the .env dot-file */, results.drop.skipped);
  } finally {
    __setCapsForTest(keepCaps);
    st.files = keep.files; st.totalBytes = keep.bytes; st.skippedFiles = keep.list; st.skipped = keep.skipped; st.projectIndex = keep.idx; st.indexDirty = keep.dirty;
  }
}
export { parityCases };
