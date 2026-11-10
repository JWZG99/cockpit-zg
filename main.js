// Cockpit ZG desktop: one window, data as small JSON files (on the office server if chosen), files next to it, login with roles
const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const SETTINGS = path.join(app.getPath('userData'), 'einstellungen.json');
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return fallback; } };
let settings = readJson(SETTINGS, {});
// Büro-Ordner auf dem Server: Programm und Daten liegen zusammen darin (ZG, 9.11.2026)
const BUERO = 'G:\\03 Dokumente\\90 ZG Programm';
const BUERO_DATEN = path.join(BUERO, 'Cockpit Daten (alle)'); // gemeinsamer Ordner für alle Benutzer (vorher «Daten»)
const defaultDir = () => (fs.existsSync(BUERO) ? BUERO_DATEN : path.join(app.getPath('documents'), 'Cockpit ZG'));
const dataDir = () => settings.datenOrdner || defaultDir();
const saveSettings = () => { try { fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 1)); } catch (_) {} };
// 2.4: old folder «Daten» becomes «Cockpit Daten (alle)»; the first PC renames it, the others just follow
if (settings.datenOrdner === path.join(BUERO, 'Daten') && fs.existsSync(BUERO)) {
  const alt = path.join(BUERO, 'Daten');
  if (!fs.existsSync(BUERO_DATEN) && fs.existsSync(alt)) { try { fs.renameSync(alt, BUERO_DATEN); } catch (_) {} }
  if (fs.existsSync(BUERO_DATEN)) { settings.datenOrdner = BUERO_DATEN; saveSettings(); }
}
// 2.5.1: ZG's rule: on G: only inside BUERO. A data folder chosen earlier elsewhere on G: (e.g. G:\ itself) moves into BUERO_DATEN;
// only the Cockpit's own files are moved, nothing else in that folder is touched.
const aufG = (p) => /^g:/i.test(String(p || ''));
const inBuero = (p) => { const n = path.resolve(p).toLowerCase(), b = path.resolve(BUERO).toLowerCase(); return n === b || n.startsWith(b + path.sep); };
const zuegeln = (alt, neu) => {
  const mv = (name, ok) => {
    const a = path.join(alt, name), z = path.join(neu, name);
    try {
      if (!fs.existsSync(a) || (ok && !ok(a))) return;
      // the folder in use until now is the current one; an older copy at the target is kept aside, not overwritten
      if (fs.existsSync(z)) fs.renameSync(z, z.replace(/(\.json)?$/, '-vorher-' + Date.now() + '$1'));
      fs.renameSync(a, z);
    } catch (_) {}
  };
  try { fs.mkdirSync(neu, { recursive: true }); } catch (_) { return; }
  const nurCockpit = (re) => (d) => { try { const n = fs.readdirSync(d); return n.length > 0 && n.every((f) => re.test(f)); } catch (_) { return false; } };
  mv('daten', nurCockpit(/^[a-z0-9_.%^-]+\.json$|\.tmp$/i));
  const istDatei = /^[a-f0-9]{32}\.[a-z0-9]+$/i, dA = path.join(alt, 'dateien'), dZ = path.join(neu, 'dateien');
  if (nurCockpit(istDatei)(dA)) {
    try { fs.mkdirSync(dZ, { recursive: true }); fs.readdirSync(dA).forEach((f) => { try { if (!fs.existsSync(path.join(dZ, f))) fs.renameSync(path.join(dA, f), path.join(dZ, f)); } catch (_) {} }); fs.rmdirSync(dA); } catch (_) {}
  }
  ['ki-schluessel.json', 'cockpit-daten.json', 'cockpit-daten-bis-1.4.json'].forEach((f) => mv(f));
};
if (settings.datenOrdner && aufG(settings.datenOrdner) && fs.existsSync(BUERO) && !inBuero(settings.datenOrdner)) {
  zuegeln(settings.datenOrdner, BUERO_DATEN);
  settings.datenOrdnerAlt = settings.datenOrdner; settings.datenOrdner = BUERO_DATEN; saveSettings();
}
// once the office folder has been seen, remember it, so a short G: outage does not switch to a local folder
if (settings.datenOrdner === BUERO_DATEN && fs.existsSync(BUERO)) { try { fs.mkdirSync(settings.datenOrdner, { recursive: true }); } catch (_) {} }
if (!settings.datenOrdner && fs.existsSync(BUERO)) { settings.datenOrdner = BUERO_DATEN; try { fs.mkdirSync(settings.datenOrdner, { recursive: true }); } catch (_) {} saveSettings(); }
const dataFile = () => path.join(dataDir(), 'cockpit-daten.json');
const filesDir = () => path.join(dataDir(), 'dateien');

