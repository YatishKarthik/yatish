import { Link, useParams } from 'react-router-dom';
import { curveAt, siteIndex } from '../data/select';
import type { Scenario } from '../data/types';
import { BreaksDrawer, DossierDrawer } from '../panels/Drawers';
import { PermitCard } from '../panels/PermitCard';
import { SiteStrip } from '../panels/SiteStrip';
import { SeamCanvas } from '../scenes/SeamCanvas';
import { useStore, withTarget } from '../state/store';
import { ClockBar } from '../ui/ClockBar';
import { Seg } from '../ui/Seg';
import { useSeam } from './useSeam';

export function Hud({ extra }: { extra?: string }) {
  const hover = useStore((s) => s.hover);
  return (
    <div className="hide-in-director pointer-events-none absolute left-2 top-2 hidden rounded-sm sm:block bg-page/85 px-2 py-1 font-mono text-xs" aria-live="off">
      {hover
        ? <span><span className={hover.world === 'earth' ? 'text-earth' : 'text-mars'}>{hover.world.toUpperCase()}</span> · slope {hover.slopeDeg.toFixed(1)}° · height {hover.heightM.toFixed(0)} m <span className="text-dim">· read from height tile</span></span>
        : <span className="text-dim">{extra ?? 'Hover the terrain for slope and height · drag to orbit'}</span>}
    </div>
  );
}

export function MissingTiles({ earth, mars }: { earth: string[]; mars: string[] }) {
  if (!earth.length && !mars.length) return null;
  return (
    <div className="absolute bottom-2 left-2 rounded-sm bg-page/85 px-2 py-1 font-mono text-xs text-amber" role="status">
      tile missing{earth.length ? ` · Earth: ${earth.join(', ')}` : ''}{mars.length ? ` · Mars: ${mars.join(', ')}` : ''} (hatched)
    </div>
  );
}

function TempReadout({ si, ti }: { si: number; ti: number }) {
  const data = useStore((s) => s.data)!;
  const hour = useStore((s) => s.hour);
  const e = curveAt(data.sites[si].curve, hour), m = curveAt(data.targets[ti].curve, hour);
  return (
    <span className="caps" title={`sites.json → sites.${si}.curve and targets.${ti}.curve, interpolated at the clock hour`}>
      Curve now · <span className="text-earth">Earth {e.toFixed(2)}</span> · <span className="text-mars">Mars {m.toFixed(2)}</span> <span className="normal-case">(0 = coolest, 1 = warmest of each day)</span>
    </span>
  );
}

export function NotFound({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-lg font-semibold">{what} not found</h1>
      <p className="text-dim">It is not in the loaded sites.json.</p>
      <Link to={withTarget('/')} className="btn mt-3">Choose a site</Link>
    </div>
  );
}

export function SeamView() {
  const { siteId } = useParams();
  const { data, site, target, si, ti, tiles, extentM } = useSeam(siteId);
  const layer = useStore((s) => s.layer);
  const mode = useStore((s) => s.mode);
  const grid = useStore((s) => s.grid);
  const dirRail = useStore((s) => s.dirRail);
  const director = useStore((s) => s.director);
  const set = useStore((s) => s.set);
  if (!site) return <NotFound what="Site" />;
  const verdicts = site.verdicts[target.id];
  const showRail = !director || dirRail;

  return (
    <div className={`grid gap-3 p-3 ${showRail ? 'lg:grid-cols-[1fr_380px]' : ''}`}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className={`viewport ${director ? 'h-[78vh]' : 'h-[46vh] min-h-[300px] lg:h-[58vh]'}`}>
          {tiles
            ? <SeamCanvas earth={tiles.earth} mars={tiles.mars} extentM={extentM} mode={mode} earthLabel={site.name} marsLabel={target.name} />
            : <div className="flex h-full items-center justify-center font-mono text-sm text-dim">Loading terrain and 24 hourly layers…</div>}
          <Hud />
          {tiles && <MissingTiles earth={tiles.earth.missing} mars={tiles.mars.missing} />}
          <div className="pointer-events-none absolute right-2 top-2 rounded-sm bg-page/85 px-2 py-1 font-mono text-xs uppercase text-dim">
            layer: {layer}{site.mock ? <span className="text-amber"> · mock</span> : null}
          </div>
        </div>
        <ClockBar />
        <div className="hide-in-director flex flex-wrap items-center gap-x-5 gap-y-2">
          <Seg label="Terrain layer" value={layer} onChange={(v) => set({ layer: v })}
            options={[{ value: 'temperature', label: 'Temperature' }, { value: 'satellite', label: 'Satellite' }]} />
          <Seg label="Layout" value={mode} onChange={(v) => set({ mode: v })}
            options={[{ value: 'wipe', label: 'Seam' }, { value: 'split', label: 'Side by side' }]} />
          <button type="button" className="btn" aria-pressed={grid} onClick={() => set({ grid: !grid })}>Show real pixel size</button>
          <TempReadout si={si} ti={ti} />
        </div>
        {tiles && (
          <p className="hide-in-director font-mono text-xs uppercase text-dim">
            Same scale both sides · tile {(extentM / 1000).toFixed(1)} km · elevation pixel: Earth {tiles.earth.hf.sourceResM} m, Mars {tiles.mars.hf.sourceResM} m ·
            thermal pixel: Earth {tiles.earth.hf.thermalResM} m, Mars {tiles.mars.hf.thermalResM} m
          </p>
        )}
        <div className="hide-in-director"><BreaksDrawer site={site} /></div>
      </div>

      {showRail && (
        <aside className="flex flex-col gap-3" aria-label="Field-test permits and site numbers">
          {!director && <SiteStrip site={site} target={target} si={siteIndex(data, site.id)} ti={ti} />}
          {verdicts
            ? (['driving', 'landing', 'thermal'] as Scenario[]).map((sc) => (
                <PermitCard key={`${site.id}-${target.id}-${sc}`} scenario={sc} verdict={verdicts[sc]} siteId={site.id} defaultOpen={director && sc === 'driving'} />
              ))
            : <div className="panel p-3 text-dim">No verdicts for this target in sites.json.</div>}
          {!director && <DossierDrawer site={site} />}
        </aside>
      )}
    </div>
  );
}
