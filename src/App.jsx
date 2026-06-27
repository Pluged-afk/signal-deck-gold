import { useState } from "react";
import AccessGate from "./AccessGate";
import Landing from "./Landing";
import AssetEngine from "./AssetEngine";
import { ASSETS } from "./assets";

// Flow: passcode (every visit) → asset selection → one asset engine.
export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [asset, setAsset] = useState(null);

  if (!unlocked) return <AccessGate onUnlock={() => setUnlocked(true)} />;
  if (!asset)    return <Landing onSelect={setAsset} />;
  return <AssetEngine config={ASSETS[asset]} onBack={() => setAsset(null)} />;
}
