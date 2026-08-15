import { useState, useEffect } from "react";
import { mono, card, lotSizeFor, signalLock, hmLeft, EST_COST, EST_COST_HIGH, TD_FREE_DAILY, tdFetch, getShadows, resolveShadows, updateShadow, shadowStats, abStats, getGateOverride, setGateOverride, resetGateOverride, getLearnSettings, setLearnSettings, getMode, setMode } from "./shared";
import { learningReport, readyProposals, TIER_PRIOR } from "./learning";
import { PULLBACK_ZONES, SIGNAL_MODES } from "./ta";
import GoldChart from "./GoldChart";

// ═══════════════════════════════════════════════════════════════════════════
// GoldMinimal — the simplified, binary Gold terminal (2026-08-15).
//
// Shows ONLY: live chart · pullback meter · entry / SL / TP · a single
// TRADE / NO-TRADE call. Everything else (scorecard, MTF table, fib, quality
// bars, scenario map, news, confidence label, tier badge…) is intentionally
// hidden from the primary display.
//
// The binary is DERIVED from the exact same validated gate the full engine
// computes — `sig._verdict` (ta.js tradeVerdict), which requires htfTier >= 2
// (the daily-confirmed edge). The internal tier math still runs untouched; it
// simply is not shown. TRADE  ⟺  verdict === "TRADE". Everything that is not a
// green light (tier < 2, WAIT-for-event, extended-chase, model-WAIT) collapses
// to NO TRADE. A data-load failure shows a distinct muted state rather than
// masquerading as an analysed "NO TRADE".
// ═══════════════════════════════════════════════════════════════════════════

const num = v => { const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : null; };
const stateCol = s => (PULLBACK_ZONES.find(z => z.state === s) || {}).color || "#94a3b8";
const ZONE_ADVICE = {
  "SHALLOW": "Normal pullback — hold.", "NORMAL": "Healthy retrace — hold, watch.",
  "MODERATE": "Momentum test — watch closely.", "DEEP": "Reversal risk — tighten stop.",
  "SEVERE": "Likely reversal — consider exit.", "FULL REVERSAL": "Trend broken — exit.",
};

const TONE = {
  trade: { border: "#16a34a", bg: "#04140a", fg: "#22c55e" },
  no:    { border: "#7f1d1d", bg: "#160606", fg: "#f87171" },
  data:  { border: "#a16207", bg: "#1a1206", fg: "#fbbf24" },
  event: { border: "#a16207", bg: "#1a1206", fg: "#fbbf24" },
};

// ── Pullback meter (compact, self-contained — same 6-band model as the engine) ─
function PullbackMeter({ pull }) {
  if (!pull) return (
    <div style={{ ...card, marginBottom: 10 }}>
      <p style={{ ...mono, fontSize: 11, color: "#64748b", margin: 0 }}>Pullback Meter · no clear 1h swing</p>
    </div>
  );
  const TAIL = 15, TOTAL = 100 + TAIL;
  const p = pull.pct;
  const units = p <= 100 ? p : 100 + Math.min(1, (p - 100) / 50) * TAIL;
  const markerLeft = Math.max(0, Math.min(100, units / TOTAL * 100));
  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}>Pullback Meter</span>
        <span style={{ ...mono, fontSize: 11, color: stateCol(pull.state) }}>{pull.state}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ ...mono, fontSize: 20, fontWeight: 700, color: stateCol(pull.state) }}>{pull.pct.toFixed(0)}%</span>
        <span style={{ ...mono, fontSize: 10, color: "#64748b", alignSelf: "flex-end" }}>{pull.dir}-move retrace</span>
      </div>
      <div style={{ position: "relative", paddingTop: 7 }}>
        <div style={{ position: "absolute", top: 0, left: `${markerLeft}%`, transform: "translateX(-50%)", fontSize: 9, color: "#e2e8f0", lineHeight: 1 }}>▼</div>
        <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", border: "1px solid #1e293b" }}>
          {PULLBACK_ZONES.map(z => {
            const span = z.state === "FULL REVERSAL" ? TAIL : (z.hi - z.lo);
            const active = pull.state === z.state;
            return <div key={z.state} title={`${z.state} ${z.lo}–${z.hi === 150 ? "100+" : z.hi}%`} style={{ flex: span, background: z.color, opacity: active ? 1 : 0.25, borderRight: "1px solid #020617" }} />;
          })}
        </div>
      </div>
      <p style={{ fontSize: 8, color: "#475569", margin: "4px 0 0", ...mono }}>0 · 23.6 · 38.2 · 50 · 61.8 · 100+</p>
      <p style={{ fontSize: 10, color: "#475569", margin: "5px 0 0" }}>{ZONE_ADVICE[pull.state] || ""}</p>
    </div>
  );
}

