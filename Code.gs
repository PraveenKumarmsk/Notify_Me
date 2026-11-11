/* =====================================================================
   PingMe — Google Apps Script backend (Code.gs)
   Google Sheets = database | Apps Script = API | Web Push (VAPID) = notifications

   Is file me SIRF upar ke CONFIG ki 4 values badalni hain (README dekhiye):
     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT  (+ SHEET_ID agar chahiye)

   Kaise kaam karta hai (short):
   - Password: salted PBKDF2-HMAC-SHA256 (10,000 rounds) — plain password kabhi save nahi hota.
   - Login ke baad server ek signed token deta hai; har request server par verify hoti hai.
   - Push: Apps Script khud VAPID JWT (ES256 / P-256) sign karke push service ko
     "empty push" bhejta hai. Phone ka service worker jaag kar server se message le aata hai
     (isse payload encryption ki zaroorat nahi padti, aur Apps Script me sab chal jata hai).
   ===================================================================== */

// ============================ CONFIG ============================
const SHEET_ID          = "";   // khali rakhiye agar script isi Sheet se bani hai (Extensions → Apps Script). Alag script ho to Sheet ID daaliye.
const VAPID_PUBLIC_KEY  = "PASTE_VAPID_PUBLIC_KEY";    // vapid-generator.html se
const VAPID_PRIVATE_KEY = "PASTE_VAPID_PRIVATE_KEY";   // vapid-generator.html se (SECRET — GitHub par kabhi nahi)
const VAPID_SUBJECT     = "mailto:you@example.com";    // apna email, mailto: ke saath
const APP_NAME          = "PingMe";
// ================================================================

const TOKEN_DAYS        = 30;       // login kitne din chalega
const PBKDF2_ITERATIONS = 10000;    // password hashing rounds
const MAX_MESSAGE       = 300;      // notification message ki max length
const PULL_WINDOW_HOURS = 48;       // device kitne purane messages tak pull kar sakta hai

/* ---------------------------------------------------------------------
   SHEETS ka structure  ('key:Header' — key code me, Header Sheet me dikhta hai)
   --------------------------------------------------------------------- */
const SCHEMA_ = {
  Users:         ['id:User ID', 'hash:Password Hash', 'name:Name', 'created:Created Date', 'status:Status'],
  Connections:   ['from:Sender ID', 'to:Receiver ID', 'status:Connection Status', 'updated:Updated At'],
  Devices:       ['user:User ID', 'device:Device ID', 'sub:Push Subscription', 'label:Device', 'updated:Updated At'],
  Notifications: ['from:Sender ID', 'to:Receiver ID', 'message:Message', 'date:Date', 'time:Time', 'status:Status',
                  'id:ID', 'at:At (ISO)', 'readAt:Read At', 'deliveredTo:Delivered To', 'hidden:Hidden By'],
  Scheduled:     ['from:User ID', 'to:Receiver ID', 'message:Message', 'date:Scheduled Date', 'time:Scheduled Time',
                  'status:Status', 'id:ID', 'when:Scheduled At (ISO)', 'created:Created At', 'hidden:Hidden By']
};
const SCHEMA_KEYS_ = {};
const SCHEMA_HEADS_ = {};
Object.keys(SCHEMA_).forEach(function (n) {
  SCHEMA_KEYS_[n]  = SCHEMA_[n].map(function (s) { return s.split(':')[0]; });
  SCHEMA_HEADS_[n] = SCHEMA_[n].map(function (s) { return s.substring(s.indexOf(':') + 1); });
});

/* =====================================================================
   1) PURE-JS CRYPTO  (Apps Script me ECDSA / PBKDF2 built-in nahi hai)
   Ye hissa Apps Script ke bina bhi chalta hai (testable).
   ===================================================================== */

// ---------- UTF-8 / Base64URL / bytes helpers ----------
function utf8_(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {          // surrogate pair (emoji)
      const c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const B64_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64uEnc_(bytes) {
  let s = '', i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64_[(n >> 18) & 63] + B64_[(n >> 12) & 63] + B64_[(n >> 6) & 63] + B64_[n & 63];
  }
  if (i + 1 === bytes.length) {
    const n = bytes[i] << 16;
    s += B64_[(n >> 18) & 63] + B64_[(n >> 12) & 63];
  } else if (i + 2 === bytes.length) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += B64_[(n >> 18) & 63] + B64_[(n >> 12) & 63] + B64_[(n >> 6) & 63];
  }
  return s;
}
function b64uDec_(str) {
  str = String(str).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const out = [];
  let buf = 0, bits = 0;
  for (let i = 0; i < str.length; i++) {
    const v = B64_.indexOf(str[i]);
    if (v < 0) throw new Error('bad base64url');
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); buf &= (1 << bits) - 1; }
  }
  return out;
}
function concat_() {
  let out = [];
  for (let i = 0; i < arguments.length; i++) out = out.concat(Array.prototype.slice.call(arguments[i]));
  return out;
}

