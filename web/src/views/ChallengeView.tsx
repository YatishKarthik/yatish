import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Fingerprint } from '../charts/Fingerprint';
import { asset } from '../data/load';
import { bodyName, rankedSites, siteIndex } from '../data/select';
import type { Site, Target } from '../data/types';
import { useProgress } from '../state/progress';
import { useStore, withTarget } from '../state/store';
import { Num } from '../ui/Num';

const ROUNDS = 5;
interface Round { target: Target; options: Site[]; answer: string }

/** Five rounds: read a target's fingerprint, pick which of three Earth sites the data ranks closest. */
function deal(data: { targets: Target[]; sites: Site[] }, seed: number): Round[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const targets = [...data.targets].sort(() => rnd() - 0.5).slice(0, ROUNDS);
  return targets.map((target) => {
    const ranked = rankedSites(data as never, target.id).filter((x) => x.kind === 'candidate' && x.params);
    const n = ranked.length;
    // one strong match, one middling, one poor: readable differences, not coin flips
    const pick = [ranked[Math.floor(rnd() * 4)], ranked[Math.floor(n * 0.4 + rnd() * n * 0.15)], ranked[Math.floor(n * 0.8 + rnd() * n * 0.19)]];
    return { target, answer: pick[0].id, options: pick.sort(() => rnd() - 0.5) };
  });
}

export function ChallengeView() {
  const data = useStore((s) => s.data)!;
  const award = useProgress((s) => s.award), say = useProgress((s) => s.say);
  const [seed, setSeed] = useState(() => (Date.now() % 100000) + 1);
  const rounds = useMemo(() => deal(data, seed), [data, seed]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const done = i >= ROUNDS;

  const choose = (id: string) => {
    if (picked) return;
    setPicked(id);
    const ok = id === rounds[i].answer;
    if (ok) setScore((n) => n + 1);
    say(ok ? `Blind match ${i + 1}: correct` : `Blind match ${i + 1}: the data ranks another site closer`);
  };
  const next = () => {
    if (i + 1 >= ROUNDS) award('challenge', 'round', score);
    setI(i + 1); setPicked(null);
  };
  const again = () => { setSeed(seed + 7919); setI(0); setScore(0); setPicked(null); };

  if (done)
    return (
      <div className="mx-auto max-w-xl space-y-3 px-5 py-8 text-center">
        <p className="caps">Blind match complete</p>
        <p className="clock">{score} / {ROUNDS}</p>
        <p className="text-dim">{score >= 4 ? 'You read the fingerprints like the ranking does.' : 'Look at which spokes line up: slope and swing usually decide it.'}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="btn btn-primary" onClick={again}>Play again</button>
          <Link to={withTarget('/survey')} className="btn">Survey record</Link>
        </div>
      </div>
    );

  const r = rounds[i];
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="head">Blind match · round {i + 1} of {ROUNDS}</h1>
        <p className="font-mono text-sm tabular-nums">score {score}</p>
      </div>
      <section className="panel flex flex-wrap items-center gap-5 p-3" aria-label="Target">
        {r.target.satellite_tile && <img src={asset(r.target.satellite_tile)} alt="" width={120} height={120} className="h-[120px] w-[120px] object-cover" />}
        {r.target.params && <Fingerprint a={r.target.params} size={150} title={`${r.target.name} fingerprint`} />}
        <div className="min-w-[200px] flex-1">
          <p className="caps !text-mars">{bodyName(r.target)} target</p>
          <p className="text-lg font-semibold">{r.target.name}</p>
          <p className="text-sm text-dim">{r.target.why}</p>
          <p className="mt-2 text-sm">Which of these three places on Earth does the data rank closest to it?</p>
        </div>
      </section>
      <ul className="grid gap-3 md:grid-cols-3">
        {r.options.map((s, k) => {
          const isAnswer = s.id === r.answer, mine = picked === s.id;
          return (
            <li key={s.id}>
              <button type="button" disabled={!!picked} onClick={() => choose(s.id)}
                className={`panel row flex w-full flex-col gap-2 p-3 text-left ${picked ? (isAnswer ? '!border-permit' : mine ? '!border-denied' : 'opacity-60') : ''}`}>
                <span className="flex items-center gap-3">
                  <img src={asset(s.satellite_tile)} alt="" width={96} height={96} className="h-24 w-24 object-cover" />
                  {s.params && <Fingerprint a={s.params} b={picked ? r.target.params : undefined} size={96} title={`Site ${k + 1} fingerprint`} />}
                </span>
                <span className="block font-semibold">{picked ? s.name : `Site ${'ABC'[k]}`}</span>
                <span className="caps">{picked ? s.region : `${s.class.name} · slope ${s.params?.slope_mean?.value.toFixed(1)}°`}</span>
                {picked && (
                  <span className="flex items-baseline justify-between">
                    <span className={`font-mono text-sm ${isAnswer ? 'text-permit' : 'text-dim'}`}>{isAnswer ? 'CLOSEST' : mine ? 'YOUR PICK' : ''}</span>
                    <Num path={`sites.${siteIndex(data, s.id)}.closeness.${r.target.id}.total`} className="text-lg" />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        {picked && <p className="text-sm">{picked === r.answer ? 'Correct.' : 'Not this time.'} Orange shows the target's fingerprint over each site.</p>}
        {picked && <button type="button" className="btn btn-primary" onClick={next}>{i + 1 >= ROUNDS ? 'See result' : 'Next round'}</button>}
        {picked && <Link to={{ pathname: `/seam/${r.answer}`, hash: `#t=${r.target.id}` }} className="btn">Open the closest site</Link>}
      </div>
    </div>
  );
}
