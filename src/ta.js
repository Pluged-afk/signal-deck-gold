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
import { calcEMA, calcEMAlast, calcATR, bollinger } from "./shared";

// ─── Tiered pullback zones (Section 3a) — one shared band model ──────────────
// Retracement %, banded into six zones. Used by both the local pullback analysis
// and the segmented Pullback Meter so the labels never drift apart.
export const PULLBACK_ZONES = [
  { state: "SHALLOW",       lo: 0,     hi: 23.6, color: "#4ade80" },
  { state: "NORMAL",        lo: 23.6,  hi: 38.2, color: "#a3e635" },
  { state: "MODERATE",      lo: 38.2,  hi: 50,   color: "#fbbf24" },
  { state: "DEEP",          lo: 50,    hi: 61.8, color: "#fb923c" },
  { state: "SEVERE",        lo: 61.8,  hi: 100,  color: "#f87171" },
  { state: "FULL REVERSAL", lo: 100,   hi: 150,  color: "#dc2626" },
];
export const pullbackZone = pct => PULLBACK_ZONES.find(z => pct < z.hi) || PULLBACK_ZONES[PULLBACK_ZONES.length - 1];

// Bollinger regime on 4h (20, 2SD) — reuses the scalp BB math. Compares the
// current band width to its recent average to classify squeeze vs trending.
const bb4hRegime = closes => {
  const cur = bollinger(closes, 20, 2);
  if (!cur) return null;
  const widths = [];
  for (let i = Math.max(21, closes.length - 30); i <= closes.length; i++) {
    const b = bollinger(closes.slice(0, i), 20, 2);
    if (b) widths.push(b.width);
  }
  const avgWidth = widths.reduce((a, b) => a + b, 0) / (widths.length || 1);
  const squeeze = cur.width < 0.8 * avgWidth, wide = cur.width > 1.25 * avgWidth;
  return { ...cur, avgWidth, squeeze, wide, regime: squeeze ? "SQUEEZE — breakout coming" : wide ? "WIDE — trending" : "normal" };
};

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

// ─── Fibonacci retracement from the recent swing (with swing dates) ──────────
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtSwingDate = t => {
  if (t == null) return null;
  const d = typeof t === "number" ? new Date(t) : new Date(String(t).replace(" ", "T") + "Z");
  return isNaN(d) ? null : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
export const calcFib = (highs, lows, price, times) => {
  let high = -Infinity, low = Infinity, hiI = 0, loI = 0;
  for (let i = 0; i < highs.length; i++) { if (highs[i] > high) { high = highs[i]; hiI = i; } if (lows[i] < low) { low = lows[i]; loI = i; } }
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
  return { high, low, range, levels, position, atLevel, highDate: times ? fmtSwingDate(times[hiI]) : null, lowDate: times ? fmtSwingDate(times[loI]) : null };
};

// ─── volume divergence: price and volume moving opposite = weak move ─────────
export const volDivergence = (closes, volumes) => {
  if (closes.length < 8 || volumes.length < 8 || volumes.every(v => !v)) return null;
  const pNow = closes[closes.length - 1], pPrev = closes[closes.length - 6];
  const vRecent = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3, vPrior = volumes.slice(-6, -3).reduce((a, b) => a + b, 0) / 3;
  const priceUp = pNow > pPrev, volUp = vRecent > vPrior;
  if (priceUp && !volUp) return "Price rising on falling volume — weak move";
  if (!priceUp && !volUp) return "Price falling on falling volume — weak selling";
  return null;
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
  retrace = Math.max(0, Math.min(1.5, retrace)); // allow >100% for FULL REVERSAL
  const pct = retrace * 100;
  const zone = pullbackZone(pct);
  return { dir, pct, state: zone.state, color: zone.color, swingHigh: sh, swingLow: sl };
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

// Higher-timeframe trend. Same idea as trendOf but with a WIDER flat band: a
// ±0.05% band is meaningless on a daily/weekly close, so the daily was forced to
// take a side even when genuinely directionless, manufacturing false conflicts.
// Backtest across gold/GBP/BTC, train AND test halves (6/6 improvements), showed a
// smooth plateau from 0.25%–1.0% — 0.5% sits safely inside it (1.5% breaks GBP).
//   period 20 on daily closes  = the daily trend
//   period 100 on daily closes = the weekly trend (20 weeks ≈ weekly EMA20), which
//   matched true weekly-candle aggregation within noise while avoiding the fact
//   that Twelve Data returns date strings and Binance returns ms timestamps.
export const htfTrend = (closes, period = 20, band = 0.005) => {
  if (!closes || closes.length < period + 1) return "FLAT";
  const e = calcEMAlast(closes, period);
  if (e == null) return "FLAT";
  const p = closes[closes.length - 1];
  return p > e * (1 + band) ? "BULL" : p < e * (1 - band) ? "BEAR" : "FLAT";
};

// ─── trend-context helpers (weighted inputs for the AI, not hard rules) ───────
// bars = per-asset calibrated ADX thresholds (GBP/USD trends less sharply than
// gold/BTC, so its weak/strong bars are lower — set from real ADX distribution).
const trendStrength = (adx, adxPrev, closes, bars = { weak: 20, strong: 25 }) => {
  if (adx == null) return { label: "unknown", note: "ADX unavailable", mode: "trend" };
  const t = closes.slice(-4);
  const up = t.length === 4 && t[3] > t[2] && t[2] > t[1];
  const down = t.length === 4 && t[3] < t[2] && t[2] < t[1];
  const rising = adxPrev != null && adx > adxPrev + 1;
  if (adx > bars.strong && (up || down)) return { label: "STRONG", note: `ADX ${adx.toFixed(0)} + ${up ? "3 up" : "3 down"} 4h candles — favour trend-following`, mode: "trend" };
  if (adx < bars.weak && rising) return { label: "TRANSITIONING", note: `ADX ${adx.toFixed(0)} rising — trend developing, watch for breakout confirmation`, mode: "transition" };
  if (adx < bars.weak) return { label: "WEAK/RANGING", note: `ADX ${adx.toFixed(0)} — ranging market, favour mean-reversion (bounces not breakouts)`, mode: "range" };
  return { label: "MODERATE", note: `ADX ${adx.toFixed(0)} — developing`, mode: rising ? "transition" : "trend" };
};

const priceStructure = (highs, lows) => {
  const sh = [], sl = [];
  for (let i = 2; i < highs.length - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) sh.push(highs[i]);
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) sl.push(lows[i]);
  }
  const lastH = sh.slice(-3), lastL = sl.slice(-3);
  const asc = a => a.length >= 2 && a.every((v, i) => i === 0 || v > a[i - 1]);
  const desc = a => a.length >= 2 && a.every((v, i) => i === 0 || v < a[i - 1]);
  let structure = "ranging (flat highs/lows)";
  if (asc(lastH) && asc(lastL)) structure = "UPTREND — higher highs + higher lows";
  else if (desc(lastH) && desc(lastL)) structure = "DOWNTREND — lower highs + lower lows";
  else if (asc(lastH)) structure = "higher highs, mixed lows";
  else if (desc(lastL)) structure = "lower lows, mixed highs";
  return { highs: lastH, lows: lastL, structure };
};

