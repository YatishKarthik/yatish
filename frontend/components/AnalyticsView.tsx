"use client";

import React, { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Play, Search } from "lucide-react";
import type { GlobePin } from "@/components/PlanetGlobe";
import { Tabs, Status, Bar, Kpi, similarityWord, PCT } from "@/components/ui";

const PlanetGlobe = dynamic(() => import("@/components/PlanetGlobe"), { ssr: false });

/* ---------- data shapes ---------- */
export type DataStatus = "measured" | "derived" | "modelled" | "typical" | "procedural" | "unknown";
const STATUS_INFO: Record<DataStatus, { word: string; level: "good" | "warn" | "bad"; what: string }> = {
  measured: { word: "Measured", level: "good", what: "read directly from a satellite or climate product" },
  derived: { word: "Derived", level: "good", what: "computed from measured elevation data" },
  modelled: { word: "Modelled", level: "warn", what: "produced by a simple physical model" },
  typical: { word: "Typical value", level: "warn", what: "a representative value for this kind of site, not measured here" },
  procedural: { word: "Placeholder", level: "bad", what: "no data covered this site; a shape model stands in" },
  unknown: { word: "Unknown", level: "bad", what: "source not recorded" },
};
function SourceTag({ s }: { s?: DataStatus }) { const k = STATUS_INFO[s ?? "unknown"]; return <span title={k.what}><Status level={k.level}>{k.word}</Status></span>; }
export interface ParamSim {
  label: string; unit: string; pillar: string; similarity: number; target_val: number; earth_val: number;
  earth_agency?: string; earth_instrument?: string; space_agency?: string; space_instrument?: string;
  earth_status?: DataStatus; space_status?: DataStatus; status?: DataStatus;
}
export interface MatrixRow { test: string; scenario: "rover" | "landing" | "mining"; status: "REPRESENTATIVE" | "PARTIAL" | "NOT_REPRESENTATIVE"; confidence: number; reason: string }
export interface BestPerTestRow { test: string; scenario: "rover" | "landing" | "mining"; best_site_id: string; best_site_name: string; rank: number; status: MatrixRow["status"]; confidence: number; reason: string }
export interface EarthMatch {
  id: string; rank?: number; name: string; type: string; data_source?: string; lat: number; lon: number; elevation_m: number;
  morphology: string; mineral_profile: string; geology: string; similarity_score: number; epistemic_uncertainty: number;
  conformal_90_interval: [number, number]; pillar_scores: { topo: number; radar: number; mineral: number; thermal: number };
  parameter_similarities: Record<string, ParamSim>; representativeness_matrix: MatrixRow[];
  scenarios: Record<string, { status: string; score: number; uncertainty: number; conformal_interval: [number, number]; note: string }>;
  diurnal_sol_curve?: number[]; heightmap_url: string; radar_url: string;
  similarity_before_vegetation_rule?: number; vegetation_gate?: number; ndvi?: number; water_fraction?: number;
}
export interface MatchPayload {
  search_time_ms: number; earth_sites_scanned: number; overall_best_id?: string; best_per_test?: BestPerTestRow[];
  target: { id: string; name: string; body: "moon" | "mars"; lat: number; lon: number; elevation_m: number; gravity: number; pressure_bar: number; temp_min_c: number; temp_max_c: number; primary_challenge: string; diurnal_sol_curve?: number[]; heightmap_url: string; radar_url: string };
  matches: EarthMatch[];
}

/* ---------- plain-language dictionaries ---------- */
const PILLARS: { key: keyof EarthMatch["pillar_scores"]; label: string; what: string; weight: number }[] = [
  { key: "topo", label: "Terrain shape", what: "How steep and how rough the ground is, from elevation maps.", weight: 0.30 },
  { key: "radar", label: "Surface texture", what: "How broken and blocky the ground is, measured as texture in the elevation grid.", weight: 0.30 },
  { key: "mineral", label: "Rock and soil", what: "What the ground is made of and how bare it is, from satellite colour bands.", weight: 0.25 },
  { key: "thermal", label: "Day-night heat", what: "How hot and cold it gets and how big the daily swing is.", weight: 0.15 },
];

