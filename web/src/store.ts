// A tiny observable value with a Preact hook (no state library needed).
import { useEffect, useReducer } from "preact/hooks";

export class Store<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(value: T): void {
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const l of [...this.listeners]) l();
  }

  update(fn: (value: T) => T): void {
    this.set(fn(this.value));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useStore<T>(store: Store<T>): T {
  const [, force] = useReducer((n: number, _action: void) => n + 1, 0);
  useEffect(() => store.subscribe(() => force()), [store]);
  return store.get();
}

/** localStorage that never throws (private windows, blocked storage). */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage unavailable: settings last for this visit only
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
  json<T>(key: string, fallback: T): T {
    const raw = storage.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
};
