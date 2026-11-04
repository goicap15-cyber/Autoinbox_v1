$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue
foreach ($p in $procs) {
  $cl = [string]$p.CommandLine
  if ($cl -like '*autochatbot*') {
    $prof = ''
    if ($cl.Contains('--user-data-dir=')) {
      $idx = $cl.IndexOf('--user-data-dir=')
      $prof = $cl.Substring($idx + 17, [Math]::Min(110, $cl.Length - $idx - 17))
    }
    Write-Output ("PID=" + $p.ProcessId + " PROF=" + $prof)
  }
}
