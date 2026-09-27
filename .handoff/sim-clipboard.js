// sim-clipboard.js — Improved Filter Options 0.2.7: the filter clipboard, run from
// mods/improvedfilters/main.js against a mocked sandkit. Checks:
//   - COPY from the game's row editor takes getSelection().draft; with no row open it takes
//     store.options.defaultFilter;
//   - PASTE into an open row goes through the editor: setDraft, then apply;
//   - the clip round-trips through localStorage by element ID (never a number), a material
//     from a mod that isn't loaded is dropped, a clip with nothing resolvable stays unloaded;
//   - Mk.1 filters (StructureType 17/18) are not pickable and never show the strip;
//   - a paste onto a placed row writes only {mode, elementType}: a row's affectsLiquid:true
//     stays true, and a missing flag is never persisted or written as false;
//   - arming Pick while the game's editor has a row open does NOT touch what is in hand
//     (that would make the editor drop the row); with a Mk.2 in hand it stashes and hands back.
// Run from anywhere:  node .handoff/sim-clipboard.js   (exit 1 on any failed check)
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "mods", "improvedfilters", "main.js"), "utf8");
let ok = true; const check = (c, msg) => { console.log((c ? "  ok   " : "  FAIL ") + msg); if (!c) ok = false; };

// --- the mocked game -----------------------------------------------------------------
// element id -> number on THIS PC (swapped later to model another PC)
let IDS = { sand: 1, water: 3, copper: 36, glassSand: 61 };
const NAMES = { sand: "soil", water: "Water", copper: "Copper", glassSand: "Sand" };
const idOf = (t) => Object.keys(IDS).find((k) => IDS[k] === t);
const storage = {};
const structs = [];   // placed filters; a tile is 4 cells wide
const getAtCell = (x, y) => structs.find((s) => s.y === y && x >= s.x && x < s.x + 4) || null;
let selection = null;   // what the game's filterGroupEditor reports
const editorCalls = [], updateManyCalls = [], buildingCalls = [], toasts = [], handlers = {}, intervals = [], overlays = {};
let engineActive = null;   // engine action.getActive: {type, id} or null
const state = { session: { building: { activeStructureType: null, placing: false }, action: { customData: {} }, input: { mouse: { cellPosition: { x: 0, y: 0 } } },
		rendering: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }) } }, camera: { x: 0, y: 0 }, view: { zoom: 1 }, scale: 1 },
	store: { options: { defaultFilter: { mode: "allow", elementType: 1 } }, player: { action: null, hotbar: { activeSlotIndex: 2 } } } };
const engine = { state, api: {
	filterGroupEditor: { getSelection: (st) => (st === state ? selection : null), setDraft: (st, f) => { editorCalls.push({ op: "setDraft", f }); return true; }, apply: (st) => { editorCalls.push({ op: "apply" }); selection = null; return true; }, cancel() {}, selectAt() {} },
	structures: { updateMany: (st, list, opts) => updateManyCalls.push({ st, list, opts }) },
	action: { getActive: (st) => (st === state ? engineActive : undefined) },
	building: { cancelPlacement: () => buildingCalls.push("cancelPlacement"), selectStructure: (st, id) => { buildingCalls.push("selectStructure:" + id); state.session.building.activeStructureType = id; } },
	input: { resetMouseState() {} } } };
const api = {
	settings: { get: () => undefined }, scene: { getActive: () => 4 },
	elements: { getTypeFromId: (id) => IDS[id], getIdByType: idOf, getNameByType: (t) => NAMES[idOf(t)], getDefinitionByType: (t) => ({ metaColor: 0x808080 }) },
	structures: { getAtCell, forEachOfType: (id, cb) => structs.filter((s) => s.type === id).forEach(cb) },
	ui: { toast: (t) => toasts.push(t), update() {}, inject: () => true, overlays: { register: (band, id, render) => { overlays[id] = render; return true; }, update() {} } },
	events: { on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); } },
};
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: (v) => [v, () => {}], useEffect() {}, useRef: () => ({ current: null }), Fragment: "Fragment" };
global.sandkit = { api, engine, state, react: React, enums: { Scene: { MainMenu: 1, Intro: 2, Deploy: 3, Game: 4 }, StructureType: { FilterLeft: 17, FilterRight: 18 }, ComponentId: { FilterConfig: 5, Hotbar: 6 } } };
global.window = { addEventListener() {}, localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: (k) => { delete storage[k]; } } };
global.document = { createElement: () => ({ remove() {}, style: {} }), head: { appendChild() {} }, body: { appendChild() {} } };
global.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }; global.clearInterval = () => {};
global.setTimeout = (fn) => 0; global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => {};

