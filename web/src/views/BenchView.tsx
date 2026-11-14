import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bodyName } from '../data/select';
import { SOURCE_NOTE } from '../data/pillars';
import { runPower } from '../sim/power';
import { runThermal } from '../sim/thermal';
import { useProgress } from '../state/progress';
import { withTarget } from '../state/store';
import { Seg } from '../ui/Seg';
import { NotFound } from './SeamView';
import { useSeam } from './useSeam';

const E = '#4f8df7', T = '#e0673a';

/** Two series over the 24 local-hour bins, each on its own vertical scale when `own` is set. */
function DayChart({ a, b, unit, own, line, label }: { a: number[]; b: number[]; unit: string; own?: boolean; line?: number; label: string }) {
  const W = 640, H = 170, pad = 28;
  const range = (xs: number[]) => { const lo = Math.min(...xs, line ?? Infinity), hi = Math.max(...xs, line ?? -Infinity); return [lo, hi === lo ? lo + 1 : hi] as const; };
  const all = range([...a, ...b]), ra = own ? range(a) : all, rb = own ? range(b) : all;
  const path = (xs: number[], [lo, hi]: readonly [number, number]) => xs.map((v, i) => `${i ? 'L' : 'M'}${(pad + (i / 23) * (W - pad * 2)).toFixed(1)},${(H - 22 - ((v - lo) / (hi - lo)) * (H - 40)).toFixed(1)}`).join('');
  const y = (v: number, [lo, hi]: readonly [number, number]) => H - 22 - ((v - lo) / (hi - lo)) * (H - 40);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
      {[0, 6, 12, 18, 23].map((h) => <text key={h} x={pad + (h / 23) * (W - pad * 2)} y={H - 6} textAnchor="middle" fontSize={11} fontFamily="IBM Plex Mono" fill="#aeb7c2">{String(h === 23 ? 24 : h).padStart(2, '0')}</text>)}
      <line x1={pad} x2={W - pad} y1={H - 22} y2={H - 22} stroke="#2c3440" />
      {line != null && !own && <line x1={pad} x2={W - pad} y1={y(line, all)} y2={y(line, all)} stroke="#e6e9ef" strokeDasharray="4 4" />}
      <path d={path(a, ra)} fill="none" stroke={E} strokeWidth={2} />
      <path d={path(b, rb)} fill="none" stroke={T} strokeWidth={2} />
      <text x={pad} y={12} fontSize={11} fontFamily="IBM Plex Mono" fill={E}>Earth {Math.round(Math.min(...a))} to {Math.round(Math.max(...a))}{unit}</text>
      <text x={W - pad} y={12} textAnchor="end" fontSize={11} fontFamily="IBM Plex Mono" fill={T}>target {Math.round(Math.min(...b))} to {Math.round(Math.max(...b))}{unit}</text>
    </svg>
  );
}

function Stat({ k, e, t, note }: { k: string; e: string; t: string; note?: string }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-3">{k}{note && <span className="caps block">{note}</span>}</td>
      <td className="text-right font-mono tabular-nums text-earth">{e}</td>
      <td className="text-right font-mono tabular-nums text-mars">{t}</td>
    </tr>
  );
}

