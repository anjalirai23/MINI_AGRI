import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from preprocessing.features import load_crop_series
from preprocessing.forecasting import (
    LSTM_WINDOW, MAX_HORIZON, arima_exog, direct_features_for_forecast, future_dates, pick_bucket,
)
from preprocessing.lstm_arch import build_lstm_model

log = logging.getLogger("ml-service")
logging.basicConfig(level=logging.INFO)

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models"
DATA_DIR = ROOT / "datasets"

CROPS = ["wheat", "paddy", "cotton", "maize"]
SEASONS = ["Kharif", "Rabi", "Zaid"]
WATER_LEVELS = ["Low", "Medium", "High"]
SOIL_TYPES = ["Sandy", "Loamy", "Clay"]
PRICE_MODELS = ("LSTM", "ARIMA", "XGBoost")
FORMAT_VERSION = 2
RETRAIN_HINT = (
    "The saved models are missing or from an older version. In the ml-service folder run: "
    "python train_all.py, then restart this service."
)

_price_metrics = {}
_demand_metrics = {}
_recommend_metrics = {}
_recommend_model = None
_production_cost = pd.read_csv(DATA_DIR / "production_cost.csv")

_price_series_cache = {}
_demand_series_cache = {}
_models = {"arima": {}, "xgb": {}, "lstm": {}, "demand": {}}
_load_errors = []
_loaded = False


def _read_json(name):
    path = MODEL_DIR / name
    return json.loads(path.read_text()) if path.exists() else {}


def _check_version(bundle, label):
    if not isinstance(bundle, dict) or bundle.get("version") != FORMAT_VERSION:
        raise RuntimeError(f"{label}: old model format")
    return bundle


def load_all_models():
    """Load every model once at start-up (and warm the LSTMs) so the first request is not slow."""
    global _price_metrics, _demand_metrics, _recommend_metrics, _recommend_model, _loaded
    _loaded = True
    _load_errors.clear()
    _price_metrics, _demand_metrics = _read_json("price_metrics.json"), _read_json("demand_metrics.json")
    _recommend_metrics = _read_json("recommend_metrics.json")
    try:
        _recommend_model = joblib.load(MODEL_DIR / "recommend_yield_rf.pkl")
    except Exception as exc:
        _load_errors.append(f"recommend: {exc}")

    for crop in CROPS:
        steps = [
            ("arima", lambda c=crop: _check_version(joblib.load(MODEL_DIR / f"price_arima_{c}.pkl"), f"ARIMA {c}")),
            ("xgb", lambda c=crop: _check_version(joblib.load(MODEL_DIR / f"price_xgb_{c}.pkl"), f"XGBoost {c}")),
            ("demand", lambda c=crop: _check_version(joblib.load(MODEL_DIR / f"demand_rf_{c}.pkl"), f"demand {c}")),
            ("lstm", lambda c=crop: _load_lstm(c)),
        ]
        for key, loader in steps:
            try:
                _models[key][crop] = loader()
            except Exception as exc:
                _load_errors.append(f"{key}/{crop}: {exc}")
                log.warning("could not load %s model for %s: %s", key, crop, exc)
    if _load_errors:
        log.warning("Some models are not ready. %s", RETRAIN_HINT)
    else:
        log.info("All models loaded.")


def _load_lstm(crop):
    meta = _check_version(joblib.load(MODEL_DIR / f"price_lstm_meta_{crop}.pkl"), f"LSTM {crop}")
    model = build_lstm_model(meta["window"], meta["horizon"], compile_model=False)
    model.load_weights(MODEL_DIR / f"price_lstm_{crop}.weights.h5")
    model(np.zeros((1, meta["window"], 1), dtype="float32"), training=False)   # warm-up
    return {"model": model, **meta}


@asynccontextmanager
async def lifespan(_app):
    load_all_models()
    yield


app = FastAPI(title="AgriMarket AI ML Service", lifespan=lifespan)


