# %% [markdown]
# # Used Car Fair-Price Bot
# Dataset: CarDekho (`Car details v3.csv`).
# Stages: (1) Linear Regression vs KNN, (2) K-Means price segments, (3) Bagging vs Boosting + tuning, (4) UI (`app.py`).

# %%
import re, json, warnings
import numpy as np, pandas as pd, joblib
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split, RandomizedSearchCV
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LinearRegression
from sklearn.neighbors import KNeighborsRegressor
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.cluster import KMeans
from sklearn.metrics import mean_squared_error, r2_score, silhouette_score
from xgboost import XGBRegressor
warnings.filterwarnings("ignore")
RNG = 42
DATA = "data/Car details v3.csv"
OUT = "artifacts"
import os; os.makedirs(OUT, exist_ok=True)

def rmse(y, p): return float(np.sqrt(mean_squared_error(y, p)))

# %% [markdown]
# ## 1. Load and clean

# %%
df = pd.read_csv(DATA)
print("raw shape:", df.shape)

def num(s):
    m = re.search(r"[\d.]+", str(s))
    return float(m.group()) if m else np.nan

df["mileage"] = df["mileage"].map(num)
df["engine"] = df["engine"].map(num)
df["max_power"] = df["max_power"].map(num)
df["brand"] = df["name"].str.split().str[0]
df["car_age"] = 2026 - df["year"]
df = df.drop_duplicates().drop(columns=["torque"])
df = df[df["owner"] != "Test Drive Car"]
df = df.dropna(subset=["mileage", "engine", "max_power", "seats"])
# remove extreme outliers (1st-99th percentile on price & km)
for c in ["selling_price", "km_driven"]:
    lo, hi = df[c].quantile([0.01, 0.99]); df = df[df[c].between(lo, hi)]
df = df.reset_index(drop=True)
print("clean shape:", df.shape)
df.describe().T

# %%
NUM = ["car_age", "km_driven", "mileage", "engine", "max_power", "seats"]
CAT = ["brand", "fuel", "seller_type", "transmission", "owner"]
X = df[NUM + CAT]
y = np.log1p(df["selling_price"])          # log target: prices are right-skewed
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=RNG)
# RMSE is reported in rupees (after inverse log) so it is interpretable
def rmse_inr(y_log_true, y_log_pred): return rmse(np.expm1(y_log_true), np.expm1(y_log_pred))

def prep(scale=True):
    return ColumnTransformer([
        ("num", StandardScaler() if scale else "passthrough", NUM),
        ("cat", OneHotEncoder(handle_unknown="ignore", min_frequency=5), CAT)])

# %% [markdown]
# ## 2. Baselines: Linear Regression vs KNN Regressor (RMSE)

# %%
results = []
lin = Pipeline([("p", prep()), ("m", LinearRegression())]).fit(Xtr, ytr)
results.append(("Linear Regression", rmse_inr(yte, lin.predict(Xte)), r2_score(yte, lin.predict(Xte))))

knn_scores = {}
for k in range(1, 26):
    m = Pipeline([("p", prep()), ("m", KNeighborsRegressor(n_neighbors=k, weights="distance"))]).fit(Xtr, ytr)
    knn_scores[k] = rmse_inr(yte, m.predict(Xte))
best_k = min(knn_scores, key=knn_scores.get)
knn = Pipeline([("p", prep()), ("m", KNeighborsRegressor(n_neighbors=best_k, weights="distance"))]).fit(Xtr, ytr)
results.append((f"KNN (k={best_k})", rmse_inr(yte, knn.predict(Xte)), r2_score(yte, knn.predict(Xte))))

plt.figure(figsize=(6,3.5)); plt.plot(list(knn_scores), list(knn_scores.values()), marker="o")
plt.axvline(best_k, ls="--", c="gray"); plt.xlabel("k"); plt.ylabel("RMSE (INR)"); plt.title("KNN: choosing k")
plt.tight_layout(); plt.savefig(f"{OUT}/knn_k.png", dpi=150); plt.show()
pd.DataFrame(results, columns=["Model", "RMSE (INR)", "R2 (log)"])

# %% [markdown]
# ## 3. K-Means price segments

# %%
seg_feats = ["selling_price", "engine", "max_power"]   # price tier = price + size/power (not age/km)
Z = StandardScaler().fit(np.log1p(df[seg_feats]))
Zs = Z.transform(np.log1p(df[seg_feats]))
inertia, sil = {}, {}
for k in range(2, 9):
    km = KMeans(k, n_init=10, random_state=RNG).fit(Zs)
    inertia[k] = km.inertia_; sil[k] = silhouette_score(Zs, km.labels_, sample_size=3000, random_state=RNG)
fig, ax = plt.subplots(1, 2, figsize=(10,3.5))
ax[0].plot(list(inertia), list(inertia.values()), marker="o"); ax[0].set_title("Elbow (inertia)")
ax[1].plot(list(sil), list(sil.values()), marker="o"); ax[1].set_title("Silhouette")
plt.tight_layout(); plt.savefig(f"{OUT}/kmeans_k.png", dpi=150); plt.show()
print("silhouette:", {k: round(v,3) for k,v in sil.items()})

# Use k=3 for interpretable Budget / Mid-range / Premium segments
K = 3
kmeans = KMeans(K, n_init=10, random_state=RNG).fit(Zs)
df["cluster"] = kmeans.labels_
order = df.groupby("cluster")["selling_price"].median().sort_values().index.tolist()
names = {c: n for c, n in zip(order, ["Budget", "Mid-range", "Premium"])}
df["segment"] = df["cluster"].map(names)
seg_profile = df.groupby("segment")[["selling_price","engine","max_power"]].median().round(0).loc[["Budget","Mid-range","Premium"]]
seg_profile["count"] = df["segment"].value_counts()
print(seg_profile)

