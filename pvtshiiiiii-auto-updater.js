// pvtshiiiiii-auto-updater.js — Scriptable (iOS)
// Install this small script on BOTH iPhones and run it instead of the main app.
// It checks GitHub whenever opened, downloads the latest app source, validates it,
// and caches the last working copy for offline fallback.
//
// Repository: https://github.com/romit-23/scriptable
// Main app: pvtshiiiiii.js
//
// IMPORTANT:
// - The repository must remain public for this unauthenticated raw URL to work.
// - Only use a repository you control: this updater executes downloaded JavaScript.

const UPDATE_CONFIG = {
  appUrl: "https://raw.githubusercontent.com/romit-23/scriptable/main/pvtshiiiiii.js",
  cacheFileName: "pvtshiiiiii-app-cache.js",
  requestTimeoutSeconds: 20,
  minSourceLength: 10000,
};

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), UPDATE_CONFIG.cacheFileName);

function appVersion(source) {
  const match = source.match(/^\\/\\/\\s*APP_VERSION:\\s*(.+)$/m);
  return match ? match[1].trim() : "unknown";
}

function validateAppSource(source) {
  if (typeof source !== "string" || source.length < UPDATE_CONFIG.minSourceLength) {
    throw new Error("Downloaded file is unexpectedly small. Check the GitHub URL and branch.");
  }
  if (!source.includes("// pvtshiiiiii.js — Scriptable (iOS)")) {
    throw new Error("Downloaded file is not the pvtshiiiiii Scriptable app.");
  }
  if (!source.includes("Script.complete();")) {
    throw new Error("Downloaded script looks incomplete; refusing to execute it.");
  }
  if (source.includes("scripts i ran on supabase :")) {
    throw new Error("The downloaded file contains unexpected SQL setup text.");
  }

  // Compile before caching or execution, so a broken update cannot replace the good cache.
  new Function("return (async function(){\\n" + source + "\\n}).call(this);");
  return source;
}

async function downloadLatest() {
  const request = new Request(UPDATE_CONFIG.appUrl + "?cache_bust=" + Date.now());
  request.method = "GET";
  request.timeoutInterval = UPDATE_CONFIG.requestTimeoutSeconds;
  request.headers = {
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  };
  return validateAppSource(await request.loadString());
}

function readCachedApp() {
  if (!fm.fileExists(cachePath)) return null;
  try {
    return validateAppSource(fm.readString(cachePath));
  } catch (error) {
    console.error("Cached app is invalid: " + String(error));
    return null;
  }
}

async function executeApp(source) {
  // The main app contains top-level await. This wrapper permits it inside Scriptable.
  const run = new Function("return (async function(){\\n" + source + "\\n}).call(this);");
  await run();
}

let appSource = null;
let sourceLabel = "GitHub";

try {
  appSource = await downloadLatest();
  // Cache only after validation succeeds.
  fm.writeString(cachePath, appSource);
  console.log("pvtshiiiiii updater: downloaded version " + appVersion(appSource));
} catch (error) {
  console.error("pvtshiiiiii updater: GitHub update failed: " + String(error));
  appSource = readCachedApp();
  sourceLabel = "local cached copy";
}

if (!appSource) {
  throw new Error(
    "Could not download pvtshiiiiii from GitHub and no working cached copy exists. " +
    "Check internet access and confirm the repository is public and pvtshiiiiii.js exists on main."
  );
}

console.log("pvtshiiiiii updater: launching " + sourceLabel + " (" + appVersion(appSource) + ")");
await executeApp(appSource);
