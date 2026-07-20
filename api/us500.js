import { authOK } from "./_userkeys.js";

// ═══════════════════════════════════════════════════════════════════════════
// FREE, no-key S&P 500 index data for the US500 engine. Twelve Data's free tier
// excludes index (SPX) and futures (ES) data — Gold's forex key can't serve them
// — so US500 uses this instead. Fetches Yahoo Finance ^GSPC server-side (no CORS,
// no key), returns 15m / 1h / 4h / 1day OHLCV in the same shape the pipeline used
// for Twelve Data. Yahoo has no native 4h, so 4h is resampled from 1h. Falls back
// query1→query2 host and ^GSPC→ES=F (e-mini futures) symbol. Gated by the login
// cookie like the other server routes.
// ═══════════════════════════════════════════════════════════════════════════
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
// ES=F (e-mini futures) FIRST: it trades ~23h and tracks the US500 CFD, so it
// stays fresh in pre-market/overnight. ^GSPC (cash index) is a fallback only —
// it FREEZES at the last cash close (9:30–16:00 ET), so it would serve days-old
// data outside US hours. Both free feeds are ~10-15 min delayed.
const SYMBOLS = ["ES%3DF", "%5EGSPC"];

async function yfetch(symbol, interval, range) {
  for (const host of HOSTS) {
    try {
      const r = await fetch(`https://${host}/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`,
        { headers: { "User-Agent": "Mozilla/5.0 (signal-deck)" } });
      if (!r.ok) continue;
      const d = await r.json();
      const res = d?.chart?.result?.[0];
      if (res?.timestamp?.length) return res;
    } catch (_) {}
  }
  return null;
}

// Yahoo chart result → {times,opens,highs,lows,closes,volumes}, dropping null bars.
function toCandles(res) {
  const ts = res.timestamp || [];
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const out = { times: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.times.push(new Date(ts[i] * 1000).toISOString().replace("T", " ").slice(0, 19));
    out.opens.push(o); out.highs.push(h); out.lows.push(l); out.closes.push(c);
    out.volumes.push(q.volume?.[i] || 0);
  }
  return out;
}

// Resample 1h candles into 4h (consecutive groups of 4, oldest→newest).
function resample4h(c) {
  const out = { times: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
  for (let i = 0; i < c.closes.length; i += 4) {
    const end = Math.min(i + 4, c.closes.length);
    out.times.push(c.times[i]);
    out.opens.push(c.opens[i]);
    out.highs.push(Math.max(...c.highs.slice(i, end)));
    out.lows.push(Math.min(...c.lows.slice(i, end)));
    out.closes.push(c.closes[end - 1]);
    out.volumes.push(c.volumes.slice(i, end).reduce((a, b) => a + b, 0));
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authOK(req)) { res.statusCode = 401; res.end("Unauthorized"); return; }
  const priceOnly = (req.query && req.query.price === "1");

  // Resolve a working symbol via a light 1h fetch first.
  let usedSym = null, c1hRes = null;
  for (const sym of SYMBOLS) {
    const r = await yfetch(sym, "60m", priceOnly ? "5d" : "3mo");
    if (r) { usedSym = sym; c1hRes = r; break; }
  }
  if (!c1hRes) {
    res.statusCode = 502; res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "S&P 500 source unavailable" })); return;
  }

  const c1h = toCandles(c1hRes);
  const price = c1hRes.meta?.regularMarketPrice ?? c1h.closes[c1h.closes.length - 1] ?? null;
  const src = usedSym === "ES%3DF" ? "Yahoo ES=F (~15m delayed)" : "Yahoo ^GSPC (cash, ~15m delayed)";
  // Freshness: how old the latest quote is, so the pipeline can flag stale data.
  const asOfTs = c1hRes.meta?.regularMarketTime || c1hRes.timestamp?.[c1hRes.timestamp.length - 1] || null;
  const ageMin = asOfTs ? Math.round((Date.now() / 1000 - asOfTs) / 60) : null;
  const asOf = asOfTs ? new Date(asOfTs * 1000).toISOString() : null;

  if (priceOnly) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ price, src, asOf, ageMin })); return;
  }

  const [c15Res, c1dRes] = await Promise.all([yfetch(usedSym, "15m", "1mo"), yfetch(usedSym, "1d", "2y")]);
  const c15 = c15Res ? toCandles(c15Res) : c1h;
  const c1d = c1dRes ? toCandles(c1dRes) : c1h;
  const c4h = resample4h(c1h);

  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ price, src, asOf, ageMin, c15, c1h, c4h, c1d }));
}
