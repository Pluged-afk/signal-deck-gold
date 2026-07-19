import { useState } from "react";
import { mono, card, lbl, fmt } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// Section 3 accuracy/risk-transparency cards, shared by all three assets:
//   • MarginalBanner  (3c) — locally-computed hard rule, hero banner
//   • ScenarioMap     (3b) — primary + alternate bullish/bearish branches
//   • OutcomeMap      (3d) — pure local arithmetic, €0 cost
// ═══════════════════════════════════════════════════════════════════════════

const num = v => { const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return isFinite(n) ? n : null; };

// ─── 3c: Marginal setup flag ─────────────────────────────────────────────────
// `conditions` is the pre-computed list of triggered risk factors (2+ = marginal).
export function MarginalBanner({ conditions }) {
  if (!conditions || conditions.length < 2) return null;
  return (
    <div style={{ ...card, background: "#1a0505", border: "2px solid #dc2626", marginBottom: 10 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: "#f87171", margin: "0 0 4px" }}>
        ⚠️ MARGINAL SETUP — {conditions.join(" · ")}
      </p>
      <p style={{ fontSize: 11, color: "#fca5a5", ...mono, margin: 0, lineHeight: 1.5 }}>
        Multiple risk factors are stacked here. A skip is a valid decision. If you do take it, use minimum size and a tight stop.
      </p>
    </div>
  );
}

