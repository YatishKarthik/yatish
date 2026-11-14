import { describe, expect, it } from 'vitest';
import { runTrial, stuckSlopeDeg, STEP_M } from './rover';

const ramp = (deg: number, n = 200) => Array.from({ length: n }, (_, i) => i * STEP_M * Math.tan((deg * Math.PI) / 180));
const EARTH = 9.81, MARS = 3.72;

describe('rover trial', () => {
  it('never gets stuck on flat ground, any class, either world', () => {
    for (const mu of [0.35, 0.45, 0.6, 0.7]) for (const g of [EARTH, MARS]) {
      const r = runTrial(ramp(0), { g, mu });
      expect(r.outcome).toBe('PASS');
      expect(r.maxSlip).toBe(0);
    }
  });
  it('gets stuck on 30° fines on Mars', () => {
    expect(runTrial(ramp(30), { g: MARS, mu: 0.35 }).outcome).toBe('STUCK');
  });
  it('has a lower stuck slope on Mars than on Earth for the same surface', () => {
    for (const mu of [0.35, 0.6]) expect(stuckSlopeDeg(MARS, mu)).toBeLessThan(stuckSlopeDeg(EARTH, mu));
  });
  it('can pass on Earth and stick on Mars between the two thresholds', () => {
    const mid = (stuckSlopeDeg(MARS, 0.35) + stuckSlopeDeg(EARTH, 0.35)) / 2;
    expect(runTrial(ramp(mid), { g: EARTH, mu: 0.35 }).outcome).toBe('PASS');
    expect(runTrial(ramp(mid), { g: MARS, mu: 0.35 }).outcome).toBe('STUCK');
  });
  it('is deterministic', () => {
    const a = runTrial(ramp(12), { g: MARS, mu: 0.6 }), b = runTrial(ramp(12), { g: MARS, mu: 0.6 });
    expect(a).toEqual(b);
  });
});
