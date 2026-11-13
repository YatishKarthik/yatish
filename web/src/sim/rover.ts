// Deterministic rover traction trial (BUILD_SPEC §11.4). Same code for both worlds; only g and mu differ.
// Static friction angle does not depend on gravity. Gravity matters through the commanded-acceleration
// term m·a_cmd, which is not scaled by g: at lower g the ratio F/F_max is larger on the same slope.

export interface RoverParams { g: number; mu: number; aCmd?: number; vMax?: number; dt?: number; slipLimit?: number; stuckSeconds?: number }
export interface TrialSample { t: number; dist: number; speed: number; slip: number; slopeDeg: number }
export interface TrialResult {
  outcome: 'PASS' | 'STUCK';
  samples: TrialSample[];        // one per simulated second
  duration: number;              // s
  distance: number;              // m travelled
  maxSlopeDeg: number;           // steepest uphill on the path
  maxSlip: number;
  stuckSlopeDeg: number;         // uphill slope at which this world's rover would exceed the slip limit
}

export const STEP_M = 2;

/** Uphill slope (deg) at which slip reaches the limit: (g·sinθ + a)/(μ·g·cosθ) = 1 + limit. */
export function stuckSlopeDeg(g: number, mu: number, aCmd = 0.2, slipLimit = 0.3): number {
  let lo = 0, hi = 89;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2, th = (mid * Math.PI) / 180;
    const ratio = (g * Math.sin(th) + aCmd) / (mu * g * Math.cos(th));
    if (ratio > 1 + slipLimit) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** heights: elevation in metres sampled every STEP_M along the path. */
export function runTrial(heights: ArrayLike<number>, p: RoverParams): TrialResult {
  const aCmd = p.aCmd ?? 0.2, vMax = p.vMax ?? 1.0, dt = p.dt ?? 0.1;
  const slipLimit = p.slipLimit ?? 0.3, stuckSeconds = p.stuckSeconds ?? 2;
  const total = (heights.length - 1) * STEP_M;
  const samples: TrialSample[] = [];
  let dist = 0, vWheel = 0, t = 0, slipTime = 0, maxSlip = 0, maxSlope = 0, nextSample = 0;
  let outcome: TrialResult['outcome'] = 'PASS';
  const maxT = (total / vMax) * 6 + 60;
  while (dist < total && t < maxT) {
    const i = Math.min(heights.length - 2, Math.floor(dist / STEP_M));
    const theta = Math.atan2(heights[i + 1] - heights[i], STEP_M);
    const F = p.g * Math.sin(theta) + aCmd;            // per unit mass
    const Fmax = p.mu * p.g * Math.cos(theta);
    const slip = Math.min(1, Math.max(0, (F - Fmax) / Fmax));
    vWheel = Math.min(vMax, vWheel + aCmd * dt);
    const v = vWheel * (1 - slip);
    const slopeDeg = (theta * 180) / Math.PI;
    if (t >= nextSample) { samples.push({ t, dist, speed: v, slip, slopeDeg }); nextSample += 1; }
    maxSlip = Math.max(maxSlip, slip);
    maxSlope = Math.max(maxSlope, slopeDeg);
    slipTime = slip > slipLimit ? slipTime + dt : 0;
    if (slipTime > stuckSeconds) { outcome = 'STUCK'; break; }
    dist += v * dt;
    t += dt;
  }
  if (outcome === 'PASS' && dist < total) outcome = 'STUCK';
  samples.push({ t, dist: Math.min(dist, total), speed: 0, slip: samples.length ? samples[samples.length - 1].slip : 0, slopeDeg: samples.length ? samples[samples.length - 1].slopeDeg : 0 });
  return { outcome, samples, duration: t, distance: Math.min(dist, total), maxSlopeDeg: maxSlope, maxSlip, stuckSlopeDeg: stuckSlopeDeg(p.g, p.mu, aCmd, slipLimit) };
}

/** State at simulated time t (linear between one-second samples). */
export function sampleAt(r: TrialResult, t: number): TrialSample {
  const s = r.samples;
  if (t <= 0) return s[0];
  if (t >= r.duration) return s[s.length - 1];
  const i = Math.min(s.length - 2, Math.floor(t));
  const a = s[i], b = s[i + 1], f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  return { t, dist: a.dist + (b.dist - a.dist) * f, speed: a.speed + (b.speed - a.speed) * f, slip: a.slip, slopeDeg: a.slopeDeg };
}
