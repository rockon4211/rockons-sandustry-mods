// sim-filterboost.js — runs the real worker.real.js against a mock worker state and checks the
// Mk.2 Filter speed switch: frozen transport config, ON doubles filterLeft/RightMk2 cells-per-pass,
// OFF restores the original object, other belts untouched.
const fs = require("fs");
const deepFreeze = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const cfg = deepFreeze({ transport: { conveyors: { structures: {
	conveyorRight: { maxDisplacementCellsPerPass: 1 }, conveyorRightMk2: { maxDisplacementCellsPerPass: 1 },
	filterLeftMk2: { maxDisplacementCellsPerPass: 1 }, filterRightMk2: { maxDisplacementCellsPerPass: 1 } } } }, other: { a: 1 } });
const state = { sandkit: { jsonConfigs: cfg } };
const buf = new Uint32Array(2);
const timers = [];
global.setTimeout = (fn) => timers.push(fn);
const logs = []; console.log = (m) => logs.push(m); console.error = (m) => logs.push("ERR " + m);
const sandkit = { state, api: { shared: { buffers: { require: () => buf } }, elements: {}, events: { on() {} } } };
new Function("sandkit", fs.readFileSync(__dirname + "/../mods/manufacturing/worker.real.js", "utf8"))(sandkit);
const run = () => { const t = timers.splice(0); t.forEach((f) => f()); };
const d = () => state.sandkit.jsonConfigs.transport.conveyors.structures;
let ok = true; const check = (c, m) => { process.stdout.write((c ? "  ok   " : "  FAIL ") + m + "\n"); if (!c) ok = false; };
run();
check(state.sandkit.jsonConfigs === cfg, "off at start: original config untouched");
buf[0] = 1; run();
check(d().filterRightMk2.maxDisplacementCellsPerPass === 2 && d().filterLeftMk2.maxDisplacementCellsPerPass === 2, "ON: Mk.2 filters move 2 cells per pass");
check(d().conveyorRight.maxDisplacementCellsPerPass === 1 && d().conveyorRightMk2.maxDisplacementCellsPerPass === 1, "ON: belts unchanged");
check(state.sandkit.jsonConfigs.other === cfg.other && buf[1] === 2, "ON: rest of config kept, worker reports applied");
buf[0] = 0; run();
check(state.sandkit.jsonConfigs === cfg && buf[1] === 1, "OFF: original config object restored");
buf[0] = 1; run(); buf[0] = 1; run();
check(d().filterRightMk2.maxDisplacementCellsPerPass === 2, "ON again: still 2 (not compounded to 4)");
process.stdout.write(logs.filter((l) => /belt speed|ERR/.test(l)).join("\n") + "\n" + (ok ? "ALL OK\n" : "FAILED\n"));
process.exit(ok ? 0 : 1);
