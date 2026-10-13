# Captures the visible windows of ONE process (by id) with PrintWindow, never the screen, so nothing
# else on the desktop ends up in a screenshot. Also answers "is a full-screen app running?".
#   capture.ps1 -ProcessId 1234 -Out shot.png [-Which main|tab|largest]
#   capture.ps1 -Busy        (prints busy / free from SHQueryUserNotificationState)
#   capture.ps1 -ProcessId 1234 -List
#   capture.ps1 -ProcessId 1234 -PostClose   (posts WM_CLOSE to that process's main window, like its X button)
param(
    [int]$ProcessId,
    [string]$Out,
    [ValidateSet("main", "tab", "dialog", "largest")]
    [string]$Which = "main",
    [switch]$Busy,
    [switch]$List,
    [switch]$PostClose
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class LudoCapture
{
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT r, int size);
    [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);

    public static void Close(Win w, uint pid)
    {
        uint owner; GetWindowThreadProcessId(w.Handle, out owner);
        if (owner != pid) throw new InvalidOperationException("Window belongs to another process");
        PostMessage(w.Handle, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
    }

    // Per-monitor aware, so window sizes and PrintWindow output aren't scaled by Windows.
    public static void PerMonitor() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } }

    public class Win { public IntPtr Handle; public string Title; public string Class; public RECT Rect; public RECT Frame; }

    public static List<Win> Windows(uint pid)
    {
        PerMonitor();
        var list = new List<Win>();
        EnumWindows((h, l) => {
            uint p; GetWindowThreadProcessId(h, out p);
            if (p != pid || !IsWindowVisible(h)) return true;
            var t = new StringBuilder(256); GetWindowText(h, t, 256);
            var c = new StringBuilder(256); GetClassName(h, c, 256);
            RECT r; GetWindowRect(h, out r);
            RECT f; if (DwmGetWindowAttribute(h, 9, out f, Marshal.SizeOf(typeof(RECT))) != 0) f = r;
            if (r.Right - r.Left < 8 || r.Bottom - r.Top < 8) return true;
            list.Add(new Win { Handle = h, Title = t.ToString(), Class = c.ToString(), Rect = r, Frame = f });
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static void Capture(Win w, uint pid, string path)
    {
        PerMonitor();
        uint owner; GetWindowThreadProcessId(w.Handle, out owner);
        if (owner != pid) throw new InvalidOperationException("Window belongs to another process");
        int width = w.Rect.Right - w.Rect.Left, height = w.Rect.Bottom - w.Rect.Top;
        using (var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                var hdc = g.GetHdc();
                PrintWindow(w.Handle, hdc, 2); // PW_RENDERFULLCONTENT (includes WebView2 content)
                g.ReleaseHdc(hdc);
            }
            // Crop the invisible resize borders.
            var crop = new Rectangle(w.Frame.Left - w.Rect.Left, w.Frame.Top - w.Rect.Top, w.Frame.Right - w.Frame.Left, w.Frame.Bottom - w.Frame.Top);
            if (crop.Width <= 0 || crop.Height <= 0 || crop.Right > width || crop.Bottom > height) crop = new Rectangle(0, 0, width, height);
            using (var cut = bmp.Clone(crop, PixelFormat.Format32bppArgb)) cut.Save(path, ImageFormat.Png);
        }
    }
}
"@

if ($Busy) {
    $state = 0
    [void][LudoCapture]::SHQueryUserNotificationState([ref]$state)
    if ($state -in 2, 3, 4, 6) { "busy $state" } else { "free $state" }
    return
}

$wins = [LudoCapture]::Windows([uint32]$ProcessId)
if ($List) {
    $wins | ForEach-Object { "{0} '{1}' {2} {3}x{4}" -f $_.Handle, $_.Title, $_.Class, ($_.Frame.Right - $_.Frame.Left), ($_.Frame.Bottom - $_.Frame.Top) }
    return
}
$pick = switch ($Which) {
    "main" { $wins | Where-Object { $_.Title -eq "Ludo Royale" -and ($_.Frame.Right - $_.Frame.Left) -gt 200 } | Select-Object -First 1 }
    "tab" { $wins | Where-Object { ($_.Frame.Right - $_.Frame.Left) -lt 80 } | Select-Object -First 1 }
    "dialog" { $wins | Sort-Object { ($_.Frame.Right - $_.Frame.Left) * ($_.Frame.Bottom - $_.Frame.Top) } | Where-Object { ($_.Frame.Right - $_.Frame.Left) -gt 200 } | Select-Object -First 1 }
    default { $wins | Sort-Object { - ($_.Frame.Right - $_.Frame.Left) * ($_.Frame.Bottom - $_.Frame.Top) } | Select-Object -First 1 }
}
if (-not $pick) { throw "No visible '$Which' window for process $ProcessId" }
if ($PostClose) {
    [LudoCapture]::Close($pick, [uint32]$ProcessId)
    "posted WM_CLOSE"
    return
}
[LudoCapture]::Capture($pick, [uint32]$ProcessId, $Out)
"captured {0} ({1}x{2})" -f $Out, ($pick.Frame.Right - $pick.Frame.Left), ($pick.Frame.Bottom - $pick.Frame.Top)
