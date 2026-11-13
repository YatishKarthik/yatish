// Fetches REAL terrain and imagery for the tiles from open data on AWS, so the 3D view shows actual ground.
//   Earth elevation : Copernicus DEM GLO-30 (ESA; © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018)
//   Earth imagery   : Sentinel-2 L2A true colour (contains modified Copernicus Sentinel data)
//   Mars elevation and imagery : USGS Astrogeology CTX stereo DTMs and orthoimages (NASA/JPL/MSSS/USGS)
// Writes height.png, sat.png and source.json per tile. Scores and thermal curves stay mock; run `npm run mock` after this.
import { fromUrl } from 'geotiff';
import { encode } from 'fast-png';
import proj4 from 'proj4';
import mgrs from 'mgrs';
const toMgrs = mgrs.forward;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SIZE = 256, EXTENT_M = 3000;
const only = process.argv.slice(2);

const EARTH = [
  { id: 'dune_a', lat: 23.02, lon: 53.80 },
  { id: 'gravel_plain_b', lat: 22.30, lon: 57.60 },
  { id: 'sabkha_c', lat: 23.40, lon: 52.30 },
  { id: 'ridge_d', lat: 23.05, lon: 58.45 },
  { id: 'farm_liwa', lat: 23.13, lon: 53.78 },
];
const CTX = 'https://astrogeo-ard.s3-us-west-2.amazonaws.com/mars/mro/ctx/controlled/usgs/';
const MARS = [
  { id: 'jezero', lat: 18.44, lon: 77.50, product: 'J10_048842_1986_XN_18N282W__J11_048908_1986_XN_18N282W' },
  { id: 'gale', lat: -4.59, lon: 137.44, product: 'D03_028335_1754_XI_04S222W__D03_028269_1752_XI_04S222W' },
  { id: 'arcadia', lat: 39.40, lon: -170.40, product: 'N05_064174_2195_XN_39N170W__N05_064464_2195_XN_39N170W' },
];

/** Read a ground window [minX, minY, maxX, maxY] in the image's own CRS, resampled to SIZE x SIZE. */
async function readWindow(url, box, samples) {
  const tiff = await fromUrl(url);
  const img = await tiff.getImage();
  const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
  const win = [Math.floor((box[0] - ox) / rx), Math.floor((box[3] - oy) / ry), Math.ceil((box[2] - ox) / rx), Math.ceil((box[1] - oy) / ry)];
  const data = await img.readRasters({ window: win, width: SIZE, height: SIZE, resampleMethod: 'bilinear', samples, interleave: true, fillValue: img.getGDALNoData() ?? 0 });
  return { data, nodata: img.getGDALNoData(), srcRes: Math.abs(rx) };
}

/** Replace nodata by the nearest valid value along the row, so holes never render as cliffs. */
function fillHoles(h, nodata) {
  let holes = 0;
  const bad = (v) => !Number.isFinite(v) || v === nodata || v < -1e4;
  for (let y = 0; y < SIZE; y++) {
    let last = NaN;
    for (let x = 0; x < SIZE; x++) { const i = y * SIZE + x; if (bad(h[i])) { holes++; h[i] = last; } else last = h[i]; }
    for (let x = SIZE - 1; x >= 0; x--) { const i = y * SIZE + x; if (Number.isNaN(h[i])) h[i] = last; else last = h[i]; }
  }
  for (let i = 0; i < h.length; i++) if (Number.isNaN(h[i])) h[i] = h[(i + SIZE) % h.length] || 0;
  return holes / h.length;
}

function writeTile(dir, h, rgb, source) {
  let zMin = Infinity, zMax = -Infinity;
  for (const v of h) { if (v < zMin) zMin = v; if (v > zMax) zMax = v; }
  const h16 = new Uint16Array(SIZE * SIZE);
  for (let i = 0; i < h.length; i++) h16[i] = Math.round(((h[i] - zMin) / (zMax - zMin || 1)) * 65535);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'height.png'), encode({ width: SIZE, height: SIZE, data: h16, channels: 1, depth: 16 }));
  fs.writeFileSync(path.join(dir, 'sat.png'), encode({ width: SIZE, height: SIZE, data: rgb, channels: 3, depth: 8 }));
  fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify({ ...source, z_min: +zMin.toFixed(2), z_max: +zMax.toFixed(2), pixel_m: +(EXTENT_M / SIZE).toFixed(3) }, null, 1));
  console.log(`${path.basename(dir)}: relief ${(zMax - zMin).toFixed(0)} m, ${source.elevation} + ${source.imagery}`);
}

