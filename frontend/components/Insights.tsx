"use client";

import React, { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Status, Bar, notComparedReason } from "@/components/ui";

/* ---------- data shapes added by the functional-analogue, explainability and field-readiness work ---------- */
export type Scenario = "rover" | "landing" | "mining";
export type UseStatus = "REPRESENTATIVE" | "PARTIAL" | "NOT_REPRESENTATIVE";
export type PillarKey = "topo" | "radar" | "mineral" | "thermal";

export interface ArtemisInfo { status: "artemis_iii_2024" | "artemis_iii_2022_only"; region: string; feature?: string; placement?: string; search?: unknown }
export interface Illumination {
  sunlit_fraction: number; tile_sunlit_fraction: number; psr_fraction_tile: number; earth_visible_fraction: number;
  max_sun_elevation_deg: number; modelled_max_temp_c: number; slope_deg_2km: number; method: string;
  lola?: { product?: string; source?: string; cell_m: number };
}
export interface NightIR { night_ir_contrast: number; night_ir_texture: number; mosaic: string; reading: string; status: string }
export interface CustomInfo { nearest_target: string; nearest_km: number; terrain_offset_km: number }
export interface FunctionalSite { id: string; name: string; overall_rank: number; use_score: number; status: UseStatus; reason: string }
export interface FunctionalRanking { test: string; scenario: Scenario; transfers: boolean; uses: PillarKey[]; note: string | null; top: FunctionalSite[] }
export interface Contribution { feature: string; label: string; pillar: PillarKey; similarity: number | null; points: number; max_points: number; lost: number; compared?: boolean }
export interface WhyInfo { helps: string[]; hurts: string[]; gate_note: string | null }
export interface FieldReadiness {
  analog_history: string | null; analog_history_status: string; permits: string | null; permits_status: string;
  field_season: string | null; field_season_basis: string | null; low_sun_test_months: string | null; elevation_m: number | null; infrastructure: string | null;
}

/* ---------- shared dictionaries ---------- */
export const GROUPS: Record<PillarKey, { label: string; colour: string }> = {
  topo: { label: "Terrain", colour: "var(--g-topo)" },
  radar: { label: "Surface texture", colour: "var(--g-radar)" },
  mineral: { label: "Composition", colour: "var(--g-mineral)" },
  thermal: { label: "Temperatures", colour: "var(--g-thermal)" },
};

export const TEST_HELP: Record<string, { short: string; ask: string; why: string }> = {
  "Slope Climbing & Wheel Traction": { short: "Slopes & traction", ask: "Can a rover climb and grip here?", why: "Depends on slopes and ruggedness. Gravity still differs, so grip on Earth is always higher." },
  "Radar / Darkness Boulder Navigation": { short: "Boulder navigation", ask: "Can a rover find its way across broken ground?", why: "Depends on surface texture matching. Plant cover hides the rocks, so green sites fail this." },
  "Lander Touchdown Tilt & Stability": { short: "Touchdown stability", ask: "Will a lander stay upright when it touches down?", why: "Depends on slope spread and surface roughness around the pad." },
  "Thruster Plume & Dust Ejecta": { short: "Plume & dust", ask: "What does the engine blast do to the ground?", why: "Earth's air damps the plume. In near-vacuum, dust flies far and fast. Earth can rarely stand in for this." },
  "Rock / Ice Drill Bit Hardness": { short: "Drilling", ask: "Does the drill bit meet the same kind of rock?", why: "Depends on the mineral match. Wet soil never behaves like dry regolith." },
  "Thermal & Vacuum Motor Cooling": { short: "Motor cooling", ask: "Will motors overheat like they would in vacuum?", why: "No: Earth's air cools motors by convection. This test never transfers from Earth." },
  "Low-Sun Camera Navigation & Long Shadows": { short: "Low-sun cameras", ask: "Can cameras navigate with the Sun on the horizon?", why: "Depends on terrain shape and when the Earth site has a similarly low Sun. Earth's sky still lights the shadows." },
};

