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

// --- Checker panel --------------------------------------------------------
// Styled to match the Sandbox Loop panel: same title bar (grip + minimize),
// draggable by the title with a remembered position, same fonts/colors/badges.
// Hidden unless "Show checker panel" is on in the mod settings.
function showChecker() { return setting("showChecker", false); }
let repaint = null;
function inWorld() {
	const active = safe(() => api.scene.getActive());
	const Scene = safe(() => sandkit.enums.Scene) || {};
	const menus = [Scene.MainMenu, Scene.Intro].filter((v) => typeof v === "number");
	return active !== undefined && active !== null && (menus.length ? !menus.includes(active) : active > 2);
}
// position (default: top-right, mirroring Sandbox Loop's top-left) + minimize, both remembered
const POS_KEY = "brandon.lavaboiloff.panelpos", MIN_KEY = "brandon.lavaboiloff.panelmin";
let panelPos = { x: Math.max(12, (safe(() => window.innerWidth) || 1200) - 292), y: 84 };
(function loadPos() { const raw = safe(() => window.localStorage.getItem(POS_KEY)); const o = raw && safe(() => JSON.parse(raw)); if (o && typeof o.x === "number" && typeof o.y === "number") panelPos = o; })();
let panelMin = safe(() => window.localStorage.getItem(MIN_KEY)) === "1";
function setMin(v) { panelMin = !!v; safe(() => window.localStorage.setItem(MIN_KEY, panelMin ? "1" : "0")); if (repaint) repaint((x) => x + 1); }
let _drag = false, _ddx = 0, _ddy = 0;
safe(() => {
	window.addEventListener("mousemove", (e) => { if (!_drag) return; panelPos = { x: Math.max(0, e.clientX - _ddx), y: Math.max(0, e.clientY - _ddy) }; if (repaint) repaint((v) => v + 1); });
	window.addEventListener("mouseup", () => { if (!_drag) return; _drag = false; safe(() => window.localStorage.setItem(POS_KEY, JSON.stringify(panelPos))); });
});
function startDrag(e) { _drag = true; _ddx = e.clientX - panelPos.x; _ddy = e.clientY - panelPos.y; if (e.preventDefault) e.preventDefault(); }

// shared look (mirrors Sandbox Loop)
const FONT = '600 12px -apple-system,"Segoe UI",Roboto,sans-serif';
const SUBLINE = { fontSize: "10.5px", color: "#9aa6b2", fontWeight: 600, lineHeight: 1.55 };
const MINBTN = { background: "#1c2530", color: "#cdd6df", border: "1px solid #3a4550", borderRadius: "5px", fontSize: "13px", fontWeight: 800, lineHeight: 1, padding: "2px 9px", cursor: "pointer", flexShrink: 0 };
function cspan(color, text) { return h("span", { style: { color: color, fontWeight: 700, fontVariantNumeric: "tabular-nums" } }, text); }
function badge(text, k) {
	const col = k === "up" ? "#8fe0aa" : k === "down" ? "#e79b9b" : k === "warn" ? "#e0b060" : "#aab4c0";
	const bg = k === "up" ? "#16351f" : k === "down" ? "#351717" : k === "warn" ? "#3a2f12" : "#232a31";
	return h("span", { style: { background: bg, color: col, fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", padding: "2px 8px", borderRadius: "10px", whiteSpace: "nowrap", flexShrink: 0 } }, text);
}
function TitleBar(statusBadge) {
	return h("div", { onMouseDown: startDrag, title: "drag to move", style: { fontWeight: 800, marginBottom: "4px", letterSpacing: ".02em", cursor: _drag ? "grabbing" : "grab", userSelect: "none", display: "flex", alignItems: "center", gap: "7px" } },
		h("span", { style: { color: "#5b6470", fontSize: "13px", lineHeight: 1 } }, "⠿"),
		h("span", null, "Lava Boil-Off"),
		h("span", { style: { flex: "1 1 auto" } }),
		statusBadge,
		h("button", { title: panelMin ? "expand" : "minimize", onMouseDown: (e) => { if (e.stopPropagation) e.stopPropagation(); }, onClick: (e) => { if (e.stopPropagation) e.stopPropagation(); setMin(!panelMin); }, style: MINBTN }, panelMin ? "▢" : "–"));
}
function Checker() {
	const [, b] = React.useState(0); repaint = b;
	if (!showChecker() || !shared || !inWorld()) return null;
	const en = shared[0] === 1, water = shared[1], lava = shared[2], denom = shared[3] || 0;
	const rolls = shared[4] >>> 0, vanished = shared[5] >>> 0;
	const observed = vanished > 0 ? Math.round(rolls / vanished) : null;
	const typesOk = water > 0 && lava > 0;
	const status = !en ? badge("OFF", "flat") : typesOk ? badge("ARMED ✓", "up") : badge("RESOLVING…", "warn");
	const base = {
		position: "fixed", left: panelPos.x + "px", top: panelPos.y + "px", zIndex: 99998, pointerEvents: "auto",
		background: "rgba(10,14,20,0.94)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "8px",
		padding: "8px 10px", font: FONT, color: "#e8edf3", boxShadow: "0 4px 16px rgba(0,0,0,.5)",
	};
	if (panelMin) return h("div", { style: Object.assign({}, base, { minWidth: "200px" }) }, TitleBar(status));
	const line = (label, val, col) => h("div", { style: SUBLINE }, label + " ", cspan(col || "#e8edf3", val));
	return h("div", { style: Object.assign({}, base, { minWidth: "270px", maxWidth: "320px" }) },
		TitleBar(status),
		h("div", { style: { fontSize: "9.5px", color: "#8a94a0", fontWeight: 600, margin: "2px 0 4px", lineHeight: 1.5 } },
			"Each time lava boils water to steam, a ", cspan("#e0b060", "1-in-" + denom), " roll to burn the lava out."),
		line("rolls (water met lava):", String(rolls), "#c7d0da"),
		line("vanished (lava burnt out):", String(vanished), "#e79b9b"),
		line("observed odds:", observed !== null ? "1-in-" + observed : "— none yet", observed !== null ? "#8fe0aa" : "#aab4c0"),
		h("div", { style: { fontSize: "9px", color: "#6f7b88", marginTop: "4px", lineHeight: 1.5 } },
			"If rolls climb when water touches lava the mod is firing; if vanished tracks ~1-in-" + denom + " of that, the odds are right.  types water=" + water + " lava=" + lava));
}
if (h) {
	safe(() => api.ui.inject("brandon-lavaboiloff-checker", Checker));
	setInterval(() => { if (repaint) repaint((v) => v + 1); }, 500);
}

console.log("[" + MOD_ID + "] loaded (main)");
