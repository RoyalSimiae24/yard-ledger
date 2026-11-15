// Yard Ledger launcher. It stays tiny and rarely changes: it starts the newest
// verified update from the user's data folder, or the built-in app if there is none.
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const rawfs = require("original-fs");
const crypto = require("crypto");

const builtIn = __dirname;
const shellVersion = JSON.parse(fs.readFileSync(path.join(builtIn, "package.json"), "utf8")).version;
const newer = (a, b) => {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
const userData = () => app.getPath("userData");
const log = (m) => { try { rawfs.appendFileSync(path.join(userData(), "update.log"), new Date().toISOString() + " launcher " + m + "\n"); } catch (e) { /* best effort */ } };

function pickOverride() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(userData(), "update-state.json"), "utf8"));
    if (!st || !/^\d+\.\d+\.\d+$/.test(String(st.version)) || !newer(st.version, shellVersion)) return null;
    if (typeof st.file !== "string" || !rawfs.existsSync(st.file)) return null;
    const h = crypto.createHash("sha256").update(rawfs.readFileSync(st.file)).digest("hex");
    if (h !== String(st.sha256).toLowerCase()) { log("checksum mismatch for " + st.version); return null; }
    return st;
  } catch (e) { return null; }
}

const ov = pickOverride();
if (ov) {
  try {
    require(path.join(ov.file, "core.js"));
    log("running " + ov.version);
  } catch (e) {
    log("update " + ov.version + " failed to start, using built-in: " + String((e && e.stack) || e).slice(0, 300));
    try { fs.renameSync(path.join(userData(), "update-state.json"), path.join(userData(), "update-state.bad.json")); } catch (e2) { /* ignore */ }
    require(path.join(builtIn, "core.js"));
  }
} else {
  require(path.join(builtIn, "core.js"));
}
