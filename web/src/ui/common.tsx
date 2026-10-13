// Small shared UI pieces.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { COLORS } from "../../../shared/src/board.js";
import { toast } from "../notify.js";
import { Icon } from "./Icons.js";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers: a temporary text field.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, label = "Copy", compact = false }: { text: string; label?: string; compact?: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      class={`btn ${compact ? "icon-btn" : "secondary"}`}
      onClick={async () => {
        if (await copyText(text)) setDone(true);
        else toast("Couldn't copy. Select the text and copy it yourself.", { tone: "warn" });
      }}
      aria-label={compact ? label : undefined}
      title={label}
    >
      <Icon name={done ? "check" : "copy"} size={18} />
      {!compact && <span>{done ? "Copied" : label}</span>}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          class={o.value === value ? "on" : ""}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label class={`toggle-row${disabled ? " disabled" : ""}`}>
      <span class="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span class="switch" aria-hidden="true" />
    </label>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button, input")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div class="drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="drawer" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <header class="drawer-head">
          <h2>{title}</h2>
          <button type="button" class="btn icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div class="drawer-body">{children}</div>
      </div>
    </div>
  );
}

export function Avatar({ name, color, size = 32 }: { name: string; color: number; size?: number }) {
  const initial = [...(name.trim() || "?")][0]!.toUpperCase();
  return (
    <span class={`avatar c${color}`} style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.46)}px` }} aria-hidden="true">
      {initial}
    </span>
  );
}

export function colorName(c: number): string {
  const n = COLORS[c] ?? "";
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function Spinner({ label }: { label: string }) {
  return (
    <div class="spinner-wrap" role="status">
      <span class="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
