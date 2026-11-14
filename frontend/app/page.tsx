"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Loader2, AlertTriangle, Search } from "lucide-react";
import type { GlobePin } from "@/components/PlanetGlobe";
import AnalyticsView, { MatchPayload, EarthMatch } from "@/components/AnalyticsView";
import { ThemeToggle } from "@/components/ui";
import { Tour, HelpButton, TourPrompt, type TourStep } from "@/components/Tutorial";

const PlanetGlobe = dynamic(() => import("@/components/PlanetGlobe"), { ssr: false });
const DualSimulator = dynamic(() => import("@/components/DualSimulator"), { ssr: false });
const SystemPicker = dynamic(() => import("@/components/SystemPicker"), { ssr: false });

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

// The walkthrough. Steps whose element is not on screen are skipped, so this one list covers every screen.
const TOUR: TourStep[] = [
  { target: "brand", title: "What this app does", body: "You pick a place on the Moon or Mars where a base might be built. The app then finds places on Earth that behave like it, so hardware can be tested there first. Finally you can run the same test on both worlds and see what changes.", side: "bottom" },
  { target: "worlds", title: "Start by choosing a world", body: "This is a small model of the inner solar system. Hover a body to read about it. Click the Moon or Mars to open its globe. Earth is where the testing happens, so it cannot be chosen as a destination.", side: "top" },
  { target: "theme", title: "Light or dark", body: "Switch between light and dark mode any time. Your choice is remembered on this device.", side: "bottom" },
  { target: "globe", title: "The destination globe", body: "Each pin is a candidate base site. Drag to turn the globe, scroll to zoom, and click a pin or its label to select it. The globe turns to face whatever you select.", side: "right" },
  { target: "candidates", title: "The same sites as a list", body: "Prefer a list? Pick from here. Coordinates and elevation are shown for each site.", side: "left" },
  { target: "selected", title: "What makes this site hard", body: "Each site has one main engineering problem, written in plain words. The button below starts the search for Earth test sites that share that problem.", side: "left" },
  { target: "summary", title: "The answer in one paragraph", body: "After a search, this tab explains the best Earth match in plain language: how alike it is, what it is good for testing, and what it cannot tell you.", side: "bottom" },
  { target: "earth-globe", title: "Where the matches are", body: "Every ranked Earth site is a pin. The best three are labelled. Select one and the globe turns to it.", side: "right" },
  { target: "ranked", title: "All sixty, ranked", body: "Sites are ordered by how closely their ground, rock and temperatures resemble the destination. The ± value is how unsure the model is about that score.", side: "right" },
  { target: "score", title: "The match score", body: "0 to 100. It blends four things: terrain shape, radar roughness, rock and soil type, and day-night temperature behaviour. A high score does not mean every kind of test will work there, which is what the Tests tab is for.", side: "left" },
  { target: "view-tabs", title: "Dig deeper when you want to", body: "Tests says which hardware tests the site is good for. Day & night compares temperatures hour by hour. Measurements lists every value with a one-line explanation. Expert view holds the uncertainty maths and data sources.", side: "top" },
  { target: "launch", title: "Try it yourself", body: "Opens the simulator: drive a rover, land a lander and drill a core on the Earth site, then do the same on the destination with its real gravity and air pressure.", side: "left" },
  { target: "sim-world", title: "Two worlds, same test", body: "Run the test on Earth first, then switch to the destination. The terrain is built from each site's real elevation data; gravity, air pressure and temperature change with the world.", side: "bottom" },
  { target: "sim-test", title: "One mission, three parts", body: "First you land on the pad. Then the rover rolls off and drives five waypoints along a surveyed route; on the way you grab flagged rocks with the claw and dock at two stations to drill a core. Everything you collect adds to the score.", side: "bottom" },
  { target: "sim-briefing", title: "Read the rules first", body: "Every run starts with a short briefing: what counts as a pass, what fails you, and the controls. Nothing moves until you press Start.", side: "top" },
  { target: "sim-hud", title: "Live readings", body: "While you play, the key numbers are shown here in plain words. Red means you are close to failing.", side: "bottom" },
  { target: "sim-score", title: "Your score", body: "Points so far out of 235, with rocks, cores and waypoints counted. The arrow points at the next waypoint. Fly the same mission on the other world and compare the two scores.", side: "left" },
  { target: "sim-results", title: "Compare the two runs", body: "Your Earth result and destination result sit side by side with their scores. The gap between them is exactly what an Earth test can and cannot tell you about the destination.", side: "top" },
  { target: "help", title: "Come back any time", body: "This button restarts the walkthrough for whichever screen you are on.", side: "left" },
];

