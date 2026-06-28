// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL DECK — technical-analysis engine. ALL of this is computed locally from
// real OHLCV candles. The AI never guesses these values; it only judges/synthesises.
//   • multi-timeframe trend (15m / 1h / 4h / daily)
//   • candlestick pattern recognition (last 3 candles, 1h + 4h)
//   • Fibonacci retracement from the 4h swing
//   • ADX trend strength (14)
//   • swing high/low support & resistance with touch ranking
//   • pullback vs reversal depth
//   • volume classification
//   • signal-quality score 0–100
// ═══════════════════════════════════════════════════════════════════════════
import { calcEMA, calcEMAlast, calcATR } from "./shared";

// ─── candle helpers ──────────────────────────────────────────────────────────
export const candleStats = (o, h, l, c) => {
  const range = (h - l) || 1e-9;
  const body = Math.abs(c - o);
  const upper = h - Math.max(o, c);
  const lower = Math.min(o, c) - l;
  return { o, h, l, c, range, body, upper, lower, bull: c >= o };
};
export const buildCandles = (opens, highs, lows, closes) =>
  opens.map((_, i) => candleStats(opens[i], highs[i], lows[i], closes[i]));

// ─── candlestick patterns (most recent 3 candles) ───────────────────────────
export const detectPatterns = (cs, ctx = {}) => {
  const n = cs.length;
  if (n < 2) return [];
  const c1 = cs[n - 1], c2 = cs[n - 2], c3 = cs[n - 3];
  const tf = ctx.tf, atRes = !!ctx.atResistance, atSup = !!ctx.atSupport;
  const out = [];
  const isDoji = c => c.body <= c.range * 0.1;

  if (c1.upper > 2 * c1.body && c1.body < c1.range * 0.4 && c1.lower < c1.body)
    out.push({ name: "Shooting Star", dir: "bearish", tf });
  if (c1.lower > 2 * c1.body && c1.body < c1.range * 0.4 && c1.upper < c1.body)
    out.push({ name: "Hammer", dir: "bullish", tf });
  if (c2.bull && !c1.bull && c1.c < c2.o && c1.o > c2.c)
    out.push({ name: "Bearish Engulfing", dir: "bearish", tf });
  if (!c2.bull && c1.bull && c1.c > c2.o && c1.o < c2.c)
    out.push({ name: "Bullish Engulfing", dir: "bullish", tf });
  if (c3 && c3.bull && c2.body < c2.range * 0.4 && !c1.bull && c1.c < (c3.o + c3.c) / 2)
    out.push({ name: "Evening Star", dir: "bearish", tf });
  if (c3 && !c3.bull && c2.body < c2.range * 0.4 && c1.bull && c1.c > (c3.o + c3.c) / 2)
    out.push({ name: "Morning Star", dir: "bullish", tf });
  if ((c1.c - c1.l) < c1.range * 0.25 && c1.upper > c1.range * 0.6)
    out.push({ name: "Bearish Pin Bar", dir: "bearish", tf });
  if ((c1.h - c1.c) < c1.range * 0.25 && c1.lower > c1.range * 0.6)
    out.push({ name: "Bullish Pin Bar", dir: "bullish", tf });
  if (isDoji(c1))
    out.push({ name: "Doji", dir: atRes ? "bearish" : atSup ? "bullish" : "neutral", tf });
  if (c1.h <= c2.h && c1.l >= c2.l)
    out.push({ name: "Inside Bar", dir: "continuation", tf });
  if (c3 && c1.bull && c2.bull && c3.bull) out.push({ name: "Three White Soldiers", dir: "bullish", tf });
  if (c3 && !c1.bull && !c2.bull && !c3.bull) out.push({ name: "Three Black Crows", dir: "bearish", tf });

  return out;
};

