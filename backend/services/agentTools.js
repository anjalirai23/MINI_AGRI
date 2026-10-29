const mlService = require("./mlService");
const { fetchWeather } = require("./weatherService");
const Alert = require("../models/Alert");
const { logActivity } = require("./activity");

const VALID_CROPS = ["wheat", "paddy", "cotton", "maize"];

const TOOL_DEFINITIONS = [
  {
    name: "get_price_forecast",
    description:
      "Get the ML price forecast for a crop (wheat, paddy, cotton, or maize), including current price, forecast price, trend, and confidence. Use this whenever the farmer asks about prices, whether to sell, or price trends — never guess a price yourself.",
    parameters: {
      type: "OBJECT",
      properties: {
        crop: { type: "STRING", enum: VALID_CROPS },
        model: { type: "STRING", enum: ["auto", "LSTM", "ARIMA", "XGBoost"], description: "Forecast model to use. Default 'auto' picks the best-performing model for that crop." },
        horizon_days: { type: "INTEGER", description: "How many days ahead to forecast (7-180). Default 90." },
      },
      required: ["crop"],
    },
  },
  {
    name: "get_demand_forecast",
    description:
      "Get the ML demand forecast for a crop, including current/predicted demand index and trend (Rising/Stable/Falling). Use this when the farmer asks about demand, market appetite, or how easy a crop will be to sell.",
    parameters: {
      type: "OBJECT",
      properties: {
        crop: { type: "STRING", enum: VALID_CROPS },
        horizon_weeks: { type: "INTEGER", description: "How many weeks ahead (1-26). Default 8." },
      },
      required: ["crop"],
    },
  },
  {
    name: "get_weather",
    description:
      "Get current weather and a 7-day forecast (temperature, humidity, precipitation, wind) for a location. Defaults to Ludhiana, Punjab if no coordinates given. Use this for questions about weather, rain, or field conditions.",
    parameters: {
      type: "OBJECT",
      properties: {
        lat: { type: "NUMBER", description: "Latitude. Omit to use the default location." },
        lon: { type: "NUMBER", description: "Longitude. Omit to use the default location." },
      },
    },
  },
  {
    name: "create_price_alert",
    description:
      "Create a price alert for the farmer that will notify them when a crop's forecast price crosses a target. Only call this after the farmer has clearly asked for or agreed to an alert — confirm the crop, target price, and condition with them first if any of those are unclear.",
    parameters: {
      type: "OBJECT",
      properties: {
        crop: { type: "STRING", enum: VALID_CROPS },
        target_price: { type: "NUMBER", description: "Target price per quintal in rupees." },
        condition: { type: "STRING", enum: ["above", "below"] },
      },
      required: ["crop", "target_price", "condition"],
    },
  },
  {
    name: "list_price_alerts",
    description: "List the farmer's active price alerts. Use this before creating a new alert to avoid duplicates, or whenever they ask what alerts they have.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "check_alerts_now",
    description:
      "Immediately re-check all of the farmer's active alerts against the latest price forecasts and report which ones have triggered. Use this when the farmer asks to check their alerts right now, rather than waiting for the automatic hourly check.",
    parameters: { type: "OBJECT", properties: {} },
  },
];

function invalid(message) {
  return { error: message };
}

function slimPrice(d) {
  const f = d.forecast || [];
  const step = Math.max(1, Math.floor(f.length / 6));
  return {
    crop: d.crop,
    model: d.model,
    horizon_days: d.horizon_days,
    current_price: d.current_price,
    forecast_price: d.forecast_price,
    pct_change: d.pct_change,
    confidence_pct: d.confidence,
    best_model_for_crop: d.best_model,
    sample_forecast_points: f.filter((_, i) => i % step === 0 || i === f.length - 1).map((p) => ({ date: p.date, price: p.price })),
  };
}

function slimDemand(d) {
  return {
    crop: d.crop,
    current_demand_index: d.current_demand_index,
    predicted_demand_index: d.predicted_demand_index,
    demand_trend: d.demand_trend,
    demand_level: d.demand_level,
    horizon_weeks: d.horizon_weeks,
  };
}

function slimWeather(w) {
  const daily = w.daily || {};
  return {
    current: w.current,
    units: w.current_units,
    daily_forecast: (daily.time || []).map((date, i) => ({
      date,
      max_c: daily.temperature_2m_max?.[i],
      min_c: daily.temperature_2m_min?.[i],
      rain_mm: daily.precipitation_sum?.[i],
    })),
  };
}

function clamp(n, lo, hi, fallback) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
}

async function executeTool(name, input, { userId }) {
  switch (name) {
    case "get_price_forecast": {
      const crop = (input.crop || "").toLowerCase();
      if (!VALID_CROPS.includes(crop)) return invalid(`crop must be one of ${VALID_CROPS.join(", ")}`);
      const result = await mlService.predictPrice({
        crop,
        model: input.model || "auto",
        horizonDays: clamp(input.horizon_days, 7, 180, 90),
      });
      return slimPrice(result.data);
    }

    case "get_demand_forecast": {
      const crop = (input.crop || "").toLowerCase();
      if (!VALID_CROPS.includes(crop)) return invalid(`crop must be one of ${VALID_CROPS.join(", ")}`);
      const result = await mlService.predictDemand({
        crop,
        horizonWeeks: clamp(input.horizon_weeks, 1, 26, 8),
      });
      return slimDemand(result.data);
    }

    case "get_weather": {
      const data = await fetchWeather({ lat: Number(input.lat), lon: Number(input.lon) });
      return slimWeather(data);
    }

    case "create_price_alert": {
      const crop = (input.crop || "").toLowerCase();
      if (!VALID_CROPS.includes(crop)) return invalid(`crop must be one of ${VALID_CROPS.join(", ")}`);
      const target = Number(input.target_price);
      if (!Number.isFinite(target) || target <= 0 || !input.condition) return invalid("target_price (a positive number) and condition are required");
      const alert = await Alert.create({
        user: userId,
        crop,
        targetPrice: target,
        condition: input.condition === "below" ? "below" : "above",
        createdBy: "agent",
      });
      await logActivity(userId, `AI assistant created a price alert: ${alert.crop} ${alert.condition} ₹${alert.targetPrice}/quintal`);
      return { id: alert._id, crop: alert.crop, targetPrice: alert.targetPrice, condition: alert.condition };
    }

    case "list_price_alerts": {
      const alerts = await Alert.find({ user: userId, active: true }).sort({ createdAt: -1 });
      return alerts.map((a) => ({
        id: a._id,
        crop: a.crop,
        targetPrice: a.targetPrice,
        condition: a.condition,
        triggered: a.triggered,
      }));
    }

    case "check_alerts_now": {
      const { checkAlertsForUser } = require("./agentAutomation");
      const triggered = await checkAlertsForUser(userId);
      return { triggered };
    }

    default:
      return invalid(`Unknown tool: ${name}`);
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
