"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls, Stars } from "@react-three/drei";
import { ArrowLeft, RotateCcw, Car, Rocket, Drill, CheckCircle2, XCircle, Eye, Play } from "lucide-react";
import type { EarthMatch, MatchPayload } from "@/components/AnalyticsView";
import { Status } from "@/components/ui";

/* =====================================================================================
   Types and catalogue
   ===================================================================================== */
type ScenarioType = "rover" | "landing" | "mining";
type WorldSide = "earth" | "space";
type Body = "earth" | "moon" | "mars";
type Sensor = "optical" | "sar" | "thermal";

interface RunRecord { status: "PASS" | "FAIL"; timeSec: number; headline: string; reason: string; numbers: { label: string; value: string }[] }

interface RoverSpec { id: string; name: string; costM: number; wheels: string; maxTempC: number; radiator: number; armor: number; topSpeed: number; grip: number; bestFor?: Body; note: string }

const ROVERS: RoverSpec[] = [
  { id: "budget_buggy", name: "Budget buggy", costM: 18, wheels: "Rubber", maxTempC: 112, radiator: 0.04, armor: 0.26, topSpeed: 2.6, grip: 0.65, note: "Cheap. Rubber tyres wear fast on sharp rock and cannot shed heat without air." },
  { id: "desert_scout", name: "Desert scout", costM: 48, wheels: "Aluminium treads", maxTempC: 140, radiator: 0.22, armor: 0.55, topSpeed: 2.5, grip: 0.85, bestFor: "earth", note: "A solid Earth field vehicle." },
  { id: "micro_hopper", name: "Micro scout", costM: 95, wheels: "Titanium mesh", maxTempC: 152, radiator: 0.42, armor: 0.68, topSpeed: 3.1, grip: 0.82, note: "Light and quick; thin wheels." },
  { id: "mars_perseverance", name: "Mars class", costM: 145, wheels: "Machined titanium", maxTempC: 185, radiator: 0.82, armor: 1.45, topSpeed: 2.3, grip: 0.95, bestFor: "mars", note: "Nuclear-heated, built for thin air and cold." },
  { id: "lunar_cryo", name: "Lunar class", costM: 195, wheels: "Shape-memory alloy", maxTempC: 205, radiator: 1.05, armor: 1.85, topSpeed: 2.4, grip: 1.05, bestFor: "moon", note: "Big radiators for vacuum, springy wheels for low gravity." },
  { id: "heavy_isru", name: "Heavy hauler", costM: 280, wheels: "Steel crawler", maxTempC: 225, radiator: 1.25, armor: 2.5, topSpeed: 1.8, grip: 1.15, note: "Slow, tough, expensive." },
];

const WORLD_SIZE = 60;
const MASS_KG = 650;
const WAYPOINTS = 5;
const DRILL_LIMIT_C = 110;
const DRILL_TARGET_M = 2.0;
const LAND_SPEED_LIMIT = 3.0;
const PAD_RADIUS = 5.0;

/* =====================================================================================
   Terrain helpers (heights are the site's real elevation data; nothing here invents relief)
   ===================================================================================== */
function hashString(str?: string): number {
  if (!str) return 777;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
const rng = (seed: number) => { let s = seed % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; };

function shapeEdges(grid: number[], wx: number, wz: number, raw: number): number {
  if (!grid || grid.length !== 128 * 128) return raw;
  let h = raw;
  const d = Math.hypot(wx, wz);
  if (d < 7.5) { const c = grid[64 * 128 + 64] || 0; h = THREE.MathUtils.lerp(c, h, THREE.MathUtils.smoothstep(d, 3.8, 7.5)); }   // a flat pad in the middle for the lander and drill
  const e = Math.max(Math.abs(wx), Math.abs(wz));
  if (e > WORLD_SIZE / 2 - 4) h = THREE.MathUtils.lerp(h, 0, THREE.MathUtils.smoothstep(e, WORLD_SIZE / 2 - 4, WORLD_SIZE / 2));
  return h;
}

function sample(grid: number[], relief: number, wx: number, wz: number): { h: number; slopeDeg: number } {
  if (!grid || grid.length !== 128 * 128 || Math.abs(wx) > WORLD_SIZE / 2 || Math.abs(wz) > WORLD_SIZE / 2) return { h: 0, slopeDeg: 0 };
  const u = THREE.MathUtils.clamp((wx + WORLD_SIZE / 2) / WORLD_SIZE, 0, 1) * 127, v = THREE.MathUtils.clamp((wz + WORLD_SIZE / 2) / WORLD_SIZE, 0, 1) * 127;
  const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(127, x0 + 1), y1 = Math.min(127, y0 + 1), tx = u - x0, ty = v - y0;
  const h00 = grid[y0 * 128 + x0] || 0, h10 = grid[y0 * 128 + x1] || 0, h01 = grid[y1 * 128 + x0] || 0, h11 = grid[y1 * 128 + x1] || 0;
  const raw = (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
  const cell = WORLD_SIZE / 127;
  const grad = Math.hypot((h10 - h00) * relief, (h01 - h00) * relief) / cell;
  return { h: shapeEdges(grid, wx, wz, raw) * relief, slopeDeg: THREE.MathUtils.radToDeg(Math.atan(grad)) };
}

/* =====================================================================================
   Procedural textures (drawn once on a canvas; real heights, hand-made surface detail)
   ===================================================================================== */
function noiseCanvas(seed: number, base: string, grain: string, speck: string, size = 512): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!; const r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 36; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  g.fillStyle = grain; for (let i = 0; i < 2600; i++) { const s = 1 + r() * 3; g.globalAlpha = 0.25 + r() * 0.4; g.fillRect(r() * size, r() * size, s, s); }
  g.fillStyle = speck; for (let i = 0; i < 700; i++) { g.globalAlpha = 0.2 + r() * 0.5; g.beginPath(); g.arc(r() * size, r() * size, 1 + r() * 4, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  return c;
}
function panelCanvas(base = "#d6dbe3", line = "#8a94a3", size = 256): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d")!; const r = rng(99);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  g.strokeStyle = line; g.lineWidth = 2;
  for (let i = 0; i < 5; i++) { const x = (i + 0.5) * (size / 5) + (r() - 0.5) * 20; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.stroke(); }
  for (let i = 0; i < 4; i++) { const y = (i + 0.5) * (size / 4); g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }
  g.fillStyle = "#5b6472"; for (let i = 0; i < 80; i++) { g.beginPath(); g.arc(r() * size, r() * size, 2, 0, Math.PI * 2); g.fill(); }
  return c;
}
function foilCanvas(size = 256): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d")!; const r = rng(31);
  g.fillStyle = "#c9931c"; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) { g.fillStyle = r() > 0.5 ? "#f5c542" : "#9a6a0e"; g.globalAlpha = 0.35; g.beginPath(); const x = r() * size, y = r() * size; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40); g.closePath(); g.fill(); }
  g.globalAlpha = 1; return c;
}
function solarCanvas(size = 256): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d")!;
  g.fillStyle = "#0b1d4d"; g.fillRect(0, 0, size, size);
  g.strokeStyle = "#8fb3ff"; g.lineWidth = 2;
  for (let i = 0; i <= 6; i++) { const p = (i * size) / 6; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke(); }
  return c;
}
function tex(canvas: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
  return t;
}

function groundPalette(body: Body, mineral: string, sensor: Sensor) {
  if (sensor === "sar") return { base: "#0b1220", grain: "#0e7490", speck: "#22d3ee", low: "#0f172a", mid: "#0891b2", rock: "#67e8f9" };
  if (sensor === "thermal") return body === "earth" ? { base: "#7c2d12", grain: "#ea580c", speck: "#facc15", low: "#9a3412", mid: "#ea580c", rock: "#fde047" } : { base: "#1e3a8a", grain: "#2563eb", speck: "#93c5fd", low: "#1e3a8a", mid: "#2563eb", rock: "#93c5fd" };
  if (body === "moon") return { base: "#6b7280", grain: "#9ca3af", speck: "#374151", low: "#4b5563", mid: "#737a85", rock: "#a1a7b0" };
  if (body === "mars") return mineral === "basalt_ice" ? { base: "#8a3a1e", grain: "#b4552c", speck: "#d9d9d9", low: "#7c2d12", mid: "#a3431f", rock: "#cbd5e1" } : { base: "#9a3f1c", grain: "#c2602e", speck: "#5a1f0c", low: "#7c2d12", mid: "#c2410c", rock: "#451a03" };
  if (mineral === "biomass_wet") return { base: "#2f5e2a", grain: "#4a7c3a", speck: "#1b3d17", low: "#14532d", mid: "#3f7a32", rock: "#5b7a2a" };
  if (mineral === "evaporite_sulfate") return { base: "#d8d4cc", grain: "#eeeae2", speck: "#8c8578", low: "#c9c4ba", mid: "#e2ded6", rock: "#8c8578" };
  if (mineral.includes("basalt")) return { base: "#3b3733", grain: "#57534e", speck: "#1c1917", low: "#292524", mid: "#4a4541", rock: "#6b645d" };
  return { base: "#b08a5c", grain: "#c8a373", speck: "#6b5544", low: "#a18056", mid: "#c29b6b", rock: "#6b5544" };
}

