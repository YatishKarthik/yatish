import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const REDUCE = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const NOISE = /* glsl */ `
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n3(p); p *= 2.02; a *= 0.5; } return s; }`;

/** Sky dome: a soft band of coloured dust across a deep blue-black, drifting very slowly. */
function Nebula() {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `${NOISE}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float band = exp(-pow(d.y * 1.7 + 0.45 * sin(d.x * 2.2 + 1.0) - 0.1, 2.0) * 2.6);
        float cloud = fbm(d * 2.4 + 3.0), wisps = fbm(d * 6.0 + 11.0), hue = fbm(d * 1.2 + 7.0);
        vec3 violet = vec3(0.42, 0.16, 0.78), teal = vec3(0.08, 0.52, 0.72), rose = vec3(0.95, 0.38, 0.55), gold = vec3(1.0, 0.72, 0.38);
        vec3 col = vec3(0.012, 0.016, 0.04) + vec3(0.02, 0.03, 0.07) * (1.0 - abs(d.y));
        col += band * cloud * cloud * mix(violet, teal, smoothstep(0.35, 0.65, hue)) * 0.7;
        col += band * pow(wisps, 3.0) * mix(rose, gold, hue) * 0.3;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }), []);
  useFrame((_, dt) => { if (ref.current && !REDUCE) ref.current.rotation.y += dt * 0.004; });
  return <mesh ref={ref} material={mat} rotation={[0.35, 0.6, 0.2]}><sphereGeometry args={[95, 48, 32]} /></mesh>;
}

/** Stars with their own size, colour and twinkle. Fixed seed, so the sky is the same on every load. */
function Stars() {
  const { geo, mat } = useMemo(() => {
    let s = 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const n = 2600, pos = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n), col = new Float32Array(n * 3);
    const tints = [[1, 1, 1], [0.78, 0.86, 1], [1, 0.9, 0.76], [0.86, 0.8, 1], [1, 0.8, 0.82]];
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, q = Math.sqrt(1 - u * u), R = 80;
      pos.set([R * q * Math.cos(t), R * u, R * q * Math.sin(t)], i * 3);
      size[i] = 1.2 + Math.pow(rnd(), 6) * 5.5;
      phase[i] = rnd() * 6.283;
      col.set(tints[Math.floor(rnd() * tints.length)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uDpr: { value: Math.min(2, window.devicePixelRatio || 1) } },
      vertexShader: `attribute float aSize, aPhase; attribute vec3 aCol; uniform float uTime, uDpr; varying vec3 vCol; varying float vTw;
        void main() { vCol = aCol; vTw = 0.72 + 0.28 * sin(uTime * 1.6 + aPhase);
          gl_PointSize = aSize * uDpr * vTw; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vCol; varying float vTw;
        void main() { float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vCol * vTw, a * a); }`,
    });
    return { geo, mat };
  }, []);
  useFrame(({ clock }) => { if (!REDUCE) mat.uniforms.uTime.value = clock.elapsedTime; });
  return <points geometry={geo} material={mat} />;
}

/** A few shooting stars: one every few seconds, each gone in under a second. Off with reduced motion. */
function ShootingStars() {
  const pool = useRef<(THREE.Mesh | null)[]>([]);
  const state = useRef([0, 1, 2].map((i) => ({ t0: -10, dur: 0.8, from: new THREE.Vector3(), dir: new THREE.Vector3(), next: 1.5 + i * 2.3 })));
  const mats = useMemo(() => [0, 1, 2].map(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uFade: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uFade;
      void main() { float tail = pow(vUv.x, 2.2); float core = 1.0 - abs(vUv.y - 0.5) * 2.0;
        gl_FragColor = vec4(mix(vec3(0.6, 0.78, 1.0), vec3(1.0), vUv.x), tail * core * core * uFade); }`,
  })), []);
  useFrame(({ clock }) => {
    if (REDUCE) return;
    const now = clock.elapsedTime;
    state.current.forEach((s, i) => {
      const m = pool.current[i];
      if (!m) return;
      if (now > s.next) {
        // start somewhere in the upper sky and fall down and across
        const a = (200 + Math.random() * 50) * (Math.PI / 180) * (Math.random() < 0.5 ? 1 : -1);
        s.from.set(-14 + Math.random() * 28, 3 + Math.random() * 6, -22 - Math.random() * 10);
        s.dir.set(Math.cos(a < 0 ? Math.PI - a : a), -Math.abs(Math.sin(a)) - 0.25, 0).normalize();
        s.t0 = now; s.dur = 0.55 + Math.random() * 0.5; s.next = now + 2.5 + Math.random() * 5;
        m.rotation.z = Math.atan2(s.dir.y, s.dir.x);
      }
      const k = (now - s.t0) / s.dur;
      if (k >= 0 && k <= 1) {
        m.visible = true;
        m.position.copy(s.from).addScaledVector(s.dir, k * 16);
        mats[i].uniforms.uFade.value = Math.sin(k * Math.PI);
      } else m.visible = false;
    });
  });
  return <>{mats.map((mat, i) => (
    <mesh key={i} ref={(el) => { pool.current[i] = el; }} material={mat} visible={false}><planeGeometry args={[4.5, 0.07]} /></mesh>
  ))}</>;
}

/** Soft rim of light around a planet. */
export function Atmosphere({ r, colour, strength = 1 }: { r: number; colour: string; strength?: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uCol: { value: new THREE.Color(colour) }, uK: { value: strength } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; uniform vec3 uCol; uniform float uK;
      // brightest at the planet's limb, fading to nothing at the outer edge of the shell
      void main() { float i = pow(clamp(-dot(normalize(vN), normalize(vV)) * 3.0, 0.0, 1.0), 2.6); gl_FragColor = vec4(uCol * i * uK, i * uK); }`,
  }), [colour, strength]);
  return <mesh material={mat}><sphereGeometry args={[r * 1.07, 64, 48]} /></mesh>;
}

export function Galaxy() {
  return <><Nebula /><Stars /><ShootingStars /></>;
}
