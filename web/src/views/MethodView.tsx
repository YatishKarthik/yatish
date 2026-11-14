import { useStore } from '../state/store';
import { Num } from '../ui/Num';

import { PARAMS, PILLARS, RESOURCES } from '../data/pillars';


function Box({ x, label, sub }: { x: number; label: string; sub: string }) {
  return (
    <g>
      <rect x={x} y={10} width={150} height={56} rx={4} fill="#161b22" stroke="#262d37" />
      <text x={x + 75} y={34} textAnchor="middle" fill="#e6e9ef" fontSize={13} fontFamily="IBM Plex Mono">{label}</text>
      <text x={x + 75} y={52} textAnchor="middle" fill="#9aa4b2" fontSize={11} fontFamily="IBM Plex Mono">{sub}</text>
    </g>
  );
}

export function MethodView() {
  const data = useStore((s) => s.data)!;
  const m = data.meta;
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-5 py-5">
      <h1 className="head">Method</h1>

      <section className="panel p-3" aria-label="Pipeline">
        <h2 className="mb-2 text-lg font-semibold">Pipeline</h2>
        <svg viewBox="0 0 850 76" className="w-full" role="img" aria-label="Pipeline: day curves per planet, percentile ranks within each planet, closeness formula, rule engine, this page">
          {[['Day curves', '24 bins per site'], ['Percentile ranks', 'within each planet'], ['Closeness', 'printed formula'], ['Rule engine', 'permit per test'], ['Web app', 'static data']].map(([l, s], i) => (
            <g key={l}>
              <Box x={i * 175} label={l} sub={s} />
              {i < 4 && <path d={`M${i * 175 + 152},38 h20 m-6,-5 l6,5 l-6,5`} stroke="#9aa4b2" fill="none" />}
            </g>
          ))}
        </svg>
      </section>

      <section className="panel p-3" aria-label="Formula">
        <h2 className="mb-2 text-lg font-semibold">Closeness formula</h2>
        {m.formula
          ? <pre className="overflow-x-auto rounded bg-page p-3 font-mono text-sm leading-relaxed" title="sites.json → meta.formula">{m.formula.join('\n')}</pre>
          : <p className="text-dim">Not available.</p>}
        <table className="mt-3 w-full max-w-md text-sm">
          <thead><tr className="caps text-left"><th className="py-1">Term</th><th className="text-right">Weight</th></tr></thead>
          <tbody>
            {(['thermal', 'terrain', 'minerals'] as const).map((k) => (
              <tr key={k} className="border-t border-line"><td className="py-1 capitalize">{k}</td><td className="text-right"><Num path={`meta.weights.${k}`} digits={2} /></td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel p-3" aria-label="Pillars and parameters">
        <h2 className="mb-2 text-lg font-semibold">Four pillars, fourteen parameters</h2>
        {m.pillar_formula && <pre className="mb-3 overflow-x-auto rounded bg-page p-3 font-mono text-sm leading-relaxed" title="sites.json → meta.pillar_formula">{m.pillar_formula.join('\n')}</pre>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="caps text-left"><th className="py-1 font-normal">Pillar</th><th className="font-normal">Parameter</th><th className="font-normal">Earth</th><th className="font-normal">Mars</th><th className="font-normal">Moon</th><th className="text-right font-normal">Weight</th><th className="font-normal">Scored</th></tr></thead>
            <tbody>
              {PILLARS.flatMap((p) => PARAMS.filter((d) => d.pillar === p.id).map((d, i, arr) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="py-1 pr-3 font-mono text-xs uppercase" style={{ color: p.colour }}>{i === 0 ? p.label : ''}</td>
                  <td className="pr-3">{d.label}{d.note && <span className="caps block">{d.note}</span>}</td>
                  <td className="pr-3 text-dim">{d.earth}</td><td className="pr-3 text-dim">{d.mars}</td><td className="pr-3 text-dim">{d.moon}</td>
                  <td className="text-right font-mono">{i === 0 ? <Num path={`meta.pillar_weights.${p.id}`} digits={2} /> : ''}{i === 0 && arr.length ? '' : ''}</td>
                  <td className={`font-mono text-xs ${d.comparable ? 'text-permit' : 'text-amber'}`}>{d.comparable ? 'yes' : 'shown only'}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-sm text-dim">Every parameter is ranked within its own planet before comparison. Radar carries weight 0 because Earth C-band and lunar S-band are not like-for-like; absolute temperatures are shown but never compared across planets.</p>
        <p className="caps mt-2">Earth thermal source in this build: <span className="text-ink" title="sites.json → meta.earth_thermal_source">{m.earth_thermal_source}</span> · common grid <Num path="meta.common_resolution_m" unit=" m" /></p>
      </section>

      <section className="panel p-3" aria-label="Challenge resources">
        <h2 className="mb-2 text-lg font-semibold">Challenge resources, and what we do with each</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="caps text-left"><th className="py-1 font-normal">Agency</th><th className="font-normal">Resource</th><th className="font-normal">Use in this project</th><th className="font-normal">Status</th></tr></thead>
            <tbody>
              {RESOURCES.map((r) => (
                <tr key={r.name} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.agency}</td>
                  <td className="pr-3"><a href={r.url} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:decoration-ink">{r.name}</a></td>
                  <td className="pr-3 text-dim">{r.use}</td>
                  <td className={`font-mono text-xs uppercase ${r.status === 'used' ? 'text-permit' : r.status === 'planned' ? 'text-amber' : 'text-dim'}`}>{r.status === 'used' ? 'used now' : r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="panel p-3" aria-label="Surface classes">
          <h2 className="mb-2 text-lg font-semibold">Surface classes</h2>
          {m.class_map
            ? <table className="w-full text-sm">
                <thead><tr className="caps text-left"><th className="py-1">Class</th><th>Meaning</th><th className="text-right">Friction μ</th></tr></thead>
                <tbody>
                  {m.class_map.map((c) => (
                    <tr key={c.id} className="border-t border-line">
                      <td className="py-1 font-mono">{c.name}</td><td className="pr-2 text-dim">{c.label}</td>
                      <td className="text-right">{m.friction ? <Num path={`meta.friction.${c.name}`} digits={2} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            : <p className="text-dim">Not available.</p>}
        </section>

        <section className="panel p-3" aria-label="Planet constants">
          <h2 className="mb-2 text-lg font-semibold">Planet constants</h2>
          <table className="w-full text-sm">
            <thead><tr className="caps text-left"><th className="py-1">Body</th><th className="text-right">Gravity</th><th className="text-right">Pressure</th><th className="text-right">Sunlight</th></tr></thead>
            <tbody>
              {Object.keys(data.planets).map((p) => (
                <tr key={p} className="border-t border-line">
                  <td className="py-1 capitalize">{p}</td>
                  <td className="text-right"><Num path={`planets.${p}.gravity`} digits={2} unit=" m/s²" /></td>
                  <td className="text-right"><Num path={`planets.${p}.pressure_bar`} digits={3} unit=" bar" /></td>
                  <td className="text-right"><Num path={`planets.${p}.solar_flux_wm2`} digits={0} unit=" W/m²" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="panel p-3" aria-label="AI use">
        <h2 className="mb-2 text-lg font-semibold">AI use</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm" title="sites.json → ai_use">{data.ai_use.map((a) => <li key={a}>{a}</li>)}</ul>
        <p className="mt-2 text-sm text-dim">Pipeline version <Num path="meta.pipeline_version" /> · generated <Num path="meta.generated_utc" />.</p>
      </section>
    </div>
  );
}
