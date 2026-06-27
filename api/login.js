import crypto from "node:crypto";

// Login handler + IP-based lockout. Edge middleware can't read POST bodies, so
// the passcode check lives here. After MAX_FAILS wrong attempts an IP is added
// to a durable block set (Vercel KV / Upstash) and every further attempt —
// right or wrong — is refused until an admin clears it via /api/reset.
const COOKIE = "sdg_auth";
const MAX_FAILS = 2;

async function kv(...cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null; // store not linked → fail open (no limiting)
  try {
    const r = await fetch(`${url}/${cmd.map(encodeURIComponent).join("/")}`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) return null;
    return (await r.json()).result;
  } catch (_) { return null; }
}

const ipOf = req =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.headers["x-real-ip"] || "unknown";

export default async function handler(req, res) {
  const USER = process.env.SITE_USER || "signal";
  const PASS = process.env.SITE_PASS || "";
  if (req.method !== "POST") { res.statusCode = 405; res.end("Method not allowed"); return; }
  res.setHeader("Cache-Control", "no-store");

  const ip = ipOf(req);

  // Already blocked → refuse outright (even a correct passcode won't pass).
  if ((await kv("sismember", "sdg_blocked", ip)) === 1) {
    res.statusCode = 303; res.setHeader("Location", "/?b=1"); res.end(); return;
  }

  let pass = "";
  try {
    if (req.body && typeof req.body === "object") pass = req.body.pass || "";
    else {
      let raw = typeof req.body === "string" ? req.body : "";
      if (!raw) raw = await new Promise(r => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => r(d)); req.on("error", () => r("")); });
      pass = new URLSearchParams(raw).get("pass") || "";
    }
  } catch (_) {}

  if (PASS && pass === PASS) {
    await kv("del", `sdg_fail:${ip}`); // reset the counter on success
    const token = crypto.createHash("sha256").update(`${USER}:${PASS}`).digest("hex");
    res.statusCode = 303;
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    res.setHeader("Location", "/");
    res.end();
    return;
  }

  // Wrong passcode → count the failure; block this IP once it reaches MAX_FAILS.
  let blockedNow = false;
  const n = await kv("incr", `sdg_fail:${ip}`);
  if (n !== null) {
    await kv("expire", `sdg_fail:${ip}`, 86400);
    if (n >= MAX_FAILS) { await kv("sadd", "sdg_blocked", ip); blockedNow = true; }
  }
  res.statusCode = 303;
  res.setHeader("Location", blockedNow ? "/?b=1" : "/?e=1");
  res.end();
}
