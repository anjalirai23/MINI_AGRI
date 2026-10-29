import { createContext, useContext, useMemo, useState, useCallback } from "react";
import translations from "../i18n/translations.json";

const LanguageContext = createContext(null);

const STORAGE_KEY = "agrimarket_lang";

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && translations[saved]) return saved;
    } catch {}
    return "en";
  });

  const setLang = useCallback((next) => {
    if (!translations[next]) return;
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const t = useCallback(
    (key) => {
      const table = translations[lang] || translations.en;
      if (table[key] !== undefined) return table[key];
      return translations.en[key] !== undefined ? translations.en[key] : key;
    },
    [lang]
  );

  const fmt = useCallback(
    (str, vals) => str.replace(/\{(\w+)\}/g, (_, k) => (vals && vals[k] !== undefined ? vals[k] : "")),
    []
  );

  const value = useMemo(() => ({ lang, setLang, t, fmt }), [lang, setLang, t, fmt]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}
