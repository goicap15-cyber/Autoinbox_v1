$p = Get-CimInstance Win32_Process -Filter "ProcessId=7244"
if ($p) {
  Write-Output ("PID: {0}" -f $p.ProcessId)
  Write-Output ("Name: {0}" -f $p.Name)
  Write-Output ("Parent: {0}" -f $p.ParentProcessId)
  Write-Output ("Exec: {0}" -f $p.ExecutablePath)
  Write-Output ("Cmd: {0}" -f $p.CommandLine)
  $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwner
  Write-Output ("Owner: {0}\{1}" -f $owner.Domain, $owner.User)
} else {
  Write-Output "PID 7244 not found"
}
