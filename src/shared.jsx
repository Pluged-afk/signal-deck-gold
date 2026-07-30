// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL DECK — shared library (styles, helpers, indicators, AI loop)
// Used by all three asset engines. No asset-specific logic lives here.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";

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
// Gold runs hotter than forex — 70/30 flags extremes prematurely. Gold uses 80/20.
export const rsiLblGold = v => !v?"":(v>80?" (OVERBOUGHT)":v<20?" (OVERSOLD)":" (neutral)");
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

// ─── Single live-time source (Section 4) ──────────────────────────────────────
// Every time-dependent UI (session-quality label, next-refresh countdown, binary-
// event strip, debug clock) must read from ONE live clock computed fresh on every
// render — never a value cached at signal-generation time. useNow() ticks on an
// interval and returns a fresh Date; components derive session/countdown from it.
export const useNow = (intervalMs = 1000) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return now;
};
// Raw debug clock (Section 4): HH:MM:SS in UTC and in Egypt (UTC+3, the app-wide
// convention used by toEgypt12). Displayed on the hero card so a stale/mislabeled
// time source is immediately visible to the user.
export const utcClockStr = (d = new Date()) =>
  `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}:${String(d.getUTCSeconds()).padStart(2,"0")}`;
export const egyClockStr = (d = new Date()) => {
  const h = ((d.getUTCHours() + 3) % 24 + 24) % 24; const ap = h >= 12 ? "PM" : "AM"; let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(d.getUTCMinutes()).padStart(2,"0")}:${String(d.getUTCSeconds()).padStart(2,"0")} ${ap}`;
};

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

// GBP/USD ("cable") — LONDON-centric clock, distinct from gold's FX map. Cable's
// primary liquidity is the London open (07:00 UTC) and the London/NY overlap
// (13:00–16:00 UTC). The Asian session (21:00–07:00 UTC) is genuinely thin for
// cable — more so than gold — so it is rated AVOID, not just "ok".
export const getGbpSession = () => {
  const h = new Date().getUTCHours(), d = new Date().getUTCDay();
  if (d === 6 || (d === 0 && h < 21)) return { label: "Weekend", quality: "avoid" };
  if (h >= 7 && h < 9)   return { label: "London Open",       quality: "best" }; // cable's own primary window
  if (h >= 9 && h < 13)  return { label: "London Session",    quality: "good" };
  if (h >= 13 && h < 16) return { label: "London/NY Overlap", quality: "best" };
  if (h >= 16 && h < 17) return { label: "US Afternoon",      quality: "good" };
  if (h >= 17 && h < 21) return { label: "US Late",           quality: "ok"   };
  return { label: "Asian — thin for cable", quality: "avoid" }; // 21:00–07:00 UTC
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
// Bollinger Bands (period, sd). Moved here from the removed scalp engine — ta.js
// uses it for the 4h BB regime shared by every asset.
export const bollinger = (closes, period = 20, sd = 2) => {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mid + sd * std, lower = mid - sd * std;
  const price = closes[closes.length - 1];
  return { mid, upper, lower, width: (upper - lower) / mid * 100, position: price >= upper ? "UPPER" : price <= lower ? "LOWER" : "MIDDLE" };
};

// ─── Binary-event calendar (auto-estimated; AI web search is the real gate) ───
const pad = n => String(n).padStart(2,"0");
const firstFriday = (y,m) => { const d=new Date(Date.UTC(y,m,1)); const off=(5-d.getUTCDay()+7)%7; return 1+off; };
// 2026 FOMC decision dates (announcement day). Verify against the Fed calendar.
const FOMC_2026 = ["2026-01-28","2026-03-18","2026-04-29","2026-06-17","2026-07-29","2026-09-16","2026-10-28","2026-12-09"];
// 2026 ECB monetary-policy Governing Council decision dates (confirmed).
const ECB_2026  = ["2026-01-30","2026-03-06","2026-04-17","2026-06-05","2026-07-24","2026-09-11","2026-10-30","2026-12-18"];
// 2026 BOE Bank of England MPC decision dates (approx — 8/year; live calendar is
// the real gate). Cable moves hard on these — weighted like FOMC for GBP/USD.
const BOE_2026  = ["2026-02-05","2026-03-19","2026-05-07","2026-06-18","2026-08-06","2026-09-17","2026-11-05","2026-12-17"];

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
  // UK / GBP events (cable-specific) — BOE mirrors the FOMC cadence; UK data prints
  // mid-month. Cable often moves outsized on these even when the USD side is quiet.
  BOE:  { label:"BOE rate decision",     next:()=>nextFromList(BOE_2026) },
  UKCPI:{ label:"UK CPI (inflation)",    next:()=>nextMonthly(()=>16), approx:true },
  UKGDP:{ label:"UK GDP",                next:()=>nextMonthly(()=>12), approx:true },
  UKEMP:{ label:"UK employment/wages",   next:()=>nextMonthly(()=>15), approx:true },
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

// First binary event within `hours` from now (the WAIT window), else null. Used to
// block BOTH the free scan and the paid signal — a scan is pointless (and wastes the
// Twelve-Data free limit) when an imminent event will force WAIT anyway.
export const binaryWithin = (events, hours = 24) => {
  const now = Date.now();
  return (events || [])
    .filter(e => e && e.date && (+e.date - now) > 0 && (+e.date - now) <= hours * 3600000)
    .sort((a, b) => +a.date - +b.date)[0] || null;   // the NEAREST imminent event
};
// Two-phase event gate: "pre" = within preH hours BEFORE the release (block/WAIT);
// "chaos" = within postMin minutes AFTER release (still WAIT — the sharp, whippy
// window verified to blow stops); null = safe to trade. `at` = release time,
// `safeAt` = when it becomes tradeable again. Feed a ticking clock for a live count.
export const eventGate = (events, preH = 24, postMin = 30) => {
  const now = Date.now();
  const sorted = (events || []).filter(e => e && e.date).sort((a, b) => +a.date - +b.date);
  for (const e of sorted) {
    const dt = +e.date, delta = dt - now, safeAt = dt + postMin * 60000;
    if (delta > 0 && delta <= preH * 3600000) return { phase: "pre", event: e, at: dt, safeAt };
    if (delta <= 0 && now < safeAt) return { phase: "chaos", event: e, at: dt, safeAt };
  }
  return null;
};
// "Xh Ym" (or "Ym") until a target time — a live countdown when fed a ticking clock.
export const hmLeft = (target, nowMs = Date.now()) => {
  const ms = Math.max(0, (+target) - nowMs), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// Is the current UTC time inside a "HH:MM–HH:MM UTC" window? (handles midnight wrap)
export const inWindow = win => {
  const m = (win || "").match(/(\d{1,2}):(\d{2}).*?(\d{1,2}):(\d{2})/); if (!m) return false;
  const now = new Date(), cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4];
  return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
};

// ═══ Section 7: server-side proxy configuration ═════════════════════════════
// PROXY_DATA routes the KEYED upstreams (Twelve Data, FRED) through
// our same-origin /api/data function, which injects the key server-side — so no
// data key ever appears in a browser network request. SIGNAL_PROXY controls, per
// asset, whether the Anthropic call goes through /api/signal (server-side key) vs
// the legacy in-browser path. Defaults ON (secure). Flip an asset to false only
// as part of a deliberate, verified rollback (see runAI + the audit report).
export const PROXY_DATA = true;
export const SIGNAL_PROXY = { gold: true, gbp: true, btc: true };
export const signalProxyEnabled = id => SIGNAL_PROXY[id] !== false;

// Wrap a keyed upstream URL so the request goes through the same-origin proxy
// with the real key injected server-side. Any (masked) key param is stripped
// client-side so the sentinel never even leaves the browser.
export const proxyDataUrl = (src, rawUrl) => {
  if (!PROXY_DATA) return rawUrl;
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete(src === "td" ? "apikey" : "api_key");
    return `/api/data?src=${src}&u=${encodeURIComponent(u.toString())}`;
  } catch (_) { return rawUrl; }
};

// ─── Twelve Data fetch with one 429 retry (rate-limit aware) ──────────────────
// Returns parsed JSON. On a rate-limit response, waits 15s and retries once.
// Routed through the server-side data proxy (Section 7) so the key stays server-side.
export const tdFetch = async (url, addLog) => {
  const target = proxyDataUrl("td", url);
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(target);
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
export async function runAI({ apiKey, system, userContent, addLog, model="claude-sonnet-4-6", maxTokens=6000, maxSearches, useProxy=false }) {
  // ═══ Section 7: server-side proxy path (default) ═══════════════════════════
  // The Anthropic key lives ONLY on the server. We POST the request payload to
  // /api/signal, which runs the full multi-turn tool_use loop server-side (the
  // conversation-history fix is preserved byte-for-byte inside that function) and
  // returns just the final text + the pipeline logs to replay in the UI.
  if (useProxy) {
    addLog && addLog("Sending to secure signal proxy (server-side key)...");
    const res = await fetch("/api/signal", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, userContent, model, maxTokens, maxSearches }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error((data && data.error) || `Signal proxy error ${res.status}`);
    (data.logs || []).forEach(l => addLog && addLog(l));
    return data.text || "";
  }

  // ═══ LEGACY in-browser path — retained per the safe-rollout requirement (7B),
  // NOT deleted. Only reachable when an asset's SIGNAL_PROXY flag is off. Note:
  // with keys masked server-side (Section 7) `apiKey` is the sentinel, so this
  // path is a documented rollback stub — a full revert also un-masks /api/keys.
  const tools=[{ type:"web_search_20250305", name:"web_search", ...(maxSearches?{ max_uses:maxSearches }:{}) }];
  let history=[{ role:"user", content:userContent }];
  let finalText="";

  // PROMPT CACHING: each search iteration re-sends the whole growing conversation
  // (system + data package + all search results) as input tokens. Marking the
  // system block + the last content block as ephemeral cache breakpoints lets the
  // repeated prefix be re-read at ~10% of the input price. temperature:0 makes the
  // signal deterministic (same data → same call). Falls back automatically if the
  // API ever rejects a cache marker.
  const systemBlocks=[{ type:"text", text:system, cache_control:{ type:"ephemeral" } }];
  // Only mark USER-role messages (safe, documented); never mark a trailing
  // assistant message from a pause_turn resume — avoids any prefill+cache edge.
  const withCacheMark = msgs => {
    let li=-1;
    for(let k=msgs.length-1;k>=0;k--) if(msgs[k].role==="user"){ li=k; break; }
    if(li===-1) return msgs;
    return msgs.map((m,idx)=>{
      if(idx!==li) return m;
      let c=m.content;
      if(typeof c==="string") c=[{ type:"text", text:c }];
      else c=c.map(b=>{ const { cache_control, ...rest }=b; return rest; });
      if(!c.length) return m;
      c=[...c.slice(0,-1), { ...c[c.length-1], cache_control:{ type:"ephemeral" } }];
      return { ...m, content:c };
    });
  };
  let useCache=true;

  for(let i=0;i<10;i++){
    const res=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" },
      body:JSON.stringify({ model, max_tokens:maxTokens, temperature:0,
        system:useCache?systemBlocks:system, tools,
        messages:useCache?withCacheMark(history):history })
    });
    if(!res.ok){
      const e=await res.json().catch(()=>({}));
      const msg=e?.error?.message||`API error ${res.status}`;
      if(useCache&&/cache/i.test(msg)){ useCache=false; addLog&&addLog("Prompt caching rejected — retrying without"); i--; continue; }
      throw new Error(msg);
    }
    const data=await res.json();

    const texts=(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
    if(texts) finalText=texts;

    if(data.stop_reason==="max_tokens") addLog&&addLog("⚠ hit max_tokens — output may be truncated");
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

  // SALVAGE PASS: if the reply isn't valid JSON (prose ending, truncation), make
  // one cheap tool-free request that converts it into the required JSON instead
  // of surfacing a parse error. Fresh context — no tool blocks, no cache marks.
  if(finalText && !parseJSON(finalText)){
    addLog&&addLog("Reply wasn't valid JSON — running salvage pass...");
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{ "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" },
        body:JSON.stringify({ model, max_tokens:4000, temperature:0, system,
          messages:[{ role:"user", content:`Your previous analysis reply was not valid JSON. Convert it into the single valid JSON object required by your instructions — preserve every value and conclusion exactly as stated, fill any missing required field sensibly from the text, and output ONLY the JSON with no other text.\n\n--- PREVIOUS REPLY ---\n${finalText.slice(0,12000)}` }] })
      });
      if(res.ok){
        const d=await res.json();
        const t=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
        if(t&&parseJSON(t)){ addLog&&addLog("Salvage succeeded."); return t; }
      }
    }catch(_){}
    addLog&&addLog("Salvage failed — returning original reply.");
  }
  return finalText;
}

// ─── WAIT Alert System — appended to every asset's system prompt ─────────────
export const WAIT_RULES = `

