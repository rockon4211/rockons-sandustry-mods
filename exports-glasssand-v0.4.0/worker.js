// Glass Sand - worker entry (generated). Touch reactions and purge rules
// live here because only this thread sees particles move.
const api = sandkit.api;
const MOD_ID = "brandon.glasssand";
let shared = null;
try { shared = api.shared.buffers.require("state", { type: "uint32", length: 10 }); }
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
