import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineStyle, createSeriesMarkers } from "lightweight-charts";
import { mono, card, lbl, tdFetch } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// GoldChart — self-hosted live candlestick chart (lightweight-charts v5).
//
// WHY self-hosted and not a TradingView embed: the app's CSP (vercel.json) is
// `script-src 'self'` with no external frame-src, so a TradingView widget would
// be blocked — enabling it would require loosening the security policy, which is
// explicitly out of scope ("security completely untouched"). This library is
// bundled (served from 'self'), so it is CSP-compliant AND it is the only option
// that can overlay OUR entry / stop / TP / tier levels directly on the candles.
//
// Candles come from Twelve Data XAU/USD via the SAME server-side proxy the signal
// uses (tdFetch → /api/data, key injected server-side) so the instrument matches
// the signal exactly and the level overlays line up. No key in the browser.
// ═══════════════════════════════════════════════════════════════════════════

const TF = [
  { id: "1h",   label: "1H",  interval: "1h",   size: 240 },
  { id: "4h",   label: "4H",  interval: "4h",   size: 240 },
  { id: "1day", label: "1D",  interval: "1day", size: 260 },
];

// TD returns values newest-first in the exchange tz; we request UTC and convert to
// unix-seconds (lightweight-charts wants ascending, unique, numeric UTC time).
const toBars = values => {
  if (!Array.isArray(values)) return [];
  const rows = values.map(v => ({
    time: Math.floor(Date.parse(String(v.datetime).replace(" ", "T") + "Z") / 1000),
    open: +v.open, high: +v.high, low: +v.low, close: +v.close,
    volume: v.volume != null ? +v.volume : 0,
  })).filter(b => Number.isFinite(b.time) && Number.isFinite(b.close));
  rows.sort((a, b) => a.time - b.time);
  // de-dupe identical timestamps (TD can repeat the forming bar)
  const out = [];
  for (const b of rows) { if (out.length && out[out.length - 1].time === b.time) out[out.length - 1] = b; else out.push(b); }
  return out;
};

const num = v => { const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : null; };