const macdHistSeries = closes => {
  const e12 = calcEMA(closes, 12), e26 = calcEMA(closes, 26);
  const valid = e12.map((v, i) => ({ v: (v != null && e26[i] != null) ? v - e26[i] : null, i })).filter(x => x.v != null);
  const sigArr = calcEMA(valid.map(x => x.v), 9);
  const hist = {};
  for (let k = 0; k < valid.length; k++) if (sigArr[k] != null) hist[valid[k].i] = valid[k].v - sigArr[k];
  return hist;
};
const detectDivergence = (highs, lows, closes) => {
  const hist = macdHistSeries(closes);
  const peaks = [], troughs = [];
  for (let i = 2; i < closes.length - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) peaks.push(i);
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) troughs.push(i);
  }
  const p = peaks.slice(-2), t = troughs.slice(-2);
  if (p.length === 2 && hist[p[0]] != null && hist[p[1]] != null && highs[p[1]] > highs[p[0]] && hist[p[1]] < hist[p[0]])
    return { type: "bearish", note: "price higher-high but MACD lower-high — weakening uptrend, SHORT bias" };
  if (t.length === 2 && hist[t[0]] != null && hist[t[1]] != null && lows[t[1]] < lows[t[0]] && hist[t[1]] > hist[t[0]])
    return { type: "bullish", note: "price lower-low but MACD higher-low — weakening downtrend, LONG bias" };
  return { type: "none", note: "no clear divergence" };
};

const sessionBias = (c1h, price) => {
  const n = Math.min(8, c1h.highs.length);
  const hi = Math.max(...c1h.highs.slice(-n)), lo = Math.min(...c1h.lows.slice(-n));
  if (hi === lo) return { bias: "neutral", pct: 50 };
  const pct = Math.round((price - lo) / (hi - lo) * 100);
  return { bias: pct >= 60 ? "bullish" : pct <= 40 ? "bearish" : "neutral", pct, hi, lo };
};

// ─── Volatility Meter (G3): current vs the asset's OWN recent baseline ────────
// recent 5-bar avg true-range vs 20-bar avg true-range (4h) → a per-asset relative
// read. An ATR% that's "normal" for BTC would be "extreme" for GBP, so this is
// always measured against the same asset's own history, never a shared scale.
export const volMeter = (highs, lows, closes, recent = 5, base = 20) => {
  const n = closes.length;
  if (n < base + 2) return null;
  const tr = [];
  for (let i = 1; i < n; i++) tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const cur = mean(tr.slice(-recent)), avg = mean(tr.slice(-base));
  if (!avg) return null;
  const pct = Math.round(cur / avg * 100);
  const level = pct < 70 ? "LOW" : pct <= 130 ? "NORMAL" : pct <= 200 ? "HIGH" : "EXTREME";
  return { pct, level };
};

// ─── Flip confirmation (G4): a single-candle level break is only tradeable once
// the NEXT candle confirms it. Returns pending / confirmed / false_break so the AI
// won't hand out a full-confidence breakout on the triggering candle alone.
export const flipCheck = (c4h, sr, atr4h) => {
  const c = c4h.closes, n = c.length;
  if (n < 3 || !atr4h) return { status: "none" };
  const levels = [...(sr.resistance || []).map(r => r.level), ...(sr.support || []).map(s => s.level)];
  if (!levels.length) return { status: "none" };
  const c0 = c[n - 1], c1 = c[n - 2], c2 = c[n - 3];
  const margin = atr4h * 0.15; // a "meaningful" close beyond the level (not a hair)
  for (const lvl of levels) {
    // prior candle (c1) closed through a level that c2 was on the other side of
    const brokeUp = c2 <= lvl && c1 > lvl + margin, brokeDn = c2 >= lvl && c1 < lvl - margin;
    if (brokeUp || brokeDn) {
      const dir = brokeUp ? "up" : "down";
      if (brokeUp) return c0 > c1 ? { status: "confirmed", dir, level: lvl } : c0 < lvl ? { status: "false_break", dir, level: lvl, note: "next candle reclaimed BELOW the level" } : { status: "pending", dir, level: lvl };
      return c0 < c1 ? { status: "confirmed", dir, level: lvl } : c0 > lvl ? { status: "false_break", dir, level: lvl, note: "next candle reclaimed ABOVE the level" } : { status: "pending", dir, level: lvl };
    }
    // the LATEST candle just flipped — no confirmation candle yet
    const nowUp = c1 <= lvl && c0 > lvl + margin, nowDn = c1 >= lvl && c0 < lvl - margin;
    if (nowUp || nowDn) return { status: "pending", dir: nowUp ? "up" : "down", level: lvl, note: "flip on the latest candle — awaiting next-candle confirmation" };
  }
  return { status: "none" };
};

