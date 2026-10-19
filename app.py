import json
import os
from pathlib import Path
 
import joblib
import numpy as np
import pandas as pd
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS
 
BASE = Path(__file__).parent
SHEET = "ML Model Dataset (Risk Score)"
 
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.json.ensure_ascii = False  # Монгол үсэг JSON-д хэвээр гарна
CORS(app)
 
# ----------------------------------------------------------------- Ачаалалт
regressor = joblib.load(BASE / "model" / "knn_regressor.joblib")
classifier = joblib.load(BASE / "model" / "knn_classifier.joblib")
META = json.loads((BASE / "model" / "metadata.json").read_text(encoding="utf-8"))
FEATURES = META["features"]
LOW_MAX = META["thresholds"]["low_max"]
MEDIUM_MAX = META["thresholds"]["medium_max"]
 
df = pd.read_excel(BASE / "data" / "database.xlsx", sheet_name=SHEET)
scaler = regressor.named_steps["scaler"]
knn = regressor.named_steps["knn"]
X_scaled = scaler.transform(df[FEATURES])
Y = df["Degradation_Risk_Score"].to_numpy()
 
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
    KNN оноог гараар тооцно (sklearn-ийн regressor-тай ижил үр дүн).
    exclude_idx өгвөл тухайн мөрийг хөрш болгохгүй (leave-one-out) - ингэснээр
    сургалтын өгөгдлийн мөрийг дахин таамаглахад "өөрийгөө хөрш болгох" алдаа гарахгүй.
    """
    k = knn.n_neighbors
    n_query = k + 1 if exclude_idx is not None else k
    dist, idx = knn.kneighbors(x_scaled_row.reshape(1, -1), n_neighbors=n_query)
    dist, idx = dist[0], idx[0]
    if exclude_idx is not None:
        keep = idx != exclude_idx
        dist, idx = dist[keep][:k], idx[keep][:k]
 
    if knn.weights == "distance":
        w = 1.0 / np.maximum(dist, 1e-12)
    else:
        w = np.ones_like(dist)
    score = float(np.sum(w * Y[idx]) / np.sum(w))
 
    if not with_neighbors:
        return score, None
    neighbors = [
        {
            "aimag": str(df.iloc[i]["Аймаг"]),
            "year": int(df.iloc[i]["Жил"]),
            "risk_score": float(Y[i]),
            "distance": round(float(d), 3),
            "weight_pct": round(float(wi / w.sum() * 100), 1),
        }
        for i, d, wi in zip(idx, dist, w)
    ]
    return score, neighbors
 
 
def parse_features(payload):
    """JSON-оос 5 шинж чанарыг шалгаж гаргана. (values, errors) буцаана."""
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
    """Сургалтын өгөгдлийн хүрээнээс гарсан утгыг анхааруулна (KNN extrapolate хийдэггүй)."""
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
    """
    Шинж чанар бүрийг сургалтын өгөгдлийн медиан утгаар сольж оноо хэрхэн
    өөрчлөгдөхийг хэмжинэ. effect > 0 бол тухайн утга оноог ердийнхөөс ӨНДӨР болгож байна.
    (Shapley биш, энгийн "нэг хүчин зүйлийг дундажаар сольсон" мэдрэмжийн шинжилгээ.)
    """
    out = []
    for f in FEATURES:
        alt = dict(values)
        alt[f] = MEDIANS[f]
        xs = scaler.transform(pd.DataFrame([alt], columns=FEATURES))[0]
        alt_score, _ = knn_score(xs)
        out.append({"feature": f, "label": LABELS[f],
                    "effect": round(base_score - alt_score, 1)})
    return sorted(out, key=lambda r: abs(r["effect"]), reverse=True)
 
 
def row_features(row):
    return {f: float(row[f]) for f in FEATURES}
 
 
# ----------------------------------------------------------------- Endpoint-ууд
@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")
 
 
@app.get("/api/health")
def health():
    return jsonify(status="ok")
 
 
@app.get("/api/model-info")
def model_info():
    return jsonify(
        algorithm="K-Nearest Neighbors",
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
     "NDVI": 0.33, "Stocking_Rate": 2.4}
    """
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="JSON body шаардлагатай"), 400
    values, errors = parse_features(payload)
    if errors:
        return jsonify(errors=errors), 422
 
    x = pd.DataFrame([values], columns=FEATURES)
    x_scaled = scaler.transform(x)[0]
    score, neighbors = knn_score(x_scaled, with_neighbors=True)
    cls = classifier.predict(x)[0]
 
    return jsonify(
        risk_score=round(score, 1),
        risk_level=level_of(score),
        classifier_level=str(cls),
        k=knn.n_neighbors,
        neighbors=neighbors,
        warnings=range_warnings(values),
        factors=factor_effects(values, score),
        input=values,
    )
 
 
@app.get("/api/dataset")
def dataset():
    """Бүх аймаг-жилийн бодит өгөгдөл (газрын зураг, тайлан, график ашиглана)."""
    rows = [
        {"aimag": str(r["Аймаг"]), "year": int(r["Жил"]),
         "score": float(r["Degradation_Risk_Score"]),
         "level": str(r["Risk_Level_Class"]), **row_features(r)}
        for _, r in df.iterrows()
    ]
    return jsonify(rows=rows, thresholds=META["thresholds"])
 
 
@app.get("/api/dataset.csv")
def dataset_csv():
    out = df.rename(columns={"Аймаг": "Aimag", "Жил": "Year"})
    body = out.to_csv(index=False)
    # utf-8-sig: Excel дээр монгол үсэг зөв нээгдэнэ
    return Response(
        "\ufeff" + body,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=pasture_risk_dataset.csv"},
    )
 
 
@app.get("/api/aimag/<name>")
def aimag_history(name):
    """Аймгийн жил бүрийн бодит оноо болон KNN-ий leave-one-out таамаглал."""
    sub = df[df["Аймаг"] == name]
    if sub.empty:
        return jsonify(error=f"'{name}' аймаг олдсонгүй"), 404
    rows = []
    for i in sub.index:
        pred, _ = knn_score(X_scaled[i], exclude_idx=i)
        rows.append(
            {
                "year": int(df.at[i, "Жил"]),
                "actual_score": float(Y[i]),
                "actual_level": str(df.at[i, "Risk_Level_Class"]),
                "knn_estimate": round(pred, 1),
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
        pred, _ = knn_score(X_scaled[i], exclude_idx=i)
        out.append(
            {
                "aimag": str(df.at[i, "Аймаг"]),
                "actual_score": float(Y[i]),
                "knn_estimate": round(pred, 1),
                "knn_level": level_of(pred),
                "actual_level": str(df.at[i, "Risk_Level_Class"]),
            }
        )
    out.sort(key=lambda r: r["actual_score"], reverse=True)
    for rank, r in enumerate(out, 1):
        r["rank"] = rank
    return jsonify(year=year, ranking=out)
 
 
if __name__ == "__main__":
    # Өөрийн компьютер дээр туршихад. Бусдад харуулахдаа serve.py ашиглана.
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")),
            debug=True, use_reloader=False)
 