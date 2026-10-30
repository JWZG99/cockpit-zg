# Cockpit ZG

Projekte, Aufgaben (mit Whiteboard, Dateien und Links) und die Arbeitszeit von heute als Windows-Programm.

## Aufbau

- `web/cockpit-zg.html`: die Oberfläche. Es ist dieselbe Seite wie das Online-Cockpit auf claude.ai.
- `build/web-zu-app.py`: macht daraus `app/index.html` für das Programm.
- `app/claude-shim.js`: Die Seite spricht mit `window.claude.use(...)`. Im Programm gehen diese Aufrufe an eine Datei statt an claude.ai.
- `main.js` / `preload.js`: Fenster, Datenspeicher, Öffnen von Serverpfaden, PDF speichern und automatische Updates.

## Daten

Alles liegt in einem Ordner. Standard ist `Dokumente\Cockpit ZG`, im Menü kannst du unter «Cockpit → Datenordner wählen» z. B. einen Ordner auf `G:\` wählen:

- `cockpit-daten.json`: Projekte, Aufgaben und Zeiten
- `dateien\`: abgelegte Bilder und Dateien

Programme und Skripte in verknüpften Pfaden werden nie gestartet, nur im Explorer gezeigt.

## Neue Version veröffentlichen

1. Die Version in `package.json` erhöhen.
2. Ein Tag `vX.Y.Z` pushen.
3. GitHub Actions baut den Windows-Installer und legt ihn als Release ab.
4. Das installierte Programm findet das Update beim nächsten Start selbst.
