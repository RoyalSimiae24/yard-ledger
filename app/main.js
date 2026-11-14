const { app, BrowserWindow, ipcMain, dialog, Menu, Notification, shell, net } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

app.setAppUserModelId("com.yardledger.app");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let win = null;

const dataFile = () => path.join(app.getPath("userData"), "data.json");
const prevFile = () => path.join(app.getPath("userData"), "data.previous.json");
const oldJobsFile = () => path.join(app.getPath("userData"), "jobs.json");

function isPlainObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function normalize(x) {
  if (Array.isArray(x)) x = { jobs: x };
  if (!isPlainObject(x)) throw new Error("not a ledger");
  return {
    jobs: Array.isArray(x.jobs) ? x.jobs : [],
    clients: Array.isArray(x.clients) ? x.clients : [],
    services: Array.isArray(x.services) ? x.services : [],
    invoices: Array.isArray(x.invoices) ? x.invoices : [],
    settings: isPlainObject(x.settings) ? x.settings : {},
  };
}

function validData(d) {
  if (!isPlainObject(d)) return false;
  const lists = [d.jobs, d.clients, d.services, d.invoices];
  for (const l of lists) {
    if (!Array.isArray(l)) return false;
    for (const it of l) {
      if (!isPlainObject(it) || typeof it.id !== "string" || it.id.length === 0 || it.id.length > 200) return false;
    }
  }
  return isPlainObject(d.settings);
}

