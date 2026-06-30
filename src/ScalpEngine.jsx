import { useState, useCallback, useRef } from "react";
import {
  mono, card, lbl, fmt, inputStyle, aStyl, cCol, qCol,
  parseJSON, runAI, tdFetch, getFxSession, upcomingEvents,
  toEgypt12, egyptWindow, loadKeys, saveKeys,
  bumpSignalCount, signalCount,
} from "./shared";
import { analyzeScalp, SCALP_SYSTEM, eur001, eur005 } from "./scalp";

const T = { accent: "#3b82f6", accentText: "#60a5fa", panelBg: "#0c1a3a", panelBorder: "#1e3a8a", loader: "#3b82f6" };

// In-memory state (not localStorage), persists for the app session.
let SCALP_LOG = [];
const todayKey = () => new Date().toISOString().slice(0, 10);
const dailyCount = () => { try { return parseInt(sessionStorage.getItem("sdg_scalp_" + todayKey())) || 0; } catch (_) { return 0; } };
const bumpDaily = () => { try { const n = dailyCount() + 1; sessionStorage.setItem("sdg_scalp_" + todayKey(), String(n)); return n; } catch (_) { return 0; } };
const lastRefresh = () => { try { return parseInt(sessionStorage.getItem("sdg_scalp_last")) || 0; } catch (_) { return 0; } };
const setLast = () => { try { sessionStorage.setItem("sdg_scalp_last", String(Date.now())); } catch (_) {} };

const f5 = v => (v == null) ? "—" : (typeof v === "number" ? v.toFixed(5) : v);
const ok = b => b ? "✅" : "❌";

