import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useStore } from '../state/store';
import { setSound } from './sound';

export function Chrome({ children }: { children: ReactNode }) {
  const data = useStore((s) => s.data);
  const target = useStore((s) => s.target);
  const setTarget = useStore((s) => s.setTarget);
  const sound = useStore((s) => s.sound);
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
          {link('/', 'Sol')}{link('/evidence', 'Evidence')}{link('/method', 'Method')}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {data && (
            <div role="group" aria-label="Mars target" className="flex items-center gap-1">
              <span className="caps mr-1 hidden md:inline">Target</span>
              {data.targets.map((t) => (
                <button key={t.id} type="button" className="btn !min-h-[36px]" aria-pressed={t.id === target} onClick={() => setTarget(t.id)}>{t.name.split(' ')[0]}</button>
              ))}
            </div>
          )}
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
