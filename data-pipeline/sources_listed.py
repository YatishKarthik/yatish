"""
Readers for the data sources the challenge lists, used by 02_fetch_real_data.py and 04_polar_illumination.py.

  Moon terrain      NASA PDS Geosciences Node, LRO LOLA gridded DEMs (LRO-L-LOLA-4-GDR):
                    polar stereographic LDEM_xxS/N_20M/30M/60M, and LDEM_1024 cylindrical tiles (~30 m) elsewhere.
  Moon temperature  NASA PDS Geosciences Node, LRO Diviner Global Cumulative Products (GCP): bolometric surface
                    temperature binned at 0.5 degrees and 0.25 h of local time. Daily max, min and swing per site.
  Mars terrain      NASA PDS (HiRISE, Mars Reconnaissance Orbiter): HiRISE stereo DTMs (~1 m) from the PDS DTM index.
  Earth temperature NASA Worldview / GIBS: MODIS Terra monthly land surface temperature, day and night layers,
                    decoded to kelvin with the layer's published colour map.

Every function returns the values together with the exact product it read.
"""
import csv
import io
import math
import time
import os
import re
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

import numpy as np
import requests

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".img,.IMG,.lbl,.LBL,.tif")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")
# every HTTP request gives up instead of hanging: without these a stalled range request waits forever
os.environ.setdefault("GDAL_HTTP_TIMEOUT", "30")
os.environ.setdefault("GDAL_HTTP_CONNECTTIMEOUT", "15")
if os.path.isfile("/root/.ccr/ca-bundle.crt"):   # dev sandbox proxy only; isfile() never raises, Path.exists() does when /root is unreadable
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")

import rasterio  # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402
from pyproj import Transformer  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PDS_GEO = "https://pds-geosciences.wustl.edu"
LOLA_GDR = f"{PDS_GEO}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr"
DIVINER_GCP = f"{PDS_GEO}/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp"
HIRISE = "https://hirise-pds.lpl.arizona.edu/PDS"
GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
MOON_R = 1737400.0
MARS_R = 3396190.0


def _window(url: str, lon: float, lat: float, extent_m: float, grid: int, scale: float = 1.0, unit_m: float = 1.0, sub: int = 0) -> np.ndarray:
    """A grid x grid window of extent_m around (lon, lat) from a projected PDS raster, heights in metres.
    sub > 0: for very fine rasters (HiRISE, ~1 m) read sub x sub samples per output cell with nearest sampling and
    average them, so only those rows are downloaded instead of every row of a 2 km window."""
    if sub:
        return _window_rows(url, lon, lat, extent_m, grid, scale, unit_m, sub)
    with rasterio.open("/vsicurl/" + url) as ds:
        tr = Transformer.from_crs(ds.crs.geodetic_crs, ds.crs, always_xy=True)
        x, y = tr.transform(lon, lat)
        h = extent_m / 2
        w = from_bounds(x - h, y - h, x + h, y + h, ds.transform)
        n = grid * sub if sub else grid
        # Upsampling (the raster is coarser than the output grid, e.g. LOLA's 29.6 m tiles onto 15.6 m cells) must
        # interpolate: averaging repeats each source height in about two cells, which draws regular stair-steps and
        # inflates slope and roughness. Downsampling keeps the area average.
        up = w.width < n
        if up and not sub:
            # read the native heights (as floats: some products are integers in 0.5 m steps, and resampling inside the
            # reader would round the blended values back onto those steps), then fit a smooth cubic surface through them
            from rasterio.windows import Window
            from scipy.ndimage import map_coordinates
            c0, r0 = int(math.floor(w.col_off)) - 2, int(math.floor(w.row_off)) - 2
            w2 = Window(c0, r0, int(math.ceil(w.width)) + 5, int(math.ceil(w.height)) + 5)
            fill = ds.nodata if ds.nodata is not None else -32768
            nat = ds.read(1, window=w2, boundless=True, fill_value=fill).astype(np.float64)
            bad = np.isclose(nat, fill) | (nat < -1e30)
            if ds.nodata is not None:
                bad |= np.isclose(nat, ds.nodata)
            cols = (w.col_off - c0) + (np.arange(n) + 0.5) * w.width / n - 0.5
            rows = (w.row_off - r0) + (np.arange(n) + 0.5) * w.height / n - 0.5
            rr, cc = np.meshgrid(rows, cols, indexing="ij")
            filled = np.where(bad, np.nanmean(np.where(bad, np.nan, nat)) if (~bad).any() else 0.0, nat)
            a = map_coordinates(filled, [rr, cc], order=3, mode="nearest")
            a[map_coordinates(bad.astype(np.float64), [rr, cc], order=1, mode="nearest") > 0.25] = np.nan
            return a * scale * unit_m
        a = ds.read(1, window=w, out_shape=(n, n), boundless=True, fill_value=np.nan,
                    resampling=rasterio.enums.Resampling.nearest if sub else rasterio.enums.Resampling.average).astype(np.float64)
        if ds.nodata is not None:
            a[np.isclose(a, ds.nodata) | (a < -1e30)] = np.nan
        if sub:
            a = np.nanmean(a.reshape(grid, sub, grid, sub), axis=(1, 3))
        return a * scale * unit_m


