const { execSync } = require('child_process');

const ps = `
$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { ($_ | Select-Object -ExpandProperty CommandLine) -like '*autochatbot-fb-crm*' }
$killed = 0
foreach ($p in $procs) {
  $id = $p.ProcessId
  taskkill.exe /PID $id /T /F 2>$null | Out-Null
  $killed++
}
Write-Output ("TOTAL_KILLED=" + $killed)
`;
const encoded = Buffer.from(ps, 'utf16le').toString('base64');
const out = execSync(
  `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
  { encoding: 'utf8', windowsHide: true, timeout: 30000 }
);
console.log(out.trim());
