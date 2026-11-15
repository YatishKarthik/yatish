"""
Builds the 14 features per site from the real-data cache (data/real, written by 02_fetch_real_data.py).

Every value carries a status:
  measured      read directly from an instrument product (Copernicus DEM, Sentinel-2, MODIS LST and NDVI, LRO LOLA, LRO Diviner, MRO HiRISE)
  derived       computed from measured data (slope and texture statistics from the elevation grid)
  modelled      produced by a simple physical model (the 24-hour temperature curve)
  typical       a representative value for the site's rock class or a published temperature range, not measured here
  procedural    no data product covered the site, so a shape model stands in; never presented as data
"""
import json
import math
import hashlib
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.ndimage import gaussian_filter, sobel
from skimage.feature import graycomatrix, graycoprops

ROOT = Path(__file__).resolve().parent.parent
REAL_DIR = ROOT / "data" / "real"   # written by 02_fetch_real_data.py
CONFIG_PATH = ROOT / "data" / "config" / "sites.json"
OUT_PROCESSED = ROOT / "data" / "processed"
OUT_ASSETS = ROOT / "backend" / "static" / "assets"

OUT_PROCESSED.mkdir(parents=True, exist_ok=True)
OUT_ASSETS.mkdir(parents=True, exist_ok=True)

GRID_RES = 128


def stable_seed(site_id: str) -> int:
    return int(hashlib.md5(site_id.encode("utf-8")).hexdigest()[:8], 16)


def generate_planetary_mesh(site: dict) -> tuple[np.ndarray, float]:
    """Fallback only: a procedural shape model of the site's landform class, used when no elevation product covers it."""
    site_id = site["id"]
    morph = site.get("morphology", "flat_plain")
    rng = np.random.default_rng(stable_seed(site_id))

    x = np.linspace(-1, 1, GRID_RES)
    y = np.linspace(-1, 1, GRID_RES)
    xx, yy = np.meshgrid(x, y)
    r = np.sqrt(xx**2 + yy**2)

    noise = np.zeros((GRID_RES, GRID_RES))
    for scale, weight in [(3, 1.0), (7, 0.45), (15, 0.22), (31, 0.10)]:
        px, py = rng.uniform(0, 2 * np.pi), rng.uniform(0, 2 * np.pi)
        nx = np.sin(scale * xx * np.pi + px) * np.cos(scale * yy * np.pi + py)
        noise += weight * gaussian_filter(nx + rng.normal(0, 0.14, (GRID_RES, GRID_RES)), sigma=1.1)

    if morph == "crater_rim":
        rim = np.exp(-((r - 0.58) ** 2) / 0.028) * 2.4
        bowl = -np.clip(1.0 - (r / 0.58) ** 2, 0, 1) * 3.6
        mesh = rim + bowl + noise * 0.45
        relief_m = float(rng.uniform(260, 420))
    elif morph == "crater_bowl":
        rim = np.exp(-((r - 0.72) ** 2) / 0.03) * 1.8
        bowl = -np.clip(1.0 - (r / 0.72) ** 2, 0, 1) * 4.0
        mesh = rim + bowl + noise * 0.35
        relief_m = float(rng.uniform(280, 440))
    elif morph == "ridge_massif":
        ang = rng.uniform(-0.8, 0.8)
        rot_x = xx * np.cos(ang) - yy * np.sin(ang)
        mesh = np.exp(-(rot_x ** 2) / 0.12) * 3.6 + noise * 0.75
        relief_m = float(rng.uniform(240, 410))
    elif morph == "saddle_ridge":
        mesh = (xx ** 2 - yy ** 2) * 2.2 + noise * 0.55
        relief_m = float(rng.uniform(200, 340))
    elif morph == "canyon_steep":
        mesh = -np.exp(-((xx * 1.4 + yy * 0.3) ** 2) / 0.08) * 3.8 + noise * 0.65
        relief_m = float(rng.uniform(320, 460))
    elif morph == "delta_fan":
        fan = np.exp(-((xx + 0.35) ** 2 + (yy ** 2) * 0.7) / 0.35) * 1.8
        channels = np.sin(yy * 14.0 + xx * 4.0) * 0.25 * np.clip(1.0 - xx, 0, 1.5)
        mesh = fan + channels + noise * 0.30 - (xx * 1.1)
        relief_m = float(rng.uniform(110, 210))
    elif morph == "lava_pit":
        mesh = -np.exp(-((xx - 0.1) ** 2 + (yy + 0.1) ** 2) / 0.045) * 4.2 + noise * 0.85
        relief_m = float(rng.uniform(160, 280))
    elif morph == "lava_channel":
        rille = -np.exp(-((yy - 0.28 * np.sin(xx * 3.5)) ** 2) / 0.03) * 2.6
        mesh = rille + noise * 0.80
        relief_m = float(rng.uniform(140, 250))
    elif morph == "polygon_plain":
        mesh = noise * 0.16 + (np.sin(18 * xx) * np.sin(18 * yy)) * 0.15
        relief_m = float(rng.uniform(25, 55))
    else:
        mesh = noise * 0.18
        relief_m = float(rng.uniform(20, 45))

    norm = (mesh - mesh.min()) / (mesh.max() - mesh.min() + 1e-8)
    return norm, relief_m


