import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PARAM_INDEX, PARAMS, type ParamId } from '../data/pillars';
import { bodyName, targetIndex } from '../data/select';
import type { Site, Target } from '../data/types';
import { useProgress } from '../state/progress';
import { useStore } from '../state/store';
import { Seg } from '../ui/Seg';

// five families: distinguishable by lightness as well as hue, and always named in the legend
const FAMILY = ['#e6e9ef', '#4f8df7', '#3fb950', '#f2a93b', '#c084fc'];
const REDUCE = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const label = (id: string) => PARAM_INDEX[id as ParamId]?.short ?? id;

function Space({ sites, targets, target, colourBy, neighbours }: { sites: Site[]; targets: Target[]; target: Target; colourBy: 'family' | 'closeness'; neighbours: string[] }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<string | null>(null);
  const S = 3;
  const tp = target.ml!.pca.map((v) => v * S) as [number, number, number];
  const tone = (s: Site) => {
    if (colourBy === 'family') return FAMILY[s.ml!.cluster % FAMILY.length];
    const c = (s.closeness[target.id]?.total ?? 0) / 100;     // grey to amber: the closeness ramp
    return `rgb(${Math.round(58 + c * 197)},${Math.round(63 + c * 161)},${Math.round(71 + c * 67)})`;
  };
  return (
    <>
      {/* axes through the origin, one per principal component */}
      {([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const).map((d, i) => (
        <Line key={i} points={[[-d[0] * S, -d[1] * S, -d[2] * S], [d[0] * S, d[1] * S, d[2] * S]]} color="#2c3440" lineWidth={1} />
      ))}
      {neighbours.map((id) => { const s = sites.find((x) => x.id === id); return s?.ml ? <Line key={id} points={[tp, s.ml.pca.map((v) => v * S) as [number, number, number]]} color="#e0673a" lineWidth={1.5} transparent opacity={0.8} /> : null; })}
      {sites.map((s) => s.ml && (
        <mesh key={s.id} position={s.ml.pca.map((v) => v * S) as [number, number, number]}
          onPointerOver={(e) => { e.stopPropagation(); setHover(s.id); }} onPointerOut={() => setHover(null)}
          onClick={(e) => { e.stopPropagation(); navigate({ pathname: `/seam/${s.id}`, hash: `#t=${target.id}` }); }}>
          <sphereGeometry args={[neighbours.includes(s.id) ? 0.085 : 0.06, 16, 12]} />
          <meshBasicMaterial color={tone(s)} />
          {hover === s.id && <Html center zIndexRange={[30, 0]}><div className="hud-tag pointer-events-none -translate-y-6 whitespace-nowrap font-mono text-xs text-ink">{s.name} · {s.closeness[target.id]?.total}</div></Html>}
        </mesh>
      ))}
      {targets.map((t) => t.ml && (
        <mesh key={t.id} position={t.ml.pca.map((v) => v * S) as [number, number, number]} rotation={[0.6, 0.6, 0]}
          onPointerOver={(e) => { e.stopPropagation(); setHover(t.id); }} onPointerOut={() => setHover(null)}
          onClick={(e) => { e.stopPropagation(); useStore.getState().setTarget(t.id); }}>
          <octahedronGeometry args={[t.id === target.id ? 0.17 : 0.1]} />
          <meshBasicMaterial color={t.id === target.id ? '#e0673a' : '#8a4a32'} wireframe={t.id !== target.id} />
          {(hover === t.id || t.id === target.id) && <Html center zIndexRange={[30, 0]}><div className="hud-tag pointer-events-none -translate-y-7 whitespace-nowrap font-mono text-xs text-mars">{t.name}</div></Html>}
        </mesh>
      ))}
      <OrbitControls enablePan={false} autoRotate={!REDUCE && !hover} autoRotateSpeed={0.6} minDistance={4} maxDistance={14} />
    </>
  );
}

function Scatter({ pts, xl, yl, onPick }: { pts: { id: string; x: number; y: number; colour: string; name: string; target?: boolean; big?: boolean }[]; xl: string; yl: string; onPick?: (id: string) => void }) {
  const W = 520, H = 320, p = 36;
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const X = (v: number) => p + ((v - x0) / (x1 - x0 || 1)) * (W - p * 2), Y = (v: number) => H - p - ((v - y0) / (y1 - y0 || 1)) * (H - p * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${yl} against ${xl} for every Earth site and target`}>
      <rect x={p} y={p} width={W - p * 2} height={H - p * 2} fill="none" stroke="#2c3440" />
      <text x={W / 2} y={H - 8} textAnchor="middle" fontSize={11} fontFamily="IBM Plex Mono" fill="#aeb7c2">{xl}</text>
      <text x={12} y={H / 2} textAnchor="middle" fontSize={11} fontFamily="IBM Plex Mono" fill="#aeb7c2" transform={`rotate(-90 12 ${H / 2})`}>{yl}</text>
      {pts.map((q) => q.target
        ? <rect key={q.id} x={X(q.x) - (q.big ? 6 : 4)} y={Y(q.y) - (q.big ? 6 : 4)} width={q.big ? 12 : 8} height={q.big ? 12 : 8} transform={`rotate(45 ${X(q.x)} ${Y(q.y)})`} fill={q.big ? '#e0673a' : 'none'} stroke="#e0673a"><title>{q.name}</title></rect>
        : <circle key={q.id} cx={X(q.x)} cy={Y(q.y)} r={4} fill={q.colour} opacity={0.9} onClick={() => onPick?.(q.id)} style={{ cursor: onPick ? 'pointer' : undefined }}><title>{q.name}</title></circle>)}
    </svg>
  );
}

export function AnalysisView() {
  const data = useStore((s) => s.data)!;
  const targetId = useStore((s) => s.target);
  const navigate = useNavigate();
  const [colourBy, setColourBy] = useState<'family' | 'closeness'>('family');
  const [px, setPx] = useState<ParamId>('slope_p90'), [py, setPy] = useState<ParamId>('temp_delta_c');
  useEffect(() => { useProgress.getState().award('flag', 'analysis'); }, []);
  const target = data.targets[Math.max(0, targetIndex(data, targetId))];
  const ml = data.meta.ml;
  const sites = data.sites.filter((s) => s.ml && s.params);

  // correlation between parameters across the Earth sites (Pearson on percentiles)
  const corr = useMemo(() => {
    const f = ml?.features ?? [];
    const col = (id: string) => sites.map((s) => s.params![id as ParamId]!.pct);
    const r = (a: number[], b: number[]) => {
      const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
      let n = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
      return da && db ? n / Math.sqrt(da * db) : 0;
    };
    return f.map((a) => f.map((b) => r(col(a), col(b))));
  }, [ml, sites]);

  if (!ml || !target.ml) return <div className="p-8 text-dim">No analysis block in sites.json. Run <code className="font-mono">npm run ml</code>.</div>;
  const neighbours = ml.neighbours[target.id] ?? [];
  const open = (id: string) => navigate({ pathname: `/seam/${id}`, hash: `#t=${target.id}` });
  const fam = (s: Site) => FAMILY[s.ml!.cluster % FAMILY.length];
  const rho = ml.agreement[target.id];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-5 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="head">Parameter space</h1>
          <p className="max-w-2xl text-sm text-dim">Every Earth site and target as a point, placed by machine learning from {ml.features.length} comparable parameters. Used to explore and to cross-check the formula. It is never part of the closeness score.</p>
        </div>
        <Seg label="Colour points by" value={colourBy} onChange={setColourBy} options={[{ value: 'family', label: 'Family' }, { value: 'closeness', label: `Closeness to ${target.name.split(' ')[0]}` }]} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="viewport h-[52vh] min-h-[340px]">
          <Canvas camera={{ position: [5.5, 3.5, 7], fov: 38 }} dpr={[1, 2]} aria-label="Three-dimensional principal-component space of all sites and targets">
            <Space sites={sites} targets={data.targets} target={target} colourBy={colourBy} neighbours={neighbours} />
          </Canvas>
          <div className="pointer-events-none absolute left-2 top-2 space-y-0.5 font-mono text-xs text-dim">
            {ml.pca.map((c) => <p key={c.pc}>axis {c.pc} · {(c.explained * 100).toFixed(0)}% · {c.top.map((t) => label(t.id)).join(', ')}</p>)}
          </div>
          <p className="pointer-events-none absolute bottom-2 right-10 font-mono text-xs text-dim">drag to turn · click a point to open it</p>
        </div>
        <aside className="space-y-3">
          <div className="panel p-3">
            <h2 className="head mb-2">Nearest in this space to {target.name}</h2>
            <ol className="space-y-1">
              {neighbours.map((id, i) => { const s = data.sites.find((x) => x.id === id)!; return (
                <li key={id}><button type="button" onClick={() => open(id)} className="row flex w-full items-center justify-between border border-line px-3 py-1.5 text-left">
                  <span><span className="mr-2 font-mono text-sm text-dim">{String(i + 1).padStart(2, '0')}</span>{s.name}</span>
                  <span className="font-mono tabular-nums" title={`sites.json → closeness.${target.id}.total`}>{s.closeness[target.id]?.total}</span>
                </button></li>
              ); })}
            </ol>
            <p className="caps mt-2">number = formula closeness · order = distance in parameter space</p>
          </div>
          <div className="panel space-y-2 p-3 text-sm">
            <h2 className="head">What the models say</h2>
            <p><span className="font-mono">ρ = {rho?.toFixed(2)}</span> · agreement between plain nearest-neighbour distance and the printed formula for {target.name} (1 = same order). Across all targets: <span className="font-mono">{ml.mean_agreement.toFixed(2)}</span>.</p>
            <p><span className="font-mono">{(ml.pca.reduce((a, c) => a + c.explained, 0) * 100).toFixed(0)}%</span> of the variation is visible in these three axes (PCA).</p>
            <p><span className="font-mono">{ml.kmeans.silhouette.toFixed(2)}</span> silhouette for {ml.kmeans.k} k-means families: the groups overlap, so treat them as loose.</p>
            <p><span className="font-mono">R² {ml.autoencoder.r2.toFixed(2)}</span> for a {ml.autoencoder.layers.join('-')} neural autoencoder squeezing the space to two numbers.</p>
            <p className="caps">{ml.samples} places · unsupervised · no labels exist for "valid analog"</p>
          </div>
        </aside>
      </div>

      <section className="panel flex flex-wrap items-center gap-x-5 gap-y-2 p-3" aria-label="Families">
        <span className="head">Families</span>
        {ml.kmeans.families.map((f) => (
          <span key={f.id} className="flex items-center gap-2 text-sm"><span className="inline-block h-3 w-3 rounded-full" style={{ background: FAMILY[f.id % FAMILY.length] }} />{f.direction} {label(f.trait)} <span className="font-mono text-dim">{f.size}</span></span>
        ))}
        <span className="flex items-center gap-2 text-sm"><span className="inline-block h-3 w-3 rotate-45 border border-mars" />target</span>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-3" aria-label="Neural map">
          <h2 className="head mb-1">Neural map</h2>
          <p className="mb-2 text-sm text-dim">The autoencoder's two-number summary of each place. Near points are places the network finds alike.</p>
          <Scatter xl="neuron 1" yl="neuron 2" onPick={open}
            pts={[...sites.map((s) => ({ id: s.id, x: s.ml!.map[0], y: s.ml!.map[1], colour: fam(s), name: s.name })), ...data.targets.filter((t) => t.ml).map((t) => ({ id: t.id, x: t.ml!.map[0], y: t.ml!.map[1], colour: '', name: `${bodyName(t)} · ${t.name}`, target: true, big: t.id === target.id }))]} />
        </section>
        <section className="panel p-3" aria-label="Compare two parameters">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h2 className="head">Two parameters</h2>
            {([['x', px, setPx], ['y', py, setPy]] as const).map(([ax, v, set]) => (
              <label key={ax} className="flex items-center gap-1"><span className="caps">{ax}</span>
                <select value={v} onChange={(e) => set(e.target.value as ParamId)} className="min-h-[32px] rounded border border-line bg-panel px-1 font-mono text-xs text-ink">
                  {PARAMS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <Scatter xl={`${PARAM_INDEX[px].label} (percentile within planet)`} yl={`${PARAM_INDEX[py].label} (percentile)`} onPick={open}
            pts={[...sites.map((s) => ({ id: s.id, x: s.params![px]!.pct, y: s.params![py]!.pct, colour: fam(s), name: s.name })), ...data.targets.filter((t) => t.params).map((t) => ({ id: t.id, x: t.params![px]!.pct, y: t.params![py]!.pct, colour: '', name: t.name, target: true, big: t.id === target.id }))]} />
        </section>
      </div>

      <section className="panel p-3" aria-label="Correlation between parameters">
        <h2 className="head mb-1">Which parameters move together</h2>
        <p className="mb-2 text-sm text-dim">Correlation across the {sites.length} Earth sites. Strongly linked parameters carry overlapping information, which matters when weights are set.</p>
        <div className="overflow-x-auto">
          <table className="border-collapse font-mono text-xs">
            <thead><tr><th />{ml.features.map((f) => <th key={f} className="h-20 w-9 align-bottom font-normal text-dim"><span className="block origin-bottom-left -rotate-60 whitespace-nowrap" style={{ transform: 'rotate(-55deg) translateX(8px)' }}>{label(f)}</span></th>)}</tr></thead>
            <tbody>
              {ml.features.map((a, i) => (
                <tr key={a}><th className="pr-2 text-right font-normal text-dim">{label(a)}</th>
                  {ml.features.map((b, j) => { const r = corr[i]?.[j] ?? 0; return (
                    <td key={b} className="h-9 w-9 border border-page text-center" title={`${label(a)} × ${label(b)}: r = ${r.toFixed(2)}`}
                      style={{ background: r >= 0 ? `rgba(230,233,239,${Math.abs(r) * 0.85})` : `rgba(224,103,58,${Math.abs(r) * 0.85})`, color: Math.abs(r) > 0.55 ? '#0e1116' : '#aeb7c2' }}>
                      {i === j ? '' : (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(1).slice(1)}
                    </td>
                  ); })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="caps mt-2">white = move together · orange = move opposite · sign printed in every cell</p>
      </section>
    </div>
  );
}
