import sys
from pathlib import Path
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ml_engine.engine import PlanetaryAnalogEngine
from backend.sim_physics import DualPhysicsSimulator

app = FastAPI(
    title="TERRA-TWIN Planetary Analog API",
    description="Uncertainty-Aware Multi-Agency Planetary Analog Finder & Dual Simulator Backend",
    version="2.1.0",
)

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


@app.get("/")
def root():
    return {"system": "TERRA-TWIN v2.1", "status": "operational"}


@app.get("/api/targets")
def get_targets():
    targets = ml_engine.config.get("targets", [])
    return {"count": len(targets), "targets": targets}


@app.get("/api/match/{target_id}")
def match_target_site(target_id: str, top_k: int = 60):
    try:
        return ml_engine.match(target_id, top_k=top_k)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)