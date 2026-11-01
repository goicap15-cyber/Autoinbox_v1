Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FG2 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder sb, int max);
}
"@
function Get-FgTitle {
  $h = [FG2]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][FG2]::GetWindowText($h, $sb, 512)
  return $sb.ToString()
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')
$tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
$btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$buttons = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)

foreach ($b in $buttons) {
  $name = $b.Current.Name
  if ($name -like '*Chrome*') {
    Write-Output ("=== '" + $name + "' | " + $b.Current.AutomationId + " ===")
    $before = Get-FgTitle
    try {
      $acc = $b.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
      $acc.DoDefaultAction()
    } catch {
      Write-Output ("  DoDefaultAction FAILED: " + $_.Exception.Message)
      continue
    }
    Start-Sleep -Milliseconds 1800
    $after = Get-FgTitle
    if ($after -ne $before) { Write-Output ("  LIVE - foreground switched to: '$after'") }
    else { Write-Output ("  NO REACTION (foreground still '$before') => GHOST or minimized-only") }
  }
}
Write-Output "done"