const PARAM_HELP: Record<string, { name: string; what: string }> = {
  slope_mean: { name: "Average slope", what: "How steep the ground is on average. Steeper means harder driving and landing." },
  slope_p90: { name: "Steepest common slope", what: "The slope that only 10% of the area is steeper than. Shows the worst patches a rover meets." },
  tri_ruggedness: { name: "Ruggedness", what: "How much the height jumps between neighbouring points. High means lumpy, broken ground." },
  concavity: { name: "Pits and craters", what: "Whether the ground tends to form bowls (craters, pits) or domes." },
  sar_backscatter: { name: "Texture roughness", what: "A single roughness index from height spread and texture contrast. Higher means rougher, blockier ground." },
  sar_entropy: { name: "Texture variety", what: "How jumbled the slope pattern is. Broken, cratered ground scores high; smooth plains score low." },
  sar_contrast: { name: "Texture contrast", what: "How sharply steep and flat patches alternate. Picks out ridges, scarps and crater walls." },
  bareness_index: { name: "Bare ground", what: "1 means no plants at all; lower values mean vegetation, which the Moon and Mars do not have." },
  iron_oxide_ratio: { name: "Iron oxide (rust)", what: "How red and iron-rich the surface is. Mars is high; basalt and anorthosite are low." },
  clay_hydroxyl_ratio: { name: "Clay content", what: "Signs of clay minerals formed by water. Important for drilling and for Mars delta sites." },
  albedo: { name: "Brightness (albedo)", what: "How much sunlight the surface reflects. Dark ground heats up more by day." },
  temp_min_c: { name: "Coldest temperature", what: "Typical night-time low. Compared by pattern, not by absolute value." },
  temp_max_c: { name: "Warmest temperature", what: "Typical daytime high." },
  temp_delta_c: { name: "Daily swing", what: "Warmest minus coldest. Large swings stress materials and joints." },
};

const TEST_HELP: Record<string, { ask: string; why: string }> = {
  "Slope Climbing & Wheel Traction": { ask: "Can a rover climb and grip here?", why: "Depends on slopes and ruggedness. Gravity still differs, so grip on Earth is always higher." },
  "Radar / Darkness Boulder Navigation": { ask: "Can a rover find its way across broken ground?", why: "Depends on surface texture matching. Plant cover hides the rocks, so green sites fail this." },
  "Lander Touchdown Tilt & Stability": { ask: "Will a lander stay upright when it touches down?", why: "Depends on slope spread and surface roughness around the pad." },
  "Thruster Plume & Dust Ejecta": { ask: "What does the engine blast do to the ground?", why: "Earth's air damps the plume. In near-vacuum, dust flies far and fast. Earth can rarely stand in for this." },
  "Rock / Ice Drill Bit Hardness": { ask: "Does the drill bit meet the same kind of rock?", why: "Depends on the mineral match. Wet soil never behaves like dry regolith." },
  "Thermal & Vacuum Motor Cooling": { ask: "Will motors overheat like they would in vacuum?", why: "No: Earth's air cools motors by convection. This test never transfers from Earth." },
};
const STATUS_WORD: Record<MatrixRow["status"], { word: string; level: "good" | "warn" | "bad" }> = {
  REPRESENTATIVE: { word: "Good Test Site", level: "good" },
  PARTIAL: { word: "Partly Useful", level: "warn" },
  NOT_REPRESENTATIVE: { word: "Not Useful For This", level: "bad" },
};

function DataNote({ m, world }: { m: EarthMatch; world: string }) {
  const p = m.parameter_similarities;
  const terrainE = p.slope_mean?.earth_status, terrainT = p.slope_mean?.space_status, comp = p.bareness_index?.earth_status, temp = p.temp_max_c?.earth_status;
  const bits: string[] = [];
  bits.push(terrainE === "measured" && terrainT === "measured" ? "Terrain for both sites is measured" : terrainT !== "measured" ? `Terrain for ${world} is a placeholder shape model` : "Terrain for the Earth site is a placeholder");
  bits.push(comp === "measured" ? "Earth surface composition is measured by Sentinel-2" : "Earth surface composition is a typical value");
  bits.push(temp === "measured" ? "Earth temperatures are NASA POWER climatology" : "Earth temperatures are typical values");
  bits.push(`${world === "the Moon" ? "Moon" : "Mars"} composition and temperatures are typical published values`);
  return <p className="text-xs muted leading-relaxed border-l-2 pl-3" style={{ borderColor: "var(--accent)" }}><b style={{ color: "var(--text)" }}>Where the data comes from.</b> {bits.join(". ")}. Each value&apos;s source is tagged in the Measurements tab.</p>;
}

