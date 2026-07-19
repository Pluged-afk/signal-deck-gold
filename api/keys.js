import { withRedis } from "./_redis.js";
import { authOK, aesKey, encKeys, readUserKeys, MASK } from "./_userkeys.js";

// Encrypted API-key store. Section 7: GET no longer returns raw key VALUES to the
// browser — it returns a "__stored__" sentinel for any key that is set (so the
// client can still tell a key is configured) while the real values stay server-
// side and are used only by the /api/signal and /api/data proxies. POST saves new
// values; a field left as the sentinel keeps the existing stored value untouched.
const FIELDS = ["anthropic", "td", "fred", "glassnode"];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authOK(req)) { res.statusCode = 401; res.end("Unauthorized"); return; }
  if (!aesKey()) { res.statusCode = 503; res.end("Key store not configured"); return; }

  if (req.method === "GET") {
    const stored = await readUserKeys();
    // Mask: never send real values to the client — only presence.
    const masked = {};
    for (const f of FIELDS) masked[f] = stored[f] ? MASK : "";
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(masked));
    return;
  }

  if (req.method === "POST") {
    let raw = "";
    if (req.body && typeof req.body === "object") raw = JSON.stringify(req.body);
    else if (typeof req.body === "string") raw = req.body;
    else raw = await new Promise(r => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => r(d)); req.on("error", () => r("")); });
    let incoming = {}; try { incoming = JSON.parse(raw) || {}; } catch (_) {}

    const existing = await readUserKeys();
    const clean = {};
    for (const f of FIELDS) {
      const v = incoming[f];
      // Sentinel (or undefined) = "unchanged" → keep the existing stored value.
      clean[f] = (v === undefined || v === MASK) ? String(existing[f] || "") : String(v || "");
    }
    await withRedis(r => r ? r.set("sdg_userkeys", encKeys(clean)) : null);
    res.end("ok");
    return;
  }

  res.statusCode = 405; res.end("Method not allowed");
}