@lru_cache(maxsize=64)
def _pds_label(url: str) -> dict | None:
    """Layout of a PDS3 raster with an attached label (HiRISE DTMs): where the image starts and how a row is stored."""
    import requests
    r = requests.get(url, headers={"Range": "bytes=0-32767"}, timeout=(15, 60))
    if r.status_code != 206:
        return None
    txt = r.content.decode("latin1")
    txt = txt[: txt.find("\nEND") if "\nEND" in txt else len(txt)]

    def val(key):
        m = re.search(r"^\s*" + re.escape(key) + r"\s*=\s*(.+?)\s*$", txt, re.M)
        return m.group(1).strip().strip('"') if m else None
    rec, ptr, lines, samples = val("RECORD_BYTES"), val("^IMAGE"), val("LINES"), val("LINE_SAMPLES")
    if not (rec and ptr and lines and samples) or val("SAMPLE_TYPE") != "PC_REAL" or val("SAMPLE_BITS") != "32":
        return None
    m = re.match(r"(\d+)\s*(<BYTES>)?", ptr)
    offset = int(m.group(1)) - 1 if m.group(2) else (int(m.group(1)) - 1) * int(rec)
    return {"offset": offset, "lines": int(lines), "samples": int(samples), "row_bytes": int(samples) * 4,
            "scale": float(val("SCALING_FACTOR") or 1.0), "add": float(val("OFFSET") or 0.0)}


def _multirange_rows(url: str, lab: dict, rows: list[int]) -> dict[int, bytes]:
    """Fetch many raster rows in a few HTTP requests (multipart byte ranges): one round trip per 128 rows instead of
    one per row, which is what makes HiRISE usable from a slow or distant connection."""
    import requests
    from concurrent.futures import ThreadPoolExecutor
    rb, off = lab["row_bytes"], lab["offset"]

    def fetch(chunk):
        spec = ",".join(f"{off + r * rb}-{off + (r + 1) * rb - 1}" for r in chunk)
        with requests.get(url, headers={"Range": "bytes=" + spec}, timeout=(15, 90), stream=True) as resp:
            if resp.status_code != 206:
                raise RuntimeError(f"archive did not return byte ranges (HTTP {resp.status_code})")
            ctype = resp.headers.get("Content-Type", "")
            body = resp.content
        parts = {}
        if "multipart/byteranges" in ctype:
            boundary = ("--" + ctype.split("boundary=")[1].strip().strip('"')).encode()
            for seg in body.split(boundary):
                head, _, data = seg.partition(b"\r\n\r\n")
                m = re.search(rb"Content-Range:\s*bytes\s+(\d+)-(\d+)", head, re.I)
                if m:
                    a0, a1 = int(m.group(1)), int(m.group(2))
                    parts[a0] = data[: a1 - a0 + 1]
        else:
            m = re.search(r"bytes\s+(\d+)-(\d+)", resp.headers.get("Content-Range", ""))
            if m:
                parts[int(m.group(1))] = body
        out = {}
        starts = sorted(parts)
        for r in chunk:
            s = off + r * rb
            for a0 in reversed(starts):          # the part that contains this row (the server may merge ranges)
                if a0 <= s and s + rb <= a0 + len(parts[a0]):
                    out[r] = parts[a0][s - a0: s - a0 + rb]
                    break
        if len(out) != len(chunk):
            raise RuntimeError("incomplete byte-range response")
        return out

    chunks = [rows[i:i + 128] for i in range(0, len(rows), 128)]
    res = {}
    with ThreadPoolExecutor(min(4, len(chunks)) or 1) as ex:
        for d in ex.map(fetch, chunks):
            res.update(d)
    return res


