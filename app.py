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
DATA_FILES = ("database.xlsx", "database 2.xlsx", "database_clean_formatted.xlsx")

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.json.ensure_ascii = False  # Монгол үсэг JSON-д хэвээр гарна
CORS(app)

# ----------------------------------------------------------------- Өгөгдөл
FEATURES = ["Total_Livestock", "Precipitation_mm", "Temperature_C", "NDVI", "Stocking_Rate"]
SHOW = FEATURES
LOW_MAX, MEDIUM_MAX = 35, 65
N_NEIGHBORS = 5


def _find_dataset():
    """Ажлын хавтас дахь Excel-ээс ML хуудсыг олно."""
    for name in DATA_FILES:
        path = BASE / name
        if not path.exists():
            continue
        xl = pd.ExcelFile(path)
        for sheet in [SHEET, *xl.sheet_names]:
            if sheet not in xl.sheet_names:
                continue
            frame = pd.read_excel(xl, sheet_name=sheet)
            if {"Аймаг", "Жил", *FEATURES}.issubset(frame.columns):
                return frame
    raise FileNotFoundError(
        "database.xlsx олдсонгүй. Excel файлд 'Аймаг', 'Жил', "
        f"{', '.join(FEATURES)} багана байх ёстой."
    )


df = _find_dataset()
df = df.dropna(subset=["Аймаг", "Жил", *FEATURES]).reset_index(drop=True)
df["Аймаг"] = df["Аймаг"].astype(str).str.strip()
df = df.sort_values(["Аймаг", "Жил"]).reset_index(drop=True)

YEARS = sorted(int(y) for y in df["Жил"].unique())
LATEST_YEAR = YEARS[-1]
AIMAGS = sorted(df["Аймаг"].unique().tolist())


# ----------------------------------------------------------------- Зорилтот утга (тасралтгүй 0-100)
def _minmax(s):
    return (s - s.min()) / (s.max() - s.min() + 1e-9)


if "Degradation_Risk_Score" in df.columns:
    TARGET = df["Degradation_Risk_Score"].astype(float).clip(0, 100)
else:
    # Бэлэн оноо байхгүй бол 4 үзүүлэлтээс composite индекс байгуулна
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
    "NDVI": "Ургамлын индекс (NDVI)",
    "Stocking_Rate": "Ачааллын коэффициент",
}

LABELS_EN = {
    "Total_Livestock": "Total livestock (sheep units)",
    "Precipitation_mm": "Annual precipitation (mm)",
    "Temperature_C": "Mean annual temperature (°C)",
    "NDVI": "Vegetation index (NDVI)",
    "Stocking_Rate": "Stocking rate",
}

AIMAG_EN = {
    "Архангай": "Arkhangai", "Баян-Өлгий": "Bayan-Ölgii", "Баянхонгор": "Bayankhongor",
    "Булган": "Bulgan", "Говь-Алтай": "Govi-Altai", "Говьсүмбэр": "Govisümber",
    "Дархан-Уул": "Darkhan-Uul", "Дорноговь": "Dornogovi", "Дорнод": "Dornod",
    "Дундговь": "Dundgovi", "Завхан": "Zavkhan", "Орхон": "Orkhon",
    "Сэлэнгэ": "Selenge", "Сүхбаатар": "Sükhbaatar", "Төв": "Töv", "Увс": "Uvs",
    "Ховд": "Khovd", "Хэнтий": "Khentii", "Хөвсгөл": "Khövsgöl",
    "Өвөрхангай": "Övörkhangai", "Өмнөговь": "Ömnögovi",
}


def req_lang():
    value = (request.args.get("lang") or "").lower()
    return "en" if value.startswith("en") else "mn"


def labels_for(lang):
    return LABELS_EN if lang == "en" else LABELS

QUANTILES = {
    f: {p: float(df[f].quantile(p / 100)) for p in (10, 25, 50, 75, 90)} for f in FEATURES
}

