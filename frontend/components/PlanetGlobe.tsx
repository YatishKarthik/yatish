"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";

export interface MiniMatrixItem {
  shortLabel: string;
  status: "REPRESENTATIVE" | "PARTIAL" | "NOT_REPRESENTATIVE";
}

export interface GlobePin {
  id: string;
  name: string;
  lat: number;
  lon: number;
  rank?: number;
  subtitle?: string;
  miniMatrix?: MiniMatrixItem[];
}

type Body = "moon" | "mars" | "earth";

const R = 2;
const TINT: Record<Body, string> = { earth: "#7dd3fc", mars: "#fb923c", moon: "#cbd5e1" };

function latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

/* Thin rim of light where the sphere meets space: a fresnel term, additive, drawn on the back faces. */
function Atmosphere({ body }: { body: Body }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(TINT[body]) }, uStrength: { value: body === "moon" ? 0.35 : 1.0 } },
        vertexShader: `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uStrength;
          varying vec3 vN; varying vec3 vV;
          void main() {
            float rim = pow(1.0 - abs(dot(vN, vV)), 3.2);
            gl_FragColor = vec4(uColor, rim * 0.9 * uStrength);
          }`,
      }),
    [body]
  );
  return (
    <mesh material={material} scale={1.12}>
      <sphereGeometry args={[R, 64, 64]} />
    </mesh>
  );
}

/* The pin on the surface, its projected footprint, and the hologram card that hangs above it. */
function PinMarker({
  pin,
  isSelected,
  isHovered,
  body,
  onSelect,
  onHover,
}: {
  pin: GlobePin;
  isSelected: boolean;
  isHovered: boolean;
  body: Body;
  onSelect: (id: string) => void;
  onHover: (pin: GlobePin | null) => void;
}) {
  const haloRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const pos = useMemo(() => latLonToVector3(pin.lat, pin.lon, R + 0.012), [pin.lat, pin.lon]);
  const normal = useMemo(() => pos.clone().normalize(), [pos]);
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal), [normal]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (haloRef.current) {
      const s = isSelected ? 1 + ((t * 0.9) % 1) * 1.6 : 1;
      haloRef.current.scale.set(s, s, 1);
      (haloRef.current.material as THREE.MeshBasicMaterial).opacity = isSelected ? 0.7 * (1 - ((t * 0.9) % 1)) : isHovered ? 0.6 : 0.3;
    }
    if (beamRef.current) (beamRef.current.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(t * 2.2) * 0.05;
  });

  const isTop = body !== "earth" || (pin.rank !== undefined && pin.rank <= 5);
  const colour = isSelected ? "#67e8f9" : isHovered ? "#fde68a" : body === "earth" ? (isTop ? "#6ee7b7" : "#94a3b8") : body === "mars" ? "#fda4af" : "#bae6fd";
  const dot = isSelected ? 0.05 : isTop ? 0.036 : 0.026;
  const foot = body === "earth" ? 0.14 : 0.2;
  const lift = isSelected ? 0.55 : 0.34;

  return (
    <group position={pos} quaternion={quat}>
      <mesh
        onClick={(e) => { e.stopPropagation(); onSelect(pin.id); }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(pin); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = "default"; }}
      >
        <sphereGeometry args={[dot, 16, 16]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={isSelected ? 2.6 : isTop ? 1.4 : 0.6} />
      </mesh>
      {/* larger invisible target so small pins are easy to hit */}
      <mesh visible={false} onClick={(e) => { e.stopPropagation(); onSelect(pin.id); }} onPointerOver={(e) => { e.stopPropagation(); onHover(pin); }} onPointerOut={() => onHover(null)}>
        <sphereGeometry args={[0.09, 8, 8]} />
      </mesh>

      {(isTop || isSelected || isHovered) && (
        <mesh ref={haloRef} position={[0, 0, 0.002]}>
          <ringGeometry args={[foot * 0.7, foot * 0.78, 48]} />
          <meshBasicMaterial color={colour} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}

      {(isHovered || isSelected) && (
        <>
          <mesh position={[0, 0, 0.001]}>
            <circleGeometry args={[foot, 48]} />
            <meshBasicMaterial color={colour} transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {/* a column of light from the footprint to the card */}
          <mesh ref={beamRef} position={[0, 0, lift / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.012, foot * 0.55, lift, 24, 1, true]} />
            <meshBasicMaterial color={colour} transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </>
      )}

    </group>
  );
}

