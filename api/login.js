import crypto from "node:crypto";
import { withRedis } from "./_redis.js";

// Login handler + IP-based lockout. Edge middleware can't read POST bodies, so
// the passcode check lives here. After MAX_FAILS wrong attempts an IP is added
// to a durable Redis block set; every further attempt — right or wrong — is
// refused until an admin clears it via /api/reset. Fails OPEN if Redis is down.
const COOKIE = "sdg_auth";
const MAX_FAILS = 2;

const ipOf = req =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.headers["x-real-ip"] || "unknown";

export default async function handler(req, res) {
  const USER = process.env.SITE_USER || "signal";
  const PASS = process.env.SITE_PASS || "";
  if (req.method !== "POST") { res.statusCode = 405; res.end("Method not allowed"); return; }
  res.setHeader("Cache-Control", "no-store");

  const ip = ipOf(req);

  let pass = "";
  try {
    if (req.body && typeof req.body === "object") pass = req.body.pass || "";
    else {
      let raw = typeof req.body === "string" ? req.body : "";
      if (!raw) raw = await new Promise(r => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => r(d)); req.on("error", () => r("")); });
      pass = new URLSearchParams(raw).get("pass") || "";
    }
  } catch (_) {}

  const outcome = await withRedis(async (redis) => {
    // Blocked already? Refuse outright (even a correct passcode won't pass).
    if (redis && (await redis.sIsMember("sdg_blocked", ip))) return "blocked";

    if (PASS && pass === PASS) {
      if (redis) await redis.del(`sdg_fail:${ip}`); // reset counter on success
      return "ok";
    }

    // Wrong passcode → count the failure; block once it reaches MAX_FAILS.
    if (redis) {
      const n = await redis.incr(`sdg_fail:${ip}`);
      await redis.expire(`sdg_fail:${ip}`, 86400);
      if (n >= MAX_FAILS) { await redis.sAdd("sdg_blocked", ip); await redis.del(`sdg_fail:${ip}`); return "blocked"; }
    }
    return "wrong";
  });

  if (outcome === "ok") {
    const token = crypto.createHash("sha256").update(`${USER}:${PASS}`).digest("hex");
    res.statusCode = 303;
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    res.setHeader("Location", "/");
    res.end();
    return;
  }

  res.statusCode = 303;
  res.setHeader("Location", outcome === "blocked" ? "/?b=1" : "/?e=1");
  res.end();
}
