# Celestra

Find places on Earth whose ground behaves like a proposed Moon or Mars base site, show what they can and cannot stand in for, and let anyone try the same hardware mission on both worlds.

Built for the NASA Space Apps Challenge 2026: *Identify Earth locations that analog the permanent Moon base locations and Mars*.

## What it does

1. **Pick a destination.** NASA's nine Artemis III candidate regions at the lunar south pole (Oct 2024 list), nine other Moon sites (including three 2022 Artemis candidates that were dropped, marked as such) and ten Mars sites. Or **click any point** on the Moon or Mars: its terrain is fetched live from LOLA, Kaguya or CTX and ranked the same way.
2. **Rank 60 Earth sites.** Fourteen measurements of terrain, surface texture, surface composition and temperatures are compared site by site; the result is a 0–100 match score with an uncertainty band, and a breakdown of how many points each measurement adds (**why this match**).
3. **Best site per use.** An Earth site can be a good stand-in for one test and useless for another (a *functional analogue*, Foucher et al. 2021). For seven hardware tests (traction, navigation, landing stability, plume, drilling, motor cooling, low-sun camera navigation) the app ranks the best Earth sites for that use and says plainly when Earth physics cannot stand in at all.
4. **Sunlight at the pole.** For polar Moon sites, a horizon model on LOLA terrain gives how often the Sun and Earth are above the horizon, how much of the site never sees the Sun, and a modelled peak temperature. The same model chose the landing point inside each Artemis III region.
5. **Plan the campaign.** Per Earth site: documented analog history, permits, field season from NASA POWER temperatures, the months when the Sun is as low as at the target, and what still needs checking. A one-page **field brief** can be saved as PDF.
6. **Fly it.** A short mission on each world (land, drive, collect samples, drill cores) on terrain built from the real elevation data, with that world's gravity and air pressure. The score gap between the two runs is the part an Earth test cannot show.

## Data

Every value in the app is tagged with where it came from. Fetch with `data-pipeline/02_fetch_real_data.py`; the cache is in `data/real/`.

| Group | Earth (60 sites) | Moon (18 sites) | Mars (10 sites) |
|---|---|---|---|
| Terrain | **Measured**: Copernicus DEM GLO-30 (ESA), all 60 | **Measured**: LRO LOLA laser altimeter returns, median-gridded at ~60 m over 2 km tiles (15 sites; 92–100% of 62.5 m cells hit, Schrödinger 31%); Kaguya TC stereo DTMs (JAXA/USGS) for Marius Hills, Aristarchus, Von Kármán | **Measured**: MRO CTX stereo DTMs (NASA/USGS), all 10. Where no DTM covers the nominal point the nearest one is used and the distance is shown (0–218 km; Phoenix polar plains is the farthest) |
| Surface texture | **Derived** from the terrain (texture statistics of the slope grid). A roughness proxy, not radar | Derived | Derived |
| Surface composition | **Measured**: Sentinel-2 L2A, cloud- and water-masked with the scene classification layer, all 60 | **Typical** values for the rock class | **Typical** values for the rock class |
| Temperatures | **Measured**: NASA POWER climatology, 2 m air (typical daily high in the warmest month, low in the coldest, mean day-night range) | Polar sites: peak **modelled** by radiative balance on LOLA terrain and sun geometry, cold end **typical**. Other sites: **typical** published ranges | **Typical** published surface ranges |
| Sunlight and Earth view | Noon Sun elevation by month (geometry) | **Modelled** for polar sites: horizons traced on a 400 m LOLA terrain model to 90 km, Sun over a lunar day at 12 seasonal points, Earth over its libration range (`04_polar_illumination.py`) | Sun elevation from latitude |
| Night-time infrared | – | – | **Measured, relative**: THEMIS night-IR controlled mosaics (Mars Odyssey), site vs 20 km surround; 9 of 10 sites (`05_mars_themis.py`). Shown as a descriptor, not scored |
| 24-hour curve | Modelled (sine between the low and high) | Modelled | Modelled |

Earth temperatures are air temperatures and Moon/Mars ones are surface ranges, so temperatures are compared by pattern after standardisation, never by raw value, and carry the smallest weight.

## Method

