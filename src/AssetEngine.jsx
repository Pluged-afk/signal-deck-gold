import { useState, useCallback, useRef } from "react";
import {
  mono, card, lbl, fmt, inputStyle,
  aStyl, rStyl, cCol, sCol, qCol,
  parseJSON, runAI, isWeekend, upcomingEvents,
  loadKeys, saveKeys, WAIT_RULES, egyptWindow, urgencyCol, inWindow,
  bumpSignalCount, signalCount, EST_COST, EST_COST_HIGH,
} from "./shared";
import TACards from "./TACards";
import WaitCard, { InvalidationCard, waitTypeMeta } from "./WaitCard";
import { runPreCheck, storeSignalForPrecheck, PrecheckCard, BinaryBlockCard, precheckSummary } from "./precheck";
import { localWait } from "./ta";

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
  const logRef = useRef([]);
  const usesTD = config.keyFields.some(f => f.field === "td");

  const addLog = msg => { logRef.current=[...logRef.current,`[${new Date().toLocaleTimeString()}] ${msg}`]; setDataLog([...logRef.current]); };

  const events = upcomingEvents(config.events);

  const fetchSignal = useCallback(async () => {
    if(!keys.anthropic){ setError("Anthropic API key required."); setKeysSet(false); return; }
    setPrecheck(null); setLoading(true); setError(null); logRef.current=[]; setDataLog([]);
    try{
      const { pkg, price, session, meta } = await config.pipeline({ keys, addLog });

      // HARD GATE (softened): only force WAIT + skip the paid call when ALL THREE
      // timeframes disagree (genuine chop). A plain 4h/1h conflict now still runs
      // and returns as a LOW-confidence signal.
      const ta = meta.ta;
      if(ta && ta.allDisagree){
        addLog(`All timeframes disagree (4h ${ta.t4} / 1h ${ta.t1} / 15m ${ta.t15}) — forcing WAIT, skipping AI call`);
        const parsed = localWait(ta, price, config.pricePrefix===""?5:2);
        config.merge(parsed, meta);
        parsed.session = session.label; parsed.session_quality = session.quality;
        addLog("Signal complete (local WAIT).");
        setSig(parsed); setTs(new Date());
        try{ storeSignalForPrecheck(config.id, parsed, parseFloat(parsed.price)||price); }catch(_){}
        return;
      }

      addLog("Sending to AI for news + synthesis...");
      setCostN(bumpSignalCount()); // count this paid Anthropic call
      const finalText = await runAI({ apiKey:keys.anthropic, system:config.system + WAIT_RULES, userContent:pkg, addLog, maxSearches:5 });
      const parsed = parseJSON(finalText);
      if(!parsed){ addLog(`Parse failed. Raw start: ${(finalText||"").slice(0,120)}`); throw new Error("Could not parse signal JSON. Please retry."); }
      config.merge(parsed, meta);
      parsed.session = session.label;
      parsed.session_quality = session.quality;
      if(!parsed.price && price) parsed.price = String(price);

      // Softened gates: quality <35 forces WAIT; 35-50 OR a 4h/1h conflict still
      // fires but is capped at LOW confidence (trade-at-own-risk).
      if(parsed.action !== "WAIT"){
        if(parsed._quality && parsed._quality.score < 35){
          addLog(`Signal quality ${parsed._quality.score}<35 — forcing WAIT`);
          parsed.action = "WAIT";
          if(!parsed.wait_type || parsed.wait_type === "none") parsed.wait_type = "no_setup";
          if(parsed.triggers && !parsed.triggers.primary_reason) parsed.triggers.primary_reason = `Signal quality ${parsed._quality.score}/100 (below 35)`;
        } else {
          if((parsed._quality && parsed._quality.score < 50) || ta?.mtfConflict){ parsed.confidence = "LOW"; parsed._lowConfWarn = true; }
          if(ta?.mtfConflict){ parsed._mtfConflict = true; addLog(`4h/1h conflict (4h ${ta.t4} / 1h ${ta.t1}) — capping confidence at LOW`); }
        }
      }

      addLog("Signal complete.");
      setSig(parsed); setTs(new Date());
      try{ storeSignalForPrecheck(config.id, parsed, parseFloat(parsed.price)||price); }catch(_){}
    }catch(e){ setError(e.message||"Unknown error"); addLog(`ERROR: ${e.message}`); }
    finally{ setLoading(false); }
  }, [keys, config]);

  // Free local pre-check first; only call the paid signal if all conditions pass.
  const attemptSignal = useCallback(async (opts={}) => {
    if(!keys.anthropic){ setError("Anthropic API key required."); setKeysSet(false); return; }
    // Fix 2: warn before spending if Twelve Data key is missing on a TD-backed asset
    if(usesTD && !keys.td && !opts.ackTD){ setTdWarn(true); setPrecheck(null); return; }
    setTdWarn(false);
    setPrechecking(true); setError(null);
    const res = await runPreCheck({ config, keys, events });
    setPrechecking(false);
    setPrecheck({ ...res, ts:Date.now() });
    if(res.pass) fetchSignal();
  }, [keys, config, events, fetchSignal, usesTD]);

  const as = sig?aStyl(sig.action):{};
  const sc = sig?.scorecard||{};
  const wknd = isWeekend();

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
          {keysSet&&<button onClick={attemptSignal} disabled={loading||prechecking} style={primaryBtn}>{prechecking?"Checking...":loading?"Scanning...":"Refresh ↗"}</button>}
          <button onClick={()=>setKeysSet(false)} style={ghostBtn}>⚙ Keys</button>
        </div>
      </div>

      {headerExtra}

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

      {/* Session cost (fix 3) */}
      {costN>0&&(
        <p style={{...mono,fontSize:10,color:"#64748b",margin:"0 0 8px",textAlign:"right"}}>
          Session: {costN} paid signal{costN>1?"s":""} · €{(costN*EST_COST).toFixed(2)} – €{(costN*EST_COST_HIGH).toFixed(2)} (est.)
        </p>
      )}

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
                <span style={{...mono,fontSize:11,color:qCol(sig.session_quality),padding:"2px 7px",background:"#1e293b",border:"1px solid #334155",borderRadius:6}}>{sig.session}{sig.session_quality?` · ${sig.session_quality}`:""}</span>
                {sig.passes!==undefined&&(()=>{const need=Math.ceil(config.passesOf*0.6);return <span style={{...mono,fontSize:11,color:sig.passes>=need?"#4ade80":sig.passes>=need-1?"#fbbf24":"#f87171"}}>{sig.passes}/{config.passesOf} confirmed</span>;})()}
                {sig.signal_quality&&<span style={{...mono,fontSize:11,color:T.accentText,padding:"2px 7px",background:"#1e293b",border:"1px solid #334155",borderRadius:6}}>Q {sig.signal_quality}</span>}
                {sig.action==="WAIT"&&sig.wait_type&&sig.wait_type!=="none"&&<span style={{...mono,fontSize:11,fontWeight:600,color:waitTypeMeta(sig.wait_type).col}}>{waitTypeMeta(sig.wait_type).label}</span>}
                {(sig._sources||[]).map(s=><span key={s} style={{...mono,fontSize:10,color:"#4ade80"}}>✓ {s}</span>)}
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <p style={{fontSize:10,color:"#475569",margin:"0 0 2px",letterSpacing:"0.07em"}}>CONFIDENCE</p>
              <p style={{...mono,fontSize:16,margin:0,color:cCol(sig.confidence)}}>{sig.confidence}</p>
            </div>
          </div>
          {sig.binary_event&&sig.binary_event!=="none"&&sig.binary_event!==""&&(()=>{const uc=urgencyCol(events[0]?.days);return(
            <div style={{marginTop:8,padding:"6px 10px",background:T.panelBg,borderRadius:8,border:`1px solid ${uc}`}}>
              <span style={{fontSize:11,color:uc,...mono}}>⚠ Binary event: {sig.binary_event}</span>
            </div>
          );})()}
        </div>

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
            <p style={{fontSize:11,color:"#fdba74",...mono,margin:0,lineHeight:1.5}}>{sig._mtfConflict?"4h/1h conflict — counter-trend risk. ":""}This setup has significant risks. Use minimum lot size (0.01) and a tighter stop. Consider paper trading this signal.</p>
          </div>
        )}

        {/* WAIT → watch-for card replaces the entry plan; LONG/SHORT → invalidation card */}
        {sig.action==="WAIT" && <WaitCard sig={sig} pricePrefix={config.pricePrefix}/>}
        {sig.action!=="WAIT" && <InvalidationCard sig={sig} pricePrefix={config.pricePrefix}/>}

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

        {/* Asset-specific panels (macro / derivatives / rates) */}
        {config.extraPanels(sig)}

        {/* Multi-timeframe TA: quality, pattern alert, MTF table, fib, pullback, entries */}
        <TACards sig={sig} T={T} pricePrefix={config.pricePrefix} decimals={config.pricePrefix===""?5:2}/>

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
          <p style={{fontSize:9,color:"#334155",margin:"6px 0 0",lineHeight:1.4}}>{config.eventsNote} Dates auto-estimated — verify official calendar.</p>
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
