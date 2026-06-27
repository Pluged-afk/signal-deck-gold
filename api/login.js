import crypto from "node:crypto";

// Login handler. Edge Middleware can't read POST bodies, but a Node serverless
// function can — so the passcode check lives here. On success it issues the same
// HttpOnly session cookie the middleware validates, then redirects to the app.
export default async function handler(req, res) {
  const USER = process.env.SITE_USER || "signal";
  const PASS = process.env.SITE_PASS || "";

  if (req.method !== "POST") { res.statusCode = 405; res.end("Method not allowed"); return; }

  let pass = "";
  try {
    if (req.body && typeof req.body === "object") {
      pass = req.body.pass || "";
    } else {
      let raw = typeof req.body === "string" ? req.body : "";
      if (!raw) {
        raw = await new Promise(resolve => {
          let d = ""; req.on("data", c => (d += c)); req.on("end", () => resolve(d)); req.on("error", () => resolve(""));
        });
      }
      pass = new URLSearchParams(raw).get("pass") || "";
    }
  } catch (_) {}

  res.setHeader("Cache-Control", "no-store");
  if (PASS && pass === PASS) {
    const token = crypto.createHash("sha256").update(`${USER}:${PASS}`).digest("hex");
    res.statusCode = 303;
    res.setHeader("Set-Cookie", `sdg_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    res.setHeader("Location", "/");
    res.end();
  } else {
    res.statusCode = 303;
    res.setHeader("Location", "/?e=1");
    res.end();
  }
}
