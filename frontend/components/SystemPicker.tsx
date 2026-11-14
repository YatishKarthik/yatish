"use client";

import React, { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

type World = "moon" | "mars";
type BodyId = "sun" | "earth" | "moon" | "mars";

const FACTS: Record<BodyId, { title: string; line: string; detail: string; pick: boolean }> = {
  sun: { title: "Sun", line: "The light every site on this map is measured under", detail: "Day length and sunlight set how hot a place gets and how fast it cools at night.", pick: false },
  earth: { title: "Earth", line: "Where the testing happens", detail: "60 candidate test sites: deserts, craters, lava fields, dry valleys and a few deliberately unsuitable places as controls.", pick: false },
  moon: { title: "The Moon", line: "10 base candidates · 1.62 m/s² · no air", detail: "South Pole crater rims, permanently shadowed floors, lava-tube skylights. Nights last two weeks.", pick: true },
  mars: { title: "Mars", line: "10 base candidates · 3.72 m/s² · 0.006 bar", detail: "Ancient river deltas, buried ice plains, deep canyons and basaltic lava tubes. Thin air, fine dust.", pick: true },
};

/* A faint band of stars across the sky and a sparse field around it. */
function Galaxy() {
  const geo = useMemo(() => {
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const n = 6000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const band = i < n * 0.55;
      let x, y, z;
      if (band) { const a = rnd() * Math.PI * 2, r = 120 + rnd() * 60; x = Math.cos(a) * r; z = Math.sin(a) * r; y = (rnd() - 0.5) * 28 * (0.4 + rnd()) + Math.sin(a * 2) * 8; }
      else { const a = rnd() * Math.PI * 2, p = Math.acos(2 * rnd() - 1), r = 150 + rnd() * 40; x = r * Math.sin(p) * Math.cos(a); y = r * Math.cos(p); z = r * Math.sin(p) * Math.sin(a); }
      pos.set([x, y, z], i * 3);
      c.setHSL(0.55 + rnd() * 0.12, 0.5, 0.65 + rnd() * 0.3);
      if (band && rnd() < 0.2) c.setHSL(0.08, 0.6, 0.75);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  return <points geometry={geo}><pointsMaterial size={1.1} sizeAttenuation vertexColors transparent opacity={0.9} depthWrite={false} /></points>;
}

/* Meteors: a streak appears every few seconds, crosses the sky and fades. */
function ShootingStars() {
  const ref = useRef<THREE.Group>(null);
  const streaks = useRef(Array.from({ length: 3 }, (_, k) => ({ t: 10 + k * 3, a: 0, pos: new THREE.Vector3(0, -999, 0), dir: new THREE.Vector3(0, -1, 0) })));
  useFrame((_, dt) => {
    const g = ref.current; if (!g) return;
    streaks.current.forEach((st, k) => {
      st.t += dt;
      const m = g.children[k] as THREE.Mesh;
      if (st.t > 1.4 + k) {
        st.t = -2 - Math.random() * 5;
        st.pos.set((Math.random() - 0.5) * 120, 20 + Math.random() * 40, -60 - Math.random() * 40);
        st.dir.set(-1 - Math.random(), -0.5 - Math.random() * 0.5, 0.2).normalize();
        st.a = 1;
      }
      const live = st.t > 0 && st.t < 1.2;
      m.visible = live;
      if (live) {
        st.pos.addScaledVector(st.dir, dt * 70);
        m.position.copy(st.pos);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), st.dir);
        (m.material as THREE.MeshBasicMaterial).opacity = Math.sin((st.t / 1.2) * Math.PI) * 0.9;
      }
    });
  });
  return (
    <group ref={ref}>
      {[0, 1, 2].map((k) => (
        <mesh key={k} visible={false}><cylinderGeometry args={[0.02, 0.12, 9, 6]} /><meshBasicMaterial color="#e0f2fe" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      ))}
    </group>
  );
}

function Sun() {
  const sunRef = useRef<THREE.Mesh>(null);
  const surface = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float noise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){ float n = noise(vP * 6.0 + uT * 0.15) * 0.6 + noise(vP * 14.0 - uT * 0.1) * 0.4;
        float limb = pow(max(dot(vN, vV), 0.0), 0.45);
        vec3 c = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.95, 0.75), n) * (0.55 + 0.45 * limb);
        gl_FragColor = vec4(c, 1.0); }`,
  }), []);
  useFrame(({ clock }) => { const m = sunRef.current?.material as THREE.ShaderMaterial | undefined; if (m) m.uniforms.uT.value = clock.elapsedTime; });
  const glow = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ float r = pow(1.0 - abs(dot(vN, vV)), 2.0); gl_FragColor = vec4(1.0, 0.72, 0.35, r * 0.9); }`,
  }), []);
  return (
    <group>
      <mesh ref={sunRef} material={surface}><sphereGeometry args={[1.25, 64, 64]} /></mesh>
      <mesh material={glow} scale={2.0}><sphereGeometry args={[1.25, 48, 48]} /></mesh>
      <pointLight intensity={70} distance={60} decay={1.6} color="#fff4df" />
    </group>
  );
}