// ── Entry / SL / TP block — the order ticket, no confidence/tier labels ────────
function Levels({ sig, dec, mode }) {
  const entry = num(sig.entry);
  if (entry == null) return null;
  const dir = sig.action === "SHORT" ? -1 : 1;
  const atr = sig._ta && sig._ta.atr4h > 0 ? sig._ta.atr4h : null;
  const isFade = !!sig._fade;
  const M = SIGNAL_MODES[mode] || SIGNAL_MODES.day;
  // Trend trade → recompute stop/targets for the SELECTED mode (instant, free).
  // Range-fade → use the signal's own validated fade levels (mode never rescales a fade).
  let stop, t1, t2;
  if (isFade || !atr) { stop = num(sig.stop); t1 = num(sig.t1); t2 = num(sig.t2); }
  else { const r = M.stopMult * atr; stop = entry - dir * r; t1 = entry + dir * M.t1 * r; t2 = entry + dir * M.t2 * r; }
  if (stop == null) return null;
  const risk = Math.abs(entry - stop) || 1e-9;
  const rMul = pr => pr == null ? null : ((pr - entry) * dir) / risk;
  const fp = v => v == null ? "—" : `$${Number(v).toFixed(dec)}`;
  const acct = (() => { try { const v = parseFloat(localStorage.getItem("sdg_acct")); return Number.isFinite(v) && v > 0 ? v : 10000; } catch (_) { return 10000; } })();
  const riskPct = (() => { try { const v = parseFloat(localStorage.getItem("sdg_riskpct")); return Number.isFinite(v) && v > 0 ? v : 1; } catch (_) { return 1; } })();
  const eff = sig._verdict?.sizeMult && sig._verdict.sizeMult < 1 ? sig._verdict.sizeMult : 1;
  const ps = lotSizeFor("gold", risk, acct * (riskPct * eff) / 100);
  const dirCol = sig.action === "LONG" ? "#22c55e" : "#f87171";

  // Distance-first: every level shows its $ gap from entry (+ ×ATR), because gold
  // feeds differ and the difference isn't even constant. Distances transfer; price doesn't.
  const Row = ({ label, price, col, isEntry }) => {
    const dist = price - entry, r = isEntry ? null : rMul(price);
    const sub = isEntry
      ? "at your platform's live price"
      : `${dist >= 0 ? "+" : "−"}$${Math.abs(dist).toFixed(dec)}${atr ? ` · ${(Math.abs(dist) / atr).toFixed(1)}×ATR` : ""}`;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "48px 1fr auto", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid #1e293b" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: col, letterSpacing: "0.05em" }}>{label}</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ ...mono, fontSize: 16, color: "#f1f5f9" }}>{fp(price)}</span>
          <span style={{ ...mono, fontSize: 9, color: isEntry ? "#64748b" : col }}>{sub}</span>
        </div>
        <span style={{ ...mono, fontSize: 11, color: "#64748b", textAlign: "right" }}>{r != null ? `${r >= 0 ? "+" : ""}${r.toFixed(1)}R` : ""}</span>
      </div>
    );
  };
  return (
    <div style={{ ...card, marginBottom: 10, border: `1px solid ${dirCol}55` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}>Trade Levels · {sig.action}{isFade ? " · fade" : ""}</span>
        <span style={{ ...mono, fontSize: 9, color: isFade ? "#c084fc" : "#475569" }}>{isFade ? "range-fade" : `${mode} · hold ${M.hold}`}</span>
      </div>
      <Row label="ENTRY" price={entry} col="#e2e8f0" isEntry />
      <Row label="SL" price={stop} col="#f87171" />
      {t1 != null && <Row label="TP1" price={t1} col="#22c55e" />}
      {t2 != null && <Row label="TP2" price={t2} col="#16a34a" />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, flexWrap: "wrap", gap: 6 }}>
        <span style={{ ...mono, fontSize: 11, color: "#94a3b8" }}>
          Size: {ps && !ps.tooSmall ? <b style={{ color: "#e2e8f0" }}>{ps.lots.toFixed(2)} lots</b> : ps?.tooSmall ? <span style={{ color: "#f87171" }}>&lt; 0.01 lot</span> : "—"}
          {eff < 1 ? <span style={{ color: "#64748b" }}> · {Math.round(eff * 100)}% size</span> : ""}
        </span>
        <span style={{ ...mono, fontSize: 11, color: "#64748b" }}>{riskPct}% risk · €{Number(acct).toLocaleString()}</span>
      </div>
      <p style={{ fontSize: 8, color: "#334155", margin: "8px 0 0", lineHeight: 1.5 }}>
        Prices are our data feed's reference. Gold feeds differ (and not by a fixed amount), so <b style={{ color: "#64748b" }}>enter at your platform's live price and apply the $ distances / R</b> — those transfer to any feed.{isFade ? " Range-fade: fixed capped target, half size." : ` ${mode} profile: stop ${M.stopMult}×ATR, targets ${M.t1}R / ${M.t2}R.`}
      </p>
    </div>
  );
}

