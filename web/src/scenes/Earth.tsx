import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { asset } from '../data/load';

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
