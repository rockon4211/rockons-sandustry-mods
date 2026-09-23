const fs = require("fs"); const src = fs.readFileSync("../mods/screensaver/main.js", "utf8");
const IDS = { sand: 1, water: 3, wetSand: 4, gold: 5, residue: 6, steam: 10, lava: 11, seed: 12, wetSeed: 13, copper: 36, liquidCopper: 37, liquidGold: 38 };
const NAMES = { 1: "soil", 3: "Water", 4: "Wet Soil", 5: "Gold", 6: "Residue", 10: "Steam", 11: "Lava", 12: "Seed", 13: "Wet Seed", 36: "Copper", 37: "Liquid Copper", 38: "Liquid Gold" };
const byType = {}; for (const k in IDS) byType[IDS[k]] = k;
const defs = {}; for (const k in IDS) defs[IDS[k]] = { name: NAMES[IDS[k]], matterType: k === "water" ? 2 : 7, density: 1600, metaColor: 0x886644, colors: { variants: [[100, 80, 60, 255]] }, isGrabbable: true, somePhysics: 3 };
let next = 60; const regs = {}; const contacts = []; const recipes = [];
const cells = new Map(); const K = (x, y) => x + "," + y;
let NOW = 1e9; const RD = Date; global.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
global.performance = { now: () => NOW };
const queued = [];
global.sandkit = { api: {
  elements: { getResolvedTypeAtCell: (x, y) => cells.get(K(x, y)) || 0, getNameByType: (t) => (defs[t] || regs[t] || {}).name,
    getDefinitionByType: (t) => defs[t] || regs[t], getIdByType: (t) => byType[t] || (regs[t] && regs[t].id), getTypeFromId: (id) => IDS[id],
    register: (d) => { const t = next++; regs[t] = d; byType[t] = d.id; return { elementType: t }; },
    updateDefinition(t, p) { if (regs[t]) Object.assign(regs[t], p); }, replaceAtCell: (x, y, t) => queued.push({ x, y, t }), replaceAtCellWhenIdle: (x, y, t) => queued.push({ x, y, t }), isFreeFallingAtCell: () => false, getVelocityAtCell: () => ({ x: 0, y: 0 }) },
  reactions: { registerContact: (c) => contacts.push(c) },
  structures: { getAtCell: () => null, forEachOfType: () => {}, getTypeById: () => 5, getIdByType: () => "belt", recipes: { register: (m, r) => recipes.push([m, r]) } },
  settings: { get: () => undefined }, scene: { getActive: () => 3 }, ui: { update() {}, inject() {} }, events: { on() {} } },
  state: { session: { overrideCamera: false, ui: {}, settings: {}, view: { zoom: 2 }, rendering: { canvas: { width: 1920, height: 1080 } } }, store: { structures: [], player: { x: 0, y: 0 } } },
  enums: { Scene: { Game: 3, MainMenu: 0 }, ElementType: { Empty: 0 }, ComponentId: {}, MatterType: { Powder: 7, Solid: 1, Liquid: 2, Gas: 4, Slushy: 6 } }, react: null };
global.window = { addEventListener() {}, localStorage: { setItem() {}, getItem: () => null }, __brandonSandboxLoop: { sources: () => [], emitOnce() {}, emitOnceResult: () => null, cancelEmitOnce() {} } };
global.document = { addEventListener() {}, createElement: () => ({ remove() {} }), head: { appendChild() {} }, getElementById: () => null };
global.navigator = { wakeLock: { request: () => Promise.resolve({ release() {} }) } };
global.setInterval = () => 0; const timers = []; global.setTimeout = (fn, ms) => { timers.push({ fn, at: NOW + ms }); return 0; };
const log = console.log; console.log = () => {};
eval('"use strict";\n' + src.replace("function tick() {", "function modTick() {").replace("setInterval(tick, 33);", "")
  + "\nglobal.M = { get dbg(){return dbg}, get trc(){return trc}, set trc(v){trc=v}, modTick, set active(v){active=v}, set cam(v){cam=v}, get notes(){return recentNotes}, armCloneReactions, cloneOf, get armed(){return reactionsArmed} };");
M.active = true; M.armCloneReactions();
log("clones:", M.cloneOf.size, "armed:", M.armed, "contacts:", contacts.length, "recipes:", recipes.map(r => r[0]).join(","));
const cSand = M.cloneOf.get(1), cWet = M.cloneOf.get(4);
log("clone soil def:", JSON.stringify(regs[cSand]));
// clone soil sits at 100,100; water arrives next to it at t=2s; the game's contact table converts it
cells.set(K(100, 100), cSand);
M.trc = { t: cSand, orig: 1, x: 100, y: 100, lastMove: NOW, since: NOW - 10000, pending: false, tries: 0, hops: ["soil"], hopTypes: [1], search: null, moved: 10 };
for (let i = 0; i < 300; i++) {
  NOW += 33;
  if (i === 60) cells.set(K(101, 100), 3);
  if (i === 70) { // the game's contact: apply the registered rule
    const c = contacts.find(c => c.inputA === cells.get(K(100, 100)) && c.inputB === 3);
    if (c) { cells.set(K(100, 100), c.outputA); if (c.outputB === null) cells.delete(K(101, 100)); else cells.set(K(101, 100), c.outputB); }
  }
  while (queued.length) { const q = queued.shift(); cells.set(K(q.x, q.y), q.t); }
  M.modTick();
}
log("tracer now:", M.trc && M.trc.hops.join(" → "), "| phase:", M.dbg.phase, "| search:", !!(M.trc && M.trc.search));
log(M.notes.map(n => n.txt).join("\n"));
log("cell 100,100 is clone wet soil:", cells.get(K(100, 100)) === cWet, "| water became:", NAMES[cells.get(K(101, 100))]);
