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

// Item enums + the matter-tools we never allow in the workshop (they break the
// closed economy). Vacuum covers the mod's Omni Vacuum too (it just enhances the
// base Vacuum). Volcanizer (the lava gun) uses the string id "volcanizer". The
// Matter Gun (brandonMatterGun) is NOT blocked — it stays for testing.
const ItemId = safe(() => sandkit.enums.ItemId) || {};
const ItemType = safe(() => sandkit.enums.ItemType) || {};
const BLOCKED_TOOL_IDS = new Set([ItemId.Vacuum, ItemId.RocketLauncher, ItemId.Flamethrower, ItemId.Cryoblaster].filter((v) => v !== undefined));
const BLOCKED_TOOL_NAMES = new Set(["vacuum", "rocketlauncher", "flamethrower", "cryoblaster", "volcanizer"]);
function isBlockedTool(id) {
	if (id === undefined || id === null) return false;
	if (BLOCKED_TOOL_IDS.has(id)) return true;
	if (typeof id === "string" && BLOCKED_TOOL_NAMES.has(id.toLowerCase())) return true;
	return false;
}

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
		inputRate: safe(() => currentRate, 0) || 0,   // Redsand/min fed to the basket over the last minute
		tools: (function () {                          // hand items the player owns in the overworld
			const inv = safe(() => store.player.inventory) || [];
			const out = [];
			for (const it of inv) {
				if (!it || it.id === undefined || it.id === null) continue;
				const t = it.itemType;
				if (t === undefined || t === ItemType.Tool || t === ItemType.Weapon || t === ItemType.Mod) out.push(it.id);
			}
			return out;
		})(),
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
	// Upgrades: apply each carried level through the game's own api.upgrades.setLevelById,
	// which sets the level AND fires the upgrade's onUpgrade(state, level) so the effect
	// actually applies (merging raw level data left them shown-but-inert). Only call it
	// when the level differs, so the boot loop doesn't re-fire onUpgrade every cycle.
	if (snap.upgrades) {
		const canSet = safe(() => typeof api.upgrades.setLevelById === "function");
		for (const cat in snap.upgrades) {
			const src = snap.upgrades[cat]; if (!src || typeof src !== "object") continue;
			if (store.upgrades && !store.upgrades[cat]) store.upgrades[cat] = {};
			for (const uid in src) {
				const s2 = src[uid]; if (!s2 || typeof s2.level !== "number") continue;
				if (canSet) {
					const cur = safe(() => api.upgrades.getLevelById(cat, uid));
					if (cur !== s2.level) safe(() => api.upgrades.setLevelById(cat, uid, s2.level));
				} else if (store.upgrades) {
					if (!store.upgrades[cat][uid]) store.upgrades[cat][uid] = {};
					store.upgrades[cat][uid].level = s2.level;
				}
				if (store.upgrades && store.upgrades[cat] && store.upgrades[cat][uid] && typeof s2.availableLevel === "number")
					store.upgrades[cat][uid].availableLevel = s2.availableLevel;
			}
		}
	}
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

// Workshop toolset. The game finds usable tools in store.player.inventory, so we
// create + PUSH each granted item there (createById alone only makes the instance).
// Two modes, decided by whether the Mod Tools mod is loaded (Matter Gun registered):
//   MOD TOOLS ON  -> testing sandbox: grant every registered item (everything).
//   MOD TOOLS OFF -> normal: grant only the tools you owned in the overworld
//                    (snapshot.tools), MINUS the blocked matter-tools.
// In the OFF (normal) case we also strip any blocked matter-tool that snuck in, so
// the workshop can never carry the Vacuum / Cryoblaster / Flamethrower / Volcanizer
// / Rocket Launcher. Runs periodically so a workshop re-init can't undo it.
let workshopToolsGranted = false, wsToolsMade = 0, wsModToolsOn = false;
function grantWorkshopTools() {
	if (!isEnabled() || !bootIsWorkshop()) return;
	const store = safe(() => sandkit.state.store);
	if (!store || !store.player || !Array.isArray(store.player.inventory)) return;
	const mk = safe(() => api.items.createById) || safe(() => api.items.createFromId);
	if (typeof mk !== "function") return;
	const inv = store.player.inventory;
	const regIds = safe(() => api.items.getRegisteredIds()) || [];
	wsModToolsOn = Array.isArray(regIds) && regIds.indexOf("brandonMatterGun") !== -1;

	// Source list + whether to enforce the block:
	//   ON  -> all registered items, no block (full sandbox).
	//   OFF -> the overworld toolset from the snapshot, block enforced.
	let source, enforceBlock;
	if (wsModToolsOn) { source = regIds; enforceBlock = false; }
	else {
		let snap = {}; try { snap = JSON.parse(safe(() => window.localStorage.getItem(SNAP_KEY)) || "{}") || {}; } catch (e) {}
		source = Array.isArray(snap.tools) ? snap.tools : [];
		enforceBlock = true;
	}

	// In normal mode, remove any blocked matter-tool already in the inventory
	// (default tools, or something carried), so they can't be used in the workshop.
	if (enforceBlock) {
		for (let i = inv.length - 1; i >= 0; i--) { const it = inv[i]; if (it && isBlockedTool(it.id)) inv.splice(i, 1); }
	}

	let made = 0;
	for (const id of source) {
		if (enforceBlock && isBlockedTool(id)) continue;
		if (inv.some((e) => e && e.id === id)) continue;   // already have it
		const n = safe(() => mk(id));
		if (!n) continue;
		safe(() => inv.push(n));
		made++;
	}
	if (made > 0) {
		wsToolsMade += made; workshopToolsGranted = true;
		safe(() => api.ui.overlays && api.ui.overlays.update("hotbar"));
		console.log("[" + MOD_ID + "] workshop tools (" + (wsModToolsOn ? "sandbox" : "normal") + "): pushed " + made + " into inventory");
	}
}
setInterval(grantWorkshopTools, 3000);

