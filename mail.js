// Mails aus dem Outlook auf diesem PC (klassisches Outlook, über COM/PowerShell).
// Kein Passwort, nichts wird auf G: abgelegt: das Cockpit liest nur und merkt sich bei Verknüpfungen die Outlook-ID.
const { execFile } = require('child_process');

const ps = (script, env, timeout = 60000) => new Promise((resolve) => {
  if (process.platform !== 'win32') { resolve({ ok: false, error: 'Mails gehen nur unter Windows mit Outlook.' }); return; }
  const kopf = "$ErrorActionPreference='Stop'\n[Console]::OutputEncoding=[Text.Encoding]::UTF8\n" +
    "try { $o = New-Object -ComObject Outlook.Application; $ns = $o.GetNamespace('MAPI') } catch { Write-Output '{\"ok\":false,\"error\":\"outlook\"}'; exit }\n";
  const enc = Buffer.from(kopf + script, 'utf16le').toString('base64');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
    { env: { ...process.env, ...env }, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
    (err, stdout) => {
      const t = String(stdout || '').trim();
      const i = t.indexOf('{');
      try {
        const r = JSON.parse(t.slice(i));
        if (r && r.ok === false && r.error === 'outlook') r.error = 'Outlook wurde nicht gefunden. Das Cockpit braucht das klassische Outlook (nicht das «neue Outlook»).';
        resolve(r);
      } catch (_) {
        resolve({ ok: false, error: err && err.killed ? 'Outlook hat zu lange gebraucht. Nochmals versuchen.' : 'Outlook antwortet nicht. Ist Outlook offen?' });
      }
    });
});

const LISTE = `
$f = if ($env:ZG_ORDNER -eq 'sent') { $ns.GetDefaultFolder(5) } else { $ns.GetDefaultFolder(6) }
$feld = if ($env:ZG_ORDNER -eq 'sent') { '[SentOn]' } else { '[ReceivedTime]' }
$items = $f.Items; $items.Sort($feld, $true)
$n = [int]$env:ZG_ANZAHL; $out = New-Object System.Collections.ArrayList
$m = $items.GetFirst()
while ($m -ne $null -and $out.Count -lt $n) {
  if ($m.Class -eq 43) {
    $z = if ($env:ZG_ORDNER -eq 'sent') { $m.SentOn } else { $m.ReceivedTime }
    [void]$out.Add([pscustomobject]@{ id = [string]$m.EntryID; betreff = [string]$m.Subject; von = [string]$m.SenderName; an = [string]$m.To; zeit = $z.ToString('s'); neu = [bool]$m.UnRead; anh = [int]$m.Attachments.Count })
  }
  $m = $items.GetNext()
}
Write-Output (@{ ok = $true; mails = @($out.ToArray()) } | ConvertTo-Json -Depth 4 -Compress)
`;

const DETAIL = `
try { $m = $ns.GetItemFromID($env:ZG_ID) } catch { Write-Output '{"ok":false,"error":"Die Mail wurde nicht gefunden. Vielleicht verschoben oder gelöscht."}'; exit }
$b = [string]$m.Body; if ($b.Length -gt 30000) { $b = $b.Substring(0, 30000) + ' …' }
$a = @(); foreach ($x in $m.Attachments) { $a += [string]$x.FileName }
$z = if ($m.ReceivedTime) { $m.ReceivedTime.ToString('s') } else { '' }
Write-Output (@{ ok = $true; mail = @{ id = [string]$m.EntryID; betreff = [string]$m.Subject; von = [string]$m.SenderName; an = [string]$m.To; cc = [string]$m.CC; zeit = $z; text = $b; anhaenge = @($a) } } | ConvertTo-Json -Depth 4 -Compress)
`;

const OEFFNEN = `
try { $m = $ns.GetItemFromID($env:ZG_ID) } catch { Write-Output '{"ok":false,"error":"Die Mail wurde nicht gefunden. Vielleicht verschoben oder gelöscht."}'; exit }
$m.Display()
Write-Output '{"ok":true}'
`;

const NEU = `
$m = $o.CreateItem(0)
if ($env:ZG_AN) { $m.To = $env:ZG_AN }
if ($env:ZG_BETREFF) { $m.Subject = $env:ZG_BETREFF }
$m.Display()
Write-Output '{"ok":true}'
`;

const ANTWORT = `
try { $m = $ns.GetItemFromID($env:ZG_ID) } catch { Write-Output '{"ok":false,"error":"Die Mail wurde nicht gefunden."}'; exit }
$r = if ($env:ZG_ALLE -eq '1') { $m.ReplyAll() } else { $m.Reply() }
$r.Display()
Write-Output '{"ok":true}'
`;

const ID = /^[0-9A-Fa-f]{20,600}$/;
const id = (x) => { const s = String(x || '').replace(/^outlook:/i, ''); return ID.test(s) ? s : null; };

module.exports = ({ ipcMain }) => {
  ipcMain.handle('mail-liste', (_e, o = {}) => ps(LISTE, { ZG_ORDNER: o.ordner === 'sent' ? 'sent' : 'inbox', ZG_ANZAHL: String(Math.min(300, Math.max(10, Number(o.anzahl) || 80))) }, 90000));
  ipcMain.handle('mail-detail', (_e, x) => { const i = id(x); return i ? ps(DETAIL, { ZG_ID: i }) : { ok: false, error: 'Ungültige Mail.' }; });
  ipcMain.handle('mail-oeffnen', (_e, x) => { const i = id(x); return i ? ps(OEFFNEN, { ZG_ID: i }) : { ok: false, error: 'Ungültige Mail.' }; });
  ipcMain.handle('mail-antworten', (_e, { id: x, alle }) => { const i = id(x); return i ? ps(ANTWORT, { ZG_ID: i, ZG_ALLE: alle ? '1' : '0' }) : { ok: false, error: 'Ungültige Mail.' }; });
  ipcMain.handle('mail-neu', (_e, o = {}) => ps(NEU, { ZG_AN: String(o.an || '').slice(0, 500), ZG_BETREFF: String(o.betreff || '').slice(0, 300) }));
  return { oeffnen: (x) => { const i = id(x); return i ? ps(OEFFNEN, { ZG_ID: i }) : Promise.resolve({ ok: false, error: 'Ungültige Mail.' }); } };
};
