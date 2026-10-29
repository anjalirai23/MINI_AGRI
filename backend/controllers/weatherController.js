const { fetchWeather } = require("../services/weatherService");

async function getWeather(req, res) {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const data = await fetchWeather({ lat, lon });
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({ success: false, message: "Weather service unavailable" });
  }
}

module.exports = { getWeather };
