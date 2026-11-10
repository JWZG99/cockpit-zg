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
  const ablegen = async () => {
    const ganz = !ofs.existsSync(path.join(MASTER, 'Cockpit ZG.exe'));
    if (ganz) {
      const tmp = MASTER + '.neu';
      await ofs.promises.rm(tmp, { recursive: true, force: true });
      // nur das Programm, keine Daten, die im Programmordner liegen geblieben sind
      const nurProgramm = (q) => { const rel = path.relative(progDir, q).toLowerCase(); return !/^(daten|dateien)([\\/]|$)|^cockpit-daten.*\.json$|\.neu$/.test(rel); };
      await ofs.promises.cp(progDir, tmp, { recursive: true, filter: nurProgramm });
      await ofs.promises.rm(MASTER, { recursive: true, force: true });
      await ofs.promises.rename(tmp, MASTER);
    } else {
      const ziel = path.join(MASTER, 'resources', 'app.asar');
      await ofs.promises.copyFile(path.join(resDir, 'app.asar'), ziel + '.neu');
      await ofs.promises.rename(ziel + '.neu', ziel);
    }
    await ofs.promises.writeFile(VJSON, JSON.stringify({ version: meine, am: new Date().toISOString(), von: os.hostname() }, null, 1));
    await ofs.promises.writeFile(path.join(BUERO, 'Cockpit installieren.cmd'), installer());
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

  // beim Start: true = es wird gerade aktualisiert, das Programm soll sich beenden
  const pruefen = () => {
    if (!app.isPackaged || process.platform !== 'win32' || !ofs.existsSync(BUERO)) return false;
    const g = lies(VJSON);
    const gv = g && g.version;
    if (gv && neuer(gv, meine) && ofs.existsSync(path.join(MASTER, 'resources', 'app.asar'))) {
      try { holen(gv); return true; } catch (_) { return false; }
    }
    if (!gv || neuer(meine, gv)) ablegen().catch(() => {});
    return false;
  };
  return { pruefen, neuer };
};
