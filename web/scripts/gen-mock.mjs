// Mock data generator for the front end. Deterministic: same bytes every run.
// Writes public/data/sites.json and public/tiles/**. Everything it writes is flagged mock.
// The real pipeline (pipeline/package) overwrites these files with the same contract.
import { encode } from 'fast-png';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const SIZE = 256;
const THERM = 64;

// ---------- deterministic noise ----------
function hash(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, seed, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f, seed + i * 17); amp *= 0.5; f *= 2; }
  return s; // ~0..1
}

// ---------- terrain shapes (metres in, metres out) ----------
const SHAPES = {
  dune: (x, y, s) => {
    const warp = 2.2 * fbm(x / 1500, y / 1500, s);
    const ridge = 1 - Math.abs(Math.sin((Math.PI * (x * 0.85 + y * 0.35)) / 800 + warp));
    return 55 * ridge * ridge + 10 * fbm(x / 350, y / 350, s + 5);
  },
  gravel: (x, y, s) => 6 * fbm(x / 900, y / 900, s) + 0.004 * x,
  sabkha: (x, y, s) => 1.5 * fbm(x / 1200, y / 1200, s),
  bedrock: (x, y, s) => {
    const r = 1 - Math.abs(2 * fbm(x / 1100, y / 1100, s, 5) - 1);
    return 210 * r * r + 25 * fbm(x / 250, y / 250, s + 9);
  },
  farm: (x, y, s) => 3 * fbm(x / 1000, y / 1000, s) + 0.002 * y,
  jezero: (x, y, s) => 90 * fbm(x / 4500, y / 4500, s) + 40 * Math.exp(-(((x - 5000) / 2500) ** 2)),
  gale: (x, y, s) => 260 * fbm(x / 5000, y / 5000, s, 5) + 0.02 * y,
  arcadia: (x, y, s) => 18 * fbm(x / 6000, y / 6000, s),
};

// sample analytic shape at the SOURCE resolution, then upsample smoothly to SIZE.
// This mimics what the real pipeline delivers: coarse DEM samples in a 256 px tile.
function makeHeight(shape, extentM, sourceResM, seed) {
  const n = Math.max(4, Math.round(extentM / sourceResM) + 1);
  const src = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
    src[j * n + i] = SHAPES[shape]((i / (n - 1)) * extentM, (j / (n - 1)) * extentM, seed);
  const at = (i, j) => src[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  const cr = (p0, p1, p2, p3, t) =>
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  const out = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const gy = (y / (SIZE - 1)) * (n - 1), jy = Math.floor(gy), ty = gy - jy;
    for (let x = 0; x < SIZE; x++) {
      const gx = (x / (SIZE - 1)) * (n - 1), ix = Math.floor(gx), tx = gx - ix;
      const rows = [];
      for (let k = -1; k <= 2; k++) rows.push(cr(at(ix - 1, jy + k), at(ix, jy + k), at(ix + 1, jy + k), at(ix + 2, jy + k), tx));
      out[y * SIZE + x] = cr(rows[0], rows[1], rows[2], rows[3], ty);
    }
  }
  // terrain stats on the source grid (what the pipeline would report)
  let slopeSum = 0, cnt = 0, res2 = 0;
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const dzdx = (at(i + 1, j) - at(i - 1, j)) / (2 * sourceResM);
    const dzdy = (at(i, j + 1) - at(i, j - 1)) / (2 * sourceResM);
    slopeSum += (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    let m = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) m += at(i + a, j + b);
    res2 += (at(i, j) - m / 9) ** 2;
    cnt++;
  }
  let zMin = Infinity, zMax = -Infinity;
  for (const v of out) { if (v < zMin) zMin = v; if (v > zMax) zMax = v; }
  return { h: out, zMin, zMax, meanSlope: slopeSum / cnt, rough: Math.sqrt(res2 / cnt) };
}

