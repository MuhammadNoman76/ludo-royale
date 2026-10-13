using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using LudoRoyale.Interop;

namespace LudoRoyale.Views
{
    internal enum CloseChoice { Cancel, Tray, Quit }

    /// <summary>"Keep Ludo Royale running in the tray?" The person decides; the answer can be remembered.</summary>
    internal sealed class CloseDialog : Window
    {
        private readonly CheckBox _remember;

        public CloseDialog(bool dark)
        {
            Title = "Ludo Royale";
            Width = 440;
            SizeToContent = SizeToContent.Height;
            ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = false;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            FontFamily = Theme.UiFont;
            FontSize = 14;
            Background = Theme.Brush(Theme.BackgroundColor(dark));
            Foreground = Theme.Brush(Theme.TextColor(dark));
            UseLayoutRounding = true;

            var panel = new StackPanel { Margin = new Thickness(24, 20, 24, 20) };
            panel.Children.Add(new TextBlock
            {
                Text = "Keep Ludo Royale running in the tray?",
                FontSize = 18,
                FontWeight = FontWeights.SemiBold,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 8),
            });
            panel.Children.Add(new TextBlock
            {
                Text = "While it runs in the notification area, friends' invites and \"your turn\" alerts still reach you. You can quit any time from its tray icon.",
                TextWrapping = TextWrapping.Wrap,
                Foreground = Theme.Brush(Theme.MutedColor(dark)),
                Margin = new Thickness(0, 0, 0, 14),
            });
            _remember = new CheckBox { Content = "Remember my choice", Foreground = Foreground, Margin = new Thickness(0, 0, 0, 18) };
            panel.Children.Add(_remember);

            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            var keep = MakeButton("Keep running", dark, primary: true);
            keep.IsDefault = true;
            keep.Click += (_, _) => Finish(CloseChoice.Tray);
            var quit = MakeButton("Quit", dark, primary: false);
            quit.Click += (_, _) => Finish(CloseChoice.Quit);
            buttons.Children.Add(keep);
            buttons.Children.Add(quit);
            panel.Children.Add(buttons);
            Content = panel;

            PreviewKeyDown += (_, e) =>
            {
                if (e.Key == Key.Escape) Finish(CloseChoice.Cancel);
            };
            SourceInitialized += (_, _) =>
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                Native.SetDarkTitleBar(hwnd, dark);
                Native.TrySetMica(hwnd);
            };
            Loaded += (_, _) => keep.Focus();
        }

        public CloseChoice Choice { get; private set; } = CloseChoice.Cancel;

        public bool Remember => _remember.IsChecked == true;

        private void Finish(CloseChoice choice)
        {
            Choice = choice;
            Close();
        }

        private static Button MakeButton(string text, bool dark, bool primary)
        {
            var b = new Button
            {
                Content = text,
                MinWidth = 120,
                Padding = new Thickness(16, 7, 16, 7),
                Margin = new Thickness(8, 0, 0, 0),
                FontWeight = FontWeights.SemiBold,
                Cursor = Cursors.Hand,
                BorderThickness = new Thickness(1),
            };
            if (primary)
            {
                b.Background = Theme.Brush(Theme.AccentColor(dark));
                b.Foreground = Theme.Brush(Theme.OnAccentColor(dark));
                b.BorderBrush = b.Background;
            }
            else
            {
                b.Background = Theme.Brush(Theme.CardColor(dark));
                b.Foreground = Theme.Brush(Theme.TextColor(dark));
                b.BorderBrush = Theme.Brush(Theme.LineColor(dark));
            }
            b.Template = RoundedTemplate();
            return b;
        }

        /// <summary>A plain rounded button (the classic WPF button look doesn't fit Windows 11).</summary>
        private static ControlTemplate RoundedTemplate()
        {
            var template = new ControlTemplate(typeof(Button));
            var border = new FrameworkElementFactory(typeof(Border));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(8));
            border.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            border.SetBinding(Border.BorderBrushProperty, new System.Windows.Data.Binding("BorderBrush") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            border.SetBinding(Border.BorderThicknessProperty, new System.Windows.Data.Binding("BorderThickness") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            border.SetBinding(Border.PaddingProperty, new System.Windows.Data.Binding("Padding") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(content);
            template.VisualTree = border;
            var focus = new Trigger { Property = UIElement.IsKeyboardFocusedProperty, Value = true };
            focus.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(2)));
            template.Triggers.Add(focus);
            return template;
        }
    }
}
