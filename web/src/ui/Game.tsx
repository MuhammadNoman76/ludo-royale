// The game screen: board, die, whose turn it is, reactions, and the victory screen.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { partnerOf } from "../../../shared/src/board.js";
import { homeCount, standings } from "../../../shared/src/engine.js";
import { REACTIONS } from "../../../shared/src/protocol.js";
import { Animator } from "../animator.js";
import type { Session } from "../session.js";
import { useStore } from "../store.js";
import { Board, type FloatingReaction } from "./Board.js";
import { Avatar, colorName } from "./common.js";
import { Confetti } from "./Confetti.js";
import { Dice } from "./Dice.js";
import { Icon } from "./Icons.js";
import { ShareRoom } from "./Share.js";

interface Props {
  session: Session;
  onLeave: () => void;
  onHome: () => void;
}

export function Game({ session, onLeave, onHome }: Props) {
  const state = useStore(session.state);
  const animator = useMemo(() => new Animator(() => session.state.get().you), [session]);
  const display = useStore(animator.display);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [showShare, setShowShare] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const live = useRef<HTMLDivElement>(null);
  const reactionId = useRef(1);

  useEffect(() => {
    const off = session.onBatch((b) => animator.push(b));
    const offReact = session.onReact((c, r) => {
      const id = reactionId.current++;
      setReactions((list) => [...list.slice(-6), { id, c, r }]);
      setTimeout(() => setReactions((list) => list.filter((x) => x.id !== id)), 2300);
    });
    return () => {
      off();
      offReact();
      animator.dispose();
    };
  }, [session, animator]);

  const you = state.you;
  const room = display.room;
  const game = room?.game ?? null;
  const idle = !display.busy;
  const mySeat = you !== null && room ? room.seats[you] : null;
  const myTurn = !!game && game.phase !== "over" && game.turn === you && room?.phase === "playing";
  const canRoll = idle && myTurn && game!.phase === "roll";
  const canMove = idle && myTurn && game!.phase === "move";
  const movable = canMove ? game!.movable : [];

  const roll = () => {
    if (canRoll) session.send({ t: "roll" });
  };
  const move = (t: number) => {
    if (canMove && movable.includes(t)) session.send({ t: "move", k: t });
  };

  // Keyboard: Space / Enter rolls, 1-4 moves that token.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === " " || e.key === "Enter") && canRoll) {
        if (target?.tagName === "BUTTON" && !target.classList.contains("dice")) return;
        e.preventDefault();
        roll();
      } else if (/^[1-4]$/.test(e.key) && canMove) {
        e.preventDefault();
        move(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Announce turns for screen readers.
  useEffect(() => {
    if (!live.current || !game || !room) return;
    live.current.textContent = myTurn ? (game.phase === "roll" ? "Your turn. Press Space to roll." : `You rolled ${game.dice}. Pick a token with 1 to 4.`) : `${room.seats[game.turn]?.name ?? "Someone"}'s turn.`;
  }, [game?.turnNo, game?.phase, myTurn]);

  if (!room || !game) return null;

  const turnSeat = room.seats[game.turn]!;
  const status = (() => {
    if (room.phase === "over") return "Game over";
    if (display.busy) return myTurn ? "Your turn" : `${turnSeat.name}'s turn`;
    if (myTurn) {
      if (mySeat?.auto) return "A bot is playing for you";
      if (game.phase === "roll") return game.dice === 6 || game.sixes > 0 ? "Roll again!" : "Your turn: roll the die";
      return game.moveColor !== you ? `Move one of your partner's tokens (${colorName(game.moveColor)})` : "Pick a token to move";
    }
    if (turnSeat.kind === "bot" || turnSeat.auto) return `${turnSeat.name} is thinking…`;
    return `${turnSeat.name}'s turn`;
  })();

  const over = room.phase === "over" && idle;

  return (
    <div class="game">
      <div class="board-wrap">
        <Board display={display} you={you} movable={movable} onToken={move} reactions={reactions} />
        {display.banner && (
          <div key={display.banner.id} class="banner" aria-hidden="true">
            {display.banner.text}
          </div>
        )}
        {over && <Victory session={session} you={you} onHome={onHome} />}
      </div>

      <div class={`controls c${display.diceColor}`}>
        <div class="turn-info">
          <Avatar name={turnSeat.name} color={game.turn} size={30} />
          <div class="turn-text">
            <strong>{status}</strong>
            <span class="small muted">
              {room.mode === "quick" ? "Quick" : "Classic"}
              {room.teams ? " · 2 vs 2" : ""}
              {room.code !== "SOLO" ? ` · Room ${room.code}` : " · Offline"}
            </span>
          </div>
        </div>
        <Dice
          value={display.dice}
          rolling={display.rolling}
          color={display.diceColor}
          canRoll={canRoll}
          onRoll={roll}
          label={canRoll ? "Roll the die" : display.dice ? `Die shows ${display.dice}` : "Waiting"}
        />
      </div>

      {mySeat?.auto && room.phase === "playing" && (
        <div class="notice">
          <span>You were away, so a bot took your turns.</span>
          <button type="button" class="btn small primary" onClick={() => session.send({ t: "back" })}>
            I'm back
          </button>
        </div>
      )}

      <div class="game-actions">
        <button type="button" class="btn secondary" onClick={onLeave} title="Leave the game">
          <Icon name="leave" size={18} />
          <span>Leave</span>
        </button>
        {you !== null && (
          <div class="reactions-wrap">
            <button type="button" class="btn secondary" aria-expanded={showReactions} onClick={() => setShowReactions(!showReactions)} title="Send a reaction">
              <Icon name="smile" size={18} />
              <span>React</span>
            </button>
            {showReactions && (
              <div class="reactions" role="menu">
                {REACTIONS.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    class="reaction-btn"
                    onClick={() => {
                      session.send({ t: "react", r: i });
                      setShowReactions(false);
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {room.code !== "SOLO" && (
          <button type="button" class="btn secondary" aria-expanded={showShare} onClick={() => setShowShare(!showShare)}>
            <Icon name="share" size={18} />
            <span>Invite</span>
          </button>
        )}
      </div>
      {showShare && room.code !== "SOLO" && <ShareRoom code={room.code} compact />}
      {state.status === "reconnecting" && <div class="notice warn">Connection lost. Reconnecting…</div>}
      <div class="sr-only" aria-live="polite" ref={live} />
    </div>
  );
}

function Victory({ session, you, onHome }: { session: Session; you: number | null; onHome: () => void }) {
  const state = useStore(session.state);
  const room = state.room!;
  const game = room.game!;
  const winners = game.winners;
  const iWon = you !== null && winners.includes(you);
  const order = standings(game);
  const isHost = you !== null && room.host === you;
  const title = winners.length === 2 ? `${winners.map((c) => room.seats[c]!.name).join(" & ")} win!` : `${room.seats[winners[0]!]?.name ?? colorName(winners[0]!)} wins!`;
  return (
    <div class="victory" role="dialog" aria-label="Game over">
      <Confetti />
      <div class="victory-card">
        <div class="trophy" aria-hidden="true">
          🏆
        </div>
        <h2>{iWon ? "You win!" : title}</h2>
        {iWon && <p class="muted">{title}</p>}
        <ol class="standings">
          {order.map((c, i) => (
            <li key={c} class={winners.includes(c) ? "won" : ""}>
              <span class="place">{i + 1}</span>
              <Avatar name={room.seats[c]!.name} color={c} size={26} />
              <span class="grow">{room.seats[c]!.name}</span>
              <span class="small muted">
                {homeCount(game, c)}/{room.mode === "quick" ? 2 : 4} home
              </span>
            </li>
          ))}
        </ol>
        {room.teams && winners.length === 2 && <p class="muted small">Team {colorName(winners[0]!)} + {colorName(partnerOf(winners[0]!))}</p>}
        <div class="victory-actions">
          {room.code === "SOLO" || isHost ? (
            <button type="button" class="btn primary" onClick={() => session.send({ t: "rematch" })}>
              <Icon name="refresh" size={18} />
              <span>Play again</span>
            </button>
          ) : (
            <span class="muted small">Waiting for the host to start a new game…</span>
          )}
          <button type="button" class="btn secondary" onClick={onHome}>
            <Icon name="home" size={18} />
            <span>Home</span>
          </button>
        </div>
      </div>
    </div>
  );
}
