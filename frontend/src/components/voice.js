export const SpeechRecognitionCtor =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition || null : null;

export const canListen = Boolean(SpeechRecognitionCtor);
export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

export const VOICE_LANGS = [
  { code: "en-IN", label: "English", app: "en" },
  { code: "hi-IN", label: "हिन्दी", app: "hi" },
  { code: "pa-IN", label: "ਪੰਜਾਬੀ", app: "pa" },
  { code: "bn-IN", label: "বাংলা", app: "bn" },
];

export function voiceLangFromApp(appLang) {
  return VOICE_LANGS.find((l) => l.app === appLang)?.code || "en-IN";
}

export function detectLang(text, fallback = "en-IN") {
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
  if (/[\u0A00-\u0A7F]/.test(text)) return "pa-IN";
  if (/[\u0980-\u09FF]/.test(text)) return "bn-IN";
  return fallback.startsWith("en") || /[A-Za-z]/.test(text) ? "en-IN" : fallback;
}

export function toSpeech(text, lang) {
  let t = String(text || "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[`#>_]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ");
  if (lang.startsWith("en")) {
    t = t
      .replace(/₹\s?([\d,]+(?:\.\d+)?)/g, "$1 rupees")
      .replace(/\/\s?quintal/gi, " per quintal")
      .replace(/(\d)\s?%/g, "$1 percent");
  } else {
    t = t.replace(/₹\s?/g, "").replace(/(\d)\s?%/g, "$1 %");
  }
  return t.replace(/\s{2,}/g, " ").trim();
}

export function chunkText(text, max = 180) {
  const sentences = text.split(/(?<=[.!?।])\s+/).filter(Boolean);
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length > max && cur) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur = (cur + " " + s).trim();
    }
  }
  if (cur) chunks.push(cur.trim());
  return chunks.length ? chunks : [text];
}

export function pickVoice(lang) {
  if (!canSpeak) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  const norm = (v) => v.lang.replace("_", "-").toLowerCase();
  const exact = voices.find((v) => norm(v) === lang.toLowerCase());
  if (exact) return exact;
  const prefix = lang.split("-")[0].toLowerCase();
  return voices.find((v) => norm(v).startsWith(prefix)) || null;
}

export const RECOGNITION_ERRORS = {
  "not-allowed": "Microphone access is blocked. Allow the microphone for this site in your browser settings.",
  "service-not-allowed": "Microphone access is blocked. Allow the microphone for this site in your browser settings.",
  "no-speech": "I didn't hear anything. Tap the mic and try again.",
  "audio-capture": "No microphone was found. Check that one is connected.",
  network: "Speech recognition needs an internet connection.",
  "language-not-supported": "This browser can't recognise that language. Try another voice language.",
};
