import { useEffect, useState } from 'react';
import { siteIndex, targetIndex } from '../data/select';
import { loadTileSet, tileWidthM, type TileSet } from '../data/tiles';
import { useStore } from '../state/store';

/** Resolve the site and target for a seam or trial view and load both tile sets. */
export function useSeam(siteId: string | undefined) {
  const data = useStore((s) => s.data)!;
  const targetId = useStore((s) => s.target);
  const si = siteIndex(data, siteId ?? ''), ti = Math.max(0, targetIndex(data, targetId));
  const site = si >= 0 ? data.sites[si] : undefined, target = data.targets[ti];
  const [tiles, setTiles] = useState<{ key: string; earth: TileSet; mars: TileSet } | null>(null);
  const key = `${site?.id}|${target.id}`;
  useEffect(() => {
    if (!site) return;
    let live = true;
    Promise.all([loadTileSet(site), loadTileSet(target)]).then(([earth, mars]) => { if (live) setTiles({ key, earth, mars }); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = tiles && tiles.key === key ? tiles : null;
  // Same scale on both halves: the Mars tile is cropped to the Earth site's extent.
  const extentM = ready ? Math.min(tileWidthM(ready.earth.hf), tileWidthM(ready.mars.hf)) : 0;
  return { data, site, target, si, ti, tiles: ready, extentM };
}
