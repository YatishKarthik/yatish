import sys
from pathlib import Path
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml_engine.engine import PlanetaryAnalogEngine
from backend.sim_physics import DualPhysicsSimulator

app = FastAPI(
    title="Celestra Planetary Analog API",
    description="Planetary analog finder and dual-world simulator backend",
    version="2.1.0",
)

# results are up to ~2 MB of JSON: compress them for the deployed site
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = ROOT / "backend" / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

print("Initializing Planetary Analog Engine & Dual Physics Simulator...")
ml_engine = PlanetaryAnalogEngine()
sim_engine = DualPhysicsSimulator()
print("Backend v2.1 ready!")


class SimRequest(BaseModel):
    target_id: str
    earth_id: str
    scenario: str


@app.get("/api/status")
def root():
    return {"system": "Celestra v2.2", "status": "operational"}


@app.get("/api/targets")
def get_targets():
    targets = ml_engine.config.get("targets", [])
    return {"count": len(targets), "targets": targets}


@app.get("/api/match/{target_id}")
def match_target_site(target_id: str, top_k: int = 60, include_ai: bool = False):
    try:
        return ml_engine.match(target_id, top_k=top_k, include_ai=include_ai)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/validation")
def get_validation():
    """Results of data-pipeline/03_validate.py: controls, benchmarks, baseline, sensitivity, score range."""
    import json
    path = ROOT / "data" / "processed" / "validation.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Run data-pipeline/03_validate.py first.")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/brief/{target_id}", response_class=HTMLResponse)
def field_brief(target_id: str):
    """Printable one-page field-campaign brief (browser Print > Save as PDF)."""
    import json
    from backend.brief import render
    try:
        res = ml_engine.match(target_id, top_k=10)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    path = ROOT / "data" / "processed" / "validation.json"
    val = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    return render(res, val)


_discoveries = {"mtime": None, "data": None}


@app.get("/api/discoveries/{target_id}")
def ai_discoveries(target_id: str):
    """AI-discovered candidate analog sites (data-pipeline/06_ai_discovery.py): deep-ensemble estimate with a
    split-conformal 90% interval, and the exact Celestra score of each candidate."""
    import json
    path = ROOT / "data" / "processed" / "discoveries.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="No AI discoveries yet: run data-pipeline/06_ai_discovery.py.")
    mt = path.stat().st_mtime
    if _discoveries["mtime"] != mt:
        _discoveries["data"], _discoveries["mtime"] = json.loads(path.read_text(encoding="utf-8")), mt
    d = _discoveries["data"]
    tids = list(d["targets"].keys())
    if target_id not in d["targets"]:
        raise HTTPException(status_code=404, detail="No AI discoveries for this target.")
    k = tids.index(target_id)
    met = d["metrics"]
    return {
        "method": d["method"], "inputs": d["inputs"], "cells_searched": d["cells_searched"], "cell_deg": d["cell_deg"],
        "model": {"n_train": met["n_train"], "n_calibration": met["n_calibration"], "n_test": met["n_test"],
                  "coverage": met["coverage_per_target"][k], "r2": met["r2_per_target"][k], "mae": met["mae_per_target"][k],
                  "coverage_mean": round(sum(met["coverage_per_target"]) / len(tids), 3), "r2_mean": round(sum(met["r2_per_target"]) / len(tids), 3)},
        "verification": d.get("verification"),
        "candidates": d["targets"][target_id],
    }


# Live points are measured one at a time: each needs up to ~300 MB while its terrain is processed, so on a 512 MB
# server two at once could run out of memory. Others wait their turn (the page shows a timer).
import threading  # noqa: E402
_CUSTOM_LOCK = threading.Lock()


@app.get("/api/custom_target")
def custom_target(body: str, lat: float, lon: float, top_k: int = 60):
    """Rank Earth sites for any Moon or Mars point: terrain fetched live from NASA PDS (LOLA / HiRISE), 10-90 s."""
    from backend import custom_target as ct
    ok, why = ct.available()
    if not ok:
        raise HTTPException(status_code=501, detail=why)
    if not _CUSTOM_LOCK.acquire(timeout=170):
        raise HTTPException(status_code=503, detail="Other visitors are measuring points right now. Please try again in a minute.")
    try:
        return ct.match_custom(ml_engine, body, lat, lon, top_k)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LookupError as e:
        msg = str(e)
        if "too slowly" in msg or "timed out" in msg.lower() or "curl" in msg.lower():
            # a slow or unreachable archive is not the same as missing data: say which it is
            raise HTTPException(status_code=504, detail=f"NASA's archive did not answer in time, so this point could not be measured yet (the data does exist). Try again in a moment. ({msg[:160]})")
        raise HTTPException(status_code=404, detail=f"No elevation data near this point: {msg}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:300])
    finally:
        _CUSTOM_LOCK.release()


@app.post("/api/simulate")
def simulate_dual(req: SimRequest):
    try:
        return sim_engine.run_dual(req.target_id, req.earth_id, req.scenario)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"Site ID not found: {e}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Deployed build: the exported website (frontend/out) is served from the same address as the API, so the site can
# use relative URLs and judges open a single link. Mounted last so every /api and /static route above wins.
WEB_DIR = ROOT / "frontend" / "out"
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
else:
    @app.get("/")
    def root_status():
        return root()


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)