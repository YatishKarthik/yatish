// Fetches REAL terrain and imagery for the tiles from open data on AWS, so the 3D view shows actual ground.
//   Earth elevation : Copernicus DEM GLO-30 (ESA; © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018)
//   Earth imagery   : Sentinel-2 L2A true colour (contains modified Copernicus Sentinel data)
//   Mars elevation and imagery : USGS Astrogeology CTX stereo DTMs and orthoimages (NASA/JPL/MSSS/USGS)
//   Moon elevation and imagery : USGS Astrogeology Kaguya Terrain Camera stereo DTMs and orthoimages (JAXA/SELENE, USGS)
// Locations come from scripts/locations.json; a location with no usable data is skipped.
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

const LOC = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'locations.json'), 'utf8'));
const WANT = { earth: 60, mars: 10, moon: 10 };
const MONTHS = ['2023/10', '2023/9', '2023/11', '2023/8', '2023/7', '2023/6', '2023/5', '2023/4', '2023/3', '2023/2', '2023/1', '2023/12', '2022/10', '2022/7', '2024/4'];
const ARD = 'https://astrogeo-ard.s3-us-west-2.amazonaws.com/';

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
  const ok = Array.from(h).filter((v) => Number.isFinite(v) && v !== nodata && v > -2e4).sort((a, b) => a - b);
  const med = ok.length ? ok[ok.length >> 1] : 0;
  const dev = ok.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const lim = Math.max(600, 8 * (dev[dev.length >> 1] ?? 0));   // untagged fill values sit far outside the real spread
  const bad = (v) => !Number.isFinite(v) || v === nodata || Math.abs(v - med) > lim;
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
  const name = `Copernicus_DSM_COG_10_${ns}${String(Math.abs(Math.floor(s.lat))).padStart(2, '0')}_00_${ew}${String(Math.abs(Math.floor(s.lon))).padStart(3, '0')}_00_DEM`;
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
  search: for (const band of [m[2], BANDS[bi - 1], BANDS[bi + 1]]) for (const month of MONTHS) {
    const listing = await (await fetch(`${S2}?list-type=2&delimiter=/&prefix=sentinel-s2-l2a-cogs/${m[1]}/${band}/${m[3]}/${month}/`)).text();
    scenes = [...listing.matchAll(/<Prefix>([^<]+_L2A\/)<\/Prefix>/g)].map((x) => x[1]).slice(0, 14);
    if (scenes.length) break search;
  }
  if (!scenes.length) throw new Error(`no Sentinel-2 scenes for square ${m[1]}${m[2]}${m[3]}`);
  const utm = `+proj=utm +zone=${m[1]}${s.lat < 0 ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
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
    id: s.id, real: true, centre: { lat: s.lat, lon: s.lon }, extent_m: EXTENT_M, source_res_m: 30,
    elevation: 'Copernicus DEM GLO-30', imagery: `Sentinel-2 L2A ${used.id}`, imagery_res_m: 10,
  });
}

/** Mars and Moon: USGS stereo DTM plus its orthoimage. Both are equirectangular on a sphere, centre longitude 0. */
async function planet(body, t) {
  const rad = Math.PI / 180, k = EXTENT_M / 2;
  const suffix = body === 'mars' ? ['_dtm.tif', '_orthoimage.tif'] : ['_ba-aligned-DEM.tif', '_ba-aligned-DRG.tif'];
  for (const product of t.products) {
    try {
      // newer lunar products name their files differently and keep one orthoimage per source image
      const v2 = product.includes('usgs_dtms_v2');
      const demUrl = `${ARD}${product}${v2 ? '-DEM.tif' : suffix[0]}`;
      const orthoUrl = v2 ? `${ARD}${product.slice(0, product.lastIndexOf('/') + 1)}${product.split('/').pop().split('__')[0]}.ortho.tif` : `${ARD}${product}${suffix[1]}`;
      const tiff = await fromUrl(demUrl);
      const img = await tiff.getImage();
      const keys = img.getGeoKeys(), R = keys.GeogSemiMajorAxisGeoKey, bb = img.getBoundingBox();
      const polar = keys.ProjCoordTransGeoKey === 15;   // south polar stereographic, true scale at the pole
      let cx, cy, kx = k;
      if (polar) {
        const rho = 2 * R * Math.tan(Math.PI / 4 + (t.lat * rad) / 2);
        cx = rho * Math.sin(t.lon * rad); cy = rho * Math.cos(t.lon * rad);
      } else {
        // equirectangular: x = R·lon, y = R·lat, so one metre of ground east-west is 1/cos(lat) metres of x
        cx = R * t.lon * rad;
        const turn = 2 * Math.PI * R;
        while (cx < bb[0]) cx += turn;
        while (cx > bb[2]) cx -= turn;
        cy = R * t.lat * rad; kx = k / Math.cos(t.lat * rad);
      }
      // a window just outside the strip may slide in by up to 15 km; the tile records where it ended up
      const fit = (c, half, lo, hi) => (hi - lo < 2 * half ? NaN : Math.min(hi - half, Math.max(lo + half, c)));
      const nx = fit(cx, kx, bb[0], bb[2]), ny = fit(cy, k, bb[1], bb[3]);
      if (Number.isNaN(nx) || Number.isNaN(ny) || Math.hypot((nx - cx) * (k / kx), ny - cy) > 15000) { if (process.env.DEBUG) console.log(t.id, 'outside', product.slice(-30)); continue; }
      cx = nx; cy = ny;
      const centre = polar
        ? { lat: +(-(90 - (2 * Math.atan(Math.hypot(cx, cy) / (2 * R))) / rad)).toFixed(3), lon: +(Math.atan2(cx, cy) / rad).toFixed(3) }
        : { lat: +(cy / R / rad).toFixed(3), lon: +((((cx / R / rad) + 540) % 360) - 180).toFixed(3) };
      const box = [cx - kx, cy - k, cx + kx, cy + k];
      const dem = await readWindow(demUrl, box);
      const h = Float32Array.from(dem.data);
      const holes = fillHoles(h, dem.nodata);
      if (holes > 0.15) { if (process.env.DEBUG) console.log(t.id, 'holes', holes.toFixed(2)); continue; }
      const ortho = await readWindow(orthoUrl, box);
      // single grey band: stretch to the window's 1st-99th percentile and keep it grey
      const vals = Array.from(ortho.data).filter((v) => Number.isFinite(v) && v !== ortho.nodata && v > 0).sort((a, b) => a - b);
      if (vals.length < SIZE * SIZE * 0.85) { if (process.env.DEBUG) console.log(t.id, 'ortho empty', vals.length); continue; }
      const lo = vals[Math.floor(vals.length * 0.01)], hi = vals[Math.floor(vals.length * 0.99)];
      const rgb = new Uint8Array(SIZE * SIZE * 3);
      for (let i = 0; i < SIZE * SIZE; i++) {
        const v = Math.round(Math.min(1, Math.max(0, (ortho.data[i] - lo) / (hi - lo || 1))) * 235 + 10);
        rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v;
      }
      const name = product.split('/').pop();
      writeTile(path.join(PUB, 'tiles', body, t.id), h, rgb, {
        id: t.id, real: true, centre, extent_m: EXTENT_M, source_res_m: +dem.srcRes.toFixed(1),
        elevation: body === 'mars' ? `USGS CTX stereo DTM ${name}` : `USGS Kaguya TC stereo DTM ${name}`,
        imagery: body === 'mars' ? 'CTX orthoimage, same product' : 'Kaguya TC orthoimage, same product', imagery_res_m: +ortho.srcRes.toFixed(1),
      });
      return true;
    } catch (e) { if (process.env.DEBUG) console.log(t.id, 'error', e.message); }
  }
  console.error(`FAILED ${t.id}: no product covers the window`);
  return false;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const done = (body) => fs.existsSync(path.join(PUB, 'tiles', body)) ? fs.readdirSync(path.join(PUB, 'tiles', body)).filter((d) => fs.existsSync(path.join(PUB, 'tiles', body, d, 'source.json'))).length : 0;
await pool(LOC.earth.filter((s) => !only.length || only.includes(s.id)), 5, async (s) => {
  if (done('earth') >= WANT.earth || fs.existsSync(path.join(PUB, 'tiles', 'earth', s.id, 'source.json'))) return;
  await earth(s).catch((e) => console.error(`FAILED ${s.id}: ${e.message}`));
});
for (const body of ['mars', 'moon']) await pool(LOC[body].filter((t) => !only.length || only.includes(t.id)), 4, async (t) => {
  if (done(body) >= WANT[body] || fs.existsSync(path.join(PUB, 'tiles', body, t.id, 'source.json'))) return;
  await planet(body, t);
});
console.log(`tiles: earth ${done('earth')}, mars ${done('mars')}, moon ${done('moon')}`);