const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
eval('"use strict";\n' + src + "\nglobal.C = { get clip(){return clip}, set clip(v){clip=v}, get mode(){return mode}, get held(){return held}, copyFromMenu, pasteIntoMenu, menuUp, rowAt, writeRow, loadClip, saveClip, isFilter, Strip, doPasteRow, doCopyRow, arm, cloneFilter };");
console.log = log; console.error = err;
const C = global.C;
const CLIP_KEY = "brandon.improvedfilters.clip";
const stripShown = () => { const r = C.Strip(); return r !== null && r !== undefined; };

// --- 1. COPY from the game's editor / from the default ------------------------------------
selection = { structureType: "filterRightMk2", memberCount: 3, draft: { mode: "block", elementType: [3, 36], affectsLiquid: true }, isDirty: false };
check(C.menuUp() === "van-row", "a Mk.2 row open in the game's editor → menu 'van-row'");
C.copyFromMenu("van-row");
check(!!C.clip && C.clip.mode === "block" && JSON.stringify(C.clip.elementType) === "[3,36]" && C.clip.affectsLiquid === true, "COPY takes getSelection().draft: " + JSON.stringify(C.clip));
check(C.clip !== selection.draft && C.clip.elementType !== selection.draft.elementType, "…as a copy, not the editor's own object");
check(toasts.some((t) => /Copied filter settings: Water \/ Copper · block/.test(t)), "the toast names the materials: " + JSON.stringify(toasts[toasts.length - 1]));
selection = null; C.clip = null; toasts.length = 0;
state.session.building.activeStructureType = "filterLeftMk2";
state.store.options.defaultFilter = { mode: "allow", elementType: 36 };
check(C.menuUp() === "van-new", "a Mk.2 in hand with no row open → menu 'van-new'");
C.copyFromMenu("van-new");
check(!!C.clip && C.clip.mode === "allow" && C.clip.elementType === 36, "COPY with no row open takes store.options.defaultFilter: " + JSON.stringify(C.clip));
check(C.clip !== state.store.options.defaultFilter, "…as a copy");

// --- 2. PASTE into an open row: setDraft then apply ------------------------------------------
state.session.building.activeStructureType = null;
C.clip = { mode: "block", elementType: [3] };
selection = { structureType: "filterRightMk2", memberCount: 2, draft: { mode: "allow", elementType: 1 } };
editorCalls.length = 0;
C.pasteIntoMenu("van-row");
check(editorCalls.map((c) => c.op).join(",") === "setDraft,apply", "PASTE into a row = editor setDraft, then apply (" + editorCalls.map((c) => c.op).join(",") + ")");
check(editorCalls[0] && editorCalls[0].f !== C.clip && JSON.stringify(editorCalls[0].f) === JSON.stringify({ mode: "block", elementType: [3] }), "…the draft handed over is a copy of the clip");
check(updateManyCalls.length === 0, "…and nothing is written behind the editor's back");
selection = null;

