// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL DECK — shared library (styles, helpers, indicators, AI loop)
// Used by all three asset engines. No asset-specific logic lives here.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Styles ───────────────────────────────────────────────────────────────────
export const mono = { fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace", fontWeight:500 };
export const card = { background:"#0f172a", borderRadius:12, border:"1px solid #1e293b", padding:"0.9rem 1.1rem" };
export const lbl  = { fontSize:10, color:"#475569", letterSpacing:"0.08em", margin:"0 0 8px", textTransform:"uppercase", fontWeight:600 };
export const inputStyle = { width:"100%", padding:"8px 10px", background:"#0f172a", border:"1px solid #334155", borderRadius:8, color:"#e2e8f0", fontSize:12, ...mono, boxSizing:"border-box" };

// ─── Formatters ─────────────────────────────────────────────────────────────
export const fmt = v => (v!==undefined&&v!==null&&v!==""&&v!=="null") ? v : "—";
export const p2  = n => parseFloat(parseFloat(n).toFixed(2));
export const p5  = n => parseFloat(parseFloat(n).toFixed(5));
export const f3  = v => (v||v===0) ? v.toFixed(3) : "n/a";
export const f2  = v => (v||v===0) ? v.toFixed(2) : "n/a";
export const f1  = v => (v||v===0) ? v.toFixed(1) : "n/a";
export const na  = v => (v??"unavailable");
export const rsiLbl = v => !v?"":(v>70?" (OVERBOUGHT)":v<30?" (OVERSOLD)":" (neutral)");
export const volLbl = r => !r?"":(r>1.5?" HIGH — confirms":r<0.8?" LOW — weak":" normal");

// ─── Status colors ──────────────────────────────────────────────────────────
export const aStyl = a => a==="LONG"  ? {bg:"#052e16",fg:"#4ade80",border:"#166534"}
                        : a==="SHORT" ? {bg:"#450a0a",fg:"#f87171",border:"#7f1d1d"}
                        :               {bg:"#1c1408",fg:"#fbbf24",border:"#78350f"};
export const rStyl = r => (r==="PASS"||r==="BULLISH") ? {bg:"#052e16",fg:"#4ade80"}
                        : (r==="FAIL"||r==="BEARISH") ? {bg:"#450a0a",fg:"#f87171"}
                        :                               {bg:"#1e1b4b",fg:"#a5b4fc"};
export const cCol = c => c==="HIGH"?"#4ade80":c==="LOW"?"#f87171":"#fbbf24";
export const sCol = s => s==="BULLISH"?"#4ade80":s==="BEARISH"?"#f87171":"#94a3b8";
export const qCol = q => q==="best"?"#4ade80":q==="good"?"#fbbf24":q==="avoid"?"#f87171":"#94a3b8";

// ─── Sessions ─────────────────────────────────────────────────────────────────
export const isWeekend = () => { const d=new Date().getUTCDay(); return d===0||d===6; };

// FX / metals session model (gold + EUR/USD share this clock).
export const getFxSession = () => {
  const h=new Date().getUTCHours(), d=new Date().getUTCDay();
  if(d===6||(d===0&&h<21)) return { label:"Weekend", quality:"avoid" };
  if(h>=8&&h<10)   return { label:"London Open",   quality:"best" };
  if(h>=10&&h<13)  return { label:"London Mid",    quality:"good" };
  if(h>=13&&h<16)  return { label:"EU-US Overlap", quality:"best" };
  if(h>=16&&h<17)  return { label:"US Session",    quality:"good" };
  if(h>=17&&h<21)  return { label:"US Late",       quality:"ok"   };
  return { label:"Asian / Off-Peak", quality:"avoid" };
};

// Crypto trades 24/7 — different quality map, weekend is "ok" not "avoid".
export const getCryptoSession = () => {
  const h=new Date().getUTCHours(), d=new Date().getUTCDay();
  const wknd = (d===0||d===6);
  if(h>=13&&h<16)  return { label:wknd?"Overlap · Weekend":"EU-US Overlap", quality:wknd?"good":"best" };
  if(h>=16&&h<21)  return { label:wknd?"US · Weekend":"US Session",         quality:wknd?"good":"best" };
  if(h>=8&&h<13)   return { label:wknd?"Europe · Weekend":"Europe",         quality:wknd?"ok":"good" };
  return { label:wknd?"Asia · Weekend":"Asia", quality:wknd?"avoid":"ok" };
};

// ─── JSON recovery (handles truncated / fenced model output) ──────────────────
export const parseJSON = raw => {
  const clean=(raw||"").replace(/```[a-z]*\n?/gi,"").trim();
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

// ─── Technical indicators (all computed locally from real candles) ────────────
export const calcEMA = (values, period) => {
  const k=2/(period+1);
  let ema=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  const r=new Array(period-1).fill(null); r.push(ema);
  for(let i=period;i<values.length;i++){ ema=values[i]*k+ema*(1-k); r.push(ema); }
  return r;
};
export const calcMACD = closes => {
  const e12=calcEMA(closes,12), e26=calcEMA(closes,26);
  const ml=e12.map((v,i)=>(v&&e26[i])?v-e26[i]:null);
  const valid=ml.filter(Boolean);
  const sig=calcEMA(valid,9);
  const last=valid.slice(-1)[0], s9=sig.slice(-1)[0];
  const prev=valid.slice(-2)[0], ps=sig.slice(-2)[0];
  const hist=last-s9, ph=prev-ps;
  return { macd:last, signal:s9, histogram:hist, aboveSignal:last>s9, expanding:Math.abs(hist)>Math.abs(ph) };
};
export const calcRSI = (closes, period=14) => {
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
export const calcATR = (highs, lows, closes, period=14) => {
  const trs=[];
  for(let i=1;i<highs.length;i++)
    trs.push(Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1])));
  return trs.slice(-period).reduce((a,b)=>a+b,0)/period;
};
export const calcSMA = (values, period) => {
  const s=values.slice(-period);
  return s.length===period ? s.reduce((a,b)=>a+b,0)/period : null;
};
export const calcEMAlast = (values, period) => {
  if(values.length<period) return null;
  const arr=calcEMA(values,period);
  return arr.slice(-1)[0];
};
export const calcVWAP = (highs, lows, closes, volumes) => {
  let cumTPV=0, cumVol=0;
  for(let i=0;i<closes.length;i++){
    const tp=(highs[i]+lows[i]+closes[i])/3;
    cumTPV+=tp*(volumes[i]||0); cumVol+=(volumes[i]||0);
  }
  return cumVol>0 ? cumTPV/cumVol : null;
};
export const calcVolRatio = (volumes, period=20) => {
  if(volumes.length<period+1) return null;
  const avg=volumes.slice(-period-1,-1).reduce((a,b)=>a+b,0)/period;
  const cur=volumes[volumes.length-1];
  return avg>0 ? { current:cur, average:avg, ratio:cur/avg } : null;
};
// Classic floor-trader pivots from the previous completed daily candle.
export const calcPivots = (h, l, c) => {
  const P=(h+l+c)/3;
  return { P, R1:2*P-l, S1:2*P-h, R2:P+(h-l), S2:P-(h-l) };
};

// ─── Binary-event calendar (auto-estimated; AI web search is the real gate) ───
const pad = n => String(n).padStart(2,"0");
const firstFriday = (y,m) => { const d=new Date(Date.UTC(y,m,1)); const off=(5-d.getUTCDay()+7)%7; return 1+off; };
// 2026 FOMC decision dates (announcement day). Verify against the Fed calendar.
const FOMC_2026 = ["2026-01-28","2026-03-18","2026-04-29","2026-06-17","2026-07-29","2026-09-16","2026-10-28","2026-12-09"];
// 2026 ECB monetary-policy Governing Council decision dates (confirmed).
const ECB_2026  = ["2026-01-30","2026-03-06","2026-04-17","2026-06-05","2026-07-24","2026-09-11","2026-10-30","2026-12-18"];

const nextMonthly = (dayFn) => {
  const now=new Date(); let y=now.getUTCFullYear(), m=now.getUTCMonth();
  for(let i=0;i<4;i++){
    const day=dayFn(y,m);
    const dt=new Date(Date.UTC(y,m,day,12,30));
    if(dt>now) return dt;
    m++; if(m>11){ m=0; y++; }
  }
  return null;
};
const nextFromList = list => {
  const now=new Date();
  for(const s of list){ const dt=new Date(s+"T18:00:00Z"); if(dt>now) return dt; }
  return null;
};

const EVENT_DEFS = {
  NFP:  { label:"US Non-Farm Payrolls", next:()=>nextMonthly((y,m)=>firstFriday(y,m)) },
  CPI:  { label:"US CPI (inflation)",    next:()=>nextMonthly(()=>13), approx:true },
  PCE:  { label:"US PCE (Fed's gauge)",  next:()=>nextMonthly(()=>28), approx:true },
  GDP:  { label:"US GDP",                next:()=>nextMonthly(()=>27), approx:true },
  FOMC: { label:"FOMC rate decision",    next:()=>nextFromList(FOMC_2026) },
  ECB:  { label:"ECB rate decision",     next:()=>nextFromList(ECB_2026) },
  EUCPI:{ label:"Eurozone CPI (flash)",  next:()=>nextMonthly(()=>1), approx:true },
};

export const upcomingEvents = (types, n=3) => {
  const out=[];
  for(const t of types){
    const def=EVENT_DEFS[t]; if(!def) continue;
    const dt=def.next(); if(!dt) continue;
    out.push({ label:def.label, date:dt, approx:!!def.approx });
  }
  out.sort((a,b)=>a.date-b.date);
  return out.slice(0,n).map(e=>{
    const d=e.date;
    const ds=`${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]} ${d.getUTCDate()}`;
    const days=Math.ceil((d-new Date())/86400000);
    return { ...e, ds, days, tEgy:toEgypt12(d.getUTCHours(),d.getUTCMinutes()), in:days<=0?"today":days===1?"1 day":`${days} days` };
  });
};

// ─── Egypt local time (UTC+3, EET/EEST) in 12-hour AM/PM ─────────────────────
export const toEgypt12 = (utcH, utcM = 0) => {
  let h = ((utcH + 3) % 24 + 24) % 24; const ap = h >= 12 ? "PM" : "AM"; let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(utcM).padStart(2, "0")} ${ap}`;
};
export const egyptFromHHMM = s => { const m = /(\d{1,2}):(\d{2})/.exec(s || ""); return m ? toEgypt12(+m[1], +m[2]) : null; };
export const egyptWindow = win => { const m = (win || "").match(/(\d{1,2}):(\d{2}).*?(\d{1,2}):(\d{2})/); return m ? `${toEgypt12(+m[1], +m[2])}–${toEgypt12(+m[3], +m[4])} EGY` : ""; };
// Binary-event urgency: red <3d, orange <7d, amber beyond.
export const urgencyCol = d => d == null ? "#475569" : d < 3 ? "#f87171" : d < 7 ? "#fb923c" : "#fbbf24";

// Is the current UTC time inside a "HH:MM–HH:MM UTC" window? (handles midnight wrap)
export const inWindow = win => {
  const m = (win || "").match(/(\d{1,2}):(\d{2}).*?(\d{1,2}):(\d{2})/); if (!m) return false;
  const now = new Date(), cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4];
  return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
};

