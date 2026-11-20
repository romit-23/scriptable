// End-to-end test of the WebView page: two "phones" against an in-memory mock of the Supabase
// schema (RLS-equivalent checks included) and a mock of the Scriptable bridge.
//   node tools/e2e.mjs              WebKit (iOS engine) for pairing/text/photo/tamper, Chromium for voice
// Screenshots land in test-output/.
import { webkit, chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "test-output");
fs.mkdirSync(OUT, { recursive: true });
const SB = "https://mock.supabase.test";
const PAGE_URL = "https://pvtshiiiiii.local/";
const pageSrc = fs.readFileSync(path.join(root, "src", "page.html"), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.error("  FAIL " + name + (extra ? " :: " + extra : "")); } };

/* ---------------- mock Supabase ---------------- */
export function makeServer() {
  const db = { users: new Map(), spaces: new Set(), members: [], invites: new Map(), messages: [], handshakes: new Map(), objects: new Map(), reqLog: [], tokenTtl: 3600 };
  const uid = () => crypto.randomUUID();
  const token = (sub) => { const h = Buffer.from('{"alg":"none"}').toString("base64url"); const p = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + db.tokenTtl })).toString("base64url"); return h + "." + p + ".x"; };
  const userOf = (req) => { const a = req.headers()["authorization"] || ""; try { return JSON.parse(Buffer.from(a.split(" ")[1].split(".")[1], "base64url").toString()).sub; } catch (e) { return null; } };
  const isMember = (sid, u) => db.members.some((m) => m.space_id === sid && m.user_id === u);
  const code = () => crypto.randomBytes(5).toString("hex").toUpperCase();
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: cors(), body: JSON.stringify(body) });
  const cors = () => ({ "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });

  async function handle(route) {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    const url = new URL(req.url());
    const p = url.pathname, q = url.searchParams, u = userOf(req);
    const body = () => { try { return JSON.parse(req.postData() || "{}"); } catch (e) { return {}; } };
    db.reqLog.push(req.method() + " " + p);

    if (p === "/auth/v1/signup") { const id = uid(); db.users.set(id, 1); return json(route, 200, { access_token: token(id), refresh_token: "r-" + id, user: { id } }); }
    if (p === "/auth/v1/token") { const id = body().refresh_token.slice(2); return json(route, 200, { access_token: token(id), refresh_token: "r-" + id }); }
    if (!u) return json(route, 401, { message: "JWT required" });

    if (p === "/rest/v1/rpc/create_space") {
      const sid = uid(); db.spaces.add(sid); db.members.push({ space_id: sid, user_id: u });
      const c = code(); db.invites.set(c, { space_id: sid, exp: Date.now() + 6e5, used: false });
      return json(route, 200, { space_id: sid, code: c });
    }
    if (p === "/rest/v1/rpc/new_invite") {
      const sid = body().p_space;
      if (!isMember(sid, u)) return json(route, 400, { message: "not a member" });
      if (db.members.filter((m) => m.space_id === sid).length >= 2) return json(route, 400, { message: "space is already full" });
      const c = code(); db.invites.set(c, { space_id: sid, exp: Date.now() + 6e5, used: false });
      return json(route, 200, c);
    }
    if (p === "/rest/v1/rpc/join_space") {
      const inv = db.invites.get(String(body().p_code).toUpperCase());
      if (!inv || inv.used || inv.exp < Date.now()) return json(route, 400, { message: "invalid or expired invite" });
      if (db.members.filter((m) => m.space_id === inv.space_id).length >= 2) return json(route, 400, { message: "space is already full" });
      db.members.push({ space_id: inv.space_id, user_id: u }); inv.used = true;
      return json(route, 200, inv.space_id);
    }
    if (p === "/rest/v1/rpc/publish_key") {
      const b = body();
      if (!isMember(b.p_space, u)) return json(route, 400, { message: "not a member" });
      db.handshakes.set(b.p_space + "|" + u, { space_id: b.p_space, user_id: u, payload: b.p_payload });
      return json(route, 200, null);
    }
    const eq = (k) => (q.get(k) || "").replace(/^eq\./, "");
    if (p === "/rest/v1/handshakes") {
      const sid = eq("space_id");
      return json(route, 200, [...db.handshakes.values()].filter((h) => h.space_id === sid && isMember(sid, u)));
    }
    if (p === "/rest/v1/members") {
      const sid = eq("space_id");
      return json(route, 200, isMember(sid, u) ? db.members.filter((m) => m.space_id === sid).map((m) => ({ user_id: m.user_id })) : []);
    }
    if (p === "/rest/v1/messages" && req.method() === "POST") {
      const b = body();
      if (!isMember(b.space_id, u)) return json(route, 403, { message: "new row violates row-level security policy" });
      if (!["text", "image", "video", "voice"].includes(b.message_type)) return json(route, 400, { message: "check constraint" });
      const row = { id: uid(), space_id: b.space_id, sender_id: u, message_type: b.message_type, ciphertext: b.ciphertext, created_at: new Date().toISOString().replace("Z", "123+00:00"), expires_at: b.expires_at };
      db.messages.push(row);
      return json(route, 201, [row]);
    }
    if (p === "/rest/v1/messages") {
      const sid = eq("space_id");
      if (!isMember(sid, u)) return json(route, 200, []);
      let rows = db.messages.filter((m) => m.space_id === sid && Date.parse(m.expires_at) > Date.now());
      const ca = q.get("created_at");
      if (ca && ca.startsWith("gte.")) rows = rows.filter((m) => Date.parse(m.created_at) >= Date.parse(ca.slice(4)));
      if (ca && ca.startsWith("gt.")) rows = rows.filter((m) => Date.parse(m.created_at) > Date.parse(ca.slice(3)));
      const sn = q.get("sender_id");
      if (sn && sn.startsWith("neq.")) rows = rows.filter((m) => m.sender_id !== sn.slice(4));
      rows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      if ((q.get("order") || "").endsWith("desc")) rows.reverse();
      return json(route, 200, rows.slice(0, +(q.get("limit") || 1000)));
    }
    if (p.startsWith("/storage/v1/object/list/pvt-media")) {
      const prefix = body().prefix || "";
      if (!isMember(prefix, u)) return json(route, 200, []);
      return json(route, 200, [...db.objects.entries()].filter(([k]) => k.startsWith(prefix + "/")).map(([k, o]) => ({ name: k.slice(prefix.length + 1), created_at: new Date(o.created).toISOString() })));
    }
    if (p === "/storage/v1/object/pvt-media" && req.method() === "DELETE") {
      const del = [];
      for (const k of body().prefixes || []) { const o = db.objects.get(k); if (o && isMember(k.split("/")[0], u) && (o.owner === u || Date.now() - o.created > 864e5)) { db.objects.delete(k); del.push(k); } }
      db.deleted = (db.deleted || []).concat(del);
      return json(route, 200, del.map((name) => ({ name })));
    }
    if (p.startsWith("/storage/v1/object/authenticated/pvt-media/")) {
      const name = p.slice("/storage/v1/object/authenticated/pvt-media/".length);
      if (!isMember(name.split("/")[0], u)) return json(route, 400, { message: "Object not found" });
      const o = db.objects.get(name);
      if (!o) return json(route, 400, { message: "Object not found" });
      return route.fulfill({ status: 200, headers: Object.assign(cors(), { "content-type": "application/octet-stream" }), body: o.buf });
    }
    if (p.startsWith("/storage/v1/object/pvt-media/") && req.method() === "POST") {
      const name = p.slice("/storage/v1/object/pvt-media/".length);
      if (!isMember(name.split("/")[0], u)) return json(route, 403, { message: "new row violates row-level security policy" });
      if ((req.headers()["content-type"] || "") !== "application/octet-stream") return json(route, 415, { message: "mime type not allowed" });
      const buf = req.postDataBuffer(); if (!buf || !buf.length) return json(route, 400, { message: "mock: empty body" });
      db.objects.set(name, { buf, owner: u, created: Date.now() });
      return json(route, 200, { Key: "pvt-media/" + name });
    }
    return json(route, 404, { message: "mock: no route " + req.method() + " " + p });
  }
  return { db, handle };
}

/* ---------------- a "phone": browser context + page + bridge loop ---------------- */
async function phone(browser, server, name, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: opts.scheme || "dark" }, opts.ctx || {}));
  const keychain = opts.keychain || {};
  let clipboard = "";
  const init = { cfg: { url: SB, key: "sb_publishable_test" }, store: Object.assign({}, keychain), legacy: !!opts.legacy, version: "2.0.0" };
  const html = pageSrc.replace(/__NONCE__/g, "testnonce").replace("__CONNECT__", SB).replace("__INIT__", JSON.stringify(init).split("<").join("\\u003c"));
  await ctx.route(SB + "/**", server.handle);
  await ctx.route(PAGE_URL, (r) => r.fulfill({ status: 200, contentType: "text/html", body: html }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(PAGE_URL);
  let alive = true; const exports = [];
  (async () => {
    while (alive) {
      try {
        const raw = await page.evaluate(() => (window.__drain ? window.__drain() : "[]"));
        const xfer = {};
        for (const r of JSON.parse(raw)) {
          let err = null, val = null;
          if (r.t === "save") { if (r.v == null) delete keychain[r.k]; else keychain[r.k] = JSON.parse(JSON.stringify(r.v)); }
          else if (r.t === "load") val = keychain[r.k] ?? null;
          else if (r.t === "wipe" || r.t === "dropLegacy") { for (const k of Object.keys(keychain)) if (r.t === "wipe" || k === "space") delete keychain[k]; }
          else if (r.t === "copy") clipboard = r.text;
          else if (r.t === "paste") val = clipboard;
          else if (r.t === "share") clipboard = r.text;
          else if (r.t === "chunk") (phone.x[r.x] = phone.x[r.x] || []).push(r.d);
          else if (r.t === "export") { exports.push(Buffer.from((phone.x[r.x] || []).join(""), "base64")); delete phone.x[r.x]; }
          else err = "unknown " + r.t;
          if (r.id) await page.evaluate(([id, e, v]) => window.__ack(id, e, v), [r.id, err, val]);
        }
      } catch (e) { if (alive) await new Promise((r) => setTimeout(r, 50)); }
      await new Promise((r) => setTimeout(r, 40));
    }
  })();
  return { name, ctx, page, keychain, errors, exports, setClipboard: (t) => { clipboard = t; }, close: async () => { alive = false; await ctx.close(); } };
}
phone.x = {};

async function typeCode(page, code) {
  for (const d of code) await page.click(`.keypad .key[aria-label="${d}"]`);
}
const shot = (p, n) => p.page.screenshot({ path: path.join(OUT, n + ".png") });

function pngBytes(w, h) {
  // tiny valid PNG with a gradient, built by hand so the test needs no image library
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w) | 0; raw[o + 1] = (y * 255 / h) | 0; raw[o + 2] = 160; } }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function pairPhones(browser, server, schemeB) {
  const A = await phone(browser, server, "A");
  const B = await phone(browser, server, "B", { scheme: schemeB });
  await A.page.click("text=Create a space");
  await typeCode(A.page, "135792"); await A.page.waitForSelector("text=Confirm passcode"); await typeCode(A.page, "135792");
  try { await A.page.waitForSelector(".invite-code", { timeout: 20000 }); }
  catch (e) { await shot(A, "debug-A"); console.error("A errors:", A.errors, "req:", server.db.reqLog.slice(-15), "text:", (await A.page.textContent("body")).slice(0, 400)); throw e; }
  const invite = await A.page.textContent(".invite-code");
  await A.page.waitForTimeout(400); await shot(A, "11-invite-sheet");
  await B.page.click("text=Join with an invite");
  B.setClipboard(invite);
  await B.page.click("text=Paste from clipboard");
  await B.page.waitForFunction(() => document.querySelector("textarea").value.startsWith("PVT2"));
  await B.page.click("text=Continue");
  await typeCode(B.page, "246801"); await B.page.waitForSelector("text=Confirm passcode"); await typeCode(B.page, "246801");
  await B.page.waitForSelector("#txt", { state: "visible", timeout: 20000 });
  await A.page.click(".sheet .cancel");
  await A.page.waitForSelector("#txt", { state: "visible", timeout: 20000 });
  return { A, B, invite };
}

