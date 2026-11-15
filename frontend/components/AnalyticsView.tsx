"use client";

import React, { useState, useMemo, useEffect } from "react";
import { AiDiscoveries, type AiDiscoveryData } from "@/components/AiDiscoveries";
import dynamic from "next/dynamic";
import { ArrowLeft, Play, Search, FileText } from "lucide-react";
import type { GlobePin } from "@/components/PlanetGlobe";
import { Tabs, Status, Bar, Kpi, similarityWord, PCT, notComparedReason } from "@/components/ui";
import {
  ArtemisBadge, ByUseView, WhyThisMatch, FieldReadinessCard, SunlightPanel, TEST_HELP,
  type ArtemisInfo, type Illumination, type NightIR, type CustomInfo, type FunctionalRanking, type Contribution, type WhyInfo, type FieldReadiness,
} from "@/components/Insights";
import TerrainTwins from "@/components/TerrainTwins";
import { apiUrl } from "@/lib/api";


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
  label: string; unit: string; pillar: string; similarity: number | null; compared?: boolean; target_val: number; earth_val: number;
  earth_agency?: string; earth_instrument?: string; space_agency?: string; space_instrument?: string;
  earth_status?: DataStatus; space_status?: DataStatus; status?: DataStatus;
}
export interface MatrixRow { test: string; scenario: "rover" | "landing" | "mining"; status: "REPRESENTATIVE" | "PARTIAL" | "NOT_REPRESENTATIVE"; confidence: number; reason: string }
export interface BestPerTestRow { test: string; scenario: "rover" | "landing" | "mining"; best_site_id: string; best_site_name: string; rank: number; status: MatrixRow["status"]; confidence: number; reason: string }
export interface EarthMatch {
  ai?: { ai_score?: number; ai_low?: number; ai_high?: number; ai_sigma?: number; confident?: boolean; found_for?: string } | null;
  id: string; rank?: number; name: string; type: string; data_source?: string; lat: number; lon: number; elevation_m: number;
  morphology: string; mineral_profile: string; geology: string; similarity_score: number; epistemic_uncertainty: number;
  conformal_90_interval: [number, number]; pillar_scores: { topo: number | null; radar: number | null; mineral: number | null; thermal: number | null };
  parameter_similarities: Record<string, ParamSim>; representativeness_matrix: MatrixRow[];
  scenarios: Record<string, { status: string; score: number; uncertainty: number; conformal_interval: [number, number]; note: string }>;
  diurnal_sol_curve?: number[]; heightmap_url: string; radar_url: string;
  similarity_before_vegetation_rule?: number; vegetation_gate?: number; ndvi?: number; water_fraction?: number;
  contributions?: Contribution[]; why?: WhyInfo; field_readiness?: FieldReadiness;
}
export interface TargetInfo {
  id: string; name: string; body: "moon" | "mars"; lat: number; lon: number; elevation_m: number; gravity: number; pressure_bar: number; temp_min_c: number; temp_max_c: number;
  primary_challenge: string; diurnal_sol_curve?: number[]; heightmap_url: string; radar_url: string;
  artemis?: ArtemisInfo | null; illumination?: Illumination | null; night_ir?: NightIR | null; max_sun_elevation_deg?: number; custom?: CustomInfo;
}
export interface MatchPayload {
  search_time_ms: number; earth_sites_scanned: number; overall_best_id?: string; best_per_test?: BestPerTestRow[];
  target: TargetInfo;
  functional_rankings?: FunctionalRanking[];
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

const STATUS_WORD: Record<MatrixRow["status"], { word: string; level: "good" | "warn" | "bad" }> = {
  REPRESENTATIVE: { word: "Good Test Site", level: "good" },
  PARTIAL: { word: "Partly Useful", level: "warn" },
  NOT_REPRESENTATIVE: { word: "Not Useful For This", level: "bad" },
};

const nameOf = (feature: string, label: string) => PARAM_HELP[feature]?.name ?? label;

function DataNote({ m, world, t }: { m: EarthMatch; world: string; t: TargetInfo }) {
  const p = m.parameter_similarities;
  const terrainOk = p.slope_mean?.earth_status === "measured" && p.slope_mean?.space_status === "measured";
  const body = world === "the Moon" ? "the Moon" : "Mars";
  const bits: string[] = [];
  bits.push(terrainOk ? "The ground shape of both places comes from real NASA and ESA satellite elevation maps" : "Part of the terrain here is a placeholder shape");
  bits.push(p.temp_max_c?.space_status === "measured"
    ? `temperatures are measured on both worlds; ${body}'s rock and soil are not measured in our data, so they are left out of the score`
    : `${body}'s rock, soil and temperatures are not measured in our data, so only ground shape and texture are compared`);
  if (t.illumination) bits.push("sunlight and Earth view are modelled by Celestra from the Moon's terrain");
  return <p className="text-xs muted leading-relaxed border-l-2 pl-3" style={{ borderColor: "var(--accent)" }}><b style={{ color: "var(--text)" }}>Where the data comes from.</b> {bits.join("; ")}. The exact instruments are listed in Expert view.</p>;
}

interface Validation {
  earth_sites: number;
  negative_controls: { count: number; median_rank: number; share_in_bottom_half: number; best_rank_seen: number };
  negative_controls_without_vegetation_rule?: { median_rank: number; share_in_bottom_half: number; best_rank_seen: number };
  benchmarks: { count: number; median_rank: number; share_in_top_half: number };
  weight_sensitivity: { mean_top5_kept: number; min_top5_kept: number };
  score_range?: { median_width: number; method: string };
  baseline?: {
    description: string;
    plain: BaselineRow; plain_with_bare_ground_rule: BaselineRow; celestra: BaselineRow;
    rank_correlation_with_celestra: number;
  };
  bare_ground_threshold_sensitivity?: { ndvi_full_score_at: number; ndvi_zero_at: number; control_median_rank: number; control_share_bottom_half: number }[];
  cannot_show?: string[];
}
interface BaselineRow { control_median_rank: number; control_share_bottom_half: number; benchmark_median_rank: number; benchmark_share_top_half: number }

function BaselineTable({ b, sites }: { b: NonNullable<Validation["baseline"]>; sites: number }) {
  const rows: [string, string, BaselineRow][] = [
    ["Celestra", "four weighted groups + bare-ground rule", b.celestra],
    ["Plain distance", "all 14 values, equal weight", b.plain],
    ["Plain + bare-ground rule", "equal weight, same rule", b.plain_with_bare_ground_rule],
  ];
  const c = b.celestra, p = b.plain_with_bare_ground_rule;
  const beats = c.control_median_rank > p.control_median_rank && c.benchmark_median_rank < p.benchmark_median_rank;
  return (
    <div className="card-solid p-3">
      <div className="font-semibold mb-1">Does our weighting beat a plain distance?</div>
      <p className="muted mb-2">The same checks run with simpler scoring. Controls should rank low (high number, out of {sites}); benchmarks should rank high (low number).</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="muted text-left"><th className="font-normal pb-1">Scoring</th><th className="font-normal text-right">Controls, median rank</th><th className="font-normal text-right">Benchmarks, median rank</th></tr></thead>
          <tbody>{rows.map(([n, d, r]) => (
            <tr key={n} className="border-t line">
              <td className="py-1.5 pr-2"><div className="font-medium">{n}</div><div className="text-[11px] faint">{d}</div></td>
              <td className="text-right font-mono">{r.control_median_rank}<span className="faint"> · {Math.round(r.control_share_bottom_half * 100)}% low</span></td>
              <td className="text-right font-mono">{r.benchmark_median_rank}<span className="faint"> · {Math.round(r.benchmark_share_top_half * 100)}% high</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-2 leading-relaxed">{beats
        ? "Our weighting separates controls from benchmarks a little better than a plain distance with the same rule."
        : "Our weighting does not beat a plain distance. Most of the separating power comes from the bare-ground rule and the features themselves, not our weights."}{" "}
        <span className="muted">Rank agreement between Celestra and plain distance: {b.rank_correlation_with_celestra.toFixed(2)} (1 = identical order).</span></p>
    </div>
  );
}

function Evidence() {
  const [v, setV] = useState<Validation | null>(null);
  useEffect(() => { fetch(apiUrl("/api/validation")).then((r) => (r.ok ? r.json() : null)).then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const nc = v.negative_controls, raw = v.negative_controls_without_vegetation_rule, thr = v.bare_ground_threshold_sensitivity;
  return (
    <>
    <div className="card-solid p-3">
      <div className="font-semibold mb-1">Does the score mean anything? Checks across every target</div>
      <ul className="flex flex-col gap-1.5 mt-2">
        <li><b>Unsuitable control sites</b> (rainforest, wetland, farmland, polders): median rank {nc.median_rank} of {v.earth_sites}, {Math.round(nc.share_in_bottom_half * 100)}% in the bottom half{raw ? `. Without the bare-ground rule: median ${raw.median_rank}, ${Math.round(raw.share_in_bottom_half * 100)}% in the bottom half` : ""}. Best rank any control reached: {nc.best_rank_seen}.</li>
        <li><b>Established analog sites</b> used by space agencies: median rank {v.benchmarks.median_rank}, {Math.round(v.benchmarks.share_in_top_half * 100)}% in the top half. Each benchmark is an analog for particular targets, not all of them, so a middling average is expected.</li>
        <li><b>Weight sensitivity</b>: moving any one group weight by ±20% keeps on average {v.weight_sensitivity.mean_top5_kept} of the top 5 (never fewer than {v.weight_sensitivity.min_top5_kept}).</li>
        {v.score_range && <li><b>Score range</b>: {v.score_range.method} The median range across all pairs is ±{Math.round(v.score_range.median_width * 50)} points.</li>}
      </ul>
      {thr && thr.length > 0 && (() => {
        const meds = thr.map((x) => x.control_median_rank), lo = Math.min(...meds), hi = Math.max(...meds);
        const sh = thr.map((x) => x.control_share_bottom_half), shLo = Math.min(...sh), shHi = Math.max(...sh);
        const full = thr.map((x) => x.ndvi_full_score_at), zero = thr.map((x) => x.ndvi_zero_at);
        return <p className="mt-2"><b>Bare-ground rule thresholds</b>: across {thr.length} settings (full score at NDVI {Math.min(...full)}–{Math.max(...full)}, zero at {Math.min(...zero)}–{Math.max(...zero)}) the control median {lo === hi ? `stays ${lo} for every threshold tried` : `ranges from ${lo} to ${hi}`}; {Math.round(shLo * 100)}–{Math.round(shHi * 100)}% of controls stay in the bottom half.</p>;
      })()}
      <p className="muted mt-2">Reproduce with <code className="font-mono">python data-pipeline/03_validate.py</code>.</p>
    </div>
    {v.baseline && <BaselineTable b={v.baseline} sites={v.earth_sites} />}
    {v.cannot_show && v.cannot_show.length > 0 && (
      <div className="card-solid p-3">
        <div className="font-semibold mb-1">What This Validation Cannot Show</div>
        <ul className="flex flex-col gap-1.5 mt-1 list-disc pl-4 muted">{v.cannot_show.map((c) => <li key={c}>{c}</li>)}</ul>
      </div>
    )}
    </>
  );
}

type View = "use" | "ai" | "summary" | "twins" | "tests" | "day" | "measure" | "expert";

export default function AnalyticsView({ data, onBackToGlobe, onLaunchSimulator }: { data: MatchPayload; onBackToGlobe: () => void; onLaunchSimulator: (selectedMatch: EarthMatch) => void }) {
  const [selectedId, setSelectedId] = useState<string>(data.matches[0]?.id || "");
  const [filterText, setFilterText] = useState("");
  const [view, setView] = useState<View>("use");
  const [ai, setAi] = useState<{ id: string; data: AiDiscoveryData | null; error: string | null } | null>(null);
  const [showAi, setShowAi] = useState(true);
  const targetId = data.target.id;
  useEffect(() => {
    if (targetId.startsWith("custom_")) return;
    let live = true;
    fetch(apiUrl(`/api/discoveries/${targetId}`))
      .then(async (r) => { const j = await r.json().catch(() => null); if (!live) return; if (r.ok) setAi({ id: targetId, data: j as AiDiscoveryData, error: null }); else setAi({ id: targetId, data: null, error: j?.detail ?? "AI search not available." }); })
      .catch(() => { if (live) setAi({ id: targetId, data: null, error: "AI search not available (backend not reachable)." }); });
    return () => { live = false; };
  }, [targetId]);
  const aiData = ai && ai.id === targetId ? ai.data : null;
  const aiError = ai && ai.id === targetId ? ai.error : null;

  const m = useMemo(() => data.matches.find((x) => x.id === selectedId) || data.matches[0], [data.matches, selectedId]);
  const t = data.target;
  const world = t.body === "moon" ? "the Moon" : "Mars";

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return data.matches;
    return data.matches.filter((x) => x.name.toLowerCase().includes(q) || x.mineral_profile.toLowerCase().includes(q) || x.type.toLowerCase().includes(q));
  }, [data.matches, filterText]);

  const pins: GlobePin[] = useMemo(() => data.matches.filter((x) => showAi || x.type !== "ai_discovery").map((x, i) => (x.type === "ai_discovery"
    ? { id: x.id, rank: x.rank || i + 1, name: x.name, lat: x.lat, lon: x.lon, tone: "ai" as const, subtitle: `${PCT(x.similarity_score)} match${x.ai?.ai_score != null ? ` · AI ${PCT(x.ai.ai_score)} (${PCT(x.ai.ai_low ?? 0)}–${PCT(x.ai.ai_high ?? 0)})` : ""}`, badge: x.ai?.confident ? "AI find · confident" : "AI find" }
    : { id: x.id, rank: x.rank || i + 1, name: x.name, lat: x.lat, lon: x.lon, subtitle: `${PCT(x.similarity_score)} match` })), [data.matches, showAi]);
  const nAi = data.matches.filter((x) => x.type === "ai_discovery").length;

  // plain-language summary pieces
  const sw = similarityWord(m.similarity_score);
  const pillarsSorted = [...PILLARS].filter((p) => m.pillar_scores[p.key] !== null).sort((a, b) => (m.pillar_scores[b.key] ?? 0) - (m.pillar_scores[a.key] ?? 0));
  const best = pillarsSorted[0], worst = pillarsSorted[pillarsSorted.length - 1];
  const good = m.representativeness_matrix.filter((r) => r.status === "REPRESENTATIVE");
  const partial = m.representativeness_matrix.filter((r) => r.status === "PARTIAL");
  const bad = m.representativeness_matrix.filter((r) => r.status === "NOT_REPRESENTATIVE");
  const ask = (test: string) => TEST_HELP[test]?.ask ?? test;

  const isCustom = t.id.startsWith("custom_") || !!t.custom;
  const sunlightPanel = <SunlightPanel body={t.body} illumination={t.illumination} nightIr={t.night_ir} maxSun={t.max_sun_elevation_deg} />;
  const sunlight = t.illumination || t.night_ir || (t.body === "moon" && (t.max_sun_elevation_deg ?? 99) < 15) ? sunlightPanel : null;
  const rankings = data.functional_rankings ?? [];

  const targetCurve = t.diurnal_sol_curve || [], earthCurve = m.diurnal_sol_curve || [];
  const lo = Math.min(...targetCurve, ...earthCurve, -240), hi = Math.max(...targetCurve, ...earthCurve, 120);
  const yPct = (v: number) => Math.round(((v - lo) / (hi - lo || 1)) * 100);

  const params = Object.entries(m.parameter_similarities);
  const byPillar = (key: string) => params.filter(([, p]) => p.pillar === key);

  return (
    <div className="relative z-10 flex-1 flex flex-col gap-4 p-4 max-w-[1750px] w-full mx-auto">
      <div className="card px-4 py-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={onBackToGlobe} className="btn btn-sm shrink-0"><ArrowLeft className="w-3.5 h-3.5" /> Back to {world}</button>
            <div className="min-w-0">
              <div className="text-sm font-semibold flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Earth sites that behave like {t.name}</span>
                <ArtemisBadge a={t.artemis} />
                {isCustom && <span className="badge">Your point</span>}
              </div>
              <div className="text-xs muted">{data.earth_sites_scanned} sites compared · {t.gravity} m/s² · {t.pressure_bar} bar · {t.temp_min_c}°C to {t.temp_max_c}°C</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isCustom && (
              <a className="btn" href={apiUrl(`/api/brief/${encodeURIComponent(t.id)}#print`)} target="_blank" rel="noopener noreferrer" data-tour="brief" title="A printable one-page plan for a test campaign at the top sites">
                <FileText className="w-4 h-4" /> Field Brief (PDF)
              </a>
            )}
            <button type="button" onClick={() => onLaunchSimulator(m)} className="btn btn-primary" data-tour="launch"><Play className="w-4 h-4" /> Test hardware at #{m.rank || 1} in the simulator</button>
          </div>
        </div>
        {(t.artemis || t.custom || sunlight) && (
          <div className={`grid grid-cols-1 gap-x-6 gap-y-3 pt-3 border-t line ${(t.artemis || t.custom) && sunlight ? "lg:grid-cols-2" : ""}`}>
            {t.artemis && (
              <div className="text-xs leading-relaxed min-w-0">
                <div><span className="font-semibold">{t.artemis.status === "artemis_iii_2024" ? "NASA Artemis III candidate region" : "Former Artemis III candidate region"}:</span> {t.artemis.region.replace(/\s*\(.*\)\s*$/, "")}{t.artemis.feature && t.artemis.feature !== t.artemis.region ? `, near ${t.artemis.feature}` : ""}.{t.artemis.status === "artemis_iii_2022_only" ? " On NASA's 2022 list, not on the October 2024 list." : ""}</div>
                {t.artemis.placement && <p className="muted mt-1">{t.artemis.placement}</p>}
              </div>
            )}
            {t.custom && (
              <div className="text-xs leading-relaxed min-w-0">
                <div><span className="font-semibold">A point you picked</span> at {Math.abs(t.lat).toFixed(2)}°{t.lat >= 0 ? "N" : "S"}, {Math.abs(t.lon).toFixed(2)}°{t.lon >= 0 ? "E" : "W"}.</div>
                <p className="muted mt-1">Ground shape measured live from NASA&apos;s elevation maps; {t.body === "moon" ? "temperatures are measured too; rock and soil are not, so they are not scored." : "rock, soil and temperatures are not measured here, so only ground shape and texture are scored."}{t.custom.terrain_offset_km > 0.5 ? ` The nearest elevation data was ${t.custom.terrain_offset_km.toFixed(1)} km from your point.` : ""}</p>
              </div>
            )}
            {sunlight}
          </div>
        )}
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
            {nAi > 0 && <button type="button" data-tour="ai-finds" className="absolute bottom-3 left-3 z-10 btn btn-sm" onClick={() => setShowAi((v) => !v)} aria-pressed={showAi}><span className="w-2 h-2 rounded-full" style={{ background: "#c084fc" }} /> {showAi ? "Hide" : "Show"} AI finds ({nAi})</button>}
          </div>

          <div className="card p-4 flex-1 flex flex-col" data-tour="ranked">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-semibold">All {data.matches.length} sites, best first</span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 faint" />
                <input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Filter by name or rock type" className="input" style={{ paddingLeft: 28 }} />
              </div>
            </div>
            <p className="text-xs muted mb-2">Score out of 100 · the smaller the ±, the surer the score</p>
            <div className="relative flex-1 min-h-[340px]"><div className="absolute inset-0 flex flex-col gap-1 overflow-y-auto pr-1">
              {filtered.map((x) => {
                const rank = x.rank || 1;
                return (
                  <button key={x.id} type="button" onClick={() => setSelectedId(x.id)} className="row flex items-center justify-between gap-2" aria-pressed={x.id === m.id}>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold flex items-center gap-1.5 truncate"><span className="font-mono muted">#{rank}</span>{x.type === "ai_discovery" && <span className="status shrink-0" style={{ background: "rgba(192,132,252,0.15)", color: "#c084fc" }}>AI find</span>}<span className="truncate">{x.name.replace(/^AI find /, "")}</span></div>
                      <div className="text-[11px] muted mt-0.5">{x.type === "ai_discovery" ? (x.ai?.ai_score != null ? `unnamed place · AI guessed ${Math.round(x.ai.ai_score * 100)} (${Math.round((x.ai.ai_low ?? 0) * 100)}–${Math.round((x.ai.ai_high ?? 0) * 100)})` : "unnamed place · found by the AI search, measured exactly") : `${x.mineral_profile.replace(/_/g, " ")} · ${x.lat.toFixed(1)}°, ${x.lon.toFixed(1)}°`}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold font-mono">{Math.round(x.similarity_score * 100)}</div>
                      <div className="text-[11px] font-mono muted">±{Math.round(x.epistemic_uncertainty * 100)}</div>
                    </div>
                  </button>
                );
              })}
            </div></div>
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
                <div className="text-[11px] muted mt-1" title="Lowest and highest score if any one measurement is left out or a group weight moves by 20%">range {Math.round(m.conformal_90_interval[0] * 100)}–{Math.round(m.conformal_90_interval[1] * 100)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 mt-4 border-t line">
              {PILLARS.map((p) => { const v = m.pillar_scores[p.key]; return (
                <div key={p.key} title={v === null ? `${p.label}: ${notComparedReason(p.key, t.body)}` : p.what}>
                  <div className="flex justify-between text-xs mb-1"><span className={`font-medium ${v === null ? "faint" : ""}`}>{p.label}</span><span className="font-mono muted">{v === null ? "not compared" : Math.round(v * 100)}</span></div>
                  {v === null ? <div className="h-1.5 rounded-full unverified" /> : <Bar value={v} />}
                </div>
              ); })}
            </div>
            {PILLARS.some((p) => m.pillar_scores[p.key] === null) && (
              <div className="mt-3 flex flex-col gap-1">
                {PILLARS.filter((p) => m.pillar_scores[p.key] === null).map((p) => (
                  <p key={p.key} className="text-[11px] muted leading-relaxed"><b>{p.label}, not compared:</b> {notComparedReason(p.key, t.body)}</p>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5 flex-1 flex flex-col">
            <Tabs<View> value={view} onChange={setView} tour="view-tabs" items={[
              { id: "use", label: "By Use", hint: "best site for each test" },
              ...(t.id.startsWith("custom_") ? [] : [{ id: "ai" as View, label: "AI Discoveries", hint: "new places, whole Earth" }]),
              { id: "summary", label: "Summary", hint: "why this site matches" },
              { id: "twins", label: "Terrain Twins", hint: "both grounds side by side" },
              { id: "tests", label: "Tests", hint: "what you can test here" },
              { id: "day", label: "Day & night", hint: "temperatures hour by hour" },
              { id: "measure", label: "Measurements", hint: "all 14 values explained" },
              { id: "expert", label: "Expert view", hint: "uncertainty and sources" },
            ]} />

            <div className="pt-4 flex-1 overflow-y-auto" key={view}>
              {view === "summary" && (
                <div className="flex flex-col gap-4 rise" data-tour="summary">
                  <DataNote m={m} world={world} t={t} />
                  {m.vegetation_gate !== undefined && m.vegetation_gate < 1 && (
                    <p className="text-xs leading-relaxed" style={{ color: "var(--warn)" }}>The bare-ground rule cut this site&apos;s score{m.vegetation_gate === 0 ? " to zero" : ` to ${Math.round(m.vegetation_gate * 100)}%`}: satellites see {m.ndvi !== undefined && m.ndvi > 0.2 ? "plants growing here" : ""}{m.ndvi !== undefined && m.ndvi > 0.2 && (m.water_fraction ?? 0) > 0.2 ? " and " : ""}{(m.water_fraction ?? 0) > 0.2 ? `${Math.round((m.water_fraction ?? 0) * 100)}% open water` : ""}. The Moon and Mars have neither. Before the rule it scored {Math.round((m.similarity_before_vegetation_rule ?? 0) * 100)}.</p>
                  )}
                  <p className="text-[15px] leading-relaxed">
                    <b>{m.name}</b> is <Status level={sw.level}>{sw.word}</Status> to {t.name} overall, with a match score of <b>{Math.round(m.similarity_score * 100)} out of 100</b>.
                    It resembles the destination most in <b>{best.label.toLowerCase()}</b> ({Math.round((m.pillar_scores[best.key] ?? 0) * 100)}) and least in <b>{worst.label.toLowerCase()}</b> ({Math.round((m.pillar_scores[worst.key] ?? 0) * 100)}).
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
                  <WhyThisMatch contributions={m.contributions} why={m.why} score={m.similarity_score} nameOf={nameOf} body={t.body} />
                  <FieldReadinessCard fr={m.field_readiness} name={m.name} />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Kpi label="Gravity" value={`${t.gravity} m/s²`} sub={`Earth is 9.81, so ${(9.81 / t.gravity).toFixed(1)}× stronger`} />
                    <Kpi label="Air pressure" value={`${t.pressure_bar} bar`} sub={t.pressure_bar < 0.05 ? "effectively vacuum: no air cooling, no plume damping" : "thin atmosphere"} />
                    <Kpi label="Temperatures there" value={`${t.temp_min_c}° to ${t.temp_max_c}°C`} sub={m.parameter_similarities.temp_max_c?.space_status === "measured" ? `daily swing ${Math.round(t.temp_max_c - t.temp_min_c)}°C · LRO Diviner` : "typical range, not measured · not scored"} />
                    <Kpi label="Temperatures here" value={`${m.parameter_similarities.temp_min_c?.earth_val}° to ${m.parameter_similarities.temp_max_c?.earth_val}°C`} sub={`daily swing ${m.parameter_similarities.temp_delta_c?.earth_val}°C`} />
                  </div>
                  <p className="text-xs muted leading-relaxed">
                    How to read the score: it compares the measurements that exist for both sites (up to 14), grouped as above and weighted terrain shape 30%, surface texture 30%, rock and soil 25%, day-night heat 15%, renormalised over the groups that were compared. Groups marked &quot;not compared&quot; have no measurement for the destination and are left out rather than guessed. The ± is how far the score moves if any one measurement is dropped or a weight shifts by 20%. Temperatures are compared by pattern after standardisation, never by raw value.
                  </p>
                </div>
              )}

              {view === "tests" && (
                <div className="flex flex-col gap-2.5 rise">
                  <p className="text-xs muted">{m.representativeness_matrix.length} common hardware tests. For each: can this Earth site stand in for {t.name}?</p>
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

              {view === "ai" && (
                <AiDiscoveries data={aiData} error={aiError} world={t.name} body={t.body} selected={m.type === "ai_discovery" ? m.id : null} onSelect={(id) => { if (data.matches.some((x) => x.id === id)) setSelectedId(id); }} topNamedScore={data.matches.find((x) => x.type !== "ai_discovery")?.similarity_score} />
              )}
              {view === "use" && rankings.length > 0 && (
                <ByUseView rankings={rankings} selectedId={m.id} onSelect={setSelectedId}
                  best={data.matches[0] ? { id: data.matches[0].id, name: data.matches[0].name, score: Math.round(data.matches[0].similarity_score * 100), total: data.matches.length } : undefined} />
              )}

              {view === "twins" && (
                <TerrainTwins left={{ url: t.heightmap_url, name: t.name, kind: t.body }} right={{ url: m.heightmap_url, name: m.name, kind: "earth" }} />
              )}

              {view === "use" && rankings.length === 0 && (
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
                  <p className="text-xs muted leading-relaxed">One local day on each world, stretched to the same width: a day on the Moon lasts about 29.5 Earth days, a day on Mars 24 h 40 min, a day on Earth 24 h. So the bars line up by <b>position in each world&apos;s own day</b> (local midnight, noon, midnight), never by clock time. The coldest and warmest values are measured; the curve between them is drawn with a simple day-night model for illustration and is <b>not scored</b>.</p>
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
                          <div className="absolute -top-9 left-1/2 -translate-x-1/2 hidden group-hover:block card-solid px-2 py-1 text-[10px] font-mono whitespace-nowrap z-20">{Math.round((hr / 24) * 100)}% through the local day · {tt}°C vs {et}°C</div>
                        </div>
                      ); })}
                    </div>
                    <div className="flex justify-between text-[11px] muted mt-2"><span>local midnight</span><span>sunrise</span><span>local noon</span><span>sunset</span><span>midnight</span></div>
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
                        {byPillar(p.key).map(([key, v]) => { const h = PARAM_HELP[key], cmp = v.similarity !== null && v.compared !== false, w = cmp ? similarityWord(v.similarity as number) : { level: "warn" as const, word: "Not compared" }; return (
                          <div key={key} className="card-solid p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0"><div className="text-sm font-medium">{h?.name ?? v.label}</div><div className="text-[11px] muted">{h?.what}</div></div>
                              <div className="shrink-0 text-right"><Status level={w.level}>{w.word}</Status></div>
                            </div>
                            {cmp ? <div className="mt-2"><Bar value={v.similarity as number} colour={w.level === "good" ? "var(--good)" : w.level === "warn" ? "var(--warn)" : "var(--bad)"} /></div>
                              : <p className="text-[11px] muted mt-2">Not in the score. {notComparedReason(p.key, t.body)}</p>}
                            <div className="flex flex-wrap justify-between text-[11px] font-mono mt-1.5">
                              <span style={{ color: "var(--earth)" }}>Earth {v.earth_val} {v.unit}</span>
                              <span style={{ color: "var(--space)" }}>{world} {v.target_val} {v.unit}</span>
                            </div>
                            <div className="flex flex-wrap justify-between items-center gap-2 mt-1.5 text-[11px]">
                              <span className="flex items-center gap-1.5"><SourceTag s={v.earth_status} /><span className="faint truncate max-w-[220px]" title={v.earth_instrument}>{v.earth_agency && v.earth_agency !== "none" ? `${v.earth_agency} satellite` : "–"}</span></span>
                              <span className="flex items-center gap-1.5"><span className="faint truncate max-w-[220px]" title={v.space_instrument}>{v.space_agency && v.space_agency !== "none" ? `${v.space_agency} orbiter` : "–"}</span><SourceTag s={v.space_status} /></span>
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
                  <p className="muted leading-relaxed">How the numbers are made. Only measurements that exist for both sites are compared. Each is standardised across the sites that have it measured (z-scores), the two sites are compared with exp(−0.55·|Δz|), those are averaged within each group, and the groups that were compared are blended with the weights below (renormalised). That blend is the match score. The range shows how far the score moves if any one measurement is left out or any group weight shifts by 20%.</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Kpi label="Similarity" value={m.similarity_score.toFixed(3)} sub="The match score before rounding: weighted mean of the four group means." />
                    <Kpi label="Groups compared" value={`${(m as EarthMatch & { groups_compared?: string[] }).groups_compared?.length ?? 4} of 4`} sub="Groups with a measurement on both sides. The others are shown but not scored." />
                    <Kpi label="Score range" value={`${m.conformal_90_interval[0].toFixed(2)}–${m.conformal_90_interval[1].toFixed(2)}`} sub="Lowest and highest score if any one measurement is dropped or any group weight moves ±20%." />
                    <Kpi label="Search time" value={`${data.search_time_ms} ms`} sub={`Time to compare all ${data.earth_sites_scanned} Earth sites on the server.`} />
                  </div>
                  <Evidence />
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
                  <p className="muted leading-relaxed">Limits worth stating. Terrain is measured for every site (Copernicus DEM on Earth, LRO LOLA gridded DEMs on the Moon, MRO HiRISE DTMs on Mars, the latter two from NASA PDS). Surface texture is computed from that terrain, not from radar. Surface composition is measured by Sentinel-2 on Earth; it is not measured for the Moon or Mars in our data, so it is not scored there. Temperatures are measured surface temperatures on Earth (MODIS, NASA Worldview) and the Moon (LRO Diviner); Mars temperatures are not measured here and are not scored. Diviner bins are 0.5° (about 15 km), coarser than the 2 km terrain tiles.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
