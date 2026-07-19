import { useState, useEffect } from "react";
import Landing from "./Landing";
import AssetEngine from "./AssetEngine";
import { ASSETS } from "./assets";
import { syncKeysFromServer } from "./shared";

// Flow: passcode (server-side middleware) → asset selection → one asset engine.
// Each asset is fully self-contained; only the selected asset's engine mounts.
export default function App() {
  const [asset, setAsset] = useState(null);

  // Pull encrypted server-stored API keys once on load (user is on the landing
  // page at this point, so keys are in localStorage before an engine mounts).
  useEffect(() => { syncKeysFromServer(); }, []);

  if (!asset) return <Landing onSelect={setAsset} />;
  return <AssetEngine config={ASSETS[asset]} onBack={() => setAsset(null)} />;
}