# ----------------------------------------------------------------- Туслахууд
def level_of(score: float, lang: str = "mn") -> str:
    en = lang == "en"
    if score < LOW_MAX:
        return "Low" if en else "Бага (Low)"
    if score < MEDIUM_MAX:
        return "Medium" if en else "Дунд (Medium)"
    return "High" if en else "Өндөр (High)"


def level_key(score: float) -> str:
    if score < LOW_MAX:
        return "low"
    if score < MEDIUM_MAX:
        return "mid"
    return "high"


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

    w = 1.0 / np.maximum(dist, 0.2)
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
                **{f: round(float(df.iloc[i][f]), 3) for f in FEATURES},
            }
            for i, d, wi in zip(idx, dist, w)
        ]
    return score, spread, neighbors


# Мөр бүрийн leave-one-out оноо (газрын зураг, түүх, эрэмбэд ашиглана)
LOO_SCORE = np.array([knn_score(X_scaled[i], exclude_idx=i)[0] for i in range(len(df))])
ACTUAL = Y

# Жил бүрийн улсын дундаж
NATIONAL_MEAN_BY_YEAR = (
    df.assign(_score=ACTUAL).groupby("Жил")["_score"].mean().round(1).to_dict()
)


def parse_features(payload, lang="mn"):
    """JSON-оос шинж чанаруудыг шалгаж гаргана. (values, errors) буцаана."""
    en = lang == "en"
    values, errors = {}, []
    for f in FEATURES:
        if f not in payload:
            errors.append(f"'{f}' is required" if en else f"'{f}' талбар дутуу байна")
            continue
        try:
            v = float(payload[f])
        except (TypeError, ValueError):
            errors.append(f"'{f}' must be a number" if en else f"'{f}' тоон утга байх ёстой")
            continue
        if not np.isfinite(v):
            errors.append(f"'{f}' is not a valid number" if en else f"'{f}' хүчинтэй тоо биш байна")
            continue
        values[f] = v
    for f in ("Total_Livestock", "Precipitation_mm", "Stocking_Rate"):
        if f in values and values[f] < 0:
            errors.append(f"'{f}' cannot be negative" if en else f"'{f}' сөрөг байж болохгүй")
    if "NDVI" in values and not (-1 <= values["NDVI"] <= 1):
        errors.append("'NDVI' must be between -1 and 1" if en else "'NDVI' -1..1 хооронд байх ёстой")
    return values, errors


def _fmt_num(v):
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    return f"{v:,.2f}".rstrip("0").rstrip(".")


def range_warnings(values, lang="mn"):
    """Сургалтын өгөгдлийн хүрээнээс гарсан утгыг анхааруулна."""
    warnings = []
    labels = labels_for(lang)
    for f, v in values.items():
        lo, hi = META["feature_ranges"][f]
        if v < lo or v > hi:
            if lang == "en":
                warnings.append(
                    f"{labels[f]}: {_fmt_num(v)} is outside the training range "
                    f"({_fmt_num(lo)} – {_fmt_num(hi)}). Outside its training range, "
                    "KNN relies on the nearest known values, so the result is less reliable."
                )
            else:
                warnings.append(
                    f"{labels[f]}: {_fmt_num(v)} нь сургалтын хүрээнээс "
                    f"({_fmt_num(lo)} – {_fmt_num(hi)}) гадуур. "
                    "KNN хүрээнээс гадуур таамаглахдаа хамгийн ойрын мэдэгдэж буй утгад "
                    "тулгуурладаг тул үр дүн найдвар муутай."
                )
    return warnings


MEDIANS = df[FEATURES].median().to_dict()


def factor_effects(values, base_score, lang="mn"):
    """Шинж чанар бүрийг медианаар сольж оноо хэрхэн өөрчлөгдөхийг хэмжинэ."""
    labels = labels_for(lang)
    out = []
    for f in FEATURES:
        alt = dict(values)
        alt[f] = MEDIANS[f]
        xs = scaler.transform(pd.DataFrame([alt], columns=FEATURES))[0]
        alt_score, _, _ = knn_score(xs)
        out.append({"feature": f, "label": labels[f], "value": round(values[f], 3),
                    "median": round(float(MEDIANS[f]), 3),
                    "effect": round(base_score - alt_score, 1)})
    return sorted(out, key=lambda r: abs(r["effect"]), reverse=True)


