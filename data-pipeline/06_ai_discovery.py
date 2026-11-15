"""
AI discovery: search the bare land of the whole Earth for new analog sites.

The exact Celestra score needs a 2 km, 30 m terrain tile per place, so it cannot be run everywhere. Instead:

  1. Coarse global inputs on a 0.25-degree grid (about 28 km): terrain roughness from the Copernicus DEM GLO-90
     (read at ~360 m), and MODIS land-surface temperature and NDVI from NASA Worldview (ai_rasters.py).
     Candidate cells are bare land (greenest-month NDVI <= 0.25) that is not an ice cap.
  2. Exact scores against all 28 targets, computed with the real pipeline (Copernicus GLO-30 2 km tile + MODIS),
     for a random sample of candidate cells.
  3. A deep ensemble (7 small neural networks, bootstrapped) learns to predict the 28 exact scores from the coarse
     inputs. Split-conformal calibration on held-out cells gives each prediction a 90% interval; the test-set
     coverage is reported.
  4. The ensemble sweeps every candidate cell. Per target, the cells with the highest lower bound (confident and
     high), at least 150 km apart and 50 km from any named Celestra site, are re-scored with the exact pipeline.

What the model learns is our scoring, not ground truth: it is a fast emulator that makes a global search possible,
and every candidate shown in the app has its exact score next to the AI estimate.

Run after ai_rasters.py:  python data-pipeline/06_ai_discovery.py
"""
import json
import math
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.img,.IMG,.lbl,.LBL")
if Path("/root/.ccr/ca-bundle.crt").exists():
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")

import importlib.util  # noqa: E402
import rasterio  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
RAW = ROOT / "data" / "raw" / "ai"
OUT = ROOT / "data" / "processed" / "discoveries.json"
CELL = 0.25
N_TRAIN = int(os.environ.get("AI_N_TRAIN", "1500"))
random.seed(7); np.random.seed(7)


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


fetch = _load("celestra_fetch", "02_fetch_real_data.py")
extract = _load("celestra_extract", "01_fetch_and_extract.py")
from ml_engine.engine import PlanetaryAnalogEngine, FEATURE_COLS, FEATURE_META, PILLARS, PILLAR_WEIGHTS, USABLE, NDVI_FULL, NDVI_ZERO, _status  # noqa: E402


# ---------------------------------------------------------------- 1. global MODIS maps (0.05 deg)
def modis_maps():
    def stack(what):
        return np.stack([np.load(RAW / f"modis_{what}_{m:02d}.npy") for m in range(1, 13)])
    day, night, ndvi = stack("lstday"), stack("lstnight"), stack("ndvi")
    nd, nn = np.isfinite(day).sum(0), np.isfinite(night).sum(0)
    with np.errstate(all="ignore"):
        tmax = np.nanmax(day, 0) - 273.15
        tmin = np.nanmin(night, 0) - 273.15
        delta = np.nanmean(day - night, 0)
        nmax = np.nanmax(ndvi, 0)
    # MODIS NDVI does not cover Antarctica, where nothing grows: count it as bare where temperatures were measured
    ant = np.zeros_like(nmax, dtype=bool); ant[int((90 + 60) / 0.05):, :] = True
    nmax = np.where(ant & ~np.isfinite(nmax) & (nd >= 1), 0.0, nmax)
    ok = (nd >= 3) & (nn >= 3)
    ok |= ant & (nd >= 1) & (nn >= 1)   # polar night and cloud leave fewer valid months in Antarctica
    tmax[~ok] = np.nan; tmin[~ok] = np.nan; delta[~ok] = np.nan
    return tmax.astype(np.float32), tmin.astype(np.float32), delta.astype(np.float32), nmax.astype(np.float32)


def px(lat, lon):
    return int(min(3599, max(0, (90 - lat) / 0.05))), int(min(7199, max(0, (lon + 180) / 0.05)))


def sample_map(m, lat, lon, r=1):
    i, j = px(lat, lon)
    v = m[max(0, i - r):i + r + 1, max(0, j - r):j + r + 1]
    return float(np.nanmedian(v)) if np.isfinite(v).any() else float("nan")


# ---------------------------------------------------------------- 2. coarse terrain from Copernicus GLO-90
def glo90_tile(lat0, lon0):
    ns, ew = ("N" if lat0 >= 0 else "S"), ("E" if lon0 >= 0 else "W")
    name = f"Copernicus_DSM_COG_30_{ns}{abs(lat0):02d}_00_{ew}{abs(lon0):03d}_00_DEM"
    return f"https://copernicus-dem-90m.s3.amazonaws.com/{name}/{name}.tif"


