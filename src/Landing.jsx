import { mono, card, isWeekend } from "./shared";

// Asset selection — no signals run here. Picking a card mounts ONE engine.
const CARDS = [
  {
    id:"gold", name:"GOLD", symbol:"XAU/USD",
    accent:"#ca8a04", accentText:"#fbbf24", glyph:"✦",
    desc:"Safe-haven metal. Driven by real yields, DXY, Fed policy and COT positioning.",
    hours:"London Open 08–10 UTC · EU-US overlap 13–16 UTC",
    weekend:"Avoid — spreads blow out",
    weekendRating:"poor",
  },
  {
    id:"eur", name:"EUR / USD", symbol:"EUR/USD",
    accent:"#3b82f6", accentText:"#60a5fa", glyph:"€",
    desc:"World's most-traded pair. Fed vs ECB rate differential and DXY drive direction.",
    hours:"London Open 08–10 UTC · EU-US overlap 13–16 UTC",
    weekend:"Limited — 20+ pip targets only",
    weekendRating:"fair",
  },
  {
    id:"btc", name:"BITCOIN", symbol:"BTC/USD",
    accent:"#f97316", accentText:"#fb923c", glyph:"₿",
    desc:"24/7 crypto. ETF flows, funding rate, open interest and dominance lead price.",
    hours:"US session 13–21 UTC primary · 24/7 market",
    weekend:"Tradeable — reduce size 30%",
    weekendRating:"good",
  },
];

const ratingCol = r => r==="good"?"#4ade80":r==="fair"?"#fbbf24":"#f87171";

export default function Landing({ onSelect }) {
  const wknd = isWeekend();
  return (
    <div style={{background:"#020617",minHeight:"100vh",color:"#e2e8f0",padding:"1rem",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <div style={{maxWidth:660,margin:"0 auto"}}>

        <div style={{textAlign:"center",padding:"1.5rem 0 0.5rem"}}>
          <p style={{fontWeight:700,fontSize:22,letterSpacing:"0.14em",color:"#f1f5f9",margin:"0 0 4px"}}>✦ SIGNAL DECK</p>
          <p style={{...mono,fontSize:11,color:"#475569",margin:0}}>Multi-asset signal terminal · Real APIs · Paper trading</p>
        </div>

        {wknd && (
          <div style={{...card,background:"#1c1408",border:"1px solid #78350f",margin:"1rem 0",textAlign:"center"}}>
            <span style={{fontSize:11,color:"#fbbf24",...mono}}>⚠ Weekend — liquidity is thin. Each asset shows its own weekend trading guidance.</span>
          </div>
        )}

        <p style={{fontSize:11,color:"#475569",textAlign:"center",margin:"1.25rem 0 0.75rem",letterSpacing:"0.08em",textTransform:"uppercase"}}>Choose an instrument</p>

        <div style={{display:"grid",gap:12,marginBottom:"1.5rem"}}>
          {CARDS.map(c=>(
            <button key={c.id} onClick={()=>onSelect(c.id)}
              style={{...card, textAlign:"left", cursor:"pointer", borderColor:c.accent+"55", borderWidth:1, transition:"all 0.15s", display:"block"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=c.accent;e.currentTarget.style.background="#111c33";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=c.accent+"55";e.currentTarget.style.background="#0f172a";}}>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <div style={{width:54,height:54,borderRadius:12,background:c.accent+"22",border:`1px solid ${c.accent}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,color:c.accentText,flexShrink:0}}>{c.glyph}</div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                    <span style={{fontSize:17,fontWeight:700,color:c.accentText,letterSpacing:"0.04em"}}>{c.name}</span>
                    <span style={{...mono,fontSize:11,color:"#475569"}}>{c.symbol}</span>
                  </div>
                  <p style={{fontSize:12,color:"#94a3b8",margin:"4px 0 0",lineHeight:1.5}}>{c.desc}</p>
                </div>
                <span style={{fontSize:20,color:c.accent}}>→</span>
              </div>
              <div style={{display:"flex",gap:16,marginTop:12,paddingTop:10,borderTop:"1px solid #1e293b",flexWrap:"wrap"}}>
                <span style={{...mono,fontSize:10,color:"#64748b"}}>🕐 {c.hours}</span>
                <span style={{...mono,fontSize:10,color:ratingCol(c.weekendRating)}}>● Weekend: {c.weekend}</span>
              </div>
            </button>
          ))}
        </div>

        <p style={{fontSize:10,color:"#334155",margin:0,lineHeight:1.5,borderTop:"1px solid #1e293b",paddingTop:"0.75rem"}}>
          PAPER TRADING ONLY — Not financial advice. Each instrument has its own signal engine, scorecard and risk model. Only the selected asset runs.
        </p>
      </div>
    </div>
  );
}
