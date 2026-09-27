// sim-loop.js — Sandbox Loop: a Source keeps the material baked into it, by element ID,
// and only falls back to the panel default when nothing usable is baked.
// Run from anywhere:  node .handoff/sim-loop.js   (exit 1 on any failed check)
//
// The old version of this harness only ever checked that three setups all resolved to the
// DEFAULT material — which every broken cfgFor would also do. So here a NON-default material
// ("glassSand", Manufacturing's golden Sand, numbered 61 on one PC and 74 on the other) is
// baked into a structure and the Source must emit THAT while the panel default stays soil.
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "mods", "sandboxloop", "main.js"), "utf8");
let ok = true; const check = (c, msg) => { console.log((c ? "  ok   " : "  FAIL ") + msg); if (!c) ok = false; };

// one mocked game: `ids` = element id -> number on this PC, `names` = number -> display name,
// `storedCfg` = the pre-0.4.0 localStorage entry, `structData` = what the save carries on the structure
function run(label, ids, names, storedCfg, structData) {
	const byType = {}; for (const k in ids) byType[ids[k]] = k;
	let NOW = 1e9; const RD = Date; global.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
	global.performance = { now: () => NOW };
	const store = {}; if (storedCfg) store["brandon.sandboxloop.instances"] = JSON.stringify(storedCfg);
	const structs = [{ type: "brandonSandboxSource", x: 100, y: 100, data: structData ? Object.assign({}, structData) : {} }];
	const updates = [];
	global.sandkit = { api: {
		elements: { getRegisteredTypes: () => Object.values(ids), getNameByType: (t) => names[t], getIdByType: (t) => byType[t], getTypeFromId: (id) => ids[id],
			getDefinitionByType: (t) => ({ name: names[t], matterType: 7, metaColor: 0x888888 }), getResolvedTypeAtCell: () => 0,
			createAtCellWhenIdle() {}, removeAtCellWhenIdle() {}, replaceAtCell() {} },
		structures: { register() {}, forEachOfType: (id, cb) => structs.filter((s) => s.type === id).forEach(cb), getAtCell: () => null, recipes: { register() {} },
			updateData: (s, patch) => { updates.push(patch); if (!s.data) s.data = {}; Object.assign(s.data, patch); } },
		world: { isTerrainAtCell: () => false, getDimensions: () => ({ widthCells: 100, heightCells: 100 }) }, settings: { get: () => undefined }, scene: { getActive: () => 4 },
		time: { getTick: () => 1 },
		ui: { update() {}, inject() {}, toast() {} }, events: { on() {} }, sprites: { loadFromMod() {} }, i18n: { register() {} } },
		state: { session: { ui: {}, settings: {}, paused: false }, store: { structures: structs, meta: { worldId: "w1" } } },
		enums: { Scene: { MainMenu: 1, Intro: 2, Deploy: 3, Game: 4 }, ElementType: { Empty: 0 }, ComponentId: {}, MatterType: { Powder: 7, Particle: 2 } },
		react: { createElement: () => null, useState: () => [0, () => {}], useEffect: () => {} } };
	global.window = { addEventListener() {}, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } } };
	global.document = { addEventListener() {}, createElement: () => ({ remove() {}, click() {}, style: {} }), head: { appendChild() {} }, body: { appendChild() {} }, getElementById: () => null };
	global.setInterval = () => 0; global.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; };
	const log = console.log; console.log = () => {}; console.error = () => {};
	eval('"use strict";\n' + src + "\nglobal.L = { defaultType, cfgFor, bake, get emitCfg(){return emitCfg}, buildPalette };");
	console.log = log;
	const panel = { mat: L.emitCfg.mat, type: L.emitCfg.type, rate: L.emitCfg.rate };
	const cfg = L.cfgFor(structs[0], panel);
	log("== " + label);
	log("   panel default:", names[L.defaultType()], "(type " + L.defaultType() + ")  panel:", JSON.stringify(panel));
	log("   Source emits:", names[cfg.type], "(type " + cfg.type + ", rate " + cfg.rate + (cfg.unset ? ", unset" : "") + ") | on the structure:", JSON.stringify(structs[0].data));
	return { cfg, panel, def: L.defaultType(), struct: structs[0], names, ids, store, updates, L };
}
// desktop: vanilla sand renamed to soil by Manufacturing, plus its golden Sand at type 61
const DESK = { sand: 1, water: 3, copper: 36, glassSand: 61 };
const DNAM = { 1: "soil", 3: "Water", 36: "Copper", 61: "Sand" };
// laptop: same mods, but the golden Sand landed on a different number
const LAP = { sand: 1, water: 3, copper: 36, glassSand: 74 };
const LNAM = { 1: "soil", 3: "Water", 36: "Copper", 74: "Sand" };
// a PC without Manufacturing: no "glassSand" at all
const BARE = { sand: 1, water: 3, copper: 36 };
const BNAM = { 1: "soil", 3: "Water", 36: "Copper" };

