"use client";

import React, { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Cpu,
  Globe,
  Play,
  ArrowLeft,
  SlidersHorizontal,
  Trophy,
  Search,
  Sun,
  Fingerprint,
  ShieldCheck,
} from "lucide-react";
import type { GlobePin } from "@/components/PlanetGlobe";

const PlanetGlobe = dynamic(() => import("@/components/PlanetGlobe"), { ssr: false });

export interface ParamSim {
  label: string;
  unit: string;
  pillar: string;
  similarity: number;
  target_val: number;
  earth_val: number;
  earth_agency?: string;
  earth_instrument?: string;
  space_agency?: string;
  space_instrument?: string;
  status?: "measured" | "derived" | "calibrated";
}

export interface MatrixRow {
  test: string;
  scenario: "rover" | "landing" | "mining";
  status: "REPRESENTATIVE" | "PARTIAL" | "NOT_REPRESENTATIVE";
  confidence: number;
  reason: string;
}

export interface BestPerTestRow {
  test: string;
  scenario: "rover" | "landing" | "mining";
  best_site_id: string;
  best_site_name: string;
  rank: number;
  status: "REPRESENTATIVE" | "PARTIAL" | "NOT_REPRESENTATIVE";
  confidence: number;
  reason: string;
}

export interface EarthMatch {
  id: string;
  rank?: number;
  name: string;
  type: string;
  data_source?: string;
  lat: number;
  lon: number;
  elevation_m: number;
  morphology: string;
  mineral_profile: string;
  geology: string;
  similarity_score: number;
  epistemic_uncertainty: number;
  conformal_90_interval: [number, number];
  pillar_scores: { topo: number; radar: number; mineral: number; thermal: number };
  parameter_similarities: Record<string, ParamSim>;
  representativeness_matrix: MatrixRow[];
  scenarios: Record<string, { status: string; score: number; uncertainty: number; conformal_interval: [number, number]; note: string }>;
  diurnal_sol_curve?: number[];
  heightmap_url: string;
  radar_url: string;
}

export interface MatchPayload {
  search_time_ms: number;
  earth_sites_scanned: number;
  overall_best_id?: string;
  best_per_test?: BestPerTestRow[];
  target: {
    id: string;
    name: string;
    body: "moon" | "mars";
    lat: number;
    lon: number;
    elevation_m: number;
    gravity: number;
    pressure_bar: number;
    temp_min_c: number;
    temp_max_c: number;
    primary_challenge: string;
    diurnal_sol_curve?: number[];
    heightmap_url: string;
    radar_url: string;
  };
  matches: EarthMatch[];
}

const SHORT_LABELS = ["Slope", "Radar", "Tilt", "Plume", "Drill", "Cool"];