async function main() {
  /* ======== WebKit: pairing, text, photo, tamper, lock, screenshots ======== */
  console.log("WebKit");
  const wk = await webkit.launch();
  const server = makeServer();

  const W = await phone(wk, server, "W");
  await W.page.waitForTimeout(500); await shot(W, "01-welcome-dark");
  await W.close();
  const WL = await phone(wk, server, "WL", { scheme: "light" });
  await WL.page.waitForTimeout(500); await shot(WL, "02-welcome-light");
  await WL.close();
  const LG = await phone(wk, server, "LG", { legacy: true, keychain: { session: { access_token: "x", refresh_token: "r-x", user_id: "x" }, space: "old" } });
  ok("legacy install shows the upgrade screen", await LG.page.isVisible("text=Security upgrade"));
  await shot(LG, "03-upgrade");
  await LG.page.click("text=Upgrade and pair again");
  await LG.page.waitForSelector("text=Create a space");
  ok("upgrade drops the old space from the keychain", !("space" in LG.keychain));
  await LG.close();

  const t0 = Date.now();
  const { A, B, invite } = await pairPhones(wk, server, "light");
  ok("pairing completes on both phones (" + (Date.now() - t0) + " ms)", true);
  ok("invite carries no message key (PVT2.code.fp.secret)", /^PVT2\.[A-F0-9]{10}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/.test(invite.trim()), invite);
  ok("vault is sealed (no plaintext keys in keychain)", !JSON.stringify(A.keychain).includes('"d"') && A.keychain.vault && A.keychain.vault.c && !("key" in A.keychain));

  await A.page.fill("#txt", "hello from A — \u{1F510} <b>not html</b>");
  await A.page.keyboard.press("Enter");
  await B.page.waitForSelector("text=hello from A", { timeout: 10000 });
  ok("B decrypts A's text", true);
  ok("HTML in messages is shown as text", (await B.page.locator(".msg:not(.me) .bub").first().innerHTML()).includes("&lt;b&gt;"));
  await B.page.fill("#txt", "hi A, B here");
  await B.page.click("#act");
  await A.page.waitForSelector("text=hi A, B here", { timeout: 10000 });
  ok("A decrypts B's text", true);
  ok("server only sees ciphertext", server.db.messages.every((m) => m.ciphertext.startsWith("v2.") && !m.ciphertext.includes("hello") && m.message_type === "text"));

  // photo
  const png = pngBytes(640, 480);
  await A.page.setInputFiles("#fLibrary", { name: "test.png", mimeType: "image/png", buffer: png });
  try { await B.page.waitForSelector(".msg:not(.me) .bub.media img:not(.th)", { timeout: 20000 }); }
  catch (e) { await shot(A, "debug-A"); await shot(B, "debug-B"); console.error("A:", A.errors, "B:", B.errors, "req:", server.db.reqLog.filter(x=>!/messages|members/.test(x)).slice(-12), "objs:", server.db.objects.size); throw e; }
  ok("B receives and decrypts the photo", true);
  const obj = [...server.db.objects.values()][0].buf;
  ok("stored photo is ciphertext (not PNG/JPEG)", obj && obj[0] !== 0x89 && !(obj[0] === 0xff && obj[1] === 0xd8));
  await B.page.click(".msg:not(.me) .bub.media");
  await B.page.waitForSelector(".viewer img");
  await shot(B, "06-viewer-light");
  await B.page.click('.viewer [aria-label="Save or share"]');
  await B.page.click(".dialog >> text=Continue");
  await new Promise((r) => setTimeout(r, 1500));
  ok("export hands a decoded JPEG to Scriptable", B.exports.length === 1 && B.exports[0][0] === 0xff && B.exports[0][1] === 0xd8);
  await B.page.click('.viewer [aria-label="Close"]');

  // video
  const fakeVideo = Buffer.concat([Buffer.from("....ftypisom"), crypto.randomBytes(300000)]);
  await B.page.setInputFiles("#fLibrary", { name: "clip.mp4", mimeType: "video/mp4", buffer: fakeVideo });
  await A.page.waitForSelector(".msg:not(.me) .bub.media .play", { timeout: 20000 });
  await A.page.click(".msg:not(.me) .bub.media >> nth=-1");
  await A.page.waitForSelector(".viewer video", { timeout: 15000 });
  const vlen = await A.page.evaluate(() => { const m = LIST.find((x) => x.env && x.env.t === "video" && !x.me); return m && m.blob ? m.blob.size : -1; });
  ok("video round-trips through encryption (" + vlen + " bytes)", vlen === fakeVideo.length, "len " + vlen);
  await A.page.click('.viewer [aria-label="Close"]');

  // safety numbers match
  await A.page.click('[aria-label="Settings"]'); await A.page.waitForSelector(".safety");
  await B.page.click('[aria-label="Settings"]'); await B.page.waitForSelector(".safety");
  const sa = await A.page.textContent(".safety"), sbn = await B.page.textContent(".safety");
  ok("safety numbers match (" + sa + ")", sa === sbn && /^\d{30}$/.test(sa));
  await shot(A, "07-settings-dark");
  await A.page.click(".sheet >> text=Mark as verified");
  await A.page.click(".dialog >> text=They match");
  await A.page.waitForSelector("text=Encrypted · verified");
  ok("verified state shows in header", true);
  await B.page.click(".sheet .cancel");

  // tamper: server re-attributes A's ciphertext to B; and injects garbage
  const sid = A.keychain.space;
  const aRow = server.db.messages.find((m) => m.sender_id !== server.db.messages[1].sender_id) || server.db.messages[0];
  const bUser = server.db.members.find((m) => m.space_id === sid && m.user_id !== aRow.sender_id).user_id;
  server.db.messages.push(Object.assign({}, aRow, { id: crypto.randomUUID(), sender_id: bUser, created_at: new Date().toISOString() }));
  server.db.messages.push(Object.assign({}, aRow, { id: crypto.randomUUID(), ciphertext: "v2." + Buffer.from(crypto.randomBytes(60)).toString("base64"), created_at: new Date().toISOString() }));
  await A.page.waitForFunction(() => document.querySelectorAll(".bub.bad").length >= 2, null, { timeout: 10000 });
  ok("re-attributed and forged rows are rejected", true);
  await shot(A, "05-chat-dark");
  await shot(B, "05-chat-light");

  // expired-media cleanup runs on next unlock: age one of B's objects past 24h
  const victim = [...server.db.objects.keys()][0];
  server.db.objects.get(victim).created = Date.now() - 865e5;
  server.db.tokenTtl = 30; // next tokens are near expiry -> app must refresh proactively

  await A.page.click('[aria-label="Attach"]'); await A.page.waitForTimeout(400); await shot(A, "12-attach-sheet");
  await A.page.click(".sheet .cancel"); await A.page.waitForTimeout(350);

  // lock + wrong passcode + unlock
  await A.page.click('[aria-label="Lock"]');
  await A.page.waitForSelector("text=Enter passcode");
  ok("lock clears decrypted messages from the DOM", (await A.page.locator(".bub").count()) === 0);
  await typeCode(A.page, "000000");
  await A.page.waitForSelector("text=Wrong passcode");
  ok("wrong passcode rejected and counted", A.keychain.lock && A.keychain.lock.f === 1);
  await shot(A, "04-lock-dark");
  await A.page.setViewportSize({ width: 375, height: 667 }); await A.page.waitForTimeout(200);
  await shot(A, "13-lock-small");
  ok("small screen: keypad and Forgot link reachable", await A.page.locator("text=Forgot passcode?").isVisible() || (await A.page.locator("text=Forgot passcode?").scrollIntoViewIfNeeded().then(() => true)));
  await A.page.setViewportSize({ width: 390, height: 844 });
  await typeCode(A.page, "135792");
  await A.page.waitForSelector("text=hi A, B here", { timeout: 15000 });
  ok("correct passcode unlocks and history re-decrypts", true);
  await A.page.waitForTimeout(1500);
  ok("expired media deleted by cleanup", (server.db.deleted || []).includes(victim));
  const tokCalls = () => server.db.reqLog.filter((x) => x === "POST /auth/v1/token").length;
  const mkTok = (sub, secs) => Buffer.from('{"alg":"none"}').toString("base64url") + "." + Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + secs })).toString("base64url") + ".x";
  const me = A.keychain.session.user_id;
  // (a) widget already rotated the session in the Keychain: app adopts it, no /token call
  let before = tokCalls();
  A.keychain.session = { access_token: mkTok(me, 3600) + "w", refresh_token: "r-" + me, user_id: me };
  await A.page.evaluate((t) => { ST.session.access_token = t; }, mkTok(me, 10));
  await A.page.fill("#txt", "after widget rotation");
  await A.page.keyboard.press("Enter");
  await B.page.waitForSelector("text=after widget rotation", { timeout: 15000 });
  ok("adopts a session the widget rotated (no extra refresh)", tokCalls() === before && (await A.page.evaluate(() => ST.session.access_token.endsWith("w"))));
  // (b) nothing newer in the Keychain: app refreshes itself and saves the result
  server.db.tokenTtl = 3600;
  before = tokCalls();
  A.keychain.session = { access_token: mkTok(me, 10), refresh_token: "r-" + me, user_id: me };
  await A.page.evaluate((t) => { ST.session.access_token = t; }, mkTok(me, 10));
  await A.page.fill("#txt", "after refresh");
  await A.page.keyboard.press("Enter");
  await B.page.waitForSelector("text=after refresh", { timeout: 15000 });
  ok("near-expiry token is refreshed and saved", tokCalls() > before && JSON.parse(Buffer.from(A.keychain.session.access_token.split(".")[1], "base64url")).exp * 1000 > Date.now() + 60000);
  server.db.tokenTtl = 3600;

  // bad joiner: someone with the code but a wrong HMAC secret
  const C = await phone(wk, server, "C");
  await C.page.click("text=Create a space");
  await typeCode(C.page, "112358"); await C.page.waitForSelector("text=Confirm passcode"); await typeCode(C.page, "112358");
  await C.page.waitForSelector(".invite-code");
  const inv2 = (await C.page.textContent(".invite-code")).trim().split(".");
  inv2[3] = Buffer.from(crypto.randomBytes(16)).toString("base64url");
  const D = await phone(wk, server, "D");
  await D.page.click("text=Join with an invite");
  await D.page.fill("textarea", inv2.join("."));
  await D.page.click("text=Continue");
  await typeCode(D.page, "975310"); await D.page.waitForSelector("text=Confirm passcode"); await typeCode(D.page, "975310");
  await C.page.click(".sheet .cancel");
  await C.page.waitForSelector("text=Unverified device joined", { timeout: 15000 });
  ok("creator refuses a joiner without the invite secret", !(await C.page.isVisible("#txt")));
  await shot(C, "08-bad-join");

  // fingerprint mismatch: server swaps creator's key
  const E = await phone(wk, server, "E");
  await E.page.click("text=Create a space");
  await typeCode(E.page, "192837"); await E.page.waitForSelector("text=Confirm passcode"); await typeCode(E.page, "192837");
  await E.page.waitForSelector(".invite-code");
  const inv3 = (await E.page.textContent(".invite-code")).trim();
  const eSpace = E.keychain.space;
  for (const [k, hs] of server.db.handshakes) if (hs.space_id === eSpace) { const p = JSON.parse(hs.payload); const kp = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }); const j = kp.publicKey.export({ format: "jwk" }); p.pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]).toString("base64url"); hs.payload = JSON.stringify(p); }
  const F = await phone(wk, server, "F");
  await F.page.click("text=Join with an invite");
  await F.page.fill("textarea", inv3);
  await F.page.click("text=Continue");
  await typeCode(F.page, "564738"); await F.page.waitForSelector("text=Confirm passcode"); await typeCode(F.page, "564738");
  await F.page.waitForSelector("text=does not match your invite", { timeout: 15000 });
  ok("joiner detects a server-substituted creator key", true);

  for (const p of [A, B, C, D, E, F]) ok("no page errors on " + p.name, p.errors.length === 0, p.errors.join(" | "));
  for (const p of [A, B, C, D, E, F]) await p.close();
  await wk.close();

  /* ======== Chromium: voice note with a fake microphone ======== */
  console.log("Chromium (fake microphone)");
  const cr = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const s2 = makeServer();
  const ctxOpts = { permissions: ["microphone"] };
  const origPhone = phone;
  const P2 = async (n) => origPhone(cr, s2, n, { ctx: ctxOpts });
  const A2 = await P2("A2"), B2 = await P2("B2");
  await A2.page.click("text=Create a space");
  await typeCode(A2.page, "135792"); await A2.page.waitForSelector("text=Confirm passcode"); await typeCode(A2.page, "135792");
  await A2.page.waitForSelector(".invite-code");
  const i2 = await A2.page.textContent(".invite-code");
  await B2.page.click("text=Join with an invite");
  await B2.page.fill("textarea", i2);
  await B2.page.click("text=Continue");
  await typeCode(B2.page, "246801"); await B2.page.waitForSelector("text=Confirm passcode"); await typeCode(B2.page, "246801");
  await A2.page.click(".sheet .cancel");
  await A2.page.waitForSelector("#txt", { state: "visible", timeout: 20000 });
  await A2.page.click("#act"); // empty composer -> mic
  await A2.page.waitForSelector(".rec");
  await new Promise((r) => setTimeout(r, 2200));
  await shot(A2, "09-recording");
  await A2.page.click('[aria-label="Send voice note"]');
  await B2.page.waitForSelector(".msg:not(.me) .bub.voice", { timeout: 20000 });
  const dur = await B2.page.textContent(".msg:not(.me) .vdur");
  ok("voice note recorded, encrypted and delivered (" + dur.trim() + ")", /^0:0[1-4]$/.test(dur.trim()));
  await B2.page.click(".msg:not(.me) .vplay");
  await B2.page.waitForSelector('.msg:not(.me) .vplay[aria-label="Pause"]', { timeout: 10000 });
  ok("partner decrypts and plays it", true);
  await new Promise((r) => setTimeout(r, 900));
  await shot(B2, "10-voice");
  for (const p of [A2, B2]) ok("no page errors on " + p.name, p.errors.length === 0, p.errors.join(" | "));
  await A2.close(); await B2.close();
  await cr.close();

  console.log(`\ne2e: ${pass} passed, ${fail} failed. Screenshots in test-output/`);
  process.exit(fail ? 1 : 0);
}
export { typeCode, pngBytes };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
