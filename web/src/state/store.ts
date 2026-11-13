import { create } from 'zustand';
import type { SitesJson, World } from '../data/types';

export type Layer = 'temperature' | 'satellite';
export type Mode = 'wipe' | 'split';
export type Cam = 'survey' | 'walk' | 'overhead';
export interface Hover { world: World; slopeDeg: number; heightM: number }

interface Store {
  data: SitesJson | null;
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  target: string;
  hour: number;          // 0..24 local solar time
  playing: boolean;
  speed: 1 | 2 | 4;      // hours per second
  seam: number;          // 0..1, fraction of the tile that is Earth
  layer: Layer;
  mode: Mode;
  grid: boolean;         // draw source-pixel grid
  cam: Cam;
  sound: boolean;        // opt-in, off by default
  hover: Hover | null;
  trial: { a: [number, number]; b: [number, number]; t: number; running: boolean };
  director: boolean;
  dirRail: boolean;
  caption: string;
  set: (p: Partial<Store>) => void;
  setTarget: (id: string) => void;
  setTrial: (p: Partial<Store['trial']>) => void;
}

const hashTarget = () => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t');

export const useStore = create<Store>((set) => ({
  data: null,
  loadState: 'idle',
  target: (typeof window !== 'undefined' && hashTarget()) || 'jezero',
  hour: 14,
  playing: false,
  speed: 2,
  seam: 0.5,
  layer: 'temperature',
  mode: 'wipe',
  grid: false,
  cam: 'survey',
  sound: false,
  hover: null,
  trial: { a: [0.12, 0.85], b: [0.88, 0.15], t: 0, running: false },
  director: false,
  dirRail: false,
  caption: '',
  set: (p) => set(p),
  setTarget: (id) => {
    const url = new URL(window.location.href);
    url.hash = `t=${id}`;
    window.history.replaceState(window.history.state, '', url);
    set({ target: id });
  },
  setTrial: (p) => set((s) => ({ trial: { ...s.trial, ...p } })),
}));

/** Path helper that keeps the Mars target in the hash so every view is linkable. */
export const withTarget = (pathname: string) => ({ pathname, hash: `#t=${useStore.getState().target}` });
