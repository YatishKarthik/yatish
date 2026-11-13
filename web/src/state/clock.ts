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