function Orbit({ r }: { r: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r - 0.012, r + 0.012, 180]} />
      <meshBasicMaterial color="#9fc3d6" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function Planet({ id, r, tex, children, onHover, onPick, hovered, pickable, meshRef }: {
  id: BodyId; r: number; tex: string; children?: React.ReactNode; onHover: (b: BodyId | null) => void; onPick: (b: BodyId) => void; hovered: boolean; pickable: boolean; meshRef: React.RefObject<THREE.Group | null>;
}) {
  const raw = useLoader(THREE.TextureLoader, tex);
  const map = useMemo(() => { const t = raw.clone(); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t; }, [raw]);
  const spin = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => { if (spin.current) spin.current.rotation.y += dt * 0.15; });
  return (
    <group ref={meshRef}>
      <mesh ref={spin}
        onClick={(e) => { e.stopPropagation(); if (pickable) onPick(id); }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(id); document.body.style.cursor = pickable ? "pointer" : "default"; }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = "default"; }}>
        <sphereGeometry args={[r, 64, 64]} />
        <meshStandardMaterial map={map} bumpMap={map} bumpScale={0.02} roughness={0.9} metalness={0.02} />
      </mesh>
      {pickable && (
        <mesh visible={false} onClick={(e) => { e.stopPropagation(); onPick(id); }} onPointerOver={(e) => { e.stopPropagation(); onHover(id); document.body.style.cursor = "pointer"; }} onPointerOut={() => { onHover(null); document.body.style.cursor = "default"; }}>
          <sphereGeometry args={[r * 2.2, 12, 12]} />
        </mesh>
      )}
      <mesh scale={1.08}><sphereGeometry args={[r, 32, 32]} /><meshBasicMaterial color={id === "earth" ? "#7dd3fc" : id === "mars" ? "#fb923c" : "#cbd5e1"} transparent opacity={hovered ? 0.14 : 0.05} side={THREE.BackSide} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      {children}
    </group>
  );
}

