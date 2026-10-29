import { createContext, useContext, useState, useCallback } from "react";
import api from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("agrimarket_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem("agrimarket_token"));

  const persist = (t, u) => {
    localStorage.setItem("agrimarket_token", t);
    localStorage.setItem("agrimarket_user", JSON.stringify(u));
    setToken(t);
    setUser(u);
  };

  const login = useCallback(async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    persist(data.data.token, data.data.user);
    return data.data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    persist(data.data.token, data.data.user);
    return data.data.user;
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await api.get("/auth/profile");
    localStorage.setItem("agrimarket_user", JSON.stringify(data.data.user));
    setUser(data.data.user);
    return data.data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("agrimarket_token");
    localStorage.removeItem("agrimarket_user");
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
