import { useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import api from "../api/client";

const CROPS = ["wheat", "paddy", "cotton", "maize"];
const MODELS = ["LSTM", "ARIMA", "XGBoost"];

export default function CropForecastCard() {
  const [crop, setCrop] = useState("wheat");
  const [model, setModel] = useState("LSTM");
  const [horizon, setHorizon] = useState(90);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runForecast() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/ml/price-forecast", { crop, model, horizonDays: horizon });
      setResult(data.data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not generate forecast. Please try again.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const recent = result ? result.history.slice(-60) : [];
  const chartData = result
    ? [
        ...recent.map((h) => ({ date: h.date, historical: h.price })),
        ...result.forecast.map((f) => ({ date: f.date, forecast: f.price })),
      ]
    : [];

  return (
    <article className="forecast-card">
      <div className="fc-head">
        <div>
          <h3 className="fc-title">Crop Forecasting</h3>
          <p className="fc-desc">Compare LSTM, ARIMA and XGBoost for a selected crop and forecast horizon.</p>
        </div>
        <span className="fc-badge badge-green">PRICE · ML</span>
      </div>

      <div className="model-tabs" role="tablist">
        {MODELS.map((m) => (
          <button key={m} className={`model-tab ${model === m ? "active" : ""}`} onClick={() => setModel(m)}>
            {m}
          </button>
        ))}
      </div>

      <div className="forecast-controls">
        <div className="fc-field">
          <label>Crop</label>
          <select value={crop} onChange={(e) => setCrop(e.target.value)}>
            {CROPS.map((c) => (
              <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="fc-field">
          <label>Forecast horizon</label>
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
      </div>

      <button className="run-btn" onClick={runForecast} disabled={loading}>
        {loading ? "Running model..." : "Run crop forecast"}
      </button>

      {error && <div className="forecast-output" style={{ color: "#b91c1c" }}>{error}</div>}

      {result && (
        <>
          <div className="model-meta">
            <div className="meta-box"><span>MODEL</span><strong>{result.model}</strong></div>
            <div className="meta-box"><span>CONFIDENCE</span><strong>{result.confidence}%</strong></div>
            <div className="meta-box"><span>FORECAST</span><strong>₹{result.forecast_price.toLocaleString()}/qtl</strong></div>
          </div>

          <div className="chart-wrap" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <ReferenceLine x={recent[recent.length - 1]?.date} stroke="#999" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="historical" stroke="#2f8f4e" dot={false} name="Historical price" />
                <Line type="monotone" dataKey="forecast" stroke="#d97706" dot={false} strokeDasharray="5 3" name="Forecast" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="forecast-output">
            <strong>Recommendation:</strong>{" "}
            {result.pct_change > 1
              ? `Forecast is trending upward (${result.pct_change}% over ${result.horizon_days} days). Holding may improve the selling price, subject to actual mandi conditions.`
              : result.pct_change < -1
              ? `Forecast is trending downward (${result.pct_change}% over ${result.horizon_days} days). Selling sooner may reduce downside risk.`
              : `Forecast is roughly stable (${result.pct_change}% over ${result.horizon_days} days).`}
          </div>

          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table className="compare-table">
              <thead><tr><th>Model</th><th>MAE</th><th>RMSE</th><th>MAPE</th></tr></thead>
              <tbody>
                {MODELS.map((m) => (
                  <tr key={m}>
                    <td><strong>{m}</strong>{m === result.best_model ? " ★" : ""}</td>
                    <td>₹{result.model_comparison[m].mae.toFixed(1)}</td>
                    <td>₹{result.model_comparison[m].rmse.toFixed(1)}</td>
                    <td>{result.model_comparison[m].mape.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </article>
  );
}
