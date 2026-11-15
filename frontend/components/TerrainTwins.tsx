"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";


export interface Dem {
  resolution: number; extent_m: number; relief_m: number; data: number[];
  data_provenance?: { topography?: { instrument?: string; status?: string; agency?: string } };
}
type Kind = "moon" | "mars" | "earth";
export interface TwinSide { url: string; name: string; kind: Kind }

// low and high ends of a height ramp; hillshade multiplies on top
const RAMP: Record<Kind, [number[], number[]]> = {
  moon: [[62, 63, 66], [208, 207, 202]],
  mars: [[104, 44, 22], [226, 146, 96]],
  earth: [[92, 102, 68], [210, 190, 150]],
};
const KIND_WORD: Record<Kind, string> = { moon: "Moon", mars: "Mars", earth: "Earth" };
const BINS = 8, BIN_DEG = 5;   // 0–40° in 5° steps, the last bin holds everything steeper
const SUN_AZ = (315 * Math.PI) / 180, SUN_ALT = (45 * Math.PI) / 180;

const cache = new Map<string, Promise<Dem>>();
function loadDem(url: string): Promise<Dem> {
  if (!cache.has(url)) {
    const p = fetch(apiUrl(url)).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Dem>; });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url)!;
}

/* Gradients by central differences on the true-scale grid (heights × relief, cells of extent/resolution metres). */
function analyse(d: Dem) {
  const n = d.resolution, cell = d.extent_m / n, z = (r: number, c: number) => d.data[Math.min(n - 1, Math.max(0, r)) * n + Math.min(n - 1, Math.max(0, c))] * d.relief_m;
  const shade = new Float32Array(n * n), hist = new Array(BINS).fill(0);
  let sum = 0;
  const lx = Math.cos(SUN_ALT) * Math.sin(SUN_AZ), ly = Math.cos(SUN_ALT) * Math.cos(SUN_AZ), lz = Math.sin(SUN_ALT);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const dx = (z(r, c + 1) - z(r, c - 1)) / ((Math.min(n - 1, c + 1) - Math.max(0, c - 1)) * cell);     // rise to the east
    const dy = (z(r + 1, c) - z(r - 1, c)) / ((Math.min(n - 1, r + 1) - Math.max(0, r - 1)) * cell);     // rise to the south (row 0 is north)
    const len = Math.hypot(dx, dy, 1);
    shade[r * n + c] = Math.max(0, (-dx * lx + dy * ly + lz) / len);
    const deg = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
    sum += deg;
    hist[Math.min(BINS - 1, Math.floor(deg / BIN_DEG))]++;
  }
  return { shade, hist: hist.map((h) => h / (n * n)), meanSlope: sum / (n * n) };
}

