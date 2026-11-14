"""
Checks whether the match score means anything, and writes data/processed/validation.json.

1. Negative controls. The registry marks 8 Earth sites as deliberately unsuitable (rainforest, wetland, farmland,
   polders). A useful score should rank them near the bottom for every Moon and Mars target.
2. Benchmarks. 12 sites are established analogs used by space agencies (Haughton, Atacama, McMurdo, ...).
   They should rank above the median.
   The score includes a stated bare-ground rule (vegetated sites cannot be analogs); results are reported with
   and without it so the rule's effect is visible rather than hidden.
3. Weight sensitivity. Each pillar weight is moved by +/-20% (others renormalised). If the top 5 barely changes,
   the ranking does not hinge on our particular choice of weights.
4. Ensemble calibration. Share of Earth sites whose scenario labels fall inside the 90% conformal band.

Run after 01_fetch_and_extract.py:  python data-pipeline/03_validate.py
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from ml_engine.engine import PlanetaryAnalogEngine  # noqa: E402

WEIGHTS = {"topo": 0.30, "radar": 0.30, "mineral": 0.25, "thermal": 0.15}


def ranked(matches, weights):
    score = lambda m: sum(weights[k] * m["pillar_scores"][k] for k in weights) * m["vegetation_gate"]
    return [m["id"] for m in sorted(matches, key=score, reverse=True)]


def main():
    eng = PlanetaryAnalogEngine()
    types = {e["id"]: e["type"] for e in eng.config["earth_analogs"]}
    controls = [k for k, v in types.items() if v == "negative_control"]
    benchmarks = [k for k, v in types.items() if v == "benchmark"]
    n_earth = len(types)

    per_target, ctrl_ranks, bench_ranks, overlaps, ungated_ctrl_ranks = [], [], [], [], []
    for t in eng.config["targets"]:
        res = eng.match(t["id"], top_k=n_earth)
        order = [m["id"] for m in res["matches"]]
        rank = {sid: i + 1 for i, sid in enumerate(order)}
        cr = sorted(rank[c] for c in controls)
        ungated = [m["id"] for m in sorted(res["matches"], key=lambda m: m["similarity_before_vegetation_rule"], reverse=True)]
        ungated_ctrl_ranks.extend(ungated.index(c) + 1 for c in controls)
        br = sorted(rank[b] for b in benchmarks)
        ctrl_ranks += cr
        bench_ranks += br

        base_top = set(order[:5])
        worst = 5
        for k in WEIGHTS:
            for f in (0.8, 1.2):
                w = dict(WEIGHTS); w[k] *= f
                s = sum(w.values()); w = {a: b / s for a, b in w.items()}
                worst = min(worst, len(base_top & set(ranked(res["matches"], w)[:5])))
        overlaps.append(worst)
        per_target.append({
            "target": t["id"], "name": t["name"], "body": t["body"],
            "top3": [m["name"] for m in res["matches"][:3]],
            "control_ranks": cr, "best_control_rank": cr[0],
            "benchmark_median_rank": float(np.median(br)),
            "top5_kept_under_weight_changes": worst,
        })
        print(f"{t['name'][:34]:34} controls ranked {cr[0]:2d}-{cr[-1]:2d} of {n_earth} · benchmarks median {np.median(br):4.1f} · top-5 kept {worst}/5")

    # ensemble calibration on the Earth sites (same split as training)
    earth = eng.df[eng.df["body"] == "earth"]
    X = eng.norm_df.loc[earth.index].values
    Y = np.stack([
        np.clip(earth.bareness_index.values * (1 - earth.slope_p90.values / 50), 0.05, 0.98),
        np.clip(earth.bareness_index.values * (1 - (earth.slope_p90.values / 45) * 0.65 - (earth.sar_contrast.values / 700) * 0.25), 0.05, 0.98),
        np.clip(earth.bareness_index.values * (0.5 * earth.iron_oxide_ratio.values + 0.5 * earth.clay_hydroxyl_ratio.values), 0.05, 0.98),
    ], 1)
    rng = np.random.default_rng(42)
    perm = rng.permutation(len(X)); cal = perm[int(len(X) * 0.78):]
    inside = []
    for i in cal:
        _, _, lo, hi = eng.ensemble.predict_with_conformal(X[i])
        inside.append((Y[i] >= lo) & (Y[i] <= hi))
    coverage = np.mean(inside, axis=0).round(2).tolist()

    out = {
        "earth_sites": n_earth,
        "negative_controls_without_vegetation_rule": {"median_rank": float(np.median(ungated_ctrl_ranks)),
                                                      "share_in_bottom_half": round(float(np.mean(np.array(ungated_ctrl_ranks) > n_earth / 2)), 3),
                                                      "best_rank_seen": int(min(ungated_ctrl_ranks))},
        "negative_controls": {"count": len(controls), "median_rank": float(np.median(ctrl_ranks)),
                               "share_in_bottom_half": round(float(np.mean(np.array(ctrl_ranks) > n_earth / 2)), 3),
                               "best_rank_seen": int(min(ctrl_ranks))},
        "benchmarks": {"count": len(benchmarks), "median_rank": float(np.median(bench_ranks)),
                       "share_in_top_half": round(float(np.mean(np.array(bench_ranks) <= n_earth / 2)), 3)},
        "weight_sensitivity": {"perturbation": "each pillar weight x0.8 and x1.2, renormalised",
                               "mean_top5_kept": round(float(np.mean(overlaps)), 2), "min_top5_kept": int(min(overlaps))},
        "ensemble_calibration": {"target": 0.9, "coverage_per_scenario": coverage, "calibration_sites": int(len(cal))},
        "per_target": per_target,
    }
    path = ROOT / "data" / "processed" / "validation.json"
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k != "per_target"}, indent=1))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
