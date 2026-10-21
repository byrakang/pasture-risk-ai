import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

file_path = 'database.xlsx'

excel_file = pd.ExcelFile(file_path)
sheet_name = excel_file.sheet_names[0]
df = pd.read_excel(file_path, sheet_name=sheet_name)

features = ["Total_Livestock", "Precipitation_mm", "Temperature_C", "NDVI", "Stocking_Rate"]
X = df[features]

y = (X['Stocking_Rate'] > X['Stocking_Rate'].median()).astype(int)

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

knn = KNeighborsClassifier(n_neighbors=5)
knn.fit(X_train_scaled, y_train)

y_pred = knn.predict(X_test_scaled)

print("--- KNN Classifier Үр Дүн ---")
print(f"Accuracy (Нарийвчлал): {accuracy_score(y_test, y_pred):.2f}")
print("\nClassification Report:")
print(classification_report(y_test, y_pred))

def evaluate(xtr, xte, ytr, yte):
    sc = StandardScaler()
    xtr_s = sc.fit_transform(xtr)
    xte_s = sc.transform(xte)
    model = KNeighborsClassifier(n_neighbors=5)
    model.fit(xtr_s, ytr)
    preds = model.predict(xte_s)
    return accuracy_score(yte, preds)

results = {}
results["1. Санамсаргүй 80/20"] = evaluate(X_train, X_test, y_train, y_test)
print(f"\nResults Dictionary: {results}")
