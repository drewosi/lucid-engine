/* ============ INDEXING WORKER ============
   Runs the same pure scan as the main thread (index-core.js) off the UI thread.
   Protocol, in:  {type:'build', job, files:[[path, content], ...], opts}
            out:  {type:'progress', job, done, total}
                  {type:'snapshot', job, index}   partial index at doubling checkpoints
                  {type:'done',     job, index}
                  {type:'error',    job, message}
   Cancel is terminate() from the main thread: the scan is a tight synchronous
   loop, so a cancel message would never be read until it finished. */
import { buildIndexCore } from './index-core.js';

self.onmessage = function (e) {
  var m = e.data;
  if (!m || m.type !== 'build') return;
  try {
    var files = new Map();
    for (var i = 0; i < m.files.length; i++) files.set(m.files[i][0], { content: m.files[i][1] });
    var last = 0, opts = Object.assign({}, m.opts || {});
    opts.onProgress = function (done, total) {
      var now = Date.now();
      if (done === total || now - last > 100) { last = now; self.postMessage({ type: 'progress', job: m.job, done: done, total: total }); }
    };
    opts.onSnapshot = function (index) { self.postMessage({ type: 'snapshot', job: m.job, index: index }); };
    var index = buildIndexCore(files, opts);
    self.postMessage({ type: 'done', job: m.job, index: index });
  } catch (err) {
    self.postMessage({ type: 'error', job: m.job, message: String(err && err.message || err) });
  }
};