// ─── master aggregator ───────────────────────────────────────────────────────
// Each c* = { opens, highs, lows, closes, volumes }. `cal` = per-asset calibrated
// ADX bars ({weak,strong}); defaults to gold/BTC's 20/25 when omitted.
export const analyzeTimeframes = ({ c15, c1h, c4h, c1d, c4hTimes, price, atr4h, prevClose, cal, rangeFadeEnabled = false, revFadeEnabled = false }) => {
  // c1h and c4h are required (master timeframes); c15 is optional (entry timing);
  // c1d is optional but strongly recommended — see dailyConflict below.
  const t4 = trendOf(c4h.closes), t1 = trendOf(c1h.closes), t15 = c15 ? trendOf(c15.closes) : "FLAT";
  // Daily + weekly, both derived from the daily candle array the pipelines already fetch.
  const dC = (c1d && c1d.closes) ? c1d.closes : null;
  const htfOK = !!(dC && dC.length >= 21);
  const tD = htfOK ? htfTrend(dC, 20) : "FLAT";
  const tW = (dC && dC.length >= 101) ? htfTrend(dC, 100) : "FLAT";
  const adxR = calcADX(c4h.highs, c4h.lows, c4h.closes, 14);
  const adx = adxR ? adxR.adx : null;
  const fib = calcFib(c4h.highs.slice(-50), c4h.lows.slice(-50), price, c4hTimes ? c4hTimes.slice(-50) : null);
  const sr = detectLevels(c4h.highs.slice(-100), c4h.lows.slice(-100), price);
  const pull = analyzePullback(c1h.highs, c1h.lows, c1h.closes);
  const vol4 = volumeState(c4h.volumes), vol1 = volumeState(c1h.volumes), vol15 = c15 ? volumeState(c15.volumes) : null;
  const volDiv = volDivergence(c4h.closes, c4h.volumes);
  const bb = bb4hRegime(c4h.closes);

  // ── Chop + "extended" guards (2026-07-30) ────────────────────────────────────
  // ranging: ADX below this pair's weak bar → the directional read is mostly noise
  //   (display as RANGE, size down; NOT a hard block — ADX carries no measured
  //   expectancy edge, so it must not veto the tested tier logic).
  // extended: price just ran >1.5×ATR over the last 3×4h bars → entering now is
  //   CHASING. Backtested 2026-07-30 (n=566-1509, non-overlapping): riding a fresh
  //   >1.5×ATR move returns -0.05R/47% and fading it is noise — but sustained runs
  //   CONTINUE, so the right action is WAIT-for-a-pullback, not "trade the other way".
  const weakBar = cal ? cal.adxWeak : 20;
  const ranging = adx != null && adx < weakBar;
  const recentMoveATR = (atr4h && c4h.closes.length >= 4) ? Math.abs(price - c4h.closes[c4h.closes.length - 4]) / atr4h : 0;
  const extended = recentMoveATR > 1.5;

  const nearRes = sr.resistance[0] && Math.abs(price - sr.resistance[0].level) / price < 0.005;
  const nearSup = sr.support[0] && Math.abs(price - sr.support[0].level) / price < 0.005;
  const pat4 = detectPatterns(buildCandles(c4h.opens, c4h.highs, c4h.lows, c4h.closes), { tf: "4h", atResistance: nearRes, atSupport: nearSup });
  const pat1 = detectPatterns(buildCandles(c1h.opens, c1h.highs, c1h.lows, c1h.closes), { tf: "1h", atResistance: nearRes, atSupport: nearSup });
  const pat15 = c15 ? detectPatterns(buildCandles(c15.opens, c15.highs, c15.lows, c15.closes), { tf: "15m" }) : [];

  const allPats = [...pat4, ...pat1];
  const bullP = allPats.filter(p => p.dir === "bullish").length;
  const bearP = allPats.filter(p => p.dir === "bearish").length;
  const patternBias = bullP > bearP ? "bullish" : bearP > bullP ? "bearish" : "neutral";
  // strongest pattern at a key level for the alert card
  const keyPattern = allPats.find(p => (p.dir === "bullish" && nearSup) || (p.dir === "bearish" && nearRes)) || allPats[0] || null;

  const mtfAligned = t4 === t1 && t1 !== "FLAT";
  const mtfConflict = t4 !== "FLAT" && t1 !== "FLAT" && t4 !== t1;                 // 4h vs 1h disagree
  const allDisagree = t4 !== t1 && t1 !== t15 && t4 !== t15;                        // all 3 different = chop
  const overall = t4 === t1 ? t4 : "WAIT";
  // ── HIGHER-TIMEFRAME TIER — the largest measured accuracy factor ──────────────
  // ANCHORED ON THE DAILY, deliberately not a flat count. Measuring each confirmer
  // separately at a fixed target (gold/GBP/BTC, 2600-5400 set-ups each) showed they
  // are nowhere near equal — the 1h carries no information at all:
  //     confirmer   Δ expectancy vs not-confirming        significance
  //     1h          +0.033 / +0.006 / -0.019 R           p=0.38 / 0.87 / 0.45  (none)
  //     weekly      +0.117 / +0.118 / +0.089 R           p<0.001 (real, ~half the daily)
  //     DAILY       +0.221 / +0.238 / +0.322 R           p<0.000001 (dominant)
  // Non-overlapping, pooled: daily-confirms Δ0.255R, p<1e-8.
  // So a flat 3-way count mis-rates two groups badly: "1h+weekly agree, daily does
  // not" scored 2/3 yet wins only 28-45% (expectancy -0.07…-0.30R), while "daily
  // alone" scored 1/3 yet wins 56-62% (+0.07…+0.12R). The tier below fixes that.
  //     tier 0  daily does NOT confirm   35-53% win, -0.10…-0.21R  → LOW / lean WAIT
  //     tier 1  daily only               56-62% win, +0.07…+0.12R  → MEDIUM
  //     tier 2  daily + 1h or weekly     55-60% win, +0.06…+0.11R  → MEDIUM
  //     tier 3  daily + both             58-62% win, +0.11…+0.17R  → HIGH allowed
  const dailyConfirms = htfOK && t4 !== "FLAT" && tD === t4;
  const htfTier = (!htfOK || t4 === "FLAT") ? null
    : dailyConfirms ? 1 + (t1 === t4 ? 1 : 0) + (tW === t4 ? 1 : 0) : 0;
  const dailyAligned = mtfAligned && tD === t4;
  const dailyConflict = mtfAligned && tD !== "FLAT" && tD !== t4;
  const sigOf = t => t === "BULL" ? "LONG" : t === "BEAR" ? "SHORT" : "—";

  // ── RANGE-FADE regime (Gold + GBP only; opt-in via rangeFadeEnabled) ──────────
  // The ONLY logic path in this engine that can oppose the 4h trend. Activates ONLY
  // when the EXACT conditions validated in the regime audit are all met — otherwise
  // this stays null and every downstream consumer behaves exactly as before:
  //   1. ADX(4h) strictly BELOW this pair's own weak bar (gold <20, GBP <18)
  //   2. the DAILY trend does NOT confirm the 4h (tD !== t4) — i.e. no daily trend
  //   3. the 4h itself is not flat (a real, if weak, directional read exists)
  //   4. price is stretched ≥0.30×ATR from the 20-period mean (room to revert)
  // Measured (non-overlapping, paired): fading toward the BB mid here returns
  // +0.13R/signal at 72-77% win (gold p=0.034, GBP p=0.007); CONTINUATION loses
  // -0.2R. The same fade LOSES in trend regime (-0.01/-0.05R) — hence it is gated to
  // this regime only, never applied generally. Target is the BB mid, hard-capped at
  // 1.0R (a small-win / occasional-full-loss profile — deliberately NOT widened).
  // Borderline setups fall through to null => normal trend-following logic (spec §2).
  let rangeFade = null, regimeLabel = null;
  if (rangeFadeEnabled) {
    const weakBar = cal ? cal.adxWeak : 20;
    const dev = (bb && bb.mid != null) ? price - bb.mid : null;
    const inRange = adx != null && adx < weakBar && t4 !== "FLAT" && tD !== t4
      && dev != null && Math.abs(dev) >= 0.30 * atr4h;
    if (inRange) {
      const d = dev > 0 ? -1 : 1;                                   // fade TOWARD the mean
      const risk = 1.5 * atr4h;
      const targetDist = Math.min(Math.abs(dev), risk);            // BB mid, hard-capped at 1.0R
      rangeFade = {
        active: true, dir: d > 0 ? "LONG" : "SHORT", bbMid: bb.mid,
        target: price + d * targetDist, stop: price - d * risk,
        devATR: +(Math.abs(dev) / atr4h).toFixed(2), targetR: +(targetDist / risk).toFixed(2),
      };
      regimeLabel = "RANGE";
    } else {
      regimeLabel = (dailyConfirms && adx != null && adx > (cal ? cal.adxStrong : 25)) ? "TREND" : "NORMAL";
    }
  }

  // ── REVERSAL-FADE (BTC only; opt-in via revFadeEnabled) ──────────────────────
  // Turns the "LOW + FULL REVERSAL" no-trade into a tradeable fade. Fires ONLY when:
  //   1. the daily does NOT confirm the 4h (tD !== t4) — i.e. a LOW / tier-0 setup
  //   2. the 4h is not flat
  //   3. the 1h pullback has SEVERELY or FULLY reversed the swing that AGREES with
  //      the 4h trend (state SEVERE/FULL REVERSAL, dir matching the trend side) —
  //      i.e. the move in the trend direction has been reversed against the trade
  // Then FADE the 4h trend (take the opposite side). Measured (non-overlapping):
  // the trend trade here LOSES; the fade returns +0.25R at 63% win on BTC
  // (p=0.001, both period halves +0.22R/+0.29R). Gold/GBP did NOT clear the bar, so
  // this is BTC-only. Target 1.0R, stop 1.5xATR. Distinct from range-fade (≈20% overlap).
  let revFade = null;
  if (revFadeEnabled && pull && t4 !== "FLAT" && !dailyConfirms) {
    const sev = pull.state === "SEVERE" || pull.state === "FULL REVERSAL";
    const against = (t4 === "BULL" && pull.dir === "up") || (t4 === "BEAR" && pull.dir === "down");
    if (sev && against) {
      const d = t4 === "BULL" ? -1 : 1;                      // fade OPPOSITE the 4h trend
      const risk = 1.5 * atr4h;
      revFade = {
        active: true, dir: d > 0 ? "LONG" : "SHORT", pullState: pull.state, pullPct: Math.round(pull.pct),
        target: price + d * 1.0 * risk, stop: price - d * risk, targetR: 1.0,
      };
      regimeLabel = "REVERSAL";
    } else if (regimeLabel == null) {
      regimeLabel = "NORMAL";
    }
  }

  // trend-context (weighted inputs for the AI)
  const adxBars = cal ? { weak: cal.adxWeak, strong: cal.adxStrong } : { weak: 20, strong: 25 };
  const adxPrevR = calcADX(c4h.highs.slice(0, -3), c4h.lows.slice(0, -3), c4h.closes.slice(0, -3), 14);
  const strength = trendStrength(adx, adxPrevR ? adxPrevR.adx : null, c4h.closes, adxBars);
  const vmeter = volMeter(c4h.highs, c4h.lows, c4h.closes);
  const flip = flipCheck(c4h, sr, atr4h);
  const structure = priceStructure(c4h.highs.slice(-60), c4h.lows.slice(-60));
  const divergence = detectDivergence(c4h.highs.slice(-40), c4h.lows.slice(-40), c4h.closes.slice(-40));
  const sBias = sessionBias(c1h, price);
  const pdBias = prevClose == null ? { bias: "unknown", prevClose: null } : { bias: price > prevClose ? "bullish" : price < prevClose ? "bearish" : "neutral", prevClose };

  const mtf = {
    rows: [
      { tf: "1W", trend: tW, candle: "—", volume: "—", signal: sigOf(tW) },
      { tf: "1D", trend: tD, candle: "—", volume: "—", signal: sigOf(tD) },
      { tf: "4h", trend: t4, candle: pat4[0]?.name || "—", volume: vol4?.cls || "—", signal: sigOf(t4) },
      { tf: "1h", trend: t1, candle: pat1[0]?.name || "—", volume: vol1?.cls || "—", signal: sigOf(t1) },
      // `pull` is derived from the 1h candles (see analyzePullback call above), so it
      // must NOT be rendered on the 15m row — it read as an independent 15m reversal
      // when it was really the 1h pullback. The Pullback Meter card shows it, correctly
      // labelled as 1h. This row now shows the 15m timeframe's own trend signal.
      { tf: "15m", trend: t15, candle: pat15[0]?.name || "—", volume: vol15?.cls || "—", signal: sigOf(t15) },
    ],
    overall: overall === "WAIT" ? "WAIT" : sigOf(overall),
    aligned: mtfAligned,
    dailyAligned, dailyConflict, htfTier,
  };

  const entries = {
    optimal: fib.levels[0.382],
    aggressive: price,
    pattern: keyPattern ? c1h.closes[c1h.closes.length - 1] : null,
    conservative: "wait for 15m close in trend direction",
    recommended: keyPattern && (nearRes || nearSup) ? "Pattern"
      : pull && (pull.state === "SHALLOW" || pull.state === "NORMAL") ? "Optimal (fib 38.2%)"
        : pull && (pull.state === "DEEP" || pull.state === "SEVERE" || pull.state === "FULL REVERSAL") ? "Conservative"
          : "Aggressive",
  };

  return {
    t4, t1, t15, tD, tW, dailyAligned, dailyConflict, dailyConfirms, htfTier, adx, adxClass: adxClass(adx),
    fib, sr, pull, vol4, vol1, vol15, volDiv,
    pat4, pat1, pat15, patternBias, keyPattern, nearRes, nearSup,
    mtf, entries, atr4h, bb,
    mtfConflict, allDisagree,
    strength, structure, divergence, sessionBias: sBias, prevDayBias: pdBias,
    vmeter, flip, rangeFade, revFade, regimeLabel, _cal: adxBars,
    ranging, extended, recentMoveATR,
  };
};

