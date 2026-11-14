// Builds public/data/sites.json and the hourly colour tiles around the REAL terrain fetched by fetch-real.mjs.
// Real: terrain, imagery, coordinates, mean slope and roughness.
// Mock (deterministic, flagged mock in the file and on screen): thermal curves, classes, closeness, verdict inputs, validation.
// The real pipeline overwrites sites.json and the colour tiles with the same contract.
import { decode, encode } from 'fast-png';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.resolve(HERE, '..', 'public');
const LOC = JSON.parse(fs.readFileSync(path.join(HERE, 'locations.json'), 'utf8'));
const SIZE = 256, THERM = 64;
const readJson = (f) => (fs.existsSync(path.join(HERE, f)) ? JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8')) : {});
const ENV = readJson('env-earth.json');   // NASA POWER climatology per Earth site
const S2 = readJson('s2-earth.json');      // Sentinel-2 spectral indices per Earth site

// ---------- deterministic helpers ----------
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const rnd = (key) => (hashStr(key) % 100000) / 100000;          // 0..1, fixed for a given key
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), s = (t) => t * t * (3 - 2 * t), fx = s(x - ix), fy = s(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// ---------- real terrain ----------
function loadReal(dir) {
  const src = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'));
  const img = decode(fs.readFileSync(path.join(dir, 'height.png')));
  const h = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < h.length; i++) h[i] = src.z_min + (img.data[i] / 65535) * (src.z_max - src.z_min);
  // slope and roughness on a 100 m grid, the pipeline's common resolution
  const n = Math.round(src.extent_m / 100) + 1, res = src.extent_m / (n - 1);
  const at = (i, j) => h[Math.round((Math.min(n - 1, Math.max(0, j)) / (n - 1)) * (SIZE - 1)) * SIZE + Math.round((Math.min(n - 1, Math.max(0, i)) / (n - 1)) * (SIZE - 1))];
  let slopeSum = 0, cnt = 0, res2 = 0;
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    slopeSum += (Math.atan(Math.hypot((at(i + 1, j) - at(i - 1, j)) / (2 * res), (at(i, j + 1) - at(i, j - 1)) / (2 * res))) * 180) / Math.PI;
    let m = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) m += at(i + a, j + b);
    res2 += (at(i, j) - m / 9) ** 2;
    cnt++;
  }
  // 14-parameter inputs that can be measured here: slope distribution, TRI, concavity on the 100 m grid
  const slopes = [], tris = [], curv = [];
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    slopes.push((Math.atan(Math.hypot((at(i + 1, j) - at(i - 1, j)) / (2 * res), (at(i, j + 1) - at(i, j - 1)) / (2 * res))) * 180) / Math.PI);
    let d2 = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (a || b) d2 += (at(i + a, j + b) - at(i, j)) ** 2;
    tris.push(Math.sqrt(d2));
    curv.push((at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1) - 4 * at(i, j)) / (res * res) * 1000);   // Laplacian, 1/km
  }
  slopes.sort((a, b) => a - b);
  const topo = {
    slope_mean: +(slopes.reduce((a, b) => a + b, 0) / slopes.length).toFixed(2),
    slope_p90: +slopes[Math.floor(slopes.length * 0.9)].toFixed(2),
    tri_ruggedness: +(tris.reduce((a, b) => a + b, 0) / tris.length).toFixed(2),
    concavity: +(curv.reduce((a, b) => a + b, 0) / curv.length).toFixed(4),
  };
  // optical proxies from the true-colour image: brightness and red/blue ratio (approximate, labelled derived)
  const sat = decode(fs.readFileSync(path.join(dir, 'sat.png')));
  let lum = 0, rb = 0, px = 0;
  for (let i = 0; i < sat.width * sat.height; i++) {
    const r = sat.data[i * sat.channels], g = sat.data[i * sat.channels + 1], b = sat.data[i * sat.channels + 2];
    lum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; rb += (r + 1) / (b + 1); px++;
  }
  const optical = { brightness: lum / px, red_blue: rb / px };
  return { h, src, meanSlope: +(slopeSum / cnt).toFixed(2), rough: +Math.sqrt(res2 / cnt).toFixed(2), topo, optical };
}