// ---------- curves ----------
function makeCurve({ peak, tau, depth, p }) {
  const raw = [];
  for (let h = 0; h < 24; h++) {
    const hc = h + 0.5;
    const x = Math.cos((2 * Math.PI * (hc - peak)) / 24);
    if (x > 0) raw.push(Math.pow(x, p));
    else {
      const sinceSunset = (hc - (peak + 6) + 48) % 24;
      raw.push(-depth * (1 - Math.exp(-sinceSunset / tau)));
    }
  }
  const sm = raw.map((_, i) => (raw[(i + 23) % 24] + raw[i] + raw[(i + 1) % 24]) / 3);
  const mn = Math.min(...sm), mx = Math.max(...sm);
  return sm.map((v) => +((v - mn) / (mx - mn)).toFixed(4));
}
const peakHour = (c) => c.indexOf(Math.max(...c)) + 0.5;
function nightSlope(c) {
  let s = 0, n = 0;
  for (const h of [20, 21, 22, 23, 0, 1, 2, 3]) { s += c[(h + 1) % 24] - c[h]; n++; }
  return +(s / n).toFixed(4);
}

// ---------- colour ----------
const RAMP = ['#1d2a6b', '#3d7ab8', '#e8e2c8', '#e0673a', '#8f1c1c'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
function ramp(t) {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  return RAMP[i].map((c, k) => Math.round(c + (RAMP[i + 1][k] - c) * f));
}
const SAT = {
  dune: [[196, 112, 62], [226, 150, 88]], gravel: [[124, 108, 94], [158, 142, 124]], sabkha: [[196, 190, 176], [232, 228, 214]],
  bedrock: [[58, 50, 46], [104, 88, 76]], farm: [[52, 96, 44], [120, 150, 70]],
  jezero: [[142, 86, 58], [186, 122, 84]], gale: [[120, 72, 52], [176, 112, 80]], arcadia: [[160, 104, 74], [198, 142, 104]],
};

function writePng(file, data, width, height, channels, depth) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encode({ width, height, data, channels, depth }));
}

function writeTiles(dir, shape, T, curve, seed) {
  const { h, zMin, zMax } = T;
  // height: 16-bit grey
  const h16 = new Uint16Array(SIZE * SIZE);
  for (let i = 0; i < h.length; i++) h16[i] = Math.round(((h[i] - zMin) / (zMax - zMin || 1)) * 65535);
  writePng(path.join(dir, 'height.png'), h16, SIZE, SIZE, 1, 16);
  // satellite: procedural true-colour stand-in
  const sat = new Uint8Array(SIZE * SIZE * 3);
  const [c0, c1] = SAT[shape];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x;
    const hx = h[y * SIZE + Math.min(SIZE - 1, x + 1)] - h[y * SIZE + Math.max(0, x - 1)];
    const shade = Math.min(1.25, Math.max(0.6, 1 - hx * 0.06));
    let t = 0.5 * fbm(x / 40, y / 40, seed + 31) + 0.5 * (h[i] - zMin) / (zMax - zMin || 1);
    if (shape === 'farm') t = ((Math.floor(x / 32) + Math.floor(y / 32)) % 2) * 0.7 + 0.15 * fbm(x / 8, y / 8, seed);
    for (let k = 0; k < 3; k++) sat[i * 3 + k] = Math.min(255, Math.round((c0[k] + (c1[k] - c0[k]) * t) * shade));
  }
  writePng(path.join(dir, 'sat.png'), sat, SIZE, SIZE, 3, 8);
  // hourly colour: site curve value, lightly modulated by sun-facing slope (mock only)
  const step = SIZE / THERM;
  for (let hour = 0; hour < 24; hour++) {
    const buf = new Uint8Array(THERM * THERM * 3);
    const sunX = -Math.cos(((hour + 0.5 - 6) / 12) * Math.PI); // east(-x) at 6h to west(+x) at 18h
    const day = hour >= 6 && hour < 18 ? 1 : 0;
    for (let y = 0; y < THERM; y++) for (let x = 0; x < THERM; x++) {
      const px = Math.min(SIZE - 2, Math.max(1, Math.round(x * step))), py = Math.min(SIZE - 1, Math.round(y * step));
      const dzdx = h[py * SIZE + px + 1] - h[py * SIZE + px - 1];
      const mod = day * Math.max(-0.1, Math.min(0.1, dzdx * sunX * 0.02)) + 0.04 * (fbm(x / 9, y / 9, seed + 77) - 0.5);
      const rgb = ramp(curve[hour] + mod);
      buf.set(rgb, (y * THERM + x) * 3);
    }
    writePng(path.join(dir, `colour_${hour}.png`), buf, THERM, THERM, 3, 8);
  }
}

