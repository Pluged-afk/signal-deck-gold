// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL DECK — asset definitions. Each asset is a self-contained engine config:
// its own system prompt, data pipeline, scorecard, levels, panels and risk model.
// Only the selected asset's `pipeline` ever runs.
// ═══════════════════════════════════════════════════════════════════════════
import {
  mono, card, lbl, fmt, p2, p5,
  calcMACD, calcRSI, calcATR, calcSMA, calcVWAP, calcVolRatio,
  getFxSession, getCryptoSession, getUS500Session,
  f1, f2, f3, na, rsiLbl, rsiLblGold, volLbl, tdFetch, proxyDataUrl,
} from "./shared";
import { analyzeTimeframes, signalQuality, taPromptBlock } from "./ta";

// Two scorecard rows shared by every asset (multi-timeframe + candle patterns).
const TA_ROWS = [
  { key:"candles", label:"9. Candle Patterns" },
  { key:"mtf",     label:"10. MTF Alignment (4h/1h/15m)" },
];

const ff = v => (v||v===0) ? v.toFixed(5) : "n/a"; // forex 5-dp formatter

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
function mergeTA(p, ta, fnum) {
  if (!ta) return;
  p._ta = ta;
  const q = signalQuality(p, ta);
  p.signal_quality = `${q.score}/100`;
  p._quality = q;
  if ((!p.support || p.support === "") && ta.sr.support[0]) p.support = fnum(ta.sr.support[0].level);
  if ((!p.resistance || p.resistance === "") && ta.sr.resistance[0]) p.resistance = fnum(ta.sr.resistance[0].level);
  if (!p.entry_type && ta.entries) p.entry_type = ta.entries.recommended;
  if (ta.bb) { p.bb_upper = fnum(ta.bb.upper); p.bb_lower = fnum(ta.bb.lower); p.bb_regime = ta.bb.regime; }
}

