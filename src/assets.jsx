// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL DECK — asset definitions. Each asset is a self-contained engine config:
// its own system prompt, data pipeline, scorecard, levels, panels and risk model.
// Only the selected asset's `pipeline` ever runs.
// ═══════════════════════════════════════════════════════════════════════════
import {
  mono, card, lbl, fmt, p2, p5,
  calcMACD, calcRSI, calcATR, calcSMA, calcVWAP, calcVolRatio, calcEMAlast,
  getFxSession, getCryptoSession, getGbpSession,
  f1, f2, f3, na, rsiLbl, rsiLblGold, volLbl, tdFetch, proxyDataUrl, bumpDaily,
} from "./shared";
import { analyzeTimeframes, signalQuality, taPromptBlock } from "./ta";

// Two scorecard rows shared by every asset (multi-timeframe + candle patterns).
const TA_ROWS = [
  { key:"candles", label:"8. Candle Patterns" },
  { key:"mtf",     label:"9. MTF Alignment (4h/1h/15m)" },
];

const ff = v => (v||v===0) ? v.toFixed(5) : "n/a"; // forex 5-dp formatter

// ─── FREE tier scan (no paid Anthropic call) ─────────────────────────────────
// Fetches only the 3 candle series the higher-timeframe tier needs (1h/4h/1day)
// and runs the SAME analyzeTimeframes() the paid signal uses, so the scanned tier
// EXACTLY matches what the paid signal would compute. Zero AI cost — only ~3 free
// data calls. Used by the free "Scan" button and as the hard tier-2 gate before any
// paid signal. `fetchSeries(interval, size)` is the asset's own candle fetcher;
// `rangeFadeEnabled` matches the asset (gold/GBP true, BTC false). Fails soft:
// returns { ok:false } on any error so a data hiccup never hard-blocks the user.
const runTierScan = async ({ fetchSeries, rangeFadeEnabled, cal, tdCalls = 0 }) => {
  try {
    const [c1h, c4h, c1d] = await Promise.all([fetchSeries("1h"), fetchSeries("4h"), fetchSeries("1day")]);
    if (tdCalls) bumpDaily("td", tdCalls);
    bumpDaily("scans", 1);
    if (!c4h?.closes?.length || !c1h?.closes?.length) return { ok: false, reason: "no candles" };
    const atr4h = calcATR(c4h.highs, c4h.lows, c4h.closes, 14);
    const price = c4h.closes[c4h.closes.length - 1];
    const ta = analyzeTimeframes({
      c15: null, c1h, c4h, c1d, c4hTimes: c4h.times, price, atr4h,
      prevClose: c1d && c1d.closes.length >= 2 ? c1d.closes[c1d.closes.length - 2] : null,
      cal, rangeFadeEnabled,
    });
    return { ok: true, tier: ta.htfTier, regime: ta.regimeLabel, t4: ta.t4, t1: ta.t1, tD: ta.tD, tW: ta.tW, adx: ta.adx, rangeFade: ta.rangeFade, price };
  } catch (e) { return { ok: false, reason: e?.message || "scan failed" }; }
};

// ─── Small shared panel helpers (used inside extraPanels) ─────────────────────
const Stat = ({ title, value, color="#e2e8f0", sub }) => (
  <div style={{marginBottom:8,paddingBottom:8,borderBottom:"1px solid #1e293b"}}>
    <p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>{title}</p>
    <p style={{...mono,fontSize:13,margin:0,color}}>{value}</p>
    {sub && <p style={{fontSize:9,color:"#475569",margin:"2px 0 0"}}>{sub}</p>}
  </div>
);

// Inject locally-computed TA into the parsed signal for the UI, compute the
// 0–100 quality score, and backfill S/R from swing levels if the AI left blanks.
// `scoredKeys` = this asset's scorecard row keys. Passed through so quality and the
// "X/N confirmed" badge are computed ONLY from real scored rows — a demoted item the
// model emits anyway (COT, dominance, …) must not add points.
function mergeTA(p, ta, fnum, scoredKeys) {
  if (!ta) return;
  p._ta = ta;
  const q = signalQuality(p, ta, scoredKeys);
  p.signal_quality = `${q.score}/100`;
  p._quality = q;
  if (scoredKeys && scoredKeys.length) {
    const allow = new Set(scoredKeys);
    p.passes = Object.entries(p.scorecard || {})
      .filter(([k, it]) => allow.has(k) && it && (it.r === "PASS" || it.r === "BULLISH")).length;
  }
  if ((!p.support || p.support === "") && ta.sr.support[0]) p.support = fnum(ta.sr.support[0].level);
  if ((!p.resistance || p.resistance === "") && ta.sr.resistance[0]) p.resistance = fnum(ta.sr.resistance[0].level);
  if (!p.entry_type && ta.entries) p.entry_type = ta.entries.recommended;
  if (ta.bb) { p.bb_upper = fnum(ta.bb.upper); p.bb_lower = fnum(ta.bb.lower); p.bb_regime = ta.bb.regime; }
  if (ta.vmeter) p._vmeter = ta.vmeter;                                  // G3 Volatility Meter (all assets)
  if (ta.flip && ta.flip.status !== "none") p._flip = { ...ta.flip, level: fnum(ta.flip.level) }; // G4 flip status
}

