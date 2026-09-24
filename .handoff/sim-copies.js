// sim-copies.js — Screensaver 0.18: every material gets a copy that carries its recipes.
// Run from .handoff/:  node sim-copies.js
// Mocks the game's element list and its recipe tables (sandkit.mods.recipes), evals the real
// main.js in strict mode, then checks: which copies exist, what each was taught (touch, burn,
// machines — with the gold rule and the main-product rule), and drives four scenes:
//   A) wet soil sits on a Launcher (#7)          → must NOT be handed back (0.17 did)
//   B) residue catches fire                       → waits, comes back as burnt residue copy
//   C) wet seed handed back on a planter; Copper appears nearby → must NOT pick Copper;
//      Amethelis (petalium) appears → picks it
//   D) wet soil on a Shaker it has a recipe for   → no hand-back while the machine works
const fs = require("fs"); const src = fs.readFileSync(__dirname + "/../mods/screensaver/main.js", "utf8");
let ok = true; const check = (c, msg) => { console.log((c ? "  ok   " : "  FAIL ") + msg); if (!c) ok = false; };
// element list (ids as the game has them; numbers as on Loamcrest-ish)
const E = [["sand", 1, "soil", 1, {}], ["particle", 2, "Particle", 99, {}], ["water", 3, "Water", 2, {}], ["wetSand", 4, "Wet Soil", 6, {}], ["residue", 6, "Residue", 6, {}],
	["gold", 7, "Gold", 1, {}], ["steam", 10, "Steam", 4, {}], ["fire", 11, "Fire", 4, { duration: 1.28 }], ["flame", 13, "Flame", 1, { duration: 0.28 }], ["burntResidue", 14, "Burnt Residue", 1, {}],
	["seed", 15, "Seed", 1, {}], ["wetSeed", 16, "Wet Seed", 6, {}], ["seedling", 17, "Seedling", 8, { durationRandom: { min: 0.1, max: 0.5 } }], ["petalium", 18, "Amethelis", 9, {}], ["lava", 19, "Lava", 2, { duration: 0.28 }],
	["florin", 30, "Florin", 4, {}], ["dryPetalium", 31, "Dry Amethelis", 9, { flammable: { outputElementId: "florin", outputChance: 0.5, fireInheritsDuration: true, duration: [0.05, 0.3] } }],
	["florinol", 32, "Florinol", 2, {}], ["liquidGold", 33, "Liquid Gold", 2, { collectable: { value: 2 } }], ["copper", 36, "Copper", 1, {}], ["liquidCopper", 37, "Liquid Copper", 2, {}],
	["aurixite", 40, "Aurixite", 1, {}], ["cloud", 41, "Cloud", 4, {}], ["Sand", 54, "Sand", 1, {}]];
const IDS = {}, NAMES = {}, defs = {}, byType = {};
for (const [id, t, name, mt, extra] of E) { IDS[id] = t; NAMES[t] = name; byType[t] = id; defs[t] = Object.assign({ name: name, matterType: mt, density: 100 + t, metaColor: 0x886644, colors: { variants: [[100, 80, 60, 255]] } }, extra); }
defs[IDS.wetSand].getExtraProps = () => ({});   // functions must not be copied
let next = 55; const regs = {}; const contacts = []; const recipes = [];
const T = (id) => IDS[id];
const recipeTable = { contacts: [], shakers: [], kineticPresses: [], growers: [],
	condensers: [{ input: T("florin"), outputs: [{ elementType: T("gold"), chance: 0.5 }, { elementType: T("florinol"), chance: 0.5 }] }, { input: T("steam"), outputs: [{ elementType: T("water"), chance: 1 }] }],
	steamDryers: [{ input: T("petalium"), outputs: [{ elementType: T("dryPetalium"), chance: 1 }] }],
	synthesizers: [{ input: T("florinol"), outputs: [{ elementType: T("aurixite"), chance: 1 }] }], snowmakers: [],
	smelters: [{ input: T("copper"), outputs: [{ elementType: T("liquidCopper"), chance: 1 }] }, { input: T("gold"), outputs: [{ elementType: T("liquidGold"), chance: 0.5 }] }] };