/* =====================================================================================
   Terrain
   ===================================================================================== */
function Terrain({ siteId, grid, reliefM, body, mineral, sensor, roughness }: { siteId: string; grid: number[] | null; reliefM: number; body: Body; mineral: string; sensor: Sensor; roughness: number }) {
  const relief = Math.max(0.8, reliefM / 36);
  const pal = useMemo(() => groundPalette(body, mineral, sensor), [body, mineral, sensor]);
  const map = useMemo(() => tex(noiseCanvas(hashString(siteId), pal.base, pal.grain, pal.speck), 14), [siteId, pal]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 127, 127); geo.rotateX(-Math.PI / 2);
    if (!grid || grid.length !== 128 * 128) return geo;
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) pos.setY(i, shapeEdges(grid, pos.getX(i), pos.getZ(i), grid[i] || 0) * relief);
    geo.computeVertexNormals();
    const n = geo.attributes.normal, tmp = new THREE.Color(), low = new THREE.Color(pal.low), mid = new THREE.Color(pal.mid), rock = new THREE.Color(pal.rock);
    for (let i = 0; i < pos.count; i++) {
      const steep = THREE.MathUtils.clamp((1 - n.getY(i)) * 4.5, 0, 1);
      tmp.copy(low).lerp(mid, grid[i] || 0).lerp(rock, steep * 0.85);
      // vertex colour multiplies the texture, so keep it bright
      tmp.multiplyScalar(1.35);
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [grid, relief, pal]);

  const rocks = useRef<THREE.InstancedMesh>(null);
  const count = Math.round(60 + roughness * 160);
  useEffect(() => {
    if (!rocks.current || !grid) return;
    const d = new THREE.Object3D(), r = rng(hashString(siteId));
    for (let i = 0; i < count; i++) {
      const wx = (r() - 0.5) * (WORLD_SIZE - 9), wz = (r() - 0.5) * (WORLD_SIZE - 9);
      if (Math.hypot(wx, wz) < 5.5) d.scale.set(0, 0, 0);
      else { const { h } = sample(grid, relief, wx, wz); const s = 0.12 + r() * 0.4; d.position.set(wx, h + s * 0.3, wz); d.rotation.set(r() * 3, r() * 3, r() * 3); d.scale.set(s * (0.8 + r() * 0.6), s * 0.7, s * (0.8 + r() * 0.6)); }
      d.updateMatrix(); rocks.current.setMatrixAt(i, d.matrix);
    }
    rocks.current.instanceMatrix.needsUpdate = true;
  }, [siteId, grid, relief, count]);

  const half = WORLD_SIZE / 2, ext = 160;
  return (
    <group>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial vertexColors map={map} wireframe={sensor === "sar"} roughness={0.95} metalness={0.02} />
      </mesh>
      {[[0, -(half + ext / 2), WORLD_SIZE + ext * 2, ext], [0, half + ext / 2, WORLD_SIZE + ext * 2, ext], [-(half + ext / 2), 0, ext, WORLD_SIZE], [half + ext / 2, 0, ext, WORLD_SIZE]].map(([x, z, w, h], i) => (
        <mesh key={i} position={[x, 0, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[w, h]} /><meshStandardMaterial color={pal.low} map={map} wireframe={sensor === "sar"} roughness={0.95} /></mesh>
      ))}
      <instancedMesh ref={rocks} args={[undefined, undefined, count]} castShadow>
        <dodecahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={pal.rock} roughness={0.95} />
      </instancedMesh>
    </group>
  );
}

/* =====================================================================================
   Vehicles
   ===================================================================================== */
function Rover({ groupRef, wheelRefs, spec }: { groupRef: React.RefObject<THREE.Group | null>; wheelRefs: React.MutableRefObject<(THREE.Group | null)[]>; spec: RoverSpec }) {
  const panels = useMemo(() => tex(panelCanvas()), []);
  const solar = useMemo(() => tex(solarCanvas()), []);
  const wheelX = 0.62, wheelZ = [-0.62, 0.0, 0.62];
  return (
    <group ref={groupRef}>
      {/* chassis */}
      <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[0.9, 0.3, 1.4]} /><meshStandardMaterial map={panels} metalness={0.4} roughness={0.5} /></mesh>
      <mesh position={[0, 0.47, 0.05]}><boxGeometry args={[1.0, 0.04, 1.15]} /><meshStandardMaterial map={solar} metalness={0.6} roughness={0.3} /></mesh>
      {/* rocker arms */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.5, 0.22, 0.3]}><boxGeometry args={[0.06, 0.06, 0.75]} /><meshStandardMaterial color="#9aa3ad" metalness={0.7} roughness={0.3} /></mesh>
          <mesh position={[side * 0.5, 0.22, -0.35]} rotation={[0.5, 0, 0]}><boxGeometry args={[0.06, 0.06, 0.7]} /><meshStandardMaterial color="#9aa3ad" metalness={0.7} roughness={0.3} /></mesh>
        </group>
      ))}
      {/* mast and camera head */}
      <mesh position={[-0.25, 0.85, -0.5]}><cylinderGeometry args={[0.03, 0.04, 0.75, 10]} /><meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.3} /></mesh>
      <mesh position={[-0.25, 1.24, -0.5]}><boxGeometry args={[0.3, 0.14, 0.16]} /><meshStandardMaterial color="#f1f5f9" /></mesh>
      {[-0.08, 0.08].map((x) => <mesh key={x} position={[-0.25 + x, 1.24, -0.59]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.035, 0.035, 0.04, 12]} /><meshStandardMaterial color="#111827" /></mesh>)}
      {/* high-gain antenna */}
      <mesh position={[0.3, 0.7, 0.45]} rotation={[-0.6, 0, 0]}><cylinderGeometry args={[0.18, 0.02, 0.08, 20]} /><meshStandardMaterial color="#e5e7eb" metalness={0.5} roughness={0.35} /></mesh>
      {/* power unit at the back for the planetary classes */}
      {spec.radiator > 0.6 && (
        <group position={[0, 0.5, 0.78]} rotation={[0.5, 0, 0]}>
          <mesh><cylinderGeometry args={[0.1, 0.1, 0.5, 12]} /><meshStandardMaterial color="#374151" metalness={0.8} roughness={0.3} /></mesh>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <mesh key={i} rotation={[0, (i * Math.PI) / 4, 0]}><boxGeometry args={[0.32, 0.46, 0.012]} /><meshStandardMaterial color="#9ca3af" metalness={0.7} /></mesh>)}
        </group>
      )}
      {/* six wheels with grousers */}
      {[-1, 1].flatMap((side) => wheelZ.map((z, k) => {
        const idx = (side < 0 ? 0 : 3) + k;
        return (
          <group key={idx} ref={(el) => { wheelRefs.current[idx] = el; }} position={[side * wheelX, 0, z]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.24, 0.24, 0.2, 20]} /><meshStandardMaterial color="#1f2937" roughness={0.9} /></mesh>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => <mesh key={i} rotation={[(i * Math.PI) / 6, 0, 0]}><boxGeometry args={[0.21, 0.5, 0.03]} /><meshStandardMaterial color="#111827" roughness={0.9} /></mesh>)}
            <mesh rotation={[0, 0, Math.PI / 2]} position={[side * 0.11, 0, 0]}><cylinderGeometry args={[0.1, 0.1, 0.02, 12]} /><meshStandardMaterial color="#9ca3af" metalness={0.7} /></mesh>
          </group>
        );
      }))}
    </group>
  );
}