export default function AnalyticsView({
  data,
  onBackToGlobe,
  onLaunchSimulator,
}: {
  data: MatchPayload;
  onBackToGlobe: () => void;
  onLaunchSimulator: (selectedMatch: EarthMatch) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(data.matches[0]?.id || "");
  const [filterText, setFilterText] = useState("");
  const [activeTab, setActiveTab] = useState<"matrix" | "best" | "sol" | "fingerprint">("matrix");

  const activeMatch = useMemo(
    () => data.matches.find((m) => m.id === selectedId) || data.matches[0],
    [data.matches, selectedId]
  );

  const filteredMatches = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return data.matches;
    return data.matches.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.mineral_profile.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q)
    );
  }, [data.matches, filterText]);

  const earthPins: GlobePin[] = useMemo(
    () =>
      data.matches.map((m, idx) => ({
        id: m.id,
        rank: m.rank || idx + 1,
        name: m.name,
        lat: m.lat,
        lon: m.lon,
        subtitle: `${(m.similarity_score * 100).toFixed(1)}% Match (±${(m.epistemic_uncertainty * 100).toFixed(1)}%)`,
        miniMatrix: m.representativeness_matrix.map((row, rIdx) => ({
          shortLabel: SHORT_LABELS[rIdx] || `T${rIdx + 1}`,
          status: row.status,
        })),
      })),
    [data.matches]
  );

  const matrixBadge = (status: MatrixRow["status"]) => {
    if (status === "REPRESENTATIVE") {
      return {
        cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
        icon: CheckCircle2,
        label: "REPRESENTATIVE",
      };
    }
    if (status === "PARTIAL") {
      return {
        cls: "bg-amber-500/15 text-amber-300 border-amber-500/40",
        icon: AlertTriangle,
        label: "PARTIAL",
      };
    }
    return {
      cls: "bg-rose-500/15 text-rose-300 border-rose-500/40",
      icon: XCircle,
      label: "NOT REPRESENTATIVE",
    };
  };

  // 24-Hour Diurnal Sol Thermal Curve math
  const targetCurve = data.target.diurnal_sol_curve || [];
  const earthCurve = activeMatch.diurnal_sol_curve || [];
  const minTempAll = Math.min(...targetCurve, ...earthCurve, -240);
  const maxTempAll = Math.max(...targetCurve, ...earthCurve, 120);

  const toYPercent = (temp: number) => {
    const range = maxTempAll - minTempAll || 1;
    return Math.round(100 - ((temp - minTempAll) / range) * 100);
  };

  return (
    <div className="relative z-10 flex-1 flex flex-col gap-4 p-5 max-w-[1750px] w-full mx-auto">
      {/* Top Action Bar */}
      <div className="glass-card rounded-2xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToGlobe}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700 cursor-pointer transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to {data.target.body.toUpperCase()} Globe
          </button>
          <div>
            <div className="text-xs font-mono text-cyan-400">
              STRICT MULTI-AGENCY COMPLIANCE • {data.earth_sites_scanned} EARTH LOCATIONS RANKED IN {data.search_time_ms} MS
            </div>
            <div className="text-sm font-bold text-white">
              Target: {data.target.name} ({data.target.gravity} m/s² • {data.target.pressure_bar} bar)
            </div>
          </div>
        </div>

        <button
          onClick={() => onLaunchSimulator(activeMatch)}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-extrabold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/20 cursor-pointer transition"
        >
          <Play className="w-4 h-4 fill-current" />
          Launch 3D Simulator with Rank #{activeMatch.rank || 1}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1">
        {/* LEFT (5 cols): 3D Earth Globe (60 Pins) + Full Ranked List */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="glass-card rounded-[28px] overflow-hidden relative h-[400px]">
            <div className="absolute top-3 left-3 z-10 glass-chip px-3 py-1.5">
              <div className="text-xs font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" /> EARTH GLOBE ({data.matches.length} PINS)
              </div>
              <div className="text-[10px] text-slate-300/80">Top 3 are labelled • Select a site and the globe turns to it</div>
            </div>

            <PlanetGlobe
              body="earth"
              pins={earthPins}
              selectedPinId={activeMatch.id}
              onSelectPin={(id) => setSelectedId(id)}
            />
          </div>

          <div className="glass-card rounded-3xl p-4 flex-1 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                All {data.matches.length} Ranked Locations
              </span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Filter (e.g. UAE, basalt, crater)..."
                  className="pl-7 pr-3 py-1 rounded-lg bg-slate-950/70 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto pr-1">
              {filteredMatches.map((m) => {
                const isSelected = m.id === activeMatch.id;
                const rank = m.rank || 1;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? "bg-cyan-300/15 border-cyan-200/60 text-white shadow-[0_0_24px_-6px_rgba(103,232,249,0.6)]"
                        : "bg-white/[0.03] border-white/10 text-slate-300 hover:border-white/30 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="pr-2 min-w-0">
                      <div className="text-xs font-bold flex items-center gap-1.5 truncate">
                        <span className={`font-mono ${rank <= 5 ? "text-emerald-400" : "text-slate-400"}`}>#{rank}</span>
                        <span className="truncate">{m.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {m.lat.toFixed(2)}°, {m.lon.toFixed(2)}° • {m.mineral_profile.replace(/_/g, " ")}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-xs font-mono font-bold ${rank <= 5 ? "text-emerald-400" : "text-cyan-400"}`}>
                        {(m.similarity_score * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] font-mono text-amber-300">
                        ±{(m.epistemic_uncertainty * 100).toFixed(1)}%
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT (7 cols): Summary, Pillars & 4 Analytical Tabs */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="glass-card rounded-3xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
              <div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase flex items-center gap-1 w-fit">
                  <ShieldCheck className="w-3 h-3" />
                  Rank #{activeMatch.rank || 1} • Authorized Agency Data
                </span>
                <h2 className="text-xl font-bold text-white mt-1.5">{activeMatch.name}</h2>
                <p className="text-xs text-slate-400 mt-1">{activeMatch.geology}</p>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3 text-right font-mono shrink-0">
                <div className="text-[10px] text-slate-400">OVERALL SIMILARITY (90% CONFORMAL CI)</div>
                <div className="text-2xl font-extrabold text-cyan-400">
                  {(activeMatch.similarity_score * 100).toFixed(1)}%
                  <span className="text-xs text-amber-300 ml-1.5">
                    ±{(activeMatch.epistemic_uncertainty * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">
                  Interval: [{(activeMatch.conformal_90_interval[0] * 100).toFixed(1)}% – {(activeMatch.conformal_90_interval[1] * 100).toFixed(1)}%]
                </div>
              </div>
            </div>

            {/* 4 Pillars with Agency Labels */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800/80">
              {[
                { key: "topo", label: "Topography", agency: "ESA GLO-30m" },
                { key: "radar", label: "Radar", agency: "CSA RADARSAT" },
                { key: "mineral", label: "Minerals", agency: "ESA Sentinel-2" },
                { key: "thermal", label: "Thermal", agency: "NASA MODIS / JAXA" },
              ].map((p) => {
                const val = activeMatch.pillar_scores[p.key as keyof typeof activeMatch.pillar_scores];
                return (
                  <div key={p.key} className="bg-slate-950/50 rounded-xl p-2.5 border border-slate-800/70">
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span className="text-slate-300 font-semibold">{p.label}</span>
                      <span className="font-mono font-bold text-cyan-300">{(val * 100).toFixed(0)}%</span>
                    </div>
                    <div className="text-[9px] font-mono text-slate-400 mb-1.5">{p.agency}</div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-400" style={{ width: `${val * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4 Analytical Tabs */}
          <div className="glass-card rounded-3xl p-5 flex-1 flex flex-col">
            <div className="flex flex-wrap items-center gap-2 mb-4 border-b border-slate-800/80 pb-3">
              <button
                onClick={() => setActiveTab("matrix")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                  activeTab === "matrix" ? "bg-cyan-500 text-slate-950" : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Cpu className="w-3.5 h-3.5" /> Representativeness Matrix
              </button>
              <button
                onClick={() => setActiveTab("best")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                  activeTab === "best" ? "bg-emerald-400 text-slate-950" : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Trophy className="w-3.5 h-3.5" /> Best Per Test
              </button>
              <button
                onClick={() => setActiveTab("sol")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                  activeTab === "sol" ? "bg-amber-400 text-slate-950" : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Sun className="w-3.5 h-3.5" /> 24-Hour Diurnal Sol Ribbon
              </button>
              <button
                onClick={() => setActiveTab("fingerprint")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                  activeTab === "fingerprint" ? "bg-indigo-400 text-slate-950" : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Fingerprint className="w-3.5 h-3.5" /> 14-Param Fingerprint &amp; Provenance
              </button>
            </div>

            {/* TAB 1: REPRESENTATIVENESS MATRIX */}
            {activeTab === "matrix" && (
              <div className="flex flex-col gap-2.5 overflow-y-auto">
                {activeMatch.representativeness_matrix.map((row, i) => {
                  const badge = matrixBadge(row.status);
                  const Icon = badge.icon;
                  return (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-2">
                          {row.test}
                          <span className="text-[10px] font-mono text-slate-500 uppercase">[{row.scenario}]</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{row.reason}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-mono text-slate-400">Conf: {(row.confidence * 100).toFixed(0)}%</span>
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-mono border flex items-center gap-1 ${badge.cls}`}>
                          <Icon className="w-3 h-3" /> {badge.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* TAB 2: BEST PER TEST */}
            {activeTab === "best" && (
              <div className="flex flex-col gap-3 overflow-y-auto">
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono text-emerald-300 uppercase flex items-center gap-1">
                      <Trophy className="w-3.5 h-3.5" /> Overall Best Earth Testbed (All 4 Pillars Combined)
                    </div>
                    <div className="text-base font-bold text-white mt-0.5">{data.matches[0]?.name}</div>
                    <div className="text-xs font-mono text-emerald-300">
                      {(data.matches[0]?.similarity_score * 100).toFixed(1)}% Overall Match • Rank #1 of 60
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedId(data.matches[0].id)}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    Select #1 Site
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  {(data.best_per_test || []).map((item, idx) => {
                    const badge = matrixBadge(item.status);
                    const Icon = badge.icon;
                    return (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div>
                          <div className="text-[10px] font-mono text-cyan-400 uppercase">{item.test}</div>
                          <div className="text-xs font-bold text-white mt-0.5">
                            Best Match: #{item.rank} {item.best_site_name}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">{item.reason}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-1 rounded-lg text-[10px] font-mono border flex items-center gap-1 ${badge.cls}`}>
                            <Icon className="w-3 h-3" /> {badge.label}
                          </span>
                          <button
                            onClick={() => setSelectedId(item.best_site_id)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-cyan-300 font-semibold cursor-pointer"
                          >
                            Inspect
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 3: 24-HOUR DIURNAL SOL THERMAL RIBBON */}
            {activeTab === "sol" && (
              <div className="flex flex-col gap-3 overflow-y-auto">
                <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-cyan-400" />
                      <span>{data.target.body.toUpperCase()}: {data.target.temp_min_c}°C to {data.target.temp_max_c}°C (NASA Diviner/THEMIS)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-emerald-400" />
                      <span>EARTH: {activeMatch.parameter_similarities.temp_min_c.earth_val}°C to {activeMatch.parameter_similarities.temp_max_c.earth_val}°C (MODIS / JAXA)</span>
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-amber-300">
                    DIURNAL SWING ΔT: Space {data.target.temp_max_c - data.target.temp_min_c}°C vs Earth {activeMatch.parameter_similarities.temp_delta_c.earth_val}°C
                  </div>
                </div>

                {/* 24-Hour Visual Heat Ribbon */}
                <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800 flex flex-col gap-3">
                  <div className="text-[11px] font-mono text-slate-400 flex justify-between">
                    <span>00:00 (Midnight Chill)</span>
                    <span>06:00 (Dawn)</span>
                    <span>12:00 (Solar Peak)</span>
                    <span>18:00 (Dusk)</span>
                    <span>23:00 (Night)</span>
                  </div>

                  {/* Ribbon Hourly Columns */}
                  <div className="grid grid-cols-24 gap-1 h-28 items-end p-2 bg-slate-900/60 rounded-xl border border-slate-800/80">
                    {targetCurve.map((tTemp, hr) => {
                      const eTemp = earthCurve[hr] ?? 20;
                      const tHeight = Math.max(8, 100 - toYPercent(tTemp));
                      const eHeight = Math.max(8, 100 - toYPercent(eTemp));
                      return (
                        <div key={hr} className="h-full flex items-end justify-center gap-0.5 group relative">
                          <div
                            className="w-full bg-cyan-400/80 rounded-t-sm transition-all"
                            style={{ height: `${tHeight}%` }}
                          />
                          <div
                            className="w-full bg-emerald-400/80 rounded-t-sm transition-all"
                            style={{ height: `${eHeight}%` }}
                          />
                          {/* Hover Tooltip */}
                          <div className="absolute -top-10 left-1/2 -translate-x-1/2 hidden group-hover:flex px-2 py-1 bg-slate-950 border border-slate-700 text-[9px] font-mono rounded whitespace-nowrap z-20 shadow-lg">
                            Hr {hr}:00 | {data.target.body.slice(0, 1).toUpperCase()}:{tTemp}°C | E:{eTemp}°C
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[11px] text-slate-400 leading-relaxed font-mono">
                    <b className="text-amber-400">PHYSICS CAVEAT:</b> On Earth, air convection continuously dissipates heat from rover motors and drilling rigs. In the {data.target.pressure_bar} bar space vacuum, radiative cooling is weak, causing equipment to store heat rapidly and seize.
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: 14-PARAMETER FINGERPRINT GLYPH & MULTI-AGENCY PROVENANCE */}
            {activeTab === "fingerprint" && (
              <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
                <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between pb-1 px-1">
                  <span>PARAMETER (14 TOTAL)</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> measured</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> derived</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" /> calibrated</span>
                  </div>
                </div>

                {Object.entries(activeMatch.parameter_similarities).map(([key, p]) => {
                  const statusDot =
                    p.status === "measured"
                      ? "bg-emerald-400"
                      : p.status === "derived"
                      ? "bg-amber-400"
                      : "bg-cyan-400";

                  return (
                    <div
                      key={key}
                      className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
                          <span className="font-bold text-white">{p.label}</span>
                          <span className="text-[10px] font-mono text-slate-500 uppercase">[{p.pillar}]</span>
                        </div>
                        <span className="font-mono font-bold text-cyan-400">{(p.similarity * 100).toFixed(1)}%</span>
                      </div>

                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            p.similarity >= 0.75 ? "bg-emerald-400" : p.similarity >= 0.45 ? "bg-amber-400" : "bg-rose-400"
                          }`}
                          style={{ width: `${p.similarity * 100}%` }}
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between text-[10px] font-mono text-slate-400 gap-1">
                        <div>
                          <span className="text-emerald-300 font-semibold">Earth: {p.earth_val} {p.unit}</span>
                          <span className="text-slate-500 ml-1.5">[{p.earth_agency}: {p.earth_instrument}]</span>
                        </div>
                        <div>
                          <span className="text-cyan-300 font-semibold">Space: {p.target_val} {p.unit}</span>
                          <span className="text-slate-500 ml-1.5">[{p.space_agency}: {p.space_instrument}]</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}