const cells = new Map(); const K = (x, y) => x + "," + y;
const structs = new Map();   // "x,y" -> structure
let NOW = 1e9; const RD = Date; global.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
global.performance = { now: () => NOW };
const queued = [];
global.sandkit = { api: {
	elements: { getRegisteredTypes: () => Object.keys(defs).map(Number).concat(Object.keys(regs).map(Number)).sort((a, b) => a - b),
		getResolvedTypeAtCell: (x, y) => cells.get(K(x, y)) || 0, getInfoAtCell: (x, y) => ({ elementType: cells.get(K(x, y)), isParticle: false }),
		getNameByType: (t) => (defs[t] || regs[t] || {}).name, getDefinitionByType: (t) => defs[t] || regs[t],
		getIdByType: (t) => byType[t], getTypeFromId: (id) => { for (const k in byType) if (byType[k] === id) return +k; return undefined; },
		register: (d) => { const t = next++; regs[t] = JSON.parse(JSON.stringify(d)); byType[t] = d.id; return { elementType: t }; },
		updateDefinition(t, p) { if (regs[t]) Object.assign(regs[t], p); }, replaceAtCell: (x, y, t) => queued.push({ x, y, t }), removeAtCell: (x, y) => queued.push({ x, y, t: 0 }),
		isFreeFallingAtCell: () => false, getVelocityAtCell: () => ({ x: 0, y: 0 }) },
	reactions: { registerContact: (c) => { if (c.inputA === undefined || c.inputB === undefined) throw new Error("bad contact"); contacts.push(c); } },
	structures: { getAtCell: (x, y) => structs.get(K(x, y)) || null, forEachOfType: () => {}, getTypeById: () => 5, recipes: { register: (m, r) => { if (m === "synthesizer" && recipes.some((q) => q[0] === m && q[1].outputs.some((o) => o.elementType === r.input))) throw new Error("Synthesizer inputs cannot be outputs of another Synthesizer recipe."); recipes.push([m, r]); } } },
	settings: { get: () => undefined }, scene: { getActive: () => 3 }, ui: { update() {}, inject() {}, toast() {} }, events: { on() {} } },
	state: { sandkit: { mods: { recipes: recipeTable } }, session: { overrideCamera: false, ui: {}, settings: {}, view: { zoom: 2 }, rendering: { canvas: { width: 1920, height: 1080 } } }, store: { structures: [], player: { x: 0, y: 0 } } },
	enums: { Scene: { Game: 3, MainMenu: 0 }, ElementType: { Empty: 0 }, ComponentId: {}, MatterType: { Solid: 1, Liquid: 2, Gas: 4, Slushy: 6, Powder: 7, Static: 8, Wisp: 9, Particle: 99 } }, react: null };
global.window = { addEventListener() {}, localStorage: { setItem() {}, getItem: () => null }, __brandonSandboxLoop: { sources: () => [], emitOnce() {}, emitOnceResult: () => null, cancelEmitOnce() {} } };
global.document = { addEventListener() {}, createElement: () => ({ remove() {} }), head: { appendChild() {} }, getElementById: () => null };
global.navigator = { wakeLock: { request: () => Promise.resolve({ release() {} }) } };
global.setInterval = () => 0; const timers = []; global.setTimeout = (fn, ms) => { timers.push({ fn, at: NOW + ms }); return 0; };
const log = console.log; console.log = () => {};
eval('"use strict";\n' + src.replace("function tick() {", "function modTick() {").replace("setInterval(tick, 33);", "")
	+ "\nglobal.M = { get dbg(){return dbg}, get trc(){return trc}, set trc(v){trc=v}, modTick, set active(v){active=v}, get notes(){return recentNotes}, armCloneReactions, cloneOf, realOf, nextOf, cloneMachines, covered, get armed(){return reactionsArmed}, get errors(){return armErrors}, get log(){return tlog} };");
