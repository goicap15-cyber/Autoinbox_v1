$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue
foreach ($p in $procs) {
  $cl = [string]$p.CommandLine
  $prof = ''
  if ($cl.Contains('--user-data-dir=')) {
    $idx = $cl.IndexOf('--user-data-dir=')
    $prof = $cl.Substring($idx + 17, [Math]::Min(100, $cl.Length - $idx - 17))
  }
  $dbg = ''
  if ($cl.Contains('--remote-debugging-port=')) {
    $idx = $cl.IndexOf('--remote-debugging-port=')
    $dbg = $cl.Substring($idx, [Math]::Min(28, $cl.Length - $idx))
  }
  Write-Output ("PID=" + $p.ProcessId + " | PROF=" + $prof + " | " + $dbg)
}
