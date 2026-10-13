// Sharing a room: the link, Copy, WhatsApp, a QR code, and invites to online friends.
import { useState } from "preact/hooks";
import { roomLink } from "../config.js";
import { friends, inviteFriend } from "../friends.js";
import { isApp, openExternal } from "../host.js";
import { useStore } from "../store.js";
import { CopyButton } from "./common.js";
import { Icon, WhatsAppMark } from "./Icons.js";
import { Qr } from "./Qr.js";

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function ShareRoom({ code, compact = false }: { code: string; compact?: boolean }) {
  const link = roomLink(code);
  const [showQr, setShowQr] = useState(!compact);
  const message = `Join my Ludo Royale game! Room ${code}: ${link}`;
  const canNativeShare = !isApp && typeof navigator.share === "function";
  return (
    <section class="share card" aria-label="Invite people">
      <div class="share-head">
        <div>
          <div class="eyebrow">Room code</div>
          <div class="room-code" aria-label={`Room code ${code.split("").join(" ")}`}>
            {code}
          </div>
        </div>
        {showQr && <Qr text={link} size={compact ? 120 : 148} />}
      </div>
      <div class="link-row">
        <input class="input mono" value={link} readOnly aria-label="Room link" onFocus={(e) => (e.target as HTMLInputElement).select()} />
        <CopyButton text={link} label="Copy link" />
      </div>
      <div class="share-actions">
        <button type="button" class="btn whatsapp" onClick={() => openExternal(whatsappUrl(message))}>
          <WhatsAppMark size={18} />
          <span>WhatsApp</span>
        </button>
        <button type="button" class="btn secondary" aria-pressed={showQr} onClick={() => setShowQr(!showQr)}>
          <Icon name="qr" size={18} />
          <span>{showQr ? "Hide QR" : "QR code"}</span>
        </button>
        {canNativeShare && (
          <button type="button" class="btn secondary" onClick={() => void navigator.share({ title: "Ludo Royale", text: message, url: link }).catch(() => undefined)}>
            <Icon name="share" size={18} />
            <span>Share</span>
          </button>
        )}
      </div>
      <InviteFriends code={code} />
    </section>
  );
}

function InviteFriends({ code }: { code: string }) {
  const f = useStore(friends);
  const [sent, setSent] = useState<string[]>([]);
  if (f.status !== "online" || f.friends.length === 0) return null;
  const online = f.friends.filter((x) => x.online);
  return (
    <div class="invite-list">
      <div class="eyebrow">Invite friends</div>
      {online.length === 0 && <p class="muted small">None of your friends is online right now.</p>}
      {online.map((x) => (
        <div class="invite-row" key={x.code}>
          <span class="dot online" aria-hidden="true" />
          <span class="grow">{x.name}</span>
          <button
            type="button"
            class="btn small"
            disabled={sent.includes(x.code)}
            onClick={() => {
              if (inviteFriend(x.code, code)) setSent([...sent, x.code]);
            }}
          >
            {sent.includes(x.code) ? "Invited" : "Invite"}
          </button>
        </div>
      ))}
    </div>
  );
}

/** Browser players on Windows who have the app can open the room there (ludoroyale:// link). */
export function OpenInApp({ code }: { code: string }) {
  if (isApp || !/Windows/.test(navigator.userAgent)) return null;
  return (
    <p class="small muted center open-in-app">
      Have Ludo Royale for Windows? <a href={`ludoroyale://join/${code}`}>Open this room in the app</a>
    </p>
  );
}