// ---------- SHA-256 / HMAC / PBKDF2 ----------
const K256_ = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function sha256_(bytes) {
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = bytes.length;
  const padLen = (((l + 9 + 63) >> 6) << 6);
  const m = new Array(padLen);
  for (let i = 0; i < padLen; i++) m[i] = i < l ? bytes[i] : 0;
  m[l] = 0x80;
  const bitsHi = Math.floor((l * 8) / 4294967296), bitsLo = (l * 8) >>> 0;
  m[padLen - 8] = (bitsHi >>> 24) & 255; m[padLen - 7] = (bitsHi >>> 16) & 255;
  m[padLen - 6] = (bitsHi >>> 8) & 255;  m[padLen - 5] = bitsHi & 255;
  m[padLen - 4] = (bitsLo >>> 24) & 255; m[padLen - 3] = (bitsLo >>> 16) & 255;
  m[padLen - 2] = (bitsLo >>> 8) & 255;  m[padLen - 1] = bitsLo & 255;
  const w = new Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3]) | 0;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256_[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  const out = [];
  for (let i = 0; i < 8; i++) out.push((h[i] >>> 24) & 255, (h[i] >>> 16) & 255, (h[i] >>> 8) & 255, h[i] & 255);
  return out;
}
function hmacSha256_(key, msg) {
  if (key.length > 64) key = sha256_(key);
  const ipad = new Array(64), opad = new Array(64);
  for (let i = 0; i < 64; i++) {
    const k = i < key.length ? key[i] : 0;
    ipad[i] = k ^ 0x36; opad[i] = k ^ 0x5c;
  }
  return sha256_(opad.concat(sha256_(ipad.concat(msg))));
}
function pbkdf2_(password, salt, iterations) {            // 32-byte output (1 block)
  let u = hmacSha256_(password, salt.concat([0, 0, 0, 1]));
  const t = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = hmacSha256_(password, u);
    for (let j = 0; j < 32; j++) t[j] ^= u[j];
  }
  return t;
}
function randomBytes_(n) {                                  // Utilities.getUuid() (secure random) se
  let pool = [];
  while (pool.length < n) {
    const hex = Utilities.getUuid().replace(/-/g, '');
    for (let i = 0; i < 32; i += 2) pool.push(parseInt(hex.substr(i, 2), 16));
  }
  // thoda aur mixing: time + hash
  const mix = sha256_(pool.concat(utf8_(String(Date.now()) + Math.random())));
  return pool.slice(0, n).map(function (b, i) { return b ^ mix[i % 32]; });
}
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- P-256 (secp256r1) ECDSA, BigInt ----------
const P256_P  = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const P256_N  = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const P256_GX = BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');
const P256_GY = BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5');
const ZERO_ = BigInt(0), ONE_ = BigInt(1), TWO_ = BigInt(2), THREE_ = BigInt(3);

function mod_(a, m) { const r = a % m; return r >= ZERO_ ? r : r + m; }
function invMod_(a, m) {
  let t = ZERO_, newT = ONE_, r = m, newR = mod_(a, m);
  while (newR !== ZERO_) {
    const q = r / newR;
    const tmpT = t - q * newT; t = newT; newT = tmpT;
    const tmpR = r - q * newR; r = newR; newR = tmpR;
  }
  return mod_(t, m);
}
function bytesToBig_(bytes) {
  let n = ZERO_;
  for (let i = 0; i < bytes.length; i++) n = (n << BigInt(8)) | BigInt(bytes[i]);
  return n;
}
function bigToBytes_(n, len) {
  const out = new Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(n & BigInt(255)); n >>= BigInt(8); }
  return out;
}
// Jacobian points: [X, Y, Z]; infinity => Z == 0
function ecDouble_(p) {
  const X = p[0], Y = p[1], Z = p[2], M = P256_P;
  if (Z === ZERO_ || Y === ZERO_) return [ZERO_, ONE_, ZERO_];
  const delta = (Z * Z) % M, gamma = (Y * Y) % M, beta = (X * gamma) % M;
  const alpha = mod_(THREE_ * (X - delta) * (X + delta), M);
  const X3 = mod_(alpha * alpha - BigInt(8) * beta, M);
  const Z3 = mod_((Y + Z) * (Y + Z) - gamma - delta, M);
  const Y3 = mod_(alpha * (BigInt(4) * beta - X3) - BigInt(8) * gamma * gamma, M);
  return [X3, Y3, Z3];
}
function ecAdd_(p, q) {
  if (p[2] === ZERO_) return q;
  if (q[2] === ZERO_) return p;
  const M = P256_P;
  const Z1Z1 = (p[2] * p[2]) % M, Z2Z2 = (q[2] * q[2]) % M;
  const U1 = (p[0] * Z2Z2) % M, U2 = (q[0] * Z1Z1) % M;
  const S1 = (p[1] * q[2] % M) * Z2Z2 % M, S2 = (q[1] * p[2] % M) * Z1Z1 % M;
  const H = mod_(U2 - U1, M), r0 = mod_(S2 - S1, M);
  if (H === ZERO_) return r0 === ZERO_ ? ecDouble_(p) : [ZERO_, ONE_, ZERO_];
  const I = (TWO_ * H) * (TWO_ * H) % M, J = (H * I) % M, r = (TWO_ * r0) % M, V = (U1 * I) % M;
  const X3 = mod_(r * r - J - TWO_ * V, M);
  const Y3 = mod_(r * (V - X3) - TWO_ * S1 * J, M);
  const Z3 = mod_(((p[2] + q[2]) * (p[2] + q[2]) - Z1Z1 - Z2Z2) * H, M);
  return [X3, Y3, Z3];
}
function ecMulG_(k) {                                       // k * G  -> affine [x, y]
  let result = [ZERO_, ONE_, ZERO_];
  const G = [P256_GX, P256_GY, ONE_];
  const bits = k.toString(2);
  for (let i = 0; i < bits.length; i++) {
    result = ecDouble_(result);
    if (bits[i] === '1') result = ecAdd_(result, G);
  }
  const zi = invMod_(result[2], P256_P), zi2 = (zi * zi) % P256_P;
  return [(result[0] * zi2) % P256_P, (result[1] * zi2 % P256_P) * zi % P256_P];
}
function ecdsaSign_(hash32, dBytes) {                       // returns 64 bytes r||s
  const d = bytesToBig_(dBytes), e = bytesToBig_(hash32);
  for (let ctr = 0; ctr < 100; ctr++) {
    const kb = hmacSha256_(dBytes, hash32.concat([ctr]));   // deterministic nonce (RFC6979-style)
    const k = bytesToBig_(kb) % P256_N;
    if (k === ZERO_) continue;
    const r = ecMulG_(k)[0] % P256_N;
    if (r === ZERO_) continue;
    const s = mod_(invMod_(k, P256_N) * (e + r * d), P256_N);
    if (s === ZERO_) continue;
    return bigToBytes_(r, 32).concat(bigToBytes_(s, 32));
  }
  throw new Error('sign failed');
}
function publicFromPrivate_(dBytes) {                        // 65-byte uncompressed public key
  const xy = ecMulG_(bytesToBig_(dBytes));
  return [4].concat(bigToBytes_(xy[0], 32), bigToBytes_(xy[1], 32));
}