function Lander({ groupRef, flameRef }: { groupRef: React.RefObject<THREE.Group | null>; flameRef: React.RefObject<THREE.Group | null> }) {
  const foil = useMemo(() => tex(foilCanvas(), 2), []);
  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.45, 0]} castShadow><cylinderGeometry args={[0.75, 0.85, 0.55, 8]} /><meshStandardMaterial map={foil} metalness={0.7} roughness={0.35} /></mesh>
      <mesh position={[0, 0.95, 0]}><cylinderGeometry args={[0.5, 0.65, 0.5, 8]} /><meshStandardMaterial color="#e5e7eb" metalness={0.3} roughness={0.5} /></mesh>
      <mesh position={[0, 1.3, 0]}><sphereGeometry args={[0.22, 16, 12]} /><meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.3} /></mesh>
      {/* tanks */}
      {[0, 1, 2, 3].map((i) => { const a = (i * Math.PI) / 2; return <mesh key={i} position={[Math.cos(a) * 0.62, 0.5, Math.sin(a) * 0.62]}><sphereGeometry args={[0.2, 16, 12]} /><meshStandardMaterial color="#f8fafc" metalness={0.5} roughness={0.3} /></mesh>; })}
      {/* legs */}
      {[0, 1, 2, 3].map((i) => { const a = (i * Math.PI) / 2 + Math.PI / 4; return (
        <group key={i} rotation={[0, a, 0]}>
          <mesh position={[0.95, -0.1, 0]} rotation={[0, 0, 0.75]}><cylinderGeometry args={[0.035, 0.045, 1.1, 10]} /><meshStandardMaterial color="#9ca3af" metalness={0.7} roughness={0.3} /></mesh>
          <mesh position={[0.78, 0.15, 0]} rotation={[0, 0, 1.2]}><cylinderGeometry args={[0.022, 0.022, 0.7, 8]} /><meshStandardMaterial color="#6b7280" metalness={0.7} /></mesh>
          <mesh position={[1.32, -0.54, 0]}><cylinderGeometry args={[0.22, 0.26, 0.06, 16]} /><meshStandardMaterial color="#374151" metalness={0.5} /></mesh>
        </group>
      ); })}
      {/* engine bell */}
      <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.14, 0.32, 0.4, 20, 1, true]} /><meshStandardMaterial color="#1f2937" metalness={0.9} roughness={0.25} side={THREE.DoubleSide} /></mesh>
      <group ref={flameRef} position={[0, -0.5, 0]} visible={false}>
        <mesh rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.3, 1.3, 14]} /><meshBasicMaterial color="#fb923c" transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
        <mesh position={[0, 0.2, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.15, 0.8, 10]} /><meshBasicMaterial color="#bae6fd" transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
        <pointLight intensity={8} distance={12} color="#fdba74" />
      </group>
    </group>
  );
}

function DrillRig({ padY, carriageRef, bitMat, coreRef, chipsRef, body }: { padY: number; carriageRef: React.RefObject<THREE.Group | null>; bitMat: React.RefObject<THREE.MeshStandardMaterial | null>; coreRef: React.RefObject<THREE.Mesh | null>; chipsRef: React.RefObject<THREE.Group | null>; body: Body }) {
  const panels = useMemo(() => tex(panelCanvas("#cfd5de", "#7d8794")), []);
  return (
    <group position={[0, padY, 0]}>
      {/* base frame and outriggers */}
      <mesh position={[0, 0.12, 0]}><boxGeometry args={[1.6, 0.16, 1.6]} /><meshStandardMaterial map={panels} metalness={0.5} roughness={0.4} /></mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], i) => (
        <group key={i}>
          <mesh position={[x * 1.1, 0.1, z * 1.1]} rotation={[0, Math.atan2(x, z), 0.0]}><boxGeometry args={[0.1, 0.08, 0.9]} /><meshStandardMaterial color="#6b7280" metalness={0.6} /></mesh>
          <mesh position={[x * 1.45, 0.04, z * 1.45]}><cylinderGeometry args={[0.16, 0.18, 0.08, 12]} /><meshStandardMaterial color="#374151" /></mesh>
        </group>
      ))}
      {/* mast */}
      <mesh position={[0.4, 1.6, 0]}><boxGeometry args={[0.16, 2.9, 0.16]} /><meshStandardMaterial color="#9ca3af" metalness={0.7} roughness={0.3} /></mesh>
      <mesh position={[0.4, 3.08, 0]}><boxGeometry args={[0.5, 0.12, 0.3]} /><meshStandardMaterial color="#374151" metalness={0.6} /></mesh>
      {/* carriage with motor, auger and bit; moves down as the hole deepens */}
      <group ref={carriageRef} position={[0, 2.4, 0]}>
        <mesh position={[0.2, 0, 0]}><boxGeometry args={[0.6, 0.4, 0.4]} /><meshStandardMaterial color="#1f2937" metalness={0.7} roughness={0.3} /></mesh>
        <mesh position={[0, -0.9, 0]}><cylinderGeometry args={[0.06, 0.06, 2.4, 12]} /><meshStandardMaterial ref={bitMat} color="#cbd5e1" metalness={0.8} roughness={0.25} /></mesh>
        {Array.from({ length: 9 }, (_, i) => <mesh key={i} position={[0, -0.25 - i * 0.2, 0]} rotation={[0.25, i * 0.9, 0]}><torusGeometry args={[0.13, 0.025, 8, 18]} /><meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.25} /></mesh>)}
        <mesh position={[0, -2.15, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.1, 0.25, 10]} /><meshStandardMaterial color="#f59e0b" metalness={0.8} /></mesh>
      </group>
      {/* core sample tube on the frame */}
      <mesh position={[-0.55, 0.75, 0.45]}><cylinderGeometry args={[0.1, 0.1, 1.1, 14]} /><meshStandardMaterial color="#93c5fd" transparent opacity={0.3} /></mesh>
      <mesh ref={coreRef} position={[-0.55, 0.22, 0.45]}><cylinderGeometry args={[0.08, 0.08, 1.0, 12]} /><meshStandardMaterial color={body === "mars" ? "#b45309" : body === "moon" ? "#6b7280" : "#78716c"} /></mesh>
      <group ref={chipsRef} position={[0, 0.2, 0]} visible={false}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i * Math.PI) / 4; return <mesh key={i} position={[Math.cos(a) * 0.4, (i % 2) * 0.12, Math.sin(a) * 0.4]}><dodecahedronGeometry args={[0.05, 0]} /><meshBasicMaterial color="#fbbf24" /></mesh>; })}
      </group>
    </group>
  );
}

/* a surveyed waypoint: tripod, pole, lamp and a ground ring */
function Waypoint({ x, y, z, state, index }: { x: number; y: number; z: number; state: "done" | "next" | "later"; index: number }) {
  const lamp = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (lamp.current && state === "next") (lamp.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 + Math.sin(clock.elapsedTime * 5) * 1.2; });
  const col = state === "done" ? "#22c55e" : state === "next" ? "#38bdf8" : "#94a3b8";
  return (
    <group position={[x, y, z]}>
      {[0, 1, 2].map((i) => { const a = (i * Math.PI * 2) / 3; return <mesh key={i} position={[Math.cos(a) * 0.35, 0.55, Math.sin(a) * 0.35]} rotation={[Math.sin(a) * 0.32, 0, -Math.cos(a) * 0.32]}><cylinderGeometry args={[0.02, 0.025, 1.15, 8]} /><meshStandardMaterial color="#d1d5db" metalness={0.6} /></mesh>; })}
      <mesh position={[0, 1.6, 0]}><cylinderGeometry args={[0.025, 0.025, 1.3, 8]} /><meshStandardMaterial color="#e5e7eb" metalness={0.6} /></mesh>
      <mesh ref={lamp} position={[0, 2.3, 0]}><sphereGeometry args={[0.14, 16, 12]} /><meshStandardMaterial color={col} emissive={col} emissiveIntensity={state === "later" ? 0.3 : 1.5} /></mesh>
      <mesh position={[0.22, 2.0, 0]}><planeGeometry args={[0.4, 0.26]} /><meshStandardMaterial color={col} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.3, 2.6, 40]} /><meshBasicMaterial color={col} transparent opacity={state === "later" ? 0.25 : 0.6} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.3, 16]} /><meshBasicMaterial color={col} /></mesh>
      {/* dots above the lamp count the waypoint number, readable from any side */}
      <group position={[0, 2.75, 0]}>{Array.from({ length: index + 1 }, (_, i) => <mesh key={i} position={[(i - index / 2) * 0.12, 0, 0]}><sphereGeometry args={[0.04, 8, 8]} /><meshBasicMaterial color="#ffffff" /></mesh>)}</group>
    </group>
  );
}

/* =====================================================================================
   The scene: physics and camera live here
   ===================================================================================== */
interface Telemetry { [k: string]: number | string | boolean | undefined }

function makeGuide(x: number, y: number, z: number, padY: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24, u = 1 - t; pts.push([u * u * x + 2 * u * t * x * 0.35, u * u * y + 2 * u * t * (padY + 6) + t * t * (padY + 0.6), u * u * z + 2 * u * t * z * 0.35]); }
  return pts;
}

