import { useState } from "react";
import { mono, card, lbl, fmt, lotSizeFor } from "./shared";

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
export function OutcomeMap({ sig, pricePrefix = "", decimals = 2, assetId, sizeMult = 1 }) {
  const [acct, setAcct] = useState(() => { const v = parseFloat(localStorage.getItem("sdg_acct")); return isFinite(v) && v > 0 ? v : 10000; });
  const [riskPct, setRiskPct] = useState(() => { const v = parseFloat(localStorage.getItem("sdg_riskpct")); return isFinite(v) && v > 0 ? v : 1; });
  const setA = v => { setAcct(v); try { localStorage.setItem("sdg_acct", String(v)); } catch (_) {} };
  const setR = v => { setRiskPct(v); try { localStorage.setItem("sdg_riskpct", String(v)); } catch (_) {} };

  const entry = num(sig.entry), stop = num(sig.stop), t1 = num(sig.t1), t2 = num(sig.t2);
  if (entry == null || stop == null) return null;
  const riskDist = Math.abs(entry - stop);
  if (!riskDist) return null;
  // Conviction-adjusted risk: a LOW-confidence / ranging TRADE risks less (sizeMult<1).
  // effPct is the risk actually used everywhere below so the €, %, and lots all agree.
  const eff = (sizeMult > 0 && sizeMult < 1) ? sizeMult : 1;
  const effPct = riskPct * eff;
  const riskEur = acct * effPct / 100;

  // ── POSITION SIZE (Pepperstone contract specs) ──────────────────────────────
  // The number pros compute BEFORE every trade and retail skips: the exact lot size
  // that makes the loss-at-stop equal your chosen risk %. contractVal = USD P/L per
  // 1.0 price unit per 1.0 lot. lots = riskAmount / (stopDistance × contractVal).
  const ps = lotSizeFor(assetId, riskDist, riskEur) || { lots: 0, units: 0, actualRisk: 0, unit: "units", tooSmall: false };
  const { lots, units, actualRisk, unit: psUnit, tooSmall } = ps;
  const actualPct = acct > 0 ? actualRisk / acct * 100 : 0;
  const highRisk = riskPct > 2;
  const fp = v => v == null ? "—" : `${pricePrefix}${Number(v).toFixed(decimals)}`;
  const eur = v => (v >= 0 ? "+" : "−") + "€" + Math.abs(v).toFixed(0);
  const pct = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) + "%";

  const winRow = (label, price) => {
    if (price == null) return null;
    const R = Math.abs(price - entry) / riskDist;
    return { label, price, eur: riskEur * R, pct: effPct * R, r: R };
  };
  const rows = [
    winRow("Win at T1", t1),
    winRow("Win at T2", t2),
    { label: "Loss at stop", price: stop, eur: -riskEur, pct: -effPct, r: -1 },
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
      {/* Position size — the number to actually enter, so every trade risks the same % */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 8, borderRadius: 8, background: "#04140a", border: "1px solid #166534", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 10, color: "#4ade80", margin: "0 0 2px", letterSpacing: "0.05em", textTransform: "uppercase" }}>Position size — enter this</p>
          <p style={{ ...mono, fontSize: 9, color: "#64748b", margin: 0 }}>target {eff < 1 ? `${effPct.toFixed(2)}% (${riskPct}% × ${Math.round(eff * 100)}% conviction)` : `${riskPct}%`} of €{Number(acct).toLocaleString()} · stop {riskDist.toFixed(decimals)}{assetId === "gbp" ? ` (${Math.round(riskDist * 10000)} pips)` : ""}{!tooSmall ? ` · actually risks €${actualRisk.toFixed(0)} (${actualPct.toFixed(2)}%)` : ""}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ ...mono, fontSize: 18, fontWeight: 700, color: tooSmall ? "#f87171" : "#4ade80", margin: 0 }}>{tooSmall ? "< 0.01 lot" : `${lots.toFixed(2)} lots`}</p>
          {!tooSmall && <p style={{ ...mono, fontSize: 9, color: "#64748b", margin: "2px 0 0" }}>= {units.toLocaleString(undefined, { maximumFractionDigits: psUnit === "BTC" ? 3 : 0 })} {psUnit}</p>}
        </div>
      </div>
      {tooSmall && <p style={{ fontSize: 10, color: "#fca5a5", ...mono, margin: "-4px 0 8px", lineHeight: 1.5 }}>⚠ Your {effPct.toFixed(2)}% risk (€{riskEur.toFixed(0)}) is below the 0.01-lot minimum for this stop distance. Either widen the account, raise risk% (carefully), or skip — do NOT force an oversized 0.01 lot, it would risk more than {effPct.toFixed(2)}%.</p>}
      {highRisk && !tooSmall && <p style={{ fontSize: 10, color: "#fbbf24", ...mono, margin: "-4px 0 8px", lineHeight: 1.5 }}>⚠ {riskPct}% per trade is aggressive — a normal losing streak (6-8 in a row happens) would cut the account hard. Pros risk 1-2%.</p>}

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
        Lot size uses Pepperstone contract specs ({assetId === "gold" ? "1 lot = 100 oz" : assetId === "gbp" ? "1 lot = 100k, 1 pip = $10" : assetId === "btc" ? "1 lot = 1 BTC" : "standard"}) and assumes ≈1:1 €/$ — a € account risks ~8% more in $ terms, so confirm the exact lot in your broker's calculator before entering. Time decay: if no clear move develops, close by session end rather than holding a stalling position.
      </p>
    </div>
  );
}

