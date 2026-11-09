// Cockpit ZG desktop: one window, data in a JSON file (on the office server if chosen), files next to it
const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const SETTINGS = path.join(app.getPath('userData'), 'einstellungen.json');
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return fallback; } };
let settings = readJson(SETTINGS, {});
const dataDir = () => settings.datenOrdner || path.join(app.getPath('documents'), 'Cockpit ZG');
const dataFile = () => path.join(dataDir(), 'cockpit-daten.json');
const filesDir = () => path.join(dataDir(), 'dateien');

let store = {}, win = null, lastWrite = 0;
// Local copy of the last known data, so the program keeps working when the server (e.g. G:) is briefly away.
// Changes made offline are kept in a list and written to the server as soon as it is back.
const MIRROR = path.join(app.getPath('userData'), 'letzte-daten.json');
const PENDING = path.join(app.getPath('userData'), 'ausstehend.json');
let pending = readJson(PENDING, []);
let online = true;
const reachable = () => !settings.datenOrdner || fs.existsSync(dataDir());
const writeMirror = () => { try { fs.writeFileSync(MIRROR, JSON.stringify(store)); } catch (_) {} };
const status = () => ({ online, dir: dataDir(), ausstehend: pending.length });
const sendStatus = () => { if (win && !win.isDestroyed()) win.webContents.send('data-status', status()); };
const apply = (ops) => {
  for (const op of ops) {
    if (op.kind === 'set') store[op.path] = op.data;
    else if (op.kind === 'update') store[op.path] = { ...(store[op.path] || {}), ...op.data };
    else if (op.kind === 'delete') delete store[op.path];
  }
};
// Read the server file; never replace good data by an empty or half-read file
const load = () => {
  if (!reachable()) return false;
  let txt;
  try { txt = fs.readFileSync(dataFile(), 'utf8'); } catch (e) { return e.code === 'ENOENT' ? 'fehlt' : false; }
  try { store = JSON.parse(txt); writeMirror(); return true; } catch (_) { return false; }
};
const saveServer = () => {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 1));
  fs.renameSync(tmp, dataFile());
  lastWrite = Date.now();
};
const save = () => {
  writeMirror();
  if (online && !reachable()) { online = false; sendStatus(); }
  if (!online) return false;
  try { saveServer(); return true; } catch (_) { online = false; sendStatus(); return false; }
};
const changed = () => { if (win && !win.isDestroyed()) win.webContents.send('db-changed', store); };
const watch = () => {
  fs.unwatchFile(dataFile());
  // polling, because change events do not arrive reliably from network shares
  fs.watchFile(dataFile(), { interval: 3000 }, () => { if (online && Date.now() - lastWrite > 2000 && load() === true) changed(); });
};
// Start: server file if reachable, otherwise the local copy
const start = () => {
  const r = load();
  if (r === true) online = true;
  else if (r === 'fehlt') { online = true; store = readJson(MIRROR, {}); if (Object.keys(store).length) save(); }
  else { online = false; store = readJson(MIRROR, {}); }
  if (online && pending.length) reconnect();
};
// Server back: take its current state, add what was changed offline, write it back
const reconnect = () => {
  const r = load();
  if (r === false) return;
  if (r === 'fehlt') store = readJson(MIRROR, store);
  online = true;
  if (pending.length) { apply(pending); pending = []; try { fs.writeFileSync(PENDING, '[]'); } catch (_) {} save(); }
  writeMirror(); watch(); changed(); sendStatus();
};
setInterval(() => {
  const ok = reachable();
  if (!online && ok) reconnect();
  else if (online && !ok) { online = false; sendStatus(); }
}, 10000);

ipcMain.handle('db-all', () => store);
ipcMain.handle('db-write', (_e, ops) => {
  apply(ops);
  if (!online || !save()) {
    pending.push(...ops);
    try { fs.writeFileSync(PENDING, JSON.stringify(pending)); } catch (_) {}
    sendStatus();
  }
  changed();
  return true;
});
ipcMain.handle('data-status', () => status());
// Contents of a folder (e.g. a project folder on G:), folders first
ipcMain.handle('list-dir', (_e, p) => {
  p = String(p || '').trim().replace(/^"(.*)"$/, '$1');
  try {
    const items = fs.readdirSync(p, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.') && !/^(desktop\.ini|thumbs\.db|~\$.*)$/i.test(d.name))
      .map((d) => {
        const full = path.join(p, d.name);
        let st = null; try { st = fs.statSync(full); } catch (_) {}
        return { name: d.name, path: full, ordner: d.isDirectory(), groesse: st ? st.size : 0, geaendert: st ? st.mtimeMs : 0 };
      })
      .sort((a, b) => (b.ordner - a.ordner) || a.name.localeCompare(b.name, 'de'));
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: e.code === 'ENOENT' ? 'Ordner nicht gefunden. Ist der Server verbunden?' : 'Ordner nicht lesbar.' };
  }
});

const TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json', mp4: 'video/mp4', webm: 'video/webm' };
const findAsset = (id) => {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  try { const f = fs.readdirSync(filesDir()).find((n) => n.startsWith(id)); return f ? path.join(filesDir(), f) : null; } catch (_) { return null; }
};
ipcMain.handle('asset-put', (_e, { bytes, name, type }) => {
  fs.mkdirSync(filesDir(), { recursive: true });
  const id = crypto.randomBytes(16).toString('hex');
  const ext = (path.extname(name || '').slice(1) || Object.keys(TYPES).find((k) => TYPES[k] === type) || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  fs.writeFileSync(path.join(filesDir(), id + '.' + ext), Buffer.from(bytes));
  return { id, url: '/_blob/' + id, sizeBytes: bytes.byteLength, contentType: type || TYPES[ext] || 'application/octet-stream' };
});
ipcMain.handle('asset-delete', (_e, id) => { const f = findAsset(String(id).replace('/_blob/', '')); if (f) fs.unlinkSync(f); return { deleted: !!f }; });

// PDFs and other exports: ask where to save, then open with the default program (e.g. PDF-XChange)
ipcMain.handle('save-file', async (_e, { filename, bytes }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(settings.exportOrdner || app.getPath('documents'), filename) });
  if (r.canceled || !r.filePath) return { declined: true };
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  settings.exportOrdner = path.dirname(r.filePath); fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 1));
  if (/\.pdf$/i.test(r.filePath)) shell.openPath(r.filePath);
  return { path: r.filePath };
});

// Server paths: folders open in Explorer, documents in their program; programs and scripts are only shown, never started
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|lnk|hta|cpl|reg|jar|appref-ms)$/i;
ipcMain.handle('open-path', async (_e, p) => {
  p = String(p || '').trim().replace(/^"(.*)"$/, '$1');
  if (/^https?:\/\//i.test(p)) { await shell.openExternal(p); return { ok: true }; }
  if (/^file:/i.test(p)) { try { p = require('url').fileURLToPath(p); } catch (_) {} }
  if (!fs.existsSync(p)) return { ok: false, error: 'Pfad nicht gefunden. Ist der Server verbunden?' };
  if (RUNNABLE.test(p)) { shell.showItemInFolder(p); return { ok: true }; }
  const err = await shell.openPath(p);
  return err ? { ok: false, error: err } : { ok: true };
});
ipcMain.handle('pick-path', async (_e, kind) => {
  const r = await dialog.showOpenDialog(win, { properties: kind === 'ordner' ? ['openDirectory'] : ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('data-dir', () => dataDir());
ipcMain.handle('choose-data-dir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Ordner für die Cockpit-Daten wählen (z. B. auf dem Server)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return dataDir();
  const old = { store, dir: dataDir() };
  settings.datenOrdner = r.filePaths[0];
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 1));
  online = true;
  if (fs.existsSync(dataFile())) { load(); if (pending.length) reconnect(); }
  else {
    // first use of the new folder: take the current data and files along
    store = old.store; save();
    try { fs.cpSync(path.join(old.dir, 'dateien'), filesDir(), { recursive: true }); } catch (_) {}
  }
  watch(); changed(); sendStatus();
  return dataDir();
});

const createWindow = () => {
  win = new BrowserWindow({
    width: 1320, height: 920, minWidth: 720, minHeight: 560, title: 'Cockpit ZG', backgroundColor: '#f2f2f7',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadURL('app://cockpit/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
};

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    if (u.pathname.startsWith('/_blob/')) {
      const f = findAsset(u.pathname.slice(7));
      return f ? net.fetch(pathToFileURL(f).toString()) : new Response('', { status: 404 });
    }
    const f = path.normalize(path.join(__dirname, 'app', decodeURIComponent(u.pathname)));
    if (!f.startsWith(path.join(__dirname, 'app'))) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(f).toString());
  });
  start(); watch();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Cockpit', submenu: [
      { label: 'Datenordner wählen …', click: () => win && win.webContents.send('ask-data-dir') },
      { label: 'Datenordner öffnen', click: () => shell.openPath(dataDir()) },
      { type: 'separator' },
      { label: 'Nach Updates suchen', click: () => autoUpdater.checkForUpdatesAndNotify().catch(() => {}) },
      { type: 'separator' },
      { role: 'quit', label: 'Beenden' },
    ] },
    { label: 'Bearbeiten', submenu: [{ role: 'undo', label: 'Widerrufen' }, { role: 'redo', label: 'Wiederholen' }, { type: 'separator' }, { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einfügen' }, { role: 'selectAll', label: 'Alles auswählen' }] },
    { label: 'Ansicht', submenu: [{ role: 'reload', label: 'Neu laden' }, { role: 'resetZoom', label: 'Originalgrösse' }, { role: 'zoomIn', label: 'Vergrössern' }, { role: 'zoomOut', label: 'Verkleinern' }, { role: 'togglefullscreen', label: 'Vollbild' }] },
  ]));
  createWindow();
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});
app.on('window-all-closed', () => app.quit());
