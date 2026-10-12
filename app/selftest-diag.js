import { st } from './state.js';
import { lsGet, lsSet, lsDel } from './helpers.js';
import { LS } from './config.js';
import { buildDiagnostics, diagnosticsText, openDiagnostics, recordError, redact } from './diagnostics.js';
/* ============ SELF-TESTS: DIAGNOSTICS REPORT ============
   The report must be useful for support and contain zero source, paths, names,
   keys or URLs. Planted markers prove it. */

function diagCases(ok) {
  var keepFiles = st.files, keepKey = lsGet(LS.key), keepUrl = lsGet(LS.curl), keepShared = st.shared;
  try {
    st.files = new Map();
    st.files.set('Acme-Internal/src/UltraSecretName.js', { content: 'const SECRETMARKER_QQ = 1;', lines: 1, tokens: 8, mtime: 0, base: 1, checked: true, lang: 'js' });
    st.files.set('Acme-Internal/tools/build.py', { content: 'print("hi")', lines: 1, tokens: 5, mtime: 0, base: 1, checked: true, lang: 'python' });
    lsSet(LS.key, 'sk-ant-SUPERSECRETKEYVALUE123456');
    lsSet(LS.curl, 'http://localhost:1234/v1-INTERNALHOST');
    recordError('error', 'Failed reading C:\\Users\\bob\\Acme-Internal\\src\\UltraSecretName.js via https://internal.acme.example/api?token=abcdefghijklmnopqrstuvwxyz0123456789 near "private thing"');
    var text = diagnosticsText(), rep = buildDiagnostics();
    ['UltraSecretName', 'SECRETMARKER_QQ', 'Acme-Internal', 'bob', 'internal.acme', 'abcdefghijklmnop', 'private thing', 'SUPERSECRET', 'INTERNALHOST', 'build.py', 'tools/'].forEach(function (needle) {
      ok('diagnostics · report never contains "' + needle + '"', text.indexOf(needle) === -1);
    });
    ok('diagnostics · counts and language mix are present', rep.project.files === 2 && rep.project.languages.js === 1 && rep.project.languages.python === 1);
    ok('diagnostics · version, browser capabilities and settings flags are present', /^\d+\.\d+/.test(rep.app.version) && typeof rep.browser.features.worker === 'boolean' && typeof rep.browser.features.fileSystemAccess === 'boolean' && typeof rep.settings.ground === 'boolean' && ['anthropic', 'openai', 'custom', 'local', 'none'].indexOf(rep.settings.provider) !== -1);
    ok('diagnostics · skip counters use the same fields as the skip review', ['dirs', 'binary', 'big', 'over', 'user', 'readerr', 'memcap'].every(function (k) { return typeof rep.project.skipped[k] === 'number'; }));
    ok('diagnostics · the last error is kept but scrubbed', rep.lastError && rep.lastError.kind === 'error' && /<path>|<file>/.test(rep.lastError.message) && /<url>/.test(rep.lastError.message), rep.lastError && rep.lastError.message);
    ok('diagnostics · indexing section reports worker capability and fallbacks', typeof rep.indexing.workerCapable === 'boolean' && typeof rep.indexing.fallbacks === 'number');
    ok('redact · paths, urls, file names, token-shaped runs and quoted text are all scrubbed', (function () {
      var r = redact('boom in main.js at /home/u/x/y.ts https://a.b/c "name" ' + new Array(30).join('Z'));
      return !/main\.js|\/home|a\.b|name|ZZZZZ/.test(r);
    })());
    ok('redact · output is length-capped', redact(new Array(500).join('word ')).length <= 160);
    st.shared = { name: 'Client Secret Project', count: 1 };
    ok('diagnostics · a shared snapshot is a boolean, never its name', buildDiagnostics().project.sharedSnapshot === true && diagnosticsText().indexOf('Client Secret') === -1);

    openDiagnostics();
    var veil = document.getElementById('diagveil');
    ok('diagnostics · the report is shown for review before it can be copied', !!veil && veil.querySelector('.diag-pre').textContent.indexOf('"report": "meridian-diagnostics"') !== -1 && /nothing is sent/.test(veil.textContent));
    if (veil) veil.querySelector('#diagclose').click();
    ok('diagnostics · the review dialog closes', !document.getElementById('diagveil'));
  } finally {
    st.files = keepFiles; st.shared = keepShared;
    if (keepKey === null) lsDel(LS.key); else lsSet(LS.key, keepKey);
    if (keepUrl === null) lsDel(LS.curl); else lsSet(LS.curl, keepUrl);
    var v = document.getElementById('diagveil'); if (v) v.remove();
  }
}
export { diagCases };
