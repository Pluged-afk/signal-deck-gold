// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL DECK — asset definitions. Each asset is a self-contained engine config:
// its own system prompt, data pipeline, scorecard, levels, panels and risk model.
// Only the selected asset's `pipeline` ever runs.
// ═══════════════════════════════════════════════════════════════════════════
import {
  mono, card, lbl, fmt, p2, p5,
  calcMACD, calcRSI, calcATR, calcSMA, calcVWAP, calcVolRatio, calcEMAlast, calcPivots,
  getFxSession, getCryptoSession,
  f1, f2, f3, na, rsiLbl, volLbl, tdFetch,
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
    if(keys.td){ try{ const r=await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${keys.td}`); const d=await r.json(); if(d.price>100) return {price:p2(d.price),src:"Twelve Data"}; }catch(_){} }
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
    { key:"rsi_ma",    label:"3. RSI + 200MA" },
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
    { name:"VWAP",       val:`$${fmt(s.vwap)}` },
    { name:"Support",    val:`$${fmt(s.support)}` },
    { name:"Resistance", val:`$${fmt(s.resistance)}` },
    { name:"200-Day MA", val:`$${fmt(s.ma200)}` },
  ],
  extraPanels:(s)=>(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
      <div style={card}>
        <p style={lbl}>Macro Drivers</p>
        <Stat title="DXY (Fed TWI) — rising = bearish gold" value={fmt(s.dxy)}/>
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
3. RSI + 200MA: RSI 50-70 + price above 200MA = PASS LONG. RSI 30-50 + below 200MA = PASS SHORT. Extremes (>70 or <30) = NEUTRAL for entry.
4. VOLUME: Ratio >1.5x avg = PASS (confirms). 0.8-1.5x = NEUTRAL. <0.8x = FAIL (weak move).
5. DXY + REAL YIELD: Both falling = PASS LONG. Both rising = PASS SHORT. Conflict = NEUTRAL.
6. COT: Net MM <100k = room for longs = PASS LONG. Net >200k = crowded = FAIL LONG/PASS SHORT. 100-200k = NEUTRAL.
7. LEVELS: Price within 0.3% of key structural support (LONG) or resistance (SHORT) = PASS. Middle of range = FAIL.
8. NEWS: Confirmed bullish catalyst = PASS. Bearish = FAIL. Unclear = NEUTRAL.

SIGNAL RULES:
- Binary event (FOMC/CPI/NFP/PCE) within 24h → WAIT, no exceptions
- ≥6 of 10 confirm same direction → LONG or SHORT. <6 = WAIT
- MULTI-TIMEFRAME MASTER RULE: never trade against the 4h trend. 1h must confirm 4h. If 4h and 1h conflict → WAIT, no exceptions. 15m is for entry timing only.
- A reversal candle pattern at a key level against the trend caps confidence at MEDIUM and can flip the call to WAIT.
- SIGNAL QUALITY: <50 = WAIT regardless of everything else; 50-70 = MEDIUM; 70-85 = HIGH; 85+ = VERY HIGH (rare).
- Three-timeframe MACD alignment is a strong standalone signal — weight it heavily
- DXY and yield conflict → confidence capped at MEDIUM
- Low volume breakout → confidence capped at MEDIUM
- COT net >200k + price at resistance = high-probability SHORT
- Stop: use the ATR-based value provided. Do not widen it.
- T1: min 1.5× ATR from entry. T2: min 2.5× ATR. R:R <1:2 → WAIT
- Off-peak session + no strong catalyst → cap confidence at MEDIUM

Respond ONLY with valid JSON, no markdown, no text outside it:
{"action":"LONG|SHORT|WAIT","price":"XXXX.XX","confidence":"HIGH|MEDIUM|LOW","entry":"XXXX.XX","entry_note":"brief","stop":"XXXX.XX","stop_note":"ATR-based","stop_pct":"0.7","t1":"XXXX.XX","t2":"XXXX.XX","rr":"1:2.5","high_24h":"XXXX.XX","low_24h":"XXXX.XX","vwap":"XXXX.XX","support":"XXXX.XX","resistance":"XXXX.XX","ma200":"XXXX.XX","dxy":"XXX.XX","real_yield":"X.XX%","cot_net":"XXXXX","cot_sentiment":"NEUTRAL","passes":5,"scorecard":{"price":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"macd":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"rsi_ma":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"volume":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"dxy_yield":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"cot":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"history":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"news":{"r":"BULLISH|BEARISH|NEUTRAL","note":"brief"},"candles":{"r":"PASS|FAIL|NEUTRAL","note":"pattern name + tf"},"mtf":{"r":"PASS|FAIL|NEUTRAL","note":"4h/1h/15m agree?"}},"signal_quality":"78/100 — STRONG","entry_type":"Pattern|Optimal|Aggressive|Conservative","reasoning":"2 sentences","exits":["T1 $XXXX — close 50% move stop to entry","T2 $XXXX — close rest","Stop $XXXX — full exit","Time — 4h max"],"news_hl":"headline","news_sent":"BULLISH|BEARISH|NEUTRAL","binary_event":"none or event+timing","data_note":"brief or empty","sources":["url1"],"wait_type":"binary_event|low_confidence|no_setup|wrong_session|none","triggers":{"watch_long":"price or n/a","watch_long_note":"why","watch_short":"price or n/a","watch_short_note":"why","invalidation":"price","invalidation_note":"what the break means","next_session":"HH:MM UTC","next_session_note":"session + why","news_time":"HH:MM UTC or none","news_event":"name or none","candle_close":"HH:MM UTC","candle_close_note":"1h/4h + why","mtf_fix":"what must change","pattern_needed":"pattern + level","indicator_needed":"indicator condition","primary_reason":"main reason","secondary_reason":"second or none","estimated_clarity":"when clearer","refresh_recommendation":"specific actionable line"}}`,

  pipeline: async ({ keys, addLog }) => {
    const tdCandles = async (interval, outputsize=100) => {
      const d=await tdFetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${outputsize}&apikey=${keys.td}`, addLog);
      if(d?.status==="error") throw new Error(`Twelve Data: ${d.message}`);
      const v=(d?.values||[]).reverse();
      return { times:v.map(x=>x.datetime), opens:v.map(x=>parseFloat(x.open)), closes:v.map(x=>parseFloat(x.close)), highs:v.map(x=>parseFloat(x.high)), lows:v.map(x=>parseFloat(x.low)), volumes:v.map(x=>parseFloat(x.volume)||0) };
    };
    const fred = async s => { const r=await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${s}&api_key=${keys.fred}&file_type=json&sort_order=desc&limit=5`); const d=await r.json(); return (d.observations||[]).filter(o=>o.value!==".").map(o=>parseFloat(o.value))[0]??null; };

    addLog("Fetching spot price...");
    let spot=null;
    if(keys.td) try{ const d=await tdFetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${keys.td}`, addLog); if(d?.price&&parseFloat(d.price)>100) spot={price:p2(d.price),src:"Twelve Data"}; }catch(_){}
    if(!spot) try{ const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd"); if(r.ok){const d=await r.json(),g=d?.["pax-gold"];if(g?.usd>100) spot={price:p2(g.usd),src:"CoinGecko PAXG"};} }catch(_){}
    if(!spot) try{ const r=await fetch("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD"); if(r.ok){const d=await r.json(),q=d?.[0]?.spreadProfilePrices?.find(x=>x.spreadProfile==="prime");if(q?.ask&&q?.bid) spot={price:p2((q.ask+q.bid)/2),src:"Swissquote"};} }catch(_){}
    if(!spot) throw new Error("Could not fetch gold spot price from any source.");
    addLog(`Spot: $${spot.price} (${spot.src})`);

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
        td={ macd1h,rsi1h,atr1h,vwap,vol1h, macd4h,rsi4h,atr4h,vol4h, macdD,rsiD,volD, ma200,dailyAtr,h24,l24,rounds, bullMacd:bull, bearMacd:3-bull };
        ta=analyzeTimeframes({ c15, c1h, c4h, c4hTimes:c4h.times, price:spot.price, atr4h });
        addLog(`1h MACD:${macd1h.macd?.toFixed(2)} RSI:${rsi1h.toFixed(1)} | MTF 4h:${ta.t4} 1h:${ta.t1} 15m:${ta.t15} ADX:${ta.adx?.toFixed(0)} pull:${ta.pull?.state||"—"}`);
      } else addLog("1h/4h candles unavailable — skipping local TA");
    }catch(e){ addLog(`Twelve Data error: ${e.message}`); } }

    let macro={nominal:null,tips:null,realYield:null,dxy:null};
    if(keys.fred){ try{
      addLog("Fetching FRED yields + DXY in parallel...");
      const [nominal,tips,dxy]=await Promise.all([fred("DGS10"),fred("T10YIE"),fred("DTWEXBGS")]);
      macro.nominal=nominal; macro.tips=tips; macro.dxy=dxy;
      if(nominal&&tips) macro.realYield=p2(nominal-tips);
      addLog(`FRED → real:${macro.realYield}% DXY:${macro.dxy}`);
    }catch(e){ addLog(`FRED error: ${e.message}`); } }

    addLog("Fetching COT (CFTC)...");
    let cot=null;
    try{
      const r=await fetch("https://publicreporting.cftc.gov/resource/yw9f-hn96.json?$limit=2&$order=report_date_as_yyyy_mm_dd%20DESC&$where=commodity_name%20like%20'%25GOLD%25'");
      if(r.ok){ const d=await r.json(); if(d.length){ const lat=d[0],prev=d[1];
        const mmL=parseInt(lat.managed_money_positions_long_all||0), mmS=parseInt(lat.managed_money_positions_short_all||0), net=mmL-mmS;
        const pNet=prev?parseInt(prev.managed_money_positions_long_all||0)-parseInt(prev.managed_money_positions_short_all||0):null;
        cot={ mmLong:mmL,mmShort:mmS,netMM:net,weekChange:pNet!==null?net-pNet:null,reportDate:lat.report_date_as_yyyy_mm_dd, sentiment:net>200000?"CROWDED_LONG":net<50000?"CROWDED_SHORT":"NEUTRAL" };
      } }
    }catch(_){}
    addLog(cot?`COT → net:${cot.netMM?.toLocaleString()} ${cot.sentiment}`:"COT unavailable");

    const session=getFxSession();
    const atr=td?.atr4h??td?.atr1h??null;
    const stopAmt=atr?p2(atr*1.5):null, stopPct=stopAmt?p2((stopAmt/spot.price)*100):null;

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

RSI (14)  1h:${f1(td?.rsi1h)}${rsiLbl(td?.rsi1h)} | 4h:${f1(td?.rsi4h)}${rsiLbl(td?.rsi4h)} | Daily:${f1(td?.rsiD)}${rsiLbl(td?.rsiD)}
  200MA: $${f2(td?.ma200)} → price ${td?.ma200?(spot.price>td.ma200?"ABOVE (bull bias)":"BELOW (bear bias)"):"unknown"}

VOLUME (vs 20-avg)  1h:${td?.vol1h?td.vol1h.ratio.toFixed(2)+"x"+volLbl(td.vol1h.ratio):"n/a"} | 4h:${td?.vol4h?td.vol4h.ratio.toFixed(2)+"x"+volLbl(td.vol4h.ratio):"n/a"}

ATR & STOP  1h:$${f2(td?.atr1h)} | 4h:$${f2(td?.atr4h)} | Recommended stop: $${na(stopAmt)} (${na(stopPct)}%)

MACRO — FRED  10Y Nominal:${na(macro.nominal)}% | Real Yield:${na(macro.realYield)}%${macro.realYield!==null?(macro.realYield>1.5?" (HIGH — bearish)":macro.realYield<0.5?" (LOW — bullish)":" (moderate)"):""} | DXY:${na(macro.dxy)}

COT — CFTC Managed Money  Net:${cot?.netMM?.toLocaleString()??"n/a"} | WeekΔ:${cot?.weekChange?.toLocaleString()??"n/a"} | ${na(cot?.sentiment)} (>200k crowded long=bearish, <50k crowded short=bullish)

GOLD CONTEXT  Daily ATR:$${f2(td?.dailyAtr)} (${td?.dailyAtr>40?"HIGH vol — widen stops":td?.dailyAtr<20?"LOW vol — tight ranges":"normal"}) | Round numbers near price: ${td?.rounds?.length?td.rounds.map(r=>"$"+r).join(", "):"none within $30"}
  Session candle note: London open (08-09 UTC) often false-breaks then reverses — wait for the 2nd candle. NY open (13:30-14:30 UTC) is the most reliable candle of the day.

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
    if(macro.realYield!==null) p.real_yield=`${macro.realYield}%`;
    if(macro.dxy!==null)       p.dxy=String(macro.dxy);
    if(cot&&!p.cot_net)        p.cot_net=cot.netMM?.toLocaleString();
    if(cot&&!p.cot_sentiment)  p.cot_sentiment=cot.sentiment;
    p._sources=[...(ta?["Real OHLCV"]:[]),...((macro.dxy!=null||macro.realYield!=null)?["FRED"]:[]),...(cot?["COT"]:[])];
    mergeTA(p, ta, v=>v.toFixed(2));
  },
};

// ════════════════════════════════════════════════════════════════════════════
// ASSET 2 — EUR/USD
// ════════════════════════════════════════════════════════════════════════════
const EUR = {
  id:"eur", name:"SIGNAL DECK · EUR/USD", symbol:"EUR/USD", headerNote:"EUR/USD · Fed vs ECB · Real APIs",
  pricePrefix:"",
  theme:{ accent:"#3b82f6", accentText:"#60a5fa", panelBg:"#0c1a3a", panelBorder:"#1e3a8a", loader:"#3b82f6" },
  keyFields:[
    { field:"anthropic", label:"Anthropic API Key", hint:"required — powers the AI signal", ph:"sk-ant-..." },
    { field:"td",        label:"Twelve Data Key",   hint:"MACD, RSI, ATR, EMA, VWAP, pivots", ph:"a1b2c3d4..." },
    { field:"fred",      label:"FRED API Key",      hint:"DXY + Fed funds + 10Y (free)", ph:"abcdef123456..." },
  ],
  session:getFxSession,
  quickPrice: async (keys) => {
    if(keys.td){ try{ const r=await fetch(`https://api.twelvedata.com/price?symbol=EUR/USD&apikey=${keys.td}`); const d=await r.json(); if(d.price>0.5) return {price:p5(d.price),src:"Twelve Data"}; }catch(_){} }
    try{ const r=await fetch("https://open.er-api.com/v6/latest/EUR"); if(r.ok){const d=await r.json();if(d?.rates?.USD>0.5) return {price:p5(d.rates.USD),src:"open.er-api"};} }catch(_){}
    try{ const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=eur"); if(r.ok){const d=await r.json();const e=d?.tether?.eur;if(e>0.5) return {price:p5(1/e),src:"CoinGecko USDT/EUR"};} }catch(_){}
    return null;
  },
  sessionsGuide:[
    { window:"08:00–10:00 UTC", label:"London Open — highest EUR/USD volume", quality:"best" },
    { window:"13:00–16:00 UTC", label:"EU-US Overlap — most reliable breakouts", quality:"best" },
    { window:"16:00–17:00 UTC", label:"US — good, slows after 17:00", quality:"good" },
    { window:"21:00–08:00 UTC", label:"Asian — avoid, barely moves", quality:"avoid" },
  ],
  weekendNote:{ title:"EUR/USD — Pepperstone weekend", lines:[
    "Spread widens to 2–4 pips (vs 0.6–1 weekday)","Some liquidity from Asian forex markets",
    "Best weekend window: Sunday 21:00 UTC (weekly open)",
  ], rec:"Only trade with 20+ pip TP targets. Viable for swings, not scalping." },
  events:["ECB","FOMC","CPI","NFP","EUCPI"], eventsNote:"ECB & Fed decisions and the CPI differential dominate EUR/USD.",
  riskRules:[
    "Max 1-2% of account at risk per trade","Stop = 1.5× 4h ATR (typically 50-80 pips)",
    "Minimum R:R 1:2","DXY direction is the dominant filter — never fight it",
    "Avoid Asian session — EUR/USD is choppy and thin","At 0.01 lots, 1 pip ≈ $0.10 — small account can use 0.02-0.05 lots",
  ],
  scTitle:"10-Step Scorecard", passesOf:10,
  scRows:[
    { key:"price",  label:"1. Price vs VWAP/EMAs" },
    { key:"macd",   label:"2. MACD 1h/4h" },
    { key:"rsi",    label:"3. RSI 1h/4h" },
    { key:"dxy",    label:"4. DXY (inverse) ★" },
    { key:"rates",  label:"5. Fed vs ECB" },
    { key:"data",   label:"6. Economic data" },
    { key:"levels", label:"7. Levels / Pivots" },
    { key:"news",   label:"8. News / Risk sentiment" },
    ...TA_ROWS,
  ],
  readyLines:(k)=>[
    k.td?"✓ Twelve Data (MACD/RSI/ATR/EMA50/EMA200/VWAP/pivots)":"⚠ No Twelve Data — AI inference only",
    (k.fred?"✓ FRED (DXY + Fed funds + 10Y)":"⚠ No FRED — web search fallback")+" · Web search (ECB/Fed + news)",
  ],
  levelsTitle:"Key Levels & EMAs",
  levels:(s)=>[
    { name:"24h High",   val:fmt(s.high_24h) },
    { name:"24h Low",    val:fmt(s.low_24h) },
    { name:"VWAP",       val:fmt(s.vwap) },
    { name:"50 EMA (4h)",  val:fmt(s.ema50) },
    { name:"200 EMA (4h)", val:fmt(s.ema200) },
    { name:"Pivot",      val:fmt(s.pivot) },
    { name:"Support",    val:fmt(s.support) },
    { name:"Resistance", val:fmt(s.resistance) },
  ],
  extraPanels:(s)=>(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
      <div style={card}>
        <p style={lbl}>DXY — inverse correlation ★</p>
        <Stat title="US Dollar Index — rising = SHORT EUR" value={fmt(s.dxy)} sub="~95% inverse to EUR/USD"/>
        <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Risk sentiment</p>
        <p style={{...mono,fontSize:12,margin:0,color:s.news_sent==="BULLISH"?"#4ade80":s.news_sent==="BEARISH"?"#f87171":"#94a3b8"}}>{fmt(s.news_sent)} {s.news_sent==="BULLISH"?"(risk-on → EUR up)":s.news_sent==="BEARISH"?"(risk-off → EUR down)":""}</p></div>
      </div>
      <div style={card}>
        <p style={lbl}>Fed vs ECB rate differential</p>
        <Stat title="Differential bias" value={fmt(s.rate_diff)}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Fed</p><p style={{...mono,fontSize:12,margin:0,color:"#e2e8f0"}}>{fmt(s.fed_bias)}</p></div>
          <div><p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>ECB</p><p style={{...mono,fontSize:12,margin:0,color:"#e2e8f0"}}>{fmt(s.ecb_bias)}</p></div>
        </div>
      </div>
    </div>
  ),
  system:`You are SIGNAL DECK EUR/USD, a EUR/USD analysis engine for paper trading education only. Not financial advice. Never fabricate prices.

ALL TECHNICAL DATA IS PRE-COMPUTED AND PROVIDED — do not search for price, MACD, RSI, ATR, EMA, VWAP, pivots, or DXY. These are calculated from real API data.

YOUR JOB (web search only):
1. NEWS: EUR/USD news last 24h, risk sentiment (risk-on = EUR up, risk-off = EUR down).
2. CENTRAL BANKS: ECB latest decision & forward guidance; Fed latest statement & dot plot. Determine hawkish/dovish bias for each.
3. DATA DIFFERENTIAL: Eurozone CPI vs US CPI; PMI, retail sales released today; which economy is printing stronger.
4. LEVELS: Nearest institutional EUR/USD support/resistance; confirm/refine provided pivots.
5. BIAS SYNTHESIS: All pre-computed data + research → highest-probability direction.

KEY EUR/USD LOGIC:
- DXY direction is the single most important factor (~95% inverse). DXY rising = SHORT EUR/USD. DXY falling = LONG.
- Fed hawkish + ECB dovish = SHORT EUR/USD. Fed dovish + ECB hawkish = LONG. Both hawkish = choppy, lean WAIT.
- US data stronger than EU = SHORT. EU data stronger than US = LONG.
- Price above 200 EMA = bullish bias; below = bearish bias.

8-STEP SCORECARD:
1. PRICE vs VWAP & EMAs: above VWAP and above 50/200 EMA = PASS LONG; below all = PASS SHORT; mixed = NEUTRAL.
2. MACD 1h/4h: both above signal = PASS LONG; both below = PASS SHORT; split = NEUTRAL.
3. RSI 1h/4h: 50-70 + uptrend = PASS LONG; 30-50 + downtrend = PASS SHORT; >70 or <30 = NEUTRAL.
4. DXY (most important): DXY falling = PASS LONG; rising = PASS SHORT. This step carries extra weight.
5. FED vs ECB: divergence favouring EUR = PASS LONG; favouring USD = PASS SHORT; aligned/unclear = NEUTRAL.
6. DATA: EU data beats US = PASS LONG; US beats EU = PASS SHORT; nothing notable = NEUTRAL.
7. LEVELS/PIVOTS: within 0.1% of pivot support (LONG) or resistance (SHORT) = PASS; mid-range = FAIL.
8. NEWS/RISK: risk-on / EUR-supportive = PASS; risk-off / USD-supportive = FAIL; unclear = NEUTRAL.

SIGNAL RULES:
- Binary event (ECB/FOMC/US CPI/NFP/Eurozone CPI) within 24h → WAIT.
- ≥6 of 10 confirm same direction → LONG or SHORT. <6 = WAIT
- MULTI-TIMEFRAME MASTER RULE: never trade against the 4h trend. 1h must confirm 4h. If 4h and 1h conflict → WAIT, no exceptions. 15m is for entry timing only.
- A reversal candle pattern at a key level against the trend caps confidence at MEDIUM and can flip the call to WAIT.
- SIGNAL QUALITY: <50 = WAIT regardless of everything else; 50-70 = MEDIUM; 70-85 = HIGH; 85+ = VERY HIGH (rare)..
- DXY step conflicting with MACD/price → cap confidence at MEDIUM.
- Asian session with no catalyst → cap confidence at MEDIUM.
- Stop: use the ATR-based pip value provided. T1 min 1.5× ATR, T2 min 2.5× ATR. R:R <1:2 → WAIT.

Respond ONLY with valid JSON, no markdown, no text outside it:
{"action":"LONG|SHORT|WAIT","price":"1.XXXX","confidence":"HIGH|MEDIUM|LOW","entry":"1.XXXX","entry_note":"brief","stop":"1.XXXX","stop_note":"1.5x ATR","stop_pct":"45 pips","t1":"1.XXXX","t2":"1.XXXX","rr":"1:2.5","high_24h":"1.XXXX","low_24h":"1.XXXX","vwap":"1.XXXX","ema50":"1.XXXX","ema200":"1.XXXX","pivot":"1.XXXX","support":"1.XXXX","resistance":"1.XXXX","dxy":"XXX.XX — falling","rate_diff":"Fed > ECB by ~2%","fed_bias":"hawkish hold","ecb_bias":"dovish","passes":5,"scorecard":{"price":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"macd":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"rsi":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"dxy":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"rates":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"data":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"levels":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"news":{"r":"BULLISH|BEARISH|NEUTRAL","note":"brief"},"candles":{"r":"PASS|FAIL|NEUTRAL","note":"pattern name + tf"},"mtf":{"r":"PASS|FAIL|NEUTRAL","note":"4h/1h/15m agree?"}},"signal_quality":"78/100 — STRONG","entry_type":"Pattern|Optimal|Aggressive|Conservative","reasoning":"2 sentences","exits":["T1 X.XXXX — close 50% move stop to entry","T2 X.XXXX — close rest","Stop X.XXXX — full exit","Time — 4h max"],"news_hl":"headline","news_sent":"BULLISH|BEARISH|NEUTRAL","binary_event":"none or event+timing","data_note":"brief or empty","sources":["url1"],"wait_type":"binary_event|low_confidence|no_setup|wrong_session|none","triggers":{"watch_long":"price or n/a","watch_long_note":"why","watch_short":"price or n/a","watch_short_note":"why","invalidation":"price","invalidation_note":"what the break means","next_session":"HH:MM UTC","next_session_note":"session + why","news_time":"HH:MM UTC or none","news_event":"name or none","candle_close":"HH:MM UTC","candle_close_note":"1h/4h + why","mtf_fix":"what must change","pattern_needed":"pattern + level","indicator_needed":"indicator condition","primary_reason":"main reason","secondary_reason":"second or none","estimated_clarity":"when clearer","refresh_recommendation":"specific actionable line"}}`,

  pipeline: async ({ keys, addLog }) => {
    const tdCandles = async (interval, outputsize=100) => {
      const d=await tdFetch(`https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=${interval}&outputsize=${outputsize}&apikey=${keys.td}`, addLog);
      if(d?.status==="error") throw new Error(`Twelve Data: ${d.message}`);
      const v=(d?.values||[]).reverse();
      return { times:v.map(x=>x.datetime), opens:v.map(x=>parseFloat(x.open)), closes:v.map(x=>parseFloat(x.close)), highs:v.map(x=>parseFloat(x.high)), lows:v.map(x=>parseFloat(x.low)), volumes:v.map(x=>parseFloat(x.volume)||0) };
    };
    const fred = async s => { const r=await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${s}&api_key=${keys.fred}&file_type=json&sort_order=desc&limit=5`); const d=await r.json(); return (d.observations||[]).filter(o=>o.value!==".").map(o=>parseFloat(o.value))[0]??null; };

    addLog("Fetching EUR/USD spot...");
    let spot=null;
    if(keys.td) try{ const d=await tdFetch(`https://api.twelvedata.com/price?symbol=EUR/USD&apikey=${keys.td}`, addLog); if(d?.price&&parseFloat(d.price)>0.5) spot={price:p5(d.price),src:"Twelve Data"}; }catch(_){}
    if(!spot) try{ const r=await fetch("https://open.er-api.com/v6/latest/EUR"); if(r.ok){const d=await r.json();const px=d?.rates?.USD;if(px>0.5) spot={price:p5(px),src:"open.er-api"};} }catch(_){}
    if(!spot) try{ const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=eur"); if(r.ok){const d=await r.json();const e=d?.tether?.eur;if(e>0.5) spot={price:p5(1/e),src:"CoinGecko USDT/EUR"};} }catch(_){}
    if(!spot) throw new Error("Could not fetch EUR/USD price from any source.");
    addLog(`Spot: ${spot.price} (${spot.src})`);

    let td=null, ta=null;
    if(keys.td){ try{
      addLog("Fetching 15m/1h/4h/daily candles in parallel...");
      // allSettled so one failed timeframe doesn't drop the others
      const settled=await Promise.allSettled([tdCandles("15min",100),tdCandles("1h",100),tdCandles("4h",250),tdCandles("1day",30)]);
      const [c15,c1h,c4h,c1d]=settled.map(r=>r.status==="fulfilled"?r.value:null);
      settled.forEach((r,i)=>{ if(r.status==="rejected") addLog(`${["15m","1h","4h","daily"][i]} candles failed: ${r.reason?.message||r.reason}`); });
      if(c1h&&c4h){
        const macd1h=calcMACD(c1h.closes), rsi1h=calcRSI(c1h.closes);
        const vwap=calcVWAP(c1h.highs.slice(-23),c1h.lows.slice(-23),c1h.closes.slice(-23),c1h.volumes.slice(-23));
        const ema50_1h=calcEMAlast(c1h.closes,50);
        const macd4h=calcMACD(c4h.closes), rsi4h=calcRSI(c4h.closes), atr4h=calcATR(c4h.highs,c4h.lows,c4h.closes);
        const ema50=calcEMAlast(c4h.closes,50), ema200=calcEMAlast(c4h.closes,200);
        const pv=c1d&&c1d.closes.length>=2?calcPivots(c1d.highs[c1d.closes.length-2],c1d.lows[c1d.closes.length-2],c1d.closes[c1d.closes.length-2]):null;
        const h24=Math.max(...c1h.highs.slice(-24)), l24=Math.min(...c1h.lows.slice(-24));
        // daily range exhaustion: today's pips vs 20-day avg range
        const todayPips=Math.round((h24-l24)*10000);
        let avgPips=null, rangeUsed=null;
        if(c1d&&c1d.highs.length>=21){ const avgRange=c1d.highs.slice(-21,-1).map((h,i)=>h-c1d.lows.slice(-21,-1)[i]).reduce((a,b)=>a+b,0)/20; avgPips=Math.round(avgRange*10000); rangeUsed=avgPips?Math.round(todayPips/avgPips*100):null; }
        // Asian session range (00:00-08:00 UTC of the most recent day) → break = trigger
        let asianHigh=null, asianLow=null;
        if(c1h.times){ const rows=c1h.times.map((t,i)=>({hr:+(t.slice(11,13)),day:t.slice(0,10),h:c1h.highs[i],l:c1h.lows[i]})).filter(r=>r.hr>=0&&r.hr<8);
          if(rows.length){ const d0=rows[rows.length-1].day, a=rows.filter(r=>r.day===d0); asianHigh=Math.max(...a.map(r=>r.h)); asianLow=Math.min(...a.map(r=>r.l)); } }
        td={ macd1h,rsi1h,vwap,ema50_1h, macd4h,rsi4h,atr4h,ema50,ema200, pivots:pv, h24,l24, todayPips,avgPips,rangeUsed, asianHigh,asianLow };
        ta=analyzeTimeframes({ c15, c1h, c4h, c4hTimes:c4h.times, price:spot.price, atr4h });
        addLog(`1h RSI:${rsi1h.toFixed(1)} | MTF 4h:${ta.t4} 1h:${ta.t1} 15m:${ta.t15} ADX:${ta.adx?.toFixed(0)} pull:${ta.pull?.state||"—"}`);
      } else addLog("1h/4h candles unavailable — skipping local TA");
    }catch(e){ addLog(`Twelve Data error: ${e.message}`); } }

    let macro={dxy:null,fedfunds:null,dgs10:null};
    if(keys.fred){ try{
      addLog("Fetching FRED DXY + Fed funds + 10Y in parallel...");
      const [dxy,fedfunds,dgs10]=await Promise.all([fred("DTWEXBGS"),fred("FEDFUNDS"),fred("DGS10")]);
      macro.dxy=dxy; macro.fedfunds=fedfunds; macro.dgs10=dgs10;
      addLog(`FRED → DXY:${dxy} FedFunds:${fedfunds}% 10Y:${dgs10}%`);
    }catch(e){ addLog(`FRED error: ${e.message}`); } }

    const session=getFxSession();
    const atr=td?.atr4h??null;
    const stopAmt=atr?p5(atr*1.5):null;
    const stopPips=stopAmt?Math.round(stopAmt*10000):null;

    const pkg=`=== PRE-COMPUTED MARKET DATA — DO NOT RE-FETCH ===

PRICE
  EUR/USD Spot: ${spot.price} (${spot.src})
  24h High: ${ff(td?.h24)} | 24h Low: ${ff(td?.l24)}
  VWAP (23h): ${ff(td?.vwap)} → price ${td?.vwap?(spot.price>td.vwap?"ABOVE":"BELOW")+" VWAP":"unknown"}
  Session: ${session.label}

EMAs (4h)  50 EMA:${ff(td?.ema50)} | 200 EMA:${ff(td?.ema200)} → price ${td?.ema200?(spot.price>td.ema200?"ABOVE 200EMA (bull bias)":"BELOW 200EMA (bear bias)"):"unknown"}

MACD  1h: line=${ff(td?.macd1h?.macd)} ${td?.macd1h?.aboveSignal?"ABOVE":"BELOW"} signal | 4h: line=${ff(td?.macd4h?.macd)} ${td?.macd4h?.aboveSignal?"ABOVE":"BELOW"} signal ${td?.macd4h?.expanding?"(expanding)":"(contracting)"}

RSI (14)  1h:${f1(td?.rsi1h)}${rsiLbl(td?.rsi1h)} | 4h:${f1(td?.rsi4h)}${rsiLbl(td?.rsi4h)}

PIVOTS (from prior daily candle)  P:${ff(td?.pivots?.P)} | R1:${ff(td?.pivots?.R1)} R2:${ff(td?.pivots?.R2)} | S1:${ff(td?.pivots?.S1)} S2:${ff(td?.pivots?.S2)}

ATR & STOP (4h)  ATR:${ff(td?.atr4h)} | Recommended stop: ${ff(stopAmt)} (${stopPips??"~50"} pips, 1.5x ATR)

MACRO — FRED  DXY (Fed TWI):${na(macro.dxy)} | Fed Funds:${na(macro.fedfunds)}% | US 10Y:${na(macro.dgs10)}%
  (DXY is ~95% inverse to EUR/USD — rising DXY = bearish EUR. Use web search for ECB policy rate & latest decisions to compute the Fed-vs-ECB differential.)

EUR/USD CONTEXT  50 EMA (1h):${ff(td?.ema50_1h)} → price ${td?.ema50_1h?(spot.price>td.ema50_1h?"ABOVE (short-term bullish)":"BELOW (short-term bearish)"):"unknown"}
  Asian range (00-08 UTC): high ${ff(td?.asianHigh)} / low ${ff(td?.asianLow)} → break above high = potential LONG trigger, break below low = potential SHORT trigger (use as watch_long/watch_short)
  Daily range used: ${td?.rangeUsed!=null?`${td.rangeUsed}% (${td.todayPips}/${td.avgPips} pips avg)`+(td.rangeUsed>80?" — RANGE EXHAUSTED, avoid new entries":""):"n/a"}
  Session note: Asian (00-08 UTC) barely moves — ignore. London open (08-09) sets the range but often reverses — wait for 2nd candle. NY (13:30) often reverses London ("London close trap"). Best candles: 13-16 UTC overlap.

${ta?taPromptBlock(ta, v=>v.toFixed(5)):"MULTI-TIMEFRAME / PATTERNS / FIB: unavailable (no Twelve Data key — score candles & mtf NEUTRAL)"}

=== YOUR JOB: search ECB/Fed guidance, CPI differential, data releases, key S/R, binary events → output JSON ===`;

    return { pkg, price:spot.price, src:spot.src, session, meta:{ td, macro, stopPips, ta } };
  },
  merge:(p,m)=>{
    const { td, macro, ta } = m;
    if(td?.h24&&!p.high_24h) p.high_24h=td.h24.toFixed(5);
    if(td?.l24&&!p.low_24h)  p.low_24h=td.l24.toFixed(5);
    if(td?.vwap&&!p.vwap)    p.vwap=td.vwap.toFixed(5);
    if(td?.ema50)            p.ema50=td.ema50.toFixed(5);
    if(td?.ema200)           p.ema200=td.ema200.toFixed(5);
    if(td?.pivots?.P&&!p.pivot) p.pivot=td.pivots.P.toFixed(5);
    if(macro.dxy!==null&&(!p.dxy||p.dxy==="")) p.dxy=String(macro.dxy);
    p._sources=[...(ta?["Real OHLCV"]:[]),...(macro.dxy!=null?["FRED"]:[])];
    mergeTA(p, ta, v=>v.toFixed(5));
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
  dataNote:"BTC technicals come from Binance + CoinGecko (free, no key). Only the Anthropic key is needed.",
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
    { name:"200 SMA (D)",val:`$${fmt(s.sma200)}` },
    { name:"Support",    val:`$${fmt(s.support)}` },
    { name:"Resistance", val:`$${fmt(s.resistance)}` },
  ],
  extraPanels:(s)=>(
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
  ),
  system:`You are SIGNAL DECK BITCOIN, a BTC/USD analysis engine for paper trading education only. Not financial advice. Never fabricate prices.

ALL TECHNICAL DATA IS PRE-COMPUTED AND PROVIDED — do not search for price, MACD, RSI, ATR, 200 SMA, funding rate, open interest, dominance, or Fear & Greed. These come from Binance/CoinGecko APIs.

YOUR JOB (web search only):
1. ETF FLOWS (most important): Bitcoin spot ETF daily flows — BlackRock IBIT, Fidelity FBTC. Net inflows = bullish, outflows = bearish.
2. ON-CHAIN / WHALES: Exchange inflows/outflows, whale movements (Glassnode/CryptoQuant summaries).
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
- Binary event (FOMC/CPI/PCE) within 24h → WAIT (never hold BTC through macro).
- ≥6 of 10 confirm same direction → LONG or SHORT. <6 = WAIT
- MULTI-TIMEFRAME MASTER RULE: never trade against the 4h trend. 1h must confirm 4h. If 4h and 1h conflict → WAIT, no exceptions. 15m is for entry timing only.
- A reversal candle pattern at a key level against the trend caps confidence at MEDIUM and can flip the call to WAIT.
- SIGNAL QUALITY: <50 = WAIT regardless of everything else; 50-70 = MEDIUM; 70-85 = HIGH; 85+ = VERY HIGH (rare)..
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
    addLog("Fetching BTC market data in parallel (Binance + CoinGecko)...");
    const [tickerR, c15, c1h, c4h, c1d, c1w, fundingR, oiR, oiHistR, domR, fngR] = await Promise.all([
      jget("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"),
      klines("15m",100).catch(()=>null), klines("1h",100).catch(()=>null), klines("4h",100).catch(()=>null),
      klines("1d",220).catch(()=>null), klines("1w",2).catch(()=>null),
      jget("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1"),
      jget("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT"),
      jget("https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=4h&limit=2"),
      jget("https://api.coingecko.com/api/v3/global"),
      jget("https://api.alternative.me/fng/?limit=1"),
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
      td={ macd1h,rsi1h,vol1h, macd4h,rsi4h,atr4h,vol4h, sma200, weeklyDir, whaleWick };
      ta=analyzeTimeframes({ c15, c1h, c4h, c4hTimes:c4h.times, price:spot.price, atr4h });
      addLog(`MTF 4h:${ta.t4} 1h:${ta.t1} 15m:${ta.t15} ADX:${ta.adx?.toFixed(0)} pull:${ta.pull?.state||"—"} weekly:${weeklyDir}`);
    }catch(e){ addLog(`Binance candles error: ${e.message}`); } }

    let funding=null, oi=null, oiTrend="—", dom=null, fng=null, fngLabel=null;
    if(fundingR?.[0]?.fundingRate!=null) funding=parseFloat(fundingR[0].fundingRate)*100;
    if(oiR?.openInterest) oi=parseFloat(oiR.openInterest);
    if(Array.isArray(oiHistR)&&oiHistR.length>=2){ const a=parseFloat(oiHistR[oiHistR.length-1].sumOpenInterest), b=parseFloat(oiHistR[oiHistR.length-2].sumOpenInterest); if(a&&b) oiTrend=a>b*1.005?"Rising":a<b*0.995?"Falling":"Flat"; }
    if(domR?.data?.market_cap_percentage?.btc!=null) dom=domR.data.market_cap_percentage.btc;
    if(fngR?.data?.[0]?.value){ fng=parseInt(fngR.data[0].value); fngLabel=fngR.data[0].value_classification; }
    addLog(`Funding:${funding!=null?funding.toFixed(4)+"%":"n/a"} OI:${oi!=null?Math.round(oi).toLocaleString():"n/a"}(${oiTrend}) Dom:${dom!=null?dom.toFixed(1)+"%":"n/a"} F&G:${fng!=null?fng+" "+fngLabel:"n/a"}`);

    const session=getCryptoSession();
    const atr=td?.atr4h??null;
    const stopAmt=atr?p2(atr*1.5):null, stopPct=stopAmt?p2((stopAmt/spot.price)*100):null;

    const fundLbl = funding!=null?(funding>0.1?" (CROWDED LONGS — contrarian bearish)":funding<-0.05?" (CROWDED SHORTS — contrarian bullish)":" (neutral)"):"";
    const fngTxt  = fng!=null?(fng<20?" (Extreme Fear — contrarian LONG)":fng>80?" (Extreme Greed — contrarian SHORT)":""):"";

    const pkg=`=== PRE-COMPUTED MARKET DATA — DO NOT RE-FETCH ===

PRICE
  BTC/USD Spot: $${spot.price} (${spot.src})${chg!=null?` | 24h change ${chg>0?"+":""}${chg}%`:""}
  24h High: $${na(h24)} | 24h Low: $${na(l24)}
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

${ta?taPromptBlock(ta, v=>"$"+f2(v)):"MULTI-TIMEFRAME / PATTERNS / FIB: unavailable — score candles & mtf NEUTRAL"}

=== YOUR JOB: search BTC spot ETF daily flows (IBIT/FBTC — MOST IMPORTANT), whale/on-chain, regulatory news, Nasdaq/VIX risk tone, key round-number S/R, binary events → output JSON ===`;

    return { pkg, price:spot.price, src:spot.src, session,
      meta:{ td, h24, l24, funding, oi, oiTrend, dom, fng, fngLabel, ta } };
  },
  merge:(p,m)=>{
    const { td, h24, l24, funding, oi, oiTrend, dom, fng, fngLabel, ta } = m;
    if(h24!=null&&!p.high_24h) p.high_24h=String(h24);
    if(l24!=null&&!p.low_24h)  p.low_24h=String(l24);
    if(td?.sma200)             p.sma200=td.sma200.toFixed(2);
    if(funding!=null)          p.funding_rate=`${funding.toFixed(4)}%`;
    if(oi!=null)               p.open_interest=`${Math.round(oi).toLocaleString()} BTC`;
    if(oiTrend)                p.oi_trend=oiTrend;
    if(dom!=null)              p.btc_dominance=`${dom.toFixed(1)}%`;
    if(fng!=null&&(!p.fear_greed||p.fear_greed==="")) p.fear_greed=`${fng} ${fngLabel||""}`.trim();
    p._sources=[...(ta?["Binance OHLCV"]:[]),...(dom!=null?["CoinGecko"]:[]),...(funding!=null?["Funding/OI"]:[])];
    mergeTA(p, ta, v=>v.toFixed(2));
  },
};

export const ASSETS = { gold:GOLD, eur:EUR, btc:BTC };