// ─── Trade Plan — the clean, labelled "order ticket": entry / stop / T1 / T2 with
// prices, R-multiples and what to do at each. Only for actionable signals. Pulls the
// size from the same lotSizeFor helper + the stored account/risk so it agrees with the
// Outcome Map. Deliberately labelled and explicit — not a one-liner. ────────────────
export function TradePlan({ sig, pricePrefix = "", decimals = 2, assetId, sizeMult = 1 }) {
  if (!sig || sig.action === "WAIT") return null;
  const entry = num(sig.entry), stop = num(sig.stop), t1 = num(sig.t1), t2 = num(sig.t2);
  if (entry == null || stop == null) return null;
  const risk = Math.abs(entry - stop) || 1e-9;
  const dir = sig.action === "SHORT" ? -1 : 1;
  const rMul = p => p == null ? null : ((p - entry) * dir) / risk;
  const fp = v => v == null ? "—" : `${pricePrefix}${Number(v).toFixed(decimals)}`;
  const acct = (() => { try { const v = parseFloat(localStorage.getItem("sdg_acct")); return isFinite(v) && v > 0 ? v : 10000; } catch (_) { return 10000; } })();
  const riskPct = (() => { try { const v = parseFloat(localStorage.getItem("sdg_riskpct")); return isFinite(v) && v > 0 ? v : 1; } catch (_) { return 1; } })();
  // Conviction-adjusted risk: LOW confidence / ranging shrink the position (sizeMult<1)
  // rather than blocking the trade — the tier edge is real, the confidence is a size dial.
  const eff = (sizeMult > 0 && sizeMult < 1) ? sizeMult : 1;
  const effPct = riskPct * eff;
  const ps = lotSizeFor(assetId, risk, acct * effPct / 100);
  const dirCol = sig.action === "LONG" ? "#4ade80" : "#f87171";
  const rrTgt = t2 != null ? rMul(t2) : t1 != null ? rMul(t1) : null;

  const Row = ({ label, price, r, note, col }) => (
    <div style={{ display: "grid", gridTemplateColumns: "52px 1fr auto", gap: 8, alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid #1e293b" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: col, letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ ...mono, fontSize: 15, color: "#f1f5f9" }}>{fp(price)}</span>
      <span style={{ fontSize: 10, color: "#64748b", textAlign: "right" }}>{r != null ? `${r >= 0 ? "+" : ""}${r.toFixed(1)}R · ` : ""}{note}</span>
    </div>
  );
  return (
    <div style={{ ...card, marginBottom: 10, border: `1px solid ${dirCol}55` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
        <p style={{ ...lbl, margin: 0 }}>📋 Trade Plan</p>
        <span style={{ ...mono, fontSize: 13, fontWeight: 700, color: dirCol }}>{sig.action}{sig.confidence ? ` · ${sig.confidence}` : ""}</span>
      </div>
      <Row label="ENTRY" price={entry} r={null} note={sig.entry_note || "at market"} col="#e2e8f0" />
      <Row label="STOP" price={stop} r={-1} note="full exit" col="#f87171" />
      {t1 != null && <Row label="T1" price={t1} r={rMul(t1)} note="close 50% · stop → breakeven" col="#4ade80" />}
      {t2 != null && <Row label="T2" price={t2} r={rMul(t2)} note="close the rest" col="#4ade80" />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, flexWrap: "wrap", gap: 6 }}>
        <span style={{ ...mono, fontSize: 11, color: "#94a3b8" }}>
          Size: {ps && !ps.tooSmall ? <b style={{ color: "#e2e8f0" }}>{ps.lots.toFixed(2)} lots</b> : ps?.tooSmall ? <span style={{ color: "#f87171" }}>&lt; 0.01 lot — see Outcome Map</span> : "set account below"}{ps && !ps.tooSmall ? ` (${effPct.toFixed(2)}% risk${eff < 1 ? ` · ${Math.round(eff * 100)}% size, low conviction` : ""})` : ""}
        </span>
        <span style={{ ...mono, fontSize: 11, color: "#64748b" }}>R:R {rrTgt != null ? `1:${Math.abs(rrTgt).toFixed(1)}` : "—"}</span>
      </div>
    </div>
  );
}
