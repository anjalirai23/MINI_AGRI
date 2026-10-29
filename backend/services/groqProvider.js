const { TOOL_DEFINITIONS, executeTool } = require("./agentTools");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_TOOL_ITERATIONS = 6;
const MAX_RETRIES = 2;
const HISTORY_FOR_GROQ = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function groqModel() {
  return process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
}
function groqConfigured() {
  return Boolean((process.env.GROQ_API_KEY || "").trim());
}

function lowerTypes(node) {
  if (Array.isArray(node)) return node.map(lowerTypes);
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : lowerTypes(v);
    return out;
  }
  return node;
}

function groqTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: lowerTypes(t.parameters || { type: "OBJECT", properties: {} }) },
  }));
}

async function callGroq(body) {
  const apiKey = (process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("GROQ_API_KEY is not set");
    err.code = "NO_API_KEY";
    throw err;
  }
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (res.ok) return json;

    const err = new Error(json?.error?.message || text.slice(0, 300) || `Groq error ${res.status}`);
    err.status = res.status;
    err.provider = "groq";
    lastErr = err;
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    const retryable = res.status === 429 || res.status >= 500 || (res.status === 400 && /tool_use_failed|failed_generation/i.test(text));
    if (!retryable || attempt === MAX_RETRIES) break;
    await sleep(Math.min(retryAfter ? retryAfter * 1000 : 1000 * (attempt + 1), 8000));
  }
  throw lastErr;
}

async function runGroq({ systemPrompt, history, userMessage, userId }) {
  const messages = [{ role: "system", content: systemPrompt }];
  for (const m of history.slice(-HISTORY_FOR_GROQ)) {
    messages.push({ role: m.role === "model" ? "assistant" : "user", content: m.parts[0].text });
  }
  while (messages.length > 1 && messages[1].role !== "user") messages.splice(1, 1);
  messages.push({ role: "user", content: userMessage });

  const tools = groqTools();
  const toolCalls = [];
  let reply = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const data = await callGroq({ model: groqModel(), messages, tools, tool_choice: "auto", temperature: 0.4, max_tokens: 900 });
    const msg = data.choices?.[0]?.message;
    const calls = msg?.tool_calls || [];

    if (!calls.length) {
      reply = (msg?.content || "").trim();
      break;
    }

    messages.push({ role: "assistant", content: msg.content || "", tool_calls: calls });
    for (const call of calls) {
      let args = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      const name = call.function?.name;
      toolCalls.push({ name, input: args });
      let output;
      try {
        output = await executeTool(name, args, { userId });
      } catch (err) {
        console.error(`[agent] tool ${name} failed:`, err.message);
        output = { error: `The ${name} tool failed: ${err.message || "unknown error"}` };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output).slice(0, 6000) });
    }
  }
  return { reply, toolCalls };
}

module.exports = { runGroq, groqModel, groqConfigured };
