# Thermal Twin — web app

Static front end. Needs Node.js 20.19 or newer. It reads `public/data/sites.json` and the tiles under `public/tiles/`; it computes no scores.

```bash
npm install
npm run mock     # regenerate mock sites.json and tiles (deterministic)
npm run dev      # local server; open the http://localhost:5173 address it prints
npm test         # unit tests: selectors and the rover trial
npm run build    # type-check and build to dist/
npm run smoke    # browser smoke test on the build (needs: npm i -D playwright && npx playwright install chromium)
```

No lockfile is committed: lockfiles written on one operating system have made npm skip the build tool's native module on another. If `npm run dev` ever stops with "Cannot find native binding", delete `node_modules` and `package-lock.json` and run `npm install` again.

## Views

| Route | What it shows |
|---|---|
| `/` | Earth, Mars and the Moon: pick a destination and target, then see matching ground on Earth |
| `/sol` | Mars target picker and Earth sites as 24-hour thermal ribbons |
| `/seam/:site` | Earth and Mars terrain at one scale, split by a draggable seam; clock, permits, limits |
| `/trial/:site` | The same rover drive on both terrains, with slope margin |
| `/bench/:site` | Test bench: solar power and thermal cycling on both worlds, plus a link to the rover trial |
| `/analysis` | Parameter space: 3D PCA, k-means families, neural map, parameter scatter and correlation matrix |
| `/challenge` | Blind match: read a target's fingerprint and pick the closest of three Earth sites |
| (overlay) | Guided mission: seven chapters that walk a first-time visitor through the method; start it from the title screen |
| `/survey` | Your survey record: rank, XP, badges and coverage, kept in the browser |
| `/evidence` | Curve overlay, controls, rover ground truth, local readings |
| `/method` | Formula, weights, data table, classes, AI statement |

The Mars target is kept in the URL hash (`#t=jezero`). Press `D` or open `/?director=1` for the scripted 30-second demo. Add `?nointro` to skip the opening sequence.

To re-shoot the submission figures into `report/figures/`: `npm run build && node scripts/smoke.cjs --figures ../report/figures`.

## Real terrain and imagery

`node scripts/fetch-real.mjs` downloads real ground for the 3D tiles from open data on AWS (it skips tiles already present), then `npm run mock` rebuilds `sites.json` around it:

- Earth elevation: Copernicus DEM GLO-30 (© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA).
- Earth imagery: Sentinel-2 L2A true colour (contains modified Copernicus Sentinel data, 2023).
- Mars elevation and imagery: USGS Astrogeology CTX stereo DTMs and orthoimages (NASA/JPL/MSSS/USGS).
- Moon elevation and imagery: USGS Astrogeology stereo DTMs and orthoimages from the Kaguya Terrain Camera (JAXA/SELENE, USGS).

Locations are listed in `scripts/locations.json`: 60 Earth sites, 10 Mars targets and 10 Moon targets. A location with no usable data is skipped, so the list holds a few spares.

The system view's global maps in `public/textures/` are NASA Blue Marble (Earth), the Viking MDIM2.1 colour mosaic (Mars, NASA/JPL/USGS) and the LRO WAC global mosaic (Moon, NASA/GSFC/ASU); Mars and Moon were downloaded from NASA Trek. Earth's night lights, ocean mask and relief come from NASA Blue Marble / Black Marble derived maps as redistributed by the three-globe package.

Terrain, imagery and the slope and roughness numbers are real. Thermal curves, closeness, classes and validation numbers are still mock until the pipeline replaces them.

## Rebuilding the data

Run these from `web/` in order. Each step skips work already done.

```bash
node scripts/fetch-real.mjs          # terrain and imagery tiles
node scripts/fetch-env.mjs           # NASA POWER climate records per Earth site (set NODE_USE_ENV_PROXY=1 behind a proxy)
node scripts/fetch-s2-indices.mjs    # Sentinel-2 NDVI, iron oxide and clay ratios per Earth site
npm run data                         # build sites.json, then run the Python analysis (needs numpy and scikit-learn)
```

`pipeline/ml/analyse.py` adds PCA coordinates, k-means families, a neural autoencoder map and an agreement check to `sites.json`. It is exploration only and never feeds the closeness score.

## Connecting the pipeline

The app has no API. The pipeline's only job is to write files into `web/public/`:

1. `web/public/data/sites.json`, valid against `data/schema/sites.schema.json`, with `meta.mock` and every `site.mock` set to `false`.
2. For every site and target, a folder under `web/public/tiles/` holding `height.png` (16-bit grey, 256×256), `sat.png` and `colour_0.png` … `colour_23.png`, at the paths named in `sites.json`.

Then run `npm run build` and deploy `web/dist/`. The app checks the schema on load and shows the reason if the file is rejected. Mock markers disappear once the flags are false.

## Data contract

`../data/schema/sites.schema.json` is checked at load. The app needs these fields beyond BUILD_SPEC §4:

- `terrain_meta` on every site and target: `z_min`, `z_max`, `pixel_m`, `source_res_m`, optional `thermal_res_m`
- `features.amplitude_pct` (ribbon thickness)
- `targets[].class` and `meta.friction` (rover trial)
- `meta.formula`, `meta.class_map` (method page), `meta.demo` (director site ids)
- optional `verdicts.*.rule_id`

All data currently in `public/` is mock and is labelled as such on screen. The real pipeline overwrites the same files.