// ---------- VAPID JWT ----------
function vapidJwt_(audience) {
  const header = b64uEnc_(utf8_(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEnc_(utf8_(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT
  })));
  const input = header + '.' + claims;
  const sig = ecdsaSign_(sha256_(utf8_(input)), b64uDec_(VAPID_PRIVATE_KEY));
  return input + '.' + b64uEnc_(sig);
}
function vapidJwtCached_(audience) {
  const cache = CacheService.getScriptCache();
  const key = 'jwt_' + b64uEnc_(sha256_(utf8_(audience + VAPID_PUBLIC_KEY))).substring(0, 20);
  const hit = cache.get(key);
  if (hit) return hit;
  const jwt = vapidJwt_(audience);
  try { cache.put(key, jwt, 6 * 3600); } catch (e) {}
  return jwt;
}
function vapidReady_() {                                     // keys sahi hain aur ek doosre se match karte hain?
  try {
    if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.indexOf('PASTE_') === 0) return { ok: false, msg: 'VAPID_PUBLIC_KEY Code.gs me nahi bhari' };
    if (!VAPID_PRIVATE_KEY || VAPID_PRIVATE_KEY.indexOf('PASTE_') === 0) return { ok: false, msg: 'VAPID_PRIVATE_KEY Code.gs me nahi bhari' };
    const cache = CacheService.getScriptCache();
    const ck = 'vapidok_' + b64uEnc_(sha256_(utf8_(VAPID_PUBLIC_KEY + '|' + VAPID_PRIVATE_KEY))).substring(0, 20);
    if (cache.get(ck) === '1') return { ok: true };
    const pub = b64uDec_(VAPID_PUBLIC_KEY), priv = b64uDec_(VAPID_PRIVATE_KEY);
    if (pub.length !== 65 || pub[0] !== 4) return { ok: false, msg: 'Public key galat hai (65 bytes honi chahiye)' };
    if (priv.length !== 32) return { ok: false, msg: 'Private key galat hai (32 bytes honi chahiye)' };
    const derived = publicFromPrivate_(priv);
    if (b64uEnc_(derived) !== b64uEnc_(pub)) return { ok: false, msg: 'Public aur Private key ek jodi nahi hain — dono ek hi baar me generate kijiye' };
    try { cache.put(ck, '1', 6 * 3600); } catch (e) {}
    return { ok: true };
  } catch (err) {
    return { ok: false, msg: 'VAPID key padhne me error: ' + err.message };
  }
}

/* =====================================================================
   2) SHEET helpers
   ===================================================================== */