/*
 * Hologram tags are plain DOM nodes beside the canvas. Each frame this projects the pins into the
 * viewport and moves the tags, hiding any whose pin faces away. No portals, so the canvas can unmount freely.
 */
function LabelProjector({ pins, groupRef, nodes, selectedPinId, hoveredPinId, body }: {
  pins: GlobePin[]; groupRef: React.RefObject<THREE.Group | null>; nodes: React.RefObject<Map<string, HTMLDivElement>>;
  selectedPinId: string | null; hoveredPinId: string | null; body: Body;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const n = useMemo(() => new THREE.Vector3(), []);
  // a resting label for every pin on a small set, except where two pins crowd each other (one of the pair keeps it)
  const resting = useMemo(() => {
    const out = new Set<string>();
    if (body === "earth") { pins.forEach((p) => { if (p.rank !== undefined && p.rank <= 3) out.add(p.id); }); return out; }
    if (pins.length > 12) return out;
    const unit = pins.map((p) => latLonToVector3(p.lat, p.lon, 1));
    pins.forEach((p, i) => {
      const crowded = pins.some((_, j) => j < i && out.has(pins[j].id) && unit[i].angleTo(unit[j]) < (5 * Math.PI) / 180);
      if (!crowded) out.add(p.id);
    });
    return out;
  }, [pins, body]);
  useFrame(({ camera, size }) => {
    const g = groupRef.current;
    if (!g) return;
    for (const pin of pins) {
      const el = nodes.current?.get(pin.id);
      if (!el) continue;
      const on = pin.id === selectedPinId, hot = pin.id === hoveredPinId;
      const wanted = on || hot || resting.has(pin.id);
      if (!wanted) { el.style.display = "none"; continue; }
      n.copy(latLonToVector3(pin.lat, pin.lon, 1)).transformDirection(g.matrixWorld);
      v.copy(latLonToVector3(pin.lat, pin.lon, R + (on ? 0.55 : 0.34))).applyMatrix4(g.matrixWorld);
      const facing = n.dot(camera.position.clone().sub(v).normalize()) > 0.1;
      if (!facing) { el.style.display = "none"; continue; }
      v.project(camera);
      el.style.display = "flex";
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

function RotatingGlobe({
  body,
  pins,
  selectedPinId,
  hoveredPinId,
  onSelectPin,
  onHoverPin,
  groupRef,
}: {
  body: Body;
  pins: GlobePin[];
  selectedPinId: string | null;
  hoveredPinId: string | null;
  onSelectPin: (id: string) => void;
  onHoverPin: (pin: GlobePin | null) => void;
  groupRef: React.RefObject<THREE.Group | null>;
}) {
  const turnTo = useRef<THREE.Quaternion | null>(null);
  const raw = useLoader(THREE.TextureLoader, `/textures/${body}.jpg`);
  const texture = useMemo(() => { const t = raw.clone(); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t; }, [raw]);

  const camera = useThree((s) => s.camera);
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    if (turnTo.current) {
      g.quaternion.slerp(turnTo.current, Math.min(1, delta * 3.2));
      if (g.quaternion.angleTo(turnTo.current) < 0.004) turnTo.current = null;
    } else if (!selectedPinId && !hoveredPinId) g.rotation.y += delta * 0.05;
  });

  // when a pin is chosen, the globe turns so that pin faces the camera; dragging afterwards is free
  useEffect(() => {
    const pin = pins.find((p) => p.id === selectedPinId);
    if (!pin || !groupRef.current) return;
    const local = latLonToVector3(pin.lat, pin.lon, 1);
    const toCamera = camera.position.clone().normalize();
    turnTo.current = new THREE.Quaternion().setFromUnitVectors(local, toCamera);
  }, [selectedPinId, pins, camera, groupRef]);

  const selected = pins.find((p) => p.id === selectedPinId) ?? null;

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[R, 96, 96]} />
        <meshStandardMaterial
          map={texture}
          bumpMap={texture}
          bumpScale={body === "moon" ? 0.05 : 0.03}
          roughness={body === "earth" ? 0.55 : 0.95}
          metalness={0.02}
        />
      </mesh>
      <Atmosphere body={body} />

      {/* faint graticule, the look of a projected globe rather than a photo */}
      <mesh>
        <sphereGeometry args={[R + 0.004, 36, 18]} />
        <meshBasicMaterial color={TINT[body]} wireframe transparent opacity={0.045} depthWrite={false} />
      </mesh>

      {/* great circle through the selected site: a ring of light that marks it from any angle */}
      {selected && (
        <group quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), latLonToVector3(selected.lat, selected.lon, 1))}>
          <mesh>
            <ringGeometry args={[R + 0.02, R + 0.03, 128]} />
            <meshBasicMaterial color="#67e8f9" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      )}

      {pins.map((pin) => (
        <PinMarker
          key={pin.id}
          pin={pin}
          isSelected={pin.id === selectedPinId}
          isHovered={pin.id === hoveredPinId}
          body={body}
          onSelect={onSelectPin}
          onHover={onHoverPin}
        />
      ))}
    </group>
  );
}

