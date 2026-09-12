// Manufacturing - hot-load stub (synchronous). Real code: worker.real.js.
function __baked(sandkit) {
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
	var src = null;
	try {
		var xhr = new XMLHttpRequest();
		xhr.open("GET", "file:///C:/Users/Brand/AppData/Roaming/sandustry/mods/manufacturing/worker.real.js" + "?ts=" + Date.now(), false);
		xhr.send();
		if (xhr.status === 0 || xhr.status === 200) src = xhr.responseText;
	} catch (e) { src = null; }
	try {
		if (src) { new Function("sandkit", src)(sandkit); console.log("[brandon.manufacturing] worker.js hot-loaded fresh from disk"); }
		else { __baked(sandkit); console.log("[brandon.manufacturing] worker.js using baked code (no disk read)"); }
	} catch (e) { console.warn("[brandon.manufacturing] worker.js hot-load threw, using baked:", e && e.message); __baked(sandkit); }
})();
