const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ledger", {
  load: () => ipcRenderer.invoke("data:load"),
  save: (data) => ipcRenderer.invoke("data:save", data),
  exportData: (data) => ipcRenderer.invoke("data:export", data),
  importData: () => ipcRenderer.invoke("data:import"),
  pickClients: () => ipcRenderer.invoke("clients:pick"),
  notify: (msg) => ipcRenderer.invoke("notify", msg),
  savePdf: (m) => ipcRenderer.invoke("invoice:savePdf", m),
  printInvoice: () => ipcRenderer.invoke("invoice:print"),
  openFolder: (c) => ipcRenderer.invoke("invoice:openFolder", c),
  version: () => ipcRenderer.invoke("app:version"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  getLogin: () => ipcRenderer.invoke("login:get"),
  setLogin: (on) => ipcRenderer.invoke("login:set", on),
});
