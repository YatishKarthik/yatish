"use client";

import React, { useSyncExternalStore, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

/* ---------- theme ---------- */
export type Theme = "dark" | "light";
const KEY = "tt-theme";

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch { /* private mode */ }
  return "dark";
}
const listeners = new Set<() => void>();
export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getTheme = (): Theme => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");

export function ThemeToggle() {
  // the <html> attribute is the source of truth; layout.tsx sets it before first paint
  const theme = useSyncExternalStore(subscribe, getTheme, () => "dark" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="btn btn-icon" title={`Switch to ${next} mode`} aria-label={`Switch to ${next} mode`} data-tour="theme" onClick={() => applyTheme(next)}>
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

/* ---------- small building blocks ---------- */
export function Tabs<T extends string>({ value, onChange, items, tour }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; hint: string }[]; tour?: string }) {
  return (
    <div className="tabs" role="tablist" data-tour={tour}>
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" className="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}>
          {it.label}<small>{it.hint}</small>
        </button>
      ))}
    </div>
  );
}

export function Status({ level, children }: { level: "good" | "warn" | "bad"; children: ReactNode }) {
  return <span className={`status status-${level}`}>{children}</span>;
}

export function Bar({ value, colour }: { value: number; colour?: string }) {
  return <div className="bar"><span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, background: colour }} /></div>;
}

export function Kpi({ label, value, sub, tour }: { label: string; value: ReactNode; sub?: ReactNode; tour?: string }) {
  return (
    <div className="card-solid p-3" data-tour={tour}>
      <div className="text-[11px] muted">{label}</div>
      <div className="text-xl font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-[11px] faint mt-0.5">{sub}</div>}
    </div>
  );
}

/* plain words for a 0..1 similarity */
export function similarityWord(v: number): { word: string; level: "good" | "warn" | "bad" } {
  if (v >= 0.8) return { word: "very similar", level: "good" };
  if (v >= 0.6) return { word: "fairly similar", level: "good" };
  if (v >= 0.4) return { word: "somewhat different", level: "warn" };
  return { word: "quite different", level: "bad" };
}

export const PCT = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
