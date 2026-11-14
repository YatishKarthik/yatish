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

// sizes keep the real ordering (Sun ≫ Earth > Mars > Moon) without the real ratios, which would make the planets invisible
const SUN_R = 2.6, EARTH_R = 0.62, MARS_R = 0.4, MOON_R = 0.19, EARTH_ORBIT = 6.2, MARS_ORBIT = 9.4;

const rng = (seed: number) => { let s = seed % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; };

/* a soft radial glow drawn once, used for stars, nebulae and the comet head */
function glowTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!; const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner); grad.addColorStop(0.35, inner.replace(/,1\)$/, ",0.55)")); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* Three layers of stars: a dense Milky Way band, a sparse bright field, and a few big soft stars; plus coloured nebula patches. */
function Sky() {
  const sprite = useMemo(() => glowTexture(), []);
  const { band, field, bright } = useMemo(() => {
    const r = rng(7), c = new THREE.Color();
    const make = (n: number, place: () => [number, number, number], colour: () => THREE.Color) => {
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos.set(place(), i * 3); const k = colour(); col.set([k.r, k.g, k.b], i * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3)); return g;
    };
    const onSphere = (rad: number): [number, number, number] => { const a = r() * Math.PI * 2, p = Math.acos(2 * r() - 1); return [rad * Math.sin(p) * Math.cos(a), rad * Math.cos(p), rad * Math.sin(p) * Math.sin(a)]; };
    const bandPt = (): [number, number, number] => { const a = r() * Math.PI * 2, rad = 150 + r() * 30, spread = (r() + r() + r() - 1.5) * 22; const x = Math.cos(a) * rad, z = Math.sin(a) * rad; return [x, spread + Math.sin(a * 1.7) * 10, z]; };
    return {
      band: make(6000, bandPt, () => c.setHSL(0.58 + r() * 0.1, 0.35 + r() * 0.3, 0.72 + r() * 0.28).clone()),
      field: make(2500, () => onSphere(165 + r() * 25), () => c.setHSL(r() < 0.15 ? 0.08 : 0.6, 0.4, 0.8 + r() * 0.2).clone()),
      bright: make(140, () => onSphere(140), () => c.setHSL(r() < 0.3 ? 0.08 : 0.58, 0.5, 0.9).clone()),
    };
  }, []);
  const nebulae = useMemo(() => {
    const r = rng(23); const out: { p: [number, number, number]; s: number; c: string; o: number }[] = [];
    for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2; out.push({ p: [Math.cos(a) * 150, (r() - 0.5) * 50, Math.sin(a) * 150], s: 60 + r() * 70, c: ["#5b4bff", "#7c3aed", "#0ea5e9", "#f472b6", "#f59e0b"][i % 5], o: 0.10 + r() * 0.12 }); }
    return out;
  }, []);
  return (
    <group>
      <points geometry={band}><pointsMaterial size={1.3} sizeAttenuation vertexColors transparent opacity={0.85} depthWrite={false} map={sprite} alphaTest={0.01} /></points>
      <points geometry={field}><pointsMaterial size={2.0} sizeAttenuation vertexColors transparent opacity={0.95} depthWrite={false} map={sprite} alphaTest={0.01} /></points>
      <points geometry={bright}><pointsMaterial size={5.5} sizeAttenuation vertexColors transparent opacity={0.9} depthWrite={false} map={sprite} alphaTest={0.01} blending={THREE.AdditiveBlending} /></points>
      {nebulae.map((n, i) => <sprite key={i} position={n.p} scale={[n.s, n.s * 0.6, 1]}><spriteMaterial map={sprite} color={n.c} transparent opacity={n.o} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>)}
    </group>
  );
}

