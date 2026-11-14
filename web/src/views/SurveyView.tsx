import { Link } from 'react-router-dom';
import { BADGES, RANKS, rankOf, useProgress } from '../state/progress';
import { useStore, withTarget } from '../state/store';

function Meter({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3"><span className="caps">{label}</span><span className="font-mono text-sm tabular-nums">{value} / {total}</span></div>
      <div className="mt-1 h-1.5 bg-line"><div className="h-1.5 bg-ink" style={{ width: `${Math.min(100, (value / Math.max(1, total)) * 100)}%` }} /></div>
    </div>
  );
}

export function SurveyView() {
  const data = useStore((s) => s.data)!;
  const p = useProgress();
  const rank = rankOf(p.xp);
  const mars = data.targets.filter((t) => t.body === 'mars').length, moon = data.targets.filter((t) => t.body === 'moon').length;
  const scanned = (b: string) => p.scanned.filter((x) => x.startsWith(b + ':')).length;
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-5 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="caps">Survey record · kept in this browser</p>
          <h1 className="text-xl font-semibold">{rank.name}</h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-xl tabular-nums">{p.xp} XP</p>
          <p className="caps">{rank.next ? `${rank.next.at - p.xp} XP to ${rank.next.name}` : 'top rank'}</p>
        </div>
      </div>
      <div className="flex gap-1" aria-label="Rank ladder">
        {RANKS.map((r, i) => {
          const to = RANKS[i + 1]?.at ?? r.at + 1, fill = Math.min(1, Math.max(0, (p.xp - r.at) / (to - r.at)));
          return (
            <div key={r.name} className="flex-1">
              <div className="h-2 bg-line"><div className="h-2 bg-ink" style={{ width: `${(i < rank.index ? 1 : i === rank.index ? fill : 0) * 100}%` }} /></div>
              <p className={`caps mt-1 ${i <= rank.index ? '!text-ink' : ''}`}>{r.name}</p>
            </div>
          );
        })}
      </div>

      <section className="panel grid gap-5 p-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Coverage">
        <Meter label="Mars targets selected" value={scanned('mars')} total={mars} />
        <Meter label="Moon targets selected" value={scanned('moon')} total={moon} />
        <Meter label="Earth sites opened" value={p.surveyed.length} total={data.sites.length} />
        <Meter label="Blind match best" value={p.best} total={5} />
      </section>

      <section aria-label="Badges">
        <h2 className="head mb-2">Badges · {BADGES.filter((b) => b.test(p)).length} of {BADGES.length}</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BADGES.map((b) => {
            const got = b.test(p);
            return (
              <li key={b.id} className={`panel flex items-center gap-3 p-3 ${got ? '!border-ink' : 'opacity-60'}`}>
                <span className={`badge-mark ${got ? 'is-on' : ''}`} aria-hidden />
                <span><span className="block font-semibold">{b.name}</span><span className="block text-sm text-dim">{got ? 'Earned' : b.how}</span></span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel p-3 text-sm text-dim" aria-label="How points work">
        <h2 className="head mb-2">How points work</h2>
        <p>New target selected 20 · new Earth site opened 10 · rover trial 15 (first ten) · each correct Blind match 25 · a discovery flag 10. Points measure how much of the survey you have explored; they say nothing about which site is a better analog.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to={withTarget('/challenge')} className="btn btn-primary">Play Blind match</Link>
          <Link to={withTarget('/')} className="btn">Back to the system</Link>
          <button type="button" className="btn" onClick={() => { if (window.confirm('Clear your survey record on this browser? This cannot be undone.')) p.reset(); }}>Clear survey record</button>
        </div>
      </section>
    </div>
  );
}
