import { useState } from "react";
import Landing from "./Landing";
import AssetEngine from "./AssetEngine";
import { ASSETS } from "./assets";

// Access is enforced server-side by Edge Middleware (HTTP Basic Auth) in
// middleware.js, BEFORE this bundle is ever served. No credentials live in the
// client code. Flow here: asset selection → one asset engine.
export default function App() {
  const [asset, setAsset] = useState(null);
  if (!asset) return <Landing onSelect={setAsset} />;
  return <AssetEngine config={ASSETS[asset]} onBack={() => setAsset(null)} />;
}
