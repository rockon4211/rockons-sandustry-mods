// Lava Boil-Off — main-thread entry.
//
// The actual effect runs in worker.js (only the sim worker sees particles react).
// This entry just resolves the water/lava element types and the player's config,
// and publishes them into a shared buffer the worker reads. Same shared-state
// pattern the Material Studio mods use.
const api = sandkit.api;
const React = sandkit.react;
const h = React && React.createElement;
const MOD_ID = "brandon.lavaboiloff";

function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
function setting(name, fb) {
	const v = safe(() => api.settings.get(name));
	if (typeof fb === "boolean") return typeof v === "boolean" ? v : fb;
	if (typeof fb === "number") return (typeof v === "number" && isFinite(v)) ? v : fb;
	return v === undefined ? fb : v;
}
function isEnabled() { return setting("enabled", true); }
function typeOf(id) {
	let t = safe(() => api.elements.getTypeFromId(id));
	if (typeof t !== "number") t = safe(() => api.elements.getElementTypeFromId(id));
	return typeof t === "number" ? t : 0;
}

// Shared buffer (uint32): [0]=enabled [1]=water [2]=lava [3]=denominator
//                         [4]=rolls  [5]=vanished   (the worker writes [4]/[5])
const BUFLEN = 6;
let shared = null;
try { shared = api.shared.buffers.create("brandonLavaBoiloff", { type: "uint32", length: BUFLEN }); }
catch (e) { console.error("[" + MOD_ID + "] shared buffer failed:", e); }

function publish() {
	if (!shared) return;
	shared[0] = isEnabled() ? 1 : 0;
	shared[1] = typeOf("water");
	shared[2] = typeOf("lava");
	shared[3] = Math.max(1, Math.round(setting("chanceDenominator", 5000)));
}
publish();
setInterval(publish, 1000);

// --- Checker readout ------------------------------------------------------
// A small HUD that proves the mod is live: shows the resolved water/lava types,
// the rarity, and the running roll / vanish counters the worker publishes. If
// "rolls" climbs when water meets lava, the worker is firing; if "vanished"
// climbs at roughly 1-in-N of that, the odds are right. Hide via the setting.
function showChecker() { return setting("showChecker", true); }
let repaint = null;
function inWorld() {
	const active = safe(() => api.scene.getActive());
	const Scene = safe(() => sandkit.enums.Scene) || {};
	const menus = [Scene.MainMenu, Scene.Intro].filter((v) => typeof v === "number");
	return active !== undefined && active !== null && (menus.length ? !menus.includes(active) : active > 2);
}
function Checker() {
	const [, b] = React.useState(0); repaint = b;
	if (!showChecker() || !shared || !inWorld()) return null;
	const en = shared[0] === 1, water = shared[1], lava = shared[2], denom = shared[3] || 0;
	const rolls = shared[4] >>> 0, vanished = shared[5] >>> 0;
	const observed = vanished > 0 ? Math.round(rolls / vanished) : null;
	const typesOk = water > 0 && lava > 0;
	const row = (t, c) => h("div", { style: { whiteSpace: "nowrap", color: c || "#cfe8dd" } }, t);
	return h("div", {
		style: {
			position: "fixed", left: "8px", top: "8px", zIndex: 99999, font: "11px monospace",
			background: "rgba(5,8,13,0.92)", color: "#cfe8dd", padding: "6px 9px",
			border: "1px solid " + (en && typesOk ? "#7a4a3a" : "#8a4a4a"), borderRadius: "4px",
			pointerEvents: "none", lineHeight: "1.5",
		},
	},
		row("Lava Boil-Off " + (en ? (typesOk ? "✓ armed" : "— resolving…") : "OFF"), en && typesOk ? "#f0a58a" : "#ffb38a"),
		row("water=" + water + " lava=" + lava + "  odds 1-in-" + denom),
		row("rolls: " + rolls + "   vanished: " + vanished),
		row("observed: " + (observed !== null ? "1-in-" + observed : "— (none yet)"), "#9fe7c8"));
}
if (h) {
	safe(() => api.ui.inject("brandon-lavaboiloff-checker", Checker));
	setInterval(() => { if (repaint) repaint((v) => v + 1); }, 500);
}

console.log("[" + MOD_ID + "] loaded (main)");