// ─── ADX (Wilder, 14) ────────────────────────────────────────────────────────
export const calcADX = (highs, lows, closes, period = 14) => {
  const len = highs.length;
  if (len < period * 2 + 1) return null;
  const tr = [], pDM = [], mDM = [];
  for (let i = 1; i < len; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    pDM.push(up > dn && up > 0 ? up : 0);
    mDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smooth = arr => {
    const out = []; let s = arr.slice(0, period).reduce((a, b) => a + b, 0); out.push(s);
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
    return out;
  };
  const trS = smooth(tr), pS = smooth(pDM), mS = smooth(mDM);
  const dx = [];
  for (let i = 0; i < trS.length; i++) {
    const pDI = 100 * pS[i] / (trS[i] || 1e-9);
    const mDI = 100 * mS[i] / (trS[i] || 1e-9);
    dx.push(100 * Math.abs(pDI - mDI) / ((pDI + mDI) || 1e-9));
  }
  if (dx.length < period) return null;
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
  const li = trS.length - 1;
  return { adx, plusDI: 100 * pS[li] / (trS[li] || 1e-9), minusDI: 100 * mS[li] / (trS[li] || 1e-9) };
};
export const adxClass = a => a == null ? "—" : a >= 25 ? "STRONG" : a >= 20 ? "DEVELOPING" : "WEAK";

// ─── Fibonacci retracement from the recent swing ─────────────────────────────
export const calcFib = (highs, lows, price) => {
  const high = Math.max(...highs), low = Math.min(...lows);
  const range = (high - low) || 1e-9;
  const pcts = [0.236, 0.382, 0.5, 0.618, 0.786];
  const levels = {};
  pcts.forEach(p => { levels[p] = high - range * p; });
  const byPrice = [["Swing High", high], ["23.6%", levels[0.236]], ["38.2%", levels[0.382]],
    ["50.0%", levels[0.5]], ["61.8%", levels[0.618]], ["78.6%", levels[0.786]], ["Swing Low", low]];
  let position = "—", atLevel = null;
  for (let i = 0; i < byPrice.length - 1; i++)
    if (price <= byPrice[i][1] && price >= byPrice[i + 1][1]) { position = `between ${byPrice[i + 1][0]} and ${byPrice[i][0]}`; break; }
  for (const [name, val] of byPrice) if (Math.abs(price - val) / price < 0.003) { atLevel = name; break; }
  return { high, low, range, levels, position, atLevel };
};

// ─── swing-based support / resistance with touch ranking ────────────────────
export const detectLevels = (highs, lows, price) => {
  const sh = [], sl = [];
  for (let i = 2; i < highs.length - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) sh.push(highs[i]);
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) sl.push(lows[i]);
  }
  const cluster = arr => {
    arr.sort((a, b) => a - b);
    const cl = [];
    for (const v of arr) {
      const last = cl[cl.length - 1];
      if (last && Math.abs(v - last.level) / last.level < 0.003) { last.vals.push(v); last.level = last.vals.reduce((a, b) => a + b, 0) / last.vals.length; }
      else cl.push({ level: v, vals: [v] });
    }
    return cl.map(c => ({ level: c.level, touches: c.vals.length }));
  };
  const resistance = cluster(sh).filter(c => c.level > price).sort((a, b) => b.touches - a.touches || a.level - b.level).slice(0, 3);
  const support = cluster(sl).filter(c => c.level < price).sort((a, b) => b.touches - a.touches || b.level - a.level).slice(0, 3);
  const near = [...resistance, ...support].find(l => Math.abs(price - l.level) / price < 0.005);
  return { resistance, support, near: near ? near.level : null };
};

// ─── pullback vs reversal (on 1h) ────────────────────────────────────────────
export const analyzePullback = (highs, lows, closes) => {
  const price = closes[closes.length - 1];
  const start = Math.max(2, highs.length - 40);
  let sh = null, sl = null, shI = -1, slI = -1;
  for (let i = start; i < highs.length - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) { sh = highs[i]; shI = i; }
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) { sl = lows[i]; slI = i; }
  }
  if (sh == null || sl == null) return null;
  const range = Math.abs(sh - sl) || 1e-9;
  let dir, retrace;
  if (shI > slI) { dir = "up"; retrace = (sh - price) / range; }
  else { dir = "down"; retrace = (price - sl) / range; }
  retrace = Math.max(0, Math.min(1.2, retrace));
  const pct = retrace * 100;
  const state = pct < 38.2 ? "SHALLOW" : pct < 50 ? "NORMAL" : pct < 61.8 ? "DEEP" : "REVERSAL";
  return { dir, pct, state, swingHigh: sh, swingLow: sl };
};

