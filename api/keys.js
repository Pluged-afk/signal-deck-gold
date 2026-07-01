import crypto from "node:crypto";
import { withRedis } from "./_redis.js";

// Encrypted API-key store. GET returns the user's saved keys, POST saves them.
// Access requires the same session cookie the middleware issues (i.e. knowing
// the site passcode) — the middleware already gates this route, and we verify
// again here for depth. Keys are AES-256-GCM encrypted at rest in Redis with a
// key derived from RESET_TOKEN (stable across SITE_PASS rotations), so neither
// Redis dumps nor env listings alone reveal them.
const COOKIE = "sdg_auth";

const aesKey = () => {
  const t = process.env.RESET_TOKEN;
  return t ? crypto.createHash("sha256").update("sdg-keys-v1:" + t).digest() : null;
};
const enc = obj => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
};
const dec = b64 => {
  try {
    const buf = Buffer.from(b64, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", aesKey(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
  } catch (_) { return null; }
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const USER = process.env.SITE_USER || "signal", PASS = process.env.SITE_PASS || "";
  const token = crypto.createHash("sha256").update(`${USER}:${PASS}`).digest("hex");
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="));
  if (!PASS || !cookie || cookie.slice(COOKIE.length + 1) !== token) { res.statusCode = 401; res.end("Unauthorized"); return; }
  if (!aesKey()) { res.statusCode = 503; res.end("Key store not configured"); return; }

  if (req.method === "GET") {
    const blob = await withRedis(r => r ? r.get("sdg_userkeys") : null);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify((blob && dec(blob)) || {}));
    return;
  }

  if (req.method === "POST") {
    let raw = "";
    if (req.body && typeof req.body === "object") raw = JSON.stringify(req.body);
    else if (typeof req.body === "string") raw = req.body;
    else raw = await new Promise(r => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => r(d)); req.on("error", () => r("")); });
    let keys = {}; try { keys = JSON.parse(raw) || {}; } catch (_) {}
    // whitelist the expected fields only
    const clean = { anthropic: String(keys.anthropic || ""), td: String(keys.td || ""), fred: String(keys.fred || "") };
    await withRedis(r => r ? r.set("sdg_userkeys", enc(clean)) : null);
    res.end("ok");
    return;
  }

  res.statusCode = 405; res.end("Method not allowed");
}
