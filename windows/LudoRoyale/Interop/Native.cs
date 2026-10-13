using System;
using System.Runtime.InteropServices;

namespace LudoRoyale.Interop
{
    internal static class Native
    {
        // ---------------------------------------------------------------- Windows version

        public static Version OsVersion { get; } = ReadOsVersion();

        private static Version ReadOsVersion()
        {
            try
            {
                var info = new OSVERSIONINFOEX { dwOSVersionInfoSize = Marshal.SizeOf(typeof(OSVERSIONINFOEX)) };
                if (RtlGetVersion(ref info) == 0) return new Version(info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber);
            }
            catch
            {
            }
            return Environment.OSVersion.Version;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct OSVERSIONINFOEX
        {
            public int dwOSVersionInfoSize;
            public int dwMajorVersion;
            public int dwMinorVersion;
            public int dwBuildNumber;
            public int dwPlatformId;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szCSDVersion;
            public ushort wServicePackMajor;
            public ushort wServicePackMinor;
            public ushort wSuiteMask;
            public byte wProductType;
            public byte wReserved;
        }

        [DllImport("ntdll.dll")]
        private static extern int RtlGetVersion(ref OSVERSIONINFOEX info);

        // ---------------------------------------------------------------- DWM: Mica, dark title bar, frame

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        [DllImport("dwmapi.dll")]
        private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);

        /// <summary>Windows 11 22H2 (build 22621) or later: the documented Mica backdrop.</summary>
        public static bool SupportsMica => OsVersion.Major >= 10 && OsVersion.Build >= 22621;

        public static void SetDarkTitleBar(IntPtr hwnd, bool dark)
        {
            if (hwnd == IntPtr.Zero || OsVersion.Major < 10 || OsVersion.Build < 17763) return;
            try
            {
                var value = dark ? 1 : 0;
                var attribute = OsVersion.Build >= 18985 ? 20 : 19; // DWMWA_USE_IMMERSIVE_DARK_MODE
                DwmSetWindowAttribute(hwnd, attribute, ref value, sizeof(int));
            }
            catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
            {
            }
        }

        /// <summary>Mica behind the title bar (Windows 11 22H2+).</summary>
        public static bool TrySetMica(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero || !SupportsMica) return false;
            try
            {
                var backdrop = 2; // DWMSBT_MAINWINDOW
                return DwmSetWindowAttribute(hwnd, 38, ref backdrop, sizeof(int)) == 0;
            }
            catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
            {
                return false;
            }
        }

        public static void SetRoundCorners(IntPtr hwnd, bool round)
        {
            if (hwnd == IntPtr.Zero || OsVersion.Build < 22000) return;
            try
            {
                var preference = round ? 2 : 1; // DWMWCP_ROUND / DWMWCP_DONOTROUND
                DwmSetWindowAttribute(hwnd, 33, ref preference, sizeof(int));
            }
            catch
            {
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left, Top, Right, Bottom;
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

        /// <summary>
        /// The invisible resize borders around a window (pixels): window rectangle minus the frame you see.
        /// Docked panels subtract them so they sit flush against the screen edge.
        /// </summary>
        public static RECT InvisibleBorders(IntPtr hwnd)
        {
            var result = new RECT();
            try
            {
                if (GetWindowRect(hwnd, out var window) && DwmGetWindowAttribute(hwnd, 9, out var frame, Marshal.SizeOf(typeof(RECT))) == 0) // DWMWA_EXTENDED_FRAME_BOUNDS
                {
                    result.Left = frame.Left - window.Left;
                    result.Top = frame.Top - window.Top;
                    result.Right = window.Right - frame.Right;
                    result.Bottom = window.Bottom - frame.Bottom;
                }
            }
            catch
            {
            }
            return result;
        }

        // ---------------------------------------------------------------- monitors

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public int dwFlags;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int flags);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromPoint(POINT pt, int flags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X, Y;
        }

        /// <summary>Work area (pixels) of the monitor showing most of the window.</summary>
        public static RECT WorkAreaOf(IntPtr hwnd)
        {
            var info = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
            var monitor = MonitorFromWindow(hwnd, 2); // MONITOR_DEFAULTTONEAREST
            if (monitor != IntPtr.Zero && GetMonitorInfo(monitor, ref info)) return info.rcWork;
            return PrimaryWorkArea();
        }

        public static RECT PrimaryWorkArea()
        {
            var info = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
            var monitor = MonitorFromPoint(new POINT(), 1); // MONITOR_DEFAULTTOPRIMARY
            GetMonitorInfo(monitor, ref info);
            return info.rcWork;
        }

        // ---------------------------------------------------------------- attention, focus, full screen

        [StructLayout(LayoutKind.Sequential)]
        private struct FLASHWINFO
        {
            public uint cbSize;
            public IntPtr hwnd;
            public uint dwFlags;
            public uint uCount;
            public uint dwTimeout;
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FlashWindowEx(ref FLASHWINFO info);

        /// <summary>Flashes the taskbar button twice; it then stays highlighted until the window is activated.</summary>
        public static void Flash(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return;
            var info = new FLASHWINFO { cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO)), hwnd = hwnd, dwFlags = 0x2, uCount = 2, dwTimeout = 0 }; // FLASHW_TRAY
            FlashWindowEx(ref info);
        }

        [DllImport("shell32.dll")]
        private static extern int SHQueryUserNotificationState(out int state);

        /// <summary>
        /// True while the user is busy: a full-screen app or game (D3D), presentation mode, or quiet time.
        /// Ludo Royale doesn't pop anything up then.
        /// </summary>
        public static bool UserIsBusy()
        {
            try
            {
                if (SHQueryUserNotificationState(out var state) != 0) return false;
                // 2 QUNS_BUSY (full screen), 3 QUNS_RUNNING_D3D_FULL_SCREEN, 4 QUNS_PRESENTATION_MODE, 6 QUNS_QUIET_TIME
                return state == 2 || state == 3 || state == 4 || state == 6;
            }
            catch
            {
                return false;
            }
        }

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        // ---------------------------------------------------------------- window styles (32-bit safe)

        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_TOOLWINDOW = 0x00000080;
        public const int WS_EX_NOACTIVATE = 0x08000000;

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
        private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
        private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
        private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
        private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

        public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) =>
            IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : new IntPtr(GetWindowLong32(hWnd, nIndex));

        public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) =>
            IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, nIndex, dwNewLong) : new IntPtr(SetWindowLong32(hWnd, nIndex, dwNewLong.ToInt32()));

        /// <summary>Keeps a small helper window out of Alt+Tab and from taking focus.</summary>
        public static void MakeToolWindow(IntPtr hwnd)
        {
            var style = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
            style |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(style));
        }
    }
}
