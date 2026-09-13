// Workshop — M1: a main-menu button that boots the Workshop custom map.
//
// Runs inside new Function("__sandkit", ...) wrapped in an async IIFE: a plain
// script (no import/export, top-level await OK), with `sandkit` already in scope.
// The Workshop is a real separate map; the game loads a .custommap by navigating
// to ?custom_map=<id> (its own boot path), and the file lives in the user's
// custom_maps folder. This entry just offers the door from the main menu.

const api = sandkit.api;
const React = sandkit.react;
const h = React.createElement;
const MOD_ID = "brandon.workshop";
const MAP_ID = "brandon_workshop_v0";

function safe(fn, fb = null) { try { return fn(); } catch (e) { return fb; } }
function setting(name, fb) {
	const v = safe(() => api.settings.get(name));
	if (typeof fb === "boolean") return typeof v === "boolean" ? v : fb;
	return v;
}
function isEnabled() { return setting("enabled", true); }

// Scene: MainMenu=1, Intro=2, Deploy=3, Game=4. Show the button only in menu
// scenes, written as a hide-list so a wrong enum guess never strands the button
// on top of gameplay (where clicking it would reload away from an unsaved world).
const Scene = safe(() => sandkit.enums.Scene) || {};
function onMenu() {
	const active = safe(() => api.scene.getActive());
	const menu = [Scene.MainMenu, Scene.Intro].filter((v) => typeof v === "number");
	if (menu.length) return menu.includes(active);
	const game = typeof Scene.Game === "number" ? Scene.Game : 4;
	return active !== game;
}

// The game's own boot path for a custom map: set ?custom_map=<id> and reload.
function enterWorkshop() {
	const url = safe(() => new URL(window.location.href));
	if (!url) return;
	url.search = "?custom_map=" + encodeURIComponent(MAP_ID);
	window.location.href = url.toString();
}

// ---------------------------------------------------------------------------
// Shared progression, separate inventory. Tech / upgrades / gold carry from the
// base world into the workshop; the workshop keeps its own inventory (carried
// materials + hotbar). The two are separate worlds joined by a reload, so we
// snapshot the base world's progression to localStorage while you play it, and
// apply it on workshop entry. Verified store paths:
//   store.player.tech  = { <techId>: true }
//   store.upgrades     = { category: { id: { level, availableLevel } } }
//   store.resources.{gold, fluxite, artifacts}
const SNAP_KEY = "brandon.workshop.progression";

function bootIsWorkshop() {
	return (safe(() => window.location.search) || "").indexOf("custom_map=" + MAP_ID) !== -1;
}
function isBaseGame() {
	const Game = typeof Scene.Game === "number" ? Scene.Game : 4;
	return safe(() => api.scene.getActive()) === Game && !bootIsWorkshop();
}
function snapshotProgression() {
	const store = safe(() => sandkit.state.store);
	if (!store || !store.player) return;
	const res = store.resources || {};
	const snap = {
		tech: safe(() => store.player.tech) || {},
		buildings: safe(() => store.player.buildings) || null,    // THE buildable-machines list
		upgrades: safe(() => store.upgrades) || {},
		viability: safe(() => store.viability) || null,           // .level = which tiers are unlocked
		discoveries: safe(() => store.discoveries) || null,       // element/terrain reveals (recipe gates)
		progression: safe(() => store.progression) || null,       // upgradesUnlocked flag, dungeons
		story: safe(() => store.mods && store.mods.storyProgression) || null, // clears stale tier objective
		gold: typeof res.gold === "number" ? res.gold : null,     // store mirror of shared.gold[0]
		fluxite: typeof res.fluxite === "number" ? res.fluxite : null,
		artifacts: res.artifacts || null,
		ts: Date.now(),
	};
	safe(() => window.localStorage.setItem(SNAP_KEY, JSON.stringify(snap)));
}
function applyProgression() {
	const raw = safe(() => window.localStorage.getItem(SNAP_KEY));
	if (!raw) return;
	let snap = safe(() => JSON.parse(raw));
	if (!snap) return;
	const store = safe(() => sandkit.state.store);
	if (!store || !store.player) return;
	if (snap.tech) store.player.tech = Object.assign({}, store.player.tech, snap.tech);
	if (snap.buildings) store.player.buildings = snap.buildings; // makes researched machines buildable
	if (snap.upgrades) store.upgrades = snap.upgrades;
	if (snap.discoveries) store.discoveries = snap.discoveries;
	if (snap.progression) store.progression = snap.progression;
	// Factory tier: store.viability.level is authoritative for which tiers unlock;
	// factoryLevelCap must be null (uncapped) or it clamps the level.
	if (snap.viability) store.viability = snap.viability;
	store.factoryLevelCap = null;
	// Gold's HUD reads the shared buffer shared.gold[0]; the sim rewrites
	// store.resources.gold FROM it each tick, so we must set the buffer (setting
	// only the store gets overwritten back to 0). Fluxite/artifacts are plain store.
	if (typeof snap.gold === "number") {
		const shared = safe(() => sandkit.state.shared);
		if (shared && shared.gold) { try { shared.gold[0] = snap.gold; } catch (e) {} }
		if (store.resources) store.resources.gold = snap.gold;
	}
	if (store.resources) {
		if (typeof snap.fluxite === "number") store.resources.fluxite = snap.fluxite;
		if (snap.artifacts) store.resources.artifacts = snap.artifacts;
	}
	// Story step pointer: copying it clears the leftover "Unlock Tier N" objective.
	// Safe — cinematics only fire on live progression events, not from data.
	if (snap.story && store.mods) {
		if (!store.mods.storyProgression) store.mods.storyProgression = {};
		if (snap.story.currentStep !== undefined) store.mods.storyProgression.currentStep = snap.story.currentStep;
		if (snap.story.completedSteps) store.mods.storyProgression.completedSteps = snap.story.completedSteps;
	}
	const CID = safe(() => sandkit.enums.ComponentId) || {};
	safe(() => api.ui.update(typeof CID.TechTree === "number" ? CID.TechTree : 9));
	safe(() => api.ui.update(typeof CID.Upgrades === "number" ? CID.Upgrades : 14));
	safe(() => api.ui.update(typeof CID.Resources === "number" ? CID.Resources : 8));
	safe(() => api.ui.update(typeof CID.Objectives === "number" ? CID.Objectives : 17));
}

// While you play your base world, keep a fresh progression snapshot so the
// workshop can inherit it. Cheap; base-world only.
setInterval(() => { if (isEnabled() && isBaseGame()) snapshotProgression(); }, 4000);

// --- skip the intro/deploy cinematic, but ONLY when booting into the Workshop.
// A custom_map boot always starts at Scene.Intro and runs Intro -> Deploy ->
// Game; there is no boot flag or map-file field for it. api.game.start({skipIntro})
// jumps straight to Game. We gate strictly on our own map id in the URL so a
// normal new game (the player's own world) still plays its intro untouched.
(function skipWorkshopIntro() {
	const search = safe(() => window.location.search) || "";
	if (search.indexOf("custom_map=" + MAP_ID) === -1) return;
	const Game = typeof Scene.Game === "number" ? Scene.Game : 4;
	// ComponentId (sandkit.enums.ComponentId). The intro overlay is a UI element
	// that only refreshes on api.ui.update — flipping its .visible flag alone does
	// nothing, which is why the last attempt failed. IDs fall back to the known
	// 0.5.x values if the enum isn't exposed.
	const CID = safe(() => sandkit.enums.ComponentId) || {};
	const ID_INTRO = typeof CID.IntroScreen === "number" ? CID.IntroScreen : 20;
	const ID_ROOT = typeof CID.Root === "number" ? CID.Root : 4;
	const ID_TUT = typeof CID.Tutorial === "number" ? CID.Tutorial : 10;
	let tries = 0;
	// Mirror the game's own Skip-Intro button (bundle: hide overlay, ui.update
	// IntroScreen + Root, game.start{skip}), plus clear the tutorial flag. Repeat
	// for ~3.5s because the boot tail RE-SHOWS the intro ~1s AFTER mods run, so a
	// one-shot at load gets clobbered.
	const apply = () => {
		const st = safe(() => sandkit.state) || {};
		const store = st.store, session = st.session;
		if (safe(() => api.scene.getActive()) !== Game) safe(() => api.game.start({ skipIntro: true }));
		if (session && session.ui && session.ui.introScreen) session.ui.introScreen.visible = false;
		if (store) {
			if (store.tutorial) store.tutorial.active = false;
			if (store.scene && store.scene.triggers) store.scene.triggers.forEach((t) => { t.done = true; });
		}
		safe(() => api.ui.update(ID_INTRO));
		safe(() => api.ui.update(ID_ROOT));
		safe(() => api.ui.update(ID_TUT));
		applyProgression(); // inherit base-world tech / upgrades / gold
		if (++tries < 24) setTimeout(apply, 150);
		else safe(() => api.player.teleportToGround());
	};
	apply();
})();

