// APP_VERSION: 1.0.0
// Master app source. The updater downloads this file from GitHub on each launch.
// pvtshiiiiii.js — Scriptable (iOS)
// Pairing by invite, local PIN lock, end-to-end encrypted text messages
// stored in Supabase, 24h expiry. Photos, videos and voice come next.
//
// SETUP: paste your Supabase anon key below (Project Settings > API).
// Never paste the service_role key anywhere.

const CONFIG = {
  url: "https://wxkudamhxyengyiusqjh.supabase.co",
  anonKey: "sb_publishable_LZJE2NoHQhw7TwAeYU0PHg_FsE8WNRZ",
};
const RESET_ALL = false; // set true for one run to forget this phone, then set back to false

// ---------- Persistent storage (iOS Keychain) ----------
// Keychain names keep the old "ols_" prefix so this phone stays paired after the rename.
const KEYS = ["session", "space", "key", "pin", "invite", "seen", "notified"];
if (RESET_ALL) KEYS.forEach((k) => { if (Keychain.contains("ols_" + k)) Keychain.remove("ols_" + k); });
const store = {};
KEYS.forEach((k) => {
  if (Keychain.contains("ols_" + k)) {
    try { store[k] = JSON.parse(Keychain.get("ols_" + k)); } catch (e) {}
  }
});