/**
 * The 19 parameters for one place, each tagged with where its value comes from:
 * measured (from the tile or Sentinel-2), reanalysis (NASA POWER), model (simple physics by latitude or elevation), mock.
 */
function params(key, T, body, cls, kind, lat) {
  const m = (name, lo, hi) => +(lo + rnd(key + name) * (hi - lo)).toFixed(3);
  const neg = kind === 'negative_control', cosl = Math.max(0.02, Math.cos((lat * Math.PI) / 180));
  const P = {
    slope_mean: { value: T.topo.slope_mean, source: 'measured' },
    slope_p90: { value: T.topo.slope_p90, source: 'measured' },
    tri_ruggedness: { value: T.topo.tri_ruggedness, source: 'measured' },
    concavity: { value: T.topo.concavity, source: 'measured' },
    sar_backscatter: { value: m('sb', -18, -6), source: 'mock' },
    sar_entropy: { value: m('se', 0.3, 0.9), source: 'mock' },
    sar_contrast: { value: m('sc', 0.1, 0.8), source: 'mock' },
  };
  if (body === 'earth') {
    const e = ENV[key], s2 = S2[key];
    const sw = neg ? m('sw', 4, 9) : { fines: 32, crust: 26, gravel: 22, bedrock: 15 }[cls] + m('sw2', -5, 5), tmax = neg ? m('tx', 24, 32) : m('tx', 38, 62);
    Object.assign(P, {
      bareness_index: s2 ? { value: s2.bareness_index, source: 'measured' } : { value: neg ? m('ba', 0.15, 0.4) : m('ba', 0.86, 0.99), source: 'mock' },
      iron_oxide_ratio: s2 ? { value: s2.iron_oxide_ratio, source: 'measured' } : { value: +T.optical.red_blue.toFixed(3), source: 'derived' },
      clay_hydroxyl_ratio: s2 ? { value: s2.clay_hydroxyl_ratio, source: 'measured' } : { value: m('cl', 0.9, 1.3), source: 'mock' },
      albedo: e?.albedo != null ? { value: e.albedo, source: 'reanalysis' } : { value: +(0.08 + 0.35 * T.optical.brightness).toFixed(3), source: 'derived' },
      temp_min_c: e ? { value: e.temp_min_c, source: 'reanalysis' } : { value: +(tmax - sw).toFixed(1), source: 'mock' },
      temp_max_c: e ? { value: e.temp_max_c, source: 'reanalysis' } : { value: +tmax.toFixed(1), source: 'mock' },
      temp_delta_c: e ? { value: e.temp_delta_c, source: 'reanalysis' } : { value: +sw.toFixed(1), source: 'mock' },
      pressure_kpa: e ? { value: e.pressure_kpa, source: 'reanalysis' } : { value: 101.3, source: 'mock' },
      wind_ms: e ? { value: e.wind_ms, source: 'reanalysis' } : { value: m('w', 2, 6), source: 'mock' },
      insolation_kwh: e ? { value: e.insolation_kwh, source: 'reanalysis' } : { value: m('i', 4, 7), source: 'mock' },
      humidity_pct: e ? { value: e.humidity_pct, source: 'reanalysis' } : { value: m('h', 15, 50), source: 'mock' },
      precip_mm_day: e ? { value: e.precip_mm_day, source: 'reanalysis' } : { value: m('pr', 0, 0.5), source: 'mock' },
    });
  } else {
    const mars = body === 'mars';
    // radiative-equilibrium temperatures by latitude; pressure from elevation on Mars; sunlight from the solar constant
    const tmaxK = (mars ? 290 : 390) * Math.pow(cosl, 0.25), tminK = mars ? 150 + 45 * cosl : 95;
    const zMean = (T.src.z_min + T.src.z_max) / 2, S = mars ? 586.2 * 0.75 : 1361;
    Object.assign(P, {
      bareness_index: { value: 1, source: 'measured' },
      iron_oxide_ratio: { value: m('fe', mars ? 1.6 : 0.9, mars ? 2.4 : 1.2), source: 'mock' },
      clay_hydroxyl_ratio: { value: m('cl', 0.9, 1.3), source: 'mock' },
      albedo: { value: m('al', mars ? 0.12 : 0.07, mars ? 0.3 : 0.2), source: 'mock' },
      temp_min_c: { value: +(tminK - 273.15).toFixed(1), source: 'model' },
      temp_max_c: { value: +(tmaxK - 273.15).toFixed(1), source: 'model' },
      temp_delta_c: { value: +(tmaxK - tminK).toFixed(1), source: 'model' },
      pressure_kpa: mars ? { value: +(0.61 * Math.exp(-zMean / 10800)).toFixed(3), source: 'model' } : { value: 0, source: 'measured' },
      wind_ms: mars ? { value: m('w', 2, 9), source: 'mock' } : { value: 0, source: 'measured' },
      insolation_kwh: { value: +(((S / Math.PI) * cosl * 24) / 1000).toFixed(2), source: 'model' },
      humidity_pct: { value: 0, source: mars ? 'model' : 'measured' },
      precip_mm_day: { value: 0, source: 'measured' },
    });
  }
  return P;
}

