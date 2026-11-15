"""Global MODIS monthly rasters from NASA Worldview (GIBS) WMS, decoded to values with the layers' colour maps.
Writes data/raw/ai/modis_<what>_<month>.npy at 0.05 degrees (3600 x 7200, row 0 = 90N)."""
import io, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np, requests
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources_listed import GIBS_WMS, lst_colormap, ndvi_colormap

OUT = Path(__file__).resolve().parent.parent / "data" / "raw" / "ai"
OUT.mkdir(parents=True, exist_ok=True)
LAYERS = {"lstday": ("MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day", lst_colormap),
          "lstnight": ("MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night", lst_colormap),
          "ndvi": ("MODIS_Terra_L3_NDVI_Monthly", ndvi_colormap)}

def decode(img: np.ndarray, lut: dict) -> np.ndarray:
    rgb = img[..., 0].astype(np.int64) << 16 | img[..., 1].astype(np.int64) << 8 | img[..., 2]
    keys = np.array([(r << 16) | (g << 8) | b for (r, g, b) in lut]); vals = np.array(list(lut.values()), dtype=np.float32)
    order = np.argsort(keys); keys, vals = keys[order], vals[order]
    idx = np.clip(np.searchsorted(keys, rgb), 0, len(keys) - 1)
    out = np.where((keys[idx] == rgb) & (img[..., 3] > 0), vals[idx], np.nan).astype(np.float32)
    return out

def one(job):
    what, month = job
    f = OUT / f"modis_{what}_{month:02d}.npy"
    if f.exists(): return f.name, "cached"
    layer, cmap = LAYERS[what]; lut = cmap()
    full = np.full((3600, 7200), np.nan, dtype=np.float32)
    for qi, (lon0, lat0) in enumerate([(-180, 0), (0, 0), (-180, -90), (0, -90)]):
        params = {"SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.1.1", "LAYERS": layer, "STYLES": "", "FORMAT": "image/png",
                  "SRS": "EPSG:4326", "BBOX": f"{lon0},{lat0},{lon0 + 180},{lat0 + 90}", "WIDTH": 3600, "HEIGHT": 1800, "TIME": f"2023-{month:02d}-01"}
        for attempt in range(4):
            try:
                r = requests.get(GIBS_WMS, params=params, timeout=180)
                if r.status_code == 200 and r.headers.get("content-type", "").startswith("image"): break
            except requests.RequestException: pass
            time.sleep(3 * (attempt + 1))
        else:
            raise RuntimeError(f"{layer} {month} quadrant {qi} failed")
        img = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGBA"))
        r0 = 0 if lat0 == 0 else 1800; c0 = 0 if lon0 == -180 else 3600
        full[r0:r0 + 1800, c0:c0 + 3600] = decode(img, lut)
    np.save(f, full)
    return f.name, f"{np.isfinite(full).mean():.2f} valid"

if __name__ == "__main__":
    t = time.time()
    jobs = [(w, m) for w in LAYERS for m in range(1, 13)]
    with ThreadPoolExecutor(6) as ex:
        for name, msg in ex.map(one, jobs): print(name, msg, f"{time.time() - t:.0f}s", flush=True)
