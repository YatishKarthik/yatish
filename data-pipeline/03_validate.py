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
4. Score range. For every pair, how far the score moves if any one compared measurement is dropped or a group
   weight shifts by 20%; the median width is reported.
5. Baseline. The same checks for a plain, unweighted distance across the 14 standardised features, with and
   without the bare-ground rule, so it is visible how much the weighting and the rule each add.
6. Bare-ground thresholds. The NDVI limits of the rule are moved (0.20-0.30 full score, 0.35-0.45 zero) to show
   the control result does not hinge on one cut-off.

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
    def score(m):
        ps = {k: v for k, v in m["pillar_scores"].items() if v is not None}   # only groups measured on both sides
        return sum(weights[k] * ps[k] for k in ps) / (sum(weights[k] for k in ps) or 1) * m["vegetation_gate"]
    return [m["id"] for m in sorted(matches, key=score, reverse=True)]


def gate(ndvi, water, full=0.25, zero=0.40):
    return float(np.clip((zero - ndvi) / (zero - full), 0, 1) * np.clip((0.50 - water) / 0.30, 0, 1))


def summary(ctrl, bench, n):
    return {"control_median_rank": float(np.median(ctrl)), "control_share_bottom_half": round(float(np.mean(np.array(ctrl) > n / 2)), 3),
            "benchmark_median_rank": float(np.median(bench)), "benchmark_share_top_half": round(float(np.mean(np.array(bench) <= n / 2)), 3)}


CANNOT_SHOW = [
    "The controls and benchmarks were chosen by us. An independent test would use analog sites ranked by mission teams who did not see our scores.",
    "The score range shows sensitivity to the choice of measurements and weights, not measurement error of the instruments themselves.",
    "Moon and Mars surface composition, and Mars temperatures, are not measured in our data, so those groups are left out of Moon and Mars scores rather than filled with typical values.",
    "Whether a high-ranked site actually gave transferable results in a past campaign is not tested here; that needs campaign reports matched to flight outcomes.",
    "Texture comes from 2 km elevation tiles, so boulder-scale roughness (what wheels feel) is not seen.",
]


def main():
    eng = PlanetaryAnalogEngine()
    types = {e["id"]: e["type"] for e in eng.config["earth_analogs"]}
    controls = [k for k, v in types.items() if v == "negative_control"]
    benchmarks = [k for k, v in types.items() if v == "benchmark"]
    n_earth = len(types)

    per_target, ctrl_ranks, bench_ranks, overlaps, ungated_ctrl_ranks = [], [], [], [], []
    base = {"plain": ([], []), "plain_with_rule": ([], [])}
    thresholds = {(f, z): [] for f in (0.20, 0.25, 0.30) for z in (0.35, 0.40, 0.45) if z > f}
    rhos = []
    earth_idx = eng.df.index[eng.df["body"] == "earth"]
    earth_ids = eng.df.loc[earth_idx, "site_id"].tolist()
    Z = eng.norm_df.loc[earth_idx].values
    U = eng.usable.loc[earth_idx].values
    widths = []
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

        # baseline: plain distance in the standardised feature space, over the features measured on both sides
        ti = eng.df.index[eng.df["site_id"] == t["id"]][0]
        tz = eng.norm_df.loc[ti].values
        tm = eng.usable.loc[ti].values
        both = U & tm
        dist = np.sqrt(np.nansum(np.where(both, (Z - tz) ** 2, 0.0), axis=1) / np.maximum(both.sum(axis=1), 1))
        widths.extend(m["score_range"][1] - m["score_range"][0] for m in res["matches"])
        mm = {m["id"]: m for m in res["matches"]}
        for key, use_rule in (("plain", False), ("plain_with_rule", True)):
            sc = {sid: -d * (1 if not use_rule else 1) for sid, d in zip(earth_ids, dist)}
            if use_rule:
                sc = {sid: (1 / (1 + d)) * gate(mm[sid]["ndvi"], mm[sid]["water_fraction"]) for sid, d in zip(earth_ids, dist)}
            o = sorted(sc, key=sc.get, reverse=True)
            rk = {sid: i + 1 for i, sid in enumerate(o)}
            base[key][0].extend(rk[c] for c in controls)
            base[key][1].extend(rk[b] for b in benchmarks)
            if key == "plain":
                a = np.array([rank[sid] for sid in earth_ids]); b = np.array([rk[sid] for sid in earth_ids])
                rhos.append(float(np.corrcoef(a, b)[0, 1]))
        for (f, z) in thresholds:
            sc = {m["id"]: m["similarity_before_vegetation_rule"] * gate(m["ndvi"], m["water_fraction"], f, z) for m in res["matches"]}
            o = sorted(sc, key=sc.get, reverse=True)
            thresholds[(f, z)].extend(o.index(c) + 1 for c in controls)

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
        "score_range": {"median_width": round(float(np.median(widths)), 3),
                        "method": "For every target-site pair the score is recomputed with each compared measurement left out in turn and with each group weight moved by 20%; the range is the lowest to highest result."},
        "baseline": {
            "description": "Unweighted distance across the 14 standardised features (no groups, no weights)",
            "plain": summary(*base["plain"], n_earth),
            "plain_with_bare_ground_rule": summary(*base["plain_with_rule"], n_earth),
            "celestra": summary(ctrl_ranks, bench_ranks, n_earth),
            "rank_correlation_with_celestra": round(float(np.mean(rhos)), 3),
        },
        "bare_ground_threshold_sensitivity": [
            {"ndvi_full_score_at": f, "ndvi_zero_at": z, "control_median_rank": float(np.median(v)),
             "control_share_bottom_half": round(float(np.mean(np.array(v) > n_earth / 2)), 3)}
            for (f, z), v in thresholds.items()],
        "cannot_show": CANNOT_SHOW,
        "per_target": per_target,
    }
    path = ROOT / "data" / "processed" / "validation.json"
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k != "per_target"}, indent=1))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
