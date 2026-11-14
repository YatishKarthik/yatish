import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { rankOf, useProgress } from '../state/progress';
import { useStore } from '../state/store';
import { setSound } from './sound';

export function Chrome({ children }: { children: ReactNode }) {
  const data = useStore((s) => s.data);
  const target = useStore((s) => s.target);
  const setTarget = useStore((s) => s.setTarget);
  const sound = useStore((s) => s.sound);
  const xp = useProgress((s) => s.xp);
  const rank = rankOf(xp);
  const { hash } = useLocation();
  const link = (to: string, label: string) => (
    <NavLink to={{ pathname: to, hash: hash || `#t=${target}` }} end
      className={({ isActive }) => `border-b-2 px-2 py-2 font-mono text-sm ${isActive ? 'border-ink text-ink' : 'border-transparent text-dim hover:text-ink'}`}>
      {label}
    </NavLink>
  );
  return (
    <div className="flex min-h-full flex-col">
      <header className="hide-in-director flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-panel px-5 py-2">
        <NavLink to={{ pathname: '/', hash: `#t=${target}` }} className="head">Thermal&nbsp;Twin</NavLink>
        <nav className="flex gap-1" aria-label="Views">
          {link('/', 'System')}{link('/sol', 'Sol')}{link('/analysis', 'Analysis')}{link('/challenge', 'Blind match')}{link('/evidence', 'Evidence')}{link('/method', 'Method')}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {data && (
            <label className="flex items-center gap-2">
              <span className="caps hidden md:inline">Target</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="min-h-[36px] rounded border border-line bg-panel px-2 font-mono text-sm text-ink">
                {(['mars', 'moon'] as const).map((b) => data.targets.some((t) => t.body === b) && (
                  <optgroup key={b} label={b === 'mars' ? 'Mars' : 'Moon'}>
                    {data.targets.filter((t) => t.body === b).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          <Link to={{ pathname: '/survey', hash: hash || `#t=${target}` }} className="rank-chip" title="Your survey record">
            <span>{rank.name}</span>
            <span className="bar" aria-hidden><i style={{ width: `${rank.next ? Math.min(100, ((xp - rank.at) / (rank.next.at - rank.at)) * 100) : 100}%` }} /></span>
            <span className="tabular-nums text-dim">{xp}</span>
          </Link>
          <button type="button" className="btn" aria-pressed={sound} onClick={() => { setSound(!sound); useStore.getState().set({ sound: !sound }); }}>
            Sound {sound ? 'on' : 'off'}
          </button>
          {data?.meta.mock && <span className="chip mock !text-amber" title="sites.json → meta.mock">Mock data</span>}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
