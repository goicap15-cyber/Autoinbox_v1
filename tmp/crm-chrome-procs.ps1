$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { ($_ | Select-Object -ExpandProperty CommandLine) -like '*autochatbot-fb-crm*' }
$seen = @{}
foreach ($p in $procs) {
  $cl = $p.CommandLine
  $prof = ''
  if ($cl -match '--user-data-dir=("[^"]+"|\S+)') { $prof = $Matches[1] }
  $key = $prof + '|' + $p.ExecutablePath
  if (-not $seen.ContainsKey($key)) {
    $seen[$key] = @{ Count = 0; Exe = $p.ExecutablePath; Profile = $prof; Pids = @() }
  }
  $seen[$key].Count++
  $seen[$key].Pids += $p.ProcessId
}
foreach ($k in $seen.Keys) {
  $info = $seen[$k]
  $earliest = $null
  foreach ($procId in $info.Pids) {
    $pr = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($pr -and $null -ne $pr.StartTime) {
      if ($null -eq $earliest -or $pr.StartTime -lt $earliest) { $earliest = $pr.StartTime }
    }
  }
  Write-Output ("PROFILE=" + $info.Profile + " | procs=" + $info.Count + " | exe=" + $info.Exe + " | earliest=" + $earliest)
}
