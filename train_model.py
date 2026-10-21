"""
Бэлчээрийн талхагдлын эрсдэлийн оноо (Pasture Degradation Risk Score) -
KNN загварыг сургах скрипт.

Ажиллуулах:  python train_model.py
Гаралт:      model/knn_regressor.joblib, model/knn_classifier.joblib, model/metadata.json
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, mean_absolute_error, r2_score
from sklearn.model_selection import GridSearchCV, GroupKFold
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

BASE = Path(__file__).parent
def _find(name, *dirs):
    """Файлыг data/ хавтаснаас, эсвэл төслийн үндэс хавтаснаас хайна (GitHub-д хавтасгүй оруулсан ч ажиллана)."""
    for d in dirs:
        p = BASE / d / name
        if p.exists():
            return p
    raise FileNotFoundError(f"{name} олдсонгүй. Хайсан хавтас: {', '.join(dirs)}")


DATA_PATH = _find("database.xlsx", "data", ".")
MODEL_DIR = BASE / "model"
SHEET = "ML Model Dataset (Risk Score)"

FEATURES = [
    "Total_Livestock",     # Нийт мал (хонин толгойд шилжүүлснээр)
    "Precipitation_mm",    # Жилийн хур тунадас
    "Temperature_C",       # Жилийн дундаж температур
    "NDVI",                # Ургамлын индекс
    "Stocking_Rate",       # Бэлчээрийн ачааллын коэффициент
]
TARGET = "Degradation_Risk_Score"
TARGET_CLASS = "Risk_Level_Class"
GROUP = "Аймаг"

# Оноог ангилах босго (өгөгдлийн Risk_Level_Class-тай таарч байгаа)
LOW_MAX, MEDIUM_MAX = 35.0, 65.0


def score_to_level(score: float) -> str:
    if score < LOW_MAX:
        return "Бага (Low)"
    if score < MEDIUM_MAX:
        return "Дунд (Medium)"
    return "Өндөр (High)"


def make_pipeline(estimator):
    # KNN зайнд суурилдаг тул шинж чанаруудыг заавал стандартчилна
    # (мал 10^6, NDVI 10^-1 орчим - стандартчилахгүй бол мал бүх зайг тодорхойлно)
    return Pipeline([("scaler", StandardScaler()), ("knn", estimator)])


def main():
    df = pd.read_excel(DATA_PATH, sheet_name=SHEET)
    X, y, y_cls, groups = df[FEATURES], df[TARGET], df[TARGET_CLASS], df[GROUP]

    param_grid = {
        "knn__n_neighbors": [3, 5, 7, 9, 11, 15, 21],
        "knn__weights": ["uniform", "distance"],
        "knn__p": [1, 2],  # 1 = Manhattan, 2 = Euclidean
    }

    # ---- 1. Hyperparameter сонголт: аймгаар бүлэглэсэн CV ----
    # Санамсаргүй CV нь нэг аймгийн өөр жилүүдийг сургалт/тест хоёрт хуваадаг тул
    # хэт өөдрөг үр дүн өгдөг. GroupKFold нь "огт үзээгүй аймаг"-т хэр ажиллахыг үнэлнэ.
    gkf = GroupKFold(n_splits=7)
    search = GridSearchCV(
        make_pipeline(KNeighborsRegressor()),
        param_grid,
        cv=gkf,
        scoring="neg_mean_absolute_error",
        n_jobs=-1,
    )
    search.fit(X, y, groups=groups)
    best = {k.replace("knn__", ""): v for k, v in search.best_params_.items()}
    print("Шилдэг параметр:", best)

    # ---- 2. Үнэлгээ ----
    metrics = {}

    # (a) Огт үзээгүй аймагт
    fold_pred = np.zeros(len(df))
    for tr, te in gkf.split(X, y, groups):
        m = make_pipeline(KNeighborsRegressor(**best)).fit(X.iloc[tr], y.iloc[tr])
        fold_pred[te] = m.predict(X.iloc[te])
    metrics["unseen_aimag_cv"] = {
        "MAE": round(mean_absolute_error(y, fold_pred), 2),
        "R2": round(r2_score(y, fold_pred), 3),
        "class_accuracy": round(
            accuracy_score(y_cls, [score_to_level(s) for s in fold_pred]), 3
        ),
    }

    # (b) Цаг хугацааны хуваалт: 2010–2022-оор сургаад 2023–2025-ыг таамаглах
    train_mask = df["Жил"] <= 2022
    m = make_pipeline(KNeighborsRegressor(**best)).fit(X[train_mask], y[train_mask])
    pred = m.predict(X[~train_mask])
    metrics["time_split_2023_2025"] = {
        "MAE": round(mean_absolute_error(y[~train_mask], pred), 2),
        "R2": round(r2_score(y[~train_mask], pred), 3),
        "class_accuracy": round(
            accuracy_score(y_cls[~train_mask], [score_to_level(s) for s in pred]), 3
        ),
    }
    for name, r in metrics.items():
        print(name, r)

    # ---- 3. Эцсийн загварууд: бүх өгөгдөл дээр сургана ----
    regressor = make_pipeline(KNeighborsRegressor(**best)).fit(X, y)
    classifier = make_pipeline(KNeighborsClassifier(**best)).fit(X, y_cls)

    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump(regressor, MODEL_DIR / "knn_regressor.joblib")
    joblib.dump(classifier, MODEL_DIR / "knn_classifier.joblib")

    metadata = {
        "features": FEATURES,
        "best_params": best,
        "metrics": metrics,
        "n_samples": int(len(df)),
        "years": [int(df["Жил"].min()), int(df["Жил"].max())],
        "feature_ranges": {
            f: [float(df[f].min()), float(df[f].max())] for f in FEATURES
        },
        "thresholds": {"low_max": LOW_MAX, "medium_max": MEDIUM_MAX},
    }
    (MODEL_DIR / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("Загвар model/ хавтаст хадгалагдлаа.")


if __name__ == "__main__":
    main()
