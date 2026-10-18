import { st } from './state.js';
import { SAMPLE_PROJECT } from './demo.js';
import { app, lsDel, lsGet, lsSet } from './helpers.js';
import { LS } from './config.js';
import { BUNDLE_NOTE, FILE_FIELDS, PAYLOAD_FIELDS, SHARE_LINK_MAX_CHARS, buildSharePayload, bundleText, createShareLink, decodeShareData, defaultSharePaths, encodeShareData, isSecretish, measureLink, parseBundleText, payloadEntries, readBundleFile } from './share.js';
import { stEntry } from './selftest-fixture.js';
/* share links + bundles — real CompressionStream round-trips over the scratch
   fixture. A sentinel key is planted in the conversation and, only when that
   slot is EMPTY, in the Anthropic key slot (removed again before any await);
   neither may reach a payload. */
function settleCode(p) { return p.then(function () { return 'loaded'; }, function (e) { return (e && e.code) || 'raw:' + (e && e.message); }); }
function shareCases(ok) {
  var SENT = 'sk-ant-SELFTEST-SENTINEL-0000';
  var small = Object.keys(SAMPLE_PROJECT);
  st.files.set('src/unicode.txt', stEntry('src/unicode.txt', 'naïve café — 日本語 ✓\r\nline two'));
  st.files.set('config/.env', stEntry('config/.env', 'API_KEY=hunter2'));
  small.push('src/unicode.txt');
  var planted = !lsGet(LS.key);
  if (planted) lsSet(LS.key, SENT);
  st.history.push({ role: 'user', content: 'my key is ' + SENT });
  var pl, json, btxt;
  try {
    pl = buildSharePayload(small, { name: 'selftest', now: 1 });
    json = JSON.stringify(pl); btxt = bundleText(pl);
  } finally {
    st.history.pop();
    if (planted) lsDel(LS.key);
  }
  ok('share · payload carries only whitelisted fields', Object.keys(pl).every(function (k) { return PAYLOAD_FIELDS.indexOf(k) !== -1; })
    && pl.files.every(function (f) { return Object.keys(f).every(function (k) { return FILE_FIELDS.indexOf(k) !== -1; }); }));
  var keyNames = Object.keys(pl).concat(Object.keys(JSON.parse(btxt)));
  pl.files.forEach(function (f) { keyNames = keyNames.concat(Object.keys(f)); });
  var stored = [LS.key, LS.okey, LS.ckey, LS.curl].map(lsGet).filter(function (v) { return v && v.length >= 6; });
  ok('share · no secrets: no key/provider/history fields, no stored key values',
    !keyNames.some(function (k) { return /key|token|secret|provider|model|history|transcript|setting/i.test(k); })
    && json.indexOf(SENT) === -1 && btxt.indexOf(SENT) === -1
    && stored.every(function (v) { return json.indexOf(v) === -1 && btxt.indexOf(v) === -1; }), keyNames.length + ' field names checked');
  ok('share · secret-looking paths are flagged', ['.env', 'config/.env.local', 'certs/server.pem', 'home/.ssh/id_rsa', 'app/credentials.json'].every(isSecretish)
    && !['src/env.js', 'src/keyboard.js', 'README.md', '.env.example.md/x.js'].some(isSecretish));
  /* deterministic high-entropy text: no compressor fits 60K of it under the limit */
  var seed = 12345, noise = '';
  for (var i = 0; i < 60000; i++) { seed = (Math.imul(seed, 1103515245) + 12345) | 0; noise += String.fromCharCode(33 + ((seed >>> 16) % 90)); }
  st.files.set('share/noise.txt', stEntry('share/noise.txt', noise));
  var d1;
  return encodeShareData(pl).then(function (d) {
    d1 = d;
    ok('share · link data is versioned base64url', /^v1\.[A-Za-z0-9_-]+$/.test(d), d.slice(0, 12));
    return decodeShareData(d);
  }).then(function (back) {
    ok('share · round-trip keeps every path and byte', back.name === 'selftest' && back.created === 1 && back.files.length === pl.files.length
      && back.files.every(function (f, n) { return f.p === pl.files[n].p && f.c === pl.files[n].c; }), back.files.length + ' files');
    ok('share · unicode + CRLF survive the round-trip', back.files.some(function (f) { return f.p === 'src/unicode.txt' && f.c === st.files.get('src/unicode.txt').content; }));
    var ents = payloadEntries(back);
    ok('share · decoded files rebuild as checked entries', ents.length === back.files.length
      && ents.every(function (kv) { return kv[1].checked === true && kv[1].lines >= 1 && typeof kv[1].tokens === 'number'; }));
    return Promise.all([measureLink(small), measureLink(['share/noise.txt']), settleCode(createShareLink(['share/noise.txt']))]);
  }).then(function (r) {
    ok('share · small project fits in a link under the limit', r[0].fits && r[0].url.length <= SHARE_LINK_MAX_CHARS && r[0].url.indexOf('#share=v1.') !== -1, r[0].chars + ' / ' + SHARE_LINK_MAX_CHARS);
    ok('share · oversize selection measured over the limit, no url', !r[1].fits && r[1].url === null && r[1].chars > SHARE_LINK_MAX_CHARS, r[1].chars + ' chars');
    ok('share · createShareLink refuses over the limit', r[2] === 'toolong', r[2]);
    return defaultSharePaths();
  }).then(function (def) {
    ok('share · default selection skips secret-looking + oversize files', def.length > 0 && def.indexOf('config/.env') === -1 && def.indexOf('share/noise.txt') === -1, def.length + ' files');
    return measureLink(def).then(function (m) { ok('share · default selection actually fits', m.fits, m.chars + ' chars'); });
  }).then(function () {
    var trunc = d1.slice(0, Math.floor(d1.length / 2));
    return Promise.all([
      decodeShareData(trunc).catch(function (e) { return e; }),
      settleCode(decodeShareData(trunc)),
      settleCode(decodeShareData('v1.@@not*base64')),
      settleCode(decodeShareData('v1.QUJDREVGR0hJSktMTU5PUA')),
      settleCode(decodeShareData('v9.' + d1.slice(3))),
      settleCode(decodeShareData('')),
      settleCode(decodeShareData('garbage'))
    ]);
  }).then(function (c) {
    ok('share · truncated link → friendly error', c[1] === 'corrupt' && /damaged or incomplete/.test((c[0] && c[0].friendly) || ''), c[1]);
    ok('share · invalid characters → corrupt', c[2] === 'corrupt', c[2]);
    ok('share · non-deflate bytes → corrupt', c[3] === 'corrupt', c[3]);
    ok('share · newer format version → version error', c[4] === 'version', c[4]);
    ok('share · empty / unprefixed input → corrupt', c[5] === 'corrupt' && c[6] === 'corrupt', c[5] + ' · ' + c[6]);
    function crafted(o) { return settleCode(encodeShareData(o).then(decodeShareData)); }
    return Promise.all([
      crafted({ format: 'not-meridian', v: 1, files: [{ p: 'a.js', c: 'x' }] }),
      crafted({ format: 'meridian-share', v: 1, name: 'x', files: [{ p: 'a.js', c: 42 }] }),
      crafted({ format: 'meridian-share', v: 1, name: 'x', files: [{ p: '../etc/passwd', c: 'x' }] }),
      crafted({ format: 'meridian-share', v: 1, name: 'x', files: [{ p: 'big.txt', c: new Array(600 * 1024).join('a') }] }),
      encodeShareData({ format: 'meridian-share', v: 1, name: 'x', apiKey: SENT, files: [{ p: 'a.js', c: 'x', key: SENT }] }).then(decodeShareData)
    ]);
  }).then(function (c) {
    ok('share · wrong format / non-string content / ../ path refused', c[0] === 'invalid' && c[1] === 'invalid' && c[2] === 'invalid', c.slice(0, 3).join(' · '));
    ok('share · oversized file in a link refused (decompression cap)', c[3] === 'toobig', c[3]);
    ok('share · decoder drops unknown fields', !('apiKey' in c[4]) && !('key' in c[4].files[0]) && JSON.stringify(c[4]).indexOf(SENT) === -1);
    ok('share · bundle note says the code is readable', JSON.parse(btxt).note === BUNDLE_NOTE && /anyone who has it can read it/.test(BUNDLE_NOTE));
    return readBundleFile(new File([btxt], 'selftest.meridian'));
  }).then(function (back) {
    ok('share · bundle round-trip through a File', back.name === 'selftest' && back.files.length === pl.files.length
      && back.files.every(function (f, n) { return f.p === pl.files[n].p && f.c === pl.files[n].c; }));
    function bcode(t) { try { parseBundleText(t); return 'loaded'; } catch (e) { return e.code; } }
    ok('share · bad bundles → friendly errors', bcode('{not json') === 'bundle' && bcode('{"format":"x"}') === 'bundle'
      && bcode(JSON.stringify({ format: 'meridian-share', v: 99, files: [{ p: 'a', c: 'b' }] })) === 'version');
  });
}
export { shareCases };
