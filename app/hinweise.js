// Hinweise oben rechts: was das Programm gerade macht, und «Update bereit · Installieren» (ZG, 10.11.2026)
(() => {
  const N = window.native;
  if (!N || !N.onAktivitaet) return;
  const css = document.createElement('style');
  css.textContent = `
  .zg-hw { position: fixed; top: 54px; right: 14px; z-index: 5000; display: flex; flex-direction: column; gap: 8px; width: min(340px, calc(100vw - 28px)); pointer-events: none; font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
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
  .zg-hw .err { color: #d9342b; font-size: 13px; margin-top: 6px; }
  .zg-neu { position: fixed; top: 10px; right: 14px; z-index: 5001; width: 36px; height: 36px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer;
    background: rgba(255,255,255,.85); color: #0068da; box-shadow: 0 2px 10px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.06); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
  .zg-neu:hover { background: #fff; } .zg-neu:focus-visible { outline: 2px solid #0068da; outline-offset: 2px; }
  .zg-neu svg { width: 18px; height: 18px; } .zg-neu.dreht svg { animation: zgDreh .8s linear infinite; }
  @keyframes zgDreh { to { transform: rotate(360deg); } }
  @media (prefers-color-scheme: dark) { .zg-neu { background: rgba(44,44,46,.9); color: #0a84ff; } }`;
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
  // Karte mit Countdown: startet von selbst neu, ausser man klickt «Später»
  let cd = null;
  const countdown = (titel, text, sek, los, vorrang) => {
    if (cd && !vorrang) return;
    if (cd) { clearInterval(cd._t); cd.remove(); cd = null; }
    cd = mk('div'); cd.setAttribute('role', 'alert');
    const go = mk('button', 'go', 'Jetzt'); go.type = 'button';
    const sp = mk('button', 'spaeter', 'Später'); sp.type = 'button';
    const t = mk('div', 't'); const row = mk('div', 'row'); row.append(sp, go);
    cd.append(mk('b', '', titel), t, row);
    let rest = sek, timer = null;
    const zeig = () => { t.textContent = text + ' Neustart in ' + rest + ' s.'; };
    const fertig = () => { clearInterval(timer); go.disabled = true; sp.disabled = true; t.textContent = 'Wird neu gestartet …'; los(); };
    timer = setInterval(() => { rest--; if (rest <= 0) fertig(); else zeig(); }, 1000); cd._t = timer;
    zeig();
    go.addEventListener('click', fertig);
    sp.addEventListener('click', () => { clearInterval(timer); cd.remove(); cd = null; });
    box.append(cd);
  };
  const zeigUpd = (v) => {
    if (!v || v === spaeter) return;
    if (N.updateInstallieren && !upd) {
      countdown('Update ' + v + ' ist da', 'Das Cockpit holt die neue Version von G:.', 20, async () => { const r = await N.updateInstallieren(); if (!r || !r.ok) { if (cd) { cd.remove(); cd = null; } spaeter = null; zeigUpd2(v, r && r.error); } });
      return;
    }
    zeigUpd2(v);
  };
  const zeigUpd2 = (v, fehler) => {
    if (upd) upd.remove();
    upd = mk('div'); upd.setAttribute('role', 'alert');
    const go = mk('button', 'go', 'Installieren'); go.type = 'button';
    const sp = mk('button', 'spaeter', 'Später'); sp.type = 'button';
    const err = mk('div', 'err'); err.hidden = true;
    const row = mk('div', 'row'); row.append(sp, go);
    upd.append(mk('b', '', 'Update ' + v + ' ist bereit'), mk('div', 't', 'Das Cockpit startet dafür kurz neu. Nicht gespeicherte Eingaben vorher sichern.'), row, err);
    if (fehler) { err.hidden = false; err.textContent = fehler; }
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
    // Knopf oben rechts: Daten neu von G: lesen und neu laden
    if (N.neuLaden) {
      const b = mk('button', 'zg-neu'); b.type = 'button'; b.title = 'Aktualisieren (F5)'; b.setAttribute('aria-label', 'Aktualisieren');
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const neu = () => { b.classList.add('dreht'); N.neuLaden(); };
      b.addEventListener('click', neu);
      document.addEventListener('keydown', (e) => { if (e.key === 'F5') { e.preventDefault(); neu(); } });
      document.body.append(b);
    }
    if (N.onNeueVersionLokal) N.onNeueVersionLokal(async () => {
      const v = N.version ? await N.version().catch(() => '') : '';
      countdown('Neue Version ist da', 'Eine neue Version wurde auf diesen PC gelegt.', 10, () => N.neuStarten(), true);
    });
    N.onAktivitaet(zeigAkt);
    N.onUpdateBereit(zeigUpd);
    N.aktivitaet().then(zeigAkt).catch(() => {});
    N.updateBereit().then(zeigUpd).catch(() => {});
  };
  if (document.body) los(); else document.addEventListener('DOMContentLoaded', los);
})();