// ─── TRADE / NO-TRADE / WAIT verdict (2026-07-30) ────────────────────────────
// The "profit not quantity" gate. TRADE clears ONLY when every PROVEN filter passes:
//   • daily-anchored tier ≥ 2 (the one measured edge — see backtest notes)
//   • no binary event in the gate window (verified: trading through = coin flip at ~2.5× stop risk)
//   • entry not extended (don't chase — tested 2026-07-30)
//   • confidence ≥ MEDIUM (when a signal is present)
// Everything else is NO-TRADE or WAIT, with the exact failing reason. Ranging (weak
// ADX) does NOT hard-block — it only adds a size-down note. Pass `confidence` from a
// live signal (omit for the free scan, which has no AI call) and `gate` = eventGate().
export const tradeVerdict = (ta, { confidence = null, gate = null } = {}) => {
  const checks = [];
  const push = (k, ok, note) => checks.push({ k, ok, note });
  const adxS = ta && ta.adx != null ? ta.adx.toFixed(0) : "n/a";
  if (gate) return { verdict: "WAIT", headline: gate.phase === "pre" ? "Binary event ahead" : "Post-event chaos", reason: `${gate.event?.label || "high-impact event"} — wait for the window to clear, then re-scan for the post-event trend.`, checks };
  if (!ta || ta.htfTier == null) {
    // htfTier is null in TWO distinct cases — the message must say which:
    //   • the 4h trend is FLAT (data fine, just no trend to grade) → WAIT, re-scan won't help
    //   • daily candles didn't load (htfOK false) → NO-TRADE, likely the data API's per-minute limit
    if (ta && ta.t4 === "FLAT") { push("4h trend", false, "FLAT — no trend to grade"); return { verdict: "WAIT", headline: "No 4h trend", reason: "The 4h trend is FLAT — price is ranging inside its band, so there is no directional set-up to grade. Wait for the 4h to pick a direction (re-scanning won't change this).", checks }; }
    // Daily candles didn't load — this is a DATA failure, NOT a trade verdict. Nothing
    // was analysed, so it must not read as a red "NO-TRADE" (which means "analysed, skip").
    return { verdict: "DATA ERROR", headline: "Couldn't load candle data", reason: "The price-data provider didn't return the daily candles — usually a per-minute API-limit hit. The tier couldn't be computed, so there's nothing to grade. This is a data hiccup, NOT a trade decision — wait ~60s and re-scan.", checks: [] };
  }
  const tierOK = ta.htfTier >= 2;
  push("Tier ≥ 2", tierOK, `tier ${ta.htfTier}/3${tierOK ? " — daily-confirmed trend" : ta.htfTier === 0 ? " — daily dissents (negative expectancy)" : " — daily only (marginal)"}`);
  // Confidence sets SIZE, not a veto: the tier is the proven edge (55-62% win at
  // tier 2-3, independent of the AI's confidence — which is unproven as a win-rate
  // predictor). A clean tier-2+ therefore trades regardless of confidence; LOW just
  // trades SMALLER. (User choice 2026-07-30: "confidence → size", tier 1 still skipped.)
  const confU = confidence == null ? null : String(confidence).toUpperCase();
  const conviction = (confU === "HIGH" || confU === "VERY HIGH") ? "high" : confU === "LOW" ? "low" : "normal";
  push("Not chasing", !ta.extended, ta.extended ? `extended ${ta.recentMoveATR.toFixed(1)}×ATR — wait for a pullback` : "entry not extended");
  push("Trend present", !ta.ranging, ta.ranging ? `ADX ${adxS} — ranging` : `ADX ${adxS}`);
  if (!tierOK) return { verdict: "NO-TRADE", headline: "Below quality bar", reason: ta.htfTier === 0 ? "Tier 0 — the daily does not confirm the 4h. Negative expectancy. Hold out for a tier-2+ setup." : "Tier 1 — only the daily confirms (1h & weekly dissent). Marginal; wait for tier 2+.", checks };
  if (ta.extended) return { verdict: "WAIT", headline: "Extended — don't chase", reason: `Price ran ${ta.recentMoveATR.toFixed(1)}×ATR in the last ~12h. Entering here is chasing (tested: −0.05R). Wait for a pullback to the level, then take it.`, checks };
  // Size: LOW confidence → half, ranging → ×0.75; MEDIUM+ non-ranging → full.
  let sizeMult = conviction === "low" ? 0.5 : 1.0;
  if (ta.ranging) sizeMult = Math.round(sizeMult * 0.75 * 100) / 100;
  if (confidence != null) push("Confidence → size", true, `${confU} → ${sizeMult < 1 ? Math.round(sizeMult * 100) + "% size" : "full size"}`);
  const bits = []; if (conviction === "low") bits.push("LOW confidence"); if (ta.ranging) bits.push("ranging");
  const sizeTxt = sizeMult < 1 ? ` ${bits.join(" + ")} → trade at ${Math.round(sizeMult * 100)}% size.` : "";
  const headline = conviction === "low" ? `Tradeable · tier ${ta.htfTier}/3 · low conviction` : `Quality setup · tier ${ta.htfTier}/3`;
  return { verdict: "TRADE", headline, reason: `Daily-confirmed, entry not extended.${sizeTxt}`, conviction, sizeMult, checks };
};

