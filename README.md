# Celestra

Find places on Earth whose ground behaves like a proposed Moon or Mars base site, show what they can and cannot stand in for, and let anyone try the same hardware mission on both worlds.

Built for the NASA Space Apps Challenge 2026: *Identify Earth locations that analog the permanent Moon base locations and Mars*.

## What it does

1. **Pick a destination.** NASA's nine Artemis III candidate regions at the lunar south pole (Oct 2024 list), nine other Moon sites (including three 2022 Artemis candidates that were dropped, marked as such) and ten Mars sites. Or **click any point** on the Moon or Mars: its terrain is fetched live from NASA PDS (LOLA on the Moon, HiRISE on Mars) and ranked the same way, against the named sites and every place the AI search found on that world.
2. **Rank 60 Earth sites.** Fourteen measurements of terrain, surface texture, surface composition and temperatures are compared site by site; the result is a 0–100 match score, computed only from measurements that exist for both sites, with a sensitivity range, and a breakdown of how many points each measurement adds (**why this match**).
3. **Best site per use.** An Earth site can be a good stand-in for one test and useless for another (a *functional analogue*, Foucher et al. 2021). For seven hardware tests (traction, navigation, landing stability, plume, drilling, motor cooling, low-sun camera navigation) the app ranks the best Earth sites for that use and says plainly when Earth physics cannot stand in at all.
4. **Sunlight at the pole.** For polar Moon sites, a horizon model on LOLA terrain gives how often the Sun and Earth are above the horizon, how much of the site never sees the Sun, and a modelled peak temperature. The same model chose the landing point inside each Artemis III region.
5. **Plan the campaign.** Per Earth site: documented analog history, permits, field season from MODIS land surface temperatures, the months when the Sun is as low as at the target, and what still needs checking. A one-page **field brief** can be saved as PDF.
6. **Fly it.** A short mission on each world (land, drive, collect samples, drill cores) on terrain built from the real elevation data, with that world's gravity and air pressure. The score gap between the two runs is the part an Earth test cannot show.

## Data: only the challenge's listed resources

Every value in the app is tagged with where it came from (measured, derived, modelled or typical). **Only measured values, or values derived from measurements, enter a score.** Typical values are shown for context and labelled, never scored. Fetch with `data-pipeline/02_fetch_real_data.py` (readers in `data-pipeline/sources_listed.py`); the cache is in `data/real/`.

| Group | Earth (60 sites) | Moon (18 sites) | Mars (10 sites) |
|---|---|---|---|
| Terrain (2 km × 2 km, 128 × 128) | **Measured**: Copernicus DEM GLO-30 (ESA Copernicus), all 60 | **Measured**: LRO LOLA gridded DEMs from the NASA PDS Geosciences Node: 20 m polar grids (LDEM_80/85S/N_20M), 30 m (LDEM_75S_30M) and 30 m LDEM_1024 tiles elsewhere, all 18 | **Measured**: MRO HiRISE stereo DTMs (~1 m) from NASA PDS, all 10. Jezero, Oxia Planum and the Phoenix site are covered directly; elsewhere the nearest HiRISE DTM is used and its distance is shown (2-223 km; Hellas, Arsia and Utopia are the farthest) |
| Surface texture | **Derived** from the terrain (texture statistics of the slope grid). A roughness proxy, not radar | Derived | Derived |
| Surface composition | **Measured**: Copernicus Sentinel-2 L2A, cloud- and water-masked (all 60) | Not measured in our data: **not scored** | Not measured in our data: **not scored** |
| Temperatures | **Measured**: MODIS Terra monthly land surface temperature 2023 from NASA Worldview (GIBS), warmest-month day and coldest-month night, decoded from the layer's published colour map (all 60) | **Measured**: LRO Diviner Global Cumulative Product (NASA PDS), bolometric surface temperature by local time in 0.5° bins: daily max, min and swing (all 18) | Not measured in our data: **not scored** |
| Vegetation (bare-ground rule) | **Measured**: MODIS Terra monthly NDVI 2023 from NASA Worldview, greenest month (59 of 60; McMurdo falls back to Sentinel-2) | – | – |
| Sunlight and Earth view | Noon Sun elevation by month (geometry) | **Modelled** for polar sites from the LOLA 120 m polar DEM (PDS): horizons to 90 km, Sun over a lunar day at 12 seasonal points, Earth over its libration range (`04_polar_illumination.py`). Shown, not scored | Sun elevation from latitude |