/** Percentile of each parameter within its own planet. */
function rankWithin(all) {
  const ids = Object.keys(all[0]);
  for (const id of ids) {
    const vals = all.map((p) => p[id].value).sort((a, b) => a - b);
    for (const p of all) {
      // mid-rank percentile: ties share a rank, result always within 0..100
      if (id === 'bareness_index') { p[id].pct = Math.round(p[id].value * 100); continue; }   // same 0..1 scale on every world: compared directly
      const v = p[id].value, below = vals.filter((x) => x < v).length, equal = vals.filter((x) => x === v).length;
      p[id].pct = vals.length > 1 ? Math.round(((below + (equal - 1) / 2) / (vals.length - 1)) * 100) : 50;
    }
  }
}

const PILLAR_OF = { slope_mean: 'topography', slope_p90: 'topography', tri_ruggedness: 'topography', concavity: 'topography', sar_backscatter: 'radar', sar_entropy: 'radar', sar_contrast: 'radar', bareness_index: 'minerals', iron_oxide_ratio: 'minerals', clay_hydroxyl_ratio: 'minerals', albedo: 'minerals', temp_min_c: 'thermal', temp_max_c: 'thermal', temp_delta_c: 'thermal', pressure_kpa: 'environment', wind_ms: 'environment', insolation_kwh: 'environment', humidity_pct: 'environment', precip_mm_day: 'environment' };
const COMPARABLE = new Set(['slope_mean', 'slope_p90', 'tri_ruggedness', 'concavity', 'bareness_index', 'iron_oxide_ratio', 'clay_hydroxyl_ratio', 'albedo', 'temp_delta_c', 'wind_ms', 'insolation_kwh']);
const PW = { topography: 0.3, radar: 0, minerals: 0.3, thermal: 0.25, environment: 0.15 };   // radar is a hint until a like-for-like band exists

/** Pillar scores: 100 minus the mean percentile gap over the comparable parameters of that pillar. */
function pillarScores(a, b) {
  const out = {};
  for (const pil of ['topography', 'radar', 'minerals', 'thermal', 'environment']) {
    const ids = Object.keys(PILLAR_OF).filter((k) => PILLAR_OF[k] === pil && COMPARABLE.has(k));
    out[pil] = ids.length ? Math.round(100 - ids.reduce((s, k) => s + Math.abs(a[k].pct - b[k].pct), 0) / ids.length) : null;
  }
  return out;
}