// ─── volume classification ───────────────────────────────────────────────────
export const volumeState = volumes => {
  if (!volumes || volumes.length < 21 || volumes.every(v => !v)) return null;
  const avg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const cur = volumes[volumes.length - 1];
  if (!avg) return null;
  const ratio = cur / avg;
  return { ratio, cls: ratio > 1.5 ? "HIGH" : ratio < 0.8 ? "LOW" : "NORMAL" };
};

// ─── per-timeframe trend (EMA20 vs price) ───────────────────────────────────
export const trendOf = closes => {
  if (closes.length < 21) return "FLAT";
  const e = calcEMAlast(closes, 20), p = closes[closes.length - 1];
  return p > e * 1.0005 ? "BULL" : p < e * 0.9995 ? "BEAR" : "FLAT";
};

// ─── master aggregator ───────────────────────────────────────────────────────
// Each c* = { opens, highs, lows, closes, volumes }
export const analyzeTimeframes = ({ c15, c1h, c4h, price, atr4h }) => {
  const t4 = trendOf(c4h.closes), t1 = trendOf(c1h.closes), t15 = trendOf(c15.closes);
  const adxR = calcADX(c4h.highs, c4h.lows, c4h.closes, 14);
  const adx = adxR ? adxR.adx : null;
  const fib = calcFib(c4h.highs.slice(-50), c4h.lows.slice(-50), price);
  const sr = detectLevels(c4h.highs.slice(-100), c4h.lows.slice(-100), price);
  const pull = analyzePullback(c1h.highs, c1h.lows, c1h.closes);
  const vol4 = volumeState(c4h.volumes), vol1 = volumeState(c1h.volumes), vol15 = volumeState(c15.volumes);

  const nearRes = sr.resistance[0] && Math.abs(price - sr.resistance[0].level) / price < 0.005;
  const nearSup = sr.support[0] && Math.abs(price - sr.support[0].level) / price < 0.005;
  const pat4 = detectPatterns(buildCandles(c4h.opens, c4h.highs, c4h.lows, c4h.closes), { tf: "4h", atResistance: nearRes, atSupport: nearSup });
  const pat1 = detectPatterns(buildCandles(c1h.opens, c1h.highs, c1h.lows, c1h.closes), { tf: "1h", atResistance: nearRes, atSupport: nearSup });
  const pat15 = detectPatterns(buildCandles(c15.opens, c15.highs, c15.lows, c15.closes), { tf: "15m" });

  const allPats = [...pat4, ...pat1];
  const bullP = allPats.filter(p => p.dir === "bullish").length;
  const bearP = allPats.filter(p => p.dir === "bearish").length;
  const patternBias = bullP > bearP ? "bullish" : bearP > bullP ? "bearish" : "neutral";
  // strongest pattern at a key level for the alert card
  const keyPattern = allPats.find(p => (p.dir === "bullish" && nearSup) || (p.dir === "bearish" && nearRes)) || allPats[0] || null;

  const mtfAligned = t4 === t1 && t1 !== "FLAT";
  const overall = t4 === t1 ? t4 : "WAIT";
  const sigOf = t => t === "BULL" ? "LONG" : t === "BEAR" ? "SHORT" : "—";

  const mtf = {
    rows: [
      { tf: "4h", trend: t4, candle: pat4[0]?.name || "—", volume: vol4?.cls || "—", signal: sigOf(t4) },
      { tf: "1h", trend: t1, candle: pat1[0]?.name || "—", volume: vol1?.cls || "—", signal: sigOf(t1) },
      { tf: "15m", trend: t15, candle: pat15[0]?.name || "—", volume: vol15?.cls || "—", signal: pull ? `Pullback ${pull.state}` : sigOf(t15) },
    ],
    overall: overall === "WAIT" ? "WAIT" : sigOf(overall),
    aligned: mtfAligned,
  };

  const entries = {
    optimal: fib.levels[0.382],
    aggressive: price,
    pattern: keyPattern ? c1h.closes[c1h.closes.length - 1] : null,
    conservative: "wait for 15m close in trend direction",
    recommended: keyPattern && (nearRes || nearSup) ? "Pattern"
      : pull && pull.state === "SHALLOW" ? "Optimal (fib 38.2%)"
        : pull && (pull.state === "DEEP" || pull.state === "REVERSAL") ? "Conservative"
          : "Aggressive",
  };

  return {
    t4, t1, t15, adx, adxClass: adxClass(adx),
    fib, sr, pull, vol4, vol1, vol15,
    pat4, pat1, pat15, patternBias, keyPattern, nearRes, nearSup,
    mtf, entries, atr4h,
  };
};