export default function GoldChart({ keys, sig, decimals = 2, markers = [], levels = [] }) {
  const wrapRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volRef = useRef(null);
  const linesRef = useRef([]);       // price-line handles, cleared on each overlay update
  const markersRef = useRef(null);   // series-markers primitive
  const [tf, setTf] = useState("1h");
  const [bars, setBars] = useState(null);
  const [status, setStatus] = useState("init"); // init | loading | ok | nokey | error
  const [last, setLast] = useState(null);
  const [liveAt, setLiveAt] = useState(null);   // last real-time price update (Swissquote)
  const hasKey = !!keys?.td;

  // ── create the chart once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!wrapRef.current) return;
    const chart = createChart(wrapRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#94a3b8", fontFamily: "ui-monospace, monospace", fontSize: 10 },
      grid: { vertLines: { color: "rgba(30,41,59,0.5)" }, horzLines: { color: "rgba(30,41,59,0.5)" } },
      rightPriceScale: { borderColor: "#1e293b", scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: "#1e293b", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: 0, vertLine: { color: "#475569", labelBackgroundColor: "#334155" }, horzLine: { color: "#475569", labelBackgroundColor: "#334155" } },
      handleScale: { axisPressedMouseMove: true }, handleScroll: true,
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444", borderVisible: false,
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
      priceLineVisible: false, lastValueVisible: true,
    });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, color: "rgba(100,116,139,0.35)" });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    chartRef.current = chart; candleRef.current = candle; volRef.current = vol;
    return () => { try { chart.remove(); } catch (_) {} chartRef.current = null; candleRef.current = null; volRef.current = null; linesRef.current = []; markersRef.current = null; };
  }, []);

  // ── fetch candles for the selected timeframe ────────────────────────────────
  const load = useCallback(async () => {
    if (!hasKey) { setStatus("nokey"); return; }
    setStatus("loading");
    try {
      const conf = TF.find(t => t.id === tf) || TF[1];
      const d = await tdFetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${conf.interval}&outputsize=${conf.size}&timezone=UTC&apikey=${keys.td}`);
      const b = toBars(d?.values);
      if (!b.length) { setStatus("error"); return; }
      setBars(b); setLast(b[b.length - 1]); setStatus("ok");
    } catch (_) { setStatus("error"); }
  }, [tf, hasKey, keys?.td]);

  useEffect(() => { load(); }, [load]);

  // ── LIVE price — Swissquote free real-time feed (already CSP-allowed + used by
  // the signal pipeline). Updates the forming candle every 20s while the tab is
  // visible. Costs ZERO Twelve Data credits and needs no security change. This is
  // the same feed the engine uses to override a stale TD spot after news. ───────
  useEffect(() => {
    if (status !== "ok" || !bars || !bars.length) return;
    let alive = true;
    const tick = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const r = await fetch("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD");
        if (!r.ok) return;
        const d = await r.json();
        const q = d?.[0]?.spreadProfilePrices?.find(x => x.spreadProfile === "prime") || d?.[0]?.spreadProfilePrices?.[0];
        const px = q && q.ask && q.bid ? (q.ask + q.bid) / 2 : null;
        if (!alive || !Number.isFinite(px) || !candleRef.current) return;
        const lb = bars[bars.length - 1];
        const upd = { time: lb.time, open: lb.open, high: Math.max(lb.high, px), low: Math.min(lb.low, px), close: px };
        candleRef.current.update(upd);
        setLast({ ...lb, ...upd });
        setLiveAt(Date.now());
      } catch (_) { /* transient — next tick retries */ }
    };
    tick();
    const id = setInterval(tick, 20000);
    const onVis = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") tick(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(id); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis); };
  }, [status, bars]);

  // ── push candles into the series ────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !bars) return;
    candleRef.current.setData(bars);
    if (volRef.current) volRef.current.setData(bars.map(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? "rgba(34,197,94,0.28)" : "rgba(239,68,68,0.28)" })));
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  // ── overlay the trade levels (entry / stop / TP1 / TP2) + tier markers ──────
  useEffect(() => {
    const s = candleRef.current;
    if (!s) return;
    linesRef.current.forEach(l => { try { s.removePriceLine(l); } catch (_) {} });
    linesRef.current = [];
    const actionable = sig && sig.action && sig.action !== "WAIT";
    if (actionable) {
      const defs = [
        ["entry", num(sig.entry), "#e2e8f0", "ENTRY"],
        ["stop",  num(sig.stop),  "#ef4444", "SL"],
        ["t1",    num(sig.t1),    "#22c55e", "TP1"],
        ["t2",    num(sig.t2),    "#16a34a", "TP2"],
      ];
      defs.forEach(([, price, color, title]) => {
        if (price == null) return;
        const l = s.createPriceLine({ price, color, lineWidth: title === "ENTRY" ? 2 : 1, lineStyle: title === "ENTRY" ? LineStyle.Solid : LineStyle.Dashed, axisLabelVisible: true, title });
        linesRef.current.push(l);
      });
    }
    // structure reference levels (nearest support/resistance, prev-day close) —
    // faint dotted lines so entry/SL/TP are read IN CONTEXT of real market structure
    (levels || []).forEach(L => {
      if (!(L.price > 0)) return;
      const l = s.createPriceLine({ price: L.price, color: L.color || "#475569", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: L.title || "" });
      linesRef.current.push(l);
    });
    // optional candle markers (validated wick/close annotations, if any)
    if (markersRef.current) { try { markersRef.current.setMarkers(markers || []); } catch (_) {} }
    else if (markers && markers.length) { try { markersRef.current = createSeriesMarkers(s, markers); } catch (_) {} }
  }, [sig, bars, markers, levels]);

  const dec = decimals;
  return (
    <div style={{ ...card, marginBottom: 10, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <p style={{ ...lbl, margin: 0 }}>XAU/USD</p>
          {last && <span style={{ ...mono, fontSize: 13, fontWeight: 700, color: last.close >= last.open ? "#22c55e" : "#ef4444" }}>${last.close.toFixed(dec)}</span>}
          {liveAt && status === "ok" && <span style={{ ...mono, fontSize: 9, color: "#22c55e", display: "inline-flex", alignItems: "center", gap: 3 }} title="Live price from Swissquote — updates every 20s while this tab is open (free, no data-key cost)"><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />LIVE</span>}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {TF.map(t => (
            <button key={t.id} onClick={() => setTf(t.id)} style={{
              ...mono, fontSize: 10, padding: "2px 8px", borderRadius: 6, cursor: "pointer",
              background: tf === t.id ? "#334155" : "transparent", color: tf === t.id ? "#e2e8f0" : "#64748b",
              border: `1px solid ${tf === t.id ? "#475569" : "#1e293b"}`,
            }}>{t.label}</button>
          ))}
          <button onClick={load} title="Reload candles" style={{ ...mono, fontSize: 11, padding: "2px 7px", borderRadius: 6, cursor: "pointer", background: "transparent", color: "#64748b", border: "1px solid #1e293b" }}>↻</button>
        </div>
      </div>

      <div style={{ position: "relative", width: "100%", height: 320 }}>
        <div ref={wrapRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        {/* Full overlay ONLY when there are no candles to show yet. */}
        {status !== "ok" && (!bars || !bars.length) && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 20 }}>
            <p style={{ ...mono, fontSize: 12, color: status === "nokey" ? "#fbbf24" : status === "error" ? "#f87171" : "#64748b", lineHeight: 1.6, margin: 0 }}>
              {status === "loading" && "Loading candles…"}
              {status === "init" && "…"}
              {status === "nokey" && "Add your Twelve Data key on the landing page to load the live chart."}
              {status === "error" && (<>Couldn't load candles.<br /><span style={{ color: "#64748b", fontSize: 11 }}>Data API limit or the /api/data proxy isn't live yet. Tap ↻ to retry.</span></>)}
            </p>
          </div>
        )}
        {/* Candles already loaded but a refresh failed/pending — small pill, never cover the chart. */}
        {status !== "ok" && bars && bars.length > 0 && (
          <div style={{ position: "absolute", top: 6, right: 6, ...mono, fontSize: 8, padding: "2px 6px", borderRadius: 5, background: "rgba(2,6,23,0.8)", color: status === "error" ? "#fbbf24" : "#64748b", border: "1px solid #1e293b" }}>
            {status === "loading" ? "updating…" : "rate-limited · tap ↻"}
          </div>
        )}
      </div>

      {sig && sig.action && sig.action !== "WAIT" && status === "ok" && (
        <p style={{ ...mono, fontSize: 9, color: "#475569", margin: "6px 0 0", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span><span style={{ color: "#e2e8f0" }}>━</span> entry</span>
          <span><span style={{ color: "#ef4444" }}>┄</span> stop</span>
          <span><span style={{ color: "#22c55e" }}>┄</span> TP1 / TP2</span>
        </p>
      )}
    </div>
  );
}