// ════════════════════════════════════════════════════════════════════════════
// ASSET 1 — GOLD (XAU/USD) — 10-step engine with multi-timeframe TA
// ════════════════════════════════════════════════════════════════════════════
const GOLD = {
  id:"gold", name:"SIGNAL DECK GOLD", symbol:"XAU/USD", headerNote:"XAU/USD · 8-Step · Real APIs",
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
    "Exit 100% before any FOMC / CPI / NFP / PCE release","COT net >200k + resistance = high SHORT probability — respect it",
  ],
  scTitle:"10-Step Scorecard", passesOf:10,
  scRows:[
    { key:"price",     label:"1. Price & VWAP" },
    { key:"macd",      label:"2. MACD 1h/4h/Daily" },
    { key:"rsi_ma",    label:"3. RSI 80/20 + 200MA" },
    { key:"volume",    label:"4. Volume Confirmation" },
    { key:"dxy_yield", label:"5. DXY + Real Yield" },
    { key:"cot",       label:"6. COT Positioning" },
    { key:"history",   label:"7. Levels / Context" },
    { key:"news",      label:"8. News / Macro" },
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
        <p style={lbl}>COT Positioning <span style={{color:"#475569",fontSize:9,fontWeight:400}}>· CFTC weekly</span></p>
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
3. MACRO CONTEXT: FOMC/CPI/NFP/PCE within 48h? Fed speakers today? Geopolitical events?
4. BIAS SYNTHESIS: All pre-computed data + research → highest-probability directional bias.

8-STEP SCORECARD RULES:
1. PRICE & VWAP: Upper/lower third of 24h range AND above/below VWAP → same direction = PASS.
2. MACD MULTI-TF: 1h+4h+Daily all above signal = PASS LONG. All below = PASS SHORT. 2/3 = NEUTRAL. 1/3 or 0/3 = FAIL.
3. RSI + 200MA (GOLD-CALIBRATED 80/20): RSI 50-80 + price above 200MA = PASS LONG. RSI 20-50 + below 200MA = PASS SHORT. Extremes (>80 or <20) = NEUTRAL for entry. Gold runs hotter than forex — do NOT treat 70/30 as extreme; only 80/20 counts as overbought/oversold for gold.
4. VOLUME: Ratio >1.5x avg = PASS (confirms). 0.8-1.5x = NEUTRAL. <0.8x = FAIL (weak move).
5. DXY + REAL YIELD: Both falling = PASS LONG. Both rising = PASS SHORT. Conflict = NEUTRAL.
6. COT: Net MM <100k = room for longs = PASS LONG. Net >200k = crowded = FAIL LONG/PASS SHORT. 100-200k = NEUTRAL.
7. LEVELS: Price within 0.3% of key structural support (LONG) or resistance (SHORT) = PASS. Middle of range = FAIL.
8. NEWS: Confirmed bullish catalyst = PASS. Bearish = FAIL. Unclear = NEUTRAL.

SIGNAL RULES:
- Binary event (FOMC/CPI/NFP/PCE) UPCOMING within the next 24h → WAIT. An event that has ALREADY RELEASED does NOT force WAIT: once 30+ minutes have passed since release, trade the post-event trend normally (use the POST-NFP guidance when provided). Never output wait_type binary_event for a past release.
- ALWAYS output a directional call (LONG or SHORT) unless genuinely no setup. Base direction on the balance of the scorecard + trend context. Output WAIT ONLY if signal_quality <35 OR a binary event is within 24h. Weaker setups → output the direction with LOW confidence rather than a blanket WAIT.
- MULTI-TIMEFRAME: prefer trading with the 4h trend. If 4h and 1h conflict → still output the signal but cap confidence at LOW (counter-trend risk — advise reduced size). Only WAIT if all three timeframes (4h/1h/15m) disagree. 15m is for entry timing.
- A reversal candle pattern at a key level against the trend caps confidence at MEDIUM and can flip the call to WAIT.
- SIGNAL QUALITY: <35 = WAIT; 35-50 = LOW confidence (trade at own risk, minimum size); 50-70 = MEDIUM; 70-85 = HIGH; 85+ = VERY HIGH.
- Three-timeframe MACD alignment is a strong standalone signal — weight it heavily
- DXY and yield conflict → confidence capped at MEDIUM
- Low volume breakout → confidence capped at MEDIUM
- COT net >200k + price at resistance = high-probability SHORT
- Stop: use the ATR-based value provided. Do not widen it.
- T1: min 1.5× ATR from entry. T2: min 2.5× ATR. R:R <1:2 → WAIT
- Off-peak session + no strong catalyst → cap confidence at MEDIUM

Respond ONLY with valid JSON, no markdown, no text outside it:
{"action":"LONG|SHORT|WAIT","price":"XXXX.XX","confidence":"HIGH|MEDIUM|LOW","entry":"XXXX.XX","entry_note":"brief","stop":"XXXX.XX","stop_note":"ATR-based","stop_pct":"0.7","t1":"XXXX.XX","t2":"XXXX.XX","rr":"1:2.5","high_24h":"XXXX.XX","low_24h":"XXXX.XX","vwap":"XXXX.XX","support":"XXXX.XX","resistance":"XXXX.XX","ma200":"XXXX.XX","dxy":"XXX.XX","dxy_nfp":"post-NFP DXY reaction or empty","real_yield":"X.XX%","cot_net":"XXXXX","cot_sentiment":"NEUTRAL","passes":5,"scorecard":{"price":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"macd":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"rsi_ma":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"volume":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"dxy_yield":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"cot":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"history":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"news":{"r":"BULLISH|BEARISH|NEUTRAL","note":"brief"},"candles":{"r":"PASS|FAIL|NEUTRAL","note":"pattern name + tf"},"mtf":{"r":"PASS|FAIL|NEUTRAL","note":"4h/1h/15m agree?"}},"signal_quality":"78/100 — STRONG","entry_type":"Pattern|Optimal|Aggressive|Conservative","reasoning":"2 sentences","exits":["T1 $XXXX — close 50% move stop to entry","T2 $XXXX — close rest","Stop $XXXX — full exit","Time — 4h max"],"news_hl":"headline","news_sent":"BULLISH|BEARISH|NEUTRAL","binary_event":"none or event+timing","data_note":"brief or empty","sources":["url1"],"wait_type":"binary_event|low_confidence|no_setup|wrong_session|none","triggers":{"watch_long":"price or n/a","watch_long_note":"why","watch_short":"price or n/a","watch_short_note":"why","invalidation":"price","invalidation_note":"what the break means","next_session":"HH:MM UTC","next_session_note":"session + why","news_time":"HH:MM UTC or none","news_event":"name or none","candle_close":"HH:MM UTC","candle_close_note":"1h/4h + why","mtf_fix":"what must change","pattern_needed":"pattern + level","indicator_needed":"indicator condition","primary_reason":"main reason","secondary_reason":"second or none","estimated_clarity":"when clearer","refresh_recommendation":"specific actionable line"}}`,

  pipeline: async ({ keys, addLog, postNfp }) => {
    const tdCandles = async (interval, outputsize=100) => {
      const d=await tdFetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${outputsize}&apikey=${keys.td}`, addLog);
      if(d?.status==="error") throw new Error(`Twelve Data: ${d.message}`);
      const v=(d?.values||[]).reverse();
      return { times:v.map(x=>x.datetime), opens:v.map(x=>parseFloat(x.open)), closes:v.map(x=>parseFloat(x.close)), highs:v.map(x=>parseFloat(x.high)), lows:v.map(x=>parseFloat(x.low)), volumes:v.map(x=>parseFloat(x.volume)||0) };
    };
    // Returns latest value + direction vs the prior reading (we already fetch 5
    // observations — direction was being thrown away, yet the scorecard rules on it).
    const fred = async s => { const r=await fetch(proxyDataUrl("fred", `https://api.stlouisfed.org/fred/series/observations?series_id=${s}&api_key=${keys.fred}&file_type=json&sort_order=desc&limit=6`)); const d=await r.json(); const vals=(d.observations||[]).filter(o=>o.value!==".").map(o=>parseFloat(o.value)); const v=vals[0]??null, prev=vals[1]??null; return { v, prev, dir:(v!=null&&prev!=null)?(v>prev?"RISING":v<prev?"FALLING":"FLAT"):"unknown" }; };

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
        // PDH/PDL (yesterday's completed daily candle) + liquidity-sweep detection
        // (same pattern as EUR's Asian-range sweep, applied to gold's PDH/PDL)
        const pdh=c1d&&c1d.highs.length>=2?c1d.highs[c1d.highs.length-2]:null;
        const pdl=c1d&&c1d.lows.length>=2?c1d.lows[c1d.lows.length-2]:null;
        let sweep=null, nearPD=null;
        if(pdh!=null&&pdl!=null){
          for(let i=Math.max(0,c1h.closes.length-3);i<c1h.closes.length;i++){
            if(c1h.highs[i]>pdh&&c1h.closes[i]<pdh) sweep={level:pdh,side:"PDH",note:"bearish reversal setup — watch SHORT"};
            else if(c1h.lows[i]<pdl&&c1h.closes[i]>pdl) sweep={level:pdl,side:"PDL",note:"bullish reversal setup — watch LONG"};
          }
          if(!sweep){
            if(Math.abs(spot.price-pdh)<=5) nearPD={level:pdh,side:"PDH"};
            else if(Math.abs(spot.price-pdl)<=5) nearPD={level:pdl,side:"PDL"};
          }
        }
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
        td={ macd1h,rsi1h,atr1h,vwap,vol1h, macd4h,rsi4h,atr4h,vol4h, macdD,rsiD,volD, ma200,dailyAtr,h24,l24,rounds, pdh,pdl,sweep,nearPD, volRatio,nfpMove,nfpLarge,volFading, bullMacd:bull, bearMacd:3-bull };
        ta=analyzeTimeframes({ c15, c1h, c4h, c4hTimes:c4h.times, price:spot.price, atr4h, prevClose:c1d?c1d.closes[c1d.closes.length-2]:null });
        addLog(`1h MACD:${macd1h.macd?.toFixed(2)} RSI:${rsi1h.toFixed(1)} | MTF 4h:${ta.t4} 1h:${ta.t1} 15m:${ta.t15} ADX:${ta.adx?.toFixed(0)} pull:${ta.pull?.state||"—"}`);
      } else addLog("1h/4h candles unavailable — skipping local TA");
    }catch(e){ addLog(`Twelve Data error: ${e.message}`); } }

    let macro={nominal:null,tips:null,realYield:null,dxy:null};
    if(keys.fred){ try{
      addLog("Fetching FRED yields + DXY in parallel...");
      const [nominal,tips,dxy]=await Promise.all([fred("DGS10"),fred("T10YIE"),fred("DTWEXBGS")]);
      macro.nominal=nominal.v; macro.tips=tips.v; macro.dxy=dxy.v; macro.dxyDir=dxy.dir;
      if(nominal.v!=null&&tips.v!=null){
        macro.realYield=p2(nominal.v-tips.v);
        const ryPrev=(nominal.prev!=null&&tips.prev!=null)?nominal.prev-tips.prev:null;
        macro.realYieldDir=ryPrev!=null?(macro.realYield>p2(ryPrev)?"RISING":macro.realYield<p2(ryPrev)?"FALLING":"FLAT"):"unknown";
      }
      addLog(`FRED → real:${macro.realYield}% (${macro.realYieldDir||"?"}) DXY:${macro.dxy} (${macro.dxyDir})`);
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

MACRO — FRED (with direction vs prior reading — scorecard rule 5 uses DIRECTION: both FALLING = PASS LONG, both RISING = PASS SHORT)
  10Y Nominal:${na(macro.nominal)}% | Real Yield:${na(macro.realYield)}% ${macro.realYieldDir||""}${macro.realYield!==null?(macro.realYield>1.5?" (HIGH — bearish)":macro.realYield<0.5?" (LOW — bullish)":" (moderate)"):""} | DXY:${na(macro.dxy)} ${macro.dxyDir||""}

COT — CFTC Managed Money  Net:${cot?.netMM?.toLocaleString()??"n/a"} | WeekΔ:${cot?.weekChange?.toLocaleString()??"n/a"} | ${na(cot?.sentiment)} (>200k crowded long=bearish, <50k crowded short=bullish)

GOLD CONTEXT  Daily ATR:$${f2(td?.dailyAtr)} (${td?.dailyAtr>40?"HIGH vol — widen stops":td?.dailyAtr<20?"LOW vol — tight ranges":"normal"}) | Round numbers near price: ${td?.rounds?.length?td.rounds.map(r=>"$"+r).join(", "):"none within $30"}
  PDH: $${f2(td?.pdh)} | PDL: $${f2(td?.pdl)} (previous-day high/low — universally watched liquidity levels)${td?.sweep?`
  🎯 LIQUIDITY SWEEP DETECTED at $${f2(td.sweep.level)} (${td.sweep.side}) — price spiked through then closed back inside. Classic stop hunt: ${td.sweep.note}.`:td?.nearPD?`
  ⚠ Price within $5 of ${td.nearPD.side} ($${f2(td.nearPD.level)}) — stop-hunt risk, London false spike likely. Wait for a confirmed break or rejection before committing.`:""}
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
    p._sweepNote = td?.sweep ? `🎯 LIQUIDITY SWEEP DETECTED at $${td.sweep.level.toFixed(2)} (${td.sweep.side}) — classic stop hunt. Reversal setup forming: ${td.sweep.note}.`
      : td?.nearPD ? `⚠️ Price near ${td.nearPD.side} ($${td.nearPD.level.toFixed(2)}) — stop hunt risk. London false spike likely. Wait for confirmed break or rejection.` : null;
    p._sources=[...(ta?["Real OHLCV"]:[]),...((macro.dxy!=null||macro.realYield!=null)?["FRED"]:[]),...(cot?["COT"]:[])];
    mergeTA(p, ta, v=>v.toFixed(2));
  },
};

