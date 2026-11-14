// The parameter registry. Everything that shows a parameter reads from here, so adding one is a one-line change.
export type PillarId = 'topography' | 'radar' | 'minerals' | 'thermal';
export type ParamId =
  | 'slope_mean' | 'slope_p90' | 'tri_ruggedness' | 'concavity'
  | 'sar_backscatter' | 'sar_entropy' | 'sar_contrast'
  | 'bareness_index' | 'iron_oxide_ratio' | 'clay_hydroxyl_ratio' | 'albedo'
  | 'temp_min_c' | 'temp_max_c' | 'temp_delta_c';
export type ParamSource = 'measured' | 'derived' | 'mock';

export interface ParamValue { value: number; pct: number; source: ParamSource }
export type ParamSet = Partial<Record<ParamId, ParamValue>>;

export interface ParamDef {
  id: ParamId; pillar: PillarId; label: string; short: string; unit: string; digits: number;
  earth: string; mars: string; moon: string;    // dataset per body
  comparable: boolean;                           // false: shown for context, never scored across planets
  note?: string;
}

export const PILLARS: { id: PillarId; label: string; short: string; colour: string }[] = [
  { id: 'topography', label: 'Topography', short: 'TOPO', colour: '#e6e9ef' },
  { id: 'radar', label: 'Radar roughness', short: 'RADAR', colour: '#9aa4b2' },
  { id: 'minerals', label: 'Minerals and bareness', short: 'MINERAL', colour: '#e0a06a' },
  { id: 'thermal', label: 'Thermal regime', short: 'THERMAL', colour: '#4f8df7' },
];

export const PARAMS: ParamDef[] = [
  { id: 'slope_mean', short: 'Slope', pillar: 'topography', label: 'Mean slope', unit: '°', digits: 1, earth: 'Copernicus DEM', mars: 'CTX DTM / MOLA', moon: 'Kaguya TC / LOLA', comparable: true },
  { id: 'slope_p90', short: 'Slope p90', pillar: 'topography', label: 'Slope, 90th pct', unit: '°', digits: 1, earth: 'Copernicus DEM', mars: 'CTX DTM / MOLA', moon: 'Kaguya TC / LOLA', comparable: true, note: 'steepest ground a rover will meet' },
  { id: 'tri_ruggedness', short: 'TRI', pillar: 'topography', label: 'Ruggedness (TRI)', unit: ' m', digits: 1, earth: 'Copernicus DEM', mars: 'CTX DTM / MOLA', moon: 'Kaguya TC / LOLA', comparable: true },
  { id: 'concavity', short: 'Concavity', pillar: 'topography', label: 'Concavity', unit: '', digits: 3, earth: 'Copernicus DEM', mars: 'CTX DTM / MOLA', moon: 'Kaguya TC / LOLA', comparable: true, note: 'positive = pits and craters' },
  { id: 'sar_backscatter', short: 'SAR σ⁰', pillar: 'radar', label: 'Radar backscatter', unit: ' dB', digits: 1, earth: 'RADARSAT-1 (C-band)', mars: '—', moon: 'LRO Mini-RF (S-band)', comparable: false, note: 'C-band vs S-band: a hint, not scored' },
  { id: 'sar_entropy', short: 'SAR entropy', pillar: 'radar', label: 'Radar texture entropy', unit: '', digits: 2, earth: 'RADARSAT-1', mars: '—', moon: 'LRO Mini-RF', comparable: false },
  { id: 'sar_contrast', short: 'SAR contrast', pillar: 'radar', label: 'Radar texture contrast', unit: '', digits: 2, earth: 'RADARSAT-1', mars: '—', moon: 'LRO Mini-RF', comparable: false },
  { id: 'bareness_index', short: 'Bareness', pillar: 'minerals', label: 'Bareness (1 − NDVI)', unit: '', digits: 2, earth: 'Sentinel-2', mars: '1 by definition', moon: '1 by definition', comparable: true },
  { id: 'iron_oxide_ratio', short: 'Fe oxide', pillar: 'minerals', label: 'Iron oxide ratio', unit: '', digits: 2, earth: 'Sentinel-2 red/blue', mars: 'CRISM / orthoimage', moon: 'Kaguya MI', comparable: true },
  { id: 'clay_hydroxyl_ratio', short: 'Clay / OH', pillar: 'minerals', label: 'Clay / hydroxyl ratio', unit: '', digits: 2, earth: 'Sentinel-2 SWIR', mars: 'CRISM', moon: 'M3', comparable: true },
  { id: 'albedo', short: 'Albedo', pillar: 'minerals', label: 'Albedo', unit: '', digits: 2, earth: 'MODIS MCD43A3', mars: 'TES albedo', moon: 'LRO WAC', comparable: true },
  { id: 'temp_min_c', short: 'T min', pillar: 'thermal', label: 'Minimum temperature', unit: ' °C', digits: 0, earth: 'MODIS / ECOSTRESS', mars: 'EMIRS / TES', moon: 'Diviner', comparable: false, note: 'absolute temperatures are never compared across planets' },
  { id: 'temp_max_c', short: 'T max', pillar: 'thermal', label: 'Maximum temperature', unit: ' °C', digits: 0, earth: 'MODIS / ECOSTRESS', mars: 'EMIRS / TES', moon: 'Diviner', comparable: false, note: 'absolute temperatures are never compared across planets' },
  { id: 'temp_delta_c', short: 'ΔT', pillar: 'thermal', label: 'Day–night swing', unit: ' °C', digits: 0, earth: 'MODIS / ECOSTRESS', mars: 'EMIRS / TES', moon: 'Diviner', comparable: true, note: 'compared as a rank within each planet' },
];

