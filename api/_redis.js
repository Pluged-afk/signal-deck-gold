import { createClient } from "redis";

// Shared Redis helper for the serverless functions. Uses the REDIS_URL the
// Upstash integration provides (a TLS rediss:// connection string). Every call
// opens a short-lived connection and closes it — fine for a rarely-hit login
// endpoint. All callers must tolerate a null client (store unavailable →
// fail open so the site never breaks).
export async function withRedis(fn) {
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) return fn(null);
  let client;
  try {
    client = createClient({ url, socket: { connectTimeout: 4000 } });
    client.on("error", () => {}); // swallow — handled by try/catch
    await client.connect();
    return await fn(client);
  } catch (_) {
    return fn(null);
  } finally {
    try { if (client?.isOpen) await client.quit(); } catch (_) {}
  }
}
