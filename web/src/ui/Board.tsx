// The Ludo board as one SVG in cell units (15 x 15). Tokens move with CSS transitions on their
// transform, so a hop is just a change of position.
import { useEffect, useState } from "preact/hooks";
import { COLORS, HOME, SAFE_SQUARES, TRACK_CELLS, YARD, YARD_ORIGIN, homeColumnCell, startSquare, tokenPoint } from "../../../shared/src/board.js";
import { REACTIONS, type RoomView } from "../../../shared/src/protocol.js";
import type { DisplayState } from "../animator.js";

export interface FloatingReaction {
  id: number;
  c: number;
  r: number;
}

interface Props {
  display: DisplayState;
  you: number | null;
  /** Tokens (of display.room.game.moveColor) the player may click now. */
  movable: number[];
  onToken: (t: number) => void;
  reactions: FloatingReaction[];
}

/** A map-pin pawn: round head, pointed foot on the square's centre. */
const PIN = "M0,0.36 C-0.08,0.2 -0.33,0.02 -0.33,-0.17 A0.33,0.33 0 1 1 0.33,-0.17 C0.33,0.02 0.08,0.2 0,0.36 Z";

const STAR = "M0,-0.34 L0.1,-0.11 L0.33,-0.1 L0.15,0.05 L0.21,0.29 L0,0.16 L-0.21,0.29 L-0.15,0.05 L-0.33,-0.1 L-0.1,-0.11 Z";

function Yard({ c, room, active, timer, timerMs, you }: { c: number; room: RoomView | null; active: boolean; timer: number | null; timerMs: number; you: number | null }) {
  const [ox, oy] = YARD_ORIGIN[c]!;
  const seat = room?.seats[c];
  const inGame = room?.game ? room.game.config.seats.includes(c) : seat?.kind !== "empty";
  const name = seat && seat.kind !== "empty" ? seat.name : "";
  const badge = !seat || seat.kind === "empty" ? "" : seat.kind === "bot" ? "BOT" : seat.auto ? "AWAY" : !seat.online && room?.code !== "SOLO" ? "OFFLINE" : "";
  const label = name.length > 13 ? `${name.slice(0, 12)}…` : name;
  return (
    <g class={`yard c${c}${active ? " active" : ""}${inGame ? "" : " unused"}`}>
      <rect x={ox} y={oy} width={6} height={6} class="yard-bg" />
      <rect x={ox + 0.55} y={oy + 0.55} width={4.9} height={4.9} rx={0.55} class="yard-inner" />
      {active && timer !== null && timerMs > 0 && (
        <rect
          key={`${timer}`}
          x={ox + 0.55}
          y={oy + 0.55}
          width={4.9}
          height={4.9}
          rx={0.55}
          pathLength={100}
          class="yard-timer"
          style={{ animationDuration: `${timer}ms`, strokeDashoffset: `${100 * (1 - timer / timerMs)}` }}
        />
      )}
      {[0, 1, 2, 3].map((t) => {
        const [x, y] = tokenPoint(c, t, YARD);
        return <circle key={t} cx={x} cy={y} r={0.62} class="slot" />;
      })}
      {label && (
        <text x={ox + 3} y={oy + 5.02} class="yard-name">
          {c === you ? `${label} (you)` : label}
        </text>
      )}
      {badge && (
        <text x={ox + 3} y={oy + 1.03} class="yard-badge">
          {badge}
        </text>
      )}
    </g>
  );
}

