$procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.ExecutablePath -like '*CRM_FB1*' }

$main = @(); $child = 0
foreach ($p in $procs) {
  if ($p.CommandLine -match '--user-data-dir=("[^"]+"|\S+)') {
    $main += [PSCustomObject]@{ PID = $p.ProcessId; PPID = $p.ParentProcessId; Dir = $Matches[1] }
  } else { $child++ }
}
Write-Output ("Tong process chrome.exe cua du an: " + $procs.Count)
Write-Output ("  Chinh (co user-data-dir): " + $main.Count)
Write-Output ("  Con (tab/renderer/gpu):   " + $child)
Write-Output ""
foreach ($m in $main) {
  $d = $m.Dir -replace '"',''
  $acct = if ($d -match 'profiles[\/](.+?)(\|$)') { $Matches[1] } else { $d }
  Write-Output ("Chrome PID=" + $m.PID + "  profile=" + $acct)
}
