import numpy as np
import pandas as pd


def load_crop_series(csv_path, crop, mandi=None):
    df = pd.read_csv(csv_path, parse_dates=["date"])
    df = df[df.crop == crop]
    if mandi:
        df = df[df.mandi == mandi]
    df = df.groupby("date", as_index=False).agg(
        price_per_quintal=("price_per_quintal", "mean"),
        arrivals_tonnes=("arrivals_tonnes", "mean"),
    )
    df = df.sort_values("date").drop_duplicates(subset="date")
    full_range = pd.date_range(df.date.min(), df.date.max(), freq="D")
    df = df.set_index("date").reindex(full_range).ffill().rename_axis("date").reset_index()
    return df


def add_time_features(df):
    df = df.copy()
    df["month"] = df["date"].dt.month
    df["day_of_year"] = df["date"].dt.dayofyear
    df["month_sin"] = np.sin(2 * np.pi * df["month"] / 12)
    df["month_cos"] = np.cos(2 * np.pi * df["month"] / 12)
    for lag in [1, 7, 14, 30]:
        df[f"lag_{lag}"] = df["price_per_quintal"].shift(lag)
    df["rolling_mean_7"] = df["price_per_quintal"].rolling(7).mean()
    df["rolling_std_7"] = df["price_per_quintal"].rolling(7).std()
    df["rolling_mean_30"] = df["price_per_quintal"].rolling(30).mean()
    return df


def time_series_split(df, test_days=90, val_days=90):
    n = len(df)
    test_start = n - test_days
    val_start = test_start - val_days
    train = df.iloc[:val_start].copy()
    val = df.iloc[val_start:test_start].copy()
    test = df.iloc[test_start:].copy()
    return train, val, test


def mae(y_true, y_pred):
    return float(np.mean(np.abs(np.asarray(y_true) - np.asarray(y_pred))))


def rmse(y_true, y_pred):
    return float(np.sqrt(np.mean((np.asarray(y_true) - np.asarray(y_pred)) ** 2)))


def mape(y_true, y_pred):
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    mask = y_true != 0
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100)
