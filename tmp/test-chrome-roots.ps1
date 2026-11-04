$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'"
Write-Output "--- chrome ROOT candidates (cmdline contains --user-data-dir or no parent chrome) ---"
$allIds = @{}
foreach ($p in $procs) { $allIds[[uint32]$p.ProcessId] = $true }
foreach ($p in $procs) {
  $parentIsChrome = $allIds.ContainsKey([uint32]$p.ParentProcessId)
  $udd = if ($p.CommandLine -match '--user-data-dir=("([^"]+)"|([^ ]+))') { ($Matches[2] + $Matches[3]) } else { '(NO UDD)' }
  $type = 'child'
  if (-not $parentIsChrome) { $type = 'ROOT' }
  if ($p.CommandLine -notmatch '--type=') { $type = "$type/MAIN" }
  Write-Output ("pid=" + $p.ProcessId + " parent=" + $p.ParentProcessId + " born=" + $p.CreationDate + " " + $type)
  Write-Output ("   udd=" + $udd)
  Write-Output ("   exe=" + $p.ExecutablePath)
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')
$tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
$btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$buttons = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
Write-Output "--- taskbar buttons (chrome-related) ---"
foreach ($b in $buttons) {
  $name = $b.Current.Name
  if ($name -like '*Chrome*') {
    Write-Output ("BTN: '" + $name + "' autoId='" + $b.Current.AutomationId + "'")
  }
}