interface Validation {
  earth_sites: number;
  negative_controls: { count: number; median_rank: number; share_in_bottom_half: number; best_rank_seen: number };
  negative_controls_without_vegetation_rule?: { median_rank: number; share_in_bottom_half: number; best_rank_seen: number };
  benchmarks: { count: number; median_rank: number; share_in_top_half: number };
  weight_sensitivity: { mean_top5_kept: number; min_top5_kept: number };
  ensemble_calibration: { coverage_per_scenario: number[]; calibration_sites: number };
}

function Evidence() {
  const [v, setV] = useState<Validation | null>(null);
  useEffect(() => { fetch("http://127.0.0.1:8000/api/validation").then((r) => (r.ok ? r.json() : null)).then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const nc = v.negative_controls, raw = v.negative_controls_without_vegetation_rule;
  return (
    <div className="card-solid p-3">
      <div className="font-semibold mb-1">Does the score mean anything? Checks across all 20 targets</div>
      <ul className="flex flex-col gap-1.5 mt-2">
        <li><b>Unsuitable control sites</b> (rainforest, wetland, farmland, polders): median rank {nc.median_rank} of {v.earth_sites}, {Math.round(nc.share_in_bottom_half * 100)}% in the bottom half{raw ? `. Without the bare-ground rule: median ${raw.median_rank}, ${Math.round(raw.share_in_bottom_half * 100)}% in the bottom half` : ""}. Best rank any control reached: {nc.best_rank_seen}.</li>
        <li><b>Established analog sites</b> used by space agencies: median rank {v.benchmarks.median_rank}, {Math.round(v.benchmarks.share_in_top_half * 100)}% in the top half. Each benchmark is an analog for particular targets, not all of them, so a middling average is expected.</li>
        <li><b>Weight sensitivity</b>: moving any one group weight by ±20% keeps on average {v.weight_sensitivity.mean_top5_kept} of the top 5 (never fewer than {v.weight_sensitivity.min_top5_kept}).</li>
        <li><b>Uncertainty calibration</b>: on {v.ensemble_calibration.calibration_sites} held-out Earth sites the 90% band contained the true value {v.ensemble_calibration.coverage_per_scenario.map((c) => `${Math.round(c * 100)}%`).join(", ")} of the time for the rover, landing and mining scenarios.</li>
      </ul>
      <p className="muted mt-2">Reproduce with <code className="font-mono">python data-pipeline/03_validate.py</code>.</p>
    </div>
  );
}

type View = "summary" | "tests" | "best" | "day" | "measure" | "expert";

export default function AnalyticsView({ data, onBackToGlobe, onLaunchSimulator }: { data: MatchPayload; onBackToGlobe: () => void; onLaunchSimulator: (selectedMatch: EarthMatch) => void }) {
  const [selectedId, setSelectedId] = useState<string>(data.matches[0]?.id || "");
  const [filterText, setFilterText] = useState("");
  const [view, setView] = useState<View>("summary");

  const m = useMemo(() => data.matches.find((x) => x.id === selectedId) || data.matches[0], [data.matches, selectedId]);
  const t = data.target;
  const world = t.body === "moon" ? "the Moon" : "Mars";

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return data.matches;
    return data.matches.filter((x) => x.name.toLowerCase().includes(q) || x.mineral_profile.toLowerCase().includes(q) || x.type.toLowerCase().includes(q));
  }, [data.matches, filterText]);

  const pins: GlobePin[] = useMemo(() => data.matches.map((x, i) => ({ id: x.id, rank: x.rank || i + 1, name: x.name, lat: x.lat, lon: x.lon, subtitle: `${PCT(x.similarity_score)} match` })), [data.matches]);

  // plain-language summary pieces
  const sw = similarityWord(m.similarity_score);
  const pillarsSorted = [...PILLARS].sort((a, b) => m.pillar_scores[b.key] - m.pillar_scores[a.key]);
  const best = pillarsSorted[0], worst = pillarsSorted[pillarsSorted.length - 1];
  const good = m.representativeness_matrix.filter((r) => r.status === "REPRESENTATIVE");
  const partial = m.representativeness_matrix.filter((r) => r.status === "PARTIAL");
  const bad = m.representativeness_matrix.filter((r) => r.status === "NOT_REPRESENTATIVE");
  const ask = (test: string) => TEST_HELP[test]?.ask ?? test;

  const targetCurve = t.diurnal_sol_curve || [], earthCurve = m.diurnal_sol_curve || [];
  const lo = Math.min(...targetCurve, ...earthCurve, -240), hi = Math.max(...targetCurve, ...earthCurve, 120);
  const yPct = (v: number) => Math.round(((v - lo) / (hi - lo || 1)) * 100);

  const params = Object.entries(m.parameter_similarities);
  const byPillar = (key: string) => params.filter(([, p]) => p.pillar === key);

  return (
    <div className="relative z-10 flex-1 flex flex-col gap-4 p-4 max-w-[1750px] w-full mx-auto">
      <div className="card px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBackToGlobe} className="btn btn-sm"><ArrowLeft className="w-3.5 h-3.5" /> Back to {world}</button>
          <div>
            <div className="text-sm font-semibold">Earth sites that behave like {t.name}</div>
            <div className="text-xs muted">{data.earth_sites_scanned} sites compared · {t.gravity} m/s² · {t.pressure_bar} bar · {t.temp_min_c}°C to {t.temp_max_c}°C</div>
          </div>
        </div>
        <button type="button" onClick={() => onLaunchSimulator(m)} className="btn btn-primary" data-tour="launch"><Play className="w-4 h-4" /> Test hardware at #{m.rank || 1} in the simulator</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
        {/* left: globe + list */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="card overflow-hidden relative h-[400px]" data-tour="earth-globe">
            <div className="absolute top-3 left-3 z-10 on-canvas px-3 py-1.5">
              <div className="text-xs font-semibold">Earth · {data.matches.length} candidate test sites</div>
              <div className="text-[11px] opacity-80">Best three are labelled · select a site and the globe turns to it</div>
            </div>
            <PlanetGlobe body="earth" pins={pins} selectedPinId={m.id} onSelectPin={(id) => setSelectedId(id)} />
          </div>

          <div className="card p-4 flex-1 flex flex-col" data-tour="ranked">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-semibold">All {data.matches.length} sites, best first</span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 faint" />
                <input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Filter by name or rock type" className="input" style={{ paddingLeft: 28 }} />
              </div>
            </div>
            <p className="text-xs muted mb-2">Score out of 100 · the ± is how unsure the model is</p>
            <div className="flex flex-col gap-1 max-h-[340px] overflow-y-auto pr-1">
              {filtered.map((x) => {
                const rank = x.rank || 1;
                return (
                  <button key={x.id} type="button" onClick={() => setSelectedId(x.id)} className="row flex items-center justify-between gap-2" aria-pressed={x.id === m.id}>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold flex items-center gap-1.5 truncate"><span className="font-mono muted">#{rank}</span><span className="truncate">{x.name}</span></div>
                      <div className="text-[11px] muted mt-0.5">{x.mineral_profile.replace(/_/g, " ")} · {x.lat.toFixed(1)}°, {x.lon.toFixed(1)}°</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold font-mono">{Math.round(x.similarity_score * 100)}</div>
                      <div className="text-[11px] font-mono muted">±{Math.round(x.epistemic_uncertainty * 100)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* right: selected site */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs muted">Rank #{m.rank || 1} of {data.matches.length}</div>
                <h2 className="text-xl font-semibold mt-0.5">{m.name}</h2>
                <p className="text-xs muted mt-1 max-w-xl">{m.geology}</p>
              </div>
              <div className="card-solid p-3 text-right shrink-0" data-tour="score">
                <div className="text-[11px] muted">Match score</div>
                <div className="text-3xl font-semibold leading-none mt-1">{Math.round(m.similarity_score * 100)}<span className="text-sm muted font-normal"> / 100</span></div>
                <div className="text-[11px] muted mt-1">likely between {Math.round(m.conformal_90_interval[0] * 100)} and {Math.round(m.conformal_90_interval[1] * 100)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 mt-4 border-t line">
              {PILLARS.map((p) => { const v = m.pillar_scores[p.key]; return (
                <div key={p.key} title={p.what}>
                  <div className="flex justify-between text-xs mb-1"><span className="font-medium">{p.label}</span><span className="font-mono muted">{Math.round(v * 100)}</span></div>
                  <Bar value={v} />
                </div>
              ); })}
            </div>
          </div>

          <div className="card p-5 flex-1 flex flex-col">
            <Tabs<View> value={view} onChange={setView} tour="view-tabs" items={[
              { id: "summary", label: "Summary", hint: "the short version" },
              { id: "tests", label: "Tests", hint: "what you can test here" },
              { id: "best", label: "Best site per test", hint: "who wins each test" },
              { id: "day", label: "Day & night", hint: "temperatures hour by hour" },
              { id: "measure", label: "Measurements", hint: "all 14 values explained" },
              { id: "expert", label: "Expert view", hint: "uncertainty and sources" },
            ]} />

            <div className="pt-4 flex-1 overflow-y-auto" key={view}>
              {view === "summary" && (
                <div className="flex flex-col gap-4 rise" data-tour="summary">
                  <DataNote m={m} world={world} />
                  {m.vegetation_gate !== undefined && m.vegetation_gate < 1 && (
                    <p className="text-xs leading-relaxed" style={{ color: "var(--warn)" }}>The bare-ground rule cut this site&apos;s score{m.vegetation_gate === 0 ? " to zero" : ` to ${Math.round(m.vegetation_gate * 100)}%`}: Sentinel-2 sees {m.ndvi !== undefined && m.ndvi > 0.2 ? `plant cover (NDVI ${m.ndvi.toFixed(2)})` : ""}{m.ndvi !== undefined && m.ndvi > 0.2 && (m.water_fraction ?? 0) > 0.2 ? " and " : ""}{(m.water_fraction ?? 0) > 0.2 ? `${Math.round((m.water_fraction ?? 0) * 100)}% open water` : ""}. The Moon and Mars have neither. Before the rule it scored {Math.round((m.similarity_before_vegetation_rule ?? 0) * 100)}.</p>
                  )}
                  <p className="text-[15px] leading-relaxed">
                    <b>{m.name}</b> is <Status level={sw.level}>{sw.word}</Status> to {t.name} overall, with a match score of <b>{Math.round(m.similarity_score * 100)} out of 100</b>.
                    It resembles the destination most in <b>{best.label.toLowerCase()}</b> ({Math.round(m.pillar_scores[best.key] * 100)}) and least in <b>{worst.label.toLowerCase()}</b> ({Math.round(m.pillar_scores[worst.key] * 100)}).
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="card-solid p-3">
                      <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--good)" }}>Good place to test</div>
                      {good.length ? <ul className="text-xs flex flex-col gap-1">{good.map((r) => <li key={r.test}>• {ask(r.test)}</li>)}</ul> : <p className="text-xs muted">Nothing fully transfers from here.</p>}
                    </div>
                    <div className="card-solid p-3">
                      <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--warn)" }}>Useful with care</div>
                      {partial.length ? <ul className="text-xs flex flex-col gap-1">{partial.map((r) => <li key={r.test}>• {ask(r.test)}</li>)}</ul> : <p className="text-xs muted">—</p>}
                    </div>
                    <div className="card-solid p-3">
                      <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--bad)" }}>Do not trust Earth for</div>
                      {bad.length ? <ul className="text-xs flex flex-col gap-1">{bad.map((r) => <li key={r.test}>• {ask(r.test)}</li>)}</ul> : <p className="text-xs muted">—</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Kpi label="Gravity" value={`${t.gravity} m/s²`} sub={`Earth is 9.81, so ${(9.81 / t.gravity).toFixed(1)}× stronger`} />
                    <Kpi label="Air pressure" value={`${t.pressure_bar} bar`} sub={t.pressure_bar < 0.05 ? "effectively vacuum: no air cooling, no plume damping" : "thin atmosphere"} />
                    <Kpi label="Temperatures there" value={`${t.temp_min_c}° to ${t.temp_max_c}°C`} sub={`daily swing ${t.temp_max_c - t.temp_min_c}°C`} />
                    <Kpi label="Temperatures here" value={`${m.parameter_similarities.temp_min_c?.earth_val}° to ${m.parameter_similarities.temp_max_c?.earth_val}°C`} sub={`daily swing ${m.parameter_similarities.temp_delta_c?.earth_val}°C`} />
                  </div>
                  <p className="text-xs muted leading-relaxed">
                    How to read the score: it compares 14 measurements of the ground, split into the four groups above, weighted {PILLARS.map((p) => `${p.label.toLowerCase()} ${Math.round(p.weight * 100)}%`).join(", ")}.
                    A model trained on the Earth sites adds the ± uncertainty; a wider ± means the site is unlike anything the model has seen. Temperatures are compared by pattern, never by raw value, because Earth is always warmer.
                  </p>
                </div>
              )}

              {view === "tests" && (
                <div className="flex flex-col gap-2.5 rise">
                  <p className="text-xs muted">Six common hardware tests. For each: can this Earth site stand in for {t.name}?</p>
                  {m.representativeness_matrix.map((r) => { const s = STATUS_WORD[r.status], h = TEST_HELP[r.test]; return (
                    <div key={r.test} className="card-solid p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{h?.ask ?? r.test}</div>
                        <p className="text-xs muted mt-0.5">{r.reason}</p>
                        {h && <p className="text-[11px] faint mt-1">{h.why}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0"><span className="text-[11px] font-mono muted">confidence {Math.round(r.confidence * 100)}%</span><Status level={s.level}>{s.word}</Status></div>
                    </div>
                  ); })}
                </div>
              )}

              {view === "best" && (
                <div className="flex flex-col gap-3 rise">
                  <div className="card-solid p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: "var(--good)" }}>
                    <div>
                      <div className="text-xs muted">Best overall Earth site for {t.name}</div>
                      <div className="text-base font-semibold mt-0.5">{data.matches[0]?.name}</div>
                      <div className="text-xs muted">{Math.round((data.matches[0]?.similarity_score ?? 0) * 100)} / 100 · rank 1 of {data.matches.length}</div>
                    </div>
                    <button type="button" onClick={() => setSelectedId(data.matches[0].id)} className="btn btn-sm">Show it</button>
                  </div>
                  <p className="text-xs muted">The best overall site is not always the best for every test. Here is the winner for each one.</p>
                  {(data.best_per_test || []).map((item) => { const s = STATUS_WORD[item.status]; return (
                    <div key={item.test} className="card-solid p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] muted">{ask(item.test)}</div>
                        <div className="text-sm font-semibold mt-0.5">#{item.rank} {item.best_site_name}</div>
                        <p className="text-xs muted mt-0.5">{item.reason}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0"><Status level={s.level}>{s.word}</Status><button type="button" onClick={() => setSelectedId(item.best_site_id)} className="btn btn-sm">Show</button></div>
                    </div>
                  ); })}
                </div>
              )}

              {view === "day" && (
                <div className="flex flex-col gap-3 rise">
                  <p className="text-xs muted">One full day, hour by hour. Bars show temperature; the shape of the curve is what matters, because the two worlds are on very different absolute scales.</p>
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: "var(--space)" }} />{t.name}: {t.temp_min_c}°C to {t.temp_max_c}°C</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: "var(--earth)" }} />{m.name}: {m.parameter_similarities.temp_min_c?.earth_val}°C to {m.parameter_similarities.temp_max_c?.earth_val}°C</span>
                  </div>
                  <div className="card-solid p-4">
                    <div className="grid grid-cols-24 gap-1 h-32 items-end">
                      {targetCurve.map((tt, hr) => { const et = earthCurve[hr] ?? 20; return (
                        <div key={hr} className="h-full flex items-end justify-center gap-0.5 group relative">
                          <div className="w-full rounded-t-sm" style={{ height: `${Math.max(6, yPct(tt))}%`, background: "var(--space)", opacity: 0.85 }} />
                          <div className="w-full rounded-t-sm" style={{ height: `${Math.max(6, yPct(et))}%`, background: "var(--earth)", opacity: 0.85 }} />
                          <div className="absolute -top-9 left-1/2 -translate-x-1/2 hidden group-hover:block card-solid px-2 py-1 text-[10px] font-mono whitespace-nowrap z-20">{hr}:00 · {tt}°C vs {et}°C</div>
                        </div>
                      ); })}
                    </div>
                    <div className="flex justify-between text-[11px] muted mt-2"><span>midnight</span><span>6 am</span><span>noon</span><span>6 pm</span><span>11 pm</span></div>
                  </div>
                  <p className="text-xs muted leading-relaxed">Why this matters: on Earth, air carries heat away from motors and drills all day long. At {t.pressure_bar} bar there is almost no air, so equipment keeps the heat it makes and can seize. Daily swing here is {m.parameter_similarities.temp_delta_c?.earth_val}°C against {t.temp_max_c - t.temp_min_c}°C there.</p>
                </div>
              )}

              {view === "measure" && (
                <div className="flex flex-col gap-4 rise">
                  <p className="text-xs muted">Every number the match is built from, with what it means. &quot;Similarity&quot; says how close the two values are once put on the same scale.</p>
                  {PILLARS.map((p) => (
                    <div key={p.key}>
                      <div className="flex items-baseline justify-between mb-1.5"><h3 className="text-sm font-semibold">{p.label}</h3><span className="text-[11px] muted">{p.what}</span></div>
                      <div className="flex flex-col gap-1.5">
                        {byPillar(p.key).map(([key, v]) => { const h = PARAM_HELP[key], w = similarityWord(v.similarity); return (
                          <div key={key} className="card-solid p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0"><div className="text-sm font-medium">{h?.name ?? v.label}</div><div className="text-[11px] muted">{h?.what}</div></div>
                              <div className="shrink-0 text-right"><Status level={w.level}>{w.word}</Status></div>
                            </div>
                            <div className="mt-2"><Bar value={v.similarity} colour={w.level === "good" ? "var(--good)" : w.level === "warn" ? "var(--warn)" : "var(--bad)"} /></div>
                            <div className="flex flex-wrap justify-between text-[11px] font-mono mt-1.5">
                              <span style={{ color: "var(--earth)" }}>Earth {v.earth_val} {v.unit}</span>
                              <span style={{ color: "var(--space)" }}>{world} {v.target_val} {v.unit}</span>
                            </div>
                            <div className="flex flex-wrap justify-between items-center gap-2 mt-1.5 text-[11px]">
                              <span className="flex items-center gap-1.5"><SourceTag s={v.earth_status} /><span className="faint truncate max-w-[220px]" title={v.earth_instrument}>{v.earth_instrument}</span></span>
                              <span className="flex items-center gap-1.5"><span className="faint truncate max-w-[220px]" title={v.space_instrument}>{v.space_instrument}</span><SourceTag s={v.space_status} /></span>
                            </div>
                          </div>
                        ); })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {view === "expert" && (
                <div className="flex flex-col gap-4 rise text-xs">
                  <p className="muted leading-relaxed">How the numbers are made. Each of the 14 measurements is standardised across all 80 sites (z-scores), the two sites are compared per measurement with exp(−0.55·|Δz|), those are averaged within each of the four groups, and the groups are blended with the weights below. That blend is the match score. Separately, a small neural-network ensemble predicts how well each hardware scenario would transfer, and its disagreement gives the uncertainty.</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Kpi label="Similarity" value={m.similarity_score.toFixed(3)} sub="The match score before rounding: weighted mean of the four group means." />
                    <Kpi label="Epistemic σ" value={m.epistemic_uncertainty.toFixed(3)} sub="How much the 7 ensemble models disagree. Big σ means this site is unlike the training sites." />
                    <Kpi label="90% interval" value={`${m.conformal_90_interval[0].toFixed(2)}–${m.conformal_90_interval[1].toFixed(2)}`} sub="Conformal band: 9 times in 10 the true value should fall inside it (calibrated on 14 held-out sites)." />
                    <Kpi label="Search time" value={`${data.search_time_ms} ms`} sub={`Time to compare all ${data.earth_sites_scanned} Earth sites on the server.`} />
                  </div>
                  <Evidence />
                  <div className="card-solid p-3">
                    <div className="font-semibold mb-1">Scenario model</div>
                    <p className="muted mb-2">Ensemble predictions of how well a rover, landing or mining test would transfer (0 to 1). They inform the Tests tab and the uncertainty; they do not change the ranking.</p>
                    <table className="w-full text-xs">
                      <thead><tr className="muted text-left"><th className="font-normal pb-1">Scenario</th><th className="font-normal">Score</th><th className="font-normal">σ</th><th className="font-normal">90% interval</th><th className="font-normal">Status</th></tr></thead>
                      <tbody className="font-mono">{Object.entries(m.scenarios).map(([k, s]) => <tr key={k}><td className="py-0.5 font-sans">{k}</td><td>{s.score.toFixed(3)}</td><td>{s.uncertainty.toFixed(3)}</td><td>{s.conformal_interval[0].toFixed(2)}–{s.conformal_interval[1].toFixed(2)}</td><td className="font-sans">{s.status}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <div className="card-solid p-3">
                    <div className="font-semibold mb-1">Group weights</div>
                    <p className="muted mb-2">Terrain and surface texture carry the most weight because they decide whether vehicles can move and land at all; temperatures carry the least because Earth can never match them in absolute terms. After weighting, a bare-ground rule multiplies the score: full at Sentinel-2 NDVI 0.20 or less and up to 20% open water, falling to zero at NDVI 0.30 or 50% water, because the Moon and Mars have neither plants nor open water.</p>
                    <div className="flex flex-wrap gap-3 font-mono">{PILLARS.map((p) => <span key={p.key}>{p.label} {p.weight.toFixed(2)}</span>)}</div>
                  </div>
                  <div className="card-solid p-3">
                    <div className="font-semibold mb-1">Data sources per parameter</div>
                    <p className="muted mb-2">Where each value came from for these two sites. {(Object.keys(STATUS_INFO) as DataStatus[]).filter((k) => k !== "unknown").map((k) => `${STATUS_INFO[k].word}: ${STATUS_INFO[k].what}`).join(". ")}.</p>
                    <table className="w-full text-[11px]">
                      <thead><tr className="muted text-left"><th className="font-normal pb-1">Parameter</th><th className="font-normal">Earth</th><th className="font-normal">{world}</th></tr></thead>
                      <tbody>{params.map(([k, v]) => <tr key={k} className="border-t line"><td className="py-1 pr-2">{PARAM_HELP[k]?.name ?? v.label}</td><td className="pr-2">{v.earth_instrument} <SourceTag s={v.earth_status} /></td><td className="pr-2">{v.space_instrument} <SourceTag s={v.space_status} /></td></tr>)}</tbody>
                    </table>
                  </div>
                  <p className="muted leading-relaxed">Limits worth stating. Terrain is measured for every site that has a product (Copernicus GLO-30 on Earth, LRO LOLA altimetry on the Moon, MRO CTX stereo models on Mars). Surface texture is computed from that terrain, not from radar. Surface composition is measured by Sentinel-2 on Earth but uses typical rock-class values on the Moon and Mars. Earth temperatures are NASA POWER 2 m air climatology; Moon and Mars temperatures are published typical surface ranges, so the two are compared by pattern, not by value. The ensemble is trained on labels that are formulas of the features, so its uncertainty is epistemic only, and the calibration set is 14 sites, so the 90% band is coarse.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
