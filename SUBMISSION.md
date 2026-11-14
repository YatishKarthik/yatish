# Space Apps submission kit

Everything below matches the numbers in `data/processed/validation.json` and the README. If you re-run the pipeline, update the figures.

## Project name
Celestra

## High-level summary (for the project page, ~150 words)
Before hardware goes to the Moon or Mars it is tested on Earth, but choosing where is mostly expert judgement. Celestra ranks 60 Earth sites against NASA's nine Artemis III candidate regions, nine other Moon sites and ten Mars sites, using measured data: terrain from Copernicus DEM, LRO LOLA, Kaguya and MRO CTX; composition from Sentinel-2; climate from NASA POWER. Because an analog is only useful for a particular test, it ranks the best Earth site for each of seven hardware tests and says plainly when Earth physics cannot stand in. A horizon model on LOLA terrain gives sunlight, Earth visibility and peak temperature at each polar site, and chose our landing point inside each Artemis region. Every score is broken down by measurement, and every value says where it came from. We tested it honestly: unsuitable control sites rank at a median of 56.5 of 60, and a plain distance does as well as our weights. Anyone can also click any point on the Moon or Mars and get a live ranking.

## Demo: 7 slides
1. **The problem.** Hardware is proven on Earth first; analog sites are picked by experience, case by case. Artemis III will land at one of nine south-pole regions. Which Earth site should each rover, lander and drill be tested at?
2. **What Celestra does.** Pick an Artemis III region (or any point) → ranked Earth sites → best site *per test* → plan the campaign (season, low-sun months, permits) → fly the mission on both worlds. Screenshot: Moon globe with the amber Artemis pins, then the By Use tab.
3. **Real data, labelled.** The README data table. Measured terrain for all 88 sites, Sentinel-2 and NASA POWER for all 60 Earth sites, THEMIS night IR for Mars. Composition on the Moon and Mars is typical for the rock class, and the app says so on every number.
4. **Sunlight at the pole.** Our LOLA horizon model: Sun and Earth visibility, never-lit ground, modelled peak temperature. Check against Malapert's summit (86% sunlit). Table of the nine regions. Our point inside each region is an estimate; NASA's outline was not available.
5. **How the score works, and why each match.** 14 features → standardised → four groups → bare-ground rule. The "Why this match" bars for one pair. Terrain Twins: the two 2 km patches side by side.
6. **Does it work? (honest version).** Controls median 56.5/60 (33 without the bare-ground rule). Benchmarks median 22. A plain unweighted distance does as well as our weights, so the strength is the measured features and the rule, not our tuning. Thresholds and weights moved: results hold. What this cannot show yet.
7. **What transfers, and next steps.** By Use: traction and landing transfer; plume and motor cooling never do in 1 bar air; low-sun camera tests only in certain months. Next: Diviner/TES temperatures, M3/CRISM composition, NASA region outlines, validation against campaigns that later flew.

## Demo: 30-second video (shot list)
| Time | Screen | Voice-over |
|---|---|---|
| 0–4 s | Moon globe, amber Artemis III pins at the south pole | "NASA has nine candidate regions for the first crewed Moon landing." |
| 4–9 s | Click "Artemis III: Malapert Massif", sunlight strip | "Celestra models their sunlight from real laser-altimeter terrain..." |
| 9–15 s | By Use tab, pick "Drilling", top 5 Earth sites | "...and finds the best place on Earth to test each piece of hardware, not just one overall match." |
| 15–20 s | Why This Match bars, Terrain Twins | "Every score shows which measurements carry it, side by side at the same scale." |
| 20–25 s | Click bare ground on Mars, live result | "Pick any point on the Moon or Mars and it fetches the terrain live." |
| 25–30 s | Field Brief PDF, then the simulator landing | "Then plan the field campaign, and fly the mission on both worlds. Celestra." |

Record at 1920×1080 in dark mode; the app's walkthrough can stay off for the recording.

## NASA data used
* LRO LOLA altimeter returns (RDR), via USGS Astrogeology cloud-optimised point clouds: Moon terrain.
* MRO CTX stereo DTMs (NASA/JPL/MSSS, USGS): Mars terrain.
* NASA POWER climatology (MERRA-2): Earth temperatures.
* Mars Odyssey THEMIS night-IR controlled mosaics (NASA/JPL/ASU, USGS): Mars night-time surface character.
* NASA Artemis III candidate landing regions (October 2024 update): Moon targets.

## Space agency partner data used
* ESA Copernicus DEM GLO-30: Earth terrain.
* ESA Copernicus Sentinel-2 L2A: Earth surface composition, vegetation and water.
* JAXA SELENE (Kaguya) Terrain Camera DTMs, via USGS: Moon terrain at Marius Hills, Aristarchus and Von Kármán.

## Use of AI (paste into the form)
We used Anthropic's Claude (through Claude Code) extensively to write and refactor code: the data-fetching pipeline, sunlight model, feature extraction, validation script, web frontend, 3D simulator and documentation. Team members chose the approach, site registry and scoring design, reviewed the outputs and verified results by running the pipeline. No AI-generated images, video or audio are used; all terrain and measurements come from the instrument products listed. No NASA or agency logos appear in the project.

## References
* Copernicus DEM GLO-30, ESA/Airbus, via AWS Open Data (copernicus-dem-30m).
* Sentinel-2 L2A COGs, Element 84 / AWS Open Data (sentinel-cogs).
* NASA POWER API, power.larc.nasa.gov.
* USGS Astrogeology analysis-ready data on AWS (astrogeo-ard): LOLA RDR COPC, CTX DTMs, Kaguya TC DTMs.
* Smith et al., LOLA instrument papers; Malin et al., CTX; Haruyama et al., Kaguya TC (cite in slide 3 footer).
* NASA (Oct 2024), "NASA Provides Update on Artemis III Moon Landing Regions"; NASA (Aug 2022), "NASA Identifies Candidate Regions for Landing Next Americans on Moon".
* Foucher, F. et al. (2021), Definition and use of functional analogues in planetary exploration, Planetary and Space Science 197, 105162.
* Mazarico, E. et al. (2011), Illumination conditions of the lunar polar regions using LOLA topography, Icarus 211 (for comparison with our simpler model).
* ESA, Catalogue of Planetary Analogues (field-readiness criteria: infrastructure, legal access, local contact).