def coarse_terrain(tile):
    """Terrain statistics for the 16 cells (0.25 deg) of one 1-degree tile, read at ~360 m."""
    lat0, lon0 = tile
    cache = RAW / "glo90" / f"{lat0}_{lon0}.npy"
    if cache.exists():
        a = np.load(cache)
    else:
        try:
            with rasterio.open("/vsicurl/" + glo90_tile(lat0, lon0)) as ds:
                a = ds.read(1, out_shape=(320, 320)).astype(np.float32)
                if ds.nodata is not None:
                    a[a == ds.nodata] = np.nan
        except Exception:
            a = np.full((1, 1), np.nan, dtype=np.float32)
        cache.parent.mkdir(parents=True, exist_ok=True); np.save(cache, a)
    out = {}
    if a.size == 1:
        return out
    pix = 111320.0 / 320
    for ci in range(4):
        for cj in range(4):
            blk = a[(3 - ci) * 80:(4 - ci) * 80, cj * 80:(cj + 1) * 80]   # row 0 = north
            if not np.isfinite(blk).all():
                continue
            clat = lat0 + (ci + 0.5) * CELL
            gy, gx = np.gradient(blk, pix, pix * max(0.1, math.cos(math.radians(clat))))
            sl = np.degrees(np.arctan(np.hypot(gx, gy)))
            # the same statistics for the ~5 km around the cell centre, where the exact 2 km score is taken
            cb, cs = blk[32:48, 32:48], sl[32:48, 32:48]
            out[(round(clat, 3), round(lon0 + (cj + 0.5) * CELL, 3))] = [float(np.std(blk)), float(sl.mean()), float(np.percentile(sl, 90)),
                                                                           float(np.ptp(blk)), float(np.mean(np.abs(blk - np.mean(blk)))),
                                                                           float(np.std(cb)), float(cs.mean()), float(np.percentile(cs, 90)), float(np.ptp(cb))]
    return out


# ---------------------------------------------------------------- 3. exact score of any Earth point against the 28 targets
class Exact:
    def __init__(self, maps):
        self.eng = PlanetaryAnalogEngine()
        self.tmax, self.tmin, self.delta, self.nmax = maps
        df = self.eng.df
        self.targets = [(i, r) for i, r in df.iterrows() if r["body"] != "earth"]

    def features(self, lat, lon):
        h, _ = fetch.copernicus(lat, lon)
        fetch.reject_spikes(h)
        if np.mean(~np.isfinite(h)) > 0.2:
            return None
        fetch.fill_holes(h)
        hm = extract.to_heightmap({"heights_m": h.ravel().tolist()})
        if hm is None:
            return None
        heightmap, relief = hm
        tmax, tmin, delta = sample_map(self.tmax, lat, lon), sample_map(self.tmin, lat, lon), sample_map(self.delta, lat, lon)
        if not all(np.isfinite([tmax, tmin, delta])):
            return None
        prov = {"topography": {"status": "measured"}, "radar": {"status": "derived"}, "mineral": {"status": "typical"},
                "thermal": {"status": "measured"}, "curve": {"status": "modelled"}}
        site = {"id": "probe", "name": "probe", "body": "earth", "lat": lat, "lon": lon}
        f = extract.compute_features(site, heightmap, relief, 2000.0 / extract.GRID_RES, tmin, tmax, 0.0, prov, (0.95, 1.0, 0.4, 0.25), delta)
        f["ndvi_season_max"] = sample_map(self.nmax, lat, lon)
        f["elevation_m"] = float(np.nanmedian(h))
        f["_heightmap"], f["_relief"] = heightmap, relief
        return f

    def scores(self, f):
        e = self.eng
        ndvi = f["ndvi_season_max"]
        gate = float(np.clip((NDVI_ZERO - ndvi) / (NDVI_ZERO - NDVI_FULL), 0, 1)) if np.isfinite(ndvi) else 0.0
        zf = {c: (f[c] - e.feature_means[c]) / e.feature_stds[c] for c in FEATURE_COLS}
        out = []
        for ti, t in self.targets:
            num = den = 0.0
            for g, cols in PILLARS.items():
                if g == "mineral":
                    continue   # Earth composition of a probe is not measured here, and targets have none either
                sims = [math.exp(-0.55 * abs(zf[c] - e.norm_df.loc[ti, c])) for c in cols if _status(t, FEATURE_META[c]["group"]) in USABLE]
                if sims:
                    num += PILLAR_WEIGHTS[g] * float(np.mean(sims)); den += PILLAR_WEIGHTS[g]
            out.append((num / den if den else 0.0) * gate)
        return out


