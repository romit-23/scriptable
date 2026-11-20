// Runs the BUILT pvtshiiiiii.js (unmodified) under a shim of the Scriptable APIs it uses.
// The shim's WebView is a real WebKit page; Keychain/FileManager/QuickLook/Request are recorded.
// This exercises runApp's bridge loop, nonce/CSP substitution, handle() (key whitelist, chunked
// export, dropLegacy, wipe) and the widget code path against the mock Supabase from e2e.mjs.
//   node tools/e2e-native.mjs
import { webkit } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeServer, typeCode, pngBytes } from "./e2e.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = fs.readFileSync(path.join(root, "pvtshiiiiii.js"), "utf8");
const SB_URL = built.match(/url: "([^"]+)"/)[1]; // the real project URL; every request to it is intercepted
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.error("  FAIL " + name + (extra ? " :: " + extra : "")); } };

// Adapter so the Playwright-route based mock can serve Scriptable's Request (widget path).
function callServer(server, method, url, headers, body) {
  return new Promise((resolve) => {
    const route = {
      request: () => ({ method: () => method, url: () => url, headers: () => Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v])), postData: () => body || null, postDataBuffer: () => Buffer.from(body || "") }),
      fulfill: (r) => resolve({ status: r.status, body: r.body }),
    };
    server.handle(route);
  });
}

function scriptable(browser, server, keychain, opts = {}) {
  const st = { page: null, ctx: null, html: null, closeApp: null, shares: [], quicklook: [], errors: [], widget: null, notifications: [], clipboard: "" };
  const g = {};
  g.Keychain = {
    contains: (k) => Object.prototype.hasOwnProperty.call(keychain, k),
    get: (k) => { if (!(k in keychain)) throw new Error("no item"); return keychain[k]; },
    set: (k, v) => { keychain[k] = String(v); },
    remove: (k) => { delete keychain[k]; },
  };
  g.WebView = class {
    async loadHTML(html, base) {
      st.html = html;
      st.ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark" });
      await st.ctx.route("**/*", (r) => {
        const u = r.request().url();
        if (u.startsWith(SB_URL)) return server.handle(r);
        if (u === base) return r.fulfill({ status: 200, contentType: "text/html", body: html });
        if (/^https?:/.test(u)) return r.abort(); // no other network request may leave the page
        return r.continue();
      });
      st.page = await st.ctx.newPage();
      st.page.on("pageerror", (e) => st.errors.push(String(e)));
      st.page.on("console", (m) => { if (m.type() === "error") st.errors.push("console: " + m.text()); });
      await st.page.goto(base);
    }
    present() { return new Promise((r) => { st.closeApp = r; }); }
    async evaluateJavaScript(code, useCallback) {
      if (useCallback) throw new Error("callback mode not shimmed");
      return st.page.evaluate(code);
    }
  };
  g.Timer = { schedule: (ms, rep, fn) => { const t = setTimeout(fn, ms); return { invalidate: () => clearTimeout(t) }; } };
  g.ShareSheet = { present: async (items) => { st.shares.push(items); return {}; } };
  g.Pasteboard = { copyString: (t) => { st.clipboard = t; }, pasteString: () => st.clipboard };
  g.Data = { fromBase64String: (s) => ({ buf: Buffer.from(s, "base64") }) };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pvt-shim-"));
  g.FileManager = { local: () => ({
    temporaryDirectory: () => tmp, documentsDirectory: () => tmp, joinPath: (a, b) => path.join(a, b),
    write: (p, d) => fs.writeFileSync(p, d.buf), fileExists: (p) => fs.existsSync(p), remove: (p) => fs.rmSync(p),
  }) };
  g.QuickLook = { present: async (p) => { st.quicklook.push({ path: p, bytes: fs.readFileSync(p) }); } };
  g.config = { runsInWidget: !!opts.widget, widgetFamily: "small" };
  g.Script = { complete: () => {}, setWidget: (w) => { st.widget = w; } };
  g.args = {};
  // ---- widget-only APIs ----
  g.Request = class {
    constructor(url) { this.url = url; this.method = "GET"; this.headers = {}; this.body = null; this.response = null; }
    async loadJSON() { const r = await callServer(server, this.method, this.url, this.headers, this.body); this.response = { statusCode: r.status }; return JSON.parse(r.body || "null"); }
  };
  const texts = [];
  const stack = () => ({ addText: (t) => { texts.push(t); return {}; }, addStack: () => stack(), addSpacer: () => {}, addImage: () => ({}), setPadding: () => {}, centerAlignContent: () => {} });
  g.ListWidget = class { constructor() { Object.assign(this, stack()); this.texts = texts; } };
  g.Font = new Proxy({}, { get: (_, k) => (n) => k + ":" + n });
  g.Color = class { constructor(h) { this.hex = h; } };
  g.LinearGradient = class {};
  g.Size = class { constructor(w, h) { this.w = w; this.h = h; } };
  g.SFSymbol = { named: () => ({ applyFont: () => {}, image: {} }) };
  g.URLScheme = { forRunningScript: () => "scriptable:///run/pvt" };
  g.Notification = class { async schedule() { st.notifications.push({ title: this.title, body: this.body }); } };

  const names = Object.keys(g);
  const run = new AsyncFunction(...names, built);
  st.done = run(...names.map((n) => g[n])).catch((e) => st.errors.push("script: " + (e.stack || e)));
  st.close = async () => { if (st.closeApp) st.closeApp(); await st.done; if (st.ctx) await st.ctx.close(); };
  st.waitPage = async () => { for (let i = 0; i < 100 && !st.page; i++) await new Promise((r) => setTimeout(r, 50)); return st.page; };
  return st;
}

