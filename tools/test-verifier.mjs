// Cross-checks the updater's pure-JS SHA-256 + ECDSA P-256 verifier against Node's crypto.
// Run: node tools/test-verifier.mjs
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "pvtshiiiiii-auto-updater.js"), "utf8");
const block = src.slice(src.indexOf("// ---- BEGIN VERIFIER ----"), src.indexOf("// ---- END VERIFIER ----"));
if (!block) throw new Error("verifier block not found");
const V = new Function(block + "\nreturn PVT_VERIFY;")();

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.error("FAIL: " + name); } };

// SHA-256 against Node for many lengths (padding edge cases at 55/56/63/64 bytes)
for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 100003]) {
  const m = crypto.randomBytes(n);
  check("sha256 len " + n, Buffer.from(V.sha256(new Uint8Array(m))).equals(crypto.createHash("sha256").update(m).digest()));
}

// base64
for (const n of [0, 1, 2, 3, 64, 65]) {
  const b = crypto.randomBytes(n);
  check("b64 " + n, Buffer.from(V.fromBase64(b.toString("base64"))).equals(b));
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const pub = new Uint8Array(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
const otherPub = new Uint8Array(Buffer.concat([Buffer.from([4]), Buffer.from(other.x, "base64url"), Buffer.from(other.y, "base64url")]));

const t0 = Date.now();
const N = 40;
for (let i = 0; i < N; i++) {
  const msg = new Uint8Array(crypto.randomBytes(1 + Math.floor(Math.random() * 5000)));
  const sig = new Uint8Array(crypto.sign("sha256", msg, { key: privateKey, dsaEncoding: "ieee-p1363" }));
  check("valid sig " + i, V.verify(msg, sig, pub) === true);
  const tm = msg.slice(); tm[Math.floor(Math.random() * tm.length)] ^= 1;
  check("tampered msg " + i, V.verify(tm, sig, pub) === false);
  const ts = sig.slice(); ts[Math.floor(Math.random() * 64)] ^= 0x10;
  check("tampered sig " + i, V.verify(msg, ts, pub) === false);
  check("wrong key " + i, V.verify(msg, sig, otherPub) === false);
}
const ms = (Date.now() - t0) / (N * 4);

// Malformed inputs must return false, never throw
const msg = new Uint8Array([1, 2, 3]);
const good = new Uint8Array(crypto.sign("sha256", msg, { key: privateKey, dsaEncoding: "ieee-p1363" }));
check("r = 0", V.verify(msg, new Uint8Array(64).fill(0, 0, 32).map((v, i) => (i < 32 ? 0 : good[i])), pub) === false);
check("s = 0", V.verify(msg, good.map((v, i) => (i < 32 ? v : 0)), pub) === false);
check("r = n", V.verify(msg, Uint8Array.from([...Buffer.from("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", "hex"), ...good.slice(32)]), pub) === false);
check("short sig", V.verify(msg, good.slice(0, 63), pub) === false);
check("DER sig rejected", V.verify(msg, new Uint8Array(crypto.sign("sha256", msg, privateKey)), pub) === false);
check("off-curve key", V.verify(msg, good, pub.map((v, i) => (i === 64 ? v ^ 1 : v))) === false);
check("compressed key", V.verify(msg, good, new Uint8Array(33)) === false);
check("high-s (malleated) still verifies like Node", (() => {
  const n = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  const s = BigInt("0x" + Buffer.from(good.slice(32)).toString("hex"));
  const s2 = Buffer.from((n - s).toString(16).padStart(64, "0"), "hex");
  const mal = Uint8Array.from([...good.slice(0, 32), ...s2]);
  const nodeSays = crypto.verify("sha256", msg, { key: publicKey, dsaEncoding: "ieee-p1363" }, mal);
  return V.verify(msg, mal, pub) === nodeSays;
})());
let threw = false;
try { V.verify("nope", good, pub); V.verify(msg, "x", pub); } catch (e) { threw = true; }
check("never throws", !threw);

console.log(`verifier: ${pass} passed, ${fail} failed, ~${ms.toFixed(1)} ms per verify in Node`);
process.exit(fail ? 1 : 0);
