"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import {
  ArrowLeft,
  RotateCcw,
  Layers,
  Car,
  Rocket,
  Drill,
  CheckCircle2,
  XCircle,
  Gauge,
  Thermometer,
  Clock,
  Eye,
  Info,
  Sparkles,
  ShieldCheck,
  Zap,
  Wind,
} from "lucide-react";
import type { EarthMatch, MatchPayload } from "@/components/AnalyticsView";

type ScenarioType = "rover" | "landing" | "mining";
type WorldSide = "earth" | "space";

interface RunRecord {
  status: "PASS" | "FAIL";
  timeSec: number;
  metricLabel: string;
  reason: string;
  telemetryLog?: {
    peakSlip?: number;
    minWheel?: number;
    peakTemp?: number;
    touchSpeed?: number;
    fuelRemaining?: number;
    avgNormalN?: number;
  };
}

interface RoverSpec {
  id: string;
  name: string;
  costM: number;
  wheelMaterial: string;
  maxTempC: number;
  radiatorCooling: number;
  wheelArmor: number;
  topSpeed: number;
  slopeGrip: number;
  recommendedFor?: "earth" | "mars" | "moon";
}

const ROVER_CATALOG: RoverSpec[] = [
  {
    id: "budget_buggy",
    name: "Budget Earth Buggy",
    costM: 18,
    wheelMaterial: "Rubber Alloy",
    maxTempC: 112,
    radiatorCooling: 0.04,
    wheelArmor: 0.26,
    topSpeed: 9.2,
    slopeGrip: 0.65,
  },
  {
    id: "desert_scout",
    name: "Desert Basalt Explorer",
    costM: 48,
    wheelMaterial: "Aluminum Treads",
    maxTempC: 140,
    radiatorCooling: 0.22,
    wheelArmor: 0.55,
    topSpeed: 8.8,
    slopeGrip: 0.85,
    recommendedFor: "earth",
  },
  {
    id: "micro_hopper",
    name: "Ultra-Light Micro-Scout",
    costM: 95,
    wheelMaterial: "Thin Titanium Mesh",
    maxTempC: 152,
    radiatorCooling: 0.42,
    wheelArmor: 0.68,
    topSpeed: 11.2,
    slopeGrip: 0.82,
  },
  {
    id: "mars_perseverance",
    name: "Mars Perseverance-Class",
    costM: 145,
    wheelMaterial: "Machined Titanium + MMRTG",
    maxTempC: 185,
    radiatorCooling: 0.82,
    wheelArmor: 1.45,
    topSpeed: 8.2,
    slopeGrip: 0.95,
    recommendedFor: "mars",
  },
  {
    id: "lunar_cryo",
    name: "Lunar Cryo-Scout",
    costM: 195,
    wheelMaterial: "NiTi Shape-Memory + Radiator",
    maxTempC: 205,
    radiatorCooling: 1.05,
    wheelArmor: 1.85,
    topSpeed: 8.4,
    slopeGrip: 1.05,
    recommendedFor: "moon",
  },
  {
    id: "heavy_isru",
    name: "Heavy ISRU 6WD Hauler",
    costM: 280,
    wheelMaterial: "Armored Steel Crawler",
    maxTempC: 225,
    radiatorCooling: 1.25,
    wheelArmor: 2.5,
    topSpeed: 6.4,
    slopeGrip: 1.15,
  },
];

const WORLD_SIZE = 60;
const VEHICLE_MASS_KG = 650;

function hashString(str?: string): number {
  if (!str) return 777;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function applyTerrainShaping(grid: number[], wx: number, wz: number, rawHNorm: number): number {
  if (!grid || grid.length !== 128 * 128) return rawHNorm;
  let shaped = rawHNorm;

  const distCenter = Math.hypot(wx, wz);
  if (distCenter < 7.5) {
    const centerH = grid[64 * 128 + 64] || 0;
    const t = THREE.MathUtils.smoothstep(distCenter, 3.8, 7.5);
    shaped = THREE.MathUtils.lerp(centerH, shaped, t);
  }

  const maxEdge = Math.max(Math.abs(wx), Math.abs(wz));
  if (maxEdge > WORLD_SIZE / 2 - 4.0) {
    const edgeT = THREE.MathUtils.smoothstep(maxEdge, WORLD_SIZE / 2 - 4.0, WORLD_SIZE / 2);
    shaped = THREE.MathUtils.lerp(shaped, 0.0, edgeT);
  }
  return shaped;
}

function sampleBilinear(grid: number[], reliefScale: number, wx: number, wz: number): { h: number; slopeDeg: number } {
  if (!grid || grid.length !== 128 * 128) return { h: 0, slopeDeg: 0 };
  if (Math.abs(wx) > WORLD_SIZE / 2 || Math.abs(wz) > WORLD_SIZE / 2) {
    return { h: 0, slopeDeg: 0 };
  }

  const u = THREE.MathUtils.clamp((wx + WORLD_SIZE / 2) / WORLD_SIZE, 0, 1) * 127;
  const v = THREE.MathUtils.clamp((wz + WORLD_SIZE / 2) / WORLD_SIZE, 0, 1) * 127;

  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = Math.min(127, x0 + 1);
  const y1 = Math.min(127, y0 + 1);
  const tx = u - x0;
  const ty = v - y0;

  const h00 = grid[y0 * 128 + x0] || 0;
  const h10 = grid[y0 * 128 + x1] || 0;
  const h01 = grid[y1 * 128 + x0] || 0;
  const h11 = grid[y1 * 128 + x1] || 0;

  const hx0 = h00 * (1 - tx) + h10 * tx;
  const hx1 = h01 * (1 - tx) + h11 * tx;
  const rawNorm = hx0 * (1 - ty) + hx1 * ty;
  const hNorm = applyTerrainShaping(grid, wx, wz, rawNorm);

  const dhdx = (h10 - h00) * reliefScale;
  const dhdz = (h01 - h00) * reliefScale;
  const cellWorld = WORLD_SIZE / 127;
  const grad = Math.sqrt(dhdx * dhdx + dhdz * dhdz) / cellWorld;
  const slopeDeg = THREE.MathUtils.radToDeg(Math.atan(grad));

  return { h: hNorm * reliefScale, slopeDeg };
}

function StrutBetween({
  start,
  end,
  radius = 0.045,
  color = "#94a3b8",
}: {
  start: [number, number, number];
  end: [number, number, number];
  radius?: number;
  color?: string;
}) {
  const { mid, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const dir = b.clone().sub(a);
    const l = dir.length();
    const m = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return { mid: m, quat: q, len: l };
  }, [start, end]);

  return (
    <mesh position={mid} quaternion={quat}>
      <cylinderGeometry args={[radius, radius, len, 10]} />
      <meshStandardMaterial color={color} metalness={0.65} roughness={0.3} />
    </mesh>
  );
}

