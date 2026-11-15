import json
import time
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
TILES_PATH = ROOT / "data" / "processed" / "tiles.parquet"
CONFIG_PATH = ROOT / "data" / "config" / "sites.json"

FEATURE_COLS = [
    "slope_mean", "slope_p90", "tri_ruggedness", "concavity",
    "sar_backscatter", "sar_entropy", "sar_contrast",
    "bareness_index", "iron_oxide_ratio", "clay_hydroxyl_ratio", "albedo",
    "temp_min_c", "temp_max_c", "temp_delta_c"
]

# Plain labels per feature and which provenance group of a site's row says where the value came from.
FEATURE_META = {
    "slope_mean": {"label": "Mean Slope", "unit": "deg", "pillar": "topo", "group": "topography"},
    "slope_p90": {"label": "90th-Pct Slope", "unit": "deg", "pillar": "topo", "group": "topography"},
    "tri_ruggedness": {"label": "Terrain Ruggedness", "unit": "m", "pillar": "topo", "group": "topography"},
    "concavity": {"label": "Pit & Crater Concavity", "unit": "idx", "pillar": "topo", "group": "topography"},
    "sar_backscatter": {"label": "Surface Roughness", "unit": "idx", "pillar": "radar", "group": "radar"},
    "sar_entropy": {"label": "Texture Variety", "unit": "bits", "pillar": "radar", "group": "radar"},
    "sar_contrast": {"label": "Texture Contrast", "unit": "idx", "pillar": "radar", "group": "radar"},
    "bareness_index": {"label": "Bare Ground", "unit": "idx", "pillar": "mineral", "group": "mineral"},
    "iron_oxide_ratio": {"label": "Rusty (Iron-Oxide) Colour", "unit": "idx", "pillar": "mineral", "group": "mineral"},
    "clay_hydroxyl_ratio": {"label": "Clay Minerals", "unit": "idx", "pillar": "mineral", "group": "mineral"},
    "albedo": {"label": "Surface Brightness", "unit": "idx", "pillar": "mineral", "group": "mineral"},
    "temp_min_c": {"label": "Coldest Typical Temperature", "unit": "°C", "pillar": "thermal", "group": "thermal"},
    "temp_max_c": {"label": "Warmest Typical Temperature", "unit": "°C", "pillar": "thermal", "group": "thermal"},
    "temp_delta_c": {"label": "Day-Night Swing", "unit": "°C", "pillar": "thermal", "group": "thermal"},
}


def _prov(row, group: str) -> dict:
    """The provenance record of one group for one site, whether it was stored as a dict, a struct or a string."""
    p = row.get("provenance", {})
    if isinstance(p, str):
        import ast
        try:
            p = ast.literal_eval(p)
        except Exception:
            p = {}
    g = (p or {}).get(group) or {}
    return {"agency": g.get("agency", "none"), "instrument": g.get("instrument", "unknown"), "status": g.get("status", "unknown")}


PILLAR_WEIGHTS = {"topo": 0.30, "radar": 0.30, "mineral": 0.25, "thermal": 0.15}