/* A comet crosses the far sky now and then: bright head, long tapering tail that points away from the sun. */
function Comet() {
  const ref = useRef<THREE.Group>(null);
  const st = useRef({ t: 6, wait: 14, from: new THREE.Vector3(), to: new THREE.Vector3(), live: false });
  const sprite = useMemo(() => glowTexture("rgba(220,240,255,1)"), []);
  useFrame((_, dt) => {
    const g = ref.current, s = st.current; if (!g) return;
    s.t += dt;
    if (!s.live && s.t > s.wait) {
      const a = Math.random() * Math.PI * 2;
      s.from.set(Math.cos(a) * 90, 25 + Math.random() * 30, Math.sin(a) * 90);
      s.to.set(Math.cos(a + 2.2) * 90, -10 + Math.random() * 20, Math.sin(a + 2.2) * 90);
      s.live = true; s.t = 0;
    }
    if (s.live) {
      const k = s.t / 9;
      if (k >= 1) { s.live = false; s.t = 0; s.wait = 16 + Math.random() * 14; g.visible = false; return; }
      g.visible = true;
      g.position.lerpVectors(s.from, s.to, k);
      // tail points away from the sun (origin)
      const away = g.position.clone().normalize();
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), away);
      const fade = Math.sin(k * Math.PI);
      g.children.forEach((c) => { const m = (c as THREE.Mesh).material as THREE.Material & { opacity: number }; m.opacity = fade * (c.type === "Sprite" ? 1 : 0.55); });
    }
  });
  return (
    <group ref={ref} visible={false}>
      <sprite scale={[3.2, 3.2, 1]}><spriteMaterial map={sprite} color="#e0f2fe" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
      <mesh position={[0, 9, 0]}><coneGeometry args={[0.9, 18, 12, 1, true]} /><meshBasicMaterial color="#9fd3ff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} /></mesh>
      <mesh position={[0, 7, 0]}><coneGeometry args={[0.35, 14, 10, 1, true]} /><meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} /></mesh>
    </group>
  );
}

/* brief meteor streaks, a few times a minute */
function Meteors() {
  const ref = useRef<THREE.Group>(null);
  const streaks = useRef(Array.from({ length: 3 }, (_, k) => ({ t: 10 + k * 4, pos: new THREE.Vector3(0, -999, 0), dir: new THREE.Vector3(0, -1, 0) })));
  useFrame((_, dt) => {
    const g = ref.current; if (!g) return;
    streaks.current.forEach((st, k) => {
      st.t += dt;
      const m = g.children[k] as THREE.Mesh;
      if (st.t > 6 + k * 3) { st.t = -3 - Math.random() * 6; st.pos.set((Math.random() - 0.5) * 140, 30 + Math.random() * 40, -70 - Math.random() * 40); st.dir.set(-1 - Math.random(), -0.5 - Math.random() * 0.5, 0.2).normalize(); }
      const live = st.t > 0 && st.t < 1.1;
      m.visible = live;
      if (live) { st.pos.addScaledVector(st.dir, dt * 80); m.position.copy(st.pos); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), st.dir); (m.material as THREE.MeshBasicMaterial).opacity = Math.sin((st.t / 1.1) * Math.PI) * 0.9; }
    });
  });
  return <group ref={ref}>{[0, 1, 2].map((k) => <mesh key={k} visible={false}><cylinderGeometry args={[0.02, 0.14, 10, 6]} /><meshBasicMaterial color="#e0f2fe" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>)}</group>;
}

