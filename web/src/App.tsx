import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { loadSites } from './data/load';
import { Director } from './director/Director';
import { initClock, runIntro } from './state/clock';
import { useStore } from './state/store';
import { Chrome } from './ui/Chrome';
import { OpsLog } from './ui/OpsLog';
import { warpWhoosh } from './ui/sound';
import { ChallengeView } from './views/ChallengeView';
import { SurveyView } from './views/SurveyView';
import { EvidenceView } from './views/EvidenceView';
import { MethodView } from './views/MethodView';
import { NotFound, SeamView } from './views/SeamView';
import { SolView } from './views/SolView';
import { SystemView } from './views/SystemView';
import { TrialView } from './views/TrialView';

/** A short tunnel whenever the visitor moves between the system view and the ground. */
function WarpTunnel() {
  const { pathname } = useLocation();
  const prev = useRef(pathname);
  const [n, setN] = useState(0);
  useEffect(() => {
    const space = (p: string) => p === '/', ground = (p: string) => p.startsWith('/seam') || p.startsWith('/trial');
    if ((space(prev.current) && ground(pathname)) || (ground(prev.current) && space(pathname))) { setN((k) => k + 1); warpWhoosh(); }
    prev.current = pathname;
  }, [pathname]);
  return n ? <div key={n} className="warp-tunnel" aria-hidden /> : null;
}

export default function App() {
  const loadState = useStore((s) => s.loadState);
  const error = useStore((s) => s.error);

  const load = useCallback(() => {
    const { set } = useStore.getState();
    set({ loadState: 'loading', error: undefined });
    loadSites()
      .then((data) => {
        const t = useStore.getState().target;
        set({ data, loadState: 'ready', target: data.targets.some((x) => x.id === t) ? t : data.targets[0].id });
        runIntro();
      })
      .catch((e: Error) => set({ loadState: 'error', error: e.message }));
  }, []);

  useEffect(() => { const stop = initClock(); load(); return stop; }, [load]);

  if (loadState === 'error')
    return (
      <div className="mx-auto max-w-xl p-8" role="alert">
        <h1 className="text-lg font-semibold">Could not load site data</h1>
        <pre className="mt-3 whitespace-pre-wrap rounded border border-line bg-panel p-3 font-mono text-sm text-amber">{error}</pre>
        <button type="button" className="btn mt-3" onClick={load}>Try again</button>
      </div>
    );
  if (loadState !== 'ready') return <div className="p-8 font-mono text-sm text-dim">Loading sites.json…</div>;

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <Chrome>
        <Routes>
          <Route path="/" element={<SystemView />} />
          <Route path="/sol" element={<SolView />} />
          <Route path="/seam/:siteId" element={<SeamView />} />
          <Route path="/trial/:siteId" element={<TrialView />} />
          <Route path="/evidence" element={<EvidenceView />} />
          <Route path="/method" element={<MethodView />} />
          <Route path="/challenge" element={<ChallengeView />} />
          <Route path="/survey" element={<SurveyView />} />
          <Route path="*" element={<NotFound what="Page" />} />
        </Routes>
      </Chrome>
      <WarpTunnel />
      <OpsLog />
      <Director />
    </BrowserRouter>
  );
}