def recommendations(values, score, factors, lang="mn"):
    """Утга ба эрсдэлийн түвшинд тулгуурлан арга хэмжээний зөвлөмж буцаана."""
    q = QUANTILES
    en = lang == "en"
    items = []

    rate = values["Stocking_Rate"]
    if rate >= q["Stocking_Rate"][75]:
        items.append({
            "tag": "Livestock pressure" if en else "Малын ачаалал",
            "priority": 3 + (rate - q["Stocking_Rate"][75]),
            "text": (
                f"Stocking rate {rate:.2f} is above the top 25% of the study aimags "
                f"({q['Stocking_Rate'][75]:.2f}). Reduce herd size, rotate grazing and "
                "free up reserve pasture to lower the pressure."
            ) if en else (
                f"Ачааллын коэффициент {rate:.2f} нь судалгааны аймгуудын дээд 25%-иас "
                f"({q['Stocking_Rate'][75]:.2f}) өндөр байна. Малын тоог бууруулах, "
                "бэлчээрийг ээлжлэн ашиглах, нөөц бэлчээр гаргах замаар ачааллыг "
                "бууруулах шаардлагатай."
            ),
        })
    elif rate < q["Stocking_Rate"][25]:
        items.append({
            "tag": "Livestock pressure" if en else "Малын ачаалал",
            "priority": 0.4,
            "text": (
                f"Stocking rate {rate:.2f} is relatively low. Maintain the current herd "
                "size and keep monitoring pasture recovery."
            ) if en else (
                f"Ачааллын коэффициент {rate:.2f} харьцангуй бага байна. Одоогийн "
                "малын тоог хадгалах, бэлчээрийн нөхөн сэргэлтийг хянах нь зүйтэй."
            ),
        })

    ndvi = values["NDVI"]
    if ndvi <= q["NDVI"][25]:
        items.append({
            "tag": "Vegetation state" if en else "Ургамлын төлөв",
            "priority": 3 + (q["NDVI"][25] - ndvi) * 10,
            "text": (
                f"NDVI {ndvi:.3f} sits at the lower 25% threshold ({q['NDVI'][25]:.3f}). "
                "Rest the pasture for 1–2 years, set protection limits and plan "
                "restoration measures."
            ) if en else (
                f"NDVI {ndvi:.3f} нь доод 25%-ийн хязгаарт ({q['NDVI'][25]:.3f}) байна. "
                "Бэлчээрийг 1–2 жил амраах, хамгаалалтын хязгаарлалт тогтоох, "
                "нөхөн сэргээх арга хэмжээ төлөвлөх нь зүйтэй."
            ),
        })

    precip = values["Precipitation_mm"]
    if precip <= q["Precipitation_mm"][25]:
        items.append({
            "tag": "Drought" if en else "Ган",
            "priority": 3 + (q["Precipitation_mm"][25] - precip) / 100,
            "text": (
                f"Annual precipitation {precip:.0f} mm is below the lower 25% "
                f"({q['Precipitation_mm'][25]:.0f} mm). Build hay and feed reserves, "
                "upgrade water points and activate early drought warning."
            ) if en else (
                f"Жилийн хур тунадас {precip:.0f} мм нь доод 25%-иас "
                f"({q['Precipitation_mm'][25]:.0f} мм) бага байна. Өвс, тэжээлийн нөөц "
                "бүрдүүлэх, усан хангамжийн цэгийг шинэчлэх, гангийн эрт анхааруулга "
                "хяналтыг идэвхжүүлэх хэрэгтэй."
            ),
        })
    elif precip >= q["Precipitation_mm"][75]:
        items.append({
            "tag": "Precipitation" if en else "Хур тунадас",
            "priority": 0.5,
            "text": (
                f"Precipitation {precip:.0f} mm is relatively good. Still, prevent "
                "overgrazing and manage stocking during the green season."
            ) if en else (
                f"Хур тунадас {precip:.0f} мм харьцангуй сайн байна. Гэхдээ хэт "
                "бэлчээрлэлтээс сэргийлж, ногоон улирлын ачааллыг зохицуулах нь чухал."
            ),
        })

    temp = values["Temperature_C"]
    if temp >= q["Temperature_C"][75]:
        items.append({
            "tag": "Climate" if en else "Уур амьсгал",
            "priority": 2 + (temp - q["Temperature_C"][75]) / 3,
            "text": (
                f"Mean temperature {temp:.1f}°C is above the upper 25% "
                f"({q['Temperature_C'][75]:.1f}°C). Evaporation rises and moisture "
                "declines, so prioritize water sources and shaded pastures."
            ) if en else (
                f"Агаарын дундаж температур {temp:.1f}°C нь дээд 25%-иас "
                f"({q['Temperature_C'][75]:.1f}°C) өндөр байна. Ууршилт нэмэгдэж "
                "чийг хомсдох тул усны эх, сүүдэртэй бэлчээрийг тэргүүлэх нь зүйтэй."
            ),
        })

    livestock = values["Total_Livestock"]
    if livestock >= q["Total_Livestock"][75]:
        items.append({
            "tag": "Herd structure" if en else "Малын бүтэц",
            "priority": 1.5 + (livestock - q["Total_Livestock"][75]) / 5_000_000,
            "text": (
                f"Total livestock {livestock:,.0f} sheep units falls in the top 25%. "
                "Align herd structure and numbers with carrying capacity and stop "
                "rapid growth."
            ) if en else (
                f"Нийт мал {livestock:,.0f} хонин толгой нь дээд 25%-д багтаж байна. "
                "Малын бүтэц, тоог бэлчээрийн даацад нийцүүлж, эрчимтэй өсөлтийг "
                "зогсоох шаардлагатай."
            ),
        })

    top = factors[0]
    if top["effect"] >= 1.5:
        items.append({
            "tag": "Main driver" if en else "Гол нөлөө",
            "priority": 4 + top["effect"] / 10,
            "text": (
                f"The factor raising the score most is “{top['label']}” "
                f"(+{top['effect']:.1f} pts vs median). Moving it closer to the median "
                f"would lower the risk score by about {top['effect']:.1f} points."
            ) if en else (
                f"Оноог хамгийн их өсгөж буй хүчин зүйл нь «{top['label']}» "
                f"(медианаас +{top['effect']:.1f} оноо). Энэ үзүүлэлтийг медиан "
                f"түвшинд ойртуулбал эрсдэлийн оноо ойролцоогоор "
                f"{top['effect']:.1f} нэгжээр буурна."
            ),
        })

    if score >= MEDIUM_MAX:
        items.append({
            "tag": "Monitoring" if en else "Хяналт",
            "priority": 1.8,
            "text": (
                "The area is in the high-risk band. Monitor pasture quarterly and "
                "prepare reserve pasture and feed contingency plans."
            ) if en else (
                "Өндөр эрсдэлийн бүсэд байна. Бэлчээрийн мониторингийг улирал бүр "
                "хийж, нөөц бэлчээр, тэжээлийн нөөцийн төлөвлөгөөг бэлтгэх хэрэгтэй."
            ),
        })
    elif score >= LOW_MAX:
        items.append({
            "tag": "Monitoring" if en else "Хяналт",
            "priority": 1.8,
            "text": (
                "Risk is moderate. Review NDVI, precipitation and stocking quarterly, "
                "and adjust grazing pressure early if risk rises."
            ) if en else (
                "Дунд эрсдэлтэй байна. NDVI, хур тунадас, ачааллын үзүүлэлтийг "
                "улирал тутам хянаж, эрсдэл нэмэгдэхэд бэлчээрийн ачааллыг "
                "эрт зохицуулах нь зүйтэй."
            ),
        })
    else:
        items.append({
            "tag": "Monitoring" if en else "Хяналт",
            "priority": 0.2,
            "text": (
                "Risk is low under current conditions. Continue annual monitoring and "
                "watch seasonal NDVI changes."
            ) if en else (
                "Одоогийн үзүүлэлтээр эрсдэл бага байна. Жилийн хяналт, NDVI-ийн "
                "улирлын өөрчлөлтийг үргэлжлүүлэн ажиглах нь зүйтэй."
            ),
        })

    items.sort(key=lambda r: r["priority"], reverse=True)
    return [{
        "tag": r["tag"],
        "text": r["text"],
        "level": "high" if r["priority"] >= 3.5 else "mid" if r["priority"] >= 2 else "low",
    } for r in items[:4]]