# ---------------------------------------------------------------- 4. deep ensemble with split conformal
def train_ensemble(X, Y, n_models=7, epochs=400, seed=0):
    import torch, torch.nn as nn
    torch.manual_seed(seed)
    n = len(X); idx = np.random.permutation(n)
    tr, ca, te = idx[:int(.6 * n)], idx[int(.6 * n):int(.8 * n)], idx[int(.8 * n):]
    mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-6
    Xs = (X - mu) / sd
    models = []
    for k in range(n_models):
        torch.manual_seed(100 + k)
        b = np.random.choice(tr, len(tr), replace=True)
        net = nn.Sequential(nn.Linear(X.shape[1], 64), nn.SiLU(), nn.Linear(64, 64), nn.SiLU(), nn.Linear(64, Y.shape[1]), nn.Sigmoid())
        opt = torch.optim.AdamW(net.parameters(), lr=3e-3, weight_decay=1e-4)
        xt, yt = torch.tensor(Xs[b], dtype=torch.float32), torch.tensor(Y[b], dtype=torch.float32)
        for _ in range(epochs):
            opt.zero_grad(); loss = ((net(xt) - yt) ** 2).mean(); loss.backward(); opt.step()
        net.eval(); models.append(net)

    def predict(Xn):
        with torch.no_grad():
            t = torch.tensor((Xn - mu) / sd, dtype=torch.float32)
            P = np.stack([m(t).numpy() for m in models])
        return P.mean(0), np.maximum(P.std(0), 0.01)

    m_ca, s_ca = predict(X[ca])
    q = np.quantile(np.abs(Y[ca] - m_ca) / s_ca, 0.9, axis=0)            # one conformal quantile per target
    m_te, s_te = predict(X[te])
    lo, hi = m_te - q * s_te, m_te + q * s_te
    cover = ((Y[te] >= lo) & (Y[te] <= hi)).mean(0)
    mae = np.abs(Y[te] - m_te).mean(0)
    ss = ((Y[te] - Y[te].mean(0)) ** 2).sum(0) + 1e-9
    r2 = 1 - ((Y[te] - m_te) ** 2).sum(0) / ss
    return predict, q, {"n_train": int(len(tr)), "n_calibration": int(len(ca)), "n_test": int(len(te)),
                        "coverage_per_target": cover.round(3).tolist(), "mae_per_target": mae.round(3).tolist(), "r2_per_target": r2.round(3).tolist()}


CANDIDATES: dict = {}


def cand_id(c):
    return f"ai_{c[0]:.3f}_{c[1]:.3f}".replace("-", "m")


def cand_name(c):
    return f"AI find {abs(c[0]):.2f}°{'N' if c[0] >= 0 else 'S'} {abs(c[1]):.2f}°{'E' if c[1] >= 0 else 'W'}"


def save_candidate(c, f):
    """Terrain asset and feature row of a verified AI find, so the app can rank, explain and simulate it."""
    cid = cand_id(c)
    hm, relief = f["_heightmap"], f["_relief"]
    prov = {"topography": {"agency": "ESA", "instrument": "Copernicus DEM GLO-30 (2 km window at the cell centre)", "status": "measured"},
            "radar": {"agency": "ESA", "instrument": "Texture statistics of the slope grid (terrain-roughness proxy, not radar)", "status": "derived"},
            "mineral": {"agency": "none", "instrument": "Composition not measured for AI finds; not scored", "status": "typical"},
            "thermal": {"agency": "NASA", "instrument": "MODIS Terra monthly land surface temperature 2023, NASA Worldview (global map)", "status": "measured"},
            "curve": {"agency": "none", "instrument": "Sine-based day-night model between the low and high", "status": "modelled"}}
    row = {k: (float(v) if isinstance(v, (int, float, np.floating)) else v) for k, v in f.items() if not k.startswith("_") and k not in ("provenance",)}
    row.update({"site_id": cid, "name": cand_name(c), "type": "ai_discovery", "lat": c[0], "lon": c[1], "morphology": "unknown",
                "mineral_profile": "not measured", "water_fraction": 0.0, "ndvi_source": "MODIS Terra monthly NDVI 2023, greenest month (NASA Worldview)", "provenance": prov})
    row["diurnal_sol_curve"] = [float(x) for x in row.get("diurnal_sol_curve", [])]
    CANDIDATES[cid] = row
    asset = ROOT / "backend" / "static" / "assets" / f"{cid}_dem.json"
    asset.write_text(json.dumps({"site_id": cid, "name": cand_name(c), "body": "earth", "resolution": extract.GRID_RES, "extent_m": 2000,
                                 "relief_m": round(float(relief), 1), "data_provenance": prov, "diurnal_sol_curve": row["diurnal_sol_curve"],
                                 "data": np.round(hm.flatten(), 4).tolist()}), encoding="utf-8")


