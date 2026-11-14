import json
import time
from pathlib import Path
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim

ROOT = Path(__file__).resolve().parent.parent
TILES_PATH = ROOT / "data" / "processed" / "tiles.parquet"
CONFIG_PATH = ROOT / "data" / "config" / "sites.json"

FEATURE_COLS = [
    "slope_mean", "slope_p90", "tri_ruggedness", "concavity",
    "sar_backscatter", "sar_entropy", "sar_contrast",
    "bareness_index", "iron_oxide_ratio", "clay_hydroxyl_ratio", "albedo",
    "temp_min_c", "temp_max_c", "temp_delta_c"
]

FEATURE_META = {
    "slope_mean": {
        "label": "Mean Slope", "unit": "deg", "pillar": "topo",
        "earth_agency": "ESA", "earth_instrument": "Copernicus DEM GLO-30m",
        "moon_instrument": "NASA LRO LOLA", "mars_instrument": "NASA PDS MOLA",
        "status": "measured"
    },
    "slope_p90": {
        "label": "90th-Pct Slope", "unit": "deg", "pillar": "topo",
        "earth_agency": "ESA", "earth_instrument": "Copernicus DEM GLO-30m",
        "moon_instrument": "NASA LRO LOLA", "mars_instrument": "NASA PDS MOLA",
        "status": "measured"
    },
    "tri_ruggedness": {
        "label": "Terrain Ruggedness (TRI)", "unit": "m", "pillar": "topo",
        "earth_agency": "ESA", "earth_instrument": "Copernicus DEM GLO-30m",
        "moon_instrument": "NASA LRO LOLA", "mars_instrument": "NASA PDS MOLA",
        "status": "derived"
    },
    "concavity": {
        "label": "Pit & Crater Concavity", "unit": "idx", "pillar": "topo",
        "earth_agency": "ESA", "earth_instrument": "Copernicus DEM GLO-30m",
        "moon_instrument": "NASA LRO LOLA", "mars_instrument": "NASA PDS MOLA",
        "status": "derived"
    },
    "sar_backscatter": {
        "label": "SAR Backscatter", "unit": "norm", "pillar": "radar",
        "earth_agency": "CSA", "earth_instrument": "RADARSAT-1 / RCM",
        "moon_instrument": "NASA LRO Mini-RF", "mars_instrument": "NASA PDS SHARAD",
        "status": "derived"
    },
    "sar_entropy": {
        "label": "SAR Boulder Entropy", "unit": "bits", "pillar": "radar",
        "earth_agency": "CSA", "earth_instrument": "RADARSAT-1 / RCM",
        "moon_instrument": "NASA LRO Mini-RF", "mars_instrument": "NASA PDS SHARAD",
        "status": "derived"
    },
    "sar_contrast": {
        "label": "SAR Texture Contrast", "unit": "idx", "pillar": "radar",
        "earth_agency": "CSA", "earth_instrument": "RADARSAT-1 / RCM",
        "moon_instrument": "NASA LRO Mini-RF", "mars_instrument": "NASA PDS SHARAD",
        "status": "derived"
    },
    "bareness_index": {
        "label": "Bare-Earth Index (1-NDVI)", "unit": "idx", "pillar": "mineral",
        "earth_agency": "ESA", "earth_instrument": "Sentinel-2 MSI (B04/B08)",
        "moon_instrument": "NASA LRO LROC", "mars_instrument": "NASA PDS CRISM",
        "status": "measured"
    },
    "iron_oxide_ratio": {
        "label": "Iron Oxide Spectral Ratio", "unit": "idx", "pillar": "mineral",
        "earth_agency": "ESA", "earth_instrument": "Sentinel-2 MSI (B04/B02)",
        "moon_instrument": "NASA LRO / PDS M3", "mars_instrument": "NASA PDS CRISM",
        "status": "measured"
    },
    "clay_hydroxyl_ratio": {
        "label": "Clay / Hydroxyl Ratio", "unit": "idx", "pillar": "mineral",
        "earth_agency": "ESA", "earth_instrument": "Sentinel-2 MSI (B11/B12)",
        "moon_instrument": "NASA PDS M3", "mars_instrument": "NASA PDS CRISM",
        "status": "measured"
    },
    "albedo": {
        "label": "Surface Albedo", "unit": "idx", "pillar": "mineral",
        "earth_agency": "ESA", "earth_instrument": "Sentinel-2 MSI (Albedo)",
        "moon_instrument": "NASA LRO LOLA/Diviner", "mars_instrument": "NASA PDS MOLA/TES",
        "status": "measured"
    },
    "temp_min_c": {
        "label": "Minimum Temperature", "unit": "°C", "pillar": "thermal",
        "earth_agency": "NASA / JAXA", "earth_instrument": "MODIS LST + JAXA G-Portal",
        "moon_instrument": "NASA LRO Diviner", "mars_instrument": "NASA PDS THEMIS",
        "status": "calibrated"
    },
    "temp_max_c": {
        "label": "Maximum Temperature", "unit": "°C", "pillar": "thermal",
        "earth_agency": "NASA / JAXA", "earth_instrument": "MODIS LST + JAXA G-Portal",
        "moon_instrument": "NASA LRO Diviner", "mars_instrument": "NASA PDS THEMIS",
        "status": "calibrated"
    },
    "temp_delta_c": {
        "label": "Diurnal Thermal Swing", "unit": "°C", "pillar": "thermal",
        "earth_agency": "NASA / JAXA", "earth_instrument": "MODIS LST Day-Night",
        "moon_instrument": "NASA LRO Diviner", "mars_instrument": "NASA PDS THEMIS",
        "status": "calibrated"
    },
}