def improvement_scenarios(values, base_score, lang="mn"):
    """Мал, ачаалал, NDVI-г өөрчлөхөд эрсдэлийн оноо хэр өөрчлөгдөхийг тооцно."""
    en = lang == "en"
    rows = []

    def add(key, label, changed, detail):
        alt = dict(values)
        alt.update(changed)
        xs = scaler.transform(pd.DataFrame([alt], columns=FEATURES))[0]
        sc, _, _ = knn_score(xs)
        sc = float(round(sc, 1))
        rows.append({
            "key": key,
            "label": label,
            "detail": detail,
            "apply": {f: round(float(v), 3) for f, v in changed.items()},
            "score": sc,
            "delta": round(sc - float(base_score), 1),
        })

    rate = float(values["Stocking_Rate"])
    if rate > 1.0:
        add("stocking", "Bring stocking rate to carrying capacity" if en else "Ачааллыг даацтай тэнцүүлэх",
            {"Stocking_Rate": 1.0},
            f"Stocking {rate:.2f} → 1.00" if en else f"Ачаалал {rate:.2f} → 1.00")

    livestock = float(values["Total_Livestock"])
    if livestock > 1_000_000:
        cut = round(livestock * 0.9)
        add("livestock", "Reduce livestock by 10%" if en else "Малын тоог 10% бууруулах",
            {"Total_Livestock": cut},
            f"{livestock:,.0f} → {cut:,.0f} head" if en else f"{livestock:,.0f} → {cut:,.0f} толгой")

    ndvi = float(values["NDVI"])
    if ndvi < 0.5:
        up = round(min(0.5, ndvi + 0.05), 3)
        add("ndvi", "Rest pasture and raise NDVI" if en else "Бэлчээрийг амрааж NDVI-г нэмэх",
            {"NDVI": up},
            f"NDVI {ndvi:.3f} → {up:.3f}")

    rows.sort(key=lambda r: r["delta"])
    return rows


