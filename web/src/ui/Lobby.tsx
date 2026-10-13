// The room lobby: seats (pick a colour), bots, game options, ready / start, and sharing.
import type { RoomView } from "../../../shared/src/protocol.js";
import { addFriend, friends } from "../friends.js";
import type { Session } from "../session.js";
import { useStore } from "../store.js";
import { Avatar, Segmented, colorName } from "./common.js";
import { Icon } from "./Icons.js";
import { ShareRoom } from "./Share.js";

interface Props {
  session: Session;
  room: RoomView;
  you: number | null;
  onLeave: () => void;
}

export function startProblem(room: RoomView): string | null {
  const occupied = room.seats.filter((s) => s.kind !== "empty");
  if (occupied.length < 2) return "Add at least one more player or a bot.";
  if (room.teams && occupied.length !== 4) return "2 vs 2 needs all four seats (bots count).";
  if (room.seats.some((s, i) => s.kind === "human" && i !== room.host && !s.ready)) return "Waiting for everyone to be ready.";
  return null;
}

export function Lobby({ session, room, you, onLeave }: Props) {
  const isHost = you !== null && room.host === you;
  const me = you !== null ? room.seats[you] : null;
  const problem = startProblem(room);
  const f = useStore(friends);
  const known = new Set([f.code, ...f.friends.map((x) => x.code), ...f.outgoing]);
  const send = session.send.bind(session);

  return (
    <div class="lobby">
      <ShareRoom code={room.code} />

      <section class="card" aria-label="Players">
        <div class="section-head">
          <h2>Players</h2>
          {room.spectators > 0 && <span class="muted small">{room.spectators} watching</span>}
        </div>
        <div class="seats">
          {[0, 1, 3, 2].map((c) => {
            const s = room.seats[c]!;
            const mine = c === you;
            return (
              <div key={c} class={`seat c${c}${s.kind === "empty" ? " empty" : ""}${mine ? " mine" : ""}`}>
                {s.kind === "empty" ? (
                  <>
                    <span class="seat-color">{colorName(c)}</span>
                    <span class="muted small">Free seat</span>
                    <div class="seat-actions">
                      {you !== null && (
                        <button type="button" class="btn small" onClick={() => send({ t: "seat", c })}>
                          Sit here
                        </button>
                      )}
                      {isHost && (
                        <button type="button" class="btn small secondary" onClick={() => send({ t: "bot", c, level: "normal" })}>
                          <Icon name="bot" size={16} />
                          <span>Add bot</span>
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div class="seat-who">
                      <Avatar name={s.name} color={c} size={34} />
                      <div class="seat-name">
                        <strong>
                          {s.name}
                          {mine && <span class="muted"> (you)</span>}
                        </strong>
                        <span class="small muted">
                          {s.kind === "bot" ? (s.bot === "easy" ? "Bot · easy" : "Bot · normal") : c === room.host ? "Host" : s.ready ? "Ready" : s.online ? "Not ready" : "Connecting…"}
                        </span>
                      </div>
                      {c === room.host && <Icon name="crown" size={18} class="crown" aria-label="Host" />}
                      {s.kind === "human" && c !== room.host && s.ready && <Icon name="check" size={18} class="ready-mark" />}
                    </div>
                    <div class="seat-actions">
                      {isHost && s.kind === "bot" && (
                        <>
                          <button type="button" class="btn small secondary" onClick={() => send({ t: "bot", c, level: s.bot === "easy" ? "normal" : "easy" })}>
                            {s.bot === "easy" ? "Make normal" : "Make easy"}
                          </button>
                          <button type="button" class="btn small secondary" onClick={() => send({ t: "bot", c, level: null })} aria-label={`Remove ${s.name}`}>
                            <Icon name="x" size={16} />
                          </button>
                        </>
                      )}
                      {s.kind === "human" && !mine && s.friend && f.status === "online" && !known.has(s.friend) && (
                        <button type="button" class="btn small secondary" onClick={() => addFriend(s.friend!)}>
                          <Icon name="userPlus" size={16} />
                          <span>Add friend</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section class="card" aria-label="Game options">
        <div class="section-head">
          <h2>Game</h2>
          {!isHost && <span class="muted small">The host picks</span>}
        </div>
        <div class="option-row">
          <span>Mode</span>
          <Segmented
            label="Mode"
            value={room.mode}
            disabled={!isHost}
            options={[
              { value: "classic", label: "Classic" },
              { value: "quick", label: "Quick" },
            ]}
            onChange={(mode) => send({ t: "config", mode, teams: room.teams })}
          />
        </div>
        <p class="muted small">{room.mode === "quick" ? "One token starts out; first to bring 2 tokens home wins (about 10 minutes)." : "All four tokens start in the yard; bring all four home to win."}</p>
        <div class="option-row">
          <span>Teams</span>
          <Segmented
            label="Teams"
            value={room.teams ? "teams" : "solo"}
            disabled={!isHost}
            options={[
              { value: "solo", label: "Everyone" },
              { value: "teams", label: "2 vs 2" },
            ]}
            onChange={(v) => send({ t: "config", mode: room.mode, teams: v === "teams" })}
          />
        </div>
        {room.teams && <p class="muted small">Red + Yellow play against Green + Blue. A team wins when both partners are home.</p>}
      </section>

      <div class="lobby-actions">
        <button type="button" class="btn secondary" onClick={onLeave}>
          <Icon name="leave" size={18} />
          <span>Leave</span>
        </button>
        {isHost ? (
          <button type="button" class="btn primary grow" disabled={!!problem} onClick={() => send({ t: "start" })} title={problem ?? "Start the game"}>
            <Icon name="play" size={18} />
            <span>Start game</span>
          </button>
        ) : me ? (
          <button type="button" class={`btn grow ${me.ready ? "secondary" : "primary"}`} onClick={() => send({ t: "ready", v: !me.ready })}>
            <Icon name="check" size={18} />
            <span>{me.ready ? "Not ready" : "I'm ready"}</span>
          </button>
        ) : (
          <span class="muted grow center">Watching: the room is full.</span>
        )}
      </div>
      {isHost && problem && <p class="muted small center">{problem}</p>}
    </div>
  );
}