// ─── Twelve Data fetch with one 429 retry (rate-limit aware) ──────────────────
// Returns parsed JSON. On a rate-limit response, waits 15s and retries once.
export const tdFetch = async (url, addLog) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url);
    let d = null; try { d = await r.json(); } catch (_) {}
    const limited = r.status === 429 || d?.code === 429 || (d?.status === "error" && /limit|credit|run out/i.test(d?.message || ""));
    if (limited && attempt === 0) {
      addLog && addLog("Rate limited — retrying in 15s");
      await new Promise(s => setTimeout(s, 15000));
      continue;
    }
    return d;
  }
};

// ─── Anthropic multi-turn loop (centralised, with the conversation-history fix)
// Order is strict: capture text → if end_turn break → if pause_turn echo+continue
// → else push assistant, then handle tool_use. Never push-then-break.
export async function runAI({ apiKey, system, userContent, addLog, model="claude-sonnet-4-6", maxTokens=4096, maxSearches }) {
  const tools=[{ type:"web_search_20250305", name:"web_search", ...(maxSearches?{ max_uses:maxSearches }:{}) }];
  let history=[{ role:"user", content:userContent }];
  let finalText="";

  for(let i=0;i<10;i++){
    const res=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" },
      body:JSON.stringify({ model, max_tokens:maxTokens, system, tools, messages:history })
    });
    if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e?.error?.message||`API error ${res.status}`); }
    const data=await res.json();

    const texts=(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
    if(texts) finalText=texts;

    if(data.stop_reason==="end_turn") break;

    if(data.stop_reason==="pause_turn"){
      addLog&&addLog("AI searching web (resuming)...");
      history.push({ role:"assistant", content:data.content });
      continue;
    }

    history.push({ role:"assistant", content:data.content });

    if(data.stop_reason==="tool_use"){
      addLog&&addLog("AI searching web...");
      const results=(data.content||[]).filter(b=>b.type==="tool_use").map(b=>({ type:"tool_result", tool_use_id:b.id, content:"Search executed." }));
      if(results.length) history.push({ role:"user", content:results }); else break;
    } else break;
  }
  return finalText;
}