// ---------- UI + logic inside the WebView ----------
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
:root{--bg:#0D0D0F;--ink:#ECECEE;--mute:#76767E;--line:#1C1C20;--card:#151518;--edge:#232328;--accent:#9AA5C4;--bd:#2A2A30;color-scheme:dark}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,"SF Pro Text",system-ui,sans-serif}
#root{height:100%}
.chat{display:flex;flex-direction:column;height:100%}
header{padding:calc(14px + env(safe-area-inset-top)) 24px 14px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end}
h1,h2{margin:0;font:500 17px/1.1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.04em;text-transform:lowercase;display:flex;gap:10px;align-items:center}
h2{font-size:22px;display:block;letter-spacing:.02em}
.sub{margin-top:7px;font:11px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:lowercase;color:var(--mute)}
.lnk{background:none;border:0;color:var(--accent);font:12px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:lowercase;padding:10px 0 4px;cursor:pointer}
#list{flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:18px}
.day{align-self:center;font:10px ui-monospace,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--mute)}
.row{display:flex;flex-direction:column;gap:5px;align-items:flex-start}
.row.me{align-items:flex-end}
.meta{font:10px ui-monospace,Menlo,monospace;letter-spacing:.06em;color:var(--mute);padding:0 4px}
.bub{background:var(--card);border:1px solid var(--edge);border-radius:16px 16px 16px 4px;padding:11px 15px;max-width:280px;word-wrap:break-word;white-space:pre-wrap}
.me .bub{background:var(--ink);color:var(--bg);border-color:var(--ink);border-radius:16px 16px 4px 16px}
#bar{display:flex;gap:10px;align-items:center;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--line)}
button{font:inherit;border:0;padding:0;cursor:pointer}
.ib{width:44px;height:44px;border-radius:22px;display:flex;align-items:center;justify-content:center;flex:none}
#media{background:var(--card);border:1px solid var(--bd);color:var(--ink)}
#mic{background:var(--ink);color:var(--bg)}
#txt{flex:1;min-width:0;height:44px;border-radius:22px;border:1px solid var(--bd);background:var(--card);padding:0 18px;font:inherit;color:var(--ink);outline:0}
#toast{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:18px;font-size:13px;display:none;max-width:90%}
.screen{height:100%;display:flex;flex-direction:column;justify-content:center;gap:14px;padding:40px 28px}
.mute{color:var(--mute);margin:0;font-size:14px;line-height:1.5}
.mark{width:26px;height:26px;border:1.5px solid var(--ink);border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:6px}
.mark i{width:6px;height:6px;border-radius:50%;background:var(--ink);display:block}
.dot{width:6px;height:6px;border-radius:50%;background:var(--accent);display:inline-block}
.in{height:52px;border-radius:26px;border:1px solid var(--bd);background:var(--card);padding:0 20px;font:inherit;font-size:18px;color:var(--ink);outline:0;width:100%;letter-spacing:.2em}
textarea.in{height:120px;border-radius:20px;padding:14px 18px;letter-spacing:0;font-size:14px}
.btn{height:52px;border-radius:26px;font-size:14px;letter-spacing:.02em;border:1px solid var(--bd);background:transparent;color:var(--ink);font-weight:500;width:100%}
.btn.pri{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.box{background:var(--card);border:1px solid var(--edge);border-radius:18px;padding:16px;font:13px/1.5 ui-monospace,Menlo,monospace;word-break:break-all;user-select:all;-webkit-user-select:all}
.warn{color:#C98B8B;min-height:20px;margin:0;font-size:13px}
</style></head><body>
<div id="root"></div><div id="toast"></div>
<script>
var INIT=__INIT__,CFG=INIT.cfg,S=INIT.store||{},out=[],MSG={},LIST=[],KEY=null,partner=false,polling=false,fails=0,lastCount=0;
var enc=new TextEncoder(),dec=new TextDecoder();
var MARK='<div class="mark"><i></i></div>';
function $(i){return document.getElementById(i)}
var seq=0,waits={};
window.__ack=function(id,err){var w=waits[id];if(w){delete waits[id];w(err)}};
function save(k,v){S[k]=v;var id=++seq;out.push({id:id,t:'save',k:k,v:v});
  return new Promise(function(res){waits[id]=res;setTimeout(function(){if(waits[id]){delete waits[id];res('no reply from Scriptable, see its console')}},5000)})}
window.__drain=function(){var o=out;out=[];return JSON.stringify(o)};
function esc(s){var d=document.createElement('div');d.textContent=String(s);return d.innerHTML}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function toast(t){var e=$('toast');e.textContent=t;e.style.display='block';setTimeout(function(){e.style.display='none'},2800)}
function show(h){$('root').innerHTML=h}
function scr(title,body){return '<div class="screen">'+MARK+'<h2>'+title+'</h2>'+body+'</div>'}

/* ---- encoding + crypto ---- */
function b64(buf){var s='',b=new Uint8Array(buf);for(var i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s)}
function unb64(t){var s=atob(t),b=new Uint8Array(s.length);for(var i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b}
function b64u(buf){return b64(buf).split('+').join('-').split('/').join('_').split('=').join('')}
function unb64u(t){t=t.split('-').join('+').split('_').join('/');while(t.length%4)t+='=';return unb64(t)}
function importKey(raw){return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt'])}
async function encrypt(t){var iv=crypto.getRandomValues(new Uint8Array(12));var ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},KEY,enc.encode(t));var o=new Uint8Array(12+ct.byteLength);o.set(iv,0);o.set(new Uint8Array(ct),12);return b64(o)}
async function decrypt(t){try{var b=unb64(t);var pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},KEY,b.slice(12));return dec.decode(pt)}catch(e){return null}}
async function pinHash(pin,salt){var k=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);return b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:salt,iterations:150000,hash:'SHA-256'},k,256))}
function isPin(p){if(p.length<4||p.length>6)return false;for(var i=0;i<p.length;i++){if(p[i]<'0'||p[i]>'9')return false}return true}

/* ---- Supabase ---- */
async function refresh(){
  var r=await fetch(CFG.url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:CFG.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:S.session.refresh_token})});
  var j=await r.json();if(!r.ok)throw new Error('Session expired');
  save('session',{access_token:j.access_token,refresh_token:j.refresh_token,user_id:S.session.user_id})}
async function api(path,opt,retried){
  opt=opt||{};var h={apikey:CFG.key,'Content-Type':'application/json'};
  h.Authorization='Bearer '+(S.session?S.session.access_token:CFG.key);
  for(var k in (opt.headers||{}))h[k]=opt.headers[k];
  var r=await fetch(CFG.url+path,{method:opt.method||'GET',headers:h,body:opt.body});
  if(r.status===401&&S.session&&!retried){await refresh();return api(path,opt,true)}
  var t=await r.text(),j=null;try{j=t?JSON.parse(t):null}catch(e){}
  if(!r.ok)throw new Error((j&&(j.message||j.msg||j.error_description))||('HTTP '+r.status));
  return j}
