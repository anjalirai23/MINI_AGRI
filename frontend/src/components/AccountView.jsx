import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "forecasts", label: "Forecast history" },
  { key: "alerts", label: "Price alerts" },
  { key: "activity", label: "Activity log" },
  { key: "settings", label: "Settings" },
];

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const inr = (n) => (Number.isFinite(n) ? `₹${Math.round(n).toLocaleString("en-IN")}` : "—");
const dateFmt = (d, opts) => (d ? new Date(d).toLocaleDateString("en-IN", opts || { day: "numeric", month: "short", year: "numeric" }) : "—");
const dateTimeFmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function timeAgo(d) {
  if (!d) return "—";
  const s = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return dateFmt(d);
}

function groupByDay(items) {
  const groups = [];
  for (const a of items) {
    const key = dateFmt(a.at, { weekday: "long", day: "numeric", month: "long" });
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(a);
    else groups.push({ key, items: [a] });
  }
  return groups;
}

function Stat({ label, value, sub }) {
  return (
    <div className="pf-stat">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

function Empty({ title, text }) {
  return (
    <div className="pf-empty">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function OverviewTab({ data, goTab }) {
  const { stats, predictions, activity } = data;
  const max = Math.max(1, ...stats.cropBreakdown.map((c) => c.count));
  return (
    <div className="pf-two-col">
      <section className="pf-panel">
        <div className="pf-panel-head">
          <h4>Recent activity</h4>
          <button type="button" className="pf-link" onClick={() => goTab("activity")}>View all</button>
        </div>
        {activity.length === 0 ? (
          <Empty title="Nothing yet" text="Your actions on AgriMarket will show up here." />
        ) : (
          <ul className="pf-feed">
            {activity.slice(0, 6).map((a, i) => (
              <li key={i}>
                <span className="pf-feed-icon">•</span>
                <div>
                  <p>{a.message}</p>
                  <small>{timeAgo(a.at)}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="pf-stack">
        <section className="pf-panel">
          <div className="pf-panel-head"><h4>Crops you research</h4></div>
          {stats.cropBreakdown.length === 0 ? (
            <Empty title="No forecasts yet" text="Run a price or demand forecast to see your crop interests." />
          ) : (
            <div className="pf-bars">
              {stats.cropBreakdown.map((c) => (
                <div key={c.crop} className="pf-bar-row">
                  <span>{cap(c.crop)}</span>
                  <div className="pf-bar"><i style={{ width: `${(c.count / max) * 100}%` }} /></div>
                  <b>{c.count}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="pf-panel">
          <div className="pf-panel-head">
            <h4>Latest forecasts</h4>
            <button type="button" className="pf-link" onClick={() => goTab("forecasts")}>View all</button>
          </div>
          {predictions.length === 0 ? (
            <Empty title="No forecasts run" text="Head to Crop Forecasting to run your first one." />
          ) : (
            <ul className="pf-mini-list">
              {predictions.slice(0, 3).map((p) => (
                <li key={p.id}>
                  <span>{cap(p.crop)} <em>{p.type}</em></span>
                  <b>{p.type === "price" ? inr(p.result?.forecastPrice) : `${p.result?.predictedDemand ?? "—"}/100`}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ForecastsTab({ predictions }) {
  const [filter, setFilter] = useState("all");
  const rows = predictions.filter((p) => filter === "all" || p.type === filter);
  return (
    <section className="pf-panel">
      <div className="pf-panel-head">
        <h4>Forecast history <small>({predictions.length})</small></h4>
        <div className="pf-seg" role="group" aria-label="Filter forecasts">
          {["all", "price", "demand"].map((f) => (
            <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{cap(f)}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty title="No forecasts here" text="Forecasts you run from the dashboard are saved automatically." />
      ) : (
        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead>
              <tr><th>When</th><th>Crop</th><th>Type</th><th>Model</th><th>Horizon</th><th>Result</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const r = p.result || {};
                const isPrice = p.type === "price";
                const change = r.pctChange;
                return (
                  <tr key={p.id}>
                    <td>{dateTimeFmt(p.at)}</td>
                    <td>{cap(p.crop)}</td>
                    <td><span className={`pf-tag ${p.type}`}>{p.type}</span></td>
                    <td>{r.model || p.input?.model || "—"}</td>
                    <td>{isPrice ? `${r.horizonDays ?? p.input?.horizonDays ?? "—"} days` : `${r.horizonWeeks ?? p.input?.horizonWeeks ?? "—"} weeks`}</td>
                    <td>
                      {isPrice ? (
                        <>
                          <b>{inr(r.forecastPrice)}</b> <small>from {inr(r.currentPrice)}</small>{" "}
                          {Number.isFinite(change) && <span className={`pf-delta ${change >= 0 ? "up" : "down"}`}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%</span>}
                        </>
                      ) : (
                        <>
                          <b>{r.predictedDemand ?? "—"}/100</b> <small>{r.level}</small>{" "}
                          {r.trend && <span className={`pf-delta ${r.trend === "Falling" ? "down" : "up"}`}>{r.trend}</span>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AlertsTab({ alerts, onDelete }) {
  return (
    <section className="pf-panel">
      <div className="pf-panel-head">
        <h4>Price alerts <small>({alerts.length})</small></h4>
        <span className="pf-hint">Ask the AI Assistant: “Alert me if wheat goes above ₹2500”</span>
      </div>
      {alerts.length === 0 ? (
        <Empty title="No alerts yet" text="Create one by chatting with the AI Assistant." />
      ) : (
        <ul className="pf-alerts">
          {alerts.map((a) => {
            const state = a.triggered ? "triggered" : a.active ? "active" : "paused";
            return (
              <li key={a.id}>
                <div className="pf-alert-main">
                  <div>
                    <p><b>{cap(a.crop)}</b> {a.condition} <b>{inr(a.targetPrice)}</b>/quintal</p>
                    <small>
                      Created {dateFmt(a.createdAt)}{a.createdBy === "agent" ? " · by AI assistant" : ""}
                      {a.triggeredAt ? ` · triggered ${dateFmt(a.triggeredAt)}` : ""}
                    </small>
                  </div>
                </div>
                <div className="pf-alert-side">
                  <span className={`pf-state ${state}`}>{state}</span>
                  <button type="button" className="pf-icon-btn" title="Delete alert" aria-label="Delete alert" onClick={() => onDelete(a)}>✕</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ActivityTab({ activity }) {
  const groups = useMemo(() => groupByDay(activity), [activity]);
  return (
    <section className="pf-panel">
      <div className="pf-panel-head"><h4>Activity log <small>(last {activity.length})</small></h4></div>
      {activity.length === 0 ? (
        <Empty title="No activity yet" text="Logins, forecasts, alerts and assistant chats are recorded here." />
      ) : (
        groups.map((g) => (
          <div key={g.key} className="pf-day">
            <h5>{g.key}</h5>
            <ul className="pf-timeline">
              {g.items.map((a, i) => (
                <li key={i}>
                  <span className="pf-feed-icon">•</span>
                  <p>{a.message}</p>
                  <time>{new Date(a.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</time>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function SettingsTab({ user, onSaved }) {
  const [form, setForm] = useState({ name: user.name || "", phone: user.phone || "", location: user.location || "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState("");

  async function saveProfile(e) {
    e.preventDefault();
    setBusy("profile");
    setMsg(null);
    try {
      await api.put("/auth/profile", form);
      await onSaved();
      setMsg({ scope: "profile", type: "ok", text: "Profile updated." });
    } catch (err) {
      setMsg({ scope: "profile", type: "err", text: err.response?.data?.message || "Could not update profile." });
    } finally {
      setBusy("");
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return setMsg({ scope: "password", type: "err", text: "New passwords don't match." });
    setBusy("password");
    setMsg(null);
    try {
      await api.put("/auth/password", { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      await onSaved();
      setMsg({ scope: "password", type: "ok", text: "Password changed." });
    } catch (err) {
      setMsg({ scope: "password", type: "err", text: err.response?.data?.message || "Could not change password." });
    } finally {
      setBusy("");
    }
  }

  const note = (scope) => msg?.scope === scope && <div className={`pf-note ${msg.type}`}>{msg.text}</div>;

  return (
    <div className="pf-two-col">
      <form className="pf-panel" onSubmit={saveProfile}>
        <div className="pf-panel-head"><h4>Personal details</h4></div>
        <div className="fc-field"><label>Full name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div className="fc-field"><label>Email</label><input value={user.email} disabled /></div>
        <div className="fc-field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" /></div>
        <div className="fc-field"><label>Village / District</label><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Ludhiana, Punjab" /></div>
        {note("profile")}
        <button className="extra-btn" type="submit" disabled={busy === "profile"}>{busy === "profile" ? "Saving…" : "Save changes"}</button>
      </form>

      <form className="pf-panel" onSubmit={savePassword}>
        <div className="pf-panel-head"><h4>Change password</h4></div>
        <div className="fc-field"><label>Current password</label><input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></div>
        <div className="fc-field"><label>New password</label><input type="password" autoComplete="new-password" minLength={6} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required /></div>
        <div className="fc-field"><label>Confirm new password</label><input type="password" autoComplete="new-password" minLength={6} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></div>
        {note("password")}
        <button className="extra-btn" type="submit" disabled={busy === "password"}>{busy === "password" ? "Updating…" : "Update password"}</button>
      </form>
    </div>
  );
}

export default function AccountView() {
  const { user: cachedUser, refreshProfile, logout } = useAuth();
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get("/auth/overview");
      setData(res.data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load your profile. Check that the backend is running.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/auth/overview")
      .then(({ data: res }) => !cancelled && setData(res.data))
      .catch((err) => !cancelled && setError(err.response?.data?.message || "Could not load your profile. Check that the backend is running."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function afterSave() {
    await refreshProfile();
    await load();
  }

  async function deleteAlert(a) {
    if (!window.confirm(`Delete the ${a.crop} alert (${a.condition} ${inr(a.targetPrice)})?`)) return;
    try {
      await api.delete(`/alerts/${a.id}`);
      await load();
    } catch {
      setError("Could not delete that alert.");
    }
  }

  if (error && !data) {
    return (
      <div className="forecast-card full">
        <div className="pf-note err">{error}</div>
        <button className="extra-btn" style={{ width: "auto", padding: "10px 20px" }} onClick={load}>Try again</button>
      </div>
    );
  }
  if (!data) return <div className="forecast-card full pf-loading">Loading your profile…</div>;

  const { user, stats, predictions, alerts } = data;
  const activity = user.activity || [];
  const profile = { ...cachedUser, ...user };
  const initials = (profile.name || "F").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const tabCount = { forecasts: predictions.length, alerts: alerts.length };

  return (
    <div className="pf-root">
      <header className="pf-hero">
        <div className="pf-hero-bg" />
        <div className="pf-hero-body">
          <div className="pf-avatar">{initials}</div>
          <div className="pf-id">
            <h2>{profile.name}</h2>
            <div className="pf-chips">
              <span>{profile.email}</span>
              {profile.phone && <span>{profile.phone}</span>}
              {profile.location && <span>{profile.location}</span>}
              <span>Member since {dateFmt(stats.memberSince, { month: "long", year: "numeric" })}</span>
            </div>
          </div>
          <div className="pf-hero-actions">
            <button type="button" className="pf-btn ghost" onClick={() => setTab("settings")}>Edit profile</button>
            <button type="button" className="pf-btn" onClick={logout}>Log out</button>
          </div>
        </div>
      </header>

      <div className="pf-stats">
        <Stat label="Forecasts run" value={stats.totalForecasts} sub={`${stats.priceForecasts} price · ${stats.demandForecasts} demand`} />
        <Stat label="Assistant questions" value={stats.assistantQuestions} sub="in current chat" />
        <Stat label="Active alerts" value={stats.activeAlerts} sub={`${stats.triggeredAlerts} triggered`} />
        <Stat label="Top crop" value={cap(stats.topCrop) || "—"} sub="most researched" />
        <Stat label="Total logins" value={stats.logins} sub={`Last: ${timeAgo(stats.lastLogin)}`} />
      </div>

      {error && <div className="pf-note err">{error}</div>}

      <nav className="pf-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
            {tabCount[t.key] > 0 && <span className="pf-count">{tabCount[t.key]}</span>}
          </button>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab data={{ ...data, activity }} goTab={setTab} />}
      {tab === "forecasts" && <ForecastsTab predictions={predictions} />}
      {tab === "alerts" && <AlertsTab alerts={alerts} onDelete={deleteAlert} />}
      {tab === "activity" && <ActivityTab activity={activity} />}
      {tab === "settings" && <SettingsTab user={profile} onSaved={afterSave} />}
    </div>
  );
}
