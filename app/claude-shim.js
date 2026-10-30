// The cockpit page was written against the claude.ai artifact runtime (window.claude.use(...)).
// In the desktop program the same calls go to a JSON file through window.native.
(() => {
  const N = window.native;
  if (!N) return;
  let store = {};
  const ready = N.dbAll().then((s) => { store = s || {}; });
  const listeners = new Set();
  const notify = () => listeners.forEach((l) => { try { l(); } catch (e) { console.error(e); } });
  N.onDbChanged((s) => { store = s || {}; notify(); });

  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const write = async (ops) => {
    // apply locally first so the page reacts at once, the file follows
    for (const op of ops) {
      if (op.kind === 'set') store[op.path] = op.data;
      else if (op.kind === 'update') store[op.path] = { ...(store[op.path] || {}), ...op.data };
      else store[op.path] = undefined, delete store[op.path];
    }
    notify();
    await N.dbWrite(JSON.parse(JSON.stringify(ops)));
  };

  const docSnap = (path) => {
    const v = store[path];
    return { id: path.split('/').pop(), exists: v !== undefined, data: () => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))), metadata: { hasPendingWrites: false } };
  };
  const docRef = (path) => ({
    id: path.split('/').pop(),
    set: (data) => write([{ kind: 'set', path, data }]),
    update: (data) => {
      if (store[path] === undefined) return Promise.reject({ code: 'not_found', message: 'Dokument fehlt' });
      return write([{ kind: 'update', path, data }]);
    },
    delete: () => write([{ kind: 'delete', path }]),
    get: async () => { await ready; return docSnap(path); },
    onSnapshot: (cb) => {
      const l = () => cb(docSnap(path));
      listeners.add(l); ready.then(l);
      return () => listeners.delete(l);
    },
  });
  const query = (col, order = [], lim = null) => {
    const run = () => {
      const pre = col + '/';
      let docs = Object.keys(store).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(docSnap);
      for (const [f, dir] of order.slice().reverse()) {
        docs.sort((a, b) => {
          const x = a.data()[f], y = b.data()[f];
          const c = x == null && y == null ? 0 : x == null ? -1 : y == null ? 1 : x < y ? -1 : x > y ? 1 : 0;
          return dir === 'desc' ? -c : c;
        });
      }
      if (lim != null) docs = docs.slice(0, lim);
      return { docs, size: docs.length, empty: !docs.length };
    };
    return {
      orderBy: (f, dir) => query(col, order.concat([[f, dir || 'asc']]), lim),
      limit: (n) => query(col, order, n),
      doc: (id) => docRef(col + '/' + (id || newId())),
      add: async (data) => { const id = newId(); await write([{ kind: 'set', path: col + '/' + id, data }]); return docRef(col + '/' + id); },
      get: async () => { await ready; return run(); },
      onSnapshot: (cb) => {
        const l = () => cb(run());
        listeners.add(l); ready.then(l);
        return () => listeners.delete(l);
      },
    };
  };
  const db = { collection: (p) => query(p), doc: (p) => docRef(p) };

  const assets = {
    upload: async (blob, opts) => N.assetPut(new Uint8Array(await blob.arrayBuffer()), blob.name || '', (opts && opts.type) || blob.type || ''),
    delete: async (ref) => N.assetDelete(ref),
    list: async () => ({ assets: [], usage: {} }),
  };
  const downloads = {
    save: async ({ filename, data }) => {
      const r = await N.saveFile(filename, new Uint8Array(await data.arrayBuffer()));
      if (r && r.declined) throw { code: 'declined', message: 'Abgebrochen' };
      return r;
    },
  };
  const user = { can: async () => true, id: async () => 'lokal' };
  const caps = { db, assets, downloads, user };
  window.claude = { use: async (name) => caps[name] || null };
})();
