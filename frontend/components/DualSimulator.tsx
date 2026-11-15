"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls, Stars } from "@react-three/drei";
import { ArrowLeft, RotateCcw, Rocket, Car, CheckCircle2, XCircle, Eye, Play, Trophy } from "lucide-react";
import type { EarthMatch, MatchPayload } from "@/components/AnalyticsView";
import { Status } from "@/components/ui";
import { RoverModel, LanderModel, BeaconModel, useRockParts, GroundRing, RouteRibbon, makeTerrainThermalMaterial, makeObjectThermalMaterial, useMaterialSwap, INFERNO_CSS } from "@/components/simModels";
import { apiUrl } from "@/lib/api";

/* =====================================================================================
   One mission, three parts: land on the pad, drive the surveyed route collecting rock
   samples with the claw, and dock at two stations to drill cores. Same mission on Earth
   and on the destination; the gravity, air and temperature are the only things that change.
   ===================================================================================== */
type WorldSide = "earth" | "space";
type Body = "earth" | "moon" | "mars";
type Sensor = "optical" | "sar" | "thermal";
type Phase = "brief-land" | "land" | "brief-drive" | "drive" | "done";

interface Score { landing: number; waypoints: number; rocks: number; cores: number; time: number }
interface RunRecord { status: "PASS" | "FAIL"; timeSec: number; headline: string; reason: string; score: Score; total: number; numbers: { label: string; value: string }[] }

interface RoverSpec { id: string; name: string; costM: number; wheels: string; maxTempC: number; radiator: number; armor: number; topSpeed: number; grip: number; bestFor?: Body; heat: string; tough: string; note: string }
const ROVERS: RoverSpec[] = [
  { id: "budget_buggy", name: "Budget buggy", costM: 18, wheels: "Rubber tyres", maxTempC: 112, radiator: 0.04, armor: 0.26, topSpeed: 5.2, grip: 0.65, heat: "Low", tough: "Weak", note: "Cheap and quick on Earth. Rubber shreds on sharp rock and the motor has no radiator." },
  { id: "desert_scout", name: "Desert scout", costM: 48, wheels: "Aluminium treads", maxTempC: 140, radiator: 0.22, armor: 0.55, topSpeed: 5.0, grip: 0.85, bestFor: "earth", heat: "Medium", tough: "Fair", note: "A good Earth field vehicle; relies on air to cool its motor." },
  { id: "micro_hopper", name: "Micro scout", costM: 95, wheels: "Titanium mesh", maxTempC: 152, radiator: 0.42, armor: 0.68, topSpeed: 6.2, grip: 0.82, heat: "Medium", tough: "Fair", note: "Fastest of the set. Thin wheels wear quickly." },
  { id: "mars_perseverance", name: "Mars class", costM: 145, wheels: "Machined titanium", maxTempC: 185, radiator: 0.82, armor: 1.45, topSpeed: 4.6, grip: 0.95, bestFor: "mars", heat: "High", tough: "Strong", note: "Built for thin air and cold: radiators and hard wheels." },
  { id: "lunar_cryo", name: "Lunar class", costM: 195, wheels: "Shape-memory alloy", maxTempC: 205, radiator: 1.05, armor: 1.85, topSpeed: 4.8, grip: 1.05, bestFor: "moon", heat: "Very high", tough: "Very strong", note: "Big radiators for vacuum, springy wheels for low gravity." },
  { id: "heavy_isru", name: "Heavy hauler", costM: 280, wheels: "Steel crawler", maxTempC: 225, radiator: 1.25, armor: 2.5, topSpeed: 3.6, grip: 1.15, heat: "Very high", tough: "Armoured", note: "Slow, tough and expensive." },
];

const WORLD_SIZE = 96;
const MASS_KG = 650;
const WAYPOINTS = 5;
const ROCKS = 6;
const STATIONS = 2;
const CORE_TARGET_M = 1.0;
const DRILL_LIMIT_C = 110;
const LAND_SPEED_LIMIT = 3.0;
const PAD_RADIUS = 5.0;
const POINTS = { landing: 30, waypoint: 8, rockClean: 10, rockFumbled: 6, core: 25, timeMax: 25 };
const STUCK_SECONDS = 4.5;
const MAX_SCORE = POINTS.landing + 10 + WAYPOINTS * POINTS.waypoint + ROCKS * POINTS.rockClean + STATIONS * POINTS.core + POINTS.timeMax;

/* ---------- terrain helpers: heights come from the site's elevation data ---------- */
function hashString(str?: string): number { if (!str) return 777; let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
const rng = (seed: number) => { let s = seed % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; };
function shapeEdges(grid: number[], wx: number, wz: number, raw: number): number {
  if (!grid || grid.length !== 128 * 128) return raw;
  let h = raw; const d = Math.hypot(wx, wz);
  if (d < 7.5) { const c = grid[64 * 128 + 64] || 0; h = THREE.MathUtils.lerp(c, h, THREE.MathUtils.smoothstep(d, 3.8, 7.5)); }
  const e = Math.max(Math.abs(wx), Math.abs(wz));
  if (e > WORLD_SIZE / 2 - 4) h = THREE.MathUtils.lerp(h, 0, THREE.MathUtils.smoothstep(e, WORLD_SIZE / 2 - 4, WORLD_SIZE / 2));
  return h;
}
function rawHeight(grid: number[], wx: number, wz: number): number {
  const u = THREE.MathUtils.clamp((wx + WORLD_SIZE / 2) / WORLD_SIZE, 0, 1) * 127, v = THREE.MathUtils.clamp((wz + WORLD_SIZE / 2) / WORLD_SIZE, 0, 1) * 127;
  const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(127, x0 + 1), y1 = Math.min(127, y0 + 1), tx = u - x0, ty = v - y0;
  const h00 = grid[y0 * 128 + x0] || 0, h10 = grid[y0 * 128 + x1] || 0, h01 = grid[y1 * 128 + x0] || 0, h11 = grid[y1 * 128 + x1] || 0;
  return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
}
/* height and slope of the surface as drawn (including the flattened pad), so physics and picture agree */
function sample(grid: number[], relief: number, wx: number, wz: number, ve = 1): { h: number; slopeDeg: number } {
  if (!grid || grid.length !== 128 * 128 || Math.abs(wx) > WORLD_SIZE / 2 || Math.abs(wz) > WORLD_SIZE / 2) return { h: 0, slopeDeg: 0 };
  const H = (x: number, z: number) => shapeEdges(grid, x, z, rawHeight(grid, x, z)) * relief;
  const d = WORLD_SIZE / 127;
  const h = H(wx, wz);
  const grad = Math.hypot(H(wx + d, wz) - H(wx - d, wz), H(wx, wz + d) - H(wx, wz - d)) / (2 * d);
  return { h, slopeDeg: THREE.MathUtils.radToDeg(Math.atan(grad / ve)) };   // slope of the real ground, whatever the drawing exaggeration
}
// points on the rover (model frame, metres) that must stay above the ground: the six wheel bottoms and the belly
const ROVER_CONTACTS: [number, number, number][] = [
  [-0.62, -0.27, -0.62], [-0.62, -0.27, 0], [-0.62, -0.27, 0.62], [0.62, -0.27, -0.62], [0.62, -0.27, 0], [0.62, -0.27, 0.62],
  [0, -0.05, 0],
];
const CONTACT_TMP = new THREE.Vector3();
const CAM_DIR_TMP = new THREE.Vector3();
const LANDER_FOOT = 0.6;   // lander origin above its footpads
const LANDER_FEET: [number, number][] = [[0, -1.0], [-0.87, 0.5], [0.87, 0.5]];   // the three footpads of the model, in metres from its centre

/* ---------- procedural textures ---------- */
function noiseCanvas(seed: number, base: string, grain: string, speck: string, size = 512): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d")!; const r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 36; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  g.fillStyle = grain; for (let i = 0; i < 2600; i++) { const s = 1 + r() * 3; g.globalAlpha = 0.25 + r() * 0.4; g.fillRect(r() * size, r() * size, s, s); }
  g.fillStyle = speck; for (let i = 0; i < 700; i++) { g.globalAlpha = 0.2 + r() * 0.5; g.beginPath(); g.arc(r() * size, r() * size, 1 + r() * 4, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1; return c;
}
function panelCanvas(base = "#d6dbe3", line = "#8a94a3", size = 256): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d")!; const r = rng(99);
  g.fillStyle = base; g.fillRect(0, 0, size, size); g.strokeStyle = line; g.lineWidth = 2;
  for (let i = 0; i < 5; i++) { const x = (i + 0.5) * (size / 5) + (r() - 0.5) * 20; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.stroke(); }
  for (let i = 0; i < 4; i++) { const y = (i + 0.5) * (size / 4); g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }
  g.fillStyle = "#5b6472"; for (let i = 0; i < 80; i++) { g.beginPath(); g.arc(r() * size, r() * size, 2, 0, Math.PI * 2); g.fill(); }
  return c;
}
function tex(canvas: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8; return t; }

function groundPalette(body: Body, mineral: string) {
  if (body === "moon") return { base: "#9aa0a8", grain: "#c3c8cf", speck: "#5b616b", low: "#7c838c", mid: "#a4abb4", rock: "#d2d6db" };
  if (body === "mars") return mineral === "basalt_ice" ? { base: "#8a3a1e", grain: "#b4552c", speck: "#d9d9d9", low: "#7c2d12", mid: "#a3431f", rock: "#cbd5e1" } : { base: "#9a3f1c", grain: "#c2602e", speck: "#5a1f0c", low: "#7c2d12", mid: "#c2410c", rock: "#451a03" };
  if (mineral === "biomass_wet") return { base: "#2f5e2a", grain: "#4a7c3a", speck: "#1b3d17", low: "#14532d", mid: "#3f7a32", rock: "#5b7a2a" };
  if (mineral === "evaporite_sulfate") return { base: "#d8d4cc", grain: "#eeeae2", speck: "#8c8578", low: "#c9c4ba", mid: "#e2ded6", rock: "#8c8578" };
  if (mineral.includes("basalt")) return { base: "#3b3733", grain: "#57534e", speck: "#1c1917", low: "#292524", mid: "#4a4541", rock: "#6b645d" };
  return { base: "#b08a5c", grain: "#c8a373", speck: "#6b5544", low: "#a18056", mid: "#c29b6b", rock: "#6b5544" };
}

/* ---------- terrain ---------- */
const UP_AXIS = new THREE.Vector3(0, 1, 0);

/* slope classes for the Slope view, in degrees: what a rover can drive */
export const SLOPE_CLASSES = [
  { max: 5, color: "#22c55e", label: "0–5° easy" },
  { max: 15, color: "#eab308", label: "5–15° careful" },
  { max: 25, color: "#f97316", label: "15–25° rover limit" },
  { max: 90, color: "#dc2626", label: "> 25° no-go" },
];
function slopeColor(deg: number, out: THREE.Color) {
  const stops = [[0, "#16a34a"], [5, "#84cc16"], [10, "#eab308"], [15, "#f59e0b"], [20, "#f97316"], [25, "#dc2626"], [40, "#7f1d1d"]] as [number, string][];
  for (let k = 1; k < stops.length; k++) if (deg <= stops[k][0]) { const [d0, c0] = stops[k - 1], [d1, c1] = stops[k]; return out.set(c0).lerp(new THREE.Color(c1), (deg - d0) / (d1 - d0)); }
  return out.set(stops[stops.length - 1][1]);
}

/* The surface-temperature model behind the Heat view. Sun direction and mission time come from the scene.
   Each vertex has an equilibrium temperature from the sun's incidence on its facet (and whether a ridge shades it),
   and its actual temperature relaxes towards it with a thermal lag, so the ground warms up as the mission goes on.
   Vacuum: radiative balance, T = Tmax·cos(i)^¼ in kelvin, shadows fall to the night temperature (huge contrast).
   Air: convection evens it out (smaller contrast, shadows stay milder). */
export interface ThermalState { temps: Float32Array | null; lo: number; hi: number }
export interface SunState { dir: THREE.Vector3; t: number; exhaust: { x: number; z: number; p: number } }
function Terrain({ siteId, grid, reliefM, body, mineral, sensor, sunRef, thermalRef, tminC, tmaxC, airy, ve }: { siteId: string; grid: number[] | null; reliefM: number; body: Body; mineral: string; sensor: Sensor; sunRef: React.MutableRefObject<SunState>; thermalRef: React.MutableRefObject<ThermalState>; tminC: number; tmaxC: number; airy: number; ve: number }) {
  const relief = (reliefM / 2000) * WORLD_SIZE * ve;   // the 2 km tile drawn at true proportions, times the chosen vertical exaggeration
  const pal = useMemo(() => groundPalette(body, mineral), [body, mineral]);
  const map = useMemo(() => tex(noiseCanvas(hashString(siteId), pal.base, pal.grain, pal.speck), 22), [siteId, pal]);
  const thermalMat = useMemo(() => makeTerrainThermalMaterial(), []);
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 127, 127); geo.rotateX(-Math.PI / 2);
    if (!grid || grid.length !== 128 * 128) return geo;
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), slopeColors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) pos.setY(i, shapeEdges(grid, pos.getX(i), pos.getZ(i), grid[i] || 0) * relief);
    geo.computeVertexNormals();
    const n = geo.attributes.normal, tmp = new THREE.Color(), low = new THREE.Color(pal.low), mid = new THREE.Color(pal.mid), rock = new THREE.Color(pal.rock);
    for (let i = 0; i < pos.count; i++) {
      const steep = THREE.MathUtils.clamp((1 - n.getY(i)) * 4.5, 0, 1);
      tmp.copy(low).lerp(mid, grid[i] || 0).lerp(rock, steep * 0.85).multiplyScalar(1.35);
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
      const drawn = Math.acos(THREE.MathUtils.clamp(n.getY(i), -1, 1));
      slopeColor(THREE.MathUtils.radToDeg(Math.atan(Math.tan(drawn) / ve)), tmp);   // true slope, not the exaggerated one
      slopeColors.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.userData.camera = colors; geo.userData.slope = slopeColors;
    geo.setAttribute("temp", new THREE.BufferAttribute(new Float32Array(pos.count), 1));
    return geo;
  }, [grid, relief, pal, ve]);

  // which colours the Camera / Slope views show
  useEffect(() => {
    const c = geometry.getAttribute("color") as THREE.BufferAttribute | undefined; if (!c || !geometry.userData.camera) return;
    (c.array as Float32Array).set(sensor === "sar" ? geometry.userData.slope : geometry.userData.camera); c.needsUpdate = true;
  }, [geometry, sensor]);

  // thermal model state for this terrain
  const th = useRef<{ T: Float32Array | null; eq: Float32Array | null; lit: Uint8Array | null; sunKey: number; last: number; shadowAt: number }>({ T: null, eq: null, lit: null, sunKey: -999, last: -1, shadowAt: -99 });
  const surfMaxC = tmaxC;   // both ends are measured surface temperatures (MODIS on Earth, Diviner on the Moon)
  const nightC = tminC + (tmaxC - tminC) * 0.12 * airy;
  useEffect(() => {
    th.current = { T: null, eq: null, lit: null, sunKey: -999, last: -1, shadowAt: -99 };
    thermalRef.current = { temps: null, lo: tminC - 5, hi: surfMaxC + 5 };
  }, [geometry, tminC, surfMaxC, thermalRef]);

  useFrame(() => {
    const pos = geometry.attributes.position, nrm = geometry.attributes.normal, tA = geometry.getAttribute("temp") as THREE.BufferAttribute | undefined;
    if (!tA || !grid) return;
    const sun = sunRef.current, st = th.current, N = pos.count;
    if (st.last >= 0 && sun.t - st.last < 0.25 && sun.t >= st.last) return;
    const dt = st.last < 0 || sun.t < st.last ? 0 : sun.t - st.last; st.last = sun.t;
    if (!st.T) { st.T = new Float32Array(N).fill(nightC); st.eq = new Float32Array(N); st.lit = new Uint8Array(N); }
    // ridge shadows: march across the height grid towards the sun; redone when the sun has moved a few degrees
    const key = Math.round(Math.atan2(sun.dir.x, sun.dir.z) * 30) * 1000 + Math.round(Math.asin(sun.dir.y) * 60);
    if (key !== st.sunKey || st.shadowAt < 0) {
      st.sunKey = key; st.shadowAt = sun.t;
      const cell = WORLD_SIZE / 127, hz = Math.hypot(sun.dir.x, sun.dir.z) || 1e-6, tanEl = sun.dir.y / hz, sx = sun.dir.x / hz, sz = sun.dir.z / hz;
      for (let r = 0; r < 128; r++) for (let c = 0; c < 128; c++) {
        const i = r * 128 + c, h0 = pos.getY(i); let lit = sun.dir.y > 0 ? 1 : 0;
        for (let k = 1; lit && k < 60; k++) { const cc = Math.round(c + sx * k), rr = Math.round(r + sz * k); if (cc < 0 || rr < 0 || cc > 127 || rr > 127) break; if (pos.getY(rr * 128 + cc) > h0 + tanEl * k * cell + 0.02) lit = 0; }
        st.lit![i] = lit;
      }
    }
    const tnK = nightC + 273.15, tmK = surfMaxC + 273.15, tau = airy > 0.5 ? 28 : 10, a = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
    const lo = tminC - 5, hi = surfMaxC + 5, arr = tA.array as Float32Array, ex = sun.exhaust, exhaustC = surfMaxC + (airy > 0.5 ? 120 : 220);
    for (let i = 0; i < N; i++) {
      const inc = Math.max(0, nrm.getX(i) * sun.dir.x + nrm.getY(i) * sun.dir.y + nrm.getZ(i) * sun.dir.z) * st.lit![i];
      const vac = Math.max(tnK, tmK * Math.pow(inc, 0.25)) - 273.15;
      const air = nightC + (surfMaxC - nightC) * (0.18 + 0.82 * inc) * (st.lit![i] ? 1 : 0.55);
      st.eq![i] = vac + (air - vac) * Math.pow(airy, 0.35);
      st.T[i] += (st.eq![i] - st.T[i]) * a;
      if (ex.p > 0) {   // exhaust blast: hot gas scours the ground under the engine
        const d2 = (pos.getX(i) - ex.x) ** 2 + (pos.getZ(i) - ex.z) ** 2;
        if (d2 < 49) st.T[i] += (exhaustC - st.T[i]) * Math.min(1, dt * 3) * ex.p * Math.exp(-d2 / 6);
      }
      arr[i] = (st.T[i] - lo) / (hi - lo);
    }
    tA.needsUpdate = true;
    thermalRef.current = { temps: st.T, lo, hi };
  });

  const half = WORLD_SIZE / 2, ext = 160;
  const outer = sensor === "thermal" ? "#1b0a33" : sensor === "sar" ? "#30343b" : pal.low;
  return (
    <group>
      <mesh geometry={geometry} receiveShadow material={sensor === "thermal" ? thermalMat : undefined}>
        {sensor !== "thermal" && <meshStandardMaterial key={sensor} vertexColors map={sensor === "sar" ? null : map} roughness={0.95} metalness={0.02} />}
      </mesh>
      {[[0, -(half + ext / 2), WORLD_SIZE + ext * 2, ext], [0, half + ext / 2, WORLD_SIZE + ext * 2, ext], [-(half + ext / 2), 0, ext, WORLD_SIZE], [half + ext / 2, 0, ext, WORLD_SIZE]].map(([x, z, w, h], i) => (
        <mesh key={i} position={[x, 0, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[w, h]} />{sensor === "thermal" ? <meshBasicMaterial color={outer} /> : <meshStandardMaterial color={outer} map={sensor === "sar" ? null : map} roughness={0.95} />}</mesh>
      ))}
    </group>
  );
}

