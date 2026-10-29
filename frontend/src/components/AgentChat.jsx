import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import api from "../api/client";
import { useLanguage } from "../context/LanguageContext";
import {
  RECOGNITION_ERRORS,
  SpeechRecognitionCtor,
  VOICE_LANGS,
  canListen,
  canSpeak,
  chunkText,
  detectLang,
  pickVoice,
  toSpeech,
  voiceLangFromApp,
} from "./voice";

const SUGGESTIONS = [
  "Should I sell wheat now or wait?",
  "What's the demand outlook for cotton?",
  "What's the weather looking like this week?",
  "Alert me if paddy goes above ₹2500",
  "What alerts do I have?",
];

const TOOL_LABELS = {
  get_price_forecast: "Price forecast",
  get_demand_forecast: "Demand forecast",
  get_weather: "Weather",
  create_price_alert: "Alert created",
  list_price_alerts: "Alerts checked",
  check_alerts_now: "Alerts re-checked",
};

const PREF_KEY = "agrimarket_voice_prefs";
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY)) || {};
  } catch {
    return {};
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {}
}

function Inline({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>
  );
}

function RichText({ text }) {
  const blocks = [];
  let list = [];
  const flush = () => {
    if (list.length) {
      blocks.push(<ul key={`ul${blocks.length}`}>{list.map((li, i) => <li key={i}><Inline text={li} /></li>)}</ul>);
      list = [];
    }
  };
  text.split("\n").forEach((line) => {
    const m = line.match(/^\s*[-*•]\s+(.*)$/);
    if (m) list.push(m[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={`p${blocks.length}`}><Inline text={line} /></p>);
    }
  });
  flush();
  return <>{blocks}</>;
}

const timeLabel = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

