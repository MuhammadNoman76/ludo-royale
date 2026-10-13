// The die: pips on a rounded square, a tumble while rolling, tinted with the current player's colour.
import { useEffect, useState } from "preact/hooks";

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

interface Props {
  value: number;
  rolling: boolean;
  color: number;
  canRoll: boolean;
  onRoll: () => void;
  label: string;
}

export function Dice({ value, rolling, color, canRoll, onRoll, label }: Props) {
  const [face, setFace] = useState(value || 6);
  useEffect(() => {
    if (!rolling) {
      setFace(value || 0);
      return;
    }
    const id = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 80);
    return () => clearInterval(id);
  }, [rolling, value]);

  return (
    <button
      type="button"
      class={`dice c${color}${rolling ? " rolling" : ""}${canRoll ? " ready" : ""}`}
      disabled={!canRoll}
      onClick={onRoll}
      aria-label={label}
      title={canRoll ? "Roll (Space)" : label}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <rect x={6} y={6} width={88} height={88} rx={20} class="dice-face" />
        {face > 0 ? (
          PIPS[face]!.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={9} class="pip" />)
        ) : canRoll ? (
          <text x={50} y={60} class="dice-roll">
            ROLL
          </text>
        ) : null}
      </svg>
    </button>
  );
}
