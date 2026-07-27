import { useState } from "react";
import { mono, card, isWeekend, loadKeys, useNow, TD_FREE_DAILY, dailyMeter } from "./shared";
import { ASSETS } from "./assets";

// Recommended free-scan times — the 4h closes that land in a good session (skip the
// dead 00/04 UTC Asian closes). Egypt = UTC+3.
const SCAN_TIMES = [
  { utc: "08:00 UTC", egy: "11:00 AM", who: "Gold · GBP — London open" },
  { utc: "12:00 UTC", egy: "3:00 PM",  who: "All — into NY session" },
  { utc: "16:00 UTC", egy: "7:00 PM",  who: "All — EU/US overlap (best)" },
  { utc: "20:00 UTC", egy: "11:00 PM", who: "BTC — US session" },
];
// next 4h candle close (00/04/08/12/16/20 UTC) from a live clock
const nextClose = now => { const nh = (Math.floor(now.getUTCHours() / 4) + 1) * 4; const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)); d.setUTCHours(nh); return d; };
const egyHour = utcH => { const e = (utcH + 3) % 24; return `${e % 12 || 12}:00 ${e >= 12 ? "PM" : "AM"}`; };

// Asset selection — no signals run here. Picking a card mounts ONE engine.
const CARDS = [
  {
    id:"gold", name:"GOLD", symbol:"XAU/USD",
    accent:"#ca8a04", accentText:"#fbbf24", glyph:"✦",
    desc:"Safe-haven metal. Driven by real yields, DXY, Fed policy and COT positioning.",
    hours:"London Open 08–10 UTC · EU-US overlap 13–16 UTC",
    weekend:"Avoid — spreads blow out",
    weekendRating:"poor",
  },
  {
    id:"gbp", name:"GBP / USD", symbol:"Cable",
    accent:"#1e40af", accentText:"#93c5fd", glyph:"£",
    desc:"Cable. Driven by BOE vs Fed policy, DXY and UK data (CPI/GDP/jobs). London/NY overlap best — 4:00–7:00 PM EGY.",
    hours:"London Open 07–09 UTC · London/NY overlap 13–16 UTC",
    weekend:"Thin — 25+ pip targets only",
    weekendRating:"fair",
  },
  {
    id:"btc", name:"BITCOIN", symbol:"BTC/USD",
    accent:"#f97316", accentText:"#fb923c", glyph:"₿",
    desc:"24/7 crypto. ETF flows, funding rate, open interest and dominance lead price.",
    hours:"US session 13–21 UTC primary · 24/7 market",
    weekend:"Tradeable — reduce size 30%",
    weekendRating:"good",
  },
];

const ratingCol = r => r==="good"?"#4ade80":r==="fair"?"#fbbf24":"#f87171";

