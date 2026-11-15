"""
Sunlight, Earth visibility and modelled peak temperature for the polar Moon sites, from LRO LOLA terrain.

Near the lunar poles the Sun never rises more than a few degrees, so whether a spot is lit depends on the
horizon around it. For each site this script:

  1. resamples the LOLA 120 m polar DEM (NASA PDS) onto a 400 m terrain model reaching
     90 km beyond the search area, so distant mountains can block the Sun;
  2. traces the horizon in 72 directions from each candidate point, allowing for the Moon's curvature;
  3. moves the Sun through a full lunar day at 12 points of the 1.54 degree seasonal cycle (864 positions) and
     Earth through its libration range (63 positions), and counts how often each is above the horizon;
  4. converts the steepest sunlit incidence on the local 2 km slope into a radiative-balance peak temperature.

For NASA's nine Artemis III candidate regions (data/config/artemis_regions.json) it then searches the area
around each named feature and picks the best-lit, gentlest 2 km window. That point is Celestra's estimate of a
landing spot inside the region, not NASA's. It is written to data/config/artemis_targets.json, which
build_site_registry.py and this script merge into sites.json.

Limits, stated in the app: point Sun (no partial disc), 90 km horizon range, 400 m terrain (small boulders and
crater walls under ~1 km are smoothed out), no secondary illumination or heat flow. Published ray-traced
illumination maps (Mazarico et al. 2011) should be preferred where available.

Run:  python data-pipeline/04_polar_illumination.py      (about 5-10 min; then run 02, 01 and 03)
"""
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates

if os.path.isfile("/root/.ccr/ca-bundle.crt"):   # dev sandbox proxy only; isfile() never raises, Path.exists() does when /root is unreadable
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
CONFIG = ROOT / "data" / "config"
R = 1737400.0
CELL = 400.0               # terrain model cell, m
HORIZON_KM = 90.0
MAST_M = 2.0               # observer height above the ground
ALBEDO, EMISSIVITY, S0, SIGMA = 0.15, 0.95, 1361.0, 5.670e-8
AZ = np.radians(np.arange(0, 360, 5.0))
DIST = np.geomspace(CELL, HORIZON_KM * 1000, 150)


def frame(lat, lon):
    la, lo = math.radians(lat), math.radians(lon)
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    return up, east, np.cross(up, east)


def to_latlon(v):
    v = v / np.linalg.norm(v)
    return math.degrees(math.asin(v[2])), math.degrees(math.atan2(v[1], v[0]))


def lola_grid(lat, lon, half_m):
    """LOLA heights on a CELL-metre grid in the local tangent plane around (lat, lon), reaching half_m each way.
    Source: the LOLA 120 m polar stereographic DEM (LDEM_75S/N_120M, NASA PDS Geosciences Node), resampled onto the
    plane so horizons can be traced along true east/north directions."""
    import rasterio
    from rasterio.windows import from_bounds
    from pyproj import Transformer
    from sources_listed import LOLA_GDR
    url = f"{LOLA_GDR}/polar/float_img/ldem_75{'s' if lat < 0 else 'n'}_120m_float.lbl"
    up, east, north = frame(lat, lon)
    n = int(round(2 * half_m / CELL))
    ax = (np.arange(n) + 0.5) * CELL - half_m
    E, N = np.meshgrid(ax, -ax)                       # row 0 at the north edge
    P = up * R + E[..., None] * east + N[..., None] * north
    P /= np.linalg.norm(P, axis=-1, keepdims=True)
    glat, glon = np.degrees(np.arcsin(P[..., 2])), np.degrees(np.arctan2(P[..., 1], P[..., 0]))
    with rasterio.open("/vsicurl/" + url) as ds:
        tr = Transformer.from_crs(ds.crs.geodetic_crs, ds.crs, always_xy=True)
        X, Y = tr.transform(glon, glat)
        x0, x1, y0, y1 = X.min() - 500, X.max() + 500, Y.min() - 500, Y.max() + 500
        m = int(min(2400, max(64, (x1 - x0) / 200)))
        w = from_bounds(x0, y0, x1, y1, ds.transform)
        a = ds.read(1, window=w, out_shape=(m, m), resampling=rasterio.enums.Resampling.average).astype(np.float64) * 1000.0
    rows = (y1 - Y) / (y1 - y0) * m - 0.5
    cols = (X - x0) / (x1 - x0) * m - 0.5
    grid = map_coordinates(a, [rows, cols], order=1, mode="nearest")
    return grid, (up, east, north), {"product": url.rsplit("/", 1)[-1].replace(".lbl", "").upper(), "source": "LRO LOLA GDR, NASA PDS Geosciences Node", "cell_m": CELL}