// ── Signal Log — shadow outcomes (the learning "recorder", read-only display) ─
const OC = { tp1: { t: "TP ✓", c: "#22c55e" }, tp2: { t: "TP2 ✓", c: "#16a34a" }, sl: { t: "SL ✗", c: "#f87171" }, open: { t: "open", c: "#64748b" }, expired: { t: "expired", c: "#475569" } };
function LogPanel({ shadows, stats, onMark, onClose, dec }) {
  const rows = [...shadows].sort((a, b) => b.ts - a.ts).slice(0, 20);
  const fp = v => v == null ? "—" : `$${Number(v).toFixed(dec)}`;
  const mini = c => ({ ...mono, fontSize: 9, padding: "1px 6px", borderRadius: 5, cursor: "pointer", background: "transparent", border: `1px solid ${c}55`, color: c });
  const Chip = ({ label, g, hint }) => (
    <div style={{ flex: 1, padding: "8px 10px", borderRadius: 8, background: "#020617", border: "1px solid #1e293b" }}>
      <p style={{ fontSize: 9, color: "#64748b", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</p>
      <p style={{ ...mono, fontSize: 15, fontWeight: 700, margin: 0, color: g.rate == null ? "#475569" : g.rate >= 50 ? "#22c55e" : "#f87171" }}>{g.rate == null ? "—" : `${g.rate}%`}<span style={{ fontSize: 10, color: "#64748b", fontWeight: 400 }}> {g.tp}/{g.tp + g.sl}</span></p>
      <p style={{ fontSize: 8, color: "#475569", margin: "2px 0 0", lineHeight: 1.4 }}>{hint}</p>
    </div>
  );
  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}>Signal Log · shadow outcomes</span>
        <button onClick={onClose} style={{ ...mono, fontSize: 11, padding: "2px 7px", borderRadius: 6, cursor: "pointer", background: "transparent", color: "#64748b", border: "1px solid #1e293b" }}>✕</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <Chip label="TRADE hit TP" g={stats.trade} hint="of resolved TRADE calls" />
        <Chip label="NO-TRADE would've" g={stats.noTrade} hint="skipped setups that hit TP first — a high % over many samples = the gate may be too strict" />
      </div>
      {rows.length === 0 && <p style={{ ...mono, fontSize: 10, color: "#475569", margin: 0, lineHeight: 1.5 }}>No signals logged yet. Every signal — including NO&nbsp;TRADE — is recorded here with its hypothetical entry/SL/TP, then auto-resolved from candles.</p>}
      {rows.map(r => {
        const o = OC[r.outcome] || OC.open;
        return (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "46px 1fr auto", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1e293b" }}>
            <div>
              <span style={{ ...mono, fontSize: 10, fontWeight: 700, color: r.verdict === "TRADE" ? "#22c55e" : "#94a3b8" }}>{r.verdict === "TRADE" ? "TRADE" : "NO"}</span>
              <br /><span style={{ ...mono, fontSize: 9, color: "#475569" }}>{r.side}</span>
            </div>
            <div>
              <span style={{ fontSize: 9, color: "#64748b" }}>{new Date(r.ts).toLocaleDateString([], { month: "short", day: "numeric" })} · {r.reason}</span>
              <br /><span style={{ ...mono, fontSize: 9, color: "#475569" }}>{fp(r.entry)}→{fp(r.tp1)} / {fp(r.sl)}</span>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: o.c }}>{o.t}</span>
              {r.resolvedBy && <span style={{ fontSize: 8, color: "#475569", display: "block", lineHeight: 1 }}>{r.resolvedBy}</span>}
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 3 }}>
                <button onClick={() => onMark(r.id, "tp1")} title="Manually mark: price hit TP" style={mini("#22c55e")}>TP</button>
                <button onClick={() => onMark(r.id, "sl")} title="Manually mark: price hit SL" style={mini("#f87171")}>SL</button>
              </div>
            </div>
          </div>
        );
      })}
      <p style={{ fontSize: 8, color: "#334155", margin: "8px 0 0", lineHeight: 1.5 }}>Auto-resolved from 4h candles (ties → SL, conservative). TP/SL buttons override manually. Evidence only — never changes the live signal. Stored locally on this device.</p>
    </div>
  );
}