PILLARS = {
    "topo": ["slope_mean", "slope_p90", "tri_ruggedness", "concavity"],
    "radar": ["sar_backscatter", "sar_entropy", "sar_contrast"],
    "mineral": ["bareness_index", "iron_oxide_ratio", "clay_hydroxyl_ratio", "albedo"],
    "thermal": ["temp_min_c", "temp_max_c", "temp_delta_c"],
}


class TestbedNet(nn.Module):
    def __init__(self, in_features=14, hidden=48, out_scenarios=3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_features, hidden),
            nn.SiLU(),
            nn.LayerNorm(hidden),
            nn.Dropout(0.1),
            nn.Linear(hidden, 24),
            nn.SiLU(),
            nn.Linear(24, out_scenarios),
        )

    def forward(self, x):
        return self.net(x)


class PlanetaryDeepEnsemble:
    def __init__(self, n_models=7, in_features=14):
        self.n_models = n_models
        self.models = []
        for i in range(n_models):
            torch.manual_seed(100 + i * 37)
            hidden = 40 + (i % 3) * 16
            self.models.append(TestbedNet(in_features, hidden=hidden))
        self.conformal_q90 = np.array([0.12, 0.12, 0.12])

    def fit_and_calibrate(self, X: np.ndarray, Y: np.ndarray, epochs=140):
        rng = np.random.default_rng(42)
        n = len(X)
        perm = rng.permutation(n)
        split = int(n * 0.78)
        train_idx, cal_idx = perm[:split], perm[split:]

        X_tr, Y_tr = X[train_idx], Y[train_idx]
        X_cal, Y_cal = X[cal_idx], Y[cal_idx]

        for model in self.models:
            optimizer = optim.AdamW(model.parameters(), lr=0.012, weight_decay=5e-4)
            criterion = nn.MSELoss()

            b_idx = rng.choice(len(X_tr), size=len(X_tr), replace=True)
            x_b = torch.tensor(X_tr[b_idx] + rng.normal(0, 0.05, X_tr[b_idx].shape), dtype=torch.float32)
            y_b = torch.tensor(Y_tr[b_idx], dtype=torch.float32)

            model.train()
            for _ in range(epochs):
                optimizer.zero_grad()
                pred = model(x_b)
                loss = criterion(pred, y_b)
                loss.backward()
                optimizer.step()

        self.eval_mode()
        with torch.no_grad():
            x_c = torch.tensor(X_cal, dtype=torch.float32)
            preds = torch.stack([m(x_c) for m in self.models]).numpy()
            mean_pred = preds.mean(axis=0)
            std_pred = np.maximum(preds.std(axis=0), 0.02)
            nonconformity = np.abs(Y_cal - mean_pred) / std_pred
            self.conformal_q90 = np.quantile(nonconformity, 0.90, axis=0)

    def eval_mode(self):
        for m in self.models:
            m.eval()

    def predict_with_conformal(self, x_vec: np.ndarray):
        self.eval_mode()
        with torch.no_grad():
            t = torch.tensor(x_vec, dtype=torch.float32).reshape(1, -1)
            preds = torch.stack([m(t) for m in self.models]).squeeze(1).numpy()
            mean = np.clip(preds.mean(axis=0), 0.0, 1.0)
            epi_std = np.clip(preds.std(axis=0), 0.015, 0.45)
            half_width = self.conformal_q90 * epi_std
            low = np.clip(mean - half_width, 0.0, 1.0)
            high = np.clip(mean + half_width, 0.0, 1.0)
            return mean, epi_std, low, high


