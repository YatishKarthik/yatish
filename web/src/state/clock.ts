import { useStore } from './store';

// The one animation loop for time. Everything else subscribes to `hour`.
let raf = 0;
let last = 0;

function tick(now: number) {
  const s = useStore.getState();
  if (!s.playing) { raf = 0; return; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  s.set({ hour: (s.hour + dt * s.speed) % 24 });
  raf = requestAnimationFrame(tick);
}

export function initClock() {
  const apply = (hour: number) => document.documentElement.style.setProperty('--hour', hour.toFixed(3));
  apply(useStore.getState().hour);
  return useStore.subscribe((s, prev) => {
    if (s.hour !== prev.hour) apply(s.hour);
    if (s.playing && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  });
}

export const fmtHour = (h: number) => {
  const m = Math.floor((h % 24) * 60 + 1e-6);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** First load only: the clock runs from 06:00 to 14:00 in 1.8 s while the page fades in. Any key or click skips it. */
export function runIntro() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const skipIt = reduce || new URLSearchParams(window.location.search).has('director') || new URLSearchParams(window.location.search).has('nointro');
  let seen = false;
  try { seen = sessionStorage.getItem('tt-intro') === '1'; sessionStorage.setItem('tt-intro', '1'); } catch { /* storage unavailable */ }
  if (skipIt || seen) return;
  const root = document.documentElement, t0 = performance.now();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    root.classList.remove('intro');
    useStore.getState().set({ hour: 14 });
    window.removeEventListener('pointerdown', finish);
    window.removeEventListener('keydown', finish);
  };
  root.classList.add('intro');
  window.addEventListener('pointerdown', finish);
  window.addEventListener('keydown', finish);
  const step = (now: number) => {
    if (done) return;
    const k = Math.min(1, (now - t0) / 1800), e = 1 - Math.pow(1 - k, 3);
    useStore.getState().set({ hour: 6 + 8 * e });
    if (k < 1) requestAnimationFrame(step); else window.setTimeout(finish, 500);
  };
  requestAnimationFrame(step);
}
