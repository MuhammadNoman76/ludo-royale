// Short sound effects (a few KB each), played through Web Audio. A soft synthesized blip stands in
// when a file can't be loaded. Nothing plays before the first click or key press (browser rule).
import { prefs } from "./prefs.js";

export type SoundName = "dice" | "move" | "capture" | "home" | "win" | "turn";

const VOLUME: Record<SoundName, number> = { dice: 0.7, move: 0.35, capture: 0.75, home: 0.7, win: 0.7, turn: 0.6 };

let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer | null>();
let unlocked = false;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

async function load(name: SoundName): Promise<void> {
  if (buffers.has(name)) return;
  buffers.set(name, null);
  const c = context();
  if (!c) return;
  try {
    const r = await fetch(`/sounds/${name}.mp3`);
    if (!r.ok) return;
    buffers.set(name, await c.decodeAudioData(await r.arrayBuffer()));
  } catch {
    // keep the synthesized fallback
  }
}

function unlock(): void {
  if (unlocked) return;
  unlocked = true;
  const c = context();
  void c?.resume();
  for (const n of Object.keys(VOLUME) as SoundName[]) void load(n);
}

window.addEventListener("pointerdown", unlock, { once: true, capture: true });
window.addEventListener("keydown", unlock, { once: true, capture: true });

function synth(c: AudioContext, name: SoundName, volume: number): void {
  const notes: Record<SoundName, number[]> = { dice: [320, 260], move: [520], capture: [220, 150], home: [660, 880], win: [523, 659, 784, 1046], turn: [740, 988] };
  const t0 = c.currentTime;
  notes[name].forEach((f, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = name === "capture" ? "sawtooth" : "sine";
    osc.frequency.value = f;
    const start = t0 + i * 0.09;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume * 0.25, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.18);
  });
}

export function play(name: SoundName): void {
  if (prefs.get().muted || !unlocked || document.hidden) return;
  const c = context();
  if (!c || c.state !== "running") return;
  const buffer = buffers.get(name);
  const volume = VOLUME[name];
  if (!buffer) {
    synth(c, name, volume);
    return;
  }
  const source = c.createBufferSource();
  source.buffer = buffer;
  const gain = c.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(c.destination);
  source.start();
}