async function earth(s) {
  // elevation: one-degree Copernicus GLO-30 tile, geographic coordinates
  const ns = s.lat >= 0 ? 'N' : 'S', ew = s.lon >= 0 ? 'E' : 'W';
  const name = `Copernicus_DSM_COG_10_${ns}${String(Math.floor(Math.abs(s.lat))).padStart(2, '0')}_00_${ew}${String(Math.floor(Math.abs(s.lon))).padStart(3, '0')}_00_DEM`;
  const dLat = EXTENT_M / 2 / 111320, dLon = dLat / Math.cos((s.lat * Math.PI) / 180);
  const dem = await readWindow(`https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`, [s.lon - dLon, s.lat - dLat, s.lon + dLon, s.lat + dLat]);
  const h = Float32Array.from(dem.data);
  fillHoles(h, dem.nodata);

  // imagery: least cloudy Sentinel-2 scene of a dry month over this MGRS square
  const m = toMgrs([s.lon, s.lat], 0).match(/^(\d+)([A-Z])([A-Z]{2})/);
  // a 100 km square that straddles a latitude-band edge is filed under the neighbouring band letter, so try those too
  const S2 = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/';
  const BANDS = 'CDEFGHJKLMNPQRSTUVWX', bi = BANDS.indexOf(m[2]);
  let scenes = [];
  search: for (const band of [m[2], BANDS[bi - 1], BANDS[bi + 1]]) for (const month of ['2023/10', '2023/9', '2023/11', '2022/10']) {
    const listing = await (await fetch(`${S2}?list-type=2&delimiter=/&prefix=sentinel-s2-l2a-cogs/${m[1]}/${band}/${m[3]}/${month}/`)).text();
    scenes = [...listing.matchAll(/<Prefix>([^<]+_L2A\/)<\/Prefix>/g)].map((x) => x[1]).slice(0, 14);
    if (scenes.length) break search;
  }
  if (!scenes.length) throw new Error(`no Sentinel-2 scenes for square ${m[1]}${m[2]}${m[3]}`);
  const utm = `+proj=utm +zone=${m[1]} +datum=WGS84 +units=m +no_defs`;
  const [cx, cy] = proj4('WGS84', utm, [s.lon, s.lat]);
  const box = [cx - EXTENT_M / 2, cy - EXTENT_M / 2, cx + EXTENT_M / 2, cy + EXTENT_M / 2];
  // rank by cloud cover, then take the first scene whose window actually has data (swath edges are empty)
  const ranked = (await Promise.all(scenes.map(async (sc) => {
    const id = sc.split('/').filter(Boolean).pop();
    try { return { sc, id, cloud: (await (await fetch(`${S2}${sc}${id}.json`)).json()).properties['eo:cloud_cover'] ?? 100 }; } catch { return { sc, id, cloud: 100 }; }
  }))).sort((a, b) => a.cloud - b.cloud);
  let rgb, used;
  for (const r of ranked) {
    const tci = await readWindow(`${S2}${r.sc}TCI.tif`, box, [0, 1, 2]);
    let empty = 0;
    for (let i = 0; i < tci.data.length; i += 3) if (tci.data[i] + tci.data[i + 1] + tci.data[i + 2] === 0) empty++;
    if (empty / (SIZE * SIZE) < 0.02) {
      // bright desert sits near the top of the 8-bit range: scale brightness only, so hue is untouched
      const mx = [];
      for (let i = 0; i < tci.data.length; i += 3) mx.push(Math.max(tci.data[i], tci.data[i + 1], tci.data[i + 2]));
      mx.sort((a, b) => a - b);
      const k = Math.min(1, 215 / mx[Math.floor(mx.length * 0.98)]);
      rgb = Uint8Array.from(tci.data, (v) => Math.round(v * k));
      used = r; break;
    }
  }
  if (!rgb) throw new Error(`no Sentinel-2 scene with data over ${s.id}`);
  writeTile(path.join(PUB, 'tiles', 'earth', s.id), h, rgb, {
    real: true, centre: { lat: s.lat, lon: s.lon }, extent_m: EXTENT_M, source_res_m: 30,
    elevation: 'Copernicus DEM GLO-30', imagery: `Sentinel-2 L2A ${used.id}`, imagery_res_m: 10,
  });
}

async function mars(t) {
  // Mars 2015 sphere, equirectangular, centre longitude 0: x = R·lon, y = R·lat
  const R = 3396190, rad = Math.PI / 180;
  const base = `${CTX}${t.product}/${t.product}`;
  const meta = await (await fetch(`${base}.json`)).json();
  const lon = t.lon < 0 && meta.bbox[0] > 0 ? t.lon + 360 : t.lon;
  const cx = R * lon * rad, cy = R * t.lat * rad, k = EXTENT_M / 2;
  const box = [cx - k, cy - k, cx + k, cy + k];
  const dem = await readWindow(`${base}_dtm.tif`, box);
  const h = Float32Array.from(dem.data);
  const holes = fillHoles(h, dem.nodata);
  if (holes > 0.2) throw new Error(`${t.id}: ${(holes * 100).toFixed(0)}% of the DTM window is empty`);
  const ortho = await readWindow(`${base}_orthoimage.tif`, box);
  // CTX is a single grey band; stretch to the window's 1st-99th percentile and keep it grey
  const vals = Array.from(ortho.data).filter((v) => Number.isFinite(v) && v !== ortho.nodata && v > 0).sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.01)] ?? 0, hi = vals[Math.floor(vals.length * 0.99)] ?? 1;
  const rgb = new Uint8Array(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = Math.round(Math.min(1, Math.max(0, (ortho.data[i] - lo) / (hi - lo || 1))) * 235 + 10);
    rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v;
  }
  writeTile(path.join(PUB, 'tiles', 'mars', t.id), h, rgb, {
    real: true, centre: { lat: t.lat, lon: t.lon }, extent_m: EXTENT_M, source_res_m: +dem.srcRes.toFixed(1),
    elevation: `USGS CTX stereo DTM ${t.product}`, imagery: 'CTX orthoimage, same product', imagery_res_m: +ortho.srcRes.toFixed(1),
  });
}

for (const s of EARTH) if (!only.length || only.includes(s.id)) await earth(s).catch((e) => console.error(`FAILED ${s.id}: ${e.message}`));
for (const t of MARS) if (!only.length || only.includes(t.id)) await mars(t).catch((e) => console.error(`FAILED ${t.id}: ${e.message}`));
