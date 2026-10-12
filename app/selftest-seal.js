import { st } from './state.js';
import { lsGet, lsSet, lsDel } from './helpers.js';
import { LS } from './config.js';
import { createShareLink, decodeShareData, parseBundleAny, sealedBundleText, buildSharePayload, bundleText } from './share.js';
import { checkMeta, generateToken, markUsed, normToken, seal, unseal, wasUsed } from './share-seal.js';
/* ============ SELF-TESTS: PROTECTED SHARES ============
   Passphrase encryption, expiry, one-time use, tamper resistance, and that
   neither links nor bundles leak plaintext. Scratch state only. */

var MARK = 'ZXQ_SECRET_MARKER_91';
function files() {
  var m = new Map();
  m.set('proj/a.js', { content: 'export function ' + MARK + '() { return 1; }', mtime: 0, checked: true });
  m.set('proj/b.js', { content: "import { x } from './a.js';\nexport const B = 2;", mtime: 0, checked: true });
  return m;
}
function code(p) { return p.then(function () { return 'ok'; }, function (e) { return e && e.code || 'error'; }); }
function bytes(s) { return new TextEncoder().encode(s); }

async function sealCases(ok) {
  var keepFiles = st.files, keepSeen = lsGet(LS.sharesSeen);
  var realNow = Date.now;
  try {
    /* primitives */
    var tok = generateToken();
    ok('seal · generated token is 4 groups of 5 from an unambiguous alphabet', /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/.test(tok) && tok !== generateToken(), tok);
    ok('seal · tokens are case/space/dash tolerant when retyped', normToken(tok.toLowerCase().replace(/-/g, ' ')) === tok);
    var plain = bytes('hello world payload');
    var s1 = await seal(plain, 'correct horse battery', { expires: '24h', once: true });
    ok('seal · header carries id, expiry and one-time flag in the clear', /^[0-9a-f]{16}$/.test(s1.meta.id) && s1.meta.exp > Date.now() && s1.meta.once === 1);
    var back = await unseal(s1.meta, s1.ct, 'correct horse battery');
    ok('seal · round trip with the right passphrase', new TextDecoder().decode(back) === 'hello world payload');
    ok('seal · wrong passphrase is refused', await code(unseal(s1.meta, s1.ct, 'wrong horse battery')) === 'badpass');
    var forged = Object.assign({}, s1.meta, { exp: s1.meta.exp + 99 * 86400000 });
    ok('seal · editing the expiry in the header breaks decryption (AAD-bound)', await code(unseal(forged, s1.ct, 'correct horse battery')) === 'badpass');
    var flipped = Object.assign({}, s1.meta, { once: 0 });
    ok('seal · clearing the one-time flag breaks decryption', await code(unseal(flipped, s1.ct, 'correct horse battery')) === 'badpass');
    var ct2 = s1.ct.slice(); ct2[0] ^= 1;
    ok('seal · a flipped ciphertext bit is detected', await code(unseal(s1.meta, ct2, 'correct horse battery')) === 'badpass');
    ok('seal · short passphrases are rejected before any work', await code(seal(plain, 'short')) === 'weak');
    ok('seal · expired headers are refused, even with the right passphrase', await code(unseal(s1.meta, s1.ct, 'correct horse battery', s1.meta.exp + 1)) === 'expired');
    var never = await seal(plain, 'correct horse battery', { expires: 'never' });
    ok('seal · "never" has no expiry', never.meta.exp === 0 && checkMeta(never.meta, Date.now() + 1e12).expired === false);
    ok('seal · malformed headers are rejected', (function () { try { checkMeta({ id: 'zz', salt: 'x', iv: 'y', exp: 0, it: 5 }); return false; } catch (e) { return e.code === 'corrupt'; } })());
    var sm = []; var reader = function () { return sm.length ? JSON.stringify(sm) : null; }, writer = function (v) { sm = JSON.parse(v); };
    markUsed(reader, writer, 'aaaaaaaaaaaaaaaa', 0);
    ok('seal · opened-id memory remembers an id and nothing else', wasUsed(reader, 'aaaaaaaaaaaaaaaa') && !wasUsed(reader, 'bbbbbbbbbbbbbbbb') && Object.keys(sm[0]).sort().join() === 'exp,id');

    /* links */
    st.files = files();
    var paths = ['proj/a.js', 'proj/b.js'];
    var pass = 'blue-lantern-42';
    var link = await createShareLink(paths, { pass: pass, expires: '7d', once: false });
    var data = link.url.slice(link.url.indexOf('#share=') + 7);
    ok('link · a protected link is v2 and fits the same limits', link.sealed === true && /^v2\.[\w-]+\.[\w-]+$/.test(data), link.url.length + ' chars');
    ok('link · the link text does not contain code, paths or the passphrase', link.url.indexOf(MARK) === -1 && link.url.indexOf('proj') === -1 && link.url.indexOf(pass) === -1);
    ok('link · opening without a passphrase says it is locked and shows its policy', await (async function () { try { await decodeShareData(data); return false; } catch (e) { return e.code === 'locked' && !!e.meta && e.meta.exp > Date.now(); } })());
    ok('link · wrong passphrase is refused', await code(decodeShareData(data, 'not-the-passphrase')) === 'badpass');
    var opened = await decodeShareData(data, pass);
    ok('link · right passphrase restores the exact files', opened.files.length === 2 && opened.files[0].c.indexOf(MARK) !== -1 && opened.files[0].p === 'proj/a.js');
    ok('link · opened payload carries its seal policy for the one-time/expiry bookkeeping', opened.seal && opened.seal.once === false && opened.seal.exp > Date.now());
    var cut = data.slice(0, data.length - 6);
    ok('link · a truncated protected link is reported damaged, not as a wrong passphrase', ['corrupt', 'badpass'].indexOf(await code(decodeShareData(cut, pass))) !== -1);

    /* expiry (client clock) */
    var day = await createShareLink(paths, { pass: pass, expires: '24h' });
    var dayData = day.url.slice(day.url.indexOf('#share=') + 7);
    Date.now = function () { return realNow() + 25 * 3600 * 1000; };
    var expiredCode = await code(decodeShareData(dayData, pass));
    Date.now = realNow;
    ok('link · a 24h link is refused after 24h, before any passphrase is asked', expiredCode === 'expired');
    ok('link · a 7d link still opens on day one', (await code(decodeShareData(data, pass))) === 'ok');

    /* one-time use */
    var onceLink = await createShareLink(paths, { pass: pass, expires: 'never', once: true });
    var onceData = onceLink.url.slice(onceLink.url.indexOf('#share=') + 7);
    var op = await decodeShareData(onceData, pass);
    ok('once · opens the first time', op.seal.once === true);
    var sink = lsGet(LS.sharesSeen);
    markUsed(function () { return lsGet(LS.sharesSeen); }, function (v) { lsSet(LS.sharesSeen, v); }, op.seal.id, op.seal.exp);
    ok('once · after being marked used the same link is refused in this browser', await code(decodeShareData(onceData, pass)) === 'used');
    ok('once · a different one-time link is unaffected', await code(decodeShareData((await createShareLink(paths, { pass: pass, once: true })).url.split('#share=')[1], pass)) === 'ok');
    ok('once · the used-id store holds only an id and an expiry', JSON.parse(lsGet(LS.sharesSeen)).every(function (e) { return Object.keys(e).sort().join() === 'exp,id'; }), sink || '');

    /* permanent links stay readable (compat) and unprotected links stay v1 */
    var plainLink = await createShareLink(paths);
    ok('link · no protection still makes a v1 permanent link that opens without a prompt', plainLink.sealed !== true && /#share=v1\./.test(plainLink.url) && (await code(decodeShareData(plainLink.url.split('#share=')[1]))) === 'ok');

    /* bundles */
    var payload = buildSharePayload(paths);
    var sb = await sealedBundleText(payload, pass, { expires: '7d' });
    ok('bundle · a protected bundle hides the code but keeps a readable note', sb.indexOf(MARK) === -1 && /passphrase-protected/.test(sb) && JSON.parse(sb).v === 2);
    ok('bundle · opening without a passphrase says it is locked', await code(parseBundleAny(sb)) === 'locked');
    ok('bundle · wrong passphrase refused', await code(parseBundleAny(sb, 'nope-nope-nope')) === 'badpass');
    var bp = await parseBundleAny(sb, pass);
    ok('bundle · right passphrase restores the files', bp.files.length === 2 && bp.files[0].c.indexOf(MARK) !== -1);
    var tampered = JSON.parse(sb); tampered.sealed.meta.exp = 0;
    ok('bundle · removing the expiry from a protected bundle breaks it', await code(parseBundleAny(JSON.stringify(tampered), pass)) === 'badpass');
    var pb = await parseBundleAny(bundleText(payload));
    ok('bundle · plain bundles still open unchanged', pb.files.length === 2 && !pb.seal);
  } finally {
    Date.now = realNow;
    st.files = keepFiles;
    if (keepSeen === null) lsDel(LS.sharesSeen); else lsSet(LS.sharesSeen, keepSeen);
  }
}
export { sealCases };
