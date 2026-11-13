// Mirrors data/schema/sites.schema.json. Keep the two in step.
import type { ParamSet, PillarId } from './pillars';

export type Level = 'green' | 'yellow' | 'red';
export type Scenario = 'driving' | 'landing' | 'thermal';
export type ClassName = 'fines' | 'gravel' | 'crust' | 'bedrock';
export type World = 'earth' | 'mars';

export interface Planet { solar_flux_wm2: number; gravity: number; day_hours: number; pressure_bar: number }
export interface Minerals { basalt: boolean; clay: boolean; salt: boolean }
export interface Features {
  amplitude_ratio: number; amplitude_pct?: number; peak_hour: number | null; night_slope: number | null;
  ati_star_pct: number; mean_slope_deg: number; roughness_rms_m: number; minerals: Minerals | null;
}
export interface SurfaceClass { id: number; name: ClassName; label: string }
export interface TileSource { elevation: string; imagery: string; centre?: { lat: number; lon: number } }
export interface TerrainMeta { z_min: number; z_max: number; pixel_m: number; source_res_m: number; thermal_res_m?: number }
export interface Verdict { level: Level; rule: string; detail: string; rule_id?: string }
export type VerdictSet = Record<Scenario, Verdict>;
export interface Closeness { total: number; thermal: number; terrain: number; minerals?: number | null; topography?: number; pillars?: Partial<Record<PillarId, number | null>> }

export interface Target {
  id: string; body: 'mars' | 'moon'; name: string; lat: number; lon: number; why?: string;
  curve: number[]; curve_source: string; features: Features; params?: ParamSet; class?: SurfaceClass;
  tes_ti_pct?: number; ground_truth?: string;
  terrain_tile: string; texture_tile: string; satellite_tile?: string; terrain_meta?: TerrainMeta; tile_source?: TileSource;
}
export interface Site {
  id: string; name: string; kind: 'candidate' | 'positive_control' | 'negative_control';
  centroid: { lat: number; lon: number }; area_km2: number; region: string;
  curve: number[]; curve_scenes: number; curve_source: string; features: Features; params?: ParamSet; class: SurfaceClass;
  closeness: Record<string, Closeness>; verdicts: Record<string, VerdictSet>;
  catalogue: { in_esa_cafe: boolean; literature_hits: number; status: string; checked_by?: string; notes?: string };
  dossier: { text: string; generated_by: string; model: string; inputs_hash?: string };
  limits: string[];
  terrain_tile: string; texture_tile: string; satellite_tile: string; terrain_meta?: TerrainMeta; tile_source?: TileSource; mock: boolean;
}
export interface SitesJson {
  meta: {
    generated_utc: string; pipeline_version: string; weights: { thermal: number; terrain: number; minerals: number };
    common_resolution_m: number; earth_thermal_source: string; mock: boolean;
    formula?: string[]; friction?: Record<string, number>; class_map?: SurfaceClass[];
    pillar_weights?: Partial<Record<PillarId, number>>; pillar_formula?: string[];
    demo?: { target?: string; lookalike?: string; match?: string };
  };
  planets: Record<string, Planet>;
  targets: Target[];
  sites: Site[];
  validation: {
    controls: { id: string; name?: string; kind: string; closeness_jezero: number; pass: boolean }[];
    rover_sites: { id: string; tes_ti_pct: number; ground_truth: string; consistent: boolean }[];
    local: { surface: string; site_id: string; ir_c_14h: number; ir_c_06h: number; swing_c: number; sat_swing_rank: number; order_match: boolean }[];
    positive_min_closeness?: number; negative_max_closeness?: number; passed: boolean;
  };
  ai_use: string[];
}
