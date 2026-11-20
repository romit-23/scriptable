// pvtshiiiiii-auto-updater.js — Scriptable (iOS)
// Install this script on BOTH iPhones (by hand, once) and run it instead of the main app.
// Also point the home-screen widget at this script.
//
// On every run it downloads pvtshiiiiii.js and pvtshiiiiii.js.sig from GitHub, verifies the
// ECDSA P-256 signature against RELEASE_PUBLIC_KEY below, refuses downgrades, caches the
// verified copy, and runs it. If GitHub is unreachable it runs the cached copy, but only after
// verifying that copy's signature again.
//
// Why: the main app holds your encryption keys. Without a signature check, anyone who could push
// to the GitHub repo (or tamper with the download) could ship code that reads them.
// This file is the trust anchor: it never updates itself. Re-install it by hand if you rotate keys.

const UPDATE_CONFIG = {
  // Set to the raw URL of the folder that holds pvtshiiiiii.js and pvtshiiiiii.js.sig on the new account.
  // Example: "https://raw.githubusercontent.com/<owner>/<repo>/main/"
  baseUrl: "https://raw.githubusercontent.com/romit-23/scriptable/main/",
  appFile: "pvtshiiiiii.js",
  sigFile: "pvtshiiiiii.js.sig",
  cacheApp: "pvtshiiiiii-app-cache.js",
  cacheSig: "pvtshiiiiii-app-cache.js.sig",
  requestTimeoutSeconds: 20,
  maxSourceBytes: 2 * 1024 * 1024,
};

// Raw uncompressed P-256 public key (65 bytes, base64). Written by `node tools/sign.mjs keygen`.
const RELEASE_PUBLIC_KEY = "BMTQ8UNWjjrt+6kjDi9gJusysnVhaUuQvD7RzAj93TAnWC8LEIvXAkCxnWBgz76YrO9HjSd7PJMT+kbkx2/kFj4=";