// ── Collective read — the data the TRADE/NO-TRADE call synthesises, made visible.
// This is the system "reading the chart": tier (the proven gate) + the supporting
// context it weighs. All from the locally-computed `ta` — no AI.
function CollectiveRead({ ta }) {
  if (!ta) return null;
  const long = ta.t4 === "BULL";
  const Row = ({ label, ok, val }) => {
    const col = ok == null ? "#64748b" : ok ? "#4ade80" : "#f87171";
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #1e293b" }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}><span style={{ color: col }}>{ok == null ? "•" : ok ? "✓" : "✕"}</span> {label}</span>
        <span style={{ ...mono, fontSize: 10, color: "#cbd5e1" }}>{val}</span>
      </div>
    );
  };
  const structureClear = !((ta.nearRes && long) || (ta.nearSup && !long));
  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <p style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>Signal Read · collective data</p>
      <Row label="Higher-timeframe tier" ok={ta.htfTier != null ? ta.htfTier >= 2 : null} val={ta.htfTier != null ? `tier ${ta.htfTier}/3` : "—"} />
      <Row label="Trend alignment" ok={ta.dailyConfirms} val={`4h ${ta.t4} · D ${ta.tD} · W ${ta.tW}`} />
      <Row label="Regime strength" ok={ta.adx != null ? !ta.ranging : null} val={ta.adx != null ? `ADX ${ta.adx.toFixed(0)} ${ta.adxClass}` : "—"} />
      <Row label="Structure" ok={structureClear} val={ta.nearRes ? "at resistance" : ta.nearSup ? "at support" : "clear ahead"} />
      <Row label="Momentum divergence" ok={ta.divergence ? ta.divergence.type === "none" : null} val={ta.divergence && ta.divergence.type !== "none" ? ta.divergence.type : "none"} />
      <Row label="Not chasing (extended)" ok={!ta.extended} val={ta.extended ? `ran ${ta.recentMoveATR.toFixed(1)}×ATR` : "ok"} />
      <p style={{ fontSize: 8, color: "#334155", margin: "6px 0 0", lineHeight: 1.5 }}>The call = the synthesis of these. The <b style={{ color: "#64748b" }}>tier</b> is the proven gate (drives TRADE/NO-TRADE); the rest is weighted context.</p>
    </div>
  );
}

// ── Targets A/B — fixed formula vs structure-capped, measured on real outcomes.
function ABCard({ ab }) {
  if (!ab || !ab.n) return (
    <div style={{ ...card, marginBottom: 10 }}>
      <p style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>⚖ Targets A/B · formula vs structure</p>
      <p style={{ ...mono, fontSize: 10, color: "#475569", margin: 0, lineHeight: 1.5 }}>No paired outcomes yet. When a signal has a support/resistance level in its target path, both the fixed 1R/2R target and a structure-capped one are logged; once resolved from candles, this compares them.</p>
    </div>
  );
  const col = m => m >= 0 ? "#22c55e" : "#f87171";
  const structBetter = ab.structure.meanR > ab.formula.meanR;
  const Row = ({ label, g, best }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #1e293b" }}>
      <span style={{ fontSize: 11, color: best ? "#e2e8f0" : "#94a3b8" }}>{best ? "◆ " : "   "}{label}</span>
      <span style={{ ...mono, fontSize: 10, color: "#cbd5e1" }}>{g.hit}% hit · <span style={{ color: col(g.meanR) }}>{g.meanR >= 0 ? "+" : ""}{g.meanR.toFixed(2)}R</span></span>
    </div>
  );
  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <p style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 6px" }}>⚖ Targets A/B · formula vs structure <span style={{ color: "#475569" }}>· n={ab.n}</span></p>
      <Row label="Fixed formula (1R / 2R)" g={ab.formula} best={!structBetter} />
      <Row label="Structure-capped target" g={ab.structure} best={structBetter} />
      <p style={{ fontSize: 8, color: "#334155", margin: "6px 0 0", lineHeight: 1.5 }}>Structure targets hit MORE often but pay LESS — only <b style={{ color: "#64748b" }}>mean-R</b> (expectancy) names the winner. Live levels stay on the fixed formula; this only measures whether switching would help. Trust it past ~30 paired outcomes.</p>
    </div>
  );
}

