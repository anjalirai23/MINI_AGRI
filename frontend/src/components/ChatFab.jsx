import { useState } from "react";
import { useLanguage } from "../context/LanguageContext";

const QUESTIONS = ["price", "sell", "assistant", "languages", "status"];

export default function ChatFab() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState([]);

  function ask(key) {
    setHistory((h) => [...h, { role: "user", text: t(`chat.q.${key}`) }, { role: "bot", text: t(`chat.a.${key}`) }]);
  }

  return (
    <>
      <button
        type="button"
        className="chat-fab"
        aria-label="Open AI chatbot"
        aria-expanded={open}
        aria-controls="chatPanel"
        onClick={() => setOpen((o) => !o)}
      >
        AI
      </button>
      <div id="chatPanel" className={`chat-panel ${open ? "open" : ""}`} role="dialog" aria-label="AgriMarket AI chatbot">
        <div className="chat-head">
          <span>{t("chat.title")}</span>
          <button aria-label="Close chat" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="chat-body">
          <div className="chat-msg bot">{t("chat.welcome")}</div>
          {history.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role === "user" ? "user" : "bot"}`}>
              {m.text}
            </div>
          ))}
        </div>
        <div className="chat-suggestions">
          {QUESTIONS.map((q) => (
            <button key={q} type="button" onClick={() => ask(q)}>
              {t(`chat.q.${q}`)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
