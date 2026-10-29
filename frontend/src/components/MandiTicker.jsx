const ITEMS = [
  { crop: "Wheat", mandi: "Khanna", price: 2180, trend: 3.2 },
  { crop: "Wheat", mandi: "Ludhiana", price: 2210, trend: 1.8 },
  { crop: "Paddy", mandi: "Jalandhar", price: 1950, trend: -0.9 },
  { crop: "Cotton", mandi: "Bathinda", price: 6800, trend: 2.4 },
  { crop: "Maize", mandi: "Patiala", price: 1850, trend: -1.3 },
  { crop: "Wheat", mandi: "Rajpura", price: 2095, trend: -0.6 },
  { crop: "Paddy", mandi: "Amritsar", price: 1985, trend: 1.1 },
  { crop: "Cotton", mandi: "Fazilka", price: 6740, trend: 0.7 },
];

function Row({ hidden }) {
  return (
    <div className="ticker-row" aria-hidden={hidden || undefined}>
      {ITEMS.map((it, i) => {
        const up = it.trend >= 0;
        return (
          <span className="ticker-item" key={i}>
            <b>{it.crop}</b>
            <em>{it.mandi}</em>
            <span className="ticker-price">₹{it.price.toLocaleString("en-IN")}</span>
            <span className={"ticker-chg " + (up ? "up" : "down")}>
              {up ? "▲" : "▼"} {Math.abs(it.trend).toFixed(1)}%
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default function MandiTicker() {
  return (
    <div className="ticker" role="region" aria-label="Sample mandi prices per quintal">
      <div className="ticker-tag">
        <span className="ticker-dot" /> SAMPLE MANDI PRICES · ₹/QTL
      </div>
      <div className="ticker-track">
        <Row />
        <Row hidden />
      </div>
    </div>
  );
}
