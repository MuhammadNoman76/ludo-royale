// Friends: your friend code (copy, QR, share), add by code, requests, the list with online dots,
// invites to the room you're in, remove and block.
import { useState } from "preact/hooks";
import { normalizeFriendCode } from "../../../shared/src/protocol.js";
import { friendLink } from "../config.js";
import { acceptFriend, addFriend, blockPlayer, declineFriend, friends, inviteFriend, removeFriend, unblockPlayer } from "../friends.js";
import { openExternal } from "../host.js";
import { route } from "../router.js";
import { useStore } from "../store.js";
import { Avatar, CopyButton, Drawer, Spinner } from "./common.js";
import { Icon, WhatsAppMark } from "./Icons.js";
import { Qr } from "./Qr.js";
import { whatsappUrl } from "./Share.js";

export function FriendsPanel({ onClose }: { onClose: () => void }) {
  const f = useStore(friends);
  const r = useStore(route);
  const [code, setCode] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const room = r.name === "room" ? r.code : null;
  const normalized = normalizeFriendCode(code);

  return (
    <Drawer title="Friends" onClose={onClose}>
      {f.status === "connecting" && !f.code && <Spinner label="Getting your friend code…" />}
      {f.status === "offline" && <div class="notice warn">Offline. Friends come back when the connection does.</div>}

      {f.code && (
        <section class="card my-code">
          <div class="eyebrow">Your friend code</div>
          <div class="friend-code mono">{f.code}</div>
          <div class="row wrap">
            <CopyButton text={f.code} label="Copy code" />
            <button type="button" class="btn secondary" aria-pressed={showQr} onClick={() => setShowQr(!showQr)}>
              <Icon name="qr" size={18} />
              <span>QR</span>
            </button>
            <button type="button" class="btn whatsapp" onClick={() => openExternal(whatsappUrl(`Add me as a friend on Ludo Royale: ${friendLink(f.code!)} (code ${f.code})`))}>
              <WhatsAppMark size={18} />
              <span>Send</span>
            </button>
          </div>
          {showQr && (
            <div class="center qr-box">
              <Qr text={friendLink(f.code)} size={156} />
              <small class="muted">Scan to add me</small>
            </div>
          )}
        </section>
      )}

      <form
        class="card add-friend"
        onSubmit={(e) => {
          e.preventDefault();
          if (normalized && addFriend(normalized)) setCode("");
        }}
      >
        <label for="friend-code" class="eyebrow">
          Add a friend
        </label>
        <div class="join-row">
          <input
            id="friend-code"
            class="input mono"
            placeholder="LUDO-XXXX-XXXX"
            value={code}
            maxLength={20}
            autoComplete="off"
            spellcheck={false}
            onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
          />
          <button type="submit" class="btn" disabled={!normalized || f.status !== "online"}>
            Add
          </button>
        </div>
        <small class="muted">They'll get a request; you become friends when they accept.</small>
      </form>

      {f.incoming.length > 0 && (
        <section class="card">
          <div class="eyebrow">Friend requests</div>
          {f.incoming.map((x) => (
            <div class="friend-row" key={x.code}>
              <Avatar name={x.name} color={0} size={30} />
              <div class="grow">
                <strong>{x.name}</strong>
                <div class="small muted mono">{x.code}</div>
              </div>
              <button type="button" class="btn small primary" onClick={() => acceptFriend(x.code)}>
                Accept
              </button>
              <button type="button" class="btn small secondary" onClick={() => declineFriend(x.code)} aria-label={`Decline ${x.name}`}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        </section>
      )}

      <section class="card">
        <div class="eyebrow">Friends{f.friends.length > 0 ? ` · ${f.friends.filter((x) => x.online).length} online` : ""}</div>
        {f.friends.length === 0 && <p class="muted small">No friends yet. Share your code, or add someone you played with from the lobby.</p>}
        {[...f.friends]
          .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
          .map((x) => (
            <div class="friend-row" key={x.code}>
              <span class={`dot${x.online ? " online" : ""}`} title={x.online ? "Online" : "Offline"} aria-label={x.online ? "Online" : "Offline"} />
              <div class="grow">
                <strong>{x.name}</strong>
                <div class="small muted">{x.online ? "Online" : "Offline"}</div>
              </div>
              {room && x.online && (
                <button type="button" class="btn small" onClick={() => inviteFriend(x.code, room)}>
                  Invite
                </button>
              )}
              <div class="menu-wrap">
                <button type="button" class="btn icon-btn" aria-label={`More for ${x.name}`} aria-expanded={menu === x.code} onClick={() => setMenu(menu === x.code ? null : x.code)}>
                  <Icon name="settings" size={16} />
                </button>
                {menu === x.code && (
                  <div class="menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => (removeFriend(x.code), setMenu(null))}>
                      <Icon name="trash" size={16} />
                      <span>Remove friend</span>
                    </button>
                    <button type="button" role="menuitem" class="danger" onClick={() => (blockPlayer(x.code), setMenu(null))}>
                      <Icon name="block" size={16} />
                      <span>Block</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        {f.outgoing.length > 0 && <p class="small muted">Waiting for {f.outgoing.length === 1 ? "1 player" : `${f.outgoing.length} players`} to accept.</p>}
      </section>

      {f.blocked.length > 0 && (
        <section class="card">
          <button type="button" class="btn link" onClick={() => setShowBlocked(!showBlocked)} aria-expanded={showBlocked}>
            Blocked players ({f.blocked.length})
          </button>
          {showBlocked &&
            f.blocked.map((c) => (
              <div class="friend-row" key={c}>
                <span class="grow mono small">{c}</span>
                <button type="button" class="btn small secondary" onClick={() => unblockPlayer(c)}>
                  Unblock
                </button>
              </div>
            ))}
        </section>
      )}
    </Drawer>
  );
}
