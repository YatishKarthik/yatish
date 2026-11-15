"use client";

import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Loader2, AlertTriangle, Search, Crosshair, X } from "lucide-react";
import type { GlobePin } from "@/components/PlanetGlobe";
import AnalyticsView, { MatchPayload, EarthMatch } from "@/components/AnalyticsView";
import { ArtemisBadge, artemisOrder, type ArtemisInfo } from "@/components/Insights";
import { ThemeToggle } from "@/components/ui";
import { Tour, HelpButton, type TourStep } from "@/components/Tutorial";
import { Splash } from "@/components/Splash";
import { API, apiUrl } from "@/lib/api";

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

const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`;

// The walkthrough. Shared controls are explained once on the first screen; later screens show only their own steps,
// and steps whose element is not on screen are skipped.
const TOUR: TourStep[] = [
  // first screen only: what the app is and the controls every screen shares
  { screens: ["picker"], target: "brand", title: "What this app does", body: "You pick a place on the Moon or Mars where a base might be built. The app finds places on Earth that behave like it, so hardware can be tested there first. Then you can run the same test on both worlds and see what changes.", side: "bottom" },
  { screens: ["picker"], target: "worlds", title: "Start by choosing a world", body: "This is a small model of the inner solar system. Hover a body to read about it, then click the Moon or Mars to open its globe. Earth is where the testing happens, so it is not a destination.", side: "top" },
  { screens: ["picker"], target: "theme", title: "Light or dark", body: "Switch between light and dark mode at any time. Your choice is remembered on this device.", side: "bottom" },
  { screens: ["picker"], target: "help", title: "Help on every screen", body: "Each new screen shows a short tour of what is new on it. This button replays the tour for the screen you are on.", side: "left" },
  // destination globe
  { target: "globe", title: "The destination globe", body: "Each pin is a possible base site. Amber pins on the Moon are NASA's Artemis III landing regions. Drag to turn the globe, scroll to zoom and click a pin to choose it. Click bare ground to pick any point of your own.", side: "right" },
  { target: "candidates", title: "The same sites as a list", body: "NASA's current Artemis III regions come first. A dashed tag marks regions NASA dropped from its list in 2024.", side: "left" },
  { target: "custom-point", title: "Your own point", body: "Celestra measures the ground at your point live from NASA's maps. Anything it cannot measure is left out of the score. This can take up to a minute.", side: "left" },
  { target: "selected", title: "What makes this site hard", body: "Each site has one main engineering problem, in plain words. The button below searches Earth for test sites that share it.", side: "left" },
  // results
  { target: "ranked", title: "All sites, best first", body: "Named Earth sites and places the AI found (purple, shown by coordinates) are ordered by how much their ground and temperatures resemble the destination. The small ± shows how sure the score is: the smaller, the surer.", side: "right" },
  { target: "earth-globe", title: "Where the matches are", body: "Every ranked site is a pin; the best three are labelled. Choose one and the globe turns to it.", side: "right" },
  { target: "ai-finds", title: "Places nobody listed", body: "An AI searched all of Earth's bare land for places like this destination. Its finds are the purple pins. Each one was double-checked with real measurements, and you can explore it and fly it in the simulator like any other site.", side: "right" },
  { target: "score", title: "The match score", body: "0 to 100: how alike the two places are in ground shape, surface texture and, where measured, day-night temperatures. A high score does not mean every test works there, which is what the By Use tab is for.", side: "left" },
  { target: "sunlight", title: "Light, shadow and radio", body: "For Moon sites near the pole: how often the point is in sunlight, how often Earth is in view for radio contact, and how much of the area never sees the Sun.", side: "bottom" },
  { target: "view-tabs", title: "Dig deeper when you want to", body: "By Use finds the best site for each test. Summary explains this match in plain words. Terrain Twins shows both grounds side by side. Expert view has the data sources, maths and checks.", side: "top" },
  { target: "by-use", title: "Pick the test, then the site", body: "A site can be good for one test and useless for another. Choose a rover, landing or mining test to see its best Earth sites. Tests that Earth cannot imitate say so.", side: "top" },
  { target: "brief", title: "Take it into the field", body: "A printable one-page plan for a test campaign: the best sites per test, when to go, permits and what still needs checking.", side: "bottom" },
  { target: "launch", title: "Try it yourself", body: "Opens the simulator: land, drive a rover and drill a core on the Earth site, then do the same on the destination with its real gravity and air.", side: "left" },
  // simulator
  { target: "sim-world", title: "Two worlds, same test", body: "Run the mission on Earth first, then switch to the destination. Both grounds are built from real elevation maps; gravity, air and temperature change with the world.", side: "bottom" },
  { target: "sim-test", title: "One mission, two parts", body: "First land on the pad. Then the rover rolls off and drives to five waypoints, grabbing flagged rocks and stopping at two stations to drill a core. Everything you collect adds to your score.", side: "bottom" },
  { target: "sim-relief", title: "See the slopes better", body: "Real ground can look flat on a screen. Make hills 2 or 3 times taller to see the slopes clearly. Only the picture changes: the rover and lander still feel the real slopes. Choose before you start.", side: "bottom" },
  { target: "sim-view", title: "Three ways to look", body: "Camera is the normal view. Slope colours the ground by how steep it is for the rover. Heat shows how warm the ground is, and how the engine heats it when you land.", side: "bottom" },
  { target: "sim-briefing", title: "Read the rules first", body: "Each part starts with a short briefing: what counts as a pass, what fails you, and the controls. Nothing moves until you press Start.", side: "top" },
  { target: "sim-hud", title: "Live readings", body: "The key numbers while you play. Red means you are close to failing.", side: "bottom" },
  { target: "sim-score", title: "Your score", body: "Points so far for rocks, cores and waypoints. Fly the same mission on the other world and compare.", side: "left" },
  { target: "sim-results", title: "Compare the two runs", body: "Your Earth and destination results side by side. The gap between them is what an Earth test can and cannot tell you.", side: "top" },
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
  const [splash, setSplash] = useState(true);   // the intro plays when the app opens and when returning to the world picker
  const endSplash = useCallback(() => setSplash(false), []);
  // The walkthrough runs by itself the first time each screen is shown in this visit (Skip closes it); the ? button replays it.
  const screen = !selectedBody ? "picker" : !matchResult ? "globe" : !simMatch ? "results" : "sim";
  useEffect(() => {
    let id = 0;
    if (splash) return;
    try {
      const key = `celestra-tour-${screen}`;
      if (!sessionStorage.getItem(key)) {
        id = window.setTimeout(() => { try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ } setTour(true); }, screen === "picker" ? 1200 : 1800);
      }
    } catch { /* storage blocked: no automatic tour */ }
    return () => { window.clearTimeout(id); setTour(false); };
  }, [screen, splash]);

  const loadTargets = () => {
    setBackendError(false);
    fetch(apiUrl("/api/targets"))
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
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 200000);
    try {
      const res = await fetch(`${API}/api/custom_target?body=${selectedBody}&lat=${customPoint.lat.toFixed(3)}&lon=${customPoint.lon.toFixed(3)}&top_k=200`, { signal: ctrl.signal });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = typeof body?.detail === "string" ? body.detail : "";
        // network failures reach us as raw library errors: say what happened in plain words
        setCustomError(/curl|connect|timed? ?out|resolve/i.test(detail)
          ? "Couldn't reach NASA's data server from this network. Try again in a minute, or on another network (a phone hotspot works)."
          : detail || `The server could not measure this point (error ${res.status}).`);
        return;
      }
      setMatchResult(body as MatchPayload);
    } catch (e) {
      setCustomError((e as Error)?.name === "AbortError"
        ? "NASA's data server took more than 3 minutes to answer, so the search was stopped. The point does have data; try again, or pick a point nearby."
        : "Could not reach the backend. Check that it is running, then try again.");
    } finally {
      window.clearTimeout(timer);
      setCustomBusy(false);
    }
  };

  const handleRunAiSearch = async () => {
    if (!selectedTarget) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const [res] = await Promise.all([fetch(apiUrl(`/api/match/${selectedTarget.id}?top_k=200&include_ai=true`)), new Promise((r) => setTimeout(r, 500))]);
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
      <header className={`relative z-10 flex items-center justify-between gap-4 px-5 py-3 ${selectedBody ? "border-b line" : ""}`}>
        <div className="flex items-center gap-3" data-tour="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/terramappers-mark.png" alt="TerraMappers" className="h-9 w-auto" />
          <div>
            <h1 className="brand-title">CELESTRA</h1>
            <p className="text-xs muted">Find Earth test sites that behave like a Moon or Mars base site</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedBody && (
            <button type="button" className="btn btn-sm" onClick={() => { setSplash(true); setSelectedBody(null); setSelectedTarget(null); setMatchResult(null); setSimMatch(null); setCustomPoint(null); setCustomError(null); }}>
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
        <>
          {/* the whole screen is space: the solar system fills the window behind the header and title */}
          <div className="fixed inset-0 z-0" style={{ background: "radial-gradient(1200px 700px at 50% 0%, #0b1a33 0%, #04070d 55%, #01030a 100%) #01030a" }}>
            <SystemPicker full onPick={(w) => setSelectedBody(w)} />
          </div>
          <div className="relative z-10 pointer-events-none text-center max-w-2xl mx-auto px-5 pt-8">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight" style={{ color: "#eef2f7", textShadow: "0 2px 18px rgba(0,0,0,0.8)" }}>Where do you want to go?</h2>
            <p className="text-sm mt-2" style={{ color: "#c3cbd6", textShadow: "0 1px 10px rgba(0,0,0,0.9)" }}>Pick a destination. You will see its candidate base sites on a globe (on the Moon, including NASA&apos;s Artemis III landing regions), or pick any point yourself. Then find the Earth places that behave most like it, and test hardware on both.</p>
          </div>
        </>
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
              <div className="relative flex-1 min-h-[260px] mb-4"><div className="absolute inset-0 grid grid-cols-1 sm:grid-cols-2 gap-1.5 content-start overflow-y-auto pr-1" data-tour="candidates">
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
              </div></div>

              {customPoint ? (
                <div className="mt-auto card-solid p-4" data-tour="custom-point">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] muted flex items-center gap-1.5"><Crosshair className="w-3.5 h-3.5" /> Your point</span>
                    <button type="button" className="btn btn-sm btn-icon" aria-label="Clear your point" title="Clear your point" disabled={customBusy} onClick={() => { setCustomPoint(null); setCustomError(null); }}><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <h3 className="text-base font-semibold font-mono mb-1">{fmtLat(customPoint.lat)}, {fmtLon(customPoint.lon)}</h3>
                  <p className="text-xs muted leading-relaxed mb-3">Any point on {worldName}. Celestra measures the ground here live from NASA&apos;s elevation maps and, on the Moon, its temperatures. Nothing is borrowed or filled in.</p>
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
      {splash && <Splash onDone={endSplash} />}
      <Tour key={screen} steps={TOUR.filter((s) => !s.screens || s.screens.includes(screen))} open={tour} onClose={() => setTour(false)} />
    </main>
  );
}
