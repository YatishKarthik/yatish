import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { rankedSites } from '../data/select';
import { useStore } from '../state/store';

/**
 * Director mode: plays the 30-second demo with captions burned in, so the video is one take.
 * Site ids come from meta.demo (set by the team after validation); the fallback is the
 * lowest- and highest-ranked candidates, so the script never hardcodes a result.
 */
export function Director() {
  const director = useStore((s) => s.director);
  const caption = useStore((s) => s.caption);
  const navigate = useNavigate();
  // navigate changes identity on every route change; keep it in a ref so the script is not restarted.
  const nav = useRef(navigate);
  nav.current = navigate;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() === 'd' && !e.metaKey && !e.ctrlKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))
        useStore.getState().set({ director: !useStore.getState().director });
    };
    window.addEventListener('keydown', onKey);
    if (new URLSearchParams(window.location.search).get('director') === '1') useStore.getState().set({ director: true });
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('director', director);
    if (!director) { useStore.getState().set({ caption: '', dirRail: false, playing: false }); return; }
    const { data, set, setTrial, setTarget } = useStore.getState();
    if (!data) return;
    const demo = data.meta.demo ?? {};
    const target = data.targets.find((t) => t.id === demo.target) ?? data.targets[0];
    const cand = rankedSites(data, target.id).filter((s) => s.kind === 'candidate');
    const match = demo.match ?? cand[0]?.id, lookalike = demo.lookalike ?? cand[cand.length - 1]?.id;
    setTarget(target.id);
    const go = (p: string) => nav.current({ pathname: p, hash: `#t=${target.id}` });
    const timers: number[] = [];
    let raf = 0;
    const at = (sec: number, fn: () => void) => timers.push(window.setTimeout(fn, sec * 1000));

    at(0, () => { go(`/seam/${lookalike}`); set({ layer: 'satellite', mode: 'wipe', seam: 0.5, hour: 14, playing: false, grid: false, dirRail: false, caption: 'Looks like Mars.' }); });
    at(5, () => set({ layer: 'temperature', hour: 6, speed: 4, playing: true, caption: `Behaves like ${target.name}?` }));
    at(9, () => set({ playing: false }));
    at(10, () => {
      go(`/seam/${match}`);
      set({ hour: 6, speed: 2, playing: true, seam: 0.8, caption: 'This one keeps step through the whole day.' });
      const t0 = performance.now();
      const slide = (now: number) => {
        const f = Math.min(1, (now - t0 - 1500) / 4000);
        if (f > 0) set({ seam: 0.8 - 0.3 * f });
        if (f < 1 && useStore.getState().director) raf = requestAnimationFrame(slide);
      };
      raf = requestAnimationFrame(slide);
    });
    at(17, () => set({ playing: false, hour: 14, dirRail: true, caption: 'Every test gets a permit, with the physics rule printed on it.' }));
    at(23, () => { go(`/trial/${match}`); set({ dirRail: false, caption: 'Same rover, same drive, both worlds.' }); setTrial({ t: 0, running: false }); });
    at(23.6, () => setTrial({ t: 0, running: true }));
    at(27, () => { go('/evidence'); set({ caption: 'Checked against Hope · ECOSTRESS · our own thermometer.' }); });
    at(30, () => set({ director: false }));
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf); };
  }, [director]);

  if (!director || !caption) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center px-5">
      <p key={caption} className="display rise border border-line bg-page px-5 py-3 text-center text-lg">{caption}</p>
    </div>
  );
}
