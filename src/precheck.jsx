import { mono, card, lbl, fmt, egyptWindow } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// Lightweight LOCAL pre-check that runs before the paid Anthropic call. Fetches
// only a free spot price; everything else is computed from system time, the
// local binary-event calendar, and key levels stored from the previous signal.
// Costs €0 and runs in <1s. If any condition fails, the full signal is skipped.
// ═══════════════════════════════════════════════════════════════════════════
export const COST_PER_CALL = 0.18; // € estimate shown as "saved" when skipped
const MIN_INTERVAL_MIN = 45;

const PC_KEY = id => `sdg_pc_${id}`;
const STALE_MS = 24 * 3600000; // stored levels expire after 24h
export const loadPC = id => { try { return JSON.parse(localStorage.getItem(PC_KEY(id)) || "{}"); } catch (_) { return {}; } };
const savePC = (id, d) => { try { localStorage.setItem(PC_KEY(id), JSON.stringify(d)); } catch (_) {} };
const clearPC = id => { try { localStorage.removeItem(PC_KEY(id)); } catch (_) {} };

// Called after a successful full signal — remember the levels & timestamp so the
// next pre-check can tell whether price is near anything actionable.
export const storeSignalForPrecheck = (id, sig, price) => {
  const levels = [];
  const num = v => { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); if (n > 0) levels.push(n); };
  if (sig.support) num(sig.support);
  if (sig.resistance) num(sig.resistance);
  const ta = sig._ta;
  if (ta) {
    ta.sr?.resistance?.forEach(r => levels.push(r.level));
    ta.sr?.support?.forEach(r => levels.push(r.level));
    if (ta.fib) { Object.values(ta.fib.levels || {}).forEach(v => levels.push(v)); levels.push(ta.fib.high, ta.fib.low); }
  }
  savePC(id, { lastRefresh: Date.now(), levels: levels.filter(Boolean), price });
};

const goodSession = (id, h) => id === "btc" ? (h >= 13 && h < 21) : (h >= 8 && h < 20);
const dp = price => price < 10 ? 4 : 2; // EUR shows 4dp, gold/btc 2dp

// Returns { pass, checks:[{name, ok, detail}], price, src, saved }
export const runPreCheck = async ({ config, keys = {}, events }) => {
  const id = config.id;
  const now = Date.now();
  let pc = loadPC(id);
  // Expire levels older than 24h so yesterday's structure can't block today's signals.
  let staleReset = false;
  if (pc.lastRefresh && (now - pc.lastRefresh) > STALE_MS) { clearPC(id); pc = {}; staleReset = true; }
  const h = new Date().getUTCHours();

  // free spot price
  let price = null, src = null;
  try { const q = await config.quickPrice(keys); price = q?.price; src = q?.src; } catch (_) {}

  // 1 — session
  const sessOk = goodSession(id, h);
  const sess = { name: "Session", ok: sessOk, detail: sessOk ? `${config.session().label} — good window` : `Off-peak (${String(h).padStart(2, "0")}:00 UTC). Best ${id === "btc" ? "13:00–21:00" : "08:00–20:00"} UTC` };

  // (price-location check removed — it blocked too many valid moving-between-levels setups)

  // 2 — binary event within 24h → block; 24–72h → caution (still runs)
  const BLOCK_H = 24, CAUTION_H = 72;
  const soon = (events || []).find(e => e.date && (e.date - now) > 0 && (e.date - now) <= BLOCK_H * 3600000);
  const caution = soon ? null : (events || []).find(e => e.date && (e.date - now) > BLOCK_H * 3600000 && (e.date - now) <= CAUTION_H * 3600000);
  const evt = { name: "Binary event", ok: !soon, detail: soon ? `${soon.label} ${soon.in} (${soon.ds} · ${soon.tEgy} EGY) — no paid signal within 24h` : caution ? `${caution.label} ${caution.in} — trade with caution, reduce size` : "none within 24h" };

  // 3 — minimum interval since last refresh
  const since = pc.lastRefresh ? now - pc.lastRefresh : Infinity;
  const timeOk = since >= MIN_INTERVAL_MIN * 60000;
  const time = { name: "Min interval", ok: timeOk, detail: timeOk ? (pc.lastRefresh ? `${Math.round(since / 60000)} min since last refresh` : "first run") : `only ${Math.round(since / 60000)} min since last — wait ${MIN_INTERVAL_MIN - Math.round(since / 60000)} min` };

  const checks = [sess, evt, time];
  return { pass: checks.every(c => c.ok), checks, price, src, saved: COST_PER_CALL, binary: soon || null, caution: caution || null, levels: pc.levels || [] };
};

