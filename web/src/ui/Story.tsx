import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { rankOf, useProgress } from '../state/progress';
import { useStore } from '../state/store';

interface Chapter { title: string; text: string; goal?: string; done?: (c: Ctx) => boolean }
interface Ctx { station: string; path: string; target: string; layer: string; playing: boolean; trials: number; start: { target: string; trials: number } }

// The guided mission. Each chapter advances by itself when its goal is met.
const CHAPTERS: Chapter[] = [
  { title: 'Briefing', text: 'Crews are going back to the Moon and on to Mars. Before any hardware flies, it is tested on Earth, at places where the ground behaves like the destination. Your job is to find that ground.' },
  { title: 'Pick a destination', text: 'Choose Mars or the Moon, then lock a target site on its surface.', goal: 'Select a target site', done: (c) => c.target !== c.start.target && c.path === '/' },
  { title: 'Find its twin', text: 'Earth has turned to the sites that match best. The number beside each is its closeness. Open one.', goal: 'Open an Earth site', done: (c) => c.path.startsWith('/seam/') || c.path.startsWith('/table/') },
  { title: 'Read the ground', text: 'Left is Earth, right is your target, same scale. Play the clock to watch a day pass, or switch the layer to Slope to see where a rover would struggle.', goal: 'Play the clock or change the layer', done: (c) => (c.path.startsWith('/seam/') || c.path.startsWith('/table')) && (c.playing || c.layer !== 'temperature') },
  { title: 'Stress it', text: 'A look-alike is not enough. Go to the test bench and see whether a solar panel and a battery survive the night on both worlds.', goal: 'Fly to the Bench station, or open the full bench', done: (c) => c.path.startsWith('/bench/') || c.station === 'bench' },
  { title: 'Drive it', text: 'Last test. Send the same rover down the same path under two different gravities.', goal: 'Finish a rover trial', done: (c) => c.trials > c.start.trials },
  { title: 'Debrief', text: 'You chose a destination, found ground on Earth that behaves like it, and tested what transfers and what does not. That is the whole method.' },
];

export function Story() {
  const step = useProgress((s) => s.story);
  const setStory = useProgress((s) => s.setStory);
  const trials = useProgress((s) => s.trials), xp = useProgress((s) => s.xp);
  const target = useStore((s) => s.target), layer = useStore((s) => s.layer), playing = useStore((s) => s.playing), station = useStore((s) => s.station);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const start = useRef({ target, trials });
  useEffect(() => { start.current = { target: useStore.getState().target, trials: useProgress.getState().trials }; }, [step]);
  useEffect(() => {
    if (step == null) return;
    const ch = CHAPTERS[step];
    if (ch.done?.({ station, path: pathname, target, layer, playing, trials, start: start.current })) {
      const id = window.setTimeout(() => { useProgress.getState().say(`Chapter complete · ${ch.title}`); setStory(step + 1); }, 900);
      return () => window.clearTimeout(id);
    }
  }, [step, pathname, target, layer, playing, trials, station, setStory]);

  if (step == null) return null;
  const ch = CHAPTERS[step], last = step === CHAPTERS.length - 1;
  return (
    <div className={`hide-in-director pointer-events-none fixed inset-x-0 z-40 flex px-3 ${pathname.startsWith('/table') ? 'top-40 justify-end max-lg:top-16 max-lg:justify-center' : 'bottom-3 justify-center'}`}>
      <section key={step} className={`console rise pointer-events-auto w-full p-3 ${pathname.startsWith('/table') ? 'max-w-sm' : 'max-w-2xl'}`} aria-live="polite" aria-label="Mission story">
        <div className="flex items-baseline justify-between gap-3">
          <p className="caps !text-[#8fe3ff]">Chapter {step} of {CHAPTERS.length - 1} · {ch.title}</p>
          <button type="button" className="caps underline underline-offset-4 hover:!text-ink" onClick={() => setStory(null)}>Leave story</button>
        </div>
        <p className="mt-1 text-sm">{ch.text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {ch.goal && <p className="font-mono text-sm text-amber">▸ {ch.goal}</p>}
          {step === 0 && <button type="button" className="btn btn-primary" onClick={() => { navigate({ pathname: '/', hash: `#t=${target}` }); setStory(1); }}>Begin</button>}
          {step === 5 && (pathname.startsWith('/bench/') || pathname.startsWith('/table/')) && <Link to={{ pathname: pathname.replace(/^\/(bench|table)\//, '/trial/'), hash: `#t=${target}` }} className="btn btn-primary">Go to the rover trial</Link>}
          {last && <><span className="font-mono text-sm">{rankOf(xp).name} · {xp} XP</span><Link to={{ pathname: '/evidence', hash: `#t=${target}` }} className="btn" onClick={() => setStory(null)}>See the evidence</Link><button type="button" className="btn btn-primary" onClick={() => setStory(7)}>Finish</button></>}
        </div>
        <div className="mt-2 flex gap-1" aria-hidden>{CHAPTERS.map((_, i) => <span key={i} className={`h-0.5 flex-1 ${i <= step ? 'bg-[#8fe3ff]' : 'bg-line'}`} />)}</div>
      </section>
    </div>
  );
}
