import crypto from "node:crypto";
import { withRedis } from "./_redis.js";

// ═══════════════════════════════════════════════════════════════════════════
// Server-side ONLY. Single source of truth for the AES-256-GCM encrypted user
// key store in Redis. Section 7: /api/signal and /api/data read the real keys
// here so they NEVER have to be returned to the browser. The encryption key is
// derived from RESET_TOKEN (stable across SITE_PASS rotations).
// ═══════════════════════════════════════════════════════════════════════════
export const COOKIE = "sdg_auth";
export const MASK = "__stored__"; // sentinel returned to the client for a set key

export const aesKey = () => {
  const t = process.env.RESET_TOKEN;
  return t ? crypto.createHash("sha256").update("sdg-keys-v1:" + t).digest() : null;
};

export const encKeys = obj => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
};

export const decKeys = b64 => {
  try {
    const buf = Buffer.from(b64, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", aesKey(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
  } catch (_) { return null; }
};

// Read + decrypt the stored keys ({} if none / unavailable). Server-side only.
export const readUserKeys = async () => {
  if (!aesKey()) return {};
  const blob = await withRedis(r => r ? r.get("sdg_userkeys") : null);
  return (blob && decKeys(blob)) || {};
};

// Shared auth gate for the proxy routes (same login cookie as the app).
export const authOK = req => {
  const USER = process.env.SITE_USER || "signal", PASS = process.env.SITE_PASS || "";
  if (!PASS) return false;
  const token = crypto.createHash("sha256").update(`${USER}:${PASS}`).digest("hex");
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="));
  return !!cookie && cookie.slice(COOKIE.length + 1) === token;
};