def _window_rows(url: str, lon: float, lat: float, extent_m: float, grid: int, scale: float, unit_m: float, sub: int) -> np.ndarray:
    """Nearest-sampled window, fetched with multipart byte ranges when the archive supports them (a few requests),
    otherwise row by row in parallel."""
    try:
        lab = _pds_label(url)
    except Exception:
        lab = None
    if lab:
        try:
            with rasterio.open("/vsicurl/" + url) as ds:
                tr = Transformer.from_crs(ds.crs.geodetic_crs, ds.crs, always_xy=True)
                x, y = tr.transform(lon, lat)
                h = extent_m / 2
                w = from_bounds(x - h, y - h, x + h, y + h, ds.transform)
            n = grid * sub
            ri = np.floor(w.row_off + (np.arange(n) + 0.5) * w.height / n).astype(int)
            ci = np.floor(w.col_off + (np.arange(n) + 0.5) * w.width / n).astype(int)
            want = sorted({int(r) for r in ri if 0 <= r < lab["lines"]})
            got = _multirange_rows(url, lab, want) if want else {}
            a = np.full((n, n), np.nan)
            okc = (ci >= 0) & (ci < lab["samples"])
            for i, r in enumerate(ri):
                if r in got:
                    row = np.frombuffer(got[r], dtype="<f4").astype(np.float64)
                    a[i, okc] = row[ci[okc]]
            a[a < -1e30] = np.nan
            a = a * lab["scale"] + lab["add"]
            a = np.nanmean(a.reshape(grid, sub, grid, sub), axis=(1, 3))
            return a * scale * unit_m
        except Exception:
            pass   # fall back to the row-by-row reader below
    return _window_rows_parallel(url, lon, lat, extent_m, grid, scale, unit_m, sub)


def _window_rows_parallel(url: str, lon: float, lat: float, extent_m: float, grid: int, scale: float, unit_m: float, sub: int) -> np.ndarray:
    """Same result as the nearest-sampled read in _window, but the sampled rows are fetched in parallel. Each row of a
    PDS raster is a separate HTTP range request, and the HiRISE server answers them slowly one at a time (a 2 km window
    took over two minutes sequentially; in parallel it takes seconds)."""
    from concurrent.futures import ThreadPoolExecutor
    from rasterio.windows import Window
    src = "/vsicurl/" + url
    with rasterio.open(src) as ds:
        tr = Transformer.from_crs(ds.crs.geodetic_crs, ds.crs, always_xy=True)
        x, y = tr.transform(lon, lat)
        h = extent_m / 2
        w = from_bounds(x - h, y - h, x + h, y + h, ds.transform)
        nodata = ds.nodata
    n = grid * sub
    rows = w.row_off + (np.arange(n) + 0.5) * w.height / n

    def read_row(r):
        with rasterio.open(src) as ds:
            a = ds.read(1, window=Window(w.col_off, int(r), w.width, 1), out_shape=(1, n), boundless=True,
                        fill_value=np.nan, resampling=rasterio.enums.Resampling.nearest)
        return a[0].astype(np.float64)

    with ThreadPoolExecutor(24) as ex:
        a = np.array(list(ex.map(read_row, rows)))
    if nodata is not None:
        a[np.isclose(a, nodata) | (a < -1e30)] = np.nan
    a = np.nanmean(a.reshape(grid, sub, grid, sub), axis=(1, 3))
    return a * scale * unit_m


