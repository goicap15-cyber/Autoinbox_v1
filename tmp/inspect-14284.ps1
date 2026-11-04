$p = Get-CimInstance Win32_Process -Filter "ProcessId=14284"
if ($p) {
  Write-Output ("Name: {0}" -f $p.Name)
  Write-Output ("Parent: {0}" -f $p.ParentProcessId)
  Write-Output ("Exec: {0}" -f $p.ExecutablePath)
  Write-Output ("Cmd: {0}" -f $p.CommandLine)
} else { Write-Output "14284 not found" }
