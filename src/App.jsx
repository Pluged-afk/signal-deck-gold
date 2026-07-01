import { useState, useEffect } from "react";
import Landing from "./Landing";
import AssetEngine from "./AssetEngine";
import ScalpEngine from "./ScalpEngine";
import { ASSETS } from "./assets";
import { mono, syncKeysFromServer } from "./shared";

// Mode toggle shown on the EUR/USD page (swing vs scalp).
function ModeToggle({ mode, onChange }) {
  const btn = (m, label) => (
    <button onClick={() => onChange(m)} style={{
      flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12, cursor: "pointer", ...mono,
      background: mode === m ? "#1e293b" : "transparent",
      border: `1px solid ${mode === m ? "#3b82f6" : "#334155"}`,
      color: mode === m ? "#60a5fa" : "#64748b", fontWeight: mode === m ? 700 : 500,
    }}>{label}</button>
  );
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
      {btn("swing", "SWING MODE")}
      {btn("scalp", "SCALP MODE ⚡")}
    </div>
  );
}

// Flow: passcode (every visit) → asset selection → one asset engine.
export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [asset, setAsset] = useState(null);
  const [eurMode, setEurMode] = useState("swing");

  // Pull encrypted server-stored API keys once on load (user is on the landing
  // page at this point, so keys are in localStorage before an engine mounts).
  useEffect(() => { syncKeysFromServer(); }, []);

  if (!asset) return <Landing onSelect={a => { setEurMode("swing"); setAsset(a); }} />;

  if (asset === "eur") {
    const toggle = <ModeToggle mode={eurMode} onChange={setEurMode} />;
    return eurMode === "scalp"
      ? <ScalpEngine onBack={() => setAsset(null)} toggle={toggle} />
      : <AssetEngine config={ASSETS.eur} onBack={() => setAsset(null)} headerExtra={toggle} />;
  }
  return <AssetEngine config={ASSETS[asset]} onBack={() => setAsset(null)} />;
}