// ── Learning — the disciplined adaptation brain (read-only until a pattern clears)
const pctf = r => r == null ? "—" : `${Math.round(r * 100)}%`;
function LearnSection({ report, gate, autoApply, onApply, onResetGate, onToggleAuto }) {
  const thr = gate.tierThreshold ?? 2;
  const adapted = thr !== 2;
  const tierRow = t => {
    const b = report.tiers[t], prior = TIER_PRIOR[t], locked = t === 0;
    const col = b.rate == null ? "#475569" : b.rate >= 0.5 ? "#22c55e" : "#f87171";
    const traded = t >= thr && !locked;
    return (
      <div key={t} style={{ display: "grid", gridTemplateColumns: "30px 74px 1fr", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
        <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: traded ? "#22c55e" : "#64748b" }}>T{t}</span>
        <span style={{ ...mono, fontSize: 11, color: col }}>{pctf(b.rate)} <span style={{ color: "#475569", fontSize: 9 }}>({b.n})</span></span>
        <span style={{ fontSize: 9, color: "#64748b" }}>{locked ? "locked −EV" : `prior ${prior.ev === "positive" ? "+EV" : "−EV"}`}{b.n >= 1 ? ` · CI ${pctf(b.ciLo)}–${pctf(b.ciHi)}` : ""} · <span style={{ color: traded ? "#4ade80" : "#475569" }}>{traded ? "TRADE" : "skip"}</span></span>
      </div>
    );
  };
  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}>🧠 Learning</span>
        <button onClick={onToggleAuto} title="When ON, a proposal that clears the full evidence bar is applied automatically. Default off — you approve each one." style={{ ...mono, fontSize: 9, padding: "2px 8px", borderRadius: 6, cursor: "pointer", background: autoApply ? "#04140a" : "transparent", border: `1px solid ${autoApply ? "#22c55e" : "#334155"}`, color: autoApply ? "#22c55e" : "#64748b" }}>{autoApply ? "auto-apply ON" : "auto-apply off"}</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", borderRadius: 8, background: "#020617", border: `1px solid ${adapted ? "#a16207" : "#1e293b"}`, marginBottom: 8 }}>
        <span style={{ ...mono, fontSize: 11, color: "#e2e8f0" }}>Gate: TRADE at tier ≥ {thr}{adapted ? <span style={{ color: "#fbbf24" }}> · adapted</span> : <span style={{ color: "#475569" }}> · default</span>}</span>
        {adapted && <button onClick={onResetGate} style={{ ...mono, fontSize: 9, padding: "2px 7px", borderRadius: 6, cursor: "pointer", background: "transparent", border: "1px solid #334155", color: "#94a3b8" }}>reset</button>}
      </div>
      <p style={{ ...mono, fontSize: 9, color: "#64748b", margin: "0 0 6px", lineHeight: 1.5 }}>{report.totalResolved} resolved / {report.totalLogged} logged. A pattern must clear <b style={{ color: "#94a3b8" }}>≥{report.minSample} resolved + CI&gt;50% + both halves</b> before it can move the gate — one entry never can.</p>
      {[3, 2, 1, 0].map(tierRow)}
      {report.proposals.map(p => {
        const c = p.severity === "tighten" ? "#fbbf24" : "#22c55e";
        return (
          <div key={p.id} style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "#020617", border: `1px solid ${p.ready ? c : "#334155"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: p.ready ? c : "#94a3b8" }}>{p.ready ? "✓ " : "◷ "}{p.title}</span>
              {p.ready
                ? <button onClick={() => onApply(p)} style={{ ...mono, fontSize: 10, fontWeight: 700, padding: "3px 12px", borderRadius: 6, cursor: "pointer", background: c + "22", border: `1px solid ${c}`, color: c }}>Apply</button>
                : <span style={{ ...mono, fontSize: 9, color: "#64748b" }}>watching {p.bucket.n}/{report.minSample}</span>}
            </div>
            <p style={{ fontSize: 9, color: "#64748b", margin: "4px 0 0", lineHeight: 1.5 }}>{p.detail}</p>
            {p.bucket.n > 0 && <p style={{ ...mono, fontSize: 9, color: "#475569", margin: "3px 0 0" }}>live {pctf(p.bucket.rate)} TP-first ({p.bucket.n}) · CI {pctf(p.bucket.ciLo)}–{pctf(p.bucket.ciHi)} · halves {pctf(p.bucket.half1)}/{pctf(p.bucket.half2)}{p.ready ? "" : " · not cleared"}</p>}
            <div style={{ height: 4, borderRadius: 3, background: "#1e293b", marginTop: 5, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.round((p.progress || 0) * 100)}%`, background: p.ready ? c : "#334155" }} /></div>
          </div>
        );
      })}
      <p style={{ fontSize: 8, color: "#334155", margin: "8px 0 0", lineHeight: 1.5 }}>Locked forever: the daily-confirm requirement, the 1.5×ATR stop, the targets, and tier 0 (proven −EV). The loop can only move the tier threshold within 1–3, and every move is logged &amp; reversible.</p>
    </div>
  );
}