About the Earth sources: the Copernicus DEM and Sentinel-2 products are the ones the Copernicus Data Space Ecosystem distributes. They are read from their public cloud-optimised mirror because CDSE downloads need a personal login; the data are identical. MODIS LST and NDVI are read from NASA Worldview's imagery service (GIBS) and converted back to values with the colour maps GIBS publishes for each layer (steps of 0.6 K and 0.01 NDVI).

How temperatures are compared when days differ in length: never by clock time. Each world contributes its own daily extremes. For the Moon, Diviner's warmest and coldest values over a full lunar day (about 29.5 Earth days) and the swing between them; for Earth, MODIS Terra's daytime pass (about 10:30 local time) in the warmest month and its night pass (about 22:30) in the coldest month. Each of the three values is standardised over every site that has it measured, so an Earth site scores higher the closer its extremes come to the Moon's. No Earth site comes close to lunar extremes, which is one reason this group carries the smallest weight (15%). The Earth values are taken at satellite pass times, so they are near, not exactly at, the true daily extremes. The hour-by-hour chart in the app is an illustration drawn from these values and is not scored. Mars temperatures are not measured in our data, so Mars scores leave this group out.

## Method

* **Only compared what is measured on both sides.** For each Earth-target pair, a feature is compared only if both values are measured or derived from measurements. Moon pairs compare terrain, texture and temperatures; Mars pairs compare terrain and texture. Composition (and Mars temperature) are shown but not scored.
* Each feature is standardised over the sites that have it measured; per feature, similarity is `exp(-0.55·|Δz|)`; features are averaged into groups; the groups that were compared are blended with weights terrain 0.30, texture 0.30, composition 0.25, temperatures 0.15, renormalised.
* **Bare-ground rule.** The Moon and Mars have no plants and no open water, so the score is multiplied by a factor that is 1 when the site's greenest month has MODIS NDVI ≤ 0.25 and ≤ 20% open water, falling to 0 at NDVI 0.40 or 50% water. A single Sentinel-2 scene was not enough: the Everglades looked bare in one July scene (flooded sawgrass, NDVI 0.19) but its greenest month is 0.46. Results are reported with and without the rule.
* **Score range.** Each score comes with the lowest and highest value it takes if any one compared measurement is left out or any group weight moves by 20%. This is a sensitivity range, not instrument error. (An earlier version showed a "90% conformal band" from a neural-network ensemble trained on formula labels; it was removed because those labels were not real data.)
* **Why this match.** Each compared feature's share of the score is its group weight split over the group's compared features, times its similarity, times the bare-ground factor; the shares add up to the score.
* **Best site per use.** Each of the seven tests uses only the groups that matter for it and that were compared; tests whose physics cannot be reproduced in Earth's air (plume, motor cooling) are ranked on ground similarity but labelled as not transferable. Drilling transfer on the Moon and Mars is marked "partly useful" because target composition is not measured.
* **Low-sun test.** For every Earth site the noon Sun elevation is computed month by month and matched to the target's highest Sun elevation; for the Moon this test is at best partly useful because Earth's sky lights shadows.

## Artemis III regions and the sunlight model

NASA's October 2024 update named nine candidate regions for the first crewed landing, each about 15 × 15 km. NASA's region outlines were not available to us, so `04_polar_illumination.py` searches the area around each region's named feature and picks the best-lit, gentlest 2 km window: Celestra's estimate of a landing spot, not NASA's site; the app says so on every Artemis target. Mons Mouton uses a published landing-site point (LPSC 2025).

The model resamples the LOLA 120 m polar DEM (NASA PDS) onto a 400 m grid reaching 90 km beyond each site, traces horizons in 72 directions allowing for curvature, moves the Sun through a lunar day at 12 points of its ±1.54° seasonal swing and Earth through its libration range, and turns the steepest sunlit incidence into a radiative-balance peak temperature (shown for context; the scored Moon temperatures come from Diviner).

| Region | Sunlit | Earth in view | Modelled peak |
|---|---|---|---|
| Peak near Cabeus B | 58% | 97% | -24 °C |
| Haworth | 88% | 100% | -53 °C |
| Malapert Massif | 84% | 100% | -71 °C |
| Mons Mouton | 25% | 57% | -62 °C |
| Mons Mouton Plateau | 78% | 71% | -56 °C |
| Nobile Rim 1 | 76% | 100% | -62 °C |
| Nobile Rim 2 | 49% | 81% | -45 °C |
| de Gerlache Rim 2 | 91% | 59% | -81 °C |
| Slater Plain | 84% | 57% | -76 °C |