// ---------- mock thermal curves ----------
const CLASSES = [
  { id: 0, name: 'fines', label: 'Loose fines — sinkage and dust tests' },
  { id: 1, name: 'gravel', label: 'Compact gravel — good trafficability, drill testing' },
  { id: 2, name: 'crust', label: 'Salt or duricrust — crust-breaking and corrosion tests' },
  { id: 3, name: 'bedrock', label: 'Exposed bedrock — coring and obstacle tests' },
];
const CLS = Object.fromEntries(CLASSES.map((c) => [c.name, c]));
const CURVE = { fines: { peak: 12.8, tau: 1.8, depth: 1.0, p: 1.4 }, gravel: { peak: 13.4, tau: 3.2, depth: 0.9, p: 1.1 }, crust: { peak: 13.1, tau: 2.5, depth: 0.95, p: 1.2 }, bedrock: { peak: 14.4, tau: 6.0, depth: 0.8, p: 0.9 } };
const SWING = { fines: 88, crust: 68, gravel: 52, bedrock: 20 }, INERTIA = { fines: 12, crust: 28, gravel: 38, bedrock: 72 };
const FRICTION = { fines: 0.35, gravel: 0.6, crust: 0.45, bedrock: 0.7 };

function makeCurve(cls, key) {
  const c = CURVE[cls], peak = c.peak + (rnd(key + 'pk') - 0.5) * 0.9, tau = c.tau * (0.8 + rnd(key + 'tau') * 0.4);
  const raw = [];
  for (let h = 0; h < 24; h++) {
    const hc = h + 0.5, x = Math.cos((2 * Math.PI * (hc - peak)) / 24);
    raw.push(x > 0 ? Math.pow(x, c.p) : -c.depth * (1 - Math.exp(-((hc - (peak + 6) + 48) % 24) / tau)));
  }
  const sm = raw.map((_, i) => (raw[(i + 23) % 24] + raw[i] + raw[(i + 1) % 24]) / 3);
  const mn = Math.min(...sm), mx = Math.max(...sm);
  return sm.map((v) => +((v - mn) / (mx - mn)).toFixed(4));
}
const peakHour = (c) => c.indexOf(Math.max(...c)) + 0.5;
const nightSlope = (c) => +([20, 21, 22, 23, 0, 1, 2, 3].reduce((s, h) => s + c[(h + 1) % 24] - c[h], 0) / 8).toFixed(4);
const clampPct = (v) => Math.round(Math.min(99, Math.max(1, v)));

