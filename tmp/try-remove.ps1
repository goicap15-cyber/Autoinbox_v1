try {
  Remove-Item 'C:\Users\Admin\Downloads\Duan\CRM_FB1\release\win-unpacked' -Recurse -Force -ErrorAction Stop
  Write-Output 'REMOVE_OK'
} catch {
  Write-Output ('REMOVE_FAIL: ' + $_.Exception.Message)
}
