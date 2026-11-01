$procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"
foreach ($p in $procs) {
  $cl = $p.CommandLine
  if (-not $cl) { continue }
  if ($cl -match 'autochatbot-fb-crm') {
    $isMain = $cl -notmatch '--type='
    if ($isMain) {
      Write-Output "MAIN PID=$($p.ProcessId)"
      Write-Output $cl.Substring(0, [Math]::Min(1600, $cl.Length))
    }
  }
}