class Terrain:
    def __init__(self, grid, axes, half_m):
        self.g, self.half = grid, half_m
        self.up0, self.e0, self.n0 = axes
        gy, gx = np.gradient(gaussian_filter(grid, 2.5), CELL)
        self.dzde, self.dzdn = gx, -gy          # row index increases southwards

    def rc(self, e, n):
        return (self.half - n) / CELL - 0.5, (e + self.half) / CELL - 0.5

    def height(self, e, n):
        r, c = self.rc(np.atleast_1d(np.asarray(e, float)), np.atleast_1d(np.asarray(n, float)))
        return map_coordinates(self.g, [r, c], order=1, mode="nearest")

    def horizon(self, e, n):
        """Horizon elevation (deg) in each of the 72 directions from (e, n), allowing for curvature."""
        h0 = float(self.height(e, n)[0]) + MAST_M
        se, cn = np.sin(AZ)[:, None], np.cos(AZ)[:, None]
        ee, nn = e + se * DIST[None, :], n + cn * DIST[None, :]
        inside = (np.abs(ee) < self.half) & (np.abs(nn) < self.half)
        hh = self.height(ee.ravel(), nn.ravel()).reshape(ee.shape)
        ang = np.degrees(np.arctan2(hh - h0 - DIST[None, :] ** 2 / (2 * R), DIST[None, :]))
        ang = np.where(inside, ang, -90)
        return ang.max(axis=1)

    def local(self, e, n):
        p = self.up0 * R + self.e0 * e + self.n0 * n
        up = p / np.linalg.norm(p)
        east = self.e0 - (self.e0 @ up) * up
        east /= np.linalg.norm(east)
        north = np.cross(up, east)
        r, c = self.rc(np.array([e]), np.array([n]))
        ge = float(map_coordinates(self.dzde, [r, c], order=1, mode="nearest")[0])
        gn = float(map_coordinates(self.dzdn, [r, c], order=1, mode="nearest")[0])
        normal = -ge * east - gn * north + up
        normal /= np.linalg.norm(normal)
        slope = math.degrees(math.atan(math.hypot(ge, gn)))
        return up, east, north, normal, slope


def sky(dirs):
    return np.stack(dirs).reshape(-1, 3)


S_LON = np.radians(np.arange(0, 360, 5.0))
S_DEC = np.radians(1.54 * np.sin(np.linspace(0, 2 * np.pi, 12, endpoint=False)))
SUN = sky([np.stack([np.cos(d) * np.cos(S_LON), np.cos(d) * np.sin(S_LON), np.full_like(S_LON, np.sin(d))], 1) for d in S_DEC])
EB, EL = np.meshgrid(np.radians(np.linspace(-6.7, 6.7, 7)), np.radians(np.linspace(-7.9, 7.9, 9)))
EARTH = np.stack([np.cos(EB) * np.cos(EL), np.cos(EB) * np.sin(EL), np.sin(EB)], -1).reshape(-1, 3)


