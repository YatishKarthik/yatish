import { decode } from 'fast-png';
import * as THREE from 'three';
import { asset } from './load';
import type { Site, Target, TerrainMeta } from './types';

export interface Heightfield {
  size: number;            // pixels per side
  data: Float32Array;      // metres
  pixelM: number;
  sourceResM: number;
  thermalResM: number;
}
export interface TileSet {
  hf: Heightfield;
  colour: THREE.DataArrayTexture;   // 24 layers, one per hour
  sat: THREE.DataTexture;
  missing: string[];                // names of tiles that failed to load
}

const cache = new Map<string, Promise<TileSet>>();

async function fetchPng(url: string) {
  const res = await fetch(asset(url));
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return decode(new Uint8Array(await res.arrayBuffer()));
}

function toRGBA(img: { width: number; height: number; data: ArrayLike<number>; channels: number; depth: number }): Uint8Array<ArrayBuffer> {
  const n = img.width * img.height, out = new Uint8Array(n * 4), sh = img.depth === 16 ? 8 : 0;
  for (let i = 0; i < n; i++) {
    const c = img.channels, o = i * c;
    const r = img.data[o] >> sh, g = c >= 3 ? img.data[o + 1] >> sh : r, b = c >= 3 ? img.data[o + 2] >> sh : r;
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
  }
  return out;
}

/** Diagonal hatch used when a tile is missing, so a gap never looks like data. */
function hatch(size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = (x + y) % 8 < 2 ? 90 : 38, i = (y * size + x) * 4;
    out[i] = v; out[i + 1] = v; out[i + 2] = v + 6; out[i + 3] = 255;
  }
  return out;
}

async function loadHeight(url: string, meta: TerrainMeta | undefined, missing: string[]): Promise<Heightfield> {
  const m = meta ?? { z_min: 0, z_max: 0, pixel_m: 12, source_res_m: 100 };
  try {
    // Decoded from the raw bytes: an <img> would silently drop a 16-bit PNG to 8 bits.
    const img = await fetchPng(url);
    const max = img.depth === 16 ? 65535 : 255;
    const data = new Float32Array(img.width * img.height);
    for (let i = 0; i < data.length; i++) data[i] = m.z_min + (img.data[i * img.channels] / max) * (m.z_max - m.z_min);
    return { size: img.width, data, pixelM: m.pixel_m, sourceResM: m.source_res_m, thermalResM: m.thermal_res_m ?? m.source_res_m };
  } catch {
    missing.push('height');
    return { size: 2, data: new Float32Array(4), pixelM: (m.pixel_m * 256) / 2, sourceResM: m.source_res_m, thermalResM: m.thermal_res_m ?? m.source_res_m };
  }
}

async function loadColour(template: string, missing: string[]): Promise<THREE.DataArrayTexture> {
  let w = 8, h = 8, buf: Uint8Array<ArrayBuffer>;
  try {
    const imgs = await Promise.all(Array.from({ length: 24 }, (_, i) => fetchPng(template.replace('{h}', String(i)))));
    w = imgs[0].width; h = imgs[0].height;
    buf = new Uint8Array(w * h * 4 * 24);
    imgs.forEach((img, i) => buf.set(toRGBA(img), i * w * h * 4));
  } catch {
    missing.push('temperature');
    buf = new Uint8Array(w * h * 4 * 24);
    const one = hatch(w);
    for (let i = 0; i < 24; i++) buf.set(one, i * w * h * 4);
  }
  const tex = new THREE.DataArrayTexture(buf, w, h, 24);
  tex.format = THREE.RGBAFormat;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

async function loadSat(url: string | undefined, missing: string[]): Promise<THREE.DataTexture> {
  let w = 8, h = 8, buf: Uint8Array<ArrayBuffer>;
  try {
    if (!url) throw new Error('no satellite tile');
    const img = await fetchPng(url);
    w = img.width; h = img.height; buf = toRGBA(img);
  } catch {
    missing.push('satellite');
    buf = hatch(w);
  }
  const tex = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function loadTileSet(s: Site | Target): Promise<TileSet> {
  const key = s.terrain_tile;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const missing: string[] = [];
      const [hf, colour, sat] = await Promise.all([
        loadHeight(s.terrain_tile, s.terrain_meta, missing),
        loadColour(s.texture_tile, missing),
        loadSat(s.satellite_tile, missing),
      ]);
      return { hf, colour, sat, missing };
    })();
    cache.set(key, p);
  }
  return p;
}

// ---- heightfield sampling: one source for the picture, the hover readout and the rover trial ----

export const tileWidthM = (hf: Heightfield) => hf.size * hf.pixelM;

/** Bilinear height at (xm, ym) metres from the tile's north-west corner. */
export function heightAt(hf: Heightfield, xm: number, ym: number): number {
  const fx = Math.min(hf.size - 1, Math.max(0, xm / hf.pixelM - 0.5));
  const fy = Math.min(hf.size - 1, Math.max(0, ym / hf.pixelM - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(hf.size - 1, x0 + 1), y1 = Math.min(hf.size - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0, d = hf.data, n = hf.size;
  return (d[y0 * n + x0] * (1 - tx) + d[y0 * n + x1] * tx) * (1 - ty) + (d[y1 * n + x0] * (1 - tx) + d[y1 * n + x1] * tx) * ty;
}

/** Slope in degrees at a point, differenced over the source resolution (not the upsampled pixel). */
export function slopeAt(hf: Heightfield, xm: number, ym: number): number {
  const d = hf.sourceResM / 2;
  const dzdx = (heightAt(hf, xm + d, ym) - heightAt(hf, xm - d, ym)) / (2 * d);
  const dzdy = (heightAt(hf, xm, ym + d) - heightAt(hf, xm, ym - d)) / (2 * d);
  return (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
}

/** A square window of `extentM` centred in the tile; u,v in 0..1 map into it. */
export function cropPoint(hf: Heightfield, extentM: number, u: number, v: number): [number, number] {
  const off = (tileWidthM(hf) - extentM) / 2;
  return [off + u * extentM, off + v * extentM];
}

/** Elevation every `stepM` metres along a straight path given in crop coordinates. */
export function pathProfile(hf: Heightfield, extentM: number, a: [number, number], b: [number, number], stepM: number): Float32Array {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * extentM;
  const n = Math.max(2, Math.floor(len / stepM) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const [x, y] = cropPoint(hf, extentM, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
    out[i] = heightAt(hf, x, y);
  }
  return out;
}
