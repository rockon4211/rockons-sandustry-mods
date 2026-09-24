// sim-lost.js — a spot that keeps eating the tracer: grains stream along a belt into a filter
// section that deletes tracer grains (only tracers; real grains pass). The mod re-picks a
// nearby grain after each loss; the THIRD loss within 16 cells / 90s must trigger the
// hot-spot bailout (a "hotspot" log event, then a fresh journey instead of a fourth pick-up).
// Run from .handoff/:  node sim-lost.js   (exit 1 on any failed check)
const fs = require("fs"), path = require("path"); const src = fs.readFileSync(path.join(__dirname, "..", "mods", "screensaver", "main.js"), "utf8");
function run(label, rideType) {
  const T = { sand: 1, water: 3, steam: 10 }, NAME = { 1: "soil", 3: "Water", 10: "Steam" }, ID = { 1: "sand", 3: "water", 10: "steam" };
  const cells = new Map(); const K = (x, y) => x + "," + y;
  const structs = [];
  for (const x of [1956, 1960, 1964, 1988, 1992, 1996, 2000, 2004, 2008, 2012]) structs.push({ id: "conveyorRightMk2", x, y: 2340 });
  for (const x of [1968, 1972, 1976, 1980, 1984]) structs.push({ id: "filterRightMk2", x, y: 2340, filter: { elementType: [3, 10], mode: "allow" } });
  let NOW = 1e9; const RD = Date; global.Date = class extends RD { constructor(...a){ super(...(a.length?a:[NOW])); } static now(){ return NOW; } }; global.performance = { now: () => NOW };
  const queued = [], tracers = new Set();
  global.sandkit = { api: {
    elements: { getResolvedTypeAtCell: (x, y) => cells.get(K(x, y)) || 0, getNameByType: (t) => NAME[t] || "tracer",
      getDefinitionByType: (t) => ({ name: NAME[t], matterType: 7, density: 1600, metaColor: 0x888888, colors: { variants: [[128,128,128,255]] } }),
      getIdByType: (t) => ID[t], getTypeFromId: (id) => T[id], register: () => { const t = 90 + tracers.size; tracers.add(t); return { elementType: t }; },
      updateDefinition() {}, replaceAtCell: (x, y, t) => queued.push({ x, y, t }), replaceAtCellWhenIdle: (x, y, t) => queued.push({ x, y, t }), isFreeFallingAtCell: () => false },
    structures: { getAtCell: () => null, forEachOfType: (id, cb) => structs.filter((s) => s.id === id).forEach((s) => cb({ type: 5, x: s.x, y: s.y, filter: s.filter })), getTypeById: () => 5, getIdByType: () => "belt" },
    settings: { get: (k) => ({ useTracer: true, followGrain: true, handBackSeconds: 2, pileSeconds: 25, handoffSeconds: 6, followMaxSeconds: 900, mixTour: false, enabled: true })[k] },
    scene: { getActive: () => 3 }, ui: { update() {}, inject() {} }, events: { on() {} } },
    state: { session: { overrideCamera: false, camera: { x: 0, y: 0 }, ui: {}, settings: {}, view: { zoom: 2 }, rendering: { canvas: { width: 1920, height: 1080 } } }, store: { structures: [], player: { x: 0, y: 0 } } },
    enums: { Scene: { Game: 3, MainMenu: 0 }, ElementType: { Empty: 0 }, ComponentId: {}, MatterType: { Powder: 7, Solid: 1, Liquid: 2, Gas: 4, Slushy: 6 } }, react: null };
  global.window = { addEventListener() {}, localStorage: { setItem() {}, getItem: () => null }, __brandonSandboxLoop: { sources: () => [], emitOnce() {}, emitOnceResult: () => null, cancelEmitOnce() {} } };
  global.document = { addEventListener() {}, createElement: () => ({ remove() {} }), head: { appendChild() {} }, getElementById: () => null };
  global.navigator = { wakeLock: { request: () => Promise.resolve({ release() {} }) } };
  const timers = []; global.setInterval = () => 0; global.setTimeout = (fn, ms) => { timers.push({ fn, at: NOW + ms }); return 0; };
  console.log = () => {};
  eval('"use strict";\n' + src.replace("function tick() {", "function modTick() {").replace("setInterval(tick, 33);", "")
    + "\nglobal.M = { get dbg(){return dbg}, get tlog(){return tlog}, get stats(){return stats}, get notes(){return recentNotes}, get trc(){return trc}, set trc(v){trc=v}, modTick, indexBelts, set active(v){active=v}, set cam(v){cam=v}, tracerTypes };");
  M.active = true; M.cam = null; M.indexBelts(true);
  // a stream of grains rides right along y=2339 on top of the belt; filters let only Water/Steam through
  let grains = []; for (let x = 1400; x < 1966; x += 2) grains.push({ x, t: rideType });   // a long stream, so there is always a grain to re-pick
  const tt = [...M.tracerTypes][0];
  grains[grains.length - 1].t = tt;   // the front grain is our tracer
  M.trc = { t: tt, orig: rideType, x: grains[grains.length - 1].x, y: 2339, lastMove: NOW, since: NOW - 10000, pending: false, tries: 0, hops: [NAME[rideType]], hopTypes: [rideType], search: null, moved: 20 };
  const events = []; let last = "";
  for (let i = 0; i < 600; i++) {
    NOW += 33;
    while (queued.length) { const q = queued.shift(); const g = grains.find((g) => g.x === q.x); if (g) g.t = q.t; }
    cells.clear();
    for (const g of grains) {
      g.x += 1;
      const inFilter = g.x >= 1968 && g.x <= 1987;
      if (inFilter && g.t >= 90) { g.dead = true; continue; }   // what the user sees: disallowed material vanishes
      cells.set(K(g.x, 2339), g.t);
    }
    grains = grains.filter((g) => !g.dead && g.x < 2300);
    while (timers.length && timers[0].at <= NOW) timers.shift().fn();
    M.modTick();
    const line = M.dbg.note + (M.dbg.phase.indexOf("riding")===0 ? " [riding]" : "");
    if (line !== last) { events.push((i * 33 / 1000).toFixed(1) + "s  " + line + "  @" + (M.trc ? M.trc.x : "-")); last = line; }
  }
  console.error("=== " + label); console.error(JSON.stringify(M.stats)); console.error(M.notes.map(n=>n.txt).join("\n")); console.error(M.tlog.map(e=>e.kind+" "+(e.x||"")+" "+JSON.stringify(e.area||e.onStructure||e.became||"")).join("\n")); console.error(events.slice(0, 14).join("\n"));
  return { tlog: M.tlog.slice(), stats: JSON.parse(JSON.stringify(M.stats)), trc: M.trc, tracerCells: grains.filter((g) => M.tracerTypes.has(g.t) || g.t >= 90).length, events };
}
let ok = true; const check = (c, msg) => { console.error((c ? "  ok   " : "  FAIL ") + msg); if (!c) ok = false; };
for (const [label, t] of [["riding WATER", 3], ["riding SOIL", 1]]) {
  const r = run(label, t);
  const kinds = r.tlog.map((e) => e.kind);
  const hs = kinds.indexOf("hotspot");
  const lostBefore = kinds.slice(0, hs < 0 ? kinds.length : hs).filter((k) => k === "LOST").length;
  check(hs >= 0, label + ": hotspot bailout fired (" + kinds.filter((k) => k === "LOST").length + " LOST events)");
  check(hs < 0 || lostBefore === 3, label + ": it fired on the third loss, not earlier or later (" + lostBefore + " LOST events up to it)");
  check(hs < 0 || (r.tlog[hs].times >= 3), label + ": hotspot counted " + (hs >= 0 ? r.tlog[hs].times : "-") + " losses in the spot");
  check(hs < 0 || !r.tlog.slice(hs + 1).some((e) => e.kind === "pickup" && /^19[5-9]\d,2339$/.test(e.at || "")), label + ": no more pick-ups at that spot after the bailout");
  check(kinds.filter((k) => k === "pickup").length >= 2, label + ": re-picked a grain after the first two losses (" + kinds.filter((k) => k === "pickup").length + " pickups)");
}
console.error(ok ? "\nALL OK" : "\nSOME CHECKS FAILED"); process.exit(ok ? 0 : 1);
