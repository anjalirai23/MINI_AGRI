import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import LanguageSwitch from "../components/LanguageSwitch";
import CropForecastCard from "../components/CropForecastCard";
import DemandForecastCard from "../components/DemandForecastCard";
import AccountView from "../components/AccountView";
import AgentChat from "../components/AgentChat";
import FarmScene from "../components/FarmScene";

const MENU = [
  { key: "overview", label: "Overview" },
  { key: "assistant", label: "AI Assistant" },
  { key: "crop", label: "Crop Forecasting" },
  { key: "demand", label: "Demand Forecasting" },
  { key: "account", label: "My Account" },
];

const VIEW_META = {
  overview: { kicker: "AGRIMARKET AI · INTELLIGENCE CENTER", title: "Farmer Intelligence Center" },
  assistant: { kicker: "AGENTIC · AI", title: "AI Assistant" },
  crop: { kicker: "PRICE FORECASTING · ML", title: "Crop Forecasting" },
  demand: { kicker: "TIME SERIES · ML", title: "Demand Forecasting" },
  account: { kicker: "ACCOUNT", title: "My Account" },
};

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [view, setView] = useState("overview");

  function renderView() {
    switch (view) {
      case "assistant": return <AgentChat />;
      case "crop": return <CropForecastCard />;
      case "demand": return <DemandForecastCard />;
      case "account": return <AccountView />;
      default:
        return (
          <>
            <CropForecastCard />
            <DemandForecastCard />
          </>
        );
    }
  }

  const meta = VIEW_META[view] || VIEW_META.overview;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="dash-app">
      <aside className="dash-sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">A</span>
          <div><strong>AgriMarket AI</strong><small>Farmer Dashboard</small></div>
        </div>

        <div className="sidebar-welcome">
          <span>WELCOME BACK</span>
          <strong>{user?.name || "Farmer"}</strong>
          <small>Forecast workspace · 2026</small>
        </div>

        <nav className="dash-menu">
          {MENU.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`dash-menu-item ${view === m.key ? "active" : ""}`}
              onClick={() => setView(m.key)}
            >
              {m.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-kpis">
          <div className="sidebar-kpi">
            <span>{t("dash.kpi.activeCrop")}</span>
            <strong>Wheat</strong>
            <small>{t("dash.kpi.activeCropSub")}</small>
          </div>
          <div className="sidebar-kpi">
            <span>{t("dash.kpi.bestModel")}</span>
            <strong>LSTM</strong>
            <small>{t("dash.kpi.bestModelSub")}</small>
          </div>
          <div className="sidebar-kpi">
            <span>{t("dash.kpi.priceForecast")}</span>
            <strong>₹2,340</strong>
            <small>+7.3% vs today</small>
          </div>
          <div className="sidebar-kpi">
            <span>{t("dash.kpi.demandIndex")}</span>
            <strong>74 / 100</strong>
            <small>{t("dash.kpi.demandIndexSub")}</small>
          </div>
        </div>

        <div className="sidebar-lang">
          <LanguageSwitch />
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-status"><i></i> <span>{t("dash.status.ready")}</span></div>
          <button type="button" className="extra-btn" onClick={logout}>Log Out</button>
        </div>
      </aside>

      <main className="dash-main">
        <div className="dash-mobile-title">
          <div>
            <div className="dash-kicker">{meta.kicker}</div>
            <h2 className="dash-title">{meta.title}</h2>
          </div>
          {view !== "overview" && (
            <button type="button" className="dash-back-btn show" onClick={() => setView("overview")}>
              ← Back to Overview
            </button>
          )}
        </div>

        {view === "overview" && (
          <div className="dash-banner">
            <FarmScene className="dash-scene" sunX={760} align="xMidYMid slice" viewBox="0 130 1440 340" />
            <div className="dash-banner-text">
              <span className="dash-banner-date">
                {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
              </span>
              <h3>
                {greeting}, {(user?.name || "Farmer").split(" ")[0]}
              </h3>
              <p>Run a price forecast or check demand before you decide to sell or hold.</p>
            </div>
            <div className="dash-banner-actions">
              <button type="button" onClick={() => setView("crop")}>Forecast prices</button>
              <button type="button" className="alt" onClick={() => setView("assistant")}>Ask the assistant</button>
            </div>
          </div>
        )}

        <div className={`forecast-grid ${view !== "overview" ? "single-view" : ""}`}>{renderView()}</div>
      </main>
    </div>
  );
}
