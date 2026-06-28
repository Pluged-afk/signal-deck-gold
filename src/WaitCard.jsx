import { useState, useEffect } from "react";
import { mono, card, lbl, fmt } from "./shared";

// ─── WAIT-type theming ───────────────────────────────────────────────────────
const WAIT_TYPES = {
  binary_event:  { label:"WAIT — Binary Event",       col:"#f87171", bg:"#1a0505", border:"#7f1d1d" },
  low_confidence:{ label:"WAIT — Conflicting Signals", col:"#fb923c", bg:"#1f1206", border:"#7c2d12" },
  no_setup:      { label:"WAIT — No Setup",            col:"#fbbf24", bg:"#1c1408", border:"#78350f" },
  wrong_session: { label:"WAIT — Wrong Session",       col:"#94a3b8", bg:"#0f172a", border:"#334155" },
  none:          { label:"WAIT",                       col:"#fbbf24", bg:"#1c1408", border:"#78350f" },
};
export const waitTypeMeta = t => WAIT_TYPES[t] || WAIT_TYPES.none;

// ─── countdown helpers ───────────────────────────────────────────────────────
const parseHHMM = s => { const m = /(\d{1,2}):(\d{2})/.exec(s || ""); if (!m) return null; const now = new Date(); const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), +m[1], +m[2], 0)); if (d <= now) d.setUTCDate(d.getUTCDate() + 1); return d; };
const next4hClose = () => { const now = new Date(); const nh = (Math.floor(now.getUTCHours() / 4) + 1) * 4; const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)); d.setUTCHours(nh); return d; };
const hhmmUTC = d => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;

function Countdown({ triggers }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(id); }, []);
  // soonest future moment among the AI's trigger times, else the next 4h close
  const cands = [parseHHMM(triggers?.candle_close), parseHHMM(triggers?.next_session), parseHHMM(triggers?.news_time), next4hClose()].filter(Boolean);
  const target = cands.sort((a, b) => a - b)[0];
  const ms = target - new Date();
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  const left = h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, padding: "6px 10px", background: "#020617", borderRadius: 8 }}>
      <span style={{ ...mono, fontSize: 11, color: "#64748b" }}>Next recommended refresh</span>
      <span style={{ ...mono, fontSize: 12, color: "#e2e8f0" }}>{hhmmUTC(target)} · <span style={{ color: "#fbbf24" }}>{left}</span></span>
    </div>
  );
}

const Node = ({ time, name, note, danger }) => (
  <div style={{ flex: 1, textAlign: "center", minWidth: 70 }}>
    <div style={{ width: 9, height: 9, borderRadius: "50%", background: danger ? "#f87171" : "#475569", margin: "0 auto 6px" }} />
    <p style={{ ...mono, fontSize: 10, color: "#e2e8f0", margin: 0 }}>{time}</p>
    <p style={{ fontSize: 9, color: danger ? "#f87171" : "#64748b", margin: "1px 0 0", lineHeight: 1.3 }}>{name}</p>
    {note && <p style={{ fontSize: 8, color: "#475569", margin: "1px 0 0" }}>{note}</p>}
  </div>
);

