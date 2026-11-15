"""
Fetches the real measurements Celestra is built on and caches them in data/real/<site_id>.json.
Only sources from the challenge's resource list are used:

  Earth  elevation   : Copernicus DEM GLO-30 (ESA Copernicus; the same product as on the Copernicus Data Space
                       Ecosystem, read from its public cloud-optimised mirror because CDSE downloads need a login)
  Earth  spectra     : Copernicus Sentinel-2 L2A surface reflectance (ESA Copernicus; same note as above)
  Earth  temperature : MODIS Terra monthly land surface temperature, NASA Worldview / GIBS
  Moon   elevation   : LRO LOLA gridded DEMs, NASA PDS Geosciences Node
  Moon   temperature : LRO Diviner global cumulative products, NASA PDS Geosciences Node
  Mars   elevation   : MRO HiRISE stereo DTMs, NASA PDS

Each cache file records exactly which product it came from and, where the nearest product does not sit on the
nominal site, how far away it is. Nothing here invents a value: a site with no usable product is written with
"status": "missing".

Run (about 20-30 minutes, mostly network):  python data-pipeline/02_fetch_real_data.py
Then rebuild features:                      python data-pipeline/01_fetch_and_extract.py
"""
import json
import math
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
from scipy.interpolate import griddata

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.img,.IMG,.lbl,.LBL")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "3")
if Path("/root/.ccr/ca-bundle.crt").exists():
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")

import rasterio  # noqa: E402
from rasterio.warp import transform as warp_transform  # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources_listed import lola_terrain, diviner_temps, hirise_terrain, modis_lst  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "data" / "config" / "sites.json").read_text(encoding="utf-8"))
OUT = ROOT / "data" / "real"
OUT.mkdir(parents=True, exist_ok=True)

GRID = 128
EXTENT_M = 2000.0           # every tile covers 2 km x 2 km around the site
S3_S2 = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/"
MOON_R = 1737400.0
MARS_R = 3396190.0


