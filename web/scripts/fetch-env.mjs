// Real climate records for every Earth site from NASA POWER (MERRA-2 / CERES climatology, about 0.5 to 1 degree cells).
// Writes scripts/env-earth.json. Run `npm run mock` afterwards to fold the values into sites.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOC = JSON.parse(fs.readFileSync(path.join(HERE, 'locations.json'), 'utf8'));
const OUT = path.join(HERE, 'env-earth.json');
const PARAMS = 'TS,TS_MAX,TS_MIN,WS10M,RH2M,PS,ALLSKY_SFC_SW_DWN,ALLSKY_SRF_ALB,PRECTOTCORR';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const ok = (v) => typeof v === 'number' && v > -900;

async function one(s) {
  if (out[s.id]) return;
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=${PARAMS}&community=RE&longitude=${s.lon}&latitude=${s.lat}&format=JSON`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const p = (await res.json()).properties.parameter;
      // swing: the range between the monthly skin-temperature extremes, averaged over the year
      const swings = MONTHS.map((m) => p.TS_MAX[m] - p.TS_MIN[m]).filter((v) => Number.isFinite(v) && v > 0 && v < 150);
      const rec = {
        temp_max_c: p.TS_MAX.ANN, temp_min_c: p.TS_MIN.ANN, temp_mean_c: p.TS.ANN,
        temp_delta_c: +(swings.reduce((a, b) => a + b, 0) / swings.length).toFixed(2),
        wind_ms: p.WS10M.ANN, humidity_pct: p.RH2M.ANN, pressure_kpa: p.PS.ANN,
        insolation_kwh: p.ALLSKY_SFC_SW_DWN.ANN, albedo: p.ALLSKY_SRF_ALB.ANN, precip_mm_day: p.PRECTOTCORR.ANN,
      };
      for (const k of Object.keys(rec)) if (!ok(rec[k])) delete rec[k];
      out[s.id] = rec;
      return;
    } catch (e) { if (attempt === 2) console.error(`FAILED ${s.id}: ${e.message}`); else await new Promise((r) => setTimeout(r, 1500)); }
  }
}
let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (i < LOC.earth.length) await one(LOC.earth[i++]); }));
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`NASA POWER records: ${Object.keys(out).length} of ${LOC.earth.length} locations`);
