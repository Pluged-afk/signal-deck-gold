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

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
const SYSTEM = `You are SIGNAL DECK GOLD, an XAU/USD analysis engine for paper trading education only. Not financial advice. Never fabricate prices.

ALL TECHNICAL DATA IS PRE-COMPUTED AND PROVIDED — do not search for price, MACD, RSI, ATR, DXY, or real yield. These are calculated from real API data.

YOUR JOB (use web search for these only):
1. NEWS: Search top gold market news last 24h. Fed commentary, inflation data, geopolitical risk, ETF flows (GLD, IAU), VIX level. Bloomberg/Reuters preferred.
2. KEY LEVELS: Search nearest major XAU/USD support and resistance levels used by institutions. Confirm or refine the provided S/R with your search.
3. MACRO CONTEXT: Any FOMC/CPI/NFP/PCE within 48h? Fed speaker schedule today? Any geopolitical risk events?
4. BIAS SYNTHESIS: Given ALL the pre-computed data + your news/levels research, determine the highest-probability directional bias.

SIGNAL RULES:
- Binary event (FOMC/CPI/NFP/PCE) within 24h → WAIT, no exceptions
- ≥4 of 6 scorecard items confirm same direction → LONG or SHORT. <4 = WAIT
- DXY and real yield must agree for HIGH confidence — conflict caps at MEDIUM
- Entry: current price or pullback to nearest S/R within 0.3%
- Stop: ATR-based stop provided — use it. Do not invent a different stop.
- T1: next structural level, min 1.5× ATR from entry. T2: min 2.5× ATR from entry.
- R:R < 1:2 → WAIT
- Session filter: OFF-PEAK (Asia/weekend) with no strong catalyst → cap confidence at MEDIUM

Respond ONLY with a valid JSON object. No markdown, no text before or after:
{"action":"LONG|SHORT|WAIT","price":"XXXX.XX","confidence":"HIGH|MEDIUM|LOW","entry":"XXXX.XX","entry_note":"brief","stop":"XXXX.XX","stop_note":"ATR-based","stop_pct":"0.7","t1":"XXXX.XX","t2":"XXXX.XX","rr":"1:2.5","high_24h":"XXXX.XX","low_24h":"XXXX.XX","support":"XXXX.XX","resistance":"XXXX.XX","ma200":"XXXX.XX","dxy":"XXX.XX — falling","real_yield":"X.XX% — falling","passes":4,"scorecard":{"price":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"macd":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"rsi_ma":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"dxy_yield":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"history":{"r":"PASS|FAIL|NEUTRAL","note":"brief"},"news":{"r":"BULLISH|BEARISH|NEUTRAL","note":"brief"}},"reasoning":"2 sentences","exits":["T1 $XXXX — close 50% move stop to entry","T2 $XXXX — close rest","Stop $XXXX — full exit","Time — 4h max"],"news_hl":"headline","news_sent":"BULLISH|BEARISH|NEUTRAL","binary_event":"none or event+timing","data_note":"brief caveat or empty","sources":["url1"]}`;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SC_ROWS = [
  { key:"price",     label:"1. Price & Range"    },
  { key:"macd",      label:"2. MACD 1h/4h"       },
  { key:"rsi_ma",    label:"3. RSI + 200MA"      },
  { key:"dxy_yield", label:"4. DXY + Real Yield" },
  { key:"history",   label:"5. Levels / Context" },
  { key:"news",      label:"6. News / Macro"     },
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
  const clean = raw.replace(/```[a-z]*\n?/gi,"").trim();
  const start = clean.indexOf("{"); if(start===-1) return null;
  const end   = clean.lastIndexOf("}");
  if(end>start){ try{ return JSON.parse(clean.substring(start,end+1)); }catch(_){} }
  let s = clean.substring(start);
  try{ return JSON.parse(s); }catch(_){}
  s = s.replace(/,?\s*"[^"]*$/,"").replace(/,?\s*[\w.]*$/,"");
  const oA=(s.match(/\[/g)||[]).length-(s.match(/\]/g)||[]).length;
  for(let i=0;i<oA;i++) s+="]";
  const oO=(s.match(/\{/g)||[]).length-(s.match(/\}/g)||[]).length;
  for(let i=0;i<oO;i++) s+="}";
  try{ return JSON.parse(s); }catch(_){ return null; }
};

// ─── TECHNICAL CALCULATIONS ───────────────────────────────────────────────────
const calcEMA = (values, period) => {
  const k = 2/(period+1);
  let ema = values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  const result = new Array(period-1).fill(null);
  result.push(ema);
  for(let i=period;i<values.length;i++){ ema=values[i]*k+ema*(1-k); result.push(ema); }
  return result;
};

const calcMACD = closes => {
  const ema12=calcEMA(closes,12), ema26=calcEMA(closes,26);
  const macdLine=ema12.map((v,i)=>(v&&ema26[i])?v-ema26[i]:null);
  const validMacd=macdLine.filter(Boolean);
  const signal=calcEMA(validMacd,9);
  const last=macdLine.filter(Boolean).slice(-1)[0];
  const sig9=signal.slice(-1)[0];
  const prev=macdLine.filter(Boolean).slice(-2)[0];
  const prevS=signal.slice(-2)[0];
  const hist=last-sig9, prevH=prev-prevS;
  return { macd:last, signal:sig9, histogram:hist, prevHistogram:prevH,
           aboveSignal:last>sig9, expanding:Math.abs(hist)>Math.abs(prevH) };
};

const calcRSI = (closes, period=14) => {
  let gains=0, losses=0;
  for(let i=1;i<=period;i++){ const d=closes[i]-closes[i-1]; if(d>0) gains+=d; else losses-=d; }
  let avgG=gains/period, avgL=losses/period;
  for(let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    avgG=(avgG*(period-1)+(d>0?d:0))/period;
    avgL=(avgL*(period-1)+(d<0?-d:0))/period;
  }
  const rs=avgG/avgL;
  return avgL===0?100:100-(100/(1+rs));
};

const calcATR = (highs, lows, closes, period=14) => {
  const trs=[];
  for(let i=1;i<highs.length;i++)
    trs.push(Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1])));
  return trs.slice(-period).reduce((a,b)=>a+b,0)/period;
};

const calcSMA = (values, period) => {
  const slice=values.slice(-period);
  return slice.length===period ? slice.reduce((a,b)=>a+b,0)/period : null;
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === "1");
  if (!unlocked) return <AccessGate onUnlock={() => setUnlocked(true)} />;
  return <SignalDeckGold />;
}

function SignalDeckGold() {
  const [keys,    setKeys]    = useState({ anthropic:"", td:"", fred:"" });
  const [tmpKeys, setTmpKeys] = useState({ anthropic:"", td:"", fred:"" });
  const [keysSet, setKeysSet] = useState(false);
  const [sig,     setSig]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [ts,      setTs]      = useState(null);
  const [dataLog, setDataLog] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef([]);

  const addLog = msg => {
    logRef.current = [...logRef.current, `[${new Date().toLocaleTimeString()}] ${msg}`];
    setDataLog([...logRef.current]);
  };

  const fetchCandles = async (interval, outputsize=100) => {
    const r = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${outputsize}&apikey=${keys.td}`);
    const d = await r.json();
    if(d.status==="error") throw new Error(`Twelve Data: ${d.message}`);
    const values=(d.values||[]).reverse();
    return {
      closes: values.map(v=>parseFloat(v.close)),
      highs:  values.map(v=>parseFloat(v.high)),
      lows:   values.map(v=>parseFloat(v.low)),
    };
  };

  const fetchFRED = async series => {
    const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${keys.fred}&file_type=json&sort_order=desc&limit=5`);
    const d = await r.json();
    const obs=(d.observations||[]).filter(o=>o.value!==".").map(o=>parseFloat(o.value));
    return obs[0]??null;
  };

  const fetchSpot = async () => {
    if(keys.td){
      try{
        const r=await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${keys.td}`);
        const d=await r.json();
        if(d.price&&parseFloat(d.price)>100) return { price:p2(d.price), src:"Twelve Data" };
      }catch(_){}
    }
    try{
      // CoinGecko free tier returns price only — 24h high/low omitted (Pro feature)
      const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd");
      if(r.ok){
        const d=await r.json(), g=d?.["pax-gold"];
        if(g?.usd>100) return { price:p2(g.usd), src:"CoinGecko PAXG" };
      }
    }catch(_){}
    try{
      const r=await fetch("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD");
      if(r.ok){
        const d=await r.json();
        const row=Array.isArray(d)?d[0]:null;
        const sp=row?.spreadProfilePrices?.find(x=>x.spreadProfile==="prime");
        if(sp?.bid>100) return { price:p2((sp.bid+sp.ask)/2), src:"Swissquote" };
      }
    }catch(_){}
    return null;
  };

  const fetchSignal = useCallback(async () => {
    setLoading(true); setError(null); logRef.current=[]; setDataLog([]);
    try {
      addLog("Fetching XAU/USD spot price...");
      const spot = await fetchSpot();
      if(!spot) throw new Error("Could not fetch gold spot price from any source.");
      addLog(`Spot: $${spot.price} (${spot.src})`);

      let techData = null;
      if(keys.td){
        try{
          addLog("Fetching 1h candles from Twelve Data...");
          const c1h=await fetchCandles("1h",100);
          const macd1h=calcMACD(c1h.closes);
          const rsi1h=calcRSI(c1h.closes,14);
          const atr1h=calcATR(c1h.highs,c1h.lows,c1h.closes,14);
          addLog(`1h MACD: ${macd1h.macd?.toFixed(2)}, ${macd1h.aboveSignal?"above":"below"} signal`);
          addLog(`1h RSI: ${rsi1h.toFixed(1)}`);

          addLog("Fetching 4h candles...");
          const c4h=await fetchCandles("4h",100);
          const macd4h=calcMACD(c4h.closes);
          const rsi4h=calcRSI(c4h.closes,14);
          const atr4h=calcATR(c4h.highs,c4h.lows,c4h.closes,14);

          addLog("Fetching daily candles for 200MA...");
          const c1d=await fetchCandles("1day",210);
          const ma200=calcSMA(c1d.closes,200);
          const h24=Math.max(...c1h.highs.slice(-24));
          const l24=Math.min(...c1h.lows.slice(-24));

          techData={ macd1h, rsi1h, atr1h, macd4h, rsi4h, atr4h, ma200, h24, l24, price:spot.price, src:spot.src };
          addLog(`4h RSI: ${rsi4h.toFixed(1)}, ATR: $${atr4h.toFixed(2)}, 200MA: $${ma200?.toFixed(2)}`);
        }catch(e){ addLog(`Twelve Data error: ${e.message} — falling back to AI inference`); }
      }

      let fredData={ nominal:null, tips:null, realYield:null, dxy:null };
      if(keys.fred){
        try{
          addLog("Fetching FRED: 10Y nominal yield...");
          fredData.nominal=await fetchFRED("DGS10");
          addLog(`10Y nominal: ${fredData.nominal}%`);
          addLog("Fetching FRED: TIPS breakeven...");
          fredData.tips=await fetchFRED("T10YIE");
          addLog(`TIPS breakeven: ${fredData.tips}%`);
          if(fredData.nominal&&fredData.tips){ fredData.realYield=p2(fredData.nominal-fredData.tips); addLog(`Real yield: ${fredData.realYield}%`); }
          addLog("Fetching FRED: DXY proxy...");
          fredData.dxy=await fetchFRED("DTWEXBGS");
          addLog(`DXY proxy: ${fredData.dxy}`);
        }catch(e){ addLog(`FRED error: ${e.message}`); }
      }

      const session=getSession();
      const atr=techData?.atr4h??techData?.atr1h??null;
      const stopAmt=atr?p2(atr*1.5):null;
      const stopPct=stopAmt?p2((stopAmt/spot.price)*100):null;

      const dataPackage=`
=== PRE-COMPUTED MARKET DATA (verified from APIs — do not re-fetch) ===

PRICE
  XAU/USD Spot: $${spot.price} (source: ${spot.src})
  24h High: $${techData?.h24??spot.h24??"unknown"}
  24h Low:  $${techData?.l24??spot.l24??"unknown"}
  Session:  ${session}

MACD (calculated from real OHLCV candles)
  1h MACD:  line=${techData?.macd1h?.macd?.toFixed(3)??"unavailable"}, signal=${techData?.macd1h?.signal?.toFixed(3)??"unavailable"}, hist=${techData?.macd1h?.histogram?.toFixed(3)??"unavailable"} (${techData?.macd1h?.aboveSignal?"ABOVE signal":"BELOW signal"}, hist ${techData?.macd1h?.expanding?"EXPANDING":"CONTRACTING"})
  4h MACD:  line=${techData?.macd4h?.macd?.toFixed(3)??"unavailable"}, signal=${techData?.macd4h?.signal?.toFixed(3)??"unavailable"}, hist=${techData?.macd4h?.histogram?.toFixed(3)??"unavailable"} (${techData?.macd4h?.aboveSignal?"ABOVE signal":"BELOW signal"}, hist ${techData?.macd4h?.expanding?"EXPANDING":"CONTRACTING"})

RSI (14-period, calculated from real candles)
  1h RSI:  ${techData?.rsi1h?.toFixed(1)??"unavailable"} ${techData?.rsi1h>70?"(OVERBOUGHT)":techData?.rsi1h<30?"(OVERSOLD)":"(neutral)"}
  4h RSI:  ${techData?.rsi4h?.toFixed(1)??"unavailable"} ${techData?.rsi4h>70?"(OVERBOUGHT)":techData?.rsi4h<30?"(OVERSOLD)":"(neutral)"}

ATR & STOP SIZING (14-period ATR from real candles)
  1h ATR:  $${techData?.atr1h?.toFixed(2)??"unavailable"}
  4h ATR:  $${techData?.atr4h?.toFixed(2)??"unavailable"}
  Recommended stop: $${stopAmt??"use ~0.7% as fallback"} (${stopPct??"~0.7"}% from entry)

200-DAY MA
  200MA: $${techData?.ma200?.toFixed(2)??"unavailable"} → price is ${techData?.ma200?(spot.price>techData.ma200?"ABOVE (bullish bias)":"BELOW (bearish bias)"):"unknown vs MA"}

MACRO (from FRED API)
  10Y Nominal Yield:  ${fredData.nominal??"unavailable"}%
  TIPS Breakeven:     ${fredData.tips??"unavailable"}%
  10Y Real Yield:     ${fredData.realYield??"unavailable"}% ${fredData.realYield!==null?(fredData.realYield>1.5?"(HIGH — bearish gold)":fredData.realYield<0.5?"(LOW — bullish gold)":"(moderate)"):""}
  DXY (Fed TWI):      ${fredData.dxy??"unavailable"}

=== NOW DO YOUR JOB ===
Search for: (1) top gold news last 24h, (2) key institutional S/R levels, (3) binary events within 48h, (4) Fed speakers today.
Then output the JSON signal using ALL of the above data.`.trim();

      addLog("Sending to AI for news + signal synthesis...");
      const tools=[{ type:"web_search_20250305", name:"web_search" }];
      let history=[{ role:"user", content:dataPackage }];
      let finalText="";

      for(let i=0;i<10;i++){
        const res=await fetch("https://api.anthropic.com/v1/messages",{
          method:"POST",
          headers:{"Content-Type":"application/json","x-api-key":keys.anthropic,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
          body:JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:2000, system:SYSTEM, tools, messages:history })
        });
        if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e?.error?.message||`API error ${res.status}`); }
        const data=await res.json();
        const texts=(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
        if(texts) finalText=texts;
        if(data.stop_reason==="end_turn") break;
        history.push({ role:"assistant", content:data.content });
        if(data.stop_reason==="tool_use"){
          addLog("AI running web search...");
          const results=(data.content||[]).filter(b=>b.type==="tool_use").map(b=>({ type:"tool_result", tool_use_id:b.id, content:"Search executed." }));
          if(results.length) history.push({ role:"user", content:results });
          else break;
        } else break;
      }

      const parsed=parseJSON(finalText);
      if(!parsed) throw new Error("Could not parse signal JSON. Please retry.");
      parsed.session=session;
      if(techData?.h24&&!parsed.high_24h) parsed.high_24h=String(techData.h24);
      if(techData?.l24&&!parsed.low_24h)  parsed.low_24h=String(techData.l24);
      if(techData?.ma200) parsed.ma200=techData.ma200.toFixed(2);
      if(fredData.realYield!==null) parsed.real_yield=`${fredData.realYield}%`;
      if(fredData.dxy!==null)       parsed.dxy=String(fredData.dxy);
      addLog("Signal complete.");
      setSig(parsed); setTs(new Date());

    }catch(e){ setError(e.message||"Unknown error"); addLog(`ERROR: ${e.message}`); }
    finally  { setLoading(false); }
  }, [keys]);

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
          <span style={{...mono,fontSize:11,color:"#475569",marginLeft:8}}>XAU/USD · Real APIs · Paper Trading</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {ts&&<span style={{...mono,fontSize:11,color:"#475569"}}>{ts.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>}
          {keysSet&&<button onClick={fetchSignal} disabled={loading} style={btn()}>{loading?"Scanning...":"Refresh ↗"}</button>}
          <button onClick={()=>setKeysSet(false)} style={{...btn("gold"),fontSize:11,padding:"6px 10px"}}>⚙ Keys</button>
        </div>
      </div>

      {/* API Key Setup */}
      {!keysSet&&(
        <div style={{...card,marginBottom:12}}>
          <p style={{...lbl,color:"#fbbf24",marginBottom:12}}>🔑 API Key Setup</p>
          <p style={{fontSize:12,color:"#64748b",margin:"0 0 16px",lineHeight:1.6}}>
            Keys stay in memory only — never stored, never sent to chat.<br/>
            <span style={{color:"#475569"}}>Twelve Data: </span>
            <a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer" style={{color:"#3b82f6"}}>twelvedata.com</a>
            <span style={{color:"#475569"}}> · FRED: </span>
            <a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank" rel="noopener noreferrer" style={{color:"#3b82f6"}}>fred.stlouisfed.org</a>
          </p>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>Anthropic API Key <span style={{color:"#f87171"}}>(required — get free at console.anthropic.com)</span></label>
            <input type="password" placeholder="sk-ant-..." value={tmpKeys.anthropic} onChange={e=>setTmpKeys(k=>({...k,anthropic:e.target.value}))} style={inputStyle}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>Twelve Data API Key <span style={{color:"#4ade80"}}>(unlocks real MACD/RSI/ATR)</span></label>
            <input type="password" placeholder="e.g. a1b2c3d4e5f6..." value={tmpKeys.td} onChange={e=>setTmpKeys(k=>({...k,td:e.target.value}))} style={inputStyle}/>
          </div>
          <div style={{marginBottom:16}}>
            <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>FRED API Key <span style={{color:"#4ade80"}}>(unlocks real yield + DXY)</span></label>
            <input type="password" placeholder="e.g. abcdef1234567890..." value={tmpKeys.fred} onChange={e=>setTmpKeys(k=>({...k,fred:e.target.value}))} style={inputStyle}/>
          </div>
          <button onClick={()=>{ setKeys({...tmpKeys}); setKeysSet(true); setSig(null); setError(null); }} disabled={!tmpKeys.anthropic} style={{...btn(),opacity:tmpKeys.anthropic?1:0.5}}>
            Save & Continue →
          </button>
          <p style={{fontSize:10,color:"#334155",margin:"10px 0 0"}}>Without keys: MACD/RSI/ATR will be AI-inferred (less accurate). With keys: all technicals are mathematically computed from real candle data.</p>
        </div>
      )}

      {/* Ready */}
      {keysSet&&!sig&&!loading&&!error&&(
        <div style={{...card,textAlign:"center",padding:"2.5rem 1.5rem"}}>
          <p style={{...mono,fontSize:13,color:"#64748b",margin:"0 0 5px"}}>SIGNAL DECK GOLD ready</p>
          <p style={{fontSize:11,color:"#475569",margin:"0 0 14px"}}>
            {keys.td?"✓ Twelve Data":"⚠ No Twelve Data key"} · {keys.fred?"✓ FRED":"⚠ No FRED key"} · Web search active
          </p>
          <button onClick={fetchSignal} style={btn()}>Run Analysis ↗</button>
        </div>
      )}

      {/* Loading */}
      {loading&&(
        <div style={{...card,marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:16,paddingTop:8}}>
            {[0,1,2,3].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"#ca8a04",animation:`bounce 1.4s ease-in-out ${i*0.22}s infinite`}}/>)}
          </div>
          <p style={{...mono,fontSize:12,color:"#64748b",textAlign:"center",margin:"0 0 12px"}}>
            {dataLog.slice(-1)[0]?.replace(/^\[.*?\] /,"")||"Initializing..."}
          </p>
          <div style={{background:"#020617",borderRadius:8,padding:"8px 10px",maxHeight:120,overflowY:"auto"}}>
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
                {sig.passes!==undefined&&<span style={{...mono,fontSize:11,color:sig.passes>=4?"#4ade80":sig.passes===3?"#fbbf24":"#f87171"}}>{sig.passes}/6 confirmed</span>}
                {keys.td&&<span style={{fontSize:10,color:"#4ade80",...mono}}>✓ Real OHLCV</span>}
                {keys.fred&&<span style={{fontSize:10,color:"#4ade80",...mono}}>✓ FRED macro</span>}
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
              {name:"Target 1", val:`$${fmt(sig.t1)}`,     sub:null},
              {name:"Target 2", val:`$${fmt(sig.t2)}`,     sub:null},
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

        {/* Macro */}
        <div style={{...card,marginBottom:10}}>
          <p style={lbl}>Primary Macro Drivers {keys.fred&&<span style={{color:"#4ade80",fontSize:9}}>· FRED API</span>}</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div>
              <p style={{fontSize:10,color:"#475569",margin:"0 0 3px"}}>DXY (Fed TWI) — rising = bearish gold</p>
              <p style={{...mono,fontSize:13,margin:0,color:"#e2e8f0"}}>{fmt(sig.dxy)}</p>
            </div>
            <div>
              <p style={{fontSize:10,color:"#475569",margin:"0 0 3px"}}>10Y Real Yield — rising = bearish</p>
              <p style={{...mono,fontSize:13,margin:0,color:"#e2e8f0"}}>{fmt(sig.real_yield)}</p>
            </div>
          </div>
        </div>

        {/* Scorecard */}
        <div style={{...card,marginBottom:10}}>
          <p style={lbl}>6-Step Scorecard</p>
          {SC_ROWS.map(({key,label})=>{
            const item=sc[key]; if(!item) return null;
            const st=rStyl(item.r);
            return (
              <div key={key} style={{display:"grid",gridTemplateColumns:"150px 76px 1fr",gap:10,alignItems:"center",padding:"5px 0",borderBottom:"1px solid #1e293b"}}>
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

        {/* Data log */}
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
          {["Max 1-2% of account at risk per trade","ATR-based stop is pre-calculated — do not widen it","Price already 25%+ toward T1 → skip, wait for pullback","T1 hit → close 50%, move stop to entry immediately","Exit 100% before any FOMC / CPI / NFP / PCE release"].map((r,i)=>(
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
