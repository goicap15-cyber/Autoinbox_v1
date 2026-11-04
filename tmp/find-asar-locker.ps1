$asar = 'C:\Users\Admin\Downloads\Duan\CRM_FB1\release\win-unpacked\resources\app.asar'
# Who has the handle? Use Restart Manager via .NET is heavy; try openfiles (needs maintain objects list) — fallback: list handles via NtQuery not available.
# Pragmatic: find any process whose modules include the asar path.
$hits = @()
Get-Process | ForEach-Object {
  try {
    foreach ($m in $_.Modules) {
      if ($m.FileName -like '*win-unpacked*') { $hits += [PSCustomObject]@{ PID = $_.Id; Name = $_.ProcessName; Module = $m.FileName } }
    }
  } catch {}
}
$hits | Format-Table -AutoSize | Out-String -Width 300
