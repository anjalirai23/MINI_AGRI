"""Train the price forecasters (ARIMAX, XGBoost, LSTM) for every crop and back-test them honestly.

Protocol (per crop)
  1. Hold out the last HOLDOUT_DAYS. Fit every model on the data before that.
  2. Score full multi-day forecasts (30/60/90/180 days) from many origins inside the hold-out
     (rolling_backtest) - the same forecast the dashboard draws, not a one-step-ahead score.
  3. Refit on ALL data with the same settings for production, and save.
"""
import json
import sys
import time
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

sys.path.append(str(Path(__file__).resolve().parent.parent))
from preprocessing.features import load_crop_series
from preprocessing.forecasting import (
    HORIZON_BUCKETS, LSTM_WINDOW, MAX_HORIZON, DIRECT_COLS, HarmonicBaseline, build_direct_dataset,
    direct_features_for_forecast, future_dates, arima_exog, lstm_windows, rolling_backtest,
)

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
DATA_CSV = ROOT / "datasets" / "crop_prices.csv"
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(exist_ok=True)

CROPS = ["wheat", "paddy", "cotton", "maize"]
HOLDOUT_DAYS = 270
BACKTEST_STEP = 15
ARIMA_ORDER = (2, 0, 1)
SEED = 42
FORMAT_VERSION = 2


# ------------------------------------------------------------------ ARIMAX
def fit_arimax(dates, y):
    """Regression with ARMA errors: trend + yearly Fourier terms as exogenous regressors."""
    from statsmodels.tsa.statespace.sarimax import SARIMAX
    t0 = pd.DatetimeIndex(dates)[0]
    model = SARIMAX(np.asarray(y, dtype=float), exog=arima_exog(dates, t0), order=ARIMA_ORDER, trend="c")
    fit = model.fit(disp=False, maxiter=200)
    return fit, t0


def arimax_forecast_fn(params, dates, y, t0):
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    def fn(o, H):
        m = SARIMAX(y[:o + 1], exog=arima_exog(dates[:o + 1], t0), order=ARIMA_ORDER, trend="c")
        res = m.smooth(params)   # same parameters, filtered up to the origin (no re-fitting, no peeking)
        return np.asarray(res.get_forecast(steps=H, exog=arima_exog(future_dates(dates[o], H), t0)).predicted_mean)
    return fn


# ------------------------------------------------------------------ XGBoost (direct, on residuals)
def make_xgb():
    from xgboost import XGBRegressor
    return XGBRegressor(
        n_estimators=500, max_depth=4, learning_rate=0.04, subsample=0.8, colsample_bytree=0.8,
        min_child_weight=20, reg_lambda=2.0, random_state=SEED, n_jobs=-1,
    )


def fit_xgb(dates, y, baseline):
    resid = y - baseline.predict(dates)
    X, t = build_direct_dataset(resid, dates)
    model = make_xgb()
    model.fit(X[DIRECT_COLS], t)
    return model


def xgb_forecast_fn(model, baseline, dates, y):
    resid = y - baseline.predict(dates)

    def fn(o, H):
        X, fut = direct_features_for_forecast(resid[:o + 1], dates[o], H)
        return baseline.predict(fut) + model.predict(X[DIRECT_COLS])
    return fn


# ------------------------------------------------------------------ LSTM (direct, on residuals)
def fit_lstm(dates, y, baseline, epochs=None):
    import tensorflow as tf
    from tensorflow import keras
    from preprocessing.lstm_arch import build_lstm_model

    tf.keras.utils.set_random_seed(SEED)
    resid = y - baseline.predict(dates)
    scale = float(np.std(resid)) or 1.0
    X, Y = lstm_windows(resid, scale)
    model = build_lstm_model(compile_model=True)
    if epochs is None:
        # time-ordered validation split (last 15 %) to pick the number of epochs
        cut = int(len(X) * 0.85)
        hist = model.fit(
            X[:cut], Y[:cut], validation_data=(X[cut:], Y[cut:]), epochs=120, batch_size=64, verbose=0,
            callbacks=[keras.callbacks.EarlyStopping(patience=12, restore_best_weights=True),
                       keras.callbacks.ReduceLROnPlateau(patience=5, factor=0.5, min_lr=1e-5)],
        )
        best_epochs = int(np.argmin(hist.history["val_loss"])) + 1
        return model, scale, best_epochs
    model.fit(X, Y, epochs=epochs, batch_size=64, verbose=0)
    return model, scale, epochs


