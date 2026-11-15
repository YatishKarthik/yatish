"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Loader2, AlertTriangle, Search, Crosshair, X } from "lucide-react";
import type { GlobePin } from "@/components/PlanetGlobe";
import AnalyticsView, { MatchPayload, EarthMatch } from "@/components/AnalyticsView";
import { ArtemisBadge, artemisOrder, type ArtemisInfo } from "@/components/Insights";
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
  artemis?: ArtemisInfo | null;
}

const API = "http://127.0.0.1:8000";
const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`;

// The walkthrough. Steps whose element is not on screen are skipped, so this one list covers every screen.
const TOUR: TourStep[] = [
  { target: "brand", title: "What this app does", body: "You pick a place on the Moon or Mars where a base might be built. The app then finds places on Earth that behave like it, so hardware can be tested there first. Finally you can run the same test on both worlds and see what changes.", side: "bottom" },
  { target: "worlds", title: "Start by choosing a world", body: "This is a small model of the inner solar system. Hover a body to read about it. Click the Moon or Mars to open its globe. Earth is where the testing happens, so it cannot be chosen as a destination.", side: "top" },
  { target: "theme", title: "Light or dark", body: "Switch between light and dark mode any time. Your choice is remembered on this device.", side: "bottom" },
  { target: "globe", title: "The destination globe", body: "Each pin is a candidate base site; amber pins on the Moon are NASA's Artemis III landing regions. Drag to turn the globe, scroll to zoom, and click a pin to select it. Click bare ground to pick any point of your own.", side: "right" },
  { target: "candidates", title: "The same sites as a list", body: "Artemis III regions from NASA's October 2024 list come first. A dashed tag marks 2022 candidates that NASA dropped in 2024. Coordinates and elevation are shown for each site.", side: "left" },
  { target: "custom-point", title: "Your own point", body: "Celestra measures the terrain at your point live from NASA PDS elevation data (and, on the Moon, Diviner temperatures). Anything not measured is left out of the score. Because the terrain is fetched live, it can take up to a minute.", side: "left" },
  { target: "selected", title: "What makes this site hard", body: "Each site has one main engineering problem, written in plain words. The button below starts the search for Earth test sites that share that problem.", side: "left" },
  { target: "summary", title: "The answer in one paragraph", body: "This tab explains the selected Earth site in plain language: how alike it is, which measurements won and lost it points, and how ready it is for a field campaign. The first line says which numbers are measured and which are typical values.", side: "bottom" },
  { target: "earth-globe", title: "Where the matches are", body: "Every ranked Earth site is a pin. The best three are labelled. Select one and the globe turns to it.", side: "right" },
  { target: "ranked", title: "All sixty, ranked", body: "Sites are ordered by how closely their ground, rock and temperatures resemble the destination. The ± value is how unsure the model is about that score.", side: "right" },
  { target: "score", title: "The match score", body: "0 to 100. It blends four things: terrain shape, surface texture, surface composition, and day-night temperature behaviour. A high score does not mean every kind of test will work there, which is what the Tests tab is for.", side: "left" },
  { target: "sunlight", title: "Light, shadow and radio", body: "For polar Moon sites: how often the point is sunlit, how often Earth is in view for radio, and how much of the area never sees the Sun. Modelled by Celestra from LRO LOLA terrain.", side: "bottom" },
  { target: "view-tabs", title: "Dig deeper when you want to", body: "By Use finds the best site for each test. Summary explains why the selected site matches and what fieldwork there needs. Terrain Twins shows both grounds side by side at the same scale. Expert view holds the uncertainty maths, data sources and validation.", side: "top" },
  { target: "by-use", title: "Pick the test, then the site", body: "An Earth site can be a good stand-in for one test and useless for another. Choose a rover, landing or mining test to see its five best Earth sites. Tests whose physics does not carry over from Earth say so clearly.", side: "top" },
  { target: "brief", title: "Take it into the field", body: "Opens a printable one-page brief for a test campaign: the top sites per test, field seasons, permits and what is still unverified. Save it as a PDF from the print dialog.", side: "bottom" },
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
  const [customPoint, setCustomPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [customBusy, setCustomBusy] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [busySecs, setBusySecs] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  useEffect(() => {
    if (!customBusy) return;
    const started = Date.now();
    const id = window.setInterval(() => setBusySecs(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [customBusy]);
  const [tour, setTour] = useState(false);
  const [prompt, setPrompt] = useState(false);
  // offered once per visit (a new tab or window asks again)
  useEffect(() => { try { if (!sessionStorage.getItem("celestra-tour")) { const id = window.setTimeout(() => setPrompt(true), 900); return () => window.clearTimeout(id); } } catch { /* ignore */ } }, []);
  const seen = () => { try { sessionStorage.setItem("celestra-tour", "1"); } catch { /* ignore */ } };

  const loadTargets = () => {
    setBackendError(false);
    fetch(`${API}/api/targets`)
      .then((res) => { if (!res.ok) throw new Error("Backend error"); return res.json(); })
      .then((data) => setAllTargets(data.targets || []))
      .catch(() => setBackendError(true));
  };

  useEffect(() => { const id = window.setTimeout(loadTargets, 0); return () => window.clearTimeout(id); }, []);

  // Artemis III regions first (2024 list, then 2022-only), then the rest in their original order
  const bodyTargets = allTargets.filter((t) => t.body === selectedBody).map((t, i) => ({ t, i }))
    .sort((a, b) => artemisOrder(a.t.artemis) - artemisOrder(b.t.artemis) || a.i - b.i).map((x) => x.t);
  const hasArtemis = bodyTargets.some((t) => t.artemis);
  const groups = hasArtemis
    ? [
        { title: "Artemis III regions (NASA, October 2024)", items: bodyTargets.filter((t) => artemisOrder(t.artemis) === 0) },
        { title: "2022 candidates, dropped in 2024", items: bodyTargets.filter((t) => artemisOrder(t.artemis) === 1) },
        { title: "Other candidate sites", items: bodyTargets.filter((t) => artemisOrder(t.artemis) === 2) },
      ].filter((g) => g.items.length)
    : [{ title: "", items: bodyTargets }];
  const globePins: GlobePin[] = bodyTargets.map((t) => ({
    id: t.id, name: t.name, lat: t.lat, lon: t.lon, subtitle: `${t.temp_min_c}°C to ${t.temp_max_c}°C`,
    tone: t.artemis?.status === "artemis_iii_2024" ? "artemis" : t.artemis ? "artemis-old" : undefined,
    badge: t.artemis?.status === "artemis_iii_2024" ? "Artemis III candidate (2024)" : t.artemis ? "2022 candidate, dropped in 2024" : undefined,
  }));
  const worldName = selectedBody === "moon" ? "the Moon" : "Mars";

  const chooseTarget = (t: TargetSite) => { setSelectedTarget(t); setCustomPoint(null); setCustomError(null); setSearchError(null); };
  const handleSelectPin = (id: string) => {
    const found = bodyTargets.find((t) => t.id === id);
    if (found) chooseTarget(found);
  };
  const handlePickPoint = (lat: number, lon: number) => {
    if (customBusy) return;
    setCustomPoint({ lat, lon }); setSelectedTarget(null); setCustomError(null);
  };

  const runCustomSearch = async () => {
    if (!customPoint || !selectedBody) return;
    setCustomBusy(true); setCustomError(null); setBusySecs(0);
    try {
      const res = await fetch(`${API}/api/custom_target?body=${selectedBody}&lat=${customPoint.lat.toFixed(3)}&lon=${customPoint.lon.toFixed(3)}&top_k=60`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setCustomError(typeof body?.detail === "string" ? body.detail : `The server could not measure this point (error ${res.status}).`);
        return;
      }
      setMatchResult(body as MatchPayload);
    } catch {
      setCustomError("Could not reach the backend. Check that it is running, then try again.");
    } finally {
      setCustomBusy(false);
    }
  };

  const handleRunAiSearch = async () => {
    if (!selectedTarget) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const [res] = await Promise.all([fetch(`${API}/api/match/${selectedTarget.id}?top_k=60`), new Promise((r) => setTimeout(r, 500))]);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.matches) {
        setSearchError(typeof data?.detail === "string" ? data.detail : `The server could not rank this site (error ${res.status}).`);
        return;
      }
      setMatchResult(data as MatchPayload);
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
            <h1 className="text-[15px] font-semibold tracking-tight">Celestra</h1>
            <p className="text-xs muted">Find Earth test sites that behave like a Moon or Mars base site</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedBody && (
            <button type="button" className="btn btn-sm" onClick={() => { setSelectedBody(null); setSelectedTarget(null); setMatchResult(null); setSimMatch(null); setCustomPoint(null); setCustomError(null); }}>
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
            <p className="text-sm mt-2" style={{ color: "#a3adbb" }}>Pick a destination. You will see its candidate base sites on a globe (on the Moon, including NASA&apos;s Artemis III landing regions), or pick any point yourself. Then find the Earth places that behave most like it, and test hardware on both.</p>
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
              <div className="text-xs font-semibold">{selectedBody === "moon" ? "The Moon" : "Mars"} · {bodyTargets.length || "…"} candidate base sites</div>
              <div className="text-[11px] opacity-80">Drag to turn · scroll to zoom · click a pin, or bare ground to pick any point</div>
              {hasArtemis && <div className="text-[11px] mt-1 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#fbbf24" }} />Artemis III region (2024 list)</div>}
            </div>
            <PlanetGlobe body={selectedBody} pins={globePins} selectedPinId={selectedTarget?.id || null} onSelectPin={handleSelectPin} onPickPoint={handlePickPoint} customPoint={customPoint} />
          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="card p-4 flex-1 flex flex-col">
              <h2 className="text-sm font-semibold mb-1">Candidate sites on {worldName}</h2>
              <p className="text-xs muted mb-3">Click one to see its main engineering problem.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[300px] overflow-y-auto pr-1 mb-4" data-tour="candidates">
                {groups.map((g) => (
                  <React.Fragment key={g.title || "all"}>
                    {g.title && <div className="sm:col-span-2 text-[11px] font-semibold uppercase tracking-wide faint px-1 pt-1">{g.title}</div>}
                    {g.items.map((site) => (
                      <button key={site.id} type="button" onClick={() => chooseTarget(site)} className="row" aria-pressed={selectedTarget?.id === site.id}>
                        <div className="text-xs font-semibold truncate">{site.name}</div>
                        <div className="text-[11px] font-mono muted">{site.lat.toFixed(1)}°, {site.lon.toFixed(1)}° · {Math.round(site.elevation_m)} m</div>
                        {site.artemis?.status === "artemis_iii_2022_only" && <div className="mt-1"><ArtemisBadge a={site.artemis} compact /></div>}
                      </button>
                    ))}
                  </React.Fragment>
                ))}
                {!bodyTargets.length && !backendError && <p className="text-xs muted col-span-2">Loading sites…</p>}
              </div>

              {customPoint ? (
                <div className="mt-auto card-solid p-4" data-tour="custom-point">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] muted flex items-center gap-1.5"><Crosshair className="w-3.5 h-3.5" /> Your point</span>
                    <button type="button" className="btn btn-sm btn-icon" aria-label="Clear your point" title="Clear your point" disabled={customBusy} onClick={() => { setCustomPoint(null); setCustomError(null); }}><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <h3 className="text-base font-semibold font-mono mb-1">{fmtLat(customPoint.lat)}, {fmtLon(customPoint.lon)}</h3>
                  <p className="text-xs muted leading-relaxed mb-3">Any point on {worldName}. Celestra measures the terrain here live from NASA PDS elevation data and, on the Moon, LRO Diviner temperatures. Nothing is borrowed or filled in.</p>
                  {customError && (
                    <div className="rounded-xl px-3 py-2 text-xs mb-3 flex gap-2 items-start" style={{ background: "var(--bad-soft)", color: "var(--text)" }} role="alert">
                      <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--bad)" }} />
                      <span>{customError}</span>
                    </div>
                  )}
                  <button type="button" onClick={runCustomSearch} disabled={customBusy} className="btn btn-primary w-full justify-center">
                    {customBusy ? (<><Loader2 className="w-4 h-4 animate-spin" /> Measuring terrain… {busySecs}s</>) : (<><Search className="w-4 h-4" /> Find Earth sites for this point</>)}
                  </button>
                  <p className="text-[11px] faint mt-2" aria-live="polite">{customBusy ? "This can take up to a minute because the terrain is fetched live." : "Click elsewhere on the globe to move the point."}</p>
                </div>
              ) : selectedTarget ? (
                <div className="mt-auto card-solid p-4" data-tour="selected">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] muted">Selected site</span>
                    <span className="text-[11px] font-mono muted">{selectedTarget.gravity_m_s2} m/s² · {selectedTarget.pressure_bar} bar</span>
                  </div>
                  <h3 className="text-base font-semibold mb-1">{selectedTarget.name}</h3>
                  {selectedTarget.artemis && <div className="mb-2"><ArtemisBadge a={selectedTarget.artemis} /></div>}
                  <p className="text-xs muted leading-relaxed mb-4">{selectedTarget.primary_challenge}</p>
                  {searchError && (
                    <div className="rounded-xl px-3 py-2 text-xs mb-3 flex gap-2 items-start" style={{ background: "var(--bad-soft)" }} role="alert">
                      <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--bad)" }} />
                      <span>{searchError}</span>
                    </div>
                  )}
                  <button type="button" onClick={handleRunAiSearch} disabled={isSearching} className="btn btn-primary w-full justify-center">
                    {isSearching ? (<><Loader2 className="w-4 h-4 animate-spin" /> Comparing 60 Earth sites…</>) : (<><Search className="w-4 h-4" /> Find Earth sites like this one</>)}
                  </button>
                </div>
              ) : (
                <div className="mt-auto border border-dashed line rounded-2xl p-6 text-center text-xs muted">Select a site on the globe or in the list, or click anywhere on the globe to pick your own point.</div>
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
