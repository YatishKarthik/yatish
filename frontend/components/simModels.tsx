"use client";

/* =====================================================================================
   3D models, thermal-camera materials and ground-hugging overlays for the simulator.

   Models (compressed with glTF-Transform, in /public/models):
     rover.glb   Curiosity rover, NASA 3D Resources (public domain)
     lander.glb  "Mars Polar Lander" by emin31284, CC BY 4.0
     beacon.glb  "Sci-Fi Beacon/Way Point Marker" by AMMediaGames, CC BY 4.0
     rocks.glb   "Low Poly Rocks" by Michael Hooper, CC BY 4.0 (nine rocks, split here)
   ===================================================================================== */
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";

export const MODELS = { rover: "/models/rover.glb", lander: "/models/lander.glb", beacon: "/models/beacon.glb", rocks: "/models/rocks.glb" };
Object.values(MODELS).forEach((u) => useGLTF.preload(u));

/* Clone a loaded scene and wrap it so it is `size` long on the chosen axis, centred, with its lowest point at `bottom`. */
function fitClone(scene: THREE.Object3D, size: number, axis: "x" | "y" | "z" | "max", bottom: number, rotY = 0, cloneMaterials = false): THREE.Group {
  const inner = scene.clone(true);
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true; m.receiveShadow = true;
      if (cloneMaterials) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    }
  });
  const turn = new THREE.Group(); turn.rotation.y = rotY; turn.add(inner); turn.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(turn, true), dim = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const ref = axis === "max" ? Math.max(dim.x, dim.y, dim.z) : dim[axis];
  const s = size / (ref || 1);
  const outer = new THREE.Group();
  turn.position.set(-c.x, -box.min.y, -c.z);
  const scaler = new THREE.Group(); scaler.scale.setScalar(s); scaler.add(turn);
  outer.add(scaler); outer.position.y = bottom;
  return outer;
}

/* ---------------------------------------------------------------- thermal materials */
const INFERNO = /* glsl */ `
vec3 inferno(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.0, 0.0, 0.03), c1 = vec3(0.24, 0.04, 0.42), c2 = vec3(0.70, 0.18, 0.36), c3 = vec3(0.97, 0.50, 0.06), c4 = vec3(1.0, 0.97, 0.66);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}`;
export const INFERNO_CSS = "linear-gradient(90deg, #000008, #3d0a6b, #b32e5c, #f7800f, #fff7a8)";

/* Terrain in thermal view: each vertex carries its modelled surface temperature, normalised to the legend range. */
export function makeTerrainThermalMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */ `
      attribute float temp; varying float vT; varying vec3 vW;
      void main() { vT = temp; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      varying float vT; varying vec3 vW; ${INFERNO}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main() { float g = (vnoise(vW.xz * 1.3) - 0.5) * 0.03 + (vnoise(vW.xz * 5.0) - 0.5) * 0.012; gl_FragColor = vec4(inferno(vT + g), 1.0); }`,
  });
}

/* Objects in thermal view: a body temperature, plus a hot zone near the object's base (motors, wheels, engine bell, drill bit). */
export function makeObjectThermalMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uBase: { value: 0.3 }, uHot: { value: 0.3 }, uBaseY: { value: 0 }, uHotH: { value: 0.6 } },
    vertexShader: /* glsl */ `
      varying float vY; varying vec3 vN;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uBase, uHot, uBaseY, uHotH; varying float vY; varying vec3 vN; ${INFERNO}
      void main() {
        float zone = 1.0 - smoothstep(uBaseY, uBaseY + uHotH, vY);
        float t = mix(uBase, max(uBase, uHot), zone) + vN.y * 0.03;
        gl_FragColor = vec4(inferno(t), 1.0);
      }`,
  });
}

/* Swap every mesh under `ref` to `mat` while `on`; restore the originals afterwards. */
export function useMaterialSwap(ref: React.RefObject<THREE.Object3D | null>, on: boolean, mat: THREE.Material, ready: unknown) {
  useEffect(() => {
    const g = ref.current; if (!g || !on) return;
    const saved: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.keepMaterial) { saved.push([m, m.material]); m.material = mat; } });
    return () => { saved.forEach(([m, orig]) => { m.material = orig; }); };
  }, [ref, on, mat, ready]);
}

