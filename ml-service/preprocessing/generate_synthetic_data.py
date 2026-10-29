import numpy as np
import pandas as pd
from pathlib import Path

RNG = np.random.default_rng(42)
OUT_DIR = Path(__file__).resolve().parent.parent / "datasets"
OUT_DIR.mkdir(exist_ok=True)

CROPS = ["wheat", "paddy", "cotton", "maize"]
MANDIS = ["Punjab-Ludhiana", "Punjab-Amritsar", "Haryana-Karnal", "UP-Meerut"]

BASE_PRICE = {"wheat": 2100, "paddy": 1950, "cotton": 6200, "maize": 1850}
SEASON_AMPLITUDE = {"wheat": 180, "paddy": 220, "cotton": 500, "maize": 150}
TREND_PER_YEAR = {"wheat": 60, "paddy": 55, "cotton": 140, "maize": 45}
HARVEST_MONTH = {"wheat": 4, "paddy": 11, "cotton": 11, "maize": 10}


def generate_price_series(crop, start="2019-01-01", end="2026-08-31"):
    dates = pd.date_range(start, end, freq="D")
    n = len(dates)
    t_years = (dates - dates[0]).days / 365.25

    trend = TREND_PER_YEAR[crop] * t_years
    month_angle = 2 * np.pi * (dates.month - HARVEST_MONTH[crop]) / 12
    seasonality = -SEASON_AMPLITUDE[crop] * np.cos(month_angle)

    regime = np.zeros(n)
    for i in range(1, n):
        regime[i] = 0.985 * regime[i - 1] + RNG.normal(0, 6)

    noise = RNG.normal(0, 25, n)
    price = BASE_PRICE[crop] + trend + seasonality + regime + noise
    price = np.clip(price, BASE_PRICE[crop] * 0.4, None)

    arrivals = np.clip(
        3000 + 1200 * np.cos(month_angle) + RNG.normal(0, 200, n), 200, None
    )
    return dates, price, arrivals


def generate_crop_prices():
    rows = []
    for crop in CROPS:
        for mandi in MANDIS:
            dates, price, arrivals = generate_price_series(crop)
            mandi_offset = RNG.normal(0, 40)
            for d, p, a in zip(dates, price, arrivals):
                rows.append(
                    {
                        "date": d.strftime("%Y-%m-%d"),
                        "crop": crop,
                        "mandi": mandi,
                        "price_per_quintal": round(max(p + mandi_offset, 100), 2),
                        "arrivals_tonnes": round(a, 1),
                    }
                )
    df = pd.DataFrame(rows)
    df.to_csv(OUT_DIR / "crop_prices.csv", index=False)
    return df


def generate_demand(price_df):
    rows = []
    for crop in CROPS:
        for mandi in MANDIS:
            sub = price_df[(price_df.crop == crop) & (price_df.mandi == mandi)].copy()
            sub = sub.sort_values("date")
            price = sub["price_per_quintal"].values
            dates = pd.to_datetime(sub["date"].values)
            price_z = (price - price.mean()) / (price.std() + 1e-6)
            month_angle = 2 * np.pi * (dates.month - HARVEST_MONTH[crop]) / 12
            seasonal_demand = 15 * np.cos(month_angle)
            demand_index = 55 - 8 * price_z + seasonal_demand + RNG.normal(0, 6, len(price))
            demand_index = np.clip(demand_index, 5, 100)
            for d, dm in zip(dates, demand_index):
                rows.append(
                    {
                        "date": d.strftime("%Y-%m-%d"),
                        "crop": crop,
                        "mandi": mandi,
                        "demand_index": round(float(dm), 1),
                    }
                )
    df = pd.DataFrame(rows)
    df.to_csv(OUT_DIR / "demand.csv", index=False)
    return df


def generate_production_cost():
    seasons = ["Kharif", "Rabi", "Zaid"]
    base_cost = {
        "wheat": dict(seed=2200, fert=6500, labour=9000, irrigation=3200, other=2500),
        "paddy": dict(seed=1800, fert=7200, labour=12000, irrigation=6000, other=2800),
        "cotton": dict(seed=4200, fert=8800, labour=15000, irrigation=4500, other=3600),
        "maize": dict(seed=2000, fert=5800, labour=8000, irrigation=2800, other=2200),
    }
    rows = []
    for crop in CROPS:
        for season in seasons:
            c = base_cost[crop]
            jitter = lambda v: round(v * (1 + RNG.normal(0, 0.05)), 0)
            rows.append(
                {
                    "crop": crop,
                    "season": season,
                    "seed_cost": jitter(c["seed"]),
                    "fertilizer_cost": jitter(c["fert"]),
                    "labour_cost": jitter(c["labour"]),
                    "irrigation_cost": jitter(c["irrigation"]),
                    "other_cost": jitter(c["other"]),
                }
            )
    df = pd.DataFrame(rows)
    df.to_csv(OUT_DIR / "production_cost.csv", index=False)
    return df


def generate_crop_recommendation():
    seasons = ["Kharif", "Rabi", "Zaid"]
    waters = ["Low", "Medium", "High"]
    soils = ["Sandy", "Loamy", "Clay"]
    yield_base = {"wheat": 18, "paddy": 22, "cotton": 8, "maize": 20}
    rows = []
    for crop in CROPS:
        for season in seasons:
            for water in waters:
                for soil in soils:
                    fit = RNG.uniform(0.6, 1.15)
                    rows.append(
                        {
                            "crop": crop,
                            "season": season,
                            "water_availability": water,
                            "soil_type": soil,
                            "avg_yield_qtl_per_acre": round(yield_base[crop] * fit, 1),
                            "avg_price": BASE_PRICE[crop],
                            "avg_cost": round(RNG.uniform(20000, 45000), 0),
                        }
                    )
    df = pd.DataFrame(rows)
    df.to_csv(OUT_DIR / "crop_recommendation.csv", index=False)
    return df


if __name__ == "__main__":
    prices = generate_crop_prices()
    generate_demand(prices)
    generate_production_cost()
    generate_crop_recommendation()
    print("Synthetic datasets written to", OUT_DIR)
    print(prices.groupby("crop")["price_per_quintal"].describe())
