Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -match 'electron|CRM|chrome') -or ($_.CommandLine -like '*CRM_FB1*') -or ($_.ExecutablePath -like '*CRM_FB1*')
} | Select-Object ProcessId, Name, ExecutablePath | Format-Table -AutoSize -Wrap
