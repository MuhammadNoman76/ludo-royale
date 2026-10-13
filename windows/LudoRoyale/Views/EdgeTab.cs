using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using LudoRoyale.Interop;

namespace LudoRoyale.Views
{
    /// <summary>
    /// The collapsed side panel: a slim tab on the screen edge. Click it to open the panel again, drag it
    /// up or down to move it. A dot pulses when an invite or your turn arrived meanwhile.
    /// </summary>
    internal sealed class EdgeTab : Window
    {
        private const double TabWidth = 34;
        private const double TabHeight = 128;

        private readonly MainWindow _main;
        private readonly Border _border = new Border();
        private readonly Path _chevron = new Path();
        private readonly Ellipse _dot = new Ellipse();
        private string _side = "right";
        private Rect _workArea;
        private Point? _pressAt;
        private double _pressTop;
        private bool _dragged;

        public EdgeTab(MainWindow main, bool dark)
        {
            _main = main;
            Title = "Ludo Royale";
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = false;
            ShowActivated = false;
            Topmost = true;
            Width = TabWidth;
            Height = TabHeight;
            Cursor = Cursors.Hand;
            ToolTip = "Ludo Royale: click to open, drag to move";
            AutomationPropertiesHelper.SetName(this, "Open Ludo Royale");

            var icon = new Image { Source = Theme.AppIcon(32), Width = 22, Height = 22, Margin = new Thickness(0, 4, 0, 10) };
            RenderOptions.SetBitmapScalingMode(icon, BitmapScalingMode.HighQuality);
            _chevron.StrokeThickness = 2;
            _chevron.StrokeStartLineCap = PenLineCap.Round;
            _chevron.StrokeEndLineCap = PenLineCap.Round;
            _chevron.StrokeLineJoin = PenLineJoin.Round;
            _chevron.Width = 10;
            _chevron.Height = 16;
            _chevron.Stretch = Stretch.None;
            _dot.Width = 9;
            _dot.Height = 9;
            _dot.Fill = new SolidColorBrush(Color.FromRgb(0xE5, 0x48, 0x4D));
            _dot.Margin = new Thickness(0, 10, 0, 0);
            _dot.Visibility = Visibility.Collapsed;

            var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
            stack.Children.Add(icon);
            stack.Children.Add(_chevron);
            stack.Children.Add(_dot);
            _border.Child = stack;
            _border.BorderThickness = new Thickness(1);
            Content = _border;
            ApplyTheme(dark);

            SourceInitialized += (_, _) =>
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                Native.MakeToolWindow(hwnd);
                Native.SetRoundCorners(hwnd, false);
            };
            MouseLeftButtonDown += OnDown;
            MouseMove += OnMove;
            MouseLeftButtonUp += OnUp;
            KeyDown += (_, e) =>
            {
                if (e.Key == Key.Enter || e.Key == Key.Space) _main.Expand();
            };
        }

        public void ApplyTheme(bool dark)
        {
            _border.Background = Theme.Brush(Theme.CardColor(dark));
            _border.BorderBrush = Theme.Brush(Theme.LineColor(dark));
            _chevron.Stroke = Theme.Brush(Theme.MutedColor(dark));
        }

        /// <summary>Puts the tab on the left or right edge of the work area, at a fraction of its height.</summary>
        public void Place(string side, Rect workArea, double fraction)
        {
            _side = side;
            _workArea = workArea;
            var left = side == "left";
            _border.CornerRadius = left ? new CornerRadius(0, 12, 12, 0) : new CornerRadius(12, 0, 0, 12);
            _border.BorderThickness = left ? new Thickness(0, 1, 1, 1) : new Thickness(1, 1, 0, 1);
            // Points towards the panel it opens.
            _chevron.Data = Geometry.Parse(left ? "M2,1 L8,8 L2,15" : "M8,1 L2,8 L8,15");
            Left = left ? workArea.Left : workArea.Right - TabWidth;
            Top = workArea.Top + Math.Max(0, Math.Min(1, fraction)) * Math.Max(0, workArea.Height - TabHeight);
        }

        public void SetAttention(bool on)
        {
            _dot.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
            if (on)
            {
                var pulse = new DoubleAnimation(1, 0.25, TimeSpan.FromMilliseconds(700)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever };
                _dot.BeginAnimation(OpacityProperty, pulse);
            }
            else
            {
                _dot.BeginAnimation(OpacityProperty, null);
            }
        }

        private void OnDown(object sender, MouseButtonEventArgs e)
        {
            _pressAt = PointToScreen(e.GetPosition(this));
            _pressTop = Top;
            _dragged = false;
            CaptureMouse();
        }

        private void OnMove(object sender, MouseEventArgs e)
        {
            if (_pressAt == null || e.LeftButton != MouseButtonState.Pressed) return;
            var now = PointToScreen(e.GetPosition(this));
            var scale = VisualTreeHelper.GetDpi(this).DpiScaleY;
            var dy = (now.Y - _pressAt.Value.Y) / scale;
            if (Math.Abs(dy) > 4) _dragged = true;
            if (_dragged) Top = Math.Max(_workArea.Top, Math.Min(_workArea.Bottom - TabHeight, _pressTop + dy));
        }

        private void OnUp(object sender, MouseButtonEventArgs e)
        {
            ReleaseMouseCapture();
            var wasDrag = _dragged;
            _pressAt = null;
            _dragged = false;
            if (wasDrag)
            {
                var room = Math.Max(1, _workArea.Height - TabHeight);
                _main.TabMoved((Top - _workArea.Top) / room);
            }
            else
            {
                _main.Expand();
            }
        }
    }

    /// <summary>Sets UI Automation names without pulling in extra XAML.</summary>
    internal static class AutomationPropertiesHelper
    {
        public static void SetName(DependencyObject element, string name) => System.Windows.Automation.AutomationProperties.SetName(element, name);
    }
}