def lstm_forecast_fn(model, scale, baseline, dates, y):
    resid = y - baseline.predict(dates)

    def fn(o, H):
        window = (resid[o - LSTM_WINDOW + 1:o + 1] / scale).reshape(1, LSTM_WINDOW, 1)
        path = model(window, training=False).numpy()[0][:H] * scale
        return baseline.predict(future_dates(dates[o], H)) + path
    return fn


def main():
    from preprocessing.lstm_arch import save_inference_weights

    all_metrics = {}
    for crop in CROPS:
        t_start = time.time()
        print(f"\n=== {crop} ===")
        df = load_crop_series(DATA_CSV, crop)
        dates = pd.DatetimeIndex(df["date"])
        y = df["price_per_quintal"].values.astype(float)
        n = len(y)
        cut = n - HOLDOUT_DAYS

        # ---- stage 1: honest evaluation (models only see data before `cut`)
        base_ev = HarmonicBaseline().fit(dates[:cut], y[:cut])
        metrics = {}

        fit_a, t0_a = fit_arimax(dates[:cut], y[:cut])
        metrics["ARIMA"] = rolling_backtest(arimax_forecast_fn(fit_a.params, dates, y, t0_a), y, cut, BACKTEST_STEP)

        xgb_ev = fit_xgb(dates[:cut], y[:cut], base_ev)
        metrics["XGBoost"] = rolling_backtest(xgb_forecast_fn(xgb_ev, base_ev, dates, y), y, cut, BACKTEST_STEP)

        lstm_ev, scale_ev, best_epochs = fit_lstm(dates[:cut], y[:cut], base_ev)
        metrics["LSTM"] = rolling_backtest(lstm_forecast_fn(lstm_ev, scale_ev, base_ev, dates, y), y, cut, BACKTEST_STEP)

        # ---- stage 2: refit on everything for production
        base = HarmonicBaseline().fit(dates, y)
        fit_p, t0_p = fit_arimax(dates, y)
        joblib.dump({"version": FORMAT_VERSION, "fit": fit_p, "t0": t0_p, "order": ARIMA_ORDER, "last_date": dates[-1]},
                    MODEL_DIR / f"price_arima_{crop}.pkl")

        xgb_p = fit_xgb(dates, y, base)
        joblib.dump({"version": FORMAT_VERSION, "model": xgb_p, "feature_cols": DIRECT_COLS, "baseline": base},
                    MODEL_DIR / f"price_xgb_{crop}.pkl")

        lstm_p, scale_p, _ = fit_lstm(dates, y, base, epochs=best_epochs)
        save_inference_weights(lstm_p, MODEL_DIR / f"price_lstm_{crop}.weights.h5")
        joblib.dump({"version": FORMAT_VERSION, "scale": scale_p, "baseline": base, "window": LSTM_WINDOW,
                     "horizon": MAX_HORIZON}, MODEL_DIR / f"price_lstm_meta_{crop}.pkl")

        # ---- choose the best model by 90-day RMSE and publish metrics
        entry = {}
        for name, by_h in metrics.items():
            entry[name] = {"by_horizon": by_h, **{k: by_h["90"][k] for k in ("mae", "rmse", "mape")}}
        best = min(metrics, key=lambda k: metrics[k]["90"]["rmse"])
        entry.update({
            "best_model": best, "last_price": float(y[-1]), "last_date": dates[-1].strftime("%Y-%m-%d"),
            "evaluation": {"method": "rolling-origin multi-day backtest", "holdout_days": HOLDOUT_DAYS,
                           "step_days": BACKTEST_STEP, "horizons": list(HORIZON_BUCKETS), "format_version": FORMAT_VERSION},
        })
        all_metrics[crop] = entry
        for name in ("ARIMA", "XGBoost", "LSTM"):
            s = metrics[name]["90"]
            print(f"  {name:8s} 90-day: MAE {s['mae']:.1f}  RMSE {s['rmse']:.1f}  MAPE {s['mape']:.2f}%  (day-90 only: {s['endpoint_mape']:.2f}%)")
        print(f"  best: {best}   ({time.time() - t_start:.0f}s)")

    with open(MODEL_DIR / "price_metrics.json", "w") as f:
        json.dump(all_metrics, f, indent=2)
    print("\nSaved", MODEL_DIR / "price_metrics.json")


if __name__ == "__main__":
    main()
