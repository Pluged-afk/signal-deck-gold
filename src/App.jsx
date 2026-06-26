import { useState, useCallback, useRef } from "react";

// ─── ACCESS GATE ─────────────────────────────────────────────────────────────
const ACCESS_CODE = "XAU-7749-GOLD";
const SESSION_KEY = "sdg_unlocked";

function AccessGate({ onUnlock }) {
  const [input, setInput]   = useState("");
  const [shake, setShake]   = useState(false);
  const [tries, setTries]   = useState(0);

  const attempt = () => {
    if (input.trim() === ACCESS_CODE) {
      sessionStorage.setItem(SESSION_KEY, "1");
      onUnlock();
    } else {
      setShake(true);
      setTries(t => t + 1);
      setInput("");
      setTimeout(() => setShake(false), 600);
    }
  };

  const mono = { fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace" };

  return (
    <div style={{background:"#020617",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div style={{
        background:"#0f172a", border:"1px solid #1e293b", borderRadius:16,
        padding:"2.5rem 2rem", width:"100%", maxWidth:360, textAlign:"center",
        animation: shake ? "shake 0.5s ease" : "none"
      }}>
        <p style={{fontSize:20,margin:"0 0 4px",color:"#fbbf24",fontWeight:700,letterSpacing:"0.06em"}}>✦ SIGNAL DECK GOLD</p>
        <p style={{...mono, fontSize:11, color:"#475569", margin:"0 0 2rem"}}>Private access only</p>
        <input
          type="password"
          placeholder="Enter access code"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && attempt()}
          autoFocus
          style={{
            width:"100%", padding:"10px 12px", background:"#020617",
            border:`1px solid ${shake?"#7f1d1d":"#334155"}`, borderRadius:8,
            color:"#e2e8f0", fontSize:13, ...mono, boxSizing:"border-box",
            textAlign:"center", letterSpacing:"0.12em", marginBottom:"0.9rem", outline:"none"
          }}
        />
        <button
          onClick={attempt}
          style={{
            width:"100%", padding:"10px", background:"#1e3a5f",
            border:"1px solid #2563eb", borderRadius:8, color:"#60a5fa",
            fontSize:13, cursor:"pointer", ...mono
          }}
        >
          Unlock →
        </button>
        {tries > 0 && (
          <p style={{...mono, fontSize:11, color:"#7f1d1d", margin:"0.75rem 0 0"}}>
            Incorrect code{tries > 2 ? ` (${tries} attempts)` : ""}
          </p>
        )}
      </div>
      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-8px)}
          40%{transform:translateX(8px)}
          60%{transform:translateX(-6px)}
          80%{transform:translateX(6px)}
        }
      `}</style>
    </div>
  );
}

// ─── ROOT EXPORT ─────────────────────────────────────────────────────────────
export default function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === "1");
  if (!unlocked) return <AccessGate onUnlock={() => setUnlocked(true)} />;
  return <SignalDeckGold />;
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM = `You are SIGNAL DECK GOLD, an XAU/USD analysis engine for paper trading education only. Not financial advice. Never fabricate prices.

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
- ≥5 of 8 confirm same direction → LONG or SHORT. <5 = WAIT
- Three-timeframe MACD alignment is a strong standalone signal — weight it heavily
- DXY and yield conflict → confidence capped at MEDIUM
- Low volume breakout → confidence capped at MEDIUM
- COT net >200k + price at resistance = high-probability SHORT
- Stop: use the ATR-based value provided. Do not widen it.
- T1: min 1.5× ATR from entry. T2: min 2.5× ATR. R:R <1:2 → WAIT
- Off-peak session + no strong catalyst → cap confidence at MEDIUM

Respond ONLY with valid JSON, no markdown, no text outside it:
{"action":"LONG|SHORT|WAIT","price":"XXXX.XX","confidence":"HIGH|MEDIUM|LOW","entry":"XXXX.XX","entry_note":"brief","stop":"XXXX.XX","stop_note":"ATR-based","stop_pct":"0.7","t1":"XXXX.XX","t2":"XXXX.XX","rr":"1:2.5","high_24h":"XXXX.XX","low_24h":"XXXX.XX","vwap":"XXXX.XX","support":"XXXX.XX","resistance":"XXXX.XX","ma200":"XXXX.XX","dxy":"XXX.XX","real_yield":"X.XX%","cot_net":"XXXXX","cot_sentiment":"NEUTRAL","passes":5,"scorecard":{"price":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"macd":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"rsi_ma":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"volume":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"dxy_yield":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"cot":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"history":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"news":{"r":"BULLISH|BEARISH|NEUTRAL","note":"brief"}},"reasoning":"2 sentences","exits":["T1 $XXXX — close 50% move stop to entry","T2 $XXXX — close rest","Stop $XXXX — full exit","Time — 4h max"],"news_hl":"headline","news_sent":"BULLISH|BEARISH|NEUTRAL","binary_event":"none or event+timing","data_note":"brief or empty","sources":["url1"]}`;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SC_ROWS = [
  { key:"price",     label:"1. Price & VWAP"       },
  { key:"macd",      label:"2. MACD 1h/4h/Daily"   },
  { key:"rsi_ma",    label:"3. RSI + 200MA"         },
  { key:"volume",    label:"4. Volume Confirmation" },
  { key:"dxy_yield", label:"5. DXY + Real Yield"   },
  { key:"cot",       label:"6. COT Positioning"     },
  { key:"history",   label:"7. Levels / Context"    },
  { key:"news",      label:"8. News / Macro"        },
];

const mono = { fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace", fontWeight:500 };
const card = { background:"#0f172a", borderRadius:12, border:"1px solid #1e293b", padding:"0.9rem 1.1rem" };
const lbl  = { fontSize:10, color:"#475569", letterSpacing:"0.08em", margin:"0 0 8px", textTransform:"uppercase", fontWeight:600 };
const fmt  = v => (v!==undefined&&v!==null&&v!==""&&v!=="null") ? v : "—";
const p2   = n => parseFloat(parseFloat(n).toFixed(2));

const aStyl = a => a==="LONG"  ? {bg:"#052e16",fg:"#4ade80",border:"#166534"}
                 : a==="SHORT" ? {bg:"#450a0a",fg:"#f87171",border:"#7f1d1d"}
                 :               {bg:"#1c1408",fg:"#fbbf24",border:"#78350f"};
const rStyl = r => (r==="PASS"||r==="BULLISH") ? {bg:"#052e16",fg:"#4ade80"}
                 : (r==="FAIL"||r==="BEARISH") ? {bg:"#450a0a",fg:"#f87171"}
                 :                               {bg:"#1e1b4b",fg:"#a5b4fc"};
const cCol = c => c==="HIGH"?"#4ade80":c==="LOW"?"#f87171":"#fbbf24";
const sCol = s => s==="BULLISH"?"#4ade80":s==="BEARISH"?"#f87171":"#94a3b8";

const getSession = () => {
  const h=new Date().getUTCHours(), d=new Date().getUTCDay();
  if(d===0||d===6) return "Weekend";
  if(h>=8&&h<10)   return "London Open";
  if(h>=10&&h<13)  return "London Mid";
  if(h>=13&&h<17)  return "US Session";
  if(h>=17&&h<20)  return "US Close";
  return "Off-Peak";
};

const parseJSON = raw => {
  const clean=raw.replace(/```[a-z]*\n?/gi,"").trim();
  const start=clean.indexOf("{"); if(start===-1) return null;
  const end=clean.lastIndexOf("}");
  if(end>start){ try{ return JSON.parse(clean.substring(start,end+1)); }catch(_){} }
  let s=clean.substring(start);
  try{ return JSON.parse(s); }catch(_){}
  s=s.replace(/,?\s*"[^"]*$/,"").replace(/,?\s*[\w.]*$/,"");
  const oA=(s.match(/\[/g)||[]).length-(s.match(/\]/g)||[]).length;
  for(let i=0;i<oA;i++) s+="]";
  const oO=(s.match(/\{/g)||[]).length-(s.match(/\}/g)||[]).length;
  for(let i=0;i<oO;i++) s+="}";
  try{ return JSON.parse(s); }catch(_){ return null; }
};

