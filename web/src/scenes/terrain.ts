import * as THREE from 'three';
import { cropPoint, heightAt, tileWidthM, type Heightfield, type TileSet } from '../data/tiles';

export const EXAG = 2;            // vertical exaggeration, printed on screen
export const KM = 1 / 1000;       // scene units are kilometres

export function cropBase(hf: Heightfield, extentM: number): number {
  let min = Infinity;
  for (let j = 0; j <= 32; j++) for (let i = 0; i <= 32; i++) {
    const [x, y] = cropPoint(hf, extentM, i / 32, j / 32);
    min = Math.min(min, heightAt(hf, x, y));
  }
  return min;
}

/** Scene-space y for a height in metres. */
export const sceneY = (hM: number, baseM: number) => (hM - baseM) * EXAG * KM;

/** Displaced on the CPU once, so shading, picking and the rover all see the same surface. */
export function buildTerrainGeometry(hf: Heightfield, extentM: number, segments: number): THREE.BufferGeometry {
  const n = segments + 1, E = extentM * KM, base = cropBase(hf, extentM);
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), uvTile = new Float32Array(n * n * 2);
  const tw = tileWidthM(hf);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = i / segments, v = j / segments, k = j * n + i;
    const [xm, ym] = cropPoint(hf, extentM, u, v);
    pos[k * 3] = (u - 0.5) * E;
    pos[k * 3 + 1] = sceneY(heightAt(hf, xm, ym), base);
    pos[k * 3 + 2] = (v - 0.5) * E;
    uv[k * 2] = u; uv[k * 2 + 1] = v;
    uvTile[k * 2] = xm / tw; uvTile[k * 2 + 1] = ym / tw;
  }
  const idx = new Uint32Array(segments * segments * 6);
  let o = 0;
  for (let j = 0; j < segments; j++) for (let i = 0; i < segments; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('uvTile', new THREE.BufferAttribute(uvTile, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

const VERT = /* glsl */ `
attribute vec2 uvTile;
varying vec2 vUv; varying vec2 vUvTile; varying vec3 vN; varying vec3 vW;
void main() {
  vUv = uv; vUvTile = uvTile; vN = normal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uColour;
uniform sampler2D uSat;
uniform float uHour, uSatMix, uSeamX, uSide, uGrid, uGridN;
uniform vec3 uSun, uSunCol;
uniform float uDay, uRough;
float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), f.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), f.x), f.y);
}
varying vec2 vUv; varying vec2 vUvTile; varying vec3 vN; varying vec3 vW;
void main() {
  if (uSide != 0.0 && (vW.x - uSeamX) * uSide < 0.0) discard;
  float h = mod(uHour - 0.5 + 24.0, 24.0);
  float l0 = floor(h), l1 = mod(l0 + 1.0, 24.0), f = h - l0;
  vec3 temp = mix(texture(uColour, vec3(vUvTile, l0)).rgb, texture(uColour, vec3(vUvTile, l1)).rgb, f);
  vec3 sat = texture2D(uSat, vUvTile).rgb;
  float lam = max(dot(normalize(vN), uSun), 0.0);
  // satellite layer only: fine relief by surface class, so bedrock reads craggy and fines smooth
  vec2 q = vUv * 420.0;
  vec3 nb = normalize(vN + uRough * vec3(vn(q + vec2(0.5, 0.0)) - vn(q - vec2(0.5, 0.0)), 0.0, vn(q + vec2(0.0, 0.5)) - vn(q - vec2(0.0, 0.5))));
  float lamS = max(dot(nb, uSun), 0.0);
  // Temperature colour is data: shade it only lightly so the ramp stays readable. Satellite takes full shading.
  float shadeT = mix(0.86, 0.86 + 0.20 * lam, uDay);
  vec3 shadeS = mix(vec3(0.30), (0.35 + 0.80 * lamS) * uSunCol, uDay);
  // the layer change wipes left to right across the tile
  float wipe = clamp((uSatMix * 1.1 - vUv.x) / 0.1, 0.0, 1.0);
  vec3 col = mix(temp * shadeT, sat * shadeS, wipe);
  vec2 g = abs(fract(vUv * uGridN - 0.5) - 0.5) / fwidth(vUv * uGridN);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  col = mix(col, vec3(0.93), line * 0.4 * uGrid);
  gl_FragColor = vec4(col, 1.0);
}`;

export const CLASS_ROUGH: Record<string, number> = { fines: 0.02, crust: 0.08, gravel: 0.14, bedrock: 0.3 };

export function makeTerrainMaterial(tiles: TileSet, extentM: number, side: number, rough: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uColour: { value: tiles.colour },
      uSat: { value: tiles.sat },
      uHour: { value: 12 },
      uSatMix: { value: 0 },
      uSeamX: { value: 0 },
      uSide: { value: side },
      uGrid: { value: 0 },
      uGridN: { value: extentM / tiles.hf.sourceResM },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Vector3(1, 1, 1) },
      uRough: { value: rough },
      uDay: { value: 1 },
    },
  });
}

/** Sun direction for a local solar hour: east at 6, high in the south at 12, west at 18. */
export function sunAt(hour: number, out: THREE.Vector3): number {
  const a = ((hour - 6) / 12) * Math.PI, el = Math.sin(a);
  out.set(Math.cos(a), Math.max(el, 0) * 0.9 + 0.08, 0.35 * Math.max(el, 0)).normalize();
  return Math.min(1, Math.max(0, el / 0.15));
}

/** Sunlight colour: warm near sunrise and sunset, neutral at noon. */
export function sunColour(hour: number, out: THREE.Vector3): void {
  const el = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const warm = 1 - Math.min(1, el / 0.6);
  out.set(1, 1 - 0.28 * warm, 1 - 0.52 * warm);
}