def _ensure_loaded():
    """Normally done once in lifespan(); this also covers clients that skip lifespan (e.g. plain TestClient)."""
    if not _loaded:
        load_all_models()


def _get(kind, crop):
    _ensure_loaded()
    bundle = _models[kind].get(crop)
    if bundle is None:
        raise HTTPException(status_code=503, detail=f"The {kind} model for {crop} is not ready. {RETRAIN_HINT}")
    return bundle


def get_price_series(crop):
    if crop not in _price_series_cache:
        _price_series_cache[crop] = load_crop_series(DATA_DIR / "crop_prices.csv", crop)
    return _price_series_cache[crop].copy()


def get_demand_series(crop):
    if crop not in _demand_series_cache:
        df = pd.read_csv(DATA_DIR / "demand.csv", parse_dates=["date"])
        df = df[df.crop == crop].groupby("date", as_index=False)["demand_index"].mean().sort_values("date")
        full = pd.date_range(df.date.min(), df.date.max(), freq="D")
        _demand_series_cache[crop] = df.set_index("date").reindex(full).ffill().rename_axis("date").reset_index()
    return _demand_series_cache[crop].copy()


class PriceRequest(BaseModel):
    crop: str
    model: str = "auto"
    horizon_days: int = 90


class DemandRequest(BaseModel):
    crop: str
    horizon_weeks: int = 8


class RecommendRequest(BaseModel):
    season: str
    water_availability: str
    soil_type: str
    acres: float = 1.0


def _validate_crop(crop):
    if crop not in CROPS:
        raise HTTPException(status_code=400, detail=f"Unknown crop '{crop}'. Valid: {CROPS}")


def _validate_choice(value, choices, field):
    if value not in choices:
        raise HTTPException(status_code=400, detail=f"{field} must be one of {choices}")


@app.get("/health")
def health():
    _ensure_loaded()
    ready = not _load_errors
    return {"status": "ok" if ready else "degraded", "models_ready": ready,
            "problems": _load_errors[:8], "hint": None if ready else RETRAIN_HINT}


def _forecast_arima(crop, series_df, horizon):
    b = _get("arima", crop)
    last = series_df["date"].iloc[-1]
    gap = max(0, int((pd.Timestamp(last) - pd.Timestamp(b["last_date"])).days))   # data newer than the model
    fut = future_dates(b["last_date"], gap + horizon)
    mean = b["fit"].get_forecast(steps=gap + horizon, exog=arima_exog(fut, b["t0"])).predicted_mean
    return np.asarray(mean, dtype=float)[gap:]


def _forecast_xgb(crop, series_df, horizon):
    b = _get("xgb", crop)
    dates = pd.DatetimeIndex(series_df["date"])
    resid = series_df["price_per_quintal"].values - b["baseline"].predict(dates)
    X, fut = direct_features_for_forecast(resid[-200:], dates[-1], horizon)
    return b["baseline"].predict(fut) + b["model"].predict(X[b["feature_cols"]])


def _forecast_lstm(crop, series_df, horizon):
    b = _get("lstm", crop)
    dates = pd.DatetimeIndex(series_df["date"])
    resid = series_df["price_per_quintal"].values - b["baseline"].predict(dates)
    window = (resid[-b["window"]:] / b["scale"]).reshape(1, b["window"], 1).astype("float32")
    path = b["model"](window, training=False).numpy()[0][:horizon] * b["scale"]   # one forward pass
    return b["baseline"].predict(future_dates(dates[-1], horizon)) + path


_PRICE_FORECASTERS = {"ARIMA": _forecast_arima, "XGBoost": _forecast_xgb, "LSTM": _forecast_lstm}