// ─── 3b: Scenario map (three branches) ───────────────────────────────────────
export function ScenarioMap({ sig, pricePrefix = "" }) {
  const pri = sig.primary_scenario;
  const asAlt = a => (a && typeof a === "object") ? a : (typeof a === "string" ? { trigger: a, confirm: "" } : null);
  const bull = asAlt(sig.alternate_bullish), bear = asAlt(sig.alternate_bearish);
  if (!pri && !bull && !bear) return null;
  const px = v => (v == null || v === "" || v === "n/a") ? null : (/[0-9]/.test(String(v)) && !/[a-z]/i.test(String(v)) ? `${pricePrefix}${fmt(v)}` : fmt(v));
  const Col = ({ title, color, border, children }) => (
    <div style={{ padding: "8px 10px", borderRadius: 8, background: "#020617", border: `1px solid ${border}` }}>
      <p style={{ fontSize: 10, fontWeight: 700, color, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</p>
      {children}
    </div>
  );
  const AltBody = alt => alt ? (<>
    <p style={{ fontSize: 10, color: "#94a3b8", margin: "0 0 2px", lineHeight: 1.4 }}>Trigger: <span style={{ ...mono, color: "#e2e8f0" }}>{px(alt.trigger) || alt.trigger || "—"}</span></p>
    {alt.confirm ? <p style={{ fontSize: 10, color: "#94a3b8", margin: 0, lineHeight: 1.4 }}>Confirm: <span style={{ ...mono, color: "#e2e8f0" }}>{px(alt.confirm) || alt.confirm}</span></p> : null}
  </>) : <p style={{ fontSize: 10, color: "#475569", margin: 0 }}>—</p>;
  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <p style={lbl}>Scenario Map</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <Col title="Primary" color="#e2e8f0" border="#334155">
          <p style={{ fontSize: 10, color: "#cbd5e1", margin: 0, lineHeight: 1.45 }}>{pri || "—"}</p>
        </Col>
        <Col title="🟢 Alt Bullish" color="#4ade80" border="#166534">{AltBody(bull)}</Col>
        <Col title="🔴 Alt Bearish" color="#f87171" border="#7f1d1d">{AltBody(bear)}</Col>
      </div>
      <p style={{ fontSize: 9, color: "#475569", margin: "8px 0 0", lineHeight: 1.5 }}>
        Only one of these will occur — this shows the real branches, not a prediction of which.
      </p>
    </div>
  );
}

// ─── 3d: Outcome map (pure local arithmetic) ─────────────────────────────────
// Win/loss in price, € and % of account, computed from entry/stop/T1/T2 and a
// user-set account size + risk%. Breakeven trigger = 50% of the T1 distance.
export function OutcomeMap({ sig, pricePrefix = "", decimals = 2, assetId }) {
  const [acct, setAcct] = useState(() => { const v = parseFloat(localStorage.getItem("sdg_acct")); return isFinite(v) && v > 0 ? v : 10000; });
  const [riskPct, setRiskPct] = useState(() => { const v = parseFloat(localStorage.getItem("sdg_riskpct")); return isFinite(v) && v > 0 ? v : 1; });
  const setA = v => { setAcct(v); try { localStorage.setItem("sdg_acct", String(v)); } catch (_) {} };
  const setR = v => { setRiskPct(v); try { localStorage.setItem("sdg_riskpct", String(v)); } catch (_) {} };

  const entry = num(sig.entry), stop = num(sig.stop), t1 = num(sig.t1), t2 = num(sig.t2);
  if (entry == null || stop == null) return null;
  const riskDist = Math.abs(entry - stop);
  if (!riskDist) return null;
  const riskEur = acct * riskPct / 100;
  const fp = v => v == null ? "—" : `${pricePrefix}${Number(v).toFixed(decimals)}`;
  const eur = v => (v >= 0 ? "+" : "−") + "€" + Math.abs(v).toFixed(0);
  const pct = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) + "%";

  const winRow = (label, price) => {
    if (price == null) return null;
    const R = Math.abs(price - entry) / riskDist;
    return { label, price, eur: riskEur * R, pct: riskPct * R, r: R };
  };
  const rows = [
    winRow("Win at T1", t1),
    winRow("Win at T2", t2),
    { label: "Loss at stop", price: stop, eur: -riskEur, pct: -riskPct, r: -1 },
  ].filter(Boolean);
  const beTrigger = t1 != null ? entry + (t1 - entry) * 0.5 : null;

  const inp = { width: 78, padding: "3px 6px", background: "#020617", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 11, ...mono, boxSizing: "border-box" };

  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
        <p style={{ ...lbl, margin: 0 }}>Outcome Map</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 9, color: "#475569" }}>Account €<input type="number" value={acct} min={0} onChange={e => setA(parseFloat(e.target.value) || 0)} style={{ ...inp, marginLeft: 4 }} /></label>
          <label style={{ fontSize: 9, color: "#475569" }}>Risk %<input type="number" value={riskPct} min={0} step={0.5} onChange={e => setR(parseFloat(e.target.value) || 0)} style={{ ...inp, width: 52, marginLeft: 4 }} /></label>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 84px 70px 66px", gap: 6, alignItems: "center", fontSize: 10, color: "#475569", paddingBottom: 4, borderBottom: "1px solid #1e293b" }}>
        <span>OUTCOME</span><span style={{ textAlign: "right" }}>PRICE</span><span style={{ textAlign: "right" }}>€ (P/L)</span><span style={{ textAlign: "right" }}>% ACCT</span>
      </div>
      {rows.map(r => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "1fr 84px 70px 66px", gap: 6, alignItems: "center", padding: "5px 0", borderBottom: "1px solid #1e293b" }}>
          <span style={{ fontSize: 11, color: r.eur >= 0 ? "#4ade80" : "#f87171" }}>{r.label}{r.r > 0 ? <span style={{ color: "#475569", fontSize: 9 }}> · {r.r.toFixed(1)}R</span> : null}</span>
          <span style={{ ...mono, fontSize: 12, color: "#e2e8f0", textAlign: "right" }}>{fp(r.price)}</span>
          <span style={{ ...mono, fontSize: 12, color: r.eur >= 0 ? "#4ade80" : "#f87171", textAlign: "right" }}>{eur(r.eur)}</span>
          <span style={{ ...mono, fontSize: 12, color: r.eur >= 0 ? "#4ade80" : "#f87171", textAlign: "right" }}>{pct(r.pct)}</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0" }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>Breakeven trigger <span style={{ color: "#475569", fontSize: 9 }}>(50% to T1 → move stop to entry)</span></span>
        <span style={{ ...mono, fontSize: 12, color: "#fbbf24" }}>{fp(beTrigger)}</span>
      </div>
      <p style={{ fontSize: 9, color: "#475569", margin: "8px 0 0", lineHeight: 1.5 }}>
        Time decay: if no clear move develops, close by session end rather than holding a stalling position.
        {assetId === "us500" ? " US500: € figures assume 1 point = your Pepperstone €/point — confirm it before sizing." : ` € assumes ${riskPct}% risk on a €${Number(acct).toLocaleString()} account; scale with your size.`}
      </p>
    </div>
  );
}
