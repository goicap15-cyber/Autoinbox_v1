$shell = New-Object -ComObject Shell.Application
$closed = 0
foreach ($win in $shell.Windows()) {
  try {
    $loc = $win.LocationURL
    if ($loc -and $loc -like '*win-unpacked*') {
      Write-Output ("Closing Explorer window: {0}" -f $loc)
      $win.Quit()
      $closed++
    }
  } catch { }
}
Write-Output ("Closed {0} explorer window(s)" -f $closed)