export default function Home() {
  const [selectedBody, setSelectedBody] = useState<"moon" | "mars" | null>(null);
  const [allTargets, setAllTargets] = useState<TargetSite[]>([]);
  const [backendError, setBackendError] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<TargetSite | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchPayload | null>(null);
  const [simMatch, setSimMatch] = useState<EarthMatch | null>(null);
  const [tour, setTour] = useState(false);
  const [prompt, setPrompt] = useState(false);
  useEffect(() => { try { if (!localStorage.getItem("tt-tour-seen")) { const id = window.setTimeout(() => setPrompt(true), 900); return () => window.clearTimeout(id); } } catch { /* ignore */ } }, []);
  const seen = () => { try { localStorage.setItem("tt-tour-seen", "1"); } catch { /* ignore */ } };

  const loadTargets = () => {
    setBackendError(false);
    fetch("http://127.0.0.1:8000/api/targets")
      .then((res) => { if (!res.ok) throw new Error("Backend error"); return res.json(); })
      .then((data) => setAllTargets(data.targets || []))
      .catch(() => setBackendError(true));
  };

  useEffect(() => { const id = window.setTimeout(loadTargets, 0); return () => window.clearTimeout(id); }, []);

  const bodyTargets = allTargets.filter((t) => t.body === selectedBody);
  const globePins: GlobePin[] = bodyTargets.map((t) => ({ id: t.id, name: t.name, lat: t.lat, lon: t.lon, subtitle: `${t.temp_min_c}°C to ${t.temp_max_c}°C` }));
  const worldName = selectedBody === "moon" ? "the Moon" : "Mars";

  const handleSelectPin = (id: string) => {
    const found = bodyTargets.find((t) => t.id === id);
    if (found) setSelectedTarget(found);
  };

  const handleRunAiSearch = async () => {
    if (!selectedTarget) return;
    setIsSearching(true);
    try {
      const [res] = await Promise.all([fetch(`http://127.0.0.1:8000/api/match/${selectedTarget.id}?top_k=60`), new Promise((r) => setTimeout(r, 500))]);
      const data: MatchPayload = await res.json();
      setMatchResult(data);
    } catch {
      setBackendError(true);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <main className={`min-h-screen relative flex flex-col ${selectedBody ? "app-bg" : "space-page"}`}>
      <header className="relative z-10 flex items-center justify-between gap-4 px-5 py-3 border-b line">
        <div className="flex items-center gap-3" data-tour="brand">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent)" }} aria-hidden />
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">TERRA-TWIN</h1>
            <p className="text-xs muted">Find Earth test sites that behave like a Moon or Mars base site</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedBody && (
            <button type="button" className="btn btn-sm" onClick={() => { setSelectedBody(null); setSelectedTarget(null); setMatchResult(null); setSimMatch(null); }}>
              <ArrowLeft className="w-3.5 h-3.5" /> Choose another world
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {backendError && (
        <div className="relative z-20 mx-auto mt-4 card px-4 py-3 text-xs flex items-center gap-3" style={{ borderColor: "var(--bad)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--bad)" }} />
          <span>The backend is not running. In a terminal, run <code className="font-mono">python backend/main.py</code>, wait for &quot;ready&quot;, then retry.</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={loadTargets}>Retry</button>
        </div>
      )}

      {!selectedBody && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-5">
          <div className="text-center max-w-2xl mb-5">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight" style={{ color: "#eef2f7" }}>Where do you want to go?</h2>
            <p className="text-sm mt-2" style={{ color: "#a3adbb" }}>Pick a destination. You will see ten candidate base sites on its globe, find the Earth places that behave most like each one, and test hardware on both.</p>
          </div>
          <div className="w-full max-w-5xl overflow-hidden" style={{ borderRadius: 24, border: "1px solid rgba(125, 211, 252, 0.18)", boxShadow: "0 30px 80px -30px rgba(0,0,0,0.9)" }}>
            <SystemPicker onPick={(w) => setSelectedBody(w)} />
          </div>
        </div>
      )}

      {selectedBody && !matchResult && (
        <div className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 max-w-[1600px] w-full mx-auto">
          <div className="lg:col-span-7 card overflow-hidden flex flex-col relative min-h-[520px]" data-tour="globe">
            <div className="absolute top-3 left-3 z-10 on-canvas px-3 py-2">
              <div className="text-xs font-semibold">{selectedBody === "moon" ? "The Moon" : "Mars"} · 10 candidate base sites</div>
              <div className="text-[11px] opacity-80">Drag to turn · scroll to zoom · click a pin or its label</div>
            </div>
            <PlanetGlobe body={selectedBody} pins={globePins} selectedPinId={selectedTarget?.id || null} onSelectPin={handleSelectPin} />
          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="card p-4 flex-1 flex flex-col">
              <h2 className="text-sm font-semibold mb-1">Candidate sites on {worldName}</h2>
              <p className="text-xs muted mb-3">Click one to see its main engineering problem.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[260px] overflow-y-auto pr-1 mb-4" data-tour="candidates">
                {bodyTargets.map((site) => (
                  <button key={site.id} type="button" onClick={() => setSelectedTarget(site)} className="row" aria-pressed={selectedTarget?.id === site.id}>
                    <div className="text-xs font-semibold truncate">{site.name}</div>
                    <div className="text-[11px] font-mono muted">{site.lat.toFixed(1)}°, {site.lon.toFixed(1)}° · {site.elevation_m} m</div>
                  </button>
                ))}
                {!bodyTargets.length && !backendError && <p className="text-xs muted col-span-2">Loading sites…</p>}
              </div>

              {selectedTarget ? (
                <div className="mt-auto card-solid p-4" data-tour="selected">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] muted">Selected site</span>
                    <span className="text-[11px] font-mono muted">{selectedTarget.gravity_m_s2} m/s² · {selectedTarget.pressure_bar} bar</span>
                  </div>
                  <h3 className="text-base font-semibold mb-1">{selectedTarget.name}</h3>
                  <p className="text-xs muted leading-relaxed mb-4">{selectedTarget.primary_challenge}</p>
                  <button type="button" onClick={handleRunAiSearch} disabled={isSearching} className="btn btn-primary w-full justify-center">
                    {isSearching ? (<><Loader2 className="w-4 h-4 animate-spin" /> Comparing 60 Earth sites…</>) : (<><Search className="w-4 h-4" /> Find Earth sites like this one</>)}
                  </button>
                </div>
              ) : (
                <div className="mt-auto border border-dashed line rounded-2xl p-6 text-center text-xs muted">Select a site on the globe or in the list to continue.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedBody && matchResult && !simMatch && (
        <AnalyticsView data={matchResult} onBackToGlobe={() => setMatchResult(null)} onLaunchSimulator={(m) => setSimMatch(m)} />
      )}

      {selectedBody && matchResult && simMatch && (
        <DualSimulator matchData={matchResult} selectedMatch={simMatch} onBack={() => setSimMatch(null)} />
      )}

      <HelpButton onClick={() => setTour(true)} />
      {prompt && !tour && <TourPrompt onSkip={() => { seen(); setPrompt(false); }} onStart={() => { seen(); setPrompt(false); setTour(true); }} />}
      <Tour steps={TOUR} open={tour} onClose={() => setTour(false)} />
    </main>
  );
}
