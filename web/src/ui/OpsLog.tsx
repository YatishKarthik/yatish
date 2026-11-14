import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useProgress } from '../state/progress';

/** The last few console lines, bottom left. Each fades after a few seconds. */
export function OpsLog() {
  const log = useProgress((s) => s.log);
  const onTable = useLocation().pathname.startsWith('/table');
  const [now, setNow] = useState(0);
  const [born] = useState(() => new Map<number, number>());
  for (const l of log) if (!born.has(l.id)) born.set(l.id, Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const live = log.filter((l) => (now || Date.now()) - (born.get(l.id) ?? 0) < (l.kind === 'info' ? 6000 : 9000)).slice(-4);
  return (
    <div className={`hide-in-director pointer-events-none fixed left-3 z-40 flex flex-col gap-1 ${onTable ? 'top-16 max-md:hidden' : 'bottom-16'}`} aria-live="polite">
      {live.map((l) => (
        <p key={l.id} className={`opsline rise ${l.kind !== 'info' ? 'is-badge' : ''}`}>
          <span aria-hidden>{l.kind === 'info' ? '›' : '★'}</span> {l.text}
        </p>
      ))}
    </div>
  );
}
