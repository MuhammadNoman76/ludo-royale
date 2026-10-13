// QR code drawn as one SVG path (encoder: uqr, MIT).
import { encode } from "uqr";

export function Qr({ text, size = 168 }: { text: string; size?: number }) {
  const qr = encode(text, { ecc: "M", border: 2 });
  let d = "";
  qr.data.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return (
    <svg class="qr" width={size} height={size} viewBox={`0 0 ${qr.size} ${qr.size}`} shape-rendering="crispEdges" role="img" aria-label={`QR code for ${text}`}>
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={d} fill="#111" />
    </svg>
  );
}