let store = {}, win = null;
// Since 2.0 every record (project, task, user, day of time tracking …) is its own small file in <data folder>\daten,
// so several people can work at the same time without overwriting each other's changes.
const recDir = () => path.join(dataDir(), 'daten');
const keyToFile = (k) => {
  let o = '';
  for (const ch of String(k)) {
    if (/[a-z0-9_.-]/.test(ch)) o += ch;
    else if (/[A-Z]/.test(ch)) o += '^' + ch.toLowerCase(); // Windows does not tell upper from lower case
    else for (const by of Buffer.from(ch, 'utf8')) o += '%' + by.toString(16).padStart(2, '0');
  }
  return o + '.json';
};
const fileToKey = (f) => {
  const n = f.slice(0, -5); const bytes = [];
  for (let i = 0; i < n.length; i++) {
    if (n[i] === '^') { bytes.push(...Buffer.from(n[++i].toUpperCase())); }
    else if (n[i] === '%') { bytes.push(parseInt(n.substr(i + 1, 2), 16)); i += 2; }
    else bytes.push(n.charCodeAt(i));
  }
  return Buffer.from(bytes).toString('utf8');
};
const known = new Map(); // file name -> mtimeMs we last read or wrote

// Local copy of the last known data, so the program keeps working when the server (e.g. G:) is briefly away.
// Changes made offline are kept in a list and written to the server as soon as it is back.
const MIRROR = path.join(app.getPath('userData'), 'letzte-daten.json');
const PENDING = path.join(app.getPath('userData'), 'ausstehend.json');
let pending = readJson(PENDING, []);
let online = true;
const reachable = () => !settings.datenOrdner || fs.existsSync(dataDir());
let mirrorT = null;
const writeMirror = () => { clearTimeout(mirrorT); mirrorT = setTimeout(() => { try { fs.writeFileSync(MIRROR, JSON.stringify(store)); } catch (_) {} }, 500); };
const status = () => ({ online, dir: dataDir(), ausstehend: pending.length });
const sendStatus = () => { if (win && !win.isDestroyed()) win.webContents.send('data-status', status()); };
const savePending = () => { try { fs.writeFileSync(PENDING, JSON.stringify(pending)); } catch (_) {} };

const readRec = (f) => { try { return JSON.parse(fs.readFileSync(path.join(recDir(), f), 'utf8')); } catch (_) { return undefined; } };
const writeRec = (k) => {
  fs.mkdirSync(recDir(), { recursive: true });
  const f = keyToFile(k), full = path.join(recDir(), f);
  if (store[k] === undefined) { try { fs.unlinkSync(full); } catch (e) { if (e.code !== 'ENOENT') throw e; } known.delete(f); return; }
  const tmp = full + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store[k], null, 1));
  fs.renameSync(tmp, full);
  try { known.set(f, fs.statSync(full).mtimeMs); } catch (_) {}
};
// apply changes; with fresh=true an «update» first reads the current file, so a colleague's change to the same record is kept
const apply = (ops, fresh) => {
  for (const op of ops) {
    if (op.kind === 'set') store[op.path] = op.data;
    else if (op.kind === 'update') {
      const cur = fresh && online ? readRec(keyToFile(op.path)) : undefined;
      store[op.path] = { ...(cur || store[op.path] || {}), ...op.data };
    } else if (op.kind === 'delete') delete store[op.path];
  }
};
const writeKeys = (keys) => { for (const k of new Set(keys)) writeRec(k); };