export function BenchView() {
  const { siteId } = useParams();
  const { data, site, target } = useSeam(siteId);
  const [tab, setTab] = useState<'power' | 'thermal'>('power');
  const [area, setArea] = useState(2), [load, setLoad] = useState(60), [tau, setTau] = useState(2);
  useEffect(() => { useProgress.getState().say('Test bench online'); useProgress.getState().award('flag', 'bench'); }, []);
  if (!site) return <NotFound what="Site" />;
  const a = site.params, b = target.params;
  if (!a || !b) return <div className="p-8 text-dim">This pair has no parameter set in sites.json.</div>;
  const W = bodyName(target), pe = data.planets.earth, pt = data.planets[target.body];
  const src = (id: 'insolation_kwh' | 'temp_min_c') => `${a[id]?.source} / ${b[id]?.source}`;

  const powE = runPower({ insolationKwh: a.insolation_kwh!.value, dayHours: pe.day_hours, areaM2: area, efficiency: 0.25, loadW: load });
  const powT = runPower({ insolationKwh: b.insolation_kwh!.value, dayHours: pt.day_hours, areaM2: area, efficiency: 0.25, loadW: load });
  const thE = runThermal({ curve: site.curve, minC: a.temp_min_c!.value, maxC: a.temp_max_c!.value, dayHours: pe.day_hours, tauHours: tau });
  const thT = runThermal({ curve: target.curve, minC: b.temp_min_c!.value, maxC: b.temp_max_c!.value, dayHours: pt.day_hours, tauHours: tau });
  const h = (x: number) => (x >= 48 ? `${(x / 24).toFixed(1)} d` : `${x.toFixed(1)} h`);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-5 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={withTarget(`/seam/${site.id}`)} className="btn">Back to the seam</Link>
        <h1 className="head">Test bench · {site.name} vs {target.name}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Seg label="Test" value={tab} onChange={setTab} options={[{ value: 'power', label: 'Solar power' }, { value: 'thermal', label: 'Thermal cycling' }]} />
        <Link to={withTarget(`/trial/${site.id}`)} className="btn">Rover mobility</Link>
      </div>

      {tab === 'power' && (
        <section className="panel space-y-3 p-3" aria-label="Solar power test">
          <p className="text-sm text-dim">A {area} m² panel at 25 % efficiency feeding a constant {load} W load. Does it carry the load through a full local day, and how big a battery gets it through the night?</p>
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <label className="flex items-center gap-2"><span className="caps">Panel area</span><input type="range" className="scrub w-40" min={0.5} max={10} step={0.5} value={area} onChange={(e) => setArea(Number(e.target.value))} aria-valuetext={`${area} square metres`} /><span className="font-mono text-sm tabular-nums">{area} m²</span></label>
            <label className="flex items-center gap-2"><span className="caps">Load</span><input type="range" className="scrub w-40" min={10} max={400} step={10} value={load} onChange={(e) => setLoad(Number(e.target.value))} aria-valuetext={`${load} watts`} /><span className="font-mono text-sm tabular-nums">{load} W</span></label>
          </div>
          <DayChart a={powE.powerW} b={powT.powerW} unit=" W" line={load} label="Panel output over the local day, Earth and target, with the load as a dashed line" />
          <table className="w-full text-sm">
            <thead><tr className="caps text-left"><th className="py-1 font-normal">Per local day</th><th className="text-right font-normal">Earth</th><th className="text-right font-normal">{W}</th></tr></thead>
            <tbody>
              <Stat k="Daily sunlight" note={SOURCE_NOTE[a.insolation_kwh!.source] + ' / ' + SOURCE_NOTE[b.insolation_kwh!.source]} e={`${a.insolation_kwh!.value.toFixed(1)} kWh/m²`} t={`${b.insolation_kwh!.value.toFixed(1)} kWh/m²`} />
              <Stat k="Length of day" e={h(pe.day_hours)} t={h(pt.day_hours)} />
              <Stat k="Energy generated" e={`${powE.energyPerDayKwh.toFixed(2)} kWh`} t={`${powT.energyPerDayKwh.toFixed(2)} kWh`} />
              <Stat k="Energy used by the load" e={`${powE.loadPerDayKwh.toFixed(2)} kWh`} t={`${powT.loadPerDayKwh.toFixed(2)} kWh`} />
              <Stat k="Night to survive" e={h(powE.nightHours)} t={h(powT.nightHours)} />
              <Stat k="Battery to carry the night" e={`${powE.storageKwh.toFixed(2)} kWh`} t={`${powT.storageKwh.toFixed(2)} kWh`} />
              <Stat k="Result" e={powE.ok ? 'CARRIES LOAD' : 'SHORTFALL'} t={powT.ok ? 'CARRIES LOAD' : 'SHORTFALL'} />
            </tbody>
          </table>
          <p className="text-sm"><span className="font-semibold">What transfers:</span> panel sizing against real sunlight, dust-free. <span className="font-semibold">What does not:</span> {target.body === 'moon' ? `the ${h(powT.nightHours)} lunar night, which sets the battery, and the absence of any air to cool the panel.` : 'dust on the panel and the dimmer, redder sky; Earth cannot rehearse a multi-sol dust storm.'}</p>
          <p className="caps">Sunlight sources: {src('insolation_kwh')} · day spread assumed as a half sine</p>
        </section>
      )}

      {tab === 'thermal' && (
        <section className="panel space-y-3 p-3" aria-label="Thermal cycling test">
          <p className="text-sm text-dim">A component resting on the ground follows the ground temperature with a lag. Each world is drawn on its own scale: absolute temperatures are shown side by side, never matched.</p>
          <label className="flex items-center gap-2"><span className="caps">Thermal time constant</span><input type="range" className="scrub w-48" min={0.25} max={24} step={0.25} value={tau} onChange={(e) => setTau(Number(e.target.value))} aria-valuetext={`${tau} hours`} /><span className="font-mono text-sm tabular-nums">{tau} h</span></label>
          <DayChart a={thE.partC} b={thT.partC} unit=" °C" own label="Component temperature over the local day, Earth and target, each on its own scale" />
          <table className="w-full text-sm">
            <thead><tr className="caps text-left"><th className="py-1 font-normal">Component</th><th className="text-right font-normal">Earth</th><th className="text-right font-normal">{W}</th></tr></thead>
            <tbody>
              <Stat k="Ground range" note={SOURCE_NOTE[a.temp_min_c!.source] + ' / ' + SOURCE_NOTE[b.temp_min_c!.source]} e={`${a.temp_min_c!.value.toFixed(0)} to ${a.temp_max_c!.value.toFixed(0)} °C`} t={`${b.temp_min_c!.value.toFixed(0)} to ${b.temp_max_c!.value.toFixed(0)} °C`} />
              <Stat k="Component range" e={`${thE.partMinC.toFixed(0)} to ${thE.partMaxC.toFixed(0)} °C`} t={`${thT.partMinC.toFixed(0)} to ${thT.partMaxC.toFixed(0)} °C`} />
              <Stat k="Swing per cycle" e={`${thE.swingC.toFixed(0)} °C`} t={`${thT.swingC.toFixed(0)} °C`} />
              <Stat k="Fastest change" e={`${thE.maxRateCPerHour.toFixed(1)} °C/h`} t={`${thT.maxRateCPerHour.toFixed(1)} °C/h`} />
              <Stat k="Cycles per Earth year" e={thE.cyclesPerEarthYear.toFixed(0)} t={thT.cyclesPerEarthYear.toFixed(0)} />
              <Stat k="Time below −40 °C per day" note="when a survival heater must run" e={h(thE.heaterHoursPerDay)} t={h(thT.heaterHoursPerDay)} />
            </tbody>
          </table>
          <p className="text-sm"><span className="font-semibold">What transfers:</span> the number of cycles a joint or solder point sees, and the rate of change. <span className="font-semibold">What does not:</span> the absolute cold; Earth's air also carries heat away, which {target.body === 'moon' ? 'vacuum' : 'thin Mars air'} does not.</p>
          <p className="caps">Temperature sources: {src('temp_min_c')} · the day curve shape is a placeholder until the pipeline supplies it</p>
        </section>
      )}
    </div>
  );
}
