# Space Apps submission kit

Everything below matches the numbers in `data/processed/validation.json` and the README. If you re-run the pipeline, update the figures.

## Project name
Celestra

## High-level summary (for the project page, ~150 words)
Before hardware goes to the Moon or Mars it is tested on Earth, but choosing where is mostly expert judgement. Celestra ranks 60 named Earth sites (plus places its AI search found) against NASA's nine Artemis III candidate regions, nine other Moon sites and ten Mars sites using only the challenge's listed resources: LRO LOLA terrain and Diviner temperatures and MRO HiRISE terrain from NASA PDS; MODIS land-surface temperature and vegetation from NASA Worldview; Copernicus DEM and Sentinel-2 from ESA. A measurement is compared only when it exists for both sites, so nothing typical or invented enters a score. Because an analog is only useful for a particular test, Celestra ranks the best Earth site for each of seven hardware tests and says when Earth physics cannot stand in. It models sunlight at the lunar poles from LOLA, explains every score, and lets you fly the same mission on both worlds. An AI search then went beyond the list: a deep ensemble with conformal confidence intervals scanned 48,492 cells of Earth's bare land and found unnamed places, every one re-checked with real data. Checked honestly: all eight unsuitable control sites rank in the bottom half for every target.

## Demo: 8 slides
1. **The problem.** Hardware is proven on Earth first; analog sites are picked by experience, case by case. Artemis III will land at one of nine south-pole regions. Which Earth site should each rover, lander and drill be tested at?
2. **What Celestra does.** Pick an Artemis III region (or any point) → ranked Earth sites → best site *per test* → plan the campaign (season, low-sun months, permits) → fly the mission on both worlds. Screenshot: Moon globe with the amber Artemis pins, then the By Use tab.
3. **Real data, only from the listed resources.** The README data table: PDS LOLA, Diviner and HiRISE; Worldview MODIS LST and NDVI; Copernicus DEM and Sentinel-2. Composition on the Moon and Mars, and Mars temperatures, are not measured in our data, so they are shown but not scored.
4. **Sunlight at the pole.** Our LOLA horizon model: Sun and Earth visibility, never-lit ground, modelled peak temperature. Malapert Massif comes out 84% sunlit with Earth always in view. Table of the nine regions. Our point inside each region is an estimate; NASA's outline was not available.
5. **How the score works, and why each match.** 14 features → standardised → four groups → bare-ground rule. The "Why this match" bars for one pair. Terrain Twins: the two 2 km patches side by side.
6. **Does it work? (honest version).** All 8 unsuitable controls rank in the bottom half for every target (median 56.5/60; 24 without the bare-ground rule). Agency benchmarks median 25. A plain unweighted distance performs about the same as our weights, so the strength is the measured data and the bare-ground rule. Thresholds and weights moved: results hold. What this cannot show yet.
7. **AI discovery.** A 7-network deep ensemble learned our score from global MODIS and Copernicus data, searched 48,492 bare-land cells, and gave each estimate a conformal 90% interval (coverage 90% on held-out cells, R² 0.42, typical error 7 points). Every candidate is re-scored exactly; 62 of 280 would beat every named site, and they appear in the ranked list and can be flown in the simulator.
8. **What transfers, and next steps.** By Use: traction and landing transfer; plume and motor cooling never do in 1 bar air; low-sun camera tests only in certain months. Next: Mars temperatures (TES/THEMIS), Moon and Mars composition (Diviner Christiansen feature, M3, CRISM), NASA region outlines, validation against campaigns that later flew.

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
* LRO LOLA gridded DEMs (LRO-L-LOLA-4-GDR), NASA PDS Geosciences Node: Moon terrain and the polar sunlight model.
* LRO Diviner Global Cumulative Products, NASA PDS Geosciences Node: Moon surface temperatures.
* MRO HiRISE stereo DTMs, NASA PDS: Mars terrain.
* MODIS Terra monthly land surface temperature and NDVI, NASA Worldview (GIBS): Earth surface temperatures and vegetation.
* NASA Artemis III candidate landing regions (October 2024 update): Moon targets.

## Space agency partner data used
* ESA Copernicus DEM GLO-30 (the Copernicus Data Space Ecosystem product, read from its public mirror): Earth terrain.
* ESA Copernicus Sentinel-2 L2A (same note): Earth surface composition and open water.

## Use of AI (paste into the form)
We used Anthropic's Claude (through Claude Code) extensively to write and refactor code: the data-fetching pipeline, sunlight model, AI discovery model, feature extraction, validation script, web frontend, 3D simulator and documentation. Team members chose the approach, site registry and scoring design, reviewed the outputs and verified results by running the pipeline. No AI-generated images, video or audio are used; all terrain and measurements come from the instrument products listed. No NASA or agency logos appear in the project.

## References
* NASA PDS Geosciences Node: LRO LOLA GDR (Smith et al., LOLA team, NASA GSFC) and LRO Diviner derived products (Paige et al.; Williams et al. global cumulative products).
* NASA PDS / HiRISE team, University of Arizona: HiRISE DTMs (McEwen et al.).
* NASA Worldview / GIBS: MODIS Terra L3 monthly land surface temperature and NDVI layers, with their published colour maps.
* Copernicus DEM GLO-30 and Copernicus Sentinel-2 L2A (ESA / Copernicus Data Space Ecosystem).
* NASA (Oct 2024), "NASA Provides Update on Artemis III Moon Landing Regions"; NASA (Aug 2022), "NASA Identifies Candidate Regions for Landing Next Americans on Moon".
* Foucher, F. et al. (2021), Definition and use of functional analogues in planetary exploration, Planetary and Space Science 197, 105162.
* Mazarico, E. et al. (2011), Illumination conditions of the lunar polar regions using LOLA topography, Icarus 211 (for comparison with our simpler model).
* ESA, Catalogue of Planetary Analogues (field-readiness criteria: infrastructure, legal access, local contact).