export const USE_WORD: Record<UseStatus, { word: string; level: "good" | "warn" | "bad" }> = {
  REPRESENTATIVE: { word: "Good stand-in", level: "good" },
  PARTIAL: { word: "Partly useful", level: "warn" },
  NOT_REPRESENTATIVE: { word: "Not useful", level: "bad" },
};
const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "rover", label: "Rover" },
  { id: "landing", label: "Landing" },
  { id: "mining", label: "Mining" },
];
const levelColour = (l: "good" | "warn" | "bad") => (l === "good" ? "var(--good)" : l === "warn" ? "var(--warn)" : "var(--bad)");

/* ---------- Artemis III badge ---------- */
export function ArtemisBadge({ a, compact }: { a?: ArtemisInfo | null; compact?: boolean }) {
  if (!a) return null;
  const now = a.status === "artemis_iii_2024";
  const text = now ? (compact ? "Artemis III (2024)" : "Artemis III candidate (2024)") : (compact ? "2022 candidate" : "2022 candidate, dropped in 2024");
  const title = now ? `On NASA's October 2024 list of nine Artemis III candidate landing regions${a.region ? `: ${a.region}` : ""}` : `On NASA's 2022 list of candidate regions${a.region ? ` (${a.region})` : ""}, not on the 2024 list`;
  return <span className={`badge ${now ? "badge-artemis" : "badge-artemis-old"}`} title={title}>{text}</span>;
}
export const artemisOrder = (a?: ArtemisInfo | null) => (a?.status === "artemis_iii_2024" ? 0 : a?.status === "artemis_iii_2022_only" ? 1 : 2);