Three older targets were 2022 Artemis candidates dropped from the 2024 list (Peak Near Shackleton, Connecting Ridge, Faustini Rim A); they stay in the app, labelled as dropped.

## AI discovery: searching all of Earth's bare land

The exact score needs a 2 km, 30 m terrain tile per place, so it cannot run everywhere. `data-pipeline/06_ai_discovery.py` makes a whole-planet search possible:

1. **Candidates.** Earth's land on a 0.25° grid (about 28 km), kept where the greenest-month MODIS NDVI is at most 0.25 and the land is not an ice cap (Antarctic cells are kept only where MODIS shows bare rock warming above 0 °C, since MODIS has no Antarctic NDVI): **48,492 cells**. Global MODIS land-surface temperature and NDVI maps come from NASA Worldview (`ai_rasters.py`, decoded with the published colour maps); terrain statistics from the Copernicus DEM GLO-90 (read at about 360 m, for the whole cell and the ~5 km around its centre).
2. **Labels.** The exact Celestra score against all 28 targets, computed with the real pipeline (Copernicus GLO-30 2 km tile plus MODIS) for 3,968 random candidate cells. The probe reproduces the app's scores for named sites to within 0.001.
3. **Model.** A deep ensemble of 7 small neural networks (bootstrapped, PyTorch) learns the 28 scores from the 14 coarse inputs. Split-conformal calibration on 794 held-out cells gives every prediction a 90% interval. On 794 further held-out cells: **coverage 90%** (target 90%), **R² 0.42**, mean absolute error **7 points** (averaged over the 28 targets). R² moves between about 0.35 and 0.6 with the random training sample; the conformal coverage stays at 90%, which is the property the intervals promise.
4. **Sweep and verification.** The ensemble scores every candidate cell. Per target, the 10 cells with the highest lower bound, at least 150 km apart and 50 km from any named site, are re-scored with the exact pipeline. The exact score fell inside the AI's interval for **78%** of the 280 verified candidates (below 90% because the search deliberately picks the most extreme predictions); **62 of 280** verified candidates would rank first among the 60 named sites. (These verification figures use the current scoring, after the Moon terrain fix below; the model itself was trained and calibrated on the scores before that fix, which moved Moon scores slightly.)

What the model learns is Celestra's scoring, not ground truth: it is a fast emulator that makes a global search possible, and every candidate in the app shows its exact score beside the AI estimate. Composition is not part of the search. Candidates are unnamed places, shown by coordinates; access and land status are not checked.

In the app, verified AI finds appear in the ranked list beside the named sites (purple pins and an "AI find" badge, togglable on the globe), with the full analysis tabs, and the simulator can fly them on their real 30 m terrain. Every destination, listed or picked, is ranked against all AI finds on its world (106 for the Moon, 76 for Mars), each scored exactly; the 10 found specifically for a listed destination also show the AI's estimate. The AI model only estimates scores for the 28 listed destinations, so other rows show the exact score alone.

**Limits of the search:** bare land only (NDVI ≤ 0.25; forests, farmland, ocean and ice caps are excluded by design); 0.25° cells, so small outcrops inside green land are missed; composition is not used; no access, permits or land-status check.

## Does the score mean anything?

`python data-pipeline/03_validate.py` (results in `data/processed/validation.json`), over all 28 targets:

| Check | Result |
|---|---|
| 8 negative controls (rainforest, wetland, farmland, polders) | median rank **56.5 of 60**, 100% in the bottom half; the best any control reached is 53. Without the bare-ground rule: median 24, 34% in the bottom half. Terrain, texture and temperature alone cannot tell a flat wetland from a flat Martian plain; the vegetation evidence does |
| 12 agency benchmark analogs (Haughton, Atacama, McMurdo, …) | median rank **25 of 60**, 68% in the top half. Some benchmarks (Ries, Rio Tinto, Lonar-type craters) are small outcrops inside green land at 1 km scale, so the bare-ground rule lowers them; that is a resolution limit, stated rather than tuned away |
| **Baseline**: plain unweighted distance over the same compared features | controls 21, benchmarks 29.5. With the bare-ground rule: controls 56.5, benchmarks 24.5. **Our group weights perform about the same as a plain distance**: the measured features and the bare-ground rule do the work |
| Bare-ground thresholds moved (full score at NDVI 0.20-0.30, zero at 0.35-0.45) | control median stays **56.5** in every setting |
| Weight sensitivity (any one group weight ×0.8 or ×1.2) | keeps on average **4.25 of the top 5** (never fewer than 3) |
| Score range (drop any one measurement, or move any weight 20%) | median width **±2.4 points** |