function SimScene(p: {
  siteId: string; body: Body; gravity: number; pressure: number; mineral: string; iron: number; clay: number; bareness: number; ambientC: number; roughness: number;
  grid: number[] | null; reliefM: number; scenario: ScenarioType; sensor: Sensor; rover: RoverSpec; keysRef: React.MutableRefObject<Record<string, boolean>>;
  lookRef: React.MutableRefObject<{ yaw: number; pitch: number }>; thirdPerson: boolean; runId: number; paused: boolean; waypointIdx: number;
  onTelemetry: (t: Telemetry) => void; onComplete: (r: RunRecord) => void;
}) {
  const { siteId, body, gravity, pressure, mineral, iron, clay, bareness, ambientC, roughness, grid, reliefM, scenario, sensor, rover, keysRef, lookRef, thirdPerson, runId, paused, waypointIdx, onTelemetry, onComplete } = p;
  const getState = useThree((st) => st.get);
  const controls = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const relief = Math.max(0.8, reliefM / 36);

  // a route of five waypoints, laid out from the site's id so it is the same every run
  const route = useMemo(() => {
    if (!grid) return [];
    const r = rng(hashString(siteId) + 11);
    const base = [[3, 6], [-5, -1], [5, -9], [-4, -17], [1, -24]];
    return base.map(([x, z]) => { const px = x + (r() - 0.5) * 4, pz = z + (r() - 0.5) * 2; return { x: px, z: pz, y: sample(grid, relief, px, pz).h }; });
  }, [siteId, grid, relief]);
  const path = useMemo(() => {
    if (!grid || !route.length) return [] as [number, number, number][];
    const pts: [number, number, number][] = []; let ax = 0, az = 14;
    for (const w of route) { const n = 18; for (let i = 0; i <= n; i++) { const x = THREE.MathUtils.lerp(ax, w.x, i / n), z = THREE.MathUtils.lerp(az, w.z, i / n); pts.push([x, sample(grid, relief, x, z).h + 0.08, z]); } ax = w.x; az = w.z; }
    return pts;
  }, [grid, route, relief]);

  const roverRef = useRef<THREE.Group>(null), wheels = useRef<(THREE.Group | null)[]>([]);
  const landerRef = useRef<THREE.Group>(null), flameRef = useRef<THREE.Group>(null), dustRef = useRef<THREE.Group>(null), predictRef = useRef<THREE.Mesh>(null), dropRef = useRef<THREE.Mesh>(null);
  const carriageRef = useRef<THREE.Group>(null), bitMat = useRef<THREE.MeshStandardMaterial>(null), coreRef = useRef<THREE.Mesh>(null), chipsRef = useRef<THREE.Group>(null);
  const [guide, setGuide] = useState<[number, number, number][]>([]);
  const prevFocus = useRef(new THREE.Vector3());

  const rock = useMemo(() => {
    if (bareness < 0.25) return { label: "wet soil and plant roots", hardness: 0.55, dry: false };
    return { label: mineral.replace(/_/g, " "), hardness: THREE.MathUtils.clamp(0.75 + iron * 0.45 - clay * 0.35, 0.55, 1.65), dry: true };
  }, [bareness, iron, clay, mineral]);

  const s = useRef({ done: false, started: false, t: 0, rx: 0, rz: 14, yaw: 0, speed: 0, wheel: 100, motor: 30, hot: false, wp: 0, slip: 0, stuckFor: 0, peakSlip: 0,
    lx: 3, lz: 10, ly: 26, vx: 0, vy: 0, vz: 0, fuel: 100, heat: 0, depth: 0, bit: 30, seized: false, pulses: 0, lastDrill: false, emit: 0, pad: 0 });

  // reset on a new run
  useEffect(() => {
    const padH = grid ? sample(grid, relief, 0, 0).h : 0;
    const startT = THREE.MathUtils.clamp(ambientC, -35, 45);
    lookRef.current = { yaw: 0, pitch: 0 };
    const camera = getState().camera;
    s.current = { done: false, started: false, t: 0, rx: 0, rz: 14, yaw: 0, speed: 0, wheel: 100, motor: startT, hot: false, wp: 0, slip: 0, stuckFor: 0, peakSlip: 0,
      lx: 3, lz: 10, ly: padH + 22, vx: 0, vy: -0.4, vz: 0, fuel: 100, heat: 0, depth: 0, bit: startT, seized: false, pulses: 0, lastDrill: false, emit: 0, pad: padH };
    const place = (fx: number, fy: number, fz: number, cx: number, cy: number, cz: number) => {
      prevFocus.current.set(fx, fy, fz);
      if (thirdPerson || scenario !== "rover") { camera.position.set(cx, cy, cz); if (controls.current) { controls.current.target.set(fx, fy, fz); controls.current.update(); } }
    };
    if (scenario === "rover") { const h = grid ? sample(grid, relief, 0, 14).h : 0; place(0, h + 0.4, 14, 0, h + 3.2, 20.5); }
    else if (scenario === "landing") place(3, padH + 22, 10, 14, padH + 28, 24);
    else place(0, padH + 1.2, 0, 4.2, padH + 3.0, 4.6);
    onTelemetry({});
  }, [siteId, scenario, rover.id, runId, grid, relief, ambientC, thirdPerson, getState, lookRef, onTelemetry]);

  useFrame(({ clock, camera }, raw) => {
    const dt = Math.min(raw, 0.05), st = s.current, k = keysRef.current;
    if (!grid || grid.length !== 128 * 128 || paused || st.done) return;

    /* ---------------- rover ---------------- */
    if (scenario === "rover") {
      const fwd = (k["KeyW"] || k["ArrowUp"] ? 1 : 0) - (k["KeyS"] || k["ArrowDown"] ? 1 : 0);
      const steer = (k["KeyA"] || k["ArrowLeft"] ? 1 : 0) - (k["KeyD"] || k["ArrowRight"] ? 1 : 0);
      if (fwd || steer) st.started = true;
      if (st.started) st.t += dt;

      const { slopeDeg } = sample(grid, relief, st.rx, st.rz), slopeRad = THREE.MathUtils.degToRad(slopeDeg);
      const normalN = MASS_KG * gravity * Math.cos(slopeRad);
      const mu = (body === "earth" ? 0.75 : body === "mars" ? 0.58 : 0.44) * rover.grip;
      const gripN = mu * normalN;
      const demandN = MASS_KG * gravity * Math.sin(slopeRad) + (fwd ? 1150 : 250);
      const slipRatio = THREE.MathUtils.clamp((demandN / (gripN + 1e-4)) * 0.42, 0.04, 1);
      st.slip = Math.round(slipRatio * 100); st.peakSlip = Math.max(st.peakSlip, st.slip);

      st.yaw += steer * (body === "earth" ? 1.3 : body === "mars" ? 1.1 : 0.95) * rover.grip * dt * (Math.abs(st.speed) > 0.2 ? 1 : 0.6);
      const envGrip = body === "earth" ? 1 : body === "mars" ? 0.78 : 0.62;
      const penalty = Math.max(0, (slopeDeg - 12) * 0.028) / (envGrip * rover.grip);
      const maxSpd = (st.hot ? 0.25 : 1) * rover.topSpeed * (1 - slipRatio * 0.7);
      st.speed = THREE.MathUtils.lerp(st.speed, fwd ? fwd * maxSpd * Math.max(0.2, 1 - penalty) : 0, dt * (fwd ? 2.2 : 3.5));
      st.rx = THREE.MathUtils.clamp(st.rx - Math.sin(st.yaw) * st.speed * dt, -27, 27);
      st.rz = THREE.MathUtils.clamp(st.rz - Math.cos(st.yaw) * st.speed * dt, -27, 27);

      // wheels wear on sharp rock, faster in vacuum where there is no moisture film; motors heat with work and cool with air and radiators
      const v = Math.abs(st.speed);
      const wear = (v * (body === "earth" ? 0.45 : 1.25) * rock.hardness * (0.7 + roughness * 0.5)) / rover.armor;
      st.wheel = Math.max(0, st.wheel - wear * dt * 1.4);
      const heat = (v * 4.5 + slopeDeg * 0.42) * (fwd ? 1 : 0.05);
      const airCool = (pressure / 1.013) * Math.max(0, st.motor - ambientC) * 0.42;
      const radCool = rover.radiator * Math.max(0, st.motor - ambientC) * 0.28;
      st.motor = Math.max(ambientC, st.motor + (heat - airCool - radCool) * dt * 2);
      if (st.motor >= rover.maxTempC) st.hot = true;
      if (st.hot && st.motor < rover.maxTempC * 0.78) st.hot = false;
      st.stuckFor = fwd && st.slip >= 92 ? st.stuckFor + dt : 0;

      const fail = (headline: string, reason: string) => { st.done = true; onComplete({ status: "FAIL", timeSec: +st.t.toFixed(1), headline, reason, numbers: [{ label: "Waypoints reached", value: `${st.wp} of ${WAYPOINTS}` }, { label: "Wheels left", value: `${st.wheel.toFixed(0)}%` }, { label: "Peak slip", value: `${st.peakSlip}%` }, { label: "Motor peak", value: `${st.motor.toFixed(0)}°C` }] }); };
      if (st.wheel <= 0) fail("Wheels worn through", `${rover.wheels} wheels wore out on ${rock.label}. Stronger wheels or a slower drive would have made it.`);
      else if (st.stuckFor > 2.5) fail("Stuck", `Wheel slip stayed above 90% on a ${slopeDeg.toFixed(0)}° slope under ${gravity} m/s² gravity. Back off and find a gentler line.`);

      const w = route[st.wp];
      if (w && Math.hypot(st.rx - w.x, st.rz - w.z) < 2.4) {
        st.wp += 1;
        if (st.wp >= route.length) { st.done = true; onComplete({ status: "PASS", timeSec: +st.t.toFixed(1), headline: "Route completed", reason: `${rover.name} reached all ${WAYPOINTS} waypoints in ${st.t.toFixed(0)} s with ${st.wheel.toFixed(0)}% wheel left.`, numbers: [{ label: "Time", value: `${st.t.toFixed(0)} s` }, { label: "Wheels left", value: `${st.wheel.toFixed(0)}%` }, { label: "Peak slip", value: `${st.peakSlip}%` }, { label: "Motor peak", value: `${st.motor.toFixed(0)}°C` }, { label: "Cost", value: `$${rover.costM}M` }] }); }
      }

      // place the body on six wheel contact points
      const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
      const offs = [[-0.62, -0.62], [-0.62, 0], [-0.62, 0.62], [0.62, -0.62], [0.62, 0], [0.62, 0.62]];
      const hs = offs.map(([lx, lz]) => sample(grid, relief, st.rx + lx * cy + lz * sy, st.rz - lx * sy + lz * cy).h);
      const bodyY = Math.max(sample(grid, relief, st.rx, st.rz).h, hs.reduce((a, b) => a + b, 0) / 6) + 0.26;
      const pitch = Math.atan2((hs[0] + hs[3]) / 2 - (hs[2] + hs[5]) / 2, 1.24), roll = Math.atan2((hs[0] + hs[1] + hs[2]) / 3 - (hs[3] + hs[4] + hs[5]) / 3, 1.24);
      if (roverRef.current) {
        roverRef.current.position.set(st.rx, bodyY, st.rz);
        roverRef.current.rotation.set(0, st.yaw, 0); roverRef.current.rotateX(pitch); roverRef.current.rotateZ(roll);
        offs.forEach(([lx, lz], i) => { const g = wheels.current[i]; if (g) { g.position.set(lx, THREE.MathUtils.clamp(hs[i] - bodyY + 0.24, -0.3, -0.02), lz); g.rotation.x -= st.speed * dt / 0.24; } });
      }

      if (thirdPerson && controls.current) {
        const focus = new THREE.Vector3(st.rx, bodyY + 0.3, st.rz);
        camera.position.add(focus.clone().sub(prevFocus.current));
        camera.position.y = Math.max(camera.position.y, sample(grid, relief, camera.position.x, camera.position.z).h + 0.9);
        controls.current.target.copy(focus); prevFocus.current.copy(focus); controls.current.update();
      } else {
        const vy = st.yaw + lookRef.current.yaw, cx = st.rx - Math.sin(st.yaw) * 0.6, cz = st.rz - Math.cos(st.yaw) * 0.6;
        const camY = Math.max(bodyY + 0.95, sample(grid, relief, cx, cz).h + 0.9);
        camera.position.set(cx, camY, cz);
        const ahead = sample(grid, relief, cx - Math.sin(vy) * 3, cz - Math.cos(vy) * 3).h;
        camera.lookAt(cx - Math.sin(vy) * 8, Math.max(camY + Math.sin(pitch) * 4, ahead + 0.5) + lookRef.current.pitch * 6, cz - Math.cos(vy) * 8);
      }

      const nx = route[st.wp]; let bearing = 0, dist = 0;
      if (nx) { const dx = nx.x - st.rx, dz = nx.z - st.rz; dist = Math.hypot(dx, dz); bearing = THREE.MathUtils.radToDeg(Math.atan2(dx * Math.cos(st.yaw) - dz * Math.sin(st.yaw), -dx * Math.sin(st.yaw) - dz * Math.cos(st.yaw))); }
      if (st.t - st.emit > 0.1 || !st.started) { st.emit = st.t; onTelemetry({ time: st.t.toFixed(1), speed: v.toFixed(1), wheel: st.wheel.toFixed(0), motor: st.motor.toFixed(0), hot: st.hot, wp: st.wp, dist: dist.toFixed(0), bearing, slope: slopeDeg.toFixed(0), slip: st.slip }); }
    }

    /* ---------------- lander ---------------- */
    if (scenario === "landing") {
      const thrust = k["Space"] || k["ThrustHold"] ? 1 : 0;
      const fi = (k["KeyW"] || k["ArrowUp"] ? 1 : 0) - (k["KeyS"] || k["ArrowDown"] ? 1 : 0), ri = (k["KeyD"] || k["ArrowRight"] ? 1 : 0) - (k["KeyA"] || k["ArrowLeft"] ? 1 : 0);
      st.started = true; st.t += dt;
      const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
      const g = (gravity / 9.81) * 5.2, drag = (pressure / 1.013) * 0.45, power = thrust && st.fuel > 0 ? 9.0 : 0;
      if (thrust && st.fuel > 0) st.fuel = Math.max(0, st.fuel - dt * (4.2 + (gravity / 9.81) * 8.8));
      st.vy += (-g + power - st.vy * drag) * dt;
      st.vx = THREE.MathUtils.lerp(st.vx, (f.x * fi + r.x * ri) * 5, dt * 3); st.vz = THREE.MathUtils.lerp(st.vz, (f.z * fi + r.z * ri) * 5, dt * 3);
      st.lx = THREE.MathUtils.clamp(st.lx + st.vx * dt, -24, 24); st.lz = THREE.MathUtils.clamp(st.lz + st.vz * dt, -24, 24); st.ly += st.vy * dt;
      const { h: gh, slopeDeg } = sample(grid, relief, st.lx, st.lz), alt = Math.max(0, st.ly - gh), padDist = Math.hypot(st.lx, st.lz);
      if (landerRef.current) landerRef.current.position.set(st.lx, Math.max(gh + 0.55, st.ly), st.lz);
      const firing = Boolean(thrust && st.fuel > 0);
      if (flameRef.current) { flameRef.current.visible = firing; if (firing) flameRef.current.scale.set(1, 0.85 + Math.sin(clock.elapsedTime * 45) * 0.25, 1); }
      const want = firing && alt < 11 ? 1 - alt / 11 : 0;
      st.heat = want > st.heat ? Math.min(1, st.heat + dt * 1.1 * want) : Math.max(0, st.heat - dt * (pressure > 0.5 ? 0.22 : 0.07));
      if (dustRef.current) { dustRef.current.visible = st.heat > 0.08 && alt < 12; dustRef.current.position.set(st.lx, gh + 0.3, st.lz); dustRef.current.rotation.y += dt * 2; const sc = 0.8 + st.heat * (pressure < 0.05 ? 3.4 : 1.5); dustRef.current.scale.set(sc, 0.6 + st.heat, sc); }
      // where you would hit if the engine cut now
      const tHit = (st.vy + Math.sqrt(Math.max(0, st.vy * st.vy + 2 * g * alt))) / g;
      const px = THREE.MathUtils.clamp(st.lx + st.vx * tHit, -28, 28), pz = THREE.MathUtils.clamp(st.lz + st.vz * tHit, -28, 28);
      if (predictRef.current) predictRef.current.position.set(px, sample(grid, relief, px, pz).h + 0.1, pz);
      if (dropRef.current) { dropRef.current.position.set(st.lx, gh + alt / 2, st.lz); dropRef.current.scale.set(1, Math.max(0.01, alt), 1); }
      if (controls.current) {
        const focus = new THREE.Vector3(st.lx, Math.max(gh + 0.55, st.ly), st.lz);
        camera.position.add(focus.clone().sub(prevFocus.current));
        camera.position.y = Math.max(camera.position.y, sample(grid, relief, camera.position.x, camera.position.z).h + 1.2);
        controls.current.target.copy(focus); prevFocus.current.copy(focus); controls.current.update();
      }
      if (alt <= 0.18) {
        st.done = true;
        const v = Math.abs(st.vy), soft = v <= LAND_SPEED_LIMIT, onPad = padDist <= PAD_RADIUS, level = slopeDeg <= 20, ok = soft && onPad && level;
        onComplete({ status: ok ? "PASS" : "FAIL", timeSec: +st.t.toFixed(1), headline: ok ? "Soft landing on the pad" : !soft ? "Hard landing" : !onPad ? "Missed the pad" : "Tipped over",
          reason: ok ? `Touched down at ${v.toFixed(1)} m/s, ${padDist.toFixed(1)} m from the pad centre, with ${st.fuel.toFixed(0)}% fuel left.` : !soft ? `Came down at ${v.toFixed(1)} m/s; the legs are rated for ${LAND_SPEED_LIMIT} m/s. Fire the engine earlier and longer.` : !onPad ? `Landed ${padDist.toFixed(1)} m from the pad (limit ${PAD_RADIUS} m). Watch the predicted touchdown marker and steer onto the pad.` : `Touched down on a ${slopeDeg.toFixed(0)}° slope; the lander can only stand on 20° or less.`,
          numbers: [{ label: "Touchdown speed", value: `${v.toFixed(1)} m/s` }, { label: "Distance to pad", value: `${padDist.toFixed(1)} m` }, { label: "Ground slope", value: `${slopeDeg.toFixed(0)}°` }, { label: "Fuel left", value: `${st.fuel.toFixed(0)}%` }] });
      }
      if (st.t - st.emit > 0.1) { st.emit = st.t; setGuide(makeGuide(st.lx, Math.max(gh + 0.55, st.ly), st.lz, st.pad)); onTelemetry({ time: st.t.toFixed(1), alt: alt.toFixed(1), vspeed: st.vy.toFixed(1), fuel: st.fuel.toFixed(0), pad: padDist.toFixed(1), blind: firing && alt < 9 && pressure < 0.05, heat: st.heat }); }
    }

    /* ---------------- drill ---------------- */
    if (scenario === "mining") {
      const on = Boolean(k["Space"] || k["KeyE"] || k["DrillHold"]) && !st.seized;
      if (on) st.started = true;
      if (st.started) st.t += dt;
      if (on && !st.lastDrill) st.pulses += 1;
      st.lastDrill = on;
      // heat: cutting makes heat; air carries it off (only with air); the cold rock conducts some away always
      const gain = on ? 9.0 * rock.hardness : 0;
      const air = (pressure / 1.013) * 0.09 * Math.max(0, st.bit - ambientC);
      const cond = 0.04 * Math.max(0, st.bit - ambientC);
      st.bit = Math.max(ambientC, st.bit + (gain - air - cond) * dt);
      if (on) st.depth = Math.min(DRILL_TARGET_M, st.depth + (dt * 0.14) / rock.hardness);
      const padH = st.pad;
      if (carriageRef.current) { carriageRef.current.position.y = 2.4 - (st.depth / DRILL_TARGET_M) * 1.3; if (on) { carriageRef.current.rotation.y += dt * 20; carriageRef.current.position.x = Math.sin(clock.elapsedTime * 60) * 0.01; } }
      if (bitMat.current) { const hf = THREE.MathUtils.clamp((st.bit - 40) / (DRILL_LIMIT_C - 40), 0, 1); bitMat.current.emissive.setRGB(hf * 1.3, hf * 0.2, 0); }
      if (coreRef.current) { const fill = Math.max(0.03, st.depth / DRILL_TARGET_M); coreRef.current.scale.set(1, fill, 1); coreRef.current.position.y = 0.22 + fill * 0.5; }
      if (chipsRef.current) { chipsRef.current.visible = on; chipsRef.current.rotation.y += dt * 10; }
      if (controls.current) { camera.position.y = Math.max(camera.position.y, sample(grid, relief, camera.position.x, camera.position.z).h + 0.8); controls.current.target.set(0, padH + 1.2, 0); controls.current.update(); }
      const fail = (headline: string, reason: string) => { st.done = true; onComplete({ status: "FAIL", timeSec: +st.t.toFixed(1), headline, reason, numbers: [{ label: "Depth reached", value: `${st.depth.toFixed(2)} m` }, { label: "Bit temperature", value: `${st.bit.toFixed(0)}°C` }, { label: "Drill bursts", value: `${st.pulses}` }] }); };
      if (!rock.dry && st.depth >= 0.45) fail("Bit clogged", "Wet soil packed the flights of a bit designed for dry regolith. This ground cannot stand in for the Moon or Mars.");
      else if (st.bit >= DRILL_LIMIT_C) { st.seized = true; fail("Bit seized", pressure > 0.5 ? `The bit passed ${DRILL_LIMIT_C}°C even with air cooling: this rock is hard. Drill in shorter bursts.` : `No air means almost no cooling at ${pressure} bar. The bit passed ${DRILL_LIMIT_C}°C. Drill in short bursts and let the cold rock draw the heat out between them.`); }
      else if (st.depth >= DRILL_TARGET_M) { st.done = true; onComplete({ status: "PASS", timeSec: +st.t.toFixed(1), headline: "Core recovered", reason: `A ${DRILL_TARGET_M.toFixed(1)} m core of ${rock.label} came up in ${st.t.toFixed(0)} s using ${st.pulses} drill burst${st.pulses === 1 ? "" : "s"}; the bit peaked at ${st.bit.toFixed(0)}°C.`, numbers: [{ label: "Time", value: `${st.t.toFixed(0)} s` }, { label: "Bursts", value: `${st.pulses}` }, { label: "Bit peak", value: `${st.bit.toFixed(0)}°C` }, { label: "Rock", value: rock.label }] }); }
      if (st.t - st.emit > 0.08 || !st.started) { st.emit = st.t; onTelemetry({ time: st.t.toFixed(1), depth: st.depth.toFixed(2), bit: st.bit.toFixed(0), on, rock: rock.label, hardness: rock.hardness.toFixed(2), cooling: pressure > 0.5 ? "air and rock" : "rock only (no air)" }); }
    }
  });

  const padY = grid ? sample(grid, relief, 0, 0).h : 0;
  const bg = body === "moon" ? "#02040a" : body === "mars" ? "#6b3a26" : "#7fb6d9";
  return (
    <>
      <color attach="background" args={[bg]} />
      {body !== "moon" && <fog attach="fog" args={[body === "mars" ? "#8a4a2e" : "#9cc6e0", 34, 125]} />}
      {body === "moon" && <Stars radius={85} depth={30} count={1800} factor={3} fade />}
      <hemisphereLight args={[body === "earth" ? "#dbeafe" : "#f5e6d8", body === "earth" ? "#4a5a3a" : "#3b2a22", body === "moon" ? 0.25 : 0.6]} />
      <directionalLight position={[18, 26, 12]} intensity={body === "moon" ? 2.4 : 1.7} castShadow shadow-mapSize={[1024, 1024]} />

      <Terrain siteId={siteId} grid={grid} reliefM={reliefM} body={body} mineral={mineral} sensor={sensor} roughness={roughness} />
      {(thirdPerson || scenario !== "rover") && <OrbitControls ref={controls as never} makeDefault enablePan={false} minDistance={2.2} maxDistance={55} maxPolarAngle={Math.PI * 0.49} />}

      {scenario === "rover" && (
        <>
          <Rover groupRef={roverRef} wheelRefs={wheels} spec={rover} />
          {path.length > 1 && <Line points={path} color="#38bdf8" lineWidth={2} dashed dashSize={0.6} gapSize={0.35} transparent opacity={0.75} />}
          {route.map((w, i) => <Waypoint key={i} index={i} x={w.x} y={w.y} z={w.z} state={i < waypointIdx ? "done" : i === waypointIdx ? "next" : "later"} />)}
        </>
      )}

      {scenario === "landing" && (
        <>
          <Lander groupRef={landerRef} flameRef={flameRef} />
          <group ref={dustRef} visible={false}>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i * Math.PI) / 4; return <mesh key={i} position={[Math.cos(a) * 0.9, (i % 2) * 0.25, Math.sin(a) * 0.9]}><dodecahedronGeometry args={[0.45, 1]} /><meshStandardMaterial color={body === "mars" ? "#d9a06b" : body === "moon" ? "#9ca3af" : "#cbd5e1"} transparent opacity={0.4} depthWrite={false} /></mesh>; })}</group>
          {/* pad with ring and H marking */}
          <mesh position={[0, padY + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[PAD_RADIUS - 0.5, PAD_RADIUS, 48]} /><meshBasicMaterial color="#34d399" transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} /></mesh>
          <mesh position={[0, padY + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[PAD_RADIUS - 0.5, 48]} /><meshBasicMaterial color="#1f2937" transparent opacity={0.35} depthWrite={false} /></mesh>
          {[[-1.2, 0, 0.3, 2.6], [1.2, 0, 0.3, 2.6], [0, 0, 2.1, 0.3]].map(([x, z, w, h], i) => <mesh key={i} position={[x, padY + 0.06, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[w, h]} /><meshBasicMaterial color="#e5e7eb" depthWrite={false} /></mesh>)}
          {/* descent corridor above the pad */}
          <mesh position={[0, padY + 12, 0]}><cylinderGeometry args={[PAD_RADIUS * 1.6, PAD_RADIUS - 0.5, 24, 32, 1, true]} /><meshBasicMaterial color="#34d399" transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} /></mesh>
          {/* guide curve to the pad, drop line, predicted touchdown */}
          {guide.length > 1 && <Line points={guide} color="#fde68a" lineWidth={1.5} dashed dashSize={0.5} gapSize={0.3} transparent opacity={0.8} />}
          <mesh ref={dropRef}><cylinderGeometry args={[0.015, 0.015, 1, 6]} /><meshBasicMaterial color="#e2e8f0" transparent opacity={0.5} /></mesh>
          <mesh ref={predictRef} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.6, 0.85, 24]} /><meshBasicMaterial color="#fde68a" side={THREE.DoubleSide} depthWrite={false} /></mesh>
        </>
      )}

      {scenario === "mining" && <DrillRig padY={padY} carriageRef={carriageRef} bitMat={bitMat} coreRef={coreRef} chipsRef={chipsRef} body={body} />}
    </>
  );
}