def save(site_id: str, payload: dict) -> None:
    (OUT / f"{site_id}.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def fill_holes(h: np.ndarray) -> float:
    """Fill NaNs by linear then nearest interpolation; return the fraction that was missing."""
    bad = ~np.isfinite(h)
    frac = float(bad.mean())
    if 0 < frac < 1:
        yy, xx = np.mgrid[0:h.shape[0], 0:h.shape[1]]
        pts = np.column_stack([yy[~bad], xx[~bad]])
        vals = h[~bad]
        lin = griddata(pts, vals, (yy, xx), method="linear")
        near = griddata(pts, vals, (yy, xx), method="nearest")
        h[:] = np.where(np.isfinite(lin), lin, near)
    return frac


def reject_spikes(h: np.ndarray) -> None:
    """Treat values far outside the window's own spread as voids (DEM fill values, bad laser returns)."""
    ok = h[np.isfinite(h)]
    if ok.size == 0:
        return
    med = np.median(ok)
    mad = np.median(np.abs(ok - med)) + 1e-6
    h[np.abs(h - med) > max(800.0, 12 * mad)] = np.nan


# ---------------------------------------------------------------- Earth
def copernicus(lat: float, lon: float) -> tuple[np.ndarray, str]:
    ns, ew = ("N" if lat >= 0 else "S"), ("E" if lon >= 0 else "W")
    name = f"Copernicus_DSM_COG_10_{ns}{abs(math.floor(lat)):02d}_00_{ew}{abs(math.floor(lon)):03d}_00_DEM"
    d_lat = EXTENT_M / 2 / 111320.0
    d_lon = d_lat / math.cos(math.radians(lat))
    with rasterio.open(f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif") as ds:
        w = from_bounds(lon - d_lon, lat - d_lat, lon + d_lon, lat + d_lat, ds.transform)
        h = ds.read(1, window=w, out_shape=(GRID, GRID), resampling=rasterio.enums.Resampling.bilinear, boundless=True, fill_value=np.nan).astype(np.float64)
        if ds.nodata is not None:
            h[h == ds.nodata] = np.nan
    return h, name


def mgrs_square(lat: float, lon: float) -> tuple[str, str, str]:
    import mgrs
    m = re.match(r"^(\d+)([A-Z])([A-Z]{2})", mgrs.MGRS().toMGRS(lat, lon, MGRSPrecision=0))
    return str(int(m.group(1))), m.group(2), m.group(3)   # the archive writes zone 5, not 05


def sentinel2(lat: float, lon: float) -> dict:
    """Median surface reflectance indices over the 2 km window from the clearest dry-season scene."""
    months = ["2023/7", "2023/8", "2023/6", "2023/9", "2023/5", "2023/10", "2023/4", "2023/3", "2022/8", "2022/7", "2023/1", "2023/2", "2023/11", "2023/12"]
    if lat < -15:
        months = ["2023/1", "2023/2", "2023/12", "2023/11", "2023/3", "2022/12", "2023/10", "2023/4", "2022/1", "2022/2", "2023/9", "2023/5"]
    elif abs(lat) <= 15:   # tropics: the clearest skies are usually in the dry season, June to October
        months = ["2023/8", "2023/7", "2023/9", "2023/6", "2023/10", "2022/8", "2022/9", "2023/1", "2023/2", "2023/12"]
    # Sentinel-2 tiles overlap at square and zone edges, so look in the squares around the site too
    squares = []
    # ... and across a UTM zone boundary (every 6 degrees of longitude) when the site is near one
    edge = (lon + 180) % 6
    extra = (-(edge + 0.05),) if edge < 0.6 else ((6 - edge + 0.05),) if edge > 5.4 else ()
    for dlat in (0.0, -0.12, 0.12):
        for dlon in (0.0, -0.18, 0.18) + extra:
            try:
                sq = mgrs_square(lat + dlat, lon + dlon)
            except Exception:
                continue
            if sq not in squares:
                squares.append(sq)
    scenes = []
    for zone, band, square in squares:
        # a cap per square, so a neighbouring square whose swaths miss the site cannot crowd out the one that covers it
        mine = []
        for month in months:
            try:
                r = requests.get(f"{S3_S2}?list-type=2&delimiter=/&prefix=sentinel-s2-l2a-cogs/{zone}/{band}/{square}/{month}/", timeout=30)
            except requests.RequestException:
                continue
            mine += re.findall(r"<Prefix>([^<]+_L2A/)</Prefix>", r.text)[:8]
            if len(mine) >= 16:
                break
        scenes += mine[:16]
    if not scenes:
        raise RuntimeError(f"no Sentinel-2 scenes near the site ({', '.join(''.join(q) for q in squares)})")

    ranked = []
    for sc in scenes:
        sid = sc.rstrip("/").split("/")[-1]
        try:
            meta = requests.get(f"{S3_S2}{sc}{sid}.json", timeout=30).json()
            props = meta.get("properties", {})
            ranked.append((props.get("eo:cloud_cover", 100), sc, sid, props))
        except Exception:
            continue
    ranked.sort(key=lambda r: r[0])

    # per-pixel scene classification (SCL): 2 dark surfaces (basalt, lava), 4 vegetation, 5 bare, 6 water, 7 unclassified
    # and 11 snow are usable; 0-1 no data / defective, 3 cloud shadow and 8-10 cloud and cirrus are not
    best = None
    for cloud, sc, sid, props in ranked[:80]:
        try:
            with rasterio.open(f"{S3_S2}{sc}B04.tif") as ds:
                xs, ys = warp_transform("EPSG:4326", ds.crs, [lon], [lat])
                cx, cy = xs[0], ys[0]
            box = (cx - EXTENT_M / 2, cy - EXTENT_M / 2, cx + EXTENT_M / 2, cy + EXTENT_M / 2)
            with rasterio.open(f"{S3_S2}{sc}SCL.tif") as ds:
                scl = ds.read(1, window=from_bounds(*box, ds.transform), out_shape=(64, 64), boundless=True, fill_value=0,
                              resampling=rasterio.enums.Resampling.nearest)
        except Exception:
            continue
        if not scl.any():
            continue        # the swath does not reach the site in this scene
        usable = np.isin(scl, (2, 4, 5, 6, 7, 11))
        clear = float(usable.mean())
        if best is None or clear > best[0]:
            best = (clear, sc, sid, props, box, scl, usable)
        if clear >= 0.85:
            break
    if best is None or best[0] < 0.3:
        raise RuntimeError("no Sentinel-2 scene with enough clear pixels over the site")
    clear, sc, sid, props, box, scl, usable = best
    out = {}
    for b in ["B02", "B04", "B08", "B11", "B12"]:
        with rasterio.open(f"{S3_S2}{sc}{b}.tif") as ds:
            out[b] = ds.read(1, window=from_bounds(*box, ds.transform), out_shape=(64, 64), boundless=True, fill_value=0).astype(np.float64)
    water = scl == 6
    land = usable & ~water & (out["B04"] > 0) & (out["B02"] > 0) & (out["B08"] > 0)
    baseline = str(props.get("s2:processing_baseline", "00.00"))
    offset = 0.0 if props.get("earthsearch:boa_offset_applied") else (1000.0 if baseline >= "04.00" else 0.0)
    refl = {b: np.clip((v - offset) / 10000.0, 1e-4, 1.5) for b, v in out.items()}
    ndvi = (refl["B08"] - refl["B04"]) / (refl["B08"] + refl["B04"])
    albedo = 0.356 * refl["B02"] + 0.130 * refl["B04"] + 0.373 * refl["B08"] + 0.085 * refl["B11"] + 0.072 * refl["B12"] - 0.0018
    rec = {"scene": sid, "cloud_cover_scene": cloud if (cloud := props.get("eo:cloud_cover")) is not None else None,
           "processing_baseline": baseline, "offset_removed": offset,
           "clear_fraction": round(clear, 3), "water_fraction": round(float(water[usable].mean()) if usable.any() else 0.0, 3),
           "land_pixels": int(land.sum()), "scl_rule": 2}
    if land.sum() < 40:
        # the window is (almost) all open water: no land surface to describe
        rec.update({"ndvi": None, "bareness_index": None, "iron_oxide_ratio": None, "clay_hydroxyl_ratio": None, "albedo": None})
        return rec
    med = lambda a: float(np.median(a[land]))
    rec.update({
        "ndvi": round(med(ndvi), 4),
        "bareness_index": round(float(np.clip(1.0 - med(ndvi), 0.0, 1.0)), 4),
        "iron_oxide_ratio": round(med(refl["B04"] / refl["B02"]), 4),
        "clay_hydroxyl_ratio": round(med(refl["B11"] / refl["B12"]), 4),
        "albedo": round(float(np.clip(med(albedo), 0.0, 1.0)), 4),
    })
    return rec
    raise RuntimeError("no Sentinel-2 scene with a clear, full window")


def fetch_earth(site: dict) -> None:
    sid = site["id"]
    f = OUT / f"{sid}.json"
    if f.exists():
        rec = json.loads(f.read_text())
        if rec.get("spectra", {}).get("scl_rule") == 2:
            if "MODIS" not in rec.get("climate", {}).get("source", ""):
                try:
                    rec["climate"] = modis_lst(float(site["lat"]), float(site["lon"]))
                except Exception as e:
                    rec["climate"] = {"status": "missing", "error": str(e)[:200]}
                save(sid, rec)
                c = rec["climate"]
                print(f"earth {sid}: MODIS LST {c.get('temp_min_c')}..{c.get('temp_max_c')} C" if "temp_max_c" in c else f"earth {sid}: LST missing ({c.get('error')})", flush=True)
            return
        try:   # older cache: redo only the spectra, now with cloud and water masking
            rec["spectra"] = {"dataset": "Sentinel-2 L2A", **sentinel2(float(site["lat"]), float(site["lon"]))}
        except Exception as e:
            rec["spectra"] = {"status": "missing", "error": str(e)[:200]}
        save(sid, rec)
        sp = rec["spectra"]
        print(f"earth {sid}: spectra {'ndvi %.2f clear %.0f%% water %.0f%%' % (sp['ndvi'], 100 * sp['clear_fraction'], 100 * sp['water_fraction']) if sp.get('ndvi') is not None else sp.get('error', 'water only')}", flush=True)
        return
    lat, lon = float(site["lat"]), float(site["lon"])
    rec = {"id": sid, "body": "earth", "lat": lat, "lon": lon, "extent_m": EXTENT_M, "grid": GRID}
    try:
        h, name = copernicus(lat, lon)
        reject_spikes(h)
        rec["dem_hole_fraction"] = round(fill_holes(h), 4)
        rec["heights_m"] = np.round(h, 1).ravel().tolist()
        rec["dem"] = {"dataset": "Copernicus DEM GLO-30", "product": name, "native_res_m": 30, "offset_km": 0.0}
    except Exception as e:
        rec["dem"] = {"status": "missing", "error": str(e)[:200]}
    try:
        rec["spectra"] = {"dataset": "Sentinel-2 L2A", **sentinel2(lat, lon)}
    except Exception as e:
        rec["spectra"] = {"status": "missing", "error": str(e)[:200]}
    try:
        rec["climate"] = modis_lst(lat, lon)
    except Exception as e:
        rec["climate"] = {"status": "missing", "error": str(e)[:200]}
    save(sid, rec)
    print(f"earth {sid}: dem={'ok' if 'heights_m' in rec else 'MISSING'} s2={'ok' if 'ndvi' in rec['spectra'] else 'MISSING'} power={'ok' if 'temp_max_c' in rec['climate'] else 'MISSING'}", flush=True)


# ---------------------------------------------------------------- Moon (LOLA GDR + Diviner) and Mars (HiRISE), all NASA PDS
def _finish_dem(rec: dict, h: np.ndarray, meta: dict) -> None:
    reject_spikes(h)
    holes = fill_holes(h)
    rec["heights_m"] = np.round(h, 1).ravel().tolist()
    rec["dem"] = {**meta, "hole_fraction": round(holes, 3)}


def fetch_moon(site: dict) -> None:
    sid = site["id"]
    f = OUT / f"{sid}.json"
    # cached Moon terrain is reused only if it was read with interpolation (older caches drew stair-steps)
    if f.exists() and "bicubic" in json.loads(f.read_text()).get("dem", {}).get("resampling", ""):
        return
    lat, lon = float(site["lat"]), float(site["lon"])
    rec = {"id": sid, "body": "moon", "lat": lat, "lon": lon, "extent_m": EXTENT_M, "grid": GRID}
    try:
        h, meta = lola_terrain(lat, lon, EXTENT_M, GRID)
        _finish_dem(rec, h, meta)
    except Exception as e:
        rec["dem"] = {"status": "missing", "error": str(e)[:200]}
    try:
        rec["climate"] = diviner_temps(lat, lon)
    except Exception as e:
        rec["climate"] = {"status": "missing", "error": str(e)[:200]}
    save(sid, rec)
    c = rec["climate"]
    print(f"moon {sid}: {rec['dem'].get('product', 'DEM MISSING')} · Diviner {c.get('temp_min_c')}..{c.get('temp_max_c')} C", flush=True)


def fetch_mars(site: dict) -> None:
    sid = site["id"]
    f = OUT / f"{sid}.json"
    if f.exists() and "HiRISE" in json.loads(f.read_text()).get("dem", {}).get("dataset", ""):
        return
    lat, lon = float(site["lat"]), float(site["lon"])
    rec = {"id": sid, "body": "mars", "lat": lat, "lon": lon, "extent_m": EXTENT_M, "grid": GRID}
    try:
        h, meta = hirise_terrain(lat, lon, EXTENT_M, GRID)
        _finish_dem(rec, h, meta)
    except Exception as e:
        rec["dem"] = {"status": "missing", "error": str(e)[:400]}
    save(sid, rec)
    print(f"mars {sid}: {rec['dem'].get('product', 'MISSING')} ({rec['dem'].get('offset_km', '?')} km from the nominal site)", flush=True)


def great_circle_km(lat1, lon1, lat2, lon2, r_km):
    a = math.sin(math.radians(lat1)) * math.sin(math.radians(lat2)) + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(math.radians(lon1 - lon2))
    return r_km * math.acos(max(-1.0, min(1.0, a)))


fetch_moon_any = fetch_moon   # kept for the live custom-target endpoint


def main() -> None:
    only = set(sys.argv[1:])
    t0 = time.time()
    pick = lambda xs: [s for s in xs if not only or s["id"] in only]
    earth = pick(CONFIG["earth_analogs"])
    moon = pick([t for t in CONFIG["targets"] if t["body"] == "moon"])
    mars = pick([t for t in CONFIG["targets"] if t["body"] == "mars"])
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(fetch_earth, earth))
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(fetch_mars, mars))
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(fetch_moon, moon))
    print(f"done in {time.time() - t0:.0f} s; cache in {OUT}")


if __name__ == "__main__":
    main()