// --- 3. the clip round-trips through localStorage by element id ------------------------------
C.clip = { mode: "block", elementType: [3, 36, 61], affectsGas: true };
C.saveClip();
const raw = storage[CLIP_KEY];
check(!!raw && JSON.stringify(JSON.parse(raw).ids) === JSON.stringify(["water", "copper", "glassSand"]), "saved by element id: " + raw);
check(raw && !/"ids":\[[^\]]*\d/.test(raw), "…no element numbers in the stored clip");
check(raw && JSON.parse(raw).affectsGas === true && !("affectsLiquid" in JSON.parse(raw)), "…affectsGas:true is stored, the missing affectsLiquid is not stored at all");
// another PC: copper landed on another number, Manufacturing (glassSand) is not installed
IDS = { sand: 1, water: 3, copper: 44 };
C.clip = null;
check(C.loadClip() === true, "loadClip() resolves the stored clip on the other PC");
check(!!C.clip && JSON.stringify(C.clip.elementType) === "[3,44]" && C.clip.mode === "block", "water + copper come back as THIS PC's numbers (3, 44); glassSand from the missing mod is dropped: " + JSON.stringify(C.clip));
check(C.clip && C.clip.affectsGas === true && !("affectsLiquid" in C.clip), "the flag that was true is back; the missing one is absent, not false");
// a single-material clip stays a single number
C.clip = { mode: "allow", elementType: 3 }; C.saveClip(); C.clip = null; C.loadClip();
check(C.clip && C.clip.elementType === 3, "a single-material clip round-trips as one number, not a list");
// nothing resolvable yet (the world has not registered the materials): not loaded, retried later
storage[CLIP_KEY] = JSON.stringify({ mode: "allow", ids: ["glassSand"], single: true });
C.clip = null;
check(C.loadClip() === false && C.clip === null, "a clip whose materials all fail to resolve is not loaded (false = try again later)");
check(intervals.some((i) => i.ms === 1500), "…and a 1.5 s interval keeps retrying until the world has them");
IDS = { sand: 1, water: 3, copper: 36, glassSand: 61 };

// --- 4. Mk.1 filters are out: not pickable, no strip ------------------------------------------
const mk1 = { type: 18, x: 300, y: 10, filter: { mode: "allow", elementType: 3 } };
structs.push(mk1);
check(C.isFilter(mk1) === false && C.rowAt(301, 10) === null, "a Mk.1 filter (StructureType 18) is not a filter to the clipboard: rowAt → null");
selection = { structureType: 18, memberCount: 1, draft: { mode: "allow", elementType: 3 } };
check(C.menuUp() === null, "a Mk.1 row open in the game's editor → no menu");
check(!stripShown(), "…and the strip renders nothing");
selection = null;
state.session.building.activeStructureType = 18; engineActive = { type: "structure", id: 18 };
check(C.menuUp() === null && !stripShown(), "a Mk.1 filter in hand → no menu, no strip");
state.session.building.activeStructureType = null; engineActive = null;
check(!stripShown(), "nothing in hand → no strip");
engineActive = { type: "structure", id: "filterRightMk3" };
check(C.menuUp() === "mk3-new" && stripShown(), "a Mk.3 in hand (engine action.getActive) → menu 'mk3-new', strip shown");
engineActive = null;
// shakers carry a filter too but are not filters
structs.push({ type: "shaker", x: 320, y: 10, filter: { mode: "allow", elementType: 3 } });
check(C.rowAt(321, 10) === null, "a shaker's filter object does not make it pickable");

// --- 5. paste onto a placed row: only mode + elementType are written -------------------------
const F = () => ({ mode: "allow", elementType: 1, affectsLiquid: true, affectsGas: true, density: 5 });
structs.push({ type: "filterRightMk2", x: 100, y: 50, filter: F() }, { type: "filterRightMk2", x: 104, y: 50, filter: F() }, { type: "filterRightMk2", x: 108, y: 50, filter: F() },
	{ type: "filterRightMk2", x: 112, y: 50, filter: Object.assign(F(), { elementType: 3 }) },   // touching, other setting
	{ type: "filterLeftMk2", x: 96, y: 50, filter: F() });                                        // touching, other kind
