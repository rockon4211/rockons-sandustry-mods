#!/usr/bin/env node
// Material Studio -> Sandustry mod compiler (Step 3).
//
// Input:  a studio graph JSON ({mats, procs, over, dis}) plus a small config.
// Output: a complete mod folder (modinfo.json, main.js, optional worker.js).
//
// What compiles today:
//   - custom materials  -> api.elements.register (matter, density, colors)
//   - heat procs via smelter / dryer -> api.structures.recipes.register
//   - touch procs (mat + mat -> product) -> worker element:moved handlers
//     (the proven Glassworks quench pattern, generalized)
// Anything else (mine drops need terrain, cycles need timers) is reported
// and skipped, never silently dropped.

const fs = require("fs");
const path = require("path");

function shade(c, f) {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return [r, g, b, 255];
}

// Recipe-registry ids in the real game for machines the studio knows.
// (Verified against the engine's dispatcher: planterBox, shaker, kineticPress,
// condenser, steamDryer, synthesizer, snowmaker, smelter.)
const MACHINE_STRUCT = { m_smelter: "smelter", m_dryer: "steamDryer" };
const MACHINE_NAME = {
  m_smelter: "Smelter", m_shaker: "Shaker", m_dryer: "Steam Dryer",
  m_mold: "Copper Mold", m_planter: "Planter Box", m_collector: "Collector",
};

