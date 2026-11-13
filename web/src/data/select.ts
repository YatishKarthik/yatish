import type { Level, Site, SitesJson, Target } from './types';

/** Circular linear interpolation of a 24-bin curve. Bin i holds the mean for hour i..i+1 (centre i+0.5). */
export function curveAt(curve: number[], hour: number): number {
  const x = (((hour - 0.5) % 24) + 24) % 24;
  const i = Math.floor(x), f = x - i;
  return curve[i] + (curve[(i + 1) % 24] - curve[i]) * f;
}

/** Order only. Scores come from sites.json; nothing is computed here. */
export function rankedSites(data: SitesJson, targetId: string): Site[] {
  return [...data.sites].sort((a, b) => (b.closeness[targetId]?.total ?? -1) - (a.closeness[targetId]?.total ?? -1));
}

export const siteIndex = (data: SitesJson, id: string) => data.sites.findIndex((s) => s.id === id);
export const targetIndex = (data: SitesJson, id: string) => data.targets.findIndex((t) => t.id === id);

export function resolutionLabel(s: Site | Target): string {
  if ('curve_scenes' in s) {
    if (s.curve_source === 'MODIS_2PT') return '1 km MODIS · 2-point';
    return `70 m ECOSTRESS · ${s.curve_scenes} scenes · 24 bins`;
  }
  if (s.body === 'moon') return 'LRO Diviner · 24 bins';
  return s.curve_source === 'TES_DERIVED' ? '3 km TES · model curve' : 'Hope EMIRS L3 · 24 bins';
}

const RAMP = ['#1d2a6b', '#3d7ab8', '#e8e2c8', '#e0673a', '#8f1c1c'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
/** Temperature ramp for a normalised 0..1 value, per planet. */
export function tempColour(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const c = RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Display name of a target's world. */
export const bodyName = (t: { body: string }) => (t.body === 'moon' ? 'Moon' : 'Mars');

export const PERMIT: Record<Level, { word: string; colour: string }> = {
  green: { word: 'PERMITTED', colour: '#3fb950' },
  yellow: { word: 'CONDITIONAL', colour: '#f2a93b' },
  red: { word: 'DENIED', colour: '#f85149' },
};
export const SCENARIO_TITLE = {
  driving: 'ROVER MOBILITY TRIALS',
  landing: 'LANDING HAZARD TESTS',
  thermal: 'ABSOLUTE TEMPERATURE · DRILL HEAT',
} as const;

/** Read a dotted path such as "sites.2.closeness.jezero.total" from the loaded data. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}
