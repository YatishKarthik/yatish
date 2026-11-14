import { useLayoutEffect, useRef } from 'react';

/** When list order changes, each row slides from its old place so the eye can follow it. */
export function useFlip<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const prev = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const key = child.dataset.key;
      if (!key) continue;
      const top = child.getBoundingClientRect().top + window.scrollY;
      next.set(key, top);
      const old = prev.current.get(key);
      if (old != null && Math.abs(old - top) > 1 && !reduce)
        child.animate([{ transform: `translateY(${old - top}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
    prev.current = next;
  }, [dep]);
  return ref;
}
