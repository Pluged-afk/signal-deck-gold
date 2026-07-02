import crypto from "node:crypto";
import { withRedis } from "./_redis.js";

// Live economic-calendar proxy (ForexFactory weekly feed). The upstream has no
// CORS headers and rate-limits hard (429 on the 2nd quick hit), so the browser
// can't fetch it directly — we fetch server-side and cache in Redis for 45 min.
// Gated by the same login cookie as the app (also keeps this from being an open
// proxy). Serves stale cache if upstream is down; 503 if nothing available.
const COOKIE = "sdg_auth";
const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const FRESH_MS = 45 * 60000;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const USER = process.env.SITE_USER || "signal", PASS = process.env.SITE_PASS || "";
  const token = crypto.createHash("sha256").update(`${USER}:${PASS}`).digest("hex");
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="));
  if (!PASS || !cookie || cookie.slice(COOKIE.length + 1) !== token) { res.statusCode = 401; res.end("Unauthorized"); return; }

  const cached = await withRedis(async r => { if (!r) return null; try { return JSON.parse(await r.get("sdg_ffcal") || "null"); } catch (_) { return null; } });
  if (cached && Date.now() - cached.at < FRESH_MS) {
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(cached.data)); return;
  }

  let data = null;
  try {
    const r = await fetch(FEED, { headers: { "User-Agent": "Mozilla/5.0 (signal-deck)" } });
    if (r.ok) {
      const raw = await r.json();
      if (Array.isArray(raw) && raw.length) {
        // slim to the fields the client needs
        data = raw.map(e => ({ title: e.title, country: e.country, date: e.date, impact: e.impact }));
      }
    }
  } catch (_) {}

  if (data) {
    await withRedis(r => r ? r.set("sdg_ffcal", JSON.stringify({ at: Date.now(), data })) : null);
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); return;
  }
  if (cached) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(cached.data)); return; } // stale beats nothing
  res.statusCode = 503; res.end("calendar unavailable");
}
