// Thermal cycling test: a component sitting on the ground follows the ground temperature with a lag.
// Ground temperature = the place's min and max (sites.json) spread over its 24-bin day curve.

export interface ThermalInput { curve: number[]; minC: number; maxC: number; dayHours: number; tauHours: number; heaterBelowC?: number }
export interface ThermalResult {
  groundC: number[]; partC: number[];     // 24 local-hour bins
  partMinC: number; partMaxC: number; swingC: number;
  maxRateCPerHour: number;                 // fastest change, per real hour
  cyclesPerEarthYear: number;
  heaterHoursPerDay: number;               // real hours per local day below the heater threshold
}

export function runThermal(p: ThermalInput): ThermalResult {
  const groundC = p.curve.map((v) => p.minC + v * (p.maxC - p.minC));
  const binHours = p.dayHours / 24, sub = 20, dt = binHours / sub;
  const k = 1 - Math.exp(-dt / Math.max(0.01, p.tauHours));
  let T = groundC.reduce((a, b) => a + b, 0) / 24;
  let partC: number[] = [];
  let maxRate = 0;
  for (let cycle = 0; cycle < 6; cycle++) {            // repeat the day until the lagged response settles
    partC = []; maxRate = 0;
    for (let h = 0; h < 24; h++) {
      for (let s = 0; s < sub; s++) {
        const g = groundC[h] + (groundC[(h + 1) % 24] - groundC[h]) * (s / sub);
        const next = T + (g - T) * k;
        maxRate = Math.max(maxRate, Math.abs(next - T) / dt);
        T = next;
      }
      partC.push(T);
    }
  }
  const partMinC = Math.min(...partC), partMaxC = Math.max(...partC);
  const cold = p.heaterBelowC ?? -40;
  return {
    groundC, partC, partMinC, partMaxC, swingC: partMaxC - partMinC, maxRateCPerHour: maxRate,
    cyclesPerEarthYear: 8766 / p.dayHours,
    heaterHoursPerDay: partC.filter((t) => t < cold).length * binHours,
  };
}
