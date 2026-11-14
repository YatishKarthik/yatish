// Solar power test: can a panel carry a constant load through this world's day and night?
// Daily sunlight comes from sites.json (measured on Earth, modelled on Mars and the Moon); only its spread over the day is assumed.

export interface PowerInput { insolationKwh: number; dayHours: number; areaM2: number; efficiency: number; loadW: number }
export interface PowerResult {
  powerW: number[];          // panel output per local-solar-hour bin (24 bins)
  energyPerDayKwh: number;   // generated over one full local day
  loadPerDayKwh: number;     // consumed over one full local day
  nightHours: number;        // real hours of darkness in one local day
  storageKwh: number;        // battery needed to carry the load through the night
  marginKwh: number;         // generated minus consumed
  ok: boolean;
}

export function runPower(p: PowerInput): PowerResult {
  // sunlight between local 06:00 and 18:00 as a half sine whose 24-hour mean matches the given daily total
  const shape = Array.from({ length: 24 }, (_, h) => Math.max(0, Math.sin(((h + 0.5 - 6) / 12) * Math.PI)));
  const meanShape = shape.reduce((a, b) => a + b, 0) / 24;
  const meanW = (p.insolationKwh * 1000) / 24;                      // W/m² averaged over 24 h
  const peak = meanShape > 0 ? meanW / meanShape : 0;
  const powerW = shape.map((s) => s * peak * p.areaM2 * p.efficiency);
  const binHours = p.dayHours / 24;
  const energyPerDayKwh = (powerW.reduce((a, b) => a + b, 0) * binHours) / 1000;
  const loadPerDayKwh = (p.loadW * p.dayHours) / 1000;
  const nightHours = p.dayHours / 2;
  const storageKwh = (p.loadW * nightHours) / 1000;
  const marginKwh = energyPerDayKwh - loadPerDayKwh;
  return { powerW, energyPerDayKwh, loadPerDayKwh, nightHours, storageKwh, marginKwh, ok: marginKwh >= 0 };
}
