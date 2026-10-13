// A WebSocket that reconnects with back-off and keeps itself alive with small pings.

export interface SocketHandlers {
  open(): void;
  message(data: unknown): void;
  /** Return false to stop reconnecting (the server said goodbye for good). */
  closed(code: number, reason: string): boolean;
  status(status: "connecting" | "open" | "waiting"): void;
}

const PING = '{"t":"ping"}';

export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onOnline = () => this.retryNow();

  constructor(
    private readonly url: () => string,
    private readonly handlers: SocketHandlers,
  ) {
    window.addEventListener("online", this.onOnline);
    this.connect();
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(message: unknown): boolean {
    if (!this.isOpen) return false;
    this.ws!.send(JSON.stringify(message));
    return true;
  }

  retryNow(): void {
    if (this.stopped || this.isOpen || this.ws?.readyState === WebSocket.CONNECTING) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("online", this.onOnline);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    try {
      this.ws?.close(1000, "Bye");
    } catch {
      // ignore
    }
    this.ws = null;
  }

  private connect(): void {
    if (this.stopped) return;
    this.handlers.status("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.handlers.status("open");
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(PING);
      }, 25_000);
      this.handlers.open();
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data.length > 256_000) return;
      let data: unknown;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (data && typeof data === "object" && (data as { t?: unknown }).t === "pong") return;
      this.handlers.message(data);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.stopped) return;
      if (this.handlers.closed(e.code, e.reason)) this.scheduleRetry();
      else this.stop();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.handlers.status("waiting");
    const delay = Math.min(20_000, 800 * 2 ** this.attempts) * (0.75 + Math.random() * 0.5);
    this.attempts = Math.min(this.attempts + 1, 8);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
}