═══ DATA TRUST — CRITICAL ═══
The provided spot price is fetched live at request time and cross-checked against an institutional feed (Swissquote). It IS the current market price. Prices you encounter inside web-search results are often minutes-to-hours STALE (cached articles, delayed quotes) — especially right after news releases. NEVER override the provided spot with a searched price, never re-anchor your levels to a searched price, and never report a "data quality failure" because a search snippet shows a different price. Use searches for news/levels/context ONLY; use the provided numbers for ALL price math.

═══ WAIT ALERT SYSTEM — REQUIRED ON EVERY RESPONSE ═══
You MUST always include a "wait_type" string and a "triggers" object — for LONG and SHORT too, not only WAIT.

wait_type = one of:
- "binary_event"  : a binary event (FOMC/CPI/NFP/PCE/ECB) is UPCOMING within the next 24h ONLY. An event 24–72h away is NOT a binary_event WAIT — it is CAUTION ONLY (still output a directional call, just note the event and advise reduced size). Never force WAIT for an event more than 24h out. Already-released events do NOT count once 30+ minutes have passed since release.
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

// ─── Accuracy & honesty rules (Sections 3b + 3e) — appended to every asset ────
// Applied IDENTICALLY to Gold, BTC and GBP/USD so the three engines stay in sync.
export const ACCURACY_RULES = `

═══ MULTIPLE SCENARIO OUTPUT — REQUIRED ON EVERY RESPONSE (LONG, SHORT and WAIT) ═══
Markets branch. In addition to your main call you MUST map the two realistic alternate branches. Add these THREE top-level keys to your JSON:
- "primary_scenario": one sentence describing your base-case path (the direction/thesis your action reflects) and what price action would confirm it.
- "alternate_bullish": { "trigger": "the specific price level/condition that would activate a bullish path", "confirm": "the confirming price/close that validates it" }
- "alternate_bearish": { "trigger": "the specific price level/condition that would activate a bearish path", "confirm": "the confirming price/close that validates it" }
Use the pre-computed levels (fib, swing S/R, PDH/PDL, round numbers, BB bands) as the concrete trigger/confirm prices. These are REAL branches, not a hedge — only one will occur; you are not predicting which.

═══ HONEST CONFIDENCE LANGUAGE — REQUIRED ═══
Use probabilistic, non-deterministic language everywhere (reasoning, notes, scenarios). NEVER use "will", "guaranteed", "certain", "confirmed move", "definitely", "always/never happens". Prefer "likely", "favoured", "elevated probability", "leans", "suggests", "risk of". Confidence reflects how well the data ALIGNS — it is NOT a probability of profit. Losing trades are a normal, expected outcome of any edge. Do not imply certainty of outcome in any field.

═══ FLIP / BREAKOUT CONFIRMATION — REQUIRED ═══
A single candle closing through a key level is NOT a confirmed breakout. If the pre-computed LEVEL FLIP status is PENDING (broke on the latest candle, no confirmation yet), do NOT output a full-confidence breakout trade — cap confidence at LOW, describe it as pending, and set the trigger to the next candle's continuation. If it is FALSE_BREAK (the next candle reclaimed the level), treat the breakout as FAILED — explicitly say "FALSE BREAK" and lean the opposite way or WAIT. Only a CONFIRMED flip (next candle continued past the level with margin) supports a normal-confidence breakout entry.`;

