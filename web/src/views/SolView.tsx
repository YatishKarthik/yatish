import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ribbon, RibbonAxis } from '../charts/Ribbon';
import { asset } from '../data/load';
import { rankedSites, resolutionLabel, siteIndex, targetIndex, tempColour } from '../data/select';
import { useStore, withTarget } from '../state/store';
import { ClockBar } from '../ui/ClockBar';
import { Num } from '../ui/Num';
import { Seg } from '../ui/Seg';

export function SolView() {
  const data = useStore((s) => s.data)!;
  const targetId = useStore((s) => s.target);
  const setTarget = useStore((s) => s.setTarget);
  const [cls, setCls] = useState('all');
  const [cat, setCat] = useState('all');
  const target = data.targets[Math.max(0, targetIndex(data, targetId))];
  const ranked = rankedSites(data, target.id).filter((s) => (cls === 'all' || s.class.name === cls) && (cat === 'all' || s.catalogue.status === cat));
  const classes = ['all', ...new Set(data.sites.map((s) => s.class.name))];
  const cats = ['all', ...new Set(data.sites.map((s) => s.catalogue.status))];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5">
      <div>
        <p className="caps mb-2 rise">Earth analogs for Mars · matched by how the ground behaves</p>
        <h1 className="display rise text-xl md:text-2xl">One sol<span className="text-accent"> / </span>two worlds</h1>
        <p className="rise mt-3 max-w-2xl text-dim" style={{ animationDelay: '100ms' }}>Each band is a site's day: 24 hours of ground temperature, left to right. Pick a Mars target, then look for Earth bands with the same shape.</p>
      </div>

      <section aria-label="Mars targets" className="grid gap-3 sm:grid-cols-3">
        {data.targets.map((t) => {
          const ti = targetIndex(data, t.id), on = t.id === target.id;
          return (
            <button key={t.id} type="button" aria-pressed={on} onClick={() => setTarget(t.id)}
              className={`panel row flex flex-col gap-2 p-3 text-left ${on ? '!border-accent' : ''}`}>
              <span className="flex items-center gap-3">
                {t.satellite_tile && <img src={asset(t.satellite_tile)} alt="" width={48} height={48} className="h-12 w-12 rounded-sm object-cover" />}
                <span>
                  <span className="display block text-sm">{t.name}</span>
                  <span className="caps !normal-case">{t.why}</span>
                </span>
              </span>
              <Ribbon curve={t.curve} source={t.curve_source} swingPct={t.features.amplitude_pct} label={`${t.name} thermal day`} />
              <span className="caps">{resolutionLabel(t)} · swing P<Num path={`targets.${ti}.features.amplitude_pct`} /></span>
            </button>
          );
        })}
      </section>

      <ClockBar />

      <section aria-label="Earth sites ranked for the chosen target" className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h2 className="display text-sm">Earth sites for {target.name}</h2>
          <span className="flex items-center gap-2"><span className="caps">Class</span>
            <Seg label="Filter by surface class" value={cls} onChange={setCls} options={classes.map((c) => ({ value: c, label: c }))} /></span>
          <span className="flex items-center gap-2"><span className="caps">Catalogue</span>
            <Seg label="Filter by catalogue status" value={cat} onChange={setCat} options={cats.map((c) => ({ value: c, label: c }))} /></span>
        </div>

        <div className="panel grid grid-cols-[1fr] gap-x-4 px-3 py-2 md:grid-cols-[220px_1fr_150px]">
          <span className="caps self-center !text-mars">Reference · {target.name}</span>
          <div><Ribbon curve={target.curve} source={target.curve_source} swingPct={target.features.amplitude_pct} label="Target thermal day" /><RibbonAxis /></div>
          <span className="caps self-center md:text-right">local solar time</span>
        </div>

        {ranked.length === 0 && (
          <div className="panel p-4 text-dim">No sites match these filters. <button type="button" className="btn ml-2" onClick={() => { setCls('all'); setCat('all'); }}>Clear filters</button></div>
        )}
        <ol className="space-y-2">
          {ranked.map((s, rank) => {
            const si = siteIndex(data, s.id);
            return (
              <li key={`${target.id}-${s.id}`} className="rise" style={{ animationDelay: `${rank * 50}ms` }}>
                <Link to={withTarget(`/seam/${s.id}`)}
                  className={`panel row grid grid-cols-[1fr] items-center gap-x-4 gap-y-1 px-3 py-3 md:grid-cols-[220px_1fr_150px] ${s.mock ? 'mock' : ''}`}>
                  <span>
                    <span className="block font-semibold"><span className="mr-2 font-mono text-sm font-normal text-dim">{String(rank + 1).padStart(2, '0')}</span>{s.name}</span>
                    <span className="caps !normal-case">{s.region}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <span className="chip">{s.class.name}</span>
                      <span className="chip">{s.catalogue.status}</span>
                      {s.kind === 'negative_control' && <span className="chip !text-denied">decoy</span>}
                      {s.kind === 'positive_control' && <span className="chip !text-permit">known analog</span>}
                      {s.mock && <span className="chip !text-amber">mock</span>}
                    </span>
                  </span>
                  <span>
                    <Ribbon curve={s.curve} source={s.curve_source} swingPct={s.features.amplitude_pct} label={`${s.name} thermal day`} />
                    <span className="caps">{resolutionLabel(s)} · swing P<Num path={`sites.${si}.features.amplitude_pct`} /></span>
                  </span>
                  <span className="md:text-right">
                    <Num path={`sites.${si}.closeness.${target.id}.total`} className="text-2xl text-ink" />
                    <span className="caps block">closeness</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-label="Legend" className="panel flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-sm text-dim">
        <span className="flex items-center gap-2">
          <span className="caps">coolest</span>
          <span className="h-2 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(tempColour).join(',')})` }} />
          <span className="caps">warmest of that site's day</span>
        </span>
        <span>Band thickness: size of the day–night swing, as a percentile within its own planet.</span>
        <span>Dashed cells: no data at that hour (2-point MODIS).</span>
      </section>
    </div>
  );
}
