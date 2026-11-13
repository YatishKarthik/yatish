import { tempColour } from '../data/select';

/**
 * A site's day as 24 cells of colour. Thickness follows the within-planet swing percentile,
 * because normalising the curve to 0..1 hides how large the swing is.
 */
export function Ribbon({ curve, source, swingPct, label }: { curve: number[]; source: string; swingPct?: number; label: string }) {
  const twoPoint = source === 'MODIS_2PT';
  const h = 6 + Math.round(((swingPct ?? 50) / 100) * 12);
  return (
    <div className="relative flex w-full items-center" style={{ height: 20 }} role="img" aria-label={label}>
      <div className="flex w-full gap-[2px]" style={{ height: h }}>
        {curve.map((v, i) => {
          const shown = !twoPoint || i === 1 || i === 13;
          return (
            <div key={i} className="flex-1"
              style={shown ? { background: tempColour(v) } : { border: '1px dashed #262d37' }} />
          );
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
