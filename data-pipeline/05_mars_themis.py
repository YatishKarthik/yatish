"""
Night-time infrared character of each Mars target, from the Mars Odyssey THEMIS controlled night-IR mosaics
(USGS Astrogeology, astrogeo-ard on AWS, ~100 m/pixel, band 9 at 12.6 um).

At night, rock and coarse ground stay warmer (brighter) than fine dust because they store more heat (higher
thermal inertia). The USGS mosaics are 8-bit and stretched image by image, so values are qualitative: we only
compare the 2 km site window with a 20 km surround in the same mosaic. A positive score means the site is
warmer at night than its surroundings (rockier or more consolidated ground), a negative one means dustier or
finer ground. This is a descriptor shown in the app, not one of the 14 matching features, because Earth has no
matching measurement in our data.

Run:  python data-pipeline/05_mars_themis.py    -> data/processed/mars_themis.json
"""
import json
import math
import os
import re
from pathlib import Path

import numpy as np
import requests

if Path("/root/.ccr/ca-bundle.crt").exists():
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
import rasterio  # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
S3 = "https://astrogeo-ard.s3-us-west-2.amazonaws.com/"
PREFIX = "mars/mo/themis/controlled_mosaics/"
R = 3396190.0


def mosaics():
    xml = requests.get(f"{S3}?list-type=2&delimiter=/&prefix={PREFIX}", timeout=60).text
    out = []
    for p in re.findall(r"<Prefix>([^<]+_nir/)</Prefix>", xml):
        name = p.rstrip("/").split("/")[-1]
        meta = requests.get(f"{S3}{p}{name}.json", timeout=60).json()
        ring = np.array(meta["geometry"]["coordinates"][0])   # degrees; "bbox" is in projected metres
        bbox = [ring[:, 0].min(), ring[:, 1].min(), ring[:, 0].max(), ring[:, 1].max()]
        out.append((bbox, f"{S3}{p}{name}.tif", name))
    return out


def stats(url, lat, lon):
    with rasterio.open(url) as ds:
        def win(half_m):
            kx = half_m / max(math.cos(math.radians(lat)), 0.05)
            x, y = R * math.radians(lon), R * math.radians(lat)
            w = from_bounds(x - kx, y - half_m, x + kx, y + half_m, ds.transform)
            a = ds.read(1, window=w, out_shape=(96, 96), boundless=True, fill_value=0).astype(float)
            a[a == 0] = np.nan
            return a
        site, around = win(1000), win(10000)
    if np.isnan(site).mean() > 0.5 or np.isnan(around).mean() > 0.5:
        return None
    mu, sd = np.nanmean(around), np.nanstd(around) + 1e-6
    return {"night_ir_contrast": round(float((np.nanmean(site) - mu) / sd), 2),
            "night_ir_texture": round(float(np.nanstd(site) / sd), 2)}


def main():
    sites = json.loads((ROOT / "data" / "config" / "sites.json").read_text(encoding="utf-8"))
    tiles = mosaics()
    out = {}
    for t in [t for t in sites["targets"] if t["body"] == "mars"]:
        lat, lon = t["lat"], t["lon"]
        hit = [m for m in tiles if m[0][0] <= lon <= m[0][2] and m[0][1] <= lat <= m[0][3]]
        rec = None
        for bbox, url, name in hit:
            try:
                rec = stats(url, lat, lon)
            except Exception as ex:
                print(f"  {t['id']}: {name} {str(ex)[:80]}")
            if rec:
                rec["mosaic"] = name
                break
        if rec:
            c = rec["night_ir_contrast"]
            rec["reading"] = ("warmer at night than its surroundings: rockier or more consolidated ground" if c > 0.5 else
                              "cooler at night than its surroundings: finer, dustier ground" if c < -0.5 else
                              "about as warm at night as its surroundings")
            rec["status"] = "measured (relative, qualitative)"
        out[t["id"]] = rec or {"status": "missing", "reading": "no THEMIS night-IR mosaic covers this site"}
        print(f"{t['id']:28} {out[t['id']]}")
    path = ROOT / "data" / "processed" / "mars_themis.json"
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
