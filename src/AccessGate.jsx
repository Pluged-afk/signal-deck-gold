import { useState } from "react";
import { mono } from "./shared";

const ACCESS_CODE = "XAU-7749-GOLD";

// Passcode is required on every visit (not persisted). Keys persist; access does not.
export default function AccessGate({ onUnlock }) {
  const [input, setInput] = useState("");
  const [shake, setShake] = useState(false);
  const [tries, setTries] = useState(0);

  const attempt = () => {
    if (input.trim() === ACCESS_CODE) { onUnlock(); }
    else { setShake(true); setTries(t=>t+1); setInput(""); setTimeout(()=>setShake(false),600); }
  };

  return (
    <div style={{background:"#020617",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:16, padding:"2.5rem 2rem", width:"100%", maxWidth:360, textAlign:"center", animation: shake?"shake 0.5s ease":"none" }}>
        <p style={{fontSize:20,margin:"0 0 4px",color:"#fbbf24",fontWeight:700,letterSpacing:"0.06em"}}>✦ SIGNAL DECK</p>
        <p style={{...mono, fontSize:11, color:"#475569", margin:"0 0 2rem"}}>Private access only</p>
        <input type="password" placeholder="Enter access code" value={input} autoFocus
          onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&attempt()}
          style={{ width:"100%", padding:"10px 12px", background:"#020617", border:`1px solid ${shake?"#7f1d1d":"#334155"}`, borderRadius:8, color:"#e2e8f0", fontSize:13, ...mono, boxSizing:"border-box", textAlign:"center", letterSpacing:"0.12em", marginBottom:"0.9rem", outline:"none" }}/>
        <button onClick={attempt} style={{ width:"100%", padding:"10px", background:"#1e3a5f", border:"1px solid #2563eb", borderRadius:8, color:"#60a5fa", fontSize:13, cursor:"pointer", ...mono }}>Unlock →</button>
        {tries>0 && <p style={{...mono, fontSize:11, color:"#7f1d1d", margin:"0.75rem 0 0"}}>Incorrect code{tries>2?` (${tries} attempts)`:""}</p>}
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>
    </div>
  );
}