// While you play your base world, keep a fresh progression snapshot so the
// workshop can inherit it. Cheap; base-world only.
setInterval(() => { if (isEnabled() && isBaseGame()) snapshotProgression(); }, 4000);

// --- TEMP diagnostic for tools + upgrades in the workshop ---
let dbgRepaint = null;
function WsDbg() {
	const [, b] = React.useState(0); dbgRepaint = b;
	if (!isEnabled() || !bootIsWorkshop()) return null;
	const store = safe(() => sandkit.state.store) || {};
	const ids = safe(() => api.items.getRegisteredIds()) || [];
	const gun = Array.isArray(ids) && ids.indexOf("brandonMatterGun") !== -1;
	let snap = {}; try { snap = JSON.parse(safe(() => window.localStorage.getItem(SNAP_KEY)) || "{}") || {}; } catch (e) {}
	// sample first upgrade
	let up = "-", uLive = "-", uSnap = "-";
	const U = store.upgrades || {}; const cats = Object.keys(U);
	for (const c of cats) { const uids = Object.keys(U[c] || {}); if (uids.length) { up = c + "/" + uids[0]; uLive = safe(() => U[c][uids[0]].level, "?"); uSnap = safe(() => snap.upgrades[c][uids[0]].level, "?"); break; } }
	const row = (t) => h("div", { style: { whiteSpace: "nowrap" } }, t);
	return h("div", { style: {
		position: "fixed", left: "8px", bottom: "8px", zIndex: 99999, font: "11px monospace",
		color: "#9fe7c8", background: "#05080d", padding: "5px 8px", border: "1px solid #3d6b52",
		borderRadius: "4px", pointerEvents: "none", lineHeight: "1.45",
	} },
		row("tools: mode=" + (wsModToolsOn ? "SANDBOX" : "normal") + " snapTools=" + safe(() => (snap.tools || []).length, 0) + " invTools=" + safe(() => store.player.inventory.filter((e) => e && (e.itemType === ItemType.Tool || e.itemType === ItemType.Weapon || e.itemType === ItemType.Mod)).length, 0) + " made=" + safe(() => wsToolsMade, 0)),
		row("upg: cats=" + cats.length + " " + up + " live=" + uLive + " snap=" + uSnap + " snapCats=" + safe(() => Object.keys(snap.upgrades || {}).length, 0)));
}
safe(() => api.ui.inject("brandon-ws-dbg", WsDbg));
setInterval(() => { if (dbgRepaint) dbgRepaint((v) => v + 1); }, 1000);

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
		grantWorkshopTools(); // testing: full toolkit + mod tools inside the workshop
		if (++tries < 24) setTimeout(apply, 150);
		else safe(() => api.player.teleportToGround());
	};
	apply();
})();

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
setInterval(() => { if (repaint) repaint((v) => v + 1); }, 900);

const dispose = safe(() => api.ui.inject("brandon-workshop-btn", WorkshopButton));
if (!dispose) console.warn("[" + MOD_ID + "] ui.inject failed - button unavailable");

// ===========================================================================
// M2a - the buildable Workshop Door. Build it in your base from the build menu
// (category: production), then walk up to it to step into the workshop. The
// input basket + per-minute counter + red/green ready gate come next (M2b/M2c).
const STRUCT_ID = "brandonWorkshopFactory";        // renamed to force a fresh registration
const DOOR_SPRITE = "brandonWorkshopFactorySprite";
let structRegistered = false;
let lastStructErr = "";

