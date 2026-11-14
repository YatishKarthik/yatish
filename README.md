# TERRA-TWIN

Multi-agency planetary analog finder and dual-world simulator. Pick a base site on the Moon or Mars, rank 60 Earth test sites against it with a deep ensemble + conformal prediction, and run the same hardware test on both worlds.

## Run it locally (two terminals)

Backend (FastAPI on port 8000):

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows PowerShell
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
python backend/main.py
```

Frontend (Next.js on port 3000):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The page tells you if the backend is not reachable and offers a Retry.

## Layout

```
backend/        FastAPI app, static DEM/SAR tiles, dual physics simulator
ml_engine/      14-parameter similarity, 7-model deep ensemble with 90 % conformal intervals
data/           site registry (data/config/sites.json) and processed tiles
data-pipeline/  scripts that fetched and processed the agency data
frontend/       Next.js 16 + React 19 + react-three-fiber UI
```

## UI notes

- `frontend/components/SystemPicker.tsx` — landing screen: a small solar system with a lit sun, Earth and Moon, and Mars; hover for a short dossier, click the Moon or Mars (or the buttons) and the camera flies in.
- `frontend/components/PlanetGlobe.tsx` — the Moon / Mars / Earth globe with hologram tags; selecting a site turns the globe to face it.
- `frontend/components/AnalyticsView.tsx` — results. Summary first, in plain words; Tests, Best site per test, Day & night, Measurements (all 14 values explained) and an Expert view for the uncertainty maths and data sources.
- `frontend/components/DualSimulator.tsx` — one mission per world: land on the pad, roll the rover off and drive five waypoints, grab flagged rocks with the claw (hold E, release in the green), dock at two stations (F) and drill a core (hold E, release to cool). A score out of 235 compares the Earth run with the destination run. Terrain heights are the sites' real elevation data; surface textures are procedural.
- `frontend/components/Tutorial.tsx` — the "?" walkthrough: user-paced cards that point at each control on the current screen.
- `frontend/components/ui.tsx` — light/dark theme toggle, tabs, status words, plain-language helpers.
- `frontend/app/globals.css` — theme tokens for both modes and the glass panels.

The architecture, API, ML engine, physics backend and data are unchanged from the previous release.