# ---------------------------------------------------------------- Moon terrain: LOLA gridded DEMs (PDS)
def lola_product(lat: float, lon: float) -> tuple[str, float, float, float]:
    """(url, native resolution m, scale, unit) of the finest-but-practical LOLA GDR covering the point."""
    hemi = "s" if lat < 0 else "n"
    a = abs(lat)
    if a >= 85:
        return f"{LOLA_GDR}/polar/float_img/ldem_85{hemi}_20m_float.lbl", 20.0, 1.0, 1000.0
    if a >= 80:
        return f"{LOLA_GDR}/polar/float_img/ldem_80{hemi}_20m_float.lbl", 20.0, 1.0, 1000.0
    if a >= 75:
        return f"{LOLA_GDR}/polar/float_img/ldem_75{hemi}_30m_float.lbl", 30.0, 1.0, 1000.0
    if a >= 60:
        return f"{LOLA_GDR}/polar/float_img/ldem_60{hemi}_60m_float.lbl", 60.0, 1.0, 1000.0
    # LDEM_1024 tiles: 15 degree latitude bands, 30 degree longitude bands (0-360 E), int16 x 0.5 m
    lon360 = lon % 360.0
    lo = int(lon360 // 30) * 30
    b0 = int(math.floor(lat / 15.0) * 15)
    def tag(v: int) -> str:
        return f"{abs(v):02d}{'s' if v < 0 else 'n'}"
    return f"{LOLA_GDR}/cylindrical/img/ldem_1024_{tag(b0)}_{tag(b0 + 15)}_{lo:03d}_{lo + 30:03d}.lbl", 29.6, 0.5, 1.0


def lola_terrain(lat: float, lon: float, extent_m: float, grid: int) -> tuple[np.ndarray, dict]:
    url, res, scale, unit = lola_product(lat, lon)
    h = _window(url, lon, lat, extent_m, grid, scale, unit)
    return h, {"dataset": "LRO LOLA gridded DEM (NASA PDS Geosciences Node, LRO-L-LOLA-4-GDR)", "product": url.rsplit("/", 1)[-1].replace(".lbl", "").upper(),
               "url": url, "native_res_m": res, "offset_km": 0.0, "resampling": "bicubic when upsampling"}


# ---------------------------------------------------------------- Moon temperature: Diviner GCP (PDS)
GCP_ROW = 113            # bytes per row, including CR LF
GCP_HEADER = 113
GCP_BINS_PER_DEG = 2     # 0.5 degree bins
GCP_LT_STEPS = 96        # 0.25 h local-time steps


def diviner_temps(lat: float, lon: float) -> dict:
    """Daily maximum, minimum and swing of bolometric surface temperature from Diviner, for the 0.5 degree bin."""
    b0 = int(math.floor(lat / 10.0) * 10)
    b1 = b0 + 10
    if b0 >= 0:
        band = f"{b0:02d}n{b1:02d}n"
    elif b1 == 0:
        band = "10s00s"
    else:
        band = f"{abs(b0):02d}s{abs(b1):02d}s"
    url = f"{DIVINER_GCP}/global_cumul_avg_cyl_{band}_002.tab"
    lon180 = ((lon + 180) % 360) - 180
    li = min(719, int((lon180 + 180) * GCP_BINS_PER_DEG))
    ai = min(19, int((lat - b0) * GCP_BINS_PER_DEG))
    row = (li * 20 + ai) * GCP_LT_STEPS
    start = GCP_HEADER + row * GCP_ROW
    txt = requests.get(url, headers={"Range": f"bytes={start}-{start + GCP_LT_STEPS * GCP_ROW - 1}"}, timeout=90).text
    vals, clon, clat = [], None, None
    for line in txt.strip().splitlines():
        p = [s.strip() for s in line.split(",")]
        if len(p) < 11:
            continue
        clon, clat = float(p[0]), float(p[1])
        t = float(p[10])
        if t > 0:
            vals.append(t)
    if clon is None or abs(clon - (-179.75 + li * 0.5)) > 0.01 or abs(clat - (b0 + 0.25 + ai * 0.5)) > 0.01:
        raise RuntimeError(f"Diviner bin mismatch at {lat},{lon}: got {clon},{clat}")
    if len(vals) < 8:
        raise RuntimeError("too few Diviner local-time bins with data")
    v = np.array(vals)
    tmax, tmin = float(np.percentile(v, 98)), float(np.percentile(v, 2))   # robust to single noisy bins
    return {"source": "LRO Diviner Global Cumulative Product (NASA PDS Geosciences Node)", "product": url.rsplit("/", 1)[-1],
            "bin_centre": [clat, clon], "local_time_bins": int(len(v)),
            "temp_max_c": round(tmax - 273.15, 1), "temp_min_c": round(tmin - 273.15, 1), "temp_delta_c": round(tmax - tmin, 1),
            "status": "measured"}


# ---------------------------------------------------------------- Mars terrain: HiRISE DTMs (PDS)
@lru_cache(maxsize=1)
def hirise_index() -> list[dict]:
    path = RAW / "hirise_dtmcumindex.tab"
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        path.write_bytes(requests.get(f"{HIRISE}/INDEX/DTMCUMINDEX.TAB", timeout=120).content)
    out = []
    for r in csv.reader(io.StringIO(path.read_text(errors="ignore")), skipinitialspace=True):
        f = r[1].strip()
        if not (f.upper().endswith(".IMG") and f.split("/")[-1].startswith("DTE")):
            continue
        out.append({"file": f, "why": r[7].strip(), "lat0": float(r[15]), "lat1": float(r[16]), "lon0": float(r[17]), "lon1": float(r[18]), "res": float(r[19])})
    return out


def _gc_km(lat1, lon1, lat2, lon2, r_km):
    a, b, c, d = map(math.radians, (lat1, lon1, lat2, lon2))
    return r_km * math.acos(max(-1.0, min(1.0, math.sin(a) * math.sin(c) + math.cos(a) * math.cos(c) * math.cos(b - d))))


_HIRISE_LOCK = __import__("threading").Lock()


def hirise_terrain(lat: float, lon: float, extent_m: float, grid: int, max_km: float = 400.0, budget_s: float = 150.0) -> tuple[np.ndarray, dict]:
    """The nearest HiRISE DTM: a window on the site if the DTM covers it, otherwise on the DTM's own centre (offset reported).
    One HiRISE read runs at a time: parallel requests (a second click while the first is still working) made the
    archive throttle both until they timed out."""
    t_wait = time.time()
    if not _HIRISE_LOCK.acquire(timeout=budget_s):
        raise RuntimeError("another Mars point is still being measured; try again in a moment (the archive answered too slowly)")
    try:
        return _hirise_terrain(lat, lon, extent_m, grid, max_km, budget_s - (time.time() - t_wait))
    finally:
        _HIRISE_LOCK.release()


def _hirise_terrain(lat: float, lon: float, extent_m: float, grid: int, max_km: float, budget_s: float) -> tuple[np.ndarray, dict]:
    lon360 = lon % 360.0
    cands = []
    for d in hirise_index():
        inside = d["lat0"] + 0.02 <= lat <= d["lat1"] - 0.02 and d["lon0"] + 0.02 <= lon360 <= d["lon1"] - 0.02
        clat, clon = (d["lat0"] + d["lat1"]) / 2, (d["lon0"] + d["lon1"]) / 2
        dist = 0.0 if inside else _gc_km(lat, lon360, clat, clon, MARS_R / 1000)
        cands.append((dist, d["res"], d, inside, clat, clon))
    cands.sort(key=lambda c: (c[0], c[1]))
    t_start = time.time()
    if not cands or cands[0][0] > max_km:
        raise RuntimeError(f"no HiRISE terrain model lies within {max_km:.0f} km of this point (HiRISE has mapped only small patches of Mars; "
                           f"the nearest is {cands[0][0]:.0f} km away). Try a point nearer a landing site, crater or channel." if cands else "the HiRISE index is empty")
    tried = []
    for dist, _, d, inside, clat, clon in cands[:4]:
        if dist > max_km:
            break
        if time.time() - t_start > budget_s:
            raise RuntimeError(f"the HiRISE archive answered too slowly (over {budget_s:.0f} s); try again or pick another point")
        url = f"{HIRISE}/{d['file']}"
        # inside a strip: the point itself, then the same point moved halfway towards the strip centre (HiRISE DTMs
        # are narrow, so a 2 km window at a point near the edge runs off the data)
        tries = [(lat, lon360), (lat + (clat - lat) * 0.5, lon360 + (clon - lon360) * 0.5)] if inside else []
        # along the strip: centre and two points along its long axis
        tries += [(clat, clon), (d["lat0"] + (d["lat1"] - d["lat0"]) * 0.3, clon), (d["lat0"] + (d["lat1"] - d["lat0"]) * 0.7, clon)]
        for tl, tn in tries:
            if time.time() - t_start > budget_s:
                raise RuntimeError(f"the HiRISE archive answered too slowly (over {budget_s:.0f} s); try again or pick another point")
            # cheap 16-row probe first: skip windows that run off the DTM before paying for the full read
            try:
                probe = _window(url, tn if tn <= 180 else tn - 360, tl, extent_m, 16, sub=1)
                if np.mean(~np.isfinite(probe)) > 0.1:
                    continue
            except Exception:
                pass
            try:
                h = _window(url, tn if tn <= 180 else tn - 360, tl, extent_m, grid, sub=3)
            except Exception:
                try:
                    h = _window(url, tn, tl, extent_m, grid, sub=3)
                except Exception:
                    continue
            if np.mean(~np.isfinite(h)) <= 0.1:
                off = 0.0 if (tl, tn) == (lat, lon360) else _gc_km(lat, lon360, tl, tn, MARS_R / 1000)
                return h, {"dataset": "MRO HiRISE stereo DTM (NASA PDS, HiRISE team)", "product": d["file"].split("/")[-1].replace(".IMG", ""),
                           "url": url, "native_res_m": d["res"], "offset_km": round(off, 1), "window_centre": {"lat": round(tl, 3), "lon": round(((tn + 180) % 360) - 180, 3)},
                           "dtm_rationale": d["why"]}
    raise RuntimeError("the HiRISE terrain models near this point do not give a complete 2 km window (they are narrow strips with gaps); try a point nearby")


# ---------------------------------------------------------------- Earth temperature: MODIS LST via NASA Worldview (GIBS)
@lru_cache(maxsize=1)
def lst_colormap() -> dict:
    xml = requests.get("https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_Land_Surface_Temp.xml", timeout=60).text
    root = ET.fromstring(xml)
    lut = {}
    for e in root.iter("ColorMapEntry"):
        if e.get("nodata") == "true" or e.get("value") is None:
            continue
        lo, hi = [float(v) for v in re.findall(r"[-\d.]+", e.get("value"))[:2]]
        lut[tuple(int(c) for c in e.get("rgb").split(","))] = (lo + hi) / 2
    return lut


def _lst_month(layer: str, date: str, lat: float, lon: float, half_deg: float = 0.02) -> float | None:
    from PIL import Image
    params = {"SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.1.1", "LAYERS": layer, "STYLES": "", "FORMAT": "image/png",
              "SRS": "EPSG:4326", "BBOX": f"{lon - half_deg},{lat - half_deg},{lon + half_deg},{lat + half_deg}", "WIDTH": 8, "HEIGHT": 8, "TIME": date}
    r = requests.get(GIBS_WMS, params=params, timeout=60)
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image"):
        return None
    im = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGBA"))
    lut, vals = lst_colormap(), []
    for px in im.reshape(-1, 4):
        if px[3] == 0:
            continue
        k = (int(px[0]), int(px[1]), int(px[2]))
        if k in lut:
            vals.append(lut[k])
    return float(np.median(vals)) if vals else None


def modis_lst(lat: float, lon: float, year: int = 2023) -> dict:
    """Typical daytime high (warmest month) and night low (coldest month) of the land surface, from MODIS Terra monthly LST."""
    day, night = [], []
    for m in range(1, 13):
        d = f"{year}-{m:02d}-01"
        day.append(_lst_month("MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day", d, lat, lon))
        night.append(_lst_month("MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night", d, lat, lon))
    dv = [v for v in day if v is not None]
    nv = [v for v in night if v is not None]
    if len(dv) < 3 or len(nv) < 3:
        raise RuntimeError(f"MODIS LST has too few clear months here ({len(dv)} day, {len(nv)} night)")
    pairs = [d - n for d, n in zip(day, night) if d is not None and n is not None]
    return {"source": "MODIS Terra monthly land surface temperature (NASA Worldview / GIBS), decoded from the layer colour map",
            "layers": ["MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day", "MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night"], "year": year,
            "months_day": len(dv), "months_night": len(nv),
            "temp_max_c": round(max(dv) - 273.15, 1), "temp_min_c": round(min(nv) - 273.15, 1),
            "temp_delta_c": round(float(np.mean(pairs)) if pairs else max(dv) - min(nv), 1), "status": "measured"}


# ---------------------------------------------------------------- Earth vegetation: MODIS monthly NDVI via NASA Worldview (GIBS)
@lru_cache(maxsize=1)
def ndvi_colormap() -> dict:
    xml = requests.get("https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml", timeout=60).text
    lut = {}
    for e in ET.fromstring(xml).iter("ColorMapEntry"):
        if e.get("nodata") == "true" or e.get("value") is None:
            continue
        lo, hi = [float(v) for v in re.findall(r"[-\d.]+", e.get("value"))[:2]]
        lut[tuple(int(c) for c in e.get("rgb").split(","))] = (lo + hi) / 2
    return lut


def modis_ndvi(lat: float, lon: float, year: int = 2023) -> dict:
    """Greenest-month and mean NDVI of the land around the site from MODIS Terra monthly NDVI (1 km), over one year."""
    from PIL import Image
    lut, months = ndvi_colormap(), []
    for m in range(1, 13):
        params = {"SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.1.1", "LAYERS": "MODIS_Terra_L3_NDVI_Monthly", "STYLES": "", "FORMAT": "image/png",
                  "SRS": "EPSG:4326", "BBOX": f"{lon - 0.015},{lat - 0.015},{lon + 0.015},{lat + 0.015}", "WIDTH": 8, "HEIGHT": 8, "TIME": f"{year}-{m:02d}-01"}
        r = requests.get(GIBS_WMS, params=params, timeout=60)
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image"):
            continue
        im = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGBA")).reshape(-1, 4)
        vals = [lut[(int(p[0]), int(p[1]), int(p[2]))] for p in im if p[3] > 0 and (int(p[0]), int(p[1]), int(p[2])) in lut]
        if vals:
            months.append(float(np.median(vals)))
    if len(months) < 3:
        raise RuntimeError("MODIS NDVI has too few valid months here")
    return {"source": "MODIS Terra monthly NDVI (NASA Worldview / GIBS), decoded from the layer colour map", "layer": "MODIS_Terra_L3_NDVI_Monthly",
            "year": year, "months": len(months), "ndvi_max_month": round(max(months), 3), "ndvi_mean": round(float(np.mean(months)), 3), "status": "measured"}
