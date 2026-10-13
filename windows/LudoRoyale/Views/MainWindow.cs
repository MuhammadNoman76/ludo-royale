using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Interop;
using System.Windows.Media;
using LudoRoyale.Interop;
using LudoRoyale.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace LudoRoyale.Views
{
    /// <summary>
    /// The game window: the web client in WebView2, served from the "web" folder next to the exe through
    /// a virtual host (no remote web content is ever loaded; the page only opens a WSS connection to the
    /// game server). Normal window or side panel docked to a screen edge, optionally on top, and it can
    /// collapse into a slim tab at the edge.
    /// </summary>
    internal sealed class MainWindow : Window
    {
        public const string Host = "app.ludoroyale.example";
        private const string Origin = "https://" + Host;
        private const string StartUrl = Origin + "/index.html";

        private readonly App _app;
        private readonly Grid _root = new Grid();
        private readonly WebView2 _web;
        private IntPtr _hwnd;
        private bool _initStarted;
        private bool _pageReady;
        private readonly List<string> _outbox = new List<string>();
        private bool _dark;
        private bool _applying;
        private bool _quitting;
        private EdgeTab? _tab;

        public MainWindow(App app)
        {
            _app = app;
            Title = "Ludo Royale";
            Icon = Theme.AppIcon(32);
            Width = 480;
            Height = 820;
            MinWidth = 320;
            MinHeight = 440;
            FontFamily = Theme.UiFont;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            UseLayoutRounding = true;

            _dark = Theme.SystemPrefersDark();
            Background = Theme.Brush(Theme.BackgroundColor(_dark));
            _web = new WebView2 { DefaultBackgroundColor = Theme.DrawingColor(Theme.BackgroundColor(_dark)) };
            _root.Children.Add(_web);
            Content = _root;

            var normal = AppSettings.Current.Normal;
            if (normal != null && OnSomeScreen(normal))
            {
                WindowStartupLocation = WindowStartupLocation.Manual;
                Left = normal.Left;
                Top = normal.Top;
                Width = Math.Max(MinWidth, normal.Width);
                Height = Math.Max(MinHeight, normal.Height);
            }
            Topmost = AppSettings.Current.Topmost;

            SourceInitialized += OnSourceInitialized;
            Closing += OnClosing;
            Activated += (_, _) =>
            {
                _web.Focus();
                _tab?.SetAttention(false);
                _turnNotified = false;
            };
        }

        public bool Collapsed { get; private set; }

        public bool IsUserLooking => IsVisible && IsActive && WindowState != WindowState.Minimized && !Collapsed;

        // ------------------------------------------------------------------ showing and hiding

        /// <summary>
        /// Start-up in the tray: the game must run (friends, invites) without a visible window, but the
        /// WebView2 control only starts inside a shown window. So the window is shown far off-screen,
        /// without taking focus or a taskbar button, until WebView2 is up, and then hidden.
        /// </summary>
        public void StartHidden()
        {
            _offscreen = true;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = -32000;
            Top = -32000;
            ShowInTaskbar = false;
            ShowActivated = false;
            Show();
            _ = InitializeWebAsync();
        }

        private bool _offscreen;

        private void EndOffscreen()
        {
            if (!_offscreen) return;
            _offscreen = false;
            Hide();
            ShowInTaskbar = true;
            ShowActivated = true;
            var normal = AppSettings.Current.Normal;
            if (normal != null && OnSomeScreen(normal))
            {
                Left = normal.Left;
                Top = normal.Top;
            }
            else
            {
                var wa = Native.PrimaryWorkArea();
                var s = DpiScale;
                Left = (wa.Left + (wa.Right - wa.Left) / 2) / s - Width / 2;
                Top = (wa.Top + (wa.Bottom - wa.Top) / 2) / s - Height / 2;
            }
            _needsPlacement = true;
        }

        /// <summary>Started in the tray: dock (panel) or maximize when the window is first really shown.</summary>
        private bool _needsPlacement;

        /// <summary>Shows and activates the window (tray, a game link, a notification click).</summary>
        public void ShowWindow()
        {
            EndOffscreen();
            if (Collapsed)
            {
                Expand();
                return;
            }
            if (!IsVisible) Show();
            var maximize = AppSettings.Current.Normal?.Maximized == true && AppSettings.Current.Mode == "normal";
            if (_needsPlacement)
            {
                _needsPlacement = false;
                ApplyLayout();
                if (maximize) WindowState = WindowState.Maximized;
            }
            if (WindowState == WindowState.Minimized) WindowState = maximize ? WindowState.Maximized : WindowState.Normal;
            Activate();
            _ = InitializeWebAsync();
        }

        private void HideToTray()
        {
            SaveNormalBounds();
            Hide();
            _tab?.Hide();
            Collapsed = false;
            if (!AppSettings.Current.TrayHintShown)
            {
                AppSettings.Current.TrayHintShown = true;
                AppSettings.Save();
                _app.Tray.ShowBalloon("Ludo Royale is still running", "Invites and your turn still arrive. Right-click the icon here to quit.", null);
            }
        }

        public void PrepareToQuit()
        {
            _quitting = true;
            SaveNormalBounds();
            AppSettings.Save();
            _tab?.Close();
        }

        private void OnClosing(object? sender, CancelEventArgs e)
        {
            if (_quitting) return;
            e.Cancel = true;
            var action = AppSettings.Current.CloseAction;
            if (action == "ask")
            {
                var dialog = new CloseDialog(_dark) { Owner = this };
                dialog.ShowDialog();
                if (dialog.Choice == CloseChoice.Cancel) return;
                action = dialog.Choice == CloseChoice.Tray ? "tray" : "quit";
                if (dialog.Remember)
                {
                    AppSettings.Current.CloseAction = action;
                    AppSettings.Save();
                    PostSettings();
                }
            }
            // A window can't be closed from inside its own Closing event: quit right after it.
            if (action == "quit") Dispatcher.BeginInvoke(new Action(_app.Quit));
            else HideToTray();
        }

        // ------------------------------------------------------------------ window chrome, layout

        private void OnSourceInitialized(object? sender, EventArgs e)
        {
            _hwnd = new WindowInteropHelper(this).Handle;
            ApplyTheme(_dark);
            HwndSource.FromHwnd(_hwnd)?.AddHook(WndProc);
            if (_offscreen) return; // placed when it's first really shown
            ApplyLayout();
            if (AppSettings.Current.Normal?.Maximized == true && AppSettings.Current.Mode == "normal") WindowState = WindowState.Maximized;
        }

        private void ApplyTheme(bool dark)
        {
            _dark = dark;
            Background = Theme.Brush(Theme.BackgroundColor(dark));
            _web.DefaultBackgroundColor = Theme.DrawingColor(Theme.BackgroundColor(dark));
            if (_hwnd != IntPtr.Zero)
            {
                Native.SetDarkTitleBar(_hwnd, dark);
                Native.TrySetMica(_hwnd);
            }
            _tab?.ApplyTheme(dark);
        }

        private const int WM_EXITSIZEMOVE = 0x0232;
        private const int WM_DISPLAYCHANGE = 0x007E;
        private const int WM_SETTINGCHANGE = 0x001A;
        private const int WM_DPICHANGED = 0x02E0;

        private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            switch (msg)
            {
                case WM_EXITSIZEMOVE:
                    if (AppSettings.Current.Mode == "panel") Dispatcher.BeginInvoke(new Action(SnapPanel));
                    else SaveNormalBounds();
                    break;
                case WM_DISPLAYCHANGE:
                case WM_SETTINGCHANGE:
                case WM_DPICHANGED:
                    if (AppSettings.Current.Mode == "panel" && !_applying) Dispatcher.BeginInvoke(new Action(ApplyLayout), System.Windows.Threading.DispatcherPriority.Background);
                    break;
            }
            return IntPtr.Zero;
        }

        private double DpiScale => VisualTreeHelper.GetDpi(this).DpiScaleX;

        /// <summary>The work area (DIPs) of the monitor the window is on.</summary>
        private Rect WorkArea()
        {
            var r = _hwnd != IntPtr.Zero ? Native.WorkAreaOf(_hwnd) : Native.PrimaryWorkArea();
            var s = _hwnd != IntPtr.Zero ? DpiScale : 1.0;
            return new Rect(r.Left / s, r.Top / s, (r.Right - r.Left) / s, (r.Bottom - r.Top) / s);
        }

        /// <summary>Docks (panel) or restores (normal) the window and applies "always on top".</summary>
        public void ApplyLayout()
        {
            if (_hwnd == IntPtr.Zero || _offscreen) return;
            var s = AppSettings.Current;
            Topmost = s.Topmost;
            if (s.Mode != "panel") return;
            _applying = true;
            try
            {
                if (WindowState != WindowState.Normal) WindowState = WindowState.Normal;
                var wa = WorkArea();
                var b = Native.InvisibleBorders(_hwnd);
                var scale = DpiScale;
                double bl = b.Left / scale, br = b.Right / scale, bb = b.Bottom / scale, bt = b.Top / scale;
                var width = Compat.Clamp(s.PanelWidth, 320, Math.Max(320, wa.Width * 0.7));
                Width = width + bl + br;
                Height = wa.Height + bt + bb;
                Top = wa.Top - bt;
                Left = s.Side == "left" ? wa.Left - bl : wa.Right - width - bl;
            }
            finally
            {
                _applying = false;
            }
        }

        /// <summary>After the user moved or resized the panel: keep the width, dock to the nearer edge.</summary>
        private void SnapPanel()
        {
            if (_hwnd == IntPtr.Zero || AppSettings.Current.Mode != "panel") return;
            var b = Native.InvisibleBorders(_hwnd);
            var scale = DpiScale;
            var visibleWidth = ActualWidth - (b.Left + b.Right) / scale;
            var wa = WorkArea();
            var centre = Left + ActualWidth / 2;
            AppSettings.Current.PanelWidth = Compat.Clamp(visibleWidth, 320, 900);
            AppSettings.Current.Side = centre < wa.Left + wa.Width / 2 ? "left" : "right";
            AppSettings.Save();
            ApplyLayout();
            PostWindow();
        }

        public void SetMode(string mode)
        {
            if (mode != "normal" && mode != "panel") return;
            var s = AppSettings.Current;
            if (s.Mode == mode && !Collapsed) return;
            if (Collapsed) Expand();
            if (mode == "panel") SaveNormalBounds();
            s.Mode = mode;
            AppSettings.Save();
            if (mode == "panel")
            {
                ApplyLayout();
            }
            else
            {
                var n = s.Normal;
                _applying = true;
                if (n != null && OnSomeScreen(n))
                {
                    Left = n.Left;
                    Top = n.Top;
                    Width = Math.Max(MinWidth, n.Width);
                    Height = Math.Max(MinHeight, n.Height);
                    if (n.Maximized) WindowState = WindowState.Maximized;
                }
                else
                {
                    var wa = WorkArea();
                    Width = 480;
                    Height = Math.Min(820, wa.Height - 40);
                    Left = wa.Left + (wa.Width - Width) / 2;
                    Top = wa.Top + (wa.Height - Height) / 2;
                }
                _applying = false;
            }
            PostWindow();
        }

        public void SetSide(string side)
        {
            if (side != "left" && side != "right") return;
            AppSettings.Current.Side = side;
            AppSettings.Save();
            if (Collapsed) _tab?.Place(side, WorkArea(), AppSettings.Current.TabTop);
            else ApplyLayout();
            PostWindow();
        }

        public void SetTopmost(bool on)
        {
            AppSettings.Current.Topmost = on;
            AppSettings.Save();
            Topmost = on;
            PostWindow();
        }

        public void Collapse()
        {
            if (AppSettings.Current.Mode != "panel" || Collapsed) return;
            _tab ??= new EdgeTab(this, _dark);
            _tab.Place(AppSettings.Current.Side, WorkArea(), AppSettings.Current.TabTop);
            Collapsed = true;
            Hide();
            _tab.Show();
        }

        public void Expand()
        {
            if (!Collapsed) return;
            Collapsed = false;
            _tab?.Hide();
            Show();
            ApplyLayout();
            Activate();
        }

        public void TabMoved(double fraction)
        {
            AppSettings.Current.TabTop = Compat.Clamp(fraction, 0, 1);
            AppSettings.Save();
        }

        private void SaveNormalBounds()
        {
            if (_offscreen || _applying || AppSettings.Current.Mode != "normal" || !IsLoaded) return;
            var r = WindowState == WindowState.Normal ? new Rect(Left, Top, ActualWidth, ActualHeight) : RestoreBounds;
            if (r.IsEmpty || double.IsNaN(r.Left) || r.Width < MinWidth) return;
            AppSettings.Current.Normal = new WindowBounds { Left = r.Left, Top = r.Top, Width = r.Width, Height = r.Height, Maximized = WindowState == WindowState.Maximized };
        }

        private static bool OnSomeScreen(WindowBounds b)
        {
            var vs = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop, SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
            return b.Width >= 200 && b.Height >= 200 && vs.IntersectsWith(new Rect(b.Left + 40, b.Top + 10, Math.Max(1, b.Width - 80), 40));
        }

        // ------------------------------------------------------------------ WebView2

        public Task InitializeWebAsync() => _initStarted ? Task.CompletedTask : InitializeCoreAsync();

        private async Task InitializeCoreAsync()
        {
            _initStarted = true;
            try
            {
                CoreWebView2Environment.GetAvailableBrowserVersionString();
            }
            catch (WebView2RuntimeNotFoundException)
            {
                ShowProblem(
                    "Ludo Royale needs the Microsoft Edge WebView2 Runtime",
                    "It comes with Windows 11 and current Windows 10, but it's missing on this PC. Install it from Microsoft (free, about 2 minutes), then start Ludo Royale again. You can also play in your browser.",
                    ("Get WebView2 from Microsoft", "https://go.microsoft.com/fwlink/p/?LinkId=2124703"),
                    ("Play in the browser", AppSettings.Server));
                return;
            }

            var webFolder = Path.Combine(Compat.AppDirectory, "web");
            if (!File.Exists(Path.Combine(webFolder, "index.html")))
            {
                ShowProblem("Some of Ludo Royale's files are missing", "Please reinstall Ludo Royale.", ("Download page", UpdateService.DownloadPageUrl), null);
                return;
            }

            try
            {
                var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LudoRoyale", "WebView2");
                var options = new CoreWebView2EnvironmentOptions { AllowSingleSignOnUsingOSPrimaryAccount = false };
                var env = await CoreWebView2Environment.CreateAsync(null, userData, options);
                await _web.EnsureCoreWebView2Async(env);
                var core = _web.CoreWebView2;

                var settings = core.Settings;
                var devTools = Environment.GetEnvironmentVariable("LUDO_DEVTOOLS") == "1";
                settings.AreDevToolsEnabled = devTools;
                settings.AreDefaultScriptDialogsEnabled = false;
                settings.IsStatusBarEnabled = false;
                settings.AreHostObjectsAllowed = false;
                settings.IsWebMessageEnabled = true;
                settings.IsGeneralAutofillEnabled = false;
                settings.IsPasswordAutosaveEnabled = false;
                settings.AreBrowserAcceleratorKeysEnabled = devTools;
                settings.IsSwipeNavigationEnabled = false;
                settings.IsBuiltInErrorPageEnabled = true;

                core.SetVirtualHostNameToFolderMapping(Host, webFolder, CoreWebView2HostResourceAccessKind.DenyCors);
                core.NavigationStarting += OnNavigationStarting;
                core.FrameNavigationStarting += (_, e) => e.Cancel = true; // no frames, ever
                core.NewWindowRequested += OnNewWindowRequested;
                core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
                core.DownloadStarting += (_, e) => e.Cancel = true;
                core.ContextMenuRequested += OnContextMenuRequested;
                core.WebMessageReceived += OnWebMessageReceived;
                core.ProcessFailed += OnProcessFailed;
                core.Navigate(StartUrl);
                // Started in the tray: hide once the page says it has started (or after 20 s at the latest).
                if (_offscreen)
                {
                    var fallback = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };
                    fallback.Tick += (_, _) =>
                    {
                        fallback.Stop();
                        EndOffscreen();
                    };
                    fallback.Start();
                }
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Start WebView2");
                ShowProblem("Ludo Royale couldn't start its game view", "Restart Ludo Royale. If this keeps happening, reinstall it or play in your browser.", ("Play in the browser", AppSettings.Server), null);
            }
        }

        private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || !string.Equals(uri.Host, Host, StringComparison.OrdinalIgnoreCase))
            {
                e.Cancel = true;
                if (e.IsUserInitiated && uri != null && uri.Scheme == Uri.UriSchemeHttps) Compat.OpenInBrowser(uri.AbsoluteUri);
                return;
            }
            if (uri.AbsolutePath != "/" && uri.AbsolutePath != "/index.html")
            {
                // A reload of a client-side route (/r/ABCD): start from the page itself.
                e.Cancel = true;
                _web.CoreWebView2?.Navigate(StartUrl);
            }
            _pageReady = false;
        }

        private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            if (e.IsUserInitiated && IsAllowedExternal(e.Uri)) Compat.OpenInBrowser(e.Uri);
        }

        private static readonly string[] MenuKeep = { "cut", "copy", "paste", "selectAll", "undo", "redo", "emoji" };

        private void OnContextMenuRequested(object? sender, CoreWebView2ContextMenuRequestedEventArgs e)
        {
            var items = e.MenuItems;
            for (var i = items.Count - 1; i >= 0; i--)
            {
                if (!MenuKeep.Contains(items[i].Name)) items.RemoveAt(i);
            }
            while (items.Count > 0 && items[0].Kind == CoreWebView2ContextMenuItemKind.Separator) items.RemoveAt(0);
            if (items.Count == 0) e.Handled = true;
        }

        private void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
        {
            Log.Info("WebView2 process failed: " + e.ProcessFailedKind + " " + e.Reason);
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
            {
                try { _web.CoreWebView2?.Reload(); } catch (Exception ex) { Log.Error(ex, "Reload"); }
            }
        }

        private void ShowProblem(string title, string text, (string Label, string Url)? first, (string Label, string Url)? second)
        {
            EndOffscreen();
            var panel = new StackPanel { Margin = new Thickness(28), VerticalAlignment = VerticalAlignment.Center, MaxWidth = 440 };
            var fg = Theme.Brush(Theme.TextColor(_dark));
            panel.Children.Add(new Image { Source = Theme.AppIcon(64), Width = 56, Height = 56, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 16) });
            panel.Children.Add(new TextBlock { Text = title, FontSize = 20, FontWeight = FontWeights.SemiBold, Foreground = fg, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 10) });
            panel.Children.Add(new TextBlock { Text = text, FontSize = 14, Foreground = Theme.Brush(Theme.MutedColor(_dark)), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 18) });
            foreach (var link in new[] { first, second })
            {
                if (link == null) continue;
                var url = link.Value.Url;
                var hyperlink = new Hyperlink(new Run(link.Value.Label)) { Foreground = Theme.Brush(Theme.AccentColor(_dark)) };
                hyperlink.Click += (_, _) => Compat.OpenInBrowser(url);
                panel.Children.Add(new TextBlock(hyperlink) { FontSize = 15, Margin = new Thickness(0, 0, 0, 10) });
            }
            _root.Children.Clear();
            _root.Children.Add(panel);
        }

        // ------------------------------------------------------------------ bridge: web -> app

        private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!e.Source.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase)) return;
            string json;
            try { json = e.WebMessageAsJson; }
            catch { return; }
            var m = Json.ParseObject(json, 8192);
            if (m == null) return;
            Debug("page: " + m.Str("type", 40) + (_offscreen ? " (offscreen)" : IsVisible ? "" : " (hidden)"));
            try
            {
                Handle(m);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Web message " + m.Str("type", 40));
            }
        }

        private void Handle(Dictionary<string, object?> m)
        {
            switch (m.Str("type", 40))
            {
                case "ready":
                    _pageReady = true;
                    SendInit();
                    foreach (var pending in _outbox) _web.CoreWebView2?.PostWebMessageAsJson(pending);
                    _outbox.Clear();
                    break;
                case "started":
                    if (_offscreen) Dispatcher.BeginInvoke(new Action(EndOffscreen), System.Windows.Threading.DispatcherPriority.Background);
                    break;
                case "identity":
                {
                    var code = m.Str("code", 20);
                    var token = m.Str("token", 64);
                    if (AppSettings.ValidIdentity(code, token)) AppSettings.SetIdentity(code, token);
                    break;
                }
                case "identity-reset":
                    AppSettings.SetIdentity(null, null);
                    break;
                case "notify":
                    Notify(m);
                    break;
                case "theme":
                    if (m.Bool("dark") is bool dark && dark != _dark) ApplyTheme(dark);
                    break;
                case "window":
                    if (m.Str("mode", 10) is string mode) SetMode(mode);
                    if (m.Str("side", 10) is string side) SetSide(side);
                    if (m.Bool("topmost") is bool top) SetTopmost(top);
                    if (m.Bool("collapse") == true) Collapse();
                    break;
                case "settings":
                    ChangeSettings(m);
                    break;
                case "open":
                    if (m.Str("url", 2000) is string url && IsAllowedExternal(url)) Compat.OpenInBrowser(url);
                    break;
                case "check-updates":
                    _ = CheckUpdatesAsync();
                    break;
                case "update-now":
                    _ = UpdateService.UpdateNowAsync(_app.Quit);
                    break;
                case "update-later":
                    UpdateService.Later();
                    break;
                case "update-skip":
                    UpdateService.Skip();
                    break;
            }
        }

        private async Task CheckUpdatesAsync()
        {
            var text = await UpdateService.CheckAsync(manual: true);
            if (!string.IsNullOrEmpty(text)) Post(new Dictionary<string, object?> { ["type"] = "toast", ["text"] = text });
        }

        /// <summary>Links the page may open in the browser: WhatsApp sharing, the game site, the download page.</summary>
        private static bool IsAllowedExternal(string url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps) return false;
            var host = u.Host.ToLowerInvariant();
            var server = Uri.TryCreate(AppSettings.Server, UriKind.Absolute, out var s) ? s.Host.ToLowerInvariant() : "";
            return host == "wa.me" || host == "api.whatsapp.com" || host == "www.nomanshafiq.com" || host == "nomanshafiq.com" || (server.Length > 0 && host == server);
        }

        private void ChangeSettings(Dictionary<string, object?> m)
        {
            var s = AppSettings.Current;
            if (m.Bool("startWithWindows") is bool start)
            {
                Registration.SetStartWithWindows(start);
                s.StartWithWindows = Registration.StartsWithWindows;
            }
            if (m.Str("closeAction", 10) is string close && (close == "ask" || close == "tray" || close == "quit")) s.CloseAction = close;
            if (m.Bool("protocol") is bool protocol) Registration.SetProtocol(protocol);
            if (m.Bool("dnd") is bool dnd) s.DoNotDisturb = dnd;
            if (m.Bool("checkUpdates") is bool check) s.CheckUpdates = check;
            AppSettings.Save();
            PostSettings();
        }

        // ------------------------------------------------------------------ notifications

        /// <summary>
        /// Windows notifications, kept rare: invites and friend requests when you aren't looking at the
        /// game; "your turn" only while the window is hidden, minimized or collapsed, and then just once
        /// until you come back (a game has a turn every few seconds).
        /// </summary>
        private void Notify(Dictionary<string, object?> m)
        {
            var kind = m.Str("kind", 10);
            var title = m.Str("title", 120);
            var body = m.Str("body", 300) ?? "";
            if ((kind != "invite" && kind != "turn" && kind != "friend") || string.IsNullOrWhiteSpace(title)) return;
            if (AppSettings.Current.DoNotDisturb) return;

            var onScreen = IsVisible && WindowState != WindowState.Minimized && !Collapsed;
            if (kind == "turn")
            {
                if (onScreen)
                {
                    if (!IsActive) Native.Flash(_hwnd); // the taskbar button lights up; no popup
                    return;
                }
                if (Collapsed) _tab?.SetAttention(true);
                if (_turnNotified) return;
                _turnNotified = true;
            }
            else
            {
                if (IsUserLooking) return; // the page shows its own message
                if (Collapsed) _tab?.SetAttention(true);
            }

            GameLink? link = null;
            if (m.Str("room", 4) is string room) link = LaunchCommand.ParseLink("ludoroyale://join/" + room);
            // Never interrupt a full-screen app, a presentation or quiet hours.
            if (Native.UserIsBusy()) return;
            Debug("notification: " + kind + " | " + title + " | " + body);
            _app.Tray.ShowBalloon(title!, body, link);
        }

        private bool _turnNotified;

        /// <summary>With LUDO_DEBUG=1, notes what the app does in %APPDATA%\LudoRoyale\debug.log (for testing).</summary>
        private static void Debug(string text)
        {
            if (Environment.GetEnvironmentVariable("LUDO_DEBUG") != "1") return;
            try
            {
                Directory.CreateDirectory(AppSettings.DataDirectory);
                File.AppendAllText(Path.Combine(AppSettings.DataDirectory, "debug.log"), DateTime.Now.ToString("HH:mm:ss") + " " + text + Environment.NewLine);
            }
            catch
            {
            }
        }

        // ------------------------------------------------------------------ bridge: app -> web

        private void Post(Dictionary<string, object?> message)
        {
            var json = Json.Serialize(message);
            if (_pageReady && _web.CoreWebView2 != null) _web.CoreWebView2.PostWebMessageAsJson(json);
            else if (_outbox.Count < 20) _outbox.Add(json);
        }

        private Dictionary<string, object?> SettingsPayload()
        {
            var s = AppSettings.Current;
            return new Dictionary<string, object?>
            {
                ["startWithWindows"] = Registration.StartsWithWindows,
                ["closeAction"] = s.CloseAction,
                ["protocol"] = Registration.ProtocolRegistered,
                ["dnd"] = s.DoNotDisturb,
                ["checkUpdates"] = s.CheckUpdates,
            };
        }

        private Dictionary<string, object?> WindowPayload(string type)
        {
            var s = AppSettings.Current;
            return new Dictionary<string, object?> { ["type"] = type, ["mode"] = s.Mode, ["side"] = s.Side, ["topmost"] = s.Topmost };
        }

        private void SendInit()
        {
            var id = AppSettings.Identity;
            var s = AppSettings.Current;
            var init = new Dictionary<string, object?>
            {
                ["type"] = "init",
                ["version"] = Updater.CurrentVersionText,
                ["serverUrl"] = AppSettings.Server,
                ["identity"] = id == null ? null : new Dictionary<string, object?> { ["code"] = id.Value.Code, ["token"] = id.Value.Token },
                ["settings"] = SettingsPayload(),
                ["window"] = new Dictionary<string, object?> { ["mode"] = s.Mode, ["side"] = s.Side, ["topmost"] = s.Topmost },
            };
            _web.CoreWebView2?.PostWebMessageAsJson(Json.Serialize(init));
            if (UpdateService.Available != null) PostUpdate(UpdateService.Available, null, null);
        }

        public void PostSettings() => Post(new Dictionary<string, object?> { ["type"] = "settings", ["settings"] = SettingsPayload() });

        private void PostWindow() => Post(WindowPayload("window"));

        public void PostUpdate(UpdateManifest? manifest, double? progress, string? error)
        {
            if (manifest == null)
            {
                Post(new Dictionary<string, object?> { ["type"] = "update", ["version"] = null });
                return;
            }
            Post(new Dictionary<string, object?>
            {
                ["type"] = "update",
                ["version"] = manifest.Version,
                ["notes"] = manifest.Notes.ToArray(),
                ["canInstall"] = UpdateService.CanInstall(manifest),
                ["progress"] = progress,
                ["error"] = error,
            });
        }

        /// <summary>Opens a room or a friend code in the game.</summary>
        public void SendLink(GameLink link) => Post(new Dictionary<string, object?> { ["type"] = "link", ["kind"] = link.Kind, ["value"] = link.Value });
    }
}