function readData(file) {
  return normalize(JSON.parse(fs.readFileSync(file, "utf8")));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 880,
    minWidth: 480,
    minHeight: 600,
    title: "Yard Ledger",
    backgroundColor: "#F1F4F2",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("closed", () => { win = null; });
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  ipcMain.handle("data:load", () => {
    let anyExists = false;
    for (const f of [dataFile(), prevFile(), oldJobsFile()]) {
      if (!fs.existsSync(f)) continue;
      anyExists = true;
      try { return readData(f); } catch (e) { /* try the next file */ }
    }
    if (anyExists) throw new Error("unreadable");
    return normalize({});
  });

  ipcMain.handle("data:save", (_e, d) => {
    if (!validData(d)) throw new Error("bad data");
    const file = dataFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2), "utf8");
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, prevFile()); } catch (e) { /* keep going */ }
    }
    fs.renameSync(tmp, file);
    return true;
  });

  ipcMain.handle("data:export", async (_e, d) => {
    if (!validData(d)) return { error: true };
    const t = new Date();
    const stamp = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    const res = await dialog.showSaveDialog(win, {
      title: "Save backup",
      defaultPath: path.join(app.getPath("documents"), "yard-ledger-backup-" + stamp + ".json"),
      filters: [{ name: "Yard Ledger backup", extensions: ["json"] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    try {
      fs.writeFileSync(res.filePath, JSON.stringify(d, null, 2), "utf8");
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { error: true };
    }
  });

  ipcMain.handle("data:import", async () => {
    const res = await dialog.showOpenDialog(win, {
      title: "Restore backup",
      properties: ["openFile"],
      filters: [{ name: "Yard Ledger backup", extensions: ["json"] }],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    try {
      const d = readData(res.filePaths[0]);
      if (!validData(d)) return { error: "That file is not a Yard Ledger backup." };
      return { data: d };
    } catch (e) {
      return { error: "That file is not a Yard Ledger backup." };
    }
  });

  ipcMain.handle("notify", (_e, msg) => {
    if (!msg || typeof msg.title !== "string" || typeof msg.body !== "string") return false;
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: msg.title.slice(0, 120), body: msg.body.slice(0, 400) });
    n.on("click", () => {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
    n.show();
    return true;
  });

  function safeName(s, fallback) {
    let n = String(s || "").replace(/[<>:"\/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80);
    if (!n || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = fallback;
    return n;
  }
  const invoiceRoot = () => path.join(app.getPath("documents"), "Yard Ledger Invoices");

  ipcMain.handle("invoice:savePdf", async (_e, m) => {
    if (!m || typeof m !== "object" || !win) return { error: true };
    try {
      const dir = path.join(invoiceRoot(), safeName(m.client, "Client"));
      fs.mkdirSync(dir, { recursive: true });
      const no = safeName(String(m.no), "0");
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(m.date)) ? m.date : "undated";
      const file = path.join(dir, "Invoice " + no + " - " + date + ".pdf");
      const buf = await win.webContents.printToPDF({ pageSize: "Letter", printBackground: true, preferCSSPageSize: true, margins: { marginType: "none" } });
      fs.writeFileSync(file, buf);
      return { ok: true, path: file };
    } catch (err) {
      return { error: true };
    }
  });

  ipcMain.handle("invoice:print", () => new Promise((resolve) => {
    if (!win) return resolve(false);
    win.webContents.print({ printBackground: true, pageSize: "Letter" }, (ok) => resolve(!!ok));
  }));

  ipcMain.handle("invoice:openFolder", async (_e, client) => {
    const dir = client ? path.join(invoiceRoot(), safeName(client, "Client")) : invoiceRoot();
    fs.mkdirSync(dir, { recursive: true });
    const r = await shell.openPath(dir);
    return r === "";
  });

  /* ---------- updates from GitHub ---------- */
  const UPDATE_BASE = "https://raw.githubusercontent.com/RoyalSimiae24/yard-ledger/main/updates/";
  function cmpVer(a, b) {
    const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; }
    return 0;
  }
  async function fetchBuf(name, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await net.fetch(UPDATE_BASE + name + "?t=" + Date.now(), { signal: ctl.signal, cache: "no-store" });
      if (!r.ok) throw new Error("http " + r.status);
      return Buffer.from(await r.arrayBuffer());
    } finally { clearTimeout(timer); }
  }
  async function readUpdate() {
    const m = JSON.parse((await fetchBuf("update.json", 10000)).toString("utf8"));
    if (!m || !/^\d+\.\d+\.\d+$/.test(String(m.version)) || !/^[0-9a-f]{64}$/i.test(String(m.sha256))) throw new Error("bad update.json");
    return { version: String(m.version), sha256: String(m.sha256).toLowerCase(), notes: String(m.notes || "").slice(0, 300) };
  }

  ipcMain.handle("app:version", () => app.getVersion());

  ipcMain.handle("update:check", async () => {
    const current = app.getVersion();
    let m;
    try { m = await readUpdate(); } catch (e) { return { status: "offline", current }; }
    return cmpVer(m.version, current) > 0 ? { status: "available", current, version: m.version, notes: m.notes } : { status: "current", current };
  });

  ipcMain.handle("update:install", async () => {
    try {
      if (!app.isPackaged) return { error: "Updates only install in the packaged app." };
      const m = await readUpdate();
      if (cmpVer(m.version, app.getVersion()) <= 0) return { error: "Already up to date." };
      const buf = await fetchBuf("app.asar", 90000);
      if (buf.length < 1000 || buf.length > 300 * 1024 * 1024) return { error: "The update file looks wrong. Try again later." };
      if (crypto.createHash("sha256").update(buf).digest("hex") !== m.sha256) return { error: "The update is still uploading. Try again in a few minutes." };
      const resDir = process.resourcesPath, asar = path.join(resDir, "app.asar"), staged = path.join(resDir, "app.update.asar");
      const exe = process.execPath;
      if (![asar, staged, exe].every((p) => !/["%]/.test(p))) return { error: "This install folder name has a special character that blocks updating." };
      fs.writeFileSync(staged, buf);
      try { fs.copyFileSync(asar, path.join(resDir, "app.previous.asar")); } catch (e) { /* backup is best effort */ }
      const bat = path.join(app.getPath("userData"), "apply-update.bat");
      fs.writeFileSync(bat, [
        "@echo off", "set n=0", "ping -n 3 127.0.0.1 >nul", ":retry",
        'move /Y "' + staged + '" "' + asar + '" >nul 2>&1', "if not errorlevel 1 goto done",
        "set /a n+=1", "if %n% GEQ 15 goto done", "ping -n 2 127.0.0.1 >nul", "goto retry", ":done",
        'start "" "' + exe + '"', "exit", ""].join("\r\n"));
      spawn("cmd.exe", ["/c", bat], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      setTimeout(() => app.quit(), 250);
      return { ok: true };
    } catch (e) {
      return { error: "Could not download the update. Check the internet connection and try again." };
    }
  });

  ipcMain.handle("login:get", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("login:set", (_e, on) => {
    app.setLoginItemSettings({ openAtLogin: !!on });
    return app.getLoginItemSettings().openAtLogin;
  });

  createWindow();
});

app.on("window-all-closed", () => app.quit());
