import { create } from 'zustand';

// The survey career: what this visitor has scanned, surveyed and tested. Kept in the browser only.
const KEY = 'tt-progress-v1';
interface Saved { xp: number; scanned: string[]; surveyed: string[]; trials: number; best: number; flags: string[] }
export interface LogLine { id: number; text: string; kind: 'info' | 'badge' | 'rank' }
interface Progress extends Saved {
  log: LogLine[];
  award: (what: 'scan' | 'survey' | 'trial' | 'challenge' | 'flag', id: string, extra?: number) => void;
  say: (text: string) => void;
  reset: () => void;
}

export const RANKS = [{ at: 0, name: 'Cadet' }, { at: 120, name: 'Surveyor' }, { at: 350, name: 'Field lead' }, { at: 800, name: 'Mission director' }];
export const rankOf = (xp: number) => { let i = 0; RANKS.forEach((r, k) => { if (xp >= r.at) i = k; }); return { index: i, ...RANKS[i], next: RANKS[i + 1] }; };

const count = (s: Saved, body: string) => s.scanned.filter((x) => x.startsWith(body + ':')).length;
export const BADGES: { id: string; name: string; how: string; test: (s: Saved) => boolean }[] = [
  { id: 'lock', name: 'Target lock', how: 'Select your first target', test: (s) => s.scanned.length >= 1 },
  { id: 'boots', name: 'Boots on the ground', how: 'Open your first Earth site', test: (s) => s.surveyed.length >= 1 },
  { id: 'mars', name: 'Red planet survey', how: 'Select all 10 Mars targets', test: (s) => count(s, 'mars') >= 10 },
  { id: 'moon', name: 'Lunar survey', how: 'Select all 10 Moon targets', test: (s) => count(s, 'moon') >= 10 },
  { id: 'carto', name: 'Cartographer', how: 'Open 20 Earth sites', test: (s) => s.surveyed.length >= 20 },
  { id: 'atlas', name: 'Atlas complete', how: 'Open all 60 Earth sites', test: (s) => s.surveyed.length >= 60 },
  { id: 'gravity', name: 'Trial by gravity', how: 'Run 3 rover trials', test: (s) => s.trials >= 3 },
  { id: 'limit', name: 'Found the limit', how: 'Make a rover stick on either world', test: (s) => s.flags.includes('stuck') },
  { id: 'night', name: 'Night shift', how: 'Scrub the clock into the night', test: (s) => s.flags.includes('night') },
  { id: 'bench', name: 'Test engineer', how: 'Open the test bench', test: (s) => s.flags.includes('bench') },
  { id: 'analyst', name: 'Analyst', how: 'Open the parameter space', test: (s) => s.flags.includes('analysis') },
  { id: 'eye', name: 'Sharp eye', how: 'Score 4 of 5 in Blind match', test: (s) => s.best >= 4 },
  { id: 'perfect', name: 'Perfect read', how: 'Score 5 of 5 in Blind match', test: (s) => s.best >= 5 },
];

const EMPTY: Saved = { xp: 0, scanned: [], surveyed: [], trials: 0, best: 0, flags: [] };
function load(): Saved {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...EMPTY }; }
}
function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify({ xp: s.xp, scanned: s.scanned, surveyed: s.surveyed, trials: s.trials, best: s.best, flags: s.flags })); } catch { /* private window: play on without saving */ }
}
let lineId = 0;

export const useProgress = create<Progress>((set, get) => ({
  ...load(),
  log: [],
  say: (text) => set((s) => ({ log: [...s.log.slice(-29), { id: ++lineId, text, kind: 'info' }] })),
  reset: () => { save(EMPTY); set({ ...EMPTY, log: [{ id: ++lineId, text: 'Survey record cleared', kind: 'info' }] }); },
  award: (what, id, extra = 0) => {
    const s = get();
    const next: Saved = { xp: s.xp, scanned: s.scanned, surveyed: s.surveyed, trials: s.trials, best: s.best, flags: s.flags };
    let gain = 0;
    if (what === 'scan' && !s.scanned.includes(id)) { next.scanned = [...s.scanned, id]; gain = 20; }
    if (what === 'survey' && !s.surveyed.includes(id)) { next.surveyed = [...s.surveyed, id]; gain = 10; }
    if (what === 'trial') { next.trials = s.trials + 1; gain = s.trials < 10 ? 15 : 0; }
    if (what === 'challenge') { next.best = Math.max(s.best, extra); gain = extra * 25; }
    if (what === 'flag' && !s.flags.includes(id)) { next.flags = [...s.flags, id]; gain = 10; }
    next.xp = s.xp + gain;
    const lines: LogLine[] = [];
    for (const b of BADGES) if (!b.test(s) && b.test(next)) lines.push({ id: ++lineId, text: `Badge earned · ${b.name}`, kind: 'badge' });
    if (rankOf(next.xp).index > rankOf(s.xp).index) lines.push({ id: ++lineId, text: `Promoted · ${rankOf(next.xp).name}`, kind: 'rank' });
    save(next);
    set({ ...next, log: [...s.log, ...lines].slice(-30) });
  },
}));
