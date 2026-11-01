Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public class AppIdReader {
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    void GetCount(out uint cProps);
    void GetAt(uint iProp, out PropertyKey pkey);
    void GetValue(ref PropertyKey key, out PROPVARIANT pv);
    void SetValue(ref PropertyKey key, ref PROPVARIANT pv);
    void Commit();
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PropertyKey { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)]
  public struct PROPVARIANT {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointerValue;
  }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("shell32.dll")] public static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  public static PropertyKey PKEY_APPUSERMODEL_ID = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };

  public static string ReadAppId(IntPtr hwnd) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    IPropertyStore store;
    int hr = SHGetPropertyStoreForWindow(hwnd, ref iid, out store);
    if (hr != 0) return null;
    PROPVARIANT pv;
    var key = PKEY_APPUSERMODEL_ID;
    store.GetValue(ref key, out pv);
    if (pv.vt == 31 && pv.pointerValue != IntPtr.Zero) {
      return Marshal.PtrToStringUni(pv.pointerValue);
    }
    return null;
  }
}
"@

$found = New-Object System.Collections.ArrayList
$cb = [AppIdReader+EnumProc]{
  param($h, $l)
  $procId = [uint32]0
  [void][AppIdReader]::GetWindowThreadProcessId($h, [ref]$procId)
  $sbC = New-Object System.Text.StringBuilder 256
  [void][AppIdReader]::GetClassName($h, $sbC, 256)
  $cls = $sbC.ToString()
  if ($cls -eq 'Chrome_WidgetWin_1' -or $cls -eq 'Chrome_WidgetWin_0') {
    $sbT = New-Object System.Text.StringBuilder 512
    [void][AppIdReader]::GetWindowText($h, $sbT, 512)
    $vis = [AppIdReader]::IsWindowVisible($h)
    $appId = [AppIdReader]::ReadAppId($h)
    [void]$found.Add("pid=$procId vis=$vis class=$cls appid='$appId' title='$($sbT)'")
  }
  return $true
}
[void][AppIdReader]::EnumWindows($cb, [IntPtr]::Zero)
Write-Output "--- live chrome windows with AppUserModelID ---"
$found | ForEach-Object { Write-Output $_ }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')
$tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
$btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$buttons = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
Write-Output "--- taskbar chrome buttons ---"
foreach ($b in $buttons) {
  $name = $b.Current.Name
  if ($name -like '*Chrome*') { Write-Output ("BTN '" + $name + "' | " + $b.Current.AutomationId) }
}
