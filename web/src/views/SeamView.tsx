import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ribbon } from '../charts/Ribbon';
import { curveAt, siteIndex } from '../data/select';
import type { Scenario } from '../data/types';
import { DossierDrawer } from '../panels/Drawers';
import { PermitCard } from '../panels/PermitCard';
import { SiteStrip } from '../panels/SiteStrip';
import { SeamCanvas } from '../scenes/SeamCanvas';
import { useStore, withTarget } from '../state/store';
import { ClockBar } from '../ui/ClockBar';
import { Seg } from '../ui/Seg';
import { startDrone, stopDrone } from '../ui/sound';
import { useSeam } from './useSeam';

export function Hud({ extra }: { extra?: string }) {
  const hover = useStore((s) => s.hover);
  return (
    <div className="hide-in-director pointer-events-none absolute left-2 top-2 hidden rounded-sm sm:block bg-page/85 px-2 py-1 font-mono text-xs" aria-live="off">
      {hover
        ? <span><span className={hover.world === 'earth' ? 'text-earth' : 'text-mars'}>{hover.world.toUpperCase()}</span> · slope {hover.slopeDeg.toFixed(1)}° · height {hover.heightM.toFixed(0)} m</span>
        : <span className="text-dim">{extra ?? 'Drag to orbit'}</span>}
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
      Now · <span className="text-earth">Earth {e.toFixed(2)}</span> · <span className="text-mars">Mars {m.toFixed(2)}</span>
    </span>
  );
}

export function NotFound({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-lg font-semibold">{what} not found</h1>
            <Link to={withTarget('/sol')} className="btn mt-3">Choose a site</Link>
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
  const cam = useStore((s) => s.cam);
  const sound = useStore((s) => s.sound);
  const swing = site?.features.amplitude_pct;
  useEffect(() => {
    if (sound && swing != null) startDrone(swing);
    return stopDrone;
  }, [sound, swing]);
  if (!site) return <NotFound what="Site" />;
  const verdicts = site.verdicts[target.id];
  const showRail = !director || dirRail;

  return (
    <div className={`grid gap-3 p-3 ${showRail ? 'lg:grid-cols-[1fr_380px]' : ''}`}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className={`viewport ${director ? 'letterbox' : 'h-[46vh] min-h-[300px] lg:h-[58vh]'}`}>
          {tiles
            ? <SeamCanvas earth={tiles.earth} mars={tiles.mars} extentM={extentM} mode={mode} earthLabel={site.name} marsLabel={target.name} earthClass={site.class.name} marsClass={target.class?.name} />
            : <div className="flex h-full items-center justify-center font-mono text-sm text-dim">Loading terrain…</div>}
          <div className="fx" />
          <Hud />
          {tiles && <MissingTiles earth={tiles.earth.missing} mars={tiles.mars.missing} />}
          <div className="pointer-events-none absolute right-2 top-2 rounded-sm bg-page/85 px-2 py-1 font-mono text-xs uppercase text-dim">
            {layer}
          </div>
        </div>
        <ClockBar />
        <div className="hide-in-director grid grid-cols-[64px_1fr] items-center gap-x-3 gap-y-1">
          <span className="caps !text-earth">Earth</span>
          <Ribbon curve={site.curve} source={site.curve_source} swingPct={site.features.amplitude_pct} label={`${site.name} thermal day`} />
          <span className="caps !text-mars">Mars</span>
          <Ribbon curve={target.curve} source={target.curve_source} swingPct={target.features.amplitude_pct} label={`${target.name} thermal day`} />
        </div>
        <div className="hide-in-director flex flex-wrap items-center gap-x-5 gap-y-2">
          <Seg label="Terrain layer" value={layer} onChange={(v) => set({ layer: v })}
            options={[{ value: 'temperature', label: 'Temperature' }, { value: 'satellite', label: 'Satellite' }]} />
          <Seg label="Layout" value={mode} onChange={(v) => set({ mode: v })}
            options={[{ value: 'wipe', label: 'Seam' }, { value: 'split', label: 'Side by side' }]} />
          <Seg label="Camera" value={cam} onChange={(v) => set({ cam: v })}
            options={[{ value: 'survey', label: 'Survey' }, { value: 'walk', label: 'Walk' }, { value: 'overhead', label: 'Overhead' }]} />
          <button type="button" className="btn" aria-pressed={grid} onClick={() => set({ grid: !grid })}>Pixel grid</button>
          <TempReadout si={si} ti={ti} />
        </div>
        {tiles && (
          <p className="hide-in-director font-mono text-xs uppercase text-dim">
            {(extentM / 1000).toFixed(1)} km tile · elevation {tiles.earth.hf.sourceResM} m / {tiles.mars.hf.sourceResM} m · thermal {tiles.earth.hf.thermalResM} m / {tiles.mars.hf.thermalResM} m (Earth / Mars)
            {site.tile_source && <><br />Earth: {site.tile_source.elevation} · {site.tile_source.imagery.split(' ').slice(0, 2).join(' ')}</>}
            {target.tile_source && <><br />Mars: {target.tile_source.elevation.split(' ').slice(0, 4).join(' ')} and orthoimage</>}
          </p>
        )}
      </div>

      {showRail && (
        <aside className="flex flex-col gap-3" aria-label="Permits and site numbers">
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
