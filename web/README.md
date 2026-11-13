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

## Views

| Route | What it shows |
|---|---|
| `/` | Mars target picker and Earth sites as 24-hour thermal ribbons |
| `/seam/:site` | Earth and Mars terrain at one scale, split by a draggable seam; clock, permits, limits |
| `/trial/:site` | The same rover drive on both terrains, with slope margin |
| `/evidence` | Curve overlay, controls, rover ground truth, local readings |
| `/method` | Formula, weights, data table, classes, AI statement |

The Mars target is kept in the URL hash (`#t=jezero`). Press `D` or open `/?director=1` for the scripted 30-second demo. Add `?nointro` to skip the opening sequence.

To re-shoot the submission figures into `report/figures/`: `npm run build && node scripts/smoke.cjs --figures ../report/figures`.

## Data contract

`../data/schema/sites.schema.json` is checked at load. The app needs these fields beyond BUILD_SPEC §4:

- `terrain_meta` on every site and target: `z_min`, `z_max`, `pixel_m`, `source_res_m`, optional `thermal_res_m`
- `features.amplitude_pct` (ribbon thickness)
- `targets[].class` and `meta.friction` (rover trial)
- `meta.formula`, `meta.class_map` (method page), `meta.demo` (director site ids)
- optional `verdicts.*.rule_id`

All data currently in `public/` is mock and is labelled as such on screen. The real pipeline overwrites the same files.
