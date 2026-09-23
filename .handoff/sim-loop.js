// Sandbox Loop: does a Source keep its material across PCs? (element ID, not number)
const fs = require("fs"); const src = fs.readFileSync("../mods/sandboxloop/main.js", "utf8");
function run(label, ids, names, storedCfg, structData) {
  const byType = {}; for (const k in ids) byType[ids[k]] = k;
  let NOW = 1e9; const RD = Date; global.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
  global.performance = { now: () => NOW };
  const store = {}; if (storedCfg) store["brandon.sandboxloop.instances"] = JSON.stringify(storedCfg);
  const structs = [{ type: "brandon.sandboxloop.source", x: 100, y: 100, data: structData ? Object.assign({}, structData) : {} }];
  global.sandkit = { api: {
    elements: { getRegisteredTypes: () => Object.values(ids), getNameByType: (t) => names[t], getIdByType: (t) => byType[t], getTypeFromId: (id) => ids[id],
      getDefinitionByType: (t) => ({ name: names[t], matterType: 7, metaColor: 0x888888 }), getResolvedTypeAtCell: () => 0,
      createAtCellWhenIdle() {}, removeAtCellWhenIdle() {}, replaceAtCell() {} },
    structures: { register() {}, forEachOfType: (id, cb) => structs.filter((s) => s.type === id).forEach(cb), getAtCell: () => null, recipes: { register() {} } },
    world: { isTerrainAtCell: () => false }, settings: { get: () => undefined }, scene: { getActive: () => 3 },
    ui: { update() {}, inject() {}, toast() {} }, events: { on() {} }, sprites: { loadFromMod() {} }, i18n: { register() {} } },
    state: { session: { ui: {}, settings: {}, paused: false }, store: { structures: structs } },
    enums: { Scene: { Game: 3 }, ElementType: { Empty: 0 }, ComponentId: {}, MatterType: { Powder: 7, Particle: 2 } }, react: { createElement: () => null, useState: () => [0, () => {}], useEffect: () => {} } };
  global.window = { addEventListener() {}, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } } };
  global.document = { addEventListener() {}, createElement: () => ({ remove() {}, click() {}, style: {} }), head: { appendChild() {} }, body: { appendChild() {} }, getElementById: () => null };
  global.setInterval = () => 0; global.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; };
  const log = console.log; console.log = () => {}; console.error = () => {};
  eval('"use strict";\n' + src + "\nglobal.L = { defaultType, cfgFor, bake, get emitCfg(){return emitCfg}, buildPalette };");
  console.log = log;
  const cfg = L.cfgFor(structs[0], { mat: L.emitCfg.mat, type: L.emitCfg.type, rate: L.emitCfg.rate });
  log("== " + label);
  log("   default material:", names[L.defaultType()], "(type " + L.defaultType() + ")");
  log("   Source emits:", names[cfg.type], "| stored on the structure:", JSON.stringify(structs[0].data));
  return names[cfg.type];
}
// desktop: vanilla sand renamed to soil by Manufacturing, plus its new golden Sand at type 61
const DESK = { sand: 1, water: 3, copper: 36, glassSand: 61 };
const DNAM = { 1: "soil", 3: "Water", 36: "Copper", 61: "Sand" };
// laptop: same mods, but the new Sand landed on a different number, and localStorage is empty
const LAP = { sand: 1, water: 3, copper: 36, glassSand: 74 };
const LNAM = { 1: "soil", 3: "Water", 36: "Copper", 74: "Sand" };
const a = run("desktop, Source placed here (old numeric store)", DESK, DNAM, { "100,100": { type: 1, rate: 3 } }, null);
const b = run("laptop, fresh install, nothing stored", LAP, LNAM, null, null);
const c = run("laptop, save carries the baked material", LAP, LNAM, null, { brandonMat: "sand", brandonRate: 3 });
console.log("\nall three agree:", a === b && b === c, "->", a, b, c);