* Each of the 14 features is standardised across all 88 sites; per feature, similarity is `exp(-0.55·|Δz|)`; features are averaged into four groups; groups are weighted terrain 0.30, texture 0.30, composition 0.25, temperatures 0.15.
* **Bare-ground rule.** The Moon and Mars have no plants and no open water, so the weighted score is multiplied by a factor that is 1 at Sentinel-2 NDVI ≤ 0.20 and ≤ 20% open water, falling to 0 at NDVI 0.30 or 50% water. Results are reported with and without the rule.
* **Uncertainty.** A 7-model deep ensemble (PyTorch) predicts how well rover, landing and mining tests transfer; its spread is the epistemic uncertainty and split-conformal calibration gives a 90% band. The ensemble does not change the ranking.
* **Why this match.** Each feature's share of the score is its group weight split equally across the group's features, times its similarity, times the bare-ground factor. The 14 shares add up to the score, so the app can show exactly which measurements carry a match and which hold it back.
* **Best site per use.** Each of the seven tests uses only the groups that matter for it (traction: terrain and composition; navigation: texture and terrain; drilling: composition; …) and the test's verdict for that site. Tests whose physics cannot be reproduced in Earth's air (plume, motor cooling) are still ranked by ground similarity, but are labelled as not transferable.
* **Low-sun test.** At the lunar poles the Sun never rises more than a few degrees. For every Earth site the app computes the noon Sun elevation month by month and lists the months when it is as low as at the target, the window for camera and navigation tests. Earth's sky still lights shadows that are black on the Moon, so for the Moon this test is at best *partly useful*.

## Artemis III regions and the sunlight model

NASA's October 2024 update named nine candidate regions for the first crewed landing, each about 15 × 15 km: Peak near Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1 and 2, de Gerlache Rim 2 and Slater Plain. We could not obtain NASA's region outlines, so `04_polar_illumination.py` searches the area around each region's named feature and picks the best-lit, gentlest 2 km window. That point is our estimate of a landing spot inside the region, not NASA's site; the app says so on every Artemis target. Mons Mouton uses a published landing-site point (LPSC 2025).

The sunlight model grids LOLA returns to a 400 m terrain model reaching 90 km beyond each site, traces the horizon in 72 directions allowing for the Moon's curvature, moves the Sun through a lunar day at 12 points of its ±1.54° seasonal swing and Earth through its libration range, and turns the steepest sunlit incidence into a radiative-balance peak temperature (albedo 0.15, emissivity 0.95). Sanity check: the summit of Malapert Massif comes out sunlit 86% of the time with Earth in view 76%, close to the high illumination reported for that peak in the literature. The published Mons Mouton landing point comes out at only 25% sunlit in our model; it was chosen for access to shadowed ground, and our 400 m terrain also smooths out small sunlit knolls, so treat low values as a lower bound.

| Region | Sunlit | Earth in view | Modelled peak |
|---|---|---|---|
| Peak near Cabeus B | 52% | 98% | -27 °C |
| Haworth | 76% | 97% | -61 °C |
| Malapert Massif | 76% | 100% | -40 °C |
| Mons Mouton | 25% | 57% | -63 °C |
| Mons Mouton Plateau | 76% | 71% | -56 °C |
| Nobile Rim 1 | 75% | 100% | -63 °C |
| Nobile Rim 2 | 48% | 79% | -39 °C |
| de Gerlache Rim 2 | 88% | 59% | -100 °C |
| Slater Plain | 88% | 57% | -75 °C |

Three of the old targets were 2022 Artemis candidates that did not make the 2024 list (Peak Near Shackleton, Connecting Ridge, Faustini Rim A); they stay in the app, labelled as dropped.

## Does the score mean anything?

`python data-pipeline/03_validate.py` (results in `data/processed/validation.json`), over all 28 targets:

| Check | Result |
|---|---|
| 8 negative controls (rainforest, wetland, farmland, polders) | median rank **56.5 of 60**, 91% in the bottom half. Without the bare-ground rule: median 33, 58% in the bottom half. Terrain alone cannot tell a flat wetland from a flat Martian plain |
| 12 agency benchmark analogs (Haughton, Atacama, McMurdo, …) | median rank **22 of 60**, 69% in the top half. Each benchmark is an analog for particular targets, so a middling average is expected |
| **Baseline**: plain unweighted distance over the same 14 features | controls 38, benchmarks 19. With the bare-ground rule: controls 56.5, benchmarks 17. **Our group weights do not beat a plain distance**: most of the separating power comes from the measured features and the bare-ground rule. We keep the weights because they are stable (next row) and readable, and we report this openly |
| Bare-ground thresholds moved (full score at NDVI 0.15–0.25, zero at 0.25–0.35) | control median stays **56.5** in every setting (91%–100% in the bottom half) |
| Weight sensitivity (any one group weight ×0.8 or ×1.2) | keeps on average **4.29 of the top 5** (never fewer than 3) |
| Ensemble calibration (target 90%) | 86%, 79%, 86% on 14 held-out sites; small sample, coarse guarantee |

What this validation cannot show:
* The controls and benchmarks were chosen by us. An independent test would use analog sites ranked by mission teams who did not see our scores.
* The ensemble's training labels are formulas of the same features, so its band shows model disagreement (epistemic uncertainty), not real-world error.
* Moon and Mars composition are typical values for the rock class, so the composition group cannot separate two Moon sites of the same class.
* Whether a high-ranked site actually gave transferable results in a past campaign is not tested here; that needs campaign reports matched to flight outcomes.
* Texture comes from 2 km elevation tiles, so boulder-scale roughness (what wheels feel) is not seen.

