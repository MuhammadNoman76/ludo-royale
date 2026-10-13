using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace LudoRoyale.Services
{
    /// <summary>One installer in the update feed.</summary>
    internal sealed class UpdateFile
    {
        public string Url { get; set; } = "";
        public string Sha256 { get; set; } = "";
        public long Size { get; set; }
    }

    /// <summary>
    /// The update feed (https://www.nomanshafiq.com/updates/ludo-royale.json):
    /// <c>{ "app": "Ludo Royale", "version": "1.0.1", "released": "...", "notes": [...], "page": "...",
    ///      "editions": { "windows": { "url": "...", "sha256": "...", "size": 123 } } }</c>
    /// </summary>
    internal sealed class UpdateManifest
    {
        public string App { get; set; } = "";
        public string Version { get; set; } = "";
        public string? Released { get; set; }
        public List<string> Notes { get; set; } = new List<string>();
        public string? Page { get; set; }
        public Dictionary<string, UpdateFile> Editions { get; set; } = new Dictionary<string, UpdateFile>(StringComparer.OrdinalIgnoreCase);

        public UpdateFile? ForThisEdition => Editions.TryGetValue(Updater.Edition, out var f) ? f : null;
    }

    internal enum InstallScope { NotInstalled, CurrentUser, AllUsers }

    internal sealed class UpdateVerificationException : Exception
    {
        public UpdateVerificationException(string message) : base(message) { }
    }

    /// <summary>
    /// Automatic updates (the same scheme as the owner's other apps): fetch a small JSON feed, compare
    /// versions, download the installer, check its size and SHA-256, run it silently, restart.
    /// The check only downloads the feed; nothing is sent beyond a normal HTTP request.
    /// </summary>
    internal static class Updater
    {
        public const string DefaultFeedUrl = "https://www.nomanshafiq.com/updates/ludo-royale.json";
        public const string FeedOverrideVariable = "LUDO_UPDATE_URL";
        public const string Edition = "windows";

        /// <summary>The installer's AppId (windows\installer\LudoRoyale.iss): Inno Setup keys the uninstall entry with it.</summary>
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\{A2855202-BFD4-4982-866A-38326F65D047}_is1";

        private const int MaxFeedBytes = 256 * 1024;
        private static readonly TimeSpan FeedTimeout = TimeSpan.FromSeconds(15);
        private static readonly TimeSpan StallTimeout = TimeSpan.FromSeconds(30);

        public static string DownloadDirectory => Path.Combine(Path.GetTempPath(), "LudoRoyale-Update");

        public static Version CurrentVersion { get; } = Normalize(Assembly.GetExecutingAssembly().GetName().Version ?? new Version(1, 0, 0));

        public static string CurrentVersionText => CurrentVersion.ToString(3);

        public static string FeedUrl
        {
            get
            {
                var custom = Environment.GetEnvironmentVariable(FeedOverrideVariable);
                return string.IsNullOrWhiteSpace(custom) ? DefaultFeedUrl : custom!.Trim();
            }
        }

        private static bool IsFeedOverridden => !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(FeedOverrideVariable));

        // ------------------------------------------------------------------ versions

        public static Version? ParseVersion(string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            var trimmed = text!.Trim().TrimStart('v', 'V');
            return System.Version.TryParse(trimmed, out var v) ? Normalize(v) : null;
        }

        private static Version Normalize(Version v) => new Version(v.Major, v.Minor, Math.Max(0, v.Build), Math.Max(0, v.Revision));

        public static bool IsNewer(UpdateManifest manifest) => IsNewer(manifest.Version, CurrentVersion);

        public static bool IsNewer(string? available, Version current) => ParseVersion(available) is { } v && v > Normalize(current);

        // ------------------------------------------------------------------ feed

        /// <summary>Parses and checks the feed. Throws <see cref="FormatException"/> if it isn't a usable feed.</summary>
        public static UpdateManifest ParseManifest(string json)
        {
            var o = Json.ParseObject(json, MaxFeedBytes) ?? throw new FormatException("The update feed isn't valid JSON.");
            var manifest = new UpdateManifest
            {
                App = o.Str("app") ?? "",
                Version = o.Str("version", 40) ?? "",
                Released = o.Str("released", 40),
                Page = o.Str("page", 300),
                Notes = o.StrList("notes").Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => n.Trim()).Take(12).ToList(),
            };
            if (!string.Equals(manifest.App, "Ludo Royale", StringComparison.OrdinalIgnoreCase)) throw new FormatException("The update feed isn't for Ludo Royale.");
            if (ParseVersion(manifest.Version) == null) throw new FormatException("The update feed has no valid version.");
            var editions = o.Obj("editions");
            if (editions != null)
            {
                foreach (var pair in editions)
                {
                    if (!(pair.Value is Dictionary<string, object?> e)) continue;
                    var file = new UpdateFile { Url = e.Str("url", 500) ?? "", Sha256 = (e.Str("sha256", 80) ?? "").Trim().ToLowerInvariant(), Size = (long)(e.Num("size") ?? 0) };
                    if (!Uri.TryCreate(file.Url, UriKind.Absolute, out _) || file.Size <= 0 || !IsSha256(file.Sha256)) continue; // never offer an unusable entry
                    manifest.Editions[pair.Key] = file;
                }
            }
            return manifest;
        }

        private static bool IsSha256(string text) => text.Length == 64 && text.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));

        public static async Task<UpdateManifest> FetchManifestAsync(CancellationToken token = default)
        {
            var source = FeedUrl;
            string json;
            if (TryGetLocalPath(source, out var path))
            {
                json = File.ReadAllText(path, Encoding.UTF8);
            }
            else
            {
                using var client = CreateClient(FeedTimeout);
                using var request = new HttpRequestMessage(HttpMethod.Get, source);
                request.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength > MaxFeedBytes) throw new FormatException("The update feed is too large.");
                using var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
                json = await ReadLimitedAsync(stream, MaxFeedBytes, token).ConfigureAwait(false);
            }
            return ParseManifest(json);
        }

        private static async Task<string> ReadLimitedAsync(Stream stream, int limit, CancellationToken token)
        {
            using var buffer = new MemoryStream();
            var chunk = new byte[16 * 1024];
            int read;
            while ((read = await stream.ReadAsync(chunk, 0, chunk.Length, token).ConfigureAwait(false)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > limit) throw new FormatException("The update feed is too large.");
            }
            return Encoding.UTF8.GetString(buffer.ToArray());
        }

        private static bool TryGetLocalPath(string source, out string path)
        {
            path = source;
            if (Uri.TryCreate(source, UriKind.Absolute, out var uri))
            {
                if (uri.IsFile)
                {
                    path = uri.LocalPath;
                    return true;
                }
                return false;
            }
            return true; // a plain path
        }

        private static HttpClient CreateClient(TimeSpan timeout)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var client = new HttpClient(new HttpClientHandler
            {
                AllowAutoRedirect = true,
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            })
            {
                Timeout = timeout,
            };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("LudoRoyale/" + CurrentVersionText);
            return client;
        }

        // ------------------------------------------------------------------ download

        /// <summary>
        /// Downloads the installer to %TEMP%\LudoRoyale-Update and checks its size and SHA-256.
        /// A file that doesn't match is deleted and <see cref="UpdateVerificationException"/> is thrown.
        /// </summary>
        public static async Task<string> DownloadAsync(UpdateManifest manifest, UpdateFile file, IProgress<double>? progress, CancellationToken token)
        {
            if (!Uri.TryCreate(file.Url, UriKind.Absolute, out var uri)) throw new FormatException("The installer address isn't valid.");
            if (uri.Scheme != Uri.UriSchemeHttps && !(IsFeedOverridden && uri.Scheme == Uri.UriSchemeHttp))
                throw new FormatException("The installer must be downloaded over HTTPS.");

            Directory.CreateDirectory(DownloadDirectory);
            var name = SafeFileName(Path.GetFileName(uri.LocalPath));
            if (string.IsNullOrEmpty(name) || !name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                name = "LudoRoyale-Setup-" + manifest.Version + ".exe";
            var target = Path.Combine(DownloadDirectory, name);
            var partial = target + ".part";

            using var stall = CancellationTokenSource.CreateLinkedTokenSource(token);
            try
            {
                using var client = CreateClient(Timeout.InfiniteTimeSpan);
                stall.CancelAfter(StallTimeout);
                using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, stall.Token).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength is long announced && announced != file.Size)
                    throw new UpdateVerificationException("The installer on the server has the wrong size.");

                using var source = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
                using var abort = stall.Token.Register(() => source.Dispose());
                using var sha = SHA256.Create();
                using (var output = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
                {
                    var buffer = new byte[81920];
                    long total = 0;
                    var lastReport = -1.0;
                    while (true)
                    {
                        stall.CancelAfter(StallTimeout);
                        var read = await source.ReadAsync(buffer, 0, buffer.Length, stall.Token).ConfigureAwait(false);
                        if (read == 0) break;
                        total += read;
                        if (total > file.Size) throw new UpdateVerificationException("The downloaded installer is larger than the update feed says.");
                        sha.TransformBlock(buffer, 0, read, null, 0);
                        await output.WriteAsync(buffer, 0, read, token).ConfigureAwait(false);
                        var fraction = (double)total / file.Size;
                        if (fraction - lastReport >= 0.01 || total == file.Size)
                        {
                            lastReport = fraction;
                            progress?.Report(fraction);
                        }
                    }
                    sha.TransformFinalBlock(new byte[0], 0, 0);
                    if (total != file.Size) throw new UpdateVerificationException("The download is incomplete.");
                    if (!string.Equals(ToHex(sha.Hash!), file.Sha256, StringComparison.OrdinalIgnoreCase))
                        throw new UpdateVerificationException("The downloaded installer doesn't match its SHA-256 checksum, so it wasn't run.");
                }

                if (File.Exists(target)) File.Delete(target);
                File.Move(partial, target);
                if (!VerifyFile(target, file.Size, file.Sha256))
                    throw new UpdateVerificationException("The downloaded installer doesn't match its SHA-256 checksum, so it wasn't run.");
                return target;
            }
            catch (Exception ex)
            {
                TryDelete(partial);
                if (token.IsCancellationRequested) throw new OperationCanceledException(token);
                if (stall.IsCancellationRequested) throw new TimeoutException("The download stopped responding.", ex);
                throw;
            }
        }

        public static bool VerifyFile(string path, long size, string sha256)
        {
            try
            {
                var info = new FileInfo(path);
                if (info.Exists && info.Length == size)
                {
                    using var stream = File.OpenRead(path);
                    using var sha = SHA256.Create();
                    if (string.Equals(ToHex(sha.ComputeHash(stream)), sha256.Trim(), StringComparison.OrdinalIgnoreCase)) return true;
                }
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Verify " + path);
            }
            TryDelete(path);
            return false;
        }

        private static string ToHex(byte[] bytes)
        {
            var sb = new StringBuilder(bytes.Length * 2);
            foreach (var b in bytes) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        private static string SafeFileName(string name)
        {
            foreach (var c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
            return name;
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch (Exception ex) { Log.Error(ex, "Delete " + path); }
        }

        /// <summary>Removes installers left by an earlier update (the installer may still be finishing).</summary>
        public static async Task CleanUpDownloadsAsync()
        {
            for (var attempt = 0; attempt < 8; attempt++)
            {
                try
                {
                    if (!Directory.Exists(DownloadDirectory)) return;
                    var locked = false;
                    foreach (var file in Directory.GetFiles(DownloadDirectory))
                    {
                        try { File.Delete(file); }
                        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { locked = true; }
                    }
                    if (!locked)
                    {
                        try { Directory.Delete(DownloadDirectory, false); } catch { /* in use */ }
                        return;
                    }
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Clean up update downloads");
                    return;
                }
                await Task.Delay(TimeSpan.FromSeconds(15)).ConfigureAwait(false);
            }
        }

        // ------------------------------------------------------------------ install

        public static InstallScope DetectInstallScope()
        {
            var dir = Compat.AppDirectory;
            try
            {
                if (InstalledAt(RegistryHive.CurrentUser, RegistryView.Default, dir)) return InstallScope.CurrentUser;
                if (InstalledAt(RegistryHive.LocalMachine, RegistryView.Registry64, dir) || InstalledAt(RegistryHive.LocalMachine, RegistryView.Registry32, dir))
                    return InstallScope.AllUsers;
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Detect install scope");
            }
            return InstallScope.NotInstalled;
        }

        private static bool InstalledAt(RegistryHive hive, RegistryView view, string dir)
        {
            using var root = RegistryKey.OpenBaseKey(hive, view);
            using var key = root.OpenSubKey(UninstallKey);
            var location = key?.GetValue("InstallLocation") as string;
            return !string.IsNullOrWhiteSpace(location) && SamePath(location!, dir);
        }

        private static bool SamePath(string a, string b)
        {
            try
            {
                return string.Equals(Path.GetFullPath(a).TrimEnd('\\', '/'), Path.GetFullPath(b).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        public static string InstallerArguments(InstallScope scope) =>
            "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /RELAUNCH=1 " +
            (scope == InstallScope.AllUsers ? "/ALLUSERS" : "/CURRENTUSER") +
            " /DIR=\"" + Compat.AppDirectory + "\"";

        public static void LaunchInstaller(string installer, InstallScope scope)
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = installer,
                Arguments = InstallerArguments(scope),
                WorkingDirectory = Path.GetDirectoryName(installer) ?? DownloadDirectory,
                UseShellExecute = true,
            })?.Dispose();
        }
    }
}