// Permanent risk footer shown on every signal (Section 3e).
export const PERMANENT_FOOTER =
  "No signal predicts outcomes with certainty. Confidence reflects data alignment, not guaranteed results. Losses are a normal part of any trading approach.";

// ─── Session cost tracking (counts paid Anthropic calls this browser session) ─
export const EST_COST = 0.18;      // € per paid signal — low estimate
export const EST_COST_HIGH = 0.70; // € per paid signal — high estimate (more web search)
export const bumpSignalCount = () => { try { const n = (parseInt(sessionStorage.getItem("sdg_calls")) || 0) + 1; sessionStorage.setItem("sdg_calls", String(n)); return n; } catch (_) { return 0; } };
export const signalCount = () => { try { return parseInt(sessionStorage.getItem("sdg_calls")) || 0; } catch (_) { return 0; } };

// ─── Daily cost / API-call meter (operational metering, NOT trade logging) ────
// Persists a per-day count of paid Anthropic signals and Twelve-Data calls so the
// user can see spend + free-tier headroom (TD free = 800/day). Self-resets when the
// date rolls over. localStorage (same as keys/account/levels), never influences a
// signal. TD_FREE_DAILY is the documented free-tier ceiling.
export const TD_FREE_DAILY = 800;
// Position size from Pepperstone contract specs. cv = USD P/L per 1.0 price unit per
// 1.0 lot. Floored to the 0.01-lot increment so it never OVER-risks (under-risk is safe).
// Shared by the Outcome Map and the Trade Plan so they always agree.
export const LOT_SPEC = { gold: { cv: 100, unit: "oz", perLot: 100 }, gbp: { cv: 100000, unit: "units", perLot: 100000 }, btc: { cv: 1, unit: "BTC", perLot: 1 } };
export const lotSizeFor = (assetId, riskDist, riskAmount) => {
  const s = LOT_SPEC[assetId] || { cv: 1, unit: "units", perLot: 1 };
  if (!riskDist || riskDist <= 0 || !(riskAmount > 0)) return null;
  const raw = riskAmount / (riskDist * s.cv);
  const lots = Math.floor(raw * 100) / 100;
  return { lots, units: lots * s.perLot, actualRisk: lots * riskDist * s.cv, unit: s.unit, tooSmall: raw > 0 && lots < 0.01 };
};
const dayKey = () => new Date().toISOString().slice(0, 10);
export const dailyMeter = () => {
  try { const d = JSON.parse(localStorage.getItem("sdg_daily") || "{}"); return (d.date === dayKey()) ? { date: d.date, paid: d.paid || 0, td: d.td || 0, scans: d.scans || 0 } : { date: dayKey(), paid: 0, td: 0, scans: 0 }; }
  catch (_) { return { date: dayKey(), paid: 0, td: 0, scans: 0 }; }
};
export const bumpDaily = (field, n = 1) => {
  const d = dailyMeter(); d[field] = (d[field] || 0) + n;
  try { localStorage.setItem("sdg_daily", JSON.stringify(d)); } catch (_) {}
  return d;
};

