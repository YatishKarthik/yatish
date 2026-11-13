import { useId } from 'react';
import { PARAMS, PILLARS, type ParamSet } from '../data/pillars';

/**
 * A site as one shape: 14 spokes, one per parameter, radius = within-planet percentile.
 * Laid over the target's shape, so a match reads as two outlines that agree.
 * Spokes that are not comparable across planets are drawn dashed and ghosted.
 */
export function Fingerprint({ a, b, size = 160, labels = false, title }: { a: ParamSet; b?: ParamSet; size?: number; labels?: boolean; title: string }) {
  const id = useId();
  const n = PARAMS.length, c = size / 2, R = c * (labels ? 0.66 : 0.86);
  const ang = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;
  const pt = (i: number, k: number) => [c + Math.cos(ang(i)) * R * k, c + Math.sin(ang(i)) * R * k] as const;
  const path = (s: ParamSet) => PARAMS.map((d, i) => { const v = s[d.id]; const [x, y] = pt(i, v ? Math.max(0.04, v.pct / 100) : 0.04); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ') + 'Z';
  const pillarStart = PILLARS.map((p) => PARAMS.findIndex((d) => d.pillar === p.id));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title} className="shrink-0">
      <defs>
        <clipPath id={`${id}-clip`}><circle cx={c} cy={c} r={R} /></clipPath>
      </defs>
      {/* pillar sectors */}
      {PILLARS.map((p, k) => {
        const s0 = ang(pillarStart[k]) - Math.PI / n, s1 = ang(pillarStart[k + 1] ?? n) - Math.PI / n;
        const [x0, y0] = [c + Math.cos(s0) * R, c + Math.sin(s0) * R], [x1, y1] = [c + Math.cos(s1) * R, c + Math.sin(s1) * R];
        return <path key={p.id} d={`M${c},${c} L${x0},${y0} A${R},${R} 0 ${s1 - s0 > Math.PI ? 1 : 0} 1 ${x1},${y1}Z`} fill={p.colour} opacity={0.06} />;
      })}
      {[0.25, 0.5, 0.75, 1].map((k) => <circle key={k} cx={c} cy={c} r={R * k} fill="none" stroke="#2c3440" strokeWidth={k === 1 ? 1 : 0.5} />)}
      {PARAMS.map((d, i) => { const [x, y] = pt(i, 1); return <line key={d.id} x1={c} y1={c} x2={x} y2={y} stroke="#2c3440" strokeWidth={0.5} strokeDasharray={d.comparable ? undefined : '2 3'} />; })}
      {b && <path d={path(b)} fill="#e0673a" fillOpacity={0.12} stroke="#e0673a" strokeWidth={1.5} strokeLinejoin="round" />}
      <path d={path(a)} fill="#4f8df7" fillOpacity={0.14} stroke="#4f8df7" strokeWidth={1.5} strokeLinejoin="round" />
      {PARAMS.map((d, i) => { const v = a[d.id]; if (!v) return null; const [x, y] = pt(i, Math.max(0.04, v.pct / 100)); return <circle key={d.id} cx={x} cy={y} r={size > 120 ? 2.2 : 1.4} fill={v.source === 'mock' ? '#f2a93b' : '#4f8df7'} opacity={d.comparable ? 1 : 0.5} />; })}
      {labels && PARAMS.map((d, i) => {
        const [x, y] = pt(i, 1.16), anchor = Math.abs(Math.cos(ang(i))) < 0.2 ? 'middle' : Math.cos(ang(i)) > 0 ? 'start' : 'end';
        return <text key={d.id} x={x} y={y + 3} textAnchor={anchor} fontSize={10} fontFamily="IBM Plex Mono" fill={d.comparable ? '#c3cbd4' : '#78818c'}>{d.short}</text>;
      })}
    </svg>
  );
}

export function FingerprintLegend() {
  return (
    <p className="caps">
      <span className="text-earth">■ Earth site</span> · <span className="text-mars">■ target</span> · radius = percentile within its own planet · dashed spokes shown, not scored · <span className="text-amber">●</span> mock value
    </p>
  );
}
