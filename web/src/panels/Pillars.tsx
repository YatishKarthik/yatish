import { useState } from 'react';
import { Fingerprint, FingerprintLegend } from '../charts/Fingerprint';
import { bodyName } from '../data/select';
import { byPillar, PARAMS, PILLARS, SOURCE_NOTE, type ParamSource, type PillarId } from '../data/pillars';
import type { Site, Target } from '../data/types';
import { Num } from '../ui/Num';

/** Four pillars, fourteen parameters: the site's fingerprint over the target's, then each parameter side by side. */
export function Pillars({ site, target, si, ti }: { site: Site; target: Target; si: number; ti: number }) {
  const [open, setOpen] = useState<PillarId | null>('topography');
  const a = site.params, b = target.params;
  if (!a || !b) return <section className="panel p-3 text-dim">No parameter set in sites.json for this pair.</section>;
  const c = site.closeness[target.id];
  const W = bodyName(target);
  return (
    <section className="panel space-y-3 p-3" aria-label="Four pillars">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="head">Fingerprint</h2>
          <p className="text-sm text-dim">{PARAMS.length} parameters in {PILLARS.length} pillars. Two outlines that agree are a match.</p>
        </div>
        <Num path={`sites.${si}.closeness.${target.id}.total`} className="text-xl" />
      </div>
      <div className="flex justify-center"><Fingerprint a={a} b={b} size={300} labels title={`${site.name} over ${target.name}`} /></div>
      <FingerprintLegend />

      <div className="grid grid-cols-5 gap-1">
        {PILLARS.map((p) => {
          const v = c?.pillars?.[p.id];
          return (
            <button key={p.id} type="button" aria-pressed={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}
              className={`border px-2 py-2 text-left ${open === p.id ? 'border-ink' : 'border-line hover:border-dim'}`}>
              <span className="caps block">{p.short}</span>
              <span className="font-mono text-lg tabular-nums">{v == null ? '—' : v}</span>
              <span className="mt-1 block h-1 bg-line"><span className="block h-1" style={{ width: `${v ?? 0}%`, background: p.colour }} /></span>
            </button>
          );
        })}
      </div>

      {open && (
        <table className="w-full text-sm">
          <thead><tr className="caps text-left"><th className="py-1 font-normal">Parameter</th><th className="text-right font-normal">Earth</th><th className="text-right font-normal">{W}</th><th className="pl-3 font-normal">Percentile · Earth vs {W}</th></tr></thead>
          <tbody>
            {byPillar(open).map((d) => {
              const va = a[d.id], vb = b[d.id];
              return (
                <tr key={d.id} className={`border-t border-line ${d.comparable ? '' : 'text-dim'}`}>
                  <td className="py-1.5">
                    {d.label}{!d.comparable && <span className="caps block !text-amber">{d.note ?? 'shown, not scored'}</span>}
                    {d.comparable && d.note && <span className="caps block">{d.note}</span>}
                  </td>
                  <td className="text-right font-mono tabular-nums" title={`sites.json → sites.${si}.params.${d.id}`}>{va ? va.value.toFixed(d.digits) + d.unit : '—'}<Src s={va?.source} /></td>
                  <td className="text-right font-mono tabular-nums" title={`sites.json → targets.${ti}.params.${d.id}`}>{vb ? vb.value.toFixed(d.digits) + d.unit : '—'}<Src s={vb?.source} /></td>
                  <td className="pl-3">
                    {d.comparable && va && vb && (
                      <span className="relative block h-3 w-full bg-line" aria-label={`Earth ${va.pct}, ${W} ${vb.pct}`}>
                        <span className="absolute top-0 h-3 w-[2px] bg-earth" style={{ left: `${va.pct}%` }} />
                        <span className="absolute top-0 h-3 w-[2px] bg-mars" style={{ left: `${vb.pct}%` }} />
                        <span className="absolute top-1 h-1 bg-ink/50" style={{ left: `${Math.min(va.pct, vb.pct)}%`, width: `${Math.abs(va.pct - vb.pct)}%` }} />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="caps">Sources · {byPillar(open ?? 'topography').map((d) => `${d.label}: ${d.earth} / ${d[target.body]}`).join(' · ')}</p>
      <p className="caps">Earth: {PARAMS.filter((d) => a[d.id]?.source === 'measured' || a[d.id]?.source === 'reanalysis').length} of {PARAMS.length} values from real data · ○ reanalysis or derived · ◇ model · <span className="text-amber">●</span> mock</p>
      {c?.gate != null && c.gate < 1 && <p className="caps !text-denied">Vegetation mask applied: score × {c.gate}</p>}
    </section>
  );
}

function Src({ s }: { s?: ParamSource }) {
  if (!s || s === 'measured') return null;
  return <span className={`ml-1 ${s === 'mock' ? 'text-amber' : 'text-dim'}`} title={SOURCE_NOTE[s]}>{s === 'mock' ? '●' : s === 'model' ? '◇' : '○'}</span>;
}
