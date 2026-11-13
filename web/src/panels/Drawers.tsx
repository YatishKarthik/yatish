import type { Site } from '../data/types';

export const LIMITATIONS = [
  'Temperature curves are compared by shape and rank within each planet, not as absolute temperatures.',
  'Mars thermal data is far coarser than the terrain shown.',
];

export function DossierDrawer({ site }: { site: Site }) {
  return (
    <details className="panel p-3">
      <summary className="caps cursor-pointer py-1">Site summary</summary>
      <p className="mt-2 text-sm">{site.dossier.text}</p>
      <p className="caps mt-2">AI-generated · {site.dossier.model}</p>
    </details>
  );
}