def visible(dirs, hz, up, east, north):
    elev = np.degrees(np.arcsin(np.clip(dirs @ up, -1, 1)))
    az = np.degrees(np.arctan2(dirs @ east, dirs @ north)) % 360
    hz_at = np.interp(az, np.degrees(AZ), hz, period=360)
    return elev > hz_at, elev


def assess(t: Terrain, e, n):
    up, east, north, normal, slope = t.local(e, n)
    hz = t.horizon(e, n)
    lit, elev = visible(SUN, hz, up, east, north)
    seen, _ = visible(EARTH, hz, up, east, north)
    cos_i = np.clip(SUN @ normal, 0, 1) * lit
    tmax = (((1 - ALBEDO) * S0 * cos_i.max()) / (EMISSIVITY * SIGMA)) ** 0.25 if cos_i.max() > 0 else 40.0
    return {"sunlit": float(lit.mean()), "earth": float(seen.mean()), "max_sun_elev": float(elev.max()),
            "tmax_k": float(tmax), "slope": slope}


def tile_stats(t: Terrain, e, n):
    """Sunlight over the 2 km window around the point at 400 m spacing: mean sunlit share and never-lit share."""
    offs = np.arange(-800, 801, CELL)
    fr = [assess(t, e + a, n + b)["sunlit"] for a in offs for b in offs]
    return float(np.mean(fr)), float(np.mean(np.array(fr) == 0))


def plane_of(t: Terrain, lat, lon):
    up, east, north = t.up0, t.e0, t.n0
    v, _, _ = frame(lat, lon)
    k = 1.0 / (v @ up)
    return float((v @ east) * k * R), float((v @ north) * k * R)


def km(a, b):
    return R / 1000 * math.acos(max(-1, min(1, float(frame(*a)[0] @ frame(*b)[0]))))


def run_site(lat, lon, search=None, chosen=None):
    search = search or {"kind": "fixed"}
    reach = 0.0 if search["kind"] == "fixed" else 1000 * (search.get("half_km") or search.get("r_max_km"))
    half = reach + HORIZON_KM * 1000 + 2 * CELL
    grid, axes, meta = lola_grid(lat, lon, half)
    t = Terrain(grid, axes, half)
    best, scanned = None, 0
    if search["kind"] == "fixed":
        cands = [(0.0, 0.0)]
    else:
        step = 1000.0
        rng = np.arange(-reach, reach + 1, step)
        cands = [(a, b) for a in rng for b in rng]
        if search["kind"] == "ring":
            cands = [(a, b) for a, b in cands if search["r_min_km"] * 1000 <= math.hypot(a, b) <= search["r_max_km"] * 1000]
    avoid = None
    if search.get("avoid_km_from") and chosen and search["avoid_km_from"] in chosen:
        avoid = chosen[search["avoid_km_from"]]
    fw = search.get("flat_weight", 1.0)
    scored = []

    def score_of(r):
        # sunlight first, then a view of Earth for direct radio contact; gentle ground preferred
        return (0.7 * r["sunlit"] + 0.3 * r["earth"]) * max(0.0, 1 - r["slope"] / 15) ** fw
    for a, b in cands:
        p = to_latlon(t.up0 * R + t.e0 * a + t.n0 * b)
        if avoid and km(p, avoid) < search["avoid_km"]:
            continue
        r = assess(t, a, b)
        scanned += 1
        score = score_of(r)
        scored.append((score, a, b, r, p))
        if best is None or score > best[0]:
            best = (score, a, b, r, p)
    # refine: 250 m search within 1 km of the five best coarse candidates
    if search["kind"] != "fixed":
        coarse = sorted(scored, key=lambda x: -x[0])[:5]
        for _, a0, b0, _, _ in coarse:
            for a in np.arange(a0 - 1000, a0 + 1001, 250.0):
                for b in np.arange(b0 - 1000, b0 + 1001, 250.0):
                    p = to_latlon(t.up0 * R + t.e0 * a + t.n0 * b)
                    if avoid and km(p, avoid) < search["avoid_km"]:
                        continue
                    r = assess(t, a, b)
                    sc = score_of(r)
                    if sc > best[0]:
                        best = (sc, a, b, r, p)
    _, a, b, r, p = best
    mean_lit, psr = tile_stats(t, a, b)
    return {
        "lat": round(p[0], 3), "lon": round(p[1], 3),
        "elevation_m": round(float(t.height(a, b)[0]), 0),
        "sunlit_fraction": round(r["sunlit"], 3),
        "tile_sunlit_fraction": round(mean_lit, 3),
        "psr_fraction_tile": round(psr, 3),
        "earth_visible_fraction": round(r["earth"], 3),
        "max_sun_elevation_deg": round(r["max_sun_elev"], 2),
        "modelled_max_temp_c": round(r["tmax_k"] - 273.15, 0),
        "slope_deg_2km": round(r["slope"], 1),
        "candidates_scanned": scanned,
        "lola": meta,
        "method": "Horizon traced from a 400 m LOLA terrain model out to 90 km in 72 directions; Sun over a lunar day at 12 seasonal points, Earth over its libration range; peak temperature from radiative balance (albedo 0.15, emissivity 0.95) on the 2 km slope.",
    }


