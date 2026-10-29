import FarmScene from "../components/FarmScene";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AuthPage() {
  const [tab, setTab] = useState("login");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    phone: "",
    location: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [showRegPw, setShowRegPw] = useState(false);
  const [showRegConfirmPw, setShowRegConfirmPw] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  function switchTab(next) {
    setTab(next);
    setError("");
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(loginForm.email, loginForm.password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    if (registerForm.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (registerForm.password !== registerForm.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const { confirmPassword, ...payload } = registerForm;
      await register(payload);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-gate">
      <div className="auth-gate-left">
        <FarmScene className="auth-scene" sunX={900} />
        <div>
          <div className="auth-gate-brand">
            <span className="sidebar-brand-mark">A</span>
            AgriMarket AI
          </div>
          <h1 className="auth-gate-headline">Know the price before the mandi does.</h1>
          <p className="auth-gate-sub">
            Sign in to reach your Farmer Dashboard — live mandi price intelligence, crop
            forecasts, and sell/wait guidance built for Punjab's farmers.
          </p>
          <ul className="auth-gate-benefits">
            <li>Mandi price intelligence across nearby markets</li>
            <li>Crop price forecasting for the next 90 days</li>
            <li>Clear Sell / Wait recommendations for your crop</li>
            <li>Price alerts the moment your target is hit</li>
            <li>Better, data-backed market decisions every season</li>
          </ul>
        </div>
        <div className="auth-gate-foot">AgriMarket AI — built for farmers, not dashboards.</div>
      </div>

      <div className="auth-gate-right">
        <div className="auth-gate-card">
          <div className="auth-tabs" role="tablist" aria-label="Authentication">
            <button
              type="button"
              className={`auth-tab-btn ${tab === "login" ? "active" : ""}`}
              role="tab"
              aria-selected={tab === "login"}
              onClick={() => switchTab("login")}
            >
              Log In
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${tab === "register" ? "active" : ""}`}
              role="tab"
              aria-selected={tab === "register"}
              onClick={() => switchTab("register")}
            >
              Register
            </button>
          </div>

          {error && <div className="auth-error-msg show">{error}</div>}

          {tab === "login" ? (
            <form className="auth-form" onSubmit={handleLogin} noValidate>
              <div className="form-group">
                <label htmlFor="loginEmail">Email Address</label>
                <input
                  id="loginEmail"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="farmer@agrimarket.ai"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="loginPassword">Password</label>
                <div className="password-field">
                  <input
                    id="loginPassword"
                    type={showLoginPw ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowLoginPw((v) => !v)}
                  >
                    {showLoginPw ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <button type="submit" className="auth-submit-btn" disabled={loading}>
                {loading ? "Logging in..." : "Log In"}
              </button>
              <p className="auth-switch-text">
                No account?{" "}
                <button type="button" onClick={() => switchTab("register")}>
                  Register here
                </button>
              </p>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleRegister} noValidate>
              <div className="form-group">
                <label htmlFor="regName">Full Name</label>
                <input
                  id="regName"
                  required
                  autoComplete="name"
                  value={registerForm.name}
                  onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="regEmail">Email Address</label>
                <input
                  id="regEmail"
                  type="email"
                  required
                  autoComplete="email"
                  value={registerForm.email}
                  onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="regPhone">Phone Number (Optional)</label>
                <input
                  id="regPhone"
                  type="tel"
                  autoComplete="tel"
                  value={registerForm.phone}
                  onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="regLocation">Location</label>
                <input
                  id="regLocation"
                  placeholder="e.g. Ludhiana, Punjab"
                  autoComplete="address-level2"
                  value={registerForm.location}
                  onChange={(e) => setRegisterForm({ ...registerForm, location: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="regPassword">Password (min. 6 characters)</label>
                <div className="password-field">
                  <input
                    id="regPassword"
                    type={showRegPw ? "text" : "password"}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowRegPw((v) => !v)}
                  >
                    {showRegPw ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="regConfirmPassword">Confirm Password</label>
                <div className="password-field">
                  <input
                    id="regConfirmPassword"
                    type={showRegConfirmPw ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={registerForm.confirmPassword}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, confirmPassword: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowRegConfirmPw((v) => !v)}
                  >
                    {showRegConfirmPw ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <button type="submit" className="auth-submit-btn" disabled={loading}>
                {loading ? "Creating account..." : "Create Account"}
              </button>
              <p className="auth-switch-text">
                Already have an account?{" "}
                <button type="button" onClick={() => switchTab("login")}>
                  Log in here
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