// ─── signal-quality score 0–100 (scorecard PASSes + local bonuses) ──────────
// `scoredKeys` = the asset's actual scorecard rows. Anything outside that set
// (e.g. a demoted item like COT/dominance the model emitted anyway) is IGNORED —
// otherwise a stray PASS would inflate the score by 10 each and could flip a
// forced-WAIT into a tradeable signal.
export const signalQuality = (parsed, ta, scoredKeys) => {
  const sc = parsed.scorecard || {};
  const allow = (scoredKeys && scoredKeys.length) ? new Set(scoredKeys) : null;
  let pts = 0;
  Object.entries(sc).forEach(([k, it]) => {
    if (allow && !allow.has(k)) return;
    if (it && (it.r === "PASS" || it.r === "BULLISH")) pts += 10;
  });
  let bonus = 0;
  if (ta.keyPattern && (ta.nearRes || ta.nearSup)) bonus += 15;
  if (ta.mtf.aligned) bonus += 10;
  // Higher-timeframe tier (see analyzeTimeframes) — daily-anchored, so tier 1
  // ("daily alone") already earns points while a set-up where the daily dissents
  // earns none no matter how many lower timeframes agree.
  // NOTE this only ADDS points to confirmed set-ups; it never subtracts, so no
  // signal that previously cleared the WAIT bar can be newly blocked by it. The
  // de-rating of unconfirmed set-ups happens via the confidence cap, not the score.
  if (ta.htfTier === 3) bonus += 10;
  else if (ta.htfTier === 2 || ta.htfTier === 1) bonus += 5;
  if (ta.vol4 && ta.vol4.cls === "HIGH") bonus += 5;
  if (ta.adx != null && ta.adx > (ta._cal?.strong ?? 25)) bonus += 5; // per-asset strong-trend bar
  if (ta.divergence && ta.divergence.type !== "none") bonus += 5; // momentum divergence confirmation
  const score = Math.min(100, pts + bonus);
  const label = score < 35 ? "WAIT" : score < 50 ? "LOW" : score < 70 ? "MEDIUM" : score < 85 ? "HIGH" : "VERY HIGH";
  // Split reported separately: `pts` is EVIDENCE (scorecard rows the model actually
  // confirmed from news/macro/price) and `bonus` is STRUCTURE (locally-computed
  // alignment). Bonuses can reach 45 of 100, so a structurally tidy set-up with
  // almost no confirming evidence can still score in the MEDIUM band — which reads
  // as more confident than it is. Surfacing the split stops the number flattering
  // thin set-ups. (evidence + structure may exceed `score`, which is capped at 100.)
  return { score, label, evidence: pts, structure: bonus };
};

