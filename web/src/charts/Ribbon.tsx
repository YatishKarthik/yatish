import { useRef, type PointerEvent } from 'react';
import { tempColour } from '../data/select';
import { useStore } from '../state/store';

/**
 * A site's day as 24 cells of colour. Thickness follows the within-planet swing percentile,
 * because normalising the curve to 0..1 hides how large the swing is.
 * Hovering a cell previews that hour everywhere; leaving puts the clock back.
 */
export function Ribbon({ curve, source, swingPct, label }: { curve: number[]; source: string; swingPct?: number; label: string }) {
  const twoPoint = source === 'MODIS_2PT';
  const h = 6 + Math.round(((swingPct ?? 50) / 100) * 12);
  const saved = useRef<number | null>(null);
  const timer = useRef(0);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const hour = Math.min(23.99, Math.max(0, ((e.clientX - r.left) / r.width) * 24));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const s = useStore.getState();
      if (s.director) return;
      if (saved.current == null) saved.current = s.hour;
      s.set({ hour, playing: false });
    }, 60);
  };
  const onLeave = () => {
    window.clearTimeout(timer.current);
    if (saved.current != null) { useStore.getState().set({ hour: saved.current }); saved.current = null; }
  };

  return (
    <div className="relative flex w-full items-center" style={{ height: 20 }} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className="flex w-full gap-[2px]" style={{ height: h }}>
        {curve.map((v, i) => {
          const shown = !twoPoint || i === 1 || i === 13;
          return <div key={i} className="flex-1" style={shown ? { background: tempColour(v) } : { border: '1px dashed #262d37' }} />;
        })}
      </div>
      <div className="hour-cursor" />
    </div>
  );
}

export function RibbonAxis() {
  return (
    <div className="flex w-full justify-between font-mono text-xs text-dim" aria-hidden>
      {['00', '06', '12', '18', '24'].map((t) => <span key={t}>{t}</span>)}
    </div>
  );
}
