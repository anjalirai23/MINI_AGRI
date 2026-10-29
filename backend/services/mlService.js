const axios = require("axios");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// 60 s: the first request after the ML service starts can be slow while TensorFlow warms up.
const client = axios.create({ baseURL: ML_SERVICE_URL, timeout: Number(process.env.ML_TIMEOUT_MS) || 60000 });

async function predictPrice({ crop, model = "auto", horizonDays = 90 }) {
  const { data } = await client.post("/predict/price", { crop, model, horizon_days: horizonDays });
  return data;
}

async function predictDemand({ crop, horizonWeeks = 8 }) {
  const { data } = await client.post("/predict/demand", { crop, horizon_weeks: horizonWeeks });
  return data;
}

// Turn an axios error into { status, message } that says what actually went wrong,
// and log the technical cause to the backend console.
function describeError(err) {
  const detail = err.response && err.response.data && err.response.data.detail;
  let status = 503;
  let message;
  if (err.response) {
    status = 502;
    message = typeof detail === "string" ? detail : `The ML service returned an error (HTTP ${err.response.status}).`;
  } else if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
    message = `The ML service is not running at ${ML_SERVICE_URL}. Start it with: cd ml-service && uvicorn app:app --port 8000`;
  } else if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
    message = "The ML service took too long to respond. Please try again in a moment.";
  } else {
    message = "ML service unavailable. Please try again shortly.";
  }
  console.error(`[ml-service] ${err.code || ""} ${err.message}${detail ? ` | detail: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  return { status, message };
}

module.exports = { predictPrice, predictDemand, describeError };
