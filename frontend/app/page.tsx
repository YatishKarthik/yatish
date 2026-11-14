"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Rocket, Sparkles, MapPin, Search, ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import type { GlobePin } from "@/components/PlanetGlobe";
import AnalyticsView, { MatchPayload, EarthMatch } from "@/components/AnalyticsView";

const PlanetGlobe = dynamic(() => import("@/components/PlanetGlobe"), { ssr: false });
const DualSimulator = dynamic(() => import("@/components/DualSimulator"), { ssr: false });
const WorldPicker = dynamic(() => import("@/components/WorldPicker"), { ssr: false });

interface TargetSite {
  id: string;
  name: string;
  body: "moon" | "mars";
  lat: number;
  lon: number;
  elevation_m: number;
  gravity_m_s2: number;
  pressure_bar: number;
  temp_min_c: number;
  temp_max_c: number;
  primary_challenge: string;
  recommended_hardware_test: string;
}

export default function Home() {
  const [selectedBody, setSelectedBody] = useState<"moon" | "mars" | null>(null);
  const [allTargets, setAllTargets] = useState<TargetSite[]>([]);
  const [backendError, setBackendError] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<TargetSite | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchPayload | null>(null);
  const [simMatch, setSimMatch] = useState<EarthMatch | null>(null);

  const loadTargets = () => {
    setBackendError(false);
    fetch("http://127.0.0.1:8000/api/targets")
      .then((res) => {
        if (!res.ok) throw new Error("Backend error");
        return res.json();
      })
      .then((data) => setAllTargets(data.targets || []))
      .catch(() => setBackendError(true));
  };

  useEffect(() => {
    loadTargets();
  }, []);

  const bodyTargets = allTargets.filter((t) => t.body === selectedBody);

  const globePins: GlobePin[] = bodyTargets.map((t) => ({
    id: t.id,
    name: t.name,
    lat: t.lat,
    lon: t.lon,
    subtitle: `${t.temp_min_c}°C to ${t.temp_max_c}°C`,
  }));

  const handleSelectPin = (id: string) => {
    const found = bodyTargets.find((t) => t.id === id);
    if (found) setSelectedTarget(found);
  };

  const handleRunAiSearch = async () => {
    if (!selectedTarget) return;
    setIsSearching(true);
    try {
      const [res] = await Promise.all([
        fetch(`http://127.0.0.1:8000/api/match/${selectedTarget.id}?top_k=60`),
        new Promise((r) => setTimeout(r, 650)),
      ]);
      const data: MatchPayload = await res.json();
      setMatchResult(data);
    } catch {
      setBackendError(true);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <main className="min-h-screen space-bg text-slate-100 relative overflow-hidden flex flex-col">
      <div className="starfield fixed inset-0 pointer-events-none opacity-60" />

      <header className="relative z-10 border-b border-white/10 bg-white/[0.04] backdrop-blur-xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl glass-chip flex items-center justify-center text-cyan-300">
            <Rocket className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              TERRA-TWIN
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full glass-chip text-cyan-200">
                4-AGENCY ANALOG LAB
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              NASA LRO/PDS • CSA RADARSAT • ESA Copernicus • JAXA G-Portal
            </p>
          </div>
        </div>

        {selectedBody && (
          <button
            onClick={() => {
              setSelectedBody(null);
              setSelectedTarget(null);
              setMatchResult(null);
              setSimMatch(null);
            }}
            className="glass-chip flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-white/10 transition cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Switch Planet
          </button>
        )}
      </header>

      {backendError && (
        <div className="relative z-20 mx-auto mt-4 px-5 py-3 rounded-2xl bg-rose-950/90 border border-rose-500/50 text-rose-200 text-xs font-mono flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>Backend offline! Run <b className="text-white">python backend/main.py</b> in Terminal 1, then click Retry.</span>
          <button
            onClick={loadTargets}
            className="px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {!selectedBody && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
          <div className="text-center max-w-2xl mb-6">
            <div className="glass-chip inline-flex items-center gap-2 px-3 py-1 text-indigo-200 text-xs font-medium mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              80 Planetary &amp; Terrestrial Sites • Deep Ensemble + Conformal AI
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white mb-4">
              Select Your Target World
            </h2>
            <p className="text-sm md:text-base text-slate-400">
              Click a world to explore 10 permanent base candidates on its globe, discover matching testbeds on Earth, and run dual-world physics simulations.
            </p>
          </div>

          <div className="w-full max-w-4xl glass-card rounded-[28px] overflow-hidden">
            <WorldPicker onPick={(w) => setSelectedBody(w)} />
          </div>
        </div>
      )}

      {selectedBody && !matchResult && (
        <div className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 p-5 max-w-[1600px] w-full mx-auto">
          <div className="lg:col-span-7 glass-card rounded-[28px] overflow-hidden flex flex-col relative min-h-[520px]">
            <div className="absolute top-4 left-4 z-10 glass-chip px-3.5 py-2">
              <div className="text-xs font-mono font-bold text-cyan-300 uppercase">
                {selectedBody} 3D ORBITAL EXPLORER
              </div>
              <div className="text-[11px] text-slate-300/80">
                Drag to rotate • Scroll to zoom • Click a pin or its label
              </div>
            </div>

            <PlanetGlobe
              body={selectedBody}
              pins={globePins}
              selectedPinId={selectedTarget?.id || null}
              onSelectPin={handleSelectPin}
            />
          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="glass-card rounded-[28px] p-5 flex-1 flex flex-col">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-cyan-400" />
                10 {selectedBody.toUpperCase()} Base Candidates
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[260px] overflow-y-auto pr-1 mb-4">
                {bodyTargets.map((site) => {
                  const active = selectedTarget?.id === site.id;
                  return (
                    <button
                      key={site.id}
                      onClick={() => setSelectedTarget(site)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        active
                          ? "bg-cyan-300/15 border-cyan-200/60 text-white shadow-[0_0_24px_-6px_rgba(103,232,249,0.6)]"
                          : "bg-white/[0.03] border-white/10 text-slate-300 hover:border-white/30 hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="text-xs font-semibold truncate">{site.name}</div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {site.lat.toFixed(1)}°, {site.lon.toFixed(1)}° • {site.elevation_m}m
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedTarget ? (
                <div className="mt-auto glass-chip rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-cyan-400">SELECTED BASE SITE</span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {selectedTarget.gravity_m_s2} m/s² | {selectedTarget.pressure_bar} bar
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white mb-1">{selectedTarget.name}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mb-4">
                    {selectedTarget.primary_challenge}
                  </p>

                  <button
                    onClick={handleRunAiSearch}
                    disabled={isSearching}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 hover:from-cyan-200 hover:to-sky-300 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-[0_10px_30px_-10px_rgba(103,232,249,0.7)] cursor-pointer transition disabled:opacity-70"
                  >
                    {isSearching ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Scanning 60 Earth Sites Across 4 Agencies...
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        Search 60 Earth Sites with Conformal AI
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="mt-auto border border-dashed border-white/15 rounded-2xl p-6 text-center text-xs text-slate-400">
                  Click a pin on the {selectedBody} globe, or pick from the list above, to inspect it.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedBody && matchResult && !simMatch && (
        <AnalyticsView
          data={matchResult}
          onBackToGlobe={() => setMatchResult(null)}
          onLaunchSimulator={(m) => setSimMatch(m)}
        />
      )}

      {selectedBody && matchResult && simMatch && (
        <DualSimulator
          matchData={matchResult}
          selectedMatch={simMatch}
          onBack={() => setSimMatch(null)}
        />
      )}
    </main>
  );
}