// Old single file (up to 1.4): split once into the new folder, keep the old file as a backup
const migrate = () => {
  const old = path.join(dataDir(), 'cockpit-daten.json');
  if (fs.existsSync(recDir()) || !fs.existsSync(old)) return;
  const data = readJson(old, null);
  if (!data) return;
  store = data; writeKeys(Object.keys(store));
  try { fs.renameSync(old, path.join(dataDir(), 'cockpit-daten-bis-1.4.json')); } catch (_) {}
};
// Read all records from the server; false when it cannot be reached (then nothing is replaced)
const loadAll = () => {
  if (!reachable()) return false;
  try { migrate(); } catch (_) { return false; }
  let names;
  try { names = fs.readdirSync(recDir()); } catch (e) { return e.code === 'ENOENT' ? 'leer' : false; }
  const next = {};
  known.clear();
  for (const f of names) {
    if (!f.endsWith('.json')) continue;
    const k = fileToKey(f);
    const v = readRec(f);
    next[k] = v !== undefined ? v : store[k];
    if (next[k] === undefined) delete next[k];
    try { known.set(f, fs.statSync(path.join(recDir(), f)).mtimeMs); } catch (_) {}
  }
  store = next; writeMirror();
  return true;
};
const changed = () => { if (win && !win.isDestroyed()) win.webContents.send('db-changed', publicStore()); };
// Every 3 s: look for records colleagues have added, changed or deleted
const poll = () => {
  if (!online) return;
  let names;
  try { names = fs.readdirSync(recDir()); } catch (_) { return; }
  let diff = false;
  const seen = new Set();
  for (const f of names) {
    if (!f.endsWith('.json')) continue;
    seen.add(f);
    let m; try { m = fs.statSync(path.join(recDir(), f)).mtimeMs; } catch (_) { continue; }
    if (known.get(f) === m) continue;
    const v = readRec(f);
    if (v === undefined) continue; // half written, next round
    store[fileToKey(f)] = v; known.set(f, m); diff = true;
  }
  for (const f of [...known.keys()]) if (!seen.has(f)) { delete store[fileToKey(f)]; known.delete(f); diff = true; }
  if (diff) { writeMirror(); changed(); }
};
// Start: server if reachable, otherwise the local copy
const start = () => {
  const r = loadAll();
  if (r === true) online = true;
  else if (r === 'leer') { online = true; store = readJson(MIRROR, {}); if (Object.keys(store).length) { try { writeKeys(Object.keys(store)); } catch (_) { online = false; } } }
  else { online = false; store = readJson(MIRROR, {}); }
  if (online && pending.length) reconnect();
};
// Server back: take its current state, add what was changed offline, write those records back
const reconnect = () => {
  const r = loadAll();
  if (r === false) return;
  online = true;
  if (pending.length) {
    const ops = pending; pending = []; savePending();
    apply(ops, false);
    try { writeKeys(ops.map((o) => o.path)); } catch (_) { online = false; pending = ops; savePending(); }
  }
  writeMirror(); changed(); sendStatus();
};
setInterval(() => {
  const ok = reachable();
  if (!online && ok) reconnect();
  else if (online && !ok) { online = false; sendStatus(); }
}, 10000);
setInterval(poll, 3000);

const commit = (ops) => {
  apply(ops, true);
  writeMirror();
  if (online && !reachable()) { online = false; sendStatus(); }
  if (online) {
    try { writeKeys(ops.map((o) => o.path)); return; } catch (_) { online = false; }
  }
  pending.push(...ops); savePending(); sendStatus();
};