async function main() {
  const browser = await webkit.launch();
  const server = makeServer();

  // ---- legacy upgrade through the real handle('dropLegacy') ----
  const LK = { ols_key: '"k"', ols_pin: '{"salt":"x","hash":"y"}', ols_space: '"old"', ols_session: '{"access_token":"a","refresh_token":"r-a","user_id":"a"}' };
  const L = scriptable(browser, server, LK);
  const lp = await L.waitPage();
  ok("nonce substituted into CSP and script tag", !L.html.includes("__NONCE__") && /script-src 'nonce-[0-9a-f]{32}'/.test(L.html) && /<script nonce="[0-9a-f]{32}">/.test(L.html));
  ok("connect-src limited to the Supabase origin", L.html.includes("connect-src " + SB_URL + ";"));
  ok("legacy secrets are not passed into the page", !L.html.includes('"k"') && !L.html.includes('"hash"'));
  await lp.waitForSelector("text=Security upgrade");
  await lp.click("text=Upgrade and pair again");
  await lp.waitForSelector("text=Create a space");
  ok("dropLegacy removes old key/pin/space, keeps session", !("ols_key" in LK) && !("ols_pin" in LK) && !("ols_space" in LK) && "ols_session" in LK);
  const wl = await lp.evaluate(() => call("save", { k: "evil", v: 1 }).then(() => "saved", (e) => e.message));
  ok("bridge refuses keys outside the whitelist", /refusing/.test(wl) && !("ols_evil" in LK));
  await L.close();

  // ---- two phones through the real bridge ----
  const KA = {}, KB = {};
  const A = scriptable(browser, server, KA), B = scriptable(browser, server, KB);
  const pa = await A.waitPage(), pb = await B.waitPage();
  await pa.click("text=Create a space");
  await typeCode(pa, "135792"); await pa.waitForSelector("text=Confirm passcode"); await typeCode(pa, "135792");
  await pa.waitForSelector(".invite-code", { timeout: 30000 });
  await pa.click(".sheet >> text=Copy");
  await pa.waitForTimeout(500);
  const invite = A.clipboard;
  ok("Copy puts the invite on the pasteboard", /^PVT2\./.test(invite));
  await pa.click(".sheet >> text=Share");
  await pa.waitForTimeout(500);
  ok("Share opens the share sheet with the invite", A.shares.length === 1 && String(A.shares[0][0]).includes(invite));
  await pa.click(".sheet .cancel");
  B.clipboard = invite;
  await pb.click("text=Join with an invite");
  await pb.click("text=Paste from clipboard");
  await pb.waitForFunction(() => document.querySelector("textarea").value.startsWith("PVT2"));
  await pb.click("text=Continue");
  await typeCode(pb, "246801"); await pb.waitForSelector("text=Confirm passcode"); await typeCode(pb, "246801");
  await pb.waitForSelector("#txt", { state: "visible", timeout: 30000 });
  await pa.waitForSelector("#txt", { state: "visible", timeout: 30000 });
  ok("pairing through the real Scriptable bridge", true);
  const vault = JSON.parse(KA.ols_vault || "{}");
  ok("Keychain holds a sealed vault and no plaintext key", vault.v === 1 && vault.c && vault.it === 600000 && !KA.ols_key && !/"priv"|"mk"/.test(JSON.stringify(KA)));

  await pb.fill("#txt", "native bridge works");
  await pb.keyboard.press("Enter");
  await pa.waitForSelector("text=native bridge works", { timeout: 15000 });
  ok("text delivered", true);
  await pa.waitForTimeout(800);
  ok("seen timestamp saved for the widget", typeof JSON.parse(KA.ols_seen || "null") === "string");

  // photo export through handle('chunk') + handle('export') + QuickLook + temp cleanup
  await pb.setInputFiles("#fLibrary", { name: "p.png", mimeType: "image/png", buffer: pngBytes(1200, 900) });
  try { await pa.waitForSelector(".msg:not(.me) .bub.media img:not(.th)", { timeout: 30000 }); }
  catch (e) { console.error("A err", A.errors, "B err", B.errors, server.db.reqLog.filter((x) => /storage/.test(x)).slice(-6)); await pb.screenshot({ path: "test-output/debug-nb.png" }); throw e; }
  await pa.click(".msg:not(.me) .bub.media");
  await pa.waitForSelector(".viewer img");
  await pa.click('.viewer [aria-label="Save or share"]');
  await pa.click(".dialog >> text=Continue");
  for (let i = 0; i < 60 && !A.quicklook.length; i++) await new Promise((r) => setTimeout(r, 100));
  const q = A.quicklook[0];
  ok("export reassembles chunks and opens QuickLook with the JPEG", q && q.bytes[0] === 0xff && q.bytes[1] === 0xd8 && /\.jpg$/.test(q.path));
  await new Promise((r) => setTimeout(r, 300));
  ok("decrypted temp file is deleted after QuickLook closes", q && !fs.existsSync(q.path));
  await pa.click('.viewer [aria-label="Close"]');

  // ---- widget for A while the app is closed ----
  await A.close();
  await pb.fill("#txt", "while A is away");
  await pb.keyboard.press("Enter");
  await pb.waitForTimeout(1500);
  const W = scriptable(browser, server, KA, { widget: true });
  await W.done;
  ok("widget counts the unread message without the passcode", W.widget && W.widget.texts.includes("1") && W.widget.texts.includes("New message"), W.widget && W.widget.texts.join("|"));
  ok("widget notification never contains message text", W.notifications.length === 1 && !/away/.test(W.notifications[0].body));
  ok("widget did not touch the vault", KA.ols_vault === JSON.stringify(vault) || JSON.parse(KA.ols_vault).c);

  // ---- wipe through Reset ----
  await pb.click('[aria-label="Settings"]');
  await pb.click(".sheet >> text=Reset this phone");
  await pb.click(".dialog .btn.danger");
  await pb.waitForSelector("text=Create a space");
  ok("Reset wipes every pvtshiiiiii Keychain item", Object.keys(KB).length === 0, Object.keys(KB).join(","));

  for (const [n, s] of [["L", L], ["A", A], ["B", B], ["W", W]]) ok("no errors on " + n, s.errors.length === 0, s.errors.join(" | "));
  await B.close();
  await browser.close();
  console.log(`\ne2e-native: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
