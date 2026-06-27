import { next } from "@vercel/edge";

// Server-side gate. Runs at the edge BEFORE any HTML/JS is served, so the
// passcode never reaches the browser bundle. Vercel strips WWW-Authenticate
// from middleware responses (native Basic Auth popup won't fire), so instead we
// serve our own themed login page and grant a signed, HttpOnly session cookie.
export const config = { matcher: "/:path*" };

const COOKIE = "sdg_auth";

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function getCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function loginPage(error) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Signal Deck — private</title></head>
<body style="margin:0;background:#020617;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<form method="POST" action="/" style="background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:2.5rem 2rem;width:100%;max-width:340px;text-align:center;box-sizing:border-box;">
<p style="font-size:20px;margin:0 0 4px;color:#fbbf24;font-weight:700;letter-spacing:0.06em;">✦ SIGNAL DECK</p>
<p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#475569;margin:0 0 1.75rem;">Private access only</p>
<input name="pass" type="password" placeholder="Enter access code" autofocus autocomplete="current-password"
 style="width:100%;padding:10px 12px;background:#020617;border:1px solid ${error ? "#7f1d1d" : "#334155"};border-radius:8px;color:#e2e8f0;font-size:13px;font-family:'JetBrains Mono',monospace;box-sizing:border-box;text-align:center;letter-spacing:0.12em;margin-bottom:0.9rem;outline:none;"/>
<button type="submit" style="width:100%;padding:10px;background:#1e3a5f;border:1px solid #2563eb;border-radius:8px;color:#60a5fa;font-size:13px;cursor:pointer;font-family:'JetBrains Mono',monospace;">Unlock →</button>
${error ? `<p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#f87171;margin:0.75rem 0 0;">Incorrect code</p>` : ""}
</form></body></html>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-store" },
  });
}

export default async function middleware(request) {
  const USER = process.env.SITE_USER || "signal";
  const PASS = process.env.SITE_PASS;

  // Fail closed: if no password is configured, deny everything.
  if (!PASS) {
    return new Response("Site locked — no credentials configured.", {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }

  const token = await sha256(`${USER}:${PASS}`);

  // Already authenticated via session cookie → serve the app.
  if (getCookie(request.headers.get("cookie"), COOKIE) === token) {
    return next();
  }

  // Login form submission.
  if (request.method === "POST") {
    let pass = "";
    try {
      const body = await request.text();
      pass = new URLSearchParams(body).get("pass") || "";
    } catch (_) {}
    if (pass === PASS) {
      return new Response(null, {
        status: 303,
        headers: {
          "Location": "/",
          // Session cookie (no Max-Age) → cleared when the browser closes.
          "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`,
          "Cache-Control": "no-store",
        },
      });
    }
    return loginPage(true);
  }

  // Not authenticated → show the login page.
  return loginPage(false);
}
