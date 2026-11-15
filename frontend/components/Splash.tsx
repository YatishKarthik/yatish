"use client";

import React, { useEffect, useState } from "react";

/*
 * The intro: the TerraMappers logo, then CELESTRA, then the selection screen (about 5 s).
 * Click, a key press or the Skip button ends it early; with reduced motion it is shortened.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<"logo" | "title" | "out">("logo");
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const k = reduce ? 0.4 : 1;
    const t1 = window.setTimeout(() => setStage("title"), 2300 * k);
    const t2 = window.setTimeout(() => setStage("out"), 4500 * k);
    const t3 = window.setTimeout(onDone, 5100 * k);
    const skip = () => onDone();
    window.addEventListener("keydown", skip);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.clearTimeout(t3); window.removeEventListener("keydown", skip); };
  }, [onDone]);
  return (
    <div className={`splash ${stage === "out" ? "splash-out" : ""}`} role="dialog" aria-label="Celestra by TerraMappers" onClick={onDone}>
      <div className={`splash-item ${stage === "logo" ? "splash-in" : "splash-gone"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/terramappers-logo.png" alt="TerraMappers" className="splash-logo" />
      </div>
      <div className={`splash-item ${stage === "title" ? "splash-in splash-title-in" : "splash-gone"}`}>
        <h1 className="splash-title">CELESTRA</h1>
        <p className="splash-sub">Earth test sites for the Moon and Mars</p>
      </div>
      <button type="button" className="splash-skip" onClick={(e) => { e.stopPropagation(); onDone(); }}>Skip intro</button>
    </div>
  );
}
