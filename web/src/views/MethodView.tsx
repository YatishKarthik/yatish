import { useStore } from '../state/store';
import { Num } from '../ui/Num';

const DATA_ROWS = [
  ['Earth surface temperature', 'NASA ECOSTRESS L2T LSTE v2', '70 m', 'many local times (ISS orbit)'],
  ['Earth temperature fallback', 'NASA MODIS MYD11A2', '1 km', '13:30 and 01:30 only'],
  ['Earth elevation', 'Copernicus DEM GLO-30', '30 m → 100 m', '—'],
  ['Earth minerals', 'NASA EMIT L2A reflectance', '60 m', 'presence flags only'],
  ['Mars surface temperature', 'Hope EMIRS L3 (MBRSC / EMM)', '100–300 km', 'all local times'],
  ['Mars thermal inertia', 'MGS TES (Putzig & Mellon)', '≈ 3 km', 'night side'],
  ['Mars elevation', 'MOLA MEGDR', '463 m', 'upsampled for display'],
];

function Box({ x, label, sub }: { x: number; label: string; sub: string }) {
  return (
    <g>
      <rect x={x} y={10} width={150} height={56} rx={4} fill="#101215" stroke="#23272e" />
      <text x={x + 75} y={34} textAnchor="middle" fill="#eef0f2" fontSize={13} fontFamily="Geist Mono Variable">{label}</text>
      <text x={x + 75} y={52} textAnchor="middle" fill="#99a1ac" fontSize={11} fontFamily="Geist Mono Variable">{sub}</text>
    </g>
  );
}

export function MethodView() {
  const data = useStore((s) => s.data)!;
  const m = data.meta;
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-5 py-5">
      <h1 className="display text-xl">Method</h1>

      <section className="panel p-3" aria-label="Pipeline">
        <h2 className="mb-2 text-lg font-semibold">From satellite scenes to a permit</h2>
        <svg viewBox="0 0 850 76" className="w-full" role="img" aria-label="Pipeline: day curves per planet, percentile ranks within each planet, closeness formula, rule engine, this page">
          {[['Day curves', '24 bins per site'], ['Percentile ranks', 'within each planet'], ['Closeness', 'printed formula'], ['Rule engine', 'permit per test'], ['This page', 'static sites.json']].map(([l, s], i) => (
            <g key={l}>
              <Box x={i * 175} label={l} sub={s} />
              {i < 4 && <path d={`M${i * 175 + 152},38 h20 m-6,-5 l6,5 l-6,5`} stroke="#99a1ac" fill="none" />}
            </g>
          ))}
        </svg>
        <p className="mt-2 text-sm text-dim">Nothing is scored in the browser. Hover any number in this app to see the sites.json field it came from.</p>
      </section>

      <section className="panel p-3" aria-label="Formula">
        <h2 className="mb-2 text-lg font-semibold">Closeness formula</h2>
        {m.formula
          ? <pre className="overflow-x-auto rounded bg-page p-3 font-mono text-sm leading-relaxed" title="sites.json → meta.formula">{m.formula.join('\n')}</pre>
          : <p className="text-dim">meta.formula is not in sites.json yet.</p>}
        <table className="mt-3 w-full max-w-md text-sm">
          <thead><tr className="caps text-left"><th className="py-1">Term</th><th className="text-right">Weight</th></tr></thead>
          <tbody>
            {(['thermal', 'terrain', 'minerals'] as const).map((k) => (
              <tr key={k} className="border-t border-line"><td className="py-1 capitalize">{k}</td><td className="text-right"><Num path={`meta.weights.${k}`} digits={2} /></td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-dim">If a term is missing for a site (for example no EMIT scene), the remaining weights are renormalised and the card says so.</p>
      </section>

      <section className="panel p-3" aria-label="Data and resolutions">
        <h2 className="mb-2 text-lg font-semibold">Data, like for like, with resolutions</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="caps text-left"><th className="py-1">Quantity</th><th>Dataset</th><th>Resolution</th><th>Local time coverage</th></tr></thead>
            <tbody>{DATA_ROWS.map((r) => <tr key={r[0]} className="border-t border-line">{r.map((c, i) => <td key={i} className={`py-1 pr-3 ${i ? 'text-dim' : ''}`}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className="caps mt-2">Earth thermal source in this build: <span className="text-ink" title="sites.json → meta.earth_thermal_source">{m.earth_thermal_source}</span> · common grid <Num path="meta.common_resolution_m" unit=" m" /></p>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="panel p-3" aria-label="Surface classes">
          <h2 className="mb-2 text-lg font-semibold">Surface classes (k-means, k = 4)</h2>
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
            : <p className="text-dim">meta.class_map is not in sites.json yet.</p>}
          <p className="mt-2 text-sm text-dim">Clusters are ordered by thermal inertia and named by a human after checking imagery. Mars targets get a class by nearest centroid.</p>
        </section>

        <section className="panel p-3" aria-label="Planet constants">
          <h2 className="mb-2 text-lg font-semibold">Planet constants used by the rules</h2>
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
        <h2 className="mb-2 text-lg font-semibold">Where AI is used, and where it is not</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm" title="sites.json → ai_use">{data.ai_use.map((a) => <li key={a}>{a}</li>)}</ul>
        <p className="mt-2 text-sm text-dim">No learned model sits inside the closeness score or the permits. Pipeline version <Num path="meta.pipeline_version" /> · generated <Num path="meta.generated_utc" />.</p>
      </section>
    </div>
  );
}
