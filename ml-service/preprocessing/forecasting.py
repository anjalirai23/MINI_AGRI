"""Shared forecasting toolkit used by BOTH training and the FastAPI service.

Why this exists
---------------
The first version of this project trained price/demand models to predict *tomorrow* from true lags,
reported those one-step errors (~0.5 % MAPE), and then served 90-day forecasts by feeding the model its
own predictions back in. Errors compound that way, tree models cannot extrapolate a rising price trend,
and the reported accuracy did not describe the forecast the user actually sees.

The approach here:

1. HarmonicBaseline - a recency-weighted linear trend + yearly Fourier seasonality (the part of a crop
   price that is genuinely predictable far ahead).
2. The ML models (XGBoost / LSTM / Random Forest) forecast only the *residual* around that baseline, which
   is stationary, so trees and LSTMs behave well and never have to extrapolate.
3. "Direct" multi-horizon forecasting: one model call returns the whole path (no recursion, no error
   compounding, much faster).
4. Honest evaluation: rolling-origin backtest of the full multi-day forecast on a held-out period.

Training and serving import the same feature code, so there is no train/serve skew.
"""
import numpy as np
import pandas as pd

MAX_HORIZON = 182
HORIZON_BUCKETS = (30, 60, 90, 180)
FOURIER_K = 3
LSTM_WINDOW = 60
ORIGIN_COLS = ["r0", "d1", "d3", "d7", "d14", "d30", "d60", "m7", "m30", "s14", "dev30"]
DIRECT_COLS = ORIGIN_COLS + ["h", "td_sin", "td_cos"]
# horizons sampled when building the stacked training set (inference uses every day 1..H)
TRAIN_HORIZONS = (1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 75, 90, 105, 120, 150, 182)


def fourier_terms(dates, K=FOURIER_K):
    doy = np.asarray(pd.DatetimeIndex(dates).dayofyear, dtype=float)
    ang = 2.0 * np.pi * doy / 365.25
    cols = []
    for k in range(1, K + 1):
        cols += [np.sin(k * ang), np.cos(k * ang)]
    return np.column_stack(cols)


class HarmonicBaseline:
    """value(t) = a + b * years(t) + sum_k [c_k sin(k w t) + d_k cos(k w t)], fitted with recency weights."""

    def __init__(self, K=FOURIER_K, halflife_days=730):
        self.K = K
        self.halflife_days = halflife_days
        self.t0 = None
        self.coef = None

    def _design(self, dates):
        dates = pd.DatetimeIndex(dates)
        years = np.asarray((dates - self.t0).days, dtype=float) / 365.25
        return np.column_stack([np.ones(len(dates)), years, fourier_terms(dates, self.K)])

    def fit(self, dates, y):
        dates = pd.DatetimeIndex(dates)
        y = np.asarray(y, dtype=float)
        self.t0 = dates[0]
        age = np.asarray((dates[-1] - dates).days, dtype=float)
        w = np.sqrt(0.5 ** (age / self.halflife_days))
        X = self._design(dates)
        self.coef, *_ = np.linalg.lstsq(X * w[:, None], y * w, rcond=None)
        return self

    def predict(self, dates):
        return self._design(dates) @ self.coef


def build_origin_frame(resid):
    """Features describing the residual history at each possible forecast origin (uses only the past)."""
    s = pd.Series(np.asarray(resid, dtype=float))
    f = pd.DataFrame({"r0": s})
    for L in (1, 3, 7, 14, 30, 60):
        f[f"d{L}"] = s - s.shift(L)
    f["m7"] = s.rolling(7).mean()
    f["m30"] = s.rolling(30).mean()
    f["s14"] = s.rolling(14).std()
    f["dev30"] = s - f["m30"]
    return f[ORIGIN_COLS]


def target_date_features(dates):
    doy = np.asarray(pd.DatetimeIndex(dates).dayofyear, dtype=float)
    ang = 2.0 * np.pi * doy / 365.25
    return np.sin(ang), np.cos(ang)


