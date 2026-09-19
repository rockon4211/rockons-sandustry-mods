// Source (green hopper, emits) + Remover (solid red block, deletes what lands on
// top). Both 48x48 = 12x12 cells. The Remover's TOP row glows to show that's the
// surface material rests on and is eaten from.
const sharp = require("sharp");
const CW=12, CH=12, P=4, W=CW*P, H=CH*P;
function build(name, shape, body, dark, accent, topGlow){
  const buf = Buffer.alloc(W*H*4, 0);
  const set=(x,y,c)=>{if(x<0||y<0||x>=W||y>=H)return;const o=4*(x+y*W);buf[o]=c[0];buf[o+1]=c[1];buf[o+2]=c[2];buf[o+3]=c[3];};
  // find the top solid row of each column, to paint a glowing "consume" surface
  const topOf=[];
  for(let cx=0;cx<CW;cx++){ let t=-1; for(let cy=0;cy<CH;cy++){ if(shape[cy][cx]){t=cy;break;} } topOf[cx]=t; }
  for(let cy=0;cy<CH;cy++)for(let cx=0;cx<CW;cx++){
    if(!shape[cy][cx])continue;
    const isTop = topGlow && cy===topOf[cx];
    for(let py=0;py<P;py++)for(let px=0;px<P;px++){
      const x=cx*P+px,y=cy*P+py;
      const outer=(px===0||py===0||px===P-1||py===P-1);
      set(x,y, isTop ? (py<=1 ? topGlow : body) : (outer?dark:body));
    }
    if(!isTop) set(cx*P+1,cy*P+1,accent);
  }
  return sharp(buf,{raw:{width:W,height:H,channels:4}}).png().toFile(name);
}
const SRC=[[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[0,0,0,0,1,1,1,1,0,0,0,0],[0,0,0,0,1,0,0,1,0,0,0,0]];
// Remover is now a SOLID block — material lands on top and is eaten from the surface.
const SNK=[[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1]];
Promise.all([
  build("source.png", SRC, [72,150,96,255],[44,96,60,255],[150,220,170,255], null),
  build("sink.png",   SNK, [150,66,66,255],[92,40,40,255],[190,120,120,255], [255,180,120,255]),
]).then(()=>console.log("wrote source.png + sink.png"));