/* ---------- Anmeldung und Rollen ---------- */
// Users are records «benutzer/<id>» {name, kuerzel, rolle: mitarbeiter|chef|admin, aktiv, pw: {salt, hash}}.
// The page never sees the password hashes and cannot write users directly; that goes through the calls below.
const SESSION = path.join(app.getPath('userData'), 'anmeldung.json');
const IDLE_MS = 8 * 60 * 60 * 1000; // logged out after 8 hours without use
let session = readJson(SESSION, null);
const users = () => Object.keys(store).filter((k) => k.startsWith('benutzer/') && k.split('/').length === 2).map((k) => ({ id: k.slice(9), ...store[k] }));
const userById = (id) => (store['benutzer/' + id] ? { id, ...store['benutzer/' + id] } : null);
const me = () => {
  if (!session || Date.now() - session.at > IDLE_MS) return null;
  const u = userById(session.id);
  return u && u.aktiv !== false ? { id: u.id, name: u.name, kuerzel: u.kuerzel || '', rolle: u.rolle || 'mitarbeiter' } : null;
};
const touch = () => { if (session && Date.now() - session.at > 60000) { session.at = Date.now(); try { fs.writeFileSync(SESSION, JSON.stringify(session)); } catch (_) {} } };
const isBoss = () => { const m = me(); return !!m && (m.rolle === 'chef' || m.rolle === 'admin'); };
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const newPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: hashPw(pw, salt) }; };
const pwOk = (u, pw) => { if (!u || !u.pw) return false; const h = Buffer.from(hashPw(pw, u.pw.salt), 'hex'); const w = Buffer.from(u.pw.hash, 'hex'); return h.length === w.length && crypto.timingSafeEqual(h, w); };
const publicUser = (u) => ({ id: u.id, name: u.name, kuerzel: u.kuerzel || '', rolle: u.rolle || 'mitarbeiter', aktiv: u.aktiv !== false });
// Wer sieht was (ZG, 10.11.2026): Projekte sind global, werden nur vom Administrator oder Chef eröffnet; jeder wählt unter
// «Projekte wählen», an welchen er arbeitet («mitglieder»), und sieht in seinen Ansichten nur diese. Aufgaben und Termine gehören der Person, die sie
// erstellt hat («von»); sie sieht nur diese, der Chef und der Administrator sehen alle. Ältere Einträge ohne «von» gehören
// dem Administrator. Private Daten (data/users/<id>) sieht ein Mitarbeiter nur von sich selbst.
const PERSOENLICH = /^(aufgaben|termine)\/[^/]+$/;
const adminId = () => { const a = users().find((u) => u.rolle === 'admin'); return a ? a.id : null; };
const besitzer = (v) => (v && v.von) || adminId();
const darfSehen = (k, m) => {
  if (!m) return false;
  if (m.rolle === 'chef' || m.rolle === 'admin') return true;
  if (PERSOENLICH.test(k)) return besitzer(store[k]) === m.id;
  if (k.startsWith('data/users/')) return k.startsWith('data/users/' + m.id + '/');
  return true;
};
const publicStore = () => {
  const o = {}, m = me();
  for (const k of Object.keys(store)) {
    if (!darfSehen(k, m)) continue;
    if (k.startsWith('benutzer/')) { const { pw, ...rest } = store[k] || {}; o[k] = rest; }
    else o[k] = store[k];
  }
  return o;
};
// Schreibregeln für die Seite und den Assistenten: neue Aufgaben/Termine bekommen «von»; ein Mitarbeiter ändert nur Eigenes
// und an Projekten nur Kleinigkeiten (Reihenfolge, Mindmap, verknüpfte Dateien), keine neuen Projekte und keine Mitglieder.
const regeln = (ops) => {
  const m = me(); if (!m) return [];
  const boss = m.rolle === 'chef' || m.rolle === 'admin';
  return (ops || []).filter((o) => o && typeof o.path === 'string' && !o.path.startsWith('benutzer/')).map((o) => {
    const k = o.path, alt = store[k];
    if (PERSOENLICH.test(k)) {
      if (alt !== undefined && !boss && besitzer(alt) !== m.id) return null;
      if (o.kind === 'set') return { ...o, data: { ...(o.data || {}), von: alt !== undefined ? besitzer(alt) : (o.data && o.data.von) || m.id } };
      if (o.kind === 'update' && o.data && 'von' in o.data && !boss) { const { von, ...rest } = o.data; return { ...o, data: rest }; }
      return o;
    }
    if (/^projekte\/[^/]+$/.test(k) && !boss) {
      if (o.kind !== 'update' || alt === undefined) return null;
      const altM = Array.isArray(alt.mitglieder) ? alt.mitglieder : [];
      const { mitglieder, ...rest } = o.data || {};
      const data = altM.includes(m.id) ? rest : {}; // andere Felder nur an eigenen Projekten
      // in «Projekte wählen» trägt sich ein Mitarbeiter nur selbst ein oder aus
      if (Array.isArray(mitglieder)) data.mitglieder = altM.filter((x) => x !== m.id).concat(mitglieder.includes(m.id) ? [m.id] : []);
      return Object.keys(data).length ? { ...o, data } : null;
    }
    if (k.startsWith('data/users/') && !boss && !k.startsWith('data/users/' + m.id + '/')) return null;
    return o;
  }).filter(Boolean);
};
const showPage = () => { if (win && !win.isDestroyed()) win.loadURL(me() ? 'app://cockpit/index.html' : 'app://cockpit/anmelden.html'); };
const userId = () => crypto.randomBytes(5).toString('hex');

