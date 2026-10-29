"""Train the demand forecasters (one per crop) with the same honest protocol as train_price.py.

Model: yearly-trend/seasonality baseline + gradient-boosted residual model, forecasting every day of the
horizon directly (no recursion). Metrics come from a rolling multi-day backtest on the last HOLDOUT_DAYS.
"""
import json
import sys
import time
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.append(str(Path(__file__).resolve().parent.parent))
from preprocessing.forecasting import (
    DIRECT_COLS, HarmonicBaseline, build_direct_dataset, direct_features_for_forecast, rolling_backtest,
)

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
DATA_CSV = ROOT / "datasets" / "demand.csv"
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(exist_ok=True)
CROPS = ["wheat", "paddy", "cotton", "maize"]
HOLDOUT_DAYS = 270
BACKTEST_STEP = 15
BUCKETS = (28, 56, 91, 182)      # 4, 8, 13 and 26 weeks
HEADLINE = "56"                  # 8 weeks = dashboard default
FORMAT_VERSION = 2
MODEL_TYPE = "HistGradientBoosting"


def load_demand_series(crop):
    df = pd.read_csv(DATA_CSV, parse_dates=["date"])
    df = df[df.crop == crop].groupby("date", as_index=False)["demand_index"].mean().sort_values("date")
    full_range = pd.date_range(df.date.min(), df.date.max(), freq="D")
    return df.set_index("date").reindex(full_range).ffill().rename_axis("date").reset_index()


def make_model():
    return HistGradientBoostingRegressor(
        max_iter=250, max_depth=3, learning_rate=0.05, min_samples_leaf=60, l2_regularization=1.0, random_state=42,
    )


def fit(dates, y):
    base = HarmonicBaseline().fit(dates, y)
    X, t = build_direct_dataset(y - base.predict(dates), dates)
    model = make_model().fit(X[DIRECT_COLS], t)
    return base, model


def forecast_fn(base, model, dates, y):
    resid = y - base.predict(dates)

    def fn(o, H):
        X, fut = direct_features_for_forecast(resid[:o + 1], dates[o], H)
        return np.clip(base.predict(fut) + model.predict(X[DIRECT_COLS]), 0, 100)
    return fn


def main():
    metrics = {}
    for crop in CROPS:
        t_start = time.time()
        raw = load_demand_series(crop)
        dates = pd.DatetimeIndex(raw["date"])
        y = raw["demand_index"].values.astype(float)
        cut = len(y) - HOLDOUT_DAYS

        base_ev, model_ev = fit(dates[:cut], y[:cut])
        by_h = rolling_backtest(forecast_fn(base_ev, model_ev, dates, y), y, cut, BACKTEST_STEP, BUCKETS)

        base, model = fit(dates, y)
        joblib.dump({"version": FORMAT_VERSION, "model": model, "feature_cols": DIRECT_COLS, "baseline": base,
                     "model_type": MODEL_TYPE}, MODEL_DIR / f"demand_rf_{crop}.pkl")   # filename kept for compatibility

        head = by_h[HEADLINE]
        metrics[crop] = {
            "mae": head["mae"], "rmse": head["rmse"], "mape": head["mape"], "by_horizon": by_h,
            "last_demand": float(y[-1]), "last_date": dates[-1].strftime("%Y-%m-%d"),
            "evaluation": {"method": "rolling-origin multi-day backtest", "holdout_days": HOLDOUT_DAYS,
                           "horizons": list(BUCKETS), "headline_horizon_days": int(HEADLINE), "format_version": FORMAT_VERSION},
        }
        print(f"{crop:7s} {MODEL_TYPE}  8-week MAE {head['mae']:.2f}  MAPE {head['mape']:.2f}%   ({time.time() - t_start:.0f}s)")

    with open(MODEL_DIR / "demand_metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    print("Saved demand metrics.")


if __name__ == "__main__":
    main()
