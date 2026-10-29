const { runAgent, isConfigured, getModelName, getProvider } = require("../services/agentService");
const { checkAlertsForUser } = require("../services/agentAutomation");
const { logActivity } = require("../services/activity");
const AgentConversation = require("../models/AgentConversation");

async function getOrCreateConversation(userId) {
  let convo = await AgentConversation.findOne({ user: userId });
  if (!convo) convo = await AgentConversation.create({ user: userId, messages: [] });
  return convo;
}

function toDisplayMessages(messages) {
  const display = [];
  for (const m of messages || []) {
    const text = (m.parts || []).filter((p) => typeof p.text === "string").map((p) => p.text).join("\n").trim();
    if (!text || (m.parts || []).some((p) => p.functionCall || p.functionResponse)) continue;
    if (m.role === "user") display.push({ role: "user", text, at: m.at });
    else if (m.role === "model") display.push({ role: "assistant", text, at: m.at, tools: m.tools || [] });
  }
  return display;
}

function describeAiError(err) {
  const status = Number(err?.status);
  const raw = String(err?.message || "");
  if (/SERVICE_DISABLED|has not been used in project/i.test(raw)) {
    const url = (raw.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/[^\s"\\]+/) || [])[0];
    const vertex = /aiplatform/i.test(raw);
    return {
      code: 502,
      message:
        (vertex
          ? "The request went to Google Vertex AI, which is switched off for this project. Remove GEMINI_USE_VERTEX from backend/.env (the Gemini API doesn't need Vertex) and restart the backend."
          : "A Google API needed by the assistant is switched off for this key's Cloud project.") +
        (url ? ` To enable it instead: ${url}` : ""),
    };
  }
  if (/ACCESS_TOKEN_TYPE_UNSUPPORTED|Expected OAuth 2 access token/i.test(raw)) {
    return {
      code: 502,
      message: "Google didn't accept this key type for the Gemini API. Create a fresh key at aistudio.google.com/apikey, paste it into GEMINI_API_KEY in backend/.env, and restart the backend.",
    };
  }
  if (status === 401 || status === 403) {
    return { code: 502, message: "Google refused the request (permission denied). Check GEMINI_API_KEY in backend/.env — create a key at aistudio.google.com/apikey and make sure the Gemini API is enabled for its project." };
  }
  if (status === 400 && /api key|API_KEY_INVALID|permission/i.test(raw)) {
    return { code: 502, message: "The AI service says the API key is invalid. Check GEMINI_API_KEY in backend/.env." };
  }
  if (err?.provider === "groq" && status === 401) {
    return { code: 502, message: "Groq rejected the API key. Create a new one at console.groq.com/keys, put it in GROQ_API_KEY in backend/.env, and restart the backend." };
  }
  if (err?.provider === "groq" && status === 404) {
    return { code: 502, message: `Groq doesn't have the model "${getModelName()}". Set GROQ_MODEL in backend/.env to llama-3.3-70b-versatile.` };
  }
  if (status === 404) {
    return { code: 502, message: `None of the tried Gemini models (${getModelName()}, gemini-3.5-flash, gemini-2.5-flash) were found for this key. Set GEMINI_MODEL in backend/.env to a model your key can access.` };
  }
  if (status === 429) {
    return { code: 429, message: "The AI service is rate-limited or out of quota right now. Please wait a minute and try again." };
  }
  if (status === 503 || status === 500 || status === 504) {
    return { code: 503, message: "Google's AI service is busy at the moment. Please try again in a few seconds." };
  }
  if (err?.code === "ENOTFOUND" || err?.code === "ECONNREFUSED" || err?.code === "ETIMEDOUT" || /fetch failed/i.test(raw)) {
    return { code: 503, message: "The backend couldn't reach the AI service (network problem). Check the server's internet connection." };
  }
  return { code: 500, message: null };
}

async function status(req, res) {
  res.json({ success: true, data: { configured: isConfigured(), model: getModelName(), provider: getProvider() } });
}

async function chat(req, res, next) {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ success: false, message: "message is required" });
    if (message.length > 2000) return res.status(400).json({ success: false, message: "Message is too long (max 2000 characters)." });

    const convo = await getOrCreateConversation(req.userId);

    let result;
    try {
      result = await runAgent({ userId: req.userId, history: convo.messages, userMessage: message, voice: req.body?.voice === true });
    } catch (err) {
      if (err.code === "NO_API_KEY") {
        return res.status(503).json({
          success: false,
          message: `The AI assistant isn't configured yet — set ${getProvider() === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY"} in backend/.env and restart the backend.`,
        });
      }
      const info = describeAiError(err);
      console.error("[agent] chat failed:", err.status || err.code || "", err.message);
      if (info.message) return res.status(info.code).json({ success: false, message: info.message });
      throw err;
    }

    convo.messages = result.messages;
    convo.markModified("messages");
    await convo.save();

    const preview = message.length > 70 ? message.slice(0, 67) + "…" : message;
    logActivity(req.userId, `Asked the AI assistant: "${preview}"`);

    res.json({ success: true, data: { reply: result.reply, toolCalls: result.toolCalls } });
  } catch (err) {
    next(err);
  }
}

async function history(req, res, next) {
  try {
    const convo = await AgentConversation.findOne({ user: req.userId });
    res.json({ success: true, data: { messages: convo ? toDisplayMessages(convo.messages) : [] } });
  } catch (err) {
    next(err);
  }
}

async function resetHistory(req, res, next) {
  try {
    await AgentConversation.findOneAndUpdate({ user: req.userId }, { messages: [] }, { upsert: true });
    res.json({ success: true, message: "Conversation cleared" });
  } catch (err) {
    next(err);
  }
}

async function checkAlerts(req, res, next) {
  try {
    const triggered = await checkAlertsForUser(req.userId);
    res.json({ success: true, data: { triggered } });
  } catch (err) {
    next(err);
  }
}

module.exports = { chat, history, resetHistory, checkAlerts, status };
