using System;
using LudoRoyale.Services;

namespace LudoRoyale
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            // A second start (for example a ludoroyale:// link) hands its arguments to the running copy.
            if (!InstanceManager.TryBecomePrimary(args)) return 0;
            try
            {
                var app = new App(LaunchCommand.Parse(args));
                return app.Run();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Fatal");
                return 1;
            }
            finally
            {
                InstanceManager.Release();
            }
        }
    }
}
