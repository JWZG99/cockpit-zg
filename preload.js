// Bridge between the page and the desktop side; the page builds window.claude on top of it (app/claude-shim.js)
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('native', {
  dbAll: () => ipcRenderer.invoke('db-all'),
  dbWrite: (ops) => ipcRenderer.invoke('db-write', ops),
  onDbChanged: (cb) => ipcRenderer.on('db-changed', (_e, store) => cb(store)),
  assetPut: (bytes, name, type) => ipcRenderer.invoke('asset-put', { bytes, name, type }),
  assetDelete: (id) => ipcRenderer.invoke('asset-delete', id),
  saveFile: (filename, bytes) => ipcRenderer.invoke('save-file', { filename, bytes }),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  pickPath: (kind) => ipcRenderer.invoke('pick-path', kind),
  dataDir: () => ipcRenderer.invoke('data-dir'),
  chooseDataDir: () => ipcRenderer.invoke('choose-data-dir'),
  dataStatus: () => ipcRenderer.invoke('data-status'),
  onDataStatus: (cb) => ipcRenderer.on('data-status', (_e, st) => cb(st)),
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (_) { return ''; } },
  listDir: (p) => ipcRenderer.invoke('list-dir', p),
  onAskDataDir: (cb) => ipcRenderer.on('ask-data-dir', () => cb()),
});
