// Hinweise oben rechts: was das Programm gerade macht, und «Update bereit · Installieren» (ZG, 10.11.2026)
(() => {
  const N = window.native;
  if (!N || !N.onAktivitaet) return;
  const css = document.createElement('style');
  css.textContent = `
  .zg-hw { position: fixed; top: 14px; right: 14px; z-index: 5000; display: flex; flex-direction: column; gap: 8px; width: min(340px, calc(100vw - 28px)); pointer-events: none; font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .zg-hw > div { pointer-events: auto; background: rgba(255,255,255,.92); color: #1c1c1e; border-radius: 14px; padding: 12px 14px; box-shadow: 0 10px 30px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
  @media (prefers-color-scheme: dark) { .zg-hw > div { background: rgba(44,44,46,.92); color: #f2f2f7; box-shadow: 0 10px 30px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); } }
  .zg-hw b { display: block; font-size: 14px; margin-bottom: 2px; }
  .zg-hw .t { color: inherit; opacity: .75; font-size: 13px; }
  .zg-hw .bar { height: 5px; border-radius: 3px; background: rgba(127,127,127,.25); margin-top: 8px; overflow: hidden; }
  .zg-hw .bar > i { display: block; height: 100%; width: 0; background: #0a84ff; border-radius: 3px; transition: width .3s; }
  .zg-hw .bar.lauf > i { width: 35%; animation: zgLauf 1.2s ease-in-out infinite; }
  @keyframes zgLauf { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
  .zg-hw .row { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
  .zg-hw button { font: inherit; font-size: 14px; font-weight: 600; border: 0; border-radius: 9px; padding: 6px 12px; cursor: pointer; }
  .zg-hw .go { background: #0a84ff; color: #fff; } .zg-hw .go:disabled { opacity: .6; cursor: default; }
  .zg-hw .spaeter { background: rgba(127,127,127,.18); color: inherit; }
  .zg-hw .err { color: #d9342b; font-size: 13px; margin-top: 6px; }`;
  document.head.append(css);
  const box = document.createElement('div'); box.className = 'zg-hw'; box.setAttribute('aria-live', 'polite');
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  let akt = null, upd = null, spaeter = null;
  const zeigAkt = (a) => {
    if (!a) { if (akt) { akt.remove(); akt = null; } return; }
    if (!akt) { akt = mk('div'); akt.append(mk('b', '', 'Cockpit arbeitet …'), mk('div', 't'), mk('div', 'bar')); akt.querySelector('.bar').append(mk('i')); box.prepend(akt); }
    akt.querySelector('.t').textContent = a.t + (a.pct != null ? ' · ' + a.pct + ' %' : '');
    const bar = akt.querySelector('.bar'); bar.classList.toggle('lauf', a.pct == null);
    bar.firstChild.style.width = a.pct != null ? a.pct + '%' : '';
  };
  const zeigUpd = (v) => {
    if (!v || v === spaeter) return;
    if (upd) upd.remove();
    upd = mk('div'); upd.setAttribute('role', 'alert');
    const go = mk('button', 'go', 'Installieren'); go.type = 'button';
    const sp = mk('button', 'spaeter', 'Später'); sp.type = 'button';
    const err = mk('div', 'err'); err.hidden = true;
    const row = mk('div', 'row'); row.append(sp, go);
    upd.append(mk('b', '', 'Update ' + v + ' ist bereit'), mk('div', 't', 'Das Cockpit startet dafür kurz neu. Nicht gespeicherte Eingaben vorher sichern.'), row, err);
    sp.addEventListener('click', () => { spaeter = v; upd.remove(); upd = null; });
    go.addEventListener('click', async () => {
      go.disabled = true; go.textContent = 'Wird installiert …';
      const r = await N.updateInstallieren();
      if (!r || !r.ok) { go.disabled = false; go.textContent = 'Installieren'; err.hidden = false; err.textContent = (r && r.error) || 'Ging nicht.'; }
    });
    box.append(upd);
  };
  const los = () => {
    document.body.append(box);
    N.onAktivitaet(zeigAkt);
    N.onUpdateBereit(zeigUpd);
    N.aktivitaet().then(zeigAkt).catch(() => {});
    N.updateBereit().then(zeigUpd).catch(() => {});
  };
  if (document.body) los(); else document.addEventListener('DOMContentLoaded', los);
})();
