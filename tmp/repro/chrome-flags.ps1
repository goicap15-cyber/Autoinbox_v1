$procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"
$mains = $procs | Where-Object { $_.CommandLine -and ($_.CommandLine -notmatch '--type=') }
Write-Output ("main browser processes: " + $mains.Count)
foreach ($m in $mains) {
  Write-Output ("--- PID " + $m.ProcessId + " started " + $m.CreationDate)
  Write-Output $m.CommandLine.Substring(0, [Math]::Min(700, $m.CommandLine.Length))
  Write-Output ""
}
