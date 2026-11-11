// Projekte und Studien automatisch aus den Ordnern auf G: (ZG, 10.11.2026)
// G:\01 Bauten nach Nummern\<Nummer> <Kürzel> <Adresse> <Gemeinde>   -> Projekt  (z. B. «2508 STS Im Langacher 6 Richterswil»)
// G:\01 Bauten nach Nummern\0000 Studien\<Ordner>                     -> Studie
// Legt fehlende Projekte an und ergänzt Nummer, Adresse, Gemeinde und Projektordner. Was im Cockpit von Hand geändert wurde
// (Titel, Phase, Status, Farbe, Mitglieder …) bleibt. Gelöscht wird nichts. Neue Projekte beginnen als «inaktiv».
const fs = require('fs');
const path = require('path');

const BAUTEN = 'G:\\01 Bauten nach Nummern';
const STUDIEN = path.join(BAUTEN, '0000 Studien');

// «2508 STS Im Langacher 6 Richterswil» -> { nummer, kuerzel, adresse, gemeinde }
const zerlegen = (name) => {
  const t = String(name).replace(/\s+/g, ' ').trim();
  const m = t.match(/^(\d{3,6})[\s_-]+(.*)$/);
  const nummer = m ? m[1] : '';
  let rest = m ? m[2] : t;
  let kuerzel = '';
  const k = rest.match(/^([A-ZÄÖÜ][A-ZÄÖÜ0-9]{1,5})(?:[\s_-]+|$)(.*)$/);
  if (k) { kuerzel = k[1]; rest = k[2]; }
  let adresse = rest, gemeinde = '';
  if (rest.includes(',')) { const i = rest.lastIndexOf(','); adresse = rest.slice(0, i).trim(); gemeinde = rest.slice(i + 1).trim(); }
  else {
    // Gemeinde = alles nach der Hausnummer («Im Langacher 6 Richterswil»), sonst das letzte Wort
    const h = rest.match(/^(.*?\d+[a-zA-Z]?)\s+(\D.*)$/);
    if (h) { adresse = h[1]; gemeinde = h[2]; }
    else if (nummer) { const w = rest.split(' '); if (w.length > 1) { gemeinde = w.pop(); adresse = w.join(' '); } }
  }
  return { nummer, kuerzel, adresse: adresse.trim(), gemeinde: gemeinde.trim() };
};

const ordnerIn = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('~')).map((d) => d.name); }
  catch (_) { return null; }
};

// liefert die nötigen Änderungen (ops) für den Datenbestand
const abgleichen = (store) => {
  const ops = [];
  const bauten = ordnerIn(BAUTEN);
  if (!bauten) return { ops, fehler: 'Ordner ' + BAUTEN + ' nicht gefunden.' };
  const studien = ordnerIn(STUDIEN) || [];
  const projekte = Object.keys(store).filter((k) => /^projekte\/[^/]+$/.test(k)).map((k) => ({ key: k, id: k.slice(9), ...store[k] }));
  let reihe = projekte.reduce((m, p) => Math.max(m, p.reihenfolge || 0), 0);
  const neu = [];
  const eintrag = (ordnerName, basis, art) => {
    const z = zerlegen(ordnerName);
    if (art === 'bau' && !z.nummer) return;
    if (art === 'bau' && /^0+$/.test(z.nummer)) return; // «0000 Studien» und ähnliche Sammelordner
    const ordner = path.join(basis, ordnerName);
    const titel = [z.adresse, z.gemeinde].filter(Boolean).join(', ');
    // schon da? zuerst über den Ordner, dann über die Nummer, dann über das Kürzel (ältere, von Hand angelegte Projekte)
    const norm = (x) => String(x || '').toLowerCase();
    let p = projekte.find((x) => norm(x.ordner) === norm(ordner))
      || (z.nummer && projekte.find((x) => x.nummer === z.nummer && (x.art || 'bau') === art))
      || (z.kuerzel && projekte.find((x) => !x.nummer && !x.auto && norm(x.name) === norm(z.kuerzel) && (x.art || 'bau') === art));
    const felder = { art, nummer: z.nummer, adresse: z.adresse, gemeinde: z.gemeinde, ordner, ordnerName, auto: true };
    if (p) {
      const upd = {};
      Object.entries(felder).forEach(([f, v]) => { if (v && p[f] !== v) upd[f] = v; });
      if (!p.titel && titel) upd.titel = titel;
      // von 2.11 automatisch angelegte Projekte standen auf «aktiv»; ZG will sie zuerst inaktiv (einmalig, 10.11.2026)
      if (p.auto && p.erstellt && !p.statusInit) { upd.statusInit = true; if (!p.status || p.status === 'aktiv') upd.status = 'inaktiv'; }
      if (!p.name && (z.kuerzel || z.nummer)) upd.name = z.kuerzel || z.nummer;
      if (Object.keys(upd).length) ops.push({ kind: 'update', path: p.key, data: upd });
      return;
    }
    let id = (art === 'studie' ? 'S' : '') + (z.nummer || (z.kuerzel || ordnerName).normalize('NFD').replace(/[^\w-]/g, '').toUpperCase().slice(0, 24) || 'STUDIE');
    while (store['projekte/' + id] || neu.includes(id)) id += '-2';
    neu.push(id);
    ops.push({ kind: 'set', path: 'projekte/' + id, data: { ...felder, name: z.kuerzel || z.nummer || ordnerName, titel: titel || (z.kuerzel ? '' : ordnerName), phase: '', status: 'inaktiv', statusInit: true, farbe: '', mitglieder: [], reihenfolge: ++reihe, erstellt: new Date().toISOString() } });
  };
  bauten.forEach((n) => eintrag(n, BAUTEN, 'bau'));
  studien.forEach((n) => eintrag(n, STUDIEN, 'studie'));
  return { ops, neu: neu.length, bauten: bauten.length, studien: studien.length };
};

module.exports = { abgleichen, zerlegen, BAUTEN, STUDIEN };
