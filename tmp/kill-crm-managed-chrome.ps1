# Kill ONLY the CRM-managed Chrome (profile under autochatbot-fb-crm), keep user's personal Chrome.
$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { ($_ | Select-Object -ExpandProperty CommandLine) -like '*autochatbot-fb-crm*' }
$killed = 0
foreach ($p in $procs) {
  $pidToKill = $p.ProcessId
  taskkill.exe /PID $pidToKill /T /F 2>$null | Out-Null
  $killed++
}
Write-Output ("KILLED_TREE_ROOTS=" + $killed)
