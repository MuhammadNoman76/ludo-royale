using System;
using System.IO;

namespace LudoRoyale.Services
{
    /// <summary>Writes unexpected errors to %APPDATA%\LudoRoyale\error.log (never throws).</summary>
    internal static class Log
    {
        private static readonly object Gate = new object();

        public static void Error(Exception? ex, string? context = null)
        {
            if (ex == null) return;
            Write(context + Environment.NewLine + ex);
        }

        public static void Info(string message) => Write(message);

        private static void Write(string text)
        {
            try
            {
                lock (Gate)
                {
                    Directory.CreateDirectory(AppSettings.DataDirectory);
                    var file = Path.Combine(AppSettings.DataDirectory, "error.log");
                    if (File.Exists(file) && new FileInfo(file).Length > 1_000_000) File.Delete(file);
                    File.AppendAllText(file, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + text + Environment.NewLine + Environment.NewLine);
                }
            }
            catch
            {
                // Logging must never take the app down.
            }
        }
    }
}
