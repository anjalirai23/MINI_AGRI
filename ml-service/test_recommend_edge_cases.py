import math
import concurrent.futures

import pytest
from fastapi.testclient import TestClient

import app as ml_app

client = TestClient(ml_app.app)

VALID_REQUEST = {
    "season": "Kharif",
    "water_availability": "Medium",
    "soil_type": "Loamy",
    "acres": 2,
}


@pytest.fixture
def restore_production_cost():
    original = ml_app._production_cost.copy()
    yield
    ml_app._production_cost = original


def test_happy_path_sanity():
    resp = client.post("/predict/recommend", json=VALID_REQUEST)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["ranking"]) == len(ml_app.CROPS)
    for r in data["ranking"]:
        assert not math.isnan(r["total_cost_per_acre"])
    profits = [r["expected_profit_per_acre"] for r in data["ranking"]]
    assert profits == sorted(profits, reverse=True)


def test_missing_crop_cost_data_returns_clean_500_not_nan(restore_production_cost):
    victim = ml_app.CROPS[0]
    ml_app._production_cost = ml_app._production_cost[
        ml_app._production_cost.crop != victim
    ].reset_index(drop=True)

    resp = client.post("/predict/recommend", json=VALID_REQUEST)

    assert resp.status_code == 500
    assert victim in resp.json()["detail"].lower() or victim.lower() in resp.json()["detail"].lower()
    assert "NaN" not in resp.text


def test_season_fallback_when_exact_season_missing(restore_production_cost):
    victim = ml_app.CROPS[0]
    requested_season = VALID_REQUEST["season"]

    other_season_rows = ml_app._production_cost[
        (ml_app._production_cost.crop == victim)
        & (ml_app._production_cost.season != requested_season)
    ]
    if other_season_rows.empty:
        pytest.skip(f"No alternate-season cost rows for '{victim}' to test fallback against")

    ml_app._production_cost = ml_app._production_cost[
        ~((ml_app._production_cost.crop == victim) & (ml_app._production_cost.season == requested_season))
    ].reset_index(drop=True)

    resp = client.post("/predict/recommend", json=VALID_REQUEST)

    assert resp.status_code == 200
    row = next(r for r in resp.json()["data"]["ranking"] if r["crop"] == victim)
    assert not math.isnan(row["total_cost_per_acre"])
    assert row["total_cost_per_acre"] > 0


def test_invalid_choice_returns_400_not_500():
    bad = dict(VALID_REQUEST, season="Monsoon")
    resp = client.post("/predict/recommend", json=bad)
    assert resp.status_code == 400


def test_concurrent_requests_do_not_corrupt_shared_price_cache():
    ml_app._price_series_cache.clear()

    def call():
        r = client.post("/predict/recommend", json=VALID_REQUEST)
        return r.status_code, r.json()["data"]["ranking"]

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
        results = list(ex.map(lambda _: call(), range(40)))

    assert {s for s, _ in results} == {200}
    first_prices = {r["crop"]: r["current_price_per_quintal"] for r in results[0][1]}
    for _, ranking in results[1:]:
        prices = {r["crop"]: r["current_price_per_quintal"] for r in ranking}
        assert prices == first_prices