(async () => {
	try { await api.sprites.loadFromMod(DOOR_SPRITE, "door.png"); }
	catch (e) { console.error("[" + MOD_ID + "] door.png failed to load:", e); lastStructErr = "sprite"; }
	try {
		api.structures.register({
			id: STRUCT_ID,
			name: "Workshop Factory",
			description: "Two blocks: a door you enter, and an open basket. Pour Redsand into the basket; once a minute's worth is gathered, the door opens.",
			categoryKey: "production",
			buildModes: [{ type: "line", directions: ["horizontal"] }],
			variants: [{ id: STRUCT_ID, angles: [0] }],
			// A structure is drawn at its SHAPE's size, so shape and sprite must match
			// exactly: 48x24 shape <-> 192x96 sprite (12x6 blocks, 3x size). BUCKET left
			// (cols0-20, 17-wide open interior, open top), BODY mid (cols21-29), DOOR right
			// (cols30-47, opening cols33-47 open to the RIGHT), SIGN banner rows0-2 cols21-47.
			render: { imageName: DOOR_SPRITE, size: { width: 192, height: 96 }, offset: { x: 0, y: 0 }, ui: { outline: true } },
			shape: [
				[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
			],
			defaultData: {},
		});
		structRegistered = true;
		console.log("[" + MOD_ID + "] Workshop Door structure registered");
	} catch (e) { console.error("[" + MOD_ID + "] structure register failed:", e); lastStructErr = String(e && e.message || e); }

	// --- Cleanup: the OLD id "brandonWorkshopDoor" was renamed to the current id,
	// which left any previously-placed one as a stuck, un-demolishable red error
	// block (the engine can't demolish a type it doesn't recognize). Re-register the
	// old id as a valid, demolishable placeholder so it can be removed with the
	// Demolisher. It's NOT added to the buildings list, so it can't be built again.
	try {
		api.structures.register({
			id: "brandonWorkshopDoor",
			name: "Old Workshop Factory (remove me)",
			description: "Leftover from an earlier version. Demolish this to clear it.",
			categoryKey: "production",
			buildModes: [{ type: "line", directions: ["horizontal"] }],
			variants: [{ id: "brandonWorkshopDoor", angles: [0] }],
			render: { imageName: DOOR_SPRITE, size: { width: 64, height: 32 }, offset: { x: 0, y: 0 }, ui: { outline: true } },
			shape: [
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
			],
			defaultData: {},
		});
		console.log("[" + MOD_ID + "] old brandonWorkshopDoor re-registered as removable placeholder");
	} catch (e) { console.error("[" + MOD_ID + "] old-id placeholder register failed:", e); }
})();

// Make the door buildable (add it to the unlocked-buildings list). No tech gate.
function ensureBuildable() {
	const store = safe(() => sandkit.state.store);
	if (store && store.player && Array.isArray(store.player.buildings) && store.player.buildings.indexOf(STRUCT_ID) === -1) {
		store.player.buildings.push(STRUCT_ID);
	}
}
safe(() => api.events.on("game:ready", ensureBuildable));

// Track where doors are placed (cell origin of each), for the walk-up trigger.
const doorCells = new Map();
const dkey = (x, y) => x + "," + y;
function addDoor(x, y) { if (typeof x === "number") doorCells.set(dkey(x, y), { x: x, y: y }); }
function delDoor(x, y) { doorCells.delete(dkey(x, y)); }
safe(() => api.events.on("building:placed", (p) => { const s = p && p.structure; if (s && s.type === STRUCT_ID) addDoor(s.x, s.y); }));
safe(() => api.events.on("building:removed", (p) => { if (p && p.structureId === STRUCT_ID) delDoor(p.x, p.y); }));
safe(() => api.events.on("structures:removed", (p) => { const r = (p && (p.structures || p.removed)) || []; for (const e of r) { if (e && e.type === STRUCT_ID) delDoor(e.x, e.y); } }));
safe(() => api.events.on("game:ready", () => { doorCells.clear(); safe(() => api.structures.forEachOfType(STRUCT_ID, (s) => addDoor(s.x, s.y))); }));

// ===========================================================================
// M2b - the input basket. Redsand (sandium) routed into the intake zone above a
// Workshop Door is absorbed and counted; we track a per-minute rate and gate the
// door red->green (locked until >=1 minute of Redsand has been gathered). Done by
// sampling the intake cells on the MAIN thread - no sim-worker entry, so none of
// the shared-buffer timing fragility.
const RATE_WINDOW_MS = 60000;         // "per minute" + the 1-minute unlock gate
let sandiumType = null;
let intakeTotal = 0, firstDepositMs = 0, currentRate = 0, doorReady = false, readyRepaint = null;
const recentlyRemoved = new Map();    // "x,y" -> expiry, so a grain isn't double-counted before removal lands
const rateHist = [];                  // {t, total} samples for the rolling window

function resolveSandium() {
	if (typeof sandiumType !== "number") sandiumType = safe(() => api.elements.getTypeFromId("sandium"));
	return sandiumType;
}
safe(() => api.events.on("game:ready", () => { sandiumType = null; resolveSandium(); }));

// Sample the intake box above each door; absorb Redsand grains and count them.
setInterval(() => {
	if (!isEnabled() || !isBaseGame() || doorCells.size === 0) return;
	const st = resolveSandium();
	if (typeof st !== "number") return;
	const now = Date.now();
	for (const d of doorCells.values()) {
		// Intake = the open bucket interior (cols +2..+18), plus rows above so
		// grains are caught as they drop into the open-top bin.
		for (let x = d.x + 2; x <= d.x + 18; x++) {
			for (let y = d.y - 1; y <= d.y + 20; y++) {
				const key = x + "," + y;
				if ((recentlyRemoved.get(key) || 0) > now) continue;
				if (safe(() => api.elements.getResolvedTypeAtCell(x, y)) === st) {
					safe(() => api.elements.removeAtCellWhenIdle(x, y));
					recentlyRemoved.set(key, now + 600);
					intakeTotal++;
					if (!firstDepositMs) firstDepositMs = now;
				}
			}
		}
	}
	if (recentlyRemoved.size > 128) { for (const [k, exp] of recentlyRemoved) if (exp < now) recentlyRemoved.delete(k); }
}, 150);

// Per-minute rate + the ready gate (green once a full minute has been gathered).
setInterval(() => {
	const now = Date.now();
	rateHist.push({ t: now, total: intakeTotal });
	while (rateHist.length > 1 && rateHist[0].t < now - RATE_WINDOW_MS - 2000) rateHist.shift();
	let oldTotal = 0;
	for (const e of rateHist) { if (e.t <= now - RATE_WINDOW_MS) oldTotal = e.total; }
	currentRate = intakeTotal - oldTotal;
	// Open as soon as ANY Redsand has been fed in — the release rate is a rolling
	// per-minute measure, so there's no reason to make the player wait a full minute.
	doorReady = !!firstDepositMs;
	if (readyRepaint) readyRepaint((v) => v + 1);
	if (promptRepaint) promptRepaint((v) => v + 1);
}, 1000);

// Always-visible factory readout: current Redsand/min + the red/green ready light.
function IntakeHUD() {
	const [, b] = React.useState(0); readyRepaint = b;
	if (!isEnabled() || !isBaseGame() || doorCells.size === 0) return null;
	return h("div", {
		style: {
			position: "fixed", left: "50%", top: "14px", transform: "translateX(-50%)", zIndex: 99998,
			display: "flex", alignItems: "center", gap: "9px",
			padding: "6px 14px", background: "rgba(10,14,20,0.9)", border: "1px solid rgba(255,255,255,0.14)",
			borderRadius: "8px", font: '600 13px -apple-system, "Segoe UI", Roboto, sans-serif',
			color: "#eef1f5", pointerEvents: "none", boxShadow: "0 2px 10px rgba(0,0,0,0.4)", whiteSpace: "nowrap",
		},
	},
		h("span", {
			style: {
				width: "11px", height: "11px", borderRadius: "50%", flexShrink: 0,
				background: doorReady ? "#4ade80" : "#f0603c",
				boxShadow: doorReady ? "0 0 8px #4ade80" : "0 0 8px #f0603c",
			},
		}),
		"Workshop  ·  Redsand " + currentRate + "/min" + (doorReady ? "  ·  READY" : "  ·  gathering") +
			safe(() => (oilOutRate > 0 ? "  ·  Oil out " + Math.round(oilOutRate) + "/min" : ""), "")
	);
}
safe(() => api.ui.inject("brandon-workshop-intake", IntakeHUD));

// Walk-up trigger: dwell next to a door in the base world -> snapshot progression
// and enter the workshop. Debounced + 4s cooldown so it fires once per approach.
function cellSize() { const m = safe(() => api.rendering.getGridMetrics()); return (m && m.cellSize) ? m.cellSize : 4; }
const ENTER_RADIUS = 4;                       // cells from any part of the door
const INTERACT_CODE = "KeyY", INTERACT_LABEL = "Y"; // Y is unbound by the game
let nearestDist = -1, canEnterDoor = false, lastEnterMs = 0, promptRepaint = null;

// Proximity poll: are we close enough to a door to enter? (Entry itself is on the
// interact key, not auto — see the keydown handler below.)
setInterval(() => {
	const wasCan = canEnterDoor;
	if (!isEnabled() || !isBaseGame() || doorCells.size === 0) {
		nearestDist = -1; canEnterDoor = false;
		if (wasCan && promptRepaint) promptRepaint((v) => v + 1);
		return;
	}
	const world = safe(() => api.player.getPositionAtWorld()) || safe(() => api.player.getWorldPosition());
	if (!world) return;
	const cs = cellSize();
	const px = world.x / cs, py = world.y / cs;
	let best = Infinity;
	for (const d of doorCells.values()) {
		const cx = Math.max(d.x, Math.min(px, d.x + 47)); // 48 wide
		const cy = Math.max(d.y, Math.min(py, d.y + 23)); // 24 tall
		const dist = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
		if (dist < best) best = dist;
	}
	nearestDist = best;
	canEnterDoor = best <= ENTER_RADIUS;
	if (canEnterDoor !== wasCan && promptRepaint) promptRepaint((v) => v + 1);
}, 150);

function doEnterWorkshop() {
	const now = Date.now();
	if (now - lastEnterMs < 2000) return;
	lastEnterMs = now;
	safe(snapshotProgression); // capture base progression at the moment of entry
	enterWorkshop();
}

// "Press Y to enter" prompt, shown only when close to a door in the base world.
function EnterPrompt() {
	const [, b] = React.useState(0); promptRepaint = b;
	if (!isEnabled() || !isBaseGame() || !canEnterDoor) return null;
	const ready = doorReady;
	const text = ready ? "Press " + INTERACT_LABEL + " — Enter Workshop" : "Feed Redsand into the basket";
	return h("div", {
		style: {
			// Standard overlay shelf: bottom 258px, above the tool/grabber bars —
			// same spot as the Manufacturing mod's Heavy Stone toggle.
			position: "fixed", left: "50%", bottom: "258px", transform: "translateX(-50%)", zIndex: 99999,
			font: "600 14px monospace", letterSpacing: "0.03em",
			color: ready ? "#101318" : "#fff",
			background: ready ? "#ffd75e" : "rgba(200,60,40,0.92)",
			padding: "8px 16px", borderRadius: "6px",
			border: "1px solid " + (ready ? "#a9860f" : "rgba(255,120,100,0.6)"),
			boxShadow: "0 4px 14px rgba(0,0,0,.45)", pointerEvents: "none", whiteSpace: "nowrap",
		},
	}, text);
}
safe(() => api.ui.inject("brandon-workshop-prompt", EnterPrompt));

// The interact key: enter only when near a door AND it's ready (green light).
window.addEventListener("keydown", (e) => {
	if (!isEnabled() || !isBaseGame() || !canEnterDoor || !doorReady) return;
	if (e.code === INTERACT_CODE) { doEnterWorkshop(); e.preventDefault(); e.stopPropagation(); }
}, true);

// Keyboard fallback, menu only: Shift+W.
window.addEventListener("keydown", (e) => {
	if (!isEnabled() || !onMenu()) return;
	if (e.shiftKey && e.code === "KeyW") { enterWorkshop(); e.preventDefault(); e.stopPropagation(); }
}, true);

// ===========================================================================
// M3 - Redsand release INSIDE the workshop. The per-minute rate you fed the
// basket in the overworld is captured at entry (snapshot.inputRate) and drives
// an inlet spout high in the workshop room: it rains Redsand down at that same
// rate, giving you raw material to process. Backpressure-capped so a blocked
// spout doesn't hoard grains and then dump a flood.
//   Room is 384x320, walls x<5 / x>=379, floor y>=280, player spawns y=200.
// ===========================================================================
const WS_TICK_MS = 200;
let wsInputRate = 0, wsAccum = 0, wsLastSpawn = 0, wsReleased = 0, wsHudRepaint = null;

function readInputRate() {
	const raw = safe(() => window.localStorage.getItem(SNAP_KEY));
	if (!raw) return 0;
	const snap = safe(() => JSON.parse(raw));
	return (snap && typeof snap.inputRate === "number") ? snap.inputRate : 0;
}

// Keep the target rate fresh from the snapshot (also picks it up once the
// workshop has finished booting and localStorage is readable).
setInterval(() => {
	if (!isEnabled() || !bootIsWorkshop()) return;
	const r = readInputRate();
	if (r !== wsInputRate) { wsInputRate = r; if (wsHudRepaint) wsHudRepaint((v) => v + 1); }
}, 2000);

// --- The EMITTER: a placeable hopper that dumps the Redsand. 48x48 sprite =
// 12x12 cells (3x3 blocks). Mouth is the open notch at bottom-center (cols 5-6),
// so grains are spawned just below the footprint there. Later this will live at a
// fixed spot alongside unbreakable shaping blocks; for now you build it anywhere.
const EMITTER_ID = "brandonWorkshopEmitter";
const EMITTER_SPRITE = "brandonWorkshopEmitterSprite";
const emitterCells = new Map();               // "x,y" -> {x,y} origin of each placed emitter
let wsEmitIdx = 0;                             // round-robin cursor so N emitters share the rate
let wsSpawnCyc = 0;                            // cycles spawn depth when the empty-probe is unavailable
const ekey = (x, y) => x + "," + y;
function addEmitter(x, y) { if (typeof x === "number") emitterCells.set(ekey(x, y), { x: x, y: y }); }
function delEmitter(x, y) { emitterCells.delete(ekey(x, y)); }
safe(() => api.events.on("building:placed", (p) => { const s = p && p.structure; if (s && s.type === EMITTER_ID) addEmitter(s.x, s.y); }));
safe(() => api.events.on("building:removed", (p) => { if (p && p.structureId === EMITTER_ID) delEmitter(p.x, p.y); }));
safe(() => api.events.on("structures:removed", (p) => { const r = (p && (p.structures || p.removed)) || []; for (const e of r) { if (e && e.type === EMITTER_ID) delEmitter(e.x, e.y); } }));
safe(() => api.events.on("game:ready", () => { emitterCells.clear(); safe(() => api.structures.forEachOfType(EMITTER_ID, (s) => addEmitter(s.x, s.y))); }));

(async () => {
	try { await api.sprites.loadFromMod(EMITTER_SPRITE, "emitter.png"); }
	catch (e) { console.error("[" + MOD_ID + "] emitter.png failed to load:", e); }
	try {
		api.structures.register({
			id: EMITTER_ID,
			name: "Emitter",
			description: "Dumps Redsand into the Workshop from its nozzle, at the rate you fed the basket in the overworld. Place one (or several — they split the rate) above your processing line.",
			categoryKey: "production",
			buildModes: [{ type: "single" }],
			variants: [{ id: EMITTER_ID, angles: [0] }],
			render: { imageName: EMITTER_SPRITE, size: { width: 48, height: 48 }, offset: { x: 0, y: 0 }, ui: { outline: true } },
			shape: [
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[0,0,0,0,1,1,1,1,0,0,0,0],
				[0,0,0,0,1,0,0,1,0,0,0,0],
			],
			defaultData: {},
		});
		console.log("[" + MOD_ID + "] Emitter structure registered");
	} catch (e) { console.error("[" + MOD_ID + "] Emitter register failed:", e); }
})();

// Keep the Emitter in the build menu (idempotent; survives progression re-apply).
setInterval(() => {
	const store = safe(() => sandkit.state.store);
	if (store && store.player && Array.isArray(store.player.buildings) && store.player.buildings.indexOf(EMITTER_ID) === -1) {
		store.player.buildings.push(EMITTER_ID);
	}
}, 3000);

// --- The DRAIN: a placeable open-top basin that collects Oil (mirror of the
// Emitter). Oil that pools in its interior is absorbed and metered; the factory
// emits that much Oil in the overworld. Later this becomes a fixed fixture.
const DRAIN_ID = "brandonWorkshopDrain";
const DRAIN_SPRITE = "brandonWorkshopDrainSprite";
const drainCells = new Map();
function addDrain(x, y) { if (typeof x === "number") drainCells.set(ekey(x, y), { x: x, y: y }); }
function delDrain(x, y) { drainCells.delete(ekey(x, y)); }
safe(() => api.events.on("building:placed", (p) => { const s = p && p.structure; if (s && s.type === DRAIN_ID) addDrain(s.x, s.y); }));
safe(() => api.events.on("building:removed", (p) => { if (p && p.structureId === DRAIN_ID) delDrain(p.x, p.y); }));
safe(() => api.events.on("structures:removed", (p) => { const r = (p && (p.structures || p.removed)) || []; for (const e of r) { if (e && e.type === DRAIN_ID) delDrain(e.x, e.y); } }));
safe(() => api.events.on("game:ready", () => { drainCells.clear(); safe(() => api.structures.forEachOfType(DRAIN_ID, (s) => addDrain(s.x, s.y))); }));

(async () => {
	try { await api.sprites.loadFromMod(DRAIN_SPRITE, "drain.png"); }
	catch (e) { console.error("[" + MOD_ID + "] drain.png failed to load:", e); }
	try {
		api.structures.register({
			id: DRAIN_ID,
			name: "Drain",
			description: "Collects Oil that pools in its basin and sends it out — the factory emits that much Oil per minute in the overworld. Route your processed Oil into it.",
			categoryKey: "production",
			buildModes: [{ type: "single" }],
			variants: [{ id: DRAIN_ID, angles: [0] }],
			render: { imageName: DRAIN_SPRITE, size: { width: 48, height: 48 }, offset: { x: 0, y: 0 }, ui: { outline: true } },
			shape: [
				[0,0,0,0,0,0,0,0,0,0,0,0],
				[1,1,0,0,0,0,0,0,0,0,1,1],
				[1,1,0,0,0,0,0,0,0,0,1,1],
				[1,1,0,0,0,0,0,0,0,0,1,1],
				[1,1,0,0,0,0,0,0,0,0,1,1],
				[1,1,0,0,0,0,0,0,0,0,1,1],
				[1,1,0,0,0,0,0,0,0,0,1,1],
				[1,1,0,0,0,0,0,0,0,0,1,1],
				[1,1,0,0,0,0,0,0,0,0,1,1],
				[1,1,0,0,0,0,0,0,0,0,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
				[1,1,1,1,1,1,1,1,1,1,1,1],
			],
			defaultData: {},
		});
		console.log("[" + MOD_ID + "] Drain structure registered");
	} catch (e) { console.error("[" + MOD_ID + "] Drain register failed:", e); }
})();

// Keep the Drain in the build menu (idempotent).
setInterval(() => {
	const store = safe(() => sandkit.state.store);
	if (store && store.player && Array.isArray(store.player.buildings) && store.player.buildings.indexOf(DRAIN_ID) === -1) {
		store.player.buildings.push(DRAIN_ID);
	}
}, 3000);

// The release: inside the workshop, each placed Emitter dumps Redsand from its
// nozzle. The metered input rate is shared round-robin across all emitters, so
// the total released always equals what you fed the basket. Backpressure-capped.
setInterval(() => {
	if (!isEnabled() || !bootIsWorkshop()) return;
	const Game = typeof Scene.Game === "number" ? Scene.Game : 4;
	if (safe(() => api.scene.getActive()) !== Game) return;
	const st = resolveSandium();
	if (typeof st !== "number") return;
	// Enumerate placed emitters FRESH each tick straight from the game, rather than
	// trusting placement events to have fired in the workshop. Keep emitterCells in
	// sync so the HUD count matches.
	const emitters = [];
	safe(() => api.structures.forEachOfType(EMITTER_ID, (s) => { if (typeof s.x === "number") emitters.push({ x: s.x, y: s.y }); }));
	emitterCells.clear();
	for (const e of emitters) emitterCells.set(ekey(e.x, e.y), e);
	if (emitters.length === 0) { wsAccum = 0; return; } // no emitter placed -> nothing to dump
	const now = Date.now();
	const dt = wsLastSpawn ? Math.min(now - wsLastSpawn, 1000) : WS_TICK_MS;
	wsLastSpawn = now;
	wsAccum += (wsInputRate * dt) / 60000;    // grains owed this tick (total, all emitters)
	if (wsAccum > 6) wsAccum = 6;             // backpressure cap
	// isCellEmptyAtCell returns undefined in the workshop, so match on the TYPE of a
	// known-empty cell instead (getResolvedTypeAtCell is the probe that works). Sample
	// open air high in the room as the "empty" reference.
	const EMPTY = safe(() => api.elements.getResolvedTypeAtCell(192, 24));
	const emptyKnown = (EMPTY !== undefined);
	let guard = 0;
	while (wsAccum >= 1 && guard < 16) {
		guard++;
		let placed = false;
		// try emitters in rotation until one can drop a grain
		for (let n = 0; n < emitters.length && !placed; n++) {
			const em = emitters[wsEmitIdx % emitters.length]; wsEmitIdx++;
			// The structure occupies its whole bounding box for the empty-cell check,
			// so we scan straight DOWN from the nozzle (cols 5-6 of the 12-wide sprite)
			// to the first genuinely empty cell below the emitter and drop there.
			for (const ox of [em.x + 5, em.x + 6]) {
				if (emptyKnown) {
					// scan DOWN from the nozzle for the first empty cell (so it drops),
					// else UP if the emitter is boxed in below.
					let sy = null;
					for (let oy = em.y + 11; oy <= em.y + 80 && sy === null; oy++)
						if (safe(() => api.elements.getResolvedTypeAtCell(ox, oy)) === EMPTY) sy = oy;
					if (sy === null)
						for (let oy = em.y + 9; oy >= em.y - 24 && sy === null; oy--)
							if (safe(() => api.elements.getResolvedTypeAtCell(ox, oy)) === EMPTY) sy = oy;
					if (sy !== null) { safe(() => api.elements.createAtCellWhenIdle(ox, sy, st)); placed = true; wsReleased++; break; }
				} else {
					// last resort: fire ungated at a cycling depth below the nozzle;
					// createAtCellWhenIdle self-gates on empty, so blocked cells no-op.
					const off = 12 + (wsSpawnCyc % 24); wsSpawnCyc++;
					safe(() => api.elements.createAtCellWhenIdle(ox, em.y + off, st));
					placed = true; wsReleased++; break;
				}
			}
		}
		if (!placed) break;                   // every emitter's mouth is blocked -> hold accum
		wsAccum -= 1;
	}
}, WS_TICK_MS);

// In-workshop readout: the release rate, or a nudge to place an Emitter first.
function WorkshopInletHUD() {
	const [, b] = React.useState(0); wsHudRepaint = b;
	if (!isEnabled() || !bootIsWorkshop()) return null;
	const rate = Math.round(wsInputRate);
	const n = emitterCells.size;
	const active = n > 0 && rate > 0;
	const oilTxt = safe(() => (drainCells.size === 0
		? "  ·  place a Drain to collect Oil"
		: (currentOilRate > 0 ? "  ·  Oil out " + Math.round(currentOilRate) + "/min" : "  ·  route Oil into the Drain")), "");
	const text = (n === 0
		? "Workshop  ·  place an Emitter to dump Redsand"
		: "Workshop  ·  Redsand in " + rate + "/min" + (n > 1 ? "  ·  " + n + " emitters" : "")) + oilTxt;
	return h("div", {
		style: {
			position: "fixed", left: "50%", top: "14px", transform: "translateX(-50%)", zIndex: 99998,
			display: "flex", alignItems: "center", gap: "9px",
			padding: "6px 14px", background: "rgba(10,14,20,0.9)", border: "1px solid rgba(255,255,255,0.14)",
			borderRadius: "8px", font: '600 13px -apple-system, "Segoe UI", Roboto, sans-serif',
			color: "#eef1f5", pointerEvents: "none", boxShadow: "0 2px 10px rgba(0,0,0,0.4)", whiteSpace: "nowrap",
		},
	},
		h("span", { style: { width: "11px", height: "11px", borderRadius: "50%", flexShrink: 0,
			background: active ? "#e0603c" : "#6b7280", boxShadow: active ? "0 0 8px #e0603c" : "none" } }),
		text
	);
}
safe(() => api.ui.inject("brandon-workshop-inlet", WorkshopInletHUD));

// Keep the inlet HUD ticking (rate can change as the snapshot updates).
setInterval(() => { if (wsHudRepaint && bootIsWorkshop()) wsHudRepaint((v) => v + 1); }, 1000);

// ===========================================================================
// M4 - BEDROCK FOUNDATION: an unbreakable clone of the vanilla Foundation for
// framing the factory. Explicit 4x4 shapes (from the vanilla foundation shape
// data) + our own recolored sprites (block + the four triangle corners), so it
// actually renders and collides. Line/diagonal/rectangle build modes like
// foundation, buildable in the WORKSHOP only, protected from demolish + move.
// ===========================================================================
const BF_MAIN = "brandonBedrockFoundation";
// id -> { sprite file, sprite name, 4x4 solid-cell shape, angles the master maps to it }
const BF_MAP = {
	"brandonBedrockFoundation":            { file: "bedrock_block.png",         spr: "brandonBedrockBlock",       shape: [[1,1,1,1],[1,1,1,1],[1,1,1,1],[1,1,1,1]], angles: [-180, -90, 0, 90, 180] },
	"brandonBedrockFoundationAngledLeft":  { file: "bedrock_tri_left.png",      spr: "brandonBedrockTriLeft",     shape: [[0,0,0,1],[0,0,1,1],[0,1,1,1],[1,1,1,1]], angles: [135] },
	"brandonBedrockFoundationAngledRight": { file: "bedrock_tri_right.png",     spr: "brandonBedrockTriRight",    shape: [[1,0,0,0],[1,1,0,0],[1,1,1,0],[1,1,1,1]], angles: [45] },
	"brandonBedrockFoundationTriLeftDel":  { file: "bedrock_tri_left_del.png",  spr: "brandonBedrockTriLeftDel",  shape: [[1,1,1,1],[0,1,1,1],[0,0,1,1],[0,0,0,1]], angles: [-135] },
	"brandonBedrockFoundationTriRightDel": { file: "bedrock_tri_right_del.png", spr: "brandonBedrockTriRightDel", shape: [[1,1,1,1],[1,1,1,0],[1,1,0,0],[1,0,0,0]], angles: [-45] },
};
const BF_IDS = Object.keys(BF_MAP);
const BF_SET = new Set(BF_IDS);
let bfRegistered = false, bfErr = "";

(async function registerBedrock() {
	const gm = safe(() => api.rendering.getGridMetrics()) || {};
	const cell = gm.cellSize || 4;
	const variantMap = BF_IDS.map((id) => ({ id: id, angles: BF_MAP[id].angles }));
	try {
		for (const id of BF_IDS) {
			const info = BF_MAP[id];
			try { await api.sprites.loadFromMod(info.spr, info.file); } catch (e) { bfErr = "sprite " + info.file; console.error("[" + MOD_ID + "] bedrock sprite failed:", info.file, e); }
			const def = {
				id: id,
				name: id === BF_MAIN ? "Bedrock Foundation" : "Bedrock Foundation Corner",
				description: "An unbreakable foundation for framing the factory. Builds like normal foundation (lines, diagonals, rectangles); cannot be removed or moved.",
				categoryKey: "blocks",
				render: { imageName: info.spr, size: { width: 4 * cell, height: 4 * cell }, offset: { x: 0, y: 0 } },
				shape: info.shape,
				defaultData: {},
			};
			if (id === BF_MAIN) {
				def.buildModes = [{ type: "line", directions: ["horizontal", "vertical", "diagonal"] }, { type: "rectangle" }];
				def.variants = variantMap;
			} else {
				def.variants = [{ id: id, angles: [-180, -90, 0, 90, 180, -135, -45, 45, 135] }];
			}
			api.structures.register(def);
		}
		bfRegistered = true;
		console.log("[" + MOD_ID + "] Bedrock Foundation registered (" + BF_IDS.length + " variants)");
	} catch (e) { bfErr = String(e && e.message || e); console.error("[" + MOD_ID + "] Bedrock register failed:", e); }
})();

// Buildable in the WORKSHOP only. Only the master appears in the menu; the corner
// variants are auto-selected by drag angle, so they must NOT be listed.
setInterval(() => {
	const store = safe(() => sandkit.state.store);
	if (!store || !store.player || !Array.isArray(store.player.buildings)) return;
	const i = store.player.buildings.indexOf(BF_MAIN);
	if (bootIsWorkshop()) { if (i === -1) store.player.buildings.push(BF_MAIN); }
	else if (i !== -1) store.player.buildings.splice(i, 1);
}, 3000);

// UNBREAKABLE + UNMOVABLE: veto removal of my blocks in the prepare hook by
// filtering them out of the removal batch before it commits (covers demolish and
// the move tool, which removes-then-replaces).
safe(() => {
	if (!api.hooks || !api.hooks.modify) return;
	api.hooks.modify("structures:removed:prepare", (payload) => {
		if (!payload) return payload;
		const filt = (a) => Array.isArray(a) ? a.filter((e) => !(e && BF_SET.has(e.type))) : a;
		if (payload.removed) payload.removed = filt(payload.removed);
		if (payload.structures) payload.structures = filt(payload.structures);
		return payload;
	});
});

// Tiny status line (workshop only) so registration problems are visible.
let bedrockStatusRepaint = null;
function BedrockStatus() {
	const [, b] = React.useState(0); bedrockStatusRepaint = b;
	if (!isEnabled() || !bootIsWorkshop() || (bfRegistered && !bfErr)) return null;
	return h("div", {
		style: {
			position: "fixed", left: "8px", bottom: "8px", zIndex: 99999, font: "11px monospace",
			color: bfErr ? "#ff9d8a" : "#9fe7c8", background: "#05080d", padding: "5px 8px",
			border: "1px solid #3d6b52", borderRadius: "4px", pointerEvents: "none",
		},
	}, "bedrock: reg=" + (bfRegistered ? "Y" : "N") + (bfErr ? " err:" + bfErr.slice(0, 40) : ""));
}
safe(() => api.ui.inject("brandon-bedrock-status", BedrockStatus));
setInterval(() => { if (bedrockStatusRepaint) bedrockStatusRepaint((v) => v + 1); }, 1500);

// ===========================================================================
// M5 - OUTPUT side (basic flow, no deficit yet). Inside the workshop a fixed
// DRAIN zone on the centre floor absorbs Oil that reaches it and meters oil/min.
// That rate is persisted to localStorage; back in the overworld the factory
// emits Oil at the same per-minute rate out its right side.
//   Room 384x320, floor y>=280. Drain = cols 160..223, rows 274..279 (centre floor).
// ===========================================================================
const OUTPUT_KEY = "brandon.workshop.output";
const OIL_TICK_MS = 200;
let oilType = null;
function resolveOil() {
	if (typeof oilType !== "number") oilType = safe(() => api.elements.getTypeFromId("oil"));
	return oilType;
}
safe(() => api.events.on("game:ready", () => { oilType = null; resolveOil(); }));

// --- workshop: drain metering (per placed Drain) --------------------------
let oilTotal = 0, currentOilRate = 0;
const oilRateHist = [];
const oilRecentlyRemoved = new Map();
setInterval(() => {
	if (!isEnabled() || !bootIsWorkshop()) return;
	const ot = resolveOil(); if (typeof ot !== "number") return;
	// enumerate placed drains fresh (like the emitter) so tracking never depends
	// on placement events reaching us inside the workshop.
	const drains = [];
	safe(() => api.structures.forEachOfType(DRAIN_ID, (s) => { if (typeof s.x === "number") drains.push({ x: s.x, y: s.y }); }));
	drainCells.clear();
	for (const d of drains) drainCells.set(ekey(d.x, d.y), d);
	if (drains.length === 0) return;
	const now = Date.now();
	for (const d of drains) {
		// the basin's open interior: cols +2..+9, rows 0..9 (oil pools here).
		for (let x = d.x + 2; x <= d.x + 9; x++) {
			for (let y = d.y; y <= d.y + 9; y++) {
				const key = x + "," + y;
				if ((oilRecentlyRemoved.get(key) || 0) > now) continue;
				if (safe(() => api.elements.getResolvedTypeAtCell(x, y)) === ot) {
					safe(() => api.elements.removeAtCellWhenIdle(x, y));
					oilRecentlyRemoved.set(key, now + 600);
					oilTotal++;
				}
			}
		}
	}
	if (oilRecentlyRemoved.size > 256) { for (const [k, exp] of oilRecentlyRemoved) if (exp < now) oilRecentlyRemoved.delete(k); }
}, 150);

// workshop: rolling per-minute oil rate + persist to localStorage for the overworld.
setInterval(() => {
	if (!isEnabled() || !bootIsWorkshop()) return;
	const now = Date.now();
	oilRateHist.push({ t: now, total: oilTotal });
	while (oilRateHist.length > 1 && oilRateHist[0].t < now - RATE_WINDOW_MS - 2000) oilRateHist.shift();
	let old = 0; for (const e of oilRateHist) { if (e.t <= now - RATE_WINDOW_MS) old = e.total; }
	currentOilRate = oilTotal - old;
	safe(() => window.localStorage.setItem(OUTPUT_KEY, JSON.stringify({ oilRate: currentOilRate, ts: now })));
}, 1000);

// --- overworld: read the workshop oil rate and emit Oil from the factory ----
let oilOutRate = 0, oilOutAccum = 0, oilOutLast = 0;
function readOutputRate() {
	const raw = safe(() => window.localStorage.getItem(OUTPUT_KEY));
	if (!raw) return 0;
	const o = safe(() => JSON.parse(raw));
	return (o && typeof o.oilRate === "number") ? o.oilRate : 0;
}
setInterval(() => {
	if (!isEnabled() || !isBaseGame() || doorCells.size === 0) { oilOutAccum = 0; return; }
	const ot = resolveOil(); if (typeof ot !== "number") return;
	oilOutRate = readOutputRate();
	if (oilOutRate <= 0) { oilOutAccum = 0; return; }
	const now = Date.now();
	const dt = oilOutLast ? Math.min(now - oilOutLast, 1000) : OIL_TICK_MS;
	oilOutLast = now;
	oilOutAccum += (oilOutRate * dt) / 60000;
	if (oilOutAccum > 6) oilOutAccum = 6;
	const doors = Array.from(doorCells.values());
	let guard = 0;
	while (oilOutAccum >= 1 && guard < 16) {
		guard++;
		let placed = false;
		for (const d of doors) {
			// air reference above the factory, then spout just to the RIGHT of the
			// 48x24 footprint so Oil pours out into the world (not onto the factory).
			const EMPTY = safe(() => api.elements.getResolvedTypeAtCell(d.x + 24, d.y - 8));
			for (const ox of [d.x + 48, d.x + 49, d.x + 50]) {
				for (let oy = d.y + 6; oy <= d.y + 34 && !placed; oy++) {
					const t = safe(() => api.elements.getResolvedTypeAtCell(ox, oy));
					if (EMPTY !== undefined && t === EMPTY) {
						safe(() => api.elements.createAtCellWhenIdle(ox, oy, ot));
						placed = true;
					}
				}
				if (placed) break;
			}
			if (placed) break;
		}
		if (!placed) break;
		oilOutAccum -= 1;
	}
}, OIL_TICK_MS);

console.log("[" + MOD_ID + "] loaded - Enter Workshop button on the main menu (or Shift+W)");
