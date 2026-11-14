import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { asset } from '../data/load';
import { NOISE } from './Galaxy';

export const SUN_DIR = new THREE.Vector3(-4, 2.5, 9).normalize();

/**
 * Earth with glossy oceans, relief, and city lights that only show on the night side.
 * The night mask is injected into the standard material so lighting stays physically based.
 */
export function EarthMaterial() {
  const [map, night, rough, bump] = useTexture([asset('textures/earth.jpg'), asset('textures/earth-night.jpg'), asset('textures/earth-rough.jpg'), asset('textures/earth-bump.jpg')]);
  map.colorSpace = THREE.SRGBColorSpace;
  night.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, night, rough, bump]) { t.anisotropy = 16; t.generateMipmaps = true; }
  const uSun = useMemo(() => ({ value: new THREE.Vector3() }), []);
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map, roughnessMap: rough, bumpMap: bump, bumpScale: 0.012, metalness: 0, emissiveMap: night, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 1.3 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uSun = uSun;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldN;').replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWorldN = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSun; varying vec3 vWorldN;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  float nightSide = 1.0 - smoothstep(-0.12, 0.08, dot(normalize(vWorldN), uSun));\n  totalEmissiveRadiance *= nightSide;');
    };
    return m;
  }, [map, night, rough, bump, uSun]);
  useFrame(() => { uSun.value.copy(SUN_DIR); });
  return <primitive object={mat} attach="material" />;
}

/** The star that lights the scene: a bright disc with a soft corona, placed along the light direction. */
export function Sun() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float disc = smoothstep(0.08, 0.05, d);
        float corona = pow(max(0.0, 1.0 - d), 3.5) * 0.9;
        vec3 col = vec3(1.0, 0.96, 0.88) * disc * 4.0 + vec3(1.0, 0.82, 0.6) * corona;
        gl_FragColor = vec4(col, max(disc, corona));
      }`,
  }), []);
  const pos = useMemo(() => SUN_DIR.clone().multiplyScalar(85), []);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => { ref.current?.quaternion.copy(camera.quaternion); });   // always faces the camera
  return (
    <mesh ref={ref} material={mat} position={pos} scale={[22, 22, 1]}><planeGeometry args={[1, 1]} /></mesh>
  );
}

/** Drifting cloud deck, generated from noise: thin enough to read the ground through. */
export function Clouds({ r }: { r: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uSun: { value: SUN_DIR.clone() }, uT: { value: 0 } },
    vertexShader: `varying vec3 vP; varying vec3 vWN; void main() { vP = normalize(position); vWN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `${NOISE}
      varying vec3 vP; varying vec3 vWN; uniform vec3 uSun; uniform float uT;
      void main() {
        vec3 q = vP * 3.2 + vec3(uT * 0.02, 0.0, uT * 0.013);
        float bands = 0.75 + 0.25 * cos(vP.y * 9.0);                      // more cloud in the storm belts
        float c = smoothstep(0.52, 0.78, fbm(q) * bands + 0.18 * fbm(q * 3.1));
        float lit = smoothstep(-0.15, 0.35, dot(normalize(vWN), uSun));
        gl_FragColor = vec4(vec3(1.0) * (0.08 + 0.92 * lit), c * 0.6);
      }`,
  }), []);
  useFrame(({ clock }) => { mat.uniforms.uT.value = clock.elapsedTime; });
  return <mesh ref={ref} material={mat}><sphereGeometry args={[r * 1.012, 96, 64]} /></mesh>;
}