function compile(graph, cfg) {
  const report = { ok: [], warn: [], skip: [] };
  const mats = Object.values(graph.mats || {});
  const procs = (graph.procs || []).filter(p => !(graph.dis || []).includes(p.key));
  const matIds = new Set(mats.map(m => m.id));
  const isCustom = id => matIds.has(id);

  // --- classify processes ---
  const recipes = [];   // {structure, input, output, lbl}  (smelter / steamDryer)
  const shakers = {};   // input -> {below:[], above:[]}
  const touches = [];   // {from, partner, to}  from + partner -> to, partner consumed
  for (const p of procs) {
    if (p.k === "heat" && p.via === "m_shaker") {
      const s = shakers[p.f] = shakers[p.f] || { below: [], above: [] };
      // vanilla semantics: the valuable product drops below, waste is thrown above
      (p.t === "residue" ? s.above : s.below).push(p.t);
      report.ok.push(`shaker recipe: ${p.f} -> ${p.t} (${p.t === "residue" ? "thrown above" : "dropped below"})`);
    } else if (p.k === "heat" && p.via && MACHINE_STRUCT[p.via]) {
      recipes.push({ structure: MACHINE_STRUCT[p.via], input: p.f, output: p.t, lbl: p.lbl, machine: MACHINE_NAME[p.via] });
      report.ok.push(`recipe: ${p.f} -> ${p.t} via ${MACHINE_NAME[p.via]}`);
    } else if (p.k === "heat" && p.via) {
      report.skip.push(`heat via ${MACHINE_NAME[p.via] || p.via}: no mod recipe registry found for that machine yet (${p.f} -> ${p.t})`);
    } else if (p.k === "touch" && matIds.has(p.t) || p.k === "touch" && !p.t.startsWith("m_")) {
      touches.push({ from: p.f, to: p.t, partner: p.partner || "water", lbl: p.lbl, note: p.note });
      report.ok.push(`touch: ${p.f} + ${p.partner || "water"} -> ${p.t} (partner consumed)`);
    } else if (p.k === "mine") {
      // handled by the terrain-swap pass below
    } else {
      report.skip.push(`${p.k}: ${p.f} -> ${p.t} (not compilable yet)`);
    }
  }
  // --- terrain output swaps: mine procs from known terrains ---
  const TERRAIN_MAP = { t_dune: "dune" };
  const terrainSwaps = [];  // {terrain, output}
  for (const p of procs) {
    if (p.k !== "mine") continue;
    if (TERRAIN_MAP[p.f]) {
      terrainSwaps.push({ terrain: TERRAIN_MAP[p.f], output: p.t });
      report.ok.push(`terrain swap: broken ${TERRAIN_MAP[p.f]} now drops ${p.t}`);
    } else {
      report.skip.push(`mine: ${p.f} -> ${p.t} (that terrain's game id is not mapped yet)`);
    }
  }
  // --- vanilla element overrides (rename / recolor / redensity in place) ---
  const overrides = [];   // {id, n?, c?, d?}
  for (const [id, o] of Object.entries(graph.over || {})) {
    const entry = { id };
    if (o.n !== undefined) entry.n = o.n;
    if (o.c !== undefined) entry.c = o.c;
    if (o.d !== undefined) entry.d = o.d;
    if (o.m !== undefined) report.warn.push(`override ${id}: matter-type changes are not compiled (risky mid-save); kept ${id} as-is`);
    if (entry.n !== undefined || entry.c !== undefined || entry.d !== undefined) {
      overrides.push(entry);
      report.ok.push(`override: ${id}${entry.n ? ` renamed "${entry.n}"` : ""}${entry.c !== undefined ? " recolored" : ""}${entry.d !== undefined ? ` density ${entry.d}` : ""} - every existing grain changes at load`);
    }
  }
  // --- purge rules: hidden vanilla materials dry back into a stand-in ---
  const purges = [];    // {from, to}
  for (const id of (graph.hidden || [])) {
    const to = (cfg.purgeMap || {})[id];
    if (to) { purges.push({ from: id, to }); report.ok.push(`purge: ${id} converts instantly to ${to} (stripped from the game)`); }
    else report.warn.push(`hidden: ${id} - no stand-in configured, grains of it will still exist if the engine creates them`);
  }

  // --- density sanity along machine chains ---
  const byId = {};
  mats.forEach(m => byId[m.id] = m);
  for (const r of recipes) {
    const a = byId[r.input], b = byId[r.output];
    if (a && b && b.d >= a.d) report.warn.push(`density: ${r.output} (${b.d}) is not lighter than ${r.input} (${a.d}) - machine may jam`);
  }

  // --- modinfo ---
  const modinfo = {
    manifestVersion: 1,
    id: cfg.id,
    name: cfg.name,
    version: cfg.version || "0.1.0",
    apiVersion: 1,
    entry: "main.js",
    author: cfg.author || "Brandon",
    description: cfg.description,
    dependencies: [],
    loadOrder: 0,
    configSchema: {
      enabled: { type: "boolean", default: true, labelKey: "Mod enabled", descriptionKey: "Turn the mod off without unsubscribing. Recipes can only be withdrawn at load, so switching off leaves them until the next restart." },
    },
  };
  const needWorker = touches.length > 0 || purges.length > 0;
  if (needWorker) modinfo.workerEntry = "worker.js";

  // --- main.js ---
  const L = [];
  L.push(`// ${cfg.name} - generated by Sandustry Material Studio on ${new Date().toISOString().slice(0, 10)}.`);
  L.push(`// Compiled from the studio graph: ${mats.length} materials, ${recipes.length} recipes, ${touches.length} touch reactions.`);
  L.push(``);
  L.push(`const api = sandkit.api;`);
  L.push(`const MOD_ID = ${JSON.stringify(cfg.id)};`);
  L.push(``);
  L.push(`function setting(key, fallback) {`);
  L.push(`\ttry { const v = api.settings.get(key); return v === undefined || v === null ? fallback : v; } catch (e) { return fallback; }`);
  L.push(`}`);
  L.push(`const isEnabled = () => setting("enabled", true);`);
  L.push(`function safe(fn) { try { return fn(); } catch (e) { return undefined; } }`);
  L.push(``);
  L.push(`// ------------------------------------------------------------ elements --`);
  L.push(`// NEVER reorder this list; append only. Element type ids are assigned in`);
  L.push(`// registration order and a save remembers them by number.`);
  L.push(`const ELEMENTS = ${JSON.stringify(mats.map(m => ({
    id: m.id, name: m.n, matter: m.m, density: m.d, metaColor: m.c,
    colors: [shade(m.c, 1), shade(m.c, 0.9), shade(m.c, 1.12), shade(m.c, 0.8)],
    fl: m.fl || undefined,
  })), null, "\t")};`);
  L.push(``);
  L.push(`const MatterType = safe(() => sandkit.enums.MatterType) || {};`);
  L.push(`const typeById = new Map();`);
  L.push(`for (const e of ELEMENTS) {`);
  L.push(`\tconst matterType = MatterType[e.matter];`);
  L.push(`\tif (typeof matterType !== "number") { console.error(\`[\${MOD_ID}] unknown matter type "\${e.matter}" for "\${e.id}"\`); continue; }`);
  L.push(`\ttry {`);
  L.push(`\t\tconst def = { id: e.id, name: e.name, matterType, density: e.density, metaColor: e.metaColor, colors: { variants: e.colors } };`);
  L.push(`\t\tif (e.fl && e.fl.grabbable === false) def.grabbable = false;`);
  L.push(`\t\tif (e.fl && e.fl.transportable === false) def.isTransportable = false;`);
  L.push(`\t\tconst r = api.elements.register(def);`);
  L.push(`\t\tif (r && typeof r.elementType === "number") typeById.set(e.id, r.elementType);`);
  L.push(`\t\tconsole.log(\`[\${MOD_ID}] element registered: \${e.id} -> type \${r && r.elementType}\`);`);
  L.push(`\t} catch (err) { console.error(\`[\${MOD_ID}] element "\${e.id}" failed to register:\`, err); }`);
  L.push(`}`);
  L.push(`// Vanilla element types the recipes and reactions reference.`);
  const vanillaRefs = new Set();
  recipes.forEach(r => { if (!isCustom(r.input)) vanillaRefs.add(r.input); if (!isCustom(r.output)) vanillaRefs.add(r.output); });
  Object.keys(shakers).forEach(inp => {
    if (!isCustom(inp)) vanillaRefs.add(inp);
    shakers[inp].below.concat(shakers[inp].above).forEach(o => { if (!isCustom(o)) vanillaRefs.add(o); });
  });
  touches.forEach(t => { ["from", "to", "partner"].forEach(k => { if (!isCustom(t[k])) vanillaRefs.add(t[k]); }); });
  purges.forEach(p => { ["from", "to"].forEach(k => { if (!isCustom(p[k])) vanillaRefs.add(p[k]); }); });
  terrainSwaps.forEach(s => { if (!isCustom(s.output)) vanillaRefs.add(s.output); });
  overrides.forEach(o => vanillaRefs.add(o.id));
  L.push(`for (const id of ${JSON.stringify([...vanillaRefs])}) {`);
  L.push(`\tconst t = safe(() => api.elements.getTypeFromId(id));`);
  L.push(`\tif (typeof t === "number") typeById.set(id, t);`);
  L.push(`\telse console.error(\`[\${MOD_ID}] vanilla element "\${id}" not found\`);`);
  L.push(`}`);
  L.push(`const typeOf = (id) => typeById.get(id);`);
  L.push(``);
  if (recipes.length) {
    L.push(`// ------------------------------------------------------------- recipes --`);
    L.push(`// One recipe per input per machine is the engine's rule.`);
    L.push(`if (isEnabled()) {`);
    for (const r of recipes) {
      L.push(`\t{`);
      L.push(`\t\tconst input = typeOf(${JSON.stringify(r.input)}), output = typeOf(${JSON.stringify(r.output)});`);
      L.push(`\t\tif (input !== undefined && output !== undefined) {`);
      L.push(`\t\t\ttry {`);
      L.push(`\t\t\t\tapi.structures.recipes.register(${JSON.stringify(r.structure)}, { input, outputs: [{ elementType: output, chance: 1 }] });`);
      L.push(`\t\t\t\tconsole.log(\`[\${MOD_ID}] ${r.machine} recipe: ${r.input} -> ${r.output}\`);`);
      L.push(`\t\t\t} catch (e) { console.error(\`[\${MOD_ID}] recipe ${r.input} -> ${r.output} failed:\`, e); }`);
      L.push(`\t\t}`);
      L.push(`\t}`);
    }
    L.push(`}`);
    L.push(``);
    L.push(`// -------------------------------------------------------------- tooltips --`);
    for (const r of recipes) {
      L.push(`safe(() => api.elements.addInteractionInfo(${JSON.stringify(r.input)}, { kind: "custom", text: ${JSON.stringify(`${r.machine}: ${r.input} → ${r.output}`)} }));`);
    }
  }
  if (overrides.length) {
    L.push(``);
    L.push(`// -------------------------------------------- vanilla element makeovers --`);
    L.push(`// updateDefinition on a LIVE element type Object.assigns into the engine's`);
    L.push(`// definition table and broadcasts to every sim worker - all existing grains`);
    L.push(`// change identity instantly. nameKey must be cleared or i18n wins the name.`);
    L.push(`if (isEnabled()) {`);
    for (const o of overrides) {
      L.push(`\t{`);
      L.push(`\t\tconst t = typeOf(${JSON.stringify(o.id)});`);
      L.push(`\t\tif (typeof t === "number") {`);
      const patch = [];
      if (o.n !== undefined) patch.push(`nameKey: void 0, name: ${JSON.stringify(o.n)}`);
      if (o.c !== undefined) patch.push(`metaColor: ${o.c}, colors: { variants: ${JSON.stringify([shade(o.c, 1), shade(o.c, 0.9), shade(o.c, 1.12), shade(o.c, 0.8)])} }`);
      if (o.d !== undefined) patch.push(`density: ${o.d}`);
      L.push(`\t\t\tsafe(() => api.elements.updateDefinition(t, { ${patch.join(", ")} }));`);
      L.push(`\t\t\tconsole.log(\`[\${MOD_ID}] vanilla makeover applied: ${o.id}${o.n ? ` -> "${o.n}"` : ""}\`);`);
      L.push(`\t\t}`);
      L.push(`\t}`);
    }
    L.push(`}`);
  }
  if (terrainSwaps.length) {
    L.push(``);
    L.push(`// ---------------------------------------------- terrain output swaps --`);
    L.push(`// The Glassworks v0.10 pattern: terrains.updateDefinition replaces what a`);
    L.push(`// broken terrain cell spawns, live, across all sim threads.`);
    L.push(`if (isEnabled()) {`);
    for (const s of terrainSwaps) {
      L.push(`\t{`);
      L.push(`\t\tconst out = typeOf(${JSON.stringify(s.output)});`);
      L.push(`\t\tif (typeof out === "number") {`);
      L.push(`\t\t\tconst ok = safe(() => (api.terrains.updateDefinition(${JSON.stringify(s.terrain)}, { output: { elementType: out, chance: 1 } }), true));`);
      L.push(`\t\t\tif (ok) console.log(\`[\${MOD_ID}] ${s.terrain} now drops ${s.output}\`);`);
      L.push(`\t\t\telse console.error(\`[\${MOD_ID}] ${s.terrain} output swap failed\`);`);
      L.push(`\t\t}`);
      L.push(`\t}`);
    }
    L.push(`}`);
  }
  if (Object.keys(shakers).length) {
    L.push(``);
    L.push(`// ------------------------------------------------------ shaker recipes --`);
    L.push(`// Engine shape: one recipe per input; outputsBelow drop out the bottom`);
    L.push(`// (vanilla: gold), outputsAbove are thrown out the top (vanilla: residue).`);
    L.push(`if (isEnabled()) {`);
    for (const inp of Object.keys(shakers)) {
      const s = shakers[inp];
      L.push(`\t{`);
      L.push(`\t\tconst input = typeOf(${JSON.stringify(inp)});`);
      const belowIds = s.below, aboveIds = s.above;
      L.push(`\t\tconst below = ${JSON.stringify(belowIds)}.map(typeOf), above = ${JSON.stringify(aboveIds)}.map(typeOf);`);
      L.push(`\t\tif (input !== undefined && below.concat(above).every(t => t !== undefined)) {`);
      L.push(`\t\t\ttry {`);
      L.push(`\t\t\t\tapi.structures.recipes.register("shaker", {`);
      L.push(`\t\t\t\t\tinput,`);
      L.push(`\t\t\t\t\toutputsBelow: below.map(t => ({ elementType: t, chance: ${belowIds.length ? +(0.5 / belowIds.length).toFixed(3) : 0} })),`);
      L.push(`\t\t\t\t\toutputsAbove: above.map(t => ({ elementType: t, chance: ${aboveIds.length ? +(0.5 / aboveIds.length).toFixed(3) : 0} })),`);
      L.push(`\t\t\t\t});`);
      L.push(`\t\t\t\tconsole.log(\`[\${MOD_ID}] shaker recipe: ${inp} -> ${belowIds.join("+") || "-"} below / ${aboveIds.join("+") || "-"} above\`);`);
      L.push(`\t\t\t} catch (e) { console.error(\`[\${MOD_ID}] shaker recipe ${inp} failed:\`, e); }`);
      L.push(`\t\t}`);
      L.push(`\t}`);
    }
    L.push(`}`);
  }
  if (needWorker) {
    const T = touches.length, P0 = 8 + T * 3;
    L.push(``);
    L.push(`// ------------------------------------------- shared state for the worker --`);
    L.push(`let shared = null;`);
    L.push(`try { shared = api.shared.buffers.create("state", { type: "uint32", length: ${P0 + purges.length * 2} }); } catch (e) { console.error(\`[\${MOD_ID}] shared buffer failed:\`, e); }`);
    L.push(`function publish() {`);
    L.push(`\tif (!shared) return;`);
    L.push(`\tshared[0] = isEnabled() ? 1 : 0;`);
    touches.forEach((t, i) => {
      L.push(`\tshared[${8 + i * 3}] = typeOf(${JSON.stringify(t.from)}) || 0;`);
      L.push(`\tshared[${9 + i * 3}] = typeOf(${JSON.stringify(t.partner)}) || 0;`);
      L.push(`\tshared[${10 + i * 3}] = typeOf(${JSON.stringify(t.to)}) || 0;`);
    });
    purges.forEach((p, i) => {
      L.push(`\tshared[${P0 + i * 2}] = typeOf(${JSON.stringify(p.from)}) || 0;`);
      L.push(`\tshared[${P0 + i * 2 + 1}] = typeOf(${JSON.stringify(p.to)}) || 0;`);
    });
    L.push(`}`);
    L.push(`publish(); setInterval(publish, 1000);`);
  }
  L.push(``);
  L.push(`console.log(\`[\${MOD_ID}] loaded\`);`);

  // hand-written bolt-ons appended verbatim to the generated entry
  for (const p of (cfg.append || [])) {
    L.push("");
    L.push(fs.readFileSync(p, "utf8"));
    report.ok.push(`bolt-on appended: ${path.basename(p)}`);
  }
  const files = { "modinfo.json": JSON.stringify(modinfo, null, "\t") + "\n", "main.js": L.join("\n") + "\n" };

  if (needWorker) {
    files["worker.js"] = buildWorker(cfg, touches, purges);
  }
  return { files, report };
}

