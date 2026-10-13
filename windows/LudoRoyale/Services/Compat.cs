using System;
using System.Diagnostics;

namespace LudoRoyale.Services
{
    internal static class Compat
    {
        /// <summary>Full path of the running executable.</summary>
        public static string ProcessPath
        {
            get
            {
                try
                {
                    using var p = Process.GetCurrentProcess();
                    return p.MainModule?.FileName ?? System.Reflection.Assembly.GetEntryAssembly()?.Location ?? "";
                }
                catch
                {
                    return System.Reflection.Assembly.GetEntryAssembly()?.Location ?? "";
                }
            }
        }

        public static string AppDirectory => AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');

        public static double Clamp(double value, double min, double max) => value < min ? min : value > max ? max : value;

        /// <summary>Opens an https address in the default browser.</summary>
        public static void OpenInBrowser(string url)
        {
            try
            {
                if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps) return;
                Process.Start(new ProcessStartInfo { FileName = uri.AbsoluteUri, UseShellExecute = true })?.Dispose();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Open " + url);
            }
        }
    }
}