What this validation cannot show:
* The controls and benchmarks were chosen by us. An independent test would use analog sites ranked by mission teams who did not see our scores.
* The score range shows sensitivity to the choice of measurements and weights, not measurement error of the instruments themselves.
* Moon and Mars surface composition, and Mars temperatures, are not measured in our data, so those groups are left out of Moon and Mars scores rather than filled with typical values.
* Whether a high-ranked site actually gave transferable results in a past campaign is not tested here; that needs campaign reports matched to flight outcomes.
* Texture comes from 2 km elevation tiles, so boulder-scale roughness (what wheels feel) is not seen.

## Limitations

* Moon and Mars surface composition, and Mars temperatures, are not measured in our data and are therefore not scored. LRO Diviner's Christiansen-feature maps (PDS) and Mars spectrometers would close that gap.
* Diviner temperatures are 0.5° bins (about 15 km), coarser than the 2 km terrain tiles; MODIS LST and NDVI are about 1-5 km.
* The sunlight model uses a point Sun, a 90 km horizon and 400 m terrain; published ray-traced maps (Mazarico et al. 2011) are more precise. Our Artemis points are estimates inside each region.
* Mars: for Hellas, Arsia and Utopia the nearest HiRISE DTM is 140-223 km from the nominal point; the app shows the distance.
* Texture comes from 2 km elevation tiles, so it sees ridges and crater walls, not boulders.
* Field-readiness entries list analog history and permits only where documented; everything else is marked "not verified".
* Simulator physics are simplified and tuned for play. Wheel slip and sliding use a Coulomb friction model: gravity and slopes are real, the friction coefficients per world and per rover are assumed, not measured. Hills in the simulator can be drawn taller to make slopes visible (real size by default, switchable to 2× or 3×); the rover and lander physics always use the true slopes. The Heat view is a simple surface-temperature model seeded with the measured range, not a measurement.
* Moon terrain fix: LOLA products coarser than the 15.6 m display grid (the 29.6 m LDEM_1024 tiles and the 30 m south-polar grid) were being upsampled by repeating heights, which drew stair-steps and understated texture variety at flat sites (Aristarchus, Marius Hills, von Kármán). They are now interpolated with a cubic surface through the native heights; the validation above uses the corrected data.
* Registry corrections: the Amazon control was moved from central Manaus to Reserva Ducke; Shackleton rim, Connecting Ridge, Faustini Rim A and Peary rim had been registered at crater centres and were moved onto the named rims (`data/config/relocated_targets.json`); the old Malapert point is replaced by the Artemis III Malapert target.
* Data-source changes in this version: Moon terrain moved from USGS-repackaged LOLA point clouds and JAXA Kaguya DTMs to NASA PDS LOLA gridded DEMs; Mars terrain from USGS CTX DTMs to NASA PDS HiRISE DTMs; Earth temperatures from NASA POWER (air) to MODIS land surface temperature (Worldview); the THEMIS night-IR descriptor and the old neural-network score band (trained on synthetic labels) were removed; the AI discovery ensemble that replaced it learns from exact scores on real data. Everything now comes from the challenge's resource list.

## Run it locally (two terminals)

Backend (FastAPI, port 8000). Python 3.12 recommended:

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1      # Windows PowerShell
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt   # or requirements-run.txt if you do not need "pick any point"
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

If a picked Mars point fails, run `python data-pipeline/diagnose_mars.py <lat> <lon>`. It checks the connection to NASA's HiRISE archive, the nearest terrain models and the read the app makes, with timings, and says which step fails. HiRISE has mapped only small patches of Mars, so a point more than 400 km from every HiRISE terrain model cannot be measured. Mars points are measured one at a time (a second request waits for the first), and every download now times out instead of hanging.

## Deploy (free, one link for judges)

The `Dockerfile` builds the website as static files and serves it from the FastAPI backend, so one container runs everything at a single address, including live "pick any point". It fits a 512 MB free instance (it peaks at about 300 MB while measuring a live point).

