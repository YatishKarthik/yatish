import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Fingerprint } from '../charts/Fingerprint';
import { Ribbon, RibbonAxis } from '../charts/Ribbon';
import { asset } from '../data/load';
import { bodyName, rankedSites, resolutionLabel, siteIndex, targetIndex, tempColour } from '../data/select';
import { useStore, withTarget } from '../state/store';
import { ClockBar } from '../ui/ClockBar';
import { Num } from '../ui/Num';
import { Seg } from '../ui/Seg';
import { useFlip } from '../ui/useFlip';

export function SolView() {
  const data = useStore((s) => s.data)!;
  const targetId = useStore((s) => s.target);
  const setTarget = useStore((s) => s.setTarget);
  const [cls, setCls] = useState('all');
  const [cat, setCat] = useState('all');
  const target = data.targets[Math.max(0, targetIndex(data, targetId))];
  const ranked = rankedSites(data, target.id).filter((s) => (cls === 'all' || s.class.name === cls) && (cat === 'all' || s.catalogue.status === cat));
  const listRef = useFlip<HTMLOListElement>(`${target.id}|${cls}|${cat}`);
  const bodies = [...new Set(data.targets.map((t) => t.body))];
  const classes = ['all', ...new Set(data.sites.map((s) => s.class.name))];
  const cats = ['all', ...new Set(data.sites.map((s) => s.catalogue.status))];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-5 py-5">
      <h1 className="sr-only">Thermal Twin: choose a target and compare Earth sites by their thermal day</h1>

      <section aria-label="Targets" className="space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="flex flex-wrap items-center gap-3"><h2 className="head">{bodyName(target)} targets</h2>
            {bodies.length > 1 && <Seg label="World" value={target.body} onChange={(b) => setTarget(data.targets.find((t) => t.body === b)!.id)} options={bodies.map((b) => ({ value: b, label: b === 'moon' ? 'Moon' : 'Mars' }))} />}</span>
          <span className="caps">ground temperature over one day</span>
        </div>
        {data.targets.filter((t) => t.body === target.body).map((t) => {
          const ti = targetIndex(data, t.id), on = t.id === target.id;
          return (
            <button key={t.id} type="button" aria-pressed={on} onClick={() => setTarget(t.id)}
              className={`panel row grid w-full grid-cols-[1fr] items-center gap-x-5 gap-y-1 border-l-2 px-3 py-2 text-left md:grid-cols-[220px_1fr_150px] ${on ? '!border-l-ink' : ''}`}>
              <span className="flex items-center gap-3">
                {t.satellite_tile && <img src={asset(t.satellite_tile)} alt="" width={40} height={40} className="h-10 w-10 object-cover" />}
                <span>
                  <span className="block font-semibold">{t.name}</span>
                  <span className="block text-sm text-dim">{t.why}</span>
                </span>
              </span>
              <Ribbon curve={t.curve} source={t.curve_source} swingPct={t.features.amplitude_pct} label={`${t.name} thermal day`} />
              <span className="caps md:text-right">{resolutionLabel(t)} · swing P<Num path={`targets.${ti}.features.amplitude_pct`} /></span>
            </button>
          );
        })}
      </section>

      <ClockBar />

      <section aria-label="Earth sites ranked for the chosen target" className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h2 className="head">Earth sites for {target.name}</h2>
          <span className="flex items-center gap-2"><span className="caps">Class</span>
            <Seg label="Filter by surface class" value={cls} onChange={setCls} options={classes.map((c) => ({ value: c, label: c }))} /></span>
          <span className="flex items-center gap-2"><span className="caps">Catalogue</span>
            <Seg label="Filter by catalogue status" value={cat} onChange={setCat} options={cats.map((c) => ({ value: c, label: c }))} /></span>
        </div>

        <div className="panel grid grid-cols-[1fr] gap-x-5 px-3 py-2 md:grid-cols-[56px_220px_1fr_150px]">
          <span className="caps self-center !text-mars md:col-span-2">Reference · {target.name}</span>
          <div><Ribbon curve={target.curve} source={target.curve_source} swingPct={target.features.amplitude_pct} label="Target thermal day" /><RibbonAxis /></div>
          <span className="caps self-center md:text-right">local solar time</span>
        </div>

        {ranked.length === 0 && (
          <div className="panel p-5 text-dim">No sites match. <button type="button" className="btn ml-2" onClick={() => { setCls('all'); setCat('all'); }}>Clear filters</button></div>
        )}
        <ol className="space-y-2" ref={listRef}>
          {ranked.map((s, rank) => {
            const si = siteIndex(data, s.id);
            return (
              <li key={s.id} data-key={s.id}>
                <Link to={withTarget(`/seam/${s.id}`)}
                  className={`panel row grid grid-cols-[1fr] items-center gap-x-5 gap-y-1 px-3 py-3 md:grid-cols-[56px_220px_1fr_150px] ${s.mock ? 'mock' : ''}`}>
                  {s.params && target.params ? <Fingerprint a={s.params} b={target.params} size={56} title={`${s.name} fingerprint over ${target.name}`} /> : <span />}
                  <span>
                    <span className="block font-semibold"><span className="mr-2 font-mono text-sm font-normal text-dim">{String(rank + 1).padStart(2, '0')}</span>{s.name}</span>
                    <span className="caps !normal-case">{s.region}</span>
                    <span className="caps mt-1 block">
                      {s.class.name} · {s.catalogue.status}
                      {s.kind === 'negative_control' && s.catalogue.status !== 'decoy' && <span className="text-denied"> · decoy</span>}
                      {s.kind === 'positive_control' && <span className="text-permit"> · known analog</span>}
                                          </span>
                  </span>
                  <span>
                    <Ribbon curve={s.curve} source={s.curve_source} swingPct={s.features.amplitude_pct} label={`${s.name} thermal day`} />
                    <span className="caps">{resolutionLabel(s)} · swing P<Num path={`sites.${si}.features.amplitude_pct`} /></span>
                  </span>
                  <span className="md:text-right">
                    <Num path={`sites.${si}.closeness.${target.id}.total`} className="text-xl text-ink" />
                    <span className="caps block">closeness</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-label="Legend" className="panel flex flex-wrap items-center gap-x-5 gap-y-2 p-3 text-sm text-dim">
        <span className="flex items-center gap-2">
          <span className="caps">coolest</span>
          <span className="h-1 w-40" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(tempColour).join(',')})` }} />
          <span className="caps">warmest</span>
        </span>
        <span>Small glyph: the site's 14-parameter fingerprint (blue) over the target's (orange).</span>
        <span>Thicker band = larger day–night swing.</span>
        <span>Dashed = no data at that hour.</span>
      </section>
    </div>
  );
}