/* ---------- vehicles: the user's 3D models (see simModels.tsx for credits) ---------- */
function Rover({ groupRef }: { groupRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group ref={groupRef}>
      <RoverModel />
    </group>
  );
}

function Lander({ groupRef, flameRef }: { groupRef: React.RefObject<THREE.Group | null>; flameRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group ref={groupRef}>
      <LanderModel />
      <group ref={flameRef} position={[0, -0.6, 0]} visible={false}>
        <mesh rotation={[Math.PI, 0, 0]} userData={{ keepMaterial: true }}><coneGeometry args={[0.3, 1.3, 14]} /><meshBasicMaterial color="#fb923c" transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
        <mesh position={[0, 0.2, 0]} rotation={[Math.PI, 0, 0]} userData={{ keepMaterial: true }}><coneGeometry args={[0.15, 0.8, 10]} /><meshBasicMaterial color="#bae6fd" transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
        <pointLight intensity={8} distance={12} color="#fdba74" />
      </group>
    </group>
  );
}

/* a sample station: drill mast on a frame, a parking pad, and a beacon lamp */
function StationRig({ x, y, z, state, carriageRef, bitMat }: { x: number; y: number; z: number; state: "todo" | "active" | "done" | "lost"; carriageRef?: (el: THREE.Group | null) => void; bitMat?: (el: THREE.MeshStandardMaterial | null) => void }) {
  const panels = useMemo(() => tex(panelCanvas("#cfd5de", "#7d8794")), []);
  const col = state === "done" ? "#22c55e" : state === "lost" ? "#ef4444" : state === "active" ? "#fbbf24" : "#38bdf8";
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.12, 0]}><boxGeometry args={[1.6, 0.16, 1.6]} /><meshStandardMaterial map={panels} metalness={0.5} roughness={0.4} /></mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([ax, az], i) => (
        <group key={i}>
          <mesh position={[ax * 1.1, 0.1, az * 1.1]} rotation={[0, Math.atan2(ax, az), 0]}><boxGeometry args={[0.1, 0.08, 0.9]} /><meshStandardMaterial color="#6b7280" metalness={0.6} /></mesh>
          <mesh position={[ax * 1.45, 0.04, az * 1.45]}><cylinderGeometry args={[0.16, 0.18, 0.08, 12]} /><meshStandardMaterial color="#374151" /></mesh>
        </group>
      ))}
      <mesh position={[0.4, 1.6, 0]}><boxGeometry args={[0.16, 2.9, 0.16]} /><meshStandardMaterial color="#9ca3af" metalness={0.7} roughness={0.3} /></mesh>
      <mesh position={[0.4, 3.08, 0]}><boxGeometry args={[0.5, 0.12, 0.3]} /><meshStandardMaterial color="#374151" metalness={0.6} /></mesh>
      <mesh position={[0.4, 3.3, 0]}><sphereGeometry args={[0.12, 12, 10]} /><meshStandardMaterial color={col} emissive={col} emissiveIntensity={1.4} /></mesh>
      <group ref={carriageRef} position={[0, 2.4, 0]}>
        <mesh position={[0.2, 0, 0]}><boxGeometry args={[0.6, 0.4, 0.4]} /><meshStandardMaterial color="#1f2937" metalness={0.7} roughness={0.3} /></mesh>
        <mesh position={[0, -0.9, 0]}><cylinderGeometry args={[0.06, 0.06, 2.4, 12]} /><meshStandardMaterial ref={bitMat} color="#cbd5e1" metalness={0.8} roughness={0.25} /></mesh>
        {Array.from({ length: 9 }, (_, i) => <mesh key={i} position={[0, -0.25 - i * 0.2, 0]} rotation={[0.25, i * 0.9, 0]}><torusGeometry args={[0.13, 0.025, 8, 18]} /><meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.25} /></mesh>)}
        <mesh position={[0, -2.15, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.1, 0.25, 10]} /><meshStandardMaterial color="#f59e0b" metalness={0.8} /></mesh>
      </group>
    </group>
  );
}

function Waypoint({ x, y, z, state }: { x: number; y: number; z: number; state: "done" | "next" | "later" }) {
  return <group position={[x, y, z]}><BeaconModel state={state} /></group>;
}

/* a flagged sample rock: one of the rocks from the model, with a small light above it that brightens as you approach */
function SampleRock({ x, y, z, taken, near, lifting, seed, geo, material }: { x: number; y: number; z: number; taken: boolean; near: boolean; lifting: boolean; seed: number; geo: THREE.BufferGeometry; material: THREE.Material }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null), stone = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    if (lamp.current) lamp.current.emissiveIntensity = near ? 2.2 + Math.sin(clock.elapsedTime * 6) * 0.8 : 0.9;
    if (stone.current) { const goal = lifting ? 0.35 + Math.sin(clock.elapsedTime * 9) * 0.03 : 0; stone.current.position.y += (goal - stone.current.position.y) * Math.min(1, dt * 8); }   // the arm lifts it while you hold E
  });
  if (taken) return null;
  const size = 0.5 + (seed % 5) * 0.06;
  return (
    <group position={[x, y - 0.04, z]}>
      <mesh ref={stone} geometry={geo} material={material} scale={size} rotation={[0, (seed % 7) * 0.9, 0]} castShadow receiveShadow />
      <mesh position={[0, size * 0.9 + 0.45, 0]}><octahedronGeometry args={[0.07, 0]} /><meshStandardMaterial ref={lamp} color="#67e8f9" emissive="#67e8f9" emissiveIntensity={0.9} /></mesh>
    </group>
  );
}

/* =====================================================================================
   The scene: physics, camera and the mission state machine
   ===================================================================================== */
interface Telemetry { [k: string]: number | string | boolean | undefined }
type DriveEvent = { type: "waypoint"; n: number } | { type: "rock"; clean: boolean; n: number } | { type: "core"; n: number } | { type: "station-lost"; n: number } | { type: "dock"; on: boolean } | { type: "fail"; headline: string; reason: string } | { type: "complete" };

function makeGuide(x: number, y: number, z: number, padY: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24, u = 1 - t; pts.push([u * u * x + 2 * u * t * x * 0.35, u * u * y + 2 * u * t * (padY + 6) + t * t * (padY + 0.6), u * u * z + 2 * u * t * z * 0.35]); }
  return pts;
}