/* ---------- By Use: functional analogues ---------- */
export function ByUseView({ rankings, selectedId, onSelect, best }: {
  rankings: FunctionalRanking[]; selectedId: string; onSelect: (id: string) => void;
  best?: { id: string; name: string; score: number; total: number };
}) {
  const [testName, setTestName] = useState<string>(rankings[0]?.test ?? "");
  const test = rankings.find((r) => r.test === testName) ?? rankings[0];
  if (!test) return <p className="text-xs muted">No per-test rankings for this target.</p>;
  const help = TEST_HELP[test.test];

  return (
    <div className="flex flex-col gap-4 rise" data-tour="by-use">
      <p className="text-sm leading-relaxed">An Earth site can be a good stand-in for one test and useless for another. <b>Pick the test, then the site.</b></p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {SCENARIOS.map((sc) => {
          const tests = rankings.filter((r) => r.scenario === sc.id);
          if (!tests.length) return null;
          return (
            <div key={sc.id} className="flex flex-col gap-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide faint px-1">{sc.label}</div>
              {tests.map((r) => {
                const top = r.top[0], w = top ? USE_WORD[top.status] : null;
                return (
                  <button key={r.test} type="button" className="row !py-2" aria-pressed={r.test === test.test} onClick={() => setTestName(r.test)}>
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: !r.transfers ? "var(--bad)" : w ? levelColour(w.level) : "var(--faint)" }} aria-hidden />
                      <span className="truncate">{TEST_HELP[r.test]?.short ?? r.test}</span>
                    </div>
                    <div className="text-[11px] muted truncate mt-0.5">{!r.transfers ? "Does not transfer from Earth" : top ? `Best: ${top.name}` : "No site"}</div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="card-solid p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] muted">{SCENARIOS.find((s) => s.id === test.scenario)?.label} test · {test.test}</div>
            <h3 className="text-base font-semibold mt-0.5">{help?.ask ?? test.test}</h3>
          </div>
          {test.uses.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px] muted">
              Judged on
              {test.uses.map((u) => <span key={u} className="badge" style={{ borderColor: GROUPS[u]?.colour, color: "var(--text)" }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: GROUPS[u]?.colour }} />{GROUPS[u]?.label ?? u}</span>)}
            </div>
          )}
        </div>

        {!test.transfers && (
          <div className="rounded-xl px-3 py-2.5 text-xs flex gap-2.5 items-start" style={{ background: "var(--bad-soft)", border: "1px solid var(--bad)" }} role="note">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--bad)" }} />
            <div>
              <div className="font-semibold" style={{ color: "var(--bad)" }}>Does not transfer from Earth</div>
              <p className="mt-0.5 leading-relaxed">{test.note ?? help?.why}</p>
              <p className="mt-1 muted">The sites below are ranked by ground similarity only.</p>
            </div>
          </div>
        )}

        <ol className="flex flex-col gap-1">
          {test.top.map((s, i) => {
            const w = USE_WORD[s.status], on = s.id === selectedId;
            return (
              <li key={s.id}>
                <button type="button" className="row flex flex-col gap-1.5" aria-pressed={on} onClick={() => onSelect(s.id)} title={s.reason}>
                  <div className="w-full flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="min-w-0 flex items-baseline gap-2">
                      <span className="font-mono text-xs muted w-4 shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold sm:truncate">{s.name}</div>
                        <div className="text-[11px] faint">#{s.overall_rank} overall</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-6 sm:ml-0">
                      <div className="w-20 sm:w-28"><Bar value={s.use_score} colour={levelColour(w.level)} /></div>
                      <span className="font-mono text-xs w-9 text-right">{Math.round(s.use_score * 100)}%</span>
                      <span className="w-[96px] flex justify-end"><Status level={w.level}>{w.word}</Status></span>
                    </div>
                  </div>
                  {on && <p className="text-xs muted leading-relaxed pl-6">{s.reason}</p>}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="text-[11px] faint">Use score: how well this site matches the measurements that matter for this test (0–100%). Click a site to make it the current Earth site; its reason appears under it.</p>
      </div>

      <div className="card-solid p-3">
        <div className="text-xs font-semibold mb-2">Winner for each test</div>
        <table className="w-full text-xs">
          <tbody>
            {rankings.map((r) => { const top = r.top[0]; const w = top ? USE_WORD[top.status] : null; return (
              <tr key={r.test} className="border-t line">
                <td className="py-1.5 pr-2"><button type="button" className="text-left hover:underline" onClick={() => setTestName(r.test)}>{TEST_HELP[r.test]?.short ?? r.test}</button></td>
                <td className="py-1.5 pr-2 min-w-0">{top ? <button type="button" className="text-left font-medium hover:underline" onClick={() => onSelect(top.id)}>{top.name}</button> : "—"}</td>
                <td className="py-1.5 text-right whitespace-nowrap">{!r.transfers ? <span style={{ color: "var(--bad)" }}>Does not transfer</span> : w ? <span style={{ color: levelColour(w.level) }}>{Math.round((top?.use_score ?? 0) * 100)}%</span> : null}</td>
              </tr>
            ); })}
          </tbody>
        </table>
        {best && <p className="text-[11px] muted mt-2">Best overall match: <button type="button" className="font-semibold hover:underline" style={{ color: "var(--text)" }} onClick={() => onSelect(best.id)}>{best.name}</button> ({best.score} / 100, rank 1 of {best.total}). The overall winner is not always the winner for a given test.</p>}
      </div>
    </div>
  );
}

/* ---------- Why this match ---------- */
export function WhyThisMatch({ contributions, why, score, nameOf, body = "" }: { contributions?: Contribution[]; why?: WhyInfo; score: number; nameOf: (feature: string, label: string) => string; body?: string }) {
  const [open, setOpen] = useState(true);
  const all = contributions ?? [];
  const rows = all.filter((c) => c.compared !== false && c.similarity !== null);
  const skipped = all.filter((c) => !(c.compared !== false && c.similarity !== null));
  if (!all.length) return null;
  const maxMax = Math.max(1, ...rows.map((c) => c.max_points));
  const byLabel = new Map(all.map((c) => [c.label, nameOf(c.feature, c.label)]));
  const plain = (l: string) => byLabel.get(l) ?? l;
  const lostTotal = rows.reduce((a, c) => a + c.lost, 0);

  return (
    <div className="card-solid p-4" data-tour="why">
      <button type="button" className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h3 className="text-sm font-semibold">Why This Match</h3>
        <ChevronDown className={`w-4 h-4 muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {why && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs">
          <p><span className="font-semibold" style={{ color: "var(--good)" }}>Matches best on:</span> {why.helps.map(plain).join(", ")}</p>
          <p><span className="font-semibold" style={{ color: "var(--bad)" }}>Differs most on:</span> {why.hurts.map(plain).join(", ")}</p>
        </div>
      )}
      {why?.gate_note && <p className="text-xs mt-2" style={{ color: "var(--warn)" }}>{why.gate_note}</p>}
      {open && (
        <>
          <p className="text-[11px] muted mt-3">The score of {Math.round(score * 100)} is the sum of the points won on the {rows.length} measurements that exist for both sites. Each grey track is the most that measurement can give; the coloured part is what this site won. {lostTotal > 0.5 ? `${lostTotal.toFixed(0)} points were lost in total.` : ""}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] muted">
            {(Object.keys(GROUPS) as PillarKey[]).map((k) => <span key={k} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: GROUPS[k].colour }} />{GROUPS[k].label}</span>)}
          </div>
          <div className="flex flex-col gap-1.5 mt-3">
            {rows.map((c) => (
              <div key={c.feature} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-0.5 text-xs" title={c.similarity === null ? `${plain(c.label)}: not compared (no measurement for the target)` : `${plain(c.label)}: ${c.points.toFixed(1)} of ${c.max_points.toFixed(1)} points (similarity ${Math.round(c.similarity * 100)}%)`}>
                <span className="w-full sm:w-40 shrink-0 truncate">{plain(c.label)}</span>
                <div className="flex-1 min-w-0">
                  <div className="h-2.5 rounded-full overflow-hidden" style={{ width: `${(c.max_points / maxMax) * 100}%`, background: "var(--line)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(c.points / (c.max_points || 1)) * 100}%`, background: GROUPS[c.pillar]?.colour ?? "var(--accent)" }} />
                  </div>
                </div>
                <span className="font-mono w-[84px] text-right shrink-0 muted whitespace-nowrap"><span style={{ color: "var(--text)" }}>{c.points.toFixed(1)}</span> / {c.max_points % 1 ? c.max_points.toFixed(2) : c.max_points}</span>
              </div>
            ))}
          </div>
          {skipped.length > 0 && (
            <div className="text-[11px] muted mt-3 flex flex-col gap-1">
              {Array.from(new Set(skipped.map((c) => c.pillar))).map((g) => (
                <p key={g}><b>Not compared: {skipped.filter((c) => c.pillar === g).map((c) => plain(c.label)).join(", ")}.</b> {notComparedReason(g, body)}</p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Field readiness ---------- */
function FieldItem({ label, value, verified, sub }: { label: string; value: React.ReactNode; verified: boolean; sub?: React.ReactNode }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${verified ? "" : "unverified"}`} style={verified ? { border: "1px solid var(--line)" } : undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] muted">{label}</span>
        {!verified && <span className="text-[10px] font-semibold uppercase tracking-wide faint">Not verified</span>}
      </div>
      <div className={`text-xs mt-0.5 leading-relaxed ${verified ? "" : "faint italic"}`}>{value}</div>
      {sub && <div className="text-[11px] faint mt-0.5 leading-relaxed">{sub}</div>}
    </div>
  );
}
const notVerified = (s?: string | null) => !s || /^not verified/i.test(s.trim());
const stripNV = (s: string) => { const t = s.replace(/^not verified[:.]?\s*/i, ""); return t.charAt(0).toUpperCase() + t.slice(1); };

export function FieldReadinessCard({ fr, name }: { fr?: FieldReadiness; name: string }) {
  if (!fr) return null;
  const historyOk = !!fr.analog_history && fr.analog_history_status === "documented";
  const permitsOk = !!fr.permits && fr.permits_status === "documented";
  const infraOk = !notVerified(fr.infrastructure);
  return (
    <div className="card-solid p-4" data-tour="field">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold">Field Readiness</h3>
        <span className="text-[11px] faint">Planning a test campaign at {name}{fr.elevation_m != null ? ` · ${Math.round(fr.elevation_m)} m above sea level` : ""}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FieldItem label="Used as an analog before" verified={historyOk} value={fr.analog_history ? fr.analog_history : "We found no documented analog campaign here."} />
        <FieldItem label="Permits" verified={permitsOk} value={fr.permits ?? "Unknown: check with the land manager."} />
        <FieldItem label="Field season" verified={!!fr.field_season} value={fr.field_season ?? "Unknown"} sub={fr.field_season_basis} />
        <FieldItem label="Infrastructure" verified={infraOk} value={fr.infrastructure ? (infraOk ? fr.infrastructure : stripNV(fr.infrastructure)) : "Road access, power and nearest airport not checked."} />
        {fr.low_sun_test_months && <div className="sm:col-span-2"><FieldItem label="Low-sun test window" verified value={fr.low_sun_test_months} /></div>}
      </div>
      <p className="text-[11px] faint mt-2">Dashed boxes are not verified: treat them as things to check, not facts.</p>
    </div>
  );
}

/* ---------- Sunlight & Earth view (Moon) / night infrared (Mars) ---------- */
function Mini({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] muted truncate">{label}</div>
      <div className="text-base font-semibold font-mono leading-tight">{value}</div>
      <div className="text-[10px] faint leading-tight">{sub}</div>
    </div>
  );
}
export function SunlightPanel({ body, illumination, nightIr, maxSun }: { body: "moon" | "mars"; illumination?: Illumination | null; nightIr?: NightIR | null; maxSun?: number }) {
  if (body === "moon" && illumination) {
    const il = illumination;
    return (
      <div className="flex flex-col gap-2" data-tour="sunlight">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-semibold">Sunlight & Earth View</span>
          <span className="text-[11px] faint">Modelled by Celestra from NASA Moon terrain maps</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          <Mini label="Sunlit" value={`${Math.round(il.sunlit_fraction * 100)}%`} sub="of the year, at the point" />
          <Mini label="Earth in view" value={`${Math.round(il.earth_visible_fraction * 100)}%`} sub="direct radio link" />
          <Mini label="Never lit" value={`${Math.round(il.psr_fraction_tile * 100)}%`} sub="of the 2 km window" />
          <Mini label="Highest sun" value={`${il.max_sun_elevation_deg.toFixed(1)}°`} sub="above the horizon" />
          <Mini label="Peak temp." value={`${Math.round(il.modelled_max_temp_c)}°C`} sub={`on the ${il.slope_deg_2km.toFixed(1)}° slope`} />
        </div>
        <details className="text-[11px] muted">
          <summary className="cursor-pointer select-none">How this is modelled</summary>
          <p className="mt-1 leading-relaxed">{il.method}{il.lola ? ` Terrain: ${il.lola.product ?? "LRO LOLA gridded DEM"} (NASA PDS), resampled to a ${il.lola.cell_m} m grid.` : ""} The 2 km window averages {Math.round(il.tile_sunlit_fraction * 100)}% sunlit. A model, not a measurement: treat it as a planning estimate.</p>
        </details>
      </div>
    );
  }
  if (body === "mars" && nightIr) {
    return (
      <div className="flex flex-col gap-1" data-tour="sunlight">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-semibold">Night-Time Infrared (Mars Odyssey THEMIS)</span>
          <span className="text-[11px] faint" title={`Mosaic ${nightIr.mosaic}; contrast ${nightIr.night_ir_contrast.toFixed(2)}, texture ${nightIr.night_ir_texture.toFixed(2)}`}>{nightIr.status.charAt(0).toUpperCase() + nightIr.status.slice(1)}</span>
        </div>
        <p className="text-sm">{nightIr.reading.charAt(0).toUpperCase() + nightIr.reading.slice(1)}.</p>
        <p className="text-[11px] faint">Ground that stays warm at night is rockier or more consolidated; ground that cools fast is loose dust or sand. Relative to the surroundings, not a temperature.</p>
      </div>
    );
  }
  if (body === "moon" && maxSun !== undefined && maxSun < 15) {
    return <p className="text-xs muted" data-tour="sunlight">The Sun never rises more than about <b style={{ color: "var(--text)" }}>{maxSun.toFixed(1)}°</b> above the horizon here, so shadows are long all day.</p>;
  }
  return null;
}