@app.post("/predict/price")
def predict_price(req: PriceRequest):
    crop = req.crop.lower()
    _validate_crop(crop)
    horizon = max(1, min(req.horizon_days, 180))
    _ensure_loaded()
    metrics = _price_metrics.get(crop)
    if not metrics or "by_horizon" not in metrics.get("XGBoost", {}):
        raise HTTPException(status_code=503, detail=f"Price metrics are missing or outdated. {RETRAIN_HINT}")

    bucket = pick_bucket(metrics["XGBoost"]["by_horizon"], horizon)
    stats = {m: metrics[m]["by_horizon"][bucket] for m in PRICE_MODELS}
    best_model = min(PRICE_MODELS, key=lambda m: stats[m]["rmse"])   # best at THIS horizon
    model_choice = req.model if req.model != "auto" else best_model
    if model_choice not in PRICE_MODELS:
        raise HTTPException(status_code=400, detail="model must be LSTM, ARIMA, XGBoost or auto")

    series_df = get_price_series(crop)
    future = future_dates(series_df["date"].iloc[-1], horizon)
    forecast = _PRICE_FORECASTERS[model_choice](crop, series_df, horizon)
    forecast = np.maximum(np.asarray(forecast, dtype=float), 1.0)

    current_price = float(series_df["price_per_quintal"].iloc[-1])
    final_price = float(forecast[-1])
    pct_change = (final_price - current_price) / current_price * 100
    # confidence from the *measured* error of the final-day forecast at this horizon (back-test)
    confidence = max(50, min(97, round(100 - stats[model_choice]["endpoint_mape"] * 4, 1)))

    return {
        "success": True,
        "data": {
            "crop": crop,
            "model": model_choice,
            "current_price": round(current_price, 2),
            "forecast_price": round(final_price, 2),
            "pct_change": round(pct_change, 2),
            "confidence": confidence,
            "horizon_days": horizon,
            "history": [
                {"date": d.strftime("%Y-%m-%d"), "price": round(p, 2)}
                for d, p in zip(series_df["date"].tail(120), series_df["price_per_quintal"].tail(120))
            ],
            "forecast": [
                {"date": d.strftime("%Y-%m-%d"), "price": round(float(p), 2)} for d, p in zip(future, forecast)
            ],
            "model_comparison": {
                m: {"mae": round(stats[m]["mae"], 2), "rmse": round(stats[m]["rmse"], 2), "mape": round(stats[m]["mape"], 3)}
                for m in PRICE_MODELS
            },
            "evaluated_horizon_days": int(bucket),
            "best_model": best_model,
        },
        "message": "Prediction generated successfully",
    }


@app.post("/predict/demand")
def predict_demand(req: DemandRequest):
    crop = req.crop.lower()
    _validate_crop(crop)
    bundle = _get("demand", crop)
    m = _demand_metrics.get(crop)
    if not m or "by_horizon" not in m:
        raise HTTPException(status_code=503, detail=f"Demand metrics are missing or outdated. {RETRAIN_HINT}")

    weeks = max(1, min(req.horizon_weeks, 26))
    horizon_days = weeks * 7
    series_df = get_demand_series(crop)
    dates = pd.DatetimeIndex(series_df["date"])
    y = series_df["demand_index"].values.astype(float)
    resid = y - bundle["baseline"].predict(dates)
    X, fut = direct_features_for_forecast(resid[-200:], dates[-1], horizon_days)
    forecast = np.clip(bundle["baseline"].predict(fut) + bundle["model"].predict(X[bundle["feature_cols"]]), 0, 100)

    weekly = [round(float(np.mean(forecast[i:i + 7])), 1) for i in range(0, len(forecast), 7)]
    current = float(y[-1])
    avg_forecast = float(np.mean(forecast))
    trend = "Rising" if avg_forecast > current + 2 else ("Falling" if avg_forecast < current - 2 else "Stable")
    level = "High" if avg_forecast >= 65 else ("Medium" if avg_forecast >= 40 else "Low")
    acc = m["by_horizon"][pick_bucket(m["by_horizon"], horizon_days)]

    return {
        "success": True,
        "data": {
            "crop": crop,
            "model": bundle.get("model_type", "HistGradientBoosting"),
            "current_demand_index": round(current, 1),
            "predicted_demand_index": round(avg_forecast, 1),
            "demand_trend": trend,
            "demand_level": level,
            "weekly_forecast": weekly,
            "horizon_weeks": weeks,
            "accuracy": {"mape": round(acc["mape"], 2), "mae": round(acc["mae"], 2)},
        },
        "message": "Prediction generated successfully",
    }


