"""Used Car Fair-Price Bot - API + static 3D frontend."""
import json
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "artifacts"
STATIC = Path(__file__).resolve().parent / "static"
REF_YEAR = 2026  # model was trained with car_age = 2026 - year

model = joblib.load(ART / "model.joblib")
seg = joblib.load(ART / "segments.joblib")
meta = json.load(open(ART / "meta.json"))
listings = pd.read_csv(ART / "listings.csv")

app = FastAPI(title="Used Car Fair-Price Bot", version="2.0")


class CarIn(BaseModel):
    brand: str
    year: int = Field(ge=1990, le=REF_YEAR)
    fuel: str
    transmission: str
    seller_type: str
    owner: str
    km_driven: float = Field(ge=0, le=1_000_000)
    seats: int = Field(ge=2, le=14)
    engine: float = Field(ge=500, le=6000)
    max_power: float = Field(ge=20, le=600)
    mileage: float = Field(ge=3, le=50)
    asking_price: float | None = Field(default=None, ge=0)


def frame(c: CarIn, year: int | None = None, km: float | None = None) -> pd.DataFrame:
    return pd.DataFrame([{
        "car_age": REF_YEAR - (year if year is not None else c.year),
        "km_driven": km if km is not None else c.km_driven,
        "mileage": c.mileage, "engine": c.engine, "max_power": c.max_power, "seats": c.seats,
        "brand": c.brand, "fuel": c.fuel, "seller_type": c.seller_type,
        "transmission": c.transmission, "owner": c.owner}])


def price_of(df: pd.DataFrame) -> float:
    return float(np.expm1(model.predict(df))[0])


def segment_of(price: float, engine: float, power: float) -> str:
    z = seg["scaler"].transform(np.log1p(pd.DataFrame([[price, engine, power]], columns=meta["seg_features"])))
    return seg["names"][int(seg["kmeans"].predict(z)[0])]


@app.get("/health")
def health():
    return {"status": "ok", "model": meta["best_model"]}


@app.get("/api/meta")
def get_meta():
    keys = ["brands", "fuel", "seller_type", "transmission", "owner", "seats", "defaults", "ranges",
            "best_model", "band"]
    return {k: meta[k] for k in keys}


@app.post("/api/predict")
def predict(c: CarIn):
    for field, allowed in [("brand", meta["brands"]), ("fuel", meta["fuel"]), ("transmission", meta["transmission"]),
                           ("seller_type", meta["seller_type"]), ("owner", meta["owner"])]:
        if getattr(c, field) not in allowed:
            raise HTTPException(422, f"Unknown {field}: {getattr(c, field)}")
    p = price_of(frame(c))
    lo, hi = p * (1 - meta["band"]), p * (1 + meta["band"])

    # what-if: depreciation as the car ages / mileage climbs
    curve = []
    for y in range(REF_YEAR, max(REF_YEAR - 16, 1989), -1):
        curve.append({"year": y, "price": round(price_of(frame(c, year=y)))})
    km_curve = [{"km": k, "price": round(price_of(frame(c, km=k)))} for k in range(0, 250001, 25000)]

    # similar listings from the training data
    pool = listings[listings.brand == c.brand].copy()
    if len(pool) < 5:
        pool = listings.copy()
    pool["d"] = (abs(pool.year - c.year) / 3 + abs(np.log1p(pool.km_driven) - np.log1p(c.km_driven))
                 + abs(pool.engine - c.engine) / 500)
    sim = pool.nsmallest(5, "d")
    similar = [{"name": r["name"], "year": int(r.year), "km": int(r.km_driven), "fuel": r.fuel,
                "price": int(r.selling_price)} for _, r in sim.iterrows()]

    verdict = None
    if c.asking_price:
        diff = (c.asking_price - p) / p
        if c.asking_price < lo:
            verdict = {"label": "Great deal", "tone": "good", "pct": round(-diff * 100)}
        elif c.asking_price > hi:
            verdict = {"label": "Overpriced", "tone": "bad", "pct": round(diff * 100)}
        else:
            verdict = {"label": "Fair price", "tone": "ok", "pct": round(abs(diff) * 100)}
        verdict["negotiate_to"] = round(p)

    return {"price": round(p), "low": round(lo), "high": round(hi),
            "segment": segment_of(p, c.engine, c.max_power), "verdict": verdict,
            "age_curve": curve, "km_curve": km_curve, "similar": similar,
            "model": meta["best_model"]}


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
