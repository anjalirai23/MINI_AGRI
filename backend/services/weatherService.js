const axios = require("axios");

async function fetchWeather({ lat, lon } = {}) {
  const latitude = Number.isFinite(lat) ? lat : 30.901;
  const longitude = Number.isFinite(lon) ? lon : 75.8573;
  const { data } = await axios.get("https://api.open-meteo.com/v1/forecast", {
    params: {
      latitude,
      longitude,
      current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
      timezone: "auto",
      forecast_days: 7,
    },
    timeout: 10000,
  });
  return data;
}

module.exports = { fetchWeather };