/* The Sun: granulated photosphere with limb darkening, a chromosphere rim and a wide soft corona. */
function Sun() {
  const sunRef = useRef<THREE.Mesh>(null);
  const corona = useMemo(() => glowTexture("rgba(255,214,150,1)", "rgba(255,160,60,0)"), []);
  const surface = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float noise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
      void main(){
        vec3 p = normalize(vP);
        float g = fbm(p * 5.0 + uT * 0.04);                 // granulation
        float cells = smoothstep(0.35, 0.7, fbm(p * 12.0 - uT * 0.06));
        float spots = smoothstep(0.62, 0.7, fbm(p * 3.0 + 7.0)) * 0.6;  // a few darker regions
        float mu = max(dot(vN, vV), 0.0);
        float limb = 0.35 + 0.65 * pow(mu, 0.6);           // limb darkening
        vec3 hot = vec3(1.0, 0.97, 0.85), warm = vec3(1.0, 0.62, 0.18), dark = vec3(0.55, 0.2, 0.05);
        vec3 c = mix(warm, hot, g * 0.7 + cells * 0.3);
        c = mix(c, dark, spots);
        c *= limb;
        c += vec3(1.0, 0.5, 0.2) * pow(1.0 - mu, 3.0) * 0.6;   // rim glow
        gl_FragColor = vec4(c, 1.0); }`,
  }), []);
  useFrame(({ clock }) => { const m = sunRef.current?.material as THREE.ShaderMaterial | undefined; if (m) m.uniforms.uT.value = clock.elapsedTime; });
  return (
    <group>
      <mesh ref={sunRef} material={surface}><sphereGeometry args={[SUN_R, 96, 96]} /></mesh>
      <sprite scale={[SUN_R * 5.2, SUN_R * 5.2, 1]}><spriteMaterial map={corona} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
      <sprite scale={[SUN_R * 2.6, SUN_R * 2.6, 1]}><spriteMaterial map={corona} color="#fff1c2" transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
      <pointLight intensity={160} distance={90} decay={1.5} color="#fff4df" />
    </group>
  );
}

function Orbit({ r }: { r: number }) {
  return <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[r - 0.015, r + 0.015, 220]} /><meshBasicMaterial color="#9fc3d6" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} /></mesh>;
}

function Planet({ id, r, tex, children, onHover, onPick, hovered, pickable, meshRef }: {
  id: BodyId; r: number; tex: string; children?: React.ReactNode; onHover: (b: BodyId | null) => void; onPick: (b: BodyId) => void; hovered: boolean; pickable: boolean; meshRef: React.RefObject<THREE.Group | null>;
}) {
  const raw = useLoader(THREE.TextureLoader, tex);
  const map = useMemo(() => { const t = raw.clone(); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t; }, [raw]);
  const spin = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => { if (spin.current) spin.current.rotation.y += dt * 0.12; });
  const tint = id === "earth" ? "#7dd3fc" : id === "mars" ? "#fb923c" : "#cbd5e1";
  return (
    <group ref={meshRef}>
      <mesh ref={spin}
        onClick={(e) => { e.stopPropagation(); if (pickable) onPick(id); }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(id); document.body.style.cursor = pickable ? "pointer" : "default"; }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = "default"; }}>
        <sphereGeometry args={[r, 64, 64]} />
        {/* a touch of emissive keeps the night side readable and the colours rich */}
        <meshStandardMaterial map={map} bumpMap={map} bumpScale={0.02} roughness={0.85} metalness={0.02} emissive={new THREE.Color(tint)} emissiveMap={map} emissiveIntensity={0.28} />
      </mesh>
      {pickable && (
        <mesh visible={false} onClick={(e) => { e.stopPropagation(); onPick(id); }} onPointerOver={(e) => { e.stopPropagation(); onHover(id); document.body.style.cursor = "pointer"; }} onPointerOut={() => { onHover(null); document.body.style.cursor = "default"; }}>
          <sphereGeometry args={[r * 2.4, 12, 12]} />
        </mesh>
      )}
      <mesh scale={1.08}><sphereGeometry args={[r, 32, 32]} /><meshBasicMaterial color={tint} transparent opacity={hovered ? 0.18 : 0.07} side={THREE.BackSide} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
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
      if (earthOrbit.current) earthOrbit.current.rotation.y += dt * 0.02;
      if (marsOrbit.current) marsOrbit.current.rotation.y += dt * 0.014;
      if (moonOrbit.current) moonOrbit.current.rotation.y += dt * 0.22;
    }
    const z = zoomingRef.current;
    if (z && controls) {
      const g = z === "moon" ? moonRef.current : marsRef.current;
      if (g) {
        if (t0.current == null) t0.current = clock.elapsedTime;
        const k = Math.min(1, (clock.elapsedTime - t0.current) / 1.1), e = 1 - Math.pow(1 - k, 3);
        const target = g.getWorldPosition(new THREE.Vector3());
        const off = camera.position.clone().sub(controls.target).normalize().multiplyScalar(z === "moon" ? 1.0 : 2.0);
        controls.target.lerp(target, e * 0.2 + 0.05);
        camera.position.lerp(target.clone().add(off), e * 0.2 + 0.05);
        controls.enabled = false; controls.update();
        if (k >= 1) { t0.current = null; zoomingRef.current = null; controls.enabled = true; if (z === "moon" || z === "mars") onPick(z); }
      }
    }
    const refs: [BodyId, React.RefObject<THREE.Group | null>, number][] = [["earth", earthRef, EARTH_R + 0.3], ["moon", moonRef, MOON_R + 0.25], ["mars", marsRef, MARS_R + 0.3]];
    for (const [id, ref, lift] of refs) {
      const el = nodes.current?.get(id), g = ref.current;
      if (!el || !g) continue;
      const v = scratch.current; g.getWorldPosition(v); v.y += lift; v.project(camera);
      el.style.display = v.z > 1 ? "none" : "flex";
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });

  return (
    <>
      <ambientLight intensity={0.08} />
      <Sky />
      <Meteors />
      <Comet />
      <Sun />
      <Orbit r={EARTH_ORBIT} /><Orbit r={MARS_ORBIT} />
      <group ref={earthOrbit} rotation={[0, 3.7, 0]}>
        <group position={[EARTH_ORBIT, 0, 0]}>
          <Planet id="earth" r={EARTH_R} tex="/textures/earth.jpg" hovered={hovered === "earth"} pickable={false} onHover={setHovered} onPick={() => {}} meshRef={earthRef} />
          <group ref={moonOrbit}>
            <group position={[1.5, 0.08, 0]}>
              <Planet id="moon" r={MOON_R} tex="/textures/moon.jpg" hovered={hovered === "moon"} pickable onHover={setHovered} onPick={() => { zoomingRef.current = "moon"; }} meshRef={moonRef} />
            </group>
          </group>
        </group>
      </group>
      <group ref={marsOrbit} rotation={[0, 0.55, 0]}>
        <group position={[MARS_ORBIT, 0, 0]}>
          <Planet id="mars" r={MARS_R} tex="/textures/mars.jpg" hovered={hovered === "mars"} pickable onHover={setHovered} onPick={() => { zoomingRef.current = "mars"; }} meshRef={marsRef} />
        </group>
      </group>
      <OrbitControls makeDefault enablePan={false} minDistance={5} maxDistance={40} maxPolarAngle={Math.PI * 0.56} />
    </>
  );
}

export default function SystemPicker({ onPick }: { onPick: (w: World) => void }) {
  const [hovered, setHovered] = useState<BodyId | null>(null);
  const zoomingRef = useRef<BodyId | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const facts = hovered ? FACTS[hovered] : null;
  return (
    <div className="relative w-full h-[560px] md:h-[640px]" data-tour="worlds" style={{ background: "#01030a" }}>
      <Canvas camera={{ position: [0, 6.8, 15.5], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}>
        <color attach="background" args={["#01030a"]} />
        <React.Suspense fallback={null}>
          <System hovered={hovered} setHovered={setHovered} onPick={onPick} zoomingRef={zoomingRef} nodes={nodes} />
        </React.Suspense>
      </Canvas>
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {(["earth", "moon", "mars"] as BodyId[]).map((id) => (
          <div key={id} ref={(el) => { if (el) nodes.current.set(id, el); else nodes.current.delete(id); }} className={`holo-tag absolute left-0 top-0 ${hovered === id ? "is-hover" : ""}`} style={{ display: "none" }}>
            <span className="holo-name">{FACTS[id].title}</span>
            <span className="holo-sub">{FACTS[id].pick && hovered === id ? "click to open" : FACTS[id].line}</span>
          </div>
        ))}
      </div>
      <div className="absolute right-4 bottom-4 flex gap-2">
        <button type="button" className="btn btn-sm" style={{ background: "rgba(8, 20, 34, 0.7)", color: "#e2f4ff", borderColor: "rgba(125, 211, 252, 0.4)" }} onClick={() => { zoomingRef.current = "moon"; }}>Open the Moon</button>
        <button type="button" className="btn btn-sm" style={{ background: "rgba(8, 20, 34, 0.7)", color: "#e2f4ff", borderColor: "rgba(125, 211, 252, 0.4)" }} onClick={() => { zoomingRef.current = "mars"; }}>Open Mars</button>
      </div>
      <div className="pointer-events-none absolute left-4 top-4 max-w-md on-canvas px-4 py-3 text-[13px] leading-relaxed rise" key={hovered ?? "none"}>
        {facts ? (<><b>{facts.title}.</b> {facts.detail}</>) : (<>Crews are going back to the Moon and on to Mars. Before any hardware flies it is tested on Earth, at places where the ground behaves like the destination. <b>Pick the Moon or Mars to start.</b> Drag to look around, scroll to zoom.</>)}
      </div>
    </div>
  );
}