const sheetMemo_ = {};
function ss_() {
  if (SHEET_ID && SHEET_ID.indexOf('YOUR_') !== 0) return SpreadsheetApp.openById(SHEET_ID);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) fail_('SHEET_ID khali hai aur script kisi Google Sheet se juri nahi hai. Code.gs me SHEET_ID daaliye.');
  return active;
}
function sheet_(name) {                                     // tab na ho to heading ke saath khud ban jata hai
  if (sheetMemo_[name]) return sheetMemo_[name];
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const heads = SCHEMA_HEADS_[name];
    sh.getRange(1, 1, sh.getMaxRows(), heads.length).setNumberFormat('@');      // sab kuch plain text (dates auto-convert na hon)
    sh.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold').setBackground('#e0e7ff');
    sh.setFrozenRows(1);
    if (name === 'Users') sh.setColumnWidth(2, 380);
    if (name === 'Devices') sh.setColumnWidth(3, 380);
  }
  sheetMemo_[name] = sh;
  return sh;
}
function table_(name) {
  const keys = SCHEMA_KEYS_[name], sh = sheet_(name), last = sh.getLastRow(), rows = [];
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, keys.length).getValues();
    for (let i = 0; i < vals.length; i++) {
      const o = { _r: i + 2 };
      for (let j = 0; j < keys.length; j++) o[keys[j]] = vals[i][j] === undefined || vals[i][j] === null ? '' : String(vals[i][j]);
      if (o[keys[0]] !== '' || o[keys[1]] !== '') rows.push(o);
    }
  }
  return rows;
}
function append_(name, obj) {
  const keys = SCHEMA_KEYS_[name], sh = sheet_(name);
  const row = sh.getLastRow() + 1;
  const rng = sh.getRange(row, 1, 1, keys.length);
  rng.setNumberFormat('@');
  rng.setValues([keys.map(function (k) { return obj[k] === undefined ? '' : String(obj[k]); })]);
  return row;
}
function setField_(name, row, key, val) {
  sheet_(name).getRange(row, SCHEMA_KEYS_[name].indexOf(key) + 1).setValue(String(val));
}
function deleteRow_(name, row) { sheet_(name).deleteRow(row); }
function setupSheets() {                                    // saare tabs ek saath bana deta hai
  Object.keys(SCHEMA_).forEach(function (n) { sheet_(n); });
}

function tz_() { try { return Session.getScriptTimeZone() || 'Asia/Kolkata'; } catch (e) { return 'Asia/Kolkata'; } }
function fmtDate_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function fmtTime_(d) { return Utilities.formatDate(d, tz_(), 'HH:mm:ss'); }
function newId_(prefix) { return prefix + Date.now().toString(36) + Utilities.getUuid().replace(/-/g, '').substring(0, 5); }

/* =====================================================================
   3) AUTH: password hash + signed session token
   ===================================================================== */
function fail_(msg) { throw { userMessage: msg }; }

function hashPassword_(password) {
  const salt = randomBytes_(16);
  const h = pbkdf2_(utf8_(password), salt, PBKDF2_ITERATIONS);
  return ['pbkdf2', PBKDF2_ITERATIONS, b64uEnc_(salt), b64uEnc_(h)].join('$');
}
function verifyPassword_(password, stored) {
  const p = String(stored).split('$');
  if (p.length !== 4 || p[0] !== 'pbkdf2') return false;
  const h = pbkdf2_(utf8_(password), b64uDec_(p[2]), parseInt(p[1], 10));
  return safeEqual_(b64uEnc_(h), p[3]);
}
function serverSecret_() {                                  // pehli baar random bana kar Script Properties me rakhta hai
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SERVER_SECRET');
  if (!s) {
    s = b64uEnc_(randomBytes_(32));
    props.setProperty('SERVER_SECRET', s);
  }
  return s;
}
function makeToken_(user) {
  const exp = Date.now() + TOKEN_DAYS * 24 * 3600 * 1000;
  const payload = user.id + '.' + exp;
  const sig = b64uEnc_(hmacSha256_(utf8_(serverSecret_()), utf8_(payload + '.' + String(user.hash).slice(-16))));
  return payload + '.' + sig;
}
function authUser_(token) {                                 // valid token → user object, warna null
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const exp = parseInt(parts[1], 10);
  if (!exp || exp < Date.now()) return null;
  const users = table_('Users');
  let user = null;
  for (let i = 0; i < users.length; i++) if (users[i].id === parts[0]) { user = users[i]; break; }
  if (!user || user.status !== 'active') return null;
  const expect = b64uEnc_(hmacSha256_(utf8_(serverSecret_()), utf8_(parts[0] + '.' + parts[1] + '.' + String(user.hash).slice(-16))));
  return safeEqual_(expect, parts[2]) ? user : null;
}
function sessionOut_(user) { return { token: makeToken_(user), user: { id: user.id, name: user.name } }; }

/* =====================================================================
   4) Validation helpers
   ===================================================================== */
function normId_(v) {
  const id = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(id)) fail_('User ID 3-20 characters ka ho: sirf a-z, 0-9 aur _');
  return id;
}
function cleanText_(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, max);
}
function cleanMsg_(v) {
  const m = String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!m) fail_('Message khali hai.');
  if (m.length > MAX_MESSAGE) fail_('Message ' + MAX_MESSAGE + ' characters se chhota rakhiye.');
  return m;
}
const PUSH_HOST_RE_ = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|[a-z0-9.-]+\.push\.apple\.com)\//;

function usersMap_() {
  const m = {};
  table_('Users').forEach(function (u) { m[u.id] = u; });
  return m;
}
function hiddenHas_(row, id) { return ('' + row.hidden).split(',').indexOf(id) !== -1; }

/* ---- Connections ---- */
function connectionBetween_(rows, a, b) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if ((r.from === a && r.to === b) || (r.from === b && r.to === a)) return r;
  }
  return null;
}
function connectedIds_(me) {
  const out = {};
  table_('Connections').forEach(function (r) {
    if (r.status !== 'accepted') return;
    if (r.from === me) out[r.to] = true;
    else if (r.to === me) out[r.from] = true;
  });
  return out;
}