// ---------- hourly colour tiles ----------
const RAMP = ['#1d2a6b', '#3d7ab8', '#e8e2c8', '#e0673a', '#8f1c1c'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
function ramp(t) {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  return RAMP[i].map((c, k) => Math.round(c + (RAMP[i + 1][k] - c) * f));
}
function writeColour(dir, h, curve, seed) {
  const step = SIZE / THERM;
  for (let hour = 0; hour < 24; hour++) {
    const buf = new Uint8Array(THERM * THERM * 3), day = hour >= 6 && hour < 18 ? 1 : 0, sunX = Math.cos(((hour + 0.5 - 6) / 12) * Math.PI);
    for (let y = 0; y < THERM; y++) for (let x = 0; x < THERM; x++) {
      const px = Math.min(SIZE - 2, Math.max(1, Math.round(x * step))), py = Math.min(SIZE - 1, Math.round(y * step));
      const dzdx = h[py * SIZE + px + 1] - h[py * SIZE + px - 1];
      const mod = day * Math.max(-0.1, Math.min(0.1, -dzdx * sunX * 0.02)) + 0.04 * (vnoise(x / 9, y / 9, seed) - 0.5);
      buf.set(ramp(curve[hour] + mod), (y * THERM + x) * 3);
    }
    fs.writeFileSync(path.join(dir, `colour_${hour}.png`), encode({ width: THERM, height: THERM, data: buf, channels: 3, depth: 8 }));
  }
}

// ---------- rules (mirrors pipeline/match/rules.py for the mock) ----------
const PLANETS = {
  earth: { solar_flux_wm2: 1361.0, gravity: 9.81, day_hours: 24.0, pressure_bar: 1.0 },
  mars: { solar_flux_wm2: 586.2, gravity: 3.72, day_hours: 24.66, pressure_bar: 0.006 },
  moon: { solar_flux_wm2: 1361.0, gravity: 1.62, day_hours: 708.7, pressure_bar: 0.0 },
};
const roughClass = (r) => (r < 1 ? 0 : r < 4 ? 1 : r < 12 ? 2 : 3);
function verdicts(site, tgt) {
  const tol = 3.0, pe = PLANETS.earth, pt = PLANETS[tgt.body], world = tgt.body === 'moon' ? 'the Moon' : 'Mars';
  const okSlope = Math.abs(site.features.mean_slope_deg - tgt.features.mean_slope_deg) <= tol;
  const okRough = Math.abs(roughClass(site.features.roughness_rms_m) - roughClass(tgt.features.roughness_rms_m)) <= 1;
  const okClass = site.class.id === tgt.class.id;
  const nums = `Slope ${site.features.mean_slope_deg.toFixed(1)}° here, ${tgt.features.mean_slope_deg.toFixed(1)}° at ${tgt.name} (tolerance ${tol}°).`;
  const g = (pt.gravity / pe.gravity).toFixed(2);
  let driving;
  if (okSlope && okRough && okClass) driving = { level: 'green', rule_id: 'R-DRV-01', rule: `Slope within ${tol}°, roughness within one class, same thermal class`, detail: `${nums} Traction tests transfer. Gravity is ${g}× Earth, so wheel load is lower on ${world}.` };
  else if (okSlope && okRough) driving = { level: 'yellow', rule_id: 'R-DRV-02', rule: 'Geometry matches but surface class differs', detail: `${nums} Class here is ${site.class.name}, target is ${tgt.class.name}. Use for navigation and obstacle tests, not for sinkage.` };
  else driving = { level: 'red', rule_id: 'R-DRV-03', rule: 'Slope or roughness outside tolerance', detail: `${nums} Not a mobility analog.` };
  const landing = okSlope && okRough
    ? { level: 'yellow', rule_id: 'R-LND-01', rule: `Hazard geometry comparable; gravity ${g}× and surface pressure ${(pt.pressure_bar / pe.pressure_bar).toFixed(3)}× Earth`, detail: `Leg loads and tip-over geometry transfer; descent dynamics and plume–regolith interaction do not (${tgt.body === 'moon' ? 'no atmosphere to slow ejecta on the Moon' : '0.6% of Earth pressure on Mars'}).` }
    : { level: 'red', rule_id: 'R-LND-02', rule: 'Surface hazard geometry differs', detail: `${nums} Touchdown hazard tests would not transfer.` };
  const thermal = { level: 'red', rule_id: 'R-THM-01', rule: 'Earth has an atmosphere, soil moisture and convective night cooling', detail: 'The matched curve shape can calibrate thermal instruments, but absolute temperatures, drill heat rejection and ice-stability results will mislead.' };
  return { driving, landing, thermal };
}

// ---------- build ----------
const have = (body) => new Set(fs.readdirSync(path.join(PUB, 'tiles', body)).filter((d) => fs.existsSync(path.join(PUB, 'tiles', body, d, 'source.json'))));
const W = { thermal: 0.6, terrain: 0.3, minerals: 0.1 };

const targets = ['mars', 'moon'].flatMap((body) => {
  const ok = have(body);
  return LOC[body].filter((t) => ok.has(t.id)).map((t) => {
    const dir = path.join(PUB, 'tiles', body, t.id), T = loadReal(dir), curve = makeCurve(t.cls, t.id);
    writeColour(dir, T.h, curve, hashStr(t.id) % 1000);
    const P = params(t.id, T, body, t.cls, 'target', T.src.centre.lat);
    const swing = clampPct(SWING[t.cls] + (rnd(t.id + 'sw') - 0.5) * 24);
    return {
      id: t.id, body, name: t.name, lat: t.lat, lon: t.lon, why: t.why,
      curve, curve_source: body === 'mars' ? 'EMIRS_L3' : 'DIVINER',
      features: { amplitude_ratio: +(0.12 + swing / 300).toFixed(3), amplitude_pct: swing, peak_hour: peakHour(curve), night_slope: nightSlope(curve),
        ati_star_pct: clampPct(INERTIA[t.cls] + (rnd(t.id + 'ti') - 0.5) * 20), mean_slope_deg: T.meanSlope, roughness_rms_m: T.rough,
        minerals: { basalt: rnd(t.id + 'b') > 0.3, clay: rnd(t.id + 'c') > 0.6, salt: rnd(t.id + 's') > 0.75 } },
      params: P,
      class: CLS[t.cls], ...(body === 'mars' ? { tes_ti_pct: clampPct(INERTIA[t.cls] + (rnd(t.id + 'ti') - 0.5) * 20) } : {}),
      terrain_tile: `tiles/${body}/${t.id}/height.png`, texture_tile: `tiles/${body}/${t.id}/colour_{h}.png`, satellite_tile: `tiles/${body}/${t.id}/sat.png`,
      terrain_meta: { z_min: T.src.z_min, z_max: T.src.z_max, pixel_m: T.src.pixel_m, source_res_m: T.src.source_res_m, thermal_res_m: 3000 },
      tile_source: { elevation: T.src.elevation, imagery: T.src.imagery, centre: T.src.centre },
    };
  });
});

const okEarth = have('earth');
const sites = LOC.earth.filter((s) => okEarth.has(s.id)).map((s) => {
  const dir = path.join(PUB, 'tiles', 'earth', s.id), T = loadReal(dir);
  const neg = s.kind === 'negative_control', pos = s.kind === 'positive_control';
  const curve = makeCurve(neg ? 'bedrock' : s.cls, s.id);
  writeColour(dir, T.h, curve, hashStr(s.id) % 1000);
  const two = !neg && !pos && rnd(s.id + 'modis') < 0.12;
  const P = params(s.id, T, 'earth', s.cls, s.kind, T.src.centre.lat);
  const swing = neg ? clampPct(3 + rnd(s.id) * 6) : clampPct(SWING[s.cls] + (rnd(s.id + 'sw') - 0.5) * 24);
  const features = { amplitude_ratio: +(0.05 + swing / 500).toFixed(3), amplitude_pct: swing, peak_hour: two ? null : peakHour(curve), night_slope: two ? null : nightSlope(curve),
    ati_star_pct: neg ? clampPct(86 + rnd(s.id + 'ti') * 10) : clampPct(INERTIA[s.cls] + (rnd(s.id + 'ti') - 0.5) * 20), mean_slope_deg: T.meanSlope, roughness_rms_m: T.rough,
    minerals: { basalt: rnd(s.id + 'b') > 0.5, clay: rnd(s.id + 'c') > 0.6, salt: s.cls === 'crust' } };
  const site = {
    id: s.id, name: s.name, kind: s.kind, centroid: T.src.centre, area_km2: 9.0, region: s.region,
    curve, curve_scenes: two ? 0 : 6 + Math.floor(rnd(s.id + 'n') * 18), curve_source: two ? 'MODIS_2PT' : 'ECOSTRESS',
    features, params: P, class: CLS[s.cls], closeness: {}, verdicts: {},
    catalogue: neg ? { in_esa_cafe: false, literature_hits: 0, status: 'decoy', notes: 'Negative control.' }
      : pos || rnd(s.id + 'cat') > 0.45 ? { in_esa_cafe: pos, literature_hits: 1 + Math.floor(rnd(s.id + 'lit') * 9), status: 'catalogued' }
      : { in_esa_cafe: false, literature_hits: 0, status: 'uncatalogued' },
    dossier: { text: `Placeholder summary for ${s.name}. Class ${s.cls}; swing percentile ${swing}; mean slope ${T.meanSlope.toFixed(1)}°.`, generated_by: 'MOCK', model: 'mock-template' },
    limits: [
      'Thermal behaviour, not material: two different materials can share a curve.',
      two ? '1 km MODIS pixel, two local times only; curve shape is not resolved.' : '70 m ECOSTRESS pixel; smaller patches are averaged.',
      'Rover-scale rocks and ripples are below the terrain resolution.',
    ],
    terrain_tile: `tiles/earth/${s.id}/height.png`, texture_tile: `tiles/earth/${s.id}/colour_{h}.png`, satellite_tile: `tiles/earth/${s.id}/sat.png`,
    terrain_meta: { z_min: T.src.z_min, z_max: T.src.z_max, pixel_m: T.src.pixel_m, source_res_m: T.src.source_res_m, thermal_res_m: two ? 1000 : 70 },
    tile_source: { elevation: T.src.elevation, imagery: T.src.imagery, centre: T.src.centre },
    mock: true,
  };
  for (const t of targets) {
    const k = `${s.id}|${t.id}`;
    const thermal = neg ? Math.round(6 + rnd(k) * 9) : Math.round(Math.min(98, Math.max(20, 100 - Math.abs(swing - t.features.amplitude_pct) * 0.9 - rnd(k) * 12 + (pos ? 8 : 0))));
    const terrain = Math.round(Math.max(neg ? 15 : 22, Math.min(neg ? 45 : 98, 100 - Math.abs(T.meanSlope - t.features.mean_slope_deg) * 5 - Math.abs(roughClass(T.rough) - roughClass(t.features.roughness_rms_m)) * 12 - rnd(k + 't') * 10)));
    const m = neg ? 0 : ['basalt', 'clay', 'salt'].filter((x) => features.minerals[x] === t.features.minerals[x]).length;
    const minerals = Math.round((m / 3) * 100);
    site.closeness[t.id] = { total: Math.round(W.thermal * thermal + W.terrain * terrain + W.minerals * minerals), thermal, terrain, minerals };
    site.verdicts[t.id] = verdicts(site, t);
  }
  return site;
});

rankWithin(sites.map((s) => s.params));
for (const body of ['mars', 'moon']) { const grp = targets.filter((t) => t.body === body).map((t) => t.params); if (grp.length) rankWithin(grp); }
for (const s of sites) for (const t of targets) {
  const ps = pillarScores(s.params, t.params);
  const c = s.closeness[t.id];
  c.pillars = ps;
  c.topography = ps.topography; c.minerals = ps.minerals;
  c.thermal = ps.thermal; c.terrain = ps.topography;
  // the total is the printed pillar formula and nothing else: no clamps, so the controls are judged honestly
  c.total = Math.round(PW.topography * ps.topography + PW.minerals * ps.minerals + PW.thermal * ps.thermal + PW.environment * ps.environment);
  // vegetation mask from BUILD_SPEC (NDVI above 0.20 is not bare ground): full score at 0.20, none at 0.30
  const ndvi = 1 - s.params.bareness_index.value;
  c.gate = +Math.min(1, Math.max(0, (0.30 - ndvi) / 0.10)).toFixed(2);
  c.total = Math.round(c.total * c.gate);
}

const cand = (tid) => sites.filter((s) => s.kind === 'candidate').sort((a, b) => b.closeness[tid].total - a.closeness[tid].total);
const demoTarget = targets.find((t) => t.id === 'jezero') ?? targets[0];
const ranked = cand(demoTarget.id), dunes = ranked.filter((s) => s.class.name === 'fines');
const out = {
  meta: {
    generated_utc: '2026-11-13T00:00:00Z', pipeline_version: '0.0.0-mock', weights: W, common_resolution_m: 100,
    earth_thermal_source: 'ECOSTRESS_L2T_LSTE_V2', mock: true,
    formula: [
      'd_th  = 0.5·|amp_pct_a − amp_pct_t| + 0.25·|peak_a − peak_t|/12 + 0.25·|night_pct_a − night_pct_t|',
      'd_ter = 0.5·|slope_pct_a − slope_pct_t| + 0.5·|rough_pct_a − rough_pct_t|',
      'd_min = 1 − (matching mineral flags)/3',
      'C     = 100·(1 − (0.60·d_th + 0.30·d_ter + 0.10·d_min))',
    ],
    friction: FRICTION, class_map: CLASSES,
    pillar_weights: PW,
    pillar_formula: ['pillar = 100 − mean |pct_earth − pct_target| over its comparable parameters', 'C = 0.30·topography + 0.30·minerals + 0.25·thermal + 0.15·environment · radar shown, weight 0', 'bareness is compared directly (same 0–1 scale on every world); all other parameters as percentile within their own planet', 'vegetation mask: C × clamp((0.30 − NDVI) / 0.10, 0, 1), so ground with NDVI above 0.30 scores 0'],
    demo: { target: demoTarget.id, match: ranked[0].id, lookalike: (dunes[dunes.length - 1] ?? ranked[ranked.length - 1]).id },
  },
  planets: PLANETS, targets, sites,
  validation: {
    controls: sites.filter((s) => s.kind !== 'candidate').map((s) => {
      const c = s.closeness[demoTarget.id].total;
      return { id: s.id, name: `${s.name}, ${s.region.split(',')[0]}`, kind: s.kind, closeness_jezero: c, pass: s.kind === 'positive_control' ? c >= 60 : c <= 25 };
    }),
    rover_sites: [
      { id: 'gale', tes_ti_pct: 48, ground_truth: 'Mixed sand and bedrock', consistent: true },
      { id: 'jezero', tes_ti_pct: 31, ground_truth: 'Dusty plain, cobbles', consistent: true },
      { id: 'meridiani', tes_ti_pct: 12, ground_truth: 'Fine sand, hematite spherules', consistent: true },
      { id: 'gusev', tes_ti_pct: 38, ground_truth: 'Dusty basalt plain with rocks', consistent: true },
    ],
    local: [
      { surface: 'sand', site_id: 'liwa_dunes', ir_c_14h: 48.2, ir_c_06h: 16.1, swing_c: 32.1, sat_swing_rank: 0.08, order_match: true },
      { surface: 'gravel', site_id: 'wadi_gravel_oman', ir_c_14h: 44.0, ir_c_06h: 19.5, swing_c: 24.5, sat_swing_rank: 0.42, order_match: true },
      { surface: 'rock', site_id: 'hajar_ridge', ir_c_14h: 41.3, ir_c_06h: 23.9, swing_c: 17.4, sat_swing_rank: 0.82, order_match: true },
    ],
    positive_min_closeness: 60, negative_max_closeness: 25, passed: true,
  },
  ai_use: ['k-means surface classes (scikit-learn)', 'LLM dossiers from computed numbers, labelled', 'Code assistance (Claude Code)'],
};
out.validation.passed = out.validation.controls.every((c) => c.pass);

fs.mkdirSync(path.join(PUB, 'data'), { recursive: true });
fs.writeFileSync(path.join(PUB, 'data', 'sites.json'), JSON.stringify(out));
const by = (b) => targets.filter((t) => t.body === b).length;
console.log(`sites.json: ${sites.length} Earth sites, ${by('mars')} Mars targets, ${by('moon')} Moon targets; controls ${out.validation.passed ? 'pass' : 'FAIL'}`);
