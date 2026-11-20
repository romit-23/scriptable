// Runs pvtshiiiiii-auto-updater.js end to end under a Scriptable shim (Request, FileManager, Data),
// with a throwaway test signing key, so the real release key is never needed here.
//   node tools/test-updater.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.error("  FAIL " + n + (x ? " :: " + x : "")); } };

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const testPub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64");
const otherKey = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;

let updater = fs.readFileSync(path.join(root, "pvtshiiiiii-auto-updater.js"), "utf8")
  .replace(/const RELEASE_PUBLIC_KEY = "[^"]*";/, `const RELEASE_PUBLIC_KEY = "${testPub}";`)
  .replace(/baseUrl: "[^"]*"/, 'baseUrl: "https://raw.example.test/o/r/main/"');

const app = (v) => Buffer.from(`// APP_VERSION: ${v}\n// pvtshiiiiii.js — Scriptable (iOS)\nglobalThis.__ran = "${v}";\n/* ${"x".repeat(12000)} */\nScript.complete();\n`, "utf8");
const sign = (buf, key = privateKey) => JSON.stringify({ alg: "ES256", sig: crypto.sign("sha256", buf, { key, dsaEncoding: "ieee-p1363" }).toString("base64") });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvt-upd-"));
const mkData = (buf) => ({ buf, toBase64String: () => buf.toString("base64"), toRawString: () => buf.toString("utf8") });
let remote = null; // { app: Buffer, sig: string } or "offline" or { status }
globalThis.Request = class {
  constructor(url) { this.url = url; this.response = null; }
  async load() {
    if (remote === "offline") throw new Error("The Internet connection appears to be offline.");
    const name = this.url.split("?")[0].split("/").pop();
    if (remote.status) { this.response = { statusCode: remote.status }; return mkData(Buffer.from("404: Not Found")); }
    this.response = { statusCode: 200 };
    return mkData(name.endsWith(".sig") ? Buffer.from(remote.sig) : remote.app);
  }
};
globalThis.FileManager = { local: () => ({
  documentsDirectory: () => dir, joinPath: (a, b) => path.join(a, b), fileExists: (p) => fs.existsSync(p),
  read: (p) => mkData(fs.readFileSync(p)), readString: (p) => fs.readFileSync(p, "utf8"),
  write: (p, d) => fs.writeFileSync(p, d.buf), writeString: (p, s) => fs.writeFileSync(p, s),
}) };
globalThis.Script = { complete: () => {} };

async function run() {
  globalThis.__ran = null;
  const logs = [];
  const orig = console.error; console.error = (m) => logs.push(String(m));
  try { await new AsyncFunction(updater)(); return { ran: globalThis.__ran, logs }; }
  catch (e) { return { ran: globalThis.__ran, error: e.message, logs }; }
  finally { console.error = orig; }
}

let r;
remote = { app: app("2.0.0"), sig: sign(app("2.0.0")) };
r = await run();
ok("valid signed release runs and is cached", r.ran === "2.0.0" && fs.existsSync(path.join(dir, "pvtshiiiiii-app-cache.js")), JSON.stringify(r));

const tampered = Buffer.from(app("2.0.1")); tampered[tampered.length - 30] ^= 1;
remote = { app: tampered, sig: sign(app("2.0.1")) };
r = await run();
ok("tampered download is refused, cached copy runs", r.ran === "2.0.0" && r.logs.some((l) => /SIGNATURE CHECK FAILED/.test(l)), JSON.stringify(r));

remote = { app: app("2.0.2"), sig: sign(app("2.0.2"), otherKey) };
r = await run();
ok("release signed by another key is refused", r.ran === "2.0.0" && r.logs.some((l) => /SIGNATURE CHECK FAILED/.test(l)));

remote = { app: app("1.9.0"), sig: sign(app("1.9.0")) };
r = await run();
ok("signed but older version is refused (no downgrade)", r.ran === "2.0.0" && r.logs.some((l) => /downgrade/.test(l)));

remote = { status: 404 };
r = await run();
ok("HTTP 404 falls back to the verified cache", r.ran === "2.0.0");

remote = "offline";
r = await run();
ok("offline runs the verified cache", r.ran === "2.0.0");

remote = { app: app("2.1.0"), sig: sign(app("2.1.0")) };
r = await run();
ok("newer signed release replaces the cache", r.ran === "2.1.0" && fs.readFileSync(path.join(dir, "pvtshiiiiii-app-cache.js"), "utf8").includes("2.1.0"));

const cachePath = path.join(dir, "pvtshiiiiii-app-cache.js");
fs.writeFileSync(cachePath, fs.readFileSync(cachePath, "utf8").replace('globalThis.__ran = "2.1.0"', 'globalThis.__ran = "EVIL!"'));
remote = "offline";
r = await run();
ok("tampered cache is refused (nothing runs)", r.ran === null && /No verified copy/.test(r.error || ""), JSON.stringify(r));

remote = { app: app("2.1.0"), sig: sign(app("2.1.0")) };
r = await run();
ok("recovers from a bad cache when online", r.ran === "2.1.0");

updater = updater.replace(/const RELEASE_PUBLIC_KEY = "[^"]*";/, 'const RELEASE_PUBLIC_KEY = "PASTE_PUBLIC_KEY_HERE";');
remote = { app: app("3.0.0"), sig: sign(app("3.0.0")) };
r = await run();
ok("missing public key never runs downloaded code", r.ran === null);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`updater: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
