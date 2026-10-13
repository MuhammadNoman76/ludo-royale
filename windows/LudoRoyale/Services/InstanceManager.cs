using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;

namespace LudoRoyale.Services
{
    /// <summary>
    /// One Ludo Royale per Windows session. A second start (for example a ludoroyale:// link clicked in the
    /// browser) hands its command line to the running copy through a named pipe and exits.
    /// The pipe only accepts writes from the same user (default pipe security), and what arrives is
    /// parsed as strictly as a real command line.
    /// </summary>
    internal static class InstanceManager
    {
        private const int MaxMessage = 4096;
        private static Mutex? s_mutex;

        private static string Name => "LudoRoyale-" + Environment.UserName + "-" + SessionId;

        private static int SessionId
        {
            get
            {
                try
                {
                    using var me = Process.GetCurrentProcess();
                    return me.SessionId;
                }
                catch
                {
                    return 0;
                }
            }
        }

        /// <summary>Raised on a background thread with the arguments of a later start.</summary>
        public static event Action<string[]>? Received;

        /// <summary>False when the arguments went to a running copy (this process should exit).</summary>
        public static bool TryBecomePrimary(string[] args)
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                var mutex = new Mutex(false, @"Local\" + Name);
                bool owned;
                try { owned = mutex.WaitOne(0); }
                catch (AbandonedMutexException) { owned = true; }

                if (owned)
                {
                    s_mutex = mutex;
                    StartServer();
                    return true;
                }
                mutex.Dispose();
                if (Send(args.Length == 0 ? new[] { "--show" } : args)) return false;
                Thread.Sleep(250);
            }
            return true; // couldn't reach the other copy: run anyway
        }

        public static void Release()
        {
            if (s_mutex == null) return;
            try { s_mutex.ReleaseMutex(); } catch { /* not owned */ }
            s_mutex.Dispose();
            s_mutex = null;
        }

        private static bool Send(string[] args)
        {
            try
            {
                using var client = new NamedPipeClientStream(".", Name, PipeDirection.Out);
                client.Connect(2000);
                var bytes = Encoding.UTF8.GetBytes(string.Join("\n", args));
                if (bytes.Length > MaxMessage) return true; // nonsense: drop it, but still don't start a second copy
                client.Write(bytes, 0, bytes.Length);
                client.Flush();
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static void StartServer()
        {
            var thread = new Thread(() =>
            {
                while (true)
                {
                    try
                    {
                        using var server = new NamedPipeServerStream(Name, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.None);
                        server.WaitForConnection();
                        var buffer = new MemoryStream();
                        var chunk = new byte[1024];
                        int read;
                        while ((read = server.Read(chunk, 0, chunk.Length)) > 0 && buffer.Length <= MaxMessage) buffer.Write(chunk, 0, read);
                        if (buffer.Length > MaxMessage) continue;
                        var text = Encoding.UTF8.GetString(buffer.ToArray());
                        Received?.Invoke(text.Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries));
                    }
                    catch (Exception ex)
                    {
                        Log.Error(ex, "Instance pipe");
                        Thread.Sleep(200);
                    }
                }
            })
            {
                IsBackground = true,
                Name = "Instance pipe",
            };
            thread.Start();
        }
    }
}