// ─── Refresh lockout (behavioural guardrail, 2026-07-30) ─────────────────────
// After a signal fires for an asset, lock re-scans until the next 4h candle close.
// The engine recomputes live and win-rate is FLAT across the 4h bar (measured), so a
// mid-bar re-scan adds no edge — it only enables refresh-hunting and revenge re-entry,
// the user's biggest leak. Advisory: the UI disables Refresh; self-clears at the close.
export const next4hBoundaryMs = (nowMs = Date.now()) => {
  const d = new Date(nowMs);
  const nh = (Math.floor(d.getUTCHours() / 4) + 1) * 4;
  const b = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
  b.setUTCHours(nh);
  return +b;
};
export const lockSignal = assetId => {
  try { const m = JSON.parse(localStorage.getItem("sdg_lock") || "{}"); m[assetId] = next4hBoundaryMs(); localStorage.setItem("sdg_lock", JSON.stringify(m)); } catch (_) {}
};
export const signalLock = (assetId, nowMs = Date.now()) => {
  try { const m = JSON.parse(localStorage.getItem("sdg_lock") || "{}"); const until = m[assetId]; if (until && until > nowMs) return { locked: true, until }; } catch (_) {}
  return { locked: false, until: 0 };
};

// ─── Trade journal (localStorage, 2026-07-30) — measure the REAL win rate ─────
// One record per trade taken. The foundation for any real optimisation: without the
// actual outcomes we are guessing. Never influences a signal. Capped at 500 rows.
export const JOURNAL_KEY = "sdg_journal";
export const getTrades = () => { try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]"); } catch (_) { return []; } };
export const addTrade = t => { try { const a = getTrades(); a.push({ id: Date.now(), ts: Date.now(), outcome: "open", ...t }); localStorage.setItem(JOURNAL_KEY, JSON.stringify(a.slice(-500))); return a; } catch (_) { return getTrades(); } };
export const updateTrade = (id, patch) => { try { const a = getTrades().map(x => x.id === id ? { ...x, ...patch } : x); localStorage.setItem(JOURNAL_KEY, JSON.stringify(a)); return a; } catch (_) { return getTrades(); } };
export const journalStats = () => {
  const all = getTrades();
  const closed = all.filter(t => ["win", "loss", "be"].includes(t.outcome));
  const wins = closed.filter(t => t.outcome === "win").length, losses = closed.filter(t => t.outcome === "loss").length, be = closed.filter(t => t.outcome === "be").length;
  const followed = all.filter(t => t.followed === true).length;
  return { total: all.length, closed: closed.length, wins, losses, be, winRate: closed.length ? Math.round(100 * wins / (wins + losses || 1)) : null, followedPct: all.length ? Math.round(100 * followed / all.length) : null };
};

