// Assistent im Cockpit: Claude über die Anthropic-API, mit Werkzeugen für Projekte, Aufgaben, Zeit und Serverordner.
// Der API-Schlüssel liegt im Datenordner (ki-schluessel.json), damit alle im Büro denselben nutzen; die Seite sieht ihn nie.
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

// Modelle: zuerst das günstige Haiku; bei schwierigen Fragen übernimmt Opus (Modus «auto»)
const GUENSTIG = 'claude-haiku-5-5';
const STARK = 'claude-opus-5-5';
const MAX_ROUNDS = 8;

module.exports = function setupKi({ ipcMain, dataDir, getStore, commit, changed, me, isAdmin, listDir }) {
  const keyFile = () => path.join(dataDir(), 'ki-schluessel.json');
  const readCfg = () => { try { return JSON.parse(fs.readFileSync(keyFile(), 'utf8')) || {}; } catch (_) { return {}; } };
  const readKey = () => readCfg().schluessel || '';
  const modus = () => (['auto', 'guenstig', 'stark'].includes(readCfg().modus) ? readCfg().modus : 'auto');
  const chats = new Map(); // user id -> messages of the current conversation

  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const projects = () => Object.entries(getStore()).filter(([k]) => /^projekte\/[^/]+$/.test(k)).map(([k, v]) => ({ id: k.slice(9), ...v }));
  const tasks = () => Object.entries(getStore()).filter(([k]) => /^aufgaben\/[^/]+$/.test(k)).map(([k, v]) => ({ id: k.slice(9), ...v }));
  const pName = (id) => { const p = projects().find((x) => x.id === id); return p ? p.name || p.id : '–'; };

  const ESKALIEREN = { name: 'staerkeres_modell', description: 'Übergibt die Frage an ein stärkeres, teureres Modell. Nur verwenden, wenn die Frage echtes Nachdenken braucht: Planung oder Terminplanung über mehrere Projekte, Analysen, Abwägungen, längere Texte oder Briefe verfassen, heikle Formulierungen. Nicht verwenden für Nachschlagen, Auflisten, kurze Antworten, Aufgaben anlegen oder abhaken.', input_schema: { type: 'object', properties: { grund: { type: 'string', description: 'kurz, warum' } }, required: ['grund'], additionalProperties: false } };
  const TOOLS = [
    { name: 'projekte_liste', description: 'Alle Projekte des Büros mit Kürzel, Titel, SIA-Phase, Status, Verantwortlich, Serverordner und Anzahl offener Aufgaben.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'aufgaben_suchen', description: 'Aufgaben suchen. Ohne Filter: alle offenen Aufgaben. Gibt id, Text, Projekt, Fälligkeit, Status, Unteraufgaben und verknüpfte Dateien zurück.', input_schema: { type: 'object', properties: { projekt: { type: 'string', description: 'Projekt-Kürzel oder -ID, optional' }, text: { type: 'string', description: 'Suchwort im Aufgabentext, optional' }, auch_erledigte: { type: 'boolean', description: 'auch erledigte Aufgaben zeigen' } }, additionalProperties: false } },
    { name: 'aufgabe_anlegen', description: 'Neue Aufgabe in einem Projekt anlegen. Nur verwenden, wenn die Person das ausdrücklich möchte.', input_schema: { type: 'object', properties: { projekt: { type: 'string', description: 'Projekt-Kürzel oder -ID' }, text: { type: 'string' }, faellig: { type: 'string', description: 'Datum YYYY-MM-DD, optional' } }, required: ['projekt', 'text'], additionalProperties: false } },
    { name: 'aufgabe_erledigt', description: 'Eine Aufgabe als erledigt markieren. Nur verwenden, wenn die Person das ausdrücklich möchte.', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Aufgaben-ID aus aufgaben_suchen' } }, required: ['id'], additionalProperties: false } },
    { name: 'meine_zeit', description: 'Arbeitszeit der angemeldeten Person der letzten Tage (Kommen, Gehen, Pause) und Stunden pro Projekt.', input_schema: { type: 'object', properties: { tage: { type: 'integer', description: 'Anzahl Tage zurück, Standard 7' } }, additionalProperties: false } },
    { name: 'ordner_anzeigen', description: 'Inhalt eines Ordners auf dem Server (z. B. Projektordner auf G:) auflisten: Namen, Grösse, Änderungsdatum.', input_schema: { type: 'object', properties: { pfad: { type: 'string', description: 'z. B. G:\\Projekte\\WEL' } }, required: ['pfad'], additionalProperties: false } },
  ];

  const findProject = (q) => { q = String(q || '').trim().toLowerCase(); return projects().find((p) => p.id.toLowerCase() === q || String(p.name || '').toLowerCase() === q); };
  const run = (name, input, who) => {
    if (name === 'projekte_liste') {
      const t = tasks();
      return projects().map((p) => ({ id: p.id, kuerzel: p.name || p.id, titel: p.titel || '', phase: p.phase || '', status: p.status || '', verantwortlich: p.verantwortlich || '', ordner: p.ordner || '', offen: t.filter((x) => x.projekt === p.id && !x.erledigt).length }));
    }
    if (name === 'aufgaben_suchen') {
      let list = tasks();
      if (input.projekt) { const p = findProject(input.projekt); if (!p) return { fehler: 'Projekt nicht gefunden: ' + input.projekt }; list = list.filter((t) => t.projekt === p.id); }
      if (!input.auch_erledigte) list = list.filter((t) => !t.erledigt);
      if (input.text) { const q = input.text.toLowerCase(); list = list.filter((t) => String(t.text || '').toLowerCase().includes(q) || String(t.notiz || '').toLowerCase().includes(q)); }
      return list.slice(0, 80).map((t) => ({ id: t.id, text: t.text, projekt: pName(t.projekt), faellig: t.faellig || '', ueberfaellig: !!(t.faellig && !t.erledigt && t.faellig < today()), erledigt: !!t.erledigt, status: t.status || '', notiz: t.notiz || '', unteraufgaben: (t.unteraufgaben || []).map((u) => (u.erledigt ? '[x] ' : '[ ] ') + u.text), dateien: (t.anhaenge || []).filter((a) => a.art === 'link').map((a) => a.ziel) }));
    }
    if (name === 'aufgabe_anlegen') {
      const p = findProject(input.projekt); if (!p) return { fehler: 'Projekt nicht gefunden: ' + input.projekt };
      const id = Math.random().toString(36).slice(2, 12);
      commit([{ kind: 'set', path: 'aufgaben/' + id, data: { projekt: p.id, text: String(input.text).trim(), erledigt: false, faellig: /^\d{4}-\d{2}-\d{2}$/.test(input.faellig || '') ? input.faellig : '', erstellt: new Date().toISOString(), erstelltVon: who.id } }]);
      changed();
      return { ok: true, id, projekt: p.name || p.id };
    }
    if (name === 'aufgabe_erledigt') {
      const t = tasks().find((x) => x.id === input.id); if (!t) return { fehler: 'Aufgabe nicht gefunden' };
      commit([{ kind: 'update', path: 'aufgaben/' + t.id, data: { erledigt: true, erledigtAm: new Date().toISOString() } }]);
      changed();
      return { ok: true, text: t.text };
    }
    if (name === 'meine_zeit') {
      const n = Math.min(Math.max(Number(input.tage) || 7, 1), 31);
      const s = getStore(); const pre = 'data/users/' + who.id + '/zeit/';
      const out = [];
      for (let i = 0; i < n; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const t = s[pre + 'tage/' + iso], sp = s[pre + 'split/' + iso];
        if (t || sp) out.push({ datum: iso, kommen: t && t.kommen, gehen: t && t.gehen, pause_h: t && t.pause, stunden_pro_projekt: sp && sp.projekte ? Object.fromEntries(Object.entries(sp.projekte).map(([k, h]) => [k === 'ohne' ? 'ohne Projekt' : pName(k), h])) : undefined });
      }
      return out.length ? out : { hinweis: 'Keine Zeiteinträge in diesem Zeitraum.' };
    }
    if (name === 'ordner_anzeigen') {
      const r = listDir(input.pfad);
      if (!r.ok) return { fehler: r.error };
      return r.items.slice(0, 200).map((f) => ({ name: f.name, ordner: f.ordner, groesse_kb: f.ordner ? undefined : Math.round(f.groesse / 1024), geaendert: f.geaendert ? new Date(f.geaendert).toISOString().slice(0, 10) : '' }));
    }
    return { fehler: 'Unbekanntes Werkzeug' };
  };

  const system = (who) => [
    'Du bist der Assistent im «Cockpit ZG», dem Büroprogramm von Zottele Gallicchio Architekten (Schweiz).',
    'Antworte auf Deutsch (Schweizer Schreibweise, kein ß), kurz und konkret. Nutze die Werkzeuge, um Projekte, Aufgaben, Arbeitszeit und Serverordner nachzuschauen, statt zu raten.',
    'Projekte haben SIA-Phasen (31 Vorprojekt, 32 Bauprojekt, 33 Bewilligungsverfahren, 41 Ausschreibung, 51 Ausführungsprojekt, 52 Ausführung, 53 Inbetriebnahme).',
    'Lege Aufgaben nur an oder hake sie nur ab, wenn die Person das ausdrücklich verlangt, und sag danach, was du geändert hast.',
    'Angemeldet ist ' + who.name + ' (' + ({ mitarbeiter: 'Mitarbeiter', chef: 'Chef', admin: 'Administrator' }[who.rolle] || who.rolle) + ').',
  ].join('\n');

  ipcMain.handle('ki-status', () => ({ bereit: !!readKey(), darfEinrichten: isAdmin(), modus: modus() }));
  ipcMain.handle('ki-modus', (_e, m) => {
    if (!isAdmin()) return { ok: false, error: 'Nur der Administrator kann das ändern.' };
    if (!['auto', 'guenstig', 'stark'].includes(m)) return { ok: false, error: 'Unbekannter Modus.' };
    try { fs.writeFileSync(keyFile(), JSON.stringify({ ...readCfg(), modus: m })); } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true };
  });
  ipcMain.handle('ki-schluessel', (_e, k) => {
    if (!isAdmin()) return { ok: false, error: 'Nur der Administrator kann den Schlüssel hinterlegen.' };
    k = String(k || '').trim();
    try {
      fs.writeFileSync(keyFile(), JSON.stringify({ ...readCfg(), schluessel: k }));
    } catch (e) { if (k) return { ok: false, error: 'Speichern ging nicht: ' + e.message }; }
    return { ok: true };
  });
  ipcMain.handle('ki-neu', () => { const m = me(); if (m) chats.delete(m.id); return { ok: true }; });
  ipcMain.handle('ki-frage', async (e, text) => {
    const who = me();
    if (!who) return { ok: false, error: 'Nicht angemeldet.' };
    const key = readKey();
    if (!key) return { ok: false, error: 'Der Assistent ist noch nicht eingerichtet. Der Administrator hinterlegt den API-Schlüssel.' };
    const client = new Anthropic({ apiKey: key });
    const messages = chats.get(who.id) || [];
    messages.push({ role: 'user', content: String(text || '').slice(0, 20000) });
    const done = [];
    const mod = modus();
    let model = mod === 'stark' ? STARK : GUENSTIG;
    const tools = mod === 'auto' ? [...TOOLS, ESKALIEREN] : TOOLS;
    const ask = (m) => (m === STARK
      // Opus: bei einer Ablehnung übernimmt serverseitig automatisch ein passendes anderes Modell
      ? client.beta.messages.create({ model: m, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'medium' }, system: system(who), tools, messages })
      : client.messages.create({ model: m, max_tokens: 16000, output_config: { effort: 'low' }, system: system(who), tools, messages }));
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const res = await ask(model);
        messages.push({ role: 'assistant', content: res.content }); // whole content incl. thinking blocks
        if (res.stop_reason === 'refusal') {
          if (model === GUENSTIG && mod === 'auto') { messages.pop(); model = STARK; continue; } // Haiku lehnt ab: Opus versucht es
          chats.set(who.id, messages); return { ok: true, antwort: 'Dazu kann ich leider nicht antworten.', geaendert: done, modell: model };
        }
        const uses = res.content.filter((b) => b.type === 'tool_use');
        if (res.stop_reason !== 'tool_use' || !uses.length) {
          chats.set(who.id, messages);
          const txt = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          return { ok: true, antwort: txt || (res.stop_reason === 'max_tokens' ? 'Die Antwort wurde zu lang und abgeschnitten.' : '…'), geaendert: done, modell: model };
        }
        let hoch = false;
        const results = uses.map((u) => {
          if (u.name === 'staerkeres_modell') {
            if (model === STARK) return { type: 'tool_result', tool_use_id: u.id, content: 'Du bist bereits das stärkste Modell. Beantworte die Frage selbst.' };
            hoch = true;
            if (!e.sender.isDestroyed()) e.sender.send('ki-schritt', u.name);
            return { type: 'tool_result', tool_use_id: u.id, content: 'Übergeben. Ab jetzt antwortet das stärkere Modell. Beantworte die Frage der Person vollständig.' };
          }
          let out, err = false;
          try { out = run(u.name, u.input || {}, who); if (out && out.fehler) err = true; } catch (x) { out = { fehler: String(x.message || x) }; err = true; }
          if (!err && (u.name === 'aufgabe_anlegen' || u.name === 'aufgabe_erledigt')) done.push(u.name);
          if (!e.sender.isDestroyed()) e.sender.send('ki-schritt', u.name);
          return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), is_error: err };
        });
        messages.push({ role: 'user', content: results });
        if (hoch) model = STARK;
      }
      chats.set(who.id, messages);
      return { ok: true, antwort: 'Das wurde mir zu verschachtelt. Frag bitte etwas genauer.', geaendert: done, modell: model };
    } catch (x) {
      chats.delete(who.id); // start clean next time
      if (x instanceof Anthropic.AuthenticationError) return { ok: false, error: 'Der API-Schlüssel stimmt nicht. Der Administrator muss ihn neu hinterlegen.' };
      if (x instanceof Anthropic.RateLimitError) return { ok: false, error: 'Gerade zu viele Anfragen. Bitte gleich nochmals versuchen.' };
      if (x instanceof Anthropic.APIConnectionError) return { ok: false, error: 'Keine Verbindung zum Internet oder zum Dienst.' };
      if (x instanceof Anthropic.APIError) return { ok: false, error: 'Fehler beim Dienst (' + x.status + '): ' + x.message };
      return { ok: false, error: String(x.message || x) };
    }
  });
};
