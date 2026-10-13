// Home: nickname, create or join a room, play offline against bots, add a friend from a link.
import { useState } from "preact/hooks";
import { checkName, normalizeRoomCode } from "../../../shared/src/protocol.js";
import { serverOrigin } from "../config.js";
import { addFriend, friends, startFriends } from "../friends.js";
import { isApp } from "../host.js";
import { toast } from "../notify.js";
import { prefs, setPref } from "../prefs.js";
import { navigate } from "../router.js";
import { useStore } from "../store.js";
import { Icon } from "./Icons.js";
import { Logo } from "./Logo.js";

const DOWNLOAD_URL = (import.meta.env.VITE_DOWNLOAD_URL as string | undefined) || "https://www.nomanshafiq.com/ludo-royale/";

export function NameField({ onEnter }: { onEnter?: () => void }) {
  const p = useStore(prefs);
  const [draft, setDraft] = useState(p.name);
  const check = checkName(draft);
  const error = draft.trim() && !check.ok ? check.error : null;
  return (
    <div class="field">
      <label for="nickname">Your nickname</label>
      <input
        id="nickname"
        class={`input${error ? " invalid" : ""}`}
        value={draft}
        maxLength={24}
        autoComplete="nickname"
        placeholder="e.g. Noman"
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setDraft(v);
          const c = checkName(v);
          if (c.ok) setPref("name", c.name);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && check.ok) onEnter?.();
        }}
        aria-invalid={!!error}
        aria-describedby="nickname-help"
      />
      <small id="nickname-help" class={error ? "error-text" : "muted"}>
        {error ?? "2–16 letters or numbers. Shown to the people you play with."}
      </small>
    </div>
  );
}

export function Home({ friendCode }: { friendCode?: string }) {
  const p = useStore(prefs);
  const f = useStore(friends);
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const hasName = checkName(p.name).ok;
  const code = normalizeRoomCode(joinCode);

  const create = async () => {
    if (!hasName) {
      toast("Pick a nickname first", { tone: "warn" });
      document.getElementById("nickname")?.focus();
      return;
    }
    setCreating(true);
    try {
      const r = await fetch(`${serverOrigin()}/api/rooms`, { method: "POST", credentials: "omit", cache: "no-store" });
      if (r.status === 429) {
        toast("Too many new rooms from your network. Try again in a minute.", { tone: "warn" });
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const { code: room } = (await r.json()) as { code: string };
      const ok = normalizeRoomCode(room);
      if (ok) navigate({ name: "room", code: ok });
    } catch {
      toast("Can't reach the game server", { body: "Check your connection, or play against the computer offline.", tone: "warn" });
    } finally {
      setCreating(false);
    }
  };

  const join = () => {
    if (!code) return;
    if (!hasName) {
      toast("Pick a nickname first", { tone: "warn" });
      document.getElementById("nickname")?.focus();
      return;
    }
    navigate({ name: "room", code });
  };

  return (
    <div class="home">
      <section class="hero">
        <Logo size={72} />
        <div>
          <h1>Ludo Royale</h1>
          <p class="muted">Classic Ludo with friends and colleagues, wherever they are.</p>
        </div>
      </section>

      {friendCode && (
        <section class="card highlight" aria-label="Add friend">
          <h2>Add a friend</h2>
          <p>
            Send a friend request to <span class="mono">{friendCode}</span>?
          </p>
          <div class="row">
            <button
              type="button"
              class="btn primary"
              disabled={f.code === friendCode}
              onClick={async () => {
                await startFriends();
                if (friends.get().status === "online" && addFriend(friendCode)) navigate({ name: "home" }, true);
                else toast("Not connected yet. Try again in a moment.", { tone: "warn" });
              }}
            >
              <Icon name="userPlus" size={18} />
              <span>{f.code === friendCode ? "That's you" : "Send request"}</span>
            </button>
            <button type="button" class="btn secondary" onClick={() => navigate({ name: "home" }, true)}>
              Not now
            </button>
          </div>
        </section>
      )}

      <section class="card">
        <NameField onEnter={() => (code ? join() : undefined)} />
      </section>

      <section class="card" aria-label="Play online">
        <h2>Play with friends</h2>
        <button type="button" class="btn primary wide" disabled={creating} onClick={() => void create()}>
          <Icon name="play" size={18} />
          <span>{creating ? "Creating…" : "Create a room"}</span>
        </button>
        <div class="or">
          <span>or join with a code</span>
        </div>
        <form
          class="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <input
            class="input code-input"
            value={joinCode}
            maxLength={4}
            placeholder="ABCD"
            aria-label="Room code"
            autoCapitalize="characters"
            autoComplete="off"
            spellcheck={false}
            onInput={(e) => setJoinCode((e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z]/g, ""))}
          />
          <button type="submit" class="btn" disabled={!code}>
            Join
          </button>
        </form>
      </section>

      <section class="card" aria-label="Practice">
        <h2>Practice</h2>
        <p class="muted small">Play against the computer. Works offline.</p>
        <button type="button" class="btn secondary wide" onClick={() => navigate({ name: "solo" })}>
          <Icon name="bot" size={18} />
          <span>Play vs computer</span>
        </button>
      </section>

      <section class="card subtle" aria-label="How to play">
        <details class="rules">
          <summary>How to play</summary>
          <ul>
            <li>Roll a <strong>6</strong> to bring a token out of your yard. A 6 also gives you another roll, but three 6s in a row lose the turn.</li>
            <li>Move a token by the number rolled. Landing on an opponent sends it back to its yard and gives you another roll.</li>
            <li>Stars and the coloured start squares are safe: nobody can be captured there.</li>
            <li>Walk all the way round into your coloured home column. You need the exact number to reach home (another roll as a reward).</li>
            <li>Classic: bring all four tokens home. Quick: one token starts out and two home win.</li>
            <li>2 vs 2: opposite corners are partners. Once your tokens are home you move your partner's.</li>
            <li>Keyboard: Space rolls, 1 to 4 move a token. Each turn has a timer; a bot steps in if you're away.</li>
          </ul>
        </details>
      </section>

      {!isApp && /Windows/.test(navigator.userAgent) && (
        <section class="card subtle" aria-label="Windows app">
          <div class="row top">
            <Icon name="download" size={22} />
            <div class="grow">
              <strong>Ludo Royale for Windows</strong>
              <p class="muted small">A side panel next to your work, a tray icon and Windows notifications for invites. About 2 MB, Windows 10 and 11.</p>
            </div>
          </div>
          <a class="btn secondary wide" href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
            Get the app
          </a>
        </section>
      )}
    </div>
  );
}