// ─── Local WAIT when 4h/1h conflict — synthesised without an AI call (saves $) ─
export const localWait = (ta, price, decimals) => {
  const f = v => (v == null) ? "n/a" : v.toFixed(decimals);
  const now = new Date();
  const nh = (Math.floor(now.getUTCHours() / 4) + 1) * 4;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  d.setUTCHours(nh);
  const c4 = `${String(d.getUTCHours() % 24).padStart(2, "0")}:00 UTC`;
  const res = ta.sr?.resistance?.[0]?.level, sup = ta.sr?.support?.[0]?.level;
  return {
    action: "WAIT", price: String(price), confidence: "LOW", wait_type: "low_confidence",
    reasoning: `4h trend is ${ta.t4} but 1h is ${ta.t1} — the master timeframes conflict, so the local MTF rule forces WAIT (full AI analysis skipped to save cost).`,
    scorecard: {}, exits: [], sources: [], news_hl: "Local WAIT — 4h/1h conflict (no AI call)", news_sent: "NEUTRAL", binary_event: "none",
    data_note: "4h/1h conflict — analysis skipped to save API cost",
    triggers: {
      watch_long: sup ? f(sup) : "n/a", watch_long_note: "nearest 4h support — a LONG needs price here with 1h flipping to match 4h",
      watch_short: res ? f(res) : "n/a", watch_short_note: "nearest 4h resistance — a SHORT needs rejection here with 1h flipping bearish",
      invalidation: "n/a", invalidation_note: "",
      next_session: "", next_session_note: "",
      news_time: "none", news_event: "none",
      candle_close: c4, candle_close_note: "4h close may resolve the 4h/1h conflict",
      mtf_fix: `4h (${ta.t4}) and 1h (${ta.t1}) must align in the same direction`,
      pattern_needed: "a clean trend candle on 1h in the 4h direction",
      indicator_needed: `1h trend to flip to ${ta.t4}`,
      primary_reason: "4h and 1h timeframes conflict", secondary_reason: "none",
      estimated_clarity: `after the ${c4} 4h candle close`,
      refresh_recommendation: `Refresh at ${c4} (next 4h close), or sooner if the 1h trend flips to ${ta.t4}`,
    },
  };
};

