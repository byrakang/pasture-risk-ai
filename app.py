import os
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsRegressor
from sklearn.preprocessing import StandardScaler

BASE = Path(__file__).parent
SHEET = "ML Model Dataset (Risk Score)"

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.json.ensure_ascii = False  # Монгол үсэг JSON-д хэвээр гарна
CORS(app)

# ----------------------------------------------------------------- Өгөгдөл
FEATURES = ["Total_Livestock", "Precipitation_mm", "Temperature_C", "NDVI", "Stocking_Rate"]
SHOW = FEATURES
LOW_MAX, MEDIUM_MAX = 35, 65
N_NEIGHBORS = 5

_xl = pd.ExcelFile(BASE / "database.xlsx")
_sheet = SHEET if SHEET in _xl.sheet_names else _xl.sheet_names[0]
df = pd.read_excel(_xl, sheet_name=_sheet).reset_index(drop=True)


# ----------------------------------------------------------------- Зорилтот утга (тасралтгүй 0-100)
def _minmax(s):
    return (s - s.min()) / (s.max() - s.min() + 1e-9)


if "Degradation_Risk_Score" in df.columns:
    TARGET = df["Degradation_Risk_Score"].astype(float).clip(0, 100)
else:
    # Excel-д бэлэн оноо байхгүй бол 5 үзүүлэлтээс тасралтгүй composite индекс байгуулна
    TARGET = 100 * (
        0.35 * _minmax(df["Stocking_Rate"])
        + 0.25 * _minmax(df["Total_Livestock"])
        + 0.25 * (1 - _minmax(df["NDVI"]))
        + 0.15 * (1 - _minmax(df["Precipitation_mm"]))
    )

X = df[FEATURES]
Y = TARGET.to_numpy(dtype=float)

# ----------------------------------------------------------------- ML
# 1) Шалгалт: 80/20 хуваалт
X_train, X_test, y_train, y_test = train_test_split(X, Y, test_size=0.2, random_state=42)
_sc = StandardScaler()
_knn = KNeighborsRegressor(n_neighbors=N_NEIGHBORS, weights="distance")
_knn.fit(_sc.fit_transform(X_train), y_train)
_pred = _knn.predict(_sc.transform(X_test))
TEST_MAE = float(mean_absolute_error(y_test, _pred))


def _lvl(a):
    a = np.asarray(a)
    return np.where(a < LOW_MAX, 0, np.where(a < MEDIUM_MAX, 1, 2))


TEST_ACC = float(np.mean(_lvl(_pred) == _lvl(y_test)))

# 2) Сайтад ашиглах эцсийн загвар: бүх өгөгдөл дээр сургана
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)
knn = KNeighborsRegressor(n_neighbors=N_NEIGHBORS, weights="distance")
knn.fit(X_scaled, Y)

META = {
    "best_params": {"n_neighbors": N_NEIGHBORS},
    "metrics": {"unseen_aimag_cv": {"MAE": round(TEST_MAE, 1),
                                    "class_accuracy": round(TEST_ACC, 3)}},
    "n_samples": int(len(df)),
    "years": [int(df["Жил"].min()), int(df["Жил"].max())],
    "feature_ranges": {f: [float(df[f].min()), float(df[f].max())] for f in SHOW},
    "thresholds": {"low_max": LOW_MAX, "medium_max": MEDIUM_MAX},
}

LABELS = {
    "Total_Livestock": "Нийт мал (хонин толгойд)",
    "Precipitation_mm": "Жилийн хур тунадас (мм)",
    "Temperature_C": "Жилийн дундаж температур (°C)",
    "NDVI": "NDVI",
    "Stocking_Rate": "Ачааллын коэффициент",
}


# ----------------------------------------------------------------- Туслахууд
def level_of(score: float) -> str:
    if score < LOW_MAX:
        return "Бага (Low)"
    if score < MEDIUM_MAX:
        return "Дунд (Medium)"
    return "Өндөр (High)"