function System({ hovered, setHovered, onPick, zoomingRef, nodes }: {
  hovered: BodyId | null; setHovered: (b: BodyId | null) => void; onPick: (w: World) => void; zoomingRef: React.MutableRefObject<BodyId | null>; nodes: React.RefObject<Map<string, HTMLDivElement>>;
}) {
  const earthOrbit = useRef<THREE.Group>(null), marsOrbit = useRef<THREE.Group>(null), moonOrbit = useRef<THREE.Group>(null);
  const earthRef = useRef<THREE.Group>(null), moonRef = useRef<THREE.Group>(null), marsRef = useRef<THREE.Group>(null);
  const t0 = useRef<number | null>(null);
  const scratch = useRef(new THREE.Vector3());

  useFrame(({ clock, size, camera, controls: rawControls }, dt) => {
    const controls = rawControls as unknown as { target: THREE.Vector3; update: () => void; enabled: boolean } | null;
    const paused = Boolean(zoomingRef.current) || Boolean(hovered);
    if (!paused) {
      if (earthOrbit.current) earthOrbit.current.rotation.y += dt * 0.025;
      if (marsOrbit.current) marsOrbit.current.rotation.y += dt * 0.018;
      if (moonOrbit.current) moonOrbit.current.rotation.y += dt * 0.25;
    }
    // zoom flight toward the chosen world
    const z = zoomingRef.current;
    if (z && controls) {
      const g = z === "moon" ? moonRef.current : marsRef.current;
      if (g) {
        if (t0.current == null) t0.current = clock.elapsedTime;
        const k = Math.min(1, (clock.elapsedTime - t0.current) / 1.1), e = 1 - Math.pow(1 - k, 3);
        const target = g.getWorldPosition(new THREE.Vector3());
        const off = camera.position.clone().sub(controls.target).normalize().multiplyScalar(z === "moon" ? 1.4 : 2.6);
        controls.target.lerp(target, e * 0.2 + 0.05);
        camera.position.lerp(target.clone().add(off), e * 0.2 + 0.05);
        controls.enabled = false; controls.update();
        if (k >= 1) { t0.current = null; zoomingRef.current = null; controls.enabled = true; if (z === "moon" || z === "mars") onPick(z); }
      }
    }
    // project labels
    const refs: [BodyId, React.RefObject<THREE.Group | null>, number][] = [["earth", earthRef, 0.95], ["moon", moonRef, 0.5], ["mars", marsRef, 0.85]];
    for (const [id, ref, lift] of refs) {
      const el = nodes.current?.get(id), g = ref.current;
      if (!el || !g) continue;
      const v = scratch.current; g.getWorldPosition(v); v.y += lift; v.project(camera);
      const behind = v.z > 1;
      el.style.display = behind ? "none" : "flex";
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });

  return (
    <>
      <ambientLight intensity={0.12} />
      <Galaxy />
      <ShootingStars />
      <Sun />
      <Orbit r={4.4} /><Orbit r={7.4} />
      <group ref={earthOrbit} rotation={[0, 3.6, 0]}>
        <group position={[4.4, 0, 0]}>
          <Planet id="earth" r={0.72} tex="/textures/earth.jpg" hovered={hovered === "earth"} pickable={false} onHover={setHovered} onPick={() => {}} meshRef={earthRef} />
          <group ref={moonOrbit}>
            <group position={[1.55, 0.1, 0]}>
              <Planet id="moon" r={0.3} tex="/textures/moon.jpg" hovered={hovered === "moon"} pickable onHover={setHovered} onPick={() => { zoomingRef.current = "moon"; }} meshRef={moonRef} />
            </group>
          </group>
        </group>
      </group>
      <group ref={marsOrbit} rotation={[0, 0.5, 0]}>
        <group position={[7.4, 0, 0]}>
          <Planet id="mars" r={0.62} tex="/textures/mars.jpg" hovered={hovered === "mars"} pickable onHover={setHovered} onPick={() => { zoomingRef.current = "mars"; }} meshRef={marsRef} />
        </group>
      </group>
      <OrbitControls makeDefault enablePan={false} minDistance={4} maxDistance={30} maxPolarAngle={Math.PI * 0.55} />
    </>
  );
}

export default function SystemPicker({ onPick }: { onPick: (w: World) => void }) {
  const [hovered, setHovered] = useState<BodyId | null>(null);
  const zoomingRef = useRef<BodyId | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const facts = hovered ? FACTS[hovered] : null;
  return (
    <div className="relative w-full h-[520px] md:h-[600px]" data-tour="worlds">
      <Canvas camera={{ position: [0, 5.2, 11.5], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={["#02040a"]} />
        <React.Suspense fallback={null}>
          <System hovered={hovered} setHovered={setHovered} onPick={onPick} zoomingRef={zoomingRef} nodes={nodes} />
        </React.Suspense>
      </Canvas>
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {(["earth", "moon", "mars"] as BodyId[]).map((id) => (
          <div key={id} ref={(el) => { if (el) nodes.current.set(id, el); else nodes.current.delete(id); }} className={`holo-tag absolute left-0 top-0 ${hovered === id ? "is-hover" : ""}`} style={{ display: "none" }}>
            <span className="holo-name">{FACTS[id].title}</span>
            {FACTS[id].pick ? <span className="holo-sub">{hovered === id ? "click to open" : FACTS[id].line}</span> : <span className="holo-sub">{FACTS[id].line}</span>}
          </div>
        ))}
      </div>
      <div className="absolute right-4 bottom-4 flex gap-2">
        <button type="button" className="btn btn-sm" style={{ background: "rgba(8, 20, 34, 0.7)", color: "#e2f4ff", borderColor: "rgba(125, 211, 252, 0.4)" }} onClick={() => { zoomingRef.current = "moon"; }}>Open the Moon</button>
        <button type="button" className="btn btn-sm" style={{ background: "rgba(8, 20, 34, 0.7)", color: "#e2f4ff", borderColor: "rgba(125, 211, 252, 0.4)" }} onClick={() => { zoomingRef.current = "mars"; }}>Open Mars</button>
      </div>
      <div className="pointer-events-none absolute left-4 top-4 max-w-md on-canvas px-4 py-3 text-[13px] leading-relaxed rise" key={hovered ?? "none"}>
        {facts ? (<><b>{facts.title}.</b> {facts.detail}</>) : (<>Crews are going back to the Moon and on to Mars. Before any hardware flies it is tested on Earth, at places where the ground behaves like the destination. <b>Pick the Moon or Mars to start.</b> Drag to look around.</>)}
      </div>
    </div>
  );
}
