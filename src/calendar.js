// Live economic calendar (via our /api/calendar proxy) + post-NFP detection.
// Falls back to the hardcoded estimate calendar when the feed is unavailable.
import { useState, useEffect } from "react";
import { toEgypt12 } from "./shared";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let cache = null; // module-level: one fetch per app session (proxy caches server-side too)

const mapItem = it => {
  const d = new Date(it.date);
  if (isNaN(d)) return null;
  return {
    label: it.title, currency: it.country, impact: it.impact, date: d,
    ds: `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`,
    tEgy: toEgypt12(d.getUTCHours(), d.getUTCMinutes()),
  };
};

export const fetchLiveCalendar = async () => {
  if (cache) return cache;
  try {
    const r = await fetch("/api/calendar", { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d) || !d.length) return null;
    cache = d.map(mapItem).filter(Boolean);
    return cache;
  } catch (_) { return null; }
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

// Hook: live events with hardcoded fallback + post-NFP state (refreshes each render tick).
export const useLiveEvents = (fallbackEvents, currencies) => {
  const [all, setAll] = useState(null);
  useEffect(() => { let on = true; fetchLiveCalendar().then(a => { if (on) setAll(a); }); return () => { on = false; }; }, []);
  const events = all ? upcomingLive(all, currencies) : fallbackEvents;
  return { events, isLive: !!all, postNfp: postNfpWindow(all) };
};
