import { useCallback, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { loadSites } from './data/load';
import { Director } from './director/Director';
import { initClock } from './state/clock';
import { useStore } from './state/store';
import { Chrome } from './ui/Chrome';
import { EvidenceView } from './views/EvidenceView';
import { MethodView } from './views/MethodView';
import { NotFound, SeamView } from './views/SeamView';
import { SolView } from './views/SolView';
import { TrialView } from './views/TrialView';

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
      })
      .catch((e: Error) => set({ loadState: 'error', error: e.message }));
  }, []);

  useEffect(() => { const stop = initClock(); load(); return stop; }, [load]);

  if (loadState === 'error')
    return (
      <div className="mx-auto max-w-xl p-8" role="alert">
        <h1 className="text-lg font-semibold">The site data could not be used</h1>
        <pre className="mt-3 whitespace-pre-wrap rounded border border-line bg-panel p-3 font-mono text-sm text-amber">{error}</pre>
        <p className="mt-3 text-dim">Nothing is shown rather than showing numbers that failed the contract. Run <code className="font-mono">npm run mock</code> to restore mock data.</p>
        <button type="button" className="btn mt-3" onClick={load}>Try again</button>
      </div>
    );
  if (loadState !== 'ready') return <div className="p-8 font-mono text-sm text-dim">Loading sites.json…</div>;

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <Chrome>
        <Routes>
          <Route path="/" element={<SolView />} />
          <Route path="/seam/:siteId" element={<SeamView />} />
          <Route path="/trial/:siteId" element={<TrialView />} />
          <Route path="/evidence" element={<EvidenceView />} />
          <Route path="/method" element={<MethodView />} />
          <Route path="*" element={<NotFound what="Page" />} />
        </Routes>
      </Chrome>
      <Director />
    </BrowserRouter>
  );
}