def gc_km(a, b, c, d):
    a, b, c, d = map(math.radians, (a, b, c, d))
    return 6371.0 * math.acos(max(-1, min(1, math.sin(a) * math.sin(c) + math.cos(a) * math.cos(c) * math.cos(b - d))))


def main():
    t0 = time.time()
    maps = modis_maps(); tmax, tmin, delta, nmax = maps
    # candidate cells: bare land, not ice cap, inside Copernicus coverage
    cells = []
    for lat in np.arange(-85 + CELL / 2, 82, CELL):   # includes Antarctica's ice-free ground; ice sheets fail the temperature test
        for lon in np.arange(-180 + CELL / 2, 180, CELL):
            nd = sample_map(nmax, lat, lon, 2); tx = sample_map(tmax, lat, lon, 2)
            # not an ice cap: warmest month above -5 C; in Antarctica, where ice is everywhere, only ground that
            # warms above 0 C in summer (bare rock does, ice cannot)
            if np.isfinite(nd) and np.isfinite(tx) and nd <= NDVI_FULL and tx >= (0.0 if lat < -60 else -5):
                cells.append((round(float(lat), 3), round(float(lon), 3)))
    print(f"candidate bare-land cells: {len(cells)}  ({time.time() - t0:.0f}s)", flush=True)
    tiles = sorted({(math.floor(a), math.floor(b)) for a, b in cells})
    print(f"1-degree terrain tiles to read: {len(tiles)}", flush=True)
    terrain = {}
    with ThreadPoolExecutor(24) as ex:
        for k, d in enumerate(ex.map(coarse_terrain, tiles)):
            terrain.update(d)
            if k % 500 == 0:
                print(f"  terrain tiles {k}/{len(tiles)}  ({time.time() - t0:.0f}s)", flush=True)
    feats = {}
    for c in cells:
        if c in terrain:
            lat, lon = c
            feats[c] = terrain[c] + [sample_map(tmax, lat, lon, 2), sample_map(tmin, lat, lon, 2), sample_map(delta, lat, lon, 2), sample_map(nmax, lat, lon, 2), abs(lat)]
    feats = {c: v for c, v in feats.items() if all(np.isfinite(v))}
    keys = list(feats)
    print(f"cells with full coarse inputs: {len(keys)}  ({time.time() - t0:.0f}s)", flush=True)

    ex_ = Exact(maps)
    train_keys = random.sample(keys, min(N_TRAIN, len(keys)))
    cache_p = RAW / "train_exact.json"
    cache = json.loads(cache_p.read_text()) if cache_p.exists() else {}

    def label(c):
        k = f"{c[0]},{c[1]}"
        if k in cache:
            return c, cache[k]
        try:
            f = ex_.features(*c)
            return c, (ex_.scores(f) if f is not None else None)
        except Exception:
            return c, None

    with ThreadPoolExecutor(16) as pool:
        for k, (c, y) in enumerate(pool.map(label, train_keys)):
            cache[f"{c[0]},{c[1]}"] = y
            if k % 200 == 0:
                print(f"  exact labels {k}/{len(train_keys)}  ({time.time() - t0:.0f}s)", flush=True)
                cache_p.write_text(json.dumps(cache))
    cache_p.write_text(json.dumps(cache))
    lab = [(c, cache[f"{c[0]},{c[1]}"]) for c in train_keys if cache.get(f"{c[0]},{c[1]}")]
    X = np.array([feats[c] for c, _ in lab], dtype=np.float32); Y = np.array([y for _, y in lab], dtype=np.float32)
    print(f"training cells with exact scores: {len(lab)}  ({time.time() - t0:.0f}s)", flush=True)

    predict, q, metrics = train_ensemble(X, Y, epochs=600)
    print("conformal coverage (target 0.90):", np.round(np.mean(metrics["coverage_per_target"]), 3), " mean R2:", np.round(np.mean(metrics["r2_per_target"]), 3), " mean MAE:", np.round(np.mean(metrics["mae_per_target"]), 3), flush=True)

    XA = np.array([feats[c] for c in keys], dtype=np.float32)
    M, S = predict(XA)
    LO, HI = np.clip(M - q * S, 0, 1), np.clip(M + q * S, 0, 1)
    named = [(r["lat"], r["lon"]) for _, r in ex_.eng.df[ex_.eng.df["body"] == "earth"].iterrows()]
    out = {"method": __doc__.strip().split("\n\n")[1] if False else "Deep ensemble (7 networks) trained to emulate the exact Celestra score from coarse global inputs, swept over bare land, with split-conformal 90% intervals; top candidates re-scored with the exact pipeline.",
           "inputs": ["terrain std (GLO-90, ~360 m)", "mean slope", "90th-pct slope", "relief", "mean absolute deviation", "the same four for the ~5 km around the centre", "MODIS warmest-month day LST", "MODIS coldest-month night LST", "MODIS mean day-night LST swing", "MODIS greenest-month NDVI", "|latitude|"],
           "cells_searched": len(keys), "cell_deg": CELL, "metrics": metrics, "targets": {}}
    tids = [r["site_id"] for _, r in ex_.targets]
    verify_jobs = []
    for k, tid in enumerate(tids):
        order = np.argsort(-LO[:, k]); picked = []
        for i in order:
            c = keys[i]
            if any(gc_km(c[0], c[1], a, b) < 50 for a, b in named):
                continue
            if any(gc_km(c[0], c[1], p[0][0], p[0][1]) < 150 for p in picked):
                continue
            picked.append((c, float(M[i, k]), float(LO[i, k]), float(HI[i, k]), float(S[i, k])))
            if len(picked) >= 10:
                break
        out["targets"][tid] = picked
        verify_jobs += [(tid, p[0]) for p in picked]
    print(f"verifying {len(verify_jobs)} candidates with the exact pipeline ({time.time() - t0:.0f}s)", flush=True)

    vcache = {}
    def verify(job):
        tid, c = job
        if c in vcache:
            return job, vcache[c]
        try:
            f = ex_.features(*c)
            s = ex_.scores(f) if f is not None else None
        except Exception:
            s, f = None, None
        if f is not None:
            save_candidate(c, f)
        res = (s, {k: round(float(f[k]), 3) for k in ("slope_mean", "slope_p90", "tri_ruggedness", "temp_min_c", "temp_max_c", "ndvi_season_max")} if f else None)
        vcache[c] = res
        return job, res
    with ThreadPoolExecutor(16) as pool:
        results = dict(pool.map(verify, verify_jobs))

    # the exact rank a candidate would get among the 60 named Earth sites
    final = {}
    for k, tid in enumerate(tids):
        named_scores = sorted([m["similarity_score"] for m in ex_.eng.match(tid, top_k=60)["matches"]], reverse=True)
        lst = []
        for (c, mu, lo, hi, sd) in out["targets"][tid]:
            s, f = results.get((tid, c), (None, None))
            exact = None if s is None else round(s[k], 3)
            would_rank = None if exact is None else 1 + sum(1 for v in named_scores if v > exact)
            lst.append({"id": cand_id(c), "lat": c[0], "lon": c[1], "ai_score": round(mu, 3), "ai_low": round(lo, 3), "ai_high": round(hi, 3), "ai_sigma": round(sd, 3),
                        "confident": bool(hi - lo <= 0.12), "exact_score": exact, "inside_interval": None if exact is None else bool(lo - 1e-6 <= exact <= hi + 1e-6),
                        "would_rank_among_named": would_rank, "measured": f})
        lst.sort(key=lambda d: -(d["exact_score"] if d["exact_score"] is not None else -1))
        final[tid] = lst
    out["targets"] = final
    (ROOT / "data" / "processed" / "ai_candidates.json").write_text(json.dumps(CANDIDATES), encoding="utf-8")
    ins = [d["inside_interval"] for v in final.values() for d in v if d["inside_interval"] is not None]
    out["verification"] = {"candidates": len(ins), "exact_inside_ai_interval": round(float(np.mean(ins)), 3) if ins else None}
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT}  verification inside-interval {out['verification']}  total {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
