// Kill CRM app + CRM Chrome (profile contains autochatbot-fb-crm)
const { execSync } = require('child_process');

function psEncoded(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

const script = `
$appProcs = Get-Process | Where-Object { $_.Name -like 'FB Messenger CRM*' }
$ids = @($appProcs | Select-Object -ExpandProperty Id)
foreach ($procId in $ids) { taskkill.exe /PID $procId /T /F 2>$null }
Write-Output ("APP_KILLED=" + $ids.Count)

$chromeProcs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object { $_.CommandLine -match 'autochatbot-fb-crm' }
$cids = @($chromeProcs | Select-Object -ExpandProperty ProcessId -Unique)
foreach ($procId in $cids) { taskkill.exe /PID $procId /T /F 2>$null }
Write-Output ("CHROME_KILLED=" + $cids.Count)
`;

const b64 = psEncoded(script);
const out = execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${b64}`, { encoding: 'utf8', timeout: 60000 });
console.log(out);
