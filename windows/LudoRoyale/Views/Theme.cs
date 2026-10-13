using System;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using LudoRoyale.Services;
using Microsoft.Win32;

namespace LudoRoyale.Views
{
    /// <summary>Colours shared by the native windows (they match the web client's light and dark themes).</summary>
    internal static class Theme
    {
        public static bool SystemPrefersDark()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
                return key?.GetValue("AppsUseLightTheme") is int light && light == 0;
            }
            catch
            {
                return false;
            }
        }

        public static Color BackgroundColor(bool dark) => dark ? Color.FromRgb(0x13, 0x18, 0x22) : Color.FromRgb(0xF4, 0xF1, 0xEA);
        public static Color CardColor(bool dark) => dark ? Color.FromRgb(0x1C, 0x23, 0x30) : Colors.White;
        public static Color LineColor(bool dark) => dark ? Color.FromRgb(0x2D, 0x36, 0x47) : Color.FromRgb(0xE3, 0xDD, 0xD1);
        public static Color TextColor(bool dark) => dark ? Color.FromRgb(0xE9, 0xED, 0xF4) : Color.FromRgb(0x1D, 0x24, 0x33);
        public static Color MutedColor(bool dark) => dark ? Color.FromRgb(0x9A, 0xA5, 0xB8) : Color.FromRgb(0x5D, 0x66, 0x76);
        public static Color AccentColor(bool dark) => dark ? Color.FromRgb(0x8B, 0x74, 0xFF) : Color.FromRgb(0x5B, 0x3F, 0xD1);
        public static Color OnAccentColor(bool dark) => dark ? Color.FromRgb(0x0F, 0x0B, 0x24) : Colors.White;

        public static SolidColorBrush Brush(Color c)
        {
            var b = new SolidColorBrush(c);
            b.Freeze();
            return b;
        }

        public static System.Drawing.Color DrawingColor(Color c) => System.Drawing.Color.FromArgb(c.A, c.R, c.G, c.B);

        public static FontFamily UiFont { get; } = new FontFamily("Segoe UI Variable Text, Segoe UI");

        private static readonly Uri IconUri = new Uri("pack://application:,,,/Assets/LudoRoyale.ico", UriKind.Absolute);

        /// <summary>The app icon as a WPF image (window icon, edge tab).</summary>
        public static ImageSource AppIcon(int size)
        {
            try
            {
                var decoder = new IconBitmapDecoder(IconUri, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
                BitmapFrame? best = null;
                foreach (var frame in decoder.Frames)
                {
                    if (frame.PixelWidth >= size && (best == null || frame.PixelWidth < best.PixelWidth)) best = frame;
                }
                return best ?? decoder.Frames[decoder.Frames.Count - 1];
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Load icon");
                return new DrawingImage();
            }
        }

        /// <summary>The app icon for the notification area.</summary>
        public static System.Drawing.Icon TrayIcon()
        {
            var info = Application.GetResourceStream(IconUri);
            using Stream stream = info.Stream;
            return new System.Drawing.Icon(stream, System.Windows.Forms.SystemInformation.SmallIconSize);
        }
    }
}