def mineral_values(profile: str, rng: np.random.Generator) -> tuple[float, float, float, float]:
    """Representative surface values for a rock class (used where no Sentinel-2 measurement exists, and for the Moon and Mars)."""
    jitter = lambda s: 0.0   # class means only; no invented scatter
    if profile == "biomass_wet":
        return (
            float(np.clip(0.03 + jitter(0.015), 0.01, 0.10)),
            float(np.clip(0.25 + jitter(0.05), 0.10, 0.40)),
            float(np.clip(0.18 + jitter(0.04), 0.05, 0.35)),
            float(np.clip(0.13 + jitter(0.02), 0.05, 0.22)),
        )
    if profile == "mare_basalt":
        return (
            float(np.clip(0.99 + jitter(0.005), 0.96, 1.0)),
            float(np.clip(1.30 + jitter(0.06), 1.10, 1.50)),
            float(np.clip(0.16 + jitter(0.04), 0.08, 0.28)),
            float(np.clip(0.11 + jitter(0.02), 0.07, 0.18)),
        )
    if profile == "basalt_anorthosite":
        return (
            float(np.clip(0.99 + jitter(0.005), 0.96, 1.0)),
            float(np.clip(1.05 + jitter(0.05), 0.90, 1.25)),
            float(np.clip(0.22 + jitter(0.04), 0.12, 0.35)),
            float(np.clip(0.19 + jitter(0.03), 0.12, 0.28)),
        )
    if profile == "anorthosite":
        return (
            1.0,
            float(np.clip(0.75 + jitter(0.05), 0.60, 0.92)),
            float(np.clip(0.15 + jitter(0.03), 0.08, 0.25)),
            float(np.clip(0.32 + jitter(0.04), 0.22, 0.45)),
        )
    if profile in ("regolith_ice", "basalt_ice"):
        return (
            float(np.clip(0.97 + jitter(0.01), 0.92, 1.0)),
            float(np.clip(0.88 + jitter(0.06), 0.72, 1.05)),
            float(np.clip(0.42 + jitter(0.05), 0.28, 0.58)),
            float(np.clip(0.40 + jitter(0.05), 0.28, 0.55)),
        )
    if profile == "clay_carbonate":
        return (
            float(np.clip(0.98 + jitter(0.01), 0.94, 1.0)),
            float(np.clip(1.22 + jitter(0.06), 1.05, 1.40)),
            float(np.clip(0.84 + jitter(0.05), 0.70, 0.96)),
            float(np.clip(0.24 + jitter(0.03), 0.16, 0.34)),
        )
    if profile == "sulfate_clay":
        return (
            float(np.clip(0.98 + jitter(0.01), 0.94, 1.0)),
            float(np.clip(1.38 + jitter(0.06), 1.20, 1.55)),
            float(np.clip(0.78 + jitter(0.05), 0.65, 0.92)),
            float(np.clip(0.27 + jitter(0.03), 0.18, 0.36)),
        )
    if profile == "evaporite_sulfate":
        return (
            float(np.clip(0.98 + jitter(0.01), 0.94, 1.0)),
            float(np.clip(0.55 + jitter(0.06), 0.38, 0.75)),
            float(np.clip(0.88 + jitter(0.04), 0.75, 0.98)),
            float(np.clip(0.68 + jitter(0.05), 0.52, 0.82)),
        )
    if profile == "iron_sand":
        return (
            float(np.clip(0.98 + jitter(0.01), 0.94, 1.0)),
            float(np.clip(1.42 + jitter(0.06), 1.25, 1.60)),
            float(np.clip(0.32 + jitter(0.05), 0.20, 0.45)),
            float(np.clip(0.30 + jitter(0.03), 0.22, 0.38)),
        )
    return (0.95, 0.95, 0.40, 0.25)