// ═══ WAIT card (only when action === WAIT) ═══════════════════════════════════
export default function WaitCard({ sig, pricePrefix = "" }) {
  const tr = sig.triggers || {};
  const wt = waitTypeMeta(sig.wait_type);
  const px = v => (!v || v === "n/a" || v === "none") ? null : `${pricePrefix}${fmt(v)}`;
  const hasNews = tr.news_time && tr.news_time !== "none";

  return (
    <div style={{ ...card, background: wt.bg, border: `1px solid ${wt.border}`, marginBottom: 10 }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: wt.col, margin: "0 0 2px" }}>⏳ {wt.label}</p>
      <p style={{ ...mono, fontSize: 11, color: "#94a3b8", margin: "0 0 12px" }}>{tr.primary_reason || sig.reasoning || "Conditions not aligned for a trade."}{tr.secondary_reason && tr.secondary_reason !== "none" ? ` · ${tr.secondary_reason}` : ""}</p>

      {/* Section 1 — price levels */}
      <p style={{ ...lbl, color: "#64748b" }}>Price Levels to Watch</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "#020617", border: "1px solid #166534" }}>
          <p style={{ fontSize: 10, color: "#4ade80", margin: "0 0 2px" }}>🟢 Watch LONG {px(tr.watch_long) ? `at ${px(tr.watch_long)}` : ""}</p>
          <p style={{ fontSize: 10, color: "#64748b", margin: 0, lineHeight: 1.4 }}>{tr.watch_long_note || "—"}</p>
        </div>
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "#020617", border: "1px solid #7f1d1d" }}>
          <p style={{ fontSize: 10, color: "#f87171", margin: "0 0 2px" }}>🔴 Watch SHORT {px(tr.watch_short) ? `at ${px(tr.watch_short)}` : ""}</p>
          <p style={{ fontSize: 10, color: "#64748b", margin: 0, lineHeight: 1.4 }}>{tr.watch_short_note || "—"}</p>
        </div>
      </div>
      {px(tr.invalidation) && (
        <div style={{ padding: "6px 10px", borderRadius: 8, background: "#020617", marginBottom: 12 }}>
          <span style={{ ...mono, fontSize: 11, color: "#fbbf24" }}>⚡ Invalidation: {px(tr.invalidation)}</span>
          {tr.invalidation_note && <span style={{ fontSize: 10, color: "#64748b" }}> — {tr.invalidation_note}</span>}
        </div>
      )}

      {/* Section 2 — time triggers */}
      <p style={{ ...lbl, color: "#64748b" }}>Time-Based Triggers</p>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 12, padding: "4px 0" }}>
        <Node time="NOW" name="" />
        <div style={{ flex: 0.4, height: 1, background: "#1e293b", marginTop: 4 }} />
        {tr.candle_close && <Node time={tr.candle_close} name={tr.candle_close_note || "candle close"} />}
        {tr.next_session && <Node time={tr.next_session} name={tr.next_session_note || "next session"} />}
        {hasNews && <Node time={tr.news_time} name={tr.news_event || "news"} note="volatility" danger />}
      </div>

      {/* Section 3 — what needs to change */}
      <p style={{ ...lbl, color: "#64748b" }}>What Needs to Change</p>
      <div style={{ marginBottom: 12 }}>
        {[["📊 MTF", tr.mtf_fix], ["🕯️ Pattern", tr.pattern_needed], ["📈 Indicator", tr.indicator_needed]].map(([k, v]) => (
          <div key={k} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
            <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 84 }}>{k}</span>
            <span style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.4 }}>{v || "—"}</span>
          </div>
        ))}
      </div>

      {/* Section 4 — when to refresh */}
      <div style={{ padding: "10px 12px", borderRadius: 8, background: "#020617", border: `1px solid ${wt.border}` }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: wt.col, margin: "0 0 4px" }}>🔄 When to Refresh</p>
        <p style={{ fontSize: 12, color: "#e2e8f0", margin: 0, lineHeight: 1.5 }}>{tr.refresh_recommendation || tr.estimated_clarity || "Re-check at the next 4h candle close."}</p>
        <Countdown triggers={tr} />
      </div>

      {/* Smart refresh rules */}
      <p style={{ fontSize: 9, color: "#475569", margin: "10px 0 0", lineHeight: 1.6 }}>
        Smart refresh: price alert fires → refresh now · candle close reached → refresh · news passes (+30m) → refresh · next session starts → refresh · in a trade → stop refreshing.
      </p>
    </div>
  );
}

// ═══ Invalidation card (shown for LONG / SHORT) ══════════════════════════════
export function InvalidationCard({ sig, pricePrefix = "" }) {
  const tr = sig.triggers; if (!tr) return null;
  const px = v => (!v || v === "n/a" || v === "none") ? null : `${pricePrefix}${fmt(v)}`;
  const hasNews = tr.news_time && tr.news_time !== "none";
  if (!px(tr.invalidation) && !hasNews && !tr.refresh_recommendation) return null;
  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <p style={lbl}>Invalidation & Re-check</p>
      {px(tr.invalidation) && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
          <span style={{ fontSize: 11, color: "#64748b" }}>⚡ Cancels at</span>
          <span style={{ ...mono, fontSize: 12, color: "#f87171" }}>{px(tr.invalidation)}</span>
        </div>
      )}
      {tr.invalidation_note && <p style={{ fontSize: 10, color: "#475569", margin: "3px 0 6px" }}>{tr.invalidation_note}</p>}
      {hasNews && <p style={{ fontSize: 11, color: "#fbbf24", ...mono, margin: "4px 0 0" }}>⚠ {tr.news_event} at {tr.news_time} — exit before it</p>}
      {tr.refresh_recommendation && <p style={{ fontSize: 11, color: "#cbd5e1", margin: "6px 0 0", lineHeight: 1.5 }}>🔄 {tr.refresh_recommendation}</p>}
    </div>
  );
}
