const mlService = require("../services/mlService");
const Prediction = require("../models/Prediction");

const VALID_CROPS = ["wheat", "paddy", "cotton", "maize"];

function summarize(type, d) {
  if (type === "price") {
    return {
      model: d.model, currentPrice: d.current_price, forecastPrice: d.forecast_price,
      pctChange: d.pct_change, confidence: d.confidence, horizonDays: d.horizon_days,
    };
  }
  return {
    model: d.model, currentDemand: d.current_demand_index, predictedDemand: d.predicted_demand_index,
    trend: d.demand_trend, level: d.demand_level, horizonWeeks: d.horizon_weeks,
  };
}

async function priceForecast(req, res, next) {
  try {
    const { crop, model, horizonDays } = req.body;
    if (!crop || !VALID_CROPS.includes(crop.toLowerCase())) {
      return res.status(400).json({ success: false, message: `crop must be one of ${VALID_CROPS.join(", ")}` });
    }
    let result;
    try {
      result = await mlService.predictPrice({ crop: crop.toLowerCase(), model, horizonDays });
    } catch (err) {
      const { status, message } = mlService.describeError(err);
      return res.status(status).json({ success: false, message });
    }
    if (req.userId) {
      await Prediction.create({ user: req.userId, type: "price", crop: crop.toLowerCase(), input: req.body, output: summarize("price", result.data) });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function demandForecast(req, res, next) {
  try {
    const { crop, horizonWeeks } = req.body;
    if (!crop || !VALID_CROPS.includes(crop.toLowerCase())) {
      return res.status(400).json({ success: false, message: `crop must be one of ${VALID_CROPS.join(", ")}` });
    }
    let result;
    try {
      result = await mlService.predictDemand({ crop: crop.toLowerCase(), horizonWeeks });
    } catch (err) {
      const { status, message } = mlService.describeError(err);
      return res.status(status).json({ success: false, message });
    }
    if (req.userId) {
      await Prediction.create({ user: req.userId, type: "demand", crop: crop.toLowerCase(), input: req.body, output: summarize("demand", result.data) });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function history(req, res, next) {
  try {
    const items = await Prediction.find({ user: req.userId }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
}

module.exports = { priceForecast, demandForecast, history };