def generate_diurnal_sol_curve(tmin: float, tmax: float, body: str) -> list[float]:
    """Generates a 24-hour diurnal thermal sol curve (hour 00:00 to 23:00) modeling solar insolation & radiative night."""
    curve = []
    delta = tmax - tmin
    for hour in range(24):
        # Solar cycle: minimum around 05:00, maximum around 14:00
        solar_phase = math.sin((hour - 8.5) / 24.0 * 2.0 * math.pi)
        norm_temp = 0.5 + 0.5 * solar_phase
        # In space vacuum (Moon/Mars), nighttime drops steeper due to radiative cooling
        if body != "earth" and norm_temp < 0.35:
            norm_temp = math.pow(norm_temp, 1.35)
        val = tmin + delta * norm_temp
        curve.append(round(val, 1))
    return curve


def compute_features(site: dict, heightmap: np.ndarray, relief_m: float, pixel_m: float, tmin: float, tmax: float, frost: float, provenance: dict, surface: tuple | None = None, delta: float | None = None) -> dict:
    rng = np.random.default_rng(stable_seed(site["id"]) + 99)
    body = site.get("body", "earth")
    elev_m = heightmap * relief_m

    # Pillar 1: Topography, from the elevation grid
    dx = sobel(elev_m, axis=1) / (8.0 * pixel_m)
    dy = sobel(elev_m, axis=0) / (8.0 * pixel_m)
    slope_deg = np.degrees(np.arctan(np.sqrt(dx ** 2 + dy ** 2)))

    slope_mean = float(np.mean(slope_deg))
    slope_p90 = float(np.percentile(slope_deg, 90))
    tri = float(np.std(elev_m))
    concavity = float(np.mean(sobel(dx, axis=1) + sobel(dy, axis=0)))

    # Pillar 2: Surface texture. A grey-level co-occurrence texture of the slope image; a terrain-roughness proxy,
    # not radar. (The column names keep the sar_ prefix so the API stays stable.)
    grad_norm = ((slope_deg / (slope_deg.max() + 1e-6)) * 255).astype(np.uint8)
    glcm = graycomatrix(grad_norm, distances=[1], angles=[0, np.pi / 4], levels=256, symmetric=True, normed=True)
    sar_entropy = float(-np.sum(glcm * np.log(glcm + 1e-12)))
    sar_contrast = float(graycoprops(glcm, "contrast")[0, 0])
    sar_backscatter = float(np.clip((tri / 160.0) + (sar_contrast / 750.0), 0.05, 0.96))

    # Pillar 3: Surface composition. Measured Sentinel-2 indices where available, else class-typical values
    bareness, iron_ratio, clay_ratio, albedo = surface if surface is not None else mineral_values(site.get("mineral_profile", "mare_basalt"), rng)

    # Pillar 4: Temperatures. MODIS land surface temperature (Earth), LRO Diviner (Moon); Mars not measured (not scored)
    pressure = float(site.get("pressure_bar", 1.013))
    gravity = float(site.get("gravity_m_s2", 9.81))
    diurnal_curve = generate_diurnal_sol_curve(tmin, tmax, body)

    return {
        "site_id": site["id"],
        "name": site["name"],
        "body": body,
        "type": site.get("type", "target"),
        "lat": float(site["lat"]),
        "lon": float(site["lon"]),
        "elevation_m": float(site.get("elevation_m", 0)),
        "morphology": site.get("morphology", "flat_plain"),
        "mineral_profile": site.get("mineral_profile", "mare_basalt"),
        "gravity_m_s2": gravity,
        "pressure_bar": pressure,
        # 14 Scored Physics Parameters
        "slope_mean": round(slope_mean, 3),
        "slope_p90": round(slope_p90, 3),
        "tri_ruggedness": round(tri, 3),
        "concavity": round(concavity, 4),
        "sar_backscatter": round(sar_backscatter, 3),
        "sar_entropy": round(sar_entropy, 3),
        "sar_contrast": round(sar_contrast, 3),
        "bareness_index": round(bareness, 3),
        "iron_oxide_ratio": round(iron_ratio, 3),
        "clay_hydroxyl_ratio": round(clay_ratio, 3),
        "albedo": round(albedo, 3),
        "temp_min_c": round(tmin, 1),
        "temp_max_c": round(tmax, 1),
        "temp_delta_c": round(delta if delta is not None else tmax - tmin, 1),
        "frost_persistence": round(frost, 3),
        "atm_convection_factor": round(pressure / 1.013, 4),
        # 24-Hour Diurnal Sol Thermal Curve
        "diurnal_sol_curve": diurnal_curve,
        # Where every group of values came from, with its status
        "provenance": provenance,
    }