# Earth sites with a documented history as space-agency analog or training sites. Only entries we could
# attribute are listed; every other site shows "not verified" rather than a guess.
KNOWN_PROGRAMS = {
    "earth_haughton_crater": "Haughton-Mars Project (NASA / Mars Institute), field seasons since 1997",
    "earth_utah_mdrs": "Mars Desert Research Station (The Mars Society), crewed simulations since 2001",
    "earth_rio_tinto": "MARTE drilling experiment (NASA, 2003-2005)",
    "earth_atacama_yungay": "NASA Atacama rover and drilling campaigns (e.g. ARADS, 2016-2019)",
    "earth_mauna_kea_summit": "NASA / PISCES in-situ resource utilisation field tests (2008, 2010)",
    "earth_askja_caldera": "Apollo astronaut geology training (1965, 1967)",
    "earth_craters_of_the_moon": "Apollo 14 crew geology training (1969); NASA FINESSE field work",
    "earth_barringer_crater": "Apollo astronaut geology training",
    "earth_ries_crater": "Apollo 14 crew geology training (1970)",
    "earth_lanzarote_tubes": "ESA PANGAEA astronaut geology training and cave studies",
    "earth_mcmurdo_dry_valleys": "US Antarctic Program research area; widely used as a Mars analog",
}
KNOWN_PERMITS = {
    "earth_mcmurdo_dry_valleys": "Antarctic Treaty permit through a national Antarctic programme; Antarctic Specially Managed Area",
    "earth_haughton_crater": "Nunavut Research Institute scientific research licence",
}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# How each hardware test is scored for the "best site per use" view: which feature groups matter for it, and
# whether the physics transfers at all (if not, sites are ranked on ground similarity only and the UI says so).
USES = [
    {"test": "Slope Climbing & Wheel Traction", "scenario": "rover", "weights": {"topo": 0.7, "mineral": 0.3}, "transfers": True},
    {"test": "Radar / Darkness Boulder Navigation", "scenario": "rover", "weights": {"radar": 0.6, "topo": 0.4}, "transfers": True},
    {"test": "Lander Touchdown Tilt & Stability", "scenario": "landing", "weights": {"topo": 0.5, "radar": 0.5}, "transfers": True},
    {"test": "Thruster Plume & Dust Ejecta", "scenario": "landing", "weights": {"mineral": 0.5, "radar": 0.5}, "transfers": False},
    {"test": "Rock / Ice Drill Bit Hardness", "scenario": "mining", "weights": {"mineral": 0.8, "thermal": 0.2}, "transfers": True},
    {"test": "Thermal & Vacuum Motor Cooling", "scenario": "mining", "weights": {"thermal": 1.0}, "transfers": False},
    {"test": "Low-Sun Camera Navigation & Long Shadows", "scenario": "rover", "weights": {"radar": 0.5, "topo": 0.5}, "transfers": True},
]


def _load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def noon_sun_by_month(lat: float) -> list[float]:
    """Noon solar elevation (deg) at mid-month for an Earth latitude."""
    out = []
    for m in range(12):
        doy = 15 + 30.4 * m
        decl = 23.44 * np.sin(2 * np.pi * (doy - 81) / 365.0)
        out.append(float(90 - abs(lat - decl)))
    return out


def target_max_sun(body: str, lat: float, illum: dict | None) -> float:
    if illum and "max_sun_elevation_deg" in illum:
        return float(illum["max_sun_elevation_deg"])
    tilt = 1.54 if body == "moon" else 25.2
    return float(min(90.0, 90 - abs(lat) + tilt))


PILLARS = {
    "topo": ["slope_mean", "slope_p90", "tri_ruggedness", "concavity"],
    "radar": ["sar_backscatter", "sar_entropy", "sar_contrast"],
    "mineral": ["bareness_index", "iron_oxide_ratio", "clay_hydroxyl_ratio", "albedo"],
    "thermal": ["temp_min_c", "temp_max_c", "temp_delta_c"],
}


# A feature is compared only when both sites have it measured (or derived from a measurement). Typical or modelled
# values are shown for context but never enter a score.
USABLE = ("measured", "derived")
NDVI_FULL, NDVI_ZERO = 0.25, 0.40   # bare-ground rule on the greenest-month NDVI


def _status(row, group: str) -> str:
    return _prov(row, group)["status"]