// ─── Technical calculations ───────────────────────────────────────────────────
const calcEMA = (values, period) => {
  const k=2/(period+1);
  let ema=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  const r=new Array(period-1).fill(null); r.push(ema);
  for(let i=period;i<values.length;i++){ ema=values[i]*k+ema*(1-k); r.push(ema); }
  return r;
};
const calcMACD = closes => {
  const e12=calcEMA(closes,12), e26=calcEMA(closes,26);
  const ml=e12.map((v,i)=>(v&&e26[i])?v-e26[i]:null);
  const valid=ml.filter(Boolean);
  const sig=calcEMA(valid,9);
  const last=valid.slice(-1)[0], s9=sig.slice(-1)[0];
  const prev=valid.slice(-2)[0], ps=sig.slice(-2)[0];
  const hist=last-s9, ph=prev-ps;
  return { macd:last, signal:s9, histogram:hist, aboveSignal:last>s9, expanding:Math.abs(hist)>Math.abs(ph) };
};
const calcRSI = (closes, period=14) => {
  let g=0, l=0;
  for(let i=1;i<=period;i++){ const d=closes[i]-closes[i-1]; if(d>0) g+=d; else l-=d; }
  let ag=g/period, al=l/period;
  for(let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    ag=(ag*(period-1)+(d>0?d:0))/period;
    al=(al*(period-1)+(d<0?-d:0))/period;
  }
  return al===0?100:100-(100/(1+ag/al));
};
const calcATR = (highs, lows, closes, period=14) => {
  const trs=[];
  for(let i=1;i<highs.length;i++)
    trs.push(Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1])));
  return trs.slice(-period).reduce((a,b)=>a+b,0)/period;
};
const calcSMA = (values, period) => {
  const s=values.slice(-period);
  return s.length===period ? s.reduce((a,b)=>a+b,0)/period : null;
};
const calcVWAP = (highs, lows, closes, volumes) => {
  let cumTPV=0, cumVol=0;
  for(let i=0;i<closes.length;i++){
    const tp=(highs[i]+lows[i]+closes[i])/3;
    cumTPV+=tp*(volumes[i]||0); cumVol+=(volumes[i]||0);
  }
  return cumVol>0 ? cumTPV/cumVol : null;
};
const calcVolRatio = (volumes, period=20) => {
  if(volumes.length<period+1) return null;
  const avg=volumes.slice(-period-1,-1).reduce((a,b)=>a+b,0)/period;
  const cur=volumes[volumes.length-1];
  return avg>0 ? { current:cur, average:avg, ratio:cur/avg } : null;
};