async function signIn(){if(S.session)return;var j=await api('/auth/v1/signup',{method:'POST',body:'{}'});var e=await save('session',{access_token:j.access_token,refresh_token:j.refresh_token,user_id:j.user.id});if(e)throw new Error('Could not save to the Keychain: '+e)}

/* ---- screens ---- */
function fatal(m){show(scr('Not ready',' <p class="mute">'+esc(m)+'</p>'))}
function failed(e){show(scr('Something went wrong','<p class="mute">'+esc(e.message)+'</p><button class="btn" onclick="boot()">Back</button>'))}
function busy(m){show(scr(m,'<p class="mute">One moment.</p>'))}
function welcome(){show(scr('pvtshiiiiii','<p class="mute">Private and end-to-end encrypted. Messages disappear after 24 hours.</p><button class="btn pri" onclick="doCreate()">New space</button><button class="btn" onclick="joinScreen()">Join with invite</button>'))}
function joinScreen(){show(scr('Join','<p class="mute">Paste the invite you received.</p><textarea id="inv" class="in" placeholder="Invite" autocapitalize="off" autocorrect="off"></textarea><button class="btn pri" onclick="doJoin()">Join</button><button class="btn" onclick="boot()">Back</button>'))}
function inviteScreen(str){show(scr('Invite','<p class="mute">Send this privately. Anyone who has it can join, and it works once for 10 minutes.</p><div class="box">'+esc(str)+'</div><button class="btn pri" onclick="shareInvite()">Share</button><button class="btn" onclick="newCode()">New code</button><button class="btn" onclick="inviteDone()">Continue</button>'))}
function pinSetup(){show(scr('Set a PIN','<p class="mute">4 to 6 digits. It locks the app on this phone only.</p><input id="p1" class="in" type="password" inputmode="numeric" maxlength="6" placeholder="PIN"><input id="p2" class="in" type="password" inputmode="numeric" maxlength="6" placeholder="Repeat PIN"><p class="warn" id="pe"></p><button class="btn pri" onclick="doPin()">Save PIN</button>'))}
function lockScreen(msg){show(scr('Enter your PIN','<input id="pin" class="in" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="PIN"><p class="warn">'+esc(msg||'')+'</p><button class="btn pri" onclick="doUnlock()">Unlock</button>'))}

async function doCreate(){busy('Creating space');try{await signIn();var r=await api('/rest/v1/rpc/create_space',{method:'POST',body:'{}'});var raw=crypto.getRandomValues(new Uint8Array(32));var k=b64u(raw);var e1=await save('key',k);var e2=await save('space',r.space_id);if(e1||e2)throw new Error('Could not save to the Keychain: '+(e1||e2));KEY=await importKey(raw);S.invite=r.code+'.'+k;inviteScreen(S.invite)}catch(e){failed(e)}}
async function doJoin(){var v=$('inv').value.trim(),i=v.indexOf('.');if(i<1||v.length-i-1!==43){toast('That invite does not look right');return}
  var code=v.slice(0,i),k=v.slice(i+1);busy('Joining');
  try{var raw=unb64u(k);await signIn();var sid=await api('/rest/v1/rpc/join_space',{method:'POST',body:JSON.stringify({p_code:code})});var e1=await save('key',k);var e2=await save('space',sid);if(e1||e2)throw new Error('Could not save to the Keychain: '+(e1||e2));KEY=await importKey(raw);pinSetup()}catch(e){failed(e)}}
function shareInvite(){out.push({t:'share',text:'Join me on pvtshiiiiii. Open the app, tap Join, and paste this: '+S.invite})}
async function newCode(){try{var c=await api('/rest/v1/rpc/new_invite',{method:'POST',body:JSON.stringify({p_space:S.space})});S.invite=c+'.'+S.key;inviteScreen(S.invite)}catch(e){toast(e.message)}}
function inviteDone(){S.invite=null;if(S.pin)chat();else pinSetup()}
async function doPin(){var a=$('p1').value,b=$('p2').value;if(!isPin(a)){$('pe').textContent='Use 4 to 6 digits.';return}if(a!==b){$('pe').textContent='The PINs do not match.';return}
  var salt=crypto.getRandomValues(new Uint8Array(16));var h=await pinHash(a,salt);var e=await save('pin',{salt:b64(salt),hash:h});if(e){$('pe').textContent='Could not save the PIN: '+e;return}chat()}