def load_real(site_id: str) -> dict:
    f = REAL_DIR / f"{site_id}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def to_heightmap(real: dict) -> tuple[np.ndarray, float] | None:
    h = real.get("heights_m")
    if not h:
        return None
    elev = np.asarray(h, dtype=np.float64).reshape(GRID_RES, GRID_RES)
    # no smoothing: only isolated spikes (bad pixels) are replaced by the local median
    from scipy.ndimage import median_filter
    med = median_filter(elev, size=3)
    dev = elev - med
    mad = np.median(np.abs(dev)) + 1e-6
    spikes = np.abs(dev) > max(6 * 1.4826 * mad, 3.0)
    elev = np.where(spikes, med, elev)
    relief = float(max(elev.max() - elev.min(), 1.0))
    return (elev - elev.min()) / relief, relief


def describe_dem(body: str, dem: dict) -> dict:
    if body == "earth":
        return {"agency": "ESA", "instrument": f"Copernicus DEM GLO-30 ({dem.get('product', '')})", "status": "measured"}
    if body == "moon":
        return {"agency": "NASA", "instrument": f"LRO LOLA gridded DEM {dem.get('product', '')} ({dem.get('native_res_m', '?')} m, NASA PDS)", "status": "measured"}
    off = dem.get("offset_km", 0)
    where = "" if off < 1 else f", nearest HiRISE DTM {off:.0f} km from the nominal site"
    return {"agency": "NASA", "instrument": f"MRO HiRISE stereo DTM {dem.get('product', '')} (NASA PDS){where}", "status": "measured"}


