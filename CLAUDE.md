# CLAUDE.md: Cockpit ZG

Stand: 13.11.2026. Arbeitswissen für Claude Code zu diesem Repo (Regeln, Aufbau, Stand, nächste Schritte). Sprache mit ZG: **Deutsch (Schweiz, kein ß)**, kurze, klare Antworten.

---

## 1. Wer und was

- **Nutzer:** ZG (GitHub `JWZG99`), Architekt im Büro Zottele Gallicchio Architekten. Windows-PC «PC06», Windows-Benutzer `Planung6` (pro PC, nicht pro Person).
- **Projektziel (ursprünglich):** Persönlicher Assistent: Aufgaben tracken, planen, Mails analysieren und sortieren, über alle Büroprojekte.
- **Daraus entstanden:** das **Cockpit ZG**, ein Windows-Programm (Electron) für das ganze Büro: Projekte, Aufgaben, Termine, Arbeitszeit, Zugriff auf den Server G:, Outlook-Mails, Rollen (Mitarbeiter / Chef / Administrator).
- **Langfristiges Ziel:** eine **lokale Büro-KI** mit dem Wissen aus 20+ Jahren Büroarbeit (lokales Modell + Suchindex über G:, ohne API-Kosten).

---

## 2. Feste Regeln von ZG (immer einhalten)

