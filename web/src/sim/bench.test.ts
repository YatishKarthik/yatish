import { describe, expect, it } from 'vitest';
import { runPower } from './power';
import { runThermal } from './thermal';

describe('solar power test', () => {
  const base = { areaM2: 1, efficiency: 0.25, loadW: 20 };
  it('generates the given daily sunlight times area and efficiency', () => {
    const r = runPower({ ...base, insolationKwh: 6, dayHours: 24 });
    expect(r.energyPerDayKwh).toBeCloseTo(6 * 0.25, 5);
    expect(r.nightHours).toBe(12);
  });
  it('needs a far larger battery on the Moon for the same load', () => {
    const earth = runPower({ ...base, insolationKwh: 6, dayHours: 24 }), moon = runPower({ ...base, insolationKwh: 6, dayHours: 708.7 });
    expect(moon.storageKwh / earth.storageKwh).toBeCloseTo(708.7 / 24, 3);
  });
  it('fails when the load exceeds the generation', () => {
    expect(runPower({ ...base, loadW: 500, insolationKwh: 6, dayHours: 24 }).ok).toBe(false);
  });
});

describe('thermal cycling test', () => {
  const curve = Array.from({ length: 24 }, (_, h) => 0.5 - 0.5 * Math.cos(((h - 2) / 24) * 2 * Math.PI));
  it('tracks the ground closely with a short time constant', () => {
    const r = runThermal({ curve, minC: -80, maxC: 0, dayHours: 24.66, tauHours: 0.05 });
    expect(r.swingC).toBeGreaterThan(75);
  });
  it('damps the swing with a long time constant', () => {
    const fast = runThermal({ curve, minC: -80, maxC: 0, dayHours: 24.66, tauHours: 0.5 }), slow = runThermal({ curve, minC: -80, maxC: 0, dayHours: 24.66, tauHours: 12 });
    expect(slow.swingC).toBeLessThan(fast.swingC);
    expect(slow.maxRateCPerHour).toBeLessThan(fast.maxRateCPerHour);
  });
  it('counts fewer cycles per year where the day is longer', () => {
    const moon = runThermal({ curve, minC: -180, maxC: 110, dayHours: 708.7, tauHours: 2 });
    expect(moon.cyclesPerEarthYear).toBeCloseTo(12.37, 1);
    expect(moon.heaterHoursPerDay).toBeGreaterThan(200);
  });
});
