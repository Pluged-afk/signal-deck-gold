// Live economic calendar (via our /api/calendar proxy) + post-NFP detection +
// the always-on binary-event awareness strip (Section 5). Falls back to the
// hardcoded estimate calendar when the feed is unavailable.
import { useState, useEffect, useCallback } from "react";
import { toEgypt12, useNow, mono } from "./shared";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Timestamped module cache: re-fetch when older than the TTL or when forced, so
// a long-lived session never runs on a value cached earlier in the day.
let cache = null, cacheAt = 0;
const CACHE_TTL = 5 * 60000;

const mapItem = it => {
  const d = new Date(it.date);
  if (isNaN(d)) return null;
  return {
    label: it.title, currency: it.country, impact: it.impact, date: d,
    ds: `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`,
    tEgy: toEgypt12(d.getUTCHours(), d.getUTCMinutes()),
  };
};

export const fetchLiveCalendar = async (force = false) => {
  if (!force && cache && Date.now() - cacheAt < CACHE_TTL) return cache;
  try {
    const r = await fetch("/api/calendar", { cache: "no-store" });
    if (!r.ok) return cache;
    const d = await r.json();
    if (!Array.isArray(d) || !d.length) return cache;
    cache = d.map(mapItem).filter(Boolean); cacheAt = Date.now();
    return cache;
  } catch (_) { return cache; }
};

// Upcoming HIGH-impact events for the given currencies, shaped like upcomingEvents().
export const upcomingLive = (all, currencies, n = 3) => {
  const now = Date.now();
  return (all || [])
    .filter(e => e.impact === "High" && currencies.includes(e.currency) && e.date > now)
    .sort((a, b) => a.date - b.date).slice(0, n)
    .map(e => { const days = Math.ceil((e.date - now) / 86400000); return { ...e, days, in: days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`, approx: false }; });
};

// Post-NFP window: within 2h AFTER the release. Uses the live feed's actual NFP
// time when available (catches holiday shifts — e.g. Thursday releases), else
// falls back to the first-Friday 12:30 UTC rule.
export const postNfpWindow = all => {
  const now = Date.now();
  let t = null;
  const nfp = (all || []).find(e => /non-?farm employment/i.test(e.label) && e.currency === "USD" && !/adp/i.test(e.label));
  if (nfp) t = nfp.date.getTime();
  else {
    const d = new Date(); const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const first = new Date(Date.UTC(y, m, 1)); const off = (5 - first.getUTCDay() + 7) % 7;
    t = Date.UTC(y, m, 1 + off, 12, 30, 0);
  }
  const since = now - t;
  if (since > 0 && since <= 2 * 3600000) return { active: true, sinceMin: Math.round(since / 60000) };
  return { active: false };
};

// Hook: live events + hardcoded fallback + post-NFP state. Exposes `all` (raw
// feed) for the strip and `refresh(force)` so the pre-check / full run can pull
// a FRESH calendar rather than relying on a stale value (Section 5).
export const useLiveEvents = (fallbackEvents, currencies) => {
  const [all, setAll] = useState(null);
  const refresh = useCallback(async (force = false) => { const a = await fetchLiveCalendar(force); if (a) setAll(a); return a; }, []);
  useEffect(() => { let on = true; fetchLiveCalendar().then(a => { if (on && a) setAll(a); }); return () => { on = false; }; }, []);
  const events = all ? upcomingLive(all, currencies) : fallbackEvents;
  return { events, all, isLive: !!all, postNfp: postNfpWindow(all), refresh };
};

// ─── Marginal-setup conditions (Section 3c) — locally computed hard rule ─────
// Returns the list of triggered risk factors (2+ = marginal), or null.
export const computeMarginal = (ta, events, nowMs = Date.now()) => {
  const c = [];
  if (ta) {
    if (ta.mtfConflict || ta.allDisagree) c.push("MTF timeframes disagree");
    if (ta.volDiv) c.push("volume divergence");
    if (ta.pull && ["DEEP", "SEVERE", "FULL REVERSAL"].includes(ta.pull.state)) c.push(`pullback ${ta.pull.state}`);
    if (ta.adx != null && ta.adx < 20) c.push(`ADX ${ta.adx.toFixed(0)} (<20)`);
  }
  const be = (events || []).find(e => e.date && (e.date - nowMs) > 0 && (e.date - nowMs) <= 48 * 3600000);
  if (be) c.push(`${be.label} within 48h`);
  return c.length >= 2 ? c : null;
};

// ─── Section 5: always-on binary-event awareness strip ───────────────────────
// Re-renders every 60s off ONE live clock (useNow) — independent of whether the
// user refreshed a signal. Green (>24h clear) / Yellow (upcoming ≤24h) / Red
// (released ≤2h ago — post-event window).
const hm = ms => { const t = Math.max(0, ms); const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000); return h > 0 ? `${h}h ${m}m` : `${m}m`; };

export function EventStrip({ all, currencies = ["USD"], fallbackEvents = [] }) {
  const now = useNow(60000); // one live-time source, ticks each minute
  const nowMs = now.getTime();
  const list = all
    ? all.filter(e => e.impact === "High" && currencies.includes(e.currency))
    : (fallbackEvents || []).map(e => ({ label: e.label, date: e.date, tEgy: e.tEgy, impact: "High", currency: "USD" }));

  const upcoming = list.filter(e => e.date - nowMs > 0).sort((a, b) => a.date - b.date)[0];
  const past = list.filter(e => { const d = nowMs - e.date; return d > 0 && d <= 2 * 3600000; }).sort((a, b) => b.date - a.date)[0];
  const timeToUp = upcoming ? upcoming.date - nowMs : Infinity;
  const timeSincePast = past ? nowMs - past.date : Infinity;

  let dot, color, border, text;
  if (past && timeSincePast <= timeToUp) {
    dot = "🔴"; color = "#f87171"; border = "#7f1d1d";
    text = `${past.label} released ${hm(timeSincePast)} ago — post-event window, volatility may still be elevated`;
  } else if (upcoming && timeToUp <= 24 * 3600000) {
    dot = "🟡"; color = "#fbbf24"; border = "#78350f";
    text = `${upcoming.label} in ${hm(timeToUp)} — ${upcoming.tEgy || toEgypt12(upcoming.date.getUTCHours(), upcoming.date.getUTCMinutes())} EGY`;
  } else {
    dot = "🟢"; color = "#4ade80"; border = "#166534";
    text = "No high-impact event within 24h";
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, background: "#020617", border: `1px solid ${border}`, marginBottom: 10 }}>
      <span style={{ fontSize: 12 }}>{dot}</span>
      <span style={{ ...mono, fontSize: 11, color, lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}
