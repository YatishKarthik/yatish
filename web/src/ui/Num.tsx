import { getPath } from '../data/select';
import { useStore } from '../state/store';

/**
 * Every number on screen goes through here. It reads a value from sites.json by path and
 * shows that path on hover, so each figure can be traced to its source. No arithmetic.
 */
export function Num({ path, digits = 0, unit = '', className = '' }: { path: string; digits?: number; unit?: string; className?: string }) {
  const data = useStore((s) => s.data);
  const v = getPath(data, path);
  const text = typeof v === 'number' ? v.toFixed(digits) : v == null ? '—' : String(v);
  return (
    <span className={`font-mono tabular-nums ${className}`} title={`sites.json → ${path}`}>
      {text}{typeof v === 'number' ? unit : ''}
    </span>
  );
}
