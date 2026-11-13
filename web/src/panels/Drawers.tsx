import type { Site } from '../data/types';

export const GLOBAL_LIMITS = [
  'Curves are normalised within each planet and compared by shape and rank; raw temperatures are never compared across planets.',
  'Mars thermal footprints are far larger than the terrain tile, so the Mars half shows one thermal value per hour.',
  'Closeness is a printed formula on percentile ranks, not a learned model.',
];

export function BreaksDrawer({ site }: { site: Site }) {
  return (
    <section className="panel p-3" aria-label="Where the analogy breaks">
      <h2 className="caps mb-2 !text-denied">Where the analogy breaks</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {site.limits.map((l) => <li key={l}>{l}</li>)}
        {GLOBAL_LIMITS.map((l) => <li key={l} className="text-dim">{l}</li>)}
      </ul>
    </section>
  );
}

export function DossierDrawer({ site }: { site: Site }) {
  return (
    <details className={`panel p-3 ${site.mock ? 'mock' : ''}`}>
      <summary className="caps cursor-pointer py-1">Site dossier · AI-generated</summary>
      <p className="mt-2 text-sm">{site.dossier.text}</p>
      <p className="caps mt-2">AI-generated from the numbers above · model: {site.dossier.model}</p>
    </details>
  );
}
