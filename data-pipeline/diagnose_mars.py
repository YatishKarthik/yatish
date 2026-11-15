"""Why does a Mars point fail? Run:  python data-pipeline/diagnose_mars.py <lat> <lon>
Checks, step by step and with timings: the connection to NASA's HiRISE archive, which terrain models are nearest,
a quick 16-row probe of the best one, and the full 2 km read the app makes. Nothing is saved."""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import requests  # noqa: E402
import sources_listed as S  # noqa: E402


def step(name, fn):
    t = time.time()
    try:
        out = fn()
        print(f"  OK   {name}  ({time.time() - t:.1f} s)")
        return out
    except Exception as e:
        print(f"  FAIL {name}  ({time.time() - t:.1f} s): {str(e)[:300]}")
        return None


def main():
    if len(sys.argv) < 3:
        print(__doc__); return
    lat, lon = float(sys.argv[1]), float(sys.argv[2])
    lon360 = lon % 360
    print(f"Mars point {lat:.3f}, {lon:.3f}")
    print("1. Connection to the HiRISE archive (hirise-pds.lpl.arizona.edu)")
    r = step("reach the server", lambda: requests.head(f"{S.HIRISE}/INDEX/DTMCUMINDEX.LBL", timeout=20))
    if r is None:
        print("  -> Your network cannot reach NASA's HiRISE archive. Try another network (a phone hotspot) or later."); return
    print("2. Nearest HiRISE terrain models")
    idx = step("load the index", S.hirise_index)
    if not idx:
        return
    c = []
    for d in idx:
        inside = d["lat0"] <= lat <= d["lat1"] and d["lon0"] <= lon360 <= d["lon1"]
        clat, clon = (d["lat0"] + d["lat1"]) / 2, (d["lon0"] + d["lon1"]) / 2
        dist = 0.0 if inside else S._gc_km(lat, lon360, clat, clon, S.MARS_R / 1000)
        c.append((dist, d, clat, clon, inside))
    c.sort(key=lambda x: x[0])
    for dist, d, *_ in c[:3]:
        print(f"     {dist:6.1f} km  {d['file'].split('/')[-1]}")
    if c[0][0] > 400:
        print(f"  -> No HiRISE terrain model within 400 km (nearest {c[0][0]:.0f} km). The app cannot measure this point: HiRISE has mapped only small patches of Mars."); return
    dist, d, clat, clon, inside = c[0]
    url = f"{S.HIRISE}/{d['file']}"
    plat, plon = (lat, lon) if inside else (clat, clon if clon <= 180 else clon - 360)
    print(f"3. Quick probe of the nearest model ({'at the point' if inside else 'at its centre'})")
    p = step("16-row probe", lambda: S._window(url, plon, plat, 2000, 16, sub=1))
    if p is not None:
        print(f"     missing cells: {np.mean(~np.isfinite(p)) * 100:.0f}%")
    print("4. Full 2 km read, as the app does it")
    h = step("full read", lambda: S._window(url, plon, plat, 2000, 128, sub=3))
    if h is not None:
        print(f"     missing cells: {np.mean(~np.isfinite(h)) * 100:.0f}%  relief: {np.nanmax(h) - np.nanmin(h):.0f} m")
        print("  -> The data path works from this computer. If the app still fails, restart the backend (an earlier stuck request may be holding it) and try once.")
    else:
        print("  -> The archive is reachable but too slow from this network right now. Try again later or on another network.")


if __name__ == "__main__":
    main()