function buildWorker(cfg, touches, purges) {
  // Generalized Glassworks quench: touch rule i lives at shared[8+3i..10+3i]
  // (from, partner, to; the partner cell is consumed, like water in wetting).
  // Purge rule j lives after the touches, 2 slots each (from, to): any grain
  // of a stripped vanilla material converts the moment it moves.
  const T = touches.length, P0 = 8 + T * 3, P = purges.length;
  return `// ${cfg.name} - worker entry (generated). Touch reactions and purge rules
// live here because only this thread sees particles move.
const api = sandkit.api;
const MOD_ID = ${JSON.stringify(cfg.id)};
let shared = null;
try { shared = api.shared.buffers.require("state", { type: "uint32", length: ${P0 + P * 2} }); }
catch (e) { console.error(\`[\${MOD_ID}] worker cannot read shared state:\`, e); }
const T = ${T}, P0 = ${P0}, P = ${P};
const active = () => shared && shared[0] === 1;
function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
function readType(x, y) { return safe(() => api.elements.getResolvedTypeAtCell(x, y)); }
let writeMode = null;
const WRITERS = [
\t["replaceAtCell", (x, y, t) => api.elements.replaceAtCell(x, y, t)],
\t["removeCreateAtCell", (x, y, t) => { api.elements.removeAtCell(x, y); api.elements.createAtCell(x, y, t); }],
];
function setCell(x, y, t) {
\tfor (const [name, w] of WRITERS) {
\t\tif (writeMode !== null && writeMode !== name) continue;
\t\tsafe(() => w(x, y, t));
\t\tif (readType(x, y) === t) { writeMode = name; return true; }
\t}
\treturn false;
}
function clearCell(x, y) { safe(() => api.elements.removeAtCell(x, y)); }
const NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];
function scan(x, y) {
\tif (!active() || !shared) return;
\tconst here = readType(x, y);
\tfor (let j = 0; j < P; j++) {
\t\tconst from = shared[P0 + j * 2], to = shared[P0 + j * 2 + 1];
\t\tif (from && to && here === from) { if (setCell(x, y, to)) return; }
\t}
\tfor (let i = 0; i < T; i++) {
\t\tconst from = shared[8 + i * 3], partner = shared[9 + i * 3], to = shared[10 + i * 3];
\t\tif (!from || !partner || !to) continue;
\t\tif (here !== from && here !== partner) continue;
\t\tfor (const [dx, dy] of NB) {
\t\t\tconst nx = x + dx, ny = y + dy, n = readType(nx, ny);
\t\t\tif (here === from && n === partner) {
\t\t\t\t// Confirm right before writing - the event can be a tick stale.
\t\t\t\tif (readType(x, y) !== from) return;
\t\t\t\tif (setCell(x, y, to)) { clearCell(nx, ny); return; }
\t\t\t} else if (here === partner && n === from) {
\t\t\t\tif (readType(nx, ny) !== from) return;
\t\t\t\tif (setCell(nx, ny, to)) { clearCell(x, y); return; }
\t\t\t}
\t\t}
\t}
}
function register() {
\tlet ready = false;
\tfor (let i = 0; i < T; i++) if (shared && shared[8 + i * 3]) ready = true;
\tfor (let j = 0; j < P; j++) if (shared && shared[P0 + j * 2]) ready = true;
\tif (!shared || !ready) {
\t\tif (typeof setTimeout === "function") setTimeout(register, 500);
\t\treturn;
\t}
\ttry {
\t\tconst types = new Set();
\t\tfor (let i = 0; i < T; i++) { types.add(shared[8 + i * 3]); types.add(shared[9 + i * 3]); }
\t\tfor (let j = 0; j < P; j++) types.add(shared[P0 + j * 2]);
\t\tfor (const t of types) {
\t\t\tif (!t) continue;
\t\t\tapi.events.on("element:moved", (p) => { const d = p && p.destination; if (d) scan(d.x, d.y); }, { guard: { elementType: t } });
\t\t}
\t\tconsole.log(\`[\${MOD_ID}] worker armed (\${types.size} watched types)\`);
\t} catch (e) { console.error(\`[\${MOD_ID}] worker subscribe failed:\`, e); }
}
register();
`;
}

// ---- CLI ----
const [graphPath, outDir, cfgPath] = process.argv.slice(2);
const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const { files, report } = compile(graph, cfg);
fs.mkdirSync(outDir, { recursive: true });
// clear generated files a previous compile may have left behind
for (const stale of ["modinfo.json", "main.js", "worker.js"]) {
  if (!files[stale] && fs.existsSync(path.join(outDir, stale))) fs.unlinkSync(path.join(outDir, stale));
}
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), content);
console.log("== compiled ==");
for (const k of ["ok", "warn", "skip"]) report[k].forEach(m => console.log(`${k.toUpperCase()}: ${m}`));
console.log("files:", Object.keys(files).join(", "));