1. **Auf G: nichts ausser dem Ordner `G:\03 Dokumente\90 ZG Programm`.** Programm und Daten gehören dort hinein, nirgends sonst auf G:. Keine Index-, Cache- oder Logdateien auf G: ablegen.
2. **Gemeinsamer Datenordner:** `G:\03 Dokumente\90 ZG Programm\Cockpit Daten (alle)` (für alle Benutzer, pro Person intern nach Login getrennt). Daten bleiben auf G: (ZG hat entschieden, nicht lokal).
3. **Nur ZG ist Administrator.** Neue Personen registrieren sich selbst als Mitarbeiter.
4. **Projekte sind global** und werden nur von Admin/Chef angelegt. Mitarbeiter wählen in «Projekte wählen» ihre Projekte (`mitglieder`). Aufgaben/Termine gehören dem Ersteller (`von`).
5. **Nur die Desktop-Kopie aktualisieren:** `C:\Users\Planung6\Desktop\Cockpit ZG 1.1.0\` (Ordnername alt, Inhalt aktuell). Die Kopie unter `C:\Program Files\ZG\...` nicht anfassen (nicht beschreibbar).
6. **Vor dem Einspielen einer neuen Version auf ZGs PC kurz fragen** (bzw. wenn ZG «bau es ein» / «lad es hoch» sagt, ohne weitere Rückfrage machen; ZG mag kein unnötiges Nachfragen).
7. **Keine API-Kosten bevorzugt.** Der Assistent im Cockpit braucht einen eigenen Anthropic-API-Schlüssel (nicht im 20.- Abo). Kein Schlüssel angelegt.
8. **Fremde Tools** (GitHub-Projekte) zuerst nur lesend prüfen, erst nach ausdrücklichem OK installieren, nie auf G:.
9. **Messerli ZERF:** ZG will keinen CSV-Export/Button, sondern eine echte Verbindung. Arbeit daran ist gestoppt («stop nix machen»), nur auf Wunsch wieder aufnehmen.
10. **Design:** Apple-Stil (HIG, Systemschrift, runde Häkchen, Sheets) mit «Liquid Glass»-Look, bewusst ohne undurchsichtigen Ersatz. Statusfarben: Zu besprechen = orange, In Abklärung = blau, Erledigt = grün.
11. Keine Stundenstatistik (Wochen/Monate) im Cockpit, nur heute + letzte 7 Arbeitstage.
12. Den früher vorgeschlagenen Windows-Protokoll-Handler (.reg) nicht wieder vorschlagen (Sicherheitsrisiko).

---

## 3. Code: Repository und Stand

- **Repo:** https://github.com/JWZG99/cockpit-zg (öffentlich).
- **`main`** = Version **2.17.0** (PR #4 gemergt, Tag `v2.17.0`).
- **Neuester Code = 2.18.4** auf Branch `claude/project-thread-8r03mz`, offener **PR #5** «Shortcuts und Suche im Projektordner». Läuft bereits auf ZGs PC. → **PR #5 mergen**, bevor neue Arbeit beginnt (oder neue Arbeit von diesem Branch aus starten).
- Weitere offene PRs: **#2** (Skills `frontend-design`, `webapp-testing` unter `.claude/skills/`), **#3** (Skill `claude-automation-recommender`). Beide nur Text, können gemergt werden.
- Alte Sicherungen (veraltet, nur falls GitHub weg ist): `/mnt/project-files/cockpit/programm/cockpit-zg-code.bundle` (bis 2.16), `/mnt/project-files/cockpit/cockpit-zg-programm.bundle` (Oktober).
- GitHub war am 9.11. kurz gesperrt («account suspended»), funktioniert seither wieder.

### Aufbau
| Datei | Zweck |
|---|---|
| `web/cockpit-zg.html` | Die ganze Oberfläche (eine grosse HTML-Datei, ursprünglich das claude.ai-Artifact). Hier wird fast alles geändert. |
| `build/web-zu-app.py` | Erzeugt daraus `app/index.html`. **Nach jeder Änderung ausführen.** |
| `app/claude-shim.js` | Ersetzt `window.claude.use(...)` (Artifact-API) durch Dateispeicher im Programm. |
| `app/anmelden.html`, `laden.html`, `hinweise.js` | Login, Ladebildschirm, Hinweis-Karten oben rechts (Updates, Fortschritt). |
| `main.js` / `preload.js` | Electron-Hauptprozess: Fenster, Datenspeicher, Rechte (`regeln()`), IPC (`listDir`, `search-dir`, `search-warm`, `pfad-info`, `move-path`, `team-save`, `auth-*` …). |
| `buero-update.js` | Selbst-Update über G: (siehe unten). |
| `bauten.js` | Abgleich der Projekte aus `G:\01 Bauten nach Nummern` und Studien aus `…\0000 Studien` (nur lesen, löscht nie). |
| `mail.js` | Outlook (klassisch) über COM/PowerShell: Posteingang, Gesendet, Antworten, als Aufgabe. Ungetestet mit echtem Outlook, geht nicht mit «neuem Outlook». |
| `ki.js` | Assistent (Claude-Chat, `@anthropic-ai/sdk`), Haiku zuerst, bei Bedarf Opus. Schlüssel in `<Datenordner>\ki-schluessel.json`. Nie mit echtem Schlüssel getestet. |
| `package.json` | Version hier erhöhen (`"version"`). Electron 44.3.0, electron-builder 26.16.1. |
| `.github/workflows/release.yml` | Alter Release-Workflow (Installer). Wird praktisch nicht mehr genutzt. |

### Bauen und ausliefern (so wurde es bisher gemacht)
1. `web/cockpit-zg.html` ändern → `python3 build/web-zu-app.py` → Version in `package.json` erhöhen.
2. `app.asar` bauen (electron-builder bzw. `asar pack`; Windows-Portable, kein Installer, NSIS geht unter Linux nicht).
3. Die neue `resources\app.asar` in `C:\Users\Planung6\Desktop\Cockpit ZG 1.1.0\resources\` ersetzen (alte als `app.asar.<version>.bak` daneben lassen).
4. Das laufende Cockpit merkt die neue Datei (alle 15 s), zeigt «Neue Version ist da» und startet nach 10 s neu.
5. Beim Start veröffentlicht ZGs PC die neue Version nach `G:\03 Dokumente\90 ZG Programm\Programm\` (`version.json`); die anderen PCs holen sie beim nächsten Start (Countdown 20 s). Neue PCs installieren über `G:\03 Dokumente\90 ZG Programm\Cockpit installieren.cmd` (nach `%LOCALAPPDATA%\Programs\Cockpit ZG` + Desktop-Verknüpfung). Das Programm läuft nicht direkt ab G:.
- Fertige Builds liegen in `/mnt/project-files/cockpit/programm/update-2.17.0/` … `update-2.18.4/app.asar`.
- Mit Claude Code direkt auf dem PC geht Schritt 3 einfacher: lokal bauen und Datei kopieren.

### Tests
- Headless-Tests mit Playwright und einem Stub für `window.native`: `/mnt/project-files/cockpit/team/test-harness/` (`stub-2.18.js`, `run.js`, `sc.js`, `suche-test-main.js`, `dd.js`, `mv.js`).
- Prüfen in 1280×720, 1920×1080 und schmal 900 px.
- Nicht testbar in der Cloud: echte Ordner auf G:, Explorer-Drag, echtes Outlook, Assistent mit echtem Schlüssel.

---

## 4. Datenmodell (kurz)

Ein Datensatz = eine kleine Datei in `<Datenordner>\daten\` (keine Überschreibkonflikte; Polling alle 3 s).
- `projekte/<ID>`: `name` (Kürzel), `titel` (= Projektadresse), `nummer`, `gemeinde`, `art` (projekt|studie), `phase` (SIA 31–53), `status` (aktiv|wartet|kritisch|pausiert|inaktiv|beendet), `farbe`, `verantwortlich` (Name), `mitglieder` [user-ids], `ordner` (Pfad auf G:), `shortcuts` [{id, name, ziel, ordner}], `dateien` (alt, wird einmalig zu shortcuts), `reihenfolge`, `mm` {dx,dy}.
- `aufgaben/<ID>`: `projekt`, `text`, `erledigt`, `erledigtAm`, `faellig`, `prio` 1–4, `zustand` (''|besprechen|abklaerung), `unteraufgaben` [{id, text, erledigt, zustand, parent, auto}], `board.items` (Whiteboard), `anhaenge`, `von`, `autoErledigt`.
- `termine/<ID>`: `datum`, `zeit`, `bis`, `text`, `projekt`, `von`.
- `benutzer/<id>`: Login (scrypt-Hash), Rolle mitarbeiter|chef|admin. Seite sieht diese Daten nicht.
- `data/users/<id>/…`: privat: `profil`, `rechner`, `zeit/tage/<datum>`, `zeit/split/<datum>`, `zeit/taetigkeiten/<datum>`.
- Lokal pro PC (userData): `letzte-daten.json` (Offline-Kopie), `ausstehend.json` (Warteschlange, wird nachgetragen, sobald G: wieder da ist).

---

## 5. Was das Cockpit kann (Versionen)

- **1.x:** Seitenleiste (Profil, Übersicht, Zeiterfassung, je Projekt eine Seite), Daten auf G: mit Offline-Kopie (1.3), Seite «Server» zum Durchsuchen von G:, Dateien öffnen/verknüpfen (1.4).
- **2.0:** Login (Name + Passwort), Rollen, Seiten Team und Chef-Übersicht, «Ansicht als» für Admin. **2.1–2.3:** Assistent. **2.4:** Datenordner «Cockpit Daten (alle)». **2.5–2.6:** Server-Seite mit Krümelpfad, Tabs, Rechtsklick, Drag & Drop (Ctrl = kopieren) mit Rückgängig.
- **2.7–2.8:** Verteilung/Updates über G:, Ladebildschirm, Hinweis-Karten, Selbstregistrierung. **2.9–2.10:** globale Projekte, «Projekte wählen». **2.11–2.12:** Projekte/Studien automatisch aus G:, Status inaktiv/beendet, Suche in der Seitenleiste, «Meine Projekte» / «Weitere Projekte». **2.13:** Aktualisieren-Knopf (F5), automatischer Neustart bei neuer Version. **2.14–2.15:** Projekte in der Seitenleiste ziehen, «Was ich heute gemacht habe». **2.16:** Seite «Mails» (Outlook).
- **2.17 (Plan 01):** Projektseite aufgeräumt: Kürzel gross + Projektadresse in einer Zeile, Projektordner-Karte über den Aufgaben (einklappbar), Aufgaben aufklappbar mit Unteraufgaben, passt ins Fenster (nur innere Bereiche scrollen), zwei Spalten ab 1100 px.
- **2.18.0–2.18.4 (Plan 02):** «Shortcuts» statt «Verknüpfte Dateien», rekursive Suche im ganzen Projektordner (Index nur im Speicher, 10 Min Cache, Vorladen beim Öffnen des Projekts), Haus-Knopf 🏠 als eigener Knopf vor dem Krümelpfad (springt zum Projektordner-Stamm, beendet Suche).
- Pläne mit allen Details: `/mnt/project-files/cockpit/team/plan-01-projektseite.md`, `plan-02-shortcuts-suche.md`; freigegebene Vorschau: `/mnt/project-files/cockpit/team/vorschau-01-projektseite.html`.

Die frühere Online-Version (claude.ai-Artifact) ist seit dem Desktop-Programm getrennt und wird nicht mehr weiterentwickelt.

### Arbeitsweise «Cockpit-Team» (seit 11.11.)
ZG liess die Arbeit auf vier Rollen verteilen: **Planung** (Plan als .md) → **Visualisierung** (klickbare HTML-Vorschau, ZG gibt frei) → **Programmierung** (umsetzen, bauen, einspielen) → **Tests** (headless prüfen). In Claude Code kann man dem gleichen Ablauf folgen: zuerst Plan, bei sichtbaren Änderungen eine Vorschau zeigen, dann umsetzen und testen.

---

## 6. Offene Punkte / nächste Schritte

1. **PR #5 (2.18.4) mergen**, dann PR #2 und #3.
2. Auf dem echten G: testen: Suche in grossen Projektordnern, Drag & Drop auf den Haus-Knopf, Anheften per Explorer-Drag.
3. Outlook-Seite mit echtem Outlook testen.
4. Chef-Übersicht: was der Chef zusätzlich sehen soll; Aufgaben Personen zuweisen (offen).
5. Anzahl Mitarbeitende (offen).
6. Assistent: API-Schlüssel nur, wenn ZG will. Alternative ohne API: Knopf «An Claude übergeben» (Zwischenablage), angeboten, nicht gebaut.
7. Anbindung an die Zeiterfassung Messerli ZERF: pausiert, nur auf Wunsch von ZG.
8. Langfristig: lokale Büro-KI (lokales Modell + Suchindex über G:), noch in Planung.
9. README im Repo ist veraltet (beschreibt noch 1.x mit `cockpit-daten.json` und GitHub-Releases).

---

## 7. Wo liegt was

**Auf ZGs PC**
- Programm: `C:\Users\Planung6\Desktop\Cockpit ZG 1.1.0\Cockpit ZG.exe` (Updates: `resources\app.asar`)
- Ignorieren: `C:\Program Files\ZG\Cockpit ZG 1.1.0`
- Weitere freigegebene Ordner: `C:\Users\Planung6\Desktop\Claude ArchiCad Vorlage`, `G:\ZG Programme`

**Auf G:**
- `G:\03 Dokumente\90 ZG Programm\` (Programm, `Cockpit installieren.cmd`, `Programm\version.json`)
- `G:\03 Dokumente\90 ZG Programm\Cockpit Daten (alle)\` (alle Daten)
- Nur lesen: `G:\01 Bauten nach Nummern\` (Ordnername z. B. «2508 STS Im Langacher 6 Richterswil» = Nummer, Kürzel, Adresse, Gemeinde), `…\0000 Studien`

**Projektdateien im claude.ai-Projekt «JW» (nur dort erreichbar, `/mnt/project-files/`)**
- `cockpit/programm/update-2.18.4/app.asar` (neuester Build), ältere `update-2.17.0` … `update-2.18.3`
- `cockpit/programm/Cockpit-ZG-2.2.0-Windows.zip`, `Cockpit-ZG-1.1.0-Windows.zip` (ganze Programme, alt)
- `cockpit/team/` (Pläne, Vorschau, Test-Harness, Screenshot)
- `cockpit/Zusammenfassung-Cockpit-2026-11-10.md`
- `cockpit/export/` (alte Online-Version als HTML + JSON)
- `zeiterfassung/`

---

## 8. Tipps für Claude Code

- Im Repo-Ordner starten, zuerst `git checkout claude/project-thread-8r03mz` (bzw. `main` nach Merge von PR #5).
- `web/cockpit-zg.html` ist sehr gross (> 5000 Zeilen): gezielt suchen (z. B. `#pordner`, `drawOrdner`, `#projTitle`), nicht ganz lesen.
- Immer nach Änderungen: `python3 build/web-zu-app.py`, Version erhöhen, kurzer Commit auf Deutsch.
- Starten zum Ausprobieren: `npm install` und `npm start` (Node.js nötig, fehlt evtl. noch auf PC06).