// ---------- definitions ----------
const CLASSES = [
  { id: 0, name: 'fines', label: 'Loose fines — sinkage and dust tests' },
  { id: 1, name: 'gravel', label: 'Compact gravel — good trafficability, drill testing' },
  { id: 2, name: 'crust', label: 'Salt or duricrust — crust-breaking and corrosion tests' },
  { id: 3, name: 'bedrock', label: 'Exposed bedrock — coring and obstacle tests' },
];
const FRICTION = { fines: 0.35, gravel: 0.6, crust: 0.45, bedrock: 0.7 };
const PLANETS = {
  earth: { solar_flux_wm2: 1361.0, gravity: 9.81, day_hours: 24.0, pressure_bar: 1.0 },
  mars: { solar_flux_wm2: 586.2, gravity: 3.72, day_hours: 24.66, pressure_bar: 0.006 },
  moon: { solar_flux_wm2: 1361.0, gravity: 1.62, day_hours: 708.7, pressure_bar: 0.0 },
};
const CURVES = [
  { peak: 12.8, tau: 1.8, depth: 1.0, p: 1.4 },
  { peak: 13.4, tau: 3.2, depth: 0.9, p: 1.1 },
  { peak: 13.1, tau: 2.5, depth: 0.95, p: 1.2 },
  { peak: 14.4, tau: 6.0, depth: 0.8, p: 0.9 },
];

const TARGETS = [
  { id: 'jezero', name: 'Jezero crater', lat: 18.38, lon: 77.58, why: 'Perseverance site; delta, clays, carbonates', cls: 1, seed: 101,
    curve: { peak: 13.3, tau: 3.0, depth: 0.9, p: 1.1 }, amp: 0.34, ampPct: 55, ati: 31, tes: 31, source: 'EMIRS_L3',
    minerals: { basalt: true, clay: true, salt: false }, truth: 'Dusty plain, cobbles (Perseverance)' },
  { id: 'gale', name: 'Gale crater', lat: -4.59, lon: 137.44, why: 'Curiosity site; mixed sand and bedrock', cls: 3, seed: 102,
    curve: { peak: 14.1, tau: 5.0, depth: 0.85, p: 0.95 }, amp: 0.29, ampPct: 34, ati: 48, tes: 48, source: 'EMIRS_L3',
    minerals: { basalt: true, clay: true, salt: true }, truth: 'Mixed sand and bedrock (Curiosity)' },
  { id: 'arcadia', name: 'Arcadia Planitia', lat: 40.0, lon: -170.0, why: 'Human landing candidate; shallow ice', cls: 0, seed: 103,
    curve: { peak: 12.9, tau: 2.0, depth: 1.0, p: 1.35 }, amp: 0.41, ampPct: 86, ati: 14, tes: 14, source: 'EMIRS_L3',
    minerals: { basalt: true, clay: false, salt: false }, truth: 'Dust-mantled plain over shallow ice (orbital only)' },
];