function RealisticTerrain({
  siteId,
  elevData,
  reliefM,
  bodyType,
  mineralProfile,
  sensorMode,
  radarRoughness,
  plumeHeat,
  plumePos,
}: {
  siteId: string;
  elevData: number[] | null;
  reliefM: number;
  bodyType: "earth" | "moon" | "mars";
  mineralProfile: string;
  sensorMode: "optical" | "sar" | "thermal";
  radarRoughness: number;
  plumeHeat: number;
  plumePos: [number, number];
}) {
  const reliefScale = Math.max(0.8, reliefM / 36.0);

  const { cLow, cMid, cRock } = useMemo(() => {
    const low = new THREE.Color();
    const mid = new THREE.Color();
    const rock = new THREE.Color();

    if (sensorMode === "sar") {
      low.set("#0f172a");
      mid.set("#0891b2");
      rock.set("#22d3ee");
    } else if (sensorMode === "thermal") {
      low.set(bodyType === "earth" ? "#c2410c" : "#1e3a8a");
      mid.set(bodyType === "earth" ? "#ea580c" : "#2563eb");
      rock.set(bodyType === "earth" ? "#facc15" : "#60a5fa");
    } else if (bodyType === "moon") {
      low.set("#475569");
      mid.set("#64748b");
      rock.set("#94a3b8");
    } else if (bodyType === "mars") {
      if (mineralProfile === "basalt_ice") {
        low.set("#7c2d12");
        mid.set("#9a3412");
        rock.set("#cbd5e1");
      } else {
        low.set("#7c2d12");
        mid.set("#c2410c");
        rock.set("#451a03");
      }
    } else {
      if (mineralProfile === "biomass_wet") {
        low.set("#14532d");
        mid.set("#166534");
        rock.set("#3f6212");
      } else if (mineralProfile === "evaporite_sulfate") {
        low.set("#e7e5e4");
        mid.set("#d6d3d1");
        rock.set("#78716c");
      } else if (mineralProfile === "mare_basalt" || mineralProfile === "basalt_anorthosite") {
        low.set("#1c1917");
        mid.set("#292524");
        rock.set("#57534e");
      } else if (mineralProfile === "basalt_ice") {
        low.set("#cbd5e1");
        mid.set("#64748b");
        rock.set("#334155");
      } else {
        low.set("#a18056");
        mid.set("#c29b6b");
        rock.set("#6b5544");
      }
    }
    return { cLow: low, cMid: mid, cRock: rock };
  }, [bodyType, mineralProfile, sensorMode]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 127, 127);
    geo.rotateX(-Math.PI / 2);

    if (!elevData || elevData.length !== 128 * 128) return geo;

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      const hNorm = applyTerrainShaping(elevData, wx, wz, elevData[i] || 0);
      pos.setY(i, hNorm * reliefScale);
    }
    geo.computeVertexNormals();

    const normals = geo.attributes.normal;
    const tmp = new THREE.Color();
    const hotColor = new THREE.Color("#fef08a");

    for (let i = 0; i < pos.count; i++) {
      const hNorm = elevData[i] || 0;
      const ny = normals.getY(i);
      const steepness = THREE.MathUtils.clamp((1 - ny) * 4.5, 0, 1);

      tmp.copy(cLow).lerp(cMid, hNorm);
      tmp.lerp(cRock, steepness * (sensorMode === "sar" ? 1.0 : 0.85));

      if (sensorMode === "thermal" && plumeHeat > 0.02) {
        const wx = pos.getX(i);
        const wz = pos.getZ(i);
        const d = Math.hypot(wx - plumePos[0], wz - plumePos[1]);
        if (d < 7.5) {
          const heatMix = plumeHeat * (1 - d / 7.5);
          tmp.lerp(hotColor, THREE.MathUtils.clamp(heatMix, 0, 1));
        }
      }

      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [elevData, reliefScale, cLow, cMid, cRock, sensorMode, plumeHeat, plumePos]);

  const bouldersRef = useRef<THREE.InstancedMesh>(null);
  const boulderCount = Math.round(50 + radarRoughness * 140);

  useEffect(() => {
    if (!bouldersRef.current || !elevData || elevData.length !== 128 * 128) return;
    const dummy = new THREE.Object3D();
    let seed = hashString(siteId);
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let i = 0; i < boulderCount; i++) {
      const wx = (rand() - 0.5) * (WORLD_SIZE - 9);
      const wz = (rand() - 0.5) * (WORLD_SIZE - 9);
      if (Math.hypot(wx, wz) < 5.2) {
        dummy.scale.set(0, 0, 0);
      } else {
        const { h } = sampleBilinear(elevData, reliefScale, wx, wz);
        const s = 0.12 + rand() * 0.35;
        dummy.position.set(wx, h + s * 0.35, wz);
        dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        dummy.scale.set(s * (0.8 + rand() * 0.6), s * 0.7, s * (0.8 + rand() * 0.6));
      }
      dummy.updateMatrix();
      bouldersRef.current.setMatrixAt(i, dummy.matrix);
    }
    bouldersRef.current.instanceMatrix.needsUpdate = true;
  }, [siteId, elevData, reliefScale, boulderCount]);

  const skirtColor = useMemo(() => cLow, [cLow]);
  const half = WORLD_SIZE / 2;
  const ext = 160;

  return (
    <group>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial
          vertexColors
          wireframe={sensorMode === "sar"}
          roughness={sensorMode === "sar" ? 0.3 : 0.92}
          metalness={0.05}
        />
      </mesh>

      <mesh position={[0, 0, -(half + ext / 2)]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[WORLD_SIZE + ext * 2, ext]} />
        <meshStandardMaterial color={skirtColor} wireframe={sensorMode === "sar"} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0, half + ext / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[WORLD_SIZE + ext * 2, ext]} />
        <meshStandardMaterial color={skirtColor} wireframe={sensorMode === "sar"} roughness={0.95} />
      </mesh>
      <mesh position={[-(half + ext / 2), 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ext, WORLD_SIZE]} />
        <meshStandardMaterial color={skirtColor} wireframe={sensorMode === "sar"} roughness={0.95} />
      </mesh>
      <mesh position={[half + ext / 2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ext, WORLD_SIZE]} />
        <meshStandardMaterial color={skirtColor} wireframe={sensorMode === "sar"} roughness={0.95} />
      </mesh>

      <instancedMesh ref={bouldersRef} args={[undefined, undefined, boulderCount]}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color={bodyType === "mars" ? "#7c2d12" : bodyType === "moon" ? "#64748b" : "#57534e"}
          roughness={0.95}
        />
      </instancedMesh>
    </group>
  );
}

