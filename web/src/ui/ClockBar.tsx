import { useEffect } from 'react';
import { fmtHour } from '../state/clock';
import { useStore } from '../state/store';
import { Seg } from './Seg';

export function ClockReadout() {
  const hour = useStore((s) => s.hour);
  return <span className="font-mono tabular-nums">{fmtHour(hour)}</span>;
}

export function ClockBar() {
  const hour = useStore((s) => s.hour);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const set = useStore((s) => s.set);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code === 'Space' && !['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY'].includes(el.tagName)) {
        e.preventDefault();
        useStore.getState().set({ playing: !useStore.getState().playing });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3 border-y border-line py-3">
      <div>
        <div className="clock" aria-hidden>{fmtHour(hour)}</div>
        <div className="caps">Local solar time</div>
      </div>
      <div className="flex min-w-[240px] flex-1 flex-col gap-2 pb-1">
        <label className="flex flex-col">
          <span className="sr-only">Local solar time</span>
          <input type="range" min={0} max={24} step={0.05} value={hour} className="scrub w-full"
            onChange={(e) => set({ hour: Number(e.target.value) % 24, playing: false })}
            aria-valuetext={`${fmtHour(hour)} local solar time`} />
          <span className="ticks" aria-hidden />
          <span className="mt-1 flex justify-between font-mono text-xs text-dim" aria-hidden><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary w-24" onClick={() => set({ playing: !playing })} aria-label={playing ? 'Pause the clock' : 'Play the clock'}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <span className="hide-in-director">
            <Seg label="Clock speed, hours per second" value={speed} onChange={(v) => set({ speed: v })}
              options={[{ value: 1, label: '1 h/s' }, { value: 2, label: '2 h/s' }, { value: 4, label: '4 h/s' }]} />
          </span>
        </div>
      </div>
    </div>
  );
}
