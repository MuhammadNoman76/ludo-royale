using System;
using System.Windows;
using System.Windows.Threading;
using LudoRoyale.Services;
using LudoRoyale.Views;

namespace LudoRoyale
{
    internal sealed class App : Application
    {
        private readonly LaunchCommand _start;
        private Tray? _tray;
        private MainWindow? _main;
        private bool _quitting;

        public App(LaunchCommand start)
        {
            _start = start;
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
        }

        public Tray Tray => _tray!;

        public MainWindow Main => _main!;

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            DispatcherUnhandledException += (_, ex) =>
            {
                Log.Error(ex.Exception, "Unhandled");
                ex.Handled = true;
            };
            AppDomain.CurrentDomain.UnhandledException += (_, ex) => Log.Error(ex.ExceptionObject as Exception, "Unhandled (domain)");

            // Signing out, shutting down or an installer closing the app: no questions, just save and go.
            SessionEnding += (_, _) =>
            {
                _quitting = true;
                _main?.PrepareToQuit();
                _tray?.Dispose();
            };

            AppSettings.Load();
            // The Run entry is the truth for "Start with Windows" (the uninstaller or the user may remove it).
            AppSettings.Current.StartWithWindows = Registration.StartsWithWindows;

            _tray = new Tray(this);
            _main = new MainWindow(this);
            InstanceManager.Received += args => Dispatcher.BeginInvoke(new Action(() => HandleCommand(LaunchCommand.Parse(args), fromOtherStart: true)));

            if (_start.Tray && _start.Link == null) _main.StartHidden();
            else _main.ShowWindow();
            if (_start.Link != null) _main.SendLink(_start.Link);

            UpdateService.Changed += (manifest, progress, error) => _main.PostUpdate(manifest, progress, error);
            UpdateService.Start();
        }

        private void HandleCommand(LaunchCommand command, bool fromOtherStart)
        {
            if (_quitting) return;
            if (command.Link != null)
            {
                ShowMain();
                _main!.SendLink(command.Link);
            }
            else if (!command.Tray || !fromOtherStart)
            {
                ShowMain();
            }
        }

        public void ShowMain() => _main?.ShowWindow();

        public void Quit()
        {
            if (_quitting) return;
            _quitting = true;
            UpdateService.Stop();
            _main?.PrepareToQuit();
            _main?.Close();
            _tray?.Dispose();
            Shutdown();
        }
    }
}