export default function ScalpEngine({ onBack, toggle }) {
  const [keys, setKeys] = useState(loadKeys);
  const [tmpKeys, setTmpKeys] = useState(loadKeys);
  const [keysSet, setKeysSet] = useState(() => !!loadKeys().anthropic);
  const [sig, setSig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ts, setTs] = useState(null);
  const [dataLog, setDataLog] = useState([]);
  const [precheck, setPrecheck] = useState(null);
  const [, setLogV] = useState(0);
  const logRef = useRef([]);
  const addLog = m => { logRef.current = [...logRef.current, `[${new Date().toLocaleTimeString()}] ${m}`]; setDataLog([...logRef.current]); };

  const session = getFxSession();
  const events = upcomingEvents(["ECB", "FOMC", "CPI", "NFP", "EUCPI"]);

  const scalpPrecheck = () => {
    const now = Date.now(), h = new Date().getUTCHours();
    const sessOk = h >= 8 && h < 20;
    const soon = events.find(e => e.date && (e.date - now) > 0 && (e.date - now) <= 2 * 3600000);
    const since = lastRefresh() ? now - lastRefresh() : Infinity;
    const daily = dailyCount();
    const checks = [
      { name: "Session", ok: sessOk, detail: sessOk ? `${session.label} — scalp window` : "Outside 08:00–20:00 UTC — no scalping in Asian session" },
      { name: "Binary event", ok: !soon, detail: soon ? `${soon.label} ${soon.in} (${soon.tEgy} EGY) — spreads too wide for scalp` : "none within 2h" },
      { name: "Min interval", ok: since >= 15 * 60000, detail: since >= 15 * 60000 ? (lastRefresh() ? `${Math.round(since / 60000)}m since last` : "first scalp") : `only ${Math.round(since / 60000)}m — wait ${15 - Math.round(since / 60000)}m` },
      { name: "Daily limit", ok: daily < 5, detail: daily < 5 ? `${daily}/5 scalps today` : "5/5 reached — protect your gains and stop for today" },
    ];
    return { pass: checks.every(c => c.ok), checks, binary: soon || null, daily };
  };

  const tdc = async (interval, n) => {
    const d = await tdFetch(`https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=${interval}&outputsize=${n}&apikey=${keys.td}`, addLog);
    if (d?.status === "error") throw new Error(`Twelve Data: ${d.message}`);
    const v = (d?.values || []).reverse();
    return { times: v.map(x => x.datetime), opens: v.map(x => +x.open), closes: v.map(x => +x.close), highs: v.map(x => +x.high), lows: v.map(x => +x.low), volumes: v.map(x => +x.volume || 0) };
  };

  const runScalp = useCallback(async () => {
    setPrecheck(null); setLoading(true); setError(null); logRef.current = []; setDataLog([]);
    try {
      addLog("Fetching 1m/5m/15m/1h candles in parallel...");
      const settled = await Promise.allSettled([tdc("1min", 60), tdc("5min", 60), tdc("15min", 60), tdc("1h", 50)]);
      const [c1m, c5m, c15m, c1h] = settled.map(r => r.status === "fulfilled" ? r.value : null);
      settled.forEach((r, i) => { if (r.status === "rejected") addLog(`${["1m", "5m", "15m", "1h"][i]} failed: ${r.reason?.message || r.reason}`); });
      if (!c5m || !c15m || !c1h) throw new Error("Missing 5m/15m/1h candles — cannot scalp.");
      const price = c5m.closes.at(-1);
      const s = analyzeScalp({ c1m, c5m, c15m, c1h, price });
      addLog(`Scalp: ${s.dir} ${s.met}/6 · quality ${s.quality} · ATR ${s.atrPips}p · EMA bias ${s.emaBias}`);

      addLog("AI news + spread check (max 2 searches)...");
      const pkg = `EUR/USD scalp news check. Price ${price.toFixed(5)}, session ${session.label}. Proposed scalp: ${s.dir} (${s.met}/6, quality ${s.quality}). Check ONLY for news in the next/last 2h that could spike EUR/USD >20 pips, and whether the spread is normal. Return the JSON.`;
      let news = { news_risk: "LOW", news_note: "", spread_warning: false, override_wait: false, override_reason: "", sources: [] };
      try { const txt = await runAI({ apiKey: keys.anthropic, system: SCALP_SYSTEM, userContent: pkg, addLog, maxTokens: 1200, maxSearches: 2 }); const p = parseJSON(txt); if (p) news = { ...news, ...p }; }
      catch (e) { addLog(`AI news check failed: ${e.message} — proceeding on technicals`); }

      bumpSignalCount(); bumpDaily(); setLast();

      let action = s.dir, waitReason = "";
      if (s.dir === "WAIT") waitReason = s.tooQuiet ? "Market too quiet — ATR below 3 pips, no scalp opportunity" : s.tooVolatile ? "Too volatile — stop would exceed 20 pips" : `Only ${Math.max(s.longConds.filter(Boolean).length, s.shortConds.filter(Boolean).length)}/6 conditions met`;
      if (news.override_wait) { action = "WAIT"; waitReason = news.override_reason || "High news risk within 2h"; }

      const out = {
        action, _s: s, price: price.toFixed(5),
        entry: s.entry ? f5(s.entry) : f5(price), stop: f5(s.stop), t1: f5(s.t1), t2: f5(s.t2),
        stop_pips: s.stopPips, t1_pips: s.t1Pips, t2_pips: s.t2Pips,
        quality: s.quality, qLabel: s.qLabel, lotRec: s.lotRec,
        confidence: s.quality >= 80 ? "HIGH" : s.quality >= 65 ? "MEDIUM" : "LOW",
        session: session.label, session_quality: session.quality,
        spread_warning: news.spread_warning || session.quality === "avoid",
        news_risk: news.news_risk || "LOW", news_note: news.news_note || "", sources: news.sources || [],
        waitReason, hold_time: "15–45 min (2h max)",
      };
      addLog("Scalp signal complete.");
      setSig(out); setTs(new Date());
      if (action !== "WAIT" && s.entry) { SCALP_LOG.unshift({ id: Date.now(), time: new Date(), dir: action, stop_pips: s.stopPips, t1_pips: s.t1Pips, t2_pips: s.t2Pips, result: null, pips: null }); setLogV(v => v + 1); }
    } catch (e) { setError(e.message || "Unknown error"); addLog(`ERROR: ${e.message}`); }
    finally { setLoading(false); }
  }, [keys, session, events]);

  const attemptScalp = (opts = {}) => {
    if (!keys.anthropic) { setError("Anthropic API key required."); setKeysSet(false); return; }
    if (!keys.td) { setError("Twelve Data key required for scalp mode (needs 1m/5m candles)."); setKeysSet(false); return; }
    const pc = scalpPrecheck();
    if (!pc.pass && !opts.force) { setPrecheck(pc); return; }
    runScalp();
  };

  const markResult = (id, kind) => {
    SCALP_LOG = SCALP_LOG.map(t => t.id === id ? { ...t, result: kind, pips: kind === "T1" ? t.t1_pips : kind === "T2" ? t.t2_pips : kind === "Stop" ? -t.stop_pips : 0 } : t);
    setLogV(v => v + 1);
  };
  const today = SCALP_LOG.filter(t => t.time.toISOString().slice(0, 10) === todayKey());
  const resolved = today.filter(t => t.result);
  const totPips = resolved.reduce((a, t) => a + (t.pips || 0), 0);
  const wins = resolved.filter(t => (t.pips || 0) > 0).length, losses = resolved.filter(t => (t.pips || 0) < 0).length;

  const s = sig?._s;
  const as = sig ? aStyl(sig.action) : {};
  const primaryBtn = { padding: "8px 18px", background: "#1e293b", border: `1px solid ${T.accent}`, borderRadius: 8, color: T.accentText, fontSize: 12, cursor: "pointer", ...mono };
  const ghostBtn = { padding: "6px 10px", background: "transparent", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", fontSize: 11, cursor: "pointer", ...mono };
  const Row = ({ k, v, good }) => (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 26px", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
      <span style={{ fontSize: 11, color: "#64748b" }}>{k}</span>
      <span style={{ ...mono, fontSize: 11, color: "#cbd5e1" }}>{v}</span>
      <span style={{ textAlign: "center" }}>{good == null ? "" : ok(good)}</span>
    </div>
  );

  return (
    <div style={{ background: "#020617", minHeight: "100vh", color: "#e2e8f0", padding: "1rem", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ maxWidth: 660, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem", paddingBottom: "0.75rem", borderBottom: "1px solid #1e293b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={onBack} style={ghostBtn}>← Assets</button>
            <div><span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.06em", color: T.accentText }}>⚡ SCALP · EUR/USD</span>
              <span style={{ ...mono, fontSize: 11, color: "#475569", marginLeft: 8 }}>1m/5m/15m · fast</span></div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {ts && <span style={{ ...mono, fontSize: 11, color: "#475569" }}>{ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            {keysSet && <button onClick={() => attemptScalp()} disabled={loading} style={primaryBtn}>{loading ? "Scanning..." : "Scan ⚡"}</button>}
            <button onClick={() => setKeysSet(false)} style={ghostBtn}>⚙ Keys</button>
          </div>
        </div>

        {toggle}

        <p style={{ ...mono, fontSize: 10, color: "#64748b", margin: "0 0 8px", textAlign: "right" }}>
          ~€0.10/scalp · {dailyCount()}/5 today · session: {signalCount()} signals
        </p>

        {/* Keys */}
        {!keysSet && (
          <div style={{ ...card, marginBottom: 12 }}>
            <p style={{ ...lbl, color: T.accentText, marginBottom: 12 }}>🔑 Keys (Anthropic + Twelve Data required)</p>
            {[{ f: "anthropic", l: "Anthropic API Key", p: "sk-ant-..." }, { f: "td", l: "Twelve Data Key (needs 1m/5m)", p: "a1b2..." }].map(({ f, l, p }) => (
              <div key={f} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 5 }}>{l}</label>
                <input type="password" placeholder={p} value={tmpKeys[f] || ""} onChange={e => setTmpKeys(k => ({ ...k, [f]: e.target.value }))} style={inputStyle} />
              </div>
            ))}
            <button disabled={!tmpKeys.anthropic} onClick={() => { saveKeys(tmpKeys); setKeys(tmpKeys); setKeysSet(true); }} style={{ ...primaryBtn, width: "100%", textAlign: "center", opacity: tmpKeys.anthropic ? 1 : 0.5 }}>Save & Continue ↗</button>
          </div>
        )}

        {/* Pre-check block */}
        {precheck && !precheck.pass && !loading && (
          <div style={{ ...card, background: T.panelBg, border: `1px solid ${T.panelBorder}`, marginBottom: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: T.accentText, margin: "0 0 6px" }}>{precheck.binary ? "⏳ Scalp unavailable — binary event" : "⏳ Scalp conditions not met"}</p>
            {precheck.checks.map(c => (
              <div key={c.name} style={{ display: "grid", gridTemplateColumns: "18px 110px 1fr", gap: 8, padding: "3px 0", borderBottom: "1px solid #1e293b" }}>
                <span style={{ textAlign: "center", color: c.ok ? "#4ade80" : "#f87171" }}>{c.ok ? "✓" : "✗"}</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{c.name}</span>
                <span style={{ fontSize: 11, color: c.ok ? "#475569" : "#fca5a5" }}>{c.detail}</span>
              </div>
            ))}
            <button onClick={() => { setPrecheck(null); runScalp(); }} style={{ ...primaryBtn, fontSize: 11, marginTop: 10 }}>Scan anyway →</button>
          </div>
        )}

        {/* Ready */}
        {keysSet && !sig && !loading && !error && !(precheck && !precheck.pass) && (
          <div style={{ ...card, textAlign: "center", padding: "2.5rem 1.5rem" }}>
            <p style={{ ...mono, fontSize: 13, color: "#64748b", margin: "0 0 6px" }}>⚡ Scalp mode ready</p>
            <p style={{ fontSize: 11, color: "#475569", margin: "0 0 14px" }}>10–50 pip moves · 15min–2h holds · London/US sessions only</p>
            <button onClick={() => attemptScalp()} style={primaryBtn}>Scan for scalp ⚡</button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ ...card, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 12, paddingTop: 6 }}>
              {[0, 1, 2, 3].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: T.loader, animation: `bounce 1.4s ease-in-out ${i * 0.22}s infinite` }} />)}
            </div>
            <p style={{ ...mono, fontSize: 12, color: "#64748b", textAlign: "center", margin: 0 }}>{dataLog.slice(-1)[0]?.replace(/^\[.*?\] /, "") || "..."}</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div style={{ ...card, background: "#1a0505", border: "1px solid #7f1d1d", marginBottom: 10 }}>
            <p style={{ fontWeight: 600, fontSize: 13, color: "#f87171", margin: "0 0 4px" }}>Error</p>
            <p style={{ fontSize: 12, color: "#fca5a5", margin: "0 0 8px" }}>{error}</p>
            <button onClick={() => attemptScalp()} style={{ ...primaryBtn, fontSize: 11 }}>Retry ↗</button>
          </div>
        )}

        {/* Signal */}
        {sig && !loading && s && (<>
          {/* Hero */}
          <div style={{ ...card, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ background: as.bg, color: as.fg, border: `1px solid ${as.border}`, padding: "14px 20px", borderRadius: 10, ...mono, fontSize: 22, fontWeight: 700, letterSpacing: "0.1em", minWidth: 100, textAlign: "center" }}>{sig.action}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ ...mono, fontSize: 24, color: "#f1f5f9" }}>{sig.price}</span>
                  <span style={{ fontSize: 11, color: "#475569" }}>EUR/USD</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ ...mono, fontSize: 11, color: qCol(sig.session_quality), padding: "2px 7px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}>{sig.session} · {toEgypt12(new Date().getUTCHours(), new Date().getUTCMinutes())} EGY</span>
                  <span style={{ ...mono, fontSize: 11, color: sig._s.met >= 4 ? "#4ade80" : "#f87171" }}>{sig._s.met}/6</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 10, color: "#475569", margin: "0 0 2px" }}>QUALITY</p>
                <p style={{ ...mono, fontSize: 18, margin: 0, color: sig.quality >= 80 ? "#4ade80" : sig.quality >= 65 ? "#fbbf24" : sig.quality >= 50 ? "#fb923c" : "#f87171" }}>{sig.quality}</p>
                <p style={{ ...mono, fontSize: 9, margin: 0, color: "#64748b" }}>{sig.qLabel}</p>
              </div>
            </div>
            {sig.action === "WAIT" && <p style={{ fontSize: 11, color: "#fbbf24", ...mono, margin: "8px 0 0" }}>⏳ {sig.waitReason}</p>}
            {sig.action !== "WAIT" && <p style={{ fontSize: 11, color: T.accentText, ...mono, margin: "8px 0 0" }}>Target exit: {sig.hold_time} · recommended size: {sig.lotRec}</p>}
          </div>

          {/* Entry/levels with €0.01 + €0.05 */}
          {sig.action !== "WAIT" && (
            <div style={{ ...card, marginBottom: 10 }}>
              <p style={lbl}>Entry Plan — pips & euros</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, fontSize: 10, color: "#475569", borderBottom: "1px solid #1e293b", paddingBottom: 4 }}>
                <span>LEVEL</span><span>PRICE</span><span>0.01 lot</span><span>0.05 lot</span>
              </div>
              {[["Entry", sig.entry, "", ""], ["Stop", sig.stop, `${sig.stop_pips}p · €${eur001(sig.stop_pips)}`, `€${eur005(sig.stop_pips)}`],
              ["Target 1", sig.t1, `${sig.t1_pips}p · €${eur001(sig.t1_pips)}`, `€${eur005(sig.t1_pips)}`], ["Target 2", sig.t2, `${sig.t2_pips}p · €${eur001(sig.t2_pips)}`, `€${eur005(sig.t2_pips)}`]].map(r => (
                <div key={r[0]} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, padding: "5px 0", borderBottom: "1px solid #1e293b" }}>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{r[0]}</span>
                  <span style={{ ...mono, fontSize: 11, color: "#e2e8f0" }}>{r[1]}</span>
                  <span style={{ ...mono, fontSize: 10, color: r[0] === "Stop" ? "#f87171" : r[0] === "Entry" ? "#94a3b8" : "#4ade80" }}>{r[2]}</span>
                  <span style={{ ...mono, fontSize: 10, color: r[0] === "Stop" ? "#f87171" : r[0] === "Entry" ? "#94a3b8" : "#4ade80" }}>{r[3]}</span>
                </div>
              ))}
              <p style={{ fontSize: 10, color: "#475569", margin: "6px 0 0" }}>R:R 1:1.5 (T1) / 1:2.5 (T2) · stop = 1.2× ATR(7), clamped 8–20 pips</p>
            </div>
          )}

          {/* Indicators */}
          <div style={{ ...card, marginBottom: 10 }}>
            <p style={lbl}>Scalp Indicators (live)</p>
            <Row k="EMA 8/21 (5m)" v={`8 ${s.ema8above21 ? "above" : "below"} 21${s.emaCrossUp ? " · cross↑" : s.emaCrossDown ? " · cross↓" : ""}`} good={sig.action === "LONG" ? s.ema8above21 : sig.action === "SHORT" ? !s.ema8above21 : null} />
            <Row k="EMA 50 (15m)" v={`price ${s.aboveEma50_15m ? "above" : "below"} · ${f5(s.ema50_15m)}`} good={sig.action === "LONG" ? s.aboveEma50_15m : sig.action === "SHORT" ? s.aboveEma50_15m === false : null} />
            <Row k="RSI 7 (5m)" v={`${s.rsi7?.toFixed(1)} ${s.rsi7 > 70 ? "overbought" : s.rsi7 < 30 ? "oversold" : "neutral"}${s.rsiRising ? " · rising" : " · falling"}`} good={sig.action === "LONG" ? (s.rsi7 >= 30 && s.rsi7 <= 60 && s.rsiRising) : sig.action === "SHORT" ? (s.rsi7 >= 40 && s.rsi7 <= 70 && !s.rsiRising) : null} />
            <Row k="MACD 5/13/4 (5m)" v={s.macd ? `hist ${s.macd.histogram.toFixed(5)} ${s.macd.expanding ? "expanding" : "contracting"} ${s.macd.bullish ? "bull" : "bear"}` : "n/a"} good={s.macd ? (sig.action === "LONG" ? s.macd.expanding && s.macd.bullish : sig.action === "SHORT" ? s.macd.expanding && !s.macd.bullish : null) : null} />
            <Row k="Bollinger (5m)" v={s.bb ? `${s.bb.position} band · width ${s.bb.width.toFixed(2)}%` : "n/a"} good={sig.action === "LONG" ? s.bb?.position === "LOWER" : sig.action === "SHORT" ? s.bb?.position === "UPPER" : null} />
            <Row k="Stochastic 5,3,3" v={s.stoch ? `%K ${s.stoch.K?.toFixed(0)} / %D ${s.stoch.D?.toFixed(0)}${s.stoch.crossUp ? " · cross↑" : s.stoch.crossDown ? " · cross↓" : ""}` : "n/a"} good={sig.action === "LONG" ? !!s.stoch?.crossUp : sig.action === "SHORT" ? !!s.stoch?.crossDown : null} />
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6 }}>
              <span style={{ fontSize: 11, color: "#475569" }}>Conditions met</span>
              <span style={{ ...mono, fontSize: 13, color: s.met >= 4 ? "#4ade80" : "#f87171" }}>{s.met}/6</span>
            </div>
          </div>

          {/* Levels */}
          <div style={{ ...card, marginBottom: 10 }}>
            <p style={lbl}>Scalp Levels</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {[["Daily Pivot", s.pivots?.P], ["R1", s.pivots?.R1], ["R2", s.pivots?.R2], ["S1", s.pivots?.S1], ["S2", s.pivots?.S2], ["Asian High", s.asianHigh], ["Asian Low", s.asianLow], ["BB Upper", s.bb?.upper], ["BB Lower", s.bb?.lower]].map(([n, v]) => (
                <div key={n} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #1e293b" }}>
                  <span style={{ fontSize: 10, color: "#64748b" }}>{n}</span>
                  <span style={{ ...mono, fontSize: 11, color: s.pivotNearest === n || (n === "Asian High" && s.asianPos === "ABOVE") || (n === "Asian Low" && s.asianPos === "BELOW") ? T.accentText : "#e2e8f0" }}>{f5(v)}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 10, color: "#475569", margin: "6px 0 0" }}>Nearest pivot: {s.pivotNearest} · Asian range: price {s.asianPos}</p>
          </div>

          {/* Risk */}
          <div style={{ ...card, marginBottom: 10 }}>
            <p style={lbl}>Scalp Risk</p>
            <Row k="Spread status" v={sig.spread_warning ? "WIDE — caution" : "NORMAL"} good={!sig.spread_warning} />
            <Row k="News risk (2h)" v={`${sig.news_risk}${sig.news_note ? " · " + sig.news_note : ""}`} good={sig.news_risk === "LOW"} />
            <Row k="Session quality" v={`${sig.session} (${sig.session_quality})`} good={sig.session_quality !== "avoid"} />
            <Row k="Volatility ATR(7)" v={`${s.atrPips} pips/candle${s.tooQuiet ? " — too quiet" : s.tooVolatile ? " — too volatile" : ""}`} good={!s.tooQuiet && !s.tooVolatile} />
            <Row k="Recommended size" v={sig.lotRec} good={null} />
          </div>

          {/* Exit rules (always visible in scalp) */}
          <div style={{ ...card, background: T.panelBg, border: `1px solid ${T.panelBorder}`, marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: T.accentText, margin: "0 0 5px" }}>Scalp exit rules</p>
            {["T1 hit → close ALL (scalps don't hold for T2 by default)", "Time exit: close after 2h max", "Spread >2 pips → close immediately", "News spike incoming → close immediately", "Never hold a scalp through a session change"].map((r, i) => (
              <span key={i} style={{ fontSize: 11, color: "#93c5fd", ...mono, display: "block" }}>· {r}</span>
            ))}
          </div>

          {/* News sources */}
          {(sig.sources || []).filter(Boolean).length > 0 && (
            <div style={{ ...card, marginBottom: 10 }}>
              <p style={lbl}>News check sources</p>
              {sig.sources.filter(Boolean).map((u, i) => <a key={i} href={u} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#3b82f6", ...mono, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.replace(/^https?:\/\//, "").slice(0, 60)}</a>)}
            </div>
          )}
        </>)}

        {/* Performance log (always visible) */}
        <div style={{ ...card, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <p style={{ ...lbl, margin: 0 }}>Today's Scalp Log</p>
            <span style={{ ...mono, fontSize: 11, color: totPips > 0 ? "#4ade80" : totPips < 0 ? "#f87171" : "#94a3b8" }}>{totPips > 0 ? "+" : ""}{totPips} pips · €{eur001(totPips)} · {wins}W {losses}L</span>
          </div>
          {today.length === 0 && <p style={{ fontSize: 11, color: "#475569" }}>No scalps yet today.</p>}
          {today.map(t => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
              <span style={{ ...mono, fontSize: 10, color: "#94a3b8" }}>{toEgypt12(t.time.getUTCHours(), t.time.getUTCMinutes())} EGY</span>
              <span style={{ ...mono, fontSize: 10, color: t.dir === "LONG" ? "#4ade80" : "#f87171" }}>{t.dir}</span>
              {t.result
                ? <span style={{ ...mono, fontSize: 10, color: (t.pips || 0) >= 0 ? "#4ade80" : "#f87171" }}>{(t.pips || 0) >= 0 ? "+" : ""}{t.pips}p · €{eur001(t.pips)} · {t.result}</span>
                : <span style={{ display: "flex", gap: 4 }}>{["T1", "T2", "Stop"].map(k => <button key={k} onClick={() => markResult(t.id, k)} style={{ fontSize: 9, padding: "2px 5px", background: "#020617", border: "1px solid #334155", borderRadius: 5, color: "#94a3b8", cursor: "pointer", ...mono }}>{k}</button>)}</span>}
            </div>
          ))}
        </div>

        {/* Data log */}
        {dataLog.length > 0 && (
          <div style={{ ...card, marginBottom: 10, padding: "8px 10px", maxHeight: 120, overflowY: "auto" }}>
            {dataLog.map((l, i) => <div key={i} style={{ ...mono, fontSize: 10, color: "#334155", lineHeight: 1.6 }}>{l}</div>)}
          </div>
        )}

        <p style={{ fontSize: 10, color: "#334155", margin: 0, lineHeight: 1.5, borderTop: "1px solid #1e293b", paddingTop: "0.75rem" }}>
          SCALP / PAPER TRADING ONLY — Not financial advice. Trade-log results are marked manually. Verify spread & price on your platform.
        </p>
      </div>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:0.4}40%{transform:translateY(-8px);opacity:1}}`}</style>
    </div>
  );
}
