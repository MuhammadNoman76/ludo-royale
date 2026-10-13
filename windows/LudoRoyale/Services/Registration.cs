using System;
using Microsoft.Win32;

namespace LudoRoyale.Services
{
    /// <summary>
    /// Per-user registry entries (no administrator rights): the ludoroyale:// link handler and the
    /// optional "Start with Windows" entry. The uninstaller removes both.
    /// </summary>
    internal static class Registration
    {
        private const string ProtocolKey = @"Software\Classes\ludoroyale";
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValue = "Ludo Royale";

        public static string ExePath => Compat.ProcessPath;

        private static string OpenCommand => "\"" + ExePath + "\" \"%1\"";

        private static string StartupCommand => "\"" + ExePath + "\" --tray";

        public static bool ProtocolRegistered
        {
            get
            {
                try
                {
                    using var key = Registry.CurrentUser.OpenSubKey(ProtocolKey + @"\shell\open\command");
                    return key?.GetValue("") is string cmd && string.Equals(cmd, OpenCommand, StringComparison.OrdinalIgnoreCase);
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Read protocol key");
                    return false;
                }
            }
        }

        public static void SetProtocol(bool on)
        {
            try
            {
                if (!on)
                {
                    Registry.CurrentUser.DeleteSubKeyTree(ProtocolKey, throwOnMissingSubKey: false);
                    return;
                }
                using var key = Registry.CurrentUser.CreateSubKey(ProtocolKey);
                key.SetValue("", "URL:Ludo Royale");
                key.SetValue("URL Protocol", "");
                using (var icon = key.CreateSubKey("DefaultIcon")) icon.SetValue("", "\"" + ExePath + "\",0");
                using var command = key.CreateSubKey(@"shell\open\command");
                command.SetValue("", OpenCommand);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Write protocol key");
            }
        }

        public static bool StartsWithWindows
        {
            get
            {
                try
                {
                    using var key = Registry.CurrentUser.OpenSubKey(RunKey);
                    return key?.GetValue(RunValue) is string cmd && string.Equals(cmd, StartupCommand, StringComparison.OrdinalIgnoreCase);
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Read Run key");
                    return false;
                }
            }
        }

        public static void SetStartWithWindows(bool on)
        {
            try
            {
                using var key = Registry.CurrentUser.CreateSubKey(RunKey);
                if (on) key.SetValue(RunValue, StartupCommand);
                else if (key.GetValue(RunValue) != null) key.DeleteValue(RunValue, throwOnMissingValue: false);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Write Run key");
            }
        }
    }
}