export default function PlanetGlobe({
  body,
  pins,
  selectedPinId,
  onSelectPin,
}: {
  body: Body;
  pins: GlobePin[];
  selectedPinId: string | null;
  onSelectPin: (id: string) => void;
}) {
  const [hoveredPin, setHoveredPin] = useState<GlobePin | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const camPos: [number, number, number] = body === "moon" ? [0, -5.4, 4.6] : body === "mars" ? [0, 1.0, 7.0] : [0, 0.8, 4.9];
  const activePin = hoveredPin;   // the selected site is described in the panel beside the globe

  return (
    <div className="w-full h-full min-h-[380px] relative">
      {activePin && (
        <div className="absolute bottom-3 right-3 z-10 glass-chip p-3 text-xs font-mono pointer-events-none max-w-[280px]">
          <div className="font-semibold text-white truncate">
            {activePin.rank ? <span className="text-cyan-300 mr-1.5">#{activePin.rank}</span> : null}
            {activePin.name}
          </div>
          <div className="text-[10px] text-slate-300/80 mt-0.5">
            {activePin.lat.toFixed(2)}°, {activePin.lon.toFixed(2)}°
          </div>
          {activePin.subtitle && <div className="text-[10px] text-emerald-300 mt-0.5">{activePin.subtitle}</div>}
          {activePin.miniMatrix && (
            <div className="grid grid-cols-3 gap-1 mt-2 pt-2 border-t border-white/10">
              {activePin.miniMatrix.map((item, idx) => (
                <span
                  key={idx}
                  className={`px-1.5 py-0.5 rounded-md text-[9px] text-center border ${
                    item.status === "REPRESENTATIVE"
                      ? "bg-emerald-400/15 text-emerald-200 border-emerald-300/30"
                      : item.status === "PARTIAL"
                      ? "bg-amber-400/15 text-amber-200 border-amber-300/30"
                      : "bg-rose-400/15 text-rose-200 border-rose-300/30"
                  }`}
                >
                  {item.shortLabel}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[5]" aria-hidden>
        {pins.map((pin) => {
          const on = pin.id === selectedPinId, hot = pin.id === hoveredPin?.id;
          return (
            <div
              key={pin.id}
              ref={(el) => { if (el) nodes.current.set(pin.id, el); else nodes.current.delete(pin.id); }}
              className={`holo-tag absolute left-0 top-0 ${on ? "is-selected" : ""} ${hot ? "is-hover" : ""}`}
              style={{ display: "none" }}
            >
              {pin.rank ? <span className="holo-rank">#{pin.rank}</span> : null}
              <span className="holo-name">{pin.name}</span>
              {(on || hot) && pin.subtitle ? <span className="holo-sub">{pin.subtitle}</span> : null}
            </div>
          );
        })}
      </div>
      <Canvas camera={{ position: camPos, fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[10, 6, 8]} intensity={2.2} color="#fff7ed" />
        <pointLight position={[-8, -5, -6]} intensity={0.5} color={TINT[body]} />
        <Stars radius={60} depth={30} count={2400} factor={2.6} fade speed={0.4} />
        <React.Suspense fallback={null}>
          <RotatingGlobe
            body={body}
            pins={pins}
            selectedPinId={selectedPinId}
            hoveredPinId={hoveredPin?.id || null}
            onSelectPin={onSelectPin}
            onHoverPin={setHoveredPin}
            groupRef={groupRef}
          />
        </React.Suspense>
        <LabelProjector pins={pins} groupRef={groupRef} nodes={nodes} selectedPinId={selectedPinId} hoveredPinId={hoveredPin?.id || null} body={body} />
        <OrbitControls makeDefault enablePan={false} minDistance={3.0} maxDistance={8.5} enableDamping dampingFactor={0.08} />
      </Canvas>
    </div>
  );
}
