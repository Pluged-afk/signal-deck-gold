import { useState, useCallback, useRef } from "react";
import {
  mono, card, lbl, fmt, inputStyle,
  aStyl, rStyl, cCol, sCol, qCol,
  parseJSON, runAI, isWeekend, upcomingEvents,
  loadKeys, saveKeys, WAIT_RULES, ACCURACY_RULES, PERMANENT_FOOTER, egyptWindow, urgencyCol, inWindow,
  bumpSignalCount, signalCount, EST_COST, EST_COST_HIGH,
  useNow, utcClockStr, egyClockStr, signalProxyEnabled,
  dailyMeter, bumpDaily, TD_FREE_DAILY,
} from "./shared";
import TACards from "./TACards";
import WaitCard, { InvalidationCard, waitTypeMeta } from "./WaitCard";
import { MarginalBanner, ScenarioMap, OutcomeMap } from "./RiskCards";
import { runPreCheck, storeSignalForPrecheck, PrecheckCard, BinaryBlockCard, precheckSummary } from "./precheck";
import { localWait } from "./ta";
import { useLiveEvents, EventStrip, computeMarginal, upcomingLive } from "./calendar";

// Renders any asset defined in assets.jsx. The asset's `pipeline` is the only
// data path that runs — switching assets unmounts this and its state.
export default function AssetEngine({ config, onBack, headerExtra }) {
  const T = config.theme;
  const [keys,    setKeys]    = useState(loadKeys);
  const [tmpKeys, setTmpKeys] = useState(loadKeys);
  const [keysSet, setKeysSet] = useState(() => !!loadKeys().anthropic);
  const [sig,     setSig]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [ts,      setTs]      = useState(null);
  const [dataLog, setDataLog] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const [precheck, setPrecheck] = useState(null);
  const [prechecking, setPrechecking] = useState(false);
  const [tdWarn, setTdWarn] = useState(false);
  const [costN, setCostN] = useState(signalCount());
  const [scanResult, setScanResult] = useState(null); // free tier-scan result (gate)
  const [scanning, setScanning] = useState(false);
  const [meter, setMeter] = useState(dailyMeter);     // daily paid/TD tracker
  const logRef = useRef([]);
  const usesTD = config.keyFields.some(f => f.field === "td");
  const TIER_GATE = 2; // hard-block the paid signal below this scanned tier

  const addLog = msg => { logRef.current=[...logRef.current,`[${new Date().toLocaleTimeString()}] ${msg}`]; setDataLog([...logRef.current]); };

  // Live high-impact calendar (ForexFactory via our cached proxy); hardcoded
  // estimates remain the fallback. postNfp = within 2h of the ACTUAL release
  // time (catches holiday-shifted NFPs like Thu Jul 2).
  const fallbackEvents = upcomingEvents(config.events);
  // Per-asset event currencies: GBP/USD watches USD + GBP; gold/BTC just USD.
  const evCur = config.eventCurrencies || ["USD"];
  const { events, all: calAll, isLive, postNfp, refresh } = useLiveEvents(fallbackEvents, evCur);
  // Only Gold's pipeline implements the post-NFP window handling.
  const nfpAsset = config.id === "gold";
  // Single live clock (Section 4): drives the debug timestamp + session labels.
  const now = useNow(1000);

  const fetchSignal = useCallback(async () => {
    if(!keys.anthropic){ setError("Anthropic API key required."); setKeysSet(false); return; }
    setPrecheck(null); setLoading(true); setError(null); logRef.current=[]; setDataLog([]);
    try{
      // Section 5: pull a fresh calendar so binary-event awareness is never stale.
      const freshAll = await refresh(false).catch(()=>null);
      const evNow = freshAll ? upcomingLive(freshAll, evCur) : events;
      const { pkg, price, session, meta } = await config.pipeline({ keys, addLog, postNfp: nfpAsset ? postNfp : null });

      // HARD GATE (softened): only force WAIT + skip the paid call when ALL THREE
      // timeframes disagree (genuine chop). A plain 4h/1h conflict now still runs
      // and returns as a LOW-confidence signal.
      const ta = meta.ta;
      if(ta && ta.allDisagree){
        addLog(`All timeframes disagree (4h ${ta.t4} / 1h ${ta.t1} / 15m ${ta.t15}) — forcing WAIT, skipping AI call`);
        const parsed = localWait(ta, price, config.decimals || 2);
        config.merge(parsed, meta);
        parsed.session = session.label; parsed.session_quality = session.quality;
        parsed._marginal = computeMarginal(ta, evNow, Date.now());
        addLog("Signal complete (local WAIT).");
        setSig(parsed); setTs(new Date());
        try{ storeSignalForPrecheck(config.id, parsed, parseFloat(parsed.price)||price); }catch(_){}
        return;
      }

      addLog("Sending to AI for news + synthesis...");
      setCostN(bumpSignalCount()); // count this paid Anthropic call
      setMeter(bumpDaily("paid")); // daily paid-signal tracker
      const finalText = await runAI({ apiKey:keys.anthropic, system:config.system + WAIT_RULES + ACCURACY_RULES, userContent:pkg, addLog, maxSearches:(nfpAsset&&postNfp.active)?6:5, useProxy:signalProxyEnabled(config.id) });
      const parsed = parseJSON(finalText);
      if(!parsed){ addLog(`Parse failed. Raw start: ${(finalText||"").slice(0,120)}`); throw new Error("Could not parse signal JSON. Please retry."); }
      config.merge(parsed, meta);
      parsed.session = session.label;
      parsed.session_quality = session.quality;
      if(!parsed.price && price) parsed.price = String(price);

      // Softened gates: quality <35 forces WAIT; 35-50 OR a 4h/1h conflict still
      // fires but is capped at LOW confidence (trade-at-own-risk).
      const waitBar = config.qualityWaitBar ?? 35; // per-asset calibrated (GBP/USD lower — it earns fewer vol bonuses)
      if(parsed.action !== "WAIT"){
        if(parsed._quality && parsed._quality.score < waitBar){
          addLog(`Signal quality ${parsed._quality.score}<${waitBar} — forcing WAIT`);
          parsed.action = "WAIT";
          if(!parsed.wait_type || parsed.wait_type === "none") parsed.wait_type = "no_setup";
          if(parsed.triggers && !parsed.triggers.primary_reason) parsed.triggers.primary_reason = `Signal quality ${parsed._quality.score}/100 (below ${waitBar})`;
        } else {
          // Track WHICH rule produced the final confidence label, so the UI can say
          // why instead of showing a bare LOW/MEDIUM/HIGH. `aiConf` is what the model
          // itself returned before any deterministic cap was applied.
          const aiConf = parsed.confidence;
          const caps = [];
          if((parsed._quality && parsed._quality.score < 50) || ta?.mtfConflict || ta?.dailyConflict){ parsed.confidence = "LOW"; parsed._lowConfWarn = true; }
          if(parsed._quality && parsed._quality.score < 50) caps.push(`quality ${parsed._quality.score} below 50`);
          if(ta?.mtfConflict){ parsed._mtfConflict = true; caps.push(`4h/1h conflict`); addLog(`4h/1h conflict (4h ${ta.t4} / 1h ${ta.t1}) — capping confidence at LOW`); }
          // Daily gate: 4h+1h agree but the daily opposes them — measured win rate
          // 18-26% vs 43-47% when the daily agrees. Same treatment as a 4h/1h conflict.
          if(ta?.dailyConflict){ parsed._dailyConflict = true; caps.push(`daily (${ta.tD}) opposes the 4h`); addLog(`DAILY conflict (daily ${ta.tD} vs 4h/1h ${ta.t4}) — capping confidence at LOW`); }
          // Higher-timeframe tier — anchored on the DAILY, which measurement showed
          // carries almost all the predictive power (the 1h carries none). Tier 0 =
          // the daily dissents, regardless of how many lower timeframes agree.
          // Measured win rate: tier 0 35-53% (negative expectancy), tiers 1-3 55-62%.
          // Skipped entirely when daily candles are unavailable (htfTier === null).
          if(ta?.htfTier != null){
            parsed._htfTier = ta.htfTier;
            if(ta.htfTier === 0){ parsed.confidence = "LOW"; parsed._lowConfWarn = true; caps.push(`tier 0 — daily does not confirm`); addLog(`HTF tier 0 — daily (${ta.tD}) does not confirm 4h ${ta.t4} — capping confidence at LOW`); }
            else if(ta.htfTier < 3 && parsed.confidence === "HIGH"){ parsed.confidence = "MEDIUM"; caps.push(`tier ${ta.htfTier}/3`); addLog(`HTF tier ${ta.htfTier}/3 (daily confirms, ${3 - ta.htfTier} of 1h/weekly do not) — capping confidence at MEDIUM`); }
          }
          // If nothing here overrode the model, the label is its own judgement — say so
          // rather than leaving the user to guess which rule fired.
          parsed._confReason = caps.length ? caps.join(" · ")
            : `model's own call${parsed.passes !== undefined ? ` (${parsed.passes}/${config.passesOf} scorecard rows confirmed)` : ""}`;
          parsed._confFromModel = caps.length === 0;
          if(caps.length) addLog(`Confidence ${aiConf} → ${parsed.confidence} (${caps.join(" · ")})`);
        }
      }

      // Range-fade transparency (spec §4/§5, gold+GBP only). regimeLabel is null on
      // BTC and on assets without daily candles, so nothing shows there. We record the
      // regime for EVERY signal so a direction change between refreshes is explained,
      // and separately flag when the fade actually FIRED — i.e. the model's action
      // opposes the 4h trend inside an active range regime.
      if(ta?.regimeLabel){
        parsed._regime = ta.regimeLabel; // "RANGE" | "TREND" | "NORMAL"
        if(ta.rangeFade?.active){
          parsed._rangeFade = ta.rangeFade;
          const opposesTrend = (parsed.action==="LONG"&&ta.t4==="BEAR")||(parsed.action==="SHORT"&&ta.t4==="BULL");
          parsed._rangeFadeFired = parsed.action!=="WAIT" && opposesTrend;
          if(parsed._rangeFadeFired) addLog(`RANGE-FADE fired: ${parsed.action} against the 4h ${ta.t4} trend (mean-reversion, tier 0 → LOW).`);
          else if(parsed.action==="WAIT") addLog(`Range regime active but model chose WAIT (catalyst or ambiguity) — fade correctly deferred.`);
        }
      }

      parsed._marginal = computeMarginal(ta, evNow, Date.now());
      addLog("Signal complete.");
      setSig(parsed); setTs(new Date());
      try{ storeSignalForPrecheck(config.id, parsed, parseFloat(parsed.price)||price); }catch(_){}
    }catch(e){ setError(e.message||"Unknown error"); addLog(`ERROR: ${e.message}`); }
    finally{ setLoading(false); }
  }, [keys, config, postNfp.active, nfpAsset, events, refresh]);

  // FREE standalone tier scan — no paid call, no interval gate. Lets the user check
  // "is this worth paying for?" as often as they like for €0.
  const scanOnly = useCallback(async () => {
    if(!config.scan) return;
    setScanning(true); setError(null); setPrecheck(null);
    const scan = await config.scan(keys).catch(e=>({ok:false,reason:e?.message}));
    setScanResult({ ...scan, ts:Date.now() });
    setMeter(dailyMeter());
    setScanning(false);
  }, [keys, config]);

  // Free local pre-check first; only call the paid signal if all conditions pass.
  const attemptSignal = useCallback(async (opts={}) => {
    if(!keys.anthropic){ setError("Anthropic API key required."); setKeysSet(false); return; }
    // Fix 2: warn before spending if Twelve Data key is missing on a TD-backed asset
    if(usesTD && !keys.td && !opts.ackTD){ setTdWarn(true); setPrecheck(null); return; }
    setTdWarn(false);
    setPrechecking(true); setError(null);
    // HARD TIER GATE (free): compute the higher-timeframe tier locally with no AI
    // call and BLOCK the paid signal below tier 2 — the user's cost-protection
    // choice. Fails OPEN: if the scan errors (data hiccup / no key) we do NOT block,
    // so a fetch problem can never trap the user; the existing gates still apply.
    if(config.scan){
      const scan = await config.scan(keys).catch(e=>({ok:false,reason:e?.message}));
      setScanResult({ ...scan, ts:Date.now() });
      setMeter(dailyMeter());
      if(scan.ok && scan.tier != null && scan.tier < TIER_GATE){
        setPrechecking(false);
        addLog(`Free scan: tier ${scan.tier} (< ${TIER_GATE}) — paid signal blocked to save cost.`);
        return; // hard block, no paid call
      }
    }
    // Section 5: force a fresh calendar pull so the pre-check's binary gate and
    // the event strip are computed from live data, not an earlier cached value.
    const freshAll = await refresh(true).catch(()=>null);
    const evs = freshAll ? upcomingLive(freshAll, evCur) : events;
    const res = await runPreCheck({ config, keys, events: evs });
    setPrechecking(false);
    setPrecheck({ ...res, ts:Date.now() });
    if(res.pass) fetchSignal();
  }, [keys, config, events, fetchSignal, usesTD, refresh]);

  const as = sig?aStyl(sig.action):{};
  const sc = sig?.scorecard||{};
  const wknd = isWeekend();
  const dec = config.decimals || 2; // price decimals (all current assets: 2)
  // Section 4: session label recomputed LIVE from the single clock each render
  // (the `now` tick forces re-render), never frozen at signal-generation time.
  const liveSession = config.session ? config.session() : null;

  // Themed buttons
  const primaryBtn = { padding:"8px 18px", background:"#1e293b", border:`1px solid ${T.accent}`, borderRadius:8, color:T.accentText, fontSize:12, cursor:"pointer", ...mono };
  const ghostBtn   = { padding:"6px 10px", background:"transparent", border:"1px solid #334155", borderRadius:8, color:"#94a3b8", fontSize:11, cursor:"pointer", ...mono };

  return (
    <div style={{background:"#020617",minHeight:"100vh",color:"#e2e8f0",padding:"1rem",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
    <div style={{maxWidth:660,margin:"0 auto"}}>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.9rem",paddingBottom:"0.75rem",borderBottom:"1px solid #1e293b"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={onBack} style={ghostBtn} title="Back to asset selection">← Assets</button>
          <div>
            <span style={{fontWeight:700,fontSize:14,letterSpacing:"0.06em",color:T.accentText}}>✦ {config.name}</span>
            <span style={{...mono,fontSize:11,color:"#475569",marginLeft:8}}>{config.headerNote}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {ts&&<span style={{...mono,fontSize:11,color:"#475569"}}>{ts.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>}
          {keysSet&&config.scan&&<button onClick={scanOnly} disabled={loading||prechecking||scanning} style={ghostBtn} title="Free tier scan — no API cost. Checks if a setup is worth a paid signal.">{scanning?"Scanning…":"⚡ Scan (free)"}</button>}
          {keysSet&&<button onClick={attemptSignal} disabled={loading||prechecking||scanning} style={primaryBtn}>{prechecking?"Checking...":loading?"Scanning...":"Refresh ↗ (paid)"}</button>}
          <button onClick={()=>setKeysSet(false)} style={ghostBtn}>⚙ Keys</button>
        </div>
      </div>

      {headerExtra}

      {/* Section 5: always-on binary-event awareness strip (live, re-renders every 60s) */}
      <EventStrip all={calAll} currencies={evCur} fallbackEvents={fallbackEvents} />

      {/* Post-NFP window (gold): live-feed-aware, active for 2h after release */}
      {nfpAsset && postNfp.active && (
        <div style={{...card,background:"#0c1a3a",border:"1px solid #2563eb",marginBottom:10}}>
          <p style={{fontSize:12,fontWeight:700,color:"#60a5fa",margin:"0 0 3px"}}>📊 POST-NFP WINDOW <span style={{...mono,fontWeight:400,fontSize:10,color:"#64748b"}}>({postNfp.sinceMin} min since release)</span></p>
          <p style={{fontSize:11,color:"#93c5fd",...mono,margin:0,lineHeight:1.5}}>
            First 30min chaotic — most reliable signal after 13:00 UTC / 4:00 PM EGY. Stops auto-tightened 20%.
            {sig?._nfpLarge ? " ⚠ Large move already occurred — wait for pullback." : ""}
          </p>
        </div>
      )}

      {/* Binary-event caution (24–72h away — informational, does not block) */}
      {(()=>{const now=Date.now();const ce=events.find(e=>e.date&&e.date-now>24*3600000&&e.date-now<=72*3600000);return ce?(
        <div style={{...card,background:T.panelBg,border:`1px solid ${T.panelBorder}`,marginBottom:10}}>
          <span style={{fontSize:11,color:T.accentText,...mono}}>⚠️ Binary event: {ce.label} in {ce.in} ({ce.ds} · {ce.tEgy} EGY) — trade with caution, reduce size</span>
        </div>):null;})()}

      {/* Weekend banner */}
      {wknd&&(
        <div style={{...card,background:T.panelBg,border:`1px solid ${T.panelBorder}`,marginBottom:10}}>
          <p style={{fontSize:11,fontWeight:700,color:T.accentText,margin:"0 0 5px"}}>⚠ {config.weekendNote.title}</p>
          {config.weekendNote.lines.map((l,i)=><span key={i} style={{fontSize:11,color:"#d97706",...mono,display:"block"}}>· {l}</span>)}
          <p style={{fontSize:11,color:T.accentText,...mono,margin:"6px 0 0"}}>→ {config.weekendNote.rec}</p>
        </div>
      )}

      {/* Cost & API tracker — session paid cost + today's totals + free-tier headroom */}
      {(costN>0||meter.paid>0||meter.scans>0)&&(
        <div style={{...mono,fontSize:10,color:"#64748b",margin:"0 0 8px",textAlign:"right",lineHeight:1.6}}>
          {costN>0&&<div>Session: {costN} paid · €{(costN*EST_COST).toFixed(2)}–€{(costN*EST_COST_HIGH).toFixed(2)} (est.)</div>}
          <div>
            Today: <span style={{color:"#94a3b8"}}>{meter.paid} paid</span> · €{(meter.paid*EST_COST).toFixed(2)}–€{(meter.paid*EST_COST_HIGH).toFixed(2)}
            {" · "}{meter.scans} free scan{meter.scans===1?"":"s"}
            {usesTD&&<span style={{color:meter.td>TD_FREE_DAILY*0.8?"#fb923c":"#475569"}}> · ~{meter.td}/{TD_FREE_DAILY} TD calls</span>}
          </div>
        </div>
      )}

      {/* FREE SCAN result + tier gate verdict (no AI cost) */}
      {scanResult&&!loading&&(()=>{
        const s=scanResult;
        if(!s.ok) return (
          <div style={{...card,background:"#1a1206",border:"1px solid #a16207",marginBottom:10}}>
            <p style={{fontSize:12,fontWeight:700,color:"#fbbf24",margin:"0 0 3px"}}>⚡ Free scan — couldn't compute the tier</p>
            <p style={{fontSize:11,color:"#fde68a",...mono,margin:0,lineHeight:1.5}}>{s.reason||"data unavailable"}. The paid signal is NOT blocked by this (fail-open) — you can still Refresh, or try the scan again.</p>
          </div>
        );
        const pass=s.tier>=TIER_GATE;
        const col=pass?"#4ade80":"#f87171";
        const tierTxt={3:"tier 3 — daily+weekly+1h all confirm (HIGH-eligible)",2:"tier 2 — daily + one other confirm (MEDIUM)",1:"tier 1 — daily only (MEDIUM)",0:"tier 0 — daily does NOT confirm (LOW)"}[s.tier]||`tier ${s.tier}`;
        return (
          <div style={{...card,background:pass?"#04140a":"#160606",border:`2px solid ${col}`,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <p style={{fontSize:13,fontWeight:700,color:col,margin:0}}>⚡ Free scan · {tierTxt}</p>
              <span style={{...mono,fontSize:11,color:col,fontWeight:700}}>{pass?"✓ WORTH A PAID SIGNAL":"✕ BELOW TIER 2 — SKIP"}</span>
            </div>
            <p style={{...mono,fontSize:11,color:"#94a3b8",margin:"6px 0 0",lineHeight:1.5}}>
              1W {s.tW} · 1D {s.tD} · 4h {s.t4} · 1h {s.t1}{s.adx!=null?` · ADX ${s.adx.toFixed(0)}`:""}
              {s.rangeFade?.active?` · ⇄ RANGE-FADE ${s.rangeFade.dir} bias`:""}
            </p>
            <p style={{fontSize:11,color:pass?"#86efac":"#fca5a5",...mono,margin:"6px 0 0",lineHeight:1.5}}>
              {pass
                ? "Hit “Refresh ↗ (paid)” to run the full AI signal — this setup cleared the tier gate."
                : "Paid signal blocked to save your money — tier 0/1 is LOW/negative-expectancy. Re-scan (free) at the next 4h close (00/04/08/12/16/20 UTC) during a good session."}
            </p>
            <p style={{fontSize:9,color:"#475569",margin:"6px 0 0"}}>Computed locally from candles · €0 · no AI call. This is the same tier the paid signal would use.</p>
          </div>
        );
      })()}

      {/* TD-missing warning (fix 2) */}
      {tdWarn&&!loading&&(
        <div style={{...card,background:T.panelBg,border:`1px solid ${T.panelBorder}`,marginBottom:10}}>
          <p style={{fontSize:13,fontWeight:700,color:T.accentText,margin:"0 0 4px"}}>⚠ Twelve Data key missing</p>
          <p style={{fontSize:11,color:"#cbd5e1",margin:"0 0 4px",lineHeight:1.5}}>Without it, MACD / RSI / ATR / EMAs / candle patterns / multi-timeframe analysis are <b>unavailable</b> — the AI infers them instead. Estimated accuracy reduction is significant (no real OHLCV). Price still comes from a free source.</p>
          <div style={{display:"flex",gap:10,marginTop:8}}>
            <button onClick={()=>{setTdWarn(false);setKeysSet(false);}} style={{...primaryBtn,fontSize:11}}>Enter key →</button>
            <button onClick={()=>attemptSignal({ackTD:true})} style={{...ghostBtn,fontSize:11}}>Continue with reduced accuracy →</button>
          </div>
        </div>
      )}

      {/* Pre-check status + blocked cards (free local gate before the paid call) */}
      {precheck&&!loading&&(
        <p style={{...mono,fontSize:10,color:"#475569",margin:"0 0 8px",textAlign:"right"}}>
          Last pre-check: just now — {precheckSummary(precheck)}{precheck.pass?" ✓":""}
        </p>
      )}
      {precheck&&precheck.binary&&!loading&&(
        <BinaryBlockCard result={precheck} config={config} pricePrefix={config.pricePrefix} onOverride={fetchSignal}/>
      )}
      {precheck&&!precheck.pass&&!precheck.binary&&!loading&&(
        <PrecheckCard result={precheck} pricePrefix={config.pricePrefix} onOverride={fetchSignal}/>
      )}

      {/* Key Setup */}
      {!keysSet&&(
        <div style={{...card,marginBottom:12}}>
          <p style={{...lbl,color:T.accentText,marginBottom:12}}>🔑 API Key Setup</p>
          <p style={{fontSize:12,color:"#64748b",margin:"0 0 16px",lineHeight:1.6}}>
            Keys are saved in your browser AND in an encrypted server store gated by your login — enter once, they follow your passcode on any device. They are sent only to the API they belong to.
            {config.dataNote&&<><br/><span style={{color:T.accentText}}>{config.dataNote}</span></>}
          </p>
          {config.keyFields.map(({field,label,hint,ph})=>(
            <div key={field} style={{marginBottom:12}}>
              <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>
                {label} <span style={{color:field==="anthropic"?"#f87171":"#4ade80"}}>({hint})</span>
              </label>
              <input type="password" placeholder={ph} value={tmpKeys[field]||""}
                onChange={e=>setTmpKeys(k=>({...k,[field]:e.target.value}))} style={inputStyle}/>
            </div>
          ))}
          <button disabled={!tmpKeys.anthropic} onClick={()=>{ saveKeys(tmpKeys); setKeys(tmpKeys); setKeysSet(true); }}
            style={{...primaryBtn,width:"100%",textAlign:"center",opacity:tmpKeys.anthropic?1:0.5,marginTop:4}}>
            Save Keys & Continue ↗
          </button>
        </div>
      )}

      {/* Ready */}
      {keysSet&&!sig&&!loading&&!error&&!tdWarn&&!(precheck&&!precheck.pass)&&(
        <div style={{...card,textAlign:"center",padding:"2.5rem 1.5rem"}}>
          <p style={{...mono,fontSize:13,color:"#64748b",margin:"0 0 8px"}}>{config.name} ready</p>
          {config.readyLines(keys).map((l,i)=><p key={i} style={{fontSize:11,color:"#475569",margin:"0 0 4px"}}>{l}</p>)}
          <button onClick={attemptSignal} style={{...primaryBtn,marginTop:12}}>Run Analysis ↗</button>
        </div>
      )}

      {/* Loading */}
      {loading&&(
        <div style={{...card,marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:14,paddingTop:8}}>
            {[0,1,2,3].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:T.loader,animation:`bounce 1.4s ease-in-out ${i*0.22}s infinite`}}/>)}
          </div>
          <p style={{...mono,fontSize:12,color:"#64748b",textAlign:"center",margin:"0 0 10px"}}>{dataLog.slice(-1)[0]?.replace(/^\[.*?\] /,"")||"Initializing..."}</p>
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
          <button onClick={attemptSignal} style={{...primaryBtn,fontSize:11}}>Retry ↗</button>
        </div>
      )}

      {/* Signal */}
      {sig&&!loading&&(<>

        {/* Elevated / extreme volatility (current 1h true-range vs ATR20) */}
        {nfpAsset && sig._volRatio>=2 && (
          <div style={{...card,background:"#1a0505",border:"1px solid #dc2626",marginBottom:10}}>
            <p style={{fontSize:12,fontWeight:700,color:"#f87171",margin:"0 0 3px"}}>🚨 EXTREME VOLATILITY <span style={{...mono,fontWeight:400,fontSize:10,color:"#94a3b8"}}>(range {Math.round(sig._volRatio*100)}% of normal)</span></p>
            <p style={{fontSize:11,color:"#fca5a5",...mono,margin:0,lineHeight:1.5}}>Consider waiting 30 minutes for the market to stabilize before entering.</p>
          </div>
        )}
        {nfpAsset && sig._volRatio>=1.5 && sig._volRatio<2 && (
          <div style={{...card,background:"#1f1206",border:"1px solid #ea580c",marginBottom:10}}>
            <p style={{fontSize:12,fontWeight:700,color:"#fb923c",margin:"0 0 3px"}}>⚠️ ELEVATED VOLATILITY <span style={{...mono,fontWeight:400,fontSize:10,color:"#94a3b8"}}>(range {Math.round(sig._volRatio*100)}% of normal)</span></p>
            <p style={{fontSize:11,color:"#fdba74",...mono,margin:0,lineHeight:1.5}}>Spreads may be wider than normal. Add 0.3–0.5 pips to all targets. Use early-warning exit levels.</p>
          </div>
        )}

        {/* Hero */}
        <div style={{...card,marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{background:as.bg,color:as.fg,border:`1px solid ${as.border}`,padding:"12px 18px",borderRadius:10,...mono,fontSize:20,fontWeight:700,letterSpacing:"0.1em",minWidth:95,textAlign:"center"}}>{sig.action}</div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                <span style={{...mono,fontSize:26,lineHeight:1,color:"#f1f5f9"}}>{config.pricePrefix}{fmt(sig.price)}</span>
                <span style={{fontSize:11,color:"#475569"}}>{config.symbol}</span>
              </div>
              <div style={{display:"flex",gap:8,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{...mono,fontSize:11,color:qCol(liveSession?.quality||sig.session_quality),padding:"2px 7px",background:"#1e293b",border:"1px solid #334155",borderRadius:6}}>{liveSession?.label||sig.session}{(liveSession?.quality||sig.session_quality)?` · ${liveSession?.quality||sig.session_quality}`:""}</span>
                {sig.passes!==undefined&&(()=>{const need=Math.ceil(config.passesOf*0.6);return <span style={{...mono,fontSize:11,color:sig.passes>=need?"#4ade80":sig.passes>=need-1?"#fbbf24":"#f87171"}}>{sig.passes}/{config.passesOf} confirmed</span>;})()}
                {sig.signal_quality&&<span style={{...mono,fontSize:11,color:T.accentText,padding:"2px 7px",background:"#1e293b",border:"1px solid #334155",borderRadius:6}}>Q {sig.signal_quality}</span>}
                {/* Section 3: per-asset Volatility Meter (4h ATR vs THIS asset's own 20-bar baseline) */}
                {sig._vmeter&&(()=>{const v=sig._vmeter;const c=v.level==="LOW"?"#94a3b8":v.level==="NORMAL"?"#4ade80":v.level==="HIGH"?"#fb923c":"#f87171";return <span title="current 4h volatility vs this asset's own normal" style={{...mono,fontSize:11,color:c,padding:"2px 7px",background:"#1e293b",border:`1px solid ${v.level==="EXTREME"?"#dc2626":"#334155"}`,borderRadius:6}}>📊 Vol {v.pct}% · {v.level}</span>;})()}
                {sig.action==="WAIT"&&sig.wait_type&&sig.wait_type!=="none"&&<span style={{...mono,fontSize:11,fontWeight:600,color:waitTypeMeta(sig.wait_type).col}}>{waitTypeMeta(sig.wait_type).label}</span>}
                {/* Regime chip (gold/GBP only — spec §5: show the classification so a
                    direction change between refreshes is explained, not just observed). */}
                {sig._regime&&sig._regime!=="NORMAL"&&(()=>{const r=sig._regime==="RANGE";return <span title={r?"Range regime: low ADX + daily does not confirm. Mean-reversion (fade) bias is active on Gold/GBP.":"Trend regime: daily confirms 4h + strong ADX. Normal with-trend logic."} style={{...mono,fontSize:11,fontWeight:600,color:r?"#c084fc":"#38bdf8",padding:"2px 7px",background:"#1e293b",border:`1px solid ${r?"#7e22ce":"#334155"}`,borderRadius:6}}>{r?"⇄ RANGE":"➤ TREND"}</span>;})()}
                {(sig._sources||[]).map(s=><span key={s} style={{...mono,fontSize:10,color:"#4ade80"}}>✓ {s}</span>)}
              </div>
            </div>
            <div style={{textAlign:"right",maxWidth:190}}>
              <p style={{fontSize:10,color:"#475569",margin:"0 0 2px",letterSpacing:"0.07em"}}>CONFIDENCE</p>
              <p style={{...mono,fontSize:16,margin:0,color:cCol(sig.confidence)}}>{sig.confidence}</p>
              {/* Higher-timeframe tier — the strongest measured predictor in the engine,
                  so it belongs beside the confidence label, not buried below the fold. */}
              {sig._htfTier!=null&&(()=>{
                const m={3:{t:"daily+weekly+1h",a:"53-57%",c:"#4ade80"},2:{t:"daily +1 other",a:"52-55%",c:"#a3e635"},
                         1:{t:"daily only",a:"52-56%",c:"#fbbf24"},0:{t:"daily does NOT confirm",a:"38-45%",c:"#f87171"}}[sig._htfTier];
                return <p title="Higher-timeframe tier and the directional accuracy it delivered historically across gold/GBP/BTC. Historical, not a forecast." style={{...mono,fontSize:10,margin:"3px 0 0",color:m.c,lineHeight:1.35}}>tier {sig._htfTier}/3 · {m.t}<br/><span style={{color:"#64748b"}}>~{m.a} historically</span></p>;
              })()}
              {/* Why this label — otherwise the user has to guess which rule fired */}
              {sig._confReason&&<p style={{fontSize:9,color:"#475569",margin:"4px 0 0",lineHeight:1.35}}>{sig._confFromModel?"set by":"capped by"} {sig._confReason}</p>}
            </div>
          </div>
          {sig.binary_event&&sig.binary_event!=="none"&&sig.binary_event!==""&&(()=>{const uc=urgencyCol(events[0]?.days);return(
            <div style={{marginTop:8,padding:"6px 10px",background:T.panelBg,borderRadius:8,border:`1px solid ${uc}`}}>
              <span style={{fontSize:11,color:uc,...mono}}>⚠ Binary event: {sig.binary_event}</span>
            </div>
          );})()}
          {/* Section 4: live raw time debug line — one live clock, computed fresh each tick */}
          <p style={{...mono,fontSize:9,color:"#475569",margin:"8px 0 0",textAlign:"right"}}>
            System time: {egyClockStr(now)} EGY · UTC: {utcClockStr(now)}
          </p>
        </div>

        {/* Section 4 (spec §4): RANGE-FADE banner — visually distinct from every normal
            signal so it is immediately obvious this counter-trend path fired. Only shows
            when the model's action actually opposed the 4h trend inside a range regime. */}
        {sig._rangeFadeFired&&(
          <div style={{...card,background:"#1a0b26",border:"2px solid #a855f7",marginBottom:10}}>
            <p style={{fontSize:13,fontWeight:700,color:"#c084fc",margin:"0 0 4px"}}>
              ⇄ RANGE-FADE ACTIVE — this {sig.action} OPPOSES the 4h {sig._ta?.t4} trend by design
            </p>
            <p style={{fontSize:11,color:"#e9d5ff",...mono,margin:0,lineHeight:1.55}}>
              {config.symbol} mean-reversion logic fired: low ADX + no daily trend + price stretched {sig._rangeFade?.devATR}×ATR from the mean.
              Tested edge <b>+0.13R at ~72-77% win</b> in range regimes (non-overlapping, p&lt;0.05, Gold/GBP only).
              Target is the mean (BB mid, {config.pricePrefix}{fmt(sig._rangeFade?.bbMid?.toFixed(dec))}) — a deliberately small ~{sig._rangeFade?.targetR}R target. Small-win / occasional-full-loss profile; kept at LOW confidence, minimum size.
            </p>
          </div>
        )}

        {/* Section 3c: marginal-setup hero banner (visible regardless of confidence) */}
        <MarginalBanner conditions={sig._marginal}/>

        {/* Section 4: flip/breakout confirmation banner (all assets). A single-candle
            level break isn't tradeable until the next candle confirms. */}
        {sig._flip && (sig._flip.status==="pending"||sig._flip.status==="false_break") && (()=>{
          const fb = sig._flip.status==="false_break";
          return (
            <div style={{...card, background: fb?"#1a0505":"#1f1206", border:`1px solid ${fb?"#dc2626":"#7c2d12"}`, marginBottom:10}}>
              <p style={{fontSize:12,fontWeight:700,color:fb?"#f87171":"#fb923c",margin:"0 0 3px"}}>
                {fb?"🚫 FALSE BREAK":"⏳ UNCONFIRMED FLIP — PENDING"} <span style={{...mono,fontWeight:400,fontSize:10,color:"#94a3b8"}}>({sig._flip.dir}-break of {config.pricePrefix}{fmt(sig._flip.level)})</span>
              </p>
              <p style={{fontSize:11,color:"#fdba74",...mono,margin:0,lineHeight:1.5}}>
                {fb
                  ? "The next candle reclaimed the level — the breakout failed. Don't chase it; the reversal side is favoured until proven otherwise."
                  : "The level broke on the latest candle but isn't confirmed. Treat any breakout entry as LOW/pending until the next candle continues past it — a reclaim would make it a false break."}
              </p>
            </div>
          );
        })()}

        {/* Gold PDH/PDL stop-hunt / liquidity-sweep alert */}
        {sig._sweepNote && (
          <div style={{...card,background:"#1c1408",border:"1px solid #b45309",marginBottom:10}}>
            <p style={{fontSize:12,color:"#fbbf24",...mono,margin:0,lineHeight:1.5}}>{sig._sweepNote}</p>
          </div>
        )}

        {/* LOW-confidence "trade at your own risk" banner */}
        {sig.action!=="WAIT" && sig.confidence==="LOW" && (
          <div style={{...card,background:"#1f1206",border:"1px solid #7c2d12",marginBottom:10}}>
            <p style={{fontSize:12,fontWeight:700,color:"#fb923c",margin:"0 0 3px"}}>⚠️ LOW CONFIDENCE — trade at your own risk</p>
            <p style={{fontSize:11,color:"#fdba74",...mono,margin:0,lineHeight:1.5}}>{sig._mtfConflict?"4h/1h conflict — counter-trend risk. ":""}{sig._dailyConflict?`Daily trend (${sig._ta?.tD}) opposes the 4h/1h direction — historically the weakest setup class (18-26% win rate vs 43-47% when the daily agrees). `:""}This setup has significant risks. Use minimum lot size (0.01) and a tighter stop. Consider paper trading this signal.</p>
          </div>
        )}

        {/* WAIT → watch-for card replaces the entry plan; LONG/SHORT → invalidation card */}
        {sig.action==="WAIT" && <WaitCard sig={sig} pricePrefix={config.pricePrefix}/>}
        {sig.action!=="WAIT" && <InvalidationCard sig={sig} pricePrefix={config.pricePrefix}/>}

        {/* Section 3b: scenario map (primary + alternate branches) — all actions */}
        <ScenarioMap sig={sig} pricePrefix={config.pricePrefix}/>

        {/* Entry + Levels (hidden on WAIT — there is no trade to plan) */}
        {sig.action!=="WAIT" && (<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div style={card}>
            <p style={lbl}>Entry Plan</p>
            {[
              {name:"Entry",    val:`${config.pricePrefix}${fmt(sig.entry)}`, sub:sig.entry_note},
              {name:"Stop",     val:`${config.pricePrefix}${fmt(sig.stop)}`,  sub:[sig.stop_pct?`${sig.stop_pct} · ATR-based`:null,sig.stop_note].filter(Boolean).join(" · ")},
              {name:"Target 1", val:`${config.pricePrefix}${fmt(sig.t1)}`},
              {name:"Target 2", val:`${config.pricePrefix}${fmt(sig.t2)}`},
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
            <p style={lbl}>{config.levelsTitle}</p>
            {config.levels(sig).map(r=>(
              <div key={r.name} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #1e293b"}}>
                <span style={{fontSize:12,color:"#64748b"}}>{r.name}</span>
                <span style={{...mono,fontSize:13,color:"#e2e8f0"}}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>)}

        {/* Section 3d: outcome map (price / € / % of account) — below Entry Plan on LONG/SHORT */}
        {sig.action!=="WAIT" && <OutcomeMap sig={sig} pricePrefix={config.pricePrefix} decimals={dec} assetId={config.id}/>}

        {/* Asset-specific panels (macro / derivatives / rates) */}
        {config.extraPanels(sig)}

        {/* Multi-timeframe TA: quality, pattern alert, MTF table, fib, pullback, entries */}
        <TACards sig={sig} T={T} pricePrefix={config.pricePrefix} decimals={dec} waitBar={config.qualityWaitBar ?? 35}/>

        {/* Scorecard */}
        <div style={{...card,marginBottom:10}}>
          <p style={lbl}>{config.scTitle}</p>
          {config.scRows.map(({key,label})=>{
            const item=sc[key]; if(!item) return null;
            const st=rStyl(item.r);
            return (
              <div key={key} style={{display:"grid",gridTemplateColumns:"170px 76px 1fr",gap:10,alignItems:"center",padding:"5px 0",borderBottom:"1px solid #1e293b"}}>
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
            {(sig.exits||[]).map((e,i)=>(<div key={i} style={{fontSize:11,color:"#64748b",padding:"5px 0",borderBottom:"1px solid #1e293b",lineHeight:1.45}}>→ {e}</div>))}
          </div>
        </div>

        {/* News */}
        <div style={{...card,marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <p style={{...lbl,margin:0}}>News / Macro Catalyst</p>
            <span style={{...mono,fontSize:11,color:sCol(sig.news_sent)}}>● {sig.news_sent}</span>
          </div>
          <p style={{fontSize:12,fontWeight:600,color:"#e2e8f0",margin:"0 0 4px"}}>{sig.news_hl}</p>
          {sig.data_note&&sig.data_note!==""&&<p style={{fontSize:11,color:T.accentText,...mono,margin:"4px 0 0"}}>⚠ {sig.data_note}</p>}
          {(sig.sources||[]).filter(Boolean).length>0&&(
            <div style={{marginTop:6}}>
              {sig.sources.filter(Boolean).map((u,i)=>(
                <a key={i} href={u} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:"#3b82f6",...mono,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.replace(/^https?:\/\//,"").substring(0,60)}</a>
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

        {/* Section 3e: permanent honesty footer — shown on every signal */}
        <div style={{...card,background:"#0b1220",border:"1px solid #1e293b",marginBottom:10}}>
          <p style={{fontSize:10,color:"#64748b",...mono,margin:0,lineHeight:1.6}}>{PERMANENT_FOOTER}</p>
        </div>
      </>)}

      {/* Sessions guide + Binary calendar (always visible) */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div style={card}>
          <p style={lbl}>Best Trading Sessions</p>
          {config.sessionsGuide.map((s,i)=>{const now=inWindow(s.window);return(
            <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"4px 6px",borderBottom:"1px solid #1e293b",background:now?"#0a1f12":"transparent",borderLeft:now?"2px solid #4ade80":"2px solid transparent",borderRadius:now?6:0}}>
              <div style={{flex:1}}>
                <span style={{...mono,fontSize:10,color:now?"#4ade80":"#94a3b8"}}>{now?"● ":""}{s.window} <span style={{color:"#475569"}}>/ {egyptWindow(s.window)}</span></span>
                <p style={{fontSize:10,color:"#475569",margin:"1px 0 0",lineHeight:1.3}}>{now?"NOW · ":""}{s.label}</p>
              </div>
              <span style={{...mono,fontSize:9,color:qCol(s.quality),alignSelf:"center",textTransform:"uppercase"}}>{s.quality}</span>
            </div>
          );})}
        </div>
        <div style={card}>
          <p style={lbl}>Upcoming Binary Events</p>
          {events.length===0&&<p style={{fontSize:11,color:"#475569"}}>None scheduled.</p>}
          {events.map((e,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"4px 0",borderBottom:"1px solid #1e293b"}}>
              <div style={{flex:1}}>
                <span style={{fontSize:11,color:"#cbd5e1"}}>{e.label}{e.approx?" ~":""}</span>
                <p style={{...mono,fontSize:10,color:"#475569",margin:"1px 0 0"}}>{e.ds} · {e.tEgy} EGY</p>
              </div>
              <span style={{...mono,fontSize:10,fontWeight:600,color:urgencyCol(e.days),alignSelf:"center"}}>{e.in}</span>
            </div>
          ))}
          <p style={{fontSize:9,color:"#334155",margin:"6px 0 0",lineHeight:1.4}}>{config.eventsNote} {isLive?"⚡ Live: ForexFactory high-impact feed (exact times).":"Dates auto-estimated — verify official calendar."}</p>
        </div>
      </div>

      {/* Risk rules */}
      <div style={{...card,background:T.panelBg,border:`1px solid ${T.panelBorder}`,marginBottom:"0.9rem"}}>
        <p style={{fontSize:11,fontWeight:700,color:T.accentText,margin:"0 0 5px"}}>Risk rules — always active</p>
        {config.riskRules.map((r,i)=>(<span key={i} style={{fontSize:11,color:"#d97706",...mono,display:"block"}}>· {r}</span>))}
      </div>

      <p style={{fontSize:10,color:"#334155",margin:0,lineHeight:1.5,borderTop:"1px solid #1e293b",paddingTop:"0.75rem"}}>
        PAPER TRADING ONLY — Not financial advice. No system eliminates losses. Verify all data on your own platform before acting.
      </p>
    </div>
    <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:0.4}40%{transform:translateY(-8px);opacity:1}}`}</style>
    </div>
  );
}
