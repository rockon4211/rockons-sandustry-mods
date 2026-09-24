// sim-clone.js — Screensaver 0.18+: the per-material copies ("clones") are built and taught
// the game's contact rule, and a tracer soil grain that touches water becomes the wet-soil
// copy and is still followed.
// Run from .handoff/:  node sim-clone.js   (exit 1 on any failed check — including "0 clones
// built", which older versions of this harness silently passed).
// Uses the same mock shape as sim-copies.js (0.18 reads the element list through
// getRegisteredTypes and the recipe tables through sandkit.mods.recipes).
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "mods", "screensaver", "main.js"), "utf8");
let ok = true; const check = (c, msg) => { console.log((c ? "  ok   " : "  FAIL ") + msg); if (!c) ok = false; };

const E = [["sand", 1, "soil", 1], ["water", 3, "Water", 2], ["wetSand", 4, "Wet Soil", 6], ["residue", 6, "Residue", 6],
	["gold", 7, "Gold", 1], ["steam", 10, "Steam", 4], ["flame", 13, "Flame", 1], ["seed", 15, "Seed", 1], ["wetSeed", 16, "Wet Seed", 6],
	["copper", 36, "Copper", 1], ["liquidCopper", 37, "Liquid Copper", 2]];
const IDS = {}, NAMES = {}, defs = {}, byType = {};
for (const [id, t, name, mt] of E) { IDS[id] = t; NAMES[t] = name; byType[t] = id; defs[t] = { name: name, matterType: mt, density: 100 + t, metaColor: 0x886644, colors: { variants: [[100, 80, 60, 255]] } }; }
defs[IDS.flame].duration = 0.28;
const T = (id) => IDS[id];
let next = 55; const regs = {}; const contacts = []; const recipes = [];
const recipeTable = { contacts: [], shakers: [], kineticPresses: [], growers: [], condensers: [], steamDryers: [], synthesizers: [], snowmakers: [],
	smelters: [{ input: T("copper"), outputs: [{ elementType: T("liquidCopper"), chance: 1 }] }] };
const cells = new Map(); const K = (x, y) => x + "," + y;
let NOW = 1e9; const RD = Date; global.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
global.performance = { now: () => NOW };
const queued = [];
global.sandkit = { api: {
	elements: { getRegisteredTypes: () => Object.keys(defs).map(Number).concat(Object.keys(regs).map(Number)).sort((a, b) => a - b),
		getResolvedTypeAtCell: (x, y) => cells.get(K(x, y)) || 0, getInfoAtCell: (x, y) => ({ elementType: cells.get(K(x, y)), isParticle: false }),
		getNameByType: (t) => (defs[t] || regs[t] || {}).name, getDefinitionByType: (t) => defs[t] || regs[t],
		getIdByType: (t) => byType[t], getTypeFromId: (id) => { for (const k in byType) if (byType[k] === id) return +k; return undefined; },
		register: (d) => { const t = next++; regs[t] = JSON.parse(JSON.stringify(d)); byType[t] = d.id; return { elementType: t }; },
		updateDefinition(t, p) { if (regs[t]) Object.assign(regs[t], p); }, replaceAtCell: (x, y, t) => queued.push({ x, y, t }), replaceAtCellWhenIdle: (x, y, t) => queued.push({ x, y, t }),
		removeAtCell: (x, y) => queued.push({ x, y, t: 0 }), isFreeFallingAtCell: () => false, getVelocityAtCell: () => ({ x: 0, y: 0 }) },
	reactions: { registerContact: (c) => { if (c.inputA === undefined || c.inputB === undefined) throw new Error("bad contact"); contacts.push(c); } },
	structures: { getAtCell: () => null, forEachOfType: () => {}, getTypeById: () => 5, recipes: { register: (m, r) => recipes.push([m, r]) } },
	settings: { get: () => undefined }, scene: { getActive: () => 3 }, ui: { update() {}, inject() {}, toast() {} }, events: { on() {} } },
	state: { sandkit: { mods: { recipes: recipeTable } }, session: { overrideCamera: false, ui: {}, settings: {}, view: { zoom: 2 }, rendering: { canvas: { width: 1920, height: 1080 } } }, store: { structures: [], player: { x: 0, y: 0 } } },
	enums: { Scene: { Game: 3, MainMenu: 0 }, ElementType: { Empty: 0 }, ComponentId: {}, MatterType: { Solid: 1, Liquid: 2, Gas: 4, Slushy: 6, Powder: 7, Static: 8, Wisp: 9, Particle: 99 } }, react: null };