function Token({ c, t, x, y, scale, movable, hop, flying, label, onClick }: { c: number; t: number; x: number; y: number; scale: number; movable: boolean; hop: boolean; flying: boolean; label: string; onClick?: () => void }) {
  const interactive = movable && onClick;
  return (
    <g
      class={`token c${c}${movable ? " movable" : ""}${hop ? " hopping" : ""}${flying ? " flying" : ""}`}
      style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      onClick={interactive ? onClick : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
    >
      {movable && <circle r={0.5} class="token-halo" />}
      <ellipse cx={0} cy={0.36} rx={0.24} ry={0.08} class="token-shadow" />
      <g class="token-body">
        <path d={PIN} class="token-outer" />
        <circle cy={-0.17} r={0.17} class="token-ring" />
        <circle cy={-0.17} r={0.09} class="token-core" />
        <text y={-0.09} class="token-num">
          {t + 1}
        </text>
      </g>
    </g>
  );
}

/** Spreads tokens that share a square so each one stays visible and clickable. */
function layout(pos: number[][], colors: number[]): Map<string, { x: number; y: number; scale: number }> {
  const groups = new Map<string, Array<{ c: number; t: number; x: number; y: number }>>();
  for (const c of colors) {
    for (let t = 0; t < 4; t++) {
      const p = pos[c]![t]!;
      const [x, y] = tokenPoint(c, t, p);
      const key = p === YARD || p >= HOME ? `${c}:${t}:${p}` : `${x.toFixed(2)},${y.toFixed(2)}`;
      const list = groups.get(key) ?? [];
      list.push({ c, t, x, y });
      groups.set(key, list);
    }
  }
  const out = new Map<string, { x: number; y: number; scale: number }>();
  const offsets: Record<number, Array<[number, number]>> = {
    1: [[0, 0]],
    2: [[-0.2, -0.05], [0.2, 0.05]],
    3: [[-0.2, -0.16], [0.2, -0.16], [0, 0.2]],
  };
  for (const list of groups.values()) {
    const n = list.length;
    const offs = offsets[n] ?? list.map((_, i) => [((i % 2) - 0.5) * 0.4, (Math.floor(i / 2) % 2 - 0.5) * 0.4] as [number, number]);
    list.forEach((tok, i) => {
      const [dx, dy] = offs[i] ?? [0, 0];
      out.set(`${tok.c}:${tok.t}`, { x: tok.x + dx, y: tok.y + dy, scale: n === 1 ? 1 : n === 2 ? 0.8 : 0.7 });
    });
  }
  return out;
}

export function Board({ display, you, movable, onToken, reactions }: Props) {
  const room = display.room;
  const game = room?.game ?? null;
  const colors = game ? game.config.seats : room ? [0, 1, 2, 3].filter((c) => room.seats[c]!.kind !== "empty") : [];
  const places = layout(display.pos, colors);
  const turn = game && game.phase !== "over" ? game.turn : null;
  const moveColor = game?.moveColor ?? -1;

  const order: Array<{ c: number; t: number }> = [];
  for (const c of colors) for (let t = 0; t < 4; t++) order.push({ c, t });
  // The moving token is drawn last (on top).
  if (display.hop) {
    const i = order.findIndex((o) => o.c === display.hop!.c && o.t === display.hop!.t);
    if (i >= 0) order.push(...order.splice(i, 1));
  }

  return (
    <svg class="board" viewBox="-0.15 -0.15 15.3 15.3" role="img" aria-label="Ludo board">
      <defs>
        <clipPath id="board-clip">
          <rect x={0} y={0} width={15} height={15} rx={0.55} />
        </clipPath>
      </defs>
      <rect x={-0.15} y={-0.15} width={15.3} height={15.3} rx={0.7} class="board-bg" />
      <g clip-path="url(#board-clip)">
      {[0, 1, 2, 3].map((c) => (
        <Yard key={c} c={c} room={room} active={turn === c} timer={turn === c ? room?.timer ?? null : null} timerMs={room?.turnMs ?? 0} you={you} />
      ))}

      {TRACK_CELLS.map(([cx, cy], i) => {
        const startOf = [0, 1, 2, 3].find((c) => startSquare(c) === i);
        return <rect key={i} x={cx} y={cy} width={1} height={1} class={startOf !== undefined ? `cell start c${startOf}` : "cell"} />;
      })}
      {[0, 1, 2, 3].map((c) =>
        [0, 1, 2, 3, 4].map((s) => {
          const [cx, cy] = homeColumnCell(c, s);
          return <rect key={`h${c}${s}`} x={cx} y={cy} width={1} height={1} class={`cell lane c${c}`} />;
        }),
      )}
      {[...SAFE_SQUARES].map((i) => {
        const [cx, cy] = TRACK_CELLS[i]!;
        const isStart = [0, 13, 26, 39].includes(i);
        return <path key={`s${i}`} d={STAR} transform={`translate(${cx + 0.5} ${cy + 0.5})`} class={isStart ? "star on-start" : "star"} />;
      })}
      {/* Arrows into each start square */}
      {[0, 1, 2, 3].map((c) => {
        const [cx, cy] = TRACK_CELLS[(startSquare(c) + 51) % 52]!;
        const rot = [0, 90, 180, 270][c]!;
        return <path key={`a${c}`} d="M-0.22,-0.18 L0.18,0 L-0.22,0.18 Z" transform={`translate(${cx + 0.5} ${cy + 0.5}) rotate(${rot})`} class={`arrow c${c}`} />;
      })}

      <g class="center">
        <polygon points="6,6 6,9 7.5,7.5" class="tri c0" />
        <polygon points="6,6 9,6 7.5,7.5" class="tri c1" />
        <polygon points="9,6 9,9 7.5,7.5" class="tri c2" />
        <polygon points="6,9 9,9 7.5,7.5" class="tri c3" />
      </g>
      </g>

      {display.trail && (
        <g key={display.trail.id} class={`trail c${display.trail.c}`}>
          <polyline points={display.trail.points.map(([x, y]) => `${x},${y}`).join(" ")} />
          {display.trail.points.slice(0, -1).map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={0.1} />
          ))}
        </g>
      )}

      {order.map(({ c, t }) => {
        const place = places.get(`${c}:${t}`)!;
        const p = display.pos[c]![t]!;
        const isMovable = c === moveColor && movable.includes(t);
        const where = p === YARD ? "in the yard" : p >= HOME ? "home" : p > 50 ? `in the home column, ${HOME - p} from home` : `on the track, ${50 - p + 6} from home`;
        return (
          <Token
            key={`${c}:${t}`}
            c={c}
            t={t}
            x={place.x}
            y={place.y}
            scale={place.scale}
            movable={isMovable}
            hop={display.hop?.c === c && display.hop.t === t}
            flying={display.flying.includes(`${c}:${t}`)}
            label={`${COLORS[c]} token ${t + 1}, ${where}${isMovable ? ". Press to move" : ""}`}
            onClick={isMovable ? () => onToken(t) : undefined}
          />
        );
      })}

      {display.effects.map((f) => (
        <g key={f.id} class={`fx fx-${f.kind} c${f.c}`} transform={`translate(${f.x} ${f.y})`}>
          {f.kind === "six" ? (
            <circle r={2.2} />
          ) : (
            Array.from({ length: 10 }, (_, i) => {
              const a = (i / 10) * Math.PI * 2;
              return <circle key={i} r={0.13} style={{ "--dx": `${Math.cos(a) * 1.1}px`, "--dy": `${Math.sin(a) * 1.1}px` }} />;
            })
          )}
        </g>
      ))}

      {reactions.map((r) => {
        const [ox, oy] = YARD_ORIGIN[r.c]!;
        return (
          <text key={r.id} x={ox + 3} y={oy + 3.4} class="reaction">
            {REACTIONS[r.r]}
          </text>
        );
      })}
    </svg>
  );
}

/** Ticks once a second while a countdown runs (for text timers). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