**Render (free web service):**
1. Sign in at render.com with GitHub and allow access to this repository.
2. New > Web Service > pick the repository and the branch with this code. Render detects the `Dockerfile` (or use New > Blueprint, which reads `render.yaml`).
3. Instance type **Free**, then Create. The first build takes about 5-10 minutes; the app is then at `https://<service-name>.onrender.com`.

A free instance sleeps after 15 minutes without visitors and takes about a minute to wake on the next visit. Any other Docker host works the same way (the container listens on `$PORT`, default 7860). Local development is unchanged: `npm run dev` and `python backend/main.py` work as before.

## Rebuild the data from source (optional)

```bash
pip install -r requirements.txt
python data-pipeline/04_polar_illumination.py  # ~20 min: sunlight model, places the Artemis III targets
python data-pipeline/02_fetch_real_data.py     # ~5-10 min, cached in data/real/
python data-pipeline/01_fetch_and_extract.py   # features and terrain assets
python data-pipeline/03_validate.py            # controls, benchmarks, baseline, thresholds, weight sensitivity, score range
python data-pipeline/ai_rasters.py             # global MODIS maps from NASA Worldview (~5 min)
python data-pipeline/06_ai_discovery.py        # AI search of all bare land (~5 min; needs torch)
```

## Layout

```
backend/        FastAPI app, terrain assets, simulator physics, field brief, live custom targets
ml_engine/      similarity on measured features only, bare-ground rule, score ranges, per-use rankings
                (the AI discovery model is trained offline in data-pipeline/06_ai_discovery.py; the app reads its results)
data/           site registry, real-data cache (data/real), features, validation results
data-pipeline/  sources_listed.py readers, 04 sunlight + Artemis placement, 02 fetch real data, 01 build features, 03 validate,
                ai_rasters.py global MODIS maps, 06 AI discovery
frontend/       Next.js 16 + React 19 + react-three-fiber
```

## Use of AI

AI (Anthropic's Claude, through Claude Code) was used extensively to write and refactor code: the data pipeline, the frontend, the simulator and this README. The team chose the challenge approach, site registry and scoring design, and reviewed the results. No AI-generated imagery is used; all terrain comes from the instrument products listed above. No NASA or other agency logos are used.

## Credits and data licences

* Original codebase: [reality-hacker/NasaSpace1Try](https://github.com/reality-hacker/NasaSpace1Try).
* Copernicus DEM GLO-30: © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
* Contains modified Copernicus Sentinel data (2022-2023).
* MODIS Terra land surface temperature and NDVI: NASA LP DAAC products, served by NASA Worldview / GIBS (Global Imagery Browse Services).
* LRO LOLA gridded DEMs (LRO-L-LOLA-4-GDR) and LRO Diviner derived products: NASA Planetary Data System, Geosciences Node (Washington University in St. Louis); LOLA team, NASA GSFC; Diviner team, UCLA.
* MRO HiRISE DTMs: NASA/JPL/University of Arizona, NASA Planetary Data System.
* Artemis III regions: NASA, "NASA Provides Update on Artemis III Moon Landing Regions" (October 2024) and the August 2022 announcement; Mons Mouton landing point from LPSC 2025 abstract 2742; Slater Plain location from Wueller et al. 2026 (JGR Planets).
* Functional analogues: Foucher, F. et al. (2021), "Definition and use of functional analogues in planetary exploration", Planetary and Space Science 197, 105162.
* Planet textures in `frontend/public/textures` came with the original codebase; check their licences before redistributing.

**3D models** (in `frontend/public/models`, compressed with glTF-Transform):
* Curiosity rover: NASA 3D Resources (public domain).
* "Mars Polar Lander" by emin31284, https://sketchfab.com/3d-models/mars-polar-lander-8c87cc5b86864b5a8c986d603fda1cef, licensed CC BY 4.0.
* "Sci-Fi Beacon/Way Point Marker Free Model" by AMMediaGames, https://sketchfab.com/3d-models/sci-fi-beaconway-point-marker-free-model-a1d91ebb3e2d41bba31c02b11423d97f, licensed CC BY 4.0.
* "Low Poly Rocks" by Michael Hooper, https://sketchfab.com/3d-models/low-poly-rocks-9823ec262054408dbe26f6ddb9c0406e, licensed CC BY 4.0.
