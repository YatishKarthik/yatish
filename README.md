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

- `frontend/components/WorldPicker.tsx` — the landing screen: two lit, turning worlds. Click one.
- `frontend/components/PlanetGlobe.tsx` — the Moon / Mars / Earth globe. Pins carry hologram tags; selecting a site turns the globe to face it; a light column and footprint mark the selection. Labels are plain DOM projected over the canvas each frame (no portals), so they stay sharp and unmount cleanly.
- `frontend/app/globals.css` — the glass: translucent panes with a bright top edge over a slowly drifting colour field.

The architecture, API, ML engine and simulator are unchanged from the previous release.
