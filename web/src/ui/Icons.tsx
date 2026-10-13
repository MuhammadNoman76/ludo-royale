// A small set of line icons (24 x 24, drawn for this game).
import type { JSX } from "preact";

const paths: Record<string, string> = {
  copy: "M9 9h10v10H9z M5 15V5h10",
  check: "M5 12.5l4.5 4.5L19 7.5",
  share: "M12 3v12 M7.5 7.5L12 3l4.5 4.5 M5 13v6h14v-6",
  qr: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 14h2 M14 18h2 M18 18h2v2h-2z M7 7h0.01 M17 7h0.01 M7 17h0.01",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.4c2 .8 3.5 2.8 3.5 5.6",
  userPlus: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6 M19 8v6 M16 11h6",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.6 10.3l2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 4h4l.3 2.1a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.3z",
  volume: "M4 9.5h3.5L12 5.5v13l-4.5-4H4z M15.5 9a4 4 0 0 1 0 6 M18 6.5a7.5 7.5 0 0 1 0 11",
  mute: "M4 9.5h3.5L12 5.5v13l-4.5-4H4z M16 9.5l5 5 M21 9.5l-5 5",
  x: "M6 6l12 12 M18 6L6 18",
  dockLeft: "M4 5h16v14H4z M10 5v14 M6.5 9h1 M6.5 12h1",
  dockRight: "M4 5h16v14H4z M14 5v14 M16.5 9h1 M16.5 12h1",
  window: "M4 5h16v14H4z M4 9h16",
  pin: "M9 4h6 M10 4v6l-3 3h10l-3-3V4 M12 13v7",
  pinOff: "M9 4h6 M10 4v6l-3 3h10l-3-3V4 M12 13v7 M4 4l16 16",
  collapse: "M15 6l-6 6 6 6",
  expand: "M9 6l6 6-6 6",
  crown: "M4 18h16 M5 15l-1-8 5 4 3-6 3 6 5-4-1 8z",
  bot: "M7 9h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z M12 5v4 M9.5 13.5h0.01 M14.5 13.5h0.01 M10 16.5h4",
  leave: "M14 4h5v16h-5 M10 8l-4 4 4 4 M6 12h10",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z M10 20a2 2 0 0 0 4 0",
  link: "M10 14a4.5 4.5 0 0 0 6.4 0l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4l-1 1 M14 10a4.5 4.5 0 0 0-6.4 0l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1-1",
  play: "M8 5.5v13l10-6.5z",
  dice: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8.5 8.5h0.01 M15.5 8.5h0.01 M12 12h0.01 M8.5 15.5h0.01 M15.5 15.5h0.01",
  trash: "M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13",
  block: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M5.6 5.6l12.8 12.8",
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8.5 14a4.5 4.5 0 0 0 7 0 M9 9.5h0.01 M15 9.5h0.01",
  home: "M4 11l8-7 8 7 M6 9.5V20h12V9.5",
  download: "M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 19h14",
  refresh: "M19 8a7.5 7.5 0 1 0 .5 6 M19.5 3.5V8H15",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z",
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & JSX.SVGAttributes<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={1.8} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}

/** WhatsApp's speech-bubble mark (simplified) for the share button. */
export function WhatsAppMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2.2a9.7 9.7 0 0 0-8.3 14.7L2.3 21.8l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3 1 2.5c.1.2 1.7 2.6 4.1 3.6 1.5.7 2.1.7 2.9.6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.4-.4z" />
    </svg>
  );
}
