using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace LudoRoyale.Services
{
    /// <summary>A link to open in the game: a room ("join") or a friend code ("friend").</summary>
    internal sealed class GameLink
    {
        public GameLink(string kind, string value)
        {
            Kind = kind;
            Value = value;
        }

        public string Kind { get; }
        public string Value { get; }
    }

    /// <summary>
    /// The command line: ludoroyale://join/ABCD, ludoroyale://friend/LUDO-XXXX-XXXX, --tray (start in the
    /// notification area), --updated (after an update). Anything else is ignored.
    /// </summary>
    internal sealed class LaunchCommand
    {
        private static readonly Regex RoomRe = new Regex("^[A-HJ-NP-Z]{4}$", RegexOptions.CultureInvariant);
        private static readonly Regex FriendRe = new Regex("^LUDO-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$", RegexOptions.CultureInvariant);

        public GameLink? Link { get; private set; }
        public bool Tray { get; private set; }
        public bool Updated { get; private set; }

        public static LaunchCommand Parse(IEnumerable<string> args)
        {
            var c = new LaunchCommand();
            foreach (var raw in args)
            {
                var arg = (raw ?? "").Trim();
                if (arg.Length == 0 || arg.Length > 200) continue;
                if (arg.Equals("--tray", StringComparison.OrdinalIgnoreCase)) c.Tray = true;
                else if (arg.Equals("--updated", StringComparison.OrdinalIgnoreCase)) c.Updated = true;
                else if (arg.StartsWith("ludoroyale:", StringComparison.OrdinalIgnoreCase)) c.Link = ParseLink(arg) ?? c.Link;
            }
            return c;
        }

        /// <summary>ludoroyale://join/ABCD or ludoroyale://friend/LUDO-XXXX-XXXX (a trailing slash is fine).</summary>
        public static GameLink? ParseLink(string text)
        {
            var m = Regex.Match(text.Trim(), "^ludoroyale:/*(join|friend)/([A-Za-z0-9-]{4,20})/?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            if (!m.Success) return null;
            var kind = m.Groups[1].Value.ToLowerInvariant();
            var value = m.Groups[2].Value.ToUpperInvariant();
            if (kind == "join" && RoomRe.IsMatch(value)) return new GameLink("join", value);
            if (kind == "friend" && FriendRe.IsMatch(value)) return new GameLink("friend", value);
            return null;
        }
    }
}