def knn_score(x_scaled_row, exclude_idx=None, with_neighbors=False):
    """
    Эрсдэлийн оноо = хөрш аймаг-жилүүдийн оноог зайгаар жинлэсэн дундаж (тасралтгүй).
    Буцаах: (score, spread, neighbors). spread = хөршүүдийн оноон дахь жинлэсэн хазайлт.
    exclude_idx өгвөл тухайн мөрийг хөрш болгохгүй (leave-one-out).
    """
    k = knn.n_neighbors
    n_query = k + 1 if exclude_idx is not None else k
    dist, idx = knn.kneighbors(x_scaled_row.reshape(1, -1), n_neighbors=n_query)
    dist, idx = dist[0], idx[0]
    if exclude_idx is not None:
        keep = idx != exclude_idx
        dist, idx = dist[keep][:k], idx[keep][:k]

    w = 1.0 / np.maximum(dist, 1e-12)
    score = float(np.sum(w * Y[idx]) / np.sum(w))
    spread = float(np.sqrt(np.sum(w * (Y[idx] - score) ** 2) / np.sum(w)))

    neighbors = None
    if with_neighbors:
        neighbors = [
            {
                "aimag": str(df.iloc[i]["Аймаг"]),
                "year": int(df.iloc[i]["Жил"]),
                "risk_score": round(float(Y[i]), 1),
                "distance": round(float(d), 3),
                "weight_pct": round(float(wi / w.sum() * 100), 1),
            }
            for i, d, wi in zip(idx, dist, w)
        ]
    return score, spread, neighbors


# Мөр бүрийн leave-one-out оноо (газрын зураг, түүх, эрэмбэд ашиглана)
LOO_SCORE = np.array([knn_score(X_scaled[i], exclude_idx=i)[0] for i in range(len(df))])
ACTUAL = Y


def parse_features(payload):
    """JSON-оос шинж чанаруудыг шалгаж гаргана. (values, errors) буцаана."""
    values, errors = {}, []
    for f in FEATURES:
        if f not in payload:
            errors.append(f"'{f}' талбар дутуу байна")
            continue
        try:
            v = float(payload[f])
        except (TypeError, ValueError):
            errors.append(f"'{f}' тоон утга байх ёстой")
            continue
        if not np.isfinite(v):
            errors.append(f"'{f}' хүчинтэй тоо биш байна")
            continue
        values[f] = v
    for f in ("Total_Livestock", "Precipitation_mm", "Stocking_Rate"):
        if f in values and values[f] < 0:
            errors.append(f"'{f}' сөрөг байж болохгүй")
    if "NDVI" in values and not (-1 <= values["NDVI"] <= 1):
        errors.append("'NDVI' -1..1 хооронд байх ёстой")
    return values, errors


def range_warnings(values):
    """Сургалтын өгөгдлийн хүрээнээс гарсан утгыг анхааруулна."""
    warnings = []
    for f, v in values.items():
        lo, hi = META["feature_ranges"][f]
        if v < lo or v > hi:
            warnings.append(
                f"{LABELS[f]}: {v} нь сургалтын хүрээнээс ({lo:g} – {hi:g}) гадуур. "
                "KNN хүрээнээс гадуур таамаглахдаа хамгийн ойрын мэдэгдэж буй утгад "
                "тулгуурладаг тул үр дүн найдвар муутай."
            )
    return warnings


MEDIANS = df[FEATURES].median().to_dict()


def factor_effects(values, base_score):
    """Шинж чанар бүрийг медианаар сольж оноо хэрхэн өөрчлөгдөхийг хэмжинэ."""
    out = []
    for f in FEATURES:
        alt = dict(values)
        alt[f] = MEDIANS[f]
        xs = scaler.transform(pd.DataFrame([alt], columns=FEATURES))[0]
        alt_score = knn_score(xs)[0]
        out.append({"feature": f, "label": LABELS[f],
                    "effect": round(base_score - alt_score, 1)})
    return sorted(out, key=lambda r: abs(r["effect"]), reverse=True)


def row_features(row):
    return {f: float(row[f]) for f in SHOW}


# ----------------------------------------------------------------- Endpoint-ууд
@app.get("/")
def index():
    folder = BASE if (BASE / "index.html").exists() else app.static_folder
    return send_from_directory(folder, "index.html")


@app.get("/api/health")
def health():
    return jsonify(status="ok")


