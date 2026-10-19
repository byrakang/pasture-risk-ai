
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
DATA_PATH = "database.xlsx"
MODEL_DIR = BASE / "model"
SHEET = "ML Model Dataset (Risk Score)"

FEATURES = [
    "Total_Livestock",     
    "Precipitation_mm",   
    "Temperature_C",       
    "NDVI",                
    "Stocking_Rate",       
]
TARGET = "Degradation_Risk_Score"
TARGET_CLASS = "Risk_Level_Class"
GROUP = "Аймаг"

LOW_MAX, MEDIUM_MAX = 35.0, 65.0


def score_to_level(score: float) -> str:
    if score < LOW_MAX:
        return "Бага (Low)"
    if score < MEDIUM_MAX:
        return "Дунд (Medium)"
    return "Өндөр (High)"


def make_pipeline(estimator):
    return Pipeline([("scaler", StandardScaler()), ("knn", estimator)])


def main():
    df = pd.read_excel(DATA_PATH, sheet_name=SHEET)
    X, y, y_cls, groups = df[FEATURES], df[TARGET], df[TARGET_CLASS], df[GROUP]

    param_grid = {
        "knn__n_neighbors": [3, 5, 7, 9, 11, 15, 21],
        "knn__weights": ["uniform", "distance"],
        "knn__p": [1, 2], 
    }

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

    metrics = {}

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
