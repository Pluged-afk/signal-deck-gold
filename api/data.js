import { authOK, readUserKeys } from "./_userkeys.js";

// ═══════════════════════════════════════════════════════════════════════════
// Section 7: server-side data proxy for the KEYED upstreams (Twelve Data, FRED).
// The client passes the full upstream URL WITHOUT the key via ?u=;
// the server validates the host, injects the user's key from the encrypted store,
// forwards the request, and passes the response through. Keyless upstreams
// (Binance, CoinGecko, Swissquote, CFTC, blockchain.info, alternative.me) stay
// direct on the client — no key, nothing to hide. Gated by the login cookie and
// host-locked so it can't be abused as an open proxy.
// ═══════════════════════════════════════════════════════════════════════════
const UPSTREAM = {
  td:   { host: "api.twelvedata.com", keyParam: "apikey",  keyField: "td" },
  fred: { host: "api.stlouisfed.org", keyParam: "api_key", keyField: "fred" },
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authOK(req)) { res.statusCode = 401; res.end("Unauthorized"); return; }

  const q = req.query || {};
  const src = String(q.src || "");
  const u = String(q.u || "");
  const cfg = UPSTREAM[src];
  if (!cfg) { res.statusCode = 400; res.end("Unknown src"); return; }

  let url;
  try { url = new URL(u); } catch (_) { res.statusCode = 400; res.end("Bad url"); return; }
  // Host-lock: only the expected upstream, https only (blocks SSRF / open-proxy use).
  if (url.protocol !== "https:" || url.hostname !== cfg.host) { res.statusCode = 400; res.end("Host not allowed"); return; }

  const keys = await readUserKeys();
  const key = keys[cfg.keyField];
  if (!key) { res.statusCode = 400; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ status: "error", message: `${src} key not configured on server` })); return; }

  // Inject the key server-side (strip any client-supplied one first).
  url.searchParams.delete(cfg.keyParam);
  url.searchParams.set(cfg.keyParam, key);

  try {
    const r = await fetch(url.toString(), { headers: { "User-Agent": "signal-deck" } });
    const body = await r.text();
    res.statusCode = r.status;
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
    res.end(body);
  } catch (e) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "error", message: e.message || "upstream error" }));
  }
}
