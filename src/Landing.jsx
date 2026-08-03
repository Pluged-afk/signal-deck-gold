import { useState, useRef, useEffect } from "react";
import { mono, card, isWeekend, loadKeys, useNow, TD_FREE_DAILY, dailyMeter, upcomingEvents, eventGate, hmLeft, saveScans, loadScans, next4hBoundaryMs } from "./shared";
import { fetchLiveCalendar, upcomingLive } from "./calendar";
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
  // Hydrate from the cached Scan All so the per-asset quality is visible on every page
  // load (the tier is stable within a 4h bar) — not blank until you re-scan.
  const _cachedScans = loadScans();
  const [scans, setScans] = useState(_cachedScans?.map || null);   // { gold:{ok,tier,...}, gbp:{...}, btc:{...} }
  const [scanning, setScanning] = useState(false);
  const [scanTs, setScanTs] = useState(_cachedScans?.ts ? new Date(_cachedScans.ts) : null);
  const [liveCal, setLiveCal] = useState(true);  // did the last scan reach the live calendar?
  const [autoScan, setAutoScan] = useState(() => { try { return localStorage.getItem("sdg_autoscan") === "1"; } catch (_) { return false; } });
  const lastSlotRef = useRef(-1);   // last 4h slot auto-scanned (dedupe)
  const settleAtRef = useRef(0);    // when a blocked event settles → trigger an extra scan
  const scanningRef = useRef(false);
  const notifiedEventRef = useRef(0); // release-time of the last event we heads-up'd (dedupe)
  const didOpenScanRef = useRef(false); // guard: auto-scan once on open (if stale)
  const meter = dailyMeter();

  // Scan all three at once (FREE — no AI). Skips any asset with a binary event inside
  // the 24h WAIT window — no fetch, no wasted TD-limit call, since it would WAIT anyway.
  // Uses the LIVE calendar (same source as the per-asset scan) so real dated events
  // (e.g. GDP Jul 30) are caught; the local approximate calendar is only a fallback if
  // the live feed is unavailable — it estimates CPI/PCE/GDP dates and would miss them.
  const scanAll = async (opts = {}) => {
    if (scanningRef.current) return;
    scanningRef.current = true; setScanning(true);
    const keys = loadKeys();
    const all = await fetchLiveCalendar().catch(() => null);
    setLiveCal(!!all);   // null = live feed unreachable → fell back to the estimate (fail-safe warns)
    const ids = ["gold", "gbp", "btc"];
    const results = await Promise.all(ids.map(id => {
      const cfg = ASSETS[id];
      const evs = all ? upcomingLive(all, cfg.eventCurrencies || ["USD"]) : upcomingEvents(cfg.events || []);
      const eg = eventGate(evs, 24, 30);
      if (eg) return Promise.resolve({ binaryBlocked: true, gate: eg });
      return cfg.scan ? cfg.scan(keys).catch(e => ({ ok: false, reason: e?.message })) : Promise.resolve({ ok: false, reason: "n/a" });
    }));
    const map = {}; ids.forEach((id, i) => map[id] = results[i]);
    // Track the soonest event settle-time so the auto-scheduler re-scans right after it clears.
    const blocked = ids.map(id => map[id]).filter(s => s.binaryBlocked && s.gate);
    settleAtRef.current = blocked.length ? Math.min(...blocked.map(s => s.gate.safeAt)) : 0;
    const canNotify = typeof Notification !== "undefined" && Notification.permission === "granted";
    // HEADS-UP: fire once per distinct event the moment it's within the 24h window, so
    // you're told EVERY time an event is coming — not only when there's a setup.
    if (opts.auto && canNotify && blocked.length) {
      const soonest = blocked.map(s => s.gate).sort((a, b) => a.at - b.at)[0];
      if (notifiedEventRef.current !== soonest.at) {
        notifiedEventRef.current = soonest.at;
        try { new Notification("Signal Deck — binary event", { body: `${soonest.event.label} ${soonest.event.ds} · ${soonest.event.tEgy} EGY — trading paused until after` }); } catch (_) {}
      }
    }
    // Notify (auto-scans only) when something is actually tradeable — tier 2+ or a fade.
    if (opts.auto && canNotify) {
      const good = ids.filter(id => { const s = map[id]; return s.ok && !s.extended && (s.tier >= 2 || s.rangeFade?.active || s.revFade?.active); });
      if (good.length) try { new Notification("Signal Deck — worth a look", { body: good.map(id => `${id.toUpperCase()}: ${map[id].revFade?.active || map[id].rangeFade?.active ? "FADE setup" : "tier " + map[id].tier}`).join(" · ") }); } catch (_) {}
    }
    const ts = Date.now();
    setScans(map); setScanTs(new Date(ts)); saveScans(map, ts); setScanning(false); scanningRef.current = false;
  };

  const toggleAuto = () => {
    const nv = !autoScan; setAutoScan(nv);
    try { localStorage.setItem("sdg_autoscan", nv ? "1" : "0"); } catch (_) {}
    if (nv && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
    if (nv) scanAll({ auto: true });   // scan immediately on enable
  };

  // ON OPEN: if the cached scan is stale (from a previous 4h candle) or missing, scan
  // immediately — so you never OPEN the app to an out-of-date tier and act on it. This is
  // the exact trap that could bait a mistaken entry (a stale "tier 3 WORTH IT"). Runs once.
  useEffect(() => {
    if (didOpenScanRef.current) return;
    didOpenScanRef.current = true;
    const c = loadScans();
    const fresh = c?.ts && (+c.ts >= next4hBoundaryMs(Date.now()) - 4 * 3600000);
    if (!fresh) scanAll();
  }, []);

  // Scan scheduler — refreshes tiers at each 4h close (08/12/16/20 UTC) whenever the tab is
  // open. BINARY-EVENT AWARE: once a scan finds an event blocking any asset it records the
  // settle time (event + 30 min), and the scheduler SKIPS the intervening 4h scans — it does
  // NOT scan into the pre-event / chaos window — then fires ONE clean scan after the event is
  // over + 30 min. (The blocked row's live countdown still ticks meanwhile off the 1s clock,
  // so awareness isn't lost.) The Auto-scan toggle only controls NOTIFICATIONS.
  useEffect(() => {
    const t = now.getTime(), h = now.getUTCHours(), min = now.getUTCMinutes();
    const slot = Math.floor(t / (4 * 3600e3));
    const scheduledDue = [8, 12, 16, 20].includes(h) && min < 2 && slot !== lastSlotRef.current;
    const settleDue = settleAtRef.current && t >= settleAtRef.current;
    const waitingForSettle = settleAtRef.current && t < settleAtRef.current;
    if (scanningRef.current) return;
    if (settleDue) {
      settleAtRef.current = 0;
      scanAll({ auto: autoScan }); // event ended + 30 min → scan the post-event tiers
    } else if (scheduledDue) {
      lastSlotRef.current = slot;                          // consume this 4h slot either way
      if (!waitingForSettle) scanAll({ auto: autoScan });  // SKIP the 4h scan while an event is pending
    }
  }, [now, autoScan]);

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
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <button onClick={toggleAuto}
                title="Tiers auto-refresh on open and at each 4h close (08/12/16/20 UTC) while this tab is open — always, so you never act on a stale scan. This toggle only controls ALERTS: ON = notify you when a setup is worth a look; OFF = refresh silently."
                style={{padding:"8px 12px",background:autoScan?"#04140a":"transparent",border:`1px solid ${autoScan?"#4ade80":"#334155"}`,borderRadius:8,color:autoScan?"#4ade80":"#94a3b8",fontSize:11,cursor:"pointer",...mono}}>
                {autoScan?"🔔 Alerts ON":"🔕 Alerts OFF"}
              </button>
              <button onClick={()=>scanAll()} disabled={scanning}
                style={{padding:"8px 16px",background:"#1e293b",border:"1px solid #4ade80",borderRadius:8,color:"#4ade80",fontSize:12,cursor:scanning?"default":"pointer",...mono,opacity:scanning?0.6:1}}>
                {scanning?"Scanning…":"⚡ Scan All (free)"}
              </button>
            </div>
          </div>

          {/* live next-scan timer */}
          <p style={{...mono,fontSize:10,color:"#64748b",margin:"10px 0 0"}}>
            Next 4h close (when tiers can change): <span style={{color:"#94a3b8"}}>{ncUTC} · {ncEGY} EGY</span> — in {Math.floor(minsLeft/60)}h {minsLeft%60}m
            {autoScan?<span style={{color:"#4ade80"}}> · auto-scan will run then</span>:null}
          </p>

          {/* calendar fail-safe — if the live feed is down, say so instead of silently
              trusting the local estimate (which guesses CPI/PCE/GDP dates and can miss one) */}
          {scans&&!liveCal&&(
            <p style={{...mono,fontSize:10,color:"#fbbf24",margin:"8px 0 0",lineHeight:1.5,padding:"6px 8px",background:"#1a1206",border:"1px solid #a16207",borderRadius:6}}>
              ⚠ Live calendar unavailable — event detection is using estimated dates. FOMC/NFP are still accurate, but CPI/PCE/GDP dates are approximate and one could be missed. Check the economic calendar manually before trading.
            </p>
          )}

          {/* scan results */}
          {scans&&(
            <div style={{marginTop:10,borderTop:"1px solid #1e293b",paddingTop:10}}>
              {CARDS.map(c=>{
                const s=scans[c.id]; if(!s) return null;
                if(s.binaryBlocked&&s.gate){ const g=s.gate, e=g.event, pre=g.phase==="pre", col=pre?"#f87171":"#fbbf24";
                  return (
                    <button key={c.id} onClick={()=>onSelect(c.id)}
                      style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"8px 10px",margin:"4px 0",background:"#020617",border:`1px solid ${col}44`,borderRadius:8,cursor:"pointer",...mono,textAlign:"left"}}>
                      <span style={{fontSize:12,color:c.accentText,fontWeight:700,minWidth:70}}>{c.glyph} {c.name}</span>
                      <span style={{fontSize:11,color:"#94a3b8",flex:1}}>{pre?"⏳":"⚠️"} {e.label} {e.ds} · {e.tEgy} EGY {pre?"— within 24h":"— just released"}</span>
                      <span style={{fontSize:11,fontWeight:700,color:col,minWidth:135,textAlign:"right"}}>{pre?`WAIT · release ${hmLeft(g.at,+now)}`:`safe in ${hmLeft(g.safeAt,+now)}`}</span>
                    </button>
                  );
                }
                const fade=s.ok&&(s.rangeFade?.active||s.revFade?.active);
                const fadeDir=s.rangeFade?.active?s.rangeFade.dir:s.revFade?.active?s.revFade.dir:null;
                const ext=s.ok&&s.extended;                 // ran >1.5×ATR — don't chase
                const tierPass=s.ok&&(s.tier>=2||fade);
                // Priority: tier<2 is a SKIP regardless of extended (a pullback won't fix a
                // dissenting daily). "wait pullback" only applies to an otherwise-tradeable tier.
                const col=!s.ok?"#fbbf24": !tierPass?"#f87171" : ext?"#fb923c":fade?"#c084fc":"#4ade80";
                return (
                  <button key={c.id} onClick={()=>onSelect(c.id)}
                    style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"8px 10px",margin:"4px 0",background:"#020617",border:`1px solid ${col}44`,borderRadius:8,cursor:"pointer",...mono,textAlign:"left"}}>
                    <span style={{fontSize:12,color:c.accentText,fontWeight:700,minWidth:70}}>{c.glyph} {c.name}</span>
                    <span style={{fontSize:11,color:"#94a3b8",flex:1}}>
                      {s.ok?`1D ${s.tD} · 4h ${s.t4} · 1h ${s.t1}${s.ranging?" · RANGE":""}${tierPass&&ext?` · ⚠ ran ${s.recentMoveATR?.toFixed(1)}×ATR`:""}${fade?` · ⇄ ${fadeDir} fade`:""}`:`scan failed — ${s.reason||"n/a"}`}
                    </span>
                    <span style={{fontSize:11,fontWeight:700,color:col,minWidth:135,textAlign:"right"}}>
                      {!s.ok?"— proceed manually": !tierPass?`tier ${s.tier} ✕ skip` : ext?`tier ${s.tier} · wait pullback`:fade?`⇄ FADE ✓ WORTH IT`:`tier ${s.tier} ✓ WORTH IT`}
                    </span>
                  </button>
                );
              })}
              {(()=>{const stale=scanTs&&(+scanTs < next4hBoundaryMs(+now)-4*3600000);return(
              <p style={{fontSize:9,color:stale?"#fb923c":"#475569",margin:"6px 0 0",textAlign:"right"}}>
                {stale?"⚠ from a previous 4h candle — re-scan to refresh · ":""}Scanned {scanTs?scanTs.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""} · today: {meter.scans} scans · {meter.paid} paid{meter.td?` · ~${meter.td}/${TD_FREE_DAILY} TD`:""}
              </p>);})()}
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