// --- 1. the default: nothing usable baked -> the panel's material, flagged unset ------
const a = run("desktop, old numeric store only (pre-0.4.0), nothing on the structure", DESK, DNAM, { "100,100": { type: 61, rate: 3 } }, null);
check(a.def === DESK.sand, "panel default is vanilla sand (soil) by id, not Manufacturing's golden 'Sand' by name");
check(a.cfg.type === DESK.sand && a.cfg.unset === true, "a number-only pre-0.4.0 entry (61 = golden Sand here) is ignored: Source follows the panel (soil) and is flagged unset");
const b = run("laptop, fresh install, nothing stored", LAP, LNAM, null, null);
check(b.cfg.type === LAP.sand && b.cfg.unset === true, "fresh PC: Source follows the panel default (soil), flagged unset");

// --- 2. a NON-default material baked by element id travels with the save ---------------
const c = run("desktop, save carries glassSand baked on the structure", DESK, DNAM, null, { brandonMat: "glassSand", brandonRate: 2.5 });
check(c.cfg.type === DESK.glassSand && c.names[c.cfg.type] === "Sand", "desktop: Source emits golden Sand (type 61) while the panel default is soil (type " + c.def + ")");
check(c.cfg.rate === 2.5 && !c.cfg.unset, "the baked rate (2.5/s) is used and the Source is not flagged unset");
check(c.cfg.type !== c.def && c.cfg.type !== c.panel.type, "the baked material is NOT the default and NOT the panel's pick (so this check can fail)");
const d = run("laptop, same save: glassSand is number 74 here", LAP, LNAM, null, { brandonMat: "glassSand", brandonRate: 2.5 });
check(d.cfg.type === LAP.glassSand && d.names[d.cfg.type] === "Sand", "laptop: the same id resolves to type 74 -> still golden Sand, not soil and not type 61");
check(d.cfg.mat === "glassSand", "cfgFor keeps the element id on the config");

// --- 3. an old localStorage entry that DOES hold the id is migrated onto the structure --
const e = run("desktop, old per-cell store holds the id, structure has no data yet", DESK, DNAM, { "100,100": { mat: "copper", type: 36, rate: 1 } }, {});
check(e.cfg.type === DESK.copper && e.cfg.rate === 1, "an id-carrying store entry is used (copper, 1/s)");
check(e.struct.data.brandonMat === "copper" && e.struct.data.brandonRate === 1, "…and copied onto the structure so it travels with the save");

// --- 4. a material from a mod that is not loaded falls back to the panel ---------------
const f = run("PC without Manufacturing: glassSand does not exist", BARE, BNAM, null, { brandonMat: "glassSand", brandonRate: 2.5 });
check(f.cfg.type === BARE.sand && f.cfg.unset === true, "unknown id: Source follows the panel (soil) and is flagged unset rather than emitting a wrong number");

// --- 5. bake() writes the id through the game's setter ---------------------------------
const g = run("desktop, bake the panel's pick", DESK, DNAM, null, null);
g.L.bake(g.struct, { mat: "glassSand", type: DESK.glassSand, rate: 7 });
check(g.updates.some((p) => p.brandonMat === "glassSand" && p.brandonRate === 7), "bake() goes through api.structures.updateData with the id and the rate");
check(g.struct.data.brandonMat === "glassSand" && g.struct.data.brandonRate === 7, "the structure's data now carries brandonMat/brandonRate");
const after = g.L.cfgFor(g.struct, { type: g.panel.type, rate: g.panel.rate });
check(after.type === DESK.glassSand && after.rate === 7 && !after.unset, "cfgFor reads the baked pick back: golden Sand at 7/s");
check(!/"brandonMat":\s*\d/.test(g.store["brandon.sandboxloop.instances"] || "") && /"mat":"glassSand"/.test(g.store["brandon.sandboxloop.instances"] || ""), "the per-cell store is written with the element id, never a bare number");

console.log(ok ? "\nALL OK" : "\nFAIL: see above"); process.exit(ok ? 0 : 1);