global.window = { addEventListener() {}, localStorage: { setItem() {}, getItem: () => null }, __brandonSandboxLoop: { sources: () => [], emitOnce() {}, emitOnceResult: () => null, cancelEmitOnce() {} } };
global.document = { addEventListener() {}, createElement: () => ({ remove() {} }), head: { appendChild() {} }, getElementById: () => null };
global.navigator = { wakeLock: { request: () => Promise.resolve({ release() {} }) } };
global.setInterval = () => 0; const timers = []; global.setTimeout = (fn, ms) => { timers.push({ fn, at: NOW + ms }); return 0; };
const log = console.log; console.log = () => {};
eval('"use strict";\n' + src.replace("function tick() {", "function modTick() {").replace("setInterval(tick, 33);", "")
	+ "\nglobal.M = { get dbg(){return dbg}, get trc(){return trc}, set trc(v){trc=v}, modTick, set active(v){active=v}, get notes(){return recentNotes}, armCloneReactions, cloneOf, get armed(){return reactionsArmed} };");
console.log = log;

const C = (id) => M.cloneOf.get(T(id));
check(M.cloneOf.size > 0, "clones built: " + M.cloneOf.size);
check(!!C("sand") && !!C("wetSand") && !!C("water"), "soil, wet soil and water each have a copy");
check(C("sand") && regs[C("sand")] && regs[C("sand")].density === defs[T("sand")].density, "the soil copy has soil's density");
M.active = true; M.armCloneReactions();
check(M.armed > 0, "reactions armed: " + M.armed + " (contacts " + contacts.length + ", machine recipes " + recipes.length + ")");
const rule = contacts.find((c) => c.inputA === C("sand") && c.inputB === T("water"));
check(!!rule && rule.outputA === C("wetSand"), "contact rule: soil copy + water -> wet soil copy");

// drive it: the soil copy sits at 100,100, water arrives next to it, the game applies the rule
cells.set(K(100, 100), C("sand"));
M.trc = { t: C("sand"), orig: T("sand"), x: 100, y: 100, lastMove: NOW, since: NOW - 10000, pending: false, tries: 0, hops: ["soil"], hopTypes: [T("sand")], search: null, moved: 10 };
for (let i = 0; i < 300; i++) {
	NOW += 33;
	if (i === 60) cells.set(K(101, 100), T("water"));
	if (i === 70 && rule) { cells.set(K(100, 100), rule.outputA); if (rule.outputB === null) cells.delete(K(101, 100)); else cells.set(K(101, 100), rule.outputB); }
	while (queued.length) { const q = queued.shift(); if (q.t) cells.set(K(q.x, q.y), q.t); else cells.delete(K(q.x, q.y)); }
	while (timers.length && timers[0].at <= NOW) timers.shift().fn();
	M.modTick();
}
check(cells.get(K(100, 100)) === C("wetSand"), "cell 100,100 is now the wet soil copy");
check(!!M.trc && !M.trc.search && M.trc.orig === T("wetSand"), "still following it, now as wet soil: " + (M.trc ? M.trc.hops.join(" -> ") : "(no tracer)") + " | phase: " + M.dbg.phase);
console.log(ok ? "\nALL OK" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