function FirstPersonScene({
  siteId,
  worldSide,
  bodyType,
  gravity,
  pressureBar,
  mineralProfile,
  ironRatio,
  clayRatio,
  bareness,
  ambientTempC,
  radarRoughness,
  elevData,
  reliefM,
  scenario,
  sensorMode,
  roverSpec,
  keysRef,
  lookOffsetRef,
  thirdPersonCam,
  runId,
  isModalOpen,
  onTelemetry,
  onComplete,
}: {
  siteId: string;
  worldSide: WorldSide;
  bodyType: "earth" | "moon" | "mars";
  gravity: number;
  pressureBar: number;
  mineralProfile: string;
  ironRatio: number;
  clayRatio: number;
  bareness: number;
  ambientTempC: number;
  radarRoughness: number;
  elevData: number[] | null;
  reliefM: number;
  scenario: ScenarioType;
  sensorMode: "optical" | "sar" | "thermal";
  roverSpec: RoverSpec;
  keysRef: React.MutableRefObject<Record<string, boolean>>;
  lookOffsetRef: React.MutableRefObject<{ yaw: number; pitch: number }>;
  thirdPersonCam: boolean;
  runId: number;
  isModalOpen: boolean;
  onTelemetry: (t: any) => void;
  onComplete: (res: RunRecord) => void;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const reliefScale = Math.max(0.8, reliefM / 36.0);

  const [plumeHeat, setPlumeHeat] = useState(0);
  const [plumePos, setPlumePos] = useState<[number, number]>([0, 0]);

  const beacons = useMemo(() => {
    if (!elevData) return [];
    const s = hashString(siteId);
    const offset1 = ((s % 11) - 5) * 1.1;
    const offset2 = (((s >> 3) % 13) - 6) * 1.2;
    const pts = [
      { x: offset1, z: -5 },
      { x: 9 + offset2 * 0.4, z: -14 },
      { x: -8 + offset1 * 0.5, z: -21 },
    ];
    return pts.map((p) => ({
      x: p.x,
      z: p.z,
      y: sampleBilinear(elevData, reliefScale, p.x, p.z).h,
    }));
  }, [siteId, elevData, reliefScale]);

  const roverGroupRef = useRef<THREE.Group>(null);
  const wheelRefs = useRef<(THREE.Mesh | null)[]>([]);

  const landerGroupRef = useRef<THREE.Group>(null);
  const flameRef = useRef<THREE.Group>(null);
  const smokeGroupRef = useRef<THREE.Group>(null);
  const plumeRingRef = useRef<THREE.Mesh>(null);
  const thermalGlowRef = useRef<THREE.Mesh>(null);

  const augerRef = useRef<THREE.Group>(null);
  const bitGlowRef = useRef<THREE.MeshStandardMaterial>(null);
  const coreTubeRef = useRef<THREE.Mesh>(null);
  const chipsRef = useRef<THREE.Group>(null);

  const prevFocusRef = useRef(new THREE.Vector3(0, 0, 0));

  const simRef = useRef({
    finished: false,
    started: false,
    elapsed: 0,
    rx: 0,
    rz: 12,
    yaw: 0,
    speed: 0,
    wheelHealth: 100,
    motorTemp: 30,
    overheated: false,
    beaconIdx: 0,
    lx: 3,
    lz: 10,
    ly: 26,
    vx: 0,
    vy: 0,
    vz: 0,
    fuel: 100,
    groundHeat: 0,
    depth: 0,
    drillTemp: 30,
    seized: false,
    lastUiEmit: 0,
    peakSlip: 0,
    normalAccum: 0,
    normalCount: 0,
  });

  const rockStats = useMemo(() => {
    if (bareness < 0.25) {
      return { label: "Waterlogged Mud / Biomass", hardness: 0.55, heatMult: 0.4, canExtractDryCore: false };
    }
    const hardness = THREE.MathUtils.clamp(0.75 + ironRatio * 0.45 - clayRatio * 0.35, 0.55, 1.65);
    const label = mineralProfile.replace(/_/g, " ").toUpperCase();
    return { label, hardness, heatMult: hardness, canExtractDryCore: true };
  }, [bareness, ironRatio, clayRatio, mineralProfile]);

  useEffect(() => {
    const padH = elevData ? sampleBilinear(elevData, reliefScale, 0, 0).h : 0;
    const startTemp = THREE.MathUtils.clamp(ambientTempC, -35, 45);
    setPlumeHeat(0);
    lookOffsetRef.current = { yaw: 0, pitch: 0 };

    simRef.current = {
      finished: false,
      started: false,
      elapsed: 0,
      rx: 0,
      rz: 14,
      yaw: 0,
      speed: 0,
      wheelHealth: 100,
      motorTemp: startTemp,
      overheated: false,
      beaconIdx: 0,
      lx: 3,
      lz: 10,
      ly: padH + 20,
      vx: 0,
      vy: -0.6,
      vz: 0,
      fuel: 100,
      groundHeat: 0,
      depth: 0,
      drillTemp: startTemp,
      seized: false,
      lastUiEmit: 0,
      peakSlip: 0,
      normalAccum: 0,
      normalCount: 0,
    };

    if (scenario === "rover") {
      const startH = elevData ? sampleBilinear(elevData, reliefScale, 0, 14).h : 0;
      prevFocusRef.current.set(0, startH + 0.4, 14);
      if (thirdPersonCam) {
        camera.position.set(0, startH + 3.0, 20.5);
        if (controlsRef.current) {
          controlsRef.current.target.set(0, startH + 0.4, 14);
          controlsRef.current.update();
        }
      }
    } else if (scenario === "landing") {
      prevFocusRef.current.set(3, padH + 20, 10);
      if (thirdPersonCam) {
        camera.position.set(11, padH + 25, 21);
        if (controlsRef.current) {
          controlsRef.current.target.set(3, padH + 20, 10);
          controlsRef.current.update();
        }
      }
    } else {
      prevFocusRef.current.set(0, padH + 0.85, 0);
      if (thirdPersonCam) {
        camera.position.set(3.2, padH + 2.4, 3.8);
        if (controlsRef.current) {
          controlsRef.current.target.set(0, padH + 0.85, 0);
          controlsRef.current.update();
        }
      }
    }
  }, [siteId, worldSide, scenario, roverSpec.id, runId, elevData, reliefScale, ambientTempC, thirdPersonCam, camera, lookOffsetRef]);

  useFrame(({ clock }, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const s = simRef.current;
    const k = keysRef.current;
    if (!elevData || elevData.length !== 128 * 128 || isModalOpen) return;

    if (scenario === "rover") {
      const forward = (k["KeyW"] || k["ArrowUp"] ? 1 : 0) - (k["KeyS"] || k["ArrowDown"] ? 1 : 0);
      const steer = (k["KeyA"] || k["ArrowLeft"] ? 1 : 0) - (k["KeyD"] || k["ArrowRight"] ? 1 : 0);

      if (!s.finished) {
        if (forward !== 0 || steer !== 0) s.started = true;
        if (s.started) s.elapsed += dt;

        const { slopeDeg } = sampleBilinear(elevData, reliefScale, s.rx, s.rz);
        const slopeRad = THREE.MathUtils.degToRad(slopeDeg);

        const normalForceN = VEHICLE_MASS_KG * gravity * Math.cos(slopeRad);
        s.normalAccum += normalForceN;
        s.normalCount += 1;

        const steerRate = (bodyType === "earth" ? 1.85 : bodyType === "mars" ? 1.45 : 1.2) * roverSpec.slopeGrip;
        s.yaw += steer * steerRate * dt;

        const frictionMu = (bodyType === "earth" ? 0.75 : bodyType === "mars" ? 0.58 : 0.44) * roverSpec.slopeGrip;
        const gripLimitN = frictionMu * normalForceN;
        const tractionDemandN = VEHICLE_MASS_KG * gravity * Math.sin(slopeRad) + (forward !== 0 ? 1150 : 250);
        const slipRatio = Math.min(1.0, Math.max(0.04, tractionDemandN / (gripLimitN + 1e-4) * 0.42));
        const slipPct = Math.round(slipRatio * 100);
        s.peakSlip = Math.max(s.peakSlip, slipPct);

        const envGrip = bodyType === "earth" ? 1.0 : bodyType === "mars" ? 0.78 : 0.62;
        const slopePenalty = Math.max(0, (slopeDeg - 12) * 0.028) / (envGrip * roverSpec.slopeGrip);
        const maxSpd = s.overheated ? roverSpec.topSpeed * 0.22 : roverSpec.topSpeed;

        if (forward !== 0) {
          s.speed = THREE.MathUtils.lerp(s.speed, forward * maxSpd * Math.max(0.3, 1 - slopePenalty), dt * 3.5);
        } else {
          s.speed = THREE.MathUtils.lerp(s.speed, 0, dt * 4.0);
        }

        s.rx = THREE.MathUtils.clamp(s.rx - Math.sin(s.yaw) * s.speed * dt, -26, 26);
        s.rz = THREE.MathUtils.clamp(s.rz - Math.cos(s.yaw) * s.speed * dt, -26, 26);

        const speedAbs = Math.abs(s.speed);
        const envAbrasion = bodyType === "earth" ? 0.45 : 1.25;
        const wearRate = (speedAbs * envAbrasion * rockStats.hardness * (0.7 + radarRoughness * 0.5)) / roverSpec.wheelArmor;
        s.wheelHealth = Math.max(0, s.wheelHealth - wearRate * dt * 0.65);

        const heatGen = (speedAbs * 2.1 + slopeDeg * 0.42) * (forward !== 0 ? 1 : 0.05);
        const airCool = (pressureBar / 1.013) * Math.max(0, s.motorTemp - ambientTempC) * 0.42;
        const radiatorCool = roverSpec.radiatorCooling * Math.max(0, s.motorTemp - ambientTempC) * 0.28;
        s.motorTemp = Math.max(ambientTempC, s.motorTemp + (heatGen - airCool - radiatorCool) * dt * 2.0);

        if (s.motorTemp >= roverSpec.maxTempC) s.overheated = true;
        if (s.overheated && s.motorTemp < roverSpec.maxTempC * 0.78) s.overheated = false;

        if (s.wheelHealth <= 0) {
          s.finished = true;
          onComplete({
            status: "FAIL",
            timeSec: Number(s.elapsed.toFixed(1)),
            metricLabel: `${roverSpec.name} • Wheels 0%`,
            reason: `${roverSpec.wheelMaterial} shredded on ${rockStats.label} regolith! Upgrade to stronger wheels.`,
            telemetryLog: {
              peakSlip: s.peakSlip,
              minWheel: 0,
              peakTemp: Math.round(s.motorTemp),
              avgNormalN: Math.round(s.normalAccum / Math.max(1, s.normalCount)),
            },
          });
        }

        const targetB = beacons[s.beaconIdx];
        if (targetB && Math.hypot(s.rx - targetB.x, s.rz - targetB.z) < 3.0) {
          if (s.beaconIdx + 1 >= beacons.length) {
            s.finished = true;
            onComplete({
              status: "PASS",
              timeSec: Number(s.elapsed.toFixed(1)),
              metricLabel: `$${roverSpec.costM}M • Wheels ${s.wheelHealth.toFixed(0)}% • Peak ${s.motorTemp.toFixed(0)}°C`,
              reason: `${roverSpec.name} completed all 3 beacons in ${s.elapsed.toFixed(1)}s!`,
              telemetryLog: {
                peakSlip: s.peakSlip,
                minWheel: Math.round(s.wheelHealth),
                peakTemp: Math.round(s.motorTemp),
                avgNormalN: Math.round(s.normalAccum / Math.max(1, s.normalCount)),
              },
            });
          } else {
            s.beaconIdx += 1;
          }
        }

        const cosY = Math.cos(s.yaw);
        const sinY = Math.sin(s.yaw);
        const toWorld = (lx: number, lz: number) => ({
          x: s.rx + lx * cosY + lz * sinY,
          z: s.rz - lx * sinY + lz * cosY,
        });

        const wOffsets = [
          [-0.62, -0.58],
          [0.62, -0.58],
          [-0.62, 0.52],
          [0.62, 0.52],
        ];

        const wHeights = wOffsets.map(([lx, lz]) => {
          const wp = toWorld(lx, lz);
          return sampleBilinear(elevData, reliefScale, wp.x, wp.z).h;
        });

        const hCenter = sampleBilinear(elevData, reliefScale, s.rx, s.rz).h;
        const avgWheelH = (wHeights[0] + wHeights[1] + wHeights[2] + wHeights[3]) / 4;
        const bodyY = Math.max(hCenter, avgWheelH) + 0.34;

        const hFront = (wHeights[0] + wHeights[1]) / 2;
        const hBack = (wHeights[2] + wHeights[3]) / 2;
        const hLeft = (wHeights[0] + wHeights[2]) / 2;
        const hRight = (wHeights[1] + wHeights[3]) / 2;

        const pitch = Math.atan2(hFront - hBack, 1.1);
        const roll = Math.atan2(hLeft - hRight, 1.24);

        if (roverGroupRef.current) {
          roverGroupRef.current.position.set(s.rx, bodyY, s.rz);
          roverGroupRef.current.rotation.set(0, s.yaw, 0);
          roverGroupRef.current.rotateX(pitch);
          roverGroupRef.current.rotateZ(roll);

          wOffsets.forEach(([lx, lz], idx) => {
            const localWheelY = THREE.MathUtils.clamp(wHeights[idx] - bodyY + 0.21, -0.26, -0.04);
            const wMesh = wheelRefs.current[idx];
            if (wMesh) wMesh.position.set(lx, localWheelY, lz);
          });
        }

        if (thirdPersonCam && controlsRef.current) {
          const curFocus = new THREE.Vector3(s.rx, bodyY + 0.25, s.rz);
          const deltaMove = curFocus.clone().sub(prevFocusRef.current);
          camera.position.add(deltaMove);
          const hUnderCam = sampleBilinear(elevData, reliefScale, camera.position.x, camera.position.z).h;
          camera.position.y = Math.max(camera.position.y, hUnderCam + 0.9);
          controlsRef.current.target.copy(curFocus);
          prevFocusRef.current.copy(curFocus);
          controlsRef.current.update();
        } else {
          const viewYaw = s.yaw + lookOffsetRef.current.yaw;
          const camX = s.rx - Math.sin(s.yaw) * 0.90;
          const camZ = s.rz - Math.cos(s.yaw) * 0.90;
          const hAtCam = sampleBilinear(elevData, reliefScale, camX, camZ).h;
          const camY = Math.max(bodyY + 0.48, hAtCam + 0.65);
          camera.position.set(camX, camY, camZ);

          const lookX = camX - Math.sin(viewYaw) * 8;
          const lookZ = camZ - Math.cos(viewYaw) * 8;
          const hAhead = sampleBilinear(elevData, reliefScale, camX - Math.sin(viewYaw) * 2.5, camZ - Math.cos(viewYaw) * 2.5).h;
          const baseLookY = Math.max(camY + Math.sin(pitch) * 4.5, hAhead + 0.4);
          camera.lookAt(lookX, baseLookY + lookOffsetRef.current.pitch * 6, lookZ);
        }

        const nextB = beacons[s.beaconIdx];
        let bearingDeg = 0;
        if (nextB) {
          const dx = nextB.x - s.rx;
          const dz = nextB.z - s.rz;
          const fx = -Math.sin(s.yaw);
          const fz = -Math.cos(s.yaw);
          const rightX = Math.cos(s.yaw);
          const rightZ = -Math.sin(s.yaw);
          bearingDeg = THREE.MathUtils.radToDeg(Math.atan2(dx * rightX + dz * rightZ, dx * fx + dz * fz));
        }

        if (s.elapsed - s.lastUiEmit > 0.08 || !s.started) {
          s.lastUiEmit = s.elapsed;
          onTelemetry({
            time: s.elapsed.toFixed(1),
            speed: Math.abs(s.speed).toFixed(1),
            wheelHealth: s.wheelHealth.toFixed(0),
            temp: s.motorTemp.toFixed(0),
            maxTemp: roverSpec.maxTempC,
            overheated: s.overheated,
            beacon: `${s.beaconIdx + 1}/${beacons.length}`,
            slope: slopeDeg.toFixed(1),
            bearingDeg,
            normalForceN: Math.round(normalForceN),
            gripLimitN: Math.round(gripLimitN),
            slipPct,
            coolingMode: pressureBar > 0.5 ? "Air Convective (1.01 bar)" : "Radiative Vacuum",
          });
        }
      }
    }

    if (scenario === "landing") {
      const thrust = k["Space"] || k["ThrustHold"] ? 1 : 0;
      const fwdInput = (k["KeyW"] || k["ArrowUp"] ? 1 : 0) - (k["KeyS"] || k["ArrowDown"] ? 1 : 0);
      const rightInput = (k["KeyD"] || k["ArrowRight"] ? 1 : 0) - (k["KeyA"] || k["ArrowLeft"] ? 1 : 0);

      if (!s.finished) {
        s.started = true;
        s.elapsed += dt;

        const camFwd = new THREE.Vector3();
        camera.getWorldDirection(camFwd);
        camFwd.y = 0;
        if (camFwd.lengthSq() < 1e-4) camFwd.set(0, 0, -1);
        camFwd.normalize();
        const camRight = new THREE.Vector3().crossVectors(camFwd, new THREE.Vector3(0, 1, 0)).normalize();

        const desiredVx = (camFwd.x * fwdInput + camRight.x * rightInput) * 6.5;
        const desiredVz = (camFwd.z * fwdInput + camRight.z * rightInput) * 6.5;

        const gSim = (gravity / 9.81) * 5.2;
        const airDrag = (pressureBar / 1.013) * 0.45;
        const thrustPower = thrust > 0 && s.fuel > 0 ? 9.5 : 0;

        const fuelBurnRate = 4.2 + (gravity / 9.81) * 8.8;
        if (thrust > 0 && s.fuel > 0) {
          s.fuel = Math.max(0, s.fuel - dt * fuelBurnRate);
        }

        s.vy += (-gSim + thrustPower - s.vy * airDrag) * dt;
        s.vx = THREE.MathUtils.lerp(s.vx, desiredVx, dt * 3.5);
        s.vz = THREE.MathUtils.lerp(s.vz, desiredVz, dt * 3.5);

        s.lx = THREE.MathUtils.clamp(s.lx + s.vx * dt, -24, 24);
        s.lz = THREE.MathUtils.clamp(s.lz + s.vz * dt, -24, 24);
        s.ly += s.vy * dt;

        const { h: groundH, slopeDeg } = sampleBilinear(elevData, reliefScale, s.lx, s.lz);
        const altitude = Math.max(0, s.ly - groundH);
        const distFromPad = Math.hypot(s.lx, s.lz);

        if (landerGroupRef.current) {
          landerGroupRef.current.position.set(s.lx, Math.max(groundH + 0.5, s.ly), s.lz);
        }

        const firing = thrust > 0 && s.fuel > 0;
        if (flameRef.current) {
          flameRef.current.visible = firing;
          if (firing) {
            const flicker = 0.85 + Math.sin(clock.getElapsedTime() * 45) * 0.25;
            flameRef.current.scale.set(1, flicker, 1);
          }
        }

        const targetHeat = firing && altitude < 11 ? (1 - altitude / 11) : 0;
        if (targetHeat > s.groundHeat) {
          s.groundHeat = Math.min(1.0, s.groundHeat + dt * 1.15 * targetHeat);
        } else {
          const coolRate = pressureBar > 0.5 ? 0.22 : 0.07;
          s.groundHeat = Math.max(0, s.groundHeat - dt * coolRate);
        }

        if (smokeGroupRef.current) {
          smokeGroupRef.current.visible = s.groundHeat > 0.08 && altitude < 12;
          smokeGroupRef.current.position.set(s.lx, groundH + 0.35, s.lz);
          smokeGroupRef.current.rotation.y += dt * 2.5;
          const sScale = 0.8 + s.groundHeat * (pressureBar < 0.05 ? 3.2 : 1.6);
          smokeGroupRef.current.scale.set(sScale, 0.7 + s.groundHeat * 0.9, sScale);
        }

        const plumeM = (4.5 + (1.0 - Math.min(pressureBar / 1.013, 1.0)) * 75.0) * Math.max(0.1, s.groundHeat);
        if (plumeRingRef.current) {
          const dustStrength = firing && altitude < 10 ? (1 - altitude / 10) * (1.2 + (1 - pressureBar / 1.013) * 3.8) : 0.01;
          plumeRingRef.current.position.set(s.lx, groundH + 0.12, s.lz);
          plumeRingRef.current.scale.set(dustStrength * 2.5, dustStrength * 2.5, 1);
        }

        if (thermalGlowRef.current) {
          thermalGlowRef.current.visible = s.groundHeat > 0.03;
          thermalGlowRef.current.position.set(s.lx, groundH + 0.14, s.lz);
          thermalGlowRef.current.scale.setScalar(1 + s.groundHeat * 3.8);
          (thermalGlowRef.current.material as THREE.MeshBasicMaterial).opacity = s.groundHeat * 0.55;
        }

        if (thirdPersonCam && controlsRef.current) {
          const curFocus = new THREE.Vector3(s.lx, Math.max(groundH + 0.5, s.ly), s.lz);
          const deltaMove = curFocus.clone().sub(prevFocusRef.current);
          camera.position.add(deltaMove);
          const hUnderCam = sampleBilinear(elevData, reliefScale, camera.position.x, camera.position.z).h;
          camera.position.y = Math.max(camera.position.y, hUnderCam + 0.9);
          controlsRef.current.target.copy(curFocus);
          prevFocusRef.current.copy(curFocus);
          controlsRef.current.update();
        } else {
          const camY = Math.max(groundH + 0.75, s.ly - 0.58);
          camera.position.set(s.lx, camY, s.lz);
          const baseYaw = Math.atan2(-s.lx, -s.lz);
          const viewYaw = baseYaw + lookOffsetRef.current.yaw;
          const lookDist = 14;
          const lookPitch = -0.75 + lookOffsetRef.current.pitch;
          camera.lookAt(
            s.lx + Math.sin(viewYaw) * lookDist,
            camY + Math.sin(lookPitch) * lookDist,
            s.lz + Math.cos(viewYaw) * lookDist
          );
        }

        if (altitude <= 0.18) {
          s.finished = true;
          const touchSpeed = Math.abs(s.vy);
          const safeSpeed = touchSpeed <= 4.0;
          const onPad = distFromPad <= 6.0 && slopeDeg <= 22;
          const passed = safeSpeed && onPad;

          onComplete({
            status: passed ? "PASS" : "FAIL",
            timeSec: Number(s.elapsed.toFixed(1)),
            metricLabel: `Touchdown ${touchSpeed.toFixed(1)} m/s | Fuel ${s.fuel.toFixed(0)}%`,
            reason: passed
              ? `Soft touchdown on pad in ${s.elapsed.toFixed(1)}s (${touchSpeed.toFixed(1)} m/s).`
              : !safeSpeed
              ? `HARD IMPACT (${touchSpeed.toFixed(1)} m/s > 4.0 m/s limit) — Landing legs buckled!`
              : `MISSED PAD (${distFromPad.toFixed(1)}m off target / ${slopeDeg.toFixed(0)}° slope) — Tip-over!`,
            telemetryLog: {
              touchSpeed: Number(touchSpeed.toFixed(1)),
              fuelRemaining: Math.round(s.fuel),
            },
          });
        }

        if (s.elapsed - s.lastUiEmit > 0.08) {
          s.lastUiEmit = s.elapsed;
          setPlumeHeat(s.groundHeat);
          setPlumePos([s.lx, s.lz]);
          onTelemetry({
            time: s.elapsed.toFixed(1),
            alt: altitude.toFixed(1),
            vSpeed: s.vy.toFixed(1),
            fuel: s.fuel.toFixed(0),
            padDist: distFromPad.toFixed(1),
            surfaceHeatC: (ambientTempC + s.groundHeat * 850).toFixed(0),
            plumeRadiusM: plumeM.toFixed(1),
            dustBlind: firing && altitude < 9 && pressureBar < 0.05,
          });
        }
      }
    }

    if (scenario === "mining") {
      const drilling = k["Space"] || k["KeyE"] || k["DrillHold"];
      const padH = sampleBilinear(elevData, reliefScale, 0, 0).h;

      if (!s.finished) {
        if (drilling) s.started = true;
        if (s.started) s.elapsed += dt;

        if (drilling && !rockStats.canExtractDryCore && s.depth >= 0.45) {
          s.finished = true;
          onComplete({
            status: "FAIL",
            timeSec: Number(s.elapsed.toFixed(1)),
            metricLabel: `Mud Clog at ${s.depth.toFixed(2)}m`,
            reason: `NON-PLANETARY SOIL: Saturated organic mud clogged the dry planetary coring bit!`,
          });
        }

        const heatGen = drilling && !s.seized ? 32.0 * rockStats.heatMult : 0.0;
        const airConvection = (pressureBar / 1.013) * Math.max(0, s.drillTemp - 28) * 0.72;
        const radiative = 0.08 * Math.pow((s.drillTemp + 273) / 300, 4);

        s.drillTemp = Math.max(
          bodyType === "earth" ? 28 : -30,
          s.drillTemp + (heatGen - airConvection - radiative * 2.5) * dt
        );

        if (drilling && !s.seized) {
          s.depth = Math.min(2.0, s.depth + (dt * 0.30) / rockStats.hardness);
        }

        if (s.drillTemp >= 180) {
          s.seized = true;
          s.finished = true;
          onComplete({
            status: "FAIL",
            timeSec: Number(s.elapsed.toFixed(1)),
            metricLabel: `Depth ${s.depth.toFixed(2)}m | Seized 180°C`,
            reason: `THERMAL SEIZURE in ${pressureBar} bar atmosphere on ${rockStats.label}! Pulse the drill in vacuum.`,
            telemetryLog: {
              peakTemp: 180,
            },
          });
        } else if (s.depth >= 2.0) {
          s.finished = true;
          onComplete({
            status: "PASS",
            timeSec: Number(s.elapsed.toFixed(1)),
            metricLabel: `2.00m Core | Peak ${s.drillTemp.toFixed(0)}°C`,
            reason: `2.00m ${rockStats.label} core extracted in ${s.elapsed.toFixed(1)}s.`,
            telemetryLog: {
              peakTemp: Math.round(s.drillTemp),
            },
          });
        }

        if (augerRef.current) {
          if (drilling && !s.seized) {
            augerRef.current.rotation.y += dt * 24;
            augerRef.current.position.x = Math.sin(clock.getElapsedTime() * 60) * 0.012;
          } else {
            augerRef.current.position.x = 0;
          }
          augerRef.current.position.y = padH + 0.92 - (s.depth / 2.0) * 0.85;
        }

        if (bitGlowRef.current) {
          const heatFrac = THREE.MathUtils.clamp((s.drillTemp - 40) / 140, 0, 1);
          bitGlowRef.current.emissive.setRGB(heatFrac * 1.4, heatFrac * 0.25, 0);
        }

        if (coreTubeRef.current) {
          const fill = Math.max(0.05, s.depth / 2.0);
          coreTubeRef.current.scale.set(1, fill, 1);
          coreTubeRef.current.position.y = padH + 0.98 + fill * 0.32;
        }

        if (chipsRef.current) {
          chipsRef.current.visible = Boolean(drilling && !s.seized);
          chipsRef.current.rotation.y += dt * 12;
        }

        if (thirdPersonCam && controlsRef.current) {
          const hUnderCam = sampleBilinear(elevData, reliefScale, camera.position.x, camera.position.z).h;
          camera.position.y = Math.max(camera.position.y, hUnderCam + 0.85);
          controlsRef.current.target.set(0, padH + 0.85, 0);
          controlsRef.current.update();
        } else {
          const r = 3.0;
          const cx = Math.sin(lookOffsetRef.current.yaw) * r;
          const cz = Math.cos(lookOffsetRef.current.yaw) * r;
          const hUnder = sampleBilinear(elevData, reliefScale, cx, cz).h;
          const cy = Math.max(padH + 1.55 + lookOffsetRef.current.pitch * 1.5, hUnder + 0.7);
          camera.position.set(cx, cy, cz);
          camera.lookAt(0, padH + 0.85, 0);
        }

        if (s.elapsed - s.lastUiEmit > 0.06 || !s.started) {
          s.lastUiEmit = s.elapsed;
          onTelemetry({
            time: s.elapsed.toFixed(1),
            depth: s.depth.toFixed(2),
            drillTemp: s.drillTemp.toFixed(0),
            drilling: Boolean(drilling),
            rockLabel: rockStats.label,
            hardness: rockStats.hardness.toFixed(2),
            coolingMode: pressureBar > 0.5 ? "Convective Air Cooling" : "Radiative Vacuum",
          });
        }
      }
    }
  });

  const padY = elevData ? sampleBilinear(elevData, reliefScale, 0, 0).h : 0;

  return (
    <>
      {bodyType === "moon" && <color attach="background" args={["#020617"]} />}
      {bodyType === "mars" && (
        <>
          <color attach="background" args={["#5c2d1c"]} />
          <fog attach="fog" args={["#7c3d26", 30, 115]} />
        </>
      )}
      {bodyType === "earth" && (
        <>
          <color attach="background" args={["#0c4a6e"]} />
          <fog attach="fog" args={["#38bdf8", 38, 130]} />
        </>
      )}

      {bodyType === "moon" && <Stars radius={85} depth={30} count={1500} factor={3} fade />}

      <ambientLight intensity={bodyType === "moon" ? 0.35 : 0.75} />
      <directionalLight position={[18, 26, 12]} intensity={bodyType === "moon" ? 2.1 : 1.5} />

      <RealisticTerrain
        siteId={siteId}
        elevData={elevData}
        reliefM={reliefM}
        bodyType={bodyType}
        mineralProfile={mineralProfile}
        sensorMode={sensorMode}
        radarRoughness={radarRoughness}
        plumeHeat={plumeHeat}
        plumePos={plumePos}
      />

      {thirdPersonCam && <OrbitControls ref={controlsRef} makeDefault enablePan={false} minDistance={2.2} maxDistance={55} />}

      {scenario === "rover" && (
        <>
          <group ref={roverGroupRef}>
            <mesh position={[0, 0.08, -0.05]}>
              <boxGeometry args={[1.05, 0.22, 1.45]} />
              <meshStandardMaterial color="#e2e8f0" metalness={0.55} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.21, 0.05]}>
              <boxGeometry args={[0.92, 0.04, 1.05]} />
              <meshStandardMaterial color="#1d4ed8" metalness={0.75} roughness={0.2} />
            </mesh>
            {roverSpec.radiatorCooling > 0.6 && (
              <mesh position={[0, 0.28, 0.65]}>
                <boxGeometry args={[0.85, 0.16, 0.08]} />
                <meshStandardMaterial color="#f59e0b" metalness={0.7} />
              </mesh>
            )}
            <mesh position={[0, 0.42, -0.52]}>
              <cylinderGeometry args={[0.04, 0.05, 0.45, 10]} />
              <meshStandardMaterial color="#94a3b8" />
            </mesh>
            <mesh position={[0, 0.66, -0.54]}>
              <boxGeometry args={[0.26, 0.12, 0.14]} />
              <meshStandardMaterial color="#f8fafc" />
            </mesh>

            {[0, 1, 2, 3].map((idx) => (
              <mesh
                key={idx}
                ref={(el) => {
                  wheelRefs.current[idx] = el;
                }}
                rotation={[0, 0, Math.PI / 2]}
              >
                <cylinderGeometry args={[0.22, 0.22, 0.17, 16]} />
                <meshStandardMaterial color="#0f172a" roughness={0.85} />
              </mesh>
            ))}
          </group>

          {beacons.map((b, idx) => {
            const bColor =
              idx < simRef.current.beaconIdx
                ? "#22c55e"
                : idx === simRef.current.beaconIdx
                ? "#22d3ee"
                : "#475569";
            return (
              <group key={idx} position={[b.x, b.y + 0.12, b.z]}>
                <mesh position={[0, 2.5, 0]}>
                  <cylinderGeometry args={[0.14, 0.14, 5, 12]} />
                  <meshBasicMaterial color={bColor} transparent opacity={0.75} />
                </mesh>
                <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[1.6, 2.1, 28]} />
                  <meshBasicMaterial color={bColor} side={THREE.DoubleSide} />
                </mesh>
              </group>
            );
          })}
        </>
      )}

      {scenario === "landing" && (
        <>
          <group ref={landerGroupRef}>
            <mesh position={[0, 0.35, 0]}>
              <cylinderGeometry args={[0.68, 0.78, 0.45, 8]} />
              <meshStandardMaterial color="#eab308" metalness={0.8} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.78, 0]}>
              <cylinderGeometry args={[0.45, 0.58, 0.45, 8]} />
              <meshStandardMaterial color="#f8fafc" metalness={0.3} roughness={0.4} />
            </mesh>

            {[0, 1, 2, 3].map((i) => {
              const ang = (i * Math.PI) / 2 + Math.PI / 4;
              return (
                <group key={i} rotation={[0, ang, 0]}>
                  <StrutBetween start={[0.58, 0.22, 0]} end={[1.02, -0.46, 0]} radius={0.042} color="#94a3b8" />
                  <StrutBetween start={[0.64, 0.42, 0]} end={[0.85, -0.18, 0]} radius={0.028} color="#64748b" />
                  <mesh position={[1.02, -0.47, 0]}>
                    <cylinderGeometry args={[0.18, 0.2, 0.06, 12]} />
                    <meshStandardMaterial color="#475569" metalness={0.5} />
                  </mesh>
                </group>
              );
            })}

            <mesh position={[0, 0.02, 0]}>
              <cylinderGeometry args={[0.16, 0.28, 0.3, 12]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} />
            </mesh>

            <group ref={flameRef} position={[0, -0.55, 0]} visible={false}>
              <mesh rotation={[Math.PI, 0, 0]}>
                <coneGeometry args={[0.32, 1.35, 12]} />
                <meshBasicMaterial color="#fb923c" transparent opacity={0.85} />
              </mesh>
              <mesh position={[0, 0.2, 0]} rotation={[Math.PI, 0, 0]}>
                <coneGeometry args={[0.16, 0.85, 10]} />
                <meshBasicMaterial color="#38bdf8" transparent opacity={0.95} />
              </mesh>
            </group>
          </group>

          <group ref={smokeGroupRef} visible={false}>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const a = (i * Math.PI) / 3;
              return (
                <mesh key={i} position={[Math.cos(a) * 0.9, (i % 2) * 0.25, Math.sin(a) * 0.9]}>
                  <dodecahedronGeometry args={[0.45, 1]} />
                  <meshStandardMaterial color={bodyType === "mars" ? "#fdba74" : "#e2e8f0"} transparent opacity={0.45} />
                </mesh>
              );
            })}
          </group>

          <mesh position={[0, padY + 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[3.5, 4.4, 36]} />
            <meshBasicMaterial color="#34d399" side={THREE.DoubleSide} />
          </mesh>

          <mesh ref={plumeRingRef} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.6, 1.5, 28]} />
            <meshBasicMaterial color={bodyType === "earth" ? "#fde047" : "#f43f5e"} transparent opacity={0.65} side={THREE.DoubleSide} />
          </mesh>

          <mesh ref={thermalGlowRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <circleGeometry args={[1.0, 24]} />
            <meshBasicMaterial color="#f97316" transparent opacity={0.45} side={THREE.DoubleSide} />
          </mesh>
        </>
      )}

      {scenario === "mining" && (
        <group>
          <mesh position={[0, padY + 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.85, 1.35, 8]} />
            <meshStandardMaterial color="#334155" metalness={0.6} side={THREE.DoubleSide} />
          </mesh>

          <mesh position={[0, padY + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.26, 20]} />
            <meshBasicMaterial color="#020617" />
          </mesh>

          {[
            [-0.95, -0.95],
            [0.95, -0.95],
            [-0.95, 0.95],
            [0.95, 0.95],
          ].map(([fx, fz], i) => (
            <React.Fragment key={i}>
              <StrutBetween
                start={[fx, padY + 0.04, fz]}
                end={[fx * 0.42, padY + 1.82, fz * 0.42]}
                radius={0.055}
                color="#94a3b8"
              />
              <mesh position={[fx, padY + 0.04, fz]}>
                <cylinderGeometry args={[0.14, 0.16, 0.06, 10]} />
                <meshStandardMaterial color="#475569" />
              </mesh>
            </React.Fragment>
          ))}

          <mesh position={[0, padY + 1.82, 0]}>
            <cylinderGeometry args={[0.58, 0.66, 0.28, 8]} />
            <meshStandardMaterial color="#eab308" metalness={0.45} roughness={0.35} />
          </mesh>
          {[0, 1, 2, 3].map((r) => (
            <mesh key={r} position={[0, padY + 1.82, 0]} rotation={[0, (r * Math.PI) / 4, 0]}>
              <boxGeometry args={[1.38, 0.22, 0.05]} />
              <meshStandardMaterial color="#475569" metalness={0.8} />
            </mesh>
          ))}

          <mesh position={[0.44, padY + 1.32, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.75, 12]} />
            <meshStandardMaterial color="#38bdf8" transparent opacity={0.25} />
          </mesh>
          <mesh ref={coreTubeRef} position={[0.44, padY + 0.98, 0]}>
            <cylinderGeometry args={[0.085, 0.085, 0.65, 12]} />
            <meshStandardMaterial color={bodyType === "mars" ? "#c2410c" : "#64748b"} />
          </mesh>

          <group ref={augerRef} position={[0, padY + 0.92, 0]}>
            <mesh position={[0, 0.55, 0]}>
              <cylinderGeometry args={[0.24, 0.24, 0.45, 12]} />
              <meshStandardMaterial color="#0f172a" metalness={0.7} />
            </mesh>
            <mesh position={[0, -0.25, 0]}>
              <cylinderGeometry args={[0.08, 0.08, 1.5, 12]} />
              <meshStandardMaterial ref={bitGlowRef} color="#cbd5e1" metalness={0.8} roughness={0.2} />
            </mesh>
            {[-0.75, -0.5, -0.25, 0.0, 0.25].map((fy, i) => (
              <mesh key={i} position={[0, fy, 0]} rotation={[0.35, i * 1.1, 0]}>
                <torusGeometry args={[0.13, 0.03, 8, 16]} />
                <meshStandardMaterial color="#38bdf8" metalness={0.75} roughness={0.25} />
              </mesh>
            ))}
            <mesh position={[0, -1.05, 0]} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[0.14, 0.28, 8]} />
              <meshStandardMaterial color="#f59e0b" metalness={0.8} />
            </mesh>
          </group>

          <group ref={chipsRef} position={[0, padY + 0.12, 0]} visible={false}>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const ang = (i * Math.PI) / 3;
              return (
                <mesh key={i} position={[Math.cos(ang) * 0.42, (i % 2) * 0.15, Math.sin(ang) * 0.42]}>
                  <dodecahedronGeometry args={[0.055, 0]} />
                  <meshBasicMaterial color="#fbbf24" />
                </mesh>
              );
            })}
          </group>
        </group>
      )}
    </>
  );
}