/* =====================================================================
   5) PUSH bhejna
   ===================================================================== */
function pushHeaders_(endpoint) {
  const m = endpoint.match(/^(https:\/\/[^\/]+)/);
  const jwt = vapidJwtCached_(m[1]);
  return {
    'Authorization': 'vapid t=' + jwt + ', k=' + VAPID_PUBLIC_KEY,
    'TTL': '86400',
    'Urgency': 'high'
  };
}
/* devices: Devices rows. Return: { ok: n accepted, failed: n, gone: n } */
function pushToDevices_(devices) {
  const res = { ok: 0, failed: 0, gone: 0 };
  if (!devices.length) return res;
  if (!vapidReady_().ok) { res.failed = devices.length; return res; }
  const reqs = [], used = [];
  devices.forEach(function (d) {
    try {
      const sub = JSON.parse(d.sub);
      if (!sub.endpoint || !PUSH_HOST_RE_.test(sub.endpoint)) { res.failed++; return; }
      reqs.push({ url: sub.endpoint, method: 'post', headers: pushHeaders_(sub.endpoint), muteHttpExceptions: true });
      used.push(d);
    } catch (e) { res.failed++; }
  });
  if (!reqs.length) return res;
  let responses;
  try { responses = UrlFetchApp.fetchAll(reqs); } catch (e) { res.failed += reqs.length; return res; }
  const dead = [];
  responses.forEach(function (r, i) {
    const code = r.getResponseCode();
    if (code >= 200 && code < 300) res.ok++;
    else if (code === 404 || code === 410) { res.gone++; dead.push(used[i]._r); }
    else res.failed++;
  });
  dead.sort(function (a, b) { return b - a; }).forEach(function (r) { deleteRow_('Devices', r); });   // expire hue devices hatao
  return res;
}

/* senderId → receiverIds ko message deliver (Notifications rows + push) */
function deliver_(senderId, receiverIds, message) {
  const now = new Date();
  let allDevices = table_('Devices');
  const results = [];
  receiverIds.forEach(function (rid) {
    const id = newId_('n');
    const row = append_('Notifications', {
      from: senderId, to: rid, message: message, date: fmtDate_(now), time: fmtTime_(now),
      status: 'queued', id: id, at: now.toISOString(), readAt: '', deliveredTo: '', hidden: ''
    });
    const devs = allDevices.filter(function (d) { return d.user === rid; });
    const r = pushToDevices_(devs);
    if (r.gone > 0) allDevices = table_('Devices');           // rows hatne ke baad numbering badal jati hai
    let status = 'queued';
    if (r.ok > 0) status = 'sent';
    else if (r.failed > 0) status = 'failed';
    setField_('Notifications', row, 'status', status);
    results.push({ to: rid, status: status, id: id });
  });
  return results;
}

/* =====================================================================
   6) API handlers
   ===================================================================== */
const PUBLIC_ = { register: true, login: true };