export default function GoldMinimal({
  config, T, keys, sig, scanResult, loading, prechecking, scanning, error, tdWarn,
  now, meter, costN, onSignal, onScan, onAICheck, hasAI, alerts, onToggleAlerts, onKeys, onBack, onAckTD,
}) {
  const dec = config.decimals || 2;
  const ta = sig?._ta;
  const busy = loading || prechecking || scanning;
  const lk = signalLock(config.id, +now);

  // ── Shadow log (learning recorder) — auto-resolve open records from candles ──
  const [showLog, setShowLog] = useState(false);
  const [shadows, setShadows] = useState(() => getShadows());
  const [stats, setStats] = useState(() => shadowStats());
  const refreshLog = () => { setShadows(getShadows()); setStats(shadowStats()); };
  const markOutcome = (id, outcome) => { updateShadow(id, { outcome, resolvedBy: "manual", resolvedAt: Date.now() }); refreshLog(); };
  useEffect(() => {   // one 4h candle fetch on mount resolves last session's open records
    let alive = true;
    (async () => {
      if (!keys?.td || !getShadows().some(r => r.outcome === "open")) return;
      try {
        const d = await tdFetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=4h&outputsize=120&timezone=UTC&apikey=${keys.td}`);
        const bars = (d?.values || []).map(v => ({ t: Math.floor(Date.parse(String(v.datetime).replace(" ", "T") + "Z") / 1000), o: +v.open, h: +v.high, l: +v.low, c: +v.close })).filter(b => Number.isFinite(b.t) && Number.isFinite(b.c)).sort((a, b) => a.t - b.t);
        if (alive && bars.length) { resolveShadows(bars); refreshLog(); }
      } catch (_) { /* resolution is best-effort */ }
    })();
    return () => { alive = false; };
  }, [keys?.td]);
  useEffect(() => { refreshLog(); }, [sig, scanResult]);   // reflect a newly-logged signal
  const openCount = shadows.filter(r => r.outcome === "open").length;

  // ── Learning brain — disciplined gate adaptation (proposals from real patterns) ─
  const [gate, setGate] = useState(() => getGateOverride());
  const [autoApply, setAutoApply] = useState(() => getLearnSettings().autoApply);
  const report = learningReport(shadows, gate);
  const ab = abStats();
  const applyProposal = p => setGate(setGateOverride(p.target, p.title, "manual"));
  const resetGate = () => setGate(resetGateOverride());
  const toggleAuto = () => setAutoApply(setLearnSettings({ autoApply: !autoApply }).autoApply);
  useEffect(() => {   // auto-apply a cleared proposal ONLY if the user opted in
    if (!autoApply) return;
    const ready = readyProposals(learningReport(getShadows(), getGateOverride()));
    if (ready.length) setGate(setGateOverride(ready[0].target, "auto-applied: " + ready[0].title, "auto"));
  }, [autoApply, shadows]);
  const gateThr = gate.tierThreshold ?? 2;

  // Execution mode (scalp / day / swing) — same trend gate, different stop/target scale + hold.
  const [mode, setModeState] = useState(() => getMode());
  const changeMode = m => { setMode(m); setModeState(m); };

  // Structure reference levels for the chart (nearest S/R + prev-day close) — so
  // entry/SL/TP are seen against real market structure, not in a vacuum.
  const structureLevels = (() => {
    if (!ta) return [];
    const out = [];
    const r = ta.sr?.resistance?.[0]; if (r?.level > 0) out.push({ price: r.level, color: "#b91c1c", title: "Resistance" });
    const s = ta.sr?.support?.[0]; if (s?.level > 0) out.push({ price: s.level, color: "#15803d", title: "Support" });
    const pdc = ta.prevDayBias?.prevClose; if (pdc > 0) out.push({ price: pdc, color: "#475569", title: "Prev close" });
    return out;
  })();

  // ── derive the binary call from the validated verdict gate ──────────────────
  const V = sig?._verdict?.verdict;
  let call = null;
  if (V === "TRADE") call = { label: "TRADE", tone: "trade" };
  else if (V === "DATA ERROR") call = { label: "DATA UNAVAILABLE", tone: "data", note: "Price-data hiccup — nothing was analysed. Re-scan in ~60s." };
  else if (V) call = { label: "NO TRADE", tone: "no" }; // NO-TRADE or WAIT (extended / event / model-wait)
  else if (scanResult?.binaryBlocked && scanResult.gate) {
    const g = scanResult.gate;
    call = { label: "NO TRADE", tone: "event", note: `${g.event.label} — ${g.phase === "pre" ? `in ${hmLeft(g.at, +now)}` : `safe in ${hmLeft(g.safeAt, +now)}`}` };
  } else if (scanResult?.ok && scanResult.tier != null && scanResult.tier < 2 && !(scanResult.rangeFade?.active || scanResult.revFade?.active)) {
    call = { label: "NO TRADE", tone: "no" };
  }
  const actionable = V === "TRADE" && sig?.action && sig.action !== "WAIT";
  const tone = call ? TONE[call.tone] : null;

  const ghostBtn = { padding: "6px 10px", background: "transparent", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", fontSize: 11, cursor: "pointer", ...mono };
  const bigBtn = {
    width: "100%", padding: "16px", borderRadius: 12, fontSize: 15, fontWeight: 700, letterSpacing: "0.04em",
    ...mono, cursor: busy || lk.locked ? "not-allowed" : "pointer",
    background: busy ? "#0f172a" : "#1e293b", border: `1px solid ${T.accent}`, color: T.accentText,
    opacity: lk.locked ? 0.5 : 1,
  };
  const aiBtn = { width: "100%", marginTop: 8, padding: "10px", borderRadius: 10, fontSize: 12, fontWeight: 600, ...mono, cursor: busy ? "not-allowed" : "pointer", background: "transparent", border: "1px solid #334155", color: "#94a3b8", opacity: busy ? 0.5 : 1 };

  return (
    <div style={{ background: "#020617", minHeight: "100vh", color: "#e2e8f0", padding: "1rem", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem", paddingBottom: "0.7rem", borderBottom: "1px solid #1e293b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={onBack} style={ghostBtn}>←</button>
            <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.06em", color: T.accentText }}>✦ SIGNAL DECK · GOLD</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {config.scan && <button onClick={onScan} disabled={busy} style={ghostBtn} title="Free tier scan — no API cost">{scanning ? "…" : "⚡ Scan"}</button>}
            <button onClick={onToggleAlerts} style={{ ...ghostBtn, ...(alerts ? { borderColor: "#22c55e", color: "#22c55e" } : {}) }} title="TRADE alerts — a browser notification when a fresh setup becomes tradeable. Free (checks once per 4h bar while this tab is open).">{alerts ? "🔔" : "🔕"}</button>
            <button onClick={() => setShowLog(v => !v)} style={{ ...ghostBtn, ...(showLog ? { borderColor: "#475569", color: "#e2e8f0" } : {}) }} title="Signal log — shadow TRADE/NO-TRADE outcomes tracked over time">📓{openCount ? ` ${openCount}` : ""}</button>
            <button onClick={onKeys} style={ghostBtn}>⚙</button>
          </div>
        </div>

        {/* THE CALL — binary verdict headline */}
        <div style={{
          ...card, marginBottom: 10, textAlign: "center", padding: "22px 16px",
          background: tone ? tone.bg : "#0b1220", border: `2px solid ${tone ? tone.border : "#1e293b"}`,
        }}>
          {call ? (
            <>
              <p style={{ ...mono, fontSize: 34, fontWeight: 800, letterSpacing: "0.06em", color: tone.fg, margin: 0, lineHeight: 1.1 }}>
                {call.label === "TRADE" ? `${call.label} · ${sig.action}${sig._fade ? " · FADE" : ""}` : call.label}
              </p>
              {call.note && <p style={{ ...mono, fontSize: 11, color: "#94a3b8", margin: "8px 0 0", lineHeight: 1.5 }}>{call.note}</p>}
              {sig && <p style={{ ...mono, fontSize: 9, margin: "8px 0 0", color: sig._free ? "#475569" : "#22c55e" }}>{sig._free ? "○ free · local read (no live news)" : "✓ AI news-checked"}</p>}
            </>
          ) : (
            <p style={{ ...mono, fontSize: 18, fontWeight: 700, color: "#475569", margin: 0 }}>— run a signal —</p>
          )}
        </div>

        {/* Execution mode — scalp / day / swing (same trend gate, different scale + hold) */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {["scalp", "day", "swing"].map(m => (
            <button key={m} onClick={() => changeMode(m)} title={`${m}: stop ${SIGNAL_MODES[m].stopMult}×ATR · targets ${SIGNAL_MODES[m].t1}R/${SIGNAL_MODES[m].t2}R · hold ${SIGNAL_MODES[m].hold}`} style={{
              flex: 1, ...mono, fontSize: 10, padding: "7px 0", borderRadius: 8, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em",
              background: mode === m ? "#1e293b" : "transparent", color: mode === m ? T.accentText : "#64748b", border: `1px solid ${mode === m ? T.accent : "#1e293b"}`,
            }}>{m}</button>
          ))}
        </div>

        {/* Learning + A/B + signal log (opt-in) */}
        {showLog && <LearnSection report={report} gate={gate} autoApply={autoApply} onApply={applyProposal} onResetGate={resetGate} onToggleAuto={toggleAuto} />}
        {showLog && <ABCard ab={ab} />}
        {showLog && <LogPanel shadows={shadows} stats={stats} onMark={markOutcome} onClose={() => setShowLog(false)} dec={dec} />}

        {/* Live chart with entry / SL / TP overlays + structure levels */}
        <GoldChart keys={keys} sig={actionable ? sig : null} decimals={dec} levels={structureLevels} />

        {/* Collective read — what the TRADE/NO-TRADE call synthesises */}
        {ta && <CollectiveRead ta={ta} />}

        {/* Trade levels (only on a real TRADE) */}
        {actionable && <Levels sig={sig} dec={dec} mode={mode} />}

        {/* Pullback meter */}
        <PullbackMeter pull={ta?.pull} />

        {/* TD-missing soft warning */}
        {tdWarn && (
          <div style={{ ...card, marginBottom: 10, border: "1px solid #a16207", background: "#1a1206" }}>
            <p style={{ ...mono, fontSize: 11, color: "#fde68a", margin: "0 0 8px", lineHeight: 1.5 }}>No Twelve Data key — real candles (MACD/RSI/ATR/patterns/chart) are unavailable and accuracy drops. Add a key, or run on AI inference only.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onAckTD} style={{ ...ghostBtn, border: "1px solid #a16207", color: "#fbbf24" }}>Run anyway</button>
              <button onClick={onKeys} style={ghostBtn}>Add key</button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ ...card, marginBottom: 10, border: "1px solid #7f1d1d", background: "#160606" }}>
            <p style={{ ...mono, fontSize: 11, color: "#fca5a5", margin: 0, lineHeight: 1.5 }}>{error}</p>
          </div>
        )}

        {/* Primary action — FREE local signal (no AI, €0) */}
        <button onClick={onSignal} disabled={busy || lk.locked} style={bigBtn} title={lk.locked ? "Locked until the next 4h close — a mid-bar re-scan returns the same read." : "Compute the signal locally — free, no AI call"}>
          {prechecking ? "Checking…" : loading ? "Reading candles…" : scanning ? "Scanning…" : lk.locked ? `🔒 Next signal in ${hmLeft(lk.until, +now)}` : sig || scanResult ? "↻ Refresh signal · free" : "Get Signal · free"}
        </button>

        {/* Optional AI news check — on-demand, the ONLY thing that costs money */}
        {sig && sig._free && (
          hasAI
            ? <button onClick={onAICheck} disabled={busy} style={aiBtn} title="Run the AI on this exact setup for live news/catalyst context. This is the only paid action.">＋ Live news check (AI · paid)</button>
            : <p style={{ ...mono, fontSize: 9, color: "#475569", textAlign: "center", margin: "8px 0 0" }}>Add an Anthropic key (⚙) to enable the optional AI news check.</p>
        )}

        {/* Minimal cost line */}
        {(costN > 0 || meter.paid > 0) && (
          <p style={{ ...mono, fontSize: 9, color: "#475569", textAlign: "right", margin: "8px 0 0" }}>
            Today: {meter.paid} paid · €{(meter.paid * EST_COST).toFixed(2)}–€{(meter.paid * EST_COST_HIGH).toFixed(2)}
            {meter.td ? ` · ~${meter.td}/${TD_FREE_DAILY} TD` : ""}
          </p>
        )}

        <p style={{ ...mono, fontSize: 8, color: "#334155", textAlign: "center", margin: "14px 0 0", lineHeight: 1.5 }}>
          Paper-trading education. Not financial advice. TRADE requires the daily-confirmed tier (≥{gateThr}{gateThr !== 2 ? " · adapted by learning" : ""}) the engine computes internally.
        </p>
      </div>
    </div>
  );
}
