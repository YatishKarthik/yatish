import { describe, expect, it } from 'vitest';
import { curveAt, getPath, rankedSites } from './select';
import type { SitesJson } from './types';

describe('curveAt', () => {
  const c = Array.from({ length: 24 }, (_, i) => i / 23);
  it('returns the bin value at the bin centre', () => {
    expect(curveAt(c, 5.5)).toBeCloseTo(5 / 23);
  });
  it('interpolates between bins', () => {
    expect(curveAt(c, 6)).toBeCloseTo(5.5 / 23);
  });
  it('wraps around midnight', () => {
    expect(curveAt(c, 0)).toBeCloseTo((c[23] + c[0]) / 2);
    expect(curveAt(c, 24)).toBeCloseTo(curveAt(c, 0));
  });
});

describe('rankedSites', () => {
  it('orders by closeness for the target without changing the data', () => {
    const data = { sites: [{ id: 'a', closeness: { j: { total: 10 } } }, { id: 'b', closeness: { j: { total: 90 } } }] } as unknown as SitesJson;
    expect(rankedSites(data, 'j').map((s) => s.id)).toEqual(['b', 'a']);
    expect(data.sites[0].id).toBe('a');
  });
});

describe('getPath', () => {
  it('reads nested values', () => {
    expect(getPath({ a: [{ b: 3 }] }, 'a.0.b')).toBe(3);
    expect(getPath({ a: 1 }, 'x.y')).toBeUndefined();
  });
});