def build_direct_dataset(resid, dates, horizons=TRAIN_HORIZONS, max_origin=None):
    """Stack (origin, horizon) pairs -> X (DIRECT_COLS), y = residual at origin+h."""
    resid = np.asarray(resid, dtype=float)
    dates = pd.DatetimeIndex(dates)
    n = len(resid)
    origin = build_origin_frame(resid)
    ok = origin.notna().all(axis=1).values
    last_origin = n - 1 if max_origin is None else min(max_origin, n - 1)
    parts_X, parts_y = [], []
    for h in horizons:
        idx = np.where(ok)[0]
        idx = idx[(idx + h < n) & (idx <= last_origin)]
        if len(idx) == 0:
            continue
        X = origin.iloc[idx].copy()
        X["h"] = float(h)
        td_s, td_c = target_date_features(dates[idx + h])
        X["td_sin"], X["td_cos"] = td_s, td_c
        parts_X.append(X[DIRECT_COLS])
        parts_y.append(resid[idx + h])
    return pd.concat(parts_X, ignore_index=True), np.concatenate(parts_y)


def direct_features_for_forecast(resid_hist, last_date, horizon):
    """Rows for h = 1..horizon from the newest origin. resid_hist must hold >= 61 recent residuals."""
    origin = build_origin_frame(resid_hist).iloc[-1]
    hs = np.arange(1, horizon + 1)
    future = pd.DatetimeIndex([pd.Timestamp(last_date) + pd.Timedelta(days=int(h)) for h in hs])
    X = pd.DataFrame({c: np.repeat(float(origin[c]), horizon) for c in ORIGIN_COLS})
    X["h"] = hs.astype(float)
    X["td_sin"], X["td_cos"] = target_date_features(future)
    return X[DIRECT_COLS], future


def lstm_windows(resid, scale, window=LSTM_WINDOW, horizon=MAX_HORIZON, max_origin=None):
    """X: (N, window, 1) scaled residual windows; Y: (N, horizon) scaled future residual paths."""
    r = np.asarray(resid, dtype=float) / scale
    n = len(r)
    last_origin = n - 1 if max_origin is None else min(max_origin, n - 1)
    X, Y = [], []
    for i in range(window - 1, last_origin + 1):
        if i + horizon >= n:
            break
        X.append(r[i - window + 1:i + 1])
        Y.append(r[i + 1:i + 1 + horizon])
    return np.asarray(X)[..., None], np.asarray(Y)


def future_dates(last_date, horizon):
    return pd.DatetimeIndex([pd.Timestamp(last_date) + pd.Timedelta(days=int(k)) for k in range(1, horizon + 1)])


def arima_exog(dates, t0):
    """Exogenous regressors for the ARIMAX price model: years since t0 + yearly Fourier terms."""
    dates = pd.DatetimeIndex(dates)
    years = np.asarray((dates - t0).days, dtype=float) / 365.25
    return np.column_stack([years, fourier_terms(dates)])


# ---------------------------------------------------------------- evaluation
def _score(errors_abs, errors_sq, pct, end_pct):
    return {
        "mae": float(np.mean(errors_abs)),
        "rmse": float(np.sqrt(np.mean(errors_sq))),
        "mape": float(np.mean(pct)),
        "endpoint_mape": float(np.mean(end_pct)),
    }


def rolling_backtest(forecast_fn, y, cut, step=15, buckets=HORIZON_BUCKETS):
    """Score multi-day forecasts from many origins in the held-out region y[cut:].

    forecast_fn(origin_index, horizon) -> np.ndarray of `horizon` forecasts, using data <= origin_index only.
    For each bucket h the score covers days 1..h of every forecast (what the dashboard chart shows);
    `endpoint_mape` is the error of the last day only (the headline forecast price).
    """
    y = np.asarray(y, dtype=float)
    n = len(y)
    out = {}
    for h in buckets:
        abs_e, sq_e, pct, end_pct = [], [], [], []
        for o in range(cut - 1, n - h, step):
            f = np.asarray(forecast_fn(o, h), dtype=float)
            a = y[o + 1:o + 1 + h]
            e = f - a
            abs_e.append(np.abs(e))
            sq_e.append(e ** 2)
            pct.append(np.abs(e) / np.maximum(np.abs(a), 1e-9) * 100)
            end_pct.append(abs(e[-1]) / max(abs(a[-1]), 1e-9) * 100)
        if abs_e:
            out[str(h)] = _score(np.concatenate(abs_e), np.concatenate(sq_e), np.concatenate(pct), end_pct)
            out[str(h)]["n_origins"] = len(end_pct)
    return out


def pick_bucket(by_horizon, horizon_days):
    """Smallest evaluated bucket that covers the requested horizon (else the largest)."""
    keys = sorted(int(k) for k in by_horizon)
    for k in keys:
        if k >= horizon_days:
            return str(k)
    return str(keys[-1])