/* =====================================================================================
   The page around the scene
   ===================================================================================== */
const TEST_INFO: Record<ScenarioType, { name: string; icon: typeof Car; goal: string; pass: string[]; fail: string[]; controls: string[] }> = {
  rover: { name: "Rover drive", icon: Car, goal: "Drive through the five numbered waypoints in order. A dotted line on the ground shows the surveyed route.",
    pass: ["Reach all five waypoints (drive inside the ring around each one)", "Finish with some wheel tread left"],
    fail: ["Wheels wear to 0% on sharp rock", "Stuck: wheel slip above 90% for more than 2.5 seconds", "An overheated motor does not fail you, but it slows you to a crawl until it cools"],
    controls: ["W / S or ↑ / ↓ — drive forward / back", "A / D or ← / → — steer", "Drag with the mouse — look around", "Camera button — switch between driver's seat and chase view"] },
  landing: { name: "Lander descent", icon: Rocket, goal: "Bring the lander down onto the pad softly. The yellow ring on the ground shows where you would touch down if the engine cut now.",
    pass: [`Touch down slower than ${LAND_SPEED_LIMIT} m/s`, `Within ${PAD_RADIUS} m of the pad centre`, "On ground flatter than 20°"],
    fail: ["Hard landing: faster than the limit", "Missed the pad", "Tipped over on a slope", "Running out of fuel means you fall"],
    controls: ["Hold SPACE (or the on-screen button) — fire the engine", "W / A / S / D — drift sideways", "Drag with the mouse — orbit the camera"] },
  mining: { name: "Core drill", icon: Drill, goal: `Bring up a ${DRILL_TARGET_M.toFixed(0)} m core without cooking the drill bit. Cutting rock makes heat; air carries heat away on Earth, but in near-vacuum only the cold rock can.`,
    pass: [`Reach ${DRILL_TARGET_M.toFixed(0)} m depth`, `Keep the bit below ${DRILL_LIMIT_C}°C the whole time`],
    fail: [`Bit reaches ${DRILL_LIMIT_C}°C — it seizes`, "Wet soil clogs the bit (that ground is not a planetary analog)"],
    controls: ["Hold SPACE or E (or the on-screen button) — drill", "Release — stop and let the bit cool", "Drag with the mouse — orbit the camera"] },
};