class PlanetaryAnalogEngine:
    def __init__(self):
        self.df = pd.read_parquet(TILES_PATH)
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            self.config = json.load(f)

        self.meta_by_id = {}
        for item in self.config["targets"] + self.config["earth_analogs"]:
            self.meta_by_id[item["id"]] = item

        # which rows hold a real (measured or derived) value for each feature; standardise over those rows only
        self.usable = pd.DataFrame({c: [(_status(r, FEATURE_META[c]["group"]) in USABLE) for _, r in self.df.iterrows()] for c in FEATURE_COLS}, index=self.df.index)
        self.feature_means = pd.Series({c: self.df.loc[self.usable[c], c].mean() for c in FEATURE_COLS})
        self.feature_stds = pd.Series({c: self.df.loc[self.usable[c], c].std() for c in FEATURE_COLS}).replace(0, 1.0).fillna(1.0)
        self.norm_df = (self.df[FEATURE_COLS] - self.feature_means) / self.feature_stds

        processed = ROOT / "data" / "processed"
        self.illumination = _load_json(processed / "illumination.json")


    def _param_similarities(self, target_row, earth_row, target_norm, earth_norm) -> dict:
        param_sims = {}
        for idx, col in enumerate(FEATURE_COLS):
            meta = FEATURE_META[col]
            ep, tp = _prov(earth_row, meta["group"]), _prov(target_row, meta["group"])
            compared = ep["status"] in USABLE and tp["status"] in USABLE
            sim = float(np.exp(-0.55 * abs(float(target_norm[idx]) - float(earth_norm[idx])))) if compared else None

            param_sims[col] = {
                "label": meta["label"],
                "unit": meta["unit"],
                "pillar": meta["pillar"],
                "similarity": round(sim, 3) if compared else None,
                "compared": compared,
                "target_val": round(float(target_row[col]), 3),
                "earth_val": round(float(earth_row[col]), 3),
                "earth_agency": ep["agency"],
                "earth_instrument": ep["instrument"],
                "earth_status": ep["status"],
                "space_agency": tp["agency"],
                "space_instrument": tp["instrument"],
                "space_status": tp["status"],
                # the weaker of the two, so a comparison is never shown as more certain than its worst input
                "status": ep["status"] if ep["status"] != "measured" else tp["status"],
            }
        return param_sims

    def _pillar_scores(self, param_sims: dict) -> dict:
        scores = {}
        for pillar, cols in PILLARS.items():
            vals = [param_sims[c]["similarity"] for c in cols if param_sims[c]["compared"]]
            scores[pillar] = round(float(np.mean(vals)), 3) if vals else None   # None: not measured on both sides
        return scores

    @staticmethod
    def _combine(param_sims: dict, weights: dict, drop: str | None = None) -> float:
        """Weighted score over the groups that have at least one compared feature; weights renormalised."""
        num = den = 0.0
        for pillar, cols in PILLARS.items():
            vals = [param_sims[c]["similarity"] for c in cols if param_sims[c]["compared"] and c != drop]
            if vals:
                num += weights[pillar] * float(np.mean(vals)); den += weights[pillar]
        return num / den if den else 0.0

    def _score_range(self, param_sims: dict) -> tuple[float, float]:
        """How far the score moves if any one compared measurement is left out, or any group weight shifts by 20%."""
        vals = [self._combine(param_sims, PILLAR_WEIGHTS)]
        for c, p in param_sims.items():
            if p["compared"]:
                vals.append(self._combine(param_sims, PILLAR_WEIGHTS, drop=c))
        for g in PILLAR_WEIGHTS:
            for f in (0.8, 1.2):
                w = dict(PILLAR_WEIGHTS); w[g] *= f
                vals.append(self._combine(param_sims, w))
        return float(min(vals)), float(max(vals))

    def _low_sun_row(self, target_row, earth_row, pillar_scores, sun_max: float) -> dict:
        body = target_row["body"]
        noon = noon_sun_by_month(float(earth_row["lat"]))
        nav_s = (pillar_scores["radar"] + pillar_scores["topo"]) / 2
        if sun_max <= 20:
            months = [MONTHS[i] for i, e in enumerate(noon) if 0 < e <= sun_max + 8]
            if months:
                status = "PARTIAL" if body == "moon" else "REPRESENTATIVE"
                sky = (" Earth's blue sky still lights the shadows; on the airless Moon they are pitch black, so add night or dusk runs with a single lamp."
                       if body == "moon" else "")
                reason = f"The Sun stays below about {sun_max:.0f}° at the target. Here the noon Sun is that low in {', '.join(months)}, the months to schedule camera and navigation tests.{sky}"
                conf = 0.55 + 0.35 * nav_s
            else:
                status = "NOT_REPRESENTATIVE"
                reason = f"The Sun stays below about {sun_max:.0f}° at the target, but here the noon Sun never gets that low in daylight. Shadows will be far shorter than on site."
                conf = 0.8
        else:
            status = "REPRESENTATIVE" if nav_s >= 0.6 else "PARTIAL"
            reason = f"The Sun climbs to about {min(sun_max, 90):.0f}° at the target, a normal daytime range, so lighting is comparable most of the year."
            conf = 0.5 + 0.4 * nav_s
        return {"test": "Low-Sun Camera Navigation & Long Shadows", "scenario": "rover", "status": status,
                "confidence": round(float(np.clip(conf, 0.35, 0.95)), 2), "reason": reason}

    def _build_representativeness_matrix(self, target_row, earth_row, pillar_scores, epi_std) -> list:
        bareness = float(earth_row["bareness_index"])
        seasonal = earth_row.get("ndvi_season_max")
        is_vegetated = (float(seasonal) >= NDVI_ZERO) if seasonal is not None and np.isfinite(seasonal) else bareness < 0.70
        g_t = float(target_row["gravity_m_s2"])
        p_t = float(target_row["pressure_bar"])
        body_name = target_row["body"].capitalize()

        topo_s = pillar_scores["topo"] or 0.0
        radar_s = pillar_scores["radar"] or 0.0
        min_measured = pillar_scores["mineral"] is not None
        min_s = pillar_scores["mineral"] if min_measured else 0.0
        therm_s = pillar_scores["thermal"] or 0.0

        return [
            {
                "test": "Slope Climbing & Wheel Traction",
                "scenario": "rover",
                "status": "PARTIAL" if is_vegetated else ("REPRESENTATIVE" if topo_s >= 0.65 else "PARTIAL"),
                "confidence": round(float(np.clip(topo_s - epi_std[0] * 0.5, 0.35, 0.96)), 2),
                "reason": (
                    f"Slopes match ({int(topo_s*100)}%), but plants and moist soil change how tyres grip."
                    if is_vegetated
                    else f"Slope and ruggedness match ({int(topo_s*100)}%), though {body_name}'s {g_t} m/s² gravity presses the wheels down less, so grip is lower there."
                ),
            },
            {
                "test": "Radar / Darkness Boulder Navigation",
                "scenario": "rover",
                "status": "NOT_REPRESENTATIVE" if is_vegetated else ("REPRESENTATIVE" if radar_s >= 0.65 else "PARTIAL"),
                "confidence": round(float(np.clip(radar_s - epi_std[0] * 0.4, 0.35, 0.95)), 2),
                "reason": (
                    "Plant cover hides the rocks and changes the surface texture, so navigation tests do not transfer."
                    if is_vegetated
                    else f"Surface texture from the elevation grid matches ({int(radar_s*100)}%). Rock-scale texture needs radar or rover imagery to confirm."
                ),
            },
            {
                "test": "Lander Touchdown Tilt & Stability",
                "scenario": "landing",
                "status": "REPRESENTATIVE" if (topo_s >= 0.60 and radar_s >= 0.60) else "PARTIAL",
                "confidence": round(float(np.clip((topo_s + radar_s) / 2 - epi_std[1] * 0.5, 0.35, 0.94)), 2),
                "reason": f"Slope distribution matches ({int(topo_s*100)}%), so it can test whether lander legs stay upright on touchdown.",
            },
            {
                "test": "Thruster Plume & Dust Ejecta",
                "scenario": "landing",
                "status": "NOT_REPRESENTATIVE" if p_t < 0.05 else "PARTIAL",
                "confidence": round(float(np.clip(0.88 - epi_std[1], 0.50, 0.95)), 2),
                "reason": f"Earth's 1 bar air slows engine exhaust and dust; at {p_t} bar on {body_name} the blast throws regolith far and fast. Earth rarely stands in for this.",
            },
            {
                "test": "Rock / Ice Drill Bit Hardness",
                "scenario": "mining",
                "status": "NOT_REPRESENTATIVE" if is_vegetated else ("PARTIAL" if not min_measured else ("REPRESENTATIVE" if min_s >= 0.65 else "PARTIAL")),
                "confidence": round(float(np.clip(min_s - epi_std[2] * 0.4, 0.35, 0.95)), 2) if min_measured else 0.4,
                "reason": (
                    f"Plants cover much of the ground in the growing season: wet, organic soil does not behave like dry regolith."
                    if is_vegetated
                    else (f"Surface composition ({earth_row['mineral_profile'].replace('_', ' ')}) is close to the target's ({int(min_s*100)}% match)." if min_measured
                          else f"The ground here is bare, but {body_name}'s rock and soil are not measured in our data, so how similar the rock is cannot be scored. Check the rock type before relying on drill tests.")
                ),
            },
            {
                "test": "Thermal & Vacuum Motor Cooling",
                "scenario": "mining",
                "status": "NOT_REPRESENTATIVE",
                "confidence": round(float(np.clip(0.92 - therm_s * 0.1, 0.70, 0.96)), 2),
                "reason": f"Never transfers: on Earth the air carries heat away from motors and drill bits; at {p_t} bar on {body_name} there is almost no air, so hardware keeps its heat and can seize.",
            },
        ]

    def match(self, target_site_id: str, top_k: int = 60, include_ai: bool = False) -> dict:
        target_row = self.df[self.df["site_id"] == target_site_id]
        if target_row.empty:
            raise ValueError(f"Target site '{target_site_id}' not found.")
        target_row = target_row.iloc[0]
        target_meta = self.meta_by_id[target_site_id]
        target_norm = self.norm_df.loc[target_row.name].values
        extra = []
        if include_ai:
            # the places the AI found for this destination (with its estimate), then every other AI find on the same world,
            # all scored exactly, so a listed destination and a picked point see the same set of places
            extra = self._ai_rows(target_site_id)
            own = {r[0]["site_id"] for r in extra}
            extra += [r for r in self.ai_pool_rows(target_row["body"]) if r[0]["site_id"] not in own]
        return self.match_row(target_row, target_meta, target_norm, top_k, extra_rows=extra)

    def _ai_rows(self, target_id: str) -> list:
        """Places found by the AI search (06_ai_discovery.py) for this target, as extra Earth rows with their measured
        features, so they are ranked, explained and playable like the named sites."""
        disc = _load_json(ROOT / "data" / "processed" / "discoveries.json").get("targets", {}).get(target_id, [])
        cands = _load_json(ROOT / "data" / "processed" / "ai_candidates.json")
        rows = []
        for d in disc:
            cid = d.get("id")
            if not cid or cid not in cands:
                continue
            r = pd.Series(cands[cid])
            norm = ((pd.Series({c: r[c] for c in FEATURE_COLS}) - self.feature_means) / self.feature_stds).values
            meta = {"geology": f"Found by the AI search: an unnamed place at {d['lat']:.2f}, {d['lon']:.2f}. The AI guessed {round(d['ai_score'] * 100)} (range {round(d['ai_low'] * 100)}-{round(d['ai_high'] * 100)}); the score shown here was then measured exactly from real data.",
                    "ai": {k: d[k] for k in ("ai_score", "ai_low", "ai_high", "ai_sigma", "confident")}}
            rows.append((r, norm, meta))
        return rows

    def ai_pool_rows(self, body: str) -> list:
        """For a point the user picked: every place the AI search found for any listed destination on this world,
        scored exactly against the point. The AI model itself only estimates scores for the 28 listed destinations,
        so these rows carry no AI estimate."""
        disc = _load_json(ROOT / "data" / "processed" / "discoveries.json").get("targets", {})
        cands = _load_json(ROOT / "data" / "processed" / "ai_candidates.json")
        rows, seen = [], set()
        for tid, lst in disc.items():
            tmeta = self.meta_by_id.get(tid, {})
            if tmeta.get("body", tid.split("_")[0]) != body:
                continue
            for d in lst:
                cid = d.get("id")
                if not cid or cid in seen or cid not in cands:
                    continue
                seen.add(cid)
                r = pd.Series(cands[cid])
                norm = ((pd.Series({c: r[c] for c in FEATURE_COLS}) - self.feature_means) / self.feature_stds).values
                found_for = tmeta.get("name", tid)
                meta = {"geology": f"Found by the AI search (while looking for places like {found_for}): an unnamed place at {d['lat']:.2f}, {d['lon']:.2f}. Its score for your point was measured exactly from real data.",
                        "ai": {"found_for": found_for}}
                rows.append((r, norm, meta))
        return rows

    def normalise(self, row: dict) -> np.ndarray:
        return ((pd.Series({c: row[c] for c in FEATURE_COLS}) - self.feature_means) / self.feature_stds).values

    def _contributions(self, param_sims: dict, gate: float) -> tuple[list, list, list]:
        """Points each feature adds to the 0-100 score: group weight shared equally by the group's features."""
        # only compared measurements carry points; group weights are shared out over the groups that were compared
        n_cmp = {g: sum(1 for c in cols if param_sims[c]["compared"]) for g, cols in PILLARS.items()}
        wsum = sum(PILLAR_WEIGHTS[g] for g in PILLARS if n_cmp[g]) or 1.0
        rows = []
        for col, p in param_sims.items():
            g = p["pillar"]
            if not p["compared"]:
                rows.append({"feature": col, "label": p["label"], "pillar": g, "similarity": None, "points": 0.0, "max_points": 0.0, "lost": 0.0, "compared": False})
                continue
            share = 100.0 * (PILLAR_WEIGHTS[g] / wsum) / n_cmp[g]
            rows.append({"feature": col, "label": p["label"], "pillar": g, "similarity": p["similarity"],
                         "points": round(share * p["similarity"] * gate, 2), "max_points": round(share, 2),
                         "lost": round(share * (1 - p["similarity"] * gate), 2), "compared": True})
        cmp_rows = [r for r in rows if r["compared"]]
        helps = [r["label"] for r in sorted(cmp_rows, key=lambda r: -r["points"])[:3]]
        hurts = [r["label"] for r in sorted(cmp_rows, key=lambda r: -r["lost"])[:3]]
        return sorted(rows, key=lambda r: (not r["compared"], -r["points"])), helps, hurts

    def _field_readiness(self, earth_row, low_sun_row: dict) -> dict:
        sid = earth_row["site_id"]
        lat = float(earth_row["lat"])
        tmin, tmax = float(earth_row["temp_min_c"]), float(earth_row["temp_max_c"])
        north = lat >= 0
        if abs(lat) >= 60 or tmin <= -25:
            season = "Jun-Aug" if north else "Nov-Feb"
            why = "cold winters"
        elif tmax >= 38:
            season = "Nov-Mar" if north else "May-Sep"
            why = "hot summers"
        else:
            season = "most of the year"
            why = "mild climate"
        return {
            "analog_history": KNOWN_PROGRAMS.get(sid),
            "analog_history_status": "documented" if sid in KNOWN_PROGRAMS else "not verified",
            "permits": KNOWN_PERMITS.get(sid, "Not verified: check land ownership, protected-area rules and local research permits."),
            "permits_status": "documented" if sid in KNOWN_PERMITS else "not verified",
            "field_season": season,
            "field_season_basis": f"Rule of thumb from satellite ground temperatures ({why}: typical low {tmin:.0f} °C, high {tmax:.0f} °C)",
            "low_sun_test_months": low_sun_row["reason"],
            "elevation_m": float(earth_row["elevation_m"]),
            "infrastructure": "Not verified: road access, power and nearest airport should be checked before planning a campaign.",
        }

    def target_extras(self, target_row) -> dict:
        sid = target_row["site_id"]
        meta = self.meta_by_id.get(sid, {})
        illum = self.illumination.get(sid)
        body = target_row["body"]
        return {
            "artemis": meta.get("artemis"),
            "illumination": illum,
            "night_ir": None,
            "max_sun_elevation_deg": round(target_max_sun(body, float(target_row["lat"]), illum), 1),
        }

    def match_row(self, target_row, target_meta: dict, target_norm: np.ndarray, top_k: int = 60, extras: dict | None = None, extra_rows: list | None = None) -> dict:
        t0 = time.perf_counter()
        extras = extras if extras is not None else self.target_extras(target_row)
        sun_max = extras["max_sun_elevation_deg"]

        earth_df = self.df[self.df["body"] == "earth"]
        matches = []

        rows = [(earth_row, self.norm_df.loc[idx].values, self.meta_by_id[earth_row["site_id"]]) for idx, earth_row in earth_df.iterrows()]
        rows += list(extra_rows or [])
        for earth_row, earth_norm, earth_meta in rows:

            param_sims = self._param_similarities(target_row, earth_row, target_norm, earth_norm)
            pillar_scores = self._pillar_scores(param_sims)

            overall_sim = self._combine(param_sims, PILLAR_WEIGHTS)
            lo_r, hi_r = self._score_range(param_sims)
            # Bare-ground rule: the Moon and Mars have no plants and no open water, so a site covered by either cannot
            # be an analog whatever its shape. Full score at Sentinel-2 NDVI <= 0.20, falling to zero at 0.30; likewise
            # full score up to 20% open water in the window, falling to zero at 50%.
            # vegetation from the greenest month of the year (MODIS NDVI); full score at <= 0.25, zero at >= 0.40
            seasonal = earth_row.get("ndvi_season_max")
            ndvi = float(seasonal) if seasonal is not None and np.isfinite(seasonal) else 1.0 - float(earth_row["bareness_index"])
            water = float(earth_row.get("water_fraction", 0.0) or 0.0)
            veg_gate = float(np.clip((NDVI_ZERO - ndvi) / (NDVI_ZERO - NDVI_FULL), 0.0, 1.0) * np.clip((0.50 - water) / 0.30, 0.0, 1.0))
            ungated_sim = overall_sim
            overall_sim = overall_sim * veg_gate

            lo_r, hi_r = lo_r * veg_gate, hi_r * veg_gate
            half = (hi_r - lo_r) / 2
            epi_std = np.full(3, half)

            rep_matrix = self._build_representativeness_matrix(target_row, earth_row, pillar_scores, epi_std)
            rep_matrix.append(self._low_sun_row(target_row, earth_row, pillar_scores, sun_max))
            contributions, helps, hurts = self._contributions(param_sims, veg_gate)

            def _use(keys):
                v = [pillar_scores[k] for k in keys if pillar_scores[k] is not None]
                return round(float(np.mean(v)) * veg_gate, 3) if v else None
            scenarios = {
                "rover": {"status": "valid" if rep_matrix[0]["status"] == "REPRESENTATIVE" else "partial", "score": _use(["topo", "radar"]), "uncertainty": round(half, 3),
                          "conformal_interval": [round(lo_r, 3), round(hi_r, 3)], "note": rep_matrix[0]["reason"]},
                "landing": {"status": "partial", "score": _use(["topo", "radar"]), "uncertainty": round(half, 3),
                            "conformal_interval": [round(lo_r, 3), round(hi_r, 3)], "note": rep_matrix[2]["reason"]},
                "mining": {"status": "partial", "score": _use(["mineral"]), "uncertainty": round(half, 3),
                           "conformal_interval": [round(lo_r, 3), round(hi_r, 3)], "note": rep_matrix[4]["reason"]},
            }

            raw_curve = earth_row.get("diurnal_sol_curve", [])
            diurnal_curve = list(raw_curve) if hasattr(raw_curve, "__iter__") else []

            matches.append({
                "ai": earth_meta.get("ai"),
                "id": earth_row["site_id"],
                "name": earth_row["name"],
                "type": earth_row["type"],
                "lat": float(earth_row["lat"]),
                "lon": float(earth_row["lon"]),
                "elevation_m": float(earth_row["elevation_m"]),
                "morphology": earth_row["morphology"],
                "mineral_profile": earth_row["mineral_profile"],
                "geology": earth_meta.get("geology", ""),
                "similarity_score": round(float(overall_sim), 3),
                "similarity_before_vegetation_rule": round(float(ungated_sim), 3),
                "vegetation_gate": round(veg_gate, 3),
                "ndvi": round(ndvi, 3),
                "water_fraction": round(water, 3),
                # range of the score if any one compared measurement is dropped or a group weight shifts by 20%
                "epistemic_uncertainty": round(half, 3),
                "conformal_90_interval": [round(lo_r, 3), round(hi_r, 3)],
                "score_range": [round(lo_r, 3), round(hi_r, 3)],
                "groups_compared": [k for k, v in pillar_scores.items() if v is not None],
                "pillar_scores": pillar_scores,
                "contributions": contributions,
                "why": {"helps": helps, "hurts": hurts,
                        "gate_note": None if veg_gate >= 0.999 else f"Score multiplied by {veg_gate:.2f}: the land here turns green with plants in its greenest month, or is partly open water ({int(water * 100)}%)."},
                "field_readiness": self._field_readiness(earth_row, rep_matrix[-1]),
                "parameter_similarities": param_sims,
                "representativeness_matrix": rep_matrix,
                "scenarios": scenarios,
                "diurnal_sol_curve": diurnal_curve,
                "heightmap_url": f"/static/assets/{earth_row['site_id']}_dem.json",
                "radar_url": f"/static/assets/{earth_row['site_id']}_sar.json",
            })

        matches.sort(key=lambda x: x["similarity_score"], reverse=True)
        for rank_idx, m in enumerate(matches, 1):
            m["rank"] = rank_idx

        test_names = [row["test"] for row in matches[0]["representativeness_matrix"]]
        best_per_test = []
        for t_idx, t_name in enumerate(test_names):
            def test_score(m):
                row = m["representativeness_matrix"][t_idx]
                status_bonus = 2.0 if row["status"] == "REPRESENTATIVE" else (1.0 if row["status"] == "PARTIAL" else 0.0)
                return status_bonus + row["confidence"] + m["similarity_score"] * 0.5

            winner = max(matches, key=test_score)
            w_row = winner["representativeness_matrix"][t_idx]
            best_per_test.append({
                "test": t_name,
                "scenario": w_row["scenario"],
                "best_site_id": winner["id"],
                "best_site_name": winner["name"],
                "rank": winner["rank"],
                "status": w_row["status"],
                "confidence": w_row["confidence"],
                "reason": w_row["reason"],
            })

        functional = []
        for t_idx, use in enumerate(USES):
            def use_score(m):
                avail = {k: w for k, w in use["weights"].items() if m["pillar_scores"][k] is not None}
                if not avail:
                    return 0.0
                base = sum(w * m["pillar_scores"][k] for k, w in avail.items()) / sum(avail.values()) * m["vegetation_gate"]
                st = m["representativeness_matrix"][t_idx]["status"]
                return base * (1.0 if st == "REPRESENTATIVE" else 0.85 if st == "PARTIAL" else 0.6)
            ranked = sorted(matches, key=use_score, reverse=True)[:5]
            functional.append({
                "test": use["test"], "scenario": use["scenario"], "transfers": use["transfers"],
                "uses": [k for k in use["weights"]],
                "note": None if use["transfers"] else "The physics of this test does not transfer from Earth (air pressure); sites are ranked only by how similar the ground is.",
                "top": [{"id": m["id"], "name": m["name"], "overall_rank": m["rank"], "use_score": round(use_score(m), 3),
                         "status": m["representativeness_matrix"][t_idx]["status"], "reason": m["representativeness_matrix"][t_idx]["reason"]} for m in ranked],
            })

        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        target_curve = target_row.get("diurnal_sol_curve", [])

        return {
            "search_time_ms": elapsed_ms,
            "earth_sites_scanned": len(rows),
            "target": {
                "id": target_row["site_id"],
                "name": target_row["name"],
                "body": target_row["body"],
                "lat": float(target_row["lat"]),
                "lon": float(target_row["lon"]),
                "elevation_m": float(target_row["elevation_m"]),
                "gravity": float(target_row["gravity_m_s2"]),
                "pressure_bar": float(target_row["pressure_bar"]),
                "temp_min_c": float(target_row["temp_min_c"]),
                "temp_max_c": float(target_row["temp_max_c"]),
                "morphology": target_row["morphology"],
                "mineral_profile": target_row["mineral_profile"],
                "primary_challenge": target_meta.get("primary_challenge", ""),
                "recommended_hardware_test": target_meta.get("recommended_hardware_test", ""),
                "diurnal_sol_curve": list(target_curve) if hasattr(target_curve, "__iter__") else [],
                "heightmap_url": f"/static/assets/{target_row['site_id']}_dem.json",
                "radar_url": f"/static/assets/{target_row['site_id']}_sar.json",
                **extras,
            },
            "overall_best_id": matches[0]["id"],
            "functional_rankings": functional,
            "best_per_test": best_per_test,
            "matches": matches[:top_k],
        }


def main():
    print("=" * 70)
    print("TESTING PROVENANCE & DIURNAL TELEMETRY ENGINE")
    print("=" * 70)
    engine = PlanetaryAnalogEngine()
    res = engine.match("moon_shackleton_rim", top_k=3)
    print(f"Scanned {res['earth_sites_scanned']} sites in {res['search_time_ms']} ms")
    top = res["matches"][0]
    print(f"Top Match: #{top['rank']} {top['name']} ({top['similarity_score']*100:.1f}%)")
    sample_param = list(top["parameter_similarities"].values())[0]
    print(f"Sample Provenance: {sample_param['label']} -> Earth: {sample_param['earth_agency']} {sample_param['earth_instrument']} | Space: {sample_param['space_agency']} {sample_param['space_instrument']} [{sample_param['status']}]")
    print(f"24-hr Diurnal Curve points: {len(top['diurnal_sol_curve'])} points")


if __name__ == "__main__":
    main()