// --- temporary on-screen diagnostic: compares the base snapshot in localStorage
// against the live store, in whatever world you're in. Remove once progression
// carry-over is verified.
let diagRepaint = null;
function techCount(m) { let n = 0; if (m) for (const k in m) { if (m[k]) n++; } return n; }
function DiagPanel() {
	const [, b] = React.useState(0); diagRepaint = b;
	if (!isEnabled()) return null;
	const store = safe(() => sandkit.state.store) || {};
	const shared = safe(() => sandkit.state.shared) || {};
	const active = safe(() => api.scene.getActive());
	let snap = {}; try { snap = JSON.parse(safe(() => window.localStorage.getItem(SNAP_KEY)) || "{}") || {}; } catch (e) {}
	const row = (t) => h("div", { style: { whiteSpace: "nowrap" } }, t);
	const sv = snap.viability, lv = store.viability;
	return h("div", {
		style: {
			position: "fixed", right: "8px", bottom: "8px", zIndex: 99999, font: "11px monospace",
			color: "#9fe7c8", background: "rgba(0,0,0,.72)", padding: "6px 9px",
			border: "1px solid #3d6b52", borderRadius: "4px", pointerEvents: "none", lineHeight: "1.45",
		},
	},
		row("WS DIAG  scene:" + active + "  workshopBoot:" + (bootIsWorkshop() ? "Y" : "N")),
		row("snapshot: tier=" + (sv && sv.level) + "  tech=" + techCount(snap.tech) + "  bld=" + ((snap.buildings && snap.buildings.length) || 0) + "  gold=" + snap.gold),
		row("live: tier=" + (lv && lv.level) + "  cap=" + String(store.factoryLevelCap) + "  tech=" + techCount(store.player && store.player.tech) + "  bld=" + ((store.player && store.player.buildings && store.player.buildings.length) || 0)),
		row("gold: shared=" + (shared.gold ? shared.gold[0] : "?") + "  store=" + (store.resources && store.resources.gold)));
}

let repaint = null;
function WorkshopButton() {
	const [, bump] = React.useState(0);
	repaint = bump; // capture latest setter so the scene poll can re-render
	if (!isEnabled() || !onMenu()) return null;
	return h("button", {
		onClick: enterWorkshop,
		title: "Load the Workshop map",
		style: {
			position: "fixed", right: "16px", bottom: "16px", zIndex: 99999,
			padding: "10px 16px", fontFamily: "monospace", fontSize: "13px",
			fontWeight: "700", letterSpacing: "0.04em", color: "#101318",
			background: "#ffd75e", border: "1px solid #a9860f", borderRadius: "6px",
			cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.45)",
		},
	}, "⚙ ENTER WORKSHOP");
}

// Light scene poll: re-render the button on menu/game transitions. A menu-only
// UI refresh at ~1s is negligible and avoids guessing scene-event names.
setInterval(() => { if (repaint) repaint((v) => v + 1); if (diagRepaint) diagRepaint((v) => v + 1); }, 900);

const dispose = safe(() => api.ui.inject("brandon-workshop-btn", WorkshopButton));
if (!dispose) console.warn("[" + MOD_ID + "] ui.inject failed - button unavailable");
safe(() => api.ui.inject("brandon-workshop-diag", DiagPanel));

// Keyboard fallback, menu only: Shift+W.
window.addEventListener("keydown", (e) => {
	if (!isEnabled() || !onMenu()) return;
	if (e.shiftKey && e.code === "KeyW") { enterWorkshop(); e.preventDefault(); e.stopPropagation(); }
}, true);

console.log("[" + MOD_ID + "] loaded - Enter Workshop button on the main menu (or Shift+W)");