export default function DualSimulator({ matchData, selectedMatch, onBack }: { matchData: MatchPayload; selectedMatch: EarthMatch; onBack: () => void }) {
  const [scenario, setScenario] = useState<ScenarioType>("rover");
  const [side, setSide] = useState<WorldSide>("earth");
  const [sensor, setSensor] = useState<Sensor>("optical");
  const [thirdPerson, setThirdPerson] = useState(true);
  const [roverId, setRoverId] = useState("desert_scout");
  const [runId, setRunId] = useState(1);
  const [briefing, setBriefing] = useState(true);
  const [result, setResult] = useState<RunRecord | null>(null);
  const [grid, setGrid] = useState<number[] | null>(null);
  const [reliefM, setReliefM] = useState(120);
  const [tele, setTele] = useState<Telemetry>({});
  const [runs, setRuns] = useState<Record<WorldSide, Record<ScenarioType, RunRecord | null>>>({ earth: { rover: null, landing: null, mining: null }, space: { rover: null, landing: null, mining: null } });

  const keysRef = useRef<Record<string, boolean>>({});
  const lookRef = useRef({ yaw: 0, pitch: 0 });
  const drag = useRef(false), last = useRef({ x: 0, y: 0 });

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
    fetch(`http://127.0.0.1:8000${url}`).then((r) => r.json()).then((j) => { if (live) { setGrid(j.data); setReliefM(j.relief_m || 120); } }).catch((e) => console.error("heightmap", e));
    return () => { live = false; };
  }, [url]);

  const restart = useCallback(() => { setResult(null); setBriefing(true); setTele({}); setRunId((r) => r + 1); }, []);
  const changeScenario = (v: ScenarioType) => { setScenario(v); restart(); };
  const changeSide = (v: WorldSide) => { setSide(v); restart(); };
  const changeRover = (v: string) => { setRoverId(v); restart(); };

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
  const info = TEST_INFO[scenario];
  const Icon = info.icon;
  const onComplete = useCallback((r: RunRecord) => { setResult(r); setRuns((prev) => ({ ...prev, [side]: { ...prev[side], [scenario]: r } })); }, [side, scenario]);
  const other: WorldSide = side === "earth" ? "space" : "earth";
  const otherName = side === "earth" ? (t.body === "moon" ? "the Moon" : "Mars") : "Earth";

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
        <div className="seg" data-tour="sim-test">
          {(Object.keys(TEST_INFO) as ScenarioType[]).map((id) => { const I = TEST_INFO[id].icon; return <button key={id} type="button" aria-pressed={scenario === id} onClick={() => changeScenario(id)}><I className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />{TEST_INFO[id].name}</button>; })}
        </div>
        <div className="flex items-center gap-2">
          <div className="seg" title="How the terrain is shown">
            {([["optical", "Camera"], ["sar", "Radar"], ["thermal", "Heat"]] as [Sensor, string][]).map(([m, l]) => <button key={m} type="button" aria-pressed={sensor === m} onClick={() => setSensor(m)}>{l}</button>)}
          </div>
          {scenario === "rover" && <button type="button" className="btn btn-sm" onClick={() => { lookRef.current = { yaw: 0, pitch: 0 }; setThirdPerson((v) => !v); }}><Eye className="w-3.5 h-3.5" /> {thirdPerson ? "Chase camera" : "Driver's seat"}</button>}
          <button type="button" className="btn btn-sm" onClick={restart}><RotateCcw className="w-3.5 h-3.5" /> Restart</button>
        </div>
      </div>

      {scenario === "rover" && (
        <div className="card p-3">
          <div className="flex items-center justify-between text-xs mb-2"><span className="font-semibold">Choose a rover</span><span className="muted">Cheaper is not worse on Earth; it is on {t.body === "moon" ? "the Moon" : "Mars"}.</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {ROVERS.map((r) => (
              <button key={r.id} type="button" onClick={() => changeRover(r.id)} className="row relative" aria-pressed={r.id === roverId} title={r.note}>
                {r.bestFor === body && <span className="absolute -top-2 right-2 status status-good">suits {body}</span>}
                <div className="flex items-center justify-between text-xs font-semibold"><span className="truncate pr-1">{r.name}</span><span className="font-mono muted">${r.costM}M</span></div>
                <div className="text-[11px] muted mt-0.5 truncate">{r.wheels}</div>
                <div className="text-[11px] font-mono muted mt-0.5">motor limit {r.maxTempC}°C · wheel strength {r.armor}×</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-hidden relative w-full h-[60vh] min-h-[460px]"
        onPointerDown={(e) => { if (!thirdPerson && scenario === "rover") { drag.current = true; last.current = { x: e.clientX, y: e.clientY }; } }}
        onPointerMove={(e) => { if (drag.current) { const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y; last.current = { x: e.clientX, y: e.clientY }; lookRef.current.yaw -= dx * 0.005; lookRef.current.pitch = THREE.MathUtils.clamp(lookRef.current.pitch - dy * 0.004, -0.7, 0.7); } }}
        onPointerUp={() => { drag.current = false; }} onPointerLeave={() => { drag.current = false; }}>

        {/* live readings */}
        <div className="absolute top-3 left-3 z-10 on-canvas px-3.5 py-2.5 text-xs flex flex-wrap gap-x-5 gap-y-1 pointer-events-none" data-tour="sim-hud">
          <span>Time <b>{tele.time || "0.0"} s</b></span>
          {scenario === "rover" && (<>
            <span>Waypoint <b>{Math.min(Number(tele.wp ?? 0) + 1, WAYPOINTS)} of {WAYPOINTS}</b>{tele.dist ? <span className="opacity-80"> · {tele.dist} m ahead</span> : null}</span>
            <span>Speed <b>{tele.speed || "0.0"} m/s</b></span>
            <span>Wheels <b style={{ color: Number(tele.wheel ?? 100) < 35 ? "#fca5a5" : "#86efac" }}>{tele.wheel ?? 100}%</b></span>
            <span>Slip <b style={{ color: Number(tele.slip ?? 0) > 60 ? "#fca5a5" : undefined }}>{tele.slip ?? 4}%</b></span>
            <span>Motor <b style={{ color: tele.hot ? "#fca5a5" : undefined }}>{tele.motor ?? 30}°C</b><span className="opacity-80"> / {rover.maxTempC}°C</span></span>
            <span>Slope <b>{tele.slope ?? 0}°</b></span>
          </>)}
          {scenario === "landing" && (<>
            <span>Height <b>{tele.alt ?? "22.0"} m</b></span>
            <span>Falling at <b style={{ color: Number(tele.vspeed ?? 0) < -LAND_SPEED_LIMIT ? "#fca5a5" : "#86efac" }}>{Math.abs(Number(tele.vspeed ?? 0)).toFixed(1)} m/s</b><span className="opacity-80"> (limit {LAND_SPEED_LIMIT})</span></span>
            <span>Fuel <b>{tele.fuel ?? 100}%</b></span>
            <span>Pad <b>{tele.pad ?? "10.4"} m</b> away</span>
          </>)}
          {scenario === "mining" && (<>
            <span>Depth <b>{tele.depth ?? "0.00"} / {DRILL_TARGET_M.toFixed(2)} m</b></span>
            <span>Bit <b style={{ color: Number(tele.bit ?? 0) > DRILL_LIMIT_C * 0.85 ? "#fca5a5" : "#86efac" }}>{tele.bit ?? Math.round(ambient)}°C</b><span className="opacity-80"> / {DRILL_LIMIT_C}°C</span></span>
            <span>Rock <b>{String(tele.rock ?? "")}</b></span>
            <span>Cooling <b>{String(tele.cooling ?? (pressure > 0.5 ? "air and rock" : "rock only (no air)"))}</b></span>
          </>)}
        </div>

        {scenario === "mining" && !briefing && !result && (
          <div className="absolute top-3 right-3 z-10 on-canvas px-3 py-2 text-xs w-56 pointer-events-none">
            <div className="flex justify-between"><span>Bit heat</span><span className="font-mono">{tele.bit ?? Math.round(ambient)}°C</span></div>
            <div className="bar mt-1"><span style={{ width: `${Math.min(100, Math.max(0, ((Number(tele.bit ?? ambient) - ambient) / (DRILL_LIMIT_C - ambient)) * 100))}%`, background: Number(tele.bit ?? 0) > DRILL_LIMIT_C * 0.85 ? "#f87171" : "#fbbf24" }} /></div>
            <div className="flex justify-between mt-2"><span>Depth</span><span className="font-mono">{tele.depth ?? "0.00"} m</span></div>
            <div className="bar mt-1"><span style={{ width: `${(Number(tele.depth ?? 0) / DRILL_TARGET_M) * 100}%`, background: "#67e8f9" }} /></div>
            <div className="mt-2 opacity-80">{tele.on ? "Drilling…" : "Released: cooling"}</div>
          </div>
        )}
        {scenario === "rover" && !briefing && !result && (
          <div className="absolute top-3 right-3 z-10 on-canvas px-3 py-2 flex items-center gap-2 pointer-events-none">
            <span className="text-[11px]">next waypoint</span>
            <div className="text-xl font-bold" style={{ transform: `rotate(${Number(tele.bearing ?? 0)}deg)` }}>↑</div>
          </div>
        )}
        {scenario === "rover" && tele.hot && !result && !briefing && <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 on-canvas px-4 py-1.5 text-xs" style={{ borderColor: "#f87171" }}>Motor over {rover.maxTempC}°C: crawling until it cools. Ease off or pick a rover with bigger radiators.</div>}
        {scenario === "landing" && tele.blind && !result && !briefing && <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center" style={{ background: "rgba(120, 70, 30, 0.35)", backdropFilter: "blur(2px)" }}><div className="on-canvas px-4 py-1.5 text-xs">Dust blind-out: the engine is lifting regolith with no air to stop it.</div></div>}

        {/* on-screen controls */}
        <div className="absolute bottom-3 left-3 z-10 on-canvas px-3.5 py-2 text-xs flex items-center gap-3">
          {scenario === "rover" && <span><b>W A S D</b> drive · drag to look</span>}
          {scenario === "landing" && (<><span>Hold <b>SPACE</b> to fire · <b>W A S D</b> to drift</span>
            <button type="button" className="btn btn-sm btn-primary" onPointerDown={() => (keysRef.current["ThrustHold"] = true)} onPointerUp={() => (keysRef.current["ThrustHold"] = false)} onPointerLeave={() => (keysRef.current["ThrustHold"] = false)}>Hold to fire</button></>)}
          {scenario === "mining" && (<><span>Hold <b>SPACE</b> or <b>E</b> to drill · release to cool</span>
            <button type="button" className="btn btn-sm btn-primary" onPointerDown={() => (keysRef.current["DrillHold"] = true)} onPointerUp={() => (keysRef.current["DrillHold"] = false)} onPointerLeave={() => (keysRef.current["DrillHold"] = false)}>Hold to drill</button></>)}
        </div>

        {/* briefing before every run */}
        {briefing && !result && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-4" style={{ background: "rgba(3, 6, 11, 0.55)", backdropFilter: "blur(3px)" }}>
            <div className="card-solid p-6 max-w-2xl w-full rise" data-tour="sim-briefing">
              <div className="flex items-center gap-2 text-xs muted"><Icon className="w-4 h-4" /> {info.name} · on {worldLabel} · {gravity} m/s² · {pressure} bar</div>
              <h3 className="text-lg font-semibold mt-1">{info.goal}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-xs">
                <div><div className="font-semibold mb-1.5" style={{ color: "var(--good)" }}>You pass if</div><ul className="flex flex-col gap-1">{info.pass.map((x) => <li key={x}>• {x}</li>)}</ul></div>
                <div><div className="font-semibold mb-1.5" style={{ color: "var(--bad)" }}>You fail if</div><ul className="flex flex-col gap-1">{info.fail.map((x) => <li key={x}>• {x}</li>)}</ul></div>
                <div><div className="font-semibold mb-1.5">Controls</div><ul className="flex flex-col gap-1">{info.controls.map((x) => <li key={x}>• {x}</li>)}</ul></div>
              </div>
              {side === "space" && <p className="text-xs muted mt-4">Same test, different world: gravity is {(gravity / 9.81 * 100).toFixed(0)}% of Earth&apos;s, air pressure is {pressure} bar, and the ground here averages {ambient.toFixed(0)}°C.</p>}
              <div className="flex items-center justify-between mt-5">
                <span className="text-xs muted">{grid ? "Terrain loaded from the site's elevation data." : "Loading terrain…"}</span>
                <button type="button" className="btn btn-primary" disabled={!grid} onClick={() => setBriefing(false)}><Play className="w-4 h-4" /> Start</button>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-4" style={{ background: "rgba(3, 6, 11, 0.55)", backdropFilter: "blur(3px)" }}>
            <div className="card-solid p-6 max-w-md w-full text-center rise">
              <Status level={result.status === "PASS" ? "good" : "bad"}>{result.status === "PASS" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} {result.status === "PASS" ? "Passed" : "Failed"} on {worldLabel}</Status>
              <h3 className="text-xl font-semibold mt-3">{result.headline}</h3>
              <p className="text-sm muted mt-2">{result.reason}</p>
              <div className="grid grid-cols-2 gap-2 mt-4 text-left">{result.numbers.map((n) => <div key={n.label} className="card p-2.5"><div className="text-[11px] muted">{n.label}</div><div className="text-sm font-semibold">{n.value}</div></div>)}</div>
              <div className="flex gap-2 justify-center mt-5">
                <button type="button" onClick={restart} className="btn">Try again here</button>
                <button type="button" onClick={() => changeSide(other)} className="btn btn-primary">Now try it on {otherName} →</button>
              </div>
            </div>
          </div>
        )}

        <div className="w-full h-full cursor-grab active:cursor-grabbing">
          <Canvas shadows camera={{ fov: 58, near: 0.1, far: 170 }} dpr={[1, 1.75]}>
            <SimScene siteId={side === "earth" ? selectedMatch.id : t.id} body={body} gravity={gravity} pressure={pressure} mineral={mineral} iron={iron} clay={clay} bareness={bare} ambientC={ambient}
              roughness={selectedMatch.pillar_scores.radar} grid={grid} reliefM={reliefM} scenario={scenario} sensor={sensor} rover={rover} keysRef={keysRef} lookRef={lookRef} thirdPerson={thirdPerson}
              runId={runId} paused={briefing || Boolean(result)} waypointIdx={Number(tele.wp ?? 0)} onTelemetry={setTele} onComplete={onComplete} />
          </Canvas>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-tour="sim-results">
        {(["earth", "space"] as WorldSide[]).map((w) => { const r = runs[w][scenario]; const name = w === "earth" ? selectedMatch.name : t.name; return (
          <div key={w} className="card p-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] muted">{w === "earth" ? "Earth" : t.body === "moon" ? "Moon" : "Mars"} · {name}</div>
              <div className="text-sm font-medium mt-0.5 truncate">{r ? `${r.headline} · ${r.timeSec} s` : w === side ? "Not run yet." : `Switch to ${w === "earth" ? "Earth" : otherName} to run it there.`}</div>
            </div>
            {r && <Status level={r.status === "PASS" ? "good" : "bad"}>{r.status === "PASS" ? "Passed" : "Failed"}</Status>}
          </div>
        ); })}
      </div>
      {runs.earth[scenario] && runs.space[scenario] && runs.earth[scenario]!.status !== runs.space[scenario]!.status && (
        <p className="text-xs muted px-1">Different outcomes on the two worlds: this is the part an Earth test cannot show you on its own. {t.body === "moon" ? "On the Moon" : "On Mars"} the differences are gravity ({t.gravity} vs 9.81 m/s²), air ({t.pressure_bar} vs 1.013 bar) and temperature.</p>
      )}
    </div>
  );
}
