const { GoogleGenAI } = require("@google/genai");
const { TOOL_DEFINITIONS, executeTool } = require("./agentTools");
const { runGroq, groqModel, groqConfigured } = require("./groqProvider");

const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_TOOL_ITERATIONS = 6;
const MAX_HISTORY_MESSAGES = 30;
const MAX_RETRIES = 2;

const SYSTEM_PROMPT = `You are the AgriMarket AI assistant, helping Indian farmers make sense of crop price forecasts, demand forecasts, weather, and price alerts inside the AgriMarket AI app.

Rules:
- Always use the provided tools to look up prices, demand, weather, or alerts. Never invent or guess numbers.
- Reply in the same language the farmer writes in (English, Hindi, Punjabi or Bengali).
- Keep answers short, plain-language, and practical for a farmer on a phone screen. Use ₹ for prices (per quintal) unless told otherwise.
- Formatting: short sentences; use "- " bullets for lists and **bold** for the key number or recommendation. No headings, no tables.
- These are statistical forecasts, not guarantees — when giving a sell/hold opinion, say it's a forecast-based suggestion and that actual mandi prices can differ.
- You are not a licensed financial advisor. For large financial decisions, note the farmer should weigh local mandi conditions too.
- Only create a price alert after the farmer has clearly asked for one or confirmed the crop/target price/condition — don't create alerts speculatively. Call list_price_alerts first to avoid duplicates.
- If a tool errors or a crop isn't one of wheat/paddy/cotton/maize, say so plainly rather than making something up.
- If the question is unrelated to farming, markets, weather or the app, politely steer back to what you can help with.`;

const FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-2.5-flash"];
let _workingModel = null;

function getProvider() {
  const p = (process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "groq" || p === "gemini") return p;
  return !(process.env.GEMINI_API_KEY || "").trim() && groqConfigured() ? "groq" : "gemini";
}

function getModelName() {
  if (getProvider() === "groq") return groqModel();
  return _workingModel || process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

function modelCandidates() {
  return [...new Set([_workingModel, process.env.GEMINI_MODEL || DEFAULT_MODEL, ...FALLBACK_MODELS].filter(Boolean))];
}

function useVertex() {
  return (process.env.GEMINI_USE_VERTEX || "").toLowerCase() === "true";
}

let _client = null;
function getClient() {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not set");
    err.code = "NO_API_KEY";
    throw err;
  }
  if (!_client) {
    _client = useVertex()
      ? new GoogleGenAI({ vertexai: true, apiKey })
      : new GoogleGenAI({ apiKey });
  }
  return _client;
}

function isConfigured() {
  return getProvider() === "groq" ? groqConfigured() : Boolean((process.env.GEMINI_API_KEY || "").trim());
}

function textOf(parts) {
  return (parts || [])
    .filter((p) => typeof p?.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function hasToolParts(parts) {
  return (parts || []).some((p) => p?.functionCall || p?.functionResponse);
}

function toGeminiHistory(stored) {
  const clean = [];
  for (const m of stored || []) {
    if (!m || (m.role !== "user" && m.role !== "model")) continue;
    if (hasToolParts(m.parts)) continue;
    const text = textOf(m.parts);
    if (!text) continue;
    const prev = clean[clean.length - 1];
    if (prev && prev.role === m.role) {
      prev.parts[0].text += "\n" + text;
    } else {
      clean.push({ role: m.role, parts: [{ text }] });
    }
  }
  while (clean.length && clean[0].role !== "user") clean.shift();
  while (clean.length && clean[clean.length - 1].role !== "model") clean.pop();
  return clean.slice(-MAX_HISTORY_MESSAGES).filter((_, i, arr) => !(i === 0 && arr[0].role !== "user"));
}

function trimStored(messages) {
  let out = messages.slice(-MAX_HISTORY_MESSAGES);
  while (out.length && out[0].role !== "user") out = out.slice(1);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateWithRetry(params) {
  const client = getClient();
  let lastErr;
  for (const model of modelCandidates()) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await client.models.generateContent({ ...params, model });
        _workingModel = model;
        return res;
      } catch (err) {
        lastErr = err;
        const status = Number(err?.status);
        const transient = status === 503 || status === 429 || status === 500 || status === 504;
        if (status === 404) break;
        if (!transient || attempt === MAX_RETRIES) throw err;
        await sleep(800 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

function toFunctionResponsePayload(output) {
  if (output !== null && typeof output === "object" && !Array.isArray(output)) return output;
  return { result: output };
}

const VOICE_ADDENDUM = `

VOICE MODE: this farmer is talking to you by voice and your reply will be read aloud.
- Answer in at most 3 short, natural spoken sentences.
- No bullets, no markdown, no symbols like ** or #. Say numbers the way a person would say them.
- Lead with the answer (e.g. sell or wait), then one key number.`;

async function runAgent({ userId, history, userMessage, voice = false }) {
  const systemPrompt = voice ? SYSTEM_PROMPT + VOICE_ADDENDUM : SYSTEM_PROMPT;
  const base = toGeminiHistory(history);
  const contents = [...base, { role: "user", parts: [{ text: userMessage }] }];
  let toolCalls = [];
  let reply = "";

  if (getProvider() === "groq") {
    const out = await runGroq({
      systemPrompt,
      history: base,
      userMessage,
      userId,
    });
    reply = out.reply;
    toolCalls = out.toolCalls;
  }

  for (let i = 0; getProvider() !== "groq" && i < MAX_TOOL_ITERATIONS; i++) {
    const response = await generateWithRetry({
      model: getModelName(),
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: TOOL_DEFINITIONS }],
        temperature: 0.4,
      },
    });

    const candidate = response.candidates?.[0];
    const content = candidate?.content || { role: "model", parts: [] };
    if (!content.role) content.role = "model";

    const functionCalls = (content.parts || []).filter((p) => p.functionCall).map((p) => p.functionCall);

    if (functionCalls.length === 0) {
      reply = textOf(content.parts);
      if (!reply) {
        const blocked = response.promptFeedback?.blockReason || candidate?.finishReason;
        reply =
          blocked && blocked !== "STOP"
            ? "I couldn't put together an answer to that. Could you rephrase or ask something about crops, prices, demand, or weather?"
            : "Sorry, I didn't get a response that time. Please try asking again.";
      }
      break;
    }

    contents.push(content);
    const responseParts = [];
    for (const call of functionCalls) {
      const args = call.args || {};
      toolCalls.push({ name: call.name, input: args });
      let output;
      try {
        output = await executeTool(call.name, args, { userId });
      } catch (err) {
        console.error(`[agent] tool ${call.name} failed:`, err.message);
        output = { error: `The ${call.name} tool failed: ${err.message || "unknown error"}` };
      }
      const fr = { name: call.name, response: toFunctionResponsePayload(output) };
      if (call.id) fr.id = call.id;
      responseParts.push({ functionResponse: fr });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  if (!reply) {
    reply =
      "I gathered some data but couldn't finish reasoning about it in time — could you ask again, maybe more specifically?";
  }

  const at = new Date().toISOString();
  const toolNames = [...new Set(toolCalls.map((t) => t.name))];
  const stored = trimStored([
    ...(history || []).filter((m) => m && (m.role === "user" || m.role === "model") && !hasToolParts(m.parts)),
    { role: "user", parts: [{ text: userMessage }], at },
    { role: "model", parts: [{ text: reply }], tools: toolNames, at },
  ]);

  return { reply, messages: stored, toolCalls };
}

module.exports = { runAgent, isConfigured, getModelName, getProvider };
