// Release signing for pvtshiiiiii.
//   node tools/sign.mjs keygen   create the P-256 signing key (once) and write its public key into the updater
//   node tools/sign.mjs sign     sign pvtshiiiiii.js -> pvtshiiiiii.js.sig
//
// The private key lives OUTSIDE the repo at ~/.pvtshiiiiii/release-signing-key.pem (override with
// PVT_SIGNING_KEY). Never commit it. Anyone holding it can push code that both phones will run.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KEY_PATH = process.env.PVT_SIGNING_KEY || path.join(os.homedir(), ".pvtshiiiiii", "release-signing-key.pem");
const UPDATER = path.join(root, "pvtshiiiiii-auto-updater.js");
const APP = path.join(root, "pvtshiiiiii.js");

function rawPublicKey(keyObj) {
  const jwk = crypto.createPublicKey(keyObj).export({ format: "jwk" });
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64");
}

export function keygen() {
  if (fs.existsSync(KEY_PATH)) {
    console.log("Signing key already exists at " + KEY_PATH + " (not overwritten).");
  } else {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
    fs.writeFileSync(KEY_PATH, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
    console.log("Created signing key at " + KEY_PATH + ". Back it up somewhere safe and offline.");
  }
  const pub = rawPublicKey(crypto.createPrivateKey(fs.readFileSync(KEY_PATH)));
  const src = fs.readFileSync(UPDATER, "utf8");
  const next = src.replace(/const RELEASE_PUBLIC_KEY = "[^"]*";/, `const RELEASE_PUBLIC_KEY = "${pub}";`);
  if (next === src && !src.includes(pub)) throw new Error("Could not find RELEASE_PUBLIC_KEY in the updater.");
  fs.writeFileSync(UPDATER, next);
  console.log("Updater now trusts public key " + pub);
}

export function sign() {
  if (!fs.existsSync(KEY_PATH)) throw new Error("No signing key at " + KEY_PATH + ". Run: node tools/sign.mjs keygen");
  const key = crypto.createPrivateKey(fs.readFileSync(KEY_PATH));
  const updaterKey = (fs.readFileSync(UPDATER, "utf8").match(/const RELEASE_PUBLIC_KEY = "([^"]*)";/) || [])[1];
  if (updaterKey !== rawPublicKey(key)) throw new Error("The updater's RELEASE_PUBLIC_KEY does not match your signing key. Run keygen.");
  const bytes = fs.readFileSync(APP);
  const version = (bytes.toString("utf8").match(/^\/\/ APP_VERSION: (.+)$/m) || [])[1] || "unknown";
  const sig = crypto.sign("sha256", bytes, { key, dsaEncoding: "ieee-p1363" }).toString("base64");
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(APP + ".sig", JSON.stringify({ alg: "ES256", version, sha256: sha, sig }, null, 2) + "\n");
  console.log(`Signed pvtshiiiiii.js ${version} (sha256 ${sha.slice(0, 16)}…)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  try {
    if (cmd === "keygen") keygen();
    else if (cmd === "sign") sign();
    else { console.log("usage: node tools/sign.mjs keygen|sign"); process.exit(2); }
  } catch (e) {
    console.error("error: " + e.message);
    process.exit(1);
  }
}