def describe(name, r):
    lit = int(round(100 * r["sunlit_fraction"]))
    earth = int(round(100 * r["earth_visible_fraction"]))
    psr = int(round(100 * r["psr_fraction_tile"]))
    return (f"{name}: our LOLA model puts the Sun above the horizon {lit}% of the time and Earth in view {earth}% of the time; "
            f"{psr}% of the 2 km window never sees the Sun. The Sun stays below {r['max_sun_elevation_deg']:.0f}° so shadows are long and lighting is grazing.")


def main():
    only = set(sys.argv[1:])
    regions = json.loads((CONFIG / "artemis_regions.json").read_text(encoding="utf-8"))
    sites = json.loads((CONFIG / "sites.json").read_text(encoding="utf-8"))
    out_path = ROOT / "data" / "processed" / "illumination.json"
    results = json.loads(out_path.read_text()) if out_path.exists() else {}
    chosen = {k: (v["lat"], v["lon"]) for k, v in results.items()}
    new_targets = []
    for reg in regions["regions"]:
        sid = reg["id"]
        if (not only or sid in only) and (sid not in results or only):
            print(f"{reg['name']}: searching around {reg['feature']} ...", flush=True)
            results[sid] = run_site(reg["feature_lat"], reg["feature_lon"], reg["search"], chosen)
            chosen[sid] = (results[sid]["lat"], results[sid]["lon"])
            out_path.write_text(json.dumps(results, indent=1))
        r = results[sid]
        off = km((r["lat"], r["lon"]), (reg["feature_lat"], reg["feature_lon"]))
        print(f"  -> {r['lat']:.3f}, {r['lon']:.3f}  ({off:.1f} km from the feature point)  sunlit {r['sunlit_fraction']:.2f}  earth {r['earth_visible_fraction']:.2f}  psr {r['psr_fraction_tile']:.2f}  Tmax {r['modelled_max_temp_c']:.0f} C  slope {r['slope_deg_2km']}", flush=True)
        flat = reg["morphology"] == "flat_plain"
        new_targets.append({
            "id": sid, "name": f"Artemis III: {reg['name']}", "body": "moon",
            "lat": r["lat"], "lon": r["lon"], "elevation_m": r["elevation_m"],
            "gravity_m_s2": 1.62, "pressure_bar": 0.0,
            # cold end: Diviner-era published values for sunlit polar highlands in shadow (typical, not measured here)
            "temp_min_c": -230.0 if r["psr_fraction_tile"] > 0.3 else -200.0,
            "temp_max_c": r["modelled_max_temp_c"],
            "morphology": reg["morphology"], "mineral_profile": "anorthosite",
            "frost": round(min(0.95, 0.2 + r["psr_fraction_tile"]), 2),
            "primary_challenge": describe(reg["name"], r),
            "recommended_hardware_test": "rover_traverse_and_traction" if flat else "solar_array_and_optical_nav",
            "artemis": {"status": reg["status"], "region": reg["name"], "feature": reg["feature"],
                        "placement": f"Point chosen by Celestra inside the region: the best-lit, gentlest 2 km window within the search area around the {reg['feature']} ({off:.0f} km from the feature point). NASA's region outline was not used."
                        if reg["search"]["kind"] != "fixed" else "Published landing-site point (LPSC 2025 abstract 2742).",
                        "search": reg["search"]},
        })
    (CONFIG / "artemis_targets.json").write_text(json.dumps(new_targets, indent=1), encoding="utf-8")

    # existing polar targets: rim targets that were registered at their crater centre are moved onto the rim;
    # the rest are assessed at their nominal point
    relocate = {k: v for k, v in regions.get("relocate", {}).items() if not k.startswith("_")}
    superseded = regions.get("superseded", {})
    moved = {}
    for t in sites["targets"]:
        if t["body"] != "moon" or abs(t["lat"]) < 80 or t["id"].startswith("moon_a3_") or t["id"] in superseded:
            continue
        rel = relocate.get(t["id"])
        if (t["id"] in results and not only) or (only and t["id"] not in only):
            if rel and t["id"] in results:
                moved[t["id"]] = (rel, results[t["id"]])
            continue
        if rel:
            print(f"{t['name']}: moving onto the {rel['feature']} ...", flush=True)
            results[t["id"]] = run_site(rel["feature_lat"], rel["feature_lon"], rel["search"], chosen)
            moved[t["id"]] = (rel, results[t["id"]])
        else:
            print(f"{t['name']}: nominal point ...", flush=True)
            results[t["id"]] = run_site(t["lat"], t["lon"])
        r = results[t["id"]]
        print(f"  -> {r['lat']:.3f}, {r['lon']:.3f}  sunlit {r['sunlit_fraction']:.2f}  earth {r['earth_visible_fraction']:.2f}  psr {r['psr_fraction_tile']:.2f}", flush=True)
        out_path.write_text(json.dumps(results, indent=1))
    for k in superseded:
        results.pop(k, None)
    out_path.write_text(json.dumps(results, indent=1))
    relocations = {}
    for sid, (rel, r) in moved.items():
        relocations[sid] = {"lat": r["lat"], "lon": r["lon"],
                            "note": f"Moved onto the {rel['feature']}: the registry had used the crater-centre coordinates. Point chosen as the best-lit, gentlest 2 km window on the rim (LOLA)."}
    (CONFIG / "relocated_targets.json").write_text(json.dumps(relocations, indent=1), encoding="utf-8")

    # merge Artemis targets into the registry and tag the 2022-only candidates
    earlier = regions["earlier_candidates"]
    keep = [t for t in sites["targets"] if not t["id"].startswith("moon_a3_") and t["id"] not in superseded]
    for t in keep:
        if t["id"] in relocations:
            t.setdefault("registry_lat_lon", [t["lat"], t["lon"]])
            t["lat"], t["lon"] = relocations[t["id"]]["lat"], relocations[t["id"]]["lon"]
            t["relocation_note"] = relocations[t["id"]]["note"]
        if t["id"] in earlier:
            t["artemis"] = {"status": "artemis_iii_2024" if "both lists" in earlier[t["id"]] else "artemis_iii_2022_only", "region": earlier[t["id"]]}
    moon = [t for t in keep if t["body"] == "moon"]
    mars = [t for t in keep if t["body"] == "mars"]
    sites["targets"] = new_targets + moon + mars
    (CONFIG / "sites.json").write_text(json.dumps(sites, indent=2), encoding="utf-8")
    print(f"wrote {out_path} and merged {len(new_targets)} Artemis III targets into sites.json")


if __name__ == "__main__":
    main()
