"""
Fetches the real measurements Celestra is built on and caches them in data/real/<site_id>.json.

  Earth  elevation  : Copernicus DEM GLO-30 (ESA)            copernicus-dem-30m on AWS Open Data
  Earth  spectra    : Sentinel-2 L2A surface reflectance (ESA) sentinel-cogs on AWS Open Data
  Earth  climate    : NASA POWER climatology (MERRA-2 2 m air temperature)  power.larc.nasa.gov
  Moon   elevation  : NASA LRO LOLA altimeter returns (RDR), gridded here    astrogeo-ard on AWS (USGS)
  Moon   elevation  : USGS Kaguya TC stereo DTMs (JAXA SELENE) where one covers a low-latitude site
  Mars   elevation  : USGS CTX stereo DTMs (NASA MRO)          astrogeo-ard on AWS (USGS)

Each cache file records exactly which product it came from and, where the nearest available product does
not sit on the nominal site, how far away it is. Nothing here invents a value: a site with no usable product
is written with "status": "missing" and the extractor keeps it out of the real-data claims.

Run once (about 15-25 minutes, mostly network):  python data-pipeline/02_fetch_real_data.py
Then rebuild features:                         python data-pipeline/01_fetch_and_extract.py
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
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "3")
if Path("/root/.ccr/ca-bundle.crt").exists():
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")

import rasterio  # noqa: E402
from rasterio.warp import transform as warp_transform  # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "data" / "config" / "sites.json").read_text(encoding="utf-8"))
OUT = ROOT / "data" / "real"
OUT.mkdir(parents=True, exist_ok=True)

GRID = 128
EXTENT_M = 2000.0           # every tile covers 2 km x 2 km around the site
S3_ARD = "https://astrogeo-ard.s3-us-west-2.amazonaws.com/"
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
    for dlat in (0.0, -0.12, 0.12):
        for dlon in (0.0, -0.18, 0.18):
            try:
                sq = mgrs_square(lat + dlat, lon + dlon)
            except Exception:
                continue
            if sq not in squares:
                squares.append(sq)
    scenes = []
    for zone, band, square in squares:
        for month in months:
            r = requests.get(f"{S3_S2}?list-type=2&delimiter=/&prefix=sentinel-s2-l2a-cogs/{zone}/{band}/{square}/{month}/", timeout=30)
            found = re.findall(r"<Prefix>([^<]+_L2A/)</Prefix>", r.text)
            scenes += found[:8]
            if len(scenes) >= 40:
                break
        if len(scenes) >= 40:
            break
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
    for cloud, sc, sid, props in ranked[:30]:
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


def nasa_power(lat: float, lon: float) -> dict:
    """Typical temperatures from NASA POWER climatology. In this product T2M_MAX/T2M_MIN are record extremes,
    so typical daily highs and lows are taken as the monthly mean plus or minus half the mean daily range."""
    url = ("https://power.larc.nasa.gov/api/temporal/climatology/point"
           f"?parameters=T2M,T2M_RANGE&community=RE&longitude={lon:.4f}&latitude={lat:.4f}&format=JSON")
    p = requests.get(url, timeout=60).json()["properties"]["parameter"]
    t, rg = p["T2M"], p["T2M_RANGE"]
    months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    highs = {m: t[m] + rg[m] / 2 for m in months}
    lows = {m: t[m] - rg[m] / 2 for m in months}
    return {
        "dataset": "NASA POWER climatology (MERRA-2), 2 m air temperature",
        "temp_max_c": round(max(highs.values()), 1),   # typical daily high in the warmest month
        "temp_min_c": round(min(lows.values()), 1),    # typical daily low in the coldest month
        "temp_delta_c": round(float(rg["ANN"]), 1),    # annual mean day-night range
        "annual_mean_c": round(float(t["ANN"]), 1),
    }


def fetch_earth(site: dict) -> None:
    sid = site["id"]
    f = OUT / f"{sid}.json"
    if f.exists():
        rec = json.loads(f.read_text())
        if rec.get("spectra", {}).get("scl_rule") == 2:
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
        rec["climate"] = nasa_power(lat, lon)
    except Exception as e:
        rec["climate"] = {"status": "missing", "error": str(e)[:200]}
    save(sid, rec)
    print(f"earth {sid}: dem={'ok' if 'heights_m' in rec else 'MISSING'} s2={'ok' if 'ndvi' in rec['spectra'] else 'MISSING'} power={'ok' if 'temp_max_c' in rec['climate'] else 'MISSING'}", flush=True)


# ---------------------------------------------------------------- Moon: LOLA altimeter returns gridded to 128 x 128
def lola_tiles(lat: float, lon: float) -> list[str]:
    lon360 = lon % 360.0
    band_lo = int(math.floor(lat / 15.0) * 15)
    band = f"{band_lo}N{band_lo + 15}N"
    if abs(lat) > 88.5:     # near the pole the 2 km window spans many longitudes
        lons = range(0, 360, 15)
    else:
        span = math.degrees(EXTENT_M / (MOON_R * max(math.cos(math.radians(lat)), 0.02)))
        lons = sorted({int(math.floor(((lon360 + d) % 360) / 15.0) * 15) for d in (-span, 0, span)})
    return [f"{S3_ARD}moon/lro/lola/LolaRDR_{band}_{l}E{l + 15}E.copc.laz" for l in lons]


def fetch_moon(site: dict) -> None:
    import laspy
    from laspy.copc import Bounds
    sid = site["id"]
    if (OUT / f"{sid}.json").exists():
        return
    lat, lon = float(site["lat"]), float(site["lon"])
    la, lo = math.radians(lat), math.radians(lon)
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.cross(up, east)
    c0 = up * MOON_R
    half = EXTENT_M / 2
    corners = [c0 + east * sx * half + north * sy * half for sx in (-1, 1) for sy in (-1, 1)]
    corners = [p * f for p in corners for f in ((MOON_R - 12000) / MOON_R, (MOON_R + 12000) / MOON_R)]
    mins, maxs = np.min(corners, axis=0), np.max(corners, axis=0)
    xs, ys, hs, used = [], [], [], []
    for url in lola_tiles(lat, lon):
        try:
            with laspy.CopcReader.open(url) as r:
                hm, hx = r.header.mins, r.header.maxs
                if np.any(hx < mins) or np.any(hm > maxs):
                    continue
                pts = r.query(bounds=Bounds(mins=mins, maxs=maxs))
                if len(pts) == 0:
                    continue
                p = np.column_stack([np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z)])
                d = p - c0
                e, n = d @ east, d @ north
                keep = (np.abs(e) <= half) & (np.abs(n) <= half)
                xs.append(e[keep]); ys.append(n[keep]); hs.append(np.linalg.norm(p[keep], axis=1) - MOON_R)
                used.append(url.rsplit("/", 1)[-1])
        except Exception as ex:
            print(f"  {sid}: {url.rsplit('/', 1)[-1]} {str(ex)[:80]}", flush=True)
    rec = {"id": sid, "body": "moon", "lat": lat, "lon": lon, "extent_m": EXTENT_M, "grid": GRID}
    if not xs or sum(len(a) for a in xs) < 300:
        rec["dem"] = {"status": "missing", "error": "too few LOLA returns in the window"}
        save(sid, rec); print(f"moon {sid}: MISSING", flush=True); return
    e, n, hgt = np.concatenate(xs), np.concatenate(ys), np.concatenate(hs)
    med = np.median(hgt); mad = np.median(np.abs(hgt - med)) + 1e-6
    ok = np.abs(hgt - med) < max(1500.0, 15 * mad)
    e, n, hgt = e[ok], n[ok], hgt[ok]
    # bin to the grid (row 0 = north edge, like the image-based tiles), then interpolate between ground tracks
    col = np.clip(((e + half) / EXTENT_M * GRID).astype(int), 0, GRID - 1)
    row = np.clip(((half - n) / EXTENT_M * GRID).astype(int), 0, GRID - 1)
    s = np.zeros((GRID, GRID)); c = np.zeros((GRID, GRID))
    np.add.at(s, (row, col), hgt); np.add.at(c, (row, col), 1)
    grid = np.where(c > 0, s / np.maximum(c, 1), np.nan)
    filled = fill_holes(grid)
    rec["heights_m"] = np.round(grid, 1).ravel().tolist()
    rec["dem"] = {"dataset": "LRO LOLA altimeter returns (RDR), gridded", "products": used, "points": int(len(hgt)),
                  "cells_with_returns": round(1 - filled, 3), "native_res_m": "~25 m spots along tracks", "offset_km": 0.0}
    save(sid, rec)
    print(f"moon {sid}: {len(hgt)} LOLA returns, {100 * (1 - filled):.0f}% of cells measured", flush=True)


# ---------------------------------------------------------------- Mars (CTX) and low-latitude Moon (Kaguya TC): stereo DTMs
def list_prefixes(prefix: str, cache_name: str) -> list[str]:
    path = OUT.parent / "raw" / cache_name
    if not path.exists():
        lines, token = [], ""
        while True:
            q = f"{S3_ARD}?list-type=2&delimiter=/&prefix={prefix}&max-keys=1000" + (f"&continuation-token={requests.utils.quote(token)}" if token else "")
            r = requests.get(q, timeout=60).text
            lines += re.findall(r"<Prefix>([^<]+/)</Prefix>", r)
            m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", r)
            if not m:
                break
            token = m.group(1)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines))
    return [p for p in path.read_text().split() if "__" in p]


def great_circle_km(lat1, lon1, lat2, lon2, r_km):
    a = math.sin(math.radians(lat1)) * math.sin(math.radians(lat2)) + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(math.radians(lon1 - lon2))
    return r_km * math.acos(max(-1.0, min(1.0, a)))


def ctx_candidates(lat: float, lon: float) -> list[tuple[float, str]]:
    out = []
    for p in list_prefixes("mars/mro/ctx/controlled/usgs/", "ctx_dirs.txt"):
        m = re.search(r"_(\d{2})([NS])(\d{3})([EW])", p)
        if m:
            plat = int(m.group(1)) * (1 if m.group(2) == "N" else -1)
            plon = int(m.group(3)) * (1 if m.group(4) == "E" else -1)
            out.append((great_circle_km(lat, lon, plat, plon, MARS_R / 1000), p))
    return sorted(out)[:40]


def tc_candidates(lat: float, lon: float) -> list[tuple[float, str]]:
    out = []
    for p in list_prefixes("moon/kaguya/terrain_camera/usgs_dtms/", "tc_dirs.txt"):
        # TC1W2B0_01_02633N677E0608: orbit 02633, latitude 67.7 N, longitude 060.8 E
        m = re.search(r"_\d{5}([NS])(\d{3})E(\d{4})", p)
        if m:
            plat = int(m.group(2)) / 10 * (1 if m.group(1) == "N" else -1)
            plon = int(m.group(3)) / 10
            plon = plon - 360 if plon > 180 else plon
            out.append((great_circle_km(lat, lon, plat, plon, MOON_R / 1000), p))
    return sorted(out)[:40]


def dtm_urls(prefix: str) -> list[str]:
    name = prefix.rstrip("/").split("/")[-1]
    # three naming schemes are in use across the CTX and Kaguya archives
    return [f"{S3_ARD}{prefix}{name}{suffix}" for suffix in ("_dtm.tif", "-DEM-geoid-adj.tif", "-DEM.tif", "_ba-aligned-DEM.tif")]


def window_from_dtm(url: str, lat: float, lon: float) -> tuple | None:
    """A clean 2 km window from an equirectangular sphere DTM. If the site itself is off the strip or on its
    ragged edge, the window moves to the nearest place where the strip is fully covered, and says how far."""
    from pyproj import CRS
    from scipy.ndimage import distance_transform_edt
    with rasterio.open(url) as ds:
        crs = CRS.from_wkt(ds.crs.to_wkt())
        if "polar" in crs.name.lower() or "stereographic" in crs.to_wkt().lower():
            return None
        R = crs.ellipsoid.semi_major_metre
        half = EXTENT_M / 2
        kx = half / math.cos(math.radians(lat))
        cx, cy = R * math.radians(lon), R * math.radians(lat)
        b = ds.bounds
        turn = 2 * math.pi * R
        cx -= turn * round((cx - (b.left + b.right) / 2) / turn)   # the copy of the site's longitude nearest the strip
        if b.right - b.left < 2 * kx or b.top - b.bottom < 2 * half:
            return None

        def read(nx, ny):
            w = from_bounds(nx - kx, ny - half, nx + kx, ny + half, ds.transform)
            h = ds.read(1, window=w, out_shape=(GRID, GRID), resampling=rasterio.enums.Resampling.bilinear, boundless=True, fill_value=np.nan).astype(np.float64)
            if ds.nodata is not None:
                h[h == ds.nodata] = np.nan
            h[h < -2e4] = np.nan
            reject_spikes(h)
            return h

        h = read(cx, cy) if (b.left + kx <= cx <= b.right - kx and b.bottom + half <= cy <= b.top - half) else None
        nx, ny = cx, cy
        if h is None or np.mean(~np.isfinite(h)) > 0.15:
            # coarse validity mask of the whole strip, shrunk by the window size, then the nearest good cell
            f = max(1, int(max(ds.width, ds.height) / 900))
            cw, ch = max(8, ds.width // f), max(8, ds.height // f)
            ov = ds.read(1, out_shape=(ch, cw), resampling=rasterio.enums.Resampling.nearest).astype(np.float64)
            ok = np.isfinite(ov) & (ov > -2e4)
            if ds.nodata is not None:
                ok &= ov != ds.nodata
            px = (b.right - b.left) / cw
            rad = int(math.ceil(kx * 1.15 / px))
            ok = distance_transform_edt(np.pad(ok, 1))[1:-1, 1:-1] > rad * 1.42   # far enough inside the strip
            del ov
            if not ok.any():
                return None
            rows, cols = np.nonzero(ok)
            xs = b.left + (cols + 0.5) * px
            ys = b.top - (rows + 0.5) * (b.top - b.bottom) / ch
            i = int(np.argmin(((xs - cx) * math.cos(math.radians(lat))) ** 2 + (ys - cy) ** 2))
            nx, ny = float(xs[i]), float(ys[i])
            h = read(nx, ny)
            if np.mean(~np.isfinite(h)) > 0.15:
                return None
        off_km = math.hypot((nx - cx) * math.cos(math.radians(lat)), ny - cy) / 1000
        return off_km, h, float(ds.res[0]), (round(math.degrees(ny / R), 3), round(((math.degrees(nx / R) + 540) % 360) - 180, 3))


def best_dtm(candidates: list[tuple[float, str]], lat: float, lon: float) -> tuple | None:
    best = None
    for _, prefix in candidates:
        for url in dtm_urls(prefix):
            try:
                got = window_from_dtm(url, lat, lon)
            except Exception:
                continue
            if got is None:
                break       # the file opened but does not give a clean window
            if not best or got[0] < best[0]:
                best = (got[0], prefix.rstrip("/").split("/")[-1], got[1], got[2], got[3])
            break
        if best and best[0] < 0.5:
            break
    return best


def fetch_mars(site: dict) -> None:
    sid = site["id"]
    if (OUT / f"{sid}.json").exists() and "heights_m" in json.loads((OUT / f"{sid}.json").read_text()):
        return
    lat, lon = float(site["lat"]), float(site["lon"])
    best = best_dtm(ctx_candidates(lat, lon), lat, lon)
    rec = {"id": sid, "body": "mars", "lat": lat, "lon": lon, "extent_m": EXTENT_M, "grid": GRID}
    if not best:
        rec["dem"] = {"status": "missing", "error": "no CTX DTM gives a clean 2 km window near the site"}
        save(sid, rec); print(f"mars {sid}: MISSING", flush=True); return
    off, name, h, res, centre = best
    holes = fill_holes(h)
    rec["heights_m"] = np.round(h, 1).ravel().tolist()
    rec["dem"] = {"dataset": "USGS CTX stereo DTM (NASA MRO)", "product": name, "native_res_m": round(res, 1),
                  "offset_km": round(off, 1), "window_centre": {"lat": centre[0], "lon": centre[1]}, "hole_fraction": round(holes, 3)}
    save(sid, rec)
    print(f"mars {sid}: {name} ({off:.1f} km from the nominal site)", flush=True)


def fetch_moon_any(site: dict) -> None:
    """Kaguya stereo DTM where one exists (better than sparse LOLA tracks away from the poles); LOLA otherwise."""
    sid = site["id"]
    if (OUT / f"{sid}.json").exists():
        rec = json.loads((OUT / f"{sid}.json").read_text())
        if rec.get("dem", {}).get("dataset", "").startswith("USGS Kaguya") or rec.get("dem", {}).get("cells_with_returns", 0) >= 0.25:
            return
    lat, lon = float(site["lat"]), float(site["lon"])
    if abs(lat) < 76:
        best = best_dtm(tc_candidates(lat, lon), lat, lon)
        if best and best[0] <= 30:
            off, name, h, res, centre = best
            holes = fill_holes(h)
            rec = {"id": sid, "body": "moon", "lat": lat, "lon": lon, "extent_m": EXTENT_M, "grid": GRID,
                   "heights_m": np.round(h, 1).ravel().tolist(),
                   "dem": {"dataset": "USGS Kaguya TC stereo DTM (JAXA SELENE)", "product": name, "native_res_m": round(res, 1),
                           "offset_km": round(off, 1), "window_centre": {"lat": centre[0], "lon": centre[1]}, "hole_fraction": round(holes, 3)}}
            save(sid, rec)
            print(f"moon {sid}: Kaguya {name} ({off:.1f} km from the nominal site)", flush=True)
            return
    (OUT / f"{sid}.json").unlink(missing_ok=True)
    fetch_moon(site)


def main() -> None:
    only = set(sys.argv[1:])
    t0 = time.time()
    pick = lambda xs: [s for s in xs if not only or s["id"] in only]
    earth = pick(CONFIG["earth_analogs"])
    moon = pick([t for t in CONFIG["targets"] if t["body"] == "moon"])
    mars = pick([t for t in CONFIG["targets"] if t["body"] == "mars"])
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(fetch_earth, earth))
    with ThreadPoolExecutor(max_workers=2) as ex:
        list(ex.map(fetch_mars, mars))
    with ThreadPoolExecutor(max_workers=2) as ex:
        list(ex.map(fetch_moon_any, moon))
    print(f"done in {time.time() - t0:.0f} s; cache in {OUT}")


if __name__ == "__main__":
    main()
