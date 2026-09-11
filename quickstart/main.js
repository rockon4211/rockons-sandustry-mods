// Quick Start - F10 quick reload, straight back into the current save.
//
// The game's own "reload last save and play" button works by setting the
// db_load=<save id> query parameter and reloading the window - the boot code
// honors it and loads the save directly, no menu. F10 does exactly that.
// (F9 is the game's own quickload, F5 its quicksave, F4 the HUD toggle.)
// If you quicksaved (F5) this session, F10 prefers the quicksave slot
// (`<worldId>-quicksave`) - F5 then F10 loses zero progress.

const api = sandkit.api;
const MOD_ID = "brandon.quickstart";

function setting(key, fallback) {
	try { const v = api.settings.get(key); return v === undefined || v === null ? fallback : v; } catch (e) { return fallback; }
}
const isEnabled = () => setting("enabled", true);
function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

let sawQuickSave = false;
safe(() => window.addEventListener("keydown", (e) => { if (e.key === "F5") sawQuickSave = true; }));
safe(() => window.addEventListener("keydown", (e) => {
	if (e.key !== "F10" || !isEnabled()) return;
	e.preventDefault();
	let id = null;
	if (sawQuickSave) {
		const worldId = safe(() => sandkit.state.store.meta.worldId);
		if (worldId) id = worldId + "-quicksave";
	}
	if (!id) { try { id = new URLSearchParams(window.location.search).get("db_load"); } catch (_) {} }
	if (!id) {
		try {
			const raw = (window.electron && window.electron.getLastPlayedGameSync && window.electron.getLastPlayedGameSync())
				|| localStorage.getItem("lastPlayedGame");
			if (raw) { const p = typeof raw === "string" ? JSON.parse(raw) : raw; id = p && p.id != null ? p.id : null; }
		} catch (_) {}
	}
	safe(() => api.ui.toast(id ? "Quick reload - back into the save…" : "Quick reload - to the menu…"));
	const base = window.location.protocol + "//" + window.location.host + window.location.pathname;
	setTimeout(() => {
		try { window.history.replaceState({}, "", id ? base + "?db_load=" + id : base); } catch (_) {}
		window.location.reload();
	}, 150);
}));

console.log(`[${MOD_ID}] loaded - F10 quick reload armed`);