/* ---------------------------------------------------------------- models */
export function RoverModel() {
  const { scene } = useGLTF(MODELS.rover);
  // Curiosity faces +Z in the file; the simulator drives towards -Z. 1.75 m long, wheels on the ground at -0.26.
  const obj = useMemo(() => fitClone(scene, 1.75, "z", -0.27, Math.PI), [scene]);
  return <primitive object={obj} />;
}

export function LanderModel() {
  const { scene } = useGLTF(MODELS.lander);
  const obj = useMemo(() => fitClone(scene, 2.7, "x", -0.6), [scene]);
  return <primitive object={obj} />;
}

/* A waypoint: the beacon model, tinted by state, with one slim fading light beam on the next waypoint only. */
export function BeaconModel({ state }: { state: "done" | "next" | "later" }) {
  const { scene } = useGLTF(MODELS.beacon);
  const obj = useMemo(() => fitClone(scene, 2.0, "y", 0, 0, true), [scene]);
  const col = state === "done" ? "#34d399" : state === "next" ? "#67e8f9" : "#94a3b8";
  const mats = useMemo(() => {
    const out: THREE.MeshStandardMaterial[] = [];
    obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { if ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial) out.push(x as THREE.MeshStandardMaterial); }); });
    return out;
  }, [obj]);
  const beamRef = useRef<THREE.Mesh>(null);
  const beamMat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color("#67e8f9") } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main() { float a = (1.0 - vUv.y) * (1.0 - vUv.y) * (0.16 + 0.05 * sin(uTime * 3.0)); gl_FragColor = vec4(uColor, a); }`,
  }), []);
  useEffect(() => { mats.forEach((m) => { m.emissive = new THREE.Color(col); }); }, [mats, col]);
  useFrame(({ clock }) => {
    const pulse = state === "next" ? 1.8 + Math.sin(clock.elapsedTime * 3) * 0.8 : state === "done" ? 0.9 : 0.25;
    mats.forEach((m) => { m.emissiveIntensity = pulse; });
    const bm = beamRef.current?.material as THREE.ShaderMaterial | undefined;
    if (bm) bm.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <group>
      <primitive object={obj} />
      {state === "next" && <mesh ref={beamRef} position={[0, 5.2, 0]} material={beamMat} userData={{ keepMaterial: true }}><cylinderGeometry args={[0.06, 0.18, 7, 12, 1, true]} /></mesh>}
    </group>
  );
}

/* The nine rocks in rocks.glb are one mesh; split them into separate geometries once. */
function splitComponents(src: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const g = src.index ? src : src.clone();
  const pos = g.attributes.position, idx = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
  const parent = Array.from({ length: pos.count }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let i = 0; i < idx.length; i += 3) { unite(idx[i], idx[i + 1]); unite(idx[i], idx[i + 2]); }
  const byPos = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) { const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`; const j = byPos.get(k); if (j === undefined) byPos.set(k, i); else unite(j, i); }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < idx.length; i += 3) { const r = find(idx[i]); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(idx[i], idx[i + 1], idx[i + 2]); }
  const out: THREE.BufferGeometry[] = [];
  groups.forEach((tri) => {
    const geo = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name], n = a.itemSize, arr = new Float32Array(tri.length * n);
      tri.forEach((v, k) => { for (let c = 0; c < n; c++) arr[k * n + c] = a.getComponent(v, c); });
      geo.setAttribute(name, new THREE.BufferAttribute(arr, n));
    }
    geo.computeBoundingBox(); const bb = geo.boundingBox!, c = bb.getCenter(new THREE.Vector3());
    geo.translate(-c.x, -bb.min.y, -c.z);
    const d = bb.getSize(new THREE.Vector3()), s = 1 / Math.max(d.x, d.z, 1e-3);
    geo.scale(s, s, s); geo.computeVertexNormals();
    out.push(geo);
  });
  return out;
}

