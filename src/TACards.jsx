import { mono, card, lbl } from "./shared";

// New technical-analysis cards (all from locally-computed sig._ta):
// signal quality, candle-pattern alert, multi-timeframe table, Fibonacci,
// pullback meter, and entry options. Renders nothing if no TA was computed.
const trendCol = t => t === "BULL" ? "#4ade80" : t === "BEAR" ? "#f87171" : "#94a3b8";
const sigCol = s => /LONG/.test(s) ? "#4ade80" : /SHORT/.test(s) ? "#f87171" : "#94a3b8";
const volCol = v => v === "HIGH" ? "#4ade80" : v === "LOW" ? "#f87171" : "#94a3b8";
const stateCol = s => s === "SHALLOW" ? "#4ade80" : s === "NORMAL" ? "#fbbf24" : s === "DEEP" ? "#fb923c" : "#f87171";
const qCol = l => l === "VERY HIGH" || l === "HIGH" ? "#4ade80" : l === "MEDIUM" ? "#fbbf24" : "#f87171";
const dirCol = d => d === "bullish" ? "#4ade80" : d === "bearish" ? "#f87171" : "#94a3b8";

export default function TACards({ sig, T, pricePrefix = "", decimals = 2 }) {
  const ta = sig._ta;
  if (!ta) return null;
  const fp = v => v == null ? "—" : pricePrefix + Number(v).toFixed(decimals);
  const q = sig._quality;
  const fl = ta.fib.levels;
  const kp = ta.keyPattern;

  return (
    <>
      {/* Signal Quality */}
      {q && (
        <div style={{ ...card, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <p style={{ ...lbl, margin: 0 }}>Signal Quality</p>
            <span style={{ ...mono, fontSize: 14, fontWeight: 700, color: qCol(q.label) }}>{q.score}/100 · {q.label}</span>
          </div>
          <div style={{ height: 8, background: "#020617", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${q.score}%`, height: "100%", background: qCol(q.label), transition: "width 0.4s" }} />
          </div>
          <p style={{ fontSize: 9, color: "#475569", margin: "6px 0 0" }}>scorecard PASSes ×10 + bonuses (pattern@level +15, MTF aligned +10, high vol +5, ADX&gt;25 +5). &lt;50 = WAIT.</p>
        </div>
      )}

      {/* Candle pattern alert */}
      {kp && (
        <div style={{ ...card, marginBottom: 10, background: T.panelBg, border: `1px solid ${T.panelBorder}` }}>
          <p style={{ ...lbl, margin: "0 0 4px", color: T.accentText }}>⚡ Candle Pattern Alert</p>
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 2px", color: dirCol(kp.dir) }}>
            {kp.name} <span style={{ color: "#64748b", fontWeight: 400 }}>on {kp.tf}</span> — {kp.dir}
          </p>
          <p style={{ ...mono, fontSize: 11, color: "#94a3b8", margin: 0 }}>
            {ta.nearRes ? "at resistance" : ta.nearSup ? "at support" : "mid-range"} · volume {ta.vol1h?.cls || ta.vol4?.cls || "n/a"}
            {ta.vol1h ? ` (${ta.vol1h.ratio.toFixed(1)}×)` : ""}
          </p>
        </div>
      )}

      {/* Multi-timeframe table */}
      <div style={{ ...card, marginBottom: 10 }}>
        <p style={lbl}>Multi-Timeframe Analysis</p>
        <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 1fr 64px 84px", gap: 6, alignItems: "center", fontSize: 10, color: "#475569", paddingBottom: 4, borderBottom: "1px solid #1e293b" }}>
          <span>TF</span><span>TREND</span><span>CANDLE</span><span>VOL</span><span style={{ textAlign: "right" }}>SIGNAL</span>
        </div>
        {ta.mtf.rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "44px 1fr 1fr 64px 84px", gap: 6, alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1e293b" }}>
            <span style={{ ...mono, fontSize: 11, color: "#94a3b8" }}>{r.tf}</span>
            <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: trendCol(r.trend) }}>{r.trend}</span>
            <span style={{ fontSize: 10, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.candle}</span>
            <span style={{ ...mono, fontSize: 10, color: volCol(r.volume) }}>{r.volume}</span>
            <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: sigCol(r.signal), textAlign: "right" }}>{r.signal}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8 }}>
          <span style={{ fontSize: 11, color: "#64748b" }}>OVERALL {ta.mtf.aligned ? "· aligned" : "· not aligned"} · ADX {ta.adx != null ? ta.adx.toFixed(0) : "—"} ({ta.adxClass})</span>
          <span style={{ ...mono, fontSize: 13, fontWeight: 700, color: sigCol(ta.mtf.overall) }}>{ta.mtf.overall} {ta.mtf.overall !== "WAIT" ? "✅" : "⚠"}</span>
        </div>
      </div>

      {/* Fibonacci + Pullback */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div style={card}>
          <p style={lbl}>Fibonacci (4h swing)</p>
          {[["Swing High", ta.fib.high, "#94a3b8"], ["23.6%", fl[0.236], "#64748b"], ["38.2% ★", fl[0.382], "#fbbf24"],
          ["50.0%", fl[0.5], "#64748b"], ["61.8% ★", fl[0.618], "#fbbf24"], ["78.6%", fl[0.786], "#64748b"], ["Swing Low", ta.fib.low, "#94a3b8"]].map(([n, v, c]) => (
            <div key={n} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #1e293b" }}>
              <span style={{ fontSize: 11, color: c }}>{n}</span>
              <span style={{ ...mono, fontSize: 12, color: "#e2e8f0" }}>{fp(v)}</span>
            </div>
          ))}
          <p style={{ fontSize: 10, color: "#64748b", margin: "6px 0 0" }}>price {ta.fib.position}{ta.fib.atLevel ? ` — AT ${ta.fib.atLevel}` : ""}</p>
        </div>
        <div style={card}>
          <p style={lbl}>Pullback Meter</p>
          {ta.pull ? (<>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ ...mono, fontSize: 18, fontWeight: 700, color: stateCol(ta.pull.state) }}>{ta.pull.pct.toFixed(0)}%</span>
              <span style={{ ...mono, fontSize: 11, color: stateCol(ta.pull.state), alignSelf: "flex-end" }}>{ta.pull.state}</span>
            </div>
            <div style={{ height: 10, background: "#020617", borderRadius: 6, overflow: "hidden", position: "relative" }}>
              <div style={{ width: `${Math.min(100, ta.pull.pct)}%`, height: "100%", background: stateCol(ta.pull.state), transition: "width 0.4s" }} />
            </div>
            <p style={{ fontSize: 10, color: "#475569", margin: "8px 0 0", lineHeight: 1.5 }}>
              {ta.pull.dir}-move retrace. {ta.pull.state === "SHALLOW" ? "Normal pullback — hold." : ta.pull.state === "NORMAL" ? "Watch closely." : ta.pull.state === "DEEP" ? "Reversal risk." : "EXIT — reversal likely."}
            </p>
          </>) : <p style={{ fontSize: 11, color: "#475569" }}>No clear swing on 1h.</p>}
        </div>
      </div>

      {/* Entry options */}
      {ta.entries && (
        <div style={{ ...card, marginBottom: 10 }}>
          <p style={lbl}>Entry Options <span style={{ color: T.accentText, fontSize: 9 }}>· recommended: {ta.entries.recommended}</span></p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {[["Optimal", fp(ta.entries.optimal), "fib 38.2%"], ["Pattern", ta.entries.pattern ? fp(ta.entries.pattern) : "—", "pattern close"],
            ["Aggressive", fp(ta.entries.aggressive), "current"], ["Conservative", "wait", "15m confirm"]].map(([n, v, sub]) => {
              const rec = ta.entries.recommended.toLowerCase().startsWith(n.toLowerCase());
              return (
                <div key={n} style={{ padding: "6px 8px", borderRadius: 8, background: rec ? T.panelBg : "#020617", border: `1px solid ${rec ? T.accent : "#1e293b"}` }}>
                  <p style={{ fontSize: 9, color: rec ? T.accentText : "#64748b", margin: "0 0 2px", textTransform: "uppercase" }}>{n}</p>
                  <p style={{ ...mono, fontSize: 12, color: "#e2e8f0", margin: 0 }}>{v}</p>
                  <p style={{ fontSize: 8, color: "#475569", margin: "1px 0 0" }}>{sub}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