// ─── WAIT Alert System — appended to every asset's system prompt ─────────────
export const WAIT_RULES = `

═══ WAIT ALERT SYSTEM — REQUIRED ON EVERY RESPONSE ═══
You MUST always include a "wait_type" string and a "triggers" object — for LONG and SHORT too, not only WAIT.

wait_type = one of:
- "binary_event"  : a binary event (FOMC/CPI/NFP/PCE/ECB) is within 24h
- "low_confidence" : signal quality <50 or the timeframes/indicators conflict
- "no_setup"      : market ranging, no clear direction
- "wrong_session" : off-peak / low-volume window
- "none"          : use this for any LONG or SHORT signal

triggers — be SPECIFIC and ACTIONABLE. Use the pre-computed swing S/R, fib levels, round numbers, session windows, ADX, patterns, funding/F&G and Asian range provided above as concrete trigger values. 4h candles close at 00:00/04:00/08:00/12:00/16:00/20:00 UTC.
- watch_long / watch_long_note: price where a LONG likely fires (key support being tested) + why
- watch_short / watch_short_note: price where a SHORT likely fires (key resistance) + why
- invalidation / invalidation_note: the level that changes the thesis + what its break means
- next_session ("HH:MM UTC") / next_session_note: next high-volume session + why it is better
- news_time ("HH:MM UTC" or "none") / news_event: scheduled news today + its name
- candle_close ("HH:MM UTC") / candle_close_note: the next important 1h/4h close + why
- mtf_fix: what must change in 4h/1h/15m alignment to fire (reference the ACTUAL current trends)
- pattern_needed: the exact candle pattern + price/level that would confirm entry
- indicator_needed: the exact indicator condition (e.g. "1h RSI 65+, currently 52 and rising")
- primary_reason / secondary_reason: the main + second reason ("none" if only one)
- estimated_clarity: when the market likely becomes clearer (a real time or level)
- refresh_recommendation: ONE specific actionable line. GOOD: "Refresh at 16:00 UTC (4h close) OR immediately if price touches 4050 resistance — whichever first". BAD: "refresh in 1 hour" / "monitor the market".

For LONG/SHORT: watch_long/watch_short may be "n/a", but invalidation, invalidation_note, news_time/news_event and a refresh_recommendation (e.g. "hold; re-check at the next 4h close or if price hits the invalidation level") are still REQUIRED.`;

// ─── Session cost tracking (counts paid Anthropic calls this browser session) ─
export const EST_COST = 0.18;      // € per paid signal — low estimate
export const EST_COST_HIGH = 0.70; // € per paid signal — high estimate (more web search)
export const bumpSignalCount = () => { try { const n = (parseInt(sessionStorage.getItem("sdg_calls")) || 0) + 1; sessionStorage.setItem("sdg_calls", String(n)); return n; } catch (_) { return 0; } };
export const signalCount = () => { try { return parseInt(sessionStorage.getItem("sdg_calls")) || 0; } catch (_) { return 0; } };

// ─── Shared key storage (gold + EUR share data keys; all share Anthropic) ─────
export const KEY_STORE = "sdg_keys";
export const loadKeys = () => { try { return { anthropic:"", td:"", fred:"", ...JSON.parse(localStorage.getItem(KEY_STORE)||"{}") }; } catch(_){ return { anthropic:"", td:"", fred:"" }; } };
export const saveKeys = k => { try { localStorage.setItem(KEY_STORE, JSON.stringify(k)); } catch(_){} };
