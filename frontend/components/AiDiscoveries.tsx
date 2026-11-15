"use client";

import React from "react";
import { Sparkles, CheckCircle2, AlertTriangle, MapPin } from "lucide-react";

export interface AiCandidate {
  id?: string; lat: number; lon: number;
  ai_score: number; ai_low: number; ai_high: number; ai_sigma: number; confident: boolean;
  exact_score: number | null; inside_interval: boolean | null; would_rank_among_named: number | null;
  measured: { slope_mean: number; slope_p90: number; tri_ruggedness: number; temp_min_c: number; temp_max_c: number; ndvi_season_max: number } | null;
}
export interface AiDiscoveryData {
  method: string; inputs: string[]; cells_searched: number; cell_deg: number;
  model: { n_train: number; n_calibration: number; n_test: number; coverage: number; r2: number; mae: number; coverage_mean: number; r2_mean: number };
  verification?: { candidates: number; exact_inside_ai_interval: number | null };
  candidates: AiCandidate[];
}

export const aiPinId = (c: { id?: string; lat: number; lon: number }) => c.id ?? `ai:${c.lat},${c.lon}`;
export const fmtLatLon = (lat: number, lon: number) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
const P = (x: number) => Math.round(x * 100);

export function AiDiscoveries({ data, error, world, selected, onSelect, topNamedScore }: {
  data: AiDiscoveryData | null; error: string | null; world: string; selected: string | null; onSelect: (id: string) => void; topNamedScore?: number;
}) {
  if (error) return <p className="text-xs muted">{error}</p>;
  if (!data) return <p className="text-xs muted">Loading the AI search…</p>;
  const m = data.model;
  return (
    <div className="flex flex-col gap-4 rise text-xs">
      <div className="card-solid p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="w-4 h-4" style={{ color: "var(--ai, #c084fc)" }} /> Places on Earth nobody listed</div>
        <p className="muted leading-relaxed mt-1.5">
          A deep ensemble (7 neural networks) learned to estimate the Celestra score from coarse global data, then searched {data.cells_searched.toLocaleString("en-US")} cells of bare land
          ({data.cell_deg}° grid) for places like {world}. Each estimate has a 90% conformal interval: narrow means the AI is confident, wide means it has seen little terrain like this.
          Every candidate below was then re-scored with the exact pipeline on real 30 m terrain and MODIS data.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <div className="card p-2.5"><div className="text-[11px] muted">Interval coverage</div><div className="text-sm font-semibold">{P(m.coverage)}%</div><div className="text-[10px] faint">target 90%, on {m.n_test} held-out cells</div></div>
          <div className="card p-2.5"><div className="text-[11px] muted">Fit (R²)</div><div className="text-sm font-semibold">{m.r2.toFixed(2)}</div><div className="text-[10px] faint">AI vs exact score, held-out</div></div>
          <div className="card p-2.5"><div className="text-[11px] muted">Typical error</div><div className="text-sm font-semibold">±{P(m.mae)} pts</div><div className="text-[10px] faint">mean absolute, held-out</div></div>
          <div className="card p-2.5"><div className="text-[11px] muted">Trained on</div><div className="text-sm font-semibold">{m.n_train} cells</div><div className="text-[10px] faint">exact scores from real data</div></div>
        </div>
        {data.verification?.exact_inside_ai_interval != null && (
          <p className="text-[11px] muted mt-2">Across all targets, the exact score fell inside the AI&apos;s interval for {P(data.verification.exact_inside_ai_interval)}% of the {data.verification.candidates} verified candidates.</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {data.candidates.map((c, i) => {
          const id = aiPinId(c), sel = id === selected;
          const beatsTop = c.exact_score != null && topNamedScore != null && c.exact_score >= topNamedScore;
          return (
            <button key={id} type="button" onClick={() => onSelect(id)} className="row text-left" aria-pressed={sel}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ai, #c084fc)" }} />
                  <span className="font-semibold font-mono">{fmtLatLon(c.lat, c.lon)}</span>
                  <span className="faint">AI find #{i + 1}</span>
                </div>
                <div className="flex items-center gap-2">
                  {c.confident ? <span className="status status-good">Confident</span> : <span className="status status-warn">Less certain</span>}
                  {beatsTop && <span className="status" style={{ background: "rgba(192,132,252,0.15)", color: "#c084fc" }}>Beats every named site</span>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                <div><div className="text-[11px] muted">AI estimate</div><div className="font-mono"><b>{P(c.ai_score)}</b> <span className="muted">({P(c.ai_low)}–{P(c.ai_high)})</span></div></div>
                <div><div className="text-[11px] muted">Exact score (verified)</div><div className="font-mono flex items-center gap-1.5">{c.exact_score == null ? <span className="muted">no 30 m data</span> : <><b>{P(c.exact_score)}</b>{c.inside_interval ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--good)" }} /> : <AlertTriangle className="w-3.5 h-3.5" style={{ color: "var(--warn)" }} />}</>}</div></div>
                <div><div className="text-[11px] muted">Would rank among the 60 named</div><div className="font-mono">{c.would_rank_among_named == null ? "–" : `#${c.would_rank_among_named}`}</div></div>
              </div>
              {sel && <div className="text-[11px] mt-2" style={{ color: "#c084fc" }}>Selected: its full analysis is in the other tabs, and the simulator button at the top flies this place.</div>}
              {c.measured && sel && (
                <div className="text-[11px] muted mt-2">Measured here: mean slope {c.measured.slope_mean.toFixed(1)}°, steep slopes {c.measured.slope_p90.toFixed(1)}°, surface {c.measured.temp_min_c.toFixed(0)}° to {c.measured.temp_max_c.toFixed(0)}°C (MODIS), greenest-month NDVI {c.measured.ndvi_season_max.toFixed(2)}. Unnamed place: shown by coordinates.</div>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] faint leading-relaxed">What the AI learned is Celestra&apos;s scoring, not ground truth: it is a fast stand-in that makes a whole-planet search possible. Composition is not part of this search. Check a candidate&apos;s access and land status before planning any fieldwork.</p>
    </div>
  );
}
