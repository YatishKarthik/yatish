# Space Apps submission kit

Everything below matches the numbers in `data/processed/validation.json` and the README. If you re-run the pipeline, update the figures.

## Project name
Celestra

## High-level summary (for the project page, ~150 words)
Before hardware goes to the Moon or Mars it is tested on Earth, but choosing where is mostly expert judgement. Celestra ranks 60 Earth sites against 20 proposed Moon and Mars base sites using measured data: terrain from Copernicus DEM, LRO LOLA, Kaguya and MRO CTX stereo models; surface composition from Sentinel-2; climate from NASA POWER. Fourteen features are compared into a 0–100 score with a calibrated uncertainty band, and a bare-ground rule removes vegetated or flooded sites, which the Moon and Mars never have. For six common hardware tests the app says whether each Earth site is a good, partial or poor stand-in, and why. We checked the score: unsuitable control sites rank at a median of 56.5 of 60 and agency benchmark analogs at 23. Finally, anyone can fly the same land-drive-drill mission on both worlds and see what Earth testing cannot capture.

## Demo: 7 slides
1. **The problem.** Hardware is proven on Earth first; analog sites are picked by experience, case by case. One picture: a rover in a desert next to the same rover on Mars.
2. **What Celestra does.** Pick a Moon or Mars base site → ranked Earth sites → what each can and cannot test → fly the mission on both worlds. Screenshot of the solar-system picker and the results page.
3. **Real data, labelled.** The data table from the README: measured terrain for all 80 sites (Copernicus, LOLA, Kaguya, CTX), Sentinel-2 composition and NASA POWER climate for Earth; Moon/Mars composition and temperatures are typical values, and the app says so on every number.
4. **How the score works.** 14 features → standardised → four groups weighted 30/30/25/15 → bare-ground rule → 7-model ensemble with 90% conformal band. One diagram.
5. **Does it work?** Controls median rank 56.5/60 (34 without the bare-ground rule: terrain alone cannot tell a wetland from a Martian plain). Benchmarks median 23. Top 5 stable under ±20% weight changes. Example: Shackleton rim → McMurdo Dry Valleys, Etna ash slopes, Tabernas.
6. **What transfers and what does not.** The Tests tab for one pair: traction and landing stability transfer, plume behaviour and motor cooling never do in 1 bar air. Then the mission: same rover, Earth score vs Moon score.
7. **Limits and next steps.** Moon/Mars composition and temperatures are typical values → add Diviner, THEMIS/TES, M3/CRISM. Texture from 2 km tiles → add radar (Mini-RF, SHARAD) and rover-scale imagery. Validate against analog campaigns that later flew.

## Demo: 30-second video (shot list)
| Time | Screen | Voice-over |
|---|---|---|
| 0–4 s | Solar-system picker, click Mars | "Before anything flies to Mars, it's tested on Earth. But where?" |
| 4–9 s | Mars globe, click Jezero, *Find Earth sites* | "Pick a base site. Celestra compares it with 60 places on Earth." |
| 9–15 s | Results summary, Earth globe turning to #1 | "Using real terrain from LOLA, CTX and Copernicus, Sentinel-2 and NASA POWER, every number labelled with its source." |
| 15–20 s | Tests tab, green and red rows | "It says what each site can stand in for, and what it can't." |
| 20–27 s | Simulator: landing, then the rover grabbing a rock | "Then fly the same mission on Earth and on Mars." |
| 27–30 s | Two scores side by side | "The gap is what Earth testing misses. Celestra." |

Record at 1920×1080 in dark mode; the app's walkthrough can stay off for the recording.

## NASA data used
* LRO LOLA altimeter returns (RDR), via USGS Astrogeology cloud-optimised point clouds: Moon terrain.
* MRO CTX stereo DTMs (NASA/JPL/MSSS, USGS): Mars terrain.
* NASA POWER climatology (MERRA-2): Earth temperatures.

## Space agency partner data used
* ESA Copernicus DEM GLO-30: Earth terrain.
* ESA Copernicus Sentinel-2 L2A: Earth surface composition, vegetation and water.
* JAXA SELENE (Kaguya) Terrain Camera DTMs, via USGS: Moon terrain at Marius Hills, Aristarchus and Von Kármán.

## Use of AI (paste into the form)
We used Anthropic's Claude (through Claude Code) extensively to write and refactor code: the data-fetching pipeline, feature extraction, validation script, web frontend, 3D simulator and documentation. Team members chose the approach, site registry and scoring design, reviewed the outputs and verified results by running the pipeline. No AI-generated images, video or audio are used; all terrain and measurements come from the instrument products listed. No NASA or agency logos appear in the project.

## References
* Copernicus DEM GLO-30, ESA/Airbus, via AWS Open Data (copernicus-dem-30m).
* Sentinel-2 L2A COGs, Element 84 / AWS Open Data (sentinel-cogs).
* NASA POWER API, power.larc.nasa.gov.
* USGS Astrogeology analysis-ready data on AWS (astrogeo-ard): LOLA RDR COPC, CTX DTMs, Kaguya TC DTMs.
* Smith et al., LOLA instrument papers; Malin et al., CTX; Haruyama et al., Kaguya TC (cite in slide 3 footer).