const SITES = [
  { id: 'dune_a', name: 'Dune field A', kind: 'candidate', region: 'Liwa, Abu Dhabi, UAE', lat: 23.08, lon: 53.77, shape: 'dune', cls: 0, seed: 1,
    amp: 0.21, ampPct: 92, ati: 12, scenes: 17, source: 'ECOSTRESS', minerals: { basalt: false, clay: false, salt: false },
    cat: { in_esa_cafe: true, literature_hits: 6, status: 'catalogued', checked_by: 'MOCK', notes: 'Liwa is a published analog.' },
    close: { jezero: [48, 62, 33], gale: [40, 45, 33], arcadia: [86, 80, 67] } },
  { id: 'gravel_plain_b', name: 'Gravel plain B', kind: 'candidate', region: 'Abu Dhabi, UAE', lat: 23.9, lon: 54.8, shape: 'gravel', cls: 1, seed: 2,
    amp: 0.16, ampPct: 58, ati: 34, scenes: 14, source: 'ECOSTRESS', minerals: { basalt: true, clay: true, salt: false },
    cat: { in_esa_cafe: false, literature_hits: 0, status: 'uncatalogued', checked_by: 'MOCK', notes: '' },
    close: { jezero: [91, 84, 100], gale: [70, 66, 67], arcadia: [52, 71, 67] } },
  { id: 'sabkha_c', name: 'Inland sabkha C', kind: 'candidate', region: 'Al Dhafra, UAE', lat: 23.6, lon: 53.1, shape: 'sabkha', cls: 2, seed: 3,
    amp: 0.18, ampPct: 71, ati: 26, scenes: 0, source: 'MODIS_2PT', minerals: { basalt: false, clay: false, salt: true },
    cat: { in_esa_cafe: true, literature_hits: 4, status: 'catalogued', checked_by: 'MOCK', notes: 'Abu Dhabi sabkha is a published analog.' },
    close: { jezero: [64, 78, 33], gale: [55, 60, 33], arcadia: [60, 82, 33] } },
  { id: 'ridge_d', name: 'Ophiolite ridge D', kind: 'candidate', region: 'Hajar, Oman', lat: 23.2, lon: 57.9, shape: 'bedrock', cls: 3, seed: 4,
    amp: 0.1, ampPct: 18, ati: 71, scenes: 9, source: 'ECOSTRESS', minerals: { basalt: true, clay: true, salt: true },
    cat: { in_esa_cafe: true, literature_hits: 9, status: 'catalogued', checked_by: 'MOCK', notes: 'Samail ophiolite is a published analog.' },
    close: { jezero: [58, 41, 67], gale: [88, 79, 100], arcadia: [30, 25, 33] } },
  { id: 'farm_al_ain', name: 'Irrigated farm block', kind: 'negative_control', region: 'Al Ain, UAE', lat: 24.2, lon: 55.7, shape: 'farm', cls: 2, seed: 5,
    amp: 0.06, ampPct: 4, ati: 88, scenes: 21, source: 'ECOSTRESS', minerals: { basalt: false, clay: false, salt: false },
    cat: { in_esa_cafe: false, literature_hits: 0, status: 'decoy', checked_by: 'MOCK', notes: 'Negative control.' },
    close: { jezero: [12, 55, 0], gale: [10, 40, 0], arcadia: [15, 50, 0] }, curveOverride: { peak: 14.8, tau: 8, depth: 0.7, p: 0.8 } },
];

const W = { thermal: 0.6, terrain: 0.3, minerals: 0.1 };
const roughClass = (r) => (r < 1 ? 0 : r < 4 ? 1 : r < 12 ? 2 : 3);

function verdicts(site, tgt) {
  const cfg = { slope_tol_deg: 3.0, roughness_class_tol: 1 };
  const pe = PLANETS.earth, pt = PLANETS.mars;
  const dS = Math.abs(site.features.mean_slope_deg - tgt.features.mean_slope_deg);
  const okSlope = dS <= cfg.slope_tol_deg;
  const okRough = Math.abs(roughClass(site.features.roughness_rms_m) - roughClass(tgt.features.roughness_rms_m)) <= cfg.roughness_class_tol;
  const okClass = site.class.id === tgt.class.id;
  const slip = (Math.atan(FRICTION[site.class.name]) * 180) / Math.PI;
  const nums = `Slope ${site.features.mean_slope_deg.toFixed(1)}° here vs ${tgt.features.mean_slope_deg.toFixed(1)}° at ${tgt.name} (tolerance ${cfg.slope_tol_deg}°).`;
  let driving;
  if (okSlope && okRough && okClass)
    driving = { level: 'green', rule_id: 'R-DRV-01', rule: `Slope within ${cfg.slope_tol_deg}°, roughness within one class, same thermal class`,
      detail: `${nums} Traction tests transfer. Gravity ratio ${(pt.gravity / pe.gravity).toFixed(2)}: wheel load is lower on Mars. Static friction angle for ${site.class.name} is about ${slip.toFixed(0)}° on both worlds (gravity cancels); the dynamic term in the trial is where gravity shows.` };
  else if (okSlope && okRough)
    driving = { level: 'yellow', rule_id: 'R-DRV-02', rule: 'Geometry matches but surface class differs',
      detail: `${nums} Class here is ${site.class.name}, target is ${tgt.class.name}. Use for navigation and obstacle tests, not for sinkage.` };
  else driving = { level: 'red', rule_id: 'R-DRV-03', rule: 'Slope or roughness outside tolerance', detail: `${nums} Not a mobility analog.` };
  const landing = okSlope && okRough
    ? { level: 'yellow', rule_id: 'R-LND-01', rule: `Hazard geometry comparable; gravity ${(pt.gravity / pe.gravity).toFixed(2)}× and surface pressure ${(pt.pressure_bar / pe.pressure_bar).toFixed(3)}× Earth`,
        detail: 'Leg loads and tip-over geometry transfer; descent dynamics and plume–regolith interaction do not (0.6% of Earth pressure on Mars).' }
    : { level: 'red', rule_id: 'R-LND-02', rule: 'Surface hazard geometry differs', detail: `${nums} Touchdown hazard tests would not transfer.` };
  const thermal = { level: 'red', rule_id: 'R-THM-01', rule: 'Earth has an atmosphere, soil moisture and convective night cooling',
    detail: 'Thermal-instrument calibration can use the matched curve SHAPE, but absolute temperatures, drill heat rejection and ice-stability results will mislead. Apparent thermal inertia of the same material differs with pressure; a thin dust skin can halve it on either planet.' };
  return { driving, landing, thermal };
}