export default function DualSimulator({
  matchData,
  selectedMatch,
  onBack,
}: {
  matchData: MatchPayload;
  selectedMatch: EarthMatch;
  onBack: () => void;
}) {
  const [scenario, setScenario] = useState<ScenarioType>("rover");
  const [worldSide, setWorldSide] = useState<WorldSide>("earth");
  const [sensorMode, setSensorMode] = useState<"optical" | "sar" | "thermal">("optical");
  const [thirdPersonCam, setThirdPersonCam] = useState(false);
  const [selectedRoverId, setSelectedRoverId] = useState<string>("desert_scout");
  const [runId, setRunId] = useState(1);
  const [modalResult, setModalResult] = useState<RunRecord | null>(null);

  const [elevData, setElevData] = useState<number[] | null>(null);
  const [reliefM, setReliefM] = useState<number>(120);

  const [telemetry, setTelemetry] = useState<any>({});
  const [earthRun, setEarthRun] = useState<Record<ScenarioType, RunRecord | null>>({
    rover: null,
    landing: null,
    mining: null,
  });
  const [spaceRun, setSpaceRun] = useState<Record<ScenarioType, RunRecord | null>>({
    rover: null,
    landing: null,
    mining: null,
  });

  const keysRef = useRef<Record<string, boolean>>({});
  const lookOffsetRef = useRef({ yaw: 0, pitch: 0 });
  const draggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
      keysRef.current[e.code] = true;
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const activeUrl = worldSide === "earth" ? selectedMatch.heightmap_url : matchData.target.heightmap_url;
  useEffect(() => {
    setElevData(null);
    fetch(`http://127.0.0.1:8000${activeUrl}`)
      .then((res) => res.json())
      .then((json) => {
        setElevData(json.data);
        setReliefM(json.relief_m || 120);
      })
      .catch((err) => console.error("Heightmap fetch error:", err));
  }, [activeUrl]);

  useEffect(() => {
    setModalResult(null);
    setRunId((r) => r + 1);
    if (scenario === "mining") setThirdPersonCam(true);
  }, [scenario, worldSide, selectedRoverId]);

  const activeSiteId = (worldSide === "earth" ? selectedMatch?.id : matchData?.target?.id) || "default";
  const activeBody: "earth" | "moon" | "mars" = worldSide === "earth" ? "earth" : matchData.target.body;
  const activeGravity = worldSide === "earth" ? 9.81 : matchData.target.gravity;
  const activePressure = worldSide === "earth" ? 1.013 : matchData.target.pressure_bar;
  const activeMineral =
    worldSide === "earth" ? selectedMatch.mineral_profile : (matchData.target as any).mineral_profile || "mare_basalt";
  const activeAmbientTemp =
    worldSide === "earth" ? 28 : (matchData.target.temp_min_c + matchData.target.temp_max_c) / 2;

  const params = selectedMatch.parameter_similarities;
  const ironRatio = worldSide === "earth" ? (params?.iron_oxide_ratio?.earth_val ?? 1.0) : (params?.iron_oxide_ratio?.target_val ?? 1.2);
  const clayRatio = worldSide === "earth" ? (params?.clay_hydroxyl_ratio?.earth_val ?? 0.4) : (params?.clay_hydroxyl_ratio?.target_val ?? 0.3);
  const bareness = worldSide === "earth" ? (params?.bareness_index?.earth_val ?? 0.98) : (params?.bareness_index?.target_val ?? 1.0);

  const selectedRover = ROVER_CATALOG.find((r) => r.id === selectedRoverId) || ROVER_CATALOG[1];

  const rockStats = useMemo(() => {
    if (bareness < 0.25) {
      return { label: "Waterlogged Mud / Biomass", hardness: 0.55 };
    }
    const hardness = THREE.MathUtils.clamp(0.75 + ironRatio * 0.45 - clayRatio * 0.35, 0.55, 1.65);
    const label = activeMineral.replace(/_/g, " ").toUpperCase();
    return { label, hardness };
  }, [bareness, ironRatio, clayRatio, activeMineral]);

  const handleComplete = (res: RunRecord) => {
    setModalResult(res);
    if (worldSide === "earth") {
      setEarthRun((prev) => ({ ...prev, [scenario]: res }));
    } else {
      setSpaceRun((prev) => ({ ...prev, [scenario]: res }));
    }
  };

  const handleRetry = () => {
    setModalResult(null);
    setRunId((r) => r + 1);
  };

  return (
    <div className="relative z-10 flex-1 flex flex-col gap-3 p-4 max-w-[1750px] w-full mx-auto">
      <div className="glass-card rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700 cursor-pointer transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Analytics
          </button>

          <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setWorldSide("earth")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                worldSide === "earth" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
              }`}
            >
              1. Earth ({selectedMatch.name.split("(")[0].trim()})
            </button>
            <button
              onClick={() => setWorldSide("space")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                worldSide === "space" ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:text-white"
              }`}
            >
              2. {matchData.target.body.toUpperCase()} ({matchData.target.name})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
          {[
            { id: "rover", label: "Rover Drive", icon: Car },
            { id: "landing", label: "Lander Descent", icon: Rocket },
            { id: "mining", label: "Core Drill", icon: Drill },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setScenario(item.id as ScenarioType)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition ${
                  scenario === item.id ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            <Layers className="w-3.5 h-3.5 text-cyan-400 ml-1" />
            {(["optical", "sar", "thermal"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setSensorMode(m)}
                className={`px-2 py-1 rounded-lg text-[10px] font-mono uppercase cursor-pointer ${
                  sensorMode === m ? "bg-slate-700 text-white font-bold" : "text-slate-400"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              lookOffsetRef.current = { yaw: 0, pitch: 0 };
              setThirdPersonCam((v) => !v);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border cursor-pointer transition ${
              thirdPersonCam
                ? "bg-amber-400 text-slate-950 border-amber-300"
                : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
            }`}
          >
            <Eye className="w-3.5 h-3.5" /> {thirdPersonCam ? "3rd-Person (Drag Orbit)" : "1st-Person (Drag Look)"}
          </button>

          <button
            onClick={handleRetry}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1 border border-slate-700 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Restart
          </button>
        </div>
      </div>

      {scenario === "rover" && (
        <div className="glass-card rounded-2xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-300 px-1">
            <span>SELECT ROVER HARDWARE (Test Cost vs. Reliability on {activeBody.toUpperCase()}):</span>
            <span className="text-emerald-300">AI Recommended = Optimum Cost / Physics Compatibility</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {ROVER_CATALOG.map((r) => {
              const isSelected = r.id === selectedRoverId;
              const isRec = r.recommendedFor === activeBody;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedRoverId(r.id)}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer relative ${
                    isSelected
                      ? "bg-cyan-500/15 border-cyan-400 text-white shadow"
                      : "bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-600"
                  }`}
                >
                  {isRec && (
                    <span className="absolute -top-2 right-2 px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950 text-[9px] font-mono font-extrabold flex items-center gap-0.5 shadow">
                      <Sparkles className="w-2.5 h-2.5" /> RECOMMENDED
                    </span>
                  )}
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="truncate pr-1">{r.name}</span>
                    <span className="text-amber-300 font-mono">${r.costM}M</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate">{r.wheelMaterial}</div>
                  <div className="text-[10px] font-mono text-cyan-300 mt-1">
                    Max: {r.maxTempC}°C | Armor: {r.wheelArmor}x
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-slate-900/70 border border-slate-800 rounded-xl px-4 py-2 text-[11px] font-mono flex flex-wrap items-center justify-between gap-2 text-slate-300">
        <span className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          {scenario === "rover" && (
            <span>
              <b className="text-emerald-400">PASS:</b> Reach 3 beacons with Wheels &gt; 0% |{" "}
              <b className="text-rose-400">FAIL:</b> Wheels reach 0% (Budget buggies shred tires in vacuum!)
            </span>
          )}
          {scenario === "landing" && (
            <span>
              <b className="text-emerald-400">PASS:</b> Land inside green ring (&lt;6m) at V-Speed &le; 4.0 m/s |{" "}
              <b className="text-rose-400">FAIL:</b> Hard impact (&gt;4.0 m/s) or Missed Pad
            </span>
          )}
          {scenario === "mining" && (
            <span>
              <b className="text-emerald-400">PASS:</b> Drill 2.00m core before Bit hits 180°C |{" "}
              <b className="text-rose-400">FAIL:</b> Bit hits 180°C or wet mud clogs bit (Rock: {rockStats.label})
            </span>
          )}
        </span>
        <span className="text-slate-400">
          Gravity: {activeGravity} m/s² | Pressure: {activePressure} bar | Hardness: {rockStats.label}
        </span>
      </div>

      <div
        className="glass-card rounded-3xl overflow-hidden relative w-full h-[58vh] min-h-[440px]"
        onPointerDown={(e) => {
          if (!thirdPersonCam) {
            draggingRef.current = true;
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
          }
        }}
        onPointerMove={(e) => {
          if (!thirdPersonCam && draggingRef.current) {
            const dx = e.clientX - lastPointerRef.current.x;
            const dy = e.clientY - lastPointerRef.current.y;
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
            lookOffsetRef.current.yaw -= dx * 0.005;
            lookOffsetRef.current.pitch = THREE.MathUtils.clamp(lookOffsetRef.current.pitch - dy * 0.004, -0.7, 0.7);
          }
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerLeave={() => {
          draggingRef.current = false;
        }}
      >
        <div className="absolute top-4 left-4 z-10 bg-slate-950/80 backdrop-blur border border-slate-800 rounded-2xl p-3 font-mono text-xs flex flex-wrap gap-5 pointer-events-none">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-cyan-400" />
            <span>TIME: <b>{telemetry.time || "0.0"}s</b></span>
          </div>

          {scenario === "rover" && (
            <>
              <div className="flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-emerald-400" />
                <span>WHEELS: <b className={Number(telemetry.wheelHealth) < 35 ? "text-rose-400" : "text-emerald-300"}>{telemetry.wheelHealth || 100}%</b></span>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>NORMAL FORCE: <b className="text-amber-300">{telemetry.normalForceN || Math.round(VEHICLE_MASS_KG * activeGravity)} N</b></span>
              </div>
              <div className="flex items-center gap-1.5">
                <span>SLIP: <b className={Number(telemetry.slipPct) > 40 ? "text-rose-400" : "text-cyan-300"}>{telemetry.slipPct || 4}%</b></span>
              </div>
              <div className="flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5 text-rose-400" />
                <span>MOTOR: <b className={telemetry.overheated ? "text-rose-400" : "text-slate-200"}>{telemetry.temp || 30}°C / {selectedRover.maxTempC}°C</b></span>
              </div>
              <div>BEACON: <b className="text-cyan-300">{telemetry.beacon || "1/3"}</b></div>
            </>
          )}

          {scenario === "landing" && (
            <>
              <div>ALT: <b className="text-cyan-300">{telemetry.alt || "20.0"}m</b></div>
              <div>V-SPEED: <b className={Number(telemetry.vSpeed) < -4.0 ? "text-rose-400" : "text-emerald-300"}>{telemetry.vSpeed || "0.0"} m/s</b></div>
              <div>FUEL: <b className="text-amber-300">{telemetry.fuel || 100}%</b></div>
              <div>PAD DIST: <b>{telemetry.padDist || "10.4"}m</b></div>
              <div>GROUND TEMP: <b className="text-orange-300">{telemetry.surfaceHeatC || "28"}°C</b></div>
            </>
          )}

          {scenario === "mining" && (
            <>
              <div>DEPTH: <b className="text-cyan-300">{telemetry.depth || "0.00"} / 2.00m</b></div>
              <div>BIT TEMP: <b className={Number(telemetry.drillTemp) > 135 ? "text-rose-400" : "text-emerald-300"}>{telemetry.drillTemp || 30}°C / 180°C</b></div>
              <div>ROCK: <b className="text-amber-300">{telemetry.rockLabel || rockStats.label}</b></div>
            </>
          )}
        </div>

        {scenario === "rover" && telemetry.overheated && !modalResult && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 rounded-full bg-rose-950/90 border border-rose-500 text-rose-200 text-xs font-mono pointer-events-none">
            MOTOR OVERHEATED (&gt;{selectedRover.maxTempC}°C) — THROTTLED! RELEASE W OR PICK A BETTER ROVER
          </div>
        )}

        {scenario === "rover" && !modalResult && (
          <div className="absolute top-4 right-4 z-10 bg-slate-950/80 border border-cyan-500/40 rounded-2xl px-3.5 py-2 flex items-center gap-2 pointer-events-none">
            <span className="text-[11px] font-mono text-cyan-300">NEXT BEACON</span>
            <div className="text-xl font-bold text-cyan-400 transition-transform" style={{ transform: `rotate(${telemetry.bearingDeg || 0}deg)` }}>
              ↑
            </div>
          </div>
        )}

        {scenario === "landing" && telemetry.dustBlind && !modalResult && (
          <div className="absolute inset-0 z-10 pointer-events-none bg-amber-900/35 backdrop-blur-[2px] flex items-center justify-center">
            <div className="px-4 py-1.5 rounded-full bg-rose-950/90 border border-rose-500 text-rose-200 text-xs font-mono">
              VACUUM PLUME DUST BLINDOUT!
            </div>
          </div>
        )}

        <div className="absolute bottom-4 left-4 z-10 bg-slate-950/85 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-300 flex items-center gap-3">
          {scenario === "rover" && <span>CONTROLS: <b>W / A / S / D</b> to drive • <b>Drag Mouse</b> to look/orbit 360°</span>}
          {scenario === "landing" && (
            <>
              <span>CONTROLS: Hold <b>SPACE</b> for Thruster • <b>W / A / S / D</b> to steer • <b>Drag Mouse</b> to look/orbit</span>
              <button
                onMouseDown={() => (keysRef.current["ThrustHold"] = true)}
                onMouseUp={() => (keysRef.current["ThrustHold"] = false)}
                onMouseLeave={() => (keysRef.current["ThrustHold"] = false)}
                className="px-3 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold cursor-pointer"
              >
                HOLD THRUSTER
              </button>
            </>
          )}
          {scenario === "mining" && (
            <>
              <span>CONTROLS: Hold <b>SPACE / E</b> to Drill • <b>Drag Mouse</b> to orbit 360°</span>
              <button
                onMouseDown={() => (keysRef.current["DrillHold"] = true)}
                onMouseUp={() => (keysRef.current["DrillHold"] = false)}
                onMouseLeave={() => (keysRef.current["DrillHold"] = false)}
                className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold cursor-pointer"
              >
                HOLD TO DRILL
              </button>
            </>
          )}
        </div>

        {modalResult && (
          <div className="absolute inset-0 z-20 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="glass-card rounded-3xl p-6 max-w-md w-full border border-slate-700 text-center">
              <div
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-bold mb-3 ${
                  modalResult.status === "PASS" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                }`}
              >
                {modalResult.status === "PASS" ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {worldSide.toUpperCase()} MISSION {modalResult.status}
              </div>
              <h3 className="text-xl font-bold text-white mb-1">{modalResult.timeSec}s Elapsed</h3>
              <p className="text-xs font-mono text-cyan-300 mb-2">{modalResult.metricLabel}</p>
              <p className="text-xs text-slate-300 mb-5">{modalResult.reason}</p>

              <div className="flex gap-2 justify-center">
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer"
                >
                  Retry {worldSide === "earth" ? "Earth" : matchData.target.body.toUpperCase()}
                </button>
                <button
                  onClick={() => setWorldSide(worldSide === "earth" ? "space" : "earth")}
                  className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold cursor-pointer"
                >
                  Now Test on {worldSide === "earth" ? matchData.target.body.toUpperCase() : "Earth"} →
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="w-full h-full cursor-grab active:cursor-grabbing">
          <Canvas shadows camera={{ fov: 60, near: 0.1, far: 170 }}>
            <FirstPersonScene
              siteId={activeSiteId}
              worldSide={worldSide}
              bodyType={activeBody}
              gravity={activeGravity}
              pressureBar={activePressure}
              mineralProfile={activeMineral}
              ironRatio={ironRatio}
              clayRatio={clayRatio}
              bareness={bareness}
              ambientTempC={activeAmbientTemp}
              radarRoughness={selectedMatch.pillar_scores.radar}
              elevData={elevData}
              reliefM={reliefM}
              scenario={scenario}
              sensorMode={sensorMode}
              roverSpec={selectedRover}
              keysRef={keysRef}
              lookOffsetRef={lookOffsetRef}
              thirdPersonCam={thirdPersonCam}
              runId={runId}
              isModalOpen={Boolean(modalResult)}
              onTelemetry={setTelemetry}
              onComplete={handleComplete}
            />
          </Canvas>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="glass-card rounded-2xl p-3.5 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-mono text-emerald-400 uppercase">Earth Run ({selectedMatch.name})</div>
            <div className="text-xs text-slate-200 font-semibold mt-0.5">
              {earthRun[scenario]
                ? `${earthRun[scenario]!.status} in ${earthRun[scenario]!.timeSec}s — ${earthRun[scenario]!.metricLabel}`
                : "Not run yet — drive/land/drill on Earth first!"}
            </div>
          </div>
          {earthRun[scenario] && (
            <span
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold ${
                earthRun[scenario]!.status === "PASS" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
              }`}
            >
              {earthRun[scenario]!.status}
            </span>
          )}
        </div>

        <div className="glass-card rounded-2xl p-3.5 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-mono text-cyan-400 uppercase">
              {matchData.target.body} Run ({matchData.target.name})
            </div>
            <div className="text-xs text-slate-200 font-semibold mt-0.5">
              {spaceRun[scenario]
                ? `${spaceRun[scenario]!.status} in ${spaceRun[scenario]!.timeSec}s — ${spaceRun[scenario]!.metricLabel}`
                : `Switch to ${matchData.target.body.toUpperCase()} above to compare!`}
            </div>
          </div>
          {spaceRun[scenario] && (
            <span
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold ${
                spaceRun[scenario]!.status === "PASS" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
              }`}
            >
              {spaceRun[scenario]!.status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}