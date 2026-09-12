// Manufacturing - hot-load stub (sync; worker entries cannot use await).
function __baked(sandkit) {
// Manufacturing - worker entry (generated). Touch reactions and purge rules
// live here because only this thread sees particles move.
const api = sandkit.api;
const MOD_ID = "brandon.manufacturing";
let shared = null;
const PROBE_BASE = 10;
try { shared = api.shared.buffers.require("state", { type: "uint32", length: 20 }); }
catch (e) { console.error(`[${MOD_ID}] worker cannot read shared state:`, e); }
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
// Vanilla makeovers, applied IN THIS THREAD: the world renderer reads this
// worker's own color scheme, and the main thread's update broadcast does not
// reliably reach it - so the worker re-applies the same patches directly.
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
applyMakeovers();
if (typeof setTimeout === "function") for (const d of [2000, 6000]) setTimeout(applyMakeovers, d);
// Probe responder: main writes a cell request (F8), this worker answers with
// ITS OWN view of that cell - type, def presence, matter, density. Comparing
// the two sides pins down cross-thread desyncs.
let probeSeen = 0;
if (typeof setInterval === "function") setInterval(() => {
	if (!shared) return;
	shared[PROBE_BASE + 8] = (shared[PROBE_BASE + 8] + 1) >>> 0; // heartbeat
	const seq = shared[PROBE_BASE + 2];
	if (!seq || seq === probeSeen) return;
	probeSeen = seq;
	const x = shared[PROBE_BASE], y = shared[PROBE_BASE + 1];
	const t = readType(x, y) || 0;
	const def = t ? safe(() => api.elements.getDefinitionByType(t)) : null;
	shared[PROBE_BASE + 3] = t;
	shared[PROBE_BASE + 4] = def ? 1 : 0;
	shared[PROBE_BASE + 5] = def && typeof def.matterType === "number" ? def.matterType : 255;
	shared[PROBE_BASE + 6] = def && typeof def.density === "number" ? def.density : 0;
	shared[PROBE_BASE + 7] = seq;
}, 200);
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

}
(function () {
	var ran = false;
	try {
		fetch("file:///C:/Users/Brand/AppData/Roaming/sandustry/mods/manufacturing/worker.real.js" + "?ts=" + Date.now()).then(function (r) {
			if (!r.ok) throw new Error("HTTP " + r.status);
			return r.text();
		}).then(function (src) {
			new Function("sandkit", src)(sandkit);
			ran = true;
			console.log("[brandon.manufacturing] worker hot-loaded worker.real.js fresh from disk");
		}).catch(function (e) {
			console.warn("[brandon.manufacturing] worker hot-load failed, using baked code:", e && e.message);
			if (!ran) __baked(sandkit);
		});
	} catch (e) {
		console.warn("[brandon.manufacturing] worker hot-load unavailable, using baked code");
		__baked(sandkit);
	}
})();