// Administrator wird nur ganz am Anfang angelegt (leerer gemeinsamer Datenordner, Server erreichbar). Neue Leute legen sich
// selbst als Mitarbeiter an; Chef oder Administrator macht nur der Administrator unter «Team» (ZG, 10.11.2026).
const serverDa = () => online && fs.existsSync(BUERO) && fs.existsSync(dataDir());
ipcMain.handle('auth-state', () => ({
  einrichten: !users().length && serverDa(),
  keinServer: !users().length && !serverDa(),
  online,
  benutzer: users().filter((u) => u.aktiv !== false).map(publicUser).sort((a, b) => a.name.localeCompare(b.name, 'de')),
  ich: me(),
}));
// First start: the first person becomes administrator; the data of the single-user version (user «lokal») becomes theirs
ipcMain.handle('auth-setup', (_e, { name, kuerzel, pw }) => {
  if (users().length) return { ok: false, error: 'Es gibt schon Benutzer.' };
  if (!serverDa()) return { ok: false, error: 'Der Server ist nicht erreichbar. Bitte zuerst G: verbinden.' };
  if (!String(name || '').trim() || String(pw || '').length < 4) return { ok: false, error: 'Name und ein Passwort mit mindestens 4 Zeichen eingeben.' };
  const id = userId();
  const ops = [{ kind: 'set', path: 'benutzer/' + id, data: { name: String(name).trim(), kuerzel: String(kuerzel || '').trim().toUpperCase(), rolle: 'admin', aktiv: true, pw: newPw(pw), erstellt: new Date().toISOString() } }];
  for (const k of Object.keys(store)) if (k.startsWith('data/users/lokal/')) { ops.push({ kind: 'set', path: 'data/users/' + id + '/' + k.slice(17), data: store[k] }); ops.push({ kind: 'delete', path: k }); }
  commit(ops);
  session = { id, at: Date.now() }; fs.writeFileSync(SESSION, JSON.stringify(session));
  showPage();
  return { ok: true };
});
// Neu im Büro: selbst als Mitarbeiter anmelden
ipcMain.handle('auth-register', (_e, { name, kuerzel, pw }) => {
  if (!users().length) return { ok: false, error: 'Zuerst muss der Administrator eingerichtet sein.' };
  if (!online) return { ok: false, error: 'Der Server ist nicht erreichbar. Bitte zuerst G: verbinden.' };
  name = String(name || '').trim(); kuerzel = String(kuerzel || '').trim().toUpperCase().slice(0, 4);
  if (!name || String(pw || '').length < 4) return { ok: false, error: 'Name und ein Passwort mit mindestens 4 Zeichen eingeben.' };
  if (users().some((u) => u.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'Diesen Namen gibt es schon. Wähl ihn in der Liste, oder lass dein Passwort unter «Team» neu setzen.' };
  if (kuerzel && users().some((u) => (u.kuerzel || '').toUpperCase() === kuerzel)) return { ok: false, error: 'Dieses Kürzel ist schon vergeben.' };
  const id = userId();
  commit([{ kind: 'set', path: 'benutzer/' + id, data: { name, kuerzel, rolle: 'mitarbeiter', aktiv: true, pw: newPw(pw), erstellt: new Date().toISOString(), selbst: true } }]);
  session = { id, at: Date.now() }; fs.writeFileSync(SESSION, JSON.stringify(session));
  showPage();
  return { ok: true };
});
ipcMain.handle('auth-login', (_e, { id, pw }) => {
  const u = userById(String(id || ''));
  if (!u || u.aktiv === false || !pwOk(u, pw)) return { ok: false, error: 'Passwort stimmt nicht.' };
  session = { id: u.id, at: Date.now() }; fs.writeFileSync(SESSION, JSON.stringify(session));
  showPage();
  return { ok: true };
});
ipcMain.handle('auth-logout', () => { session = null; try { fs.unlinkSync(SESSION); } catch (_) {} showPage(); return { ok: true }; });
ipcMain.handle('auth-me', () => me());
ipcMain.handle('auth-password', (_e, { alt, neu }) => {
  const m = me(); const u = m && userById(m.id);
  if (!u || !pwOk(u, alt)) return { ok: false, error: 'Das bisherige Passwort stimmt nicht.' };
  if (String(neu || '').length < 4) return { ok: false, error: 'Das neue Passwort braucht mindestens 4 Zeichen.' };
  commit([{ kind: 'update', path: 'benutzer/' + u.id, data: { pw: newPw(neu) } }]); changed();
  return { ok: true };
});
// Team: chef and administrator create people and reset passwords; only an administrator hands out the roles chef and admin
ipcMain.handle('team-list', () => (isBoss() ? users().map(publicUser).sort((a, b) => a.name.localeCompare(b.name, 'de')) : []));
ipcMain.handle('team-save', (_e, d) => {
  const m = me();
  if (!isBoss()) return { ok: false, error: 'Nur Chef und Administrator dürfen das.' };
  const rollen = ['mitarbeiter', 'chef', 'admin'];
  const rolle = rollen.includes(d.rolle) ? d.rolle : 'mitarbeiter';
  const alt = d.id ? userById(d.id) : null;
  if (d.id && !alt) return { ok: false, error: 'Benutzer nicht gefunden.' };
  if (m.rolle !== 'admin' && (rolle !== 'mitarbeiter' || (alt && alt.rolle && alt.rolle !== 'mitarbeiter'))) return { ok: false, error: 'Rollen Chef und Administrator vergibt nur der Administrator.' };
  if (alt && alt.id === m.id && (rolle !== m.rolle || d.aktiv === false)) return { ok: false, error: 'Die eigene Rolle kannst du nicht ändern.' };
  if (!String(d.name || '').trim()) return { ok: false, error: 'Name fehlt.' };
  if (!alt && String(d.pw || '').length < 4) return { ok: false, error: 'Start-Passwort mit mindestens 4 Zeichen eingeben.' };
  if (d.pw && String(d.pw).length < 4) return { ok: false, error: 'Das Passwort braucht mindestens 4 Zeichen.' };
  const id = alt ? alt.id : userId();
  const data = { name: String(d.name).trim(), kuerzel: String(d.kuerzel || '').trim().toUpperCase(), rolle, aktiv: d.aktiv !== false };
  if (d.pw) data.pw = newPw(d.pw);
  commit([alt ? { kind: 'update', path: 'benutzer/' + id, data } : { kind: 'set', path: 'benutzer/' + id, data: { ...data, erstellt: new Date().toISOString() } }]);
  changed();
  return { ok: true, id };
});

ipcMain.handle('db-all', () => (me() ? publicStore() : {}));
ipcMain.handle('db-write', (_e, ops) => {
  if (!me()) return false;
  ops = regeln(ops);
  touch();
  if (ops.length) commit(ops);
  changed();
  return true;
});
ipcMain.handle('data-status', () => status());
// Contents of a folder (e.g. a project folder on G:), folders first
const listDir = (p) => {
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
};
ipcMain.handle('list-dir', (_e, p) => listDir(p));
// Seite «Server»: im Explorer zeigen, neuer Ordner, löschen (mit Rückfrage)
const cleanP = (p) => String(p || '').trim().replace(/^"(.*)"$/, '$1');
const isRoot = (p) => { const r = path.parse(p).root; return !p || path.resolve(p) === path.resolve(r) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(p); };
const geschuetzt = (p) => {
  const n = path.resolve(p).toLowerCase();
  const prot = [BUERO, dataDir(), app.getPath('userData'), path.dirname(app.getPath('exe'))].map((x) => path.resolve(x).toLowerCase());
  return isRoot(p) || prot.some((x) => n === x || x.startsWith(n + path.sep));
};
ipcMain.handle('show-in-folder', (_e, p) => { p = cleanP(p); if (fs.existsSync(p)) shell.showItemInFolder(p); return { ok: true }; });
ipcMain.handle('make-dir', (_e, { in: inDir, name }) => {
  name = String(name || '').trim();
  if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /^\.+$/.test(name) || /[. ]$/.test(name)) return { ok: false, error: 'Dieser Name geht nicht (keine Zeichen wie \\ / : * ? " < > |).' };
  const full = path.join(cleanP(inDir), name);
  if (fs.existsSync(full)) return { ok: false, error: 'Diesen Ordner gibt es schon.' };
  try { fs.mkdirSync(full); return { ok: true, path: full }; } catch (e) { return { ok: false, error: e.code === 'EPERM' || e.code === 'EACCES' ? 'Keine Berechtigung für diesen Ordner.' : 'Ordner anlegen ging nicht.' }; }
});
// Verschieben (Standard) oder kopieren (Ctrl) per Ziehen auf der Seite «Server»
ipcMain.handle('move-path', async (_e, { von, nach, kopie }) => {
  von = cleanP(von); nach = cleanP(nach);
  if (!von || !fs.existsSync(von)) return { ok: false, error: 'Nicht gefunden.' };
  if (!nach || !fs.existsSync(nach) || !fs.statSync(nach).isDirectory()) return { ok: false, error: 'Zielordner nicht gefunden.' };
  if (!kopie && geschuetzt(von)) return { ok: false, error: 'Diesen Ordner kann man nicht verschieben (Laufwerk oder Cockpit-Ordner).' };
  const ziel = path.join(nach, path.basename(von));
  const nv = path.resolve(von).toLowerCase(), nz = path.resolve(ziel).toLowerCase();
  if (nv === nz) return { ok: false, error: 'Liegt schon dort.' };
  if (nz.startsWith(nv + path.sep)) return { ok: false, error: 'Ein Ordner kann nicht in sich selbst verschoben werden.' };
  if (fs.existsSync(ziel)) return { ok: false, error: '«' + path.basename(von) + '» gibt es im Zielordner schon.' };
  const busy = (e) => (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY' ? 'keine Berechtigung, oder eine Datei darin ist noch offen.' : 'Fehler ' + (e.code || ''));
  try {
    if (kopie) fs.cpSync(von, ziel, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    else {
      try { fs.renameSync(von, ziel); }
      catch (e) {
        if (e.code !== 'EXDEV') throw e;
        fs.cpSync(von, ziel, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
        fs.rmSync(von, { recursive: true });
      }
    }
  } catch (e) { return { ok: false, error: (kopie ? 'Kopieren' : 'Verschieben') + ' ging nicht: ' + busy(e) }; }
  return { ok: true, ziel };
});
ipcMain.handle('delete-path', async (_e, p) => {
  p = cleanP(p);
  if (!p || !fs.existsSync(p)) return { ok: false, error: 'Nicht gefunden.' };
  if (geschuetzt(p)) return { ok: false, error: 'Diesen Ordner kann man hier nicht löschen (Laufwerk oder Cockpit-Ordner).' };
  let st; try { st = fs.statSync(p); } catch (_) { return { ok: false, error: 'Nicht lesbar.' }; }
  let inhalt = '';
  if (st.isDirectory()) { try { const n = fs.readdirSync(p).length; inhalt = n ? 'Er enthält ' + n + (n === 1 ? ' Eintrag' : ' Einträge') + ' (mit allen Unterordnern).' : 'Er ist leer.'; } catch (_) {} }
  const lokal = /^c:/i.test(p);
  const r = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Abbrechen', 'Löschen'], defaultId: 0, cancelId: 0, noLink: true, title: 'Löschen',
    message: (st.isDirectory() ? 'Ordner' : 'Datei') + ' «' + path.basename(p) + '» löschen?',
    detail: [p, inhalt, lokal ? 'Er kommt in den Papierkorb.' : 'Achtung: Auf dem Server gibt es keinen Windows-Papierkorb. Danach ist es weg (nur noch über die Server-Sicherung zurückzuholen).'].filter(Boolean).join('\n\n'),
  });
  if (r.response !== 1) return { ok: false, abgebrochen: true };
  try { await shell.trashItem(p); }
  catch (_) {
    try { fs.rmSync(p, { recursive: true }); } catch (e) { return { ok: false, error: e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY' ? 'Löschen ging nicht: keine Berechtigung, oder eine Datei darin ist noch offen.' : 'Löschen ging nicht.' }; }
  }
  return { ok: true };
});
// Assistent (Claude) im Programm
require('./ki')({ ipcMain, dataDir, getStore: () => publicStore(), commit: (ops) => { const r = regeln(ops); if (r.length) commit(r); }, changed, me, isAdmin: () => { const m = me(); return !!m && m.rolle === 'admin'; }, listDir });

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
  const m = me();
  if (users().length && (!m || m.rolle !== 'admin')) return dataDir(); // only the administrator moves the data
  const r = await dialog.showOpenDialog(win, { title: 'Ordner für die Cockpit-Daten wählen (z. B. auf dem Server)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return dataDir();
  if (aufG(r.filePaths[0]) && !inBuero(r.filePaths[0])) { await dialog.showMessageBox(win, { type: 'info', message: 'Auf G: nur im Ordner «90 ZG Programm».', detail: 'Bitte einen Ordner in ' + BUERO + ' wählen, damit sonst nichts auf G: abgelegt wird.' }); return dataDir(); }
  const old = { store: { ...store }, dir: dataDir() };
  settings.datenOrdner = r.filePaths[0];
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 1));
  online = true;
  const hasData = fs.existsSync(recDir()) || fs.existsSync(path.join(dataDir(), 'cockpit-daten.json'));
  if (hasData) { loadAll(); if (pending.length) reconnect(); }
  else {
    // first use of the new folder: take the current data and files along
    store = old.store;
    try { writeKeys(Object.keys(store)); } catch (_) { online = false; }
    try { fs.cpSync(path.join(old.dir, 'dateien'), filesDir(), { recursive: true }); } catch (_) {}
  }
  changed(); sendStatus();
  if (!me()) showPage();
  return dataDir();
});

// Projekte und Studien aus G:\01 Bauten nach Nummern (beim Start, alle 10 Minuten und auf Knopfdruck)
const bauten = require('./bauten');
const bautenAbgleich = () => {
  if (!online) return { ok: false, error: 'Der Server ist nicht erreichbar.' };
  let r; try { r = bauten.abgleichen(store); } catch (e) { return { ok: false, error: 'Abgleich ging nicht.' }; }
  if (r.fehler) return { ok: false, error: r.fehler };
  if (r.ops.length) { commit(r.ops); changed(); }
  return { ok: true, neu: r.neu, geaendert: r.ops.length - r.neu, bauten: r.bauten, studien: r.studien };
};
ipcMain.handle('bauten-abgleichen', () => { const m = me(); if (!m) return { ok: false }; return bautenAbgleich(); });
setInterval(() => { try { bautenAbgleich(); } catch (_) {} }, 10 * 60 * 1000);

// Was das Programm gerade macht (Startbildschirm und Hinweis oben rechts) und Updates über G:
const upd = require('./buero-update')({ app, BUERO, dialog });
let aktiv = null, updGemeldet = null;
const setAktiv = (t, pct) => { aktiv = t ? { t, pct: pct == null ? null : pct } : null; if (win && !win.isDestroyed()) win.webContents.send('aktivitaet', aktiv); };
ipcMain.handle('aktivitaet', () => aktiv);
ipcMain.handle('update-bereit', () => upd.bereit());
ipcMain.handle('update-installieren', () => {
  try { if (!upd.installieren()) return { ok: false, error: 'Kein Update gefunden.' }; } catch (_) { return { ok: false, error: 'Update holen ging nicht. Ist G: verbunden?' }; }
  setAktiv('Update wird installiert, das Cockpit startet gleich neu …');
  setTimeout(() => app.quit(), 600);
  return { ok: true };
});
const updPruefen = () => { try { const v = upd.bereit(); if (v && v !== updGemeldet) { updGemeldet = v; if (win && !win.isDestroyed()) win.webContents.send('update-bereit', v); } } catch (_) {} };
setInterval(updPruefen, 5 * 60 * 1000);

const createWindow = () => {
  win = new BrowserWindow({
    width: 1320, height: 920, minWidth: 720, minHeight: 560, title: 'Cockpit ZG', backgroundColor: '#f2f2f7',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.webContents.on('did-finish-load', () => { if (aktiv) win.webContents.send('aktivitaet', aktiv); const v = upd.bereit(); if (v) win.webContents.send('update-bereit', v); });
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Cockpit', submenu: [
      { label: 'Datenordner wählen …', click: () => win && win.webContents.send('ask-data-dir') },
      { label: 'Datenordner öffnen', click: () => shell.openPath(dataDir()) },
      { type: 'separator' },
      { label: 'Version ' + app.getVersion(), enabled: false },
      { type: 'separator' },
      { role: 'quit', label: 'Beenden' },
    ] },
    { label: 'Bearbeiten', submenu: [{ role: 'undo', label: 'Widerrufen' }, { role: 'redo', label: 'Wiederholen' }, { type: 'separator' }, { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einfügen' }, { role: 'selectAll', label: 'Alles auswählen' }] },
    { label: 'Ansicht', submenu: [{ role: 'reload', label: 'Neu laden' }, { role: 'resetZoom', label: 'Originalgrösse' }, { role: 'zoomIn', label: 'Vergrössern' }, { role: 'zoomOut', label: 'Verkleinern' }, { role: 'togglefullscreen', label: 'Vollbild' }] },
  ]));
  createWindow();
  // Startbildschirm zuerst, dann die Daten von G: laden (das kann bei langsamem Netz ein paar Sekunden dauern)
  setAktiv(fs.existsSync(BUERO) ? 'Verbinde mit dem Server G: …' : 'Server G: nicht gefunden, lade die lokale Kopie …');
  win.loadURL('app://cockpit/laden.html');
  win.webContents.once('did-finish-load', () => setTimeout(() => {
    setAktiv('Lade die Daten …');
    setTimeout(() => {
      start();
      setAktiv('Projekte mit G: abgleichen …');
      try { bautenAbgleich(); } catch (_) {}
      setAktiv(null);
      showPage();
      updPruefen();
      try { if (upd.sollAblegen()) upd.ablegen(setAktiv).catch(() => setAktiv(null)); } catch (_) {}
    }, 30);
  }, 30));
});
app.on('window-all-closed', () => app.quit());