// ---- BEGIN VERIFIER ----
// Pure-JS SHA-256 + ECDSA P-256 (IEEE P1363 r||s) verification. Scriptable's JSContext has no
// WebCrypto. Verify-only: no secrets are handled here, so timing side channels do not matter.
const PVT_VERIFY = (() => {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function sha256(bytes) {
    const len = bytes.length;
    const total = Math.ceil((len + 9) / 64) * 64;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    const bits = len * 8;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(total - 4, bits >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = W[i - 15], b = W[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
    return out;
  }

  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function fromBase64(str) {
    const s = String(str).replace(/[\s=]/g, "");
    if (/[^A-Za-z0-9+/]/.test(s) || s.length % 4 === 1) throw new Error("bad base64");
    const out = new Uint8Array(Math.floor((s.length * 3) / 4));
    let buf = 0, bitsN = 0, j = 0;
    for (let i = 0; i < s.length; i++) {
      buf = (buf << 6) | B64.indexOf(s[i]);
      bitsN += 6;
      if (bitsN >= 8) { bitsN -= 8; out[j++] = (buf >> bitsN) & 0xff; }
    }
    return out.subarray(0, j);
  }

  const toBig = (bytes) => {
    let hex = "0x0";
    for (let i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return BigInt(hex);
  };

  // NIST P-256 domain parameters
  const P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
  const N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  const B = BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b");
  const GX = BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296");
  const GY = BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5");
  const Z0 = BigInt(0), Z1 = BigInt(1), Z2 = BigInt(2), Z3 = BigInt(3), Z4 = BigInt(4), Z8 = BigInt(8);

  const mod = (a, m) => { const r = a % m; return r < Z0 ? r + m : r; };
  function powMod(b, e, m) {
    let r = Z1; b = mod(b, m);
    while (e > Z0) { if (e & Z1) r = (r * b) % m; b = (b * b) % m; e >>= Z1; }
    return r;
  }
  const inv = (a, m) => powMod(a, m - Z2, m); // m is prime

  // Jacobian coordinates [X, Y, Z]; Z == 0 is the point at infinity. Curve a = -3.
  const INF = [Z0, Z1, Z0];
  function dbl(p) {
    const [X, Y, Z] = p;
    if (Z === Z0 || Y === Z0) return INF;
    const YY = (Y * Y) % P, ZZ = (Z * Z) % P;
    const S = (Z4 * X * YY) % P;
    const M = (Z3 * mod(X - ZZ, P) * ((X + ZZ) % P)) % P;
    const X3 = mod(M * M - Z2 * S, P);
    const Y3 = mod(M * mod(S - X3, P) - Z8 * ((YY * YY) % P), P);
    const Z3n = (Z2 * Y * Z) % P;
    return [X3, Y3, Z3n];
  }
  function add(p, q) {
    if (p[2] === Z0) return q;
    if (q[2] === Z0) return p;
    const [X1, Y1, Zp] = p, [X2, Y2, Zq] = q;
    const Z1Z1 = (Zp * Zp) % P, Z2Z2 = (Zq * Zq) % P;
    const U1 = (X1 * Z2Z2) % P, U2 = (X2 * Z1Z1) % P;
    const S1 = (Y1 * Zq * Z2Z2) % P, S2 = (Y2 * Zp * Z1Z1) % P;
    const H = mod(U2 - U1, P), R = mod(S2 - S1, P);
    if (H === Z0) return R === Z0 ? dbl(p) : INF;
    const HH = (H * H) % P, HHH = (H * HH) % P, V = (U1 * HH) % P;
    const X3 = mod(R * R - HHH - Z2 * V, P);
    const Y3 = mod(R * mod(V - X3, P) - S1 * HHH, P);
    const Z3n = (Zp * Zq * H) % P;
    return [X3, Y3, Z3n];
  }

  function verify(message, sigBytes, pubBytes) {
    try {
      if (!(message instanceof Uint8Array) || sigBytes.length !== 64 || pubBytes.length !== 65 || pubBytes[0] !== 4) return false;
      const qx = toBig(pubBytes.subarray(1, 33)), qy = toBig(pubBytes.subarray(33, 65));
      if (qx >= P || qy >= P) return false;
      if (mod(qy * qy - (qx * qx * qx - Z3 * qx + B), P) !== Z0) return false; // key must be on the curve
      const r = toBig(sigBytes.subarray(0, 32)), s = toBig(sigBytes.subarray(32, 64));
      if (r <= Z0 || r >= N || s <= Z0 || s >= N) return false;
      const e = toBig(sha256(message)); // 256-bit hash, no truncation needed for P-256
      const w = inv(s, N);
      const u1 = (e * w) % N, u2 = (r * w) % N;
      // Shamir's trick: u1*G + u2*Q in one pass
      const G = [GX, GY, Z1], Q = [qx, qy, Z1], GQ = add(G, Q);
      let R = INF;
      for (let i = 255; i >= 0; i--) {
        R = dbl(R);
        const b1 = (u1 >> BigInt(i)) & Z1, b2 = (u2 >> BigInt(i)) & Z1;
        if (b1 && b2) R = add(R, GQ); else if (b1) R = add(R, G); else if (b2) R = add(R, Q);
      }
      if (R[2] === Z0) return false;
      const zi = inv(R[2], P);
      const x = (R[0] * ((zi * zi) % P)) % P;
      return x % N === r;
    } catch (err) {
      return false;
    }
  }

  return { sha256, fromBase64, verify };
})();
// ---- END VERIFIER ----

function appVersion(source) {
  const line = source.split("\n").find((item) => item.startsWith("// APP_VERSION:"));
  return line ? line.slice("// APP_VERSION:".length).trim() : "0.0.0";
}

function compareVersions(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0), pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const fm = FileManager.local();
const cacheAppPath = fm.joinPath(fm.documentsDirectory(), UPDATE_CONFIG.cacheApp);
const cacheSigPath = fm.joinPath(fm.documentsDirectory(), UPDATE_CONFIG.cacheSig);

// Returns the verified source string, or throws.
function verifyRelease(data, sigText) {
  if (RELEASE_PUBLIC_KEY.indexOf("PASTE") === 0) throw new Error("RELEASE_PUBLIC_KEY is not set in the updater.");
  const b64 = data.toBase64String();
  const bytes = PVT_VERIFY.fromBase64(b64);
  if (bytes.length < 10000 || bytes.length > UPDATE_CONFIG.maxSourceBytes) throw new Error("Unexpected app size: " + bytes.length + " bytes.");
  let sig;
  try { sig = JSON.parse(sigText); } catch (e) { throw new Error("Signature file is not valid JSON."); }
  if (!sig || sig.alg !== "ES256" || typeof sig.sig !== "string") throw new Error("Signature file has the wrong format.");
  const ok = PVT_VERIFY.verify(bytes, PVT_VERIFY.fromBase64(sig.sig), PVT_VERIFY.fromBase64(RELEASE_PUBLIC_KEY));
  if (!ok) throw new Error("SIGNATURE CHECK FAILED. This app file was not signed by your release key. Not running it.");
  const source = data.toRawString();
  if (typeof source !== "string" || !source.includes("Script.complete();")) throw new Error("Verified file could not be decoded.");
  // Compile before caching or running, so a broken (but signed) build cannot replace a good cache.
  new Function("return (async function(){\n" + source + "\n}).call(this);");
  return source;
}

async function fetchData(name) {
  const req = new Request(UPDATE_CONFIG.baseUrl + name + "?cache_bust=" + Date.now());
  req.timeoutInterval = UPDATE_CONFIG.requestTimeoutSeconds;
  req.headers = { "Cache-Control": "no-cache", Pragma: "no-cache" };
  const data = await req.load();
  const code = req.response ? req.response.statusCode : 0;
  if (code !== 200) throw new Error("GitHub returned HTTP " + code + " for " + name + ".");
  return data;
}

function readCache() {
  if (!fm.fileExists(cacheAppPath) || !fm.fileExists(cacheSigPath)) return null;
  try {
    return verifyRelease(fm.read(cacheAppPath), fm.readString(cacheSigPath));
  } catch (e) {
    console.error("Cached app rejected: " + String(e));
    return null;
  }
}

async function main() {
  const cached = readCache();
  let source = null, label = "";

  if (UPDATE_CONFIG.baseUrl.indexOf("/OWNER/REPO/") !== -1) {
    console.error("pvtshiiiiii updater: set UPDATE_CONFIG.baseUrl to your new GitHub repo.");
  } else {
    try {
      const data = await fetchData(UPDATE_CONFIG.appFile);
      const sigData = await fetchData(UPDATE_CONFIG.sigFile);
      const sigText = sigData.toRawString();
      const fresh = verifyRelease(data, sigText);
      if (cached && compareVersions(appVersion(fresh), appVersion(cached)) < 0) {
        throw new Error("Refusing downgrade from " + appVersion(cached) + " to " + appVersion(fresh) + ".");
      }
      fm.write(cacheAppPath, data);
      fm.writeString(cacheSigPath, sigText);
      source = fresh;
      label = "GitHub";
    } catch (e) {
      console.error("pvtshiiiiii updater: update skipped: " + String(e));
    }
  }

  if (!source && cached) { source = cached; label = "verified cache"; }
  if (!source) {
    throw new Error(
      "No verified copy of pvtshiiiiii is available. Check UPDATE_CONFIG.baseUrl, your internet " +
      "connection, and that pvtshiiiiii.js and pvtshiiiiii.js.sig were pushed together."
    );
  }

  console.log("pvtshiiiiii updater: running " + label + " (" + appVersion(source) + ")");
  // The app uses top-level await; this wrapper allows it inside Scriptable.
  const run = new Function("return (async function(){\n" + source + "\n}).call(this);");
  await run();
}

await main();