// ─── Main component ───────────────────────────────────────────────────────────
function SignalDeckGold() {
  const savedKeys = () => { try { return JSON.parse(localStorage.getItem("sdg_keys")||"{}"); } catch(_){ return {}; } };
  const [keys,    setKeys]    = useState({ anthropic:"", td:"", fred:"", ...savedKeys() });
  const [tmpKeys, setTmpKeys] = useState({ anthropic:"", td:"", fred:"", ...savedKeys() });
  const [keysSet, setKeysSet] = useState(() => !!savedKeys().anthropic);
  const [sig,     setSig]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [ts,      setTs]      = useState(null);
  const [dataLog, setDataLog] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef([]);

  const addLog = msg => {
    logRef.current=[...logRef.current,`[${new Date().toLocaleTimeString()}] ${msg}`];
    setDataLog([...logRef.current]);
  };

  const fetchCandles = async (interval, outputsize=100) => {
    const r=await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${outputsize}&apikey=${keys.td}`);
    const d=await r.json();
    if(d.status==="error") throw new Error(`Twelve Data: ${d.message}`);
    const vals=(d.values||[]).reverse();
    return {
      closes:  vals.map(v=>parseFloat(v.close)),
      highs:   vals.map(v=>parseFloat(v.high)),
      lows:    vals.map(v=>parseFloat(v.low)),
      volumes: vals.map(v=>parseFloat(v.volume)||0),
    };
  };

  const fetchFRED = async series => {
    const r=await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${keys.fred}&file_type=json&sort_order=desc&limit=5`);
    const d=await r.json();
    return (d.observations||[]).filter(o=>o.value!==".").map(o=>parseFloat(o.value))[0]??null;
  };

  const fetchSpot = async () => {
    if(keys.td) try{
      const r=await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${keys.td}`);
      const d=await r.json();
      if(d.price&&parseFloat(d.price)>100) return {price:p2(d.price),src:"Twelve Data"};
    }catch(_){}
    try{
      const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd");
      if(r.ok){const d=await r.json(),g=d?.["pax-gold"];if(g?.usd>100) return {price:p2(g.usd),src:"CoinGecko PAXG"};}
    }catch(_){}
    try{
      const r=await fetch("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD");
      if(r.ok){const d=await r.json(),q=d?.[0]?.spreadProfilePrices?.find(x=>x.spreadProfile==="prime");if(q?.ask&&q?.bid) return {price:p2((q.ask+q.bid)/2),src:"Swissquote"};}
    }catch(_){}
    return null;
  };

  const fetchCOT = async () => {
    try{
      const r=await fetch("https://publicreporting.cftc.gov/resource/yw9f-hn96.json?$limit=2&$order=report_date_as_yyyy_mm_dd%20DESC&$where=commodity_name%20like%20'%25GOLD%25'");
      if(!r.ok) return null;
      const d=await r.json(); if(!d.length) return null;
      const lat=d[0], prev=d[1];
      const mmL=parseInt(lat.managed_money_positions_long_all||0);
      const mmS=parseInt(lat.managed_money_positions_short_all||0);
      const net=mmL-mmS;
      const pNet=prev?parseInt(prev.managed_money_positions_long_all||0)-parseInt(prev.managed_money_positions_short_all||0):null;
      return { mmLong:mmL, mmShort:mmS, netMM:net, weekChange:pNet!==null?net-pNet:null,
               reportDate:lat.report_date_as_yyyy_mm_dd,
               sentiment:net>200000?"CROWDED_LONG":net<50000?"CROWDED_SHORT":"NEUTRAL" };
    }catch(_){ return null; }
  };

  const fetchSignal = useCallback(async () => {
    setLoading(true); setError(null); logRef.current=[]; setDataLog([]);
    try{
      addLog("Fetching spot price...");
      const spot=await fetchSpot();
      if(!spot) throw new Error("Could not fetch gold spot price from any source.");
      addLog(`Spot: $${spot.price} (${spot.src})`);

      let td=null;
      if(keys.td){
        try{
          addLog("Fetching 1h candles...");
          const c1h=await fetchCandles("1h",100);
          const macd1h=calcMACD(c1h.closes);
          const rsi1h=calcRSI(c1h.closes);
          const atr1h=calcATR(c1h.highs,c1h.lows,c1h.closes);
          const vwap=calcVWAP(c1h.highs.slice(-23),c1h.lows.slice(-23),c1h.closes.slice(-23),c1h.volumes.slice(-23));
          const vol1h=calcVolRatio(c1h.volumes);
          addLog(`1h → MACD:${macd1h.macd?.toFixed(2)} RSI:${rsi1h.toFixed(1)} VWAP:$${vwap?.toFixed(2)} Vol:${vol1h?.ratio?.toFixed(2)}x`);

          addLog("Fetching 4h candles...");
          const c4h=await fetchCandles("4h",100);
          const macd4h=calcMACD(c4h.closes);
          const rsi4h=calcRSI(c4h.closes);
          const atr4h=calcATR(c4h.highs,c4h.lows,c4h.closes);
          const vol4h=calcVolRatio(c4h.volumes);
          addLog(`4h → MACD:${macd4h.macd?.toFixed(2)} RSI:${rsi4h.toFixed(1)} ATR:$${atr4h.toFixed(2)}`);

          addLog("Fetching daily candles (200MA + daily MACD/RSI)...");
          const c1d=await fetchCandles("1day",210);
          const ma200=calcSMA(c1d.closes,200);
          const macdD=calcMACD(c1d.closes);
          const rsiD=calcRSI(c1d.closes);
          const volD=calcVolRatio(c1d.volumes);
          const h24=Math.max(...c1h.highs.slice(-24));
          const l24=Math.min(...c1h.lows.slice(-24));
          addLog(`Daily → MACD:${macdD.macd?.toFixed(2)} RSI:${rsiD.toFixed(1)} 200MA:$${ma200?.toFixed(2)}`);

          const bullMacd=[macd1h,macd4h,macdD].filter(m=>m?.aboveSignal).length;
          td={ macd1h,rsi1h,atr1h,vwap,vol1h, macd4h,rsi4h,atr4h,vol4h, macdD,rsiD,volD,
               ma200,h24,l24, bullMacd, bearMacd:3-bullMacd };
        }catch(e){ addLog(`Twelve Data error: ${e.message}`); }
      }

      let fred={nominal:null,tips:null,realYield:null,dxy:null};
      if(keys.fred){
        try{
          addLog("Fetching FRED: yields + DXY...");
          fred.nominal=await fetchFRED("DGS10");
          fred.tips=await fetchFRED("T10YIE");
          if(fred.nominal&&fred.tips) fred.realYield=p2(fred.nominal-fred.tips);
          fred.dxy=await fetchFRED("DTWEXBGS");
          addLog(`FRED → nominal:${fred.nominal}% real:${fred.realYield}% DXY:${fred.dxy}`);
        }catch(e){ addLog(`FRED error: ${e.message}`); }
      }

      addLog("Fetching COT data (CFTC)...");
      const cot=await fetchCOT();
      cot ? addLog(`COT → net:${cot.netMM?.toLocaleString()} ${cot.sentiment} Δwk:${cot.weekChange?.toLocaleString()??"n/a"}`)
          : addLog("COT unavailable");

      const session=getSession();
      const atr=td?.atr4h??td?.atr1h??null;
      const stopAmt=atr?p2(atr*1.5):null;
      const stopPct=stopAmt?p2((stopAmt/spot.price)*100):null;

      const na = v => v??'unavailable';
      const f3 = v => v?.toFixed(3)??'n/a';
      const f2 = v => v?.toFixed(2)??'n/a';
      const f1 = v => v?.toFixed(1)??'n/a';
      const rsiLbl = v => !v?'':(v>70?' (OVERBOUGHT)':v<30?' (OVERSOLD)':' (neutral)');
      const volLbl = r => !r?'':(r>1.5?' HIGH — confirms':r<0.8?' LOW — weak':' normal');

      const pkg=`=== PRE-COMPUTED MARKET DATA — DO NOT RE-FETCH ===

PRICE
  XAU/USD Spot:  $${spot.price} (${spot.src})
  24h High: $${td?.h24??spot.h24??"unknown"} | 24h Low: $${td?.l24??spot.l24??"unknown"}
  VWAP (23h):    $${f2(td?.vwap)} → price ${td?.vwap?(spot.price>td.vwap?"ABOVE — bullish intraday":"BELOW — bearish intraday"):"vs VWAP unknown"}
  Session: ${session}

MACD — THREE TIMEFRAMES
  1h:    line=${f3(td?.macd1h?.macd)} sig=${f3(td?.macd1h?.signal)} hist=${f3(td?.macd1h?.histogram)} | ${td?.macd1h?.aboveSignal?"ABOVE":"BELOW"} signal | hist ${td?.macd1h?.expanding?"EXPANDING":"CONTRACTING"}
  4h:    line=${f3(td?.macd4h?.macd)} sig=${f3(td?.macd4h?.signal)} hist=${f3(td?.macd4h?.histogram)} | ${td?.macd4h?.aboveSignal?"ABOVE":"BELOW"} signal | hist ${td?.macd4h?.expanding?"EXPANDING":"CONTRACTING"}
  Daily: line=${f3(td?.macdD?.macd)} sig=${f3(td?.macdD?.signal)} hist=${f3(td?.macdD?.histogram)} | ${td?.macdD?.aboveSignal?"ABOVE":"BELOW"} signal | hist ${td?.macdD?.expanding?"EXPANDING":"CONTRACTING"}
  Alignment: ${td?`${td.bullMacd}/3 bullish, ${td.bearMacd}/3 bearish${td.bullMacd===3?" — ALL THREE BULLISH (strong)":td.bearMacd===3?" — ALL THREE BEARISH (strong)":""}` : "unavailable"}

RSI (14-period)
  1h: ${f1(td?.rsi1h)}${rsiLbl(td?.rsi1h)} | 4h: ${f1(td?.rsi4h)}${rsiLbl(td?.rsi4h)} | Daily: ${f1(td?.rsiD)}${rsiLbl(td?.rsiD)}
  200MA: $${f2(td?.ma200)} → price ${td?.ma200?(spot.price>td.ma200?"ABOVE (bull bias)":"BELOW (bear bias)"):"unknown"}

VOLUME (vs 20-period average)
  1h ratio:    ${td?.vol1h?`${td.vol1h.ratio.toFixed(2)}x${volLbl(td.vol1h.ratio)}`:"unavailable"}
  4h ratio:    ${td?.vol4h?`${td.vol4h.ratio.toFixed(2)}x${volLbl(td.vol4h.ratio)}`:"unavailable"}
  Daily ratio: ${td?.volD?`${td.volD.ratio.toFixed(2)}x${volLbl(td.volD.ratio)}`:"unavailable"}

ATR & STOP
  1h ATR: $${f2(td?.atr1h)} | 4h ATR: $${f2(td?.atr4h)}
  Recommended stop: $${na(stopAmt)} (${na(stopPct)}% from entry)

MACRO — FRED
  10Y Nominal: ${na(fred.nominal)}% | TIPS Breakeven: ${na(fred.tips)}%
  Real Yield:  ${na(fred.realYield)}%${fred.realYield!==null?(fred.realYield>1.5?" (HIGH — bearish)":fred.realYield<0.5?" (LOW — bullish)":" (moderate)"):""}
  DXY (Fed TWI): ${na(fred.dxy)}

COT — CFTC Managed Money (hedge funds, published weekly)
  Report date: ${na(cot?.reportDate)}
  MM Long: ${cot?.mmLong?.toLocaleString()??"n/a"} | MM Short: ${cot?.mmShort?.toLocaleString()??"n/a"}
  Net MM:  ${cot?.netMM?.toLocaleString()??"n/a"} | Week Δ: ${cot?.weekChange!==null?(cot.weekChange>0?"+":"")+cot.weekChange?.toLocaleString():"n/a"}
  Sentiment: ${na(cot?.sentiment)} (>200k=CROWDED LONG=bearish signal, <50k=CROWDED SHORT=bullish signal)

=== YOUR JOB: search news, key S/R levels, binary events, Fed speakers → output JSON ===`.trim();

      addLog("Sending to AI for news + synthesis...");
      const tools=[{type:"web_search_20250305",name:"web_search"}];
      let history=[{role:"user",content:pkg}];
      let finalText="";

      for(let i=0;i<10;i++){
        const res=await fetch("https://api.anthropic.com/v1/messages",{
          method:"POST",
          headers:{"Content-Type":"application/json","x-api-key":keys.anthropic,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
          body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:2000,system:SYSTEM,tools,messages:history})
        });
        if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e?.error?.message||`API error ${res.status}`);}
        const data=await res.json();
        const texts=(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
        if(texts) finalText=texts;
        if(data.stop_reason==="end_turn") break;
        history.push({role:"assistant",content:data.content});
        if(data.stop_reason==="tool_use"){
          addLog("AI searching web...");
          const results=(data.content||[]).filter(b=>b.type==="tool_use").map(b=>({type:"tool_result",tool_use_id:b.id,content:"Search executed."}));
          if(results.length) history.push({role:"user",content:results}); else break;
        } else break;
      }

      const parsed=parseJSON(finalText);
      if(!parsed) throw new Error("Could not parse signal JSON. Please retry.");
      parsed.session=session;
      if(td?.h24&&!parsed.high_24h)   parsed.high_24h=String(td.h24);
      if(td?.l24&&!parsed.low_24h)    parsed.low_24h=String(td.l24);
      if(td?.ma200)                    parsed.ma200=td.ma200.toFixed(2);
      if(td?.vwap&&!parsed.vwap)      parsed.vwap=td.vwap.toFixed(2);
      if(fred.realYield!==null)        parsed.real_yield=`${fred.realYield}%`;
      if(fred.dxy!==null)              parsed.dxy=String(fred.dxy);
      if(cot&&!parsed.cot_net)         parsed.cot_net=cot.netMM?.toLocaleString();
      if(cot&&!parsed.cot_sentiment)   parsed.cot_sentiment=cot.sentiment;
      addLog("Signal complete.");
      setSig(parsed); setTs(new Date());

    }catch(e){ setError(e.message||"Unknown error"); addLog(`ERROR: ${e.message}`); }
    finally  { setLoading(false); }
  },[keys]);

  const as=sig?aStyl(sig.action):{};
  const sc=sig?.scorecard||{};

  const inputStyle={ width:"100%", padding:"8px 10px", background:"#0f172a", border:"1px solid #334155", borderRadius:8, color:"#e2e8f0", fontSize:12, ...mono, boxSizing:"border-box" };
  const btn=(col="#3b82f6")=>({ padding:"8px 18px", background:col==="gold"?"#92400e":"#1e3a5f", border:`1px solid ${col==="gold"?"#d97706":"#2563eb"}`, borderRadius:8, color:col==="gold"?"#fbbf24":"#60a5fa", fontSize:12, cursor:"pointer", ...mono });

  return (
    <div style={{background:"#020617",minHeight:"100vh",color:"#e2e8f0",padding:"1rem",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
    <div style={{maxWidth:660,margin:"0 auto"}}>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.9rem",paddingBottom:"0.75rem",borderBottom:"1px solid #1e293b"}}>
        <div>
          <span style={{fontWeight:700,fontSize:14,letterSpacing:"0.06em",color:"#fbbf24"}}>✦ SIGNAL DECK GOLD</span>
          <span style={{...mono,fontSize:11,color:"#475569",marginLeft:8}}>XAU/USD · 8-Step · Real APIs</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {ts&&<span style={{...mono,fontSize:11,color:"#475569"}}>{ts.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>}
          {keysSet&&<button onClick={fetchSignal} disabled={loading} style={btn()}>{loading?"Scanning...":"Refresh ↗"}</button>}
          <button onClick={()=>setKeysSet(false)} style={{...btn("gold"),fontSize:11,padding:"6px 10px"}}>⚙ Keys</button>
        </div>
      </div>

      {/* Key Setup */}
      {!keysSet&&(
        <div style={{...card,marginBottom:12}}>
          <p style={{...lbl,color:"#fbbf24",marginBottom:12}}>🔑 API Key Setup</p>
          <p style={{fontSize:12,color:"#64748b",margin:"0 0 16px",lineHeight:1.6}}>
            Keys stay in browser memory only — never stored or sent anywhere except the API they belong to.<br/>
            <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" style={{color:"#3b82f6"}}>Anthropic</a>
            {" · "}
            <a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer" style={{color:"#3b82f6"}}>Twelve Data</a>
            {" · "}
            <a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank" rel="noopener noreferrer" style={{color:"#3b82f6"}}>FRED</a>
          </p>
          {[
            {field:"anthropic", label:"Anthropic API Key", hint:"required — powers the AI signal", ph:"sk-ant-..."},
            {field:"td",        label:"Twelve Data Key",   hint:"MACD, RSI, ATR, VWAP, Volume, 200MA", ph:"a1b2c3d4..."},
            {field:"fred",      label:"FRED API Key",      hint:"real yield + DXY (free, instant)", ph:"abcdef123456..."},
          ].map(({field,label,hint,ph})=>(
            <div key={field} style={{marginBottom:12}}>
              <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>
                {label} <span style={{color:field==="anthropic"?"#f87171":"#4ade80"}}>({hint})</span>
              </label>
              <input type="password" placeholder={ph} value={tmpKeys[field]}
                onChange={e=>setTmpKeys(k=>({...k,[field]:e.target.value}))} style={inputStyle}/>
            </div>
          ))}
          <div style={{display:"flex",gap:10,marginTop:4}}>
            <button onClick={()=>{localStorage.setItem("sdg_keys",JSON.stringify(tmpKeys));setKeys(tmpKeys);setKeysSet(true);}} style={{...btn(),flex:1,textAlign:"center"}}>Save Keys & Run Analysis ↗</button>
            <button onClick={()=>{const k={...tmpKeys,td:"",fred:""};localStorage.setItem("sdg_keys",JSON.stringify(k));setKeys(k);setKeysSet(true);}} style={{...btn("gold"),fontSize:11}}>Anthropic only</button>
          </div>
          <p style={{fontSize:10,color:"#334155",margin:"10px 0 0"}}>Without Twelve Data: MACD/RSI/ATR/VWAP inferred by AI. Without FRED: yields/DXY from web search. Both reduce accuracy.</p>
        </div>
      )}

      {/* Ready */}
      {keysSet&&!sig&&!loading&&!error&&(
        <div style={{...card,textAlign:"center",padding:"2.5rem 1.5rem"}}>
          <p style={{...mono,fontSize:13,color:"#64748b",margin:"0 0 6px"}}>SIGNAL DECK GOLD ready</p>
          <p style={{fontSize:11,color:"#475569",margin:"0 0 4px"}}>
            {keys.td?"✓ Twelve Data (MACD/RSI/ATR/VWAP/Volume/200MA)":"⚠ No Twelve Data — AI inference only"}
          </p>
          <p style={{fontSize:11,color:"#475569",margin:"0 0 16px"}}>
            {keys.fred?"✓ FRED (real yield + DXY)":"⚠ No FRED — web search fallback"} · COT (CFTC, public) · Web search (news + levels)
          </p>
          <button onClick={fetchSignal} style={btn()}>Run Analysis ↗</button>
        </div>
      )}

      {/* Loading */}
      {loading&&(
        <div style={{...card,marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:14,paddingTop:8}}>
            {[0,1,2,3].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"#ca8a04",animation:`bounce 1.4s ease-in-out ${i*0.22}s infinite`}}/>)}
          </div>
          <p style={{...mono,fontSize:12,color:"#64748b",textAlign:"center",margin:"0 0 10px"}}>
            {dataLog.slice(-1)[0]?.replace(/^\[.*?\] /,"")||"Initializing..."}
          </p>
          <div style={{background:"#020617",borderRadius:8,padding:"8px 10px",maxHeight:110,overflowY:"auto"}}>
            {dataLog.map((l,i)=><div key={i} style={{...mono,fontSize:10,color:"#334155",lineHeight:1.6}}>{l}</div>)}
          </div>
        </div>
      )}

      {/* Error */}
      {error&&!loading&&(
        <div style={{...card,background:"#1a0505",border:"1px solid #7f1d1d",marginBottom:10}}>
          <p style={{fontWeight:600,fontSize:13,color:"#f87171",margin:"0 0 4px"}}>Error</p>
          <p style={{fontSize:12,color:"#fca5a5",margin:"0 0 8px"}}>{error}</p>
          <button onClick={fetchSignal} style={{...btn(),fontSize:11}}>Retry ↗</button>
        </div>
      )}

      {/* Signal */}
      {sig&&!loading&&(<>

        {/* Hero */}
        <div style={{...card,marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{background:as.bg,color:as.fg,border:`1px solid ${as.border}`,padding:"12px 18px",borderRadius:10,...mono,fontSize:20,fontWeight:700,letterSpacing:"0.1em",minWidth:95,textAlign:"center"}}>
              {sig.action}
            </div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                <span style={{...mono,fontSize:26,lineHeight:1,color:"#f1f5f9"}}>${fmt(sig.price)}</span>
                <span style={{fontSize:11,color:"#475569"}}>XAU/USD</span>
              </div>
              <div style={{display:"flex",gap:8,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{...mono,fontSize:11,color:"#64748b",padding:"2px 7px",background:"#1e293b",border:"1px solid #334155",borderRadius:6}}>{sig.session}</span>
                {sig.passes!==undefined&&<span style={{...mono,fontSize:11,color:sig.passes>=5?"#4ade80":sig.passes>=4?"#fbbf24":"#f87171"}}>{sig.passes}/8 confirmed</span>}
                {keys.td&&<span style={{fontSize:10,color:"#4ade80",...mono}}>✓ Real OHLCV</span>}
                {keys.fred&&<span style={{fontSize:10,color:"#4ade80",...mono}}>✓ FRED</span>}
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <p style={{fontSize:10,color:"#475569",margin:"0 0 2px",letterSpacing:"0.07em"}}>CONFIDENCE</p>
              <p style={{...mono,fontSize:16,margin:0,color:cCol(sig.confidence)}}>{sig.confidence}</p>
            </div>
          </div>
          {sig.binary_event&&sig.binary_event!=="none"&&sig.binary_event!==""&&(
            <div style={{marginTop:8,padding:"6px 10px",background:"#1c1408",borderRadius:8,border:"1px solid #78350f"}}>
              <span style={{fontSize:11,color:"#fbbf24",...mono}}>⚠ Binary event: {sig.binary_event}</span>
            </div>
          )}
        </div>

        {/* Entry + Levels */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div style={card}>
            <p style={lbl}>Entry Plan</p>
            {[
              {name:"Entry",    val:`$${fmt(sig.entry)}`,  sub:sig.entry_note},
              {name:"Stop",     val:`$${fmt(sig.stop)}`,   sub:[sig.stop_pct?`${sig.stop_pct}% · ATR-based`:null,sig.stop_note].filter(Boolean).join(" · ")},
              {name:"Target 1", val:`$${fmt(sig.t1)}`},
              {name:"Target 2", val:`$${fmt(sig.t2)}`},
            ].map(r=>(
              <div key={r.name} style={{padding:"5px 0",borderBottom:"1px solid #1e293b"}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:12,color:"#64748b"}}>{r.name}</span>
                  <span style={{...mono,fontSize:13,color:"#e2e8f0"}}>{r.val}</span>
                </div>
                {r.sub&&<p style={{fontSize:10,color:"#475569",margin:"2px 0 0",lineHeight:1.35}}>{r.sub}</p>}
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",paddingTop:6}}>
              <span style={{fontSize:11,color:"#475569"}}>Risk / Reward</span>
              <span style={{...mono,fontSize:13,color:"#e2e8f0"}}>{fmt(sig.rr)}</span>
            </div>
          </div>
          <div style={card}>
            <p style={lbl}>Key Levels</p>
            {[
              {name:"24h High",   val:`$${fmt(sig.high_24h)}`},
              {name:"24h Low",    val:`$${fmt(sig.low_24h)}`},
              {name:"VWAP",       val:`$${fmt(sig.vwap)}`},
              {name:"Support",    val:`$${fmt(sig.support)}`},
              {name:"Resistance", val:`$${fmt(sig.resistance)}`},
              {name:"200-Day MA", val:`$${fmt(sig.ma200)}`},
            ].map(r=>(
              <div key={r.name} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #1e293b"}}>
                <span style={{fontSize:12,color:"#64748b"}}>{r.name}</span>
                <span style={{...mono,fontSize:13,color:"#e2e8f0"}}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Macro + COT */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div style={card}>
            <p style={lbl}>Macro Drivers {keys.fred&&<span style={{color:"#4ade80",fontSize:9}}>· FRED</span>}</p>
            <div style={{marginBottom:8,paddingBottom:8,borderBottom:"1px solid #1e293b"}}>
              <p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>DXY (Fed TWI) — rising = bearish gold</p>
              <p style={{...mono,fontSize:13,margin:0,color:"#e2e8f0"}}>{fmt(sig.dxy)}</p>
            </div>
            <div>
              <p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>10Y Real Yield — rising = bearish gold</p>
              <p style={{...mono,fontSize:13,margin:0,color:"#e2e8f0"}}>{fmt(sig.real_yield)}</p>
            </div>
          </div>
          <div style={card}>
            <p style={lbl}>COT Positioning <span style={{color:"#475569",fontSize:9,fontWeight:400}}>· CFTC weekly</span></p>
            <div style={{marginBottom:6,paddingBottom:6,borderBottom:"1px solid #1e293b"}}>
              <p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Managed Money Net (hedge funds)</p>
              <p style={{...mono,fontSize:13,margin:0,color:"#e2e8f0"}}>{fmt(sig.cot_net)} contracts</p>
            </div>
            <div>
              <p style={{fontSize:10,color:"#475569",margin:"0 0 2px"}}>Sentiment</p>
              <p style={{...mono,fontSize:12,margin:0,color:sig.cot_sentiment==="CROWDED_LONG"?"#f87171":sig.cot_sentiment==="CROWDED_SHORT"?"#4ade80":"#94a3b8"}}>
                {fmt(sig.cot_sentiment)}
              </p>
            </div>
          </div>
        </div>

        {/* Scorecard */}
        <div style={{...card,marginBottom:10}}>
          <p style={lbl}>8-Step Scorecard</p>
          {SC_ROWS.map(({key,label})=>{
            const item=sc[key]; if(!item) return null;
            const st=rStyl(item.r);
            return (
              <div key={key} style={{display:"grid",gridTemplateColumns:"160px 76px 1fr",gap:10,alignItems:"center",padding:"5px 0",borderBottom:"1px solid #1e293b"}}>
                <span style={{fontSize:11,color:"#64748b"}}>{label}</span>
                <span style={{...mono,fontSize:10,fontWeight:600,background:st.bg,color:st.fg,padding:"2px 6px",borderRadius:6,textAlign:"center"}}>{item.r}</span>
                <span style={{fontSize:11,color:"#475569",lineHeight:1.4}}>{item.note}</span>
              </div>
            );
          })}
        </div>

        {/* Reasoning + Exits */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div style={card}>
            <p style={lbl}>Reasoning</p>
            <p style={{fontSize:12,color:"#cbd5e1",lineHeight:1.6,margin:0}}>{sig.reasoning}</p>
          </div>
          <div style={card}>
            <p style={lbl}>Exit Plan</p>
            {(sig.exits||[]).map((e,i)=>(
              <div key={i} style={{fontSize:11,color:"#64748b",padding:"5px 0",borderBottom:"1px solid #1e293b",lineHeight:1.45}}>→ {e}</div>
            ))}
          </div>
        </div>

        {/* News */}
        <div style={{...card,marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <p style={{...lbl,margin:0}}>News / Macro Catalyst</p>
            <span style={{...mono,fontSize:11,color:sCol(sig.news_sent)}}>● {sig.news_sent}</span>
          </div>
          <p style={{fontSize:12,fontWeight:600,color:"#e2e8f0",margin:"0 0 4px"}}>{sig.news_hl}</p>
          {sig.data_note&&sig.data_note!==""&&<p style={{fontSize:11,color:"#fbbf24",...mono,margin:"4px 0 0"}}>⚠ {sig.data_note}</p>}
          {(sig.sources||[]).filter(Boolean).length>0&&(
            <div style={{marginTop:6}}>
              {sig.sources.filter(Boolean).map((u,i)=>(
                <a key={i} href={u} target="_blank" rel="noopener noreferrer"
                  style={{fontSize:10,color:"#3b82f6",...mono,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {u.replace(/^https?:\/\//,"").substring(0,60)}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Log */}
        <div style={{marginBottom:10}}>
          <button onClick={()=>setShowLog(v=>!v)} style={{fontSize:11,color:"#475569",background:"transparent",border:"none",cursor:"pointer",...mono,padding:0}}>
            {showLog?"▲ Hide":"▼ Show"} data pipeline log ({dataLog.length} steps)
          </button>
          {showLog&&(
            <div style={{...card,marginTop:6,padding:"8px 10px",maxHeight:160,overflowY:"auto"}}>
              {dataLog.map((l,i)=><div key={i} style={{...mono,fontSize:10,color:"#334155",lineHeight:1.7}}>{l}</div>)}
            </div>
          )}
        </div>

        {/* Risk rules */}
        <div style={{...card,background:"#1c1408",border:"1px solid #78350f",marginBottom:"0.9rem"}}>
          <p style={{fontSize:11,fontWeight:700,color:"#fbbf24",margin:"0 0 5px"}}>Risk rules — always active</p>
          {["Max 1-2% of account at risk per trade","ATR-based stop is pre-calculated — do not widen it","Price already 25%+ toward T1 → skip, wait for pullback","T1 hit → close 50%, move stop to entry immediately","Exit 100% before any FOMC / CPI / NFP / PCE release","COT net >200k + resistance = high SHORT probability — respect it"].map((r,i)=>(
            <span key={i} style={{fontSize:11,color:"#d97706",...mono,display:"block"}}>· {r}</span>
          ))}
        </div>

      </>)}

      <p style={{fontSize:10,color:"#334155",margin:0,lineHeight:1.5,borderTop:"1px solid #1e293b",paddingTop:"0.75rem"}}>
        PAPER TRADING ONLY — Not financial advice. No system eliminates losses. Verify all data on your own platform before acting.
      </p>
    </div>
    <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:0.4}40%{transform:translateY(-8px);opacity:1}}`}</style>
    </div>
  );
}
