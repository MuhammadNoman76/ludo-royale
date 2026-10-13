// The app shell: top bar, screens, drawers, toasts, and the Windows app's window controls.
import { useEffect, useMemo, useState } from "preact/hooks";
import { checkName, normalizeFriendCode, normalizeRoomCode } from "../../../shared/src/protocol.js";
import { friends, startFriends } from "../friends.js";
import { host, isApp, onHostLink, postToHost } from "../host.js";
import { dismiss, toasts } from "../notify.js";
import { prefs, setPref } from "../prefs.js";
import { type Route, navigate, route } from "../router.js";
import { LocalSession, OnlineSession, type Session, type SoloOptions, soloDefaults } from "../session.js";
import { useStore } from "../store.js";
import { Segmented, Spinner, colorName } from "./common.js";
import { FriendsPanel } from "./Friends.js";
import { Game } from "./Game.js";
import { Home, NameField } from "./Home.js";
import { Icon } from "./Icons.js";
import { Lobby } from "./Lobby.js";
import { Logo } from "./Logo.js";
import { SettingsPanel } from "./Settings.js";

type Panel = "friends" | "settings" | null;

function useTheme(): void {
  const p = useStore(prefs);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = p.theme === "dark" || (p.theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#151a24" : "#f4f1ea");
      postToHost({ type: "theme", dark, pref: p.theme });
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [p.theme]);
}

export function App() {
  const r = useStore(route);
  const h = useStore(host);
  const [panel, setPanel] = useState<Panel>(null);
  useTheme();

  // Friends connect once the app host (if any) has passed in the saved identity.
  useEffect(() => {
    if (h.ready) void startFriends();
  }, [h.ready]);

  // ludoroyale:// links, tray and notification clicks.
  useEffect(
    () =>
      onHostLink((link) => {
        if (link.kind === "join") {
          const code = normalizeRoomCode(link.value);
          if (code) navigate({ name: "room", code });
        } else {
          const code = normalizeFriendCode(link.value);
          if (code) navigate({ name: "friend", code });
        }
      }),
    [],
  );

  if (!h.ready) return <Spinner label="Starting…" />;

  return (
    <div class={`app${isApp ? " in-app" : ""} win-${h.window.mode}`}>
      <TopBar panel={panel} setPanel={setPanel} />
      <UpdateBar />
      <main class="main" id="main">
        <Screen route={r} />
      </main>
      {panel === "friends" && <FriendsPanel onClose={() => setPanel(null)} />}
      {panel === "settings" && <SettingsPanel onClose={() => setPanel(null)} />}
      <Toasts />
    </div>
  );
}

function Screen({ route: r }: { route: Route }) {
  switch (r.name) {
    case "room":
      return <RoomScreen key={r.code} code={r.code} />;
    case "solo":
      return <SoloScreen />;
    case "friend":
      return <Home friendCode={r.code} />;
    default:
      return <Home />;
  }
}

