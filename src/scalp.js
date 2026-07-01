// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL DECK — EUR/USD SCALP engine (1m/5m/15m). All computed locally from
// real candles; the AI only does a fast news/spread check. Targets 10–50 pip
// intraday moves. Swing mode is untouched — this is an addition.
// ═══════════════════════════════════════════════════════════════════════════
import { calcEMA, calcEMAlast, calcRSI, calcATR, calcPivots } from "./shared";

export const PIP = 0.0001;
export const EUR_PIP_001 = 0.09;  // € per pip at 0.01 lots
export const EUR_PIP_005 = 0.45;  // € per pip at 0.05 lots
export const eur001 = pips => (pips * EUR_PIP_001).toFixed(2);
export const eur005 = pips => (pips * EUR_PIP_005).toFixed(2);

// ─── fast indicators ─────────────────────────────────────────────────────────
// MACD with custom periods (scalp uses 5/13/4 instead of 12/26/9)
export const macdCustom = (closes, f = 5, s = 13, sg = 4) => {
  const ef = calcEMA(closes, f), es = calcEMA(closes, s);
  const ml = ef.map((v, i) => (v != null && es[i] != null) ? v - es[i] : null).filter(v => v != null);
  if (ml.length < sg + 1) return null;
  const sig = calcEMA(ml, sg);
  const last = ml.at(-1), s9 = sig.at(-1), prev = ml.at(-2), ps = sig.at(-2);
  const hist = last - s9, prevH = prev - ps;
  return { macd: last, signal: s9, histogram: hist, bullish: hist > 0, expanding: Math.abs(hist) > Math.abs(prevH) };
};

// Bollinger Bands (20, 2)
export const bollinger = (closes, period = 20, sd = 2) => {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mid + sd * std, lower = mid - sd * std;
  const price = closes.at(-1);
  return { mid, upper, lower, width: (upper - lower) / mid * 100, position: price >= upper ? "UPPER" : price <= lower ? "LOWER" : "MIDDLE" };
};

// Stochastic (kPeriod, kSmooth, dPeriod)
export const stochastic = (highs, lows, closes, kP = 5, kS = 3, dP = 3) => {
  if (closes.length < kP + kS + dP) return null;
  const rawK = [];
  for (let i = kP - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kP + 1, i + 1)), ll = Math.min(...lows.slice(i - kP + 1, i + 1));
    rawK.push(hh === ll ? 50 : 100 * (closes[i] - ll) / (hh - ll));
  }
  const sma = (arr, p) => { const o = []; for (let i = p - 1; i < arr.length; i++) o.push(arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p); return o; };
  const k = sma(rawK, kS), d = sma(k, dP);
  const K = k.at(-1), D = d.at(-1), Kp = k.at(-2), Dp = d.at(-2);
  return { K, D, crossUp: Kp <= Dp && K > D, crossDown: Kp >= Dp && K < D };
};

const volState = volumes => {
  if (!volumes || volumes.length < 21 || volumes.every(v => !v)) return null;
  const avg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20, cur = volumes.at(-1);
  if (!avg) return null;
  const ratio = cur / avg;
  return { ratio, cls: ratio > 1.5 ? "HIGH" : ratio < 0.8 ? "LOW" : "NORMAL" };
};

// previous-day pivots derived from 1h candles (no daily fetch needed)
const prevDayPivots = c1h => {
  if (!c1h?.times) return null;
  const byDay = {};
  c1h.times.forEach((t, i) => { const d = String(t).slice(0, 10); (byDay[d] ||= []).push(i); });
  const days = Object.keys(byDay).sort();
  if (days.length < 2) return null;
  const prev = byDay[days[days.length - 2]];
  const H = Math.max(...prev.map(i => c1h.highs[i])), L = Math.min(...prev.map(i => c1h.lows[i])), C = c1h.closes[prev[prev.length - 1]];
  return calcPivots(H, L, C);
};