export function useRockParts(): { geos: THREE.BufferGeometry[]; material: THREE.Material } {
  const { scene } = useGLTF(MODELS.rocks);
  return useMemo(() => {
    let mesh: THREE.Mesh | null = null;
    scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
    const m = mesh as THREE.Mesh | null;
    if (!m) return { geos: [new THREE.IcosahedronGeometry(0.5, 1)], material: new THREE.MeshStandardMaterial({ color: "#6f655c" }) };
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    return { geos: splitComponents(m.geometry), material: mat };
  }, [scene]);
}

/* ---------------------------------------------------------------- ground overlays */
type HeightFn = (x: number, z: number) => number;

/* A ring (or disc when r0 = 0) whose every vertex sits on the terrain, so it never cuts through slopes. */
export function GroundRing({ cx, cz, r0, r1, color, opacity, height, lift = 0.06 }: { cx: number; cz: number; r0: number; r1: number; color: string; opacity: number; height: HeightFn; lift?: number }) {
  const geo = useMemo(() => {
    const seg = 72, rings = r0 > 0 ? 2 : 6, pos: number[] = [], index: number[] = [];
    for (let j = 0; j < rings; j++) {
      const r = r0 > 0 ? (j === 0 ? r0 : r1) : (r1 * j) / (rings - 1);
      for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; pos.push(x, height(x, z) + lift, z); }
    }
    for (let j = 0; j < rings - 1; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + seg + 1; index.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(index); return g;
  }, [cx, cz, r0, r1, height, lift]);
  return (
    <mesh geometry={geo} renderOrder={2} userData={{ keepMaterial: true }}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  );
}

/* The route: a thin holographic ribbon that follows the ground. Only the current leg is bright and the next one faint;
   finished legs disappear. A soft pulse flows along it towards the next waypoint. */
export function RouteRibbon({ points, height, leg }: { points: { x: number; z: number }[]; height: HeightFn; leg: number }) {
  const geo = useMemo(() => {
    const pos: number[] = [], legA: number[] = [], distA: number[] = [], side: number[] = [], index: number[] = [];
    const half = 0.16;
    let base = 0;
    for (let l = 0; l < points.length - 1; l++) {
      const a = points[l], b = points[l + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
      const steps = Math.max(2, Math.ceil(len / 0.5));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, x = a.x + dx * t, z = a.z + dz * t, d = len * t;
        for (const s of [-1, 1]) { const px = x + nx * half * s, pz = z + nz * half * s; pos.push(px, height(px, pz) + 0.22, pz); legA.push(l); distA.push(d); side.push(s > 0 ? 1 : 0); }
        if (i < steps) { const v = base + i * 2; index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
      }
      base += (steps + 1) * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aLeg", new THREE.Float32BufferAttribute(legA, 1));
    g.setAttribute("aDist", new THREE.Float32BufferAttribute(distA, 1));
    g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
    g.setIndex(index);
    return g;
  }, [points, height]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uLeg: { value: 0 } },
    vertexShader: /* glsl */ `attribute float aLeg, aDist, aSide; varying float vLeg, vDist, vSide;
      void main() { vLeg = aLeg; vDist = aDist; vSide = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime, uLeg; varying float vLeg, vDist, vSide;
      void main() {
        float rel = vLeg - uLeg;
        if (rel < -0.5 || rel > 1.5) discard;
        float strength = rel < 0.5 ? 0.5 : 0.14;
        float across = 1.0 - abs(vSide * 2.0 - 1.0);
        float core = smoothstep(0.0, 1.0, across);
        float f = fract(vDist * 0.22 - uTime * 0.45);
        float pulse = 0.55 + 0.45 * smoothstep(0.0, 0.15, f) * (1.0 - smoothstep(0.15, 0.55, f));
        gl_FragColor = vec4(vec3(0.55, 0.92, 1.0), strength * core * pulse);
      }`,
  }), []);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { const m = ref.current?.material as THREE.ShaderMaterial | undefined; if (m) { m.uniforms.uTime.value = clock.elapsedTime; m.uniforms.uLeg.value = leg; } });
  return <mesh ref={ref} geometry={geo} material={mat} renderOrder={3} userData={{ keepMaterial: true }} />;
}
