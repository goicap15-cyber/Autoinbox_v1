$p1 = @{}
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -match 'chrome|FB Messenger' } | ForEach-Object { $p1[$_.IDProcess] = $_.PercentProcessorTime }
Start-Sleep -Seconds 6
$rows = @()
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -match 'chrome|FB Messenger' } | ForEach-Object {
  $id = $_.IDProcess
  if ($p1.ContainsKey($id)) {
    $d = $_.PercentProcessorTime - $p1[$id]
    if ($d -gt 0) { $rows += [pscustomobject]@{ PID = $id; Name = $_.Name; CPU6s = $d } }
  }
}
$rows | Sort-Object CPU6s -Descending | Select-Object -First 14 | Format-Table -AutoSize