def row_features(row):
    return {f: float(row[f]) for f in SHOW}


# ----------------------------------------------------------------- Endpoint-ууд
@app.get("/")
def index():
    folder = BASE if (BASE / "index.html").exists() else app.static_folder
    return send_from_directory(folder, "index.html")


@app.get("/api/health")
def health():
    return jsonify(status="ok", aimags=len(AIMAGS), years=[YEARS[0], YEARS[-1]],
                   n_samples=int(len(df)))


@app.get("/api/model-info")
def model_info():
    return jsonify(
        algorithm="K-Nearest Neighbors (Regressor, distance-weighted)",
        features=FEATURES,
        feature_labels=labels_for(req_lang()),
        quantiles=QUANTILES,
        **{k: META[k] for k in ("best_params", "metrics", "n_samples", "years",
                                 "feature_ranges", "thresholds")},
    )


@app.get("/api/aimags")
def aimags():
    return jsonify(aimags=AIMAGS, aimag_names=AIMAG_EN, years=YEARS, latest_year=LATEST_YEAR)


@app.post("/api/predict")
def predict():
    """
    Body (JSON):
    {"Total_Livestock": 3200000, "Precipitation_mm": 120, "Temperature_C": -3,
     "NDVI": 0.33, "Stocking_Rate": 1.2}
    """
    lang = req_lang()
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="JSON body is required" if lang == "en" else "JSON body шаардлагатай"), 400
    values, errors = parse_features(payload, lang)
    if errors:
        return jsonify(errors=errors), 422

    x_scaled = scaler.transform(pd.DataFrame([values], columns=FEATURES))[0]
    score, spread, neighbors = knn_score(x_scaled, with_neighbors=True)
    pct = float((Y < score).mean() * 100)
    lo, hi = max(0.0, score - spread), min(100.0, score + spread)
    factors = factor_effects(values, score, lang)

    return jsonify(
        risk_score=round(score, 1),
        risk_level=level_of(score, lang),
        level_key=level_key(score),
        range=[round(lo, 1), round(hi, 1)],
        percentile=round(pct),
        k=knn.n_neighbors,
        national_mean=round(float(Y.mean()), 1),
        neighbors=neighbors,
        warnings=range_warnings(values, lang),
        factors=factors,
        recommendations=recommendations(values, score, factors, lang),
        scenarios=improvement_scenarios(values, score, lang),
        input=values,
    )


