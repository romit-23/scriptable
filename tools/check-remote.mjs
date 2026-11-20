// After pushing: confirms GitHub serves exactly the bytes you signed (catches CRLF/line-ending
// rewrites and forgotten .sig pushes, which would otherwise fail silently on the phones).
//   node tools/check-remote.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const updater = fs.readFileSync(path.join(root, "pvtshiiiiii-auto-updater.js"), "utf8");
const base = (updater.match(/baseUrl: "([^"]+)"/) || [])[1];
const pub = (updater.match(/const RELEASE_PUBLIC_KEY = "([^"]+)"/) || [])[1];
if (!base || base.includes("/OWNER/REPO/")) { console.error("Set UPDATE_CONFIG.baseUrl in the updater first."); process.exit(1); }

try {
  const get = async (n) => { const r = await fetch(base + n + "?cb=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw new Error(n + ": HTTP " + r.status); return Buffer.from(await r.arrayBuffer()); };
  const [app, sigBuf] = await Promise.all([get("pvtshiiiiii.js"), get("pvtshiiiiii.js.sig")]);
  const local = fs.readFileSync(path.join(root, "pvtshiiiiii.js"));
  const sig = JSON.parse(sigBuf.toString("utf8"));
  const raw = Buffer.from(pub, "base64");
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
  const valid = crypto.verify("sha256", app, { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig.sig, "base64"));
  console.log("remote matches local build:", app.equals(local));
  console.log("remote signature valid for the updater's key:", valid, "(version " + sig.version + ")");
  process.exit(valid ? 0 : 1);
} catch (e) {
  console.error("check failed: " + e.message);
  process.exit(1);
}