export default function Landing({ onSelect }) {
  const wknd = isWeekend();
  const now = useNow(1000);
  const [scans, setScans] = useState(null);      // { gold:{ok,tier,...}, gbp:{...}, btc:{...} }
  const [scanning, setScanning] = useState(false);
  const [scanTs, setScanTs] = useState(null);
  const meter = dailyMeter();

  // Scan all three at once (FREE — no AI). Each config.scan bumps the daily meter.
  const scanAll = async () => {
    setScanning(true);
    const keys = loadKeys();
    const ids = ["gold", "gbp", "btc"];
    const results = await Promise.all(ids.map(id => ASSETS[id].scan ? ASSETS[id].scan(keys).catch(e => ({ ok: false, reason: e?.message })) : Promise.resolve({ ok: false, reason: "n/a" })));
    const map = {}; ids.forEach((id, i) => map[id] = results[i]);
    setScans(map); setScanTs(new Date()); setScanning(false);
  };

  const nc = nextClose(now);
  const minsLeft = Math.max(0, Math.floor((nc - now) / 60000));
  const ncUTC = `${String(nc.getUTCHours() % 24).padStart(2, "0")}:00 UTC`;
  const ncEGY = egyHour(nc.getUTCHours());

  return (
    <div style={{background:"#020617",minHeight:"100vh",color:"#e2e8f0",padding:"1rem",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <div style={{maxWidth:660,margin:"0 auto"}}>

        <div style={{textAlign:"center",padding:"1.5rem 0 0.5rem"}}>
          <p style={{fontWeight:700,fontSize:22,letterSpacing:"0.14em",color:"#f1f5f9",margin:"0 0 4px"}}>✦ SIGNAL DECK</p>
          <p style={{...mono,fontSize:11,color:"#475569",margin:0}}>Multi-asset signal terminal · Real APIs · Paper trading</p>
        </div>

        {wknd && (
          <div style={{...card,background:"#1c1408",border:"1px solid #78350f",margin:"1rem 0",textAlign:"center"}}>
            <span style={{fontSize:11,color:"#fbbf24",...mono}}>⚠ Weekend — liquidity is thin. Each asset shows its own weekend trading guidance.</span>
          </div>
        )}

        {/* FREE scan-all panel — check all three tiers at once for €0, then open the
            one worth a paid signal. Plus the scan schedule + a live next-close timer. */}
        <div style={{...card,margin:"1.25rem 0 0.5rem",border:"1px solid #334155"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <div>
              <p style={{fontSize:13,fontWeight:700,color:"#e2e8f0",margin:0}}>⚡ Free Scan — all assets</p>
              <p style={{fontSize:10,color:"#64748b",margin:"2px 0 0"}}>Checks the higher-timeframe tier of all three for €0 (no AI). Only pay where it's tier 2+.</p>
            </div>
            <button onClick={scanAll} disabled={scanning}
              style={{padding:"8px 16px",background:"#1e293b",border:"1px solid #4ade80",borderRadius:8,color:"#4ade80",fontSize:12,cursor:scanning?"default":"pointer",...mono,opacity:scanning?0.6:1}}>
              {scanning?"Scanning…":"⚡ Scan All (free)"}
            </button>
          </div>

          {/* live next-scan timer */}
          <p style={{...mono,fontSize:10,color:"#64748b",margin:"10px 0 0"}}>
            Next 4h close (when tiers can change): <span style={{color:"#94a3b8"}}>{ncUTC} · {ncEGY} EGY</span> — in {Math.floor(minsLeft/60)}h {minsLeft%60}m
          </p>

          {/* scan results */}
          {scans&&(
            <div style={{marginTop:10,borderTop:"1px solid #1e293b",paddingTop:10}}>
              {CARDS.map(c=>{
                const s=scans[c.id]; if(!s) return null;
                const pass=s.ok&&s.tier>=2;
                const col=!s.ok?"#fbbf24":pass?"#4ade80":"#f87171";
                return (
                  <button key={c.id} onClick={()=>onSelect(c.id)}
                    style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"8px 10px",margin:"4px 0",background:"#020617",border:`1px solid ${col}44`,borderRadius:8,cursor:"pointer",...mono,textAlign:"left"}}>
                    <span style={{fontSize:12,color:c.accentText,fontWeight:700,minWidth:70}}>{c.glyph} {c.name}</span>
                    <span style={{fontSize:11,color:"#94a3b8",flex:1}}>
                      {s.ok?`1D ${s.tD} · 4h ${s.t4} · 1h ${s.t1}${s.rangeFade?.active?` · ⇄fade ${s.rangeFade.dir}`:""}`:`scan failed — ${s.reason||"n/a"}`}
                    </span>
                    <span style={{fontSize:11,fontWeight:700,color:col,minWidth:120,textAlign:"right"}}>
                      {!s.ok?"— proceed manually":pass?`tier ${s.tier} ✓ WORTH IT`:`tier ${s.tier} ✕ skip`}
                    </span>
                  </button>
                );
              })}
              <p style={{fontSize:9,color:"#475569",margin:"6px 0 0",textAlign:"right"}}>
                Scanned {scanTs?scanTs.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""} · today: {meter.scans} scans · {meter.paid} paid{meter.td?` · ~${meter.td}/${TD_FREE_DAILY} TD`:""}
              </p>
            </div>
          )}

          {/* recommended scan schedule */}
          <div style={{marginTop:10,borderTop:"1px solid #1e293b",paddingTop:8}}>
            <p style={{fontSize:9,color:"#475569",margin:"0 0 4px",letterSpacing:"0.06em",textTransform:"uppercase"}}>Best times to scan</p>
            {SCAN_TIMES.map(t=>(
              <div key={t.utc} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"2px 0"}}>
                <span style={{...mono,fontSize:10,color:"#94a3b8"}}>{t.utc} · {t.egy} EGY</span>
                <span style={{fontSize:10,color:"#64748b"}}>{t.who}</span>
              </div>
            ))}
          </div>
        </div>

        <p style={{fontSize:11,color:"#475569",textAlign:"center",margin:"1.25rem 0 0.75rem",letterSpacing:"0.08em",textTransform:"uppercase"}}>Choose an instrument</p>

        <div style={{display:"grid",gap:12,marginBottom:"1.5rem"}}>
          {CARDS.map(c=>(
            <button key={c.id} onClick={()=>onSelect(c.id)}
              style={{...card, textAlign:"left", cursor:"pointer", borderColor:c.accent+"55", borderWidth:1, transition:"all 0.15s", display:"block"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=c.accent;e.currentTarget.style.background="#111c33";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=c.accent+"55";e.currentTarget.style.background="#0f172a";}}>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <div style={{width:54,height:54,borderRadius:12,background:c.accent+"22",border:`1px solid ${c.accent}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,color:c.accentText,flexShrink:0}}>{c.glyph}</div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                    <span style={{fontSize:17,fontWeight:700,color:c.accentText,letterSpacing:"0.04em"}}>{c.name}</span>
                    <span style={{...mono,fontSize:11,color:"#475569"}}>{c.symbol}</span>
                  </div>
                  <p style={{fontSize:12,color:"#94a3b8",margin:"4px 0 0",lineHeight:1.5}}>{c.desc}</p>
                </div>
                <span style={{fontSize:20,color:c.accent}}>→</span>
              </div>
              <div style={{display:"flex",gap:16,marginTop:12,paddingTop:10,borderTop:"1px solid #1e293b",flexWrap:"wrap"}}>
                <span style={{...mono,fontSize:10,color:"#64748b"}}>🕐 {c.hours}</span>
                <span style={{...mono,fontSize:10,color:ratingCol(c.weekendRating)}}>● Weekend: {c.weekend}</span>
              </div>
            </button>
          ))}
        </div>

        <p style={{fontSize:10,color:"#334155",margin:0,lineHeight:1.5,borderTop:"1px solid #1e293b",paddingTop:"0.75rem"}}>
          PAPER TRADING ONLY — Not financial advice. Each instrument has its own signal engine, scorecard and risk model. Only the selected asset runs.
        </p>
      </div>
    </div>
  );
}
