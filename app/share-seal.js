/* ============ SHARE SEAL (PASSPHRASE + EXPIRY, NO SERVER) ============
   Optional protection for share links and bundles. The payload bytes are
   encrypted with AES-GCM under a key derived from a passphrase (PBKDF2-SHA256),
   and the policy (id, expiry, one-time) rides in clear but is bound to the
   ciphertext as additional authenticated data: editing the expiry in a link makes
   decryption fail, it does not extend the link.

   What this is NOT: revocation. There is no server, so nothing can reach out and
   kill a link that has already been copied. Expiry and one-time use are enforced
   by the opening Meridian client, on that browser's clock and that browser's
   storage. Someone with the link, the passphrase and a modified client can
   bypass them. They stop casual re-use and old links resurfacing in chat history;
   they do not stop a determined recipient. The passphrase is the real control.
   For real revocation, share through something you operate.

   Pure functions over bytes + a tiny WebCrypto surface; no DOM, no app state.  */

var SEAL_ITER = 200000;
var PASS_MIN = 8;
var EXPIRIES = { '24h': 24 * 3600 * 1000, '7d': 7 * 24 * 3600 * 1000, never: 0 };
/* unambiguous alphabet (no 0/O/1/I/l) for generated tokens */
var TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function sealError(code, msg) { var e = new Error(msg); e.code = code; e.friendly = msg; return e; }
var SEAL_ERRORS = {
  unsupported: 'This browser cannot encrypt or decrypt protected shares (WebCrypto needs a secure https page). Try a current Chrome, Edge, Firefox or Safari.',
  weak: 'Use a passphrase of at least ' + PASS_MIN + ' characters, or generate a token.',
  badpass: 'That passphrase does not open this share, or the link was changed after it was made.',
  expired: 'This share link has expired. Ask the sender for a new one.',
  corrupt: 'This protected share is damaged or incomplete. Ask the sender to send it again.'
};

function hasCrypto() { return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.getRandomValues === 'function'; }
function randomBytes(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
function hex(b) { var s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
function unb64(str) { var bin = atob(str), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

/* a one-time token: 4 groups of 5 from a 32-symbol alphabet = 100 bits */
function generateToken() {
  var raw = randomBytes(20), out = [];
  for (var i = 0; i < 20; i++) out.push(TOKEN_ALPHABET.charAt(raw[i] & 31));
  return [out.slice(0, 5), out.slice(5, 10), out.slice(10, 15), out.slice(15, 20)].map(function (g) { return g.join(''); }).join('-');
}
/* tokens are read aloud and retyped: ignore case, spaces, dashes */
function normPass(p) { return String(p || '').trim(); }
function normToken(p) { return /^[A-Za-z2-9\s-]{20,}$/.test(p) ? p.toUpperCase().replace(/[\s-]/g, '').replace(/(.{5})(?=.)/g, '$1-') : p; }

function deriveKey(pass, salt, iter) {
  var enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  });
}
function aad(meta) { return new TextEncoder().encode('meridian-share|v2|' + meta.id + '|' + meta.exp + '|' + (meta.once ? 1 : 0)); }

/* plainBytes -> { meta, ct }. opts: { expires: '24h'|'7d'|'never', once: bool, now } */
function seal(plainBytes, passphrase, opts) {
  opts = opts || {};
  if (!hasCrypto()) return Promise.reject(sealError('unsupported', SEAL_ERRORS.unsupported));
  var pass = normPass(passphrase);
  if (pass.length < PASS_MIN) return Promise.reject(sealError('weak', SEAL_ERRORS.weak));
  pass = normToken(pass);
  var now = opts.now != null ? opts.now : Date.now(), span = EXPIRIES[opts.expires || 'never'];
  var salt = randomBytes(16), iv = randomBytes(12);
  var meta = { id: hex(randomBytes(8)), exp: span ? now + span : 0, once: opts.once ? 1 : 0, salt: b64(salt), iv: b64(iv), it: SEAL_ITER };
  return deriveKey(pass, salt, SEAL_ITER).then(function (key) {
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad(meta) }, key, plainBytes);
  }).then(function (ct) { return { meta: meta, ct: new Uint8Array(ct) }; });
}

/* clear policy check, before asking for a passphrase: { expired } */
function checkMeta(meta, now) {
  if (!meta || typeof meta.id !== 'string' || !/^[0-9a-f]{16}$/.test(meta.id) || typeof meta.salt !== 'string' || typeof meta.iv !== 'string') throw sealError('corrupt', SEAL_ERRORS.corrupt);
  if (typeof meta.exp !== 'number' || !isFinite(meta.exp) || meta.exp < 0) throw sealError('corrupt', SEAL_ERRORS.corrupt);
  var it = meta.it;
  if (typeof it !== 'number' || it < 1000 || it > 2000000) throw sealError('corrupt', SEAL_ERRORS.corrupt);
  return { expired: meta.exp > 0 && (now != null ? now : Date.now()) > meta.exp };
}
/* { meta, ct } + passphrase -> plainBytes. Expiry is re-checked after the AAD
   binds it, so a link edited to look unexpired cannot decrypt. */
function unseal(meta, ct, passphrase, now) {
  if (!hasCrypto()) return Promise.reject(sealError('unsupported', SEAL_ERRORS.unsupported));
  var chk; try { chk = checkMeta(meta, now); } catch (e) { return Promise.reject(e); }
  if (chk.expired) return Promise.reject(sealError('expired', SEAL_ERRORS.expired));
  var salt, iv;
  try { salt = unb64(meta.salt); iv = unb64(meta.iv); } catch (e) { return Promise.reject(sealError('corrupt', SEAL_ERRORS.corrupt)); }
  return deriveKey(normToken(normPass(passphrase)), salt, meta.it).then(function (key) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: aad(meta) }, key, ct);
  }).then(function (pt) { return new Uint8Array(pt); }, function () { throw sealError('badpass', SEAL_ERRORS.badpass); });
}

/* "opened once" memory: a set of share ids in this browser's storage. Honest scope:
   it stops the same browser re-opening the link, nothing more. */
function usedIds(read) { try { var a = JSON.parse(read() || '[]'); return Array.isArray(a) ? a.filter(function (e) { return e && typeof e.id === 'string'; }) : []; } catch (e) { return []; } }
function wasUsed(read, id) { return usedIds(read).some(function (e) { return e.id === id; }); }
function markUsed(read, write, id, exp) {
  var list = usedIds(read);
  if (list.some(function (e) { return e.id === id; })) return;
  list.push({ id: id, exp: exp || 0 });
  write(JSON.stringify(list.slice(-200)));
}

export { EXPIRIES, PASS_MIN, SEAL_ERRORS, SEAL_ITER, checkMeta, generateToken, hasCrypto, markUsed, normToken, seal, unseal, usedIds, wasUsed };
