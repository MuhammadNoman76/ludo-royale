using System;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace LudoRoyale.Services
{
    [DataContract]
    internal sealed class WindowBounds
    {
        [DataMember(Name = "left")] public double Left { get; set; }
        [DataMember(Name = "top")] public double Top { get; set; }
        [DataMember(Name = "width")] public double Width { get; set; }
        [DataMember(Name = "height")] public double Height { get; set; }
        [DataMember(Name = "maximized")] public bool Maximized { get; set; }
    }

    /// <summary>
    /// Settings in %APPDATA%\LudoRoyale\settings.json. The friend code's secret token is encrypted for
    /// this Windows user (DPAPI), so a copied settings file is useless on another account or PC.
    /// </summary>
    [DataContract]
    internal sealed class AppSettings
    {
        /// <summary>The game server chosen at build time (AssemblyMetadata "DefaultServer", see build.ps1 -Server).</summary>
        public static readonly string DefaultServer = BuildServer() ?? "https://ludo.nomanshafiq.com";
        public const string ServerOverrideVariable = "LUDO_SERVER_URL";

        [DataMember(Name = "friendCode", EmitDefaultValue = false)] public string? FriendCode { get; set; }
        [DataMember(Name = "token", EmitDefaultValue = false)] public string? ProtectedToken { get; set; }
        [DataMember(Name = "serverUrl", EmitDefaultValue = false)] public string? ServerUrl { get; set; }
        [DataMember(Name = "startWithWindows")] public bool StartWithWindows { get; set; }
        [DataMember(Name = "closeAction")] public string CloseAction { get; set; } = "ask";
        [DataMember(Name = "doNotDisturb")] public bool DoNotDisturb { get; set; }
        [DataMember(Name = "checkUpdates")] public bool CheckUpdates { get; set; } = true;
        [DataMember(Name = "lastUpdateCheck", EmitDefaultValue = false)] public DateTime? LastUpdateCheck { get; set; }
        [DataMember(Name = "skippedVersion", EmitDefaultValue = false)] public string? SkippedVersion { get; set; }
        [DataMember(Name = "mode")] public string Mode { get; set; } = "normal";
        [DataMember(Name = "side")] public string Side { get; set; } = "right";
        [DataMember(Name = "topmost")] public bool Topmost { get; set; }
        [DataMember(Name = "panelWidth")] public double PanelWidth { get; set; } = 400;
        [DataMember(Name = "tabTop")] public double TabTop { get; set; } = 0.4;
        [DataMember(Name = "normal", EmitDefaultValue = false)] public WindowBounds? Normal { get; set; }
        [DataMember(Name = "trayHintShown")] public bool TrayHintShown { get; set; }

        private static readonly Regex FriendCodeRe = new Regex("^LUDO-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$", RegexOptions.CultureInvariant);
        private static readonly Regex TokenRe = new Regex("^[A-Za-z0-9_-]{22,64}$", RegexOptions.CultureInvariant);
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("LudoRoyale.friend-token.v1");

        public static string DataDirectory =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "LudoRoyale");

        public static string FilePath => Path.Combine(DataDirectory, "settings.json");

        public static AppSettings Current { get; private set; } = new AppSettings();

        public static void Load()
        {
            try
            {
                if (File.Exists(FilePath))
                {
                    using var stream = File.OpenRead(FilePath);
                    if (stream.Length < 256 * 1024 && new DataContractJsonSerializer(typeof(AppSettings)).ReadObject(stream) is AppSettings loaded)
                        Current = loaded.Sanitized();
                }
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Read settings");
                Current = new AppSettings();
            }
        }

        // The serializer doesn't run constructors: defaults for fields missing from the file.
        [OnDeserializing]
        private void SetDefaults(StreamingContext context)
        {
            CloseAction = "ask";
            CheckUpdates = true;
            Mode = "normal";
            Side = "right";
            PanelWidth = 400;
            TabTop = 0.4;
        }

        private AppSettings Sanitized()
        {
            if (CloseAction != "ask" && CloseAction != "tray" && CloseAction != "quit") CloseAction = "ask";
            if (Mode != "normal" && Mode != "panel") Mode = "normal";
            if (Side != "left" && Side != "right") Side = "right";
            if (double.IsNaN(PanelWidth) || PanelWidth < 320 || PanelWidth > 900) PanelWidth = 400;
            if (double.IsNaN(TabTop) || TabTop < 0 || TabTop > 1) TabTop = 0.4;
            if (FriendCode != null && !FriendCodeRe.IsMatch(FriendCode)) FriendCode = null;
            return this;
        }

        /// <summary>Writes the file atomically (temporary file, then replace).</summary>
        public static void Save()
        {
            try
            {
                Directory.CreateDirectory(DataDirectory);
                var temp = FilePath + ".tmp";
                using (var stream = File.Create(temp))
                {
                    using var writer = JsonReaderWriterFactory.CreateJsonWriter(stream, Encoding.UTF8, ownsStream: false, indent: true);
                    new DataContractJsonSerializer(typeof(AppSettings)).WriteObject(writer, Current);
                }
                if (File.Exists(FilePath)) File.Replace(temp, FilePath, null);
                else File.Move(temp, FilePath);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Save settings");
            }
        }

        // ------------------------------------------------------------------ identity

        public static bool ValidIdentity(string? code, string? token) =>
            code != null && token != null && FriendCodeRe.IsMatch(code) && TokenRe.IsMatch(token);

        /// <summary>The friend code and its token, or null (first run, or the token can't be decrypted).</summary>
        public static (string Code, string Token)? Identity
        {
            get
            {
                var c = Current;
                if (c.FriendCode == null || c.ProtectedToken == null) return null;
                try
                {
                    var bytes = ProtectedData.Unprotect(Convert.FromBase64String(c.ProtectedToken), Entropy, DataProtectionScope.CurrentUser);
                    var token = Encoding.UTF8.GetString(bytes);
                    return ValidIdentity(c.FriendCode, token) ? (c.FriendCode, token) : ((string, string)?)null;
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Unprotect friend token");
                    return null;
                }
            }
        }

        public static void SetIdentity(string? code, string? token)
        {
            if (code == null || token == null || !ValidIdentity(code, token))
            {
                Current.FriendCode = null;
                Current.ProtectedToken = null;
            }
            else
            {
                Current.FriendCode = code;
                Current.ProtectedToken = Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.CurrentUser));
            }
            Save();
        }

        // ------------------------------------------------------------------ server

        /// <summary>The game server: LUDO_SERVER_URL, then settings.json "serverUrl", then the default.</summary>
        public static string Server
        {
            get
            {
                var env = Environment.GetEnvironmentVariable(ServerOverrideVariable);
                return Acceptable(env) ?? Acceptable(Current.ServerUrl) ?? DefaultServer;
            }
        }

        private static string? BuildServer()
        {
            try
            {
                foreach (var a in System.Reflection.Assembly.GetExecutingAssembly().GetCustomAttributes(typeof(System.Reflection.AssemblyMetadataAttribute), false))
                    if (a is System.Reflection.AssemblyMetadataAttribute m && m.Key == "DefaultServer") return Acceptable(m.Value);
            }
            catch
            {
            }
            return null;
        }

        /// <summary>HTTPS only, except a server on this computer (development).</summary>
        public static string? Acceptable(string? url)
        {
            if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url!.Trim(), UriKind.Absolute, out var u)) return null;
            if (!string.IsNullOrEmpty(u.UserInfo) || !string.IsNullOrEmpty(u.Query) || !string.IsNullOrEmpty(u.Fragment)) return null;
            var local = u.IsLoopback;
            if (u.Scheme == Uri.UriSchemeHttps || (u.Scheme == Uri.UriSchemeHttp && local))
                return u.GetLeftPart(UriPartial.Authority);
            return null;
        }
    }
}