@app.post("/predict/recommend")
def predict_recommend(req: RecommendRequest):
    season = req.season.strip().title()
    water = req.water_availability.strip().title()
    soil = req.soil_type.strip().title()
    _validate_choice(season, SEASONS, "season")
    _validate_choice(water, WATER_LEVELS, "water_availability")
    _validate_choice(soil, SOIL_TYPES, "soil_type")
    acres = max(0.1, min(req.acres, 1000))

    query = pd.DataFrame([
        {"crop": crop, "season": season, "water_availability": water, "soil_type": soil}
        for crop in CROPS
    ])
    _ensure_loaded()
    if _recommend_model is None:
        raise HTTPException(status_code=503, detail=f"The recommendation model is not ready. {RETRAIN_HINT}")
    predicted_yield = _recommend_model.predict(query)

    results = []
    for crop, yield_qtl in zip(CROPS, predicted_yield):
        price_series = get_price_series(crop)
        current_price = float(price_series["price_per_quintal"].iloc[-1])

        cost_row = _production_cost[
            (_production_cost.crop == crop) & (_production_cost.season == season)
        ]
        if cost_row.empty:
            cost_row = _production_cost[_production_cost.crop == crop]
        if cost_row.empty:
            raise HTTPException(
                status_code=500,
                detail=f"No production cost data available for crop '{crop}'. "
                        "Check production_cost.csv coverage.",
            )
        cost_breakdown = {
            "seed": float(cost_row["seed_cost"].mean()),
            "fertilizer": float(cost_row["fertilizer_cost"].mean()),
            "labour": float(cost_row["labour_cost"].mean()),
            "irrigation": float(cost_row["irrigation_cost"].mean()),
            "other": float(cost_row["other_cost"].mean()),
        }
        cost_per_acre = sum(cost_breakdown.values())

        revenue_per_acre = float(yield_qtl) * current_price
        profit_per_acre = revenue_per_acre - cost_per_acre
        margin_pct = (profit_per_acre / revenue_per_acre * 100) if revenue_per_acre > 0 else 0.0

        results.append({
            "crop": crop,
            "predicted_yield_qtl_per_acre": round(float(yield_qtl), 2),
            "current_price_per_quintal": round(current_price, 2),
            "cost_breakdown_per_acre": {k: round(v, 2) for k, v in cost_breakdown.items()},
            "total_cost_per_acre": round(cost_per_acre, 2),
            "total_cost": round(cost_per_acre * acres, 2),
            "expected_revenue_per_acre": round(revenue_per_acre, 2),
            "expected_profit_per_acre": round(profit_per_acre, 2),
            "expected_profit_total": round(profit_per_acre * acres, 2),
            "profit_margin_pct": round(margin_pct, 1),
        })

    results.sort(key=lambda r: r["expected_profit_per_acre"], reverse=True)
    for i, r in enumerate(results):
        r["rank"] = i + 1

    return {
        "success": True,
        "data": {
            "season": season,
            "water_availability": water,
            "soil_type": soil,
            "acres": acres,
            "recommended_crop": results[0]["crop"],
            "ranking": results,
            "model_accuracy": {
                "r2": round(_recommend_metrics["cv_5fold"]["r2"], 3),
                "mae_qtl_per_acre": round(_recommend_metrics["cv_5fold"]["mae"], 2),
            },
        },
        "message": "Recommendation generated successfully",
    }


@app.get("/metrics/price")
def price_metrics():
    return {"success": True, "data": _price_metrics}


@app.get("/metrics/demand")
def demand_metrics():
    return {"success": True, "data": _demand_metrics}


@app.get("/metrics/recommend")
def recommend_metrics():
    return {"success": True, "data": _recommend_metrics}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