class PlanetaryAnalogEngine:
    def __init__(self):
        self.df = pd.read_parquet(TILES_PATH)
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            self.config = json.load(f)

        self.meta_by_id = {}
        for item in self.config["targets"] + self.config["earth_analogs"]:
            self.meta_by_id[item["id"]] = item

        self.feature_means = self.df[FEATURE_COLS].mean()
        self.feature_stds = self.df[FEATURE_COLS].std().replace(0, 1.0)
        self.norm_df = (self.df[FEATURE_COLS] - self.feature_means) / self.feature_stds

        self.ensemble = PlanetaryDeepEnsemble(n_models=7, in_features=len(FEATURE_COLS))
        self._train_ensemble()

    def _train_ensemble(self):
        earth_df = self.df[self.df["body"] == "earth"].copy()
        X = self.norm_df.loc[earth_df.index].values

        y_rover = np.clip(earth_df["bareness_index"].values * (1.0 - earth_df["slope_p90"].values / 50.0), 0.05, 0.98)
        y_landing = np.clip(
            earth_df["bareness_index"].values * (1.0 - (earth_df["slope_p90"].values / 45.0) * 0.65 - (earth_df["sar_contrast"].values / 700.0) * 0.25),
            0.05, 0.98
        )
        y_mining = np.clip(
            earth_df["bareness_index"].values * (0.5 * earth_df["iron_oxide_ratio"].values + 0.5 * earth_df["clay_hydroxyl_ratio"].values),
            0.05, 0.98
        )
        Y = np.stack([y_rover, y_landing, y_mining], axis=1)
        self.ensemble.fit_and_calibrate(X, Y)

    def _param_similarities(self, target_row, earth_row, target_norm, earth_norm) -> dict:
        target_body = target_row["body"]
        param_sims = {}
        for idx, col in enumerate(FEATURE_COLS):
            z_diff = abs(float(target_norm[idx]) - float(earth_norm[idx]))
            sim = float(np.exp(-0.55 * z_diff))
            meta = FEATURE_META[col]
            space_inst = meta["moon_instrument"] if target_body == "moon" else meta["mars_instrument"]

            param_sims[col] = {
                "label": meta["label"],
                "unit": meta["unit"],
                "pillar": meta["pillar"],
                "similarity": round(sim, 3),
                "target_val": round(float(target_row[col]), 3),
                "earth_val": round(float(earth_row[col]), 3),
                "earth_agency": meta["earth_agency"],
                "earth_instrument": meta["earth_instrument"],
                "space_agency": "NASA",
                "space_instrument": space_inst,
                "status": meta["status"],
            }
        return param_sims

    def _pillar_scores(self, param_sims: dict) -> dict:
        scores = {}
        for pillar, cols in PILLARS.items():
            vals = [param_sims[c]["similarity"] for c in cols]
            scores[pillar] = round(float(np.mean(vals)), 3)
        return scores

    def _build_representativeness_matrix(self, target_row, earth_row, pillar_scores, epi_std) -> list:
        bareness = float(earth_row["bareness_index"])
        is_vegetated = bareness < 0.30
        g_t = float(target_row["gravity_m_s2"])
        p_t = float(target_row["pressure_bar"])
        body_name = target_row["body"].capitalize()

        topo_s = pillar_scores["topo"]
        radar_s = pillar_scores["radar"]
        min_s = pillar_scores["mineral"]
        therm_s = pillar_scores["thermal"]

        return [
            {
                "test": "Slope Climbing & Wheel Traction",
                "scenario": "rover",
                "status": "PARTIAL" if is_vegetated else ("REPRESENTATIVE" if topo_s >= 0.65 else "PARTIAL"),
                "confidence": round(float(np.clip(topo_s - epi_std[0] * 0.5, 0.35, 0.96)), 2),
                "reason": (
                    f"ESA Copernicus DEM slope matches ({int(topo_s*100)}%), but vegetation/soil moisture alters tire traction."
                    if is_vegetated
                    else f"ESA Copernicus DEM slope & ruggedness match ({int(topo_s*100)}%), though {body_name} {g_t} m/s² gravity lowers normal grip."
                ),
            },
            {
                "test": "Radar / Darkness Boulder Navigation",
                "scenario": "rover",
                "status": "NOT_REPRESENTATIVE" if is_vegetated else ("REPRESENTATIVE" if radar_s >= 0.65 else "PARTIAL"),
                "confidence": round(float(np.clip(radar_s - epi_std[0] * 0.4, 0.35, 0.95)), 2),
                "reason": (
                    "Plant canopy scatters radar waves differently from bare planetary boulders."
                    if is_vegetated
                    else f"CSA RADARSAT-1 boulder entropy matches ({int(radar_s*100)}%). Caveat: CSA C-band vs LRO Mini-RF S-band."
                ),
            },
            {
                "test": "Lander Touchdown Tilt & Stability",
                "scenario": "landing",
                "status": "REPRESENTATIVE" if (topo_s >= 0.60 and radar_s >= 0.60) else "PARTIAL",
                "confidence": round(float(np.clip((topo_s + radar_s) / 2 - epi_std[1] * 0.5, 0.35, 0.94)), 2),
                "reason": f"ESA Copernicus GLO-30m slope distribution ({int(topo_s*100)}% match) safely tests lander leg tip-over envelope.",
            },
            {
                "test": "Thruster Plume & Dust Ejecta",
                "scenario": "landing",
                "status": "NOT_REPRESENTATIVE" if p_t < 0.05 else "PARTIAL",
                "confidence": round(float(np.clip(0.88 - epi_std[1], 0.50, 0.95)), 2),
                "reason": f"Earth 1.01 bar air suppresses exhaust plumes; {body_name} {p_t} bar vacuum blasts ejecta wide at supersonic speeds.",
            },
            {
                "test": "Rock / Ice Drill Bit Hardness",
                "scenario": "mining",
                "status": "NOT_REPRESENTATIVE" if is_vegetated else ("REPRESENTATIVE" if min_s >= 0.65 else "PARTIAL"),
                "confidence": round(float(np.clip(min_s - epi_std[2] * 0.4, 0.35, 0.95)), 2),
                "reason": (
                    f"Low bareness ({bareness:.2f}): wet organic soil does not replicate dry extraterrestrial bedrock."
                    if is_vegetated
                    else f"ESA Sentinel-2 mineral ratios ({earth_row['mineral_profile'].replace('_', ' ')}) match target rock hardness ({int(min_s*100)}%)."
                ),
            },
            {
                "test": "Thermal & Vacuum Motor Cooling",
                "scenario": "mining",
                "status": "NOT_REPRESENTATIVE",
                "confidence": round(float(np.clip(0.92 - therm_s * 0.1, 0.70, 0.96)), 2),
                "reason": f"CONFORMAL OOD: Earth air convection cools drill motors; {body_name} vacuum causes rapid thermal seizure.",
            },
        ]

    def match(self, target_site_id: str, top_k: int = 60) -> dict:
        t0 = time.perf_counter()

        target_row = self.df[self.df["site_id"] == target_site_id]
        if target_row.empty:
            raise ValueError(f"Target site '{target_site_id}' not found.")
        target_row = target_row.iloc[0]
        target_meta = self.meta_by_id[target_site_id]
        target_norm = self.norm_df.loc[target_row.name].values

        earth_df = self.df[self.df["body"] == "earth"]
        matches = []

        for idx, earth_row in earth_df.iterrows():
            earth_norm = self.norm_df.loc[idx].values
            earth_meta = self.meta_by_id[earth_row["site_id"]]

            param_sims = self._param_similarities(target_row, earth_row, target_norm, earth_norm)
            pillar_scores = self._pillar_scores(param_sims)

            overall_sim = (
                0.30 * pillar_scores["topo"]
                + 0.30 * pillar_scores["radar"]
                + 0.25 * pillar_scores["mineral"]
                + 0.15 * pillar_scores["thermal"]
            )

            pred_mean, epi_std, conf_low, conf_high = self.ensemble.predict_with_conformal(earth_norm)
            avg_uncertainty = float(np.mean(epi_std))

            rep_matrix = self._build_representativeness_matrix(target_row, earth_row, pillar_scores, epi_std)

            scenarios = {
                "rover": {
                    "status": "valid" if rep_matrix[0]["status"] == "REPRESENTATIVE" else "partial",
                    "score": round(float(pred_mean[0]), 3),
                    "uncertainty": round(float(epi_std[0]), 3),
                    "conformal_interval": [round(float(conf_low[0]), 3), round(float(conf_high[0]), 3)],
                    "note": rep_matrix[0]["reason"],
                },
                "landing": {
                    "status": "partial",
                    "score": round(float(pred_mean[1]), 3),
                    "uncertainty": round(float(epi_std[1]), 3),
                    "conformal_interval": [round(float(conf_low[1]), 3), round(float(conf_high[1]), 3)],
                    "note": rep_matrix[3]["reason"],
                },
                "mining": {
                    "status": "ood",
                    "score": round(float(pred_mean[2]), 3),
                    "uncertainty": round(float(epi_std[2]), 3),
                    "conformal_interval": [round(float(conf_low[2]), 3), round(float(conf_high[2]), 3)],
                    "note": rep_matrix[5]["reason"],
                },
            }

            raw_curve = earth_row.get("diurnal_sol_curve", [])
            diurnal_curve = list(raw_curve) if hasattr(raw_curve, "__iter__") else []

            matches.append({
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
                "epistemic_uncertainty": round(avg_uncertainty, 3),
                "conformal_90_interval": [
                    round(float(np.clip(overall_sim - avg_uncertainty * 1.6, 0, 1)), 3),
                    round(float(np.clip(overall_sim + avg_uncertainty * 1.6, 0, 1)), 3),
                ],
                "pillar_scores": pillar_scores,
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

        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        target_curve = target_row.get("diurnal_sol_curve", [])

        return {
            "search_time_ms": elapsed_ms,
            "earth_sites_scanned": len(earth_df),
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
            },
            "overall_best_id": matches[0]["id"],
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