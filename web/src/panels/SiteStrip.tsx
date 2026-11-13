import { bodyName, getPath, resolutionLabel } from '../data/select';
import type { Site, Target } from '../data/types';
import { useStore } from '../state/store';
import { Num } from '../ui/Num';

function Bar({ label, path, colour = '#e6e9ef' }: { label: string; path: string; colour?: string }) {
  return (
    <div className="grid grid-cols-[124px_1fr_36px] items-center gap-2">
      <span className="caps">{label}</span>
      <BarFill path={path} colour={colour} />
      <Num path={path} className="text-right text-sm" />
    </div>
  );
}
function BarFill({ path, colour }: { path: string; colour: string }) {
  const v = getPath(useStore((s) => s.data), path);
  return (
    <span className="h-1 bg-line" aria-hidden>
      <span className="block h-1" style={{ width: `${typeof v === 'number' ? Math.min(100, Math.max(0, v)) : 0}%`, background: colour }} />
    </span>
  );
}

export function SiteStrip({ site, target, si, ti }: { site: Site; target: Target; si: number; ti: number }) {
  const c = `sites.${si}.closeness.${target.id}`;
  return (
    <section className={`panel space-y-3 p-3 ${site.mock ? 'mock' : ''}`} aria-label="Site numbers">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="head">{site.name}</h2>
          <p className="text-sm text-dim">{site.region} · <Num path={`sites.${si}.area_km2`} digits={0} unit=" km²" /></p>
        </div>
        <div className="text-right">
          <Num path={`${c}.total`} className="text-xl text-ink" />
          <p className="caps">closeness to {target.name}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Bar label="Thermal" path={`${c}.thermal`} />
        <Bar label="Terrain" path={`${c}.terrain`} />
        {site.closeness[target.id]?.minerals != null
          ? <Bar label="Minerals" path={`${c}.minerals`} />
          : <p className="caps">Minerals: no data</p>}
      </div>
      <div>
        <p className="caps mb-1">Percentile within each planet</p>
        <div className="space-y-1.5">
          <Bar label="Swing · Earth" path={`sites.${si}.features.amplitude_pct`} colour="#4f8df7" />
          <Bar label={`Swing · ${bodyName(target)}`} path={`targets.${ti}.features.amplitude_pct`} colour="#e0673a" />
          <Bar label="Inertia · Earth" path={`sites.${si}.features.ati_star_pct`} colour="#4f8df7" />
          <Bar label={`Inertia · ${bodyName(target)}`} path={`targets.${ti}.features.ati_star_pct`} colour="#e0673a" />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="caps">Class</dt><dd>{site.class.name}{target.class ? <span className="text-dim"> · target {target.class.name}</span> : null}</dd>
        <dt className="caps">Mean slope</dt>
        <dd><Num path={`sites.${si}.features.mean_slope_deg`} digits={1} unit="°" /> <span className="text-dim">vs</span> <Num path={`targets.${ti}.features.mean_slope_deg`} digits={1} unit="°" /></dd>
        <dt className="caps">Roughness</dt>
        <dd><Num path={`sites.${si}.features.roughness_rms_m`} digits={1} unit=" m" /> <span className="text-dim">vs</span> <Num path={`targets.${ti}.features.roughness_rms_m`} digits={1} unit=" m" /></dd>
        <dt className="caps">Thermal data</dt><dd className="font-mono text-xs uppercase">{resolutionLabel(site)}</dd>
        <dt className="caps">{bodyName(target)} data</dt><dd className="font-mono text-xs uppercase">{resolutionLabel(target)}</dd>
        <dt className="caps">Catalogue</dt>
        <dd>{site.catalogue.status}</dd>
      </dl>
      <p className="text-sm text-dim">{site.class.label}</p>
    </section>
  );
}