@app.get("/api/dataset")
def dataset():
    """Бүх аймаг-жилийн өгөгдөл. score = өгөгдлийн оноо, knn = leave-one-out таамаглал."""
    lang = req_lang()
    rows = [
        {"aimag": str(r["Аймаг"]), "year": int(r["Жил"]),
         "score": round(float(ACTUAL[i]), 1),
         "knn": round(float(LOO_SCORE[i]), 1),
         "level": level_of(float(ACTUAL[i]), lang),
         "level_key": level_key(float(ACTUAL[i])),
         **row_features(r)}
        for i, r in df.iterrows()
    ]
    return jsonify(rows=rows, thresholds=META["thresholds"], years=YEARS,
                   aimags=AIMAGS, aimag_names=AIMAG_EN, latest_year=LATEST_YEAR,
                   national_mean_by_year=NATIONAL_MEAN_BY_YEAR)


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
    lang = req_lang()
    sub = df[df["Аймаг"] == name]
    if sub.empty:
        msg = f"Aimag '{name}' not found" if lang == "en" else f"'{name}' аймаг олдсонгүй"
        return jsonify(error=msg), 404
    rows = []
    for i in sub.index:
        rows.append(
            {
                "year": int(df.at[i, "Жил"]),
                "actual_score": round(float(ACTUAL[i]), 1),
                "actual_level": level_of(float(ACTUAL[i]), lang),
                "knn_estimate": round(float(LOO_SCORE[i]), 1),
                **row_features(df.loc[i]),
            }
        )
    return jsonify(aimag=name, history=sorted(rows, key=lambda r: r["year"]))


@app.get("/api/ranking")
def ranking():
    """?year=2025 - тухайн жилийн аймгуудыг эрсдэлээр эрэмбэлнэ (default: сүүлийн жил)."""
    lang = req_lang()
    year = request.args.get("year", type=int, default=LATEST_YEAR)
    sub = df[df["Жил"] == year]
    if sub.empty:
        msg = f"No data for {year}" if lang == "en" else f"{year} оны өгөгдөл байхгүй"
        return jsonify(error=msg), 404
    out = []
    for i in sub.index:
        out.append(
            {
                "aimag": str(df.at[i, "Аймаг"]),
                "actual_score": round(float(ACTUAL[i]), 1),
                "knn_estimate": round(float(LOO_SCORE[i]), 1),
                "knn_level": level_of(float(LOO_SCORE[i]), lang),
                "actual_level": level_of(float(ACTUAL[i]), lang),
            }
        )
    out.sort(key=lambda r: r["knn_estimate"], reverse=True)
    for rank, r in enumerate(out, 1):
        r["rank"] = rank
    return jsonify(year=year, ranking=out)


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")),
            debug=True, use_reloader=False)
