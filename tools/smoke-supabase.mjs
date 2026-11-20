// Live smoke test of YOUR Supabase project after running supabase/002_keys_and_media.sql.
// It writes test data: 2 anonymous users, 1 space, 1 handshake, 1 message, 1 small file (deleted at the end).
// The test space itself stays (members can't delete spaces); it's harmless and has no partner.
//   node tools/smoke-supabase.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "src", "native.js"), "utf8");
const URL_ = src.match(/url: "([^"]+)"/)[1], KEY = src.match(/anonKey: "([^"]+)"/)[1];

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.error("  FAIL " + n + (x ? " :: " + x : "")); } };
async function req(method, p, token, body, headers) {
  const r = await fetch(URL_ + p, { method, headers: Object.assign({ apikey: KEY, Authorization: "Bearer " + (token || KEY), "Content-Type": "application/json" }, headers || {}), body: body == null ? undefined : (typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body)) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = t; }
  return { status: r.status, j };
}

try {
  const a = await req("POST", "/auth/v1/signup", null, {});
  ok("anonymous sign-up works", a.status === 200 && a.j.access_token, a.status + " " + JSON.stringify(a.j).slice(0, 120));
  const ta = a.j.access_token;
  const s = await req("POST", "/rest/v1/rpc/create_space", ta, {});
  ok("create_space", s.status === 200 && s.j.space_id);
  const sid = s.j.space_id;
  const k = await req("POST", "/rest/v1/rpc/publish_key", ta, { p_space: sid, p_payload: '{"v":2,"pub":"smoke"}' });
  ok("publish_key (v2 SQL applied)", k.status === 200 || k.status === 204, k.status + " " + JSON.stringify(k.j).slice(0, 160));
  const hs = await req("GET", "/rest/v1/handshakes?select=user_id,payload&space_id=eq." + sid, ta);
  ok("member reads handshakes", hs.status === 200 && hs.j.length === 1);
  const m = await req("POST", "/rest/v1/messages", ta, { space_id: sid, message_type: "text", ciphertext: "v2.smoke", expires_at: new Date(Date.now() + 864e5).toISOString() }, { Prefer: "return=representation" });
  ok("post message", m.status === 201);

  const name = sid + "/smoke_" + Date.now();
  const up = await req("POST", "/storage/v1/object/pvt-media/" + name, ta, new Uint8Array([1, 2, 3, 4]), { "Content-Type": "application/octet-stream" });
  ok("upload to pvt-media", up.status === 200, up.status + " " + JSON.stringify(up.j).slice(0, 160));
  const ls = await req("POST", "/storage/v1/object/list/pvt-media", ta, { prefix: sid, limit: 100, offset: 0 });
  ok("list own space folder", ls.status === 200 && Array.isArray(ls.j) && ls.j.some((o) => name.endsWith(o.name)), JSON.stringify(ls.j).slice(0, 160));
  const dl = await req("GET", "/storage/v1/object/authenticated/pvt-media/" + name, ta);
  ok("download own upload", dl.status === 200);
  const bad = await req("POST", "/storage/v1/object/pvt-media/" + name + "_x", ta, new Uint8Array([1]), { "Content-Type": "text/html" });
  ok("bucket rejects non-octet-stream uploads", bad.status >= 400);

  // outsider: a second anonymous user who is NOT a member
  const b = await req("POST", "/auth/v1/signup", null, {});
  const tb = b.j.access_token;
  const od = await req("GET", "/storage/v1/object/authenticated/pvt-media/" + name, tb);
  ok("outsider cannot download", od.status >= 400);
  const ou = await req("POST", "/storage/v1/object/pvt-media/" + sid + "/intruder", tb, new Uint8Array([9]), { "Content-Type": "application/octet-stream" });
  ok("outsider cannot upload into the space", ou.status >= 400);
  const oh = await req("GET", "/rest/v1/handshakes?select=user_id&space_id=eq." + sid, tb);
  ok("outsider sees no handshakes", oh.status === 200 && oh.j.length === 0);
  const ok2 = await req("POST", "/rest/v1/rpc/publish_key", tb, { p_space: sid, p_payload: "x" });
  ok("outsider cannot publish a key", ok2.status >= 400);
  const odel = await req("DELETE", "/storage/v1/object/pvt-media", tb, { prefixes: [name] });
  const still = await req("GET", "/storage/v1/object/authenticated/pvt-media/" + name, ta);
  ok("outsider cannot delete", still.status === 200, "outsider delete status " + odel.status);

  const del = await req("DELETE", "/storage/v1/object/pvt-media", ta, { prefixes: [name] });
  const gone = await req("GET", "/storage/v1/object/authenticated/pvt-media/" + name, ta);
  ok("uploader deletes own file", del.status === 200 && gone.status >= 400);
} catch (e) {
  fail++; console.error("smoke test crashed: " + e.message);
}
console.log(`supabase smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