## Limitations

* Moon and Mars composition are typical values for the rock class, and away from the poles so are Moon temperatures. No calibrated Diviner, TES or CRISM product was reachable from our pipeline; those are the next step.
* The sunlight model uses a point Sun, a 90 km horizon and 400 m terrain; published ray-traced maps (Mazarico et al. 2011) should be preferred where available. Our Artemis points are estimates inside each region, not NASA's sites; Haworth's best-lit window lies on its north rim, about 8 km from our Malapert point.
* THEMIS night-IR mosaics are 8-bit and stretched per image, so they are compared only with the site's own surroundings and are not scored.
* Texture comes from 2 km elevation tiles (LOLA effectively ~60 m), so it sees ridges and crater walls, not boulders.
* The ensemble's training labels are formulas of the features, so its uncertainty is epistemic only.
* Field-readiness entries list analog history and permits only where documented; everything else is marked "not verified".
* Custom points borrow composition and the cold end of the temperature range from the nearest Celestra target on the same body, and say so.
* Simulator physics are simplified and tuned for play; gravity, air pressure and temperature differences are real, vehicle numbers are illustrative. The Heat view is a simple surface-temperature model (sun incidence on each terrain facet, ridge shadows, radiative balance in vacuum, a thermal lag), not a measurement; the Slope view is the true slope of the terrain the rover drives on.
* Site registry corrections: the Amazon control was moved from central Manaus (−3.10, −60.02) to Reserva Ducke (−2.95, −59.95) so it samples forest, not city. Shackleton rim, Connecting Ridge, Faustini Rim A and Peary rim had been registered at crater-centre coordinates (Faustini's sat on the permanently shadowed floor, 0% sunlit); they were moved onto the named rims with the sunlight search (`data/config/relocated_targets.json`). The old Malapert point, on the massif's flank, is replaced by the Artemis III Malapert target. A Sentinel-2 search bug (scenes near a UTM zone edge were crowded out) left Craters of the Moon on typical values; it is now measured. LOLA tiles were first gridded at 15.6 m, which left false pits along laser tracks; they are now median-gridded at ~60 m.

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

Picking your own point on the Moon or Mars fetches terrain live, so it also needs the pipeline packages (`pip install -r requirements.txt`) and internet access; without them the app says so and everything else still works. The field brief is served by the backend at `/api/brief/<target id>`.

## Rebuild the data from source (optional)

```bash
pip install -r requirements.txt
python data-pipeline/04_polar_illumination.py  # ~20 min: sunlight model, places the Artemis III targets
python data-pipeline/05_mars_themis.py         # THEMIS night-IR descriptors for the Mars targets
python data-pipeline/02_fetch_real_data.py     # ~5-10 min, cached in data/real/
python data-pipeline/01_fetch_and_extract.py   # features and terrain assets
python data-pipeline/03_validate.py            # controls, benchmarks, baseline, sensitivity, calibration
```

## Layout

```
backend/        FastAPI app, terrain assets, simulator physics, field brief, live custom targets
ml_engine/      similarity, bare-ground rule, 7-model deep ensemble with conformal bands
data/           site registry, real-data cache (data/real), features, validation results
data-pipeline/  04 sunlight + Artemis placement, 05 THEMIS, 02 fetch real data, 01 build features, 03 validate
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
* THEMIS controlled night-IR mosaics: NASA/JPL/Arizona State University (Mars Odyssey), processed by USGS Astrogeology (CC0).
* Artemis III regions: NASA, "NASA Provides Update on Artemis III Moon Landing Regions" (October 2024) and the August 2022 announcement; Mons Mouton landing point from LPSC 2025 abstract 2742; Slater Plain location from Wueller et al. 2026 (JGR Planets).
* Functional analogues: Foucher, F. et al. (2021), "Definition and use of functional analogues in planetary exploration", Planetary and Space Science 197, 105162.
* Planet textures in `frontend/public/textures` came with the original codebase; check their licences before redistributing.

**3D models** (in `frontend/public/models`, compressed with glTF-Transform):
* Curiosity rover: NASA 3D Resources (public domain).
* "Mars Polar Lander" by emin31284, https://sketchfab.com/3d-models/mars-polar-lander-8c87cc5b86864b5a8c986d603fda1cef, licensed CC BY 4.0.
* "Sci-Fi Beacon/Way Point Marker Free Model" by AMMediaGames, https://sketchfab.com/3d-models/sci-fi-beaconway-point-marker-free-model-a1d91ebb3e2d41bba31c02b11423d97f, licensed CC BY 4.0.
* "Low Poly Rocks" by Michael Hooper, https://sketchfab.com/3d-models/low-poly-rocks-9823ec262054408dbe26f6ddb9c0406e, licensed CC BY 4.0.