def main():
    print("=" * 76)
    print("Celestra feature extraction (real-data cache: data/real)")
    print("=" * 76)

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)

    all_sites = config["targets"] + config["earth_analogs"]
    features_list = []
    pixel_m = 2000.0 / GRID_RES     # every tile is 2 km across
    counts = {"dem": 0, "spectra": 0, "climate": 0}

    for idx, site in enumerate(all_sites, 1):
        site_id = site["id"]
        body = site.get("body", "earth")
        real = load_real(site_id)
        hm = to_heightmap(real)
        frost = float(site.get("frost", 0.0))

        if hm is not None:
            heightmap, relief_m = hm
            topo = describe_dem(body, real["dem"])
            counts["dem"] += 1
        else:
            heightmap, relief_m = generate_planetary_mesh(site)
            topo = {"agency": "none", "instrument": f"Procedural shape model of a {site.get('morphology', 'plain').replace('_', ' ')} (no elevation product covers this site)", "status": "procedural"}

        texture = {"agency": topo["agency"], "instrument": "Texture statistics of the slope grid (terrain-roughness proxy, not radar)", "status": "derived" if topo["status"] == "measured" else "procedural"}

        surface, delta = None, None
        spectra, climate = real.get("spectra", {}), real.get("climate", {})
        water = float(spectra.get("water_fraction", 0.0) or 0.0) if body == "earth" else 0.0
        if body == "earth" and spectra.get("bareness_index") is not None:
            surface = (spectra["bareness_index"], spectra["iron_oxide_ratio"], spectra["clay_hydroxyl_ratio"], spectra["albedo"])
            comp = {"agency": "ESA", "instrument": f"Sentinel-2 L2A {spectra['scene']}, cloud-masked land pixels ({int(100 * spectra.get('clear_fraction', 1))}% of the window clear, {int(100 * water)}% open water)", "status": "measured"}
            counts["spectra"] += 1
        elif body == "earth" and "water_fraction" in spectra:
            _, iron, clay, alb = mineral_values(site.get("mineral_profile", "mare_basalt"), None)
            surface = (0.0, iron, clay, alb)
            comp = {"agency": "ESA", "instrument": f"Sentinel-2 L2A {spectra['scene']}: the window is open water, no bare ground", "status": "measured"}
            counts["spectra"] += 1
        else:
            comp = {"agency": "none", "instrument": f"Typical values for {site.get('mineral_profile', 'basalt').replace('_', ' ')} (not measured here; shown for context, not scored)", "status": "typical"}

        if body == "earth" and "temp_max_c" in climate:
            tmin, tmax, delta = climate["temp_min_c"], climate["temp_max_c"], climate["temp_delta_c"]
            therm = {"agency": "NASA", "instrument": f"MODIS Terra monthly land surface temperature {climate.get('year', '')}, NASA Worldview (GIBS): warmest-month day, coldest-month night", "status": "measured"}
            counts["climate"] += 1
        elif body == "moon" and "temp_max_c" in climate:
            tmin, tmax, delta = climate["temp_min_c"], climate["temp_max_c"], climate["temp_delta_c"]
            therm = {"agency": "NASA", "instrument": f"LRO Diviner bolometric surface temperature, daily max and min of the 0.5° bin ({climate.get('product', '')}, NASA PDS)", "status": "measured"}
            counts["climate"] += 1
        else:
            tmin, tmax = float(site["temp_min_c"]), float(site["temp_max_c"])
            therm = {"agency": "none", "instrument": "Published typical surface-temperature range (not measured here; shown for context, not scored)", "status": "typical"}

        provenance = {"topography": topo, "radar": texture, "mineral": comp, "thermal": therm,
                      "curve": {"agency": "none", "instrument": "Sine-based day-night model between the low and high", "status": "modelled"}}

        feat = compute_features(site, heightmap, relief_m, pixel_m, tmin, tmax, frost, provenance, surface, delta)
        feat["water_fraction"] = round(water, 3)
        # vegetation for the bare-ground rule: the greenest month of the year (MODIS NDVI, NASA Worldview), which a
        # single Sentinel-2 scene can miss; falls back to the Sentinel-2 scene where MODIS has no data
        nd = real.get("ndvi_seasonal", {})
        s2_ndvi = spectra.get("ndvi")
        feat["ndvi_season_max"] = round(float(nd["ndvi_max_month"]), 3) if "ndvi_max_month" in nd else (round(float(s2_ndvi), 3) if s2_ndvi is not None else None)
        feat["ndvi_source"] = "MODIS Terra monthly NDVI 2023, greenest month (NASA Worldview)" if "ndvi_max_month" in nd else ("Sentinel-2 L2A scene" if s2_ndvi is not None else None)
        features_list.append(feat)

        with open(OUT_ASSETS / f"{site_id}_dem.json", "w", encoding="utf-8") as f:
            json.dump({
                "site_id": site_id, "name": site["name"], "body": body, "resolution": GRID_RES, "extent_m": 2000,
                "relief_m": round(relief_m, 1), "data_provenance": provenance,
                "diurnal_sol_curve": feat["diurnal_sol_curve"], "data": np.round(heightmap.flatten(), 4).tolist(),
            }, f)

        texture_grid = np.clip(sobel(heightmap) * 4.2 + 0.12, 0.0, 1.0)
        with open(OUT_ASSETS / f"{site_id}_sar.json", "w", encoding="utf-8") as f:
            json.dump({"site_id": site_id, "sar_entropy": feat["sar_entropy"], "sar_source": texture["instrument"],
                       "data": np.round(texture_grid.flatten(), 4).tolist()}, f)

        print(f"  [{idx:02d}/{len(all_sites)}] {body:5} | {site_id:28} | relief {relief_m:6.0f} m | terrain {topo['status']:10} | surface {comp['status']:8} | temps {therm['status']}")

    df = pd.DataFrame(features_list)
    df.to_parquet(OUT_PROCESSED / "tiles.parquet", index=False)
    df.to_csv(OUT_PROCESSED / "tiles.csv", index=False)
    print("=" * 76)
    print(f"Real elevation: {counts['dem']}/{len(all_sites)} sites · Sentinel-2: {counts['spectra']} Earth sites · measured temperatures (MODIS LST / Diviner): {counts['climate']} sites")
    print(f"Wrote {OUT_PROCESSED / 'tiles.parquet'}")
    print("=" * 76)


if __name__ == "__main__":
    main()