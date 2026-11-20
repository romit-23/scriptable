// Builds pvtshiiiiii.js from src/native.js + src/page.html, checks it, and signs it.
//   node tools/build.mjs            build + compat checks + sign (if a signing key exists)
//   node tools/build.mjs --no-sign  build + checks only
// Edit src/, never pvtshiiiiii.js directly: the page is embedded as a JSON string literal, so
// backticks, ${ and backslashes in the page cannot corrupt the generated script.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sign, KEY_PATH } from "./sign.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = fs.readFileSync(path.join(root, "src", "page.html"), "utf8");
const native = fs.readFileSync(path.join(root, "src", "native.js"), "utf8");

if (!native.includes("__PAGE__")) throw new Error("src/native.js is missing the __PAGE__ placeholder");
for (const ph of ["__INIT__", "__NONCE__", "__CONNECT__"]) {
  if (!page.includes(ph)) throw new Error("src/page.html is missing " + ph);
}
// Do not use Function-replacement-pattern pitfalls: pass a function so "$&" etc. stay literal.
const out = native.replace("__PAGE__", () => JSON.stringify(page));
const outPath = path.join(root, "pvtshiiiiii.js");
fs.writeFileSync(outPath, out.replace(/\r\n/g, "\n"));

// ---- Checks ----
const built = fs.readFileSync(outPath, "utf8");
const problems = [];
// 1. The updater that is still installed on the phones (v1) must accept this file.
if (built.length < 10000) problems.push("v1 updater: file smaller than 10000 chars");
if (!built.includes("// pvtshiiiiii.js — Scriptable (iOS)")) problems.push("v1 updater: missing app marker line");
if (!built.includes("Script.complete();")) problems.push("v1 updater: missing Script.complete();");
if (/const RESET_ALL = true/.test(built)) problems.push("RESET_ALL is true: shipping this would wipe both phones");
if (built.includes("scripts i ran on supabase :")) problems.push("v1 updater: contains SQL marker text");
try { new Function("return (async function(){\n" + built + "\n}).call(this);"); }
catch (e) { problems.push("does not compile inside the async wrapper: " + e.message); }
// 2. The page script itself must parse.
const m = page.match(/<script nonce="__NONCE__">([\s\S]*?)<\/script>/);
if (!m) problems.push("page script block not found");
else {
  try { new Function(m[1].replace("__INIT__", "{}")); }
  catch (e) { problems.push("page script does not parse: " + e.message); }
}
// 3. No inline event handlers (blocked by the CSP nonce).
if (/\son[a-z]+\s*=\s*["']/i.test(page)) problems.push("page contains inline on* handlers (CSP would block them)");

if (problems.length) {
  console.error("BUILD CHECKS FAILED:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log(`Built pvtshiiiiii.js (${(built.length / 1024).toFixed(1)} KB), checks passed.`);

if (!process.argv.includes("--no-sign")) {
  if (fs.existsSync(KEY_PATH)) sign();
  else console.log("No signing key at " + KEY_PATH + ": run `node tools/sign.mjs keygen`, then build again.");
}
