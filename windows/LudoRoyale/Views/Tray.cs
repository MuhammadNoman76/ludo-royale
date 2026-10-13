using System;
using System.Drawing;
using System.Windows.Forms;
using LudoRoyale.Services;

namespace LudoRoyale.Views
{
    /// <summary>
    /// The notification-area icon: Open, Side panel, Do not disturb, Quit. Its balloons are the
    /// Windows notifications ("from Ludo Royale"); clicking one opens the game at the right room.
    /// </summary>
    internal sealed class Tray : IDisposable
    {
        private readonly App _app;
        private readonly NotifyIcon _icon;
        private readonly ContextMenuStrip _menu = new ContextMenuStrip();
        private readonly ToolStripMenuItem _panel;
        private readonly ToolStripMenuItem _dnd;
        private GameLink? _balloonLink;

        public Tray(App app)
        {
            _app = app;
            var open = new ToolStripMenuItem("Open Ludo Royale") { Font = new Font(_menu.Font, System.Drawing.FontStyle.Bold) };
            open.Click += (_, _) => _app.ShowMain();
            _panel = new ToolStripMenuItem("Side panel");
            _panel.Click += (_, _) =>
            {
                _app.Main.SetMode(AppSettings.Current.Mode == "panel" ? "normal" : "panel");
                _app.ShowMain();
            };
            _dnd = new ToolStripMenuItem("Do not disturb");
            _dnd.Click += (_, _) =>
            {
                AppSettings.Current.DoNotDisturb = !AppSettings.Current.DoNotDisturb;
                AppSettings.Save();
                _app.Main.PostSettings();
            };
            var quit = new ToolStripMenuItem("Quit");
            quit.Click += (_, _) => _app.Quit();
            _menu.Items.AddRange(new ToolStripItem[] { open, new ToolStripSeparator(), _panel, _dnd, new ToolStripSeparator(), quit });
            _menu.Opening += (_, _) =>
            {
                _panel.Checked = AppSettings.Current.Mode == "panel";
                _dnd.Checked = AppSettings.Current.DoNotDisturb;
            };

            _icon = new NotifyIcon
            {
                Icon = Theme.TrayIcon(),
                Text = "Ludo Royale",
                ContextMenuStrip = _menu,
                Visible = true,
            };
            _icon.MouseClick += (_, e) =>
            {
                if (e.Button == MouseButtons.Left) _app.ShowMain();
            };
            _icon.BalloonTipClicked += (_, _) =>
            {
                var link = _balloonLink;
                _balloonLink = null;
                _app.ShowMain();
                if (link != null) _app.Main.SendLink(link);
            };
            _icon.BalloonTipClosed += (_, _) => _balloonLink = null;
        }

        /// <summary>A Windows notification from Ludo Royale.</summary>
        public void ShowBalloon(string title, string text, GameLink? link)
        {
            _balloonLink = link;
            _icon.ShowBalloonTip(8000, title, string.IsNullOrWhiteSpace(text) ? " " : text, ToolTipIcon.None);
        }

        public void Dispose()
        {
            _icon.Visible = false;
            _icon.Dispose();
            _menu.Dispose();
        }
    }
}
