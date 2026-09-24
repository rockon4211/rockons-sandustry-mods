// Manufacturing - worker entry (generated). Touch reactions and purge rules
// live here because only this thread sees particles move.
const api = sandkit.api;
const MOD_ID = "brandon.manufacturing";
let shared = null;
const BUFLEN = 10;
function safe0(fn) { try { return fn(); } catch (e) { return undefined; } }
// The main entry loads synchronously and creates the shared buffer before this
// worker loads, but 0.5.6's shared.require THROWS hard if the buffer is not
// there yet - so retry until it lands rather than dying on the first try. The
// handlers below re-check `shared` and come alive the moment it is attached.
(function acquire(n) {
	if (shared) return;
	shared = safe0(() => api.shared.buffers.require("state", { type: "uint32", length: BUFLEN })) || null;
	if (shared) { console.log(`[${MOD_ID}] worker attached to shared state`); return; }
	if (n < 400 && typeof setTimeout === "function") setTimeout(() => acquire(n + 1), 100);
	else console.error(`[${MOD_ID}] worker never got shared state`);
})(0);
const T = 0, P0 = 8, P = 1;
const active = () => shared && shared[0] === 1;
function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
function readType(x, y) { return safe(() => api.elements.getResolvedTypeAtCell(x, y)); }
let writeMode = null;
const WRITERS = [
	["replaceAtCell", (x, y, t) => api.elements.replaceAtCell(x, y, t)],
	["removeCreateAtCell", (x, y, t) => { api.elements.removeAtCell(x, y); api.elements.createAtCell(x, y, t); }],
];
function setCell(x, y, t) {
	for (const [name, w] of WRITERS) {
		if (writeMode !== null && writeMode !== name) continue;
		safe(() => w(x, y, t));
		if (readType(x, y) === t) { writeMode = name; return true; }
	}
	return false;
}
function clearCell(x, y) { safe(() => api.elements.removeAtCell(x, y)); }
const NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];
function scan(x, y) {
	if (!active() || !shared) return;
	const here = readType(x, y);
	for (let j = 0; j < P; j++) {
		const from = shared[P0 + j * 2], to = shared[P0 + j * 2 + 1];
		if (from && to && here === from) { if (setCell(x, y, to)) return; }
	}
	for (let i = 0; i < T; i++) {
		const from = shared[8 + i * 3], partner = shared[9 + i * 3], to = shared[10 + i * 3];
		if (!from || !partner || !to) continue;
		if (here !== from && here !== partner) continue;
		for (const [dx, dy] of NB) {
			const nx = x + dx, ny = y + dy, n = readType(nx, ny);
			if (here === from && n === partner) {
				// Confirm right before writing - the event can be a tick stale.
				if (readType(x, y) !== from) return;
				if (setCell(x, y, to)) { clearCell(nx, ny); return; }
			} else if (here === partner && n === from) {
				if (readType(nx, ny) !== from) return;
				if (setCell(nx, ny, to)) { clearCell(x, y); return; }
			}
		}
	}
}
// Vanilla makeovers, worker side. 0.5.6 audit (2026-09): the worker mod
// runtime does NOT expose api.elements.updateDefinition, so this path is a
// no-op there and the main-thread update (which now postAll-broadcasts to the
// sim workers) is what actually lands the makeover. Kept and gated on the
// method's presence so it self-activates if a future worker runtime adds it,
// without burning two timers per load when it is absent.
// (nameKey: null clears the i18n key so the custom name wins on this side too.)
const MAKEOVERS = [{"id":"sand","patch":{"nameKey":null,"name":"soil"}},{"id":"wetSand","patch":{"nameKey":null,"name":"Wet Soil"}}];
function applyMakeovers() {
	for (const m of MAKEOVERS) {
		let t = safe(() => api.elements.getTypeFromId(m.id));
		if (typeof t !== "number") continue;
		const patch = Object.assign({}, m.patch);
		if (patch.nameKey === null) patch.nameKey = void 0;
		safe(() => api.elements.updateDefinition(t, patch));
	}
	if (MAKEOVERS.length) console.log(`[${MOD_ID}] worker makeovers applied (${MAKEOVERS.map(m => m.id).join(", ")})`);
}
if (typeof (api.elements && api.elements.updateDefinition) === "function") {
	applyMakeovers();
	if (typeof setTimeout === "function") for (const d of [2000, 6000]) setTimeout(applyMakeovers, d);
}
function register() {
	let ready = false;
	for (let i = 0; i < T; i++) if (shared && shared[8 + i * 3]) ready = true;
	for (let j = 0; j < P; j++) if (shared && shared[P0 + j * 2]) ready = true;
	if (!shared || !ready) {
		if (typeof setTimeout === "function") setTimeout(register, 500);
		return;
	}
	try {
		const types = new Set();
		for (let i = 0; i < T; i++) { types.add(shared[8 + i * 3]); types.add(shared[9 + i * 3]); }
		for (let j = 0; j < P; j++) types.add(shared[P0 + j * 2]);
		for (const t of types) {
			if (!t) continue;
			api.events.on("element:moved", (p) => { const d = p && p.destination; if (d) scan(d.x, d.y); }, { guard: { elementType: t } });
		}
		console.log(`[${MOD_ID}] worker armed (${types.size} watched types)`);
	} catch (e) { console.error(`[${MOD_ID}] worker subscribe failed:`, e); }
}
register();


// --------------------------------------------- Mk2 filter speed (worker) --
// The belt pass reads each belt type's cells-per-pass from this worker's own
// transport config on every pass. Mk.2 Filters run in the regular belt pass
// (every 332 ms); the Mk.2 Conveyor Belt runs twice as often. With the upgrade
// ON, Mk.2 Filters move 2 cells per pass instead of 1 - the same speed as the
// Mk.2 belt. The config object is frozen, so a patched copy is swapped in, and
// the original is put back when it's switched OFF.
(function filterBoost() {
	let buf = null, original = null, applied = -1;
	const TYPES = ["filterLeftMk2", "filterRightMk2"];
	function sk() { return sandkit.state && sandkit.state.sandkit; }
	function apply(on) {
		const k = sk();
		if (!k || !k.jsonConfigs || !k.jsonConfigs.transport) return false;
		if (!original) original = k.jsonConfigs;
		if (!on) { k.jsonConfigs = original; return true; }
		const transport = JSON.parse(JSON.stringify(original.transport));
		const structs = transport && transport.conveyors && transport.conveyors.structures;
		if (!structs) return false;
		for (const id of TYPES) if (structs[id]) structs[id].maxDisplacementCellsPerPass = 2 * (original.transport.conveyors.structures[id].maxDisplacementCellsPerPass || 1);
		k.jsonConfigs = Object.assign({}, original, { transport: transport });
		return true;
	}
	function tick() {
		if (!buf) buf = safe(() => api.shared.buffers.require("filterBoost", { type: "uint32", length: 2 })) || null;
		if (buf) {
			const on = buf[0] === 1 ? 1 : 0;
			if (on !== applied && apply(on === 1)) {
				applied = on; buf[1] = on + 1;
				console.log(`[${MOD_ID}] worker: Mk.2 Filter belt speed ${on ? "ON (2 cells per pass)" : "OFF"}`);
			}
		}
		if (typeof setTimeout === "function") setTimeout(tick, 400);
	}
	tick();
})();