// ─── prompt block: hand the AI everything we computed (it must not re-derive) ─
export const taPromptBlock = (ta, f) => {
  const fl = ta.fib.levels;
  const res = ta.sr.resistance.map(r => `${f(r.level)}(${r.touches}x)`).join(", ") || "none";
  const sup = ta.sr.support.map(r => `${f(r.level)}(${r.touches}x)`).join(", ") || "none";
  const pats = (lbl, arr) => arr.length ? `${lbl}: ${arr.map(p => `${p.name}[${p.dir}]`).join(", ")}` : `${lbl}: none`;
  const st = ta.structure, sb = ta.sessionBias, pd = ta.prevDayBias;
  const nowUTC = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return `CURRENT TIME: ${nowUTC} — judge every event you find in news against THIS timestamp. An event whose scheduled time is BEFORE now is ALREADY RELEASED: its outcome is priced in, so do NOT cap quality or "reduce size" for it, and do NOT build a trade that fades the post-event spike or infers direction from the headline (backtested: riding OR fading a post-event move is a losing coin flip, −0.05R / 47% win). Only a FUTURE event within 24h triggers the WAIT rules.

TRADE-SELECTION MANDATE — the user wants PROFIT, not trade count. DEFAULT TO WAIT. Only give a directional call for a genuine quality set-up: tier ≥ 2 (daily-confirmed), not chasing an extended move, and a real catalyst or clean structure supports the direction. When in doubt, WAIT — a missed trade costs nothing; a forced low-quality trade loses money.${ta.extended ? `\n⚠ EXTENDED: price ran ${ta.recentMoveATR.toFixed(1)}×ATR in the last ~12h — entering now is CHASING (tested −0.05R). Prefer WAIT-for-pullback; if you still signal, the entry must be a pullback level, not current price.` : ""}${ta.ranging ? `\n⚠ RANGING: ADX ${ta.adx != null ? ta.adx.toFixed(0) : "n/a"} is below this pair's weak bar — weak trend / chop. Size down; do not dress a weak range up as a strong trend.` : ""}

MULTI-TIMEFRAME (computed locally — prefer trading WITH the 4h trend; if 4h≠1h cap confidence at LOW, do NOT auto-WAIT; only WAIT if all three timeframes disagree)
  WEEKLY trend: ${ta.tW} | DAILY trend: ${ta.tD} | 4h trend: ${ta.t4} | 1h trend: ${ta.t1} | 15m trend: ${ta.t15} | OVERALL: ${ta.mtf.overall}${ta.mtf.aligned ? " (ALIGNED)" : ta.mtfConflict ? " (4h/1h CONFLICT — counter-trend risk, LOW confidence)" : " (mixed)"}${ta.allDisagree ? " — ALL THREE DISAGREE (chop → WAIT)" : ""}
  HIGHER-TIMEFRAME TIER ★★ ${ta.htfTier == null ? "unavailable (no daily candles) — ignore this rule" : `tier ${ta.htfTier}/3 — the DAILY ${ta.dailyConfirms ? "CONFIRMS" : "does NOT confirm"} the 4h ${ta.t4} direction${ta.dailyConfirms ? `, and ${ta.htfTier - 1} of {1h, weekly} also agree` : ""}.
  This is the STRONGEST measured predictor in this engine, and the DAILY carries almost all of it. Measured separately at a fixed target: the daily is worth +0.22/+0.24/+0.32R (p<0.000001 on gold/GBP/BTC), the weekly about half that, and the 1h NOTHING (p=0.38/0.87/0.45). So a set-up where the 1h and weekly agree but the DAILY dissents is a BAD set-up (28-45% win) even though two timeframes "agree" — do not be fooled by the count.
  Backtested by tier: 0 = 35-53% win / negative expectancy · 1 = 56-62% · 2 = 55-60% · 3 = 58-62%.
  RULE: tier 3 → HIGH confidence justified if the scorecard agrees. tier 1-2 → cap at MEDIUM. tier 0 → cap at LOW and lean WAIT unless there is a strong explicit catalyst. This signal: tier ${ta.htfTier} → ${ta.htfTier === 3 ? "HIGH allowed" : ta.htfTier >= 1 ? "cap at MEDIUM" : "cap at LOW / lean WAIT"}.
  ★ TARGETS: ${ta.htfTier >= 1 ? "set T1 = 1.0R (= 1.5x ATR from entry) and T2 = 2.0R (= 3.0x ATR). Measured T1 hit rate at this tier is 56-62%; stretching T1 to 1.5R drops it to 40-49%." : "set T1 = 0.75R (= 1.125x ATR from entry) and T2 = 1.5R (= 2.25x ATR) — but note this tier loses money on average at ANY target, so a closer target is not a fix. Prefer WAIT."}`}${ta.dailyConflict ? `\n  ⚠ DAILY CONFLICT — the daily trend (${ta.tD}) directly OPPOSES the aligned 4h/1h direction. State this in the reasoning.` : ""}${ta.rangeFade && ta.rangeFade.active ? `

  ⇄⇄ RANGE-FADE REGIME (Gold/GBP only — the one tested exception to "trade with the trend") ⇄⇄
  CATALYST CHECK FIRST — this bias is SUBORDINATE to every WAIT/news rule. If a binary event is within 24h, OR your news search finds a real directional catalyst (surprise data, central-bank headline, geopolitical shock), OR any WAIT rule already applies → OUTPUT WAIT (or follow the catalyst) and IGNORE this fade entirely. Only read on if the tape is genuinely quiet.
  Regime conditions are met: ADX ${ta.adx != null ? ta.adx.toFixed(1) : "n/a"} is below this pair's weak bar (ranging), the daily does NOT confirm the 4h, and price is ${ta.rangeFade.devATR}xATR above/below the 20-period mean (BB mid ${f(ta.rangeFade.bbMid)}).
  In THIS regime the tested edge REVERSES the usual rule: FADE toward the mean, do NOT follow the 4h ${ta.t4} trend. Continuation here is measured to LOSE (~-0.2R, 37% win). The fade returns +0.13R at 72-77% win (non-overlapping, p<0.05, gold & GBP). This is a small-win / occasional-full-loss profile.
  → PREFERRED (only if no catalyst): action ${ta.rangeFade.dir} (a mean-reversion fade, AGAINST the 4h trend by design). Entry at price. Stop ${f(ta.rangeFade.stop)} (1.5xATR on the far side). T1 = ${f(ta.rangeFade.target)} (the BB mid — a ${ta.rangeFade.targetR}R SUB-1R target; do NOT widen it and do NOT set a T2 beyond the mean; the edge is in the small, reliable reversion). Confidence stays LOW (this is tier 0 and a small edge) — state clearly that this is a range-fade against the trend. If anything is ambiguous, WAIT.` : ""}${ta.revFade && ta.revFade.active ? `

  ⇄⇄ REVERSAL-FADE SETUP (BTC only — turns a LOW + full-reversal no-trade into a tradeable fade) ⇄⇄
  CATALYST CHECK FIRST — SUBORDINATE to every WAIT/news rule. If a binary event is within 24h, OR the news search finds a real directional catalyst, OR any WAIT rule applies → OUTPUT WAIT and IGNORE this fade. Only read on if the tape is quiet.
  Conditions are met: the daily does NOT confirm the 4h ${ta.t4}, AND the 1h has ${ta.revFade.pullState} (${ta.revFade.pullPct}% retraced) — the move in the trend direction has REVERSED against it. Backtested: continuing WITH the 4h trend here LOSES; FADING it returns +0.25R at 63% win (BTC, non-overlapping, p=0.001, stable across both test halves).
  → PREFERRED (only if no catalyst): action ${ta.revFade.dir} — FADE the 4h ${ta.t4} trend (take the opposite side; the fresh reversal has momentum). Entry at price. Stop ${f(ta.revFade.stop)} (1.5xATR). T1 = ${f(ta.revFade.target)} (${ta.revFade.targetR}R — a fair, tested target; do NOT widen it). Confidence stays LOW (tier 0, modest edge) — state clearly this is a reversal-fade against the trend. If anything is ambiguous, WAIT.` : ""}
  ADX(4h): ${ta.adx != null ? ta.adx.toFixed(1) : "n/a"} → ${ta.adxClass} trend (calibrated for THIS pair: <${ta._cal?.weak ?? 20} weak, ${ta._cal?.weak ?? 20}-${ta._cal?.strong ?? 25} developing, >${ta._cal?.strong ?? 25} strong)
  Volatility Meter (4h): ${ta.vmeter ? `${ta.vmeter.pct}% of this asset's normal → ${ta.vmeter.level}` : "n/a"}
  LEVEL FLIP: ${ta.flip && ta.flip.status !== "none" ? `${ta.flip.status.toUpperCase()} — ${ta.flip.dir}-break of ${f(ta.flip.level)}${ta.flip.note ? " (" + ta.flip.note + ")" : ""}. RULE: on a PENDING flip do NOT give a full-confidence breakout — cap at LOW and mark it pending; on a FALSE_BREAK treat the breakout as failed (lean the other way or WAIT); only a CONFIRMED flip supports a normal-confidence breakout trade.` : "no unconfirmed level break"}

TREND CONTEXT (weighted inputs — improve direction accuracy, not hard rules)
  Trend strength: ${ta.strength.label} — ${ta.strength.note}
  Price structure (4h): ${st.structure} | recent highs ${st.highs.map(f).join(", ") || "n/a"} | recent lows ${st.lows.map(f).join(", ") || "n/a"}
  Momentum divergence: ${ta.divergence.type.toUpperCase()} — ${ta.divergence.note}
  Session bias: ${sb.bias} (price ${sb.pct}% up the session range)
  Previous-day bias: ${pd.bias}${pd.prevClose != null ? ` (prev close ${f(pd.prevClose)})` : ""}
  → In a STRONG trend weight trend-following; in a RANGING market weight mean-reversion (fade extremes); when TRANSITIONING wait for breakout confirmation.

CANDLE PATTERNS (last 3 candles)
  ${pats("4h", ta.pat4)}
  ${pats("1h", ta.pat1)}
  pattern bias: ${ta.patternBias}${ta.keyPattern ? ` | KEY: ${ta.keyPattern.name} on ${ta.keyPattern.tf} at ${ta.nearRes ? "resistance" : ta.nearSup ? "support" : "level"}` : ""}

VOLUME (current vs 20-avg)  4h:${ta.vol4 ? ta.vol4.cls + " " + ta.vol4.ratio.toFixed(2) + "x" : "n/a"} | 1h:${ta.vol1 ? ta.vol1.cls + " " + ta.vol1.ratio.toFixed(2) + "x" : "n/a"}${ta.volDiv ? `\n  ⚠ ${ta.volDiv}` : ""}
${ta.bb ? `
BOLLINGER (4h, 20/2)  upper:${f(ta.bb.upper)} | mid:${f(ta.bb.mid)} | lower:${f(ta.bb.lower)} | width ${ta.bb.width.toFixed(2)}% vs ${ta.bb.avgWidth.toFixed(2)}% avg → ${ta.bb.regime}
  price at ${ta.bb.position} band. Rules: SQUEEZE = breakout imminent, wait for direction; at UPPER + bearish signal = strong SHORT confirmation; at LOWER + bullish signal = strong LONG confirmation; WIDE bands = trending — trust trend-following over mean-reversion.` : ""}

FIBONACCI (from 4h swing, last 50)  High:${f(ta.fib.high)} Low:${f(ta.fib.low)}
  23.6%:${f(fl[0.236])} | 38.2%:${f(fl[0.382])}★ | 50%:${f(fl[0.5])} | 61.8%:${f(fl[0.618])}★ | 78.6%:${f(fl[0.786])}
  price ${ta.fib.position}${ta.fib.atLevel ? ` — AT ${ta.fib.atLevel}` : ""}

PULLBACK (1h, tiered zones)  ${ta.pull ? `${ta.pull.pct.toFixed(0)}% retraced → ${ta.pull.state} (${ta.pull.dir}-move). Bands: 0-23.6 SHALLOW(hold), 23.6-38.2 NORMAL, 38.2-50 MODERATE, 50-61.8 DEEP(reversal risk), 61.8-100 SEVERE(likely reversal/exit), >100 FULL REVERSAL(trend broken)` : "no clear swing"}

AUTO SUPPORT/RESISTANCE (4h swings, touch-ranked)
  resistance: ${res}
  support: ${sup}${ta.sr.near ? `\n  ⚠ price within 0.5% of ${f(ta.sr.near)}` : ""}

SCORE THE TWO NEW SCORECARD ROWS:
  "candles" = PASS if a pattern supports the trade direction (ideally at a key level), FAIL if a pattern opposes it, else NEUTRAL.
  "mtf" = PASS if 4h+1h agree (aligned), FAIL if they conflict, NEUTRAL if a timeframe is flat.`;
};
