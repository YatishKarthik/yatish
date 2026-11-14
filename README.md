# Celestra

Find places on Earth whose ground behaves like a proposed Moon or Mars base site, show what they can and cannot stand in for, and let anyone try the same hardware mission on both worlds.

Built for the NASA Space Apps Challenge 2026: *Identify Earth locations that analog the permanent Moon base locations and Mars*.

## What it does

1. **Pick a destination.** 10 candidate base sites on the Moon and 10 on Mars.
2. **Rank 60 Earth sites.** Fourteen measurements of terrain, surface texture, surface composition and temperatures are compared site by site; the result is a 0–100 match score with an uncertainty band.
3. **Say what transfers.** For six common hardware tests (traction, navigation, landing stability, plume, drilling, motor cooling) each Earth site is rated *good*, *partly useful* or *not useful*, with the reason in plain words.
4. **Fly it.** A short mission on each world (land, drive, collect samples, drill cores) on terrain built from the real elevation data, with that world's gravity and air pressure. The score gap between the two runs is the part an Earth test cannot show.

## Data

Every value in the app is tagged with where it came from. Fetch with `data-pipeline/02_fetch_real_data.py`; the cache is in `data/real/`.

| Group | Earth (60 sites) | Moon (10 sites) | Mars (10 sites) |
|---|---|---|---|
| Terrain | **Measured**: Copernicus DEM GLO-30 (ESA), all 60 | **Measured**: LRO LOLA laser altimeter returns gridded to 2 km tiles (7 sites, 4–64% of cells hit); Kaguya TC stereo DTMs (JAXA/USGS) for Marius Hills, Aristarchus, Von Kármán | **Measured**: MRO CTX stereo DTMs (NASA/USGS), all 10. Where no DTM covers the nominal point the nearest one is used and the distance is shown (0–218 km; Phoenix polar plains is the farthest) |
| Surface texture | **Derived** from the terrain (texture statistics of the slope grid). A roughness proxy, not radar | Derived | Derived |
| Surface composition | **Measured**: Sentinel-2 L2A, cloud- and water-masked with the scene classification layer (59 of 60; Craters of the Moon uses typical basalt values) | **Typical** values for the rock class | **Typical** values for the rock class |
| Temperatures | **Measured**: NASA POWER climatology, 2 m air (typical daily high in the warmest month, low in the coldest, mean day-night range) | **Typical** published surface ranges | **Typical** published surface ranges |
| 24-hour curve | Modelled (sine between the low and high) | Modelled | Modelled |

Earth temperatures are air temperatures and Moon/Mars ones are surface ranges, so temperatures are compared by pattern after standardisation, never by raw value, and carry the smallest weight.

## Method

* Each of the 14 features is standardised across all 80 sites; per feature, similarity is `exp(-0.55·|Δz|)`; features are averaged into four groups; groups are weighted terrain 0.30, texture 0.30, composition 0.25, temperatures 0.15.
* **Bare-ground rule.** The Moon and Mars have no plants and no open water, so the weighted score is multiplied by a factor that is 1 at Sentinel-2 NDVI ≤ 0.20 and ≤ 20% open water, falling to 0 at NDVI 0.30 or 50% water. Results are reported with and without the rule.
* **Uncertainty.** A 7-model deep ensemble (PyTorch) predicts how well rover, landing and mining tests transfer; its spread is the epistemic uncertainty and split-conformal calibration gives a 90% band. The ensemble does not change the ranking.

## Does the score mean anything?

`python data-pipeline/03_validate.py` (results in `data/processed/validation.json`), over all 20 targets:

| Check | Result |
|---|---|
| 8 negative controls (rainforest, wetland, farmland, polders) | median rank **56.5 of 60**, 91% in the bottom half. Without the bare-ground rule: median 34, 58% in the bottom half. Terrain alone cannot tell a flat wetland from a flat Martian plain. The one control that still ranks high (6th for one target) is the Everglades, which Sentinel-2 measured at NDVI 0.19 in July |
| 12 agency benchmark analogs (Haughton, Atacama, McMurdo, …) | median rank **23 of 60**, 66% in the top half. Each benchmark is an analog for particular targets, so a middling average is expected |
| Weight sensitivity (any one group weight ×0.8 or ×1.2) | keeps on average **4.15 of the top 5** (never fewer than 3) |
| Ensemble calibration (target 90%) | 79%, 86%, 86% on 14 held-out sites; small sample, coarse guarantee |

Example: for Shackleton crater rim the top three are the McMurdo Dry Valleys, Mount Etna's upper ash slopes and the Tabernas badlands.

## Limitations

* Moon and Mars composition and temperatures are typical values, not measurements; the next step is LRO Diviner and Mars THEMIS/TES temperatures and M3/CRISM composition.
* Texture comes from 2 km elevation tiles, so it sees ridges and crater walls, not boulders.
* LOLA tracks are sparse at Schrödinger basin (6% of cells hit), so most of that tile is interpolated between tracks.
* The ensemble's training labels are formulas of the features, so its uncertainty is epistemic only.
* Simulator physics are simplified and tuned for play; gravity, air pressure and temperature differences are real, vehicle numbers are illustrative.
* Site registry correction: the Amazon control was moved from central Manaus (−3.10, −60.02) to Reserva Ducke (−2.95, −59.95) so it samples forest, not city.

## Run it locally (two terminals)

Backend (FastAPI, port 8000). Python 3.12 recommended:

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1      # Windows PowerShell
# source .venv/bin/activate     # macOS / Linux
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-run.txt
python backend/main.py
```

Frontend (Next.js, port 3000):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.

## Rebuild the data from source (optional)

```bash
pip install -r requirements.txt
python data-pipeline/02_fetch_real_data.py     # ~5-10 min, cached in data/real/
python data-pipeline/01_fetch_and_extract.py   # features and terrain assets
python data-pipeline/03_validate.py            # controls, benchmarks, sensitivity, calibration
```

## Layout

```
backend/        FastAPI app, terrain assets, simulator physics
ml_engine/      similarity, bare-ground rule, 7-model deep ensemble with conformal bands
data/           site registry, real-data cache (data/real), features, validation results
data-pipeline/  02 fetch real data, 01 build features, 03 validate
frontend/       Next.js 16 + React 19 + react-three-fiber
```

## Use of AI

AI (Anthropic's Claude, through Claude Code) was used extensively to write and refactor code: the data pipeline, the frontend, the simulator and this README. The team chose the challenge approach, site registry and scoring design, and reviewed the results. No AI-generated imagery is used; all terrain comes from the instrument products listed above. No NASA or other agency logos are used.

## Credits and data licences

* Original codebase: [reality-hacker/NasaSpace1Try](https://github.com/reality-hacker/NasaSpace1Try).
* Copernicus DEM GLO-30: © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
* Contains modified Copernicus Sentinel data (2022-2023).
* NASA POWER: data obtained from the NASA Langley Research Center POWER Project, funded through the NASA Earth Science Directorate Applied Science Program.
* LRO LOLA: NASA Goddard Space Flight Center; cloud-optimised point clouds published by USGS Astrogeology (astrogeo-ard on AWS Open Data).
* MRO CTX DTMs: NASA/JPL/Malin Space Science Systems, processed by USGS Astrogeology.
* Kaguya Terrain Camera DTMs: JAXA/SELENE, processed by USGS Astrogeology.
* Planet textures in `frontend/public/textures` came with the original codebase; check their licences before redistributing.