export const byPillar = (p: PillarId) => PARAMS.filter((d) => d.pillar === p);
export const PARAM_INDEX = Object.fromEntries(PARAMS.map((d) => [d.id, d])) as Record<ParamId, ParamDef>;

// The challenge's official resources, and what this project does with each today.
export const RESOURCES: { agency: string; name: string; url: string; use: string; status: 'used' | 'planned' | 'reference' }[] = [
  { agency: 'NASA', name: 'Earthdata Search', url: 'https://search.earthdata.nasa.gov/', use: 'ECOSTRESS and MODIS land-surface temperature for the thermal pillar', status: 'planned' },
  { agency: 'NASA', name: 'Worldview', url: 'https://worldview.earthdata.nasa.gov/', use: 'Visual check of each Earth site before it is accepted', status: 'reference' },
  { agency: 'NASA', name: 'Planetary Data System (PDS)', url: 'https://pds.nasa.gov/', use: 'Mars terrain and imagery (CTX stereo models, processed by USGS); TES thermal inertia planned', status: 'used' },
  { agency: 'NASA', name: 'Lunar Reconnaissance Orbiter (LRO)', url: 'https://pds-geosciences.wustl.edu/missions/lro/', use: 'LRO WAC global mosaic on the Moon globe; LOLA slopes and Mini-RF radar planned', status: 'used' },
  { agency: 'NASA', name: 'LRO Diviner lunar data', url: 'https://pds-geosciences.wustl.edu/missions/lro/diviner.htm', use: 'Lunar surface temperatures for the thermal pillar, including the polar targets', status: 'planned' },
  { agency: 'CSA', name: 'RADARSAT Constellation Mission', url: 'https://donnees-data.asc-csa.gc.ca/en/dataset/rcm', use: 'Current C-band backscatter for the radar pillar', status: 'planned' },
  { agency: 'CSA', name: 'RADARSAT-1', url: 'https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1', use: 'Archive C-band backscatter and texture for the radar pillar', status: 'planned' },
  { agency: 'CSA', name: 'SAR Python tutorial', url: 'https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial', use: 'Method reference for reading and filtering SAR scenes', status: 'reference' },
  { agency: 'ESA', name: 'Copernicus Data Space Ecosystem', url: 'https://dataspace.copernicus.eu/', use: 'Copernicus DEM GLO-30 terrain and Sentinel-2 imagery for all 60 Earth sites', status: 'used' },
  { agency: 'ESA', name: 'Open Science Catalog', url: 'https://opensciencedata.esa.int/', use: 'Cross-check of published analog-site products', status: 'reference' },
  { agency: 'JAXA', name: 'G-Portal', url: 'https://gportal.jaxa.jp/gpr/index/index', use: 'GCOM-C land-surface temperature as a second thermal source; Kaguya lunar terrain is already used', status: 'planned' },
];
