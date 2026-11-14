"use client";

import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";

export interface TourStep {
  target: string;           // value of data-tour="…" on the element to point at
  title: string;
  body: string;
  side?: "top" | "bottom" | "left" | "right";
}

interface Box { x: number; y: number; w: number; h: number }
const PAD = 8;

/*
 * A user-paced walkthrough. Each step finds its element, cuts a hole in a dim overlay around it,
 * scrolls it into view and places a card with an arrow pointing at it. Steps whose element is not
 * on the current screen are skipped, so one list can describe a whole page.
 */
export function Tour({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  return open ? <TourInner steps={steps} onClose={onClose} /> : null;
}

function TourInner({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const open = true;
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [pop, setPop] = useState<{ left: number; top: number; side: string; arrow: number } | null>(null);
  // which steps have something to point at on this screen, decided once when the tour opens
  const [present] = useState(() => steps.filter((s) => document.querySelector(`[data-tour="${s.target}"]`)));
  const step = present[i];

  const measure = useCallback(() => {
    if (!open || !step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const b = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
    setBox(b);
    const W = window.innerWidth, H = window.innerHeight, pw = Math.min(360, W - 24), ph = 190;
    let side = step.side ?? "bottom";
    if (side === "bottom" && b.y + b.h + ph + 16 > H) side = "top";
    if (side === "top" && b.y - ph - 16 < 0) side = b.x + b.w + pw + 16 < W ? "right" : "bottom";
    if (side === "right" && b.x + b.w + pw + 16 > W) side = "left";
    if (side === "left" && b.x - pw - 16 < 0) side = "bottom";
    let left = 0, top = 0, arrow = 0;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (side === "bottom" || side === "top") {
      left = Math.max(12, Math.min(W - pw - 12, cx - pw / 2));
      top = side === "bottom" ? b.y + b.h + 14 : b.y - 14 - ph;
      arrow = Math.max(18, Math.min(pw - 18, cx - left));
    } else {
      top = Math.max(12, Math.min(H - ph - 12, cy - ph / 2));
      left = side === "right" ? b.x + b.w + 14 : b.x - 14 - pw;
      arrow = Math.max(18, Math.min(ph - 18, cy - top));
    }
    setPop({ left, top, side, arrow });
  }, [open, step]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    el?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    const t1 = window.setTimeout(measure, 60), t2 = window.setTimeout(measure, 420);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, step, measure]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((v) => Math.min(present.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, present.length]);

  if (!open || !step || !box || !pop) return null;
  const last = i === present.length - 1;
  return (
    <>
      <div className="tour-hole" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      <div className="tour-pop rise" data-side={pop.side} style={{ left: pop.left, top: pop.top, ["--arrow" as string]: `${pop.arrow}px` }} role="dialog" aria-label={step.title}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] muted">Step {i + 1} of {present.length}</div>
            <h3 className="text-sm font-semibold mt-0.5">{step.title}</h3>
          </div>
          <button type="button" className="btn btn-sm btn-icon" aria-label="Close walkthrough" onClick={onClose}><X className="w-3.5 h-3.5" /></button>
        </div>
        <p className="text-[13px] mt-2 leading-relaxed">{step.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
          <div className="flex gap-1" aria-hidden>{present.map((_, k) => <span key={k} className="h-1 w-3 rounded-full" style={{ background: k <= i ? "var(--accent)" : "var(--line)" }} />)}</div>
          {last ? <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>Done</button> : <button type="button" className="btn btn-sm btn-primary" onClick={() => setI(i + 1)}>Next</button>}
        </div>
      </div>
    </>
  );
}

export function HelpButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="help-fab" title="Show me around this screen" aria-label="Show me around this screen" data-tour="help" onClick={onClick}>?</button>;
}
