import { useState } from "react";
import api from "../api/client";

const CROPS = ["wheat", "paddy", "cotton", "maize"];

export default function DemandForecastCard() {
  const [crop, setCrop] = useState("wheat");
  const [weeks, setWeeks] = useState(8);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/ml/demand-forecast", { crop, horizonWeeks: weeks });
      setResult(data.data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not generate forecast. Please try again.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const maxBar = result ? Math.max(...result.weekly_forecast) : 100;

  return (
    <article className="forecast-card">
      <div className="fc-head">
        <div>
          <h3 className="fc-title">Demand Forecasting</h3>
          <p className="fc-desc">Time-series ML view of expected demand movement for the selected crop.</p>
        </div>
        <span className="fc-badge badge-gold">TIME SERIES · ML</span>
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
          <label>Horizon</label>
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={4}>4 weeks</option>
            <option value={8}>8 weeks</option>
            <option value={12}>12 weeks</option>
          </select>
        </div>
      </div>

      <button className="run-btn" onClick={run} disabled={loading}>
        {loading ? "Running model..." : "Run demand forecast"}
      </button>

      {error && <div className="forecast-output" style={{ color: "#b91c1c" }}>{error}</div>}

      {result && (
        <>
          <div className="demand-hero">
            <div>
              <div className="model-meta">
                <div className="meta-box"><span>MODEL</span><strong>Random Forest</strong></div>
                <div className="meta-box"><span>HORIZON</span><strong>{result.horizon_weeks} weeks</strong></div>
                <div className="meta-box"><span>TREND</span><strong>{result.demand_trend}</strong></div>
              </div>
              <div className="insight-list">
                <div className="insight"><b>Demand signal:</b> Demand index is projected to move from {result.current_demand_index} to {result.predicted_demand_index} ({result.demand_level} demand).</div>
                <div className="insight"><b>Action:</b> {result.demand_trend === "Rising" ? "Watch mandi prices closely as demand rises." : result.demand_trend === "Falling" ? "Consider selling sooner as demand softens." : "Demand looks stable; time sales around price trend instead."}</div>
              </div>
            </div>
            <div className="demand-score">
              <div className="demand-score-inner"><strong>{Math.round(result.predicted_demand_index)}</strong><span>/ 100</span></div>
            </div>
          </div>

          <div className="demand-bars">
            {result.weekly_forecast.map((v, i) => (
              <div className="demand-bar-row" key={i}>
                <span>W{i + 1}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(v / maxBar) * 100}%` }} /></div>
                <b>{v}</b>
              </div>
            ))}
          </div>
          <div className="forecast-footer">Demand forecast from a Random Forest model trained on historical demand index data.</div>
        </>
      )}
    </article>
  );
}