// One-line summary for the status row under the refresh button.
export const precheckSummary = r => {
  if (!r) return null;
  if (r.pass) return "conditions met";
  const failed = r.checks.find(c => !c.ok);
  return `not met (${failed.name.toLowerCase()})`;
};

// ═══ Binary-event block (free) — shown when an event is within 72h ═══════════
// Costs €0: no Anthropic call. Shows a free market summary so the user stays
// informed, plus when the event clears and the next clean session window.
export function BinaryBlockCard({ result, config, pricePrefix = "", onOverride }) {
  const b = result.binary; if (!b) return null;
  const price = result.price;
  const nextBest = config.sessionsGuide.find(s => s.quality === "best") || config.sessionsGuide[0];
  // nearest stored levels to current price
  const levels = (result.levels || []).slice().sort((a, c) => Math.abs(a - price) - Math.abs(c - price)).slice(0, 4)
    .sort((a, c) => c - a);
  const fpx = v => `${pricePrefix}${v.toFixed(dp(price || 1))}`;

  return (
    <div style={{ ...card, background: "#1c1408", border: "1px solid #78350f", marginBottom: 10 }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: "#fbbf24", margin: "0 0 2px" }}>⏳ Binary Event — paid signal blocked</p>
      <p style={{ ...mono, fontSize: 12, color: "#e2e8f0", margin: "0 0 4px" }}>{b.label} {b.in} — {b.ds} · {b.tEgy} EGY</p>
      <p style={{ ...mono, fontSize: 11, color: "#94a3b8", margin: "0 0 12px" }}>No signal until the event clears. €0 spent — no AI call made on a guaranteed WAIT.</p>

      <p style={{ ...lbl, color: "#64748b" }}>Free market summary</p>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>Current price {result.src ? `(${result.src})` : ""}</span>
        <span style={{ ...mono, fontSize: 12, color: "#e2e8f0" }}>{price != null ? `${pricePrefix}${price}` : "—"}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>Next clean window</span>
        <span style={{ ...mono, fontSize: 11, color: "#94a3b8" }}>{nextBest ? `${nextBest.window} / ${egyptWindow(nextBest.window)}` : "—"}</span>
      </div>
      <div style={{ padding: "6px 0" }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>Key levels to watch {levels.length ? "" : "(run a signal first)"}</span>
        {levels.length > 0 && <p style={{ ...mono, fontSize: 12, color: "#e2e8f0", margin: "3px 0 0" }}>{levels.map(fpx).join("  ·  ")}</p>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>Refresh after {b.ds} · {b.tEgy} EGY</span>
        <button onClick={onOverride} style={{ padding: "7px 14px", background: "#1e3a5f", border: "1px solid #2563eb", borderRadius: 8, color: "#60a5fa", fontSize: 11, cursor: "pointer", ...mono }}>
          Run paid signal anyway →
        </button>
      </div>
    </div>
  );
}

// ═══ Results card (shown only when the pre-check blocks a full signal) ═══════
export function PrecheckCard({ result, pricePrefix = "", onOverride }) {
  if (!result || result.pass) return null;
  const fail = result.checks.find(c => !c.ok);
  const px = result.price != null ? `${pricePrefix}${result.price}` : "—";
  return (
    <div style={{ ...card, background: "#0f172a", border: "1px solid #334155", marginBottom: 10 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24", margin: "0 0 2px" }}>⏳ Pre-check: conditions not met</p>
      <p style={{ ...mono, fontSize: 11, color: "#94a3b8", margin: "0 0 10px" }}>Skipped the paid signal — est. saved €{result.saved.toFixed(2)}. Current price: {px}</p>

      {result.checks.map(c => (
        <div key={c.name} style={{ display: "grid", gridTemplateColumns: "18px 110px 1fr", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
          <span style={{ fontSize: 12, color: c.ok ? "#4ade80" : "#f87171", textAlign: "center" }}>{c.ok ? "✓" : "✗"}</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{c.name}</span>
          <span style={{ fontSize: 11, color: c.ok ? "#475569" : "#fca5a5", lineHeight: 1.4 }}>{c.detail}</span>
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          Next check: {fail.name === "Price location" && fail.best ? `when price reaches ~${fail.best.l.toFixed(dp(result.price))}` : fail.name === "Min interval" ? "after the 45-min window" : fail.name === "Binary event" ? "after the event + 30 min" : "next good session"}
        </span>
        <button onClick={onOverride} style={{ padding: "7px 14px", background: "#1e3a5f", border: "1px solid #2563eb", borderRadius: 8, color: "#60a5fa", fontSize: 11, cursor: "pointer", ...mono }}>
          Run full signal anyway →
        </button>
      </div>
    </div>
  );
}
