// Victory confetti on a canvas (stops by itself after a few seconds).
import { useEffect, useRef } from "preact/hooks";

const COLORS = ["#e5484d", "#30a46c", "#f5b300", "#3e8ef7", "#ffffff", "#ff8fd8"];

export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const w = () => canvas.width;
    const h = () => canvas.height;
    const pieces = Array.from({ length: 160 }, () => ({
      x: Math.random() * w(),
      y: -Math.random() * h() * 0.6,
      vx: (Math.random() - 0.5) * 2.2 * dpr,
      vy: (1.6 + Math.random() * 2.8) * dpr,
      size: (5 + Math.random() * 6) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.25,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    }));
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = now - started;
      ctx.clearRect(0, 0, w(), h());
      for (const p of pieces) {
        p.x += p.vx + Math.sin((now / 400) + p.size) * 0.6 * dpr;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y > h() + 20 && t < 3500) {
          p.y = -20;
          p.x = Math.random() * w();
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = t > 5000 ? Math.max(0, 1 - (t - 5000) / 1500) : 1;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (t < 6500) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w(), h());
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} class="confetti" aria-hidden="true" />;
}