const API_ = {
  /* ---------- auth ---------- */
  register: function (req) {
    const id = normId_(req.userId);
    const name = cleanText_(req.name || id, 40) || id;
    const pw = String(req.password || '');
    if (pw.length < 6) fail_('Password kam se kam 6 characters ka rakhiye.');
    if (pw.length > 100) fail_('Password bahut lamba hai.');
    const users = table_('Users');
    if (users.some(function (u) { return u.id === id; })) fail_('Ye User ID pehle se maujood hai, doosri chuniye.');
    const hash = hashPassword_(pw);
    append_('Users', { id: id, hash: hash, name: name, created: fmtDate_(new Date()) + ' ' + fmtTime_(new Date()), status: 'active' });
    return sessionOut_({ id: id, name: name, hash: hash });
  },

  login: function (req) {
    const id = String(req.userId || '').trim().toLowerCase();
    const cache = CacheService.getScriptCache();
    const failKey = 'fail_' + id;
    if (parseInt(cache.get(failKey) || '0', 10) >= 5) fail_('Bahut zyada galat koshish. 10 minute baad try kijiye.');
    const user = table_('Users').filter(function (u) { return u.id === id; })[0];
    if (!user || user.status !== 'active' || !verifyPassword_(String(req.password || ''), user.hash)) {
      cache.put(failKey, String(parseInt(cache.get(failKey) || '0', 10) + 1), 600);
      fail_('User ID ya password galat hai.');
    }
    cache.remove(failKey);
    return sessionOut_(user);
  },

  logout: function (req, user) {
    if (req.deviceId) removeDevice_(user.id, String(req.deviceId));
    return {};
  },

  /* ---------- dashboard ---------- */
  stats: function (req, user) {
    const users = table_('Users').filter(function (u) { return u.status === 'active'; });
    const conns = table_('Connections');
    let connected = 0, incoming = 0, outgoing = 0;
    conns.forEach(function (c) {
      if (c.status === 'accepted' && (c.from === user.id || c.to === user.id)) connected++;
      if (c.status === 'pending' && c.to === user.id) incoming++;
      if (c.status === 'pending' && c.from === user.id) outgoing++;
    });
    let sent = 0, received = 0, unread = 0;
    table_('Notifications').forEach(function (n) {
      if (n.from === user.id) sent++;
      if (n.to === user.id) { received++; if (!n.readAt) unread++; }
    });
    const scheduled = table_('Scheduled').filter(function (s) { return s.from === user.id && s.status === 'pending'; }).length;
    const devices = table_('Devices').filter(function (d) { return d.user === user.id; })
      .map(function (d) { return { device: d.device, label: d.label, updated: d.updated }; });
    return {
      user: { id: user.id, name: user.name },
      stats: { totalUsers: users.length, connected: connected, sent: sent, received: received, scheduled: scheduled, unread: unread,
               incoming: incoming, outgoing: outgoing },
      devices: devices
    };
  },

  /* ---------- people / connections ---------- */
  searchUsers: function (req, user) {
    const q = String(req.q || '').trim().toLowerCase();
    if (q.length < 2) return { users: [] };
    const conns = table_('Connections');
    const out = [];
    table_('Users').forEach(function (u) {
      if (u.id === user.id || u.status !== 'active') return;
      if (u.id.indexOf(q) === -1 && u.name.toLowerCase().indexOf(q) === -1) return;
      const c = connectionBetween_(conns, user.id, u.id);
      let rel = 'none';
      if (c) {
        if (c.status === 'accepted') rel = 'connected';
        else if (c.status === 'pending') rel = c.from === user.id ? 'pending_out' : 'pending_in';
      }
      out.push({ userId: u.id, name: u.name, relation: rel });
    });
    out.sort(function (a, b) { return (a.userId === q ? -1 : 0) - (b.userId === q ? -1 : 0) || a.userId.localeCompare(b.userId); });
    return { users: out.slice(0, 20) };
  },

  connections: function (req, user) {
    const um = usersMap_();
    const friends = [], incoming = [], outgoing = [];
    table_('Connections').forEach(function (c) {
      const other = c.from === user.id ? c.to : (c.to === user.id ? c.from : null);
      if (!other || !um[other]) return;
      const item = { userId: other, name: um[other].name, since: c.updated };
      if (c.status === 'accepted') friends.push(item);
      else if (c.status === 'pending') (c.to === user.id ? incoming : outgoing).push(item);
    });
    friends.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { friends: friends, incoming: incoming, outgoing: outgoing };
  },

  sendRequest: function (req, user) {
    const to = normId_(req.to);
    if (to === user.id) fail_('Khud ko request nahi bhej sakte.');
    const um = usersMap_();
    if (!um[to] || um[to].status !== 'active') fail_('Ye user nahi mila.');
    const conns = table_('Connections');
    const c = connectionBetween_(conns, user.id, to);
    const stamp = fmtDate_(new Date()) + ' ' + fmtTime_(new Date());
    if (c) {
      if (c.status === 'accepted') fail_('Aap pehle se connected hain.');
      if (c.status === 'pending' && c.from === user.id) fail_('Request pehle se bheji hui hai.');
      if (c.status === 'pending' && c.to === user.id) {                    // samne wale ne pehle bheji thi → seedha accept
        setField_('Connections', c._r, 'status', 'accepted'); setField_('Connections', c._r, 'updated', stamp);
        return { status: 'accepted' };
      }
      // rejected tha → naye sire se pending
      setField_('Connections', c._r, 'from', user.id); setField_('Connections', c._r, 'to', to);
      setField_('Connections', c._r, 'status', 'pending'); setField_('Connections', c._r, 'updated', stamp);
      return { status: 'pending' };
    }
    append_('Connections', { from: user.id, to: to, status: 'pending', updated: stamp });
    return { status: 'pending' };
  },

  respondRequest: function (req, user) {
    const from = normId_(req.from);
    const c = table_('Connections').filter(function (r) { return r.from === from && r.to === user.id && r.status === 'pending'; })[0];
    if (!c) fail_('Ye request ab maujood nahi hai.');
    const stamp = fmtDate_(new Date()) + ' ' + fmtTime_(new Date());
    setField_('Connections', c._r, 'status', req.accept ? 'accepted' : 'rejected');
    setField_('Connections', c._r, 'updated', stamp);
    return { status: req.accept ? 'accepted' : 'rejected' };
  },

  removeConnection: function (req, user) {                 // connection hatao ya bheji hui request cancel karo
    const other = normId_(req.userId);
    const c = connectionBetween_(table_('Connections'), user.id, other);
    if (!c) return {};
    deleteRow_('Connections', c._r);
    return {};
  },

  /* ---------- devices (push subscription) ---------- */
  subscribe: function (req, user) {
    const deviceId = String(req.deviceId || '').replace(/[^A-Za-z0-9_-]/g, '').substring(0, 40);
    const sub = req.subscription;
    if (!deviceId) fail_('deviceId missing');
    if (!sub || !sub.endpoint || !PUSH_HOST_RE_.test(String(sub.endpoint))) fail_('Ye browser ka push service supported nahi hai.');
    const clean = { endpoint: String(sub.endpoint), keys: sub.keys || {} };
    const label = cleanText_(req.label || 'Device', 40);
    const stamp = fmtDate_(new Date()) + ' ' + fmtTime_(new Date());
    // same endpoint kisi aur user/device ke naam ho to hata do (device badalne par)
    const dev = table_('Devices');
    const stale = [];
    let mine = null;
    dev.forEach(function (d) {
      let ep = '';
      try { ep = JSON.parse(d.sub).endpoint; } catch (e) {}
      if (d.device === deviceId && d.user === user.id) mine = d;
      else if (d.device === deviceId || ep === clean.endpoint) stale.push(d._r);
    });
    if (mine) {
      setField_('Devices', mine._r, 'sub', JSON.stringify(clean));
      setField_('Devices', mine._r, 'label', label);
      setField_('Devices', mine._r, 'updated', stamp);
    } else {
      append_('Devices', { user: user.id, device: deviceId, sub: JSON.stringify(clean), label: label, updated: stamp });
    }
    stale.sort(function (a, b) { return b - a; }).forEach(function (r) { deleteRow_('Devices', r); });
    return {};
  },

  unsubscribe: function (req, user) {
    removeDevice_(user.id, String(req.deviceId || ''));
    return {};
  },

  /* ---------- notifications ---------- */
  send: function (req, user) {
    const message = cleanMsg_(req.message);
    let to = Array.isArray(req.to) ? req.to : [req.to];
    const seen = {};
    to = to.map(normId_).filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
    if (!to.length) fail_('Pehle koi user chuniye.');
    if (to.length > 50) fail_('Ek baar me max 50 users ko bhej sakte hain.');
    if (to.indexOf(user.id) !== -1) fail_('Khud ko nahi bhej sakte. Test ke liye Settings me "Test notification" use kijiye.');
    const ok = connectedIds_(user.id);
    to.forEach(function (r) { if (!ok[r]) fail_('@' + r + ' aapka connected user nahi hai.'); });

    if (req.scheduleAt) {
      const when = new Date(req.scheduleAt);
      if (isNaN(when.getTime())) fail_('Schedule ka time sahi nahi hai.');
      if (when.getTime() < Date.now() + 20000) fail_('Schedule time future me hona chahiye.');
      const created = new Date().toISOString();
      to.forEach(function (r) {
        append_('Scheduled', {
          from: user.id, to: r, message: message, date: fmtDate_(when), time: fmtTime_(when).substring(0, 5),
          status: 'pending', id: newId_('s'), when: when.toISOString(), created: created, hidden: ''
        });
      });
      return { scheduled: to.length, when: when.toISOString() };
    }
    if (!vapidReady_().ok) fail_('Server par VAPID keys sahi set nahi hain: ' + vapidReady_().msg);
    return { results: deliver_(user.id, to, message) };
  },

  test: function (req, user) {                              // apne hi devices par test notification
    if (!vapidReady_().ok) fail_('Server par VAPID keys sahi set nahi hain: ' + vapidReady_().msg);
    const r = deliver_(user.id, [user.id], 'Test notification: ' + APP_NAME + ' sahi chal raha hai.');
    const devs = table_('Devices').filter(function (d) { return d.user === user.id; }).length;
    return { results: r, devices: devs };
  },

  history: function (req, user) {
    const kind = String(req.kind || 'sent');
    const um = usersMap_();
    const nm = function (id) { return um[id] ? um[id].name : id; };
    let items = [];
    if (kind === 'scheduled') {
      table_('Scheduled').forEach(function (s) {
        if (s.from !== user.id || hiddenHas_(s, user.id)) return;
        items.push({ id: s.id, other: s.to, otherName: nm(s.to), message: s.message, at: s.when, date: s.date, time: s.time, status: s.status });
      });
    } else {
      table_('Notifications').forEach(function (n) {
        const mineSent = kind === 'sent' && n.from === user.id;
        const mineRecv = kind === 'received' && n.to === user.id;
        if (!(mineSent || mineRecv) || hiddenHas_(n, user.id)) return;
        const other = mineSent ? n.to : n.from;
        items.push({ id: n.id, other: other, otherName: nm(other), message: n.message, at: n.at, date: n.date, time: n.time,
                     status: n.status, readAt: n.readAt });
      });
    }
    items.sort(function (a, b) { return kind === 'scheduled' ? (a.at < b.at ? -1 : 1) : (a.at < b.at ? 1 : -1); });
    return { items: items.slice(0, 200) };
  },

  remove: function (req, user) {                            // history se delete (sirf aapki taraf se hide)
    const ids = (Array.isArray(req.ids) ? req.ids : [req.id]).map(String);
    const tabName = req.kind === 'scheduled' ? 'Scheduled' : 'Notifications';
    table_(tabName).forEach(function (r) {
      if (ids.indexOf(r.id) === -1) return;
      const owns = tabName === 'Scheduled' ? r.from === user.id : (r.from === user.id || r.to === user.id);
      if (!owns) return;
      if (tabName === 'Scheduled' && r.status === 'pending') setField_('Scheduled', r._r, 'status', 'cancelled');
      const h = (r.hidden ? r.hidden.split(',') : []);
      if (h.indexOf(user.id) === -1) { h.push(user.id); setField_(tabName, r._r, 'hidden', h.join(',')); }
    });
    return {};
  },

  markRead: function (req, user) {
    const ids = Array.isArray(req.ids) ? req.ids.map(String) : null;
    const stamp = new Date().toISOString();
    let n = 0;
    table_('Notifications').forEach(function (r) {
      if (r.to !== user.id || r.readAt) return;
      if (ids && ids.indexOf(r.id) === -1) return;
      setField_('Notifications', r._r, 'readAt', stamp);
      setField_('Notifications', r._r, 'status', 'read');
      n++;
    });
    return { marked: n };
  },

  /* Service Worker ye call karta hai jab push aata hai: is device ke liye naye messages */
  pull: function (req, user) {
    const deviceId = String(req.deviceId || '').replace(/[^A-Za-z0-9_-]/g, '').substring(0, 40);
    const um = usersMap_();
    const since = new Date(Date.now() - PULL_WINDOW_HOURS * 3600 * 1000).toISOString();
    const items = [];
    table_('Notifications').forEach(function (n) {
      if (n.to !== user.id || n.at < since || hiddenHas_(n, user.id)) return;
      const done = n.deliveredTo ? n.deliveredTo.split(',') : [];
      if (done.indexOf(deviceId) !== -1) return;
      done.push(deviceId);
      setField_('Notifications', n._r, 'deliveredTo', done.join(','));
      if (n.status === 'sent' || n.status === 'queued' || n.status === 'failed') setField_('Notifications', n._r, 'status', 'delivered');
      items.push({ id: n.id, from: n.from, fromName: um[n.from] ? um[n.from].name : n.from, message: n.message, at: n.at });
    });
    items.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    return { items: items.slice(-10) };
  }
};

