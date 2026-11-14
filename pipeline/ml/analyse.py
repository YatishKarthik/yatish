"""Unsupervised analysis of the parameter space. Exploration only: nothing here feeds the closeness score.

Reads web/public/data/sites.json, writes an `ml` block onto every site and target plus `meta.ml`:
  - PCA (3 components) of the comparable parameters, for the 3D parameter space
  - k-means families (k = 5)
  - a small neural autoencoder (11-8-2-8-11, tanh): a 2D non-linear map and a reconstruction error per place
  - how well plain nearest-neighbour distance agrees with the printed closeness formula (Spearman rho per target)

Run from the repository root:  python pipeline/ml/analyse.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[2]
SITES = ROOT / "web" / "public" / "data" / "sites.json"
FEATURES = [
    "slope_mean", "slope_p90", "tri_ruggedness", "concavity",
    "bareness_index", "iron_oxide_ratio", "clay_hydroxyl_ratio", "albedo",
    "temp_delta_c", "wind_ms", "insolation_kwh",
]
SEED = 42


def spearman(a: np.ndarray, b: np.ndarray) -> float:
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def main() -> int:
    data = json.loads(SITES.read_text(encoding="utf-8"))
    items = data["sites"] + data["targets"]
    if any("params" not in it for it in items):
        print("sites.json has no params; run the data step first", file=sys.stderr)
        return 1
    # percentile within each planet, 0..1: the same inputs the formula uses
    X = np.array([[it["params"][f]["pct"] / 100.0 for f in FEATURES] for it in items])
    Z = StandardScaler().fit_transform(X)

    pca = PCA(n_components=3, random_state=SEED).fit(Z)
    P = pca.transform(Z)
    P = P / np.abs(P).max()

    km = KMeans(n_clusters=5, n_init=20, random_state=SEED).fit(Z)
    sil = float(silhouette_score(Z, km.labels_))

    ae = MLPRegressor(hidden_layer_sizes=(8, 2, 8), activation="tanh", solver="lbfgs", alpha=1e-3, max_iter=6000, random_state=SEED).fit(Z, Z)
    h = Z
    for W, b in list(zip(ae.coefs_, ae.intercepts_))[:2]:   # forward to the 2-unit bottleneck
        h = np.tanh(h @ W + b)
    recon = ae.predict(Z)
    err = np.sqrt(((recon - Z) ** 2).mean(axis=1))
    r2 = float(1 - ((recon - Z) ** 2).sum() / (Z ** 2).sum())

    n_sites = len(data["sites"])
    for i, it in enumerate(items):
        it["ml"] = {
            "pca": [round(float(v), 4) for v in P[i]],
            "cluster": int(km.labels_[i]),
            "map": [round(float(v), 4) for v in h[i]],
            "recon_error": round(float(err[i]), 4),
        }

    agreement, neighbours = {}, {}
    for j, t in enumerate(data["targets"]):
        d = np.linalg.norm(Z[:n_sites] - Z[n_sites + j], axis=1)
        formula = np.array([s["closeness"][t["id"]]["total"] for s in data["sites"]], dtype=float)
        keep = np.array([s["closeness"][t["id"]].get("gate", 1) >= 1 for s in data["sites"]])
        agreement[t["id"]] = round(spearman(-d[keep], formula[keep]), 3)
        neighbours[t["id"]] = [data["sites"][k]["id"] for k in np.argsort(d)[:5]]

    loadings = []
    for c in range(3):
        order = np.argsort(-np.abs(pca.components_[c]))[:3]
        loadings.append({"pc": c + 1, "explained": round(float(pca.explained_variance_ratio_[c]), 3),
                         "top": [{"id": FEATURES[k], "weight": round(float(pca.components_[c][k]), 3)} for k in order]})
    names = []
    for c in range(5):   # name each family by the feature that sets it apart most
        centre = km.cluster_centers_[c]
        k = int(np.argmax(np.abs(centre)))
        names.append({"id": c, "size": int((km.labels_ == c).sum()), "trait": FEATURES[k], "direction": "high" if centre[k] > 0 else "low"})

    data["meta"]["ml"] = {
        "features": FEATURES, "samples": len(items),
        "pca": loadings, "kmeans": {"k": 5, "silhouette": round(sil, 3), "families": names},
        "autoencoder": {"layers": [len(FEATURES), 8, 2, 8, len(FEATURES)], "activation": "tanh", "r2": round(r2, 3)},
        "agreement": agreement, "neighbours": neighbours,
        "mean_agreement": round(float(np.mean(list(agreement.values()))), 3),
        "note": "Unsupervised, 80 places. Used to explore and to cross-check the formula; never part of the closeness score.",
    }
    data["ai_use"] = [
        "k-means families and PCA of the parameter space (scikit-learn), exploration only",
        "Neural autoencoder map of the parameter space (scikit-learn MLP), exploration only",
        "LLM dossiers from computed numbers, labelled",
        "Code assistance (Claude Code)",
    ]
    SITES.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    m = data["meta"]["ml"]
    print(f"ml: PCA explains {sum(l['explained'] for l in loadings):.0%} in 3 axes; k-means silhouette {sil:.2f}; "
          f"autoencoder R2 {r2:.2f}; nearest-neighbour vs formula rho {m['mean_agreement']:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
