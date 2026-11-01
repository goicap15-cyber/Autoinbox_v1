$procs = Get-Process | Where-Object { $_.Path -like '*win-unpacked*' -or $_.Path -like '*CRM_FB1*' -or $_.Path -like '*autochatbot*' }
if ($procs) {
  $procs | Select-Object Id, ProcessName, Path | Format-Table -AutoSize | Out-String -Width 300
} else {
  Write-Output "NO_PROCESS_HOLDING"
}