function removeDevice_(userId, deviceId) {
  table_('Devices').filter(function (d) { return d.user === userId && d.device === deviceId; })
    .map(function (d) { return d._r; }).sort(function (a, b) { return b - a; })
    .forEach(function (r) { deleteRow_('Devices', r); });
}

/* =====================================================================
   7) Web App entry points
   ===================================================================== */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  if (action === 'config') {
    const v = vapidReady_();
    return json_({ ok: true, appName: APP_NAME, vapidPublicKey: VAPID_PUBLIC_KEY, vapidReady: v.ok, vapidMessage: v.ok ? '' : v.msg });
  }
  return json_({ ok: true, service: APP_NAME + ' backend chal raha hai' });
}

function doPost(e) {
  let lock = null;
  try {
    const req = JSON.parse(e.postData.contents);
    const handler = API_[String(req.action || '')];
    if (!handler || !Object.prototype.hasOwnProperty.call(API_, String(req.action))) return json_({ ok: false, error: 'unknown action' });
    lock = LockService.getScriptLock();
    lock.waitLock(25000);
    let user = null;
    if (!PUBLIC_[req.action]) {
      user = authUser_(req.token);
      if (!user) return json_({ ok: false, code: 'auth', error: 'Session khatam ho gaya, dobara login kijiye.' });
    }
    const out = handler(req, user) || {};
    out.ok = true;
    return json_(out);
  } catch (err) {
    if (err && err.userMessage) return json_({ ok: false, error: err.userMessage });
    return json_({ ok: false, error: 'Server error: ' + String(err && err.message ? err.message : err) });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (x) {} }
  }
}