// ─── signal-quality score 0–100 (scorecard PASSes + local bonuses) ──────────
export const signalQuality = (parsed, ta) => {
  const sc = parsed.scorecard || {};
  let pts = 0;
  Object.values(sc).forEach(it => { if (it && (it.r === "PASS" || it.r === "BULLISH")) pts += 10; });
  let bonus = 0;
  if (ta.keyPattern && (ta.nearRes || ta.nearSup)) bonus += 15;
  if (ta.mtf.aligned) bonus += 10;
  if (ta.vol4 && ta.vol4.cls === "HIGH") bonus += 5;
  if (ta.adx != null && ta.adx > 25) bonus += 5;
  const score = Math.min(100, pts + bonus);
  const label = score < 50 ? "WAIT" : score < 70 ? "MEDIUM" : score < 85 ? "HIGH" : "VERY HIGH";
  return { score, label };
};

// ─── prompt block: hand the AI everything we computed (it must not re-derive) ─
export const taPromptBlock = (ta, f) => {
  const fl = ta.fib.levels;
  const res = ta.sr.resistance.map(r => `${f(r.level)}(${r.touches}x)`).join(", ") || "none";
  const sup = ta.sr.support.map(r => `${f(r.level)}(${r.touches}x)`).join(", ") || "none";
  const pats = (lbl, arr) => arr.length ? `${lbl}: ${arr.map(p => `${p.name}[${p.dir}]`).join(", ")}` : `${lbl}: none`;
  return `MULTI-TIMEFRAME (computed locally — MASTER RULE: never trade against 4h; 1h must confirm 4h; if 4h≠1h → WAIT)
  4h trend: ${ta.t4} | 1h trend: ${ta.t1} | 15m trend: ${ta.t15} | OVERALL: ${ta.mtf.overall}${ta.mtf.aligned ? " (ALIGNED)" : " (NOT aligned)"}
  ADX(4h): ${ta.adx != null ? ta.adx.toFixed(1) : "n/a"} → ${ta.adxClass} trend (${"<20 weak, 20-25 developing, >25 strong"})

CANDLE PATTERNS (last 3 candles)
  ${pats("4h", ta.pat4)}
  ${pats("1h", ta.pat1)}
  pattern bias: ${ta.patternBias}${ta.keyPattern ? ` | KEY: ${ta.keyPattern.name} on ${ta.keyPattern.tf} at ${ta.nearRes ? "resistance" : ta.nearSup ? "support" : "level"}` : ""}

VOLUME (current vs 20-avg)  4h:${ta.vol4 ? ta.vol4.cls + " " + ta.vol4.ratio.toFixed(2) + "x" : "n/a"} | 1h:${ta.vol1 ? ta.vol1.cls + " " + ta.vol1.ratio.toFixed(2) + "x" : "n/a"}

FIBONACCI (from 4h swing, last 50)  High:${f(ta.fib.high)} Low:${f(ta.fib.low)}
  23.6%:${f(fl[0.236])} | 38.2%:${f(fl[0.382])}★ | 50%:${f(fl[0.5])} | 61.8%:${f(fl[0.618])}★ | 78.6%:${f(fl[0.786])}
  price ${ta.fib.position}${ta.fib.atLevel ? ` — AT ${ta.fib.atLevel}` : ""}

PULLBACK (1h)  ${ta.pull ? `${ta.pull.pct.toFixed(0)}% retraced → ${ta.pull.state} (${ta.pull.dir}-move). <38% shallow/hold, 38-50 normal, 50-61.8 reversal risk, >61.8 likely reversal/exit` : "no clear swing"}

AUTO SUPPORT/RESISTANCE (4h swings, touch-ranked)
  resistance: ${res}
  support: ${sup}${ta.sr.near ? `\n  ⚠ price within 0.5% of ${f(ta.sr.near)}` : ""}

SCORE THE TWO NEW SCORECARD ROWS:
  "candles" = PASS if a pattern supports the trade direction (ideally at a key level), FAIL if a pattern opposes it, else NEUTRAL.
  "mtf" = PASS if 4h+1h agree (aligned), FAIL if they conflict, NEUTRAL if a timeframe is flat.`;
};
