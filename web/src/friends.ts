// The friends service: one connection per player to their PlayerDO for presence, friend requests,
// invites and "your turn" pings.
import type { FriendView, PlayerServerMessage } from "../../shared/src/protocol.js";
import { wsOrigin } from "./config.js";
import { host, isApp, postToHost } from "./host.js";
import { type Identity, ensureIdentity, storedIdentity } from "./identity.js";
import { ReconnectingSocket } from "./net.js";
import { systemAlert, toast } from "./notify.js";
import { prefs } from "./prefs.js";
import { navigate, route } from "./router.js";
import { Store, storage } from "./store.js";

export interface FriendsState {
  status: "off" | "connecting" | "online" | "offline";
  code: string | null;
  name: string;
  friends: FriendView[];
  incoming: { code: string; name: string }[];
  outgoing: string[];
  blocked: string[];
}

export const friends = new Store<FriendsState>({
  status: "off",
  code: storedIdentity()?.code ?? null,
  name: "",
  friends: [],
  incoming: [],
  outgoing: [],
  blocked: [],
});

let socket: ReconnectingSocket | null = null;
let identity: Identity | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let resets = 0;

function patch(p: Partial<FriendsState>): void {
  friends.set({ ...friends.get(), ...p });
}

function nickname(): string {
  return prefs.get().name || "Player";
}

/** Connects (creating a friend code on first use). Safe to call again. */
export async function startFriends(): Promise<void> {
  if (socket || retryTimer) return;
  patch({ status: "connecting" });
  identity = await ensureIdentity();
  if (!identity) {
    patch({ status: "offline" });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void startFriends();
    }, 30_000);
    return;
  }
  const id = identity;
  patch({ code: id.code });
  socket = new ReconnectingSocket(() => `${wsOrigin()}/ws/player/${id.code}`, {
    open: () => socket?.send({ t: "auth", token: id.token, name: nickname() }),
    message: (m) => onMessage(m as PlayerServerMessage),
    closed: (code) => {
      if (code === 4401 || code === 4404) {
        // The server doesn't know this identity (for example a different server): start afresh once.
        void resetIdentity();
        return false;
      }
      patch({ status: "connecting" });
      return true;
    },
    status: (s) => {
      if (s !== "open") patch({ status: s === "waiting" ? "offline" : "connecting" });
    },
  });
}

async function resetIdentity(): Promise<void> {
  socket?.stop();
  socket = null;
  if (resets++ > 1) {
    patch({ status: "offline" });
    return;
  }
  if (isApp) {
    postToHost({ type: "identity-reset" });
    host.set({ ...host.get(), identity: null });
  } else {
    storage.remove("ludo.identity");
  }
  patch({ code: null, friends: [], incoming: [], outgoing: [] });
  await startFriends();
}

export function friendsOnline(): boolean {
  return friends.get().status === "online";
}

function send(message: Record<string, unknown>): boolean {
  if (!socket?.send(message)) {
    toast("You're offline", { body: "Friends will be back when the connection is.", tone: "warn" });
    return false;
  }
  return true;
}

function onMessage(m: PlayerServerMessage): void {
  const s = friends.get();
  switch (m.t) {
    case "me":
      patch({ status: "online", code: m.code, name: m.name, friends: m.friends, incoming: m.incoming, outgoing: m.outgoing, blocked: m.blocked });
      return;
    case "presence":
      patch({ friends: s.friends.map((f) => (f.code === m.code ? { ...f, online: m.online } : f)) });
      return;
    case "request":
      if (!s.incoming.some((r) => r.code === m.code)) patch({ incoming: [...s.incoming, { code: m.code, name: m.name }] });
      toast(`${m.name} wants to be friends`, { action: { label: "Accept", run: () => acceptFriend(m.code) } });
      systemAlert({ kind: "friend", title: "Friend request", body: `${m.name} wants to be your friend in Ludo Royale.`, friend: m.code });
      return;
    case "friend":
      patch({
        friends: [...s.friends.filter((f) => f.code !== m.friend.code), m.friend],
        incoming: s.incoming.filter((r) => r.code !== m.friend.code),
        outgoing: s.outgoing.filter((c) => c !== m.friend.code),
      });
      return;
    case "unfriend":
      patch({
        friends: s.friends.filter((f) => f.code !== m.code),
        incoming: s.incoming.filter((r) => r.code !== m.code),
        outgoing: s.outgoing.filter((c) => c !== m.code),
      });
      return;
    case "invite": {
      const join = () => navigate({ name: "room", code: m.room });
      toast(`${m.name} invited you to play`, { body: `Room ${m.room}`, action: { label: "Join", run: join }, ms: 15_000 });
      systemAlert({ kind: "invite", title: `${m.name} invited you to play`, body: `Room ${m.room}. Click to join.`, room: m.room }, join);
      return;
    }
    case "turn": {
      const r = route.get();
      if (r.name === "room" && r.code === m.room) return; // the room itself tells us
      const open = () => navigate({ name: "room", code: m.room });
      toast("It's your turn", { body: `Room ${m.room}`, action: { label: "Open", run: open } });
      systemAlert({ kind: "turn", title: "It's your turn!", body: `Your move in room ${m.room}.`, room: m.room }, open);
      return;
    }
    case "info":
      toast(m.message, { tone: "good" });
      return;
    case "error":
      toast(m.message, { tone: "warn" });
      return;
  }
}

prefs.subscribe(() => {
  const name = nickname();
  if (friends.get().status === "online" && name !== friends.get().name) socket?.send({ t: "name", name });
});

export const addFriend = (code: string) => send({ t: "add", code });
export const acceptFriend = (code: string) => send({ t: "accept", code });
export const declineFriend = (code: string) => send({ t: "decline", code });
export const removeFriend = (code: string) => send({ t: "remove", code });
export const blockPlayer = (code: string) => send({ t: "block", code });
export const unblockPlayer = (code: string) => send({ t: "unblock", code });
export const inviteFriend = (code: string, room: string) => send({ t: "invite", code, room });
export function watchRoom(room: string): void {
  socket?.send({ t: "watch", room });
}
