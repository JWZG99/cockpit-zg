// Updates über den Server, ohne GitHub (ZG, 10.11.2026)
// Auf G: liegt in «90 ZG Programm\Programm» eine vollständige Kopie des Programms (Vorlage für neue PCs)
// und in «Programm\version.json» ihre Version.
// - Startet ein PC eine NEUERE Version als die auf G:, legt er seine Version dort ab (so verteilt ZG Updates).
// - Startet ein PC eine ÄLTERE Version, holt er die neue app.asar von G: und startet neu.
// Mit original-fs, damit .asar-Dateien als Dateien kopiert werden und nicht als Ordner.
const ofs = require('original-fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const neuer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
const lies = (f) => { try { return JSON.parse(ofs.readFileSync(f, 'utf8')); } catch (_) { return null; } };

module.exports = ({ app, BUERO, dialog }) => {
  const MASTER = path.join(BUERO, 'Programm');
  const VJSON = path.join(MASTER, 'version.json');
  const resDir = process.resourcesPath;
  const progDir = path.dirname(app.getPath('exe'));
  const meine = app.getVersion();

  const installer = () => [
    '@echo off',
    'rem Cockpit ZG auf diesem PC installieren (ins Benutzerprofil, keine Administratorrechte nötig)',
    'set "QUELLE=%~dp0Programm"',
    'set "ZIEL=%LOCALAPPDATA%\\Programs\\Cockpit ZG"',
    'echo Cockpit ZG wird installiert ...',
    'taskkill /im "Cockpit ZG.exe" /f >nul 2>&1',
    'robocopy "%QUELLE%" "%ZIEL%" /MIR /XF version.json /NFL /NDL /NJH /NJS /R:2 /W:2 >nul',
    'if %ERRORLEVEL% GEQ 8 (echo Kopieren ging nicht. & pause & exit /b 1)',
    'powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath(\'Desktop\')+\'\\Cockpit ZG.lnk\');$s.TargetPath=$env:ZIEL+\'\\Cockpit ZG.exe\';$s.WorkingDirectory=$env:ZIEL;$s.Save()"',
    'start "" "%ZIEL%\\Cockpit ZG.exe"',
    '',
  ].join('\r\n');

  // eigene Version auf G: ablegen (im Hintergrund; das erste Mal das ganze Programm, danach nur app.asar)
  // fortschritt(text, prozent) meldet, was gerade passiert
  const ablegen = async (fortschritt = () => {}) => {
    const ganz = !ofs.existsSync(path.join(MASTER, 'Cockpit ZG.exe'));
    // nur das Programm, keine Daten, die im Programmordner liegen geblieben sind
    const nurProgramm = (q) => { const rel = path.relative(progDir, q).toLowerCase(); return !/^(daten|dateien)([\\/]|$)|^cockpit-daten.*\.json$|\.neu$/.test(rel); };
    const liste = [];
    const sammeln = async (d) => {
      for (const e of await ofs.promises.readdir(d, { withFileTypes: true })) {
        const q = path.join(d, e.name); if (!nurProgramm(q)) continue;
        if (e.isDirectory()) await sammeln(q); else liste.push({ q, gr: (await ofs.promises.stat(q)).size });
      }
    };
    if (ganz) await sammeln(progDir); else liste.push({ q: path.join(resDir, 'app.asar'), gr: ofs.statSync(path.join(resDir, 'app.asar')).size });
    const total = liste.reduce((a, x) => a + x.gr, 0) || 1;
    let done = 0;
    const text = 'Version ' + meine + ' wird für die anderen PCs auf G: abgelegt';
    fortschritt(text, 0);
    const basis = ganz ? MASTER + '.neu' : MASTER;
    if (ganz) await ofs.promises.rm(basis, { recursive: true, force: true });
    for (const x of liste) {
      const rel = ganz ? path.relative(progDir, x.q) : path.join('resources', 'app.asar');
      const z = path.join(basis, rel);
      await ofs.promises.mkdir(path.dirname(z), { recursive: true });
      await ofs.promises.copyFile(x.q, z + '.teil');
      await ofs.promises.rename(z + '.teil', z);
      done += x.gr; fortschritt(text, Math.round(done / total * 100));
    }
    if (ganz) { await ofs.promises.rm(MASTER, { recursive: true, force: true }); await ofs.promises.rename(basis, MASTER); }
    await ofs.promises.writeFile(VJSON, JSON.stringify({ version: meine, am: new Date().toISOString(), von: os.hostname() }, null, 1));
    await ofs.promises.writeFile(path.join(BUERO, 'Cockpit installieren.cmd'), installer());
    fortschritt(null);
  };

  // neue Version von G: holen, dann über ein kleines Skript austauschen und neu starten
  const holen = (v) => {
    const quelle = path.join(MASTER, 'resources', 'app.asar');
    const neu = path.join(resDir, 'app.asar.neu');
    ofs.copyFileSync(quelle, neu);
    const cmd = path.join(os.tmpdir(), 'cockpit-update-' + process.pid + '.cmd');
    ofs.writeFileSync(cmd, [
      '@echo off',
      ':warten',
      `tasklist /fi "PID eq ${process.pid}" 2>nul | find "${process.pid}" >nul && (timeout /t 1 /nobreak >nul & goto warten)`,
      `move /y "${neu}" "${path.join(resDir, 'app.asar')}" >nul`,
      `start "" "${app.getPath('exe')}"`,
      '(goto) 2>nul & del "%~f0"',
      '',
    ].join('\r\n'));
    spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return v;
  };

  // Version auf G: (oder null)
  const gVersion = () => { if (!ofs.existsSync(BUERO)) return null; const g = lies(VJSON); return g && g.version ? String(g.version) : null; };
  // neuere Version auf G: bereit? -> Versionsnummer
  const bereit = () => {
    if (!app.isPackaged || process.platform !== 'win32') return null;
    const gv = gVersion();
    return gv && neuer(gv, meine) && ofs.existsSync(path.join(MASTER, 'resources', 'app.asar')) ? gv : null;
  };
  // eigene Version neuer als G:? (dann ablegen)
  const sollAblegen = () => {
    if (!app.isPackaged || process.platform !== 'win32' || !ofs.existsSync(BUERO)) return false;
    const gv = gVersion();
    return !gv || neuer(meine, gv);
  };
  const installieren = () => { const v = bereit(); if (!v) return false; holen(v); return true; };
  return { bereit, sollAblegen, ablegen, installieren, neuer, meine };
};
