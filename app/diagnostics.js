import { st } from './state.js';
import { LS, PROVIDERS } from './config.js';
import { APP_VERSION } from './version.js';
import { detectLang } from './index-core.js';
import { indexRunInfo, indexingState } from './index-run.js';
import { lsGet, rememberFocus, returnFocus, trap, copyText } from './helpers.js';
/* ============ DIAGNOSTICS (REDACTED, NO SOURCE, NO PATHS) ============
   A report a user can paste into a support ticket: version, counts, language mix,
   index stats, the last error, browser capabilities and settings flags.

   By construction it contains NO file names, paths, file contents, project or repo
   names, search text, keys, endpoint URLs or share data: every field is a number,
   a boolean, an enum chosen here, or a language id. The last error message is
   scrubbed of paths, URLs and token-shaped strings. The report is shown before it
   is copied; nothing is sent anywhere.                                          */

var lastError = null;
/* scrub a free-text error: drop paths, URLs, token-shaped runs and quoted names, cap length */
function redact(msg) {
  return String(msg == null ? '' : msg)
    .replace(/https?:\/\/[^\s'")]+/gi, '<url>')
    .replace(/(?:[A-Za-z]:)?[\\/][^\s'"`:)]*[\\/][^\s'"`:)]*/g, '<path>')
    .replace(/\b[\w.-]+\.(?:js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|rb|php|cs|kt|swift|json|md|html|css|c|h|cpp)\b/gi, '<file>')
    .replace(/[A-Za-z0-9_+=-]{24,}/g, '<token>')
    .replace(/(["'`])(?:(?!\1).){1,80}\1/g, '<text>')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
}
function record(kind, message) { lastError = { kind: kind, message: redact(message), at: new Date().toISOString().slice(0, 16) + 'Z' }; }
function initDiagnostics() {
  window.addEventListener('error', function (e) { record('error', e && e.message); });
  window.addEventListener('unhandledrejection', function (e) { record('rejection', e && e.reason && e.reason.message || e && e.reason); });
}

function langCounts() {
  var out = Object.create(null);
  st.files.forEach(function (f, p) { var l = f.lang || detectLang(p, ''); out[l] = (out[l] || 0) + 1; });
  return out;
}
function buildDiagnostics() {
  var idx = st.projectIndex, run = indexRunInfo(), skipped = st.skipped || {};
  var canFs = typeof window.showDirectoryPicker === 'function';
  var rep = {
    report: 'meridian-diagnostics', v: 1, generated: new Date().toISOString(),
    app: { version: APP_VERSION, page: location.pathname.replace(/^.*\//, '') === 'app.html' ? 'app.html' : 'other', secureContext: !!window.isSecureContext },
    browser: {
      userAgent: navigator.userAgent, language: navigator.language, cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null,
      features: {
        worker: typeof Worker !== 'undefined', moduleWorker: typeof Worker !== 'undefined', compressionStream: typeof CompressionStream === 'function',
        webCrypto: !!(window.crypto && crypto.subtle), indexedDB: !!window.indexedDB, fileSystemAccess: canFs, clipboard: !!(navigator.clipboard && navigator.clipboard.writeText)
      }
    },
    project: {
      files: st.files.size, languages: langCounts(), repos: st.repos.length, sharedSnapshot: !!st.shared,
      skipped: { dirs: skipped.dirs | 0, binary: skipped.binary | 0, big: skipped.big | 0, over: skipped.over | 0, user: skipped.user | 0, readerr: skipped.readerr | 0, memcap: skipped.memcap | 0 },
      textBytes: st.totalBytes | 0
    },
    index: idx ? {
      state: idx.partial ? 'partial' : 'complete', files: idx.fileCount, scanned: idx.scanned, symbols: idx.symbolCount, imports: idx.importCount,
      lines: idx.lineCount || 0, overLongLines: idx.longLineCount || 0, generatedFiles: (idx.generated || []).length
    } : { state: st.indexDirty ? 'not built' : 'none' },
    indexing: { running: indexingState().running, workerCapable: run.workerCapable, runs: run.stats.runs, workerRuns: run.stats.workerRuns, cancelled: run.stats.cancelled, fallbacks: run.stats.fallbacks, lastMode: run.stats.lastMode, lastMs: run.stats.lastMs, lastError: run.lastError ? redact(run.lastError) : null },
    settings: {
      provider: PROVIDERS[st.curProvider] ? st.curProvider : 'none', contextMode: st.ctxMode, ground: !!st.groundMode, strictTrace: lsGet(LS.strictTrace) === '1',
      fileCap: parseInt(lsGet(LS.maxfiles) || '', 10) || 'default', usageLogOn: lsGet(LS.analytics) === '1', workerDisabled: !!st.noWorker
    },
    lastError: lastError
  };
  return rep;
}
function diagnosticsText() { return JSON.stringify(buildDiagnostics(), null, 2); }

/* shown first, then copied on request: the user sees exactly what would be shared */
function openDiagnostics() {
  var text = diagnosticsText();
  var veil = document.createElement('div'); veil.className = 'veil on'; veil.id = 'diagveil';
  var modal = document.createElement('div'); modal.className = 'modal modal-wide'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'diag-title');
  modal.innerHTML = '<div class="k mono">DIAGNOSTICS · REDACTED</div><h2 id="diag-title">What you would send, and nothing more.</h2>'
    + '<p class="prev-note">// no source, no file names or paths, no project names, no keys, no URLs. counts, language ids, browser capabilities, settings flags and the last error with paths and tokens scrubbed. nothing is sent: copy it into your ticket yourself.</p>'
    + '<pre class="diag-pre mono" tabindex="0"></pre>'
    + '<div class="row"><button class="btn btn-signal" type="button" id="diagcopy">Copy report</button><button class="btn btn-hairline" type="button" id="diagclose">Close</button></div>';
  modal.querySelector('.diag-pre').textContent = text;
  veil.appendChild(modal);
  document.getElementById('app').appendChild(veil);
  rememberFocus();
  var untrap = trap(modal);
  function close() { veil.remove(); if (untrap) untrap(); returnFocus(); }
  modal.querySelector('#diagclose').addEventListener('click', close);
  modal.querySelector('#diagcopy').addEventListener('click', function () { copyText(text, 'Diagnostics report copied.'); });
  veil.addEventListener('click', function (e) { if (e.target === veil) close(); });
  veil.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  modal.querySelector('#diagcopy').focus();
}

export { buildDiagnostics, diagnosticsText, initDiagnostics, openDiagnostics, record as recordError, redact };