// ---------- build ----------
fs.rmSync(path.join(PUB, 'tiles'), { recursive: true, force: true });
const EARTH_EXTENT = 3000, MARS_EXTENT = 12000;

const targets = TARGETS.map((t) => {
  const T = makeHeight(t.id, MARS_EXTENT, 463, t.seed);
  const curve = makeCurve(t.curve);
  writeTiles(path.join(PUB, 'tiles', 'mars', t.id), t.id, T, curve, t.seed);
  return {
    id: t.id, body: 'mars', name: t.name, lat: t.lat, lon: t.lon, why: t.why,
    curve, curve_source: t.source,
    features: { amplitude_ratio: t.amp, amplitude_pct: t.ampPct, peak_hour: peakHour(curve), night_slope: nightSlope(curve), ati_star_pct: t.ati,
      mean_slope_deg: +T.meanSlope.toFixed(2), roughness_rms_m: +T.rough.toFixed(2), minerals: t.minerals },
    class: CLASSES[t.cls], tes_ti_pct: t.tes, ground_truth: t.truth,
    terrain_tile: `tiles/mars/${t.id}/height.png`, texture_tile: `tiles/mars/${t.id}/colour_{h}.png`, satellite_tile: `tiles/mars/${t.id}/sat.png`,
    terrain_meta: { z_min: +T.zMin.toFixed(2), z_max: +T.zMax.toFixed(2), pixel_m: +(MARS_EXTENT / SIZE).toFixed(3), source_res_m: 463, thermal_res_m: 3000 },
  };
});

