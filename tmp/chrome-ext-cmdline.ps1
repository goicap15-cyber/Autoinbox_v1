$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'autochatbot|crm-extension|load-extension' }
foreach ($p in $procs) {
  $cl = $p.CommandLine
  $load = ''
  if ($cl -match '--load-extension="?([^" ]+)') { $load = $Matches[1] }
  $prof = ''
  if ($cl -match '--user-data-dir=([^" ]+)') { $prof = $Matches[1] }
  $parent = ''
  if ($cl -match '--remote-debugging-port=(\d+)') { $parent = $Matches[1] }
  Write-Output ("PID=" + $p.ProcessId + " PORT=" + $parent + " PROF=" + $prof + " EXT=" + $load)
}