function SimScene(p: {
  siteId: string; body: Body; gravity: number; pressure: number; mineral: string; iron: number; clay: number; bareness: number; ambientC: number; roughness: number;
  grid: number[] | null; reliefM: number; sensor: Sensor; rover: RoverSpec; keysRef: React.MutableRefObject<Record<string, boolean>>;
  lookRef: React.MutableRefObject<{ yaw: number; pitch: number }>; thirdPerson: boolean; runId: number; phase: Phase; paused: boolean; docked: boolean;
  waypointIdx: number; tminC: number; tmaxC: number; sunElevMax: number; ve: number; cursorRef: React.MutableRefObject<number>; onTelemetry: (t: Telemetry) => void; onLanded: (ok: boolean, headline: string, reason: string, numbers: { label: string; value: string }[], bonus: number) => void; onDrive: (e: DriveEvent) => void;
}) {
  const { siteId, body, gravity, pressure, mineral, iron, clay, bareness, ambientC, roughness, grid, reliefM, sensor, rover, keysRef, lookRef, thirdPerson, runId, phase, paused, docked, waypointIdx, tminC, tmaxC, sunElevMax, ve, cursorRef, onTelemetry, onLanded, onDrive } = p;
  const getState = useThree((st) => st.get);
  const controls = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const relief = (reliefM / 2000) * WORLD_SIZE * ve;
  const airy = THREE.MathUtils.clamp(pressure / 1.013, 0, 1);
  const heightAt = useCallback((x: number, z: number) => (grid ? sample(grid, relief, x, z).h : 0), [grid, relief]);
  const rockParts = useRockParts();

  // the surveyed layout: five waypoints, the flagged rocks and two stations, spread out with clear space between them;
  // the same every run for a site
  const layout = useMemo(() => {
    if (!grid) return { route: [] as { x: number; z: number; y: number }[], rocks: [] as { x: number; z: number; y: number }[], stations: [] as { x: number; z: number; y: number }[] };
    const r = rng(hashString(siteId) + 11), H = (x: number, z: number) => sample(grid, relief, x, z).h, lim = WORLD_SIZE / 2 - 6;
    const base = [[6, -9], [-8, -18], [8, -27], [-6, -36], [2, -43]];
    const route = base.map(([x, z]) => { const px = x + (r() - 0.5) * 5, pz = z + (r() - 0.5) * 2.5; return { x: px, z: pz, y: H(px, pz) }; });
    const placed: { x: number; z: number; clear: number }[] = [{ x: 0, z: 0, clear: 9 }, ...route.map((w) => ({ x: w.x, z: w.z, clear: 5 }))];
    const free = (x: number, z: number, clear: number) => Math.abs(x) < lim && Math.abs(z) < lim && placed.every((q) => Math.hypot(q.x - x, q.z - z) >= Math.max(clear, q.clear));
    const pick = (gen: (t: number) => [number, number], clear: number) => {
      for (let t = 0; t < 40; t++) { const [x, z] = gen(t); if (free(x, z, clear)) { placed.push({ x, z, clear }); return { x, z, y: H(x, z) }; } }
      const [x, z] = gen(0); placed.push({ x, z, clear }); return { x, z, y: H(x, z) };
    };
    const stations = [1, 3].map((i, k) => { const w = route[i], side = k ? -1 : 1; return pick((t) => [w.x + side * (7.5 + t * 0.4), w.z + 1.5 - t * 0.3], 8); });
    const rocks: { x: number; z: number; y: number }[] = [];
    [0, 1, 2, 3, 4, 2].slice(0, ROCKS).forEach((l, n) => {
      const a = l === 0 ? { x: 0, z: 0 } : route[l - 1], b = route[l], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
      const f = l === 0 || n === 5 ? 0.78 : 0.5, side = n % 2 ? 1 : -1;
      rocks.push(pick((t) => { const off = (3.4 + r() * 1.4 + t * 0.12) * side * (t % 2 ? -1 : 1), g = f + (t % 3 - 1) * 0.08; return [a.x + dx * g + nx * off, a.z + dz * g + nz * off]; }, 5.5));
    });
    return { route, rocks, stations };
  }, [siteId, grid, relief]);
  const routePoints = useMemo(() => [{ x: 0, z: 0 }, ...layout.route.map((w) => ({ x: w.x, z: w.z }))], [layout]);

  // the sun moves through the mission; the light, the shadows and the Heat view all follow it
  const sunRef = useRef<SunState>({ dir: new THREE.Vector3(0.5, 0.6, 0.4).normalize(), t: 0, exhaust: { x: 0, z: 0, p: 0 } });
  const thermalRef = useRef<ThermalState>({ temps: null, lo: 0, hi: 1 });
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const [thermalMats] = useState(() => ({ rover: makeObjectThermalMaterial(), lander: makeObjectThermalMaterial(), station: makeObjectThermalMaterial(), rock: makeObjectThermalMaterial(), beacon: makeObjectThermalMaterial() }));
  const thermalUniforms = useRef(thermalMats);   // updated every frame through the ref
  const stationsRef = useRef<THREE.Group>(null), rocksRef = useRef<THREE.Group>(null), beaconsRef = useRef<THREE.Group>(null);
  const rockT = useRef<number | null>(null);
  const groundTempAt = useCallback((x: number, z: number) => {
    const th = thermalRef.current; if (!th.temps) return ambientC;
    const c = Math.round(THREE.MathUtils.clamp((x + WORLD_SIZE / 2) / WORLD_SIZE, 0, 1) * 127), r = Math.round(THREE.MathUtils.clamp((z + WORLD_SIZE / 2) / WORLD_SIZE, 0, 1) * 127);
    return th.temps[r * 128 + c];
  }, [ambientC]);

  const roverRef = useRef<THREE.Group>(null), landerRef = useRef<THREE.Group>(null);
  const [grabIdx, setGrabIdx] = useState(-1);
  const thermalOn = sensor === "thermal";
  useMaterialSwap(roverRef, thermalOn, thermalMats.rover, phase);
  useMaterialSwap(landerRef, thermalOn, thermalMats.lander, phase);
  useMaterialSwap(stationsRef, thermalOn, thermalMats.station, phase);
  useMaterialSwap(rocksRef, thermalOn, thermalMats.rock, phase);
  useMaterialSwap(beaconsRef, thermalOn, thermalMats.beacon, phase);
  const flameRef = useRef<THREE.Group>(null), dustRef = useRef<THREE.Group>(null), predictRef = useRef<THREE.Mesh>(null), dropRef = useRef<THREE.Mesh>(null);
  const carriages = useRef<(THREE.Group | null)[]>([]), bits = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const [dockIdx, setDockIdx] = useState(-1);
  const [guide, setGuide] = useState<[number, number, number][]>([]);
  const [taken, setTaken] = useState<boolean[]>(() => Array(ROCKS).fill(false));
  const [stationState, setStationState] = useState<("todo" | "done" | "lost")[]>(["todo", "todo"]);
  const [nearRock, setNearRock] = useState(-1);
  const prevFocus = useRef(new THREE.Vector3());
  // chase camera: follows the rover's turns, and swings back behind it while driving unless the player is orbiting
  const chase = useRef({ yaw: 0, orbiting: false, releasedAt: -10 });

  const rock = useMemo(() => {
    if (bareness < 0.70) return { label: "vegetated, moist soil", hardness: 0.55, dry: false };
    return { label: mineral.replace(/_/g, " "), hardness: THREE.MathUtils.clamp(0.75 + iron * 0.45 - clay * 0.35, 0.55, 1.65), dry: true };
  }, [bareness, iron, clay, mineral]);

  const s = useRef({ t: 0, rx: 0, rz: 3, yaw: 0, speed: 0, wheel: 100, motor: 30, hot: false, wp: 0, slip: 0, svx: 0, svz: 0, sliding: false, stuckFor: 0, peakSlip: 0, grabbing: false, grabT: 0, grabRock: -1, armT: 0, fPrev: false, ePrev: false, pitchS: 0, rollS: 0, blindUntil: -1,
    lx: 2.5, lz: 7, ly: 26, vx: 0, vy: 0, vz: 0, fuel: 100, heat: 0, landed: false, dock: -1, depth: 0, bit: 30, pulses: 0, lastDrill: false, emit: 0, pad: 0, done: false });

  // reset on a new run
  useEffect(() => {
    const padH = grid ? sample(grid, relief, 0, 0).h : 0;
    const startT = THREE.MathUtils.clamp(ambientC, -35, 45);
    lookRef.current = { yaw: 0, pitch: 0 };
    s.current = { t: 0, rx: 0, rz: 3, yaw: 0, speed: 0, wheel: 100, motor: startT, hot: false, wp: 0, slip: 0, svx: 0, svz: 0, sliding: false, stuckFor: 0, peakSlip: 0, grabbing: false, grabT: 0, grabRock: -1, armT: 0, fPrev: false, ePrev: false, pitchS: 0, rollS: 0, blindUntil: -1,
      lx: 2.5, lz: 7, ly: padH + 22, vx: 0, vy: -0.4, vz: 0, fuel: 100, heat: 0, landed: false, dock: -1, depth: 0, bit: startT, pulses: 0, lastDrill: false, emit: 0, pad: padH, done: false };
    const camera = getState().camera;
    prevFocus.current.set(2.5, padH + 22, 7); camera.position.set(13, padH + 28, 21);
    if (controls.current) { controls.current.target.set(2.5, padH + 22, 7); controls.current.update(); }
  }, [siteId, runId, grid, relief, ambientC, getState, lookRef]);

  // camera hand-over when the drive begins
  useEffect(() => {
    if (phase !== "drive" || !grid) return;
    const st = s.current, camera = getState().camera, h = sample(grid, relief, st.rx, st.rz).h;
    prevFocus.current.set(st.rx, h + 0.4, st.rz);
    chase.current.yaw = st.yaw;
    if (thirdPerson) { camera.position.set(st.rx + Math.sin(st.yaw) * 5.2, h + 3.0, st.rz + Math.cos(st.yaw) * 5.2); if (controls.current) { controls.current.target.set(st.rx, h + 0.4, st.rz); controls.current.update(); } }
  }, [phase, thirdPerson, grid, relief, getState]);

  useFrame(({ clock, camera }, raw) => {
    const dt = Math.min(raw, 0.05), st = s.current, k = keysRef.current;
    if (!grid || grid.length !== 128 * 128) return;

    // sun: low in the morning and climbing through the mission; at the lunar poles it skims the horizon
    {
      const prog = THREE.MathUtils.clamp(st.t / 150, 0, 1), polar = sunElevMax < 15;
      const el = THREE.MathUtils.degToRad(polar ? Math.max(7, sunElevMax) * (0.85 + 0.15 * Math.sin(prog * Math.PI)) : THREE.MathUtils.lerp(Math.max(8, sunElevMax * 0.3), sunElevMax, Math.sin((prog * Math.PI) / 2)));
      const az = THREE.MathUtils.degToRad(polar ? 200 + prog * 50 : 115 + prog * 65);
      sunRef.current.dir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
      sunRef.current.t = st.t;
      const fx = phase === "land" ? st.lx : st.rx, fz = phase === "land" ? st.lz : st.rz, l = lightRef.current;
      if (l) { l.position.set(fx + sunRef.current.dir.x * 45, sunRef.current.dir.y * 45, fz + sunRef.current.dir.z * 45); l.target.position.set(fx, 0, fz); l.target.updateMatrixWorld(); }
    }
    // thermal-camera colours of the objects, from the modelled ground temperature around them
    {
      const tm = thermalUniforms.current, th = thermalRef.current, span = th.hi - th.lo || 1, norm = (c: number) => (c - th.lo) / span;
      const groundC = groundTempAt;
      const rv = roverRef.current, ld = landerRef.current;
      if (rv) { const u = tm.rover.uniforms; u.uBase.value = norm(groundC(st.rx, st.rz)) + 0.22; u.uHot.value = norm(st.motor); u.uBaseY.value = rv.position.y - 0.27; u.uHotH.value = 0.55; }
      if (ld) { const u = tm.lander.uniforms; u.uBase.value = norm(groundC(st.lx, st.lz)) + 0.12; u.uHot.value = st.heat > 0.05 || (phase === "land" && flameRef.current?.visible) ? 1.05 : u.uBase.value; u.uBaseY.value = ld.position.y - 0.6; u.uHotH.value = 0.8; }
      if (layout.stations.length) { const stn = layout.stations[Math.max(0, st.dock)], u = tm.station.uniforms; u.uBase.value = norm(groundC(stn.x, stn.z)) + 0.08; u.uHot.value = st.dock >= 0 ? norm(st.bit) : u.uBase.value; u.uBaseY.value = stn.y; u.uHotH.value = 1.2; }
      if (layout.rocks.length) {
        const mean = layout.rocks.reduce((a, rk) => a + groundC(rk.x, rk.z), 0) / layout.rocks.length;
        if (rockT.current === null) rockT.current = mean;
        if (!paused) rockT.current += (mean - rockT.current) * (1 - Math.exp(-dt / (airy > 0.5 ? 130 : 55)));   // rock holds heat longer than loose soil
        const u = tm.rock.uniforms; u.uBase.value = norm(rockT.current); u.uHot.value = u.uBase.value; u.uHotH.value = 0;
      }
      { const u = tm.beacon.uniforms; u.uBase.value = norm(groundC(0, -20)) + 0.18; u.uHot.value = u.uBase.value; u.uHotH.value = 0; }
    }
    if (paused || st.done) return;

    /* ---------------- landing ---------------- */
    if (phase === "land") {
      const thrust = k["Space"] || k["ThrustHold"] ? 1 : 0;
      const fi = (k["KeyW"] || k["ArrowUp"] ? 1 : 0) - (k["KeyS"] || k["ArrowDown"] ? 1 : 0), ri = (k["KeyD"] || k["ArrowRight"] ? 1 : 0) - (k["KeyA"] || k["ArrowLeft"] ? 1 : 0);
      st.t += dt;
      const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
      const g = (gravity / 9.81) * 4.2, drag = (pressure / 1.013) * 0.45, power = thrust && st.fuel > 0 ? g * 1.8 : 0;
      if (thrust && st.fuel > 0) st.fuel = Math.max(0, st.fuel - dt * (3.0 + (gravity / 9.81) * 5.5));
      st.vy += (-g + power - st.vy * drag) * dt;
      st.vx = THREE.MathUtils.lerp(st.vx, (f.x * fi + r.x * ri) * 5, dt * 3); st.vz = THREE.MathUtils.lerp(st.vz, (f.z * fi + r.z * ri) * 5, dt * 3);
      st.lx = THREE.MathUtils.clamp(st.lx + st.vx * dt, -30, 30); st.lz = THREE.MathUtils.clamp(st.lz + st.vz * dt, -30, 30); st.ly += st.vy * dt;
      const { slopeDeg } = sample(grid, relief, st.lx, st.lz, ve), padDist = Math.hypot(st.lx, st.lz);
      const feetH = LANDER_FEET.map(([fx, fz]) => sample(grid, relief, st.lx + fx, st.lz + fz).h);
      const gh = Math.max(sample(grid, relief, st.lx, st.lz).h, ...feetH);   // the first thing the lander can touch
      const alt = Math.max(0, st.ly - LANDER_FOOT - gh);
      if (landerRef.current) landerRef.current.position.set(st.lx, Math.max(gh + LANDER_FOOT, st.ly), st.lz);
      const firing = Boolean(thrust && st.fuel > 0);
      sunRef.current.exhaust = { x: st.lx, z: st.lz, p: firing ? THREE.MathUtils.clamp(1 - alt / 14, 0, 1) : 0 };
      if (firing && alt < 9 && pressure < 0.05) st.blindUntil = st.t + 3.2;   // the warning stays readable after a short burn
      if (flameRef.current) { flameRef.current.visible = firing; if (firing) flameRef.current.scale.set(1, 0.85 + Math.sin(clock.elapsedTime * 45) * 0.25, 1); }
      const want = firing && alt < 11 ? 1 - alt / 11 : 0;
      st.heat = want > st.heat ? Math.min(1, st.heat + dt * 1.1 * want) : Math.max(0, st.heat - dt * (pressure > 0.5 ? 0.22 : 0.07));
      if (dustRef.current) { dustRef.current.visible = st.heat > 0.08 && alt < 12; dustRef.current.position.set(st.lx, gh + 0.3, st.lz); dustRef.current.rotation.y += dt * 2; const sc = 0.8 + st.heat * (pressure < 0.05 ? 3.4 : 1.5); dustRef.current.scale.set(sc, 0.6 + st.heat, sc); }
      const tHit = (st.vy + Math.sqrt(Math.max(0, st.vy * st.vy + 2 * g * alt))) / g;
      const px = THREE.MathUtils.clamp(st.lx + st.vx * tHit, -(WORLD_SIZE / 2 - 2), WORLD_SIZE / 2 - 2), pz = THREE.MathUtils.clamp(st.lz + st.vz * tHit, -(WORLD_SIZE / 2 - 2), WORLD_SIZE / 2 - 2);
      if (predictRef.current) predictRef.current.position.set(px, sample(grid, relief, px, pz).h + 0.1, pz);
      if (dropRef.current) { dropRef.current.position.set(st.lx, gh + alt / 2, st.lz); dropRef.current.scale.set(1, Math.max(0.01, alt), 1); }
      if (controls.current) {
        const focus = new THREE.Vector3(st.lx, Math.max(gh + LANDER_FOOT, st.ly), st.lz);
        camera.position.add(focus.clone().sub(prevFocus.current));
        camera.position.y = Math.max(camera.position.y, sample(grid, relief, camera.position.x, camera.position.z).h + 1.2);
        controls.current.target.copy(focus); prevFocus.current.copy(focus); controls.current.update();
      }
      if (alt <= 0.02) {
        st.landed = true;
        // settle on all three pads: tilt to the plane through them
        if (landerRef.current) {
          const P = LANDER_FEET.map(([fx, fz], i) => new THREE.Vector3(st.lx + fx, feetH[i], st.lz + fz));
          const nrm = new THREE.Vector3().crossVectors(P[1].clone().sub(P[0]), P[2].clone().sub(P[0])).normalize();
          if (nrm.y < 0) nrm.negate();
          landerRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
          landerRef.current.position.set(st.lx, (feetH[0] + feetH[1] + feetH[2]) / 3 + LANDER_FOOT, st.lz);
        }
        const v = Math.abs(st.vy), soft = v <= LAND_SPEED_LIMIT, onPad = padDist <= PAD_RADIUS, level = slopeDeg <= 20, ok = soft && onPad && level;
        if (flameRef.current) flameRef.current.visible = false;
        const bonus = ok ? (v < 1.5 ? 6 : v < 2.2 ? 3 : 0) + (padDist < 2 ? 4 : padDist < 3.5 ? 2 : 0) : 0;
        const numbers = [{ label: "Touchdown speed", value: `${v.toFixed(1)} m/s` }, { label: "Distance to pad", value: `${padDist.toFixed(1)} m` }, { label: "Ground slope", value: `${slopeDeg.toFixed(0)}°` }, { label: "Fuel left", value: `${st.fuel.toFixed(0)}%` }];
        // the rover rolls off the lander: it starts just in front of it
        st.rx = st.lx; st.rz = st.lz - 3.4;   // rolls off the far side, facing the route
        onLanded(ok,
          ok ? "Soft landing on the pad" : !soft ? `Hard landing at ${v.toFixed(1)} m/s` : !onPad ? `Missed the pad by ${(padDist - PAD_RADIUS).toFixed(1)} m` : `Tipped over on a ${slopeDeg.toFixed(0)}° slope`,
          ok ? `Touched down at ${v.toFixed(1)} m/s, ${padDist.toFixed(1)} m from the pad centre, with ${st.fuel.toFixed(0)}% fuel left. The rover can roll off.` : !soft ? `The legs are rated for ${LAND_SPEED_LIMIT} m/s and buckled. Under ${gravity} m/s² gravity you need to start braking ${gravity > 5 ? "early and hard" : "early; low gravity gives you more time, but also less drag to help"}.` : !onPad ? `You came down ${padDist.toFixed(1)} m from the centre; the pad allows ${PAD_RADIUS} m. Watch the yellow ring: it shows where you will hit if you cut the engine now, so steer until it sits on the pad.` : `The ground where you landed slopes ${slopeDeg.toFixed(0)}°; the lander can stand on 20° at most. The pad itself is flat, so aim for it.`,
          numbers, bonus);
        st.done = phase === "land" && !ok;   // a failed landing ends the run; a good one continues (parent flips the phase)
        if (ok) st.done = false;
      }
      if (st.t - st.emit > 0.1) { st.emit = st.t; setGuide(makeGuide(st.lx, Math.max(gh + LANDER_FOOT, st.ly), st.lz, st.pad)); onTelemetry({ time: st.t.toFixed(1), alt: alt.toFixed(1), vspeed: st.vy.toFixed(1), fuel: st.fuel.toFixed(0), pad: padDist.toFixed(1), blind: st.t < st.blindUntil, ground: groundTempAt(st.lx, st.lz).toFixed(0) }); }
      return;
    }

    if (phase !== "drive") return;

    /* ---------------- docked at a station: drilling ---------------- */
    if (docked && st.dock >= 0) {
      const on = Boolean(k["Space"] || k["KeyE"] || k["DrillHold"]);
      st.t += dt;
      if (on && !st.lastDrill) st.pulses += 1;
      st.lastDrill = on;
      const gain = on ? 9.0 * rock.hardness : 0;
      const air = (pressure / 1.013) * 0.09 * Math.max(0, st.bit - ambientC);
      const cond = 0.04 * Math.max(0, st.bit - ambientC);
      st.bit = Math.max(ambientC, st.bit + (gain - air - cond) * dt);
      if (on) st.depth = Math.min(CORE_TARGET_M, st.depth + (dt * 0.14) / rock.hardness);
      const c = carriages.current[st.dock], bm = bits.current[st.dock];
      if (c) { c.position.y = 2.4 - (st.depth / CORE_TARGET_M) * 1.3; if (on) { c.rotation.y += dt * 20; c.position.x = Math.sin(clock.elapsedTime * 60) * 0.01; } }
      if (bm) { const hf = THREE.MathUtils.clamp((st.bit - 40) / (DRILL_LIMIT_C - 40), 0, 1); bm.emissive.setRGB(hf * 1.3, hf * 0.2, 0); }
      const stn = layout.stations[st.dock];
      if (controls.current) { controls.current.target.set(stn.x, stn.y + 1.4, stn.z); controls.current.update(); }
      const fNow = Boolean(k["KeyF"]);
      const leave = fNow && !st.fPrev;
      st.fPrev = fNow;
      const finish = (res: "done" | "lost") => { const n = st.dock; st.dock = -1; setStationState((prev) => prev.map((v, i) => (i === n ? res : v))); onDrive(res === "done" ? { type: "core", n } : { type: "station-lost", n }); onDrive({ type: "dock", on: false }); };
      if (!rock.dry && st.depth >= 0.45) finish("lost");
      else if (st.bit >= DRILL_LIMIT_C) finish("lost");
      else if (st.depth >= CORE_TARGET_M) finish("done");
      else if (leave) { st.dock = -1; onDrive({ type: "dock", on: false }); }
      if (st.t - st.emit > 0.08) { st.emit = st.t; onTelemetry({ time: st.t.toFixed(1), mode: "drill", depth: st.depth.toFixed(2), bit: st.bit.toFixed(0), on, rock: rock.label, cooling: pressure > 0.5 ? "air and rock" : "rock only (no air)", wp: st.wp, ground: groundTempAt(st.rx, st.rz).toFixed(0) }); }
      return;
    }

    /* ---------------- driving ---------------- */
    const fwd = (k["KeyW"] || k["ArrowUp"] ? 1 : 0) - (k["KeyS"] || k["ArrowDown"] ? 1 : 0);
    const steer = (k["KeyA"] || k["ArrowLeft"] ? 1 : 0) - (k["KeyD"] || k["ArrowRight"] ? 1 : 0);
    st.t += dt;
    const { slopeDeg } = sample(grid, relief, st.rx, st.rz, ve), slopeRad = THREE.MathUtils.degToRad(slopeDeg);
    // uphill component: positive when the rover points up the slope it stands on
    const ahead = sample(grid, relief, st.rx - Math.sin(st.yaw) * 1.2, st.rz - Math.cos(st.yaw) * 1.2).h - sample(grid, relief, st.rx, st.rz).h;
    const climb = THREE.MathUtils.clamp(ahead / ve / 1.2, -1, 1);
    const normalN = MASS_KG * gravity * Math.cos(slopeRad);
    const mu = (body === "earth" ? 0.75 : body === "mars" ? 0.6 : 0.5) * rover.grip;
    const gripN = mu * normalN;
    // what the wheels must deliver: the climb (when going uphill), rolling resistance, and a gentle acceleration
    const demandN = Math.max(0, climb) * MASS_KG * gravity * Math.sin(slopeRad) + 0.08 * normalN + (fwd ? MASS_KG * 0.35 : 0);
    const slipRatio = THREE.MathUtils.clamp((demandN / (gripN + 1e-4)) * 0.36, 0.03, 1);
    st.slip = Math.round(slipRatio * 100); st.peakSlip = Math.max(st.peakSlip, st.slip);
    const moving = Math.abs(st.speed) > 0.2;
    st.yaw += steer * (body === "earth" ? 1.5 : body === "mars" ? 1.25 : 1.05) * rover.grip * dt * (moving ? 1 : 0.6) * (st.grabbing ? 0 : 1);
    // driver's seat: W and S are relative to where you look. While you drive, the rover turns to face the view
    // (the view itself stays put in the world, so looking back and pressing W turns the rover round and drives that way)
    if (!thirdPerson && fwd !== 0 && !st.grabbing && Math.abs(lookRef.current.yaw) > 0.01) {
      const turn = THREE.MathUtils.clamp(lookRef.current.yaw, -2.6 * dt, 2.6 * dt);
      st.yaw += turn; lookRef.current.yaw -= turn;
    }
    const envGrip = body === "earth" ? 1 : body === "mars" ? 0.78 : 0.62;
    const penalty = Math.max(0, (slopeDeg - 12) * 0.028) / (envGrip * rover.grip);
    const maxSpd = (st.hot ? 0.3 : 1) * rover.topSpeed * (1 - slipRatio * 0.7);
    const drive = st.grabbing ? 0 : fwd;
    st.speed = THREE.MathUtils.lerp(st.speed, drive ? drive * maxSpd * Math.max(0.2, 1 - penalty) : 0, dt * (drive ? 2.4 : 4));
    st.rx = THREE.MathUtils.clamp(st.rx - Math.sin(st.yaw) * st.speed * dt, -(WORLD_SIZE / 2 - 4), WORLD_SIZE / 2 - 4);
    st.rz = THREE.MathUtils.clamp(st.rz - Math.cos(st.yaw) * st.speed * dt, -(WORLD_SIZE / 2 - 4), WORLD_SIZE / 2 - 4);
    // sliding (Coulomb friction): where the real slope is steeper than the wheels can hold (tan θ > μ), the rover slides
    // downhill; wheels spinning hard on a climb also lose ground. Gravity sets how fast it slides, not whether it does.
    {
      const d0 = 0.6;
      const hx = (sample(grid, relief, st.rx + d0, st.rz).h - sample(grid, relief, st.rx - d0, st.rz).h) / (2 * d0 * ve);
      const hz = (sample(grid, relief, st.rx, st.rz + d0).h - sample(grid, relief, st.rx, st.rz - d0).h) / (2 * d0 * ve);
      const gmag = Math.hypot(hx, hz);
      const slideA = gravity * (Math.sin(slopeRad) - mu * 0.85 * Math.cos(slopeRad));
      if (gmag > 1e-4) {
        if (slideA > 0) { st.svx -= (hx / gmag) * slideA * dt * 0.6; st.svz -= (hz / gmag) * slideA * dt * 0.6; }
        if (fwd > 0 && climb > 0 && slipRatio > 0.7) { const back = (slipRatio - 0.7) * 2.5; st.svx -= (hx / gmag) * back * dt; st.svz -= (hz / gmag) * back * dt; }
      }
      const damp = Math.exp(-dt * (slideA > 0 ? 0.8 : 5)); st.svx *= damp; st.svz *= damp;
      const sv = Math.hypot(st.svx, st.svz); if (sv > 4) { st.svx *= 4 / sv; st.svz *= 4 / sv; }
      st.rx = THREE.MathUtils.clamp(st.rx + st.svx * dt, -(WORLD_SIZE / 2 - 4), WORLD_SIZE / 2 - 4);
      st.rz = THREE.MathUtils.clamp(st.rz + st.svz * dt, -(WORLD_SIZE / 2 - 4), WORLD_SIZE / 2 - 4);
      st.sliding = Math.hypot(st.svx, st.svz) > 0.3;
      if (st.sliding) st.peakSlip = Math.max(st.peakSlip, 100);
    }
    const v = Math.abs(st.speed);
    const wear = (v * (body === "earth" ? 0.45 : 1.25) * rock.hardness * (0.7 + roughness * 0.5)) / rover.armor;
    st.wheel = Math.max(0, st.wheel - wear * dt * 0.75);
    const heat = (v * 2.6 + slopeDeg * 0.42) * (fwd ? 1 : 0.05);
    const airCool = (pressure / 1.013) * Math.max(0, st.motor - ambientC) * 0.42;
    const radCool = rover.radiator * Math.max(0, st.motor - ambientC) * 0.28;
    st.motor = Math.max(ambientC, st.motor + (heat - airCool - radCool) * dt * 2);
    if (st.motor >= rover.maxTempC) st.hot = true;
    if (st.hot && st.motor < rover.maxTempC * 0.78) st.hot = false;
    st.stuckFor = fwd && st.slip >= 90 ? st.stuckFor + dt : Math.max(0, st.stuckFor - dt * 2);

    if (st.wheel <= 0) { st.done = true; onDrive({ type: "fail", headline: "Wheels worn through", reason: `The ${rover.wheels.toLowerCase()} on the ${rover.name} wore down to nothing on ${rock.label}${body !== "earth" ? ", and without air there is no moisture film to ease the abrasion" : ""}. A tougher wheel (see the rover list) or less time at full speed on rough ground would have finished the route.` }); }
    else if (st.stuckFor > STUCK_SECONDS) { st.done = true; onDrive({ type: "fail", headline: `Dug in on a ${slopeDeg.toFixed(0)}° slope`, reason: `The wheels spun at over 90% slip for ${STUCK_SECONDS} seconds and buried themselves. Under ${gravity} m/s² gravity they press on the ground with only ${(normalN / 1000).toFixed(1)} kN, so the ground could give ${(gripN / 1000).toFixed(1)} kN of grip against the ${(demandN / 1000).toFixed(1)} kN the climb asked for. When the traction warning appears, stop, reverse a little and take the slope at an angle.` }); }

    // waypoints
    const w = layout.route[st.wp];
    if (w && Math.hypot(st.rx - w.x, st.rz - w.z) < 2.4) {
      st.wp += 1; onDrive({ type: "waypoint", n: st.wp });
      if (st.wp >= layout.route.length) { st.done = true; onDrive({ type: "complete" }); }
    }

    // sample rocks and the claw mini-game: hold E near a flagged rock, release when the cursor is in the middle
    let near = -1, nearD = 99;
    layout.rocks.forEach((rk, i) => { if (taken[i]) return; const d = Math.hypot(st.rx - rk.x, st.rz - rk.z); if (d < 3.2 && d < nearD) { near = i; nearD = d; } });
    if (near !== nearRock) setNearRock(near);
    const eNow = Boolean(k["KeyE"] || k["GrabHold"]);
    if (!st.grabbing && eNow && !st.ePrev && near >= 0 && v < 2.0) { st.grabbing = true; st.grabT = 0; st.grabRock = near; }
    if (st.grabbing) {
      st.grabT += dt;
      if (!eNow) {
        const cursor = Math.sin(st.grabT * 3.0);
        const clean = Math.abs(cursor) < 0.5;
        st.grabbing = false; st.armT = 1.2;
        const idx = st.grabRock; st.grabRock = -1;
        setTaken((prev) => prev.map((t, i) => (i === idx ? true : t)));
        onDrive({ type: "rock", clean, n: idx });
      }
    }
    st.ePrev = eNow;
    if (st.armT > 0) st.armT -= dt;
    cursorRef.current = st.grabbing ? Math.sin(st.grabT * 3.0) : 0;
    const gi = st.grabbing ? st.grabRock : -1;
    if (gi !== grabIdx) setGrabIdx(gi);

    // stations: press F inside the ring to dock and drill
    let nearStation = -1;
    layout.stations.forEach((stn, i) => { if (stationState[i] === "todo" && Math.hypot(st.rx - stn.x, st.rz - stn.z) < 3.4) nearStation = i; });
    const fNow = Boolean(k["KeyF"] || k["DockHold"]);
    if (fNow && !st.fPrev && nearStation >= 0 && v < 1.5) { st.dock = nearStation; setDockIdx(nearStation); st.depth = 0; st.bit = THREE.MathUtils.clamp(ambientC, -35, 45); st.pulses = 0; st.lastDrill = false; st.speed = 0; onDrive({ type: "dock", on: true }); }
    st.fPrev = fNow;

    // place the rover on its six wheels
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    const offs = [[-0.62, -0.62], [-0.62, 0], [-0.62, 0.62], [0.62, -0.62], [0.62, 0], [0.62, 0.62]];
    const hs = offs.map(([lx, lz]) => sample(grid, relief, st.rx + lx * cy + lz * sy, st.rz - lx * sy + lz * cy).h);
    const bodyY = Math.max(sample(grid, relief, st.rx, st.rz).h, hs.reduce((a, b) => a + b, 0) / 6) + 0.26;
    const pitch = Math.atan2((hs[0] + hs[3]) / 2 - (hs[2] + hs[5]) / 2, 1.24), roll = Math.atan2((hs[0] + hs[1] + hs[2]) / 3 - (hs[3] + hs[4] + hs[5]) / 3, 1.24);
    if (roverRef.current) {
      const g = roverRef.current;
      g.position.set(st.rx, THREE.MathUtils.lerp(g.position.y || bodyY, bodyY, 0.35), st.rz);
      st.pitchS = THREE.MathUtils.lerp(st.pitchS, THREE.MathUtils.clamp(pitch, -1.1, 1.1), 0.3); st.rollS = THREE.MathUtils.lerp(st.rollS, THREE.MathUtils.clamp(-roll, -1.1, 1.1), 0.3);   // rotateZ(+) lowers the left (-x) wheels, so the left-minus-right height difference enters negated
      g.rotation.set(0, st.yaw, 0); g.rotateX(st.pitchS); g.rotateZ(st.rollS);
      // never let a wheel or the chassis sink into the drawn ground: lift the body until every contact point is above it
      let need = -Infinity;
      for (const [lx, ly, lz] of ROVER_CONTACTS) {
        const pt = CONTACT_TMP.set(lx, ly, lz).applyQuaternion(g.quaternion);
        need = Math.max(need, sample(grid, relief, st.rx + pt.x, st.rz + pt.z).h - pt.y);
      }
      if (g.position.y < need) g.position.y = need;
    }
    if (thirdPerson && controls.current) {
      const focus = new THREE.Vector3(st.rx, bodyY + 0.3, st.rz);
      const off = camera.position.clone().sub(prevFocus.current), ch = chase.current;
      // turn with the rover
      off.applyAxisAngle(UP_AXIS, st.yaw - ch.yaw); ch.yaw = st.yaw;
      // while driving, ease back to a view from behind (paused for 1.5 s after the player drags the view)
      if (!ch.orbiting && st.t - ch.releasedAt > 1.5 && Math.abs(st.speed) > 0.2) {
        const flat = Math.hypot(off.x, off.z), az = Math.atan2(off.x, off.z), want = st.yaw;
        const d = Math.atan2(Math.sin(want - az), Math.cos(want - az)), na = az + d * (1 - Math.exp(-dt * 2.2));
        off.x = Math.sin(na) * flat; off.z = Math.cos(na) * flat;
      }
      camera.position.copy(focus).add(off);
      camera.position.y = Math.max(camera.position.y, sample(grid, relief, camera.position.x, camera.position.z).h + 0.9);
      controls.current.target.copy(focus); prevFocus.current.copy(focus); controls.current.update();
    } else if (!thirdPerson) {
      const vy = st.yaw + lookRef.current.yaw, cx = st.rx - Math.sin(st.yaw) * 0.6, cz = st.rz - Math.cos(st.yaw) * 0.6;
      const camY = Math.max(bodyY + 0.95, sample(grid, relief, cx, cz).h + 0.9);
      camera.position.set(cx, camY, cz);
      const ahead = sample(grid, relief, cx - Math.sin(vy) * 3, cz - Math.cos(vy) * 3).h;
      camera.lookAt(cx - Math.sin(vy) * 8, Math.max(camY + Math.sin(pitch) * 4, ahead + 0.5) + lookRef.current.pitch * 6, cz - Math.cos(vy) * 8);
    }
    // the arrow to the next waypoint is relative to where the camera looks (orbit or driver's seat), not the rover body
    const camDir = camera.getWorldDirection(CAM_DIR_TMP), camYaw = Math.atan2(-camDir.x, -camDir.z);
    const nx = layout.route[st.wp]; let bearing = 0, dist = 0;
    if (nx) { const dx = nx.x - st.rx, dz = nx.z - st.rz; dist = Math.hypot(dx, dz); bearing = THREE.MathUtils.radToDeg(Math.atan2(dx * Math.cos(camYaw) - dz * Math.sin(camYaw), -dx * Math.sin(camYaw) - dz * Math.cos(camYaw))); }
    if (st.t - st.emit > 0.08) { st.emit = st.t; onTelemetry({ time: st.t.toFixed(1), mode: "drive", speed: v.toFixed(1), wheel: st.wheel.toFixed(0), motor: st.motor.toFixed(0), hot: st.hot, wp: st.wp, dist: dist.toFixed(0), bearing, slope: slopeDeg.toFixed(0), slip: st.slip, peakSlip: st.peakSlip, sliding: st.sliding, nearRock: near >= 0, grabbing: st.grabbing, cursor: st.grabbing ? Math.sin(st.grabT * 3.0) : 0, traction: st.stuckFor / STUCK_SECONDS, nearStation: nearStation >= 0, ground: groundTempAt(st.rx, st.rz).toFixed(0) }); }
  });

  const padY = grid ? sample(grid, relief, 0, 0).h : 0;
  const bg = sensor === "thermal" ? "#05020c" : sensor === "sar" ? "#0a0d12" : body === "moon" ? "#02040a" : body === "mars" ? "#6b3a26" : "#7fb6d9";
  const plainView = sensor === "optical";
  return (
    <>
      <color attach="background" args={[bg]} />
      {body !== "moon" && plainView && <fog attach="fog" args={[body === "mars" ? "#8a4a2e" : "#9cc6e0", 48, 170]} />}
      {body === "moon" && plainView && <Stars radius={110} depth={30} count={1800} factor={3} fade />}
      <hemisphereLight args={[body === "earth" ? "#dbeafe" : body === "moon" ? "#e5e7eb" : "#f5e6d8", body === "earth" ? "#6b7a5a" : body === "moon" ? "#6b7079" : "#6b4a3a", body === "moon" ? 1.15 : 0.95]} />
      <ambientLight intensity={body === "moon" ? 0.45 : 0.3} />
      {/* a soft fill from the camera side so slopes facing away from a low sun never go black */}
      <directionalLight position={[-20, 30, -25]} intensity={body === "moon" ? 0.55 : 0.4} />
      <directionalLight ref={lightRef} position={[18, 26, 12]} intensity={body === "moon" ? 2.9 : 1.8} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-28} shadow-camera-right={28} shadow-camera-top={28} shadow-camera-bottom={-28} shadow-camera-near={1} shadow-camera-far={140} shadow-bias={-0.0006} />
      <Terrain siteId={siteId} grid={grid} reliefM={reliefM} body={body} mineral={mineral} sensor={sensor} sunRef={sunRef} thermalRef={thermalRef} tminC={tminC} tmaxC={tmaxC} airy={airy} ve={ve} />
      {(thirdPerson || phase !== "drive" || docked) && <OrbitControls ref={controls as never} onStart={() => { chase.current.orbiting = true; }} onEnd={() => { chase.current.orbiting = false; chase.current.releasedAt = s.current.t; }} makeDefault enablePan={false} minDistance={2.2} maxDistance={70} maxPolarAngle={Math.PI * 0.49} />}

      {/* the pad: markings that lie on the ground */}
      <GroundRing cx={0} cz={0} r0={PAD_RADIUS - 0.45} r1={PAD_RADIUS} color="#34d399" opacity={0.75} height={heightAt} />
      <GroundRing cx={0} cz={0} r0={0} r1={PAD_RADIUS - 0.45} color="#0f172a" opacity={0.28} height={heightAt} lift={0.04} />
      {[[-1.2, 0, 0.3, 2.6], [1.2, 0, 0.3, 2.6], [0, 0, 2.1, 0.3]].map(([x, z, w, h], i) => <mesh key={i} position={[x, padY + 0.07, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}><planeGeometry args={[w, h]} /><meshBasicMaterial color="#e5e7eb" transparent opacity={0.85} depthWrite={false} polygonOffset polygonOffsetFactor={-3} /></mesh>)}

      <Lander groupRef={landerRef} flameRef={flameRef} />
      {phase === "land" && (
        <>
          <group ref={dustRef} visible={false}>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i * Math.PI) / 4; return <mesh key={i} position={[Math.cos(a) * 0.9, (i % 2) * 0.25, Math.sin(a) * 0.9]}><dodecahedronGeometry args={[0.45, 1]} /><meshStandardMaterial color={body === "mars" ? "#d9a06b" : body === "moon" ? "#9ca3af" : "#cbd5e1"} transparent opacity={0.4} depthWrite={false} /></mesh>; })}</group>
          {guide.length > 1 && <Line points={guide} color="#fde68a" lineWidth={1.2} transparent opacity={0.45} />}
          <mesh ref={dropRef}><cylinderGeometry args={[0.012, 0.012, 1, 6]} /><meshBasicMaterial color="#e2e8f0" transparent opacity={0.35} depthWrite={false} /></mesh>
          <mesh ref={predictRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}><ringGeometry args={[0.6, 0.8, 32]} /><meshBasicMaterial color="#fde68a" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} depthTest={false} /></mesh>
        </>
      )}

      {(phase === "drive" || phase === "brief-drive" || phase === "done") && (
        <>
          <Rover groupRef={roverRef} />
          {routePoints.length > 1 && <RouteRibbon points={routePoints} height={heightAt} leg={waypointIdx} />}
          <group ref={beaconsRef}>{layout.route.map((w, i) => <Waypoint key={i} x={w.x} y={w.y} z={w.z} state={i < waypointIdx ? "done" : i === waypointIdx ? "next" : "later"} />)}</group>
          <group ref={rocksRef}>{layout.rocks.map((rk, i) => <SampleRock key={i} x={rk.x} y={rk.y} z={rk.z} taken={taken[i]} near={nearRock === i} lifting={grabIdx === i} seed={hashString(siteId) + i * 7} geo={rockParts.geos[i % rockParts.geos.length]} material={rockParts.material} />)}</group>
          {layout.stations.map((stn, i) => { const state = docked && dockIdx === i ? "active" : stationState[i]; const col = state === "done" ? "#22c55e" : state === "lost" ? "#ef4444" : state === "active" ? "#fbbf24" : "#38bdf8"; return <GroundRing key={i} cx={stn.x} cz={stn.z} r0={3.0} r1={3.25} color={col} opacity={0.4} height={heightAt} />; })}
          <group ref={stationsRef}>{layout.stations.map((stn, i) => <StationRig key={i} x={stn.x} y={stn.y} z={stn.z} state={docked && dockIdx === i ? "active" : stationState[i]} carriageRef={(el) => { carriages.current[i] = el; }} bitMat={(el) => { bits.current[i] = el; }} />)}</group>
        </>
      )}
    </>
  );
}

