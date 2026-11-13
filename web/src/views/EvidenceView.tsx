import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { rankedSites, resolutionLabel, targetIndex } from '../data/select';
import { GLOBAL_LIMITS } from '../panels/Drawers';
import { useStore } from '../state/store';
import { Num } from '../ui/Num';

const AX = { stroke: '#99a1ac', fontSize: 12, fontFamily: 'Geist Mono Variable' };
const TIP = { contentStyle: { background: '#101215', border: '1px solid #23272e', fontFamily: 'Geist Mono Variable', fontSize: 12 }, labelStyle: { color: '#eef0f2' } };

export function EvidenceView() {
  const data = useStore((s) => s.data)!;
  const targetId = useStore((s) => s.target);
  const hour = useStore((s) => s.hour);
  const target = data.targets[Math.max(0, targetIndex(data, targetId))];
  const ranked = rankedSites(data, target.id);
  const [siteId, setSiteId] = useState(ranked[0]?.id);
  const site = data.sites.find((s) => s.id === siteId) ?? ranked[0];
  const v = data.validation;
  const twoPoint = site.curve_source === 'MODIS_2PT';
  const curveRows = target.curve.map((t, i) => ({ hour: i + 0.5, target: t, site: !twoPoint || i === 1 || i === 13 ? site.curve[i] : null }));
  const posMin = v.positive_min_closeness, negMax = v.negative_max_closeness;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="display text-xl">Evidence</h1>
        <span className="stamp !rotate-0" style={{ color: v.passed ? '#3fb950' : '#f85149', borderColor: 'currentColor' }} title="sites.json → validation.passed">
          {v.passed ? 'VALIDATION PASSED' : 'VALIDATION FAILED'}
        </span>
        {data.meta.mock && <span className="chip mock !text-amber">mock data · not evidence yet</span>}
      </div>

      <section className={`panel p-3 ${site.mock ? 'mock' : ''}`} aria-label="Curve overlay">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Day curves, normalised within each planet</h2>
          <label className="flex items-center gap-2"><span className="caps">Earth site</span>
            <select value={site.id} onChange={(e) => setSiteId(e.target.value)} className="min-h-[36px] rounded border border-line bg-panel px-2 font-mono text-sm">
              {ranked.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={curveRows} margin={{ left: 8, right: 16, bottom: 18, top: 6 }}>
              <CartesianGrid stroke="#23272e" />
              <XAxis dataKey="hour" type="number" domain={[0, 24]} ticks={[0, 6, 12, 18, 24]} {...AX} label={{ value: 'Local solar time (hours)', position: 'insideBottom', offset: -10, fill: '#99a1ac', fontSize: 12 }} />
              <YAxis domain={[0, 1]} {...AX} label={{ value: 'Normalised temperature (0–1)', angle: -90, position: 'insideLeft', fill: '#99a1ac', fontSize: 12, dy: 80 }} />
              <Tooltip {...TIP} formatter={(x: number) => x.toFixed(2)} labelFormatter={(h) => `${h} h`} />
              <Legend verticalAlign="top" wrapperStyle={{ fontFamily: 'Geist Mono Variable', fontSize: 12 }} />
              <ReferenceLine x={hour} stroke="#eef0f2" strokeDasharray="2 3" />
              <Line name={`Mars · ${target.name}`} dataKey="target" stroke="#f2b599" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line name={`Earth · ${site.name}`} dataKey="site" stroke="#6ea8ff" strokeWidth={2} dot={twoPoint} strokeDasharray={twoPoint ? '4 4' : undefined} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="caps">Earth: {resolutionLabel(site)} · Mars: {resolutionLabel(target)}{twoPoint ? ' · dashed line joins two measured points only' : ''}</p>
      </section>

      <section className="panel p-3" aria-label="Controls">
        <h2 className="text-lg font-semibold">Controls: known analogs must score high, decoys low</h2>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={v.controls.map((c) => ({ ...c, label: c.name ?? c.id }))} margin={{ left: 8, right: 16, bottom: 44, top: 10 }}>
              <CartesianGrid stroke="#23272e" vertical={false} />
              <XAxis dataKey="label" {...AX} interval={0} angle={-18} textAnchor="end" />
              <YAxis domain={[0, 100]} {...AX} label={{ value: 'Closeness to Jezero (0–100)', angle: -90, position: 'insideLeft', fill: '#99a1ac', fontSize: 12, dy: 80 }} />
              <Tooltip {...TIP} cursor={{ fill: '#23272e' }} />
              {posMin != null && <ReferenceLine y={posMin} stroke="#3fb950" strokeDasharray="4 3" label={{ value: `known analogs ≥ ${posMin}`, fill: '#3fb950', fontSize: 12, position: 'insideTopRight' }} />}
              {negMax != null && <ReferenceLine y={negMax} stroke="#f85149" strokeDasharray="4 3" label={{ value: `decoys ≤ ${negMax}`, fill: '#f85149', fontSize: 12, position: 'insideBottomRight' }} />}
              <Bar dataKey="closeness_jezero" name="Closeness to Jezero" isAnimationActive={false}>
                {v.controls.map((c) => <Cell key={c.id} fill={c.kind === 'positive_control' ? '#eef0f2' : '#5b626d'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="mt-2 w-full text-sm">
          <thead><tr className="caps text-left"><th className="py-1">Control</th><th>Kind</th><th className="text-right">Closeness</th><th className="text-right">Result</th></tr></thead>
          <tbody>
            {v.controls.map((c, i) => (
              <tr key={c.id} className="border-t border-line">
                <td className="py-1">{c.name ?? c.id}</td><td className="text-dim">{c.kind === 'positive_control' ? 'known analog' : 'decoy'}</td>
                <td className="text-right"><Num path={`validation.controls.${i}.closeness_jezero`} /></td>
                <td className="text-right font-mono">{c.pass ? 'PASS' : 'FAIL'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel p-3" aria-label="Rover ground truth">
        <h2 className="text-lg font-semibold">Mars side: orbital thermal inertia vs what rovers found</h2>
        <table className="mt-2 w-full text-sm">
          <thead><tr className="caps text-left"><th className="py-1">Rover site</th><th className="text-right">TES inertia percentile</th><th className="pl-4">Ground truth</th><th className="text-right">Consistent</th></tr></thead>
          <tbody>
            {v.rover_sites.map((r, i) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1 capitalize">{r.id}</td><td className="text-right">P<Num path={`validation.rover_sites.${i}.tes_ti_pct`} /></td>
                <td className="pl-4 text-dim">{r.ground_truth}</td><td className="text-right font-mono">{r.consistent ? 'YES' : 'NO'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel p-3" aria-label="Local readings">
        <h2 className="text-lg font-semibold">Our own thermometer: day–night swing by surface</h2>
        {v.local.length === 0
          ? <p className="text-dim">No local readings in sites.json yet.</p>
          : <>
              <div className="h-52">
                <ResponsiveContainer>
                  <BarChart data={v.local} margin={{ left: 8, right: 16, bottom: 18, top: 10 }}>
                    <CartesianGrid stroke="#23272e" vertical={false} />
                    <XAxis dataKey="surface" {...AX} label={{ value: 'Surface measured', position: 'insideBottom', offset: -10, fill: '#99a1ac', fontSize: 12 }} />
                    <YAxis {...AX} label={{ value: 'Swing 14:00 − 06:00 (°C)', angle: -90, position: 'insideLeft', fill: '#99a1ac', fontSize: 12, dy: 70 }} />
                    <Tooltip {...TIP} cursor={{ fill: '#23272e' }} />
                    <Bar dataKey="swing_c" name="Measured swing (°C)" fill="#6ea8ff" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="mt-2 w-full text-sm">
                <thead><tr className="caps text-left"><th className="py-1">Surface</th><th className="text-right">14:00</th><th className="text-right">06:00</th><th className="text-right">Swing</th><th className="text-right">Satellite swing rank</th><th className="text-right">Order matches</th></tr></thead>
                <tbody>
                  {v.local.map((r, i) => (
                    <tr key={r.surface} className="border-t border-line">
                      <td className="py-1 capitalize">{r.surface}</td>
                      <td className="text-right"><Num path={`validation.local.${i}.ir_c_14h`} digits={1} unit=" °C" /></td>
                      <td className="text-right"><Num path={`validation.local.${i}.ir_c_06h`} digits={1} unit=" °C" /></td>
                      <td className="text-right"><Num path={`validation.local.${i}.swing_c`} digits={1} unit=" °C" /></td>
                      <td className="text-right"><Num path={`validation.local.${i}.sat_swing_rank`} digits={2} /></td>
                      <td className="text-right font-mono">{r.order_match ? 'YES' : 'NO'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-sm text-dim">Spot check of ordering only: a probe tip and a 70 m pixel are different things.</p>
            </>}
      </section>

      <section className="panel p-3" aria-label="Limits">
        <h2 className="caps mb-2 !text-denied">Limits that apply to every match</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">{GLOBAL_LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
      </section>
    </div>
  );
}
