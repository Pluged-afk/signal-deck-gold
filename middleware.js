import { next } from "@vercel/edge";

// Server-side gate. Runs at the edge BEFORE any HTML/JS is served, so the
// credentials never reach the browser bundle. Without a valid login the visitor
// receives a 401 and never downloads the app at all.
export const config = { matcher: "/:path*" };

export default function middleware(request) {
  const USER = process.env.SITE_USER || "signal";
  const PASS = process.env.SITE_PASS;

  // Fail closed: if no password is configured in the environment, deny everything.
  if (!PASS) {
    return new Response("Site locked — no credentials configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const auth = request.headers.get("authorization") || "";
  const [scheme, encoded] = auth.split(" ");
  if (scheme === "Basic" && encoded) {
    let decoded = "";
    try { decoded = atob(encoded); } catch (_) {}
    const i = decoded.indexOf(":");
    const user = decoded.slice(0, i);
    const pass = decoded.slice(i + 1);
    if (user === USER && pass === PASS) {
      return next(); // authorized — continue to the app
    }
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Signal Deck — private", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}
