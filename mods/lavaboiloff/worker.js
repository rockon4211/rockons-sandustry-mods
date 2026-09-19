// Lava Boil-Off — worker entry (runs in the simulation worker).
//
// Only this thread sees particles move and react. The base game turns Water into
// Steam when it touches Lava but never consumes the Lava. Here we watch water
// cells arriving next to lava (i.e. about to be boiled to steam) and, on that
// event, roll a 1-in-N chance to also remove the lava cell (it just vanishes).
const api = sandkit.api;
const MOD_ID = "brandon.lavaboiloff";

function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
function readType(x, y) { return safe(() => api.elements.getResolvedTypeAtCell(x, y)); }
const NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// Shared buffer (created by main.js). Layout, uint32:
//   [0]=enabled [1]=water [2]=lava [3]=denominator
//   [4]=rolls (water-meets-lava events)   [5]=vanished (lava cells removed)
// The [4]/[5] counters are the checker: [4] climbs fast whenever water touches
// lava, [5] climbs ~1/denominator as often — the main entry reads them out.
let shared = null;
const BUFLEN = 6;

// A water cell just moved to (x,y). If it's touching lava it will steam against
// it — roll the chance to burn that lava out.
function onWaterMoved(x, y) {
	if (!shared || shared[0] !== 1) return;
	const waterT = shared[1], lavaT = shared[2], denom = shared[3] || 5000;
	if (!waterT || !lavaT) return;
	if (readType(x, y) !== waterT) return;          // must still be water
	for (const [dx, dy] of NB) {
		const nx = x + dx, ny = y + dy;
		if (readType(nx, ny) === lavaT) {
			shared[4] = (shared[4] + 1) >>> 0;      // a roll happened (checker)
			if (Math.random() * denom < 1) {
				safe(() => api.elements.removeAtCell(nx, ny));
				shared[5] = (shared[5] + 1) >>> 0;  // lava vanished (checker)
			}
			return;                                 // one roll per water-move event
		}
	}
}

let armed = false;
function arm() {
	if (armed || !shared) return;
	const waterT = shared[1];
	if (!waterT) { if (typeof setTimeout === "function") setTimeout(arm, 300); return; } // wait for main.js to publish
	try {
		api.events.on("element:moved", (p) => { const d = p && p.destination; if (d) onWaterMoved(d.x, d.y); }, { guard: { elementType: waterT } });
		armed = true;
		console.log("[" + MOD_ID + "] worker armed (water type " + waterT + ")");
	} catch (e) { console.error("[" + MOD_ID + "] arm failed:", e); if (typeof setTimeout === "function") setTimeout(arm, 500); }
}

// The main entry creates the buffer before the worker loads, but 0.5.6's require
// THROWS if it isn't there yet — retry until it lands.
(function acquire(n) {
	if (shared) return;
	shared = safe(() => api.shared.buffers.require("brandonLavaBoiloff", { type: "uint32", length: BUFLEN })) || null;
	if (shared) { console.log("[" + MOD_ID + "] worker attached to shared state"); arm(); return; }
	if (n < 400 && typeof setTimeout === "function") setTimeout(() => acquire(n + 1), 100);
	else console.error("[" + MOD_ID + "] worker never got shared state");
})(0);