/* =====================================================================
   8) Scheduler — har 1 minute me chalta hai (trigger)
   ===================================================================== */
function processScheduled() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const nowIso = new Date().toISOString();
    const due = table_('Scheduled').filter(function (s) { return s.status === 'pending' && s.when <= nowIso; });
    if (!due.length) return;
    due.forEach(function (s) {
      try {
        const ok = connectedIds_(s.from);
        if (!ok[s.to]) { setField_('Scheduled', s._r, 'status', 'failed: not connected'); return; }
        setField_('Scheduled', s._r, 'status', 'sending');
        const r = deliver_(s.from, [s.to], s.message)[0];
        setField_('Scheduled', s._r, 'status', r.status === 'failed' ? 'failed' : 'sent');
      } catch (err) {
        setField_('Scheduled', s._r, 'status', 'failed: ' + String(err.message || err).substring(0, 60));
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/* EK BAAR run karein: har 1 minute me processScheduled chalane ka trigger banata hai */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processScheduled') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processScheduled').timeBased().everyMinutes(1).create();
  setupSheets();
  Logger.log('Done: trigger set + sheets tayyar.');
}

/* Self-test: VAPID keys aur signing check karta hai (editor me run karke Logs dekhiye) */
function selfTest() {
  const lines = [];
  const v = vapidReady_();
  lines.push('VAPID keys: ' + (v.ok ? 'OK (public/private match karte hain)' : 'PROBLEM -> ' + v.msg));
  if (v.ok) {
    const jwt = vapidJwt_('https://fcm.googleapis.com');
    lines.push('VAPID JWT sign: OK (' + jwt.length + ' chars)');
  }
  const h = verifyPassword_('test123', hashPassword_('test123'));
  lines.push('Password hash/verify: ' + (h ? 'OK' : 'FAIL'));
  try { setupSheets(); lines.push('Sheets tabs: OK'); } catch (e) { lines.push('Sheets: ' + e.message); }
  lines.push('Trigger(s): ' + ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'processScheduled'; }).length +
             ' (1 hona chahiye — nahi to setupTrigger chalaiye)');
  const msg = lines.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu(APP_NAME)
      .addItem('1) Setup (trigger + sheets)', 'setupTrigger')
      .addItem('2) Self-test (VAPID check)', 'selfTest')
      .addToUi();
  } catch (e) {}
}