// ════════════════════════════════════════════════════════════════════════════
// ASSET 2 — US500 (S&P 500 index CFD)
// ════════════════════════════════════════════════════════════════════════════
// US500 index data comes from a FREE, no-key server proxy (Yahoo ^GSPC via
// /api/us500) — Twelve Data's free tier excludes index/futures data, so US500
// needs no data key at all (only the Anthropic key; FRED is optional).

// Approximate quarterly US earnings-season windows — mega-cap reports cluster
// mid-month in Jan / Apr / Jul / Oct. Hardcoded (Section 1): flags elevated
// single-name / index volatility. Computed locally, no API.
const earningsFlag = () => {
  const d = new Date();
  const q = { 0:"Q4", 3:"Q1", 6:"Q2", 9:"Q3" }[d.getUTCMonth()]; // Jan/Apr/Jul/Oct
  const day = d.getUTCDate();
  return (q && day >= 10 && day <= 31) ? `${q} earnings season — mega-cap volatility possible` : "";
};

const US500 = {
  id:"us500", name:"SIGNAL DECK · US500", symbol:"US500 (S&P 500 CFD)", headerNote:"US500 · 10-Step · Real APIs",
  pricePrefix:"",
  theme:{ accent:"#0891b2", accentText:"#22d3ee", panelBg:"#062a34", panelBorder:"#155e75", loader:"#0891b2" },
  keyFields:[
    { field:"anthropic", label:"Anthropic API Key", hint:"required — powers the AI signal", ph:"sk-ant-..." },
    { field:"fred",      label:"FRED API Key",      hint:"optional — adds 10Y yield + Fed expectations (free)", ph:"(optional)" },
  ],
  dataNote:"S&P 500 index data (price, candles, MTF) comes from a free no-key source. Only the Anthropic key is required; add a free FRED key for yield/Fed context.",
  session:getUS500Session,
  quickPrice: async () => {
    try{ const r=await fetch("/api/us500?price=1"); if(r.ok){ const d=await r.json(); if(d?.price>100) return {price:p2(d.price),src:d.src||"Yahoo ^GSPC"}; } }catch(_){}
    return null;
  },
  sessionsGuide:[
    { window:"13:30–20:00 UTC", label:"US Cash (9:30 AM–4:00 PM ET) — best liquidity", quality:"best" },
    { window:"08:00–13:30 UTC", label:"Pre-market (4:00–9:30 AM ET) — thinner, gap-prone", quality:"good" },
    { window:"20:00–21:00 UTC", label:"Daily maintenance halt — market closed", quality:"avoid" },
    { window:"21:00–08:00 UTC", label:"Overnight / Globex — thin liquidity, gap-prone", quality:"avoid" },
  ],
  weekendNote:{ title:"US500 — Pepperstone weekend", lines:[
    "Index CFD closed / thin over the weekend","Cash S&P 500 does not trade — only synthetic pricing",
    "Gaps are common on the Sunday/Monday reopen",
  ], rec:"Do not trade US500 on weekends. Wait for the US cash session (4:30–11:00 PM EGY)." },
  events:["FOMC","CPI","NFP","PCE","GDP"], eventsNote:"US500 reacts to Fed policy, CPI/PCE inflation, NFP & ISM — plus mega-cap earnings.",
  riskRules:[
    "Max 1-2% of account at risk per trade","ATR-based stop = 1.5× 4h ATR — do not widen it","Minimum R:R 1:2",
    "⚠ Overnight gap risk on index CFDs — a gap can jump your stop. Size for it or close before session end",
    "VIX >25 → reduce size; VIX <15 → complacency, expect sharper reversals","Exit 100% before FOMC / CPI / NFP / PCE",
    "⚠ CONFIRM Pepperstone's exact €/point value for the US500 CFD at your minimum lot size BEFORE sizing — this is a placeholder until you verify it",
  ],
  scTitle:"10-Step Scorecard", passesOf:10,
  scRows:[
    { key:"price",   label:"1. Price & VWAP/Session" },
    { key:"macd",    label:"2. MACD 1h/4h/Daily" },
    { key:"rsi_ma",  label:"3. RSI 70/30 + 200MA" },
    { key:"vix_fed", label:"4. VIX + Fed Expectations" },
    { key:"cot",     label:"5. COT (S&P futures)" },
    { key:"levels",  label:"6. Levels / Fib / PDH-PDL" },
    { key:"regime",  label:"7. Regime / Structure" },
    { key:"news",    label:"8. News / Macro" },
    ...TA_ROWS,
  ],
  readyLines:(k)=>[
    "✓ S&P 500 index — free source (Yahoo ^GSPC): price, 15m/1h/4h/daily candles, MACD/RSI/ATR/VWAP/200MA",
    (k.fred?"✓ FRED (10Y yield + Fed expectations)":"⚠ No FRED — Fed/yield via web search")+" · VIX via web search · Session windows assume US EDT",
  ],
  levelsTitle:"Key Levels",
  levels:(s)=>[
    { name:"24h High",   val:`${fmt(s.high_24h)}` },
    { name:"24h Low",    val:`${fmt(s.low_24h)}` },
    { name:"PDH",        val:`${fmt(s.pdh)}` },
    { name:"PDL",        val:`${fmt(s.pdl)}` },
    { name:"VWAP",       val:`${fmt(s.vwap)}` },
    { name:"Support",    val:`${fmt(s.support)}` },
    { name:"Resistance", val:`${fmt(s.resistance)}` },
    { name:"200-Day MA", val:`${fmt(s.ma200)}` },
    { name:"BB Upper (4h)", val:`${fmt(s.bb_upper)}` },
    { name:"BB Lower (4h)", val:`${fmt(s.bb_lower)}` },
  ],
  extraPanels:(s)=>(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
      <div style={card}>
        <p style={lbl}>Volatility & Rates</p>
        <Stat title="VIX — rising = risk-off (bearish), falling = risk-on (bullish)" value={fmt(s.vix)} sub=">25 reduce size · <15 complacency warning"/>
        <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Fed rate expectations</p>
        <p style={{...mono,fontSize:12,margin:0,color:"#e2e8f0"}}>{fmt(s.fed_expectations)}</p></div>
        {s.real_yield&&s.real_yield!==""&&<p style={{fontSize:10,color:"#64748b",...mono,margin:"6px 0 0"}}>10Y: {fmt(s.real_yield)}</p>}
      </div>
      <div style={card}>
        <p style={lbl}>Positioning & Earnings</p>
        <Stat title="COT — S&P 500 futures (asset managers)" value={fmt(s.cot_sentiment)} sub={s.cot_net&&s.cot_net!==""?`net ${s.cot_net}`:"CFTC TFF weekly"}/>
        {s.earnings_flag&&s.earnings_flag!==""&&<p style={{fontSize:11,color:"#22d3ee",...mono,margin:"0 0 8px"}}>📊 {s.earnings_flag}</p>}
        <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Risk sentiment</p>
        <p style={{...mono,fontSize:12,margin:0,color:s.news_sent==="BULLISH"?"#4ade80":s.news_sent==="BEARISH"?"#f87171":"#94a3b8"}}>{fmt(s.news_sent)} {s.news_sent==="BULLISH"?"(risk-on)":s.news_sent==="BEARISH"?"(risk-off)":""}</p></div>
      </div>
    </div>
  ),
  system:`You are SIGNAL DECK US500, an S&P 500 index CFD analysis engine for paper trading education only. Not financial advice. Never fabricate prices.

ALL TECHNICAL DATA IS PRE-COMPUTED AND PROVIDED — do not search for price, MACD, RSI, ATR, VWAP, volume, 200MA, or the 10Y yield. These are calculated from real API data.

YOUR JOB (web search only for these):
1. VIX (REQUIRED — there is no free VIX API): search "VIX level today CBOE" and report the current VIX with direction. Rising VIX = risk-off / bearish equities; falling = risk-on / bullish. VIX >25 = elevated fear (reduce size); VIX <15 = complacency warning (sharp reversals possible).
2. NEWS: top US equity market news last 24h — Fed commentary, mega-cap moves, sector rotation, geopolitical risk.
3. FED EXPECTATIONS: rate cut/hike odds, next-FOMC bias, recent Fed speakers.
4. KEY LEVELS: nearest major S&P 500 institutional support/resistance; confirm or refine the provided S/R.
5. MACRO CONTEXT: FOMC/CPI/NFP/PCE/ISM within 48h? Earnings season? → highest-probability directional bias.

10-STEP SCORECARD RULES:
1. PRICE & VWAP/SESSION: upper/lower third of the 24h range AND above/below VWAP, ideally in the US cash session → same direction = PASS.
2. MACD MULTI-TF: 1h+4h+Daily all above signal = PASS LONG; all below = PASS SHORT; 2/3 = NEUTRAL; 1/3 or 0/3 = FAIL.
3. RSI + 200MA (STANDARD 70/30 — equities are NOT gold): RSI 50-70 + price above 200MA = PASS LONG; RSI 30-50 + below 200MA = PASS SHORT; >70 overbought or <30 oversold = NEUTRAL for entry. Use 70/30 as the extremes — do NOT use gold's 80/20 here.
4. VIX + FED: VIX falling + dovish/steady Fed = PASS LONG; VIX rising + hawkish Fed = PASS SHORT; conflict = NEUTRAL. VIX >25 caps confidence at MEDIUM.
5. COT (S&P 500 futures): if positioning data is provided, use it (crowded asset-manager longs = caution for new longs); if marked unavailable, score NEUTRAL — do NOT invent positioning.
6. LEVELS: price within 0.3% of key structural support (LONG) or resistance (SHORT) = PASS; middle of range = FAIL.
7. REGIME/STRUCTURE: the pre-computed 4h structure + ADX agrees with the trade direction = PASS; ranging or conflicting = NEUTRAL/FAIL.
8. NEWS/MACRO: confirmed bullish catalyst / risk-on = PASS; bearish / risk-off / earnings landmine = FAIL; unclear = NEUTRAL.

SIGNAL RULES:
- Binary event (FOMC/CPI/NFP/PCE) UPCOMING within the next 24h → WAIT. An already-RELEASED event does NOT force WAIT once 30+ minutes have passed — trade the post-event trend normally. Never output wait_type binary_event for a past release.
- ALWAYS output a directional call (LONG or SHORT) unless genuinely no setup. Output WAIT ONLY if signal_quality <35 OR a binary event is within 24h. Weaker setups → the direction at LOW confidence rather than a blanket WAIT.
- MULTI-TIMEFRAME: prefer trading with the 4h trend. If 4h and 1h conflict → still output the signal but cap confidence at LOW. Only WAIT if all three timeframes (4h/1h/15m) disagree. 15m is for entry timing.
- OVERNIGHT GAP RISK: index CFDs gap on the reopen — a stop can be jumped through. In pre-market / overnight, cap confidence at MEDIUM and explicitly note the gap risk in the reasoning.
- VIX >25 → cap confidence at MEDIUM (elevated volatility). Earnings season → note mega-cap event risk.
- SIGNAL QUALITY: <35 = WAIT; 35-50 = LOW; 50-70 = MEDIUM; 70-85 = HIGH; 85+ = VERY HIGH.
- Stop: use the ATR-based value provided (1.5× 4h ATR). Do not widen it. T1 min 1.5× ATR, T2 min 2.5× ATR. R:R <1:2 → WAIT.
- POSITION SIZING: the exact €/point value for the US500 CFD at minimum lot size is a PLACEHOLDER the user must confirm with Pepperstone — remind them in the reasoning; do NOT assume a € value.

Respond ONLY with valid JSON, no markdown, no text outside it:
{"action":"LONG|SHORT|WAIT","price":"XXXX.XX","confidence":"HIGH|MEDIUM|LOW","entry":"XXXX.XX","entry_note":"brief","stop":"XXXX.XX","stop_note":"1.5x ATR","stop_pct":"0.8","t1":"XXXX.XX","t2":"XXXX.XX","rr":"1:2","high_24h":"XXXX.XX","low_24h":"XXXX.XX","vwap":"XXXX.XX","support":"XXXX.XX","resistance":"XXXX.XX","ma200":"XXXX.XX","vix":"XX.X — rising|falling","fed_expectations":"e.g. 25bp cut ~60% priced for next FOMC","cot_net":"value or empty","cot_sentiment":"NEUTRAL or unavailable","earnings_flag":"season note or empty","passes":5,"scorecard":{"price":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"macd":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"rsi_ma":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"vix_fed":{"r":"PASS|FAIL|NEUTRAL","note":"VIX level + direction"},"cot":{"r":"PASS|FAIL|NEUTRAL","note":"or unavailable"},"levels":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"regime":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"news":{"r":"BULLISH|BEARISH|NEUTRAL","note":"brief"},"candles":{"r":"PASS|FAIL|NEUTRAL","note":"pattern name + tf"},"mtf":{"r":"PASS|FAIL|NEUTRAL","note":"4h/1h/15m agree?"}},"signal_quality":"78/100 — STRONG","entry_type":"Pattern|Optimal|Aggressive|Conservative","reasoning":"2 sentences","exits":["T1 XXXX — close 50% move stop to entry","T2 XXXX — close rest","Stop XXXX — full exit","Time — close by session end (gap risk)"],"news_hl":"headline","news_sent":"BULLISH|BEARISH|NEUTRAL","binary_event":"none or event+timing","data_note":"brief or empty","sources":["url1"],"wait_type":"binary_event|low_confidence|no_setup|wrong_session|none","triggers":{"watch_long":"price or n/a","watch_long_note":"why","watch_short":"price or n/a","watch_short_note":"why","invalidation":"price","invalidation_note":"what the break means","next_session":"HH:MM UTC","next_session_note":"session + why","news_time":"HH:MM UTC or none","news_event":"name or none","candle_close":"HH:MM UTC","candle_close_note":"1h/4h + why","mtf_fix":"what must change","pattern_needed":"pattern + level","indicator_needed":"indicator condition","primary_reason":"main reason","secondary_reason":"second or none","estimated_clarity":"when clearer","refresh_recommendation":"specific actionable line"}}`,

  pipeline: async ({ keys, addLog }) => {
    const fred = async s => { const r=await fetch(proxyDataUrl("fred", `https://api.stlouisfed.org/fred/series/observations?series_id=${s}&api_key=${keys.fred}&file_type=json&sort_order=desc&limit=6`)); const d=await r.json(); const vals=(d.observations||[]).filter(o=>o.value!==".").map(o=>parseFloat(o.value)); const v=vals[0]??null, prev=vals[1]??null; return { v, prev, dir:(v!=null&&prev!=null)?(v>prev?"RISING":v<prev?"FALLING":"FLAT"):"unknown" }; };

    // ── S&P 500 candles from our FREE, no-key server proxy. Prefers ES=F (e-mini
    // futures, ~23h, tracks the CFD) over the cash index; ~10-15 min delayed. Twelve
    // Data's free tier excludes index/futures data, so US500 needs no data key.
    // 15m/1h/1day from Yahoo; 4h resampled from 1h (see /api/us500). ──
    addLog("Fetching US500 (S&P 500) index data — free source (Yahoo ES=F)...");
    let us=null;
    try{ const r=await fetch("/api/us500"); if(r.ok) us=await r.json(); else { const e=await r.json().catch(()=>({})); addLog(`US500 source error: ${e.error||("HTTP "+r.status)}`); } }catch(e){ addLog(`US500 source error: ${e.message}`); }
    const c15=us?.c15||null, c1h=us?.c1h||null, c4h=us?.c4h||null, c1d=us?.c1d||null;
    const dataAge=us?.ageMin, dataAsOf=us?.asOf;
    let spot=null;
    if(us?.price>100) spot={price:p2(us.price),src:us.src||"Yahoo ES=F"};
    else if(c1h?.closes?.length) spot={price:p2(c1h.closes[c1h.closes.length-1]),src:us?.src||"Yahoo ES=F"};
    // Staleness guard: outside trading hours (or a bad feed) the quote can be old.
    const stale=dataAge!=null&&dataAge>60;
    if(spot) addLog(`US500 spot ${spot.price} — data ${dataAge!=null?dataAge+" min old":"age unknown"}${stale?" ⚠ STALE (market may be closed — treat with caution)":""}`);

    let td=null, ta=null;
    if(c1h&&c4h){ try{
        const macd1h=calcMACD(c1h.closes), rsi1h=calcRSI(c1h.closes), atr1h=calcATR(c1h.highs,c1h.lows,c1h.closes);
        const vwap=calcVWAP(c1h.highs.slice(-23),c1h.lows.slice(-23),c1h.closes.slice(-23),c1h.volumes.slice(-23));
        const vol1h=calcVolRatio(c1h.volumes);
        const macd4h=calcMACD(c4h.closes), rsi4h=calcRSI(c4h.closes), atr4h=calcATR(c4h.highs,c4h.lows,c4h.closes), vol4h=calcVolRatio(c4h.volumes);
        const ma200=c1d?calcSMA(c1d.closes,200):null, macdD=c1d?calcMACD(c1d.closes):null, rsiD=c1d?calcRSI(c1d.closes):null, volD=c1d?calcVolRatio(c1d.volumes):null;
        const dailyAtr=c1d?calcATR(c1d.highs,c1d.lows,c1d.closes):null;
        const h24=Math.max(...c1h.highs.slice(-24)), l24=Math.min(...c1h.lows.slice(-24));
        const bull=[macd1h,macd4h,macdD].filter(m=>m?.aboveSignal).length;
        const pdh=c1d&&c1d.highs.length>=2?c1d.highs[c1d.highs.length-2]:null;
        const pdl=c1d&&c1d.lows.length>=2?c1d.lows[c1d.lows.length-2]:null;
        const li1=c1h.closes.length-1;
        const trNow=Math.max(c1h.highs[li1]-c1h.lows[li1],Math.abs(c1h.highs[li1]-c1h.closes[li1-1]),Math.abs(c1h.lows[li1]-c1h.closes[li1-1]));
        const atr20=calcATR(c1h.highs,c1h.lows,c1h.closes,20);
        const volRatio=atr20?p2(trNow/atr20):null;
        // overnight gap: distance from prior daily close to the current day's first candle open
        let gap=null;
        if(c1d&&c1d.closes.length>=2){ const prevClose=c1d.closes[c1d.closes.length-2]; if(prevClose) gap=p2(((spot.price-prevClose)/prevClose)*100); }
        td={ macd1h,rsi1h,atr1h,vwap,vol1h, macd4h,rsi4h,atr4h,vol4h, macdD,rsiD,volD, ma200,dailyAtr,h24,l24, pdh,pdl, volRatio,gap, bullMacd:bull, bearMacd:3-bull };
        ta=analyzeTimeframes({ c15, c1h, c4h, c4hTimes:c4h.times, price:spot.price, atr4h, prevClose:c1d?c1d.closes[c1d.closes.length-2]:null });
        addLog(`1h MACD:${macd1h.macd?.toFixed(2)} RSI:${rsi1h.toFixed(1)} | MTF 4h:${ta.t4} 1h:${ta.t1} 15m:${ta.t15} ADX:${ta.adx?.toFixed(0)} pull:${ta.pull?.state||"—"}`);
    }catch(e){ addLog(`US500 TA error: ${e.message}`); } } else addLog("1h/4h candles unavailable — skipping local TA (S&P source may be down).");

    if(!spot) throw new Error("Could not fetch US500 index data — the free S&P 500 source is temporarily unavailable. Please retry.");
    addLog(`Spot: ${spot.price} (${spot.src})`);

    // ── Rates / Fed expectations — reuse Gold's FRED series (Section 1) ──
    let macro={dgs10:null,dgs10Dir:"unknown",fedfunds:null,realYield:null};
    if(keys.fred){ try{
      addLog("Fetching FRED 10Y + real yield + Fed funds...");
      const [dgs10,tips,fedfunds]=await Promise.all([fred("DGS10"),fred("T10YIE"),fred("FEDFUNDS")]);
      macro.dgs10=dgs10.v; macro.dgs10Dir=dgs10.dir; macro.fedfunds=fedfunds.v;
      if(dgs10.v!=null&&tips.v!=null) macro.realYield=p2(dgs10.v-tips.v);
      addLog(`FRED → 10Y:${macro.dgs10}% (${macro.dgs10Dir}) real:${macro.realYield}% FedFunds:${macro.fedfunds}%`);
    }catch(e){ addLog(`FRED error: ${e.message}`); } }

    // ── COT-equivalent: CFTC Traders in Financial Futures (S&P 500). Best-effort;
    //    marks NEUTRAL/unavailable gracefully if the feed shape differs (Section 1). ──
    addLog("Fetching COT (CFTC TFF — E-mini S&P 500)...");
    let cot=null;
    try{
      // Section 6: verified TFF dataset (yw9f-hn96) + the main E-MINI S&P 500
      // contract. Asset managers are structurally long (benchmark hedging), so the
      // speculative read comes from LEVERAGED FUNDS — extreme net short can precede
      // squeezes. Falls through to "unavailable" (NEUTRAL) if the shape ever differs.
      const r=await fetch("https://publicreporting.cftc.gov/resource/yw9f-hn96.json?$limit=1&$order=report_date_as_yyyy_mm_dd%20DESC&$where=contract_market_name=%27E-MINI%20S%26P%20500%27");
      if(r.ok){ const d=await r.json(); if(d.length){ const lat=d[0];
        const amL=parseInt(lat.asset_mgr_positions_long||0), amS=parseInt(lat.asset_mgr_positions_short||0), amNet=amL-amS;
        const lmL=parseInt(lat.lev_money_positions_long||0), lmS=parseInt(lat.lev_money_positions_short||0), lmNet=lmL-lmS;
        if(amL||amS||lmL||lmS){ cot={ net:amNet, levNet:lmNet, reportDate:lat.report_date_as_yyyy_mm_dd,
          sentiment:lmNet>0?"Leveraged funds NET LONG":lmNet<0?"Leveraged funds NET SHORT":"NEUTRAL" }; }
      } }
    }catch(_){}
    addLog(cot?`COT → net:${cot.net?.toLocaleString()} ${cot.sentiment}`:"COT unavailable (scored NEUTRAL)");

    const session=getUS500Session();
    const atr=td?.atr4h??td?.atr1h??null;
    const stopAmt=atr?p2(atr*1.5):null, stopPct=stopAmt?p2((stopAmt/spot.price)*100):null;
    const earn=earningsFlag();

    const pkg=`=== PRE-COMPUTED MARKET DATA — DO NOT RE-FETCH ===

PRICE
  US500 (S&P 500) Spot: ${spot.price} (${spot.src})
  ⚠ DATA FRESHNESS (US500 ONLY): this is an E-mini futures proxy on a FREE feed, ~${dataAge!=null?dataAge:"10-15"} min old${stale?" — STALE (US market likely closed; be cautious)":""}. UNLIKE gold, it is NOT a live institutional tick and there is NO Swissquote cross-check. The directional bias, structure, MTF and levels are valid, but the exact price is delayed — tell the user in the reasoning to CONFIRM the live price on their Pepperstone platform before entering, and treat entry/stop/target as approximate. It may also differ slightly from Pepperstone's exact CFD quote (futures basis).
  24h High: ${na(td?.h24)} | 24h Low: ${na(td?.l24)}
  VWAP (23h): ${f2(td?.vwap)} → price ${td?.vwap?(spot.price>td.vwap?"ABOVE — bullish intraday":"BELOW — bearish intraday"):"unknown"}
  Session: ${session.label} (${session.quality})${td?.gap!=null?` | Overnight gap vs prior close: ${td.gap>0?"+":""}${td.gap}%${Math.abs(td.gap)>0.5?" — GAP RISK, a stop can be jumped":""}`:""}

MACD — THREE TIMEFRAMES
  1h:    line=${f3(td?.macd1h?.macd)} hist=${f3(td?.macd1h?.histogram)} | ${td?.macd1h?.aboveSignal?"ABOVE":"BELOW"} signal
  4h:    line=${f3(td?.macd4h?.macd)} hist=${f3(td?.macd4h?.histogram)} | ${td?.macd4h?.aboveSignal?"ABOVE":"BELOW"} signal ${td?.macd4h?.expanding?"(expanding)":"(contracting)"}
  Daily: line=${f3(td?.macdD?.macd)} hist=${f3(td?.macdD?.histogram)} | ${td?.macdD?.aboveSignal?"ABOVE":"BELOW"} signal
  Alignment: ${td?`${td.bullMacd}/3 bullish, ${td.bearMacd}/3 bearish${td.bullMacd===3?" — ALL BULLISH (strong)":td.bearMacd===3?" — ALL BEARISH (strong)":""}`:"unavailable"}

RSI (14, STANDARD EQUITY BANDS 70/30)  1h:${f1(td?.rsi1h)}${rsiLbl(td?.rsi1h)} | 4h:${f1(td?.rsi4h)}${rsiLbl(td?.rsi4h)} | Daily:${f1(td?.rsiD)}${rsiLbl(td?.rsiD)}
  (equities use standard 70/30 — do NOT apply gold's 80/20 here)
  200MA: ${f2(td?.ma200)} → price ${td?.ma200?(spot.price>td.ma200?"ABOVE (bull regime)":"BELOW (bear regime)"):"unknown"}

VOLUME (vs 20-avg)  1h:${td?.vol1h?td.vol1h.ratio.toFixed(2)+"x"+volLbl(td.vol1h.ratio):"n/a"} | 4h:${td?.vol4h?td.vol4h.ratio.toFixed(2)+"x"+volLbl(td.vol4h.ratio):"n/a"}

ATR & STOP  1h:${f2(td?.atr1h)} | 4h:${f2(td?.atr4h)} | Recommended stop: ${na(stopAmt)} pts (${na(stopPct)}%, 1.5x 4h ATR)
  Daily ATR:${f2(td?.dailyAtr)} points

RATES / FED — FRED  10Y Treasury:${na(macro.dgs10)}% ${macro.dgs10Dir||""} (rising yields pressure equity valuations) | Real yield:${na(macro.realYield)}% | Fed Funds:${na(macro.fedfunds)}%
  (Use web search for the current Fed rate-cut/hike expectations and next-FOMC bias to complete the VIX+Fed scorecard row.)

VIX — NOT pre-fetched. Search "VIX level today CBOE" and set vix. Rising VIX = risk-off (bearish), falling = risk-on (bullish). >25 reduce size / cap confidence; <15 complacency warning.

COT — E-mini S&P 500 (CFTC TFF)  ${cot?`Asset-manager net:${cot.net?.toLocaleString()} (structurally long — benchmark hedging) | Leveraged-fund net:${cot.levNet?.toLocaleString()} → ${cot.sentiment} (report ${cot.reportDate}). Leveraged funds are the speculative crowd; extreme net short can precede short squeezes.`:"unavailable — score the COT row NEUTRAL, do not invent positioning"}

US500 CONTEXT  ${earn?`📊 ${earn}`:"No major earnings-season cluster right now"}
  Round numbers (S&P respects 50/100-point levels near price) and PDH/PDL are universally watched.
  PDH: ${f2(td?.pdh)} | PDL: ${f2(td?.pdl)} (previous-day high/low)
  Session note: the US cash open (9:30 AM ET / 4:30 PM EGY) is the most reliable move of the day; pre-market & overnight are thin and gap-prone.
  ⚠ POSITION SIZING: the €/point value for the US500 CFD at min lot size is a PLACEHOLDER — remind the user to confirm it with Pepperstone before sizing.

${ta?taPromptBlock(ta, v=>f2(v)):"MULTI-TIMEFRAME / PATTERNS / FIB: unavailable (no candle data — score candles & mtf NEUTRAL)"}

=== YOUR JOB: search VIX (required), news, Fed expectations, key S/R, binary events → output JSON ===`;

    return { pkg, price:spot.price, src:spot.src, session, meta:{ td, macro, cot, stopAmt, stopPct, ta, earn, dataAge, stale, dataAsOf } };
  },
  merge:(p,m)=>{
    const { td, macro, cot, ta, earn, dataAsOf } = m;
    // Delay-adjusting mechanism (US500 ONLY — the free ES=F feed is ~10-15 min
    // delayed; gold/BTC feeds are live so they set nothing here). Store the ABSOLUTE
    // as-of timestamp + the 1h ATR so the UI can tick the true age live and show a
    // drift band (how far the live price may have moved during the delay).
    p._delay = { asOf: dataAsOf ? Date.parse(dataAsOf) : null, atr1h: td?.atr1h ?? null, dec: 2 };
    if(td?.h24&&!p.high_24h) p.high_24h=String(td.h24);
    if(td?.l24&&!p.low_24h)  p.low_24h=String(td.l24);
    if(td?.ma200)            p.ma200=td.ma200.toFixed(2);
    if(td?.vwap&&!p.vwap)    p.vwap=td.vwap.toFixed(2);
    if(td?.pdh!=null)        p.pdh=td.pdh.toFixed(2);
    if(td?.pdl!=null)        p.pdl=td.pdl.toFixed(2);
    if(macro.realYield!==null) p.real_yield=`${macro.realYield}%${macro.dgs10!=null?` (10Y ${macro.dgs10}% ${macro.dgs10Dir?.toLowerCase()||""})`:""}`;
    if(cot){ if(!p.cot_net) p.cot_net=cot.net?.toLocaleString(); if(!p.cot_sentiment||p.cot_sentiment==="") p.cot_sentiment=cot.sentiment; }
    else if(!p.cot_sentiment||p.cot_sentiment==="") p.cot_sentiment="unavailable";
    if((!p.earnings_flag||p.earnings_flag==="")&&earn) p.earnings_flag=earn;
    if(td?.volRatio!=null) p._volRatio=td.volRatio;
    p._sources=[...(ta?["Real OHLCV"]:[]),...((macro.dgs10!=null||macro.realYield!=null)?["FRED"]:[]),...(cot?["COT/TFF"]:[])];
    mergeTA(p, ta, v=>v.toFixed(2));
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
    "BTC is FAR more volatile than gold or EUR/USD — size down accordingly",
    "Max 1-2% of account at risk per trade — STRICTLY","ATR-based stop mandatory: 1.5× 4h ATR (often $1,000–3,000)",
    "Minimum R:R 1:2.5 (higher than gold due to volatility)","Never hold through FOMC / CPI",
    "2-loss rule: two consecutive losses → stop trading BTC for 24h","Funding >+0.1%/8h at resistance = contrarian SHORT setup",
  ],
  scTitle:"10-Step Scorecard", passesOf:10,
  scRows:[
    { key:"price",      label:"1. Price & 24h range" },
    { key:"macd",       label:"2. MACD 1h/4h" },
    { key:"rsi_sma",    label:"3. RSI + 200 SMA" },
    { key:"funding_oi", label:"4. Funding + OI" },
    { key:"etf",        label:"5. ETF flows ★" },
    { key:"dominance",  label:"6. BTC dominance" },
    { key:"levels",     label:"7. Levels (round #s)" },
    { key:"news",       label:"8. News + Fear/Greed" },
    ...TA_ROWS,
  ],
  readyLines:()=>[
    "✓ Binance (price, OHLCV, funding, open interest) — free",
    "✓ CoinGecko dominance · alternative.me Fear & Greed · Web search (ETF flows + news)",
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
        <p style={lbl}>Derivatives — Binance</p>
        <Stat title="Funding rate (per 8h)" value={fmt(s.funding_rate)} sub=">+0.1% = crowded longs (bearish) · <-0.05% = crowded shorts (bullish)"
          color={(()=>{const v=parseFloat(s.funding_rate);return v>0.1?"#f87171":v<-0.05?"#4ade80":"#e2e8f0";})()}/>
        <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Open interest {s.oi_trend&&<span style={{color:s.oi_trend==="Rising"?"#4ade80":s.oi_trend==="Falling"?"#f87171":"#94a3b8"}}>· {s.oi_trend}</span>}</p>
        <p style={{...mono,fontSize:13,margin:0,color:"#e2e8f0"}}>{fmt(s.open_interest)}</p></div>
      </div>
      <div style={card}>
        <p style={lbl}>Market structure</p>
        <Stat title="BTC dominance" value={fmt(s.btc_dominance)} sub="rising = money into BTC (bullish)"/>
        <Stat title="ETF daily flow ★" value={fmt(s.etf_flow)} sub="inflows = institutional buying"/>
        <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Fear & Greed</p>
        <p style={{...mono,fontSize:12,margin:0,color:(()=>{const v=parseInt(s.fear_greed);return v<20?"#4ade80":v>80?"#f87171":"#94a3b8";})()}}>{fmt(s.fear_greed)} {(()=>{const v=parseInt(s.fear_greed);return v<20?"(Extreme Fear → contrarian LONG)":v>80?"(Extreme Greed → contrarian SHORT)":"";})()}</p></div>
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
- Funding rate (critical): >+0.1%/8h = overleveraged longs = contrarian SHORT. <-0.05%/8h = crowded shorts = contrarian LONG. Neutral otherwise.
- ETF flows are the leading institutional indicator: strong inflows = BULLISH, outflows = BEARISH.
- BTC dominance rising = money into BTC = BULLISH BTC; falling = rotation to alts = neutral/bearish.
- Fear & Greed: Extreme Fear (<20) = contrarian LONG; Extreme Greed (>80) = contrarian SHORT.
- Risk-on (Nasdaq up, VIX down) = BULLISH; risk-off = BEARISH.
- Price above 200 SMA = bull regime; below = bear regime.

8-STEP SCORECARD:
1. PRICE & RANGE: upper third of 24h range + momentum = PASS LONG; lower third = PASS SHORT; mid = NEUTRAL.
2. MACD 1h/4h: both above signal = PASS LONG; both below = PASS SHORT; split = NEUTRAL.
3. RSI + 200 SMA: 50-70 + above SMA = PASS LONG; 30-50 + below SMA = PASS SHORT; >70/<30 = NEUTRAL.
4. FUNDING + OI: contrarian funding aligned with trade + OI rising into the move = PASS; extreme funding against = FAIL.
5. ETF FLOWS: inflows = PASS LONG; outflows = PASS SHORT; flat/unknown = NEUTRAL.
6. DOMINANCE: rising dominance = PASS LONG; falling = NEUTRAL/FAIL.
7. LEVELS: near round-number support ($90k/$95k/$100k) for LONG or resistance for SHORT = PASS; mid-range = FAIL.
8. NEWS + F&G: bullish catalyst / extreme fear = PASS; bearish / extreme greed against = FAIL; unclear = NEUTRAL.

SIGNAL RULES:
- Binary event (FOMC/CPI/PCE) UPCOMING within the next 24h → WAIT (never hold BTC through macro). Already-released events do NOT force WAIT once 30+ min have passed — trade the post-event trend.
- ALWAYS output a directional call (LONG or SHORT) unless genuinely no setup. Base direction on the balance of the scorecard + trend context. Output WAIT ONLY if signal_quality <35 OR a binary event is within 24h. Weaker setups → output the direction with LOW confidence rather than a blanket WAIT.
- MULTI-TIMEFRAME: prefer trading with the 4h trend. If 4h and 1h conflict → still output the signal but cap confidence at LOW (counter-trend risk — advise reduced size). Only WAIT if all three timeframes (4h/1h/15m) disagree. 15m is for entry timing.
- A reversal candle pattern at a key level against the trend caps confidence at MEDIUM and can flip the call to WAIT.
- SIGNAL QUALITY: <35 = WAIT; 35-50 = LOW confidence (trade at own risk, minimum size); 50-70 = MEDIUM; 70-85 = HIGH; 85+ = VERY HIGH..
- Funding >+0.1% + price at resistance = high-probability SHORT.
- Stop: use the ATR-based value provided (do not widen). T1 min 1.5× ATR, T2 min 2.5× ATR.
- Minimum R:R 1:2.5 for BTC. R:R <1:2.5 → WAIT.
- Weekend/low-volume + no catalyst → cap confidence at MEDIUM.

Respond ONLY with valid JSON, no markdown, no text outside it:
{"action":"LONG|SHORT|WAIT","price":"XXXXX.XX","confidence":"HIGH|MEDIUM|LOW","entry":"XXXXX.XX","entry_note":"brief","stop":"XXXXX.XX","stop_note":"1.5x ATR","stop_pct":"2.1","t1":"XXXXX.XX","t2":"XXXXX.XX","rr":"1:2.5","high_24h":"XXXXX.XX","low_24h":"XXXXX.XX","support":"XXXXX.XX","resistance":"XXXXX.XX","sma200":"XXXXX.XX","funding_rate":"0.010%","open_interest":"XXXXX BTC","btc_dominance":"55.8%","fear_greed":"15 Extreme Fear","etf_flow":"+$250M IBIT","passes":5,"scorecard":{"price":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"macd":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"rsi_sma":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"funding_oi":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"etf":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"dominance":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"levels":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"news":{"r":"BULLISH|BEARISH|NEUTRAL","note":"brief"},"candles":{"r":"PASS|FAIL|NEUTRAL","note":"pattern name + tf"},"mtf":{"r":"PASS|FAIL|NEUTRAL","note":"4h/1h/15m agree?"}},"signal_quality":"78/100 — STRONG","entry_type":"Pattern|Optimal|Aggressive|Conservative","reasoning":"2 sentences","exits":["T1 $XXXXX — close 50% move stop to entry","T2 $XXXXX — close rest","Stop $XXXXX — full exit","Time — 4h max"],"news_hl":"headline","news_sent":"BULLISH|BEARISH|NEUTRAL","binary_event":"none or event+timing","data_note":"brief or empty","sources":["url1"],"wait_type":"binary_event|low_confidence|no_setup|wrong_session|none","triggers":{"watch_long":"price or n/a","watch_long_note":"why","watch_short":"price or n/a","watch_short_note":"why","invalidation":"price","invalidation_note":"what the break means","next_session":"HH:MM UTC","next_session_note":"session + why","news_time":"HH:MM UTC or none","news_event":"name or none","candle_close":"HH:MM UTC","candle_close_note":"1h/4h + why","mtf_fix":"what must change","pattern_needed":"pattern + level","indicator_needed":"indicator condition","primary_reason":"main reason","secondary_reason":"second or none","estimated_clarity":"when clearer","refresh_recommendation":"specific actionable line"}}`,

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
      jget("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1"),
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
      ta=analyzeTimeframes({ c15, c1h, c4h, c4hTimes:c4h.times, price:spot.price, atr4h, prevClose:c1d?c1d.closes[c1d.closes.length-2]:null });
      addLog(`MTF 4h:${ta.t4} 1h:${ta.t1} 15m:${ta.t15} ADX:${ta.adx?.toFixed(0)} pull:${ta.pull?.state||"—"} weekly:${weeklyDir}`);
    }catch(e){ addLog(`Binance candles error: ${e.message}`); } }
    else addLog("⚠ Binance candles unavailable — MTF/patterns/ATR skipped (Binance may be geo-restricted or rate-limited in your region). Price falls back to CoinGecko; TA scores NEUTRAL.");

    let funding=null, oi=null, oiTrend="—", dom=null, fng=null, fngLabel=null;
    if(fundingR?.[0]?.fundingRate!=null) funding=parseFloat(fundingR[0].fundingRate)*100;
    if(oiR?.openInterest) oi=parseFloat(oiR.openInterest);
    if(Array.isArray(oiHistR)&&oiHistR.length>=2){ const a=parseFloat(oiHistR[oiHistR.length-1].sumOpenInterest), b=parseFloat(oiHistR[oiHistR.length-2].sumOpenInterest); if(a&&b) oiTrend=a>b*1.005?"Rising":a<b*0.995?"Falling":"Flat"; }
    if(domR?.data?.market_cap_percentage?.btc!=null) dom=domR.data.market_cap_percentage.btc;
    if(fngR?.data?.[0]?.value){ fng=parseInt(fngR.data[0].value); fngLabel=fngR.data[0].value_classification; }
    addLog(`Funding:${funding!=null?funding.toFixed(4)+"%":"n/a"} OI:${oi!=null?Math.round(oi).toLocaleString():"n/a"}(${oiTrend}) Dom:${dom!=null?dom.toFixed(1)+"%":"n/a"} F&G:${fng!=null?fng+" "+fngLabel:"n/a"}`);

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

    const fundLbl = funding!=null?(funding>0.1?" (CROWDED LONGS — contrarian bearish)":funding<-0.05?" (CROWDED SHORTS — contrarian bullish)":" (neutral)"):"";
    const fngTxt  = fng!=null?(fng<20?" (Extreme Fear — contrarian LONG)":fng>80?" (Extreme Greed — contrarian SHORT)":""):"";

    const pkg=`=== PRE-COMPUTED MARKET DATA — DO NOT RE-FETCH ===

PRICE
  BTC/USD Spot: $${spot.price} (${spot.src})${chg!=null?` | 24h change ${chg>0?"+":""}${chg}%`:""}
  24h High: $${na(h24)} | 24h Low: $${na(l24)} | PDH: $${f2(td?.pdh)} | PDL: $${f2(td?.pdl)}
  Session: ${session.label}

MACD  1h: line=${f1(td?.macd1h?.macd)} ${td?.macd1h?.aboveSignal?"ABOVE":"BELOW"} signal | 4h: line=${f1(td?.macd4h?.macd)} ${td?.macd4h?.aboveSignal?"ABOVE":"BELOW"} signal ${td?.macd4h?.expanding?"(expanding)":"(contracting)"}

RSI (14)  1h:${f1(td?.rsi1h)}${rsiLbl(td?.rsi1h)} | 4h:${f1(td?.rsi4h)}${rsiLbl(td?.rsi4h)}
  200 SMA (daily): $${f2(td?.sma200)} → price ${td?.sma200?(spot.price>td.sma200?"ABOVE (bull regime)":"BELOW (bear regime)"):"unknown"}

VOLUME (vs 20-avg)  1h:${td?.vol1h?td.vol1h.ratio.toFixed(2)+"x"+volLbl(td.vol1h.ratio):"n/a"} | 4h:${td?.vol4h?td.vol4h.ratio.toFixed(2)+"x"+volLbl(td.vol4h.ratio):"n/a"}

DERIVATIVES  Funding (8h): ${funding!=null?funding.toFixed(4)+"%":"n/a"}${fundLbl} | Open Interest: ${oi!=null?Math.round(oi).toLocaleString()+" BTC":"n/a"} (trend: ${oiTrend} over last 4h${oiTrend==="Rising"?" — new positions, strong move":oiTrend==="Falling"?" — positions closing, possible liquidations":""})

MARKET STRUCTURE  BTC Dominance: ${dom!=null?dom.toFixed(1)+"%":"n/a"} | Fear & Greed: ${fng!=null?fng+" "+fngLabel:"n/a"}${fngTxt}

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
      meta:{ td, h24, l24, funding, oi, oiTrend, dom, fng, fngLabel, ta, onchain } };
  },
  merge:(p,m)=>{
    const { td, h24, l24, funding, oi, oiTrend, dom, fng, fngLabel, ta, onchain } = m;
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
    mergeTA(p, ta, v=>v.toFixed(2));
  },
};

export const ASSETS = { gold:GOLD, us500:US500, btc:BTC };
