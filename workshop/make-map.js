// Build a clean walled "Workshop" map and validate it with Map Studio's own
// playability checker before we ship it. Terrain colour table (fixed by the game):
//   255,255,255 = Empty/sky (records surface height)   170,170,170 = Stone
//   255,0,0 = fixture marker (>=1 required)            alpha 0 = Fog
const Gen = require("/home/claude/smods/docs/map-studio/generator.js");
const sharp = require("sharp");
const fs = require("fs");

const W = 384, H = 320;                 // must be tall enough that y=200 has ground below
const SPAWN_Y = Gen.SPAWN_CELL_Y;       // 200 — the game drops the player here, ignoring the map
const FLOOR_TOP = 280;                  // stone floor from here down
const WALL = 5;                         // side-wall thickness (cells)

const WHITE=[255,255,255,255], STONE=[170,170,170,255], RED=[255,0,0,255];
const data = new Uint8ClampedArray(W*H*4);
const put=(x,y,c)=>{const o=4*(x+y*W);data[o]=c[0];data[o+1]=c[1];data[o+2]=c[2];data[o+3]=c[3];};

for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  let c=WHITE;
  if(y>=FLOOR_TOP) c=STONE;                        // floor slab
  else if(x<WALL || x>=W-WALL) c=STONE;            // side walls (open ceiling for light)
  put(x,y,c);
}
// one fixture marker, sitting just above the floor near centre (cell left empty)
put(Math.floor(W/2), FLOOR_TOP-2, RED);

// ---- validate with the generator's own checker ----
const rep = Gen.inspect(data, W, H);
console.log("problems:", rep.problems.length ? rep.problems : "none");
console.log("unknown colours:", rep.unknown);
console.log("spawnClear:", rep.spawnClear, "| groundBelow:", rep.groundBelow, "(need >"+SPAWN_Y+")");
if(rep.problems.length || rep.unknown>0){ console.error("MAP INVALID — not writing."); process.exit(1); }

// ---- encode the six layers as PNG data URLs ----
async function png(buf){ return "data:image/png;base64,"+(await sharp(Buffer.from(buf),{raw:{width:W,height:H,channels:4}}).png().toBuffer()).toString("base64"); }
const blank = new Uint8ClampedArray(W*H*4);   // fully transparent → valid empty layer
(async()=>{
  const terrainUrl = await png(Buffer.from(data.buffer));
  const blankUrl   = await png(Buffer.from(blank.buffer));
  const id = "brandon_workshop_v0";
  const layer = u => ({width:W,height:H,dataUrl:u});
  const record = {
    id, name:"Brandon's Workshop", seed:"workshop-v0",
    createdAt:new Date().toISOString(), version:"0.5.2",
    params:{width:W,height:H,scale:0.5,threshold:0.5,cellSize:1},
    terrain:layer(terrainUrl), lights:layer(blankUrl), lightsMeta:layer(blankUrl),
    sensors:layer(blankUrl), authorization:layer(blankUrl), wall:layer(blankUrl),
    prefabPlacements:[], foliageClusters:[], wallCracks:[]
  };
  const meta = {id:record.id,name:record.name,seed:record.seed,createdAt:record.createdAt,version:record.version,params:record.params};
  const text = JSON.stringify(meta)+"\n"+JSON.stringify(record);
  fs.writeFileSync(id+".custommap", text);
  console.log("\nwrote "+id+".custommap ("+(text.length/1024).toFixed(1)+" KB), id="+id);
})();
