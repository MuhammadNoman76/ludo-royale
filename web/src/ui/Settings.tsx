// Settings: nickname, theme, sound, notifications, and (in the Windows app) start-up, tray and updates.
import { useState } from "preact/hooks";
import { host, isApp, postToHost } from "../host.js";
import { browserNotificationsSupported, enableBrowserNotifications, toast } from "../notify.js";
import { prefs, setPref } from "../prefs.js";
import { useStore } from "../store.js";
import { Drawer, Segmented, Toggle } from "./common.js";
import { NameField } from "./Home.js";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const p = useStore(prefs);
  const h = useStore(host);
  const s = h.settings;
  const [checking, setChecking] = useState(false);
  const setApp = (patch: Record<string, unknown>) => postToHost({ type: "settings", ...patch });

  return (
    <Drawer title="Settings" onClose={onClose}>
      <section class="card">
        <NameField />
      </section>

      <section class="card">
        <div class="option-row">
          <span>Theme</span>
          <Segmented
            label="Theme"
            value={p.theme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(v) => setPref("theme", v)}
          />
        </div>
        <Toggle label="Sound effects" checked={!p.muted} onChange={(v) => setPref("muted", !v)} />
        {isApp ? (
          <Toggle label="Do not disturb" hint="No Windows notifications for invites and turns." checked={s.dnd} onChange={(v) => setApp({ dnd: v })} />
        ) : browserNotificationsSupported() ? (
          <Toggle
            label="Notifications"
            hint="Invites and your turn while this tab is in the background."
            checked={p.notifications}
            onChange={async (v) => {
              if (!v) return setPref("notifications", false);
              const ok = await enableBrowserNotifications();
              setPref("notifications", ok);
              if (!ok) toast("Notifications are blocked for this site in your browser settings.", { tone: "warn" });
            }}
          />
        ) : null}
      </section>

      {isApp && (
        <section class="card">
          <div class="eyebrow">Windows</div>
          <Toggle label="Start with Windows" hint="Opens quietly in the tray when you sign in." checked={s.startWithWindows} onChange={(v) => setApp({ startWithWindows: v })} />
          <div class="option-col">
            <span>When I close the window</span>
            <Segmented
              label="When I close the window"
              value={s.closeAction}
              options={[
                { value: "ask", label: "Ask" },
                { value: "tray", label: "Keep in tray" },
                { value: "quit", label: "Quit" },
              ]}
              onChange={(v) => setApp({ closeAction: v })}
            />
          </div>
          <Toggle label="Open game links in this app" hint="ludoroyale:// links from the website." checked={s.protocol} onChange={(v) => setApp({ protocol: v })} />
          <Toggle label="Check for updates automatically" checked={s.checkUpdates} onChange={(v) => setApp({ checkUpdates: v })} />
          <div class="row">
            <button
              type="button"
              class="btn secondary"
              disabled={checking}
              onClick={() => {
                setChecking(true);
                postToHost({ type: "check-updates" });
                setTimeout(() => setChecking(false), 4000);
              }}
            >
              {checking ? "Checking…" : "Check for updates"}
            </button>
            <span class="muted small">Version {h.version}</span>
          </div>
        </section>
      )}

      <section class="card subtle">
        <div class="eyebrow">Privacy</div>
        <p class="small muted">
          No account and no email. The server keeps only your nickname, your random friend code and your friends list (forgotten after a year without use). Rooms are deleted
          two hours after the last move. There's no chat, only a few fixed emoji reactions.
        </p>
      </section>
    </Drawer>
  );
}
