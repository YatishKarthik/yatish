"""
Rank Earth sites for any point on the Moon or Mars.

The terrain is fetched live with the same code as the data pipeline (LRO LOLA gridded DEMs for the Moon, HiRISE
DTMs for Mars, both from NASA PDS), turned into the same features, and matched against the 60 Earth sites. On the
Moon, Diviner gives the measured temperature range. Anything not measured (composition everywhere, temperatures on
Mars) is left out of the score, not filled in.

Needs the pipeline packages (pip install -r requirements.txt); without them the endpoint says so.
"""
import importlib.util
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
_mods = {}


def _load(name: str, file: str):
    if name not in _mods:
        spec = importlib.util.spec_from_file_location(name, ROOT / "data-pipeline" / file)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _mods[name] = mod
    return _mods[name]


def available() -> tuple[bool, str]:
    try:
        import rasterio, skimage, pyproj, PIL  # noqa: F401
        return True, ""
    except Exception as e:
        return False, f"Custom targets need the data-pipeline packages: pip install -r requirements.txt ({e})"


def _gc_km(lat1, lon1, lat2, lon2, r_km):
    a = math.sin(math.radians(lat1)) * math.sin(math.radians(lat2)) + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(math.radians(lon1 - lon2))
    return r_km * math.acos(max(-1.0, min(1.0, a)))


def build_target(engine, body: str, lat: float, lon: float) -> tuple[dict, dict, dict]:
    if body not in ("moon", "mars"):
        raise ValueError("body must be moon or mars")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("latitude must be -90..90 and longitude -180..180")
    fetch = _load("celestra_fetch", "02_fetch_real_data.py")
    extract = _load("celestra_extract", "01_fetch_and_extract.py")

    sid = f"custom_{body}_{lat:.3f}_{lon:.3f}".replace(".", "p").replace("-", "m")
    r_km = 1737.4 if body == "moon" else 3396.19
    peers = [t for t in engine.config["targets"] if t["body"] == body]
    nearest = min(peers, key=lambda t: _gc_km(lat, lon, t["lat"], t["lon"], r_km))
    near_km = _gc_km(lat, lon, nearest["lat"], nearest["lon"], r_km)
    site = {"id": sid, "name": f"Custom point {abs(lat):.2f}°{'N' if lat >= 0 else 'S'} {abs(lon):.2f}°{'E' if lon >= 0 else 'W'}",
            "body": body, "lat": lat, "lon": lon, "type": "target",
            "elevation_m": 0, "gravity_m_s2": 1.62 if body == "moon" else 3.72, "pressure_bar": 0.0 if body == "moon" else 0.006,
            "morphology": nearest["morphology"], "mineral_profile": nearest["mineral_profile"], "frost": nearest.get("frost", 0.0)}

    import time as _time
    t0 = _time.time()
    if body == "moon":
        fetch.fetch_moon_any(site)
    else:
        fetch.fetch_mars(site)
    real = extract.load_real(sid)
    hm = extract.to_heightmap(real)
    # one line per request in the backend window, so a failing point can be diagnosed
    print(f"[custom {body}] {lat:.3f}, {lon:.3f}: {'ok' if hm is not None else 'FAILED'} in {_time.time() - t0:.0f} s"
          + ("" if hm is not None else f" ({real.get('dem', {}).get('error', 'no product')})"), flush=True)
    if hm is None:
        raise LookupError(real.get("dem", {}).get("error", "no elevation product covers this point"))
    heightmap, relief = hm
    topo = extract.describe_dem(body, real["dem"])

    clim = real.get("climate", {})
    if body == "moon" and "temp_max_c" in clim:
        tmin, tmax, delta = clim["temp_min_c"], clim["temp_max_c"], clim["temp_delta_c"]
        therm = {"agency": "NASA", "instrument": f"LRO Diviner bolometric surface temperature ({clim.get('product', '')}, NASA PDS)", "status": "measured"}
    else:
        tmin, tmax, delta = float(nearest["temp_min_c"]), float(nearest["temp_max_c"]), None
        therm = {"agency": "none", "instrument": "No measured temperature here; not scored", "status": "typical"}
    prov = {"topography": topo,
            "radar": {"agency": topo["agency"], "instrument": "Texture statistics of the slope grid (terrain-roughness proxy, not radar)", "status": "derived"},
            "mineral": {"agency": "none", "instrument": "Composition not measured here; not scored", "status": "typical"},
            "thermal": therm,
            "curve": {"agency": "none", "instrument": "Sine-based day-night model between the low and high", "status": "modelled"}}
    elev = np.asarray(real["heights_m"], float)
    site["elevation_m"] = float(np.nanmedian(elev))
    row = extract.compute_features(site, heightmap, relief, 2000.0 / extract.GRID_RES, tmin, tmax, site["frost"], prov, None, delta)
    row["water_fraction"] = 0.0

    asset = ROOT / "backend" / "static" / "assets" / f"{sid}_dem.json"
    asset.write_text(json.dumps({"site_id": sid, "name": site["name"], "body": body, "resolution": extract.GRID_RES, "extent_m": 2000,
                                 "relief_m": round(relief, 1), "data_provenance": prov, "diurnal_sol_curve": row["diurnal_sol_curve"],
                                 "data": np.round(heightmap.flatten(), 4).tolist()}), encoding="utf-8")
    off = real["dem"].get("offset_km", 0.0)
    meta = {"primary_challenge": (f"A point you picked. Terrain is measured ({topo['instrument']}"
                                  + (f", nearest product {off:.0f} km away" if off and off >= 1 else "") +
                                  f"). " + ("Temperatures are measured by LRO Diviner; composition is not measured, so it is left out of the score." if body == "moon" else "Composition and temperatures are not measured here, so only terrain and surface texture are scored.")),
            "recommended_hardware_test": nearest.get("recommended_hardware_test", "")}
    extras = {"artemis": None, "illumination": None, "night_ir": None, "custom": {"nearest_target": nearest["name"], "nearest_km": round(near_km, 1), "terrain_offset_km": off},
              "max_sun_elevation_deg": round(min(90.0, 90 - abs(lat) + (1.54 if body == "moon" else 25.2)), 1)}
    return row, meta, extras


def match_custom(engine, body: str, lat: float, lon: float, top_k: int = 60) -> dict:
    row, meta, extras = build_target(engine, body, lat, lon)
    return engine.match_row(row, meta, engine.normalise(row), top_k, extras, extra_rows=engine.ai_pool_rows(body))