async function doUnlock(){var p=$('pin').value;if(!isPin(p)){lockScreen('Enter your PIN.');return}
  if(fails>=3)await new Promise(function(r){setTimeout(r,Math.min(fails,10)*1000)});
  if(await pinHash(p,unb64(S.pin.salt))===S.pin.hash){fails=0;chat()}else{fails++;lockScreen('That is not the right PIN.')}}

/* ---- chat ---- */
function left(m){var ms=m.expires-Date.now();if(ms<=0)return null;var h=Math.floor(ms/36e5);return h>=1?h+'h':Math.max(1,Math.floor(ms/6e4))+'m'}
function render(){var L=$('list');if(!L)return;L.innerHTML='';L.appendChild(el('div','day','Today'));var n=0;
  LIST.forEach(function(m){var l=left(m);if(!l)return;n++;var r=el('div','row'+(m.side==='me'?' me':''));r.appendChild(el('div','bub',m.text));r.appendChild(el('div','meta','expires in '+l));L.appendChild(r)});
  if(n!==lastCount){L.scrollTop=L.scrollHeight;lastCount=n}}
async function ingest(rows){var ch=false;
  for(var i=0;i<rows.length;i++){var r=rows[i];if(MSG[r.id])continue;MSG[r.id]=1;
    var t=r.message_type==='text'?await decrypt(r.ciphertext):'['+r.message_type+']';
    LIST.push({id:r.id,side:r.sender_id===S.session.user_id?'me':'them',text:t===null?'Could not decrypt this message':t,expires:Date.parse(r.expires_at),created:Date.parse(r.created_at)});ch=true}
  if(ch){LIST.sort(function(a,b){return a.created-b.created});if($('list'))save('seen',new Date(Math.max.apply(null,LIST.map(function(m){return m.created}))+1).toISOString())}render()}
async function poll(){if(polling||!$('list'))return;polling=true;
  try{var r=await api('/rest/v1/messages?space_id=eq.'+S.space+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&order=created_at.asc&limit=200');await ingest(r);
    var m=await api('/rest/v1/members?space_id=eq.'+S.space+'&select=user_id');partner=m.length>=2;var b=$('invBtn');if(b)b.style.display=partner?'none':'block'}catch(e){}
  polling=false}
async function send(){var t=$('txt'),v=t.value.trim();if(!v)return;t.value='';
  try{var ct=await encrypt(v);var r=await api('/rest/v1/messages',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({space_id:S.space,message_type:'text',ciphertext:ct,expires_at:new Date(Date.now()+864e5).toISOString()})});await ingest(r)}
  catch(e){toast('Not sent: '+e.message);t.value=v}}
async function doInvite(){try{var c=await api('/rest/v1/rpc/new_invite',{method:'POST',body:JSON.stringify({p_space:S.space})});S.invite=c+'.'+S.key;inviteScreen(S.invite)}catch(e){toast(e.message)}}
function chat(){
  show('<div class="chat"><header><div><h1>pvtshiiiiii</h1><div class="sub"><span class="dot"></span>&nbsp; encrypted &middot; 24h</div></div><button id="invBtn" class="lnk" onclick="doInvite()" style="display:none">Invite</button></header><div id="list"></div>'+
  '<div id="bar"><button class="ib" id="media" aria-label="Photos and videos" onclick="toast(&quot;Photos and videos are coming next&quot;)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5.5-5 4 3.5 3-2.5L21 17"/></svg></button>'+
  '<input id="txt" aria-label="Message" placeholder="Message" enterkeyhint="send" autocomplete="off">'+
  '<button class="ib" id="mic" aria-label="Voice note" onclick="toast(&quot;Voice notes are coming next&quot;)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button></div></div>');
  $('txt').addEventListener('keydown',function(e){if(e.key==='Enter')send()});
  lastCount=-1;render();poll();if(!window.__timer)window.__timer=setInterval(poll,3000)}

async function boot(){
  if(!window.crypto||!crypto.subtle)return fatal('Encryption is not available in this view, so nothing was sent or stored.');
  if(!CFG.url||!CFG.key||CFG.key.indexOf('PASTE')===0)return fatal('Add your Supabase anon key at the top of the script, then run it again.');
  try{if(S.key&&S.space)KEY=await importKey(unb64u(S.key))}catch(e){return fatal('The saved key is unreadable. Set RESET_ALL to true for one run.')}
  if(S.invite)save('invite',null); // old versions stored the invite (and key) on the phone
  if(S.space&&S.pin)return lockScreen();
  if(S.space)return pinSetup();
  welcome()}
boot();
</script></body></html>`;

// ---------- Native side ----------
const timers = []; // keep references so timers are not garbage collected
const sleep = (ms) => new Promise((r) => { timers.push(Timer.schedule(ms, false, () => r())); });
const withTimeout = (p, ms) =>
  Promise.race([
    p,
    new Promise((_, rej) => { timers.push(Timer.schedule(ms, false, () => rej(new Error("timeout after " + ms + "ms")))); }),
  ]);

async function handle(req) {
  if (req.t === "save") {
    const name = "ols_" + req.k;
    if (req.v === null || req.v === undefined) {
      if (Keychain.contains(name)) Keychain.remove(name);
    } else {
      const val = JSON.stringify(req.v);
      Keychain.set(name, val);
      if (!Keychain.contains(name) || Keychain.get(name) !== val) throw new Error(req.k + " was not kept");
    }
  } else if (req.t === "share") {
    await ShareSheet.present([req.text]);
  }
}

// ---------- The app (opens when you tap the widget or run the script) ----------
async function runApp() {
  const init = { cfg: { url: CONFIG.url, key: CONFIG.anonKey }, store };
  const page = HTML.replace("__INIT__", () => JSON.stringify(init).split("<").join("\\u003c"));

  const wv = new WebView();
  await wv.loadHTML(page, "https://pvtshiiiiii.local/");
  let closed = false;
  wv.present(true).then(() => { closed = true; });

  // Bridge: the page queues work, this loop collects it, writes to the Keychain and replies.
  let mode = 0, ready = false;
  async function drain() {
    if (mode === 0) {
      try {
        const r = await withTimeout(
          wv.evaluateJavaScript("window.__drain ? window.__drain() : '[]'", false), 1500);
        if (typeof r === "string") return r;
        console.log("direct mode returned " + typeof r + ", switching to callback mode");
      } catch (e) {
        console.log("direct mode failed (" + String(e) + "), switching to callback mode");
      }
      mode = 1;
    }
    return await withTimeout(
      wv.evaluateJavaScript("completion(window.__drain ? window.__drain() : '[]')", true), 3000);
  }

  console.log("pvtshiiiiii: bridge starting");
  await sleep(800);
  while (!closed) {
    try {
      const raw = await drain();
      if (!ready && typeof raw === "string") { ready = true; console.log("pvtshiiiiii: bridge ready (" + (mode ? "callback" : "direct") + ")"); }
      const queue = typeof raw === "string" && raw ? JSON.parse(raw) : [];
      for (const req of queue) {
        console.log("bridge request: " + req.t + " " + (req.k || ""));
        let err = null;
        try { await handle(req); } catch (e) { err = String(e); console.error(err); }
        if (req.id) {
          try {
            await withTimeout(wv.evaluateJavaScript("window.__ack(" + req.id + "," + JSON.stringify(err) + ")", false), 3000);
          } catch (e) {
            console.error("ack failed: " + String(e));
          }
        }
      }
    } catch (e) {
      console.error("bridge error: " + String(e));
      await sleep(1000);
    }
    await sleep(120);
  }
  console.log("pvtshiiiiii: closed");
}

// ---------- Home screen widget: count of unread messages from your partner ----------
// The widget only ever sees a number. It never decrypts or shows message text.
async function sb(path, token, method, body) {
  const r = new Request(CONFIG.url + path);
  r.method = method || "GET";
  r.headers = { apikey: CONFIG.anonKey, Authorization: "Bearer " + token, "Content-Type": "application/json" };
  if (body) r.body = JSON.stringify(body);
  let json = null;
  try { json = await r.loadJSON(); } catch (e) {}
  return { status: r.response ? r.response.statusCode : 0, json: json };
}

async function widgetData() {
  const sess = store.session, space = store.space;
  if (!sess || !space) return { state: "setup" };
  if (CONFIG.anonKey.indexOf("PASTE") === 0) return { state: "nokey" };

  const since = encodeURIComponent(store.seen || "1970-01-01T00:00:00Z");
  const now = encodeURIComponent(new Date().toISOString());
  const unreadPath = "/rest/v1/messages?select=id&limit=100&space_id=eq." + space +
    "&sender_id=neq." + sess.user_id + "&expires_at=gt." + now + "&created_at=gt." + since;

  let token = sess.access_token;
  let res = await sb(unreadPath, token);
  if (res.status === 401) {
    const rr = await sb("/auth/v1/token?grant_type=refresh_token", CONFIG.anonKey, "POST", { refresh_token: sess.refresh_token });
    if (rr.status !== 200 || !rr.json || !rr.json.access_token) return { state: "offline" };
    const ns = { access_token: rr.json.access_token, refresh_token: rr.json.refresh_token, user_id: sess.user_id };
    Keychain.set("ols_session", JSON.stringify(ns));
    store.session = ns;
    token = ns.access_token;
    res = await sb(unreadPath, token);
  }
  if (res.status !== 200 || !Array.isArray(res.json)) return { state: "offline" };

  const mem = await sb("/rest/v1/members?select=user_id&space_id=eq." + space, token);
  const partner = mem.status === 200 && Array.isArray(mem.json) && mem.json.length >= 2;
  return { state: "ok", count: res.json.length, partner: partner };
}

async function runWidget() {
  let d;
  try { d = await widgetData(); } catch (e) { d = { state: "offline" }; }

  const fam = config.widgetFamily || "small";
  const tiny = fam.indexOf("accessory") === 0;
  const mono = (n) => Font.regularMonospacedSystemFont(n);
  const w = new ListWidget();
  w.backgroundColor = new Color("#0D0D0F");
  w.url = URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

  const line = (text, size, hex) => {
    const t = w.addText(text);
    t.font = mono(size);
    t.textColor = new Color(hex);
    return t;
  };

  line("pvtshiiiiii", tiny ? 10 : 12, "#76767E");
  w.addSpacer(tiny ? 2 : 8);

  if (d.state === "setup") {
    line("open the app to set up", tiny ? 10 : 13, "#ECECEE");
  } else if (d.state === "nokey") {
    line("add your anon key to the script", tiny ? 10 : 13, "#C98B8B");
  } else if (d.state === "offline") {
    line("can't reach server", tiny ? 10 : 13, "#76767E");
  } else {
    line(String(d.count), tiny ? 22 : 44, d.count > 0 ? "#ECECEE" : "#76767E");
    w.addSpacer(2);
    line(d.count === 0 ? "all caught up" : (d.count === 1 ? "new message" : "new messages"), tiny ? 9 : 12, d.count > 0 ? "#9AA5C4" : "#76767E");
    if (!d.partner && !tiny) { w.addSpacer(6); line("waiting for partner", 10, "#76767E"); }

    // Best effort local notification. iOS decides when widgets refresh, so this is not instant.
    try {
      const prev = store.notified || 0;
      if (d.count > prev) {
        const n = new Notification();
        n.title = "pvtshiiiiii";
        n.body = d.count === 1 ? "1 new message" : d.count + " new messages";
        n.openURL = URLScheme.forRunningScript();
        await n.schedule();
      }
      if (d.count !== prev) Keychain.set("ols_notified", JSON.stringify(d.count));
    } catch (e) { console.error("notify failed: " + String(e)); }
  }

  Script.setWidget(w);
}

if (config.runsInWidget) { await runWidget(); } else { await runApp(); }
Script.complete();