plt.figure(figsize=(6,4))
for s, c in zip(["Budget","Mid-range","Premium"], ["#4c78a8","#f58518","#54a24b"]):
    d = df[df.segment == s]; plt.scatter(d["car_age"], d["selling_price"]/1e5, s=6, alpha=.4, label=s, c=c)
plt.xlabel("Car age (years)"); plt.ylabel("Price (lakh INR)"); plt.legend(); plt.title("K-Means price segments")
plt.tight_layout(); plt.savefig(f"{OUT}/segments.png", dpi=150); plt.show()


# %% [markdown]
# ## 4. Bagging vs Boosting (+ hyperparameter tuning)
# Note: the segment label is derived from price, so it leaks the target during training.
# We therefore **do not** feed it to the predictor; segments are used to *describe* a predicted price in the UI.

# %%
def build(model): return Pipeline([("p", prep(scale=False)), ("m", model)])
cands = {
  "Bagging: Random Forest": (build(RandomForestRegressor(random_state=RNG, n_jobs=1)),
      {"m__n_estimators":[200,400], "m__max_depth":[None,15,25], "m__min_samples_leaf":[1,2,4], "m__max_features":[0.5,0.8,1.0]}),
  "Boosting: Gradient Boosting": (build(GradientBoostingRegressor(random_state=RNG)),
      {"m__n_estimators":[200,400], "m__learning_rate":[0.03,0.05,0.1], "m__max_depth":[3,4,5], "m__subsample":[0.7,0.9,1.0]}),
  "Boosting: XGBoost": (build(XGBRegressor(random_state=RNG, n_jobs=1, tree_method="hist")),
      {"m__n_estimators":[300,600], "m__learning_rate":[0.03,0.05,0.1], "m__max_depth":[4,6,8], "m__subsample":[0.7,0.9], "m__colsample_bytree":[0.7,0.9,1.0]}),
}
tuned = {}
for name, (pipe, grid) in cands.items():
    base = pipe.fit(Xtr, ytr)
    base_rmse = rmse_inr(yte, base.predict(Xte))
    s = RandomizedSearchCV(pipe, grid, n_iter=int(os.environ.get("N_ITER", 12)), cv=3, scoring="neg_root_mean_squared_error", random_state=RNG, n_jobs=1).fit(Xtr, ytr)
    p = s.best_estimator_.predict(Xte)
    tuned[name] = s.best_estimator_
    results.append((name + " (default)", base_rmse, r2_score(yte, base.predict(Xte))))
    results.append((name + " (tuned)", rmse_inr(yte, p), r2_score(yte, p)))
    print(name, "best:", s.best_params_)

res = pd.DataFrame(results, columns=["Model", "RMSE (INR)", "R2 (log)"]).round(3)
res["RMSE (INR)"] = res["RMSE (INR)"].round(0)
print(res.to_string(index=False)); res.to_csv(f"{OUT}/results.csv", index=False)

# %%
plt.figure(figsize=(8,4.5))
r = res.sort_values("RMSE (INR)", ascending=False)
plt.barh(r["Model"], r["RMSE (INR)"], color=["#54a24b" if "tuned" in m else "#9ecae9" for m in r["Model"]])
plt.xlabel("Test RMSE (INR) - lower is better"); plt.title("Model comparison"); plt.tight_layout()
plt.savefig(f"{OUT}/model_compare.png", dpi=150); plt.show()

# %% [markdown]
# ## 5. Save the best model for the UI

# %%
best_name = min(tuned, key=lambda n: rmse_inr(yte, tuned[n].predict(Xte)))
best = tuned[best_name]
pred = np.expm1(best.predict(Xte)); true = np.expm1(yte)
resid = (true - pred) / pred
band = float(np.quantile(np.abs(resid), 0.8))   # 80% of test cars fall within +/- band of the estimate
print(f"best: {best_name} | 80% band: +/-{band*100:.1f}%")

# refit on all data for the deployed model
best.fit(X, y)
joblib.dump(best, f"{OUT}/model.joblib")
meta = {
  "best_model": best_name, "band": band,
  "brands": sorted(df["brand"].unique().tolist()),
  "fuel": sorted(df["fuel"].unique().tolist()),
  "seller_type": sorted(df["seller_type"].unique().tolist()),
  "transmission": sorted(df["transmission"].unique().tolist()),
  "owner": sorted(df["owner"].unique().tolist()),
  "seats": sorted(int(s) for s in df["seats"].unique()),
  "defaults": {c: float(df[c].median()) for c in ["km_driven","mileage","engine","max_power"]},
  "ranges": {c: [float(df[c].min()), float(df[c].max())] for c in ["km_driven","mileage","engine","max_power","year"]},
  "kmeans_centers": kmeans.cluster_centers_.tolist(),
  "seg_order": [int(c) for c in order],
  "seg_features": seg_feats,
  "seg_profile": seg_profile.reset_index().to_dict("records"),
}
json.dump(meta, open(f"{OUT}/meta.json", "w"), indent=2)
joblib.dump({"scaler": Z, "kmeans": kmeans, "names": names}, f"{OUT}/segments.joblib")

# %% [markdown]
# ## 6. Export listings for the web app (3D cloud, similar cars)

# %%
cols = ["name","brand","year","selling_price","km_driven","fuel","transmission","owner","engine","max_power","segment","car_age"]
df[cols].to_csv(f"{OUT}/listings.csv", index=False)
print("saved", len(df), "listings")
