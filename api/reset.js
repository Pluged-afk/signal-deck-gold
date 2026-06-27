import { withRedis } from "./_redis.js";

// Admin unblock. Reversible ONLY by whoever holds RESET_TOKEN (an env var that
// never reaches the browser). Visit:
//   /api/reset?token=YOUR_TOKEN            → clears ALL blocked IPs
//   /api/reset?token=YOUR_TOKEN&ip=1.2.3.4 → clears one IP
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const TOKEN = process.env.RESET_TOKEN;
  const url = new URL(req.url, `https://${req.headers.host}`);
  const given = url.searchParams.get("token");

  if (!TOKEN || given !== TOKEN) { res.statusCode = 403; res.end("Forbidden"); return; }

  const ip = url.searchParams.get("ip");
  const msg = await withRedis(async (redis) => {
    if (!redis) return "Store unavailable — nothing changed.";
    if (ip) { await redis.sRem("sdg_blocked", ip); await redis.del(`sdg_fail:${ip}`); return `Unblocked ${ip}.`; }
    await redis.del("sdg_blocked");
    return "All blocked IPs cleared.";
  });

  res.statusCode = 200;
  res.end(msg);
}
