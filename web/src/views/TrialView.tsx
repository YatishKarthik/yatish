import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bodyName } from '../data/select';
import { pathProfile } from '../data/tiles';
import type { World } from '../data/types';
import { SeamCanvas } from '../scenes/SeamCanvas';
import { runTrial, sampleAt, STEP_M, type TrialResult } from '../sim/rover';
import { useStore, withTarget } from '../state/store';
import { slipHiss } from '../ui/sound';
import { Hud, MissingTiles, NotFound } from './SeamView';
import { useSeam } from './useSeam';

function Profile({ world, label, heights, result, lengthM }: { world: World; label: string; heights: Float32Array; result: TrialResult; lengthM: number }) {
  const t = useStore((s) => s.trial.t);
  const st = sampleAt(result, t);
  const W = 600, H = 70;
  let min = Infinity, max = -Infinity;
  for (const h of heights) { if (h < min) min = h; if (h > max) max = h; }
  const span = Math.max(max - min, 1);
  const step = Math.max(1, Math.floor(heights.length / 300));
  let d = '';
  for (let i = 0; i < heights.length; i += step) d += `${i === 0 ? 'M' : 'L'}${((i / (heights.length - 1)) * W).toFixed(1)},${(H - 6 - ((heights[i] - min) / span) * (H - 14)).toFixed(1)}`;
  const slipBands = result.samples.filter((s) => s.slip > 0.3).map((s) => (s.dist / lengthM) * W);
  const x = (st.dist / lengthM) * W;
  const colour = world === 'earth' ? '#4f8df7' : '#e0673a';
  const done = t >= result.duration;
  return (
    <div className="panel p-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-5 font-mono text-sm">
        <span style={{ color: colour }}>{label.toUpperCase()}</span>
        <span>slip {(st.slip * 100).toFixed(0)}%</span>
        <span>speed {st.speed.toFixed(2)} m/s</span>
        <span>slope {st.slopeDeg.toFixed(1)}°</span>
        <span>{st.dist.toFixed(0)} / {lengthM.toFixed(0)} m</span>
        <span className="font-semibold" style={{ color: done ? (result.outcome === 'PASS' ? '#3fb950' : '#f85149') : '#9aa4b2' }}>{done ? result.outcome : 'RUNNING'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} elevation along the path, relief ${span.toFixed(0)} metres`}>
        {slipBands.map((bx, i) => <rect key={i} x={bx - 1} y={0} width={3} height={H} fill="#f85149" opacity={0.35} />)}
        <path d={d} fill="none" stroke={colour} strokeWidth={1.5} />
        <line x1={x} x2={x} y1={0} y2={H} stroke="#e6e9ef" strokeWidth={1} />
      </svg>
      <p className="caps">
        Steepest climb {result.maxSlopeDeg.toFixed(1)}° · slip limit {result.stuckSlopeDeg.toFixed(1)}° · relief {span.toFixed(0)} m
      </p>
    </div>
  );
}

export function TrialView() {
  const { siteId } = useParams();
  const { data, site, target, tiles, extentM } = useSeam(siteId);
  const trial = useStore((s) => s.trial);
  const setTrial = useStore((s) => s.setTrial);
  const director = useStore((s) => s.director);
  const friction = data.meta.friction;
  const [aCmd, setACmd] = useState(0.2);

  const run = useMemo(() => {
    if (!tiles || !site || !friction) return null;
    const muE = friction[site.class.name], muM = friction[target.class?.name ?? site.class.name];
    if (muE == null || muM == null) return null;
    const hE = pathProfile(tiles.earth.hf, extentM, trial.a, trial.b, STEP_M);
    const hM = pathProfile(tiles.mars.hf, extentM, trial.a, trial.b, STEP_M);
    const earth = runTrial(hE, { g: data.planets.earth.gravity, mu: muE, aCmd });
    const mars = runTrial(hM, { g: data.planets[target.body].gravity, mu: muM, aCmd });
    return { earth, mars, hE, hM, muE, muM, lengthM: (hE.length - 1) * STEP_M, end: Math.max(earth.duration, mars.duration) };
  }, [tiles, site, target, friction, extentM, trial.a, trial.b, data, aCmd]);

  // playback: simulated seconds are compressed so the whole drive takes about ten seconds
  useEffect(() => {
    if (!trial.running || !run) return;
    let raf = 0, last = performance.now();
    const rate = run.end / (director ? 3.2 : 10);
    const tick = (now: number) => {
      const s = useStore.getState();
      const t = s.trial.t + ((now - last) / 1000) * rate;
      last = now;
      if (t >= run.end) { s.setTrial({ t: run.end, running: false }); return; }
      s.setTrial({ t });
      if (s.sound && (sampleAt(run.earth, t).slip > 0.3 || sampleAt(run.mars, t).slip > 0.3)) slipHiss();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trial.running, run, director]);
  useEffect(() => () => useStore.getState().setTrial({ t: 0, running: false }), []);

  if (!site) return <NotFound what="Site" />;
  const done = !!run && trial.t >= run.end;
  const B = bodyName(target);
  let sentence = '';
  if (run && done) {
    const e = run.earth, m = run.mars;
    if (e.outcome === 'PASS' && m.outcome === 'PASS')
      sentence = `Both rovers finish. Steepest climb ${e.maxSlopeDeg.toFixed(1)}° on Earth, ${m.maxSlopeDeg.toFixed(1)}° on ${B}.`;
    else if (e.outcome === 'PASS') sentence = `Passes on Earth, sticks on ${B} on a ${m.maxSlopeDeg.toFixed(1)}° climb.`;
    else if (m.outcome === 'PASS') sentence = `Sticks on Earth, passes on ${B}.`;
    else sentence = 'Both rovers stick on this path.';
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="hide-in-director flex flex-wrap items-center gap-3">
        <Link to={withTarget(`/seam/${site.id}`)} className="btn">Back to the seam</Link>
        <h1 className="head">Rover trial · {site.name} vs {target.name}</h1>
      </div>
      <div className={`viewport ${director ? 'letterbox !max-h-[60vh]' : 'h-[44vh] min-h-[280px]'}`}>
        {tiles && run
          ? <SeamCanvas earth={tiles.earth} mars={tiles.mars} extentM={extentM} mode="split" earthLabel={site.name} marsLabel={target.name} earthClass={site.class.name} marsClass={target.class?.name} body={B.toUpperCase()} trial={run} />
          : <div className="flex h-full items-center justify-center px-5 text-center font-mono text-sm text-dim">
              {tiles && !friction ? 'The trial needs a friction table in sites.json.' : 'Loading terrain…'}
            </div>}
        <div className="fx" />
        <Hud extra="Click the terrain to move the path" body={B.toUpperCase()} />
        {tiles && <MissingTiles earth={tiles.earth.missing} mars={tiles.mars.missing} />}
      </div>

      {run && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary hide-in-director" onClick={() => setTrial({ t: 0, running: true })}>{done || trial.t > 0 ? 'Run again' : 'Run the trial'}</button>
            <button type="button" className="btn hide-in-director" onClick={() => setTrial({ a: [0.12, 0.85], b: [0.88, 0.15], t: 0, running: false })}>Reset path</button>
            <label className="hide-in-director flex items-center gap-2">
              <span className="caps">Acceleration</span>
              <input type="range" className="scrub w-32" min={0.1} max={0.5} step={0.05} value={aCmd}
                onChange={(e) => { setACmd(Number(e.target.value)); setTrial({ t: 0, running: false }); }}
                aria-valuetext={`${aCmd.toFixed(2)} metres per second squared`} />
              <span className="font-mono text-sm tabular-nums">{aCmd.toFixed(2)} m/s²</span>
            </label>
            <div aria-live="polite" className="flex flex-wrap items-center gap-3">
              {done && (
                <>
                  <span className="stamp !rotate-0 text-base" style={{ color: run.mars.outcome === 'PASS' && run.earth.outcome === 'PASS' ? '#3fb950' : '#f85149', borderColor: 'currentColor' }}>
                    EARTH {run.earth.outcome} / {B.toUpperCase()} {run.mars.outcome}
                  </span>
                  <span className="max-w-3xl text-sm">{sentence}</span>
                </>
              )}
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Profile world="earth" label="Earth" heights={run.hE} result={run.earth} lengthM={run.lengthM} />
            <Profile world="mars" label={B} heights={run.hM} result={run.mars} lengthM={run.lengthM} />
          </div>
          <p className="hide-in-director caps">
            Gravity {data.planets.earth.gravity} / {data.planets[target.body].gravity} m/s² · friction μ {run.muE} / {run.muM} · terrain {tiles?.earth.hf.sourceResM} m / {tiles?.mars.hf.sourceResM} m (Earth / {B})
          </p>
        </>
      )}
    </div>
  );
}
