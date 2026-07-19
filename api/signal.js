import { authOK, readUserKeys } from "./_userkeys.js";

// The multi-turn tool_use loop (with web search) can run well past a minute.
// Raise the serverless limit so it isn't killed mid-signal. Vercel caps this at
// the plan's max (Hobby ≤60s, Pro ≤300s) — see the audit note on timeouts.
export const config = { maxDuration: 300 };

// ═══════════════════════════════════════════════════════════════════════════
// Section 7: server-side Anthropic proxy. The client POSTs { system, userContent,
// model, maxTokens, maxSearches }. The Anthropic API key is read from the encrypted
// server store and NEVER sent to the browser. The full multi-turn tool_use loop —
// including the conversation-history fix — runs here, byte-for-byte identical to the
// original client-side runAI(). Returns only { text, logs } to the client.
// ═══════════════════════════════════════════════════════════════════════════

// ─── JSON recovery (mirror of client parseJSON; used by the salvage pass) ─────
const parseJSON = raw => {
  const clean = (raw || "").replace(/```[a-z]*\n?/gi, "").trim();
  const start = clean.indexOf("{"); if (start === -1) return null;
  const end = clean.lastIndexOf("}");
  if (end > start) { try { return JSON.parse(clean.substring(start, end + 1)); } catch (_) {} }
  let s = clean.substring(start);
  try { return JSON.parse(s); } catch (_) {}
  s = s.replace(/,?\s*"[^"]*$/, "").replace(/,?\s*[\w.]*$/, "");
  const oA = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
  for (let i = 0; i < oA; i++) s += "]";
  const oO = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
  for (let i = 0; i < oO; i++) s += "}";
  try { return JSON.parse(s); } catch (_) { return null; }
};

// ─── Anthropic multi-turn loop (centralised, WITH the conversation-history fix) ─
// Order is strict: capture text → if end_turn break → if pause_turn echo+continue
// → else push assistant, then handle tool_use. Never push-then-break.
export async function runAI({ apiKey, system, userContent, addLog, model = "claude-sonnet-4-6", maxTokens = 6000, maxSearches }) {
  const tools = [{ type: "web_search_20250305", name: "web_search", ...(maxSearches ? { max_uses: maxSearches } : {}) }];
  let history = [{ role: "user", content: userContent }];
  let finalText = "";

  const systemBlocks = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const withCacheMark = msgs => {
    let li = -1;
    for (let k = msgs.length - 1; k >= 0; k--) if (msgs[k].role === "user") { li = k; break; }
    if (li === -1) return msgs;
    return msgs.map((m, idx) => {
      if (idx !== li) return m;
      let c = m.content;
      if (typeof c === "string") c = [{ type: "text", text: c }];
      else c = c.map(b => { const { cache_control, ...rest } = b; return rest; });
      if (!c.length) return m;
      c = [...c.slice(0, -1), { ...c[c.length - 1], cache_control: { type: "ephemeral" } }];
      return { ...m, content: c };
    });
  };
  let useCache = true;

  for (let i = 0; i < 10; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0,
        system: useCache ? systemBlocks : system, tools,
        messages: useCache ? withCacheMark(history) : history })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const msg = e?.error?.message || `API error ${res.status}`;
      if (useCache && /cache/i.test(msg)) { useCache = false; addLog && addLog("Prompt caching rejected — retrying without"); i--; continue; }
      throw new Error(msg);
    }
    const data = await res.json();

    const texts = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    if (texts) finalText = texts;

    if (data.stop_reason === "max_tokens") addLog && addLog("⚠ hit max_tokens — output may be truncated");
    if (data.stop_reason === "end_turn") break;

    if (data.stop_reason === "pause_turn") {
      addLog && addLog("AI searching web (resuming)...");
      history.push({ role: "assistant", content: data.content });
      continue;
    }

    history.push({ role: "assistant", content: data.content });

    if (data.stop_reason === "tool_use") {
      addLog && addLog("AI searching web...");
      const results = (data.content || []).filter(b => b.type === "tool_use").map(b => ({ type: "tool_result", tool_use_id: b.id, content: "Search executed." }));
      if (results.length) history.push({ role: "user", content: results }); else break;
    } else break;
  }

  // SALVAGE PASS: if the reply isn't valid JSON, make one cheap tool-free request
  // that converts it into the required JSON. Fresh context — no tools, no cache.
  if (finalText && !parseJSON(finalText)) {
    addLog && addLog("Reply wasn't valid JSON — running salvage pass...");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 4000, temperature: 0, system,
          messages: [{ role: "user", content: `Your previous analysis reply was not valid JSON. Convert it into the single valid JSON object required by your instructions — preserve every value and conclusion exactly as stated, fill any missing required field sensibly from the text, and output ONLY the JSON with no other text.\n\n--- PREVIOUS REPLY ---\n${finalText.slice(0, 12000)}` }] })
      });
      if (res.ok) {
        const d = await res.json();
        const t = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
        if (t && parseJSON(t)) { addLog && addLog("Salvage succeeded."); return t; }
      }
    } catch (_) {}
    addLog && addLog("Salvage failed — returning original reply.");
  }
  return finalText;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.statusCode = 405; res.end("Method not allowed"); return; }
  if (!authOK(req)) { res.statusCode = 401; res.end("Unauthorized"); return; }

  // Read the request payload (system prompt, user data package, model config) —
  // NO API key comes from the client.
  let raw = "";
  if (req.body && typeof req.body === "object") raw = JSON.stringify(req.body);
  else if (typeof req.body === "string") raw = req.body;
  else raw = await new Promise(r => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => r(d)); req.on("error", () => r("")); });
  let payload = {}; try { payload = JSON.parse(raw) || {}; } catch (_) {}
  const { system, userContent, model, maxTokens, maxSearches } = payload;
  if (!system || !userContent) { res.statusCode = 400; res.end("Missing system/userContent"); return; }

  const keys = await readUserKeys();
  const apiKey = keys.anthropic;
  if (!apiKey) { res.statusCode = 400; res.end(JSON.stringify({ error: "No Anthropic key configured on the server. Save your key in settings first." })); return; }

  const logs = [];
  const addLog = m => logs.push(m);
  try {
    const text = await runAI({ apiKey, system, userContent, addLog, model, maxTokens, maxSearches });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ text, logs }));
  } catch (e) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: e.message || "Signal proxy error", logs }));
  }
}