const sites = SITES.map((s) => {
  const T = makeHeight(s.shape, EARTH_EXTENT, 100, s.seed);
  const curve = makeCurve(s.curveOverride ?? CURVES[s.cls]);
  writeTiles(path.join(PUB, 'tiles', 'earth', s.id), s.shape, T, curve, s.seed);
  const two = s.source === 'MODIS_2PT';
  const site = {
    id: s.id, name: s.name, kind: s.kind, centroid: { lat: s.lat, lon: s.lon }, area_km2: 9.0, region: s.region,
    curve, curve_scenes: s.scenes, curve_source: s.source,
    features: { amplitude_ratio: s.amp, amplitude_pct: s.ampPct, peak_hour: two ? null : peakHour(curve), night_slope: two ? null : nightSlope(curve),
      ati_star_pct: s.ati, mean_slope_deg: +T.meanSlope.toFixed(2), roughness_rms_m: +T.rough.toFixed(2), minerals: s.minerals },
    class: CLASSES[s.cls],
    closeness: Object.fromEntries(Object.entries(s.close).map(([k, [th, te, mi]]) => [k, { total: Math.round(W.thermal * th + W.terrain * te + W.minerals * mi), thermal: th, terrain: te, minerals: mi }])),
    verdicts: {},
    catalogue: s.cat,
    dossier: { text: `Placeholder dossier for ${s.name}. Class ${CLASSES[s.cls].name}; amplitude percentile ${s.ampPct}; mean slope ${T.meanSlope.toFixed(1)}°. The real text is written by an LLM from the numbers on this page and is read by a human before freeze.`,
      generated_by: 'MOCK', model: 'mock-template', inputs_hash: '0000000000000000000000000000000000000000' },
    limits: [
      'Thermal behaviour, not material: two different materials can share a curve.',
      two ? '1 km MODIS pixel, two local times only; curve shape is not resolved.' : '70 m ECOSTRESS pixel; surface patches smaller than that are averaged.',
      'Elevation is 100 m on Earth and 463 m on Mars; rover-scale rocks and ripples are not in the terrain.',
      'Earth has moisture, wind and a thick atmosphere; absolute temperatures do not transfer.',
    ],
    terrain_tile: `tiles/earth/${s.id}/height.png`, texture_tile: `tiles/earth/${s.id}/colour_{h}.png`, satellite_tile: `tiles/earth/${s.id}/sat.png`,
    terrain_meta: { z_min: +T.zMin.toFixed(2), z_max: +T.zMax.toFixed(2), pixel_m: +(EARTH_EXTENT / SIZE).toFixed(3), source_res_m: 100, thermal_res_m: two ? 1000 : 70 },
    mock: true,
  };
  for (const t of targets) site.verdicts[t.id] = verdicts(site, t);
  return site;
});

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
    demo: { target: 'jezero', lookalike: 'dune_a', match: 'gravel_plain_b' },
  },
  planets: PLANETS, targets, sites,
  validation: {
    controls: [
      { id: 'atacama', name: 'Atacama core', kind: 'positive_control', closeness_jezero: 84, pass: true },
      { id: 'death_valley', name: 'Death Valley playa', kind: 'positive_control', closeness_jezero: 77, pass: true },
      { id: 'dry_valleys', name: 'McMurdo Dry Valleys', kind: 'positive_control', closeness_jezero: 81, pass: true },
      { id: 'haughton', name: 'Haughton crater floor', kind: 'positive_control', closeness_jezero: 66, pass: true },
      { id: 'farm_al_ain', name: 'Irrigated farm, Al Ain', kind: 'negative_control', closeness_jezero: 24, pass: true },
      { id: 'forest_boreal', name: 'Boreal forest patch', kind: 'negative_control', closeness_jezero: 9, pass: true },
    ],
    rover_sites: [
      { id: 'gale', tes_ti_pct: 48, ground_truth: 'Mixed sand and bedrock', consistent: true },
      { id: 'jezero', tes_ti_pct: 31, ground_truth: 'Dusty plain, cobbles', consistent: true },
      { id: 'meridiani', tes_ti_pct: 12, ground_truth: 'Fine sand, hematite spherules', consistent: true },
      { id: 'gusev', tes_ti_pct: 38, ground_truth: 'Dusty basalt plain with rocks', consistent: true },
    ],
    local: [
      { surface: 'sand', site_id: 'dune_a', ir_c_14h: 48.2, ir_c_06h: 16.1, swing_c: 32.1, sat_swing_rank: 0.08, order_match: true },
      { surface: 'gravel', site_id: 'gravel_plain_b', ir_c_14h: 44.0, ir_c_06h: 19.5, swing_c: 24.5, sat_swing_rank: 0.42, order_match: true },
      { surface: 'rock', site_id: 'ridge_d', ir_c_14h: 41.3, ir_c_06h: 23.9, swing_c: 17.4, sat_swing_rank: 0.82, order_match: true },
    ],
    positive_min_closeness: 60, negative_max_closeness: 25, passed: true,
  },
  ai_use: ['k-means surface classes (scikit-learn)', 'LLM dossiers from computed numbers, labelled', 'Code assistance (Claude Code)'],
};

fs.mkdirSync(path.join(PUB, 'data'), { recursive: true });
fs.writeFileSync(path.join(PUB, 'data', 'sites.json'), JSON.stringify(out, null, 1));
console.log(`mock: ${sites.length} sites, ${targets.length} targets -> public/data/sites.json, public/tiles/`);