const row = C.rowAt(105, 50);
check(!!row && row.members.length === 3 && row.members.map((m) => m.x).join(",") === "100,104,108", "rowAt picks the contiguous same-setting Mk.2 row: " + (row ? row.members.map((m) => m.x).join(",") : "none"));
C.clip = { mode: "block", elementType: [3, 36] };   // no liquid / gas flags at all
updateManyCalls.length = 0;
C.doPasteRow(row);
check(updateManyCalls.length === 1 && updateManyCalls[0].st === state && updateManyCalls[0].opts.propagateToWorkers === true && updateManyCalls[0].list.length === 3, "the row is written with one engine structures.updateMany(state, 3 members, {propagateToWorkers:true})");
const w = updateManyCalls[0] ? updateManyCalls[0].list : [];
check(w.every((m) => m.filter.mode === "block" && JSON.stringify(m.filter.elementType) === "[3,36]"), "each member now blocks water + copper");
check(w.every((m) => m.filter.affectsLiquid === true && m.filter.affectsGas === true && m.filter.density === 5), "each member's own affectsLiquid:true / affectsGas:true / density survive the paste");
check(new Set(w.map((m) => m.filter)).size === 3, "a filter object per member");
check(getAtCell(112, 50).filter.mode === "allow" && getAtCell(96, 50).filter.mode === "allow", "the neighbours outside the row are untouched");
// a clip that carries explicit false flags must not switch a row's filtering off either
C.clip = { mode: "allow", elementType: 36, affectsLiquid: false, affectsGas: false };
C.saveClip();
check(!/affects/.test(storage[CLIP_KEY]), "false flags are never persisted: " + storage[CLIP_KEY]);
updateManyCalls.length = 0; C.doPasteRow(C.rowAt(100, 50));
check(updateManyCalls[0] && updateManyCalls[0].list.every((m) => m.filter.affectsLiquid === true && m.filter.affectsGas === true), "a paste from a clip with false flags still leaves the row's flags true (only mode + elementType are written)");
// the same rule for the new-filter setting
state.store.options.defaultFilter = { mode: "allow", elementType: 1, affectsLiquid: true };
C.pasteIntoMenu("van-new");
const df = state.store.options.defaultFilter;
check(df.mode === "allow" && df.elementType === 36 && !("affectsLiquid" in df) && !("affectsGas" in df), "pasted into the new-filter setting, false flags are dropped rather than written: " + JSON.stringify(df));

// --- 6. arming Pick leaves the hand alone while the game's editor has a row open --------------
buildingCalls.length = 0;
selection = { structureType: "filterRightMk2", memberCount: 2, draft: { mode: "allow", elementType: 1 } };
state.session.building.activeStructureType = null; state.store.player.action = null; state.store.player.hotbar.activeSlotIndex = 2;
C.arm("copy");
check(C.mode === "copy" && buildingCalls.length === 0 && C.held === null, "Pick armed with a row open in the game's editor: no cancelPlacement, nothing stashed");
check(state.store.player.hotbar.activeSlotIndex === 2, "…the hotbar slot is untouched (clearing it would close the editor's row)");
C.arm(null); selection = null;
// with a Mk.2 in hand the building is put down and handed back through the game's own call
state.session.building.activeStructureType = "filterLeftMk2"; state.session.building.placing = true;
buildingCalls.length = 0;
C.arm("paste");
check(C.mode === "paste" && buildingCalls.includes("cancelPlacement") && state.session.building.activeStructureType === null && state.session.building.placing === false && state.store.player.hotbar.activeSlotIndex === null, "Pick armed with a Mk.2 in hand: cancelPlacement + activeStructureType / placing / hotbar slot cleared");
C.arm(null);
check(buildingCalls.includes("selectStructure:filterLeftMk2") && state.session.building.activeStructureType === "filterLeftMk2" && state.store.player.hotbar.activeSlotIndex === 2, "disarming hands the Mk.2 back via building.selectStructure and restores the slot");
state.session.building.activeStructureType = null;

check(typeof overlays["brandonFilterClipboard"] === "function", "the strip is mounted in the hotbar band as 'brandonFilterClipboard'");
check((handlers["game:ready"] || []).length >= 1, "a game:ready handler resets the armed state on a new world");

console.log(ok ? "\nALL OK" : "\nFAIL: see above"); process.exit(ok ? 0 : 1);