@app.get("/api/model-info")
def model_info():
    return jsonify(
        algorithm="K-Nearest Neighbors (Regressor, distance-weighted)",
        features=FEATURES,
        feature_labels=LABELS,
        **{k: META[k] for k in ("best_params", "metrics", "n_samples", "years",
                                 "feature_ranges", "thresholds")},
    )


@app.get("/api/aimags")
def aimags():
    return jsonify(
        aimags=sorted(df["Аймаг"].unique().tolist()),
        years=sorted(df["Жил"].unique().tolist()),
    )


@app.post("/api/predict")
def predict():
    """
    Body (JSON):
    {"Total_Livestock": 3200000, "Precipitation_mm": 120, "Temperature_C": -3,
     "NDVI": 0.33, "Stocking_Rate": 1.2}
    """
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="JSON body шаардлагатай"), 400
    values, errors = parse_features(payload)
    if errors:
        return jsonify(errors=errors), 422

    x_scaled = scaler.transform(pd.DataFrame([values], columns=FEATURES))[0]
    score, spread, neighbors = knn_score(x_scaled, with_neighbors=True)
    pct = float((LOO_SCORE < score).mean() * 100)
    lo, hi = max(0.0, score - spread), min(100.0, score + spread)

    return jsonify(
        risk_score=round(score, 1),
        risk_level=level_of(score),
        range=[round(lo, 1), round(hi, 1)],
        percentile=round(pct),
        k=knn.n_neighbors,
        neighbors=neighbors,
        warnings=range_warnings(values),
        factors=factor_effects(values, score),
        input=values,
    )


@app.get("/api/dataset")
def dataset():
    """Бүх аймаг-жилийн өгөгдөл. score = загварын (leave-one-out) оноо."""
    rows = [
        {"aimag": str(r["Аймаг"]), "year": int(r["Жил"]),
         "score": round(float(LOO_SCORE[i]), 1),
         "level": level_of(float(LOO_SCORE[i])), **row_features(r)}
        for i, r in df.iterrows()
    ]
    return jsonify(rows=rows, thresholds=META["thresholds"])


@app.get("/api/dataset.csv")
def dataset_csv():
    out = df.rename(columns={"Аймаг": "Aimag", "Жил": "Year"}).copy()
    out["Model_Risk_Score"] = np.round(LOO_SCORE, 1)
    body = out.to_csv(index=False)
    return Response(
        "\ufeff" + body,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=pasture_risk_dataset.csv"},
    )


@app.get("/api/aimag/<name>")
def aimag_history(name):
    """Аймгийн жил бүрийн бодит оноо болон загварын leave-one-out таамаглал."""
    sub = df[df["Аймаг"] == name]
    if sub.empty:
        return jsonify(error=f"'{name}' аймаг олдсонгүй"), 404
    rows = []
    for i in sub.index:
        rows.append(
            {
                "year": int(df.at[i, "Жил"]),
                "actual_score": round(float(ACTUAL[i]), 1),
                "actual_level": level_of(float(ACTUAL[i])),
                "knn_estimate": round(float(LOO_SCORE[i]), 1),
                **row_features(df.loc[i]),
            }
        )
    return jsonify(aimag=name, history=sorted(rows, key=lambda r: r["year"]))


@app.get("/api/ranking")
def ranking():
    """?year=2025 - тухайн жилийн аймгуудыг эрсдэлээр эрэмбэлнэ (default: сүүлийн жил)."""
    year = request.args.get("year", type=int, default=int(df["Жил"].max()))
    sub = df[df["Жил"] == year]
    if sub.empty:
        return jsonify(error=f"{year} оны өгөгдөл байхгүй"), 404
    out = []
    for i in sub.index:
        out.append(
            {
                "aimag": str(df.at[i, "Аймаг"]),
                "actual_score": round(float(ACTUAL[i]), 1),
                "knn_estimate": round(float(LOO_SCORE[i]), 1),
                "knn_level": level_of(float(LOO_SCORE[i])),
                "actual_level": level_of(float(ACTUAL[i])),
            }
        )
    out.sort(key=lambda r: r["knn_estimate"], reverse=True)
    for rank, r in enumerate(out, 1):
        r["rank"] = rank
    return jsonify(year=year, ranking=out)


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")),
            debug=True, use_reloader=False)
