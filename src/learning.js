// ═══════════════════════════════════════════════════════════════════════════
// learning.js — the DISCIPLINED brain on top of the shadow recorder.
//
// Design constraint (user's words): "real patterns only get to it, not one entry
// and it just switches the entire setup." So this NEVER adapts on a small or noisy
// sample. It tests a FIXED, PRE-REGISTERED set of hypotheses (anti-fishing — the
// project's whole history is factors that faked significance when you searched
// enough dimensions), and a bucket may drive a gate change ONLY when it clears a
// hard bar:
//   • ≥ MIN_SAMPLE resolved outcomes (TP-first vs SL-first)         — no tiny samples
//   • Wilson 95% CI lower bound > 50%                               — confidently +EV, not luck
//   • BOTH time-halves on the same side of 50%                     — stable, not a one-period fluke
//
// It also carries a PRIOR from the 10yr GC=F backtest, but the prior alone never
// adapts the gate — live shadow data must confirm it. And a hard SAFETY RAIL:
// tier 0 (daily dissents) is proven negative-EV and can NEVER be promoted; the
// daily-confirm requirement and the stop/target math are not adaptable at all.
// ═══════════════════════════════════════════════════════════════════════════
import { getShadows } from "./shared";

// Resolved outcomes needed in a bucket before it can drive a proposal. The 10yr
// study used n=60-180; 30 is a pragmatic first live bar — the CI is shown so the
// remaining uncertainty is always visible. Raise it to demand more confirmation.
export const MIN_SAMPLE = 30;

// Prior belief from the rigorous backtest (see signal-deck-backtest-findings).
// Held BEFORE live data; never adapts the gate on its own.
export const TIER_PRIOR = {
  0: { ev: "negative", txt: "daily dissents — proven −EV (locked, never tradeable)" },
  1: { ev: "positive", txt: "daily-only — +EV in backtest (56–62%), skipped by choice" },
  2: { ev: "positive", txt: "daily + one confirmer — traded" },
  3: { ev: "positive", txt: "daily + both — traded" },
};

// Wilson 95% score interval for a binomial proportion — robust at small n (unlike
// the naive normal interval, which is why it's used here).
export function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const centre = p + z * z / (2 * n);
  const halfw = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return [Math.max(0, (centre - halfw) / d), Math.min(1, (centre + halfw) / d)];
}

const isResolved = r => r.outcome === "tp1" || r.outcome === "sl";
const tpFirst = recs => recs.filter(r => r.outcome === "tp1").length;

// Per-bucket stats with the both-halves split. TP-first vs SL-first at ~1R:1R, so
// TP-first rate > 50% ⇔ positive expectancy for that bucket.
export function analyzeBucket(recs) {
  const R = recs.filter(isResolved).sort((a, b) => a.ts - b.ts);
  const n = R.length, tp = tpFirst(R), sl = n - tp;
  const [ciLo, ciHi] = wilson(tp, n);
  const mid = Math.floor(n / 2);
  const h1 = R.slice(0, mid), h2 = R.slice(mid);
  const half1 = h1.length ? tpFirst(h1) / h1.length : null;
  const half2 = h2.length ? tpFirst(h2) / h2.length : null;
  return { n, tp, sl, rate: n ? tp / n : null, ciLo, ciHi, half1, half2, open: recs.length - R.length };
}

// A bucket "clears the bar" for PROMOTION when it's confidently +EV and stable.
function clearsPromote(b) {
  return b.n >= MIN_SAMPLE && b.ciLo > 0.5 && b.half1 != null && b.half2 != null && b.half1 > 0.5 && b.half2 > 0.5;
}
// ...and clears for a DEMOTION warning when it's confidently −EV.
function clearsDemote(b) {
  return b.n >= MIN_SAMPLE && b.ciHi < 0.5;
}

// The report: FIXED hypotheses only. `gate` = current override ({tierThreshold}).
export function learningReport(shadows = getShadows(), gate = {}) {
  const byTier = { 0: [], 1: [], 2: [], 3: [] };
  for (const r of shadows) if (r.tier in byTier) byTier[r.tier].push(r);
  const tiers = {};
  for (const t of [0, 1, 2, 3]) tiers[t] = analyzeBucket(byTier[t]);

  const threshold = gate.tierThreshold ?? 2;
  const proposals = [];

  // H1 (pre-registered) — promote tier 1 (daily-only) to a REDUCED-SIZE trade.
  if (threshold > 1) {
    const b = tiers[1], ready = clearsPromote(b);
    proposals.push({
      id: "promote-tier1", kind: ready ? "ready" : "watch", severity: "loosen",
      title: "Allow tier 1 as a reduced-size TRADE",
      detail: "Tier 1 (daily confirms, 1h/weekly don't) is +EV in the 10yr backtest but currently shows NO TRADE. This promotes it to a half-size trade — only once LIVE data confirms it.",
      target: { tierThreshold: 1 }, bucket: b, ready,
      progress: Math.min(1, b.n / MIN_SAMPLE),
    });
  }

  // H2 (pre-registered SAFETY GUARD) — if live tier-2 is confidently −EV, warn to tighten.
  {
    const b = tiers[2], ready = clearsDemote(b);
    if (b.n >= MIN_SAMPLE && ready) {
      proposals.push({
        id: "tighten-tier2", kind: "warn", severity: "tighten",
        title: "Tier 2 is underperforming live — consider tier 3 only",
        detail: "Live tier-2 TP-first rate is confidently below break-even right now. Tightening the gate to tier 3 is the conservative response.",
        target: { tierThreshold: 3 }, bucket: b, ready,
        progress: 1,
      });
    }
  }

  // tier 0 is intentionally absent — proven −EV, hard-locked, never promotable.
  const totalResolved = [0, 1, 2, 3].reduce((s, t) => s + tiers[t].n, 0);
  const totalLogged = shadows.length;
  return { tiers, proposals, threshold, totalResolved, totalLogged, minSample: MIN_SAMPLE };
}

// Is any proposal ready to auto-apply? (only used when the user opts into auto-apply)
export function readyProposals(report) {
  return report.proposals.filter(p => p.ready && p.kind === "ready");
}