function Hillshade({ dem, shade, kind, label }: { dem: Dem; shade: Float32Array; kind: Kind; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const n = dem.resolution, img = ctx.createImageData(n, n), [lo, hi] = RAMP[kind], flat = Math.sin(SUN_ALT);
    for (let i = 0; i < n * n; i++) {
      // height sets a gentle tint; the hillshade carries the shape
      const h = 0.3 + 0.45 * Math.max(0, Math.min(1, dem.data[i])), k = Math.min(1.45, 0.12 + Math.pow(shade[i] / flat, 1.3));
      for (let ch = 0; ch < 3; ch++) img.data[i * 4 + ch] = Math.max(0, Math.min(255, (lo[ch] + (hi[ch] - lo[ch]) * h) * k));
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [dem, shade, kind]);
  return (
    <div className="relative rounded-xl overflow-hidden aspect-square" style={{ background: "#111" }}>
      <canvas ref={ref} width={dem.resolution} height={dem.resolution} className="w-full h-full block" role="img" aria-label={label} />
      <span className="absolute top-2 right-2 text-[10px] font-semibold text-white/90 px-1.5 rounded bg-black/40">N ↑</span>
      {/* 500 m of a 2 km tile is a quarter of the width */}
      <div className="absolute left-2 bottom-2 text-[10px] text-white/90 px-1.5 py-1 rounded bg-black/45" style={{ width: `calc(${(500 / dem.extent_m) * 100}% + 12px)` }}>
        <div className="h-1 bg-white/90" />
        <div className="mt-0.5">500 m</div>
      </div>
    </div>
  );
}

export default function TerrainTwins({ left, right }: { left: TwinSide; right: TwinSide }) {
  const [dems, setDems] = useState<Record<string, Dem | "error">>({});
  const lu = left.url, ru = right.url;
  useEffect(() => {
    let live = true;
    for (const url of [lu, ru]) {
      loadDem(url).then((d) => { if (live) setDems((m) => ({ ...m, [url]: d })); }).catch(() => { if (live) setDems((m) => ({ ...m, [url]: "error" })); });
    }
    return () => { live = false; };
  }, [lu, ru]);

  const sides = [left, right];
  const a = dems[left.url], b = dems[right.url];
  const stats = useMemo(() => [a, b].map((d) => (d && d !== "error" ? analyse(d) : null)), [a, b]);
  const histMax = Math.max(0.01, ...stats.flatMap((s) => (s ? s.hist : [])));

  return (
    <div className="flex flex-col gap-3 rise" data-tour="twins">
      <p className="text-xs muted">The two places side by side at the same scale: a 2 × 2 km patch of each, shaded as if lit from the north-west. Same size on screen means same size on the ground. Heights are true to scale, so gentle ground looks gentle.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sides.map((s, i) => {
          const d = dems[s.url], st = stats[i];
          const topo = d && d !== "error" ? d.data_provenance?.topography : undefined;
          return (
            <figure key={s.url + i} className="card-solid p-3 flex flex-col gap-2 min-w-0">
              <figcaption className="min-w-0">
                <div className="text-[11px] muted">{KIND_WORD[s.kind]}</div>
                <div className="text-sm font-semibold truncate" title={s.name}>{s.name}</div>
              </figcaption>
              {d === "error" ? (
                <div className="aspect-square rounded-xl border border-dashed line flex items-center justify-center text-xs muted p-4 text-center">No elevation grid could be loaded for this site.</div>
              ) : !d || !st ? (
                <div className="aspect-square rounded-xl animate-pulse" style={{ background: "var(--line)" }} />
              ) : (
                <>
                  <Hillshade dem={d} shade={st.shade} kind={s.kind} label={`Shaded relief of ${s.name}`} />
                  <div className="flex flex-wrap justify-between gap-x-3 text-xs">
                    <span>Relief <b className="font-mono">{Math.round(d.relief_m).toLocaleString("en-US")} m</b></span>
                    <span>Mean slope <b className="font-mono">{st.meanSlope.toFixed(1)}°</b></span>
                  </div>
                  <div>
                    <div className="text-[11px] muted mb-1" title="Ground steeper than 40° is counted in the last bar">Share of ground by slope</div>
                    <div className="flex items-end gap-1 h-14" role="img" aria-label={`Slope histogram: ${st.hist.map((h, k) => `${k * BIN_DEG}° ${Math.round(h * 100)}%`).join(", ")}`}>
                      {st.hist.map((h, k) => (
                        <div key={k} className="flex-1 h-full flex items-end" title={`${k * BIN_DEG}–${k === BINS - 1 ? "90" : (k + 1) * BIN_DEG}°: ${Math.round(h * 100)}%`}>
                          <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, (h / histMax) * 100)}%`, background: `rgb(${RAMP[s.kind][1].join(",")})`, opacity: 0.9 }} />
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between text-[10px] faint font-mono mt-0.5"><span>0°</span><span>10°</span><span>20°</span><span>30°</span><span>40°</span></div>
                  </div>
                  <p className="text-[11px] faint leading-snug" title={topo?.instrument}>
                    {topo?.status === "procedural" ? "Placeholder shape: no elevation product covered this site." : <>Source: {topo?.instrument ?? "not recorded"}</>}
                  </p>
                </>
              )}
            </figure>
          );
        })}
      </div>
    </div>
  );
}