console.log = log;
const C = (id) => M.cloneOf.get(T(id)), cdef = (id) => regs[C(id)];
console.log("== copies");
check(M.cloneOf.size === E.length - 3, "a copy of every material except Particle/Fire/Flame (" + M.cloneOf.size + ")");
check(!C("fire") && !C("flame") && !M.cloneOf.has(2), "no copy of fire, flame or particle");
check(!!C("Sand") && !!C("sand") && C("Sand") !== C("sand"), "Manufacturing's golden Sand and vanilla soil each get their own copy");
check(cdef("sand").name === "· soil" && cdef("sand").density === defs[1].density && cdef("sand").matterType === 1, "copy keeps name/density/matter type");
check(cdef("wetSand").getExtraProps === undefined && cdef("seedling").durationRandom === undefined, "functions and timers are not copied");
check(JSON.stringify(cdef("residue").flammable) === JSON.stringify({ outputElementId: "brandonTrc_burntResidue", outputChance: 1 }), "residue copy burns into the burnt-residue COPY, always");
check(cdef("dryPetalium").flammable.outputElementId === "brandonTrc_florin" && cdef("dryPetalium").flammable.outputChance === 1 && cdef("dryPetalium").flammable.fireInheritsDuration === true, "dry amethelis copy burns into the florin copy, keeps its burn settings");
check(cdef("liquidGold").collectable && cdef("liquidGold").collectable.value === 2, "other properties carried over (liquid gold stays collectable)");
M.active = true; M.armCloneReactions();
console.log("== what the copies were taught (" + M.armed + " rules, " + M.errors + " refused)");
const ct = (a, b) => contacts.find((c) => c.inputA === C(a) && c.inputB === T(b));
check(ct("sand", "water") && ct("sand", "water").outputA === C("wetSand") && ct("sand", "water").outputB === T("wetSand"), "soil copy + water → wet soil copy (+ real wet soil)");
check(ct("water", "sand") && ct("water", "sand").outputA === C("wetSand"), "water copy + soil → wet soil copy");
check(ct("seed", "water") && ct("seed", "water").outputA === C("wetSeed") && ct("seed", "water").outputB === null, "seed copy + water → wet seed copy (water used up)");
check(ct("water", "flame") && ct("water", "flame").outputA === C("steam"), "water copy + flame → steam copy");
const rec = (m, id) => recipes.filter((r) => r[0] === m && r[1].input === C(id)).map((r) => r[1])[0];
check(rec("condenser", "florin") && rec("condenser", "florin").outputs.length === 1 && rec("condenser", "florin").outputs[0].elementType === C("florinol") && rec("condenser", "florin").outputs[0].chance === 1, "condenser: florin copy → florinol copy (never gold)");
check(!rec("smelter", "gold") || rec("smelter", "gold").outputs[0].elementType === C("liquidGold"), "smelter: gold copy → liquid gold copy");
check(rec("smelter", "copper") && rec("smelter", "copper").outputs[0].elementType === C("liquidCopper"), "smelter: copper copy → liquid copper copy");
check(rec("steamDryer", "petalium") && rec("steamDryer", "petalium").outputs[0].elementType === C("dryPetalium"), "steam dryer: amethelis copy → dry amethelis copy");
const sh = rec("shaker", "wetSand");
check(sh && sh.outputsAbove[0].elementType === C("residue") && sh.outputsAbove[0].chance === 1 && sh.outputsBelow[0].elementType === T("gold") && sh.outputsBelow[0].chance === 0.25, "shaker: wet soil copy → residue copy on top, real gold below 1 in 4");
const kp = rec("kineticPress", "burntResidue");
check(kp && kp.outputs.some((o) => o.elementType === C("seed") && o.chance === 1) && kp.outputs.some((o) => o.elementType === T("gold")), "kinetic press: burnt residue copy → seed copy (+ real gold)");
check(rec("synthesizer", "florinol") && rec("synthesizer", "florinol").outputs[0].elementType === C("aurixite"), "synthesizer: florinol copy → aurixite copy");
const nx = [...M.nextOf(T("wetSeed")).keys()].map((t) => NAMES[t]);
check(nx.includes("Amethelis") && !nx.includes("Seedling") && !nx.includes("Gold"), "after wet seed, look for Amethelis (skip the seedling stage, never gold): " + nx.join(", "));
const before = recipes.length + contacts.length; M.armCloneReactions();
check(recipes.length + contacts.length === before, "re-arming sends nothing new when nothing changed");

// helpers to run the tracker
const step = (n, each) => { for (let i = 0; i < n; i++) { NOW += 33; if (each) each(i); while (queued.length) { const q = queued.shift(); if (q.t) cells.set(K(q.x, q.y), q.t); else cells.delete(K(q.x, q.y)); } M.modTick(); } };
const ride = (id, x, y) => { cells.clear(); structs.clear(); cells.set(K(x, y), C(id)); M.trc = { t: C(id), orig: T(id), x: x, y: y, lastMove: NOW, since: NOW - 10000, pending: false, tries: 0, hops: [NAMES[T(id)]], hopTypes: [T(id)], search: null, moved: 20 }; };

console.log("== A) wet soil resting on a Launcher (structure #7)");
ride("wetSand", 200, 200); structs.set(K(200, 200), { type: 7, x: 200, y: 200 });
step(150);
check(M.trc && !M.trc.search && M.trc.orig === T("wetSand"), "still riding our wet soil after 5s on the launcher (phase: " + M.dbg.phase + ")");

console.log("== B) residue catches fire");
ride("residue", 300, 300);
step(10);
cells.set(K(300, 300), T("flame"));            // the fire code swaps the grain for a Flame…
step(25);
check(M.trc && !M.trc.search && /burning/.test(M.dbg.phase), "waits while it burns (phase: " + M.dbg.phase + ")");
cells.set(K(300, 300), C("burntResidue"));     // …which leaves the burnt-residue copy behind
step(5);
check(M.trc && M.trc.orig === T("burntResidue") && !M.trc.search, "followed it: " + (M.trc && M.trc.hops.join(" → ")));

console.log("== C) wet seed on a Planter Box, copper shows up nearby");
ride("wetSeed", 400, 400); structs.set(K(400, 401), { type: 21, x: 400, y: 401 });
step(100);
check(M.trc && M.trc.search, "handed back on the planter (it has no copy recipe there)");
cells.set(K(400, 400), T("wetSeed")); cells.set(K(403, 398), T("copper"));
step(150);
check(M.trc && M.trc.search, "did not pick up the Copper (not something wet seed turns into)");
cells.set(K(398, 395), T("petalium"));
step(100);
check(M.trc && !M.trc.search && M.trc.orig === T("petalium"), "picked up the Amethelis the flower made: " + (M.trc && M.trc.hops.join(" → ")));

console.log("== D) wet soil on a Shaker that has its copy recipe");
ride("wetSand", 500, 500); structs.set(K(500, 501), { type: 4, x: 500, y: 501 });
step(300);
check(M.trc && !M.trc.search, "not handed back while the shaker works on it (phase: " + M.dbg.phase + ")");
cells.set(K(500, 500), C("residue"));
step(5);
check(M.trc && M.trc.orig === T("residue"), "wet soil → residue on the shaker, still our grain");

console.log(ok ? "\nALL OK" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