function TopBar({ panel, setPanel }: { panel: Panel; setPanel: (p: Panel) => void }) {
  const p = useStore(prefs);
  const f = useStore(friends);
  const h = useStore(host);
  const r = useStore(route);
  const w = h.window;
  const toggle = (which: Panel) => setPanel(panel === which ? null : which);
  return (
    <header class="topbar">
      <button type="button" class="brand" onClick={() => r.name !== "home" && navigate({ name: "home" })} aria-label="Ludo Royale home">
        <Logo size={28} />
        <span class="brand-name">Ludo Royale</span>
      </button>
      <div class="topbar-actions">
        <button type="button" class="btn icon-btn badge-wrap" onClick={() => toggle("friends")} aria-label="Friends" title="Friends" aria-pressed={panel === "friends"}>
          <Icon name="users" />
          {f.incoming.length > 0 && <span class="badge">{f.incoming.length}</span>}
          <span class={`status-dot ${f.status}`} aria-hidden="true" />
        </button>
        <button type="button" class="btn icon-btn" onClick={() => setPref("muted", !p.muted)} aria-label={p.muted ? "Sound off" : "Sound on"} title={p.muted ? "Sound off" : "Sound on"} aria-pressed={!p.muted}>
          <Icon name={p.muted ? "mute" : "volume"} />
        </button>
        <button type="button" class="btn icon-btn" onClick={() => toggle("settings")} aria-label="Settings" title="Settings" aria-pressed={panel === "settings"}>
          <Icon name="settings" />
        </button>
        {isApp && (
          <>
            <span class="divider" aria-hidden="true" />
            <button
              type="button"
              class="btn icon-btn"
              onClick={() => postToHost({ type: "window", mode: w.mode === "panel" ? "normal" : "panel" })}
              aria-label={w.mode === "panel" ? "Normal window" : "Side panel"}
              title={w.mode === "panel" ? "Normal window" : "Dock as a side panel"}
              aria-pressed={w.mode === "panel"}
            >
              <Icon name={w.mode === "panel" ? "window" : w.side === "left" ? "dockLeft" : "dockRight"} />
            </button>
            {w.mode === "panel" && (
              <button
                type="button"
                class="btn icon-btn"
                onClick={() => postToHost({ type: "window", side: w.side === "left" ? "right" : "left" })}
                aria-label={w.side === "left" ? "Move to the right edge" : "Move to the left edge"}
                title={w.side === "left" ? "Move to the right edge" : "Move to the left edge"}
              >
                <Icon name={w.side === "left" ? "dockRight" : "dockLeft"} />
              </button>
            )}
            <button
              type="button"
              class="btn icon-btn"
              onClick={() => postToHost({ type: "window", topmost: !w.topmost })}
              aria-label="Always on top"
              title={w.topmost ? "Stop staying on top" : "Always on top"}
              aria-pressed={w.topmost}
            >
              <Icon name={w.topmost ? "pin" : "pinOff"} />
            </button>
            {w.mode === "panel" && (
              <button type="button" class="btn icon-btn" onClick={() => postToHost({ type: "window", collapse: true })} aria-label="Collapse to the edge" title="Collapse to a tab at the edge">
                <Icon name={w.side === "left" ? "collapse" : "expand"} />
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
}

function UpdateBar() {
  const h = useStore(host);
  const u = h.update;
  if (!isApp || !u) return null;
  return (
    <div class="update-bar" role="status">
      <span class="grow">
        <strong>Ludo Royale {u.version}</strong> is available.
        {u.error && <span class="error-text"> {u.error}</span>}
      </span>
      {u.progress !== null ? (
        <span class="small">Downloading… {Math.round(u.progress * 100)}%</span>
      ) : (
        <>
          <button type="button" class="btn small primary" onClick={() => postToHost({ type: "update-now" })}>
            {u.canInstall ? "Update now" : "Download page"}
          </button>
          <button type="button" class="btn small secondary" onClick={() => postToHost({ type: "update-later" })}>
            Later
          </button>
          <button type="button" class="btn small link" onClick={() => postToHost({ type: "update-skip" })}>
            Skip
          </button>
        </>
      )}
    </div>
  );
}

function Toasts() {
  const list = useStore(toasts);
  return (
    <div class="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`toast ${t.tone}`}>
          <div class="grow">
            <strong>{t.title}</strong>
            {t.body && <div class="small">{t.body}</div>}
          </div>
          {t.action && (
            <button
              type="button"
              class="btn small primary"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" class="btn icon-btn small" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- room

function RoomScreen({ code }: { code: string }) {
  const p = useStore(prefs);
  const [confirmedName, setConfirmedName] = useState<string | null>(checkName(p.name).ok ? p.name : null);
  if (!confirmedName) {
    return (
      <div class="narrow">
        <section class="card">
          <h2>Join room {code}</h2>
          <NameField onEnter={() => checkName(prefs.get().name).ok && setConfirmedName(prefs.get().name)} />
          <button type="button" class="btn primary wide" disabled={!checkName(p.name).ok} onClick={() => setConfirmedName(prefs.get().name)}>
            Join
          </button>
        </section>
      </div>
    );
  }
  return <OnlineRoom code={code} name={confirmedName} />;
}

function OnlineRoom({ code, name }: { code: string; name: string }) {
  const session = useMemo(() => new OnlineSession(code, name), [code]);
  useEffect(() => () => session.dispose(), [session]);
  const state = useStore(session.state);
  const goHome = () => navigate({ name: "home" });
  const leave = () => {
    session.leave();
    goHome();
  };

  if (state.fatal) {
    return (
      <div class="narrow">
        <section class="card center">
          <h2>Can't open room {code}</h2>
          <p class="muted">{state.fatal}</p>
          <button type="button" class="btn primary" onClick={goHome}>
            Back home
          </button>
        </section>
      </div>
    );
  }
  if (state.nameProblem) {
    return (
      <div class="narrow">
        <section class="card">
          <h2>Pick another nickname</h2>
          <p class="error-text">{state.nameProblem}</p>
          <NameField onEnter={() => session.rejoin(prefs.get().name)} />
          <button type="button" class="btn primary wide" onClick={() => session.rejoin(prefs.get().name)}>
            Join
          </button>
        </section>
      </div>
    );
  }
  if (!state.room) return <Spinner label={state.status === "reconnecting" ? "Can't reach the server. Retrying…" : `Joining room ${code}…`} />;
  if (state.room.phase === "lobby") return <Lobby session={session} room={state.room} you={state.you} onLeave={leave} />;
  return <Game session={session} onLeave={leave} onHome={goHome} />;
}

// ---------------------------------------------------------------- solo

function SoloScreen() {
  const [options, setOptions] = useState<SoloOptions>(soloDefaults());
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => () => session?.dispose(), [session]);
  const set = <K extends keyof SoloOptions>(k: K, v: SoloOptions[K]) => setOptions({ ...options, [k]: v });

  if (session) {
    const home = () => {
      session.dispose();
      navigate({ name: "home" });
    };
    return <Game session={session} onLeave={home} onHome={home} />;
  }
  return (
    <div class="narrow">
      <section class="card">
        <h2>Play vs computer</h2>
        <div class="option-col">
          <span>Your colour</span>
          <div class="color-pick" role="radiogroup" aria-label="Your colour">
            {[0, 1, 2, 3].map((c) => (
              <button key={c} type="button" role="radio" aria-checked={options.color === c} class={`swatch c${c}${options.color === c ? " on" : ""}`} onClick={() => set("color", c)}>
                {colorName(c)}
              </button>
            ))}
          </div>
        </div>
        <div class="option-row">
          <span>Opponents</span>
          <Segmented
            label="Opponents"
            value={String(options.bots) as "1" | "2" | "3"}
            options={[
              { value: "1", label: "1" },
              { value: "2", label: "2" },
              { value: "3", label: "3" },
            ]}
            onChange={(v) => set("bots", Number(v))}
          />
        </div>
        <div class="option-row">
          <span>Bots</span>
          <Segmented
            label="Bot level"
            value={options.level}
            options={[
              { value: "easy", label: "Easy" },
              { value: "normal", label: "Normal" },
            ]}
            onChange={(v) => set("level", v)}
          />
        </div>
        <div class="option-row">
          <span>Mode</span>
          <Segmented
            label="Mode"
            value={options.mode}
            options={[
              { value: "classic", label: "Classic" },
              { value: "quick", label: "Quick" },
            ]}
            onChange={(v) => set("mode", v)}
          />
        </div>
        <button
          type="button"
          class="btn primary wide"
          onClick={() => {
            const p = prefs.get();
            prefs.set({ ...p, soloBots: options.bots, soloColor: options.color, botLevel: options.level, soloMode: options.mode });
            setSession(new LocalSession({ ...options, name: p.name || "You" }));
          }}
        >
          <span>Start</span>
        </button>
      </section>
    </div>
  );
}
