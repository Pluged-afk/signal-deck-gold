// Admin unblock. Reversible ONLY by whoever holds RESET_TOKEN (an env var that
// never reaches the browser). Visit:
//   /api/reset?token=YOUR_TOKEN           → clears ALL blocked IPs
//   /api/reset?token=YOUR_TOKEN&ip=1.2.3.4 → clears one IP
async function kv(...cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  try {
    const r = await fetch(`${url}/${cmd.map(encodeURIComponent).join("/")}`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) return null;
    return (await r.json()).result;
  } catch (_) { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const TOKEN = process.env.RESET_TOKEN;
  const url = new URL(req.url, `https://${req.headers.host}`);
  const given = url.searchParams.get("token");

  if (!TOKEN || given !== TOKEN) { res.statusCode = 403; res.end("Forbidden"); return; }

  const ip = url.searchParams.get("ip");
  if (ip) { await kv("srem", "sdg_blocked", ip); await kv("del", `sdg_fail:${ip}`); res.statusCode = 200; res.end(`Unblocked ${ip}.`); }
  else { await kv("del", "sdg_blocked"); res.statusCode = 200; res.end("All blocked IPs cleared."); }
}