const asianRange = c1h => {
  if (!c1h?.times) return { high: null, low: null };
  const rows = c1h.times.map((t, i) => ({ hr: +(String(t).slice(11, 13)), day: String(t).slice(0, 10), h: c1h.highs[i], l: c1h.lows[i] })).filter(r => r.hr >= 0 && r.hr < 8);
  if (!rows.length) return { high: null, low: null };
  const d0 = rows.at(-1).day, a = rows.filter(r => r.day === d0);
  return { high: Math.max(...a.map(r => r.h)), low: Math.min(...a.map(r => r.l)) };
};

const nearestPivot = (price, pv) => {
  if (!pv) return "NONE";
  const cand = [["R2", pv.R2], ["R1", pv.R1], ["P", pv.P], ["S1", pv.S1], ["S2", pv.S2]];
  let best = null;
  cand.forEach(([n, v]) => { const d = Math.abs(price - v); if (best === null || d < best.d) best = { n, d }; });
  return best && best.d <= 4 * PIP ? best.n : "NONE";
};

// ─── scalp aggregator ────────────────────────────────────────────────────────
export const analyzeScalp = ({ c1m, c5m, c15m, c1h, price }) => {
  const o = {};
  const e8 = calcEMA(c5m.closes, 8), e21 = calcEMA(c5m.closes, 21);
  o.ema8 = e8.at(-1); o.ema21 = e21.at(-1);
  o.ema8above21 = o.ema8 > o.ema21;
  o.emaCrossUp = e8.at(-2) <= e21.at(-2) && o.ema8 > o.ema21;
  o.emaCrossDown = e8.at(-2) >= e21.at(-2) && o.ema8 < o.ema21;
  o.ema50_15m = calcEMAlast(c15m.closes, 50);
  o.aboveEma50_15m = o.ema50_15m != null ? price > o.ema50_15m : null;
  o.ema50_1h = calcEMAlast(c1h.closes, 50);
  o.aboveEma50_1h = o.ema50_1h != null ? price > o.ema50_1h : null;
  o.rsi7 = calcRSI(c5m.closes, 7);
  o.rsiRising = o.rsi7 > calcRSI(c5m.closes.slice(0, -1), 7);
  o.macd = macdCustom(c5m.closes, 5, 13, 4);
  o.bb = bollinger(c5m.closes, 20, 2);
  o.atr7 = calcATR(c5m.highs, c5m.lows, c5m.closes, 7);
  o.atrPips = Math.round(o.atr7 / PIP);
  o.stoch = stochastic(c5m.highs, c5m.lows, c5m.closes, 5, 3, 3);
  o.vol = volState(c5m.volumes);
  o.pivots = prevDayPivots(c1h);
  const ar = asianRange(c1h); o.asianHigh = ar.high; o.asianLow = ar.low;
  o.asianPos = (ar.high != null && price > ar.high) ? "ABOVE" : (ar.low != null && price < ar.low) ? "BELOW" : "INSIDE";
  o.emaBias = (price > o.ema8 && price > o.ema21) ? "BULL" : (price < o.ema8 && price < o.ema21) ? "BEAR" : "NEUTRAL";
  o.bbPos = o.bb?.position || "—";
  o.pivotNearest = nearestPivot(price, o.pivots);

  const atResL = o.bb?.position === "LOWER" || ["S1", "S2"].includes(o.pivotNearest);
  const atResH = o.bb?.position === "UPPER" || ["R1", "R2"].includes(o.pivotNearest);
  const longConds = [
    o.aboveEma50_15m === true,
    (price > o.ema8 && price > o.ema21) || o.emaCrossUp,
    o.rsi7 >= 30 && o.rsi7 <= 60 && o.rsiRising,
    !!(o.macd && o.macd.expanding && o.macd.bullish),
    atResL,
    !!(o.stoch && o.stoch.crossUp && o.stoch.K < 40),
  ];
  const shortConds = [
    o.aboveEma50_15m === false,
    (price < o.ema8 && price < o.ema21) || o.emaCrossDown,
    o.rsi7 >= 40 && o.rsi7 <= 70 && !o.rsiRising,
    !!(o.macd && o.macd.expanding && !o.macd.bullish),
    atResH,
    !!(o.stoch && o.stoch.crossDown && o.stoch.K > 60),
  ];
  o.longConds = longConds; o.shortConds = shortConds;
  const longMet = longConds.filter(Boolean).length, shortMet = shortConds.filter(Boolean).length;

  let dir = "WAIT", met = 0, conds = [];
  if (longMet >= 4 && longMet > shortMet) { dir = "LONG"; met = longMet; conds = longConds; }
  else if (shortMet >= 4 && shortMet > longMet) { dir = "SHORT"; met = shortMet; conds = shortConds; }

  // volatility gates
  o.tooQuiet = o.atr7 < 0.0003;
  const rawStop = 1.2 * o.atr7;
  o.tooVolatile = rawStop > 20 * PIP;
  const stopDist = Math.max(8 * PIP, Math.min(20 * PIP, rawStop));
  o.stopPips = Math.round(stopDist / PIP);

  if (dir !== "WAIT" && !o.tooQuiet && !o.tooVolatile) {
    const entry = price;
    o.entry = entry;
    o.stop = dir === "LONG" ? entry - stopDist : entry + stopDist;
    o.t1 = dir === "LONG" ? entry + 1.5 * stopDist : entry - 1.5 * stopDist;
    o.t2 = dir === "LONG" ? entry + 2.5 * stopDist : entry - 2.5 * stopDist;
    o.t1Pips = Math.round(1.5 * stopDist / PIP);
    o.t2Pips = Math.round(2.5 * stopDist / PIP);
  } else if (dir !== "WAIT") {
    dir = "WAIT"; // volatility gate failed
  }

  // ─── NOISE FILTERS (additive — adjust quality + build a 0–100 noise score) ──
  const li = c5m.closes.length - 1;
  // 1. body-to-range ratio of the signal candle (5m)
  o.bodyRatio = Math.abs(c5m.closes[li] - c5m.opens[li]) / ((c5m.highs[li] - c5m.lows[li]) || 1e-9);
  o.indecision = o.bodyRatio < 0.5;
  // 2. noise floor — current range vs 50-candle average
  const ranges = [];
  for (let i = Math.max(0, c5m.closes.length - 50); i < c5m.closes.length; i++) ranges.push(c5m.highs[i] - c5m.lows[i]);
  o.avgRange50 = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  o.curRange = c5m.highs[li] - c5m.lows[li];
  o.belowNoiseFloor = o.curRange < 1.3 * o.avgRange50;
  // 3. multi-timeframe volume (5m AND 15m both >120% of their 20-avg)
  o.vol15 = volState(c15m.volumes);
  o.bothVolConfirmed = !!(o.vol && o.vol15 && o.vol.ratio > 1.2 && o.vol15.ratio > 1.2);
  o.volOnly5m = !!(o.vol && o.vol.ratio > 1.2) && !(o.vol15 && o.vol15.ratio > 1.2);
  // 4. two-candle confirmation (current AND previous 5m close beyond EMA21)
  const twoLong = c5m.closes[li] > e21.at(-1) && c5m.closes[li - 1] > e21.at(-2);
  const twoShort = c5m.closes[li] < e21.at(-1) && c5m.closes[li - 1] < e21.at(-2);
  o.twoCandleConfirmed = dir === "LONG" ? twoLong : dir === "SHORT" ? twoShort : false;
  // 5. spread-adjusted minimum move (typical spread ~1.5 pips → need ≥4.5 pips)
  o.moveTooSmall = o.stopPips < 3 * 1.5;
  // 6. candle timing — only fire in the last 2 min of the 5m candle
  const now = new Date();
  o.candleAgeSec = (now.getUTCMinutes() % 5) * 60 + now.getUTCSeconds();
  o.candleSecLeft = 300 - o.candleAgeSec;
  o.candleTooFresh = o.candleAgeSec < 180;

  // hard gates that flip the signal to WAIT
  if (dir !== "WAIT") {
    if (o.candleTooFresh) { dir = "WAIT"; o.gateReason = `Wait for candle to develop — ${Math.floor(o.candleAgeSec / 60)}:${String(o.candleAgeSec % 60).padStart(2, "0")} into 5m candle (act in last 2 min)`; }
    else if (o.moveTooSmall) { dir = "WAIT"; o.gateReason = "Move too small relative to spread — skip"; }
  }

  o.dir = dir; o.met = met; o.conds = conds;

  // quality (base + bonuses + noise penalties)
  let q = met * 12;
  if (dir === "LONG" && o.aboveEma50_15m) q += 10;
  if (dir === "SHORT" && o.aboveEma50_15m === false) q += 10;
  if (o.bothVolConfirmed) q += 8;                                  // full bonus only if BOTH TFs
  if (["R1", "R2", "S1", "S2"].includes(o.pivotNearest)) q += 10;
  if (o.asianPos !== "INSIDE") q += 8;

  // 7. noise score = sum of noise penalties (0 clean → 100 noisy)
  const flags = []; let noise = 0;
  if (o.indecision) { q -= 15; noise += 25; flags.push("Indecision candle — low conviction (body " + (o.bodyRatio * 100).toFixed(0) + "%)"); }
  if (o.belowNoiseFloor) { q -= 10; noise += 20; flags.push("Below noise floor — weak move"); }
  if (o.volOnly5m) { noise += 15; flags.push("Volume only on 5m — possible noise"); }
  if (dir !== "WAIT" && !o.twoCandleConfirmed) { q -= 10; noise += 20; flags.push("Single-candle signal — no 2-candle confirm"); }
  o.noiseScore = Math.max(0, Math.min(100, noise));
  o.noiseLabel = o.noiseScore < 30 ? "Clean move" : o.noiseScore < 60 ? "Moderate noise" : "High noise — low conviction";
  o.noiseFlags = flags;
  o.capLowConf = o.noiseScore > 60;

  o.quality = Math.max(0, Math.min(100, q));
  // softened gate: quality <35 → no tradeable scalp (WAIT); 35-50 fires as LOW
  if (dir !== "WAIT" && o.quality < 35) { dir = "WAIT"; o.gateReason = o.gateReason || `Quality ${o.quality}/100 below 35 — no tradeable scalp`; }
  o.dir = dir;
  o.qLabel = o.quality < 35 ? "NO SCALP" : o.quality < 65 ? "LOW" : o.quality < 80 ? "MEDIUM" : "HIGH";
  o.lotRec = o.quality < 35 ? "—" : o.quality < 65 ? "paper only / min size" : o.quality < 80 ? "0.01–0.02 lots" : "0.03–0.05 lots";
  return o;
};

// Minimal AI prompt — news + spread check only, to keep cost ~€0.08–0.12.
export const SCALP_SYSTEM = `You are a EUR/USD scalp signal engine. All technical data is pre-computed and provided — do not analyse trends, DXY, or yields.
Your job is LIMITED to:
1. Check for any news in the last/next 2 hours that could spike EUR/USD by >20 pips (Fed/ECB speakers, US/EU data).
2. Judge whether the current spread is likely normal for the session.
Be fast and focused. Maximum 2 web searches.
Respond ONLY with this JSON, nothing else:
{"news_risk":"LOW|MEDIUM|HIGH","news_note":"one short line","spread_warning":true|false,"override_wait":true|false,"override_reason":"why, or empty","sources":["url"]}
Set override_wait=true ONLY if there is a HIGH-risk news event within ~2h that makes scalping unsafe right now.`;
