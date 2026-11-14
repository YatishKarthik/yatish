"use client";

import React, { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";

type World = "moon" | "mars";

const INFO: Record<World, { title: string; spec: string; blurb: string; tint: string }> = {
  moon: { title: "The Moon", spec: "10 base candidates · 1.62 m/s² · vacuum", blurb: "South Pole permanently shadowed craters, sunlit peaks, and lava tube skylights.", tint: "#cbd5e1" },
  mars: { title: "Mars", spec: "10 base candidates · 3.72 m/s² · 0.006 bar", blurb: "Ancient river deltas, subsurface sheet-ice plains, deep canyons, and basaltic lava tubes.", tint: "#fb923c" },
};

/* One world: a lit, slowly turning sphere with a rim of light; it swells a little under the pointer. */
function World({ id, x, hovered, onHover, onPick }: { id: World; x: number; hovered: boolean; onHover: (w: World | null) => void; onPick: (w: World) => void }) {
  const group = useRef<THREE.Group>(null);
  const sphere = useRef<THREE.Group>(null);
  const raw = useLoader(THREE.TextureLoader, `/textures/${id}.jpg`);
  const tex = useMemo(() => { const t = raw.clone(); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; }, [raw]);
  const tint = INFO[id].tint;
  useFrame((state, dt) => {
    if (sphere.current) sphere.current.rotation.y += dt * (hovered ? 0.35 : 0.12);
    if (group.current) {
      const target = hovered ? 1.08 : 1;
      group.current.scale.lerp(new THREE.Vector3(target, target, target), 0.1);
      group.current.position.y = Math.sin(state.clock.elapsedTime * 0.7 + x) * 0.05;
    }
  });
  return (
    <group ref={group} position={[x, 0, 0]}>
      <group ref={sphere}>
        <mesh
          onClick={(e) => { e.stopPropagation(); onPick(id); }}
          onPointerOver={(e) => { e.stopPropagation(); onHover(id); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { onHover(null); document.body.style.cursor = "default"; }}
        >
          <sphereGeometry args={[1.35, 96, 96]} />
          <meshStandardMaterial map={tex} bumpMap={tex} bumpScale={id === "moon" ? 0.05 : 0.03} roughness={0.95} metalness={0.02} />
        </mesh>
      </group>
      <mesh scale={1.1}>
        <sphereGeometry args={[1.35, 48, 48]} />
        <meshBasicMaterial color={tint} transparent opacity={hovered ? 0.1 : 0.05} side={THREE.BackSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* projection ring beneath each world */}
      <mesh position={[0, -1.75, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.3, 1.5, 96]} />
        <meshBasicMaterial color={tint} transparent opacity={hovered ? 0.35 : 0.14} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

export default function WorldPicker({ onPick }: { onPick: (w: World) => void }) {
  const [hovered, setHovered] = useState<World | null>(null);
  const info = hovered ? INFO[hovered] : null;
  return (
    <div className="relative w-full h-[440px] md:h-[520px]">
      <Canvas camera={{ position: [0, -0.5, 7.4], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[6, 5, 6]} intensity={2.4} color="#fff7ed" />
        <pointLight position={[-6, -3, -4]} intensity={0.5} color="#7dd3fc" />
        <Stars radius={60} depth={30} count={2600} factor={2.6} fade speed={0.3} />
        <React.Suspense fallback={null}>
          <World id="moon" x={-2.1} hovered={hovered === "moon"} onHover={setHovered} onPick={onPick} />
          <World id="mars" x={2.1} hovered={hovered === "mars"} onHover={setHovered} onPick={onPick} />
        </React.Suspense>
        <OrbitControls enablePan={false} enableZoom={false} enableRotate={false} />
      </Canvas>
      {(["moon", "mars"] as World[]).map((w, i) => (
        <div key={w} className="pointer-events-none absolute bottom-6 flex justify-center" style={{ left: i === 0 ? "25%" : "75%", transform: "translateX(-50%)" }}>
          <div className={`holo-tag text-center ${hovered === w ? "is-hover" : ""}`} style={{ minWidth: 220, transform: "none" }}>
            <span className="holo-name" style={{ fontSize: 15 }}>{INFO[w].title}</span>
            <span className="holo-sub">{INFO[w].spec}</span>
          </div>
        </div>
      ))}
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
        <div className={`glass-chip px-4 py-2 text-xs text-center transition-opacity duration-300 max-w-md ${info ? "opacity-100" : "opacity-70"}`}>
          {info ? <span className="text-slate-100">{info.blurb}</span> : <span className="text-slate-300">Click a world to open its base candidates</span>}
        </div>
      </div>
    </div>
  );
}