/* a small first-time hint box, centred near the top of the scene */
function Coach({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[11] px-4 py-2.5 text-xs max-w-md rounded-xl rise pointer-events-none" style={{ background: "rgba(24, 20, 6, 0.86)", border: "1px solid rgba(251, 191, 36, 0.65)", color: "#fef3c7" }}>
      <div className="text-[10px] uppercase tracking-wide font-semibold mb-0.5" style={{ color: "#fbbf24" }}>Tip · {title}</div>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

/* =====================================================================================
   The page around the scene
   ===================================================================================== */
const BRIEF = {
  land: { name: "Part 1 · Landing", icon: Rocket, goal: "Bring the lander down softly onto the pad. The yellow ring on the ground shows where you would touch down if the engine cut right now.",
    pass: [`Touch down slower than ${LAND_SPEED_LIMIT} m/s`, `Within ${PAD_RADIUS} m of the pad centre`, "On ground flatter than 20°"],
    fail: ["Hard landing: faster than the limit", "Missed the pad", "Tipped over on a slope", "Out of fuel means you fall"],
    controls: ["Hold SPACE (or the on-screen button) — fire the engine", "W / A / S / D — drift sideways", "Drag with the mouse — orbit the camera"],
    scoring: [`${POINTS.landing} points for a safe landing`, "Up to 10 bonus for a gentle, central touchdown"] },
  drive: { name: "Part 2 · Drive and sample", icon: Car, goal: "Drive the surveyed route through five waypoints. Grab the flagged rocks with the claw on the way, and dock at the two stations to drill a core.",
    pass: ["Reach all five waypoints", "Rocks and cores are optional: each one adds to the score"],
    fail: ["Wheels wear to 0% on sharp rock", `Dug in: the traction warning fills up (${STUCK_SECONDS} s of spinning wheels)`, "A hot motor only slows you down"],
    controls: ["W / A / S / D — drive", "Hold E next to a flagged rock, release when the cursor is in the green — claw grab", "F inside a station ring — dock; hold E or SPACE to drill, release to cool; F to leave", "Camera button — driver's seat or chase view"],
    scoring: [`${POINTS.waypoint} per waypoint`, `${POINTS.rockClean} per rock (${POINTS.rockFumbled} with a loose grip)`, `${POINTS.core} per core`, `Up to ${POINTS.timeMax} for a quick run`] },
};

export default function DualSimulator({ matchData, selectedMatch, onBack }: { matchData: MatchPayload; selectedMatch: EarthMatch; onBack: () => void }) {
  const [side, setSide] = useState<WorldSide>("earth");
  const [sensor, setSensor] = useState<Sensor>("optical");
  const [thirdPerson, setThirdPerson] = useState(true);
  const [roverId, setRoverId] = useState("desert_scout");
  const [runId, setRunId] = useState(1);
  const [phase, setPhase] = useState<Phase>("brief-land");
  const [docked, setDocked] = useState(false);
  const [score, setScore] = useState<Score>({ landing: 0, waypoints: 0, rocks: 0, cores: 0, time: 0 });
  const [tally, setTally] = useState({ rocks: 0, clean: 0, cores: 0, lost: 0 });
  const [landing, setLanding] = useState<{ ok: boolean; headline: string; reason: string; numbers: { label: string; value: string }[] } | null>(null);
  const [result, setResult] = useState<RunRecord | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [grid, setGrid] = useState<number[] | null>(null);
  const [reliefM, setReliefM] = useState(120);
  const [demSource, setDemSource] = useState<string | null>(null);
  const [tele, setTele] = useState<Telemetry>({});
  const [runs, setRuns] = useState<Record<WorldSide, RunRecord | null>>({ earth: null, space: null });

  const keysRef = useRef<Record<string, boolean>>({});
  const [ve, setVe] = useState(1);   // vertical exaggeration of the drawn terrain; physics always uses true slopes
  const cursorRef = useRef(0), cursorEl = useRef<HTMLDivElement>(null);
  // first-time coaching hints: each shows until the player has done that thing once in this visit
  const [coached, setCoached] = useState<Record<string, boolean>>({});
  const done = useCallback((k: string) => setCoached((c) => (c[k] ? c : { ...c, [k]: true })), []);
  const lookRef = useRef({ yaw: 0, pitch: 0 });
  const drag = useRef(false), last = useRef({ x: 0, y: 0 });
  const toastTimer = useRef<number | null>(null);
  const say = useCallback((msg: string) => { setToast(msg); if (toastTimer.current) window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 2200); }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault(); keysRef.current[e.code] = true; };
    const up = (e: KeyboardEvent) => { keysRef.current[e.code] = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const t = matchData.target;
  const url = side === "earth" ? selectedMatch.heightmap_url : t.heightmap_url;
  useEffect(() => {
    let live = true;
    fetch(apiUrl(url)).then((r) => r.json()).then((j) => { if (live) { setGrid(j.data); setReliefM(j.relief_m || 120); setDemSource(j.data_provenance?.topography?.instrument ?? null); } }).catch((e) => console.error("heightmap", e));
    return () => { live = false; };
  }, [url]);

  const restart = useCallback(() => { setResult(null); setLanding(null); setPhase("brief-land"); setDocked(false); setScore({ landing: 0, waypoints: 0, rocks: 0, cores: 0, time: 0 }); setTally({ rocks: 0, clean: 0, cores: 0, lost: 0 }); setTele({}); setRunId((r) => r + 1); }, []);
  const changeSide = (v: WorldSide) => { setSide(v); restart(); };
  
  const body: Body = side === "earth" ? "earth" : t.body;
  const worldLabel = side === "earth" ? selectedMatch.name.split("(")[0].trim() : t.name;
  const gravity = side === "earth" ? 9.81 : t.gravity;
  const pressure = side === "earth" ? 1.013 : t.pressure_bar;
  const mineral = side === "earth" ? selectedMatch.mineral_profile : ((t as unknown as { mineral_profile?: string }).mineral_profile || "mare_basalt");
  const ambient = side === "earth" ? 28 : (t.temp_min_c + t.temp_max_c) / 2;
  const ps = selectedMatch.parameter_similarities;
  const iron = side === "earth" ? ps?.iron_oxide_ratio?.earth_val ?? 1 : ps?.iron_oxide_ratio?.target_val ?? 1.2;
  const clay = side === "earth" ? ps?.clay_hydroxyl_ratio?.earth_val ?? 0.4 : ps?.clay_hydroxyl_ratio?.target_val ?? 0.3;
  const bare = side === "earth" ? ps?.bareness_index?.earth_val ?? 0.98 : ps?.bareness_index?.target_val ?? 1;
  const rover = ROVERS.find((r) => r.id === roverId) || ROVERS[1];
  const tempMeasured = side === "earth" ? ps?.temp_max_c?.earth_status === "measured" : ps?.temp_max_c?.space_status === "measured";
  const tempNote = side === "earth" ? (tempMeasured ? "Range: measured by NASA satellites." : "") : tempMeasured ? "Range: measured by NASA's Moon orbiter." : "Range: typical values, not measured here.";
  const tminC = side === "earth" ? ps?.temp_min_c?.earth_val ?? 5 : t.temp_min_c;
  const tmaxC = side === "earth" ? ps?.temp_max_c?.earth_val ?? 30 : t.temp_max_c;
  const sunElevMax = side === "earth" ? Math.min(78, 90 - Math.abs(selectedMatch.lat) + 18) : ((t as unknown as { max_sun_elevation_deg?: number }).max_sun_elevation_deg ?? Math.min(90, 90 - Math.abs(t.lat) + (t.body === "moon" ? 1.5 : 25)));
  const other: WorldSide = side === "earth" ? "space" : "earth";
  const otherName = side === "earth" ? (t.body === "moon" ? "the Moon" : "Mars") : "Earth";
  const total = score.landing + score.waypoints + score.rocks + score.cores + score.time;

  const finish = useCallback((status: "PASS" | "FAIL", headline: string, reason: string, sc: Score, extra: { label: string; value: string }[]) => {
    const tot = sc.landing + sc.waypoints + sc.rocks + sc.cores + sc.time;
    const rec: RunRecord = { status, timeSec: Number(tele.time ?? 0), headline, reason, score: sc, total: tot, numbers: extra };
    setResult(rec); setPhase("done"); setRuns((prev) => ({ ...prev, [side]: rec }));
  }, [side, tele.time]);

  const onLanded = useCallback((ok: boolean, headline: string, reason: string, numbers: { label: string; value: string }[], bonus: number) => {
    setLanding({ ok, headline, reason, numbers });
    if (ok) { const sc = { landing: POINTS.landing + bonus, waypoints: 0, rocks: 0, cores: 0, time: 0 }; setScore(sc); setPhase("brief-drive"); }
    else finish("FAIL", headline, reason, { landing: 0, waypoints: 0, rocks: 0, cores: 0, time: 0 }, numbers);
  }, [finish]);

  const onDrive = useCallback((e: DriveEvent) => {
    if (e.type === "waypoint") { setScore((s) => ({ ...s, waypoints: s.waypoints + POINTS.waypoint })); say(`Waypoint ${e.n} of ${WAYPOINTS} · +${POINTS.waypoint}`); }
    if (e.type === "rock") { setScore((s) => ({ ...s, rocks: s.rocks + (e.clean ? POINTS.rockClean : POINTS.rockFumbled) })); setTally((x) => ({ ...x, rocks: x.rocks + 1, clean: x.clean + (e.clean ? 1 : 0) })); say(e.clean ? `Sample secured · +${POINTS.rockClean}` : `Sample secured, loose grip · +${POINTS.rockFumbled}`); }
    if (e.type === "core") { setScore((s) => ({ ...s, cores: s.cores + POINTS.core })); setTally((x) => ({ ...x, cores: x.cores + 1 })); say(`Core recovered · +${POINTS.core}`); }
    if (e.type === "station-lost") { setTally((x) => ({ ...x, lost: x.lost + 1 })); say(pressure > 0.5 ? "Bit seized: drill in shorter bursts next time" : "Bit seized: no air to cool it, drill in short bursts"); }
    if (e.type === "dock") { setDocked(e.on); if (e.on) done("station"); else done("drill"); }
    if (e.type === "rock") { done("rock"); done("grab"); }
    if (e.type === "core" || e.type === "station-lost") done("drill");
    if (e.type === "fail") { setScore((sc) => { finish("FAIL", e.headline, e.reason, sc, [{ label: "Waypoints", value: `${Math.min(Number(tele.wp ?? 0), WAYPOINTS)} of ${WAYPOINTS}` }, { label: "Rocks", value: `${tally.rocks} of ${ROCKS}` }, { label: "Cores", value: `${tally.cores} of ${STATIONS}` }, { label: "Wheels left", value: `${tele.wheel ?? 0}%` }, { label: "Peak wheel slip", value: `${tele.peakSlip ?? 0}%` }]); return sc; }); }
    if (e.type === "complete") {
      const secs = Number(tele.time ?? 0), timePts = Math.round(THREE.MathUtils.clamp(POINTS.timeMax * (1 - Math.max(0, secs - 130) / 170), 0, POINTS.timeMax));
      setScore((sc) => { const full = { ...sc, time: timePts }; finish("PASS", "Mission complete", `All ${WAYPOINTS} waypoints in ${secs.toFixed(0)} s, ${tally.rocks} of ${ROCKS} rocks (${tally.clean} clean grabs) and ${tally.cores} of ${STATIONS} cores. ${tally.rocks + tally.cores === ROCKS + STATIONS ? "A full haul." : "Rocks and cores you left behind are points on the table for the next run."}`, full, [{ label: "Time", value: `${secs.toFixed(0)} s` }, { label: "Rocks", value: `${tally.rocks} of ${ROCKS}` }, { label: "Cores", value: `${tally.cores} of ${STATIONS}` }, { label: "Wheels left", value: `${tele.wheel ?? 0}%` }, { label: "Peak wheel slip", value: `${tele.peakSlip ?? 0}%` }]); return full; });
    }
  }, [finish, say, tele.time, tele.wp, tele.wheel, tele.peakSlip, tally, pressure, done]);

  // the claw cursor is moved every animation frame straight from the scene, not through React state, so it glides
  const grabbing = Boolean(tele.grabbing);
  useEffect(() => {
    if (!grabbing) return;
    let id = 0;
    const tick = () => { if (cursorEl.current) cursorEl.current.style.left = `calc(${((cursorRef.current + 1) / 2) * 100}% - 2px)`; id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [grabbing]);

  const brief = phase === "brief-land" ? BRIEF.land : phase === "brief-drive" ? BRIEF.drive : null;
  const BriefIcon = brief?.icon ?? Rocket;
  const paused = phase === "brief-land" || phase === "brief-drive" || phase === "done";
  const grade = (v: number) => (v >= MAX_SCORE * 0.8 ? "Outstanding" : v >= MAX_SCORE * 0.6 ? "Strong" : v >= MAX_SCORE * 0.4 ? "Solid" : v > 0 ? "Rough" : "No score");

  return (
    <div className="relative z-10 flex-1 flex flex-col gap-3 p-4 max-w-[1750px] w-full mx-auto">
      <div className="card px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onBack} className="btn btn-sm"><ArrowLeft className="w-3.5 h-3.5" /> Back to results</button>
          <div className="seg" data-tour="sim-world">
            <button type="button" aria-pressed={side === "earth"} onClick={() => changeSide("earth")}>Earth · {selectedMatch.name.split("(")[0].trim()}</button>
            <button type="button" aria-pressed={side === "space"} onClick={() => changeSide("space")}>{t.body === "moon" ? "Moon" : "Mars"} · {t.name}</button>
          </div>
        </div>
        <div className="text-xs muted" data-tour="sim-test">{phase === "land" ? "Part 1 of 2 · Landing" : phase === "drive" ? (docked ? "Part 2 of 2 · Drilling a core" : "Part 2 of 2 · Drive and sample") : "Mission: land, drive, sample"}</div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5" data-tour="sim-relief">
            <span className="text-[11px] muted hidden sm:inline">Hills</span>
            <div className="seg" title="Makes hills look taller so slopes are easier to see. Only the picture changes: the rover and lander still feel the real slopes.">
              {[1, 2, 3].map((v) => <button key={v} type="button" aria-pressed={ve === v} disabled={phase !== "brief-land" && phase !== "done"} title={phase !== "brief-land" && phase !== "done" ? "Choose this before starting a mission (it redraws the ground)" : v === 1 ? "Hills at their real height" : `Hills drawn ${v} times taller, to see slopes better`} onClick={() => { setVe(v); if (phase === "done") restart(); }}>{v === 1 ? "Real size" : `${v}× taller`}</button>)}
            </div>
          </div>
          <div className="seg" title="How the ground is shown" data-tour="sim-view">
            {([["optical", "Camera"], ["sar", "Slope"], ["thermal", "Heat"]] as [Sensor, string][]).map(([m, l]) => <button key={m} type="button" aria-pressed={sensor === m} onClick={() => setSensor(m)}>{l}</button>)}
          </div>
          {phase === "drive" && !docked && <button type="button" className="btn btn-sm" onClick={() => { lookRef.current = { yaw: 0, pitch: 0 }; setThirdPerson((v) => !v); }}><Eye className="w-3.5 h-3.5" /> {thirdPerson ? "Chase camera" : "Driver's seat"}</button>}
          <button type="button" className="btn btn-sm" onClick={restart}><RotateCcw className="w-3.5 h-3.5" /> Restart mission</button>
        </div>
      </div>

      <div className="card overflow-hidden relative w-full h-[calc(100dvh-11.5rem)] min-h-[440px] max-h-[900px]"
        onPointerDown={(e) => { if (!thirdPerson && phase === "drive" && !docked) { drag.current = true; last.current = { x: e.clientX, y: e.clientY }; } }}
        onPointerMove={(e) => { if (drag.current) { const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y; last.current = { x: e.clientX, y: e.clientY }; lookRef.current.yaw -= dx * 0.005; lookRef.current.pitch = THREE.MathUtils.clamp(lookRef.current.pitch - dy * 0.004, -0.7, 0.7); } }}
        onPointerUp={() => { drag.current = false; }} onPointerLeave={() => { drag.current = false; }}>

        {/* live readings */}
        <div className="absolute top-3 left-3 z-10 on-canvas px-3.5 py-2.5 text-xs flex flex-wrap gap-x-5 gap-y-1 pointer-events-none" data-tour="sim-hud">
          <span>Time <b>{tele.time || "0.0"} s</b></span>
          {phase === "land" && (<>
            <span className="sr-only">Height <b>{tele.alt ?? "22.0"} m</b></span>
            <span className="sr-only">Falling at <b style={{ color: Number(tele.vspeed ?? 0) < -LAND_SPEED_LIMIT ? "#fca5a5" : "#86efac" }}>{Math.abs(Number(tele.vspeed ?? 0)).toFixed(1)} m/s</b><span className="opacity-80"> (limit {LAND_SPEED_LIMIT.toFixed(1)})</span></span>
            <span>Fuel <b>{tele.fuel ?? 100}%</b></span>
            <span>Pad <b>{tele.pad ?? "10.4"} m</b> away</span>
          </>)}
          {phase === "drive" && !docked && (<>
            <span>Waypoint <b>{Math.min(Number(tele.wp ?? 0) + 1, WAYPOINTS)} of {WAYPOINTS}</b>{tele.dist ? <span className="opacity-80"> · {tele.dist} m</span> : null}</span>
            <span>Speed <b>{tele.speed || "0.0"} m/s</b></span>
            <span title="How much the wheels spin without moving the rover: 0% is full grip, 100% is spinning in place">Wheel slip <b style={{ color: tele.sliding || Number(tele.slip ?? 0) >= 75 ? "#fca5a5" : Number(tele.slip ?? 0) >= 40 ? "#fde68a" : "#86efac" }}>{tele.sliding ? "sliding!" : `${tele.slip ?? 0}%`}</b></span>
            <span>Wheels <b style={{ color: Number(tele.wheel ?? 100) < 35 ? "#fca5a5" : "#86efac" }}>{tele.wheel ?? 100}%</b></span>
            {(tele.hot || Number(tele.motor ?? 0) > rover.maxTempC * 0.7) && <span>Motor <b style={{ color: tele.hot ? "#fca5a5" : "#fde68a" }}>{tele.motor}°C</b><span className="opacity-80"> / {rover.maxTempC}°C</span></span>}
          </>)}
          {phase === "drive" && docked && (<>
            <span>Core <b>{tele.depth ?? "0.00"} / {CORE_TARGET_M.toFixed(2)} m</b></span>
            <span>Bit <b style={{ color: Number(tele.bit ?? 0) > DRILL_LIMIT_C * 0.85 ? "#fca5a5" : "#86efac" }}>{tele.bit ?? Math.round(ambient)}°C</b><span className="opacity-80"> / {DRILL_LIMIT_C}°C</span></span>
            <span>Rock <b>{String(tele.rock ?? "")}</b></span>
            <span>Cooling <b>{String(tele.cooling ?? "")}</b></span>
          </>)}
        </div>

        {/* landing gauge, next to the lander so the player never looks away */}
        {phase === "land" && (() => {
          // vspeed is signed: negative while falling, positive while the engine pushes the lander back up
          const vs = Number(tele.vspeed ?? 0), rising = vs > 0.05, v = Math.abs(vs), alt = Number(tele.alt ?? 22), over = !rising && v > LAND_SPEED_LIMIT;
          const col = rising ? "#7dd3fc" : !over ? "#86efac" : alt < 8 ? "#fca5a5" : "#fde68a";
          return (
            <div className="absolute z-10 pointer-events-none on-canvas px-4 py-3 text-center" style={{ left: "calc(50% + 110px)", top: "38%", minWidth: 150 }} aria-live="off">
              <div className="text-[11px] uppercase tracking-wider opacity-80">{rising ? "Rising" : "Falling speed"}</div>
              <div className="font-mono font-semibold leading-none mt-1" style={{ color: col, fontSize: 40 }}>{rising ? "↑ " : ""}{v.toFixed(1)}<span className="text-sm font-normal opacity-80"> m/s</span></div>
              <div className="relative h-1.5 rounded-full mt-2" style={{ background: "rgba(255,255,255,0.18)" }}>
                <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${rising ? 0 : Math.min(100, (v / (LAND_SPEED_LIMIT * 2)) * 100)}%`, background: col }} />
                <div className="absolute top-[-3px] h-[12px] w-[2px]" style={{ left: "50%", background: "#fff" }} title="limit" />
              </div>
              <div className="text-[11px] mt-1.5 opacity-90">{rising ? "Ease off the engine" : <>Land under <b>{LAND_SPEED_LIMIT.toFixed(1)}</b></>} · height <b>{tele.alt ?? "22.0"} m</b></div>
            </div>
          );
        })()}

        {/* score */}
        {phase !== "brief-land" && (
          <div className="absolute top-3 right-3 z-10 on-canvas px-3 py-2 text-xs pointer-events-none" data-tour="sim-score">
            <div className="flex items-center gap-2"><Trophy className="w-3.5 h-3.5" /><b className="text-base">{total}</b><span className="opacity-80">/ {MAX_SCORE}</span></div>
            <div className="opacity-80 mt-0.5">{tally.rocks}/{ROCKS} rocks · {tally.cores}/{STATIONS} cores</div>
            {phase === "drive" && !docked && <div className="mt-1 text-xl font-bold leading-none" style={{ transform: `rotate(${Number(tele.bearing ?? 0)}deg)`, width: 24 }}>↑</div>}
          </div>
        )}

        {/* first-time coaching */}
        {phase === "land" && !coached.land && Number(tele.time ?? 0) < 9 && !tele.blind && (
          <Coach title="First landing">Hold <b>SPACE</b> (or the button) to fire the engine and slow the fall. Keep the falling speed under {LAND_SPEED_LIMIT.toFixed(1)} m/s (shown big in the middle), and steer with <b>W A S D</b> until the yellow ring sits on the green pad.</Coach>
        )}
        {phase === "drive" && !docked && !result && !coached.rock && tele.nearRock && !tele.grabbing && (
          <Coach title="Your first sample">Stop next to the flagged rock and <b>hold E</b>. The arm reaches out and a bar appears: <b>let go of E</b> when the white marker is in the green.</Coach>
        )}
        {phase === "drive" && !docked && !result && !coached.station && tele.nearStation && !tele.nearRock && (
          <Coach title="Drill station">Slow down inside the ring and <b>press F</b> to dock. You will then drill a core.</Coach>
        )}
        {phase === "drive" && docked && !result && !coached.drill && (
          <Coach title="Drilling a core">Hold <b>E</b> or <b>SPACE</b> to drill. Watch the bit heat: <b>release</b> to let it cool before it reaches {DRILL_LIMIT_C}°C{pressure < 0.05 ? " (no air here, so it cools slowly)" : ""}. Press <b>F</b> to leave.</Coach>
        )}

        {/* prompts during the drive */}
        {phase === "drive" && !docked && !result && (tele.nearRock || tele.nearStation) && !tele.grabbing && (coached.rock || !tele.nearRock) && (coached.station || tele.nearRock) && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 on-canvas px-4 py-2 text-xs rise">
            {tele.nearRock ? <span>Flagged rock: <b>hold E</b> to reach out, <b>release</b> when the cursor is in the green</span> : <span>Sample station: <b>press F</b> to dock and drill a core</span>}
          </div>
        )}
        {phase === "drive" && tele.grabbing && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 on-canvas px-4 py-3 text-xs w-72">
            {!coached.grab && <div className="mb-2 rounded-lg px-2.5 py-1.5" style={{ background: "rgba(251, 191, 36, 0.16)", border: "1px solid rgba(251, 191, 36, 0.55)" }}>Keep holding <b>E</b>. <b>Let go</b> the moment the white marker is inside the <span style={{ color: "#4ade80" }}>green</span> band for a clean grab.</div>}
            <div className="mb-1.5">Release <b>E</b> in the green</div>
            <div className="relative h-3 rounded-full" style={{ background: "linear-gradient(90deg, #ef4444 0%, #ef4444 35%, #22c55e 35%, #22c55e 65%, #ef4444 65%, #ef4444 100%)" }}>
              <div ref={cursorEl} className="absolute top-[-3px] h-[18px] w-1 rounded bg-white" style={{ left: "calc(50% - 2px)", willChange: "left" }} />
            </div>
          </div>
        )}
        {phase === "drive" && docked && !result && (
          <div className="absolute top-16 left-3 z-10 on-canvas px-3 py-2 text-xs w-60">
            <div className="flex justify-between"><span>Bit heat</span><span className="font-mono">{tele.bit ?? Math.round(ambient)}°C</span></div>
            <div className="bar mt-1"><span style={{ width: `${Math.min(100, Math.max(0, ((Number(tele.bit ?? ambient) - ambient) / (DRILL_LIMIT_C - ambient)) * 100))}%`, background: Number(tele.bit ?? 0) > DRILL_LIMIT_C * 0.85 ? "#f87171" : "#fbbf24" }} /></div>
            <div className="flex justify-between mt-2"><span>Core</span><span className="font-mono">{tele.depth ?? "0.00"} m</span></div>
            <div className="bar mt-1"><span style={{ width: `${(Number(tele.depth ?? 0) / CORE_TARGET_M) * 100}%`, background: "#67e8f9" }} /></div>
            <div className="mt-2 opacity-80">{tele.on ? "Drilling…" : "Released: cooling"} · F to leave</div>
          </div>
        )}
        {phase === "drive" && !docked && !result && Number(tele.traction ?? 0) > 0.05 && (
          <div className="absolute top-32 left-1/2 -translate-x-1/2 z-10 on-canvas px-4 py-2 text-xs w-72" style={{ borderColor: "#f87171" }}>
            <div className="flex justify-between"><b>Losing traction</b><span>stop and back off</span></div>
            <div className="bar mt-1.5"><span style={{ width: `${Math.min(100, Number(tele.traction) * 100)}%`, background: "#f87171" }} /></div>
          </div>
        )}
        {toast && <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 on-canvas px-4 py-1.5 text-sm font-semibold rise">{toast}</div>}
        {phase === "drive" && tele.hot && !result && <div className="absolute top-32 left-1/2 -translate-x-1/2 z-10 on-canvas px-4 py-1.5 text-xs" style={{ borderColor: "#f87171" }}>Motor over {rover.maxTempC}°C: crawling until it cools. Ease off, or pick a rover with more heat tolerance.</div>}
        {phase === "land" && tele.blind && <div className="absolute inset-0 z-10 pointer-events-none flex items-start justify-center pt-20" style={{ background: "radial-gradient(ellipse at 50% 70%, rgba(190, 170, 140, 0.22), rgba(190, 170, 140, 0.06) 70%)" }}><div className="px-5 py-3 text-sm max-w-md text-center rise rounded-xl" style={{ background: "rgba(127, 29, 29, 0.82)", border: "1px solid #f87171", color: "#fee2e2" }}><b>Dust blind-out.</b> With no air to slow it, the engine blast throws regolith hundreds of metres. Cameras and lidar lose the ground: this is why vacuum landings fly the last metres on inertial guidance.</div></div>}

        {/* what the Slope and Heat views mean */}
        {sensor === "sar" && (
          <div className="absolute top-24 right-3 z-10 on-canvas px-3 py-2 text-[11px] pointer-events-none w-56">
            <div className="font-semibold mb-1">Slope of the ground</div>
            {SLOPE_CLASSES.map((c) => <div key={c.label} className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: c.color }} />{c.label}</div>)}
            <div className="opacity-80 mt-1">From the site&apos;s real elevation data. Wheels start to slip past about 15°; where the slope beats the tyres&apos; grip (roughly 20–35°, depending on the world and the rover) it slides downhill.</div>
          </div>
        )}
        {sensor === "thermal" && (
          <div className="absolute top-24 right-3 z-10 on-canvas px-3 py-2 text-[11px] pointer-events-none w-64">
            <div className="flex justify-between font-semibold"><span>Surface temperature</span>{tele.ground !== undefined && <span>here {String(tele.ground)}°C</span>}</div>
            <div className="h-2.5 rounded-full mt-1.5" style={{ background: INFERNO_CSS }} />
            <div className="flex justify-between mt-0.5 font-mono"><span>{Math.round(tminC - 5)}°C</span><span>{Math.round(tmaxC + 5)}°C</span></div>
            <div className="opacity-80 mt-1">{pressure < 0.05 ? "No air: sunlit slopes heat fast, shadows stay near the night low." : pressure < 0.5 ? "Thin air: big swings between sun and shade." : "Air evens it out: smaller contrast."} The ground warms as the sun climbs; motors and the drill bit glow. {tempNote}</div>
          </div>
        )}

        {/* on-screen controls */}
        {!paused && (
          <div className="absolute bottom-3 left-3 z-10 on-canvas px-3.5 py-2 text-xs flex items-center gap-3">
            {phase === "land" && (<><span>Hold <b>SPACE</b> to fire · <b>W A S D</b> to drift</span>
              <button type="button" className="btn btn-sm btn-primary" onPointerDown={() => (keysRef.current["ThrustHold"] = true)} onPointerUp={() => (keysRef.current["ThrustHold"] = false)} onPointerLeave={() => (keysRef.current["ThrustHold"] = false)}>Hold to fire</button></>)}
            {phase === "drive" && !docked && (<><span><b>W A S D</b> drive · <b>E</b> claw · <b>F</b> dock</span>
              <button type="button" className="btn btn-sm" onPointerDown={() => (keysRef.current["GrabHold"] = true)} onPointerUp={() => (keysRef.current["GrabHold"] = false)} onPointerLeave={() => (keysRef.current["GrabHold"] = false)}>Hold: claw</button>
              <button type="button" className="btn btn-sm" onPointerDown={() => (keysRef.current["DockHold"] = true)} onPointerUp={() => (keysRef.current["DockHold"] = false)}>Dock</button></>)}
            {phase === "drive" && docked && (<><span>Hold <b>E</b> or <b>SPACE</b> to drill · release to cool · <b>F</b> leave</span>
              <button type="button" className="btn btn-sm btn-primary" onPointerDown={() => (keysRef.current["DrillHold"] = true)} onPointerUp={() => (keysRef.current["DrillHold"] = false)} onPointerLeave={() => (keysRef.current["DrillHold"] = false)}>Hold to drill</button></>)}
          </div>
        )}

        {/* briefings */}
        {brief && !result && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-3" style={{ background: "rgba(3, 6, 11, 0.55)", backdropFilter: "blur(3px)" }}>
            <div className="card-solid max-w-3xl w-full max-h-full flex flex-col rise overflow-hidden" data-tour="sim-briefing">
              <div className="overflow-y-auto px-5 pt-5 pb-3 min-h-0">
              {phase === "brief-drive" && landing && <div className="mb-3"><Status level="good"><CheckCircle2 className="w-3.5 h-3.5" /> {landing.headline} · +{score.landing}</Status><p className="text-xs muted mt-1.5">{landing.reason}</p></div>}
              {phase === "brief-drive" && (
                <div className="mb-4">
                  <div className="text-xs font-semibold mb-1.5">Choose a rover</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {ROVERS.map((r) => (
                      <button key={r.id} type="button" onClick={() => setRoverId(r.id)} className="row relative" aria-pressed={r.id === roverId} title={r.note}>
                        {r.bestFor === body && <span className="absolute -top-2 right-2 status status-good">Suits {body === "earth" ? "Earth" : body === "moon" ? "the Moon" : "Mars"}</span>}
                        <div className="flex items-center justify-between text-xs font-semibold"><span className="truncate pr-1">{r.name}</span><span className="font-mono muted">${r.costM}M</span></div>
                        <div className="text-[11px] muted mt-0.5">Wheels {r.tough.toLowerCase()} · heat {r.heat.toLowerCase()} · {r.topSpeed.toFixed(0)} m/s</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] muted mt-1.5">{rover.note}</p>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs muted"><BriefIcon className="w-4 h-4" /> {brief.name} · on {worldLabel} · {gravity} m/s² · {pressure} bar{phase === "brief-drive" ? ` · ${rover.name}` : ""}</div>
              <h3 className="text-base font-semibold mt-1 leading-snug">{brief.goal}</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3 mt-3 text-xs">
                <div><div className="font-semibold mb-1.5" style={{ color: "var(--good)" }}>You pass if</div><ul className="flex flex-col gap-1">{brief.pass.map((x) => <li key={x}>• {x}</li>)}</ul></div>
                <div><div className="font-semibold mb-1.5" style={{ color: "var(--bad)" }}>You fail if</div><ul className="flex flex-col gap-1">{brief.fail.map((x) => <li key={x}>• {x}</li>)}</ul></div>
                <div><div className="font-semibold mb-1.5">Controls</div><ul className="flex flex-col gap-1">{brief.controls.map((x) => <li key={x}>• {x}</li>)}</ul></div>
                <div><div className="font-semibold mb-1.5">Points</div><ul className="flex flex-col gap-1">{brief.scoring.map((x) => <li key={x}>• {x}</li>)}</ul></div>
              </div>
              {side === "space" && <p className="text-xs muted mt-4">Same mission, different world: gravity is {((gravity / 9.81) * 100).toFixed(0)}% of Earth&apos;s, air pressure is {pressure} bar, and the ground here averages {ambient.toFixed(0)}°C. {pressure < 0.5 ? "With no air, motors and drill bits keep the heat they make." : ""}</p>}
              </div>
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t line shrink-0" style={{ background: "var(--panel-solid)" }}>
                <span className="text-xs muted min-w-0 truncate" title={demSource ? `Source: ${demSource}` : undefined}>{grid ? "Ground built from this site's real elevation map." : "Loading terrain…"}</span>
                <button type="button" className="btn btn-primary shrink-0" disabled={!grid} onClick={() => { if (phase === "brief-drive") done("land"); setPhase(phase === "brief-land" ? "land" : "drive"); }}><Play className="w-4 h-4" /> {phase === "brief-land" ? "Start the landing" : "Roll out"}</button>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-3" style={{ background: "rgba(3, 6, 11, 0.55)", backdropFilter: "blur(3px)" }}>
            <div className="card-solid p-6 max-w-lg w-full max-h-full overflow-y-auto text-center rise">
              <Status level={result.status === "PASS" ? "good" : "bad"}>{result.status === "PASS" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} {result.status === "PASS" ? "Mission Passed" : "Mission Failed"} on {worldLabel}</Status>
              <h3 className="text-xl font-semibold mt-3">{result.headline}</h3>
              <p className="text-sm muted mt-2 text-left leading-relaxed">{result.reason}</p>
              <div className="mt-4 card p-3 flex items-center justify-between">
                <div className="text-left"><div className="text-[11px] muted">Score</div><div className="text-2xl font-semibold">{result.total} <span className="text-sm muted font-normal">/ {MAX_SCORE}</span></div></div>
                <div className="text-right text-xs muted">
                  <div>Landing {result.score.landing} · Waypoints {result.score.waypoints}</div>
                  <div>Rocks {result.score.rocks} · Cores {result.score.cores} · Time {result.score.time}</div>
                  <div className="font-semibold mt-0.5" style={{ color: "var(--text)" }}>{grade(result.total)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3 text-left">{result.numbers.map((n) => <div key={n.label} className="card p-2.5"><div className="text-[11px] muted">{n.label}</div><div className="text-sm font-semibold">{n.value}</div></div>)}</div>
              <div className="flex gap-2 justify-center mt-5">
                <button type="button" onClick={restart} className="btn">Fly it again here</button>
                <button type="button" onClick={() => changeSide(other)} className="btn btn-primary">Now fly it on {otherName} →</button>
              </div>
            </div>
          </div>
        )}

        <div className="w-full h-full cursor-grab active:cursor-grabbing">
          <Canvas shadows camera={{ fov: 58, near: 0.1, far: 260 }} dpr={[1, 1.75]}>
            <Suspense fallback={null}>
            <SimScene key={`${runId}-${side}`} siteId={side === "earth" ? selectedMatch.id : t.id} body={body} gravity={gravity} pressure={pressure} mineral={mineral} iron={iron} clay={clay} bareness={bare} ambientC={ambient}
              roughness={selectedMatch.pillar_scores.radar ?? 0.5} grid={grid} reliefM={reliefM} sensor={sensor} rover={rover} keysRef={keysRef} lookRef={lookRef} thirdPerson={thirdPerson}
              runId={runId} phase={phase} paused={paused} docked={docked} waypointIdx={Number(tele.wp ?? 0)} tminC={tminC} tmaxC={tmaxC} sunElevMax={sunElevMax} ve={ve} cursorRef={cursorRef} onTelemetry={setTele} onLanded={onLanded} onDrive={onDrive} />
            </Suspense>
          </Canvas>
        </div>
      </div>

      <p className="text-[11px] faint px-1 -mt-1">3D models: Curiosity rover, NASA (public domain) · Mars Polar Lander by emin31284 · beacon by AMMediaGames · rocks by Michael Hooper (Sketchfab, CC BY 4.0). Terrain from the site&apos;s real elevation data.</p>
      {(runs.earth || runs.space) && <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-tour="sim-results">
        {(["earth", "space"] as WorldSide[]).map((w) => { const r = runs[w]; const name = w === "earth" ? selectedMatch.name : t.name; return (
          <div key={w} className="card p-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] muted">{w === "earth" ? "Earth" : t.body === "moon" ? "Moon" : "Mars"} · {name}</div>
              <div className="text-sm font-medium mt-0.5 truncate">{r ? `${r.headline} · ${r.total} points · ${grade(r.total)}` : w === side ? "Not flown yet." : `Switch to ${w === "earth" ? "Earth" : otherName} to fly it there.`}</div>
            </div>
            {r && <Status level={r.status === "PASS" ? "good" : "bad"}>{r.status === "PASS" ? "Passed" : "Failed"}</Status>}
          </div>
        ); })}
      </div>}
      {runs.earth && runs.space && (
        <p className="text-xs muted px-1">{runs.earth.total > runs.space.total ? `Earth scored ${runs.earth.total - runs.space.total} more.` : runs.space.total > runs.earth.total ? `${otherName === "Earth" ? worldLabel : otherName} scored ${runs.space.total - runs.earth.total} more.` : "Same score on both worlds."} The gap between the two runs is the part an Earth test cannot show you: {t.body === "moon" ? "on the Moon" : "on Mars"} gravity is {t.gravity} m/s², air is {t.pressure_bar} bar and the ground is far colder.</p>
      )}
    </div>
  );
}