// ════════════════════════════════════════════════════════════════════════════
// ASSET 1 — GOLD (XAU/USD) — 10-step engine with multi-timeframe TA
// ════════════════════════════════════════════════════════════════════════════
const GOLD = {
  id:"gold", name:"SIGNAL DECK GOLD", symbol:"XAU/USD", headerNote:"XAU/USD · 9-Step · Real APIs",
  pricePrefix:"$",
  theme:{ accent:"#ca8a04", accentText:"#fbbf24", panelBg:"#1c1408", panelBorder:"#78350f", loader:"#ca8a04" },
  keyFields:[
    { field:"anthropic", label:"Anthropic API Key", hint:"required — powers the AI signal", ph:"sk-ant-..." },
    { field:"td",        label:"Twelve Data Key",   hint:"MACD, RSI, ATR, VWAP, Volume, 200MA", ph:"a1b2c3d4..." },
    { field:"fred",      label:"FRED API Key",      hint:"real yield + DXY (free, instant)", ph:"abcdef123456..." },
  ],
  session:getFxSession,
  quickPrice: async (keys) => {
    if(keys.td){ try{ const r=await fetch(proxyDataUrl("td", `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${keys.td}`)); const d=await r.json(); if(d.price>100) return {price:p2(d.price),src:"Twelve Data"}; }catch(_){} }
    try{ const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd"); if(r.ok){const d=await r.json();if(d?.["pax-gold"]?.usd>100) return {price:p2(d["pax-gold"].usd),src:"CoinGecko"};} }catch(_){}
    return null;
  },
  // FREE tier scan (no AI). Needs the Twelve Data key (same source as the signal).
  scan: async (keys) => {
    if(!keys.td) return { ok:false, reason:"Twelve Data key needed for the free tier scan" };
    const fetchSeries = async (interval) => {
      const d = await tdFetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${interval==="1day"?210:100}&apikey=${keys.td}`);
      if(d?.status==="error") throw new Error(d.message);
      const v=(d?.values||[]).reverse();
      return { times:v.map(x=>x.datetime), opens:v.map(x=>parseFloat(x.open)), closes:v.map(x=>parseFloat(x.close)), highs:v.map(x=>parseFloat(x.high)), lows:v.map(x=>parseFloat(x.low)), volumes:v.map(x=>parseFloat(x.volume)||0) };
    };
    return runTierScan({ fetchSeries, rangeFadeEnabled:true, tdCalls:3 });
  },
  sessionsGuide:[
    { window:"08:00–10:00 UTC", label:"London Open — high volume, best signals", quality:"best" },
    { window:"13:00–16:00 UTC", label:"EU-US Overlap — peak liquidity", quality:"best" },
    { window:"10:00–13:00 UTC", label:"London Mid — decent", quality:"good" },
    { window:"21:00–08:00 UTC", label:"Asian — thin, choppy for gold", quality:"avoid" },
  ],
  weekendNote:{ title:"Gold — Pepperstone weekend", lines:[
    "Spread widens to $1–3 (vs $0.20–0.30 weekday)","Volume extremely low",
  ], rec:"Do not trade gold weekends. If forced: TP minimum $30, cut size 50%." },
  events:["FOMC","NFP","CPI","PCE","GDP"], eventsNote:"Gold reacts hardest to US rates & inflation prints.",
  riskRules:[
    "Max 1-2% of account at risk per trade","ATR-based stop is pre-calculated — do not widen it",
    "Price already 25%+ toward T1 → skip, wait for pullback","T1 hit → close 50%, move stop to entry immediately",
    "Exit 100% before any FOMC / CPI / NFP / PCE release","COT is context only (no measured predictive edge) — treat extreme crowding as size risk, not a trade signal",
  ],
  // 9-step (was 10): MACD+RSI merged into one momentum slot (0.61 correlated —
  // redundant), COT demoted to context-only (0.02 corr with next-week direction),
  // and the freed slot given to DXY/real-yield MOMENTUM (gold's strongest leading
  // input, +18pp regime edge on the 200MA / macro block).
  scTitle:"9-Step Scorecard", passesOf:9,
  scRows:[
    { key:"price",     label:"1. Price & VWAP" },
    { key:"momentum",  label:"2. Momentum (MACD+RSI+200MA)" },
    { key:"volume",    label:"3. Volume Confirmation" },
    { key:"dxy_yield", label:"4. DXY + Real Yield (level)" },
    { key:"dxy_mom",   label:"5. DXY/Yield Momentum ★" },
    { key:"history",   label:"6. Levels / Context" },
    { key:"news",      label:"7. News / Macro" },
    ...TA_ROWS,
  ],
  readyLines:(k)=>[
    k.td?"✓ Twelve Data (MACD/RSI/ATR/VWAP/Volume/200MA)":"⚠ No Twelve Data — AI inference only",
    (k.fred?"✓ FRED (real yield + DXY)":"⚠ No FRED — web search fallback")+" · COT (CFTC, public) · Web search",
  ],
  levelsTitle:"Key Levels",
  levels:(s)=>[
    { name:"24h High",   val:`$${fmt(s.high_24h)}` },
    { name:"24h Low",    val:`$${fmt(s.low_24h)}` },
    { name:"PDH",        val:`$${fmt(s.pdh)}` },
    { name:"PDL",        val:`$${fmt(s.pdl)}` },
    { name:"VWAP",       val:`$${fmt(s.vwap)}` },
    { name:"Support",    val:`$${fmt(s.support)}` },
    { name:"Resistance", val:`$${fmt(s.resistance)}` },
    { name:"200-Day MA", val:`$${fmt(s.ma200)}` },
    { name:"BB Upper (4h)", val:`$${fmt(s.bb_upper)}` },
    { name:"BB Lower (4h)", val:`$${fmt(s.bb_lower)}` },
  ],
  extraPanels:(s)=>(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
      <div style={card}>
        <p style={lbl}>Macro Drivers</p>
        <Stat title="DXY (Fed TWI) — rising = bearish gold" value={fmt(s.dxy)}/>
        {s.dxy_nfp&&s.dxy_nfp!==""&&<p style={{fontSize:11,color:"#fbbf24",...mono,margin:"0 0 8px"}}>📊 {s.dxy_nfp}</p>}
        <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>10Y Real Yield — rising = bearish gold</p>
        <p style={{...mono,fontSize:13,margin:0,color:"#e2e8f0"}}>{fmt(s.real_yield)}</p></div>
      </div>
      <div style={card}>
        <p style={lbl}>COT Positioning <span style={{color:"#475569",fontSize:9,fontWeight:400}}>· CFTC weekly · CONTEXT ONLY (not scored)</span></p>
        <Stat title="Managed Money Net (hedge funds)" value={`${fmt(s.cot_net)} contracts`}/>
        <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Sentiment</p>
        <p style={{...mono,fontSize:12,margin:0,color:s.cot_sentiment==="CROWDED_LONG"?"#f87171":s.cot_sentiment==="CROWDED_SHORT"?"#4ade80":"#94a3b8"}}>{fmt(s.cot_sentiment)}</p></div>
      </div>
    </div>
  ),
  system:`You are SIGNAL DECK GOLD, an XAU/USD analysis engine for paper trading education only. Not financial advice. Never fabricate prices.

ALL TECHNICAL DATA IS PRE-COMPUTED AND PROVIDED — do not search for price, MACD, RSI, ATR, VWAP, volume, DXY, real yield, or COT. These are calculated from real API data.

YOUR JOB (web search only for these):
1. NEWS: Top gold market news last 24h. Fed commentary, inflation, geopolitical risk, ETF flows (GLD/IAU), VIX. Bloomberg/Reuters preferred.
2. KEY LEVELS: Nearest major XAU/USD institutional support/resistance. Confirm or refine the provided S/R.
3. MACRO CONTEXT: is any FOMC/CPI/NFP/PCE scheduled, and WHEN? Only an event within 24h forces WAIT (wait_type binary_event); an event 24–72h away is CAUTION ONLY — still give a directional call, just note it and advise reduced size. Do NOT treat a 2-day-out event as a WAIT trigger. Fed speakers today? Geopolitical events?
4. BIAS SYNTHESIS: All pre-computed data + research → highest-probability directional bias.

7-STEP SCORECARD RULES (+2 TA rows = 9 scored items):
1. PRICE & VWAP: Upper/lower third of 24h range AND above/below VWAP → same direction = PASS.
2. MOMENTUM (MACD + RSI + 200MA — ONE combined slot): MACD and RSI are ~0.61 correlated, so they are scored TOGETHER, not as two independent confirmations. PASS LONG when the 1h/4h/Daily MACD lean is bullish AND RSI is 50-80 AND price is above the 200MA. PASS SHORT when MACD lean bearish AND RSI 20-50 AND price below the 200MA. Mixed = NEUTRAL. RSI extremes (>80 or <20) = NEUTRAL for entry — gold is GOLD-CALIBRATED 80/20 (verified: gold KEEPS RISING at RSI>70 and only reverses above 80; never treat 70/30 as extreme for gold). Do NOT treat MACD and RSI agreeing as two separate confirmations.
3. VOLUME: Ratio >1.5x avg = PASS (confirms). 0.8-1.5x = NEUTRAL. <0.8x = FAIL (weak move).
4. DXY + REAL YIELD (LEVEL/direction): Both falling = PASS LONG. Both rising = PASS SHORT. Conflict = NEUTRAL.
5. DXY/REAL-YIELD MOMENTUM ★ (gold's strongest leading input — weight this above the price-derived rows): use the MACRO MOMENTUM block. Both changes negative (DXY and real yield falling) = PASS LONG. Both positive = PASS SHORT. Mixed = NEUTRAL. This is rate-of-change, and it leads price — prefer it over lagging momentum when they conflict.
6. LEVELS: Price within 0.3% of key structural support (LONG) or resistance (SHORT) = PASS. Middle of range = FAIL.
7. NEWS: Confirmed bullish catalyst = PASS. Bearish = FAIL. Unclear = NEUTRAL.
(COT is NOT scored — it is context only. Do not create a "cot" scorecard entry.)

SIGNAL RULES:
- Binary event (FOMC/CPI/NFP/PCE) UPCOMING within the next 24h → WAIT. An event 24–72h away is CAUTION ONLY (note it, reduce size) — it does NOT force WAIT. An event that has ALREADY RELEASED does NOT force WAIT: once 30+ minutes have passed since release, trade the post-event trend normally (use the POST-NFP guidance when provided). Never output wait_type binary_event for a past release or for an event more than 24h out.
- ALWAYS output a directional call (LONG or SHORT) unless genuinely no setup. Base direction on the balance of the scorecard + trend context. Output WAIT ONLY if signal_quality <35 OR a binary event is within 24h. Weaker setups → output the direction with LOW confidence rather than a blanket WAIT.
- MULTI-TIMEFRAME: prefer trading with the 4h trend. If 4h and 1h conflict → still output the signal but cap confidence at LOW (counter-trend risk — advise reduced size). Only WAIT if all three timeframes (4h/1h/15m) disagree. 15m is for entry timing.
- A reversal candle pattern at a key level against the trend caps confidence at MEDIUM and can flip the call to WAIT.
- SIGNAL QUALITY: <35 = WAIT; 35-50 = LOW confidence (trade at own risk, minimum size); 50-70 = MEDIUM; 70-85 = HIGH; 85+ = VERY HIGH.
- MACD is a LAGGING confirmer (measured ~0 standalone directional edge on gold) — it confirms what price already did. Never treat it as leading, and never as independent confirmation alongside RSI (they are ~0.61 correlated and share one scored slot).
- DXY/real-yield MOMENTUM is the strongest LEADING input — when it conflicts with the lagging momentum row, favour the momentum row's direction and cap confidence at MEDIUM.
- DXY and yield conflict → confidence capped at MEDIUM
- Low volume breakout → confidence capped at MEDIUM
- COT is context only (no predictive correlation) — mention extreme crowding as a risk note, never as a directional reason
- Stop: use the ATR-based value provided. Do not widen it.
- TARGETS: stop is 1.5× ATR, which defines 1R. T1/T2 are NOT fixed — they SCALE with the higher-timeframe
  confirmation rung, and the exact values for this signal are given in the TARGET DISTANCE line of the
  multi-timeframe block below. Use those. They are calibrated so every signal lands near a ~60% T1 hit rate:
  a fully-confirmed set-up earns a farther target, a weakly-confirmed one gets a closer one.
  Do not substitute your own multiple, and do not stretch T1 to chase a rounder R:R.
- Off-peak session + no strong catalyst → cap confidence at MEDIUM

Respond ONLY with valid JSON, no markdown, no text outside it:
{"action":"LONG|SHORT|WAIT","price":"XXXX.XX","confidence":"HIGH|MEDIUM|LOW","entry":"XXXX.XX","entry_note":"brief","stop":"XXXX.XX","stop_note":"ATR-based","stop_pct":"0.7","t1":"XXXX.XX","t2":"XXXX.XX","rr":"1:2.5","high_24h":"XXXX.XX","low_24h":"XXXX.XX","vwap":"XXXX.XX","support":"XXXX.XX","resistance":"XXXX.XX","ma200":"XXXX.XX","dxy":"XXX.XX","dxy_nfp":"post-NFP DXY reaction or empty","real_yield":"X.XX%","cot_net":"XXXXX","cot_sentiment":"NEUTRAL","passes":5,"scorecard":{"price":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"momentum":{"r":"PASS|FAIL|NEUTRAL","note":"MACD+RSI+200MA combined"},"volume":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"dxy_yield":{"r":"PASS|FAIL|NEUTRAL","note":"level/direction"},"dxy_mom":{"r":"PASS|FAIL|NEUTRAL","note":"DXY/real-yield rate-of-change"},"history":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"news":{"r":"BULLISH|BEARISH|NEUTRAL","note":"brief"},"candles":{"r":"PASS|FAIL|NEUTRAL","note":"pattern name + tf"},"mtf":{"r":"PASS|FAIL|NEUTRAL","note":"4h/1h/15m agree?"}},"signal_quality":"78/100 — STRONG","entry_type":"Pattern|Optimal|Aggressive|Conservative","reasoning":"2 sentences","exits":["T1 $XXXX — close 50% move stop to entry","T2 $XXXX — close rest","Stop $XXXX — full exit","Time — 4h max"],"news_hl":"headline","news_sent":"BULLISH|BEARISH|NEUTRAL","binary_event":"none or event+timing","data_note":"brief or empty","sources":["url1"],"wait_type":"binary_event|low_confidence|no_setup|wrong_session|none","triggers":{"watch_long":"price or n/a","watch_long_note":"why","watch_short":"price or n/a","watch_short_note":"why","invalidation":"price","invalidation_note":"what the break means","next_session":"HH:MM UTC","next_session_note":"session + why","news_time":"HH:MM UTC or none","news_event":"name or none","candle_close":"HH:MM UTC","candle_close_note":"1h/4h + why","mtf_fix":"what must change","pattern_needed":"pattern + level","indicator_needed":"indicator condition","primary_reason":"main reason","secondary_reason":"second or none","estimated_clarity":"when clearer","refresh_recommendation":"specific actionable line"}}`,

  pipeline: async ({ keys, addLog, postNfp }) => {
    const tdCandles = async (interval, outputsize=100) => {
      const d=await tdFetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${outputsize}&apikey=${keys.td}`, addLog);
      if(d?.status==="error") throw new Error(`Twelve Data: ${d.message}`);
      const v=(d?.values||[]).reverse();
      return { times:v.map(x=>x.datetime), opens:v.map(x=>parseFloat(x.open)), closes:v.map(x=>parseFloat(x.close)), highs:v.map(x=>parseFloat(x.high)), lows:v.map(x=>parseFloat(x.low)), volumes:v.map(x=>parseFloat(x.volume)||0) };
    };
    // Returns latest value + direction vs the prior reading (we already fetch 5
    // observations — direction was being thrown away, yet the scorecard rules on it).
    // Latest value + direction vs prior + MOMENTUM (change across the whole window).
    // The audit showed DXY/real-yield are gold's strongest leading inputs, so their
    // rate-of-change is scored, not just their level.
    const fred = async s => { const r=await fetch(proxyDataUrl("fred", `https://api.stlouisfed.org/fred/series/observations?series_id=${s}&api_key=${keys.fred}&file_type=json&sort_order=desc&limit=8`)); const d=await r.json(); const vals=(d.observations||[]).filter(o=>o.value!==".").map(o=>parseFloat(o.value)); const v=vals[0]??null, prev=vals[1]??null, older=vals.length?vals[vals.length-1]:null; return { v, prev, older, dir:(v!=null&&prev!=null)?(v>prev?"RISING":v<prev?"FALLING":"FLAT"):"unknown", chg:(v!=null&&older!=null)?v-older:null }; };

    addLog("Fetching spot price...");
    let spot=null, sqMid=null;
    // Swissquote fetched in parallel as a live cross-check — TD's free tier can
    // lag badly right after news, and a stale spot poisons every downstream calc
    const sqP=fetch("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD").then(r=>r.ok?r.json():null).catch(()=>null);
    if(keys.td) try{ const d=await tdFetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${keys.td}`, addLog); if(d?.price&&parseFloat(d.price)>100) spot={price:p2(d.price),src:"Twelve Data"}; }catch(_){}
    try{ const d=await sqP; const q=d?.[0]?.spreadProfilePrices?.find(x=>x.spreadProfile==="prime"); if(q?.ask&&q?.bid) sqMid=p2((q.ask+q.bid)/2); }catch(_){}
    if(spot&&sqMid&&Math.abs(spot.price-sqMid)/sqMid>0.004){
      addLog(`⚠ TD spot ${spot.price} differs ${(Math.abs(spot.price-sqMid)/sqMid*100).toFixed(2)}% from Swissquote live ${sqMid} — using Swissquote (TD stale)`);
      spot={price:sqMid,src:"Swissquote (TD stale)"};
    }
    if(!spot&&sqMid) spot={price:sqMid,src:"Swissquote"};
    if(!spot) try{ const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd"); if(r.ok){const d=await r.json(),g=d?.["pax-gold"];if(g?.usd>100) spot={price:p2(g.usd),src:"CoinGecko PAXG"};} }catch(_){}
    if(!spot) throw new Error("Could not fetch gold spot price from any source.");
    addLog(`Spot: ${spot.price} (${spot.src})`);

    let td=null, ta=null;
    if(keys.td){ try{
      addLog("Fetching 15m/1h/4h/daily candles in parallel...");
      // allSettled so one failed timeframe doesn't drop the others
      const settled=await Promise.allSettled([tdCandles("15min",100),tdCandles("1h",100),tdCandles("4h",100),tdCandles("1day",210)]);
      const [c15,c1h,c4h,c1d]=settled.map(r=>r.status==="fulfilled"?r.value:null);
      settled.forEach((r,i)=>{ if(r.status==="rejected") addLog(`${["15m","1h","4h","daily"][i]} candles failed: ${r.reason?.message||r.reason}`); });
      if(c1h&&c4h){
        const macd1h=calcMACD(c1h.closes), rsi1h=calcRSI(c1h.closes), atr1h=calcATR(c1h.highs,c1h.lows,c1h.closes);
        const vwap=calcVWAP(c1h.highs.slice(-23),c1h.lows.slice(-23),c1h.closes.slice(-23),c1h.volumes.slice(-23));
        const vol1h=calcVolRatio(c1h.volumes);
        const macd4h=calcMACD(c4h.closes), rsi4h=calcRSI(c4h.closes), atr4h=calcATR(c4h.highs,c4h.lows,c4h.closes), vol4h=calcVolRatio(c4h.volumes);
        const ma200=c1d?calcSMA(c1d.closes,200):null, macdD=c1d?calcMACD(c1d.closes):null, rsiD=c1d?calcRSI(c1d.closes):null, volD=c1d?calcVolRatio(c1d.volumes):null;
        const dailyAtr=c1d?calcATR(c1d.highs,c1d.lows,c1d.closes):null;
        const h24=Math.max(...c1h.highs.slice(-24)), l24=Math.min(...c1h.lows.slice(-24));
        const bull=[macd1h,macd4h,macdD].filter(m=>m?.aboveSignal).length;
        // round numbers within $30 (gold respects these strongly)
        const rounds=[]; for(let r=Math.floor((spot.price-30)/25)*25; r<=spot.price+30; r+=25){ if(r%50===0&&Math.abs(r-spot.price)<=30) rounds.push(r); }
        // PDH/PDL (yesterday's completed daily candle) kept as reference LEVELS only.
        // The liquidity-sweep alert was REMOVED: it fired ~2.6x/day and its reversal
        // hit-rate was 49% (coinflip) over 3 months of 1h gold — confirmed noise.
        const pdh=c1d&&c1d.highs.length>=2?c1d.highs[c1d.highs.length-2]:null;
        const pdl=c1d&&c1d.lows.length>=2?c1d.lows[c1d.lows.length-2]:null;
        // current 1h true-range vs ATR(20) — elevated/extreme volatility flag
        const li1=c1h.closes.length-1;
        const trNow=Math.max(c1h.highs[li1]-c1h.lows[li1],Math.abs(c1h.highs[li1]-c1h.closes[li1-1]),Math.abs(c1h.lows[li1]-c1h.closes[li1-1]));
        const atr20=calcATR(c1h.highs,c1h.lows,c1h.closes,20);
        const volRatio=atr20?p2(trNow/atr20):null;
        // post-NFP: move since the 12:00 UTC candle open (contains the 12:30 release)
        let nfpMove=null, nfpLarge=false;
        if(postNfp?.active&&c1h.times){
          const day=new Date().toISOString().slice(0,10);
          const idx=c1h.times.findIndex(t=>String(t).slice(0,10)===day&&String(t).slice(11,13)==="12");
          if(idx>=0){ nfpMove=p2(spot.price-c1h.opens[idx]); nfpLarge=Math.abs(nfpMove)>40; }
        }
        const volFading=vol1h&&c1h.volumes[li1]<c1h.volumes[li1-1]&&vol1h.average&&(c1h.volumes[li1-1]/vol1h.average)>1.5;
        td={ macd1h,rsi1h,atr1h,vwap,vol1h, macd4h,rsi4h,atr4h,vol4h, macdD,rsiD,volD, ma200,dailyAtr,h24,l24,rounds, pdh,pdl, volRatio,nfpMove,nfpLarge,volFading, bullMacd:bull, bearMacd:3-bull };
        ta=analyzeTimeframes({ c15, c1h, c4h, c1d, c4hTimes:c4h.times, price:spot.price, atr4h, prevClose:c1d?c1d.closes[c1d.closes.length-2]:null, rangeFadeEnabled:true }); // GOLD: range-fade enabled (cleared the regime-audit bar, p=0.034)
        addLog(`1h MACD:${macd1h.macd?.toFixed(2)} RSI:${rsi1h.toFixed(1)} | MTF 4h:${ta.t4} 1h:${ta.t1} 15m:${ta.t15} ADX:${ta.adx?.toFixed(0)} pull:${ta.pull?.state||"—"}`);
      } else addLog("1h/4h candles unavailable — skipping local TA");
    }catch(e){ addLog(`Twelve Data error: ${e.message}`); } }

    let macro={nominal:null,tips:null,realYield:null,dxy:null};
    if(keys.fred){ try{
      addLog("Fetching FRED yields + DXY in parallel...");
      const [nominal,tips,dxy]=await Promise.all([fred("DGS10"),fred("T10YIE"),fred("DTWEXBGS")]);
      macro.nominal=nominal.v; macro.tips=tips.v; macro.dxy=dxy.v; macro.dxyDir=dxy.dir;
      // MOMENTUM (scored slot 5): rate-of-change across the ~8-obs window, not just level.
      macro.dxyChg=dxy.chg!=null?p2(dxy.chg):null;
      macro.dxyChgPct=(dxy.chg!=null&&dxy.older)?p2(dxy.chg/dxy.older*100):null;
      if(nominal.v!=null&&tips.v!=null){
        macro.realYield=p2(nominal.v-tips.v);
        const ryPrev=(nominal.prev!=null&&tips.prev!=null)?nominal.prev-tips.prev:null;
        macro.realYieldDir=ryPrev!=null?(macro.realYield>p2(ryPrev)?"RISING":macro.realYield<p2(ryPrev)?"FALLING":"FLAT"):"unknown";
        const ryOld=(nominal.older!=null&&tips.older!=null)?nominal.older-tips.older:null;
        macro.realYieldChg=ryOld!=null?p2(macro.realYield-ryOld):null;
      }
      // Combined momentum read — both falling = strongest gold tailwind, both rising = headwind.
      const dm=macro.dxyChg, rm=macro.realYieldChg;
      macro.momentum=(dm!=null&&rm!=null)
        ? (dm<0&&rm<0?"BOTH FALLING — strong bullish-gold tailwind":dm>0&&rm>0?"BOTH RISING — strong bearish-gold headwind":"MIXED — no combined macro thrust")
        : "unavailable";
      addLog(`FRED → real:${macro.realYield}% (${macro.realYieldDir||"?"}, Δ${macro.realYieldChg}) DXY:${macro.dxy} (${macro.dxyDir}, Δ${macro.dxyChg}) → ${macro.momentum}`);
    }catch(e){ addLog(`FRED error: ${e.message}`); } }

    addLog("Fetching COT (CFTC — COMEX gold managed money)...");
    let cot=null;
    try{
      // Section 6 fix: the disaggregated futures-only report (72hh-3qpy) with an
      // EXACT commodity_name='GOLD' filter. The old query used the financial-
      // futures dataset (yw9f-hn96) + a '%GOLD%' LIKE, which has no COMEX gold and
      // matched "GOLDMAN-SACHS COMMODITY INDEX" (no managed-money fields → net 0).
      // Field names here are m_money_positions_* (not managed_money_positions_*).
      const r=await fetch("https://publicreporting.cftc.gov/resource/72hh-3qpy.json?$limit=2&$order=report_date_as_yyyy_mm_dd%20DESC&$where=commodity_name=%27GOLD%27");
      if(r.ok){ const d=await r.json(); if(d.length){ const lat=d[0],prev=d[1];
        const mmL=parseInt(lat.m_money_positions_long_all||0), mmS=parseInt(lat.m_money_positions_short_all||0), net=mmL-mmS;
        const pNet=prev?parseInt(prev.m_money_positions_long_all||0)-parseInt(prev.m_money_positions_short_all||0):null;
        cot={ mmLong:mmL,mmShort:mmS,netMM:net,weekChange:pNet!==null?net-pNet:null,reportDate:lat.report_date_as_yyyy_mm_dd, sentiment:net>200000?"CROWDED_LONG":net<50000?"CROWDED_SHORT":"NEUTRAL" };
      } }
    }catch(_){}
    addLog(cot?`COT → net:${cot.netMM?.toLocaleString()} ${cot.sentiment}`:"COT unavailable");

    const session=getFxSession();
    const atr=td?.atr4h??td?.atr1h??null;
    const stopMult=postNfp?.active?1.2:1.5; // post-NFP: 20% tighter (sharp moves)
    const stopAmt=atr?p2(atr*stopMult):null, stopPct=stopAmt?p2((stopAmt/spot.price)*100):null;

    const pkg=`=== PRE-COMPUTED MARKET DATA — DO NOT RE-FETCH ===

PRICE
  XAU/USD Spot:  $${spot.price} (${spot.src})
  24h High: $${td?.h24??"unknown"} | 24h Low: $${td?.l24??"unknown"}
  VWAP (23h):    $${f2(td?.vwap)} → price ${td?.vwap?(spot.price>td.vwap?"ABOVE — bullish intraday":"BELOW — bearish intraday"):"unknown"}
  Session: ${session.label}

MACD — THREE TIMEFRAMES
  1h:    line=${f3(td?.macd1h?.macd)} hist=${f3(td?.macd1h?.histogram)} | ${td?.macd1h?.aboveSignal?"ABOVE":"BELOW"} signal | ${td?.macd1h?.expanding?"EXPANDING":"CONTRACTING"}
  4h:    line=${f3(td?.macd4h?.macd)} hist=${f3(td?.macd4h?.histogram)} | ${td?.macd4h?.aboveSignal?"ABOVE":"BELOW"} signal | ${td?.macd4h?.expanding?"EXPANDING":"CONTRACTING"}
  Daily: line=${f3(td?.macdD?.macd)} hist=${f3(td?.macdD?.histogram)} | ${td?.macdD?.aboveSignal?"ABOVE":"BELOW"} signal
  Alignment: ${td?`${td.bullMacd}/3 bullish, ${td.bearMacd}/3 bearish${td.bullMacd===3?" — ALL BULLISH (strong)":td.bearMacd===3?" — ALL BEARISH (strong)":""}`:"unavailable"}

RSI (14, GOLD BANDS 80/20)  1h:${f1(td?.rsi1h)}${rsiLblGold(td?.rsi1h)} | 4h:${f1(td?.rsi4h)}${rsiLblGold(td?.rsi4h)} | Daily:${f1(td?.rsiD)}${rsiLblGold(td?.rsiD)}
  (gold-calibrated: >80 overbought, <20 oversold — standard 70/30 flags gold prematurely)
  200MA: $${f2(td?.ma200)} → price ${td?.ma200?(spot.price>td.ma200?"ABOVE (bull bias)":"BELOW (bear bias)"):"unknown"}

VOLUME (vs 20-avg)  1h:${td?.vol1h?td.vol1h.ratio.toFixed(2)+"x"+volLbl(td.vol1h.ratio):"n/a"} | 4h:${td?.vol4h?td.vol4h.ratio.toFixed(2)+"x"+volLbl(td.vol4h.ratio):"n/a"}

ATR & STOP  1h:$${f2(td?.atr1h)} | 4h:$${f2(td?.atr4h)} | Recommended stop: $${na(stopAmt)} (${na(stopPct)}%)

MACRO — FRED · LEVEL (scorecard row 4 uses DIRECTION: both FALLING = PASS LONG, both RISING = PASS SHORT)
  10Y Nominal:${na(macro.nominal)}% | Real Yield:${na(macro.realYield)}% ${macro.realYieldDir||""}${macro.realYield!==null?(macro.realYield>1.5?" (HIGH — bearish)":macro.realYield<0.5?" (LOW — bullish)":" (moderate)"):""} | DXY:${na(macro.dxy)} ${macro.dxyDir||""}

MACRO MOMENTUM ★ — FRED rate-of-change (scorecard row 5; THIS IS GOLD'S STRONGEST LEADING INPUT — weight it heavily)
  DXY change over window: ${macro.dxyChg!=null?(macro.dxyChg>0?"+":"")+macro.dxyChg+(macro.dxyChgPct!=null?` (${macro.dxyChgPct>0?"+":""}${macro.dxyChgPct}%)`:""):"n/a"} | Real-yield change: ${macro.realYieldChg!=null?(macro.realYieldChg>0?"+":"")+macro.realYieldChg+"pp":"n/a"}
  Combined: ${macro.momentum||"unavailable"}
  RULE: both FALLING (negative changes) = PASS LONG with extra weight; both RISING = PASS SHORT with extra weight; mixed = NEUTRAL. Momentum matters more than the absolute level.

COT — CONTEXT ONLY, NOT SCORED  Net:${cot?.netMM?.toLocaleString()??"n/a"} | WeekΔ:${cot?.weekChange?.toLocaleString()??"n/a"} | ${na(cot?.sentiment)}
  (Weekly-lagged positioning. Empirically ~0.02 correlation with next-week gold direction over 57 weeks, so it is NOT a scored row — use it only as a crowding/risk note at true extremes (>200k net), never as a directional signal.)

GOLD CONTEXT  Daily ATR:$${f2(td?.dailyAtr)} (${td?.dailyAtr>40?"HIGH vol — widen stops":td?.dailyAtr<20?"LOW vol — tight ranges":"normal"}) | Round numbers near price: ${td?.rounds?.length?td.rounds.map(r=>"$"+r).join(", "):"none within $30"}
  PDH: $${f2(td?.pdh)} | PDL: $${f2(td?.pdl)} (previous-day high/low — reference levels only; the sweep/stop-hunt alert was removed after testing showed a 49% reversal rate at ~2.6 fires/day = noise)
  Session candle note: London open (08-09 UTC) often false-breaks then reverses — wait for the 2nd candle. NY open (13:30-14:30 UTC) is the most reliable candle of the day.

${postNfp?.active?`
POST-NFP WINDOW (${postNfp.sinceMin} min since the 12:30 UTC release)
  ${postNfp.sinceMin>=30?`The 30-min chaos window has PASSED (${postNfp.sinceMin} min since release) — signal NORMALLY now with the tightened stop; do NOT output wait_type binary_event for this released event.`:`First 30 min are chaotic — most reliable signal after 13:00 UTC.`} Stop already tightened 20% (${stopMult}x ATR).
  Move since NFP candle open: ${td?.nfpMove!=null?"$"+td.nfpMove:"n/a"}${td?.nfpLarge?" — LARGE MOVE ALREADY OCCURRED → prefer WAIT/pullback entries":""}
  Volume context: ${td?.vol1h?(td.vol1h.ratio>3?"NFP volume spike — move is institutional, high conviction":td.vol1h.ratio>1.5?"Elevated volume — reliable signal":td.volFading?"Volume normalizing — initial reaction fading, cleaner entry forming":"normal volume"):"n/a"}
  EXTRA TASK (one additional search): search "DXY dollar index NFP reaction today". If DXY up >0.3% set dxy_nfp to "DXY STRENGTHENING post-NFP — bearish gold bias confirmed (+X.X%)". If down >0.3% → "DXY WEAKENING post-NFP — bullish gold bias confirmed (-X.X%)". If flat → "DXY mixed post-NFP — rely on technicals for direction". Include the % change and a one-line analyst take.`:""}
${ta?taPromptBlock(ta, v=>"$"+f2(v)):"MULTI-TIMEFRAME / PATTERNS / FIB: unavailable (no Twelve Data key — score candles & mtf NEUTRAL)"}

=== YOUR JOB: search news, key S/R levels, binary events, Fed speakers → output JSON ===`;

    return { pkg, price:spot.price, src:spot.src, session, meta:{ td, macro, cot, stopAmt, stopPct, ta } };
  },
  merge:(p,m)=>{
    const { td, macro, cot, ta } = m;
    if(td?.h24&&!p.high_24h) p.high_24h=String(td.h24);
    if(td?.l24&&!p.low_24h)  p.low_24h=String(td.l24);
    if(td?.ma200)            p.ma200=td.ma200.toFixed(2);
    if(td?.vwap&&!p.vwap)    p.vwap=td.vwap.toFixed(2);
    if(macro.realYield!==null) p.real_yield=`${macro.realYield}%${macro.realYieldDir?` — ${macro.realYieldDir.toLowerCase()}`:""}`;
    if(macro.dxy!==null)       p.dxy=`${macro.dxy}${macro.dxyDir?` — ${macro.dxyDir.toLowerCase()}`:""}`;
    if(cot&&!p.cot_net)        p.cot_net=cot.netMM?.toLocaleString();
    if(cot&&!p.cot_sentiment)  p.cot_sentiment=cot.sentiment;
    if(td?.pdh!=null) p.pdh=td.pdh.toFixed(2);
    if(td?.pdl!=null) p.pdl=td.pdl.toFixed(2);
    if(td?.volRatio!=null) p._volRatio=td.volRatio;
    if(td?.nfpLarge) p._nfpLarge=true;
    p._sources=[...(ta?["Real OHLCV"]:[]),...((macro.dxy!=null||macro.realYield!=null)?["FRED"]:[]),...(cot?["COT"]:[])];
    mergeTA(p, ta, v=>v.toFixed(2), GOLD.scRows.map(r=>r.key));
  },
};

// ════════════════════════════════════════════════════════════════════════════
// ASSET 2 — GBP/USD ("cable")
// ════════════════════════════════════════════════════════════════════════════
// Thresholds CALIBRATED from REAL GBP/USD data (Yahoo GBPUSD=X, 130d/1543×1h/386×4h),
// NOT copied from gold or reused from EUR's over-conservative defaults:
//   • RSI 70/30 (daily RSI ranged 32-65 → never hit 80/20; 1h 6%>70/5%<30)
//   • ADX weak<18 / strong>22 (4h median 22.2, daily median 19.6 = below 20 half
//     the time — gold's <20/<25 bars would flag most normal cable as weak)
//   • quality-WAIT bar 30 (cable earns fewer vol/ADX bonuses than gold → scores
//     ~5pts lower; 35 would reproduce the "EUR always WAIT" failure)
//   • avg daily ATR ~99 pips, avg 4h ATR ~28 pips → 1.5×4h ATR stop ≈ 30 pips
const GBP = {
  id:"gbp", name:"SIGNAL DECK · GBP/USD", symbol:"GBP/USD", headerNote:"GBP/USD · Cable · Real APIs",
  pricePrefix:"", decimals:5,
  theme:{ accent:"#1e40af", accentText:"#93c5fd", panelBg:"#0a1836", panelBorder:"#1e3a8a", loader:"#1e40af" },
  cal:{ adxWeak:18, adxStrong:22 },   // calibrated ADX bars (see header)
  qualityWaitBar:30,                   // calibrated WAIT bar (gold/BTC use 35)
  eventCurrencies:["USD","GBP"],       // cable keys off BOTH sides
  keyFields:[
    { field:"anthropic", label:"Anthropic API Key", hint:"required — powers the AI signal", ph:"sk-ant-..." },
    { field:"td",        label:"Twelve Data Key",   hint:"MACD, RSI, ATR, EMA, VWAP, pivots (forex — free tier)", ph:"a1b2c3d4..." },
    { field:"fred",      label:"FRED API Key",      hint:"DXY + US 10Y + Fed funds (free)", ph:"abcdef123456..." },
  ],
  session:getGbpSession,
  quickPrice: async (keys) => {
    if(keys.td){ try{ const r=await fetch(proxyDataUrl("td", `https://api.twelvedata.com/price?symbol=GBP/USD&apikey=${keys.td}`)); const d=await r.json(); if(parseFloat(d.price)>0.5) return {price:p5(d.price),src:"Twelve Data"}; }catch(_){} }
    try{ const r=await fetch("https://open.er-api.com/v6/latest/GBP"); if(r.ok){const d=await r.json();if(d?.rates?.USD>0.5) return {price:p5(d.rates.USD),src:"open.er-api"};} }catch(_){}
    return null;
  },
  // FREE tier scan (no AI). GBP uses its own calibrated ADX bars for the tier.
  scan: async (keys) => {
    if(!keys.td) return { ok:false, reason:"Twelve Data key needed for the free tier scan" };
    const fetchSeries = async (interval) => {
      const d = await tdFetch(`https://api.twelvedata.com/time_series?symbol=GBP/USD&interval=${interval}&outputsize=${interval==="1day"?210:100}&apikey=${keys.td}`);
      if(d?.status==="error") throw new Error(d.message);
      const v=(d?.values||[]).reverse();
      return { times:v.map(x=>x.datetime), opens:v.map(x=>parseFloat(x.open)), closes:v.map(x=>parseFloat(x.close)), highs:v.map(x=>parseFloat(x.high)), lows:v.map(x=>parseFloat(x.low)), volumes:v.map(x=>parseFloat(x.volume)||0) };
    };
    return runTierScan({ fetchSeries, rangeFadeEnabled:true, cal:{ adxWeak:18, adxStrong:22 }, tdCalls:3 });
  },
  sessionsGuide:[
    { window:"07:00–09:00 UTC", label:"London Open — cable's primary liquidity window", quality:"best" },
    { window:"13:00–16:00 UTC", label:"London/NY Overlap — most reliable breakouts", quality:"best" },
    { window:"09:00–13:00 UTC", label:"London Session — good follow-through", quality:"good" },
    { window:"21:00–07:00 UTC", label:"Asian — genuinely thin for cable, avoid", quality:"avoid" },
  ],
  weekendNote:{ title:"GBP/USD — Pepperstone weekend", lines:[
    "Spread widens to 2–4 pips (vs 0.6–1.2 weekday)","Very thin — cable barely moves outside London/NY",
    "Best weekend window: Sunday 21:00 UTC weekly open",
  ], rec:"Only trade with 25+ pip TP targets. Cable's edge is London/NY — skip weekends." },
  events:["BOE","UKCPI","UKGDP","UKEMP","FOMC","CPI","NFP","PCE"], eventsNote:"Cable moves hard on BOE decisions and UK CPI/GDP/jobs — as much as on US data. Both sides are binary events.",
  riskRules:[
    "Max 1-2% of account at risk per trade","Stop = 1.5× 4h ATR (cable's 4h ATR ~28 pips → stop typically ~30-40 pips)",
    "Minimum R:R 1:2","DXY (USD side) + BOE/Fed differential are the dominant filters",
    "⚠ Cable spikes on UK data (CPI/GDP/jobs, 06:00–07:00 UTC) even when USD is quiet — exit before them",
    "Pip value: at 0.01 lots, 1 pip ≈ $0.10 ≈ €0.09 (any USD-quoted pair) — CONFIRM your exact €/pip with Pepperstone for your account currency before sizing",
  ],
  // 9-step (was 10): MACD+RSI merged into one momentum slot (0.63 correlated), and
  // the 200MA directional bias REMOVED for this pair — measured regime edge was
  // -25pp (above the 200MA was LESS bullish), so it was actively misleading on a
  // range-prone major. Regime row now reads range-vs-trend instead of a bias.
  scTitle:"9-Step Scorecard", passesOf:9,
  scRows:[
    { key:"price",    label:"1. Price & Session" },
    { key:"momentum", label:"2. Momentum (MACD+RSI)" },
    { key:"boe_fed",  label:"3. BOE/Fed + DXY" },
    { key:"uk_data",  label:"4. UK/US Data" },
    { key:"levels",   label:"5. Levels / Fib / Pivots" },
    { key:"regime",   label:"6. Regime (range vs trend)" },
    { key:"news",     label:"7. News / Macro" },
    ...TA_ROWS,
  ],
  readyLines:(k)=>[
    k.td?"✓ Twelve Data (GBP/USD forex — MACD/RSI/ATR/EMA/VWAP/pivots)":"⚠ No Twelve Data — AI inference only",
    (k.fred?"✓ FRED (DXY + US 10Y + Fed funds + UK SONIA)":"⚠ No FRED — web search fallback")+" · BOE guidance via web search",
  ],
  levelsTitle:"Key Levels & EMAs",
  levels:(s)=>[
    { name:"24h High",   val:fmt(s.high_24h) },
    { name:"24h Low",    val:fmt(s.low_24h) },
    { name:"PDH",        val:fmt(s.pdh) },
    { name:"PDL",        val:fmt(s.pdl) },
    { name:"VWAP",       val:fmt(s.vwap) },
    { name:"50 EMA (4h)",  val:fmt(s.ema50) },
    { name:"200 EMA (4h)", val:fmt(s.ema200) },
    { name:"Support",    val:fmt(s.support) },
    { name:"Resistance", val:fmt(s.resistance) },
    { name:"200-Day MA", val:fmt(s.ma200) },
  ],
  extraPanels:(s)=>(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
      <div style={card}>
        <p style={lbl}>USD side — DXY ★</p>
        <Stat title="US Dollar Index — rising = SHORT cable" value={fmt(s.dxy)} sub="cable is USD-quoted; DXY up = GBP/USD down"/>
        <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>US 10Y yield</p>
        <p style={{...mono,fontSize:12,margin:0,color:"#e2e8f0"}}>{fmt(s.real_yield)}</p></div>
      </div>
      <div style={card}>
        <p style={lbl}>BOE vs Fed differential <span style={{color:"#475569",fontSize:9,fontWeight:400}}>· FRED SONIA (structured)</span></p>
        <Stat title="UK − US policy rate (SONIA vs Fed Funds)" value={fmt(s.rate_diff)} sub={s.sonia?`UK SONIA ${s.sonia}`:"structured FRED data + search for forward guidance"}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>BOE</p><p style={{...mono,fontSize:12,margin:0,color:"#e2e8f0"}}>{fmt(s.boe_bias)}</p></div>
          <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Fed</p><p style={{...mono,fontSize:12,margin:0,color:"#e2e8f0"}}>{fmt(s.fed_bias)}</p></div>
        </div>
        {s.uk_data_note&&s.uk_data_note!==""&&<p style={{fontSize:11,color:"#93c5fd",...mono,margin:"6px 0 0"}}>🇬🇧 {s.uk_data_note}</p>}
      </div>
    </div>
  ),
  system:`You are SIGNAL DECK GBP/USD, a GBP/USD ("cable") analysis engine for paper trading education only. Not financial advice. Never fabricate prices.

ALL TECHNICAL DATA IS PRE-COMPUTED AND PROVIDED — do not search for price, MACD, RSI, ATR, EMA, VWAP, pivots, 200MA, or DXY. These are calculated from real API data.

YOUR JOB (web search only for these):
1. BOE FORWARD GUIDANCE ONLY (the rate LEVEL and the UK−US differential are already provided structurally from FRED SONIA — do not search for them): search "BOE Bank of England interest rate decision" for the MPC vote split and hawkish/dovish forward guidance for the NEXT meeting. Combine that guidance with the structured differential given in the data package.
2. UK DATA: search "UK GDP inflation data" — latest UK CPI, GDP and employment/wages vs expectations. Which side (UK or US) is printing stronger.
3. NEWS: top GBP/USD news last 24h — UK politics/fiscal, risk sentiment, GBP-specific analyst commentary.
4. KEY LEVELS: nearest institutional GBP/USD support/resistance; confirm/refine the provided pivots.
5. BIAS SYNTHESIS: all pre-computed data + research → highest-probability direction.

KEY CABLE LOGIC:
- DXY (USD side) is a dominant filter — cable is USD-quoted, so DXY rising = SHORT GBP/USD, DXY falling = LONG. Never fight a strong DXY move.
- BOE hawkish + Fed dovish = LONG cable. BOE dovish + Fed hawkish = SHORT. Both same direction = choppy, lean the stronger-surprise side.
- UK data is a HEAVYWEIGHT, not an afterthought: cable often has outsized moves on UK CPI/GDP/jobs (released 06:00-07:00 UTC) even when the USD side is quiet. Weight UK-side surprises fully.
- NO 200-MA TREND BIAS on this pair. Measured over 2 years, price above the 200MA was LESS likely to rise (-25pp edge) — cable ranges more than it trends. Read regime as RANGE vs TREND (via ADX/structure), never as "above the MA = bullish".
- MACD and RSI are ~0.63 correlated and share ONE momentum row — never count them as two independent confirmations.

10-STEP SCORECARD RULES (calibrated for GBP/USD's real volatility):
1. PRICE & SESSION: above VWAP & upper third of range in a London/overlap session = PASS LONG; below & lower third = PASS SHORT; mid/off-session = NEUTRAL.
2. MOMENTUM (MACD + RSI — ONE combined slot; they are ~0.63 correlated so they are scored together, NOT as two confirmations): PASS LONG when the 1h/4h/Daily MACD lean is bullish AND RSI is 50-70. PASS SHORT when MACD lean bearish AND RSI 30-50. Mixed = NEUTRAL. RSI >70/<30 = NEUTRAL for entry (cable's real extremes — never gold's 80/20). Do NOT use the 200MA in this row.
3. BOE/FED + DXY: use the STRUCTURED UK−US differential (FRED SONIA vs Fed Funds) provided in the package, plus DXY direction. DXY falling + UK rate relatively supportive/hawkish guidance = PASS LONG; DXY rising + UK relatively dovish = PASS SHORT; conflict = NEUTRAL.
4. UK/US DATA: UK data beats expectations vs US = PASS LONG; US beats UK = PASS SHORT; nothing notable = NEUTRAL. Treat a UK CPI/GDP/jobs surprise as fully as a US one.
5. LEVELS/PIVOTS: within 0.1% of pivot/structural support (LONG) or resistance (SHORT) = PASS; mid-range = FAIL.
6. REGIME (RANGE vs TREND — no directional MA bias): use ADX (cable-calibrated bars) + 4h structure. In a TREND regime, a trade WITH the structure = PASS. In a RANGE regime, a mean-reversion trade from the range edge = PASS and a breakout trade = FAIL/NEUTRAL. Never score this from the 200MA.
7. NEWS/MACRO: GBP-supportive catalyst / risk-on = PASS; GBP-negative / risk-off = FAIL; unclear = NEUTRAL.

SIGNAL RULES (calibrated — do NOT over-output WAIT; cable is a normal-trending major):
- Binary event (BOE/FOMC/UK CPI/UK GDP/UK jobs/US CPI/NFP/PCE) UPCOMING within the next 24h → WAIT. An event 24–72h away is CAUTION ONLY (note it, reduce size) — it does NOT force WAIT. Already-released events do NOT force WAIT once 30+ min have passed — trade the post-event trend.
- ALWAYS output a directional call (LONG or SHORT) unless genuinely no setup. Output WAIT ONLY if signal_quality <30 OR a binary event is within 24h. Weaker setups → the direction at LOW confidence, NOT a blanket WAIT.
- MULTI-TIMEFRAME: prefer trading with the 4h trend. If 4h and 1h conflict → still signal but cap confidence at LOW. Only WAIT if all three timeframes disagree.
- ADX for cable is calibrated to its own distribution (weak <18, strong >22) — cable trends less sharply than gold, so a "developing" ADX of ~20 is normal and tradeable, NOT a reason to WAIT.
- A reversal candle pattern at a key level against the trend caps confidence at MEDIUM and can flip the call to WAIT.
- SIGNAL QUALITY: <30 = WAIT; 30-50 = LOW; 50-70 = MEDIUM; 70-85 = HIGH; 85+ = VERY HIGH.
- Stop: use the ATR-based pip value provided (1.5× 4h ATR) — this defines 1R.
- TARGETS: T1/T2 are NOT fixed — they SCALE with the higher-timeframe confirmation rung, and the exact values for this signal are in the TARGET DISTANCE line of the multi-timeframe block below. Use those. They are calibrated so every signal lands near a ~60% T1 hit rate. Do not substitute your own multiple, and do not stretch T1 to chase a rounder R:R.
- Off-peak (Asian) + no catalyst → cap confidence at MEDIUM.

Respond ONLY with valid JSON, no markdown, no text outside it:
{"action":"LONG|SHORT|WAIT","price":"1.XXXXX","confidence":"HIGH|MEDIUM|LOW","entry":"1.XXXXX","entry_note":"brief","stop":"1.XXXXX","stop_note":"1.5x 4h ATR","stop_pct":"35 pips","t1":"1.XXXXX","t2":"1.XXXXX","rr":"1:2","high_24h":"1.XXXXX","low_24h":"1.XXXXX","vwap":"1.XXXXX","ema50":"1.XXXXX","ema200":"1.XXXXX","support":"1.XXXXX","resistance":"1.XXXXX","ma200":"1.XXXXX","dxy":"XXX.XX — falling","real_yield":"US 10Y X.XX%","rate_diff":"BOE vs Fed lean","boe_bias":"hawkish hold","fed_bias":"dovish","uk_data_note":"UK CPI/GDP surprise or empty","passes":5,"scorecard":{"price":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"momentum":{"r":"PASS|FAIL|NEUTRAL","note":"MACD+RSI combined"},"boe_fed":{"r":"PASS|FAIL|NEUTRAL","note":"UK-US differential + DXY"},"uk_data":{"r":"PASS|FAIL|NEUTRAL","note":"which side stronger"},"levels":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"regime":{"r":"PASS|FAIL|NEUTRAL","note":"range vs trend"},"news":{"r":"BULLISH|BEARISH|NEUTRAL","note":"brief"},"candles":{"r":"PASS|FAIL|NEUTRAL","note":"pattern name + tf"},"mtf":{"r":"PASS|FAIL|NEUTRAL","note":"4h/1h/15m agree?"}},"signal_quality":"72/100 — STRONG","entry_type":"Pattern|Optimal|Aggressive|Conservative","reasoning":"2 sentences","exits":["T1 1.XXXXX — close 50% move stop to entry","T2 1.XXXXX — close rest","Stop 1.XXXXX — full exit","Time — 4h max"],"news_hl":"headline","news_sent":"BULLISH|BEARISH|NEUTRAL","binary_event":"none or event+timing","data_note":"brief or empty","sources":["url1"],"wait_type":"binary_event|low_confidence|no_setup|wrong_session|none","triggers":{"watch_long":"price or n/a","watch_long_note":"why","watch_short":"price or n/a","watch_short_note":"why","invalidation":"price","invalidation_note":"what the break means","next_session":"HH:MM UTC","next_session_note":"session + why","news_time":"HH:MM UTC or none","news_event":"name or none","candle_close":"HH:MM UTC","candle_close_note":"1h/4h + why","mtf_fix":"what must change","pattern_needed":"pattern + level","indicator_needed":"indicator condition","primary_reason":"main reason","secondary_reason":"second or none","estimated_clarity":"when clearer","refresh_recommendation":"specific actionable line"}}`,

  pipeline: async ({ keys, addLog }) => {
    const tdCandles = async (interval, outputsize=100) => {
      const d=await tdFetch(`https://api.twelvedata.com/time_series?symbol=GBP/USD&interval=${interval}&outputsize=${outputsize}&apikey=${keys.td}`, addLog);
      if(d?.status==="error") throw new Error(`Twelve Data: ${d.message}`);
      const v=(d?.values||[]).reverse();
      return { times:v.map(x=>x.datetime), opens:v.map(x=>parseFloat(x.open)), closes:v.map(x=>parseFloat(x.close)), highs:v.map(x=>parseFloat(x.high)), lows:v.map(x=>parseFloat(x.low)), volumes:v.map(x=>parseFloat(x.volume)||0) };
    };
    // Latest value + direction vs prior + MOMENTUM (change across the whole window).
    // The audit showed DXY/real-yield are gold's strongest leading inputs, so their
    // rate-of-change is scored, not just their level.
    const fred = async s => { const r=await fetch(proxyDataUrl("fred", `https://api.stlouisfed.org/fred/series/observations?series_id=${s}&api_key=${keys.fred}&file_type=json&sort_order=desc&limit=8`)); const d=await r.json(); const vals=(d.observations||[]).filter(o=>o.value!==".").map(o=>parseFloat(o.value)); const v=vals[0]??null, prev=vals[1]??null, older=vals.length?vals[vals.length-1]:null; return { v, prev, older, dir:(v!=null&&prev!=null)?(v>prev?"RISING":v<prev?"FALLING":"FLAT"):"unknown", chg:(v!=null&&older!=null)?v-older:null }; };
    const gf = v => (v||v===0) ? v.toFixed(5) : "n/a";

    addLog("Fetching GBP/USD spot...");
    let spot=null;
    if(keys.td) try{ const d=await tdFetch(`https://api.twelvedata.com/price?symbol=GBP/USD&apikey=${keys.td}`, addLog); if(d?.price&&parseFloat(d.price)>0.5) spot={price:p5(d.price),src:"Twelve Data"}; }catch(_){}
    if(!spot) try{ const r=await fetch("https://open.er-api.com/v6/latest/GBP"); if(r.ok){const d=await r.json();const px=d?.rates?.USD;if(px>0.5) spot={price:p5(px),src:"open.er-api"};} }catch(_){}
    if(!spot) throw new Error("Could not fetch GBP/USD price from any source.");
    addLog(`Spot: ${spot.price} (${spot.src})`);

    let td=null, ta=null;
    if(keys.td){ try{
      addLog("Fetching 15m/1h/4h/daily candles in parallel...");
      const settled=await Promise.allSettled([tdCandles("15min",100),tdCandles("1h",100),tdCandles("4h",120),tdCandles("1day",210)]);
      const [c15,c1h,c4h,c1d]=settled.map(r=>r.status==="fulfilled"?r.value:null);
      settled.forEach((r,i)=>{ if(r.status==="rejected") addLog(`${["15m","1h","4h","daily"][i]} candles failed: ${r.reason?.message||r.reason}`); });
      if(c1h&&c4h){
        const macd1h=calcMACD(c1h.closes), rsi1h=calcRSI(c1h.closes), atr1h=calcATR(c1h.highs,c1h.lows,c1h.closes);
        const vwap=calcVWAP(c1h.highs.slice(-23),c1h.lows.slice(-23),c1h.closes.slice(-23),c1h.volumes.slice(-23));
        const vol1h=calcVolRatio(c1h.volumes);
        const macd4h=calcMACD(c4h.closes), rsi4h=calcRSI(c4h.closes), atr4h=calcATR(c4h.highs,c4h.lows,c4h.closes), vol4h=calcVolRatio(c4h.volumes);
        const ema50=calcEMAlast(c4h.closes,50), ema200=calcEMAlast(c4h.closes,200);
        const ma200=c1d?calcSMA(c1d.closes,200):null, macdD=c1d?calcMACD(c1d.closes):null, rsiD=c1d?calcRSI(c1d.closes):null, volD=c1d?calcVolRatio(c1d.volumes):null;
        const dailyAtr=c1d?calcATR(c1d.highs,c1d.lows,c1d.closes):null;
        const h24=Math.max(...c1h.highs.slice(-24)), l24=Math.min(...c1h.lows.slice(-24));
        const bull=[macd1h,macd4h,macdD].filter(m=>m?.aboveSignal).length;
        const pdh=c1d&&c1d.highs.length>=2?c1d.highs[c1d.highs.length-2]:null;
        const pdl=c1d&&c1d.lows.length>=2?c1d.lows[c1d.lows.length-2]:null;
        // PDH/PDL liquidity sweep (generic, same as gold) — cable stop-hunts London
        let sweep=null, nearPD=null;
        if(pdh!=null&&pdl!=null){
          for(let i=Math.max(0,c1h.closes.length-3);i<c1h.closes.length;i++){
            if(c1h.highs[i]>pdh&&c1h.closes[i]<pdh) sweep={level:pdh,side:"PDH",note:"bearish reversal setup — watch SHORT"};
            else if(c1h.lows[i]<pdl&&c1h.closes[i]>pdl) sweep={level:pdl,side:"PDL",note:"bullish reversal setup — watch LONG"};
          }
          if(!sweep){ if(Math.abs(spot.price-pdh)<=0.0015) nearPD={level:pdh,side:"PDH"}; else if(Math.abs(spot.price-pdl)<=0.0015) nearPD={level:pdl,side:"PDL"}; }
        }
        const li1=c1h.closes.length-1;
        const trNow=Math.max(c1h.highs[li1]-c1h.lows[li1],Math.abs(c1h.highs[li1]-c1h.closes[li1-1]),Math.abs(c1h.lows[li1]-c1h.closes[li1-1]));
        const atr20=calcATR(c1h.highs,c1h.lows,c1h.closes,20);
        const volRatio=atr20?p2(trNow/atr20):null;
        td={ macd1h,rsi1h,atr1h,vwap,vol1h, macd4h,rsi4h,atr4h,vol4h, macdD,rsiD,volD, ema50,ema200,ma200,dailyAtr,h24,l24, pdh,pdl,sweep,nearPD, volRatio, bullMacd:bull, bearMacd:3-bull };
        ta=analyzeTimeframes({ c15, c1h, c4h, c1d, c4hTimes:c4h.times, price:spot.price, atr4h, prevClose:c1d?c1d.closes[c1d.closes.length-2]:null, cal:{ adxWeak:18, adxStrong:22 }, rangeFadeEnabled:true }); // GBP: range-fade enabled (cleared the regime-audit bar, p=0.007)
        addLog(`1h MACD:${macd1h.macd?.toFixed(5)} RSI:${rsi1h.toFixed(1)} | MTF 4h:${ta.t4} 1h:${ta.t1} 15m:${ta.t15} ADX:${ta.adx?.toFixed(0)} vol:${ta.vmeter?.pct}% pull:${ta.pull?.state||"—"}`);
      } else addLog("1h/4h candles unavailable — skipping local TA");
    }catch(e){ addLog(`Twelve Data error: ${e.message}`); } }

    let macro={dxy:null,dxyDir:"unknown",dgs10:null,fedfunds:null,sonia:null,rateDiff:null};
    if(keys.fred){ try{
      // IUDSOIA = Daily Sterling Overnight Index Average (SONIA) — a STRUCTURED UK
      // policy-rate proxy that tracks Bank Rate, so the BOE-vs-Fed differential is
      // computed from real data instead of relying only on search commentary.
      addLog("Fetching FRED DXY + US 10Y + Fed funds + UK SONIA...");
      const [dxy,dgs10,fedfunds,sonia]=await Promise.all([fred("DTWEXBGS"),fred("DGS10"),fred("FEDFUNDS"),fred("IUDSOIA")]);
      macro.dxy=dxy.v; macro.dxyDir=dxy.dir; macro.dgs10=dgs10.v; macro.dgs10Dir=dgs10.dir; macro.fedfunds=fedfunds.v;
      macro.sonia=sonia.v; macro.soniaDir=sonia.dir; macro.soniaChg=sonia.chg!=null?p2(sonia.chg):null;
      if(macro.sonia!=null&&macro.fedfunds!=null){
        macro.rateDiff=p2(macro.sonia-macro.fedfunds); // UK minus US policy rate
        macro.rateDiffLbl=macro.rateDiff>0?"UK rate ABOVE US (GBP-supportive)":macro.rateDiff<0?"UK rate BELOW US (GBP-negative)":"parity";
      }
      addLog(`FRED → DXY:${macro.dxy} (${macro.dxyDir}) 10Y:${macro.dgs10}% Fed:${macro.fedfunds}% SONIA:${macro.sonia}% (${macro.soniaDir}) diff:${macro.rateDiff}pp`);
    }catch(e){ addLog(`FRED error: ${e.message}`); } }

    const session=getGbpSession();
    const atr=td?.atr4h??null;
    const stopAmt=atr?p5(atr*1.5):null, stopPips=stopAmt?Math.round(stopAmt*10000):null;

    const pkg=`=== PRE-COMPUTED MARKET DATA — DO NOT RE-FETCH ===

PRICE
  GBP/USD Spot: ${spot.price} (${spot.src})
  24h High: ${gf(td?.h24)} | 24h Low: ${gf(td?.l24)}
  VWAP (23h): ${gf(td?.vwap)} → price ${td?.vwap?(spot.price>td.vwap?"ABOVE — bullish intraday":"BELOW — bearish intraday"):"unknown"}
  Session: ${session.label} (${session.quality}) — cable's edge is London Open + London/NY overlap

EMAs (4h)  50 EMA:${gf(td?.ema50)} | 200 EMA:${gf(td?.ema200)} → price ${td?.ema200?(spot.price>td.ema200?"ABOVE 200EMA (bull bias)":"BELOW 200EMA (bear bias)"):"unknown"}

MACD — THREE TIMEFRAMES
  1h: line=${gf(td?.macd1h?.macd)} | ${td?.macd1h?.aboveSignal?"ABOVE":"BELOW"} signal
  4h: line=${gf(td?.macd4h?.macd)} | ${td?.macd4h?.aboveSignal?"ABOVE":"BELOW"} signal ${td?.macd4h?.expanding?"(expanding)":"(contracting)"}
  Daily: line=${gf(td?.macdD?.macd)} | ${td?.macdD?.aboveSignal?"ABOVE":"BELOW"} signal
  Alignment: ${td?`${td.bullMacd}/3 bullish, ${td.bearMacd}/3 bearish${td.bullMacd===3?" — ALL BULLISH":td.bearMacd===3?" — ALL BEARISH":""}`:"unavailable"}

RSI (14, CALIBRATED 70/30 for cable)  1h:${f1(td?.rsi1h)}${rsiLbl(td?.rsi1h)} | 4h:${f1(td?.rsi4h)}${rsiLbl(td?.rsi4h)} | Daily:${f1(td?.rsiD)}${rsiLbl(td?.rsiD)}
  (cable RSI rarely exceeds 70 even on 1h — 70/30 ARE the real extremes; do NOT apply gold's 80/20)
  MACD and RSI are scored TOGETHER as one momentum row (they are ~0.63 correlated — not two independent confirmations).
  200MA: ${gf(td?.ma200)} — REFERENCE LEVEL ONLY. Do NOT derive a bullish/bearish bias from it for cable: the measured regime edge was -25pp (price above the 200MA was LESS likely to rise), so a 200MA trend-bias is misleading on this pair.

VOLUME (vs 20-avg)  1h:${td?.vol1h?td.vol1h.ratio.toFixed(2)+"x"+volLbl(td.vol1h.ratio):"n/a"} | 4h:${td?.vol4h?td.vol4h.ratio.toFixed(2)+"x"+volLbl(td.vol4h.ratio):"n/a"}

ATR & STOP  1h:${gf(td?.atr1h)} | 4h:${gf(td?.atr4h)} | Recommended stop: ${gf(stopAmt)} (${stopPips??"~35"} pips, 1.5x 4h ATR). Cable daily ATR ~${td?.dailyAtr?Math.round(td.dailyAtr*10000):"90-100"} pips.

MACRO — FRED (USD side)  DXY (Fed TWI):${na(macro.dxy)} ${macro.dxyDir||""} | US 10Y:${na(macro.dgs10)}% | Fed Funds:${na(macro.fedfunds)}%
  (DXY direction is computed locally vs the prior reading — scorecard rule 3 uses it: DXY FALLING = PASS LONG cable, RISING = PASS SHORT. DXY is a dominant filter.)

BOE/FED RATE DIFFERENTIAL — STRUCTURED (FRED, not search)
  UK SONIA (Bank Rate proxy): ${na(macro.sonia)}% ${macro.soniaDir||""}${macro.soniaChg!=null?` (Δ${macro.soniaChg>0?"+":""}${macro.soniaChg}pp over window)`:""} | US Fed Funds: ${na(macro.fedfunds)}%
  UK − US differential: ${macro.rateDiff!=null?`${macro.rateDiff>0?"+":""}${macro.rateDiff}pp — ${macro.rateDiffLbl}`:"unavailable"}
  Use this STRUCTURED differential as the primary BOE-vs-Fed input. Web search is now only for FORWARD guidance (MPC vote split, next-meeting lean) — not for the rate level itself, which is given here.

CABLE CONTEXT
  PDH: ${gf(td?.pdh)} | PDL: ${gf(td?.pdl)} (previous-day high/low — cable stop-hunts these at the London open)${td?.sweep?`
  🎯 LIQUIDITY SWEEP at ${gf(td.sweep.level)} (${td.sweep.side}) — spiked through then closed back inside: ${td.sweep.note}.`:td?.nearPD?`
  ⚠ Price within 15 pips of ${td.nearPD.side} (${gf(td.nearPD.level)}) — London stop-hunt risk; wait for a confirmed break/rejection.`:""}
  UK DATA: search UK CPI/GDP/employment — cable moves hard on these (often 06:00-07:00 UTC) even when USD is quiet. Set uk_data_note if a UK surprise is in play. Weight UK-side binary events as heavily as US ones.
  Session note: London open (07-09 UTC) sets the day's range for cable — the most reliable window. Asian (21-07 UTC) is genuinely thin; fade less, expect chop.

${ta?taPromptBlock(ta, v=>v.toFixed(5)):"MULTI-TIMEFRAME / PATTERNS / FIB: unavailable (no Twelve Data key — score candles & mtf NEUTRAL)"}

=== YOUR JOB: search BOE Bank Rate + guidance, UK CPI/GDP/jobs, GBP news, key S/R, binary events → output JSON ===`;

    return { pkg, price:spot.price, src:spot.src, session, meta:{ td, macro, stopPips, ta } };
  },
  merge:(p,m)=>{
    const { td, macro, ta } = m;
    if(td?.h24&&!p.high_24h) p.high_24h=td.h24.toFixed(5);
    if(td?.l24&&!p.low_24h)  p.low_24h=td.l24.toFixed(5);
    if(td?.vwap&&!p.vwap)    p.vwap=td.vwap.toFixed(5);
    if(td?.ema50)            p.ema50=td.ema50.toFixed(5);
    if(td?.ema200)           p.ema200=td.ema200.toFixed(5);
    if(td?.ma200)            p.ma200=td.ma200.toFixed(5);
    if(td?.pdh!=null)        p.pdh=td.pdh.toFixed(5);
    if(td?.pdl!=null)        p.pdl=td.pdl.toFixed(5);
    if(macro.dxy!==null&&(!p.dxy||p.dxy==="")) p.dxy=`${macro.dxy}${macro.dxyDir?` — ${macro.dxyDir.toLowerCase()}`:""}`;
    if(macro.dgs10!==null&&(!p.real_yield||p.real_yield==="")) p.real_yield=`US 10Y ${macro.dgs10}%`;
    // Structured UK rate data (FRED SONIA) overrides any search-derived differential.
    if(macro.sonia!=null) p.sonia=`${macro.sonia}%${macro.soniaDir?` (${macro.soniaDir.toLowerCase()})`:""}`;
    if(macro.rateDiff!=null) p.rate_diff=`${macro.rateDiff>0?"+":""}${macro.rateDiff}pp — ${macro.rateDiffLbl||""}`;
    if(td?.volRatio!=null) p._volRatio=td.volRatio;
    p._sweepNote = td?.sweep ? `🎯 LIQUIDITY SWEEP at ${td.sweep.level.toFixed(5)} (${td.sweep.side}) — classic stop hunt. Reversal setup: ${td.sweep.note}.`
      : td?.nearPD ? `⚠️ Price near ${td.nearPD.side} (${td.nearPD.level.toFixed(5)}) — London stop-hunt risk. Wait for confirmed break or rejection.` : null;
    p._sources=[...(ta?["Real OHLCV"]:[]),...(macro.dxy!=null?["FRED"]:[])];
    mergeTA(p, ta, v=>v.toFixed(5), GBP.scRows.map(r=>r.key));
  },
};

// ════════════════════════════════════════════════════════════════════════════
// ASSET 3 — BTC/USD
// ════════════════════════════════════════════════════════════════════════════
const BTC = {
  id:"btc", name:"SIGNAL DECK · BITCOIN", symbol:"BTC/USD", headerNote:"BTC/USD · 24/7 · Binance + CoinGecko",
  pricePrefix:"$",
  theme:{ accent:"#f97316", accentText:"#fb923c", panelBg:"#271207", panelBorder:"#7c2d12", loader:"#f97316" },
  keyFields:[
    { field:"anthropic", label:"Anthropic API Key", hint:"required — powers the AI signal", ph:"sk-ant-..." },
  ],
  dataNote:"BTC technicals + on-chain context (blockchain.info + mempool.space) come from free no-key APIs. Only the Anthropic key is needed.",
  session:getCryptoSession,
  quickPrice: async () => {
    try{ const r=await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"); if(r.ok){const d=await r.json();if(+d.price>1000) return {price:p2(d.price),src:"Binance"};} }catch(_){}
    try{ const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"); if(r.ok){const d=await r.json();if(d?.bitcoin?.usd>1000) return {price:p2(d.bitcoin.usd),src:"CoinGecko"};} }catch(_){}
    return null;
  },
  // FREE tier scan (no AI). BTC uses Binance klines — no key, no TD-limit impact.
  // rangeFadeEnabled:false — BTC did not clear the range-fade audit bar, stays untouched.
  scan: async () => {
    const fetchSeries = async (interval) => {
      const iv = interval==="1day"?"1d":interval;
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${iv}&limit=${iv==="1d"?210:100}`);
      if(!r.ok) throw new Error(`Binance ${r.status}`);
      const d = await r.json();
      return { times:d.map(k=>k[0]), opens:d.map(k=>parseFloat(k[1])), highs:d.map(k=>parseFloat(k[2])), lows:d.map(k=>parseFloat(k[3])), closes:d.map(k=>parseFloat(k[4])), volumes:d.map(k=>parseFloat(k[5])) };
    };
    return runTierScan({ fetchSeries, rangeFadeEnabled:false, tdCalls:0 });
  },
  sessionsGuide:[
    { window:"13:00–16:00 UTC", label:"EU-US Overlap — best breakouts", quality:"best" },
    { window:"16:00–21:00 UTC", label:"US Session — highest volume", quality:"best" },
    { window:"08:00–13:00 UTC", label:"Europe — volume picks up", quality:"good" },
    { window:"00:00–08:00 UTC", label:"Asia — lower volume, can trend quietly", quality:"ok" },
  ],
  weekendNote:{ title:"BTC — Pepperstone weekend", lines:[
    "Spread: $5–15 (vs $2–8 weekday)","Volume lower but crypto never fully stops",
    "Watch Sunday 21:00 UTC weekly candle open","Avoid Sat 00:00–08:00 UTC (lowest volume of week)",
  ], rec:"Tradeable but reduce size 30%. Manipulation risk is higher on weekends." },
  events:["FOMC","CPI","PCE"], eventsNote:"BTC is a risk asset — Fed policy & CPI move it. Never hold through these.",
  riskRules:[
    "BTC is FAR more volatile than gold or GBP/USD — size down accordingly",
    "Max 1-2% of account at risk per trade — STRICTLY","ATR-based stop mandatory: 1.5× 4h ATR (often $1,000–3,000)",
    "Minimum R:R 1:2.5 (higher than gold due to volatility)","Never hold through FOMC / CPI",
    "2-loss rule: two consecutive losses → stop trading BTC for 24h","Crowded-long funding at resistance = contrarian SHORT setup (threshold auto-calibrated to the current regime)",
  ],
  // 9-step (was 10): 200-SMA regime (+2pp measured edge) and BTC dominance (no
  // causal link to BTC's own price — it's an alt-rotation metric) demoted to
  // context-only display. The freed weight goes to the funding/OI/ETF trio.
  scTitle:"9-Step Scorecard", passesOf:9,
  scRows:[
    { key:"price",      label:"1. Price & 24h range" },
    { key:"macd",       label:"2. MACD 1h/4h" },
    { key:"rsi",        label:"3. RSI 70/30" },
    { key:"funding_oi", label:"4. Funding + OI ★" },
    { key:"etf",        label:"5. ETF flows ★" },
    { key:"levels",     label:"6. Levels (round #s)" },
    { key:"news",       label:"7. News + Fear/Greed" },
    ...TA_ROWS,
  ],
  readyLines:()=>[
    "✓ Binance (price, OHLCV, funding + history, open interest) — free",
    "✓ CoinGecko dominance (context) · alternative.me Fear & Greed · Web search (ETF flows + news)",
  ],
  levelsTitle:"Key Levels",
  levels:(s)=>[
    { name:"24h High",   val:`$${fmt(s.high_24h)}` },
    { name:"24h Low",    val:`$${fmt(s.low_24h)}` },
    { name:"PDH",        val:`$${fmt(s.pdh)}` },
    { name:"PDL",        val:`$${fmt(s.pdl)}` },
    { name:"200 SMA (D)",val:`$${fmt(s.sma200)}` },
    { name:"Support",    val:`$${fmt(s.support)}` },
    { name:"Resistance", val:`$${fmt(s.resistance)}` },
    { name:"BB Upper (4h)", val:`$${fmt(s.bb_upper)}` },
    { name:"BB Lower (4h)", val:`$${fmt(s.bb_lower)}` },
  ],
  extraPanels:(s)=>(
    <>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
      <div style={card}>
        <p style={lbl}>Derivatives — Binance <span style={{color:"#475569",fontSize:9,fontWeight:400}}>· ★ scored</span></p>
        <Stat title="Funding rate (per 8h)" value={fmt(s.funding_rate)} sub={s.funding_bars?`crowded bars ${s.funding_bars} (auto-calibrated to current regime)`:"crowded bars auto-calibrated to the current regime"}
          color={(()=>{const v=parseFloat(s.funding_rate);const hi=parseFloat(s.funding_hi),lo=parseFloat(s.funding_lo);return (isFinite(hi)&&v>hi)?"#f87171":(isFinite(lo)&&v<lo)?"#4ade80":"#e2e8f0";})()}/>
        <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Open interest {s.oi_trend&&<span style={{color:s.oi_trend==="Rising"?"#4ade80":s.oi_trend==="Falling"?"#f87171":"#94a3b8"}}>· {s.oi_trend}</span>}</p>
        <p style={{...mono,fontSize:13,margin:0,color:"#e2e8f0"}}>{fmt(s.open_interest)}</p></div>
      </div>
      <div style={card}>
        <p style={lbl}>Market structure</p>
        <Stat title="ETF daily flow ★" value={fmt(s.etf_flow)} sub="inflows = institutional buying (scored)"/>
        <Stat title="BTC dominance" value={fmt(s.btc_dominance)} sub="CONTEXT ONLY (not scored) — alt-rotation metric, no clear link to BTC's own price"/>
        <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Fear & Greed</p>
        <p style={{...mono,fontSize:12,margin:0,color:(()=>{const v=parseInt(s.fear_greed);return v<20?"#4ade80":"#94a3b8";})()}}>{fmt(s.fear_greed)} {(()=>{const v=parseInt(s.fear_greed);return v<20?"(Extreme Fear → contrarian LONG)":v>80?"(Extreme Greed → elevated only, not a short)":"";})()}</p></div>
      </div>
    </div>
    {/* ON-CHAIN CONTEXT (Section 2) — supplementary, feeds AI reasoning */}
    <div style={{...card,marginBottom:10}}>
      <p style={lbl}>On-Chain Context <span style={{color:"#475569",fontSize:9,fontWeight:400}}>· blockchain.info + mempool.space · free-tier · supplementary</span></p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:6}}>
        <div><p style={{fontSize:9,color:"#475569",margin:"0 0 2px"}}>Miners' revenue</p><p style={{...mono,fontSize:11,margin:0,color:"#e2e8f0"}}>{fmt(s.oc_miners)}</p></div>
        <div><p style={{fontSize:9,color:"#475569",margin:"0 0 2px"}}>Transactions/day</p><p style={{...mono,fontSize:11,margin:0,color:"#e2e8f0"}}>{fmt(s.oc_ntx)}</p></div>
        <div><p style={{fontSize:9,color:"#475569",margin:"0 0 2px"}}>Hash rate</p><p style={{...mono,fontSize:11,margin:0,color:"#e2e8f0"}}>{fmt(s.oc_hash)}</p></div>
        <div><p style={{fontSize:9,color:"#475569",margin:"0 0 2px"}}>Mempool / fees</p><p style={{...mono,fontSize:11,margin:0,color:"#e2e8f0"}}>{fmt(s.oc_mempool)}</p></div>
      </div>
      {s.oc_whale&&<p style={{fontSize:11,color:"#fb923c",...mono,margin:0}}>🐋 Whale-sized transaction detected — {s.oc_whale}</p>}
    </div>
    </>
  ),
  system:`You are SIGNAL DECK BITCOIN, a BTC/USD analysis engine for paper trading education only. Not financial advice. Never fabricate prices.

ALL TECHNICAL DATA IS PRE-COMPUTED AND PROVIDED — do not search for price, MACD, RSI, ATR, 200 SMA, funding rate, open interest, dominance, or Fear & Greed. These come from Binance/CoinGecko APIs.

YOUR JOB (web search only):
1. ETF FLOWS (most important): Bitcoin spot ETF daily flows — BlackRock IBIT, Fidelity FBTC. Net inflows = bullish, outflows = bearish.
2. ON-CHAIN / WHALES: Exchange inflows/outflows, whale movements, notable on-chain analytics summaries (free sources).
3. NEWS: Crypto regulatory news last 24h, major exchange news, Fed policy impact on risk assets.
4. MACRO RISK: Nasdaq/VIX risk-on vs risk-off. Risk-on = bullish BTC, risk-off = bearish.
5. BIAS SYNTHESIS: All pre-computed data + research → highest-probability direction.

KEY BTC LOGIC:
- Funding rate (critical): use the AUTO-CALIBRATED crowded bars given in the DERIVATIVES block (they adapt to the current regime). Above the crowded-long bar = overleveraged longs = contrarian SHORT lean. Below the crowded-short bar = crowded shorts = contrarian LONG lean. Do NOT use legacy fixed bars (0.1% / -0.05%) — real funding never reaches them.
- ETF flows are the leading institutional indicator: strong inflows = BULLISH, outflows = BEARISH.
- Fear & Greed is ASYMMETRIC: Extreme Fear (<20) = contrarian LONG (real measured edge). Extreme Greed (>80) is NOT a contrarian short — it is only elevated sentiment; never short on greed alone.
- Risk-on (Nasdaq up, VIX down) = BULLISH; risk-off = BEARISH.
- Funding / OI / ETF flows are the highest-weight BTC-specific inputs — weight them above the price-derived rows.
- CONTEXT ONLY (never a scored row, never a directional reason): the 200 SMA regime (+2pp measured edge) and BTC dominance (an alt-rotation metric with no clear causal link to BTC's own price).

7-STEP SCORECARD (+2 TA rows = 9 scored items):
1. PRICE & RANGE: upper third of 24h range + momentum = PASS LONG; lower third = PASS SHORT; mid = NEUTRAL.
2. MACD 1h/4h: both above signal = PASS LONG; both below = PASS SHORT; split = NEUTRAL. (Lagging confirmer — do not treat as leading.)
3. RSI (70/30, no 200SMA): 50-70 = PASS LONG; 30-50 = PASS SHORT; >70/<30 = NEUTRAL for entry. The 200 SMA is context only now — do NOT require it for this row.
4. FUNDING + OI ★: contrarian funding (vs the AUTO-CALIBRATED bars) aligned with the trade + OI rising into the move = PASS; extreme funding against = FAIL. Highest-weight row.
5. ETF FLOWS ★: inflows = PASS LONG; outflows = PASS SHORT; flat/unknown = NEUTRAL. Highest-weight row.
6. LEVELS: near round-number support ($90k/$95k/$100k) for LONG or resistance for SHORT = PASS; mid-range = FAIL.
7. NEWS + F&G: bullish catalyst = PASS; bearish = FAIL; unclear = NEUTRAL. Extreme FEAR (<20) counts as a PASS toward LONG. Extreme GREED does NOT count as a PASS toward SHORT (no measured edge).
(Dominance and the 200 SMA are NOT scored — context only. Do not create "dominance" or "rsi_sma" scorecard entries.)

SIGNAL RULES:
- Binary event (FOMC/CPI/PCE) UPCOMING within the next 24h → WAIT (never hold BTC through macro). An event 24–72h away is CAUTION ONLY (note it, reduce size) — it does NOT force WAIT. Already-released events do NOT force WAIT once 30+ min have passed — trade the post-event trend.
- ALWAYS output a directional call (LONG or SHORT) unless genuinely no setup. Base direction on the balance of the scorecard + trend context. Output WAIT ONLY if signal_quality <35 OR a binary event is within 24h. Weaker setups → output the direction with LOW confidence rather than a blanket WAIT.
- MULTI-TIMEFRAME: prefer trading with the 4h trend. If 4h and 1h conflict → still output the signal but cap confidence at LOW (counter-trend risk — advise reduced size). Only WAIT if all three timeframes (4h/1h/15m) disagree. 15m is for entry timing.
- A reversal candle pattern at a key level against the trend caps confidence at MEDIUM and can flip the call to WAIT.
- SIGNAL QUALITY: <35 = WAIT; 35-50 = LOW confidence (trade at own risk, minimum size); 50-70 = MEDIUM; 70-85 = HIGH; 85+ = VERY HIGH..
- Funding above the auto-calibrated crowded-long bar + price at resistance = high-probability SHORT.
- Stop: use the ATR-based value provided (do not widen) — this defines 1R.
- TARGETS: T1/T2 are NOT fixed — they SCALE with the higher-timeframe confirmation rung, and the exact values for this signal are in the TARGET DISTANCE line of the multi-timeframe block below. Use those. They are calibrated so every signal lands near a ~60% T1 hit rate. Do not substitute your own multiple, and do not stretch T1 to chase a rounder R:R.
- Minimum R:R measured at T2 is 1:2, which the tier-scaled T2 delivers at tiers 1-3. Do NOT force WAIT for failing to reach 1:2.5 — the targets are calibrated for hit rate, not for a round R:R, and stretching T2 to 2.5R drops the BTC hit rate from ~39% to below 30%.
- Weekend/low-volume + no catalyst → cap confidence at MEDIUM.

Respond ONLY with valid JSON, no markdown, no text outside it:
{"action":"LONG|SHORT|WAIT","price":"XXXXX.XX","confidence":"HIGH|MEDIUM|LOW","entry":"XXXXX.XX","entry_note":"brief","stop":"XXXXX.XX","stop_note":"1.5x ATR","stop_pct":"2.1","t1":"XXXXX.XX","t2":"XXXXX.XX","rr":"1:2.5","high_24h":"XXXXX.XX","low_24h":"XXXXX.XX","support":"XXXXX.XX","resistance":"XXXXX.XX","sma200":"XXXXX.XX","funding_rate":"0.010%","open_interest":"XXXXX BTC","btc_dominance":"55.8%","fear_greed":"15 Extreme Fear","etf_flow":"+$250M IBIT","passes":5,"scorecard":{"price":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"macd":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"rsi":{"r":"PASS|FAIL|NEUTRAL","note":"RSI 70/30 only"},"funding_oi":{"r":"PASS|FAIL|NEUTRAL","note":"vs calibrated bars"},"etf":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"levels":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"news":{"r":"BULLISH|BEARISH|NEUTRAL","note":"brief"},"candles":{"r":"PASS|FAIL|NEUTRAL","note":"pattern name + tf"},"mtf":{"r":"PASS|FAIL|NEUTRAL","note":"4h/1h/15m agree?"}},"signal_quality":"78/100 — STRONG","entry_type":"Pattern|Optimal|Aggressive|Conservative","reasoning":"2 sentences","exits":["T1 $XXXXX — close 50% move stop to entry","T2 $XXXXX — close rest","Stop $XXXXX — full exit","Time — 4h max"],"news_hl":"headline","news_sent":"BULLISH|BEARISH|NEUTRAL","binary_event":"none or event+timing","data_note":"brief or empty","sources":["url1"],"wait_type":"binary_event|low_confidence|no_setup|wrong_session|none","triggers":{"watch_long":"price or n/a","watch_long_note":"why","watch_short":"price or n/a","watch_short_note":"why","invalidation":"price","invalidation_note":"what the break means","next_session":"HH:MM UTC","next_session_note":"session + why","news_time":"HH:MM UTC or none","news_event":"name or none","candle_close":"HH:MM UTC","candle_close_note":"1h/4h + why","mtf_fix":"what must change","pattern_needed":"pattern + level","indicator_needed":"indicator condition","primary_reason":"main reason","secondary_reason":"second or none","estimated_clarity":"when clearer","refresh_recommendation":"specific actionable line"}}`,

  pipeline: async ({ keys, addLog }) => {
    const klines = async (interval, limit=100) => {
      const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
      if(!r.ok) throw new Error(`Binance klines ${r.status}`);
      const d=await r.json();
      return { times:d.map(k=>k[0]), opens:d.map(k=>parseFloat(k[1])), closes:d.map(k=>parseFloat(k[4])), highs:d.map(k=>parseFloat(k[2])), lows:d.map(k=>parseFloat(k[3])), volumes:d.map(k=>parseFloat(k[5])) };
    };

    const jget = u => fetch(u).then(r=>r.ok?r.json():null).catch(()=>null);
    // blockchain.info charts (Section 2) — free, no key. cors=true for browser use.
    const bcChart = c => jget(`https://api.blockchain.info/charts/${c}?timespan=8days&format=json&cors=true`);
    addLog("Fetching BTC market + on-chain data in parallel (Binance + CoinGecko + blockchain.info + mempool.space)...");
    const [tickerR, c15, c1h, c4h, c1d, c1w, fundingR, oiR, oiHistR, domR, fngR, minersR, ntxR, hashR, mempoolR, feesR] = await Promise.all([
      jget("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"),
      klines("15m",100).catch(()=>null), klines("1h",100).catch(()=>null), klines("4h",100).catch(()=>null),
      klines("1d",220).catch(()=>null), klines("1w",2).catch(()=>null),
      jget("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=200"),
      jget("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT"),
      jget("https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=4h&limit=2"),
      jget("https://api.coingecko.com/api/v3/global"),
      jget("https://api.alternative.me/fng/?limit=1"),
      bcChart("miners-revenue"), bcChart("n-transactions"), bcChart("hash-rate"),
      // mempool.space (Section 4) — free, no key: congestion + fee pressure proxy.
      jget("https://mempool.space/api/mempool"), jget("https://mempool.space/api/v1/fees/recommended"),
    ]);

    let spot=null, h24=null, l24=null, chg=null;
    if(tickerR&&parseFloat(tickerR.lastPrice)>1000){ spot={price:p2(tickerR.lastPrice),src:"Binance"}; h24=p2(tickerR.highPrice); l24=p2(tickerR.lowPrice); chg=parseFloat(tickerR.priceChangePercent); }
    if(!spot){ const d=await jget("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"); if(d?.bitcoin?.usd>1000) spot={price:p2(d.bitcoin.usd),src:"CoinGecko"}; }
    if(!spot) throw new Error("Could not fetch BTC price from Binance or CoinGecko.");
    addLog(`Spot: $${spot.price} (${spot.src})${chg!=null?` 24h ${chg>0?"+":""}${chg}%`:""}`);

    let td=null, ta=null;
    if(c1h&&c4h&&c1d&&c15){ try{
      const macd1h=calcMACD(c1h.closes), rsi1h=calcRSI(c1h.closes), vol1h=calcVolRatio(c1h.volumes);
      const macd4h=calcMACD(c4h.closes), rsi4h=calcRSI(c4h.closes), atr4h=calcATR(c4h.highs,c4h.lows,c4h.closes), vol4h=calcVolRatio(c4h.volumes);
      const sma200=calcSMA(c1d.closes,200);
      let weeklyDir="n/a"; if(c1w){ const i=c1w.closes.length-1; weeklyDir=c1w.closes[i]>=c1w.opens[i]?"BULLISH":"BEARISH"; }
      // whale wick on the latest 4h candle: wick > 3× body
      const li=c4h.closes.length-1; const body=Math.abs(c4h.closes[li]-c4h.opens[li])||1e-9;
      const upW=c4h.highs[li]-Math.max(c4h.opens[li],c4h.closes[li]), loW=Math.min(c4h.opens[li],c4h.closes[li])-c4h.lows[li];
      const whaleWick=(upW>3*body||loW>3*body)?(upW>loW?"upper (rejection — bearish)":"lower (absorption — bullish)"):null;
      const pdh=c1d&&c1d.highs.length>=2?c1d.highs[c1d.highs.length-2]:null;
      const pdl=c1d&&c1d.lows.length>=2?c1d.lows[c1d.lows.length-2]:null;
      td={ macd1h,rsi1h,vol1h, macd4h,rsi4h,atr4h,vol4h, sma200, weeklyDir, whaleWick, pdh,pdl };
      ta=analyzeTimeframes({ c15, c1h, c4h, c1d, c4hTimes:c4h.times, price:spot.price, atr4h, prevClose:c1d?c1d.closes[c1d.closes.length-2]:null });
      addLog(`MTF 4h:${ta.t4} 1h:${ta.t1} 15m:${ta.t15} ADX:${ta.adx?.toFixed(0)} pull:${ta.pull?.state||"—"} weekly:${weeklyDir}`);
    }catch(e){ addLog(`Binance candles error: ${e.message}`); } }
    else addLog("⚠ Binance candles unavailable — MTF/patterns/ATR skipped (Binance may be geo-restricted or rate-limited in your region). Price falls back to CoinGecko; TA scores NEUTRAL.");

    let funding=null, oi=null, oiTrend="—", dom=null, fng=null, fngLabel=null;
    // ── FUNDING, ROLLING-PERCENTILE CALIBRATED ────────────────────────────────
    // The old fixed bars (>+0.1% / <-0.05% per 8h) NEVER fired: measured funding
    // maxes near +0.010%/8h in the current regime, so the signal was dead. We now
    // derive crowded bars from the trailing ~200 funding prints (p85/p15) so they
    // self-calibrate to whatever regime we're in. Fixed fallbacks (+0.01/-0.005)
    // are used only if history is unavailable.
    let fundHi=0.01, fundLo=-0.005, fundBarSrc="fallback (fixed)";
    if(Array.isArray(fundingR)&&fundingR.length){
      const hist=fundingR.map(x=>parseFloat(x.fundingRate)*100).filter(v=>isFinite(v));
      funding=hist[hist.length-1]??null; // newest print is last
      if(hist.length>=30){
        const s=[...hist].sort((a,b)=>a-b);
        fundHi=s[Math.floor(0.85*(s.length-1))]; fundLo=s[Math.floor(0.15*(s.length-1))];
        fundBarSrc=`rolling p85/p15 of ${hist.length} prints`;
      }
    } else if(fundingR?.[0]?.fundingRate!=null) funding=parseFloat(fundingR[0].fundingRate)*100;
    if(oiR?.openInterest) oi=parseFloat(oiR.openInterest);
    if(Array.isArray(oiHistR)&&oiHistR.length>=2){ const a=parseFloat(oiHistR[oiHistR.length-1].sumOpenInterest), b=parseFloat(oiHistR[oiHistR.length-2].sumOpenInterest); if(a&&b) oiTrend=a>b*1.005?"Rising":a<b*0.995?"Falling":"Flat"; }
    if(domR?.data?.market_cap_percentage?.btc!=null) dom=domR.data.market_cap_percentage.btc;
    if(fngR?.data?.[0]?.value){ fng=parseInt(fngR.data[0].value); fngLabel=fngR.data[0].value_classification; }
    addLog(`Funding:${funding!=null?funding.toFixed(4)+"%":"n/a"} (crowded bars ${fundHi.toFixed(4)}/${fundLo.toFixed(4)} — ${fundBarSrc}) OI:${oi!=null?Math.round(oi).toLocaleString():"n/a"}(${oiTrend}) Dom:${dom!=null?dom.toFixed(1)+"%":"n/a"} F&G:${fng!=null?fng+" "+fngLabel:"n/a"}`);

    // ── ON-CHAIN CONTEXT: blockchain.info trends + whale flag + mempool.space ──
    const bcLatest = r => { const v=r?.values; if(!Array.isArray(v)||!v.length) return null; const last=v[v.length-1]?.y, first=v[0]?.y; const dir=(last!=null&&first!=null)?(last>first*1.02?"RISING":last<first*0.98?"FALLING":"FLAT"):"unknown"; return { val:last, dir }; };
    const miners=bcLatest(minersR), ntx=bcLatest(ntxR), hash=bcLatest(hashR);
    addLog(`On-chain → miners rev:${miners?.val!=null?"$"+Math.round(miners.val).toLocaleString():"n/a"}(${miners?.dir||"?"}) tx/day:${ntx?.val!=null?Math.round(ntx.val).toLocaleString():"n/a"}(${ntx?.dir||"?"}) hash:${hash?.val!=null?hash.dir:"n/a"}`);
    // Whale flag from EXISTING data (no new API): largest recent 15m candle's share of
    // 24h volume. 15m ≈ 1% of a day, so a single candle >2% of daily volume is an
    // outsized block. (Per-trade granularity would need a new API, which we avoid.)
    let whale=null;
    if(c15?.volumes?.length && tickerR?.volume){
      const v24=parseFloat(tickerR.volume);
      const recent=c15.volumes.slice(-8);
      const maxV=Math.max(...recent);
      const share=v24>0?maxV/v24:0;
      if(share>0.02) whale={ pct:p2(share*100), note:"whale-sized transaction detected" };
    }
    // mempool.space (Section 4) — free network-congestion / fee-pressure proxy.
    // Rising fees + a full mempool = on-chain demand/congestion, which often
    // accompanies volatility. Free replacement for the dropped paid on-chain depth feed.
    let mempool=null;
    { const fast=feesR?.fastestFee, hour=feesR?.hourFee, count=mempoolR?.count, vsize=mempoolR?.vsize;
      if(fast!=null || count!=null){
        const pressure = fast!=null ? (fast>50?"HIGH":fast>20?"ELEVATED":fast>8?"NORMAL":"LOW") : null;
        mempool={ fastestFee:fast, hourFee:hour, count, vsize, pressure };
        addLog(`mempool.space → ${count!=null?count.toLocaleString()+" unconfirmed txs":"n/a"} | fastest fee ${fast!=null?fast+" sat/vB":"n/a"}${pressure?" ("+pressure+" pressure)":""}`);
      } else addLog("mempool.space unavailable");
    }
    const onchain={ miners, ntx, hash, whale, mempool };

    const session=getCryptoSession();
    const atr=td?.atr4h??null;
    const stopAmt=atr?p2(atr*1.5):null, stopPct=stopAmt?p2((stopAmt/spot.price)*100):null;

    const fundLbl = funding!=null?(funding>fundHi?" (CROWDED LONGS — contrarian bearish)":funding<fundLo?" (CROWDED SHORTS — contrarian bullish)":" (neutral)"):"";
    // F&G is ASYMMETRIC in the data: extreme fear (<20) preceded a bounce 62% of the
    // time (n=114), but extreme greed (>80) was a 51% coinflip — so greed is NOT
    // treated as a contrarian short, only noted as elevated sentiment.
    const fngTxt  = fng!=null?(fng<20?" (Extreme Fear — contrarian LONG, measured edge)":fng>80?" (Extreme Greed — elevated sentiment ONLY; NOT a contrarian short)":""):"";

    const pkg=`=== PRE-COMPUTED MARKET DATA — DO NOT RE-FETCH ===

PRICE
  BTC/USD Spot: $${spot.price} (${spot.src})${chg!=null?` | 24h change ${chg>0?"+":""}${chg}%`:""}
  24h High: $${na(h24)} | 24h Low: $${na(l24)} | PDH: $${f2(td?.pdh)} | PDL: $${f2(td?.pdl)}
  Session: ${session.label}

MACD  1h: line=${f1(td?.macd1h?.macd)} ${td?.macd1h?.aboveSignal?"ABOVE":"BELOW"} signal | 4h: line=${f1(td?.macd4h?.macd)} ${td?.macd4h?.aboveSignal?"ABOVE":"BELOW"} signal ${td?.macd4h?.expanding?"(expanding)":"(contracting)"}

RSI (14, standard 70/30 — verified: BTC reverses at >70)  1h:${f1(td?.rsi1h)}${rsiLbl(td?.rsi1h)} | 4h:${f1(td?.rsi4h)}${rsiLbl(td?.rsi4h)}

VOLUME (vs 20-avg)  1h:${td?.vol1h?td.vol1h.ratio.toFixed(2)+"x"+volLbl(td.vol1h.ratio):"n/a"} | 4h:${td?.vol4h?td.vol4h.ratio.toFixed(2)+"x"+volLbl(td.vol4h.ratio):"n/a"}

DERIVATIVES ★ (highest-weight BTC-specific block — funding/OI/ETF)
  Funding (8h): ${funding!=null?funding.toFixed(4)+"%":"n/a"}${fundLbl}
  Crowded bars are AUTO-CALIBRATED to the current regime: crowded-long >${fundHi.toFixed(4)}%, crowded-short <${fundLo.toFixed(4)}% (${fundBarSrc}). Use THESE bars — legacy fixed bars like 0.1%/-0.05% are far outside today's real funding range and would never trigger.
  Open Interest: ${oi!=null?Math.round(oi).toLocaleString()+" BTC":"n/a"} (trend: ${oiTrend} over last 4h${oiTrend==="Rising"?" — new positions, strong move":oiTrend==="Falling"?" — positions closing, possible liquidations":""})

SENTIMENT  Fear & Greed: ${fng!=null?fng+" "+fngLabel:"n/a"}${fngTxt}
  ASYMMETRY RULE (measured): extreme FEAR <20 is a genuine contrarian LONG (62% up-rate over the next 3 days, n=114). Extreme GREED >80 is NOT a contrarian short (51% = coinflip) — never output a SHORT because greed is high.

CONTEXT ONLY — NOT SCORED (do not create scorecard entries for these)
  200 SMA (daily): $${f2(td?.sma200)} → price ${td?.sma200?(spot.price>td.sma200?"above":"below"):"unknown"} (measured regime edge only +2pp for BTC — treat as background, not a directional reason)
  BTC Dominance: ${dom!=null?dom.toFixed(1)+"%":"n/a"} (an alt-rotation metric; no clear causal link to BTC's own price — background only)

ATR & STOP (4h)  ATR:$${f2(td?.atr4h)} | Recommended stop: $${na(stopAmt)} (${na(stopPct)}%, 1.5x ATR) — BTC stops are large, size position accordingly

BTC CONTEXT  Weekly candle: ${td?.weeklyDir||"n/a"} (first weekly candle has 60%+ predictive value for the week) | Whale wick (4h): ${td?.whaleWick||"none"}
  Funding+pattern combo: funding ${funding!=null?funding.toFixed(4)+"%":"n/a"} ${funding>0.1?"+ bearish candle at resistance = STRONG SHORT":funding<-0.05?"+ bullish candle at support = STRONG LONG":""}. 4h volume >300% avg = institutional move, weight heavily.

ON-CHAIN CONTEXT (free-tier proxies: blockchain.info + mempool.space — SUPPLEMENTARY context feeding your reasoning alongside funding/OI, NOT a standalone gate)
  Miners' revenue: ${miners?.val!=null?"$"+Math.round(miners.val).toLocaleString():"n/a"} (${miners?.dir||"?"} vs last week — sharply falling can pressure price via miner selling/capitulation)
  Transactions/day: ${ntx?.val!=null?Math.round(ntx.val).toLocaleString():"n/a"} (${ntx?.dir||"?"} — rising = network usage/demand increasing, supportive)
  Hash rate: ${hash?.val!=null?hash.val.toExponential(2):"n/a"} (${hash?.dir||"?"} — rising = miner confidence/network security up)
  Network congestion / fees (mempool.space): ${mempool?`${mempool.count!=null?mempool.count.toLocaleString()+" unconfirmed txs":"n/a"} | fastest fee ${mempool.fastestFee!=null?mempool.fastestFee+" sat/vB":"n/a"} → ${mempool.pressure||"n/a"} fee pressure (rising fees/backlog = on-chain demand & congestion, which often accompanies volatility)`:"n/a"}
  Whale activity: ${whale?`⚠ ${whale.note} — a single 15m candle carried ${whale.pct}% of 24h volume (outsized block, possible whale/institutional print)`:"no outsized single-candle volume burst detected in the last 2h"}

${ta?taPromptBlock(ta, v=>"$"+f2(v)):"MULTI-TIMEFRAME / PATTERNS / FIB: unavailable — score candles & mtf NEUTRAL"}

=== YOUR JOB: search BTC spot ETF daily flows (IBIT/FBTC — MOST IMPORTANT), whale/on-chain, regulatory news, Nasdaq/VIX risk tone, key round-number S/R, binary events → output JSON ===`;

    return { pkg, price:spot.price, src:spot.src, session,
      meta:{ td, h24, l24, funding, fundHi, fundLo, oi, oiTrend, dom, fng, fngLabel, ta, onchain } };
  },
  merge:(p,m)=>{
    const { td, h24, l24, funding, fundHi, fundLo, oi, oiTrend, dom, fng, fngLabel, ta, onchain } = m;
    // Calibrated funding bars surfaced for the UI colour/threshold display.
    if(fundHi!=null){ p.funding_hi=String(fundHi); p.funding_lo=String(fundLo); p.funding_bars=`>${fundHi.toFixed(4)}% / <${fundLo.toFixed(4)}%`; }
    if(onchain){
      const oc=onchain;
      if(oc.miners?.val!=null) p.oc_miners=`$${Math.round(oc.miners.val).toLocaleString()} · ${oc.miners.dir?.toLowerCase()}`;
      if(oc.ntx?.val!=null)    p.oc_ntx=`${Math.round(oc.ntx.val).toLocaleString()}/day · ${oc.ntx.dir?.toLowerCase()}`;
      if(oc.hash?.val!=null)   p.oc_hash=`${oc.hash.dir?.toLowerCase()}`;
      if(oc.whale)             p.oc_whale=`${oc.whale.pct}% of 24h vol in one 15m candle`;
      if(oc.mempool){ const mp=oc.mempool; p.oc_mempool=`${mp.count!=null?mp.count.toLocaleString()+" txs":"n/a"}${mp.fastestFee!=null?` · ${mp.fastestFee} sat/vB`:""}${mp.pressure?` (${mp.pressure})`:""}`; }
    }
    if(h24!=null&&!p.high_24h) p.high_24h=String(h24);
    if(l24!=null&&!p.low_24h)  p.low_24h=String(l24);
    if(td?.sma200)             p.sma200=td.sma200.toFixed(2);
    if(td?.pdh!=null)          p.pdh=td.pdh.toFixed(2);
    if(td?.pdl!=null)          p.pdl=td.pdl.toFixed(2);
    if(funding!=null)          p.funding_rate=`${funding.toFixed(4)}%`;
    if(oi!=null)               p.open_interest=`${Math.round(oi).toLocaleString()} BTC`;
    if(oiTrend)                p.oi_trend=oiTrend;
    if(dom!=null)              p.btc_dominance=`${dom.toFixed(1)}%`;
    if(fng!=null&&(!p.fear_greed||p.fear_greed==="")) p.fear_greed=`${fng} ${fngLabel||""}`.trim();
    p._sources=[...(ta?["Binance OHLCV"]:[]),...(dom!=null?["CoinGecko"]:[]),...(funding!=null?["Funding/OI"]:[])];
    mergeTA(p, ta, v=>v.toFixed(2), BTC.scRows.map(r=>r.key));
  },
};

export const ASSETS = { gold:GOLD, gbp:GBP, btc:BTC };