export default function AgentChat() {
  const { lang: appLang } = useLanguage();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState("");
  const [lastFailed, setLastFailed] = useState("");
  const [status, setStatus] = useState(null);

  const [prefs] = useState(loadPrefs);
  const [voiceLang, setVoiceLang] = useState(prefs.voiceLang || voiceLangFromApp(appLang));
  const [autoSpeak, setAutoSpeak] = useState(Boolean(prefs.autoSpeak));
  const [handsFree, setHandsFree] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState(-1);
  const [voiceNote, setVoiceNote] = useState("");

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const recRef = useRef(null);
  const wantVoiceReplyRef = useRef(false);
  const live = useRef({});

  useEffect(() => {
    live.current = { voiceLang, autoSpeak, handsFree, sending };
  });

  useEffect(() => {
    savePrefs({ voiceLang, autoSpeak });
  }, [voiceLang, autoSpeak]);

  const stopSpeaking = useCallback(() => {
    if (canSpeak) window.speechSynthesis.cancel();
    setSpeakingIdx(-1);
  }, []);

  const startListeningRef = useRef(() => {});

  const speak = useCallback(
    (text, idx, { thenListen = false } = {}) => {
      if (!canSpeak) return;
      window.speechSynthesis.cancel();
      const lang = detectLang(text, live.current.voiceLang);
      const clean = toSpeech(text, lang);
      if (!clean) return;
      const voice = pickVoice(lang);
      if (!voice && !lang.startsWith("en")) {
        setVoiceNote(`No ${lang} voice is installed on this device, so the reply may be read with a default voice. You can add one in your system's speech settings.`);
      }
      const chunks = chunkText(clean);
      setSpeakingIdx(idx);
      chunks.forEach((chunk, i) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = lang;
        if (voice) u.voice = voice;
        u.rate = 0.95;
        if (i === chunks.length - 1) {
          u.onend = () => {
            setSpeakingIdx(-1);
            if (thenListen && live.current.handsFree) startListeningRef.current();
          };
        }
        u.onerror = () => setSpeakingIdx(-1);
        window.speechSynthesis.speak(u);
      });
    },
    []
  );

  const send = useCallback(
    async (text, { viaVoice = false } = {}) => {
      const message = (text ?? input).trim();
      if (!message || live.current.sending) return;
      wantVoiceReplyRef.current = viaVoice;
      setInput("");
      setError("");
      setLastFailed("");
      setVoiceNote("");
      setMessages((prev) => [...prev, { role: "user", text: message, at: new Date().toISOString() }]);
      setSending(true);
      try {
        const { data } = await api.post("/agent/chat", { message, voice: viaVoice }, { timeout: 90000 });
        const toolNote = [...new Set((data.data.toolCalls || []).map((t) => TOOL_LABELS[t.name] || t.name))];
        const reply = data.data.reply;
        let newIdx = -1;
        setMessages((prev) => {
          newIdx = prev.length;
          return [...prev, { role: "assistant", text: reply, toolNote, at: new Date().toISOString() }];
        });
        const { autoSpeak: auto, handsFree: hf } = live.current;
        if (canSpeak && (auto || hf || viaVoice)) {
          queueMicrotask(() => speak(reply, newIdx, { thenListen: hf }));
        } else if (hf) {
          startListeningRef.current();
        }
      } catch (err) {
        setLastFailed(message);
        setHandsFree(false);
        setError(
          err.response?.data?.message ||
            (err.code === "ECONNABORTED"
              ? "The assistant took too long to answer. Please try again."
              : err.request
              ? "Can't reach the AgriMarket server. Is the backend running?"
              : "The assistant couldn't respond. Please try again.")
        );
      } finally {
        setSending(false);
        if (!viaVoice) inputRef.current?.focus();
      }
    },
    [input, speak]
  );

  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {}
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionCtor || recRef.current || live.current.sending) return;
    stopSpeaking();
    setVoiceNote("");
    setError("");

    const rec = new SpeechRecognitionCtor();
    rec.lang = live.current.voiceLang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = "";
    let failed = false;

    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      failed = true;
      if (e.error === "aborted") return;
      setVoiceNote(RECOGNITION_ERRORS[e.error] || `Voice input error: ${e.error}`);
      setHandsFree(false);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      const text = finalText.trim();
      if (text) {
        send(text, { viaVoice: true });
      } else {
        setInput("");
        if (!failed && live.current.handsFree) {
          setVoiceNote("I didn't hear anything, so hands-free mode stopped.");
          setHandsFree(false);
        }
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
    }
  }, [send, stopSpeaking]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  function toggleMic() {
    if (listening) stopListening();
    else startListening();
  }

  function toggleHandsFree() {
    if (handsFree) {
      setHandsFree(false);
      stopListening();
      stopSpeaking();
    } else {
      setHandsFree(true);
      live.current.handsFree = true;
      startListening();
    }
  }

  function toggleMessageSpeech(text, idx) {
    if (speakingIdx === idx) stopSpeaking();
    else speak(text, idx);
  }

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {}
      if (canSpeak) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (!canSpeak) return undefined;
    const noop = () => {};
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", noop);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", noop);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.get("/agent/history"), api.get("/agent/status")]).then(([h, s]) => {
      if (cancelled) return;
      if (h.status === "fulfilled") {
        setMessages(
          (h.value.data.data.messages || []).map((m) => ({
            ...m,
            toolNote: (m.tools || []).map((t) => TOOL_LABELS[t] || t),
          }))
        );
      } else {
        setError("Could not load your previous conversation.");
      }
      if (s.status === "fulfilled") setStatus(s.value.data.data);
      setLoadingHistory(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, error]);

  async function retry() {
    const msg = lastFailed;
    setMessages((prev) => (prev.length && prev[prev.length - 1].role === "user" && prev[prev.length - 1].text === msg ? prev.slice(0, -1) : prev));
    await send(msg, { viaVoice: wantVoiceReplyRef.current });
  }

  async function clearChat() {
    if (!window.confirm("Clear this whole conversation?")) return;
    try {
      stopSpeaking();
      await api.delete("/agent/history");
      setMessages([]);
      setError("");
    } catch {
      setError("Could not clear the conversation.");
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(undefined, { viaVoice: false });
    }
  }

  const notConfigured = status && !status.configured;
  const disabled = sending || notConfigured;

  return (
    <article className="forecast-card full agent-chat-card">
      <div className="fc-head">
        <div>
          <h3 className="fc-title">AI Assistant</h3>
          <p className="fc-desc">
            Ask about prices, demand, weather, or your alerts — type or just speak. It looks things up with live forecasts and can act for you (like setting an alert).
          </p>
        </div>
        <span className={`fc-badge ${notConfigured ? "badge-warn" : "badge-green"}`}>
          {notConfigured ? "NOT CONFIGURED" : `ONLINE · ${(status?.provider || "AI").toUpperCase()}`}
        </span>
      </div>

      {notConfigured && (
        <div className="agent-banner">
          The assistant needs an API key. Add <code>{status?.provider === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY"}</code> to <code>backend/.env</code> and restart the backend.
        </div>
      )}

      {(canListen || canSpeak) && (
        <div className="voice-bar">
          <label className="voice-field">
            <span>Voice language</span>
            <select value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)} disabled={listening}>
              {VOICE_LANGS.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          {canSpeak && (
            <label className="voice-toggle">
              <input type="checkbox" checked={autoSpeak} onChange={(e) => { setAutoSpeak(e.target.checked); if (!e.target.checked) stopSpeaking(); }} />
              <span>Read replies aloud</span>
            </label>
          )}
          {canListen && canSpeak && (
            <button type="button" className={`voice-handsfree ${handsFree ? "on" : ""}`} onClick={toggleHandsFree} disabled={notConfigured} title="Talk back and forth without touching the keyboard">
              {handsFree ? "■ Stop hands-free" : "Hands-free chat"}
            </button>
          )}
        </div>
      )}
      {!canListen && (
        <div className="agent-banner subtle">
          Voice input isn't supported in this browser — use Chrome, Edge or Safari to speak to the assistant. Typing still works{canSpeak ? ", and replies can be read aloud." : "."}
        </div>
      )}

      <div className="agent-chat-log" ref={scrollRef} aria-live="polite">
        {loadingHistory && <div className="agent-msg agent-msg-system"><div className="agent-msg-bubble">Loading conversation…</div></div>}
        {!loadingHistory && messages.length === 0 && (
          <div className="agent-chat-empty">
            <strong>Namaste! How can I help today?</strong>
            <p>{canListen ? "Tap the mic and ask, or try one of these:" : "Try one of these:"}</p>
            <div className="agent-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="agent-suggestion-chip" onClick={() => send(s)} disabled={disabled}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`agent-msg agent-msg-${m.role}`}>
            <div className="agent-msg-bubble">
              {m.role === "assistant" ? <RichText text={m.text} /> : m.text}
            </div>
            <div className="agent-msg-meta">
              {m.toolNote && m.toolNote.length > 0 && m.toolNote.map((t) => <span key={t} className="agent-tool-chip">✓ {t}</span>)}
              {m.at && <span className="agent-time">{timeLabel(m.at)}</span>}
              {m.role === "assistant" && canSpeak && (
                <button type="button" className={`agent-listen-btn ${speakingIdx === i ? "on" : ""}`} onClick={() => toggleMessageSpeech(m.text, i)}>
                  {speakingIdx === i ? "■ Stop" : "Listen"}
                </button>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="agent-msg agent-msg-assistant">
            <div className="agent-msg-bubble agent-typing"><i></i><i></i><i></i></div>
          </div>
        )}
        {error && (
          <div className="agent-error" role="alert">
            <span>{error}</span>
            {lastFailed && <button type="button" onClick={retry} disabled={sending}>Retry</button>}
          </div>
        )}
      </div>

      {voiceNote && <div className="voice-note" role="status">{voiceNote}</div>}

      {messages.length > 0 && !sending && !listening && (
        <div className="agent-quick-row">
          {SUGGESTIONS.slice(0, 3).map((s) => (
            <button key={s} type="button" className="agent-suggestion-chip small" onClick={() => send(s)} disabled={notConfigured}>{s}</button>
          ))}
        </div>
      )}

      <form
        className="agent-chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          send(undefined, { viaVoice: false });
        }}
      >
        {canListen && (
          <button
            type="button"
            className={`voice-mic ${listening ? "listening" : ""}`}
            onClick={toggleMic}
            disabled={disabled && !listening}
            aria-label={listening ? "Stop listening" : "Speak to the assistant"}
            aria-pressed={listening}
            title={listening ? "Tap to stop" : "Tap and speak"}
          >
            {listening ? "■" : "Mic"}
          </button>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={listening ? "Listening… speak now" : "Ask about prices, demand, weather, or alerts…"}
          disabled={disabled}
          maxLength={2000}
        />
        <button type="submit" className="run-btn agent-send-btn" disabled={disabled || !input.trim()}>
          {sending ? "…" : "Send"}
        </button>
      </form>

      {listening && (
        <div className="voice-listening">
          <span className="voice-wave"><i></i><i></i><i></i><i></i><i></i></span>
          Listening in {VOICE_LANGS.find((l) => l.code === voiceLang)?.label}… it sends when you stop talking.
        </div>
      )}

      <div className="agent-foot">
        <span>Forecasts are statistical estimates, not guarantees.</span>
        {messages.length > 0 && (
          <button type="button" className="agent-clear-btn" onClick={clearChat}>Clear conversation</button>
        )}
      </div>
    </article>
  );
}
