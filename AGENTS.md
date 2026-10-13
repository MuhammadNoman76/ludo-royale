# Ludo Royale: notes for coding agents

Shared project memory for coding assistants (Codex, Claude Code, Gemini CLI, …). `CLAUDE.md` and `GEMINI.md` load this file. Keep it up to date when something important changes.

## What this is
Ludo Royale is a free online multiplayer Ludo game for friends and colleagues: a Cloudflare Worker game server, a web client (browser at `/`, room links `/r/<CODE>`, friend links `/f/<code>`) and a tiny Windows host app (WebView2) with a side panel, tray icon and Windows notifications.
- Owner: Muhammad Noman (https://github.com/MuhammadNoman76). No GitHub repository yet: don't push until the owner creates one.
- Tagline: "Ludo with friends and colleagues, wherever they are."
- Not deployed yet. Production host planned: `https://ludo.nomanshafiq.com` (the default in build.ps1 `-Server`, `web/src/config.ts`, the csproj `LudoServer` property and the installer `ServerUrl`). Changing the domain = rebuild with `build.ps1 -Server https://…` and deploy with `VITE_SERVER_URL` set.
- Never add a feature that hides the window from screen sharing/recording or otherwise conceals the app.

## Layout
- `shared/src/`: `board.ts` (geometry: 52-square track from red's start, colours 0 red TL, 1 green TR, 2 yellow BR, 3 blue BL, clockwise; progress -1 yard, 0..50 track, 51..55 home column, 56 home; safe squares 0 8 13 21 26 34 39 47), `engine.ts` (pure rules: `createGame`, `applyRoll`, `applyMove`, `onlyOneChoice`, `standings`), `bot.ts` (easy/normal, only picks from `state.movable`), `protocol.ts` (message types, strict parsers, nickname check + profanity list, codes, `rollDie` with crypto RNG). Imported by server and web through relative paths.
- `server/`: `wrangler.jsonc` (assets = `../web/dist`, `run_worker_first` for `/api/*` and `/ws/*`, DO bindings ROOMS/PLAYERS, `new_sqlite_classes` migration v1, rate limiters, vars for timers, `env.test` with short timers), `src/index.ts` (routes, origin check, CORS for the app origin, rate limits), `src/room.ts` (RoomDO), `src/player.ts` (PlayerDO), `src/util.ts`. `worker-configuration.d.ts` is generated (`npm run types`), git-ignored.
- `web/`: Preact + TypeScript + Vite (no preset; esbuild JSX). `src/session.ts` (OnlineSession over WebSocket, LocalSession runs the engine for offline games), `src/animator.ts` (event queue → hop/dice/capture animations; skips ahead when behind), `src/friends.ts` (PlayerDO connection), `src/host.ts` (WebView2 bridge), `src/ui/*`. `public/_headers` = CSP and security headers for the Worker; `vite.config.ts` adds a CSP meta tag (used inside the app) and copies THIRD-PARTY-NOTICES.txt into the build. Sounds in `public/sounds` (6 small mp3s, ~30 KB total).
- `windows/LudoRoyale/`: C# net48 WPF + WinForms (NotifyIcon) + Microsoft.Web.WebView2 1.0.4258.31, AnyCPU, no XAML. `Program.cs` (single instance), `App.cs`, `Views/MainWindow.cs` (WebView2, virtual host `https://app.ludoroyale.example` → `web\` next to the exe, navigation lockdown, bridge, side panel/collapse, notifications policy), `Views/EdgeTab.cs`, `Views/CloseDialog.cs`, `Views/Tray.cs`, `Views/Theme.cs`, `Services/` (AppSettings with DPAPI token, InstanceManager pipe, LaunchCommand, Registration (protocol + Run key), Updater + UpdateService, Json via JavaScriptSerializer, Log), `Interop/Native.cs`.
- `windows/installer/LudoRoyale.iss`: per-user Inno Setup (PrivilegesRequired=lowest), AppId `{A2855202-BFD4-4982-866A-38326F65D047}` (keep it: the updater's uninstall-key lookup uses it). Tasks: protocol (on), startup (off), desktop icon (off). Uninstall removes the protocol key and the Run value even if the app created them, deletes `%LOCALAPPDATA%\LudoRoyale` (WebView2 cache) and asks (interactive uninstall only) whether to delete `%APPDATA%\LudoRoyale`.
- `tools/make-icons.ps1` renders `windows/LudoRoyale/Assets/LudoRoyale.ico` and `web/public/icon-*.png` (the favicon.svg/Logo.tsx use the same shapes). `tools/e2e/`: `play.mjs` (two headless Edge players: friends, invite, lobby, full game, screenshots), `appdrv.mjs` + `capture.ps1` + `toast.ps1` (drive and capture the Windows app safely, see below).
- `build.ps1` → `publish\windows`, `dist\` and `release\` (setup, portable zip, SHA256SUMS.txt).

## Protocol and server rules (keep them)
- Clients only send intents (`roll`, `move k`, lobby actions, fixed reaction index). The server rolls (`rollDie`, crypto) and validates with the engine; a roll with no real choice (`onlyOneChoice`) is played at once.
- Every client message: string ≤ 512 bytes, exact keys, typed values (`parseRoomMessage` / `parsePlayerMessage`), token bucket per socket, strikes close the socket. No free text anywhere except nicknames (`checkName`: 2–16 chars, letters/numbers/space/`_-.'`, profanity list with whole-word matching for short words so names like Hassan pass).
- Origin check on `/api/*` and `/ws/*`: the Worker's own origin plus `ALLOWED_ORIGINS` (`https://app.ludoroyale.example`). CORS headers only for listed origins.
- RoomDO: seats get a secret (hash stored) for reconnects; turn timer `TURN_MS` (20 s) then an automatic move; 2 missed turns or a disconnect longer than `GRACE_MS` (30 s) → bot plays the seat (`auto`) until the player is back; bots pace with `BOT_DELAY_MS`; nobody online → paused; idle rooms deleted after `ROOM_TTL_MS` (2 h) by an alarm. Hibernation API; state is one JSON value in DO storage.
- PlayerDO: friend code + SHA-256 of the token (issued by `POST /api/identity`), friends/requests/blocks, presence fan-out, invites only between mutual friends, "your turn" only for rooms the player registered with `watch`. Deleted after ~400 days unused.
- In local dev, a server-side `ws.close()` from an alarm handler reaches the client but the proxy keeps TCP open; tests check for the close frame, not the TCP close.

## Windows app rules (keep them)
- .NET Framework 4.8 only (no System.Text.Json and other NuGet DLLs: keep the download small). No `init`, ranges or other APIs that need polyfills.
- The page is local files only; navigation outside `https://app.ludoroyale.example/` is cancelled; `NewWindowRequested`/`open` only open https links to wa.me, api.whatsapp.com, nomanshafiq.com and the game server in the default browser. Permissions denied, downloads cancelled, dev tools only with `LUDO_DEVTOOLS=1`.
- Notifications are NotifyIcon balloons (Windows shows them as toasts "from Ludo Royale"). Policy: invites/friend requests when the user isn't looking; "your turn" only while hidden/minimized/collapsed and only once until the window is activated again; never while `SHQueryUserNotificationState` says busy; Do not disturb silences all.
- Start in the tray (`--tray`, used by the Run entry): the WPF WebView2 control only starts inside a shown window, so `StartHidden` shows the window far off-screen (no activation, no taskbar button) until the page posts `started` (or 20 s pass), then hides it. Hiding before the page has started can leave it stalled.
- Close → ask (keep in tray / quit, can be remembered). Never call `Close()` from inside `Closing` (quit is dispatched afterwards). SessionEnding quits without questions.
- Start with Windows is opt-in (off by default). The protocol is registered by the installer; the app's setting can add/remove it for portable copies.
- Settings: `%APPDATA%\LudoRoyale\settings.json` (DataContract JSON, `[OnDeserializing]` sets defaults). WebView2 data: `%LOCALAPPDATA%\LudoRoyale\WebView2`. Logs: `error.log`; `LUDO_DEBUG=1` → `debug.log` (notifications).
- Updates: feed `https://www.nomanshafiq.com/updates/ludo-royale.json` (`LUDO_UPDATE_URL` overrides; a file path works), edition key `windows`, first check 10 s after start then daily, offer shown in the web UI's update bar, size + SHA-256 checked before running the installer with `/VERYSILENT … /RELAUNCH=1 /CURRENTUSER /DIR=…`. Only installed copies update themselves; portable copies get the download page.

## Testing on the owner's PC (be careful)
- The owner uses his PC while you work. Test windows of the app appear on his screen: keep them short-lived and out of the way (preset `"mode": "panel"` in settings.json so the window docks at the edge), and stop every process you start (`wrangler dev`, headless browsers, the app).
- Before showing any window check `SHQueryUserNotificationState` (`tools/e2e/capture.ps1 -Busy`); never open windows over a full-screen app.
- Never send keyboard/mouse input to the desktop. Drive the app's page through WebView2's DevTools port (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, see `tools/e2e/appdrv.mjs`), its own windows with `WM_CLOSE` / UI Automation patterns, and capture only its own windows with PrintWindow (`capture.ps1`, per-monitor DPI aware, checks the owning process). In hidden pages use `waitForFunction(..., { polling: 300 })` (requestAnimationFrame doesn't run).
- Don't flood him with notifications from test games: they're real Windows toasts. During the first test run Windows notifications for the dev build (`NotifyIconGeneratedAumid_6537403120861086524`) ended up turned off in Windows settings; don't change that setting.
- Back up `%APPDATA%\LudoRoyale` before tests (on a fresh PC it doesn't exist: delete it afterwards, and `%LOCALAPPDATA%\LudoRoyale`). Check that `HKCU\Software\Classes\ludoroyale` and the Run value `Ludo Royale` are gone after tests.
- Installer tests: install per-user into a scratch folder (`/VERYSILENT /SUPPRESSMSGBOXES /DIR=… /TASKS="protocol,startup"`), check the keys, uninstall silently with `unins000.exe`, check that files, keys and the Start menu shortcut are gone.

## Build and release
1. Bump the version in `windows/LudoRoyale/LudoRoyale.csproj` and `package.json`; pass `-Version` to build.ps1.
2. `powershell -ExecutionPolicy Bypass -File build.ps1 -Version X.Y.Z [-Server https://…] [-Integration]`. The .NET SDK is at `%LOCALAPPDATA%\Microsoft\dotnet\dotnet.exe`; Inno Setup 6 at `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`.
3. Update the README download table (sizes), commit, push (once the repo exists).
4. Website repo (`D:\Work\nomanshafiq-portfolio`): add `public/updates/ludo-royale.json` (app "Ludo Royale", version, released, notes, page, editions.windows url/sha256/size) and a download page `/ludo-royale/`.
5. Server: `npx wrangler login` once, then `npm run deploy`.

## Git and writing rules
- Commit as `Muhammad Noman <muhammadnomanshafiq76@gmail.com>`.
- Never add AI attribution: no `Co-Authored-By` trailer and no "Generated with …" line.
- Don't mention AI in commit messages, README, release notes or repo descriptions.
- Ask before pushing unless the owner has asked for it in the current task.
- Read and write text files as UTF-8. PowerShell `Get-Content`/`Set-Content` without `-Encoding` corrupts characters such as · – ’ …
- Public claims (README, website) must match the code. Don't invent features or numbers, and say what is untested (ARM64 hardware, 32-bit Windows 10, Windows 10 in general).
- No LICENSE file yet: the owner will choose one.
