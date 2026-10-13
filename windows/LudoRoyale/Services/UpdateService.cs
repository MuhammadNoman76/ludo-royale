using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;

namespace LudoRoyale.Services
{
    /// <summary>
    /// A quiet update check about 10 s after start-up and then at most once a day. A newer version is
    /// offered in the game's own update bar (Update now / Later / Skip). Failed checks stay silent
    /// (only logged), so nothing shows until the feed exists.
    /// </summary>
    internal static class UpdateService
    {
        public const string DownloadPageUrl = "https://www.nomanshafiq.com/ludo-royale/";
        private static readonly TimeSpan FirstCheckDelay = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(24);

        private static DispatcherTimer? s_timer;
        private static bool s_checking;
        private static CancellationTokenSource? s_download;

        public static UpdateManifest? Available { get; private set; }

        /// <summary>Raised on the UI thread: the offer changed, or download progress / error.</summary>
        public static event Action<UpdateManifest?, double?, string?>? Changed;

        public static void Start()
        {
            if (s_timer != null) return;
            s_timer = new DispatcherTimer { Interval = FirstCheckDelay };
            s_timer.Tick += (_, _) =>
            {
                s_timer.Interval = TimeSpan.FromHours(1);
                if (AppSettings.Current.CheckUpdates) _ = CheckAsync(manual: false);
            };
            s_timer.Start();
            _ = Task.Run(Updater.CleanUpDownloadsAsync);
        }

        /// <summary>Checks the feed. Returns a sentence for the person who asked (automatic checks stay quiet).</summary>
        public static async Task<string> CheckAsync(bool manual)
        {
            if (s_checking) return "Already checking…";
            if (!manual)
            {
                var last = AppSettings.Current.LastUpdateCheck;
                var now = DateTime.UtcNow;
                if (last is DateTime at && at <= now && now - at < CheckInterval) return "";
            }

            s_checking = true;
            try
            {
                UpdateManifest manifest;
                using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30)))
                    manifest = await Updater.FetchManifestAsync(cts.Token);
                AppSettings.Current.LastUpdateCheck = DateTime.UtcNow;
                AppSettings.Save();

                if (!Updater.IsNewer(manifest))
                {
                    if (Available != null)
                    {
                        Available = null;
                        Changed?.Invoke(null, null, null);
                    }
                    return "You're up to date (Ludo Royale " + Updater.CurrentVersionText + ").";
                }

                var skipped = Updater.ParseVersion(AppSettings.Current.SkippedVersion) is Version s && s == Updater.ParseVersion(manifest.Version);
                if (skipped && !manual) return "";
                Available = manifest;
                Changed?.Invoke(manifest, null, null);
                return "Ludo Royale " + manifest.Version + " is available.";
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Update check (" + Updater.FeedUrl + ")");
                return manual ? "Couldn't check for updates. Check your internet connection and try again." : "";
            }
            finally
            {
                s_checking = false;
            }
        }

        public static void Skip()
        {
            if (Available == null) return;
            AppSettings.Current.SkippedVersion = Available.Version;
            AppSettings.Save();
            Available = null;
            Changed?.Invoke(null, null, null);
        }

        public static void Later()
        {
            Available = null;
            Changed?.Invoke(null, null, null);
        }

        public static bool CanInstall(UpdateManifest manifest) =>
            manifest.ForThisEdition != null && Updater.DetectInstallScope() != InstallScope.NotInstalled;

        /// <summary>Downloads, verifies and starts the installer, then quits (the installer starts the app again).</summary>
        public static async Task UpdateNowAsync(Action quit)
        {
            var manifest = Available;
            if (manifest == null || s_download != null) return;
            var file = manifest.ForThisEdition;
            var scope = Updater.DetectInstallScope();
            if (file == null || scope == InstallScope.NotInstalled)
            {
                Compat.OpenInBrowser(string.IsNullOrWhiteSpace(manifest.Page) ? DownloadPageUrl : manifest.Page!);
                return;
            }

            s_download = new CancellationTokenSource();
            try
            {
                var progress = new Progress<double>(p => Changed?.Invoke(manifest, p, null));
                Changed?.Invoke(manifest, 0, null);
                var installer = await Updater.DownloadAsync(manifest, file, progress, s_download.Token);
                Updater.LaunchInstaller(installer, scope);
                await Task.Delay(400);
                quit();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Update");
                Changed?.Invoke(manifest, null, ex is UpdateVerificationException ? ex.Message : "The update couldn't be downloaded. Try again later.");
            }
            finally
            {
                s_download.Dispose();
                s_download = null;
            }
        }

        public static void Stop()
        {
            s_timer?.Stop();
            s_download?.Cancel();
        }
    }
}
