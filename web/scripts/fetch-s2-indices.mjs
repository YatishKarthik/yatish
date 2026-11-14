// Real spectral indices for every Earth tile from the same Sentinel-2 L2A scene used for its imagery.
//   bareness = 1 - NDVI (B08, B04) · iron oxide = B04 / B02 · clay / hydroxyl = B11 / B12
// Writes scripts/s2-earth.json. Run `npm run mock` afterwards.
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TILES = path.resolve(HERE, '..', 'public', 'tiles', 'earth');
const OUT = path.join(HERE, 's2-earth.json');
const S2 = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/';
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

async function band(base, name, box) {
  const img = await (await fromUrl(`${base}${name}.tif`)).getImage();
  const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
  const win = [Math.floor((box[0] - ox) / rx), Math.floor((box[3] - oy) / ry), Math.ceil((box[2] - ox) / rx), Math.ceil((box[1] - oy) / ry)];
  return (await img.readRasters({ window: win, width: 96, height: 96, resampleMethod: 'bilinear', interleave: true }));
}

async function one(id) {
  if (out[id]) return;
  const src = JSON.parse(fs.readFileSync(path.join(TILES, id, 'source.json'), 'utf8'));
  const m = src.imagery.match(/(S2[ABC]_(\d{2})([A-Z])([A-Z]{2})_(\d{4})(\d{2})\d{2}_\d+_L2A)/);
  if (!m) return console.error(`SKIP ${id}: no scene id`);
  const base = `${S2}${+m[2]}/${m[3]}/${m[4]}/${m[5]}/${+m[6]}/${m[1]}/`;
  const { lat, lon } = src.centre, k = src.extent_m / 2;
  const [cx, cy] = proj4('WGS84', `+proj=utm +zone=${+m[2]}${lat < 0 ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`, [lon, lat]);
  const box = [cx - k, cy - k, cx + k, cy + k];
  try {
    const [b02, b04, b08, b11, b12] = await Promise.all(['B02', 'B04', 'B08', 'B11', 'B12'].map((b) => band(base, b, box)));
    let ndvi = 0, fe = 0, clay = 0, n = 0;
    for (let i = 0; i < b04.length; i++) {
      if (!(b04[i] > 0 && b08[i] > 0 && b02[i] > 0 && b11[i] > 0 && b12[i] > 0)) continue;
      ndvi += (b08[i] - b04[i]) / (b08[i] + b04[i]); fe += b04[i] / b02[i]; clay += b11[i] / b12[i]; n++;
    }
    if (n < 500) throw new Error('window mostly empty');
    out[id] = { ndvi: +(ndvi / n).toFixed(4), bareness_index: +Math.min(1, Math.max(0, 1 - ndvi / n)).toFixed(4), iron_oxide_ratio: +(fe / n).toFixed(4), clay_hydroxyl_ratio: +(clay / n).toFixed(4), scene: m[1] };
  } catch (e) { console.error(`FAILED ${id}: ${e.message}`); }
}
const ids = fs.readdirSync(TILES).filter((d) => fs.existsSync(path.join(TILES, d, 'source.json')));
let i = 0;
await Promise.all(Array.from({ length: 5 }, async () => { while (i < ids.length) await one(ids[i++]); }));
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`Sentinel-2 indices: ${Object.keys(out).length} of ${ids.length} tiles`);
