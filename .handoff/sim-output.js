// A shaker at (200,150) eats wetSand and drops BOTH gold and residue into an output pile below it.
// The tracer arrives as wetSand, is consumed, picks up the gold that falls out, and must KEEP it —
// the old rules handed it straight back (touching residue / sitting on the machine) and hopped.
const fs = require("fs"); const src = fs.readFileSync("../mods/screensaver/main.js", "utf8");
const T = { sand: 1, wetSand: 2, gold: 3, residue: 4, water: 5 };
const NAME = { 1: "soil", 2: "Wet Soil", 3: "Gold", 4: "Residue", 5: "Water" };
const ID = { 1: "sand", 2: "wetSand", 3: "gold", 4: "residue", 5: "water" };
const cells = new Map(); const K = (x, y) => x + "," + y;
const machine = new Set(); for (let x = 196; x <= 204; x++) for (let y = 146; y <= 154; y++) machine.add(K(x, y));
let NOW = 1e9; const RD = Date; global.Date = class extends RD { constructor(...a){ super(...(a.length?a:[NOW])); } static now(){ return NOW; } }; global.performance = { now: () => NOW };
const queued = []; let tracerTypeSet = new Set();
global.sandkit = { api: {
  elements: { getResolvedTypeAtCell: (x, y) => cells.get(K(x, y)) || 0, getNameByType: (t) => NAME[t] || "tracer",
    getDefinitionByType: (t) => ({ name: NAME[t], matterType: 7, density: 1600, metaColor: 0x888888, colors: { variants: [[128,128,128,255]] } }),
    getIdByType: (t) => ID[t], getTypeFromId: (id) => T[id], register: (d) => { const t = 90 + tracerTypeSet.size; tracerTypeSet.add(t); return { elementType: t }; },
    updateDefinition() {}, replaceAtCell: (x, y, t) => queued.push({ x, y, t }), replaceAtCellWhenIdle: (x, y, t) => queued.push({ x, y, t }), isFreeFallingAtCell: () => false },
  structures: { getAtCell: (x, y) => machine.has(K(x, y)) ? { type: 77, x: 196, y: 146 } : null, forEachOfType: () => {}, getTypeById: () => undefined, getIdByType: () => "shaker" },
  settings: { get: (k) => ({ useTracer: true, followGrain: true, handBackSeconds: 2, pileSeconds: 25, handoffSeconds: 8, followMaxSeconds: 900, mixTour: false, enabled: true })[k] },
  scene: { getActive: () => 3 }, ui: { update() {}, inject() {} }, events: { on() {} } },
  state: { session: { overrideCamera: false, camera: { x: 0, y: 0 }, ui: {}, settings: {}, view: { zoom: 2 }, rendering: { canvas: { width: 1920, height: 1080 } } }, store: { structures: [], player: { x: 0, y: 0 } } },
  enums: { Scene: { Game: 3, MainMenu: 0 }, ElementType: { Empty: 0 }, ComponentId: {}, MatterType: { Powder: 7, Solid: 1, Liquid: 2, Gas: 4, Slushy: 6 } }, react: null };
global.window = { addEventListener() {}, localStorage: { setItem() {}, getItem: () => null }, __brandonSandboxLoop: { sources: () => [], emitOnce() {}, emitOnceResult: () => null, cancelEmitOnce() {} } };
global.document = { addEventListener() {}, createElement: () => ({ remove() {} }), head: { appendChild() {} }, getElementById: () => null };
global.navigator = { wakeLock: { request: () => Promise.resolve({ release() {} }) } };
const timers = []; global.setInterval = () => 0; global.setTimeout = (fn, ms) => { timers.push({ fn, at: NOW + ms }); return 0; };
console.log = () => {};
eval('"use strict";\n' + src.replace("function tick() {", "function modTick() {").replace("setInterval(tick, 33);", "")
  + "\nglobal.M = { get dbg(){return dbg}, get trc(){return trc}, set trc(v){trc=v}, modTick, set active(v){active=v}, set cam(v){cam=v}, tracerTypes };");
M.active = true; M.cam = null;
// the tracer (as Wet Soil) rides a belt into the machine at x=196
const tt = [...M.tracerTypes][0];
let pos = { x: 170, y: 150 }; cells.set(K(pos.x, pos.y), tt);
M.trc = { t: tt, orig: T.wetSand, x: pos.x, y: pos.y, lastMove: NOW, since: NOW - 10000, pending: false, tries: 0, hops: ["Wet Soil"], hopTypes: [T.wetSand], search: null, moved: 20 };
let consumedAt = null, hops = 0, lastHops = "";
for (let i = 0; i < 700; i++) {
  NOW += 33;
  // ride into the machine; the machine eats it (cell vanishes)
  const cur = [...cells.entries()].find(([, t]) => M.tracerTypes.has(t));
  if (cur && !consumedAt) { const [k] = cur; const [x, y] = k.split(",").map(Number); cells.delete(k); if (x + 1 >= 196) { consumedAt = i; } else cells.set(K(x + 1, y), tt); }
  // 1s after consuming: the shaker drops a gold with residue around it, then more residue keeps falling
  if (consumedAt && i === consumedAt + 30) { cells.set(K(200, 156), T.gold); for (const [dx, dy] of [[-1,0],[1,0],[0,1],[-1,1],[1,1]]) cells.set(K(200 + dx, 156 + dy), T.residue); }
  if (consumedAt && i > consumedAt + 30 && i % 20 === 0) cells.set(K(198 + (i % 5), 157), T.residue);
  while (queued.length) { const q = queued.shift(); if (cells.get(K(q.x, q.y))) cells.set(K(q.x, q.y), q.t); }
  while (timers.length && timers[0].at <= NOW) timers.shift().fn();
  M.modTick();
  const h = M.trc ? M.trc.hops.join("→") : "-";
  if (h !== lastHops) { hops++; console.error((i * 33 / 1000).toFixed(1) + "s: " + h + " | " + M.dbg.phase + " | " + M.dbg.note); lastHops = h; }
}
console.error("final:", M.trc ? (M.trc.hops.join("→") + " riding=" + !M.trc.search) : "none", "| hop changes:", hops);