// ─── Scan-All persistence (2026-07-30) ───────────────────────────────────────
// The free tier read is stable within a 4h bar (tier is daily-anchored; the 4h trend
// only updates on a 4h close), so cache the last Scan All and show it on every page
// load until the next candle closes. `staleAfter` = the 4h boundary the read belongs
// to; past it, the UI still shows the numbers but flags them as needing a re-scan.
export const SCANS_KEY = "sdg_scans";
export const saveScans = (map, ts = Date.now()) => { try { localStorage.setItem(SCANS_KEY, JSON.stringify({ ts, map })); } catch (_) {} };
export const loadScans = () => { try { return JSON.parse(localStorage.getItem(SCANS_KEY) || "null"); } catch (_) { return null; } };

// ─── Shared key storage (gold + EUR share data keys; all share Anthropic) ─────
export const KEY_STORE = "sdg_keys";
export const loadKeys = () => { try { return { anthropic:"", td:"", fred:"", ...JSON.parse(localStorage.getItem(KEY_STORE)||"{}") }; } catch(_){ return { anthropic:"", td:"", fred:"" }; } };
// Saving also pushes to the encrypted server store (/api/keys, gated by the login
// cookie) so keys survive browser clears and follow the passcode across devices.
export const saveKeys = k => {
  try { localStorage.setItem(KEY_STORE, JSON.stringify(k)); } catch(_){}
  try { fetch("/api/keys", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(k) }); } catch(_){}
};
// Pull server-stored keys on app load; merge into localStorage if the server has
// an Anthropic key (server wins over an empty local store, local edits win later).
export const syncKeysFromServer = async () => {
  try {
    const r = await fetch("/api/keys", { cache:"no-store" });
    if (!r.ok) return null;
    const k = await r.json();
    if (k && k.anthropic) {
      const local = loadKeys();
      const merged = { ...k, ...(local.anthropic ? local : {}) };
      try { localStorage.setItem(KEY_STORE, JSON.stringify(merged)); } catch(_){}
      return merged;
    }
  } catch(_){}
  return null;
};
