# Sandustry mods — handoff

Everything a new chat needs to pick this work up. Last updated 2026-09-27.

## Start here

The repo is on GitHub: **https://github.com/rockon4211/rockons-sandustry-mods**
(public, owned by Brandon's account `rockon4211`). It is the source of truth — every mod,
the Material Studio tooling, the graph page, the Loamcrest saves, both branches and the tag.

```bash
git clone https://github.com/rockon4211/rockons-sandustry-mods.git
cd rockons-sandustry-mods
cat .handoff/handoff.md      # this file
git log --oneline | head
```

Then read the rest of this file, which covers what the mods do, what the game's modding
API allows, how to test without the game, and what is still open.

**For Claude:** `CLAUDE.md` at the repo root is loaded automatically by Claude Code and holds
the rules, the verification checklist, the mistakes already made once, and the recipe for
menus that match the game's. `.handoff/lessons.md` is the human-readable version of those
lessons. `tools/rebuild-manufacturing-stubs.js` rebuilds Manufacturing's baked copies.

**Pushing.** The live branch is `main`. On the desktop PC the clone is
`C:\Users\Brand\dev\rockons-sandustry-mods` and git is authenticated through Git Credential
Manager, so from there pushing is just `git push` (and `git push --tags` if a tag was
added). A cloud session that is refused by its proxy ("not in this session's authorized
repository set") should not fight it: hand Brandon the commits (or a patch) to push from
the desktop, or ask him to start a task with the repo attached.

**If GitHub is not reachable**, `.handoff/chunks/` holds the code history as a git bundle
in ten base64 parts; `repo-history-README.md` has the rebuild commands. It has no binaries
and its commit hashes differ from GitHub (see that README). The chunks are from `main`
`1ca265d` (2026-09-23) — about 50 commits behind the `audit-fixes` branch; regenerate them
after the push. The mirror `claude/repo-history/` and the laptop notes
`claude/laptop-install.md` live in the claude.ai project, not in this repo.

**Where the work is right now (2026-09-27):** everything since 2026-09-23 is on the local
branch `audit-fixes` in the desktop clone; GitHub `main` has not been pushed to since
`1ca265d`. Brandon pushes — ask first.

## Where things live

Game: Sandustry v0.5.6 (Steam). Player: Brandon.

- Git repo: GitHub `rockon4211/rockons-sandustry-mods`. Branch `main` is the live line;
  `snapshot/loamcrest-2026-09-20` (tag `loamcrest-2026-09-20`) is the frozen map + mods.
- Desktop PC clone: `C:\Users\Brand\dev\rockons-sandustry-mods`. Edit there.
- Game data on the desktop: `%APPDATA%\sandustry\` (`C:\Users\Brand\AppData\Roaming\sandustry\`)
  with `mods\`, `saves\`, `_screensaver\`, `_map_backups\`, `_to_delete\`.
- Steam install: **varies per PC.** On the desktop it is
  `C:\Program Files (x86)\Steam\steamapps\common\Sandustry`; game code is readable at
  `resources\app.asar` → `dist/js/bundle.js`.
- Test harnesses: `.handoff/sim-*.js` (see Testing below). `.handoff/binaries.md` /
  `binaries-b64.txt` / `repo-binaries.md` are stale base64 copies of the PNGs (no regenerate
  script) — prefer the PNGs in git.

## Mods and versions (as of 2026-09-27, branch `audit-fixes`)

- **Sandbox Loop** `brandon.sandboxloop` v0.4.6 — Sources and Removers, balance tracker,
  whole-map census, history log/export, and the panel that hosts the Screensaver button.
- **Screensaver** `brandon.screensaver` v0.18.3 — plays the map when idle and follows one
  grain through the factory. This is where most of the work went. 0.18.2: every tracer
  element (the 5 generic tracers and every clone) is registered with the game's own
  `showInFilterPicker: false`, so no picker lists them - they exist only for the Sandbox
  Loop to emit (Manufacturing's Matter Gun and the Sandbox Loop palette also drop them by
  id, `brandonTrc_*` / `brandonTracer*`, in case the flag is lost). And a whole-map sweep
  (`startMapSweep`, 25k cells per 50ms tick, ~30s) removes every tracer grain wherever it
  is: 4s after each world load, 3s after each run, or via `__brandonScreensaver.sweepMap()`;
  it aborts if a run starts. Reason: the 2026-09-24 save's discoveries held 3 tracer types
  (65, 109, 95) - tracer grains had been left on the map. 0.18.3: the sweep deletes inside
  `api.world.mutate` after re-reading the cell (`removeTracerAt`), so a grain that moved on
  is left alone and only real deletes are counted in the `map-sweep` log event; ~100
  consecutive failed slices abort the sweep instead of looping; `isSweeping()` is exposed
  so the Sandbox Loop's census can yield to it.
- **Manufacturing** `brandon.manufacturing` v0.15.8 — soil/Sand rename + Glass, Mod Tools,
  and **Filter Mk.3** research (0.10.0 was an Upgrades-pane item "Belt-Speed Filtering";
  0.12.0 made it a tech-tree node). Source of truth: `main.real.js` / `worker.real.js` (see below).
- **Lava Boiloff** v0.1.1, **Quickstart** v1.0.2 (F10 quick reload).
- **Improved Filter Options** `brandon.improvedfilters` v0.2.9 (2026-09-27) — a clipboard for
  filter settings, built into the filter menus: a strip mounted in the hotbar band
  (`api.ui.overlays.register("hotbar", …)`) whenever a filter menu is up. It reads the
  game's row editor through `sandkit.engine.api.filterGroupEditor` (`getSelection(state)`
  → `{structureType, memberCount, draft}`, `setDraft(state, f)`, `apply(state)`; the engine
  exposes it via `FH.extend`) and the Mk.3 panel through `window.__brandonFilterMk3`
  (`selection()`, `draft()`, `setDraft(f)`, `apply()`, `refresh()`, added in Manufacturing
  0.15.1). COPY takes what the open menu shows (row draft, else
  `store.options.defaultFilter`); PASTE writes it back the same way (a row via the editor's
  setDraft + apply). PICK / ONTO arm a click on a placed filter for rows not open in a menu — handled on
  POINTERDOWN (0.2.1: a preventDefault on pointerdown suppresses the browser's follow-up
  mousedown/click, so the old mousedown handler never fired), with the clicked cell computed
  from the game's own mapping (screen = canvas rect origin + (world px − camera) × view.zoom
  × session.scale; cell = world px / 4). 0.2.2: arming a pick records the building in hand
  and calls `engine.api.building.cancelPlacement` (the ghost sat over the cursor); disarming
  hands it back via `engine.api.building.selectStructure(state, id)`. 0.2.3: cancelPlacement
  alone left the Mk.3 in hand — "in hand" is activeStructureType, then player.action, then
  the active hotbar slot (bundle: `B=e=>activeStructureType?…:player.action?…:I(e)`), so
  stash() clears all three + `placing` and restores them (selectStructure for a structure,
  else player.action, plus the slot). While armed, `PickOverlay` (injected) draws a
  game-style box + label on every filter row of every kind (the game's own overlay only
  draws while one of ITS filters is in hand); clicking a label picks that row. 0.2.4 / Manufacturing 0.15.4: "a Mk.3 is in hand" is now
  asked of the game — `engine.api.action.getActive(state)` (what the game uses to decide what
  is held / whether to draw a ghost: activeStructureType, else player.action, else the hotbar
  slot) — so the Mk.3 panel and the strip close exactly when the game puts the filter away
  (they lingered before, reading player.action / activeStructureType themselves). The game's
  own filter panel is gated only on `bk(activeStructureType)`; `session.windows.building.
  filterConfig` is cleared in places but never set true — not a mechanism to rely on. 0.2.5: Mk.1 filters (StructureType 17/18) and the Mk.1 wall
  are out entirely — no strip for them, not pickable, no labels; the clipboard holds between
  Mk.2 (+ wall Mk.2) and Mk.3 only, as asked. 0.2.6: the strip is one narrow line (max 460px, material list
  ellipsised, short button labels Copy/Paste/Pick/Onto/✕) — the hotbar band lays it out next
  to the 640px filter panel, and an unbounded wrapping strip spread the pair across the
  screen over the game's shortcut help (seen in a 2026-09-25 screenshot). Confirmed in game
  that day: Pick / Onto, paste, the Mk.3 panel and labels overlay all work; only real filter kinds count (Mk.1 = StructureType 17/18, Mk.2,
  Mk.3, walls) — shakers, growers and critter fences carry a `filter` too but are excluded.
  Clipboard persisted by element id (`brandon.improvedfilters.clip`). 0.2.7: a paste onto a
  placed row writes only `{mode, elementType}` (what the game's own row editor writes), the
  liquid/gas flags are stored and written only when true — never materialised as `false` —
  and arming Pick while the game's editor has a row open no longer touches what is in hand
  (its `afterRender` drops the selection whenever the active structure isn't one of its
  filters). In-game status: 0.2.6 confirmed 2026-09-25 (Pick / Onto, paste, the Mk.3 panel
  and labels); 0.2.7's changes are covered by `sim-clipboard.js` and not yet seen in game.
- **Workshop** — retired on 2026-09-20. Code in `.handoff/workshop/` and git history; the
  early root `workshop/` copy was removed on 2026-09-23. On the PC it was moved to
  `sandustry\_to_delete\retired-2026-09-20\workshop`.

## Manufacturing — how it is built now

`mods/manufacturing/main.real.js` and `worker.real.js` are hand-maintained and are the
source of truth. `main.js` / `worker.js` are hot-load stubs: they load the `.real` file
from the mod's own folder at start-up (so an F10 reload picks up a new `.real`) and fall
back to a **verbatim baked copy** of it embedded in the stub. Every edit goes into the
`.real` file only; then `node tools/rebuild-manufacturing-stubs.js` regenerates both stubs
(`git status --short mods/manufacturing` clean afterwards = baked copy == real). Never edit
`main.js` / `worker.js` by hand.

The Material Studio compiler (`compiler.js`) is **retired**: recompiling from `graph.json`
would drop the hand-written code (HeavyStone, the Filter Mk.3 research node, red-block fixes,
probes) and reorder element registration, which changes element ids and breaks saves. It
now refuses to write into `mods/manufacturing` without `--force`.

**Filter Mk.3 (0.14.0).** Its own buildings, `filterRightMk3` / `filterLeftMk3`, unlocked by the
`brandonFilterMk3` research under Manufacturing (needs Manufacturing + vanilla Advanced
Filters; `FILTER_MK3_COST` = 25,000 gold). It reuses the game's own code: the sim marks a tile
as a filter for ANY structure carrying a `filter` object (so sorting = the Mk.2's), and
`api.structureBehaviors.registerConveyorType(id, {velocity})` makes it a belt that runs the
same move routine. Mod belt types aren't in the game's passes, so a manager-worker trigger
(`sandkit.engine.api.workers.triggers.register`, id `brandonFilterMk3Belts`, the callback is
sent as TEXT) posts `RunConveyorBelts` for it every 166 ms right-then-left — the Mk.2 belt
cadence; Clearing Frames are driven the same way. Conveyor type + trigger only reach worker
threads that exist, so both are re-sent on `game:ready`. A new Mk.3 copies
`store.options.defaultFilter` (the Mk.2 panel's current pick) in `building:placed` — the
game's filter panel only opens for its own ids; copy-paste keeps a Mk.3's filter. Vertical
placement makes a vanilla `filterWallMk2`. Sprites: the Mk.2 strip with blue → red
(`filter_*_mk3.png`, 4 frames of 18×18), animated through `render.spritesheet.frameBuffer`:
the renderer reads a frame index from a mod shared buffer (`mk3anim`, uint8[2]), which
0.15.0 fills every `frame:render` from the game's own `shared.mods.conveyorMk2AnimationIndex`
([0] left, [1] right) — so Mk.3s animate in lockstep with Mk.2 belts. Menu (0.15.0): the
game's filter panel is gated on a fixed id list (`pk`/`hk`/`Uk` in the bundle, not
exported), so `FilterMk3Panel` in main.real.js is a clone of it (same Tailwind classes),
mounted with `api.ui.overlays.register("hotbar", …, () => hM(Panel))` (render() must
RETURN an element). It edits `store.options.defaultFilter` like the Mk.2 panel; clicking a
row's label selects the contiguous same-setting row (the game's row rule) and Apply writes
it via `engine.api.structures.updateMany(state, members, {propagateToWorkers:true})`.
(Until 0.15.8 clicking the placed Mk.3 itself also opened it, through
`api.signals.interactables.register` - removed: the game's Mk.2 has no such click, and a row
opened with an empty hand never closed.)
The panel has the Mk.2's "labels overlay" switch (same setting, `store.options.showFilterOverlay`)
and, since 0.15.3, its own overlay: the game draws labels only for its own filter ids, so
`FilterMk3Overlay` (injected, fixed full-screen, pointer-events none) draws a box + label per
Mk.3 row while a Mk.3 is in hand / edited and the switch is on, positioned per frame with the
game's mapping above; clicking a label opens the row. Saves that researched the node before
0.14.0 get the building unlocked on load. 0.14.0 confirmed in game: the building shows up.
0.15.6: the Mk.2 is treated as the same filter at the slower speed — with a Mk.3 in hand the
overlay also draws Mk.2 rows (not while a game filter is in hand: the game draws those), a Mk.2
label opens that row in the Mk.3 panel, and its Apply goes through the game's editor (selectAt →
setDraft → apply, so the game's own labels redraw); with a Mk.2 in hand the overlay draws the
Mk.3 rows beside the game's labels. Labels and the editing tag name the kind (Mk.2 / Mk.3).
0.15.7 (with Improved Filters 0.2.9): a row opened from a label while a Mk.2 / Mk.3 was held
stayed open after the filter was put away (right-click / tool switch), which kept the Mk.3
panel, its labels and the clipboard strip up. Now, like the game's editor, the row is dropped
when the family filter leaves the hand - except while the clipboard is picking (it puts the
building down on purpose; it says so through `window.__brandonFilterClipboard.picking()`).
0.15.8: the Mk.3 follows the game's Mk.2 rules exactly (see Game internals → filter row
editor): no click on the placed belt, the panel opens expanded on pick-up, the row is dropped
every frame the hand isn't a Mk.2 / Mk.3, and placing is blocked while a row is open.

0.15.x in game: the panel and the labels overlay were confirmed on 2026-09-25 (with Improved
Filters 0.2.6); the belt animation and the Mk.3's actual belt speed are still unconfirmed.
0.15.5 (2026-09-27): a Mk.3 picked up with the Copier shows its copied filter in the panel
(`mk3Cfg` mirrors `customData.copiedStructure.filter` into `defaultFilter` the way the game
does for its own ids), the overlay re-renders only when the rows change, and the in-hand
gate is asked of `engine.api.action.getActive`. `sim-mk3.js` covers placement, the row
editor, the belt trigger and the animation buffer. History: 0.10.0–0.12.2 sped up every
Mk.2 Filter instead; rejected, removed in 0.13.0.

## Sandbox Loop v0.4.6 — what it does

A **Source** is a structure that emits a chosen material at an adjustable rate (decimals
allowed, up to 100/s); a **Remover** is a single block that deletes one chosen material at
an adjustable rate. Settings are baked into each structure when it is placed, stored by
element id so they travel with the save. The **Balance** panel counts every material on the
whole map (time-sliced scan, NORMAL ≈30s a pass or GENTLE ≈2min, exact counts only), shows
surplus/deficit per material, keeps running totals, logs a 30-second history that can be
exported as JSON (samples carry `t` wall-clock ms and `st` game-time ms), can lock Thermal
Buffers at their peak temperature, and freezes every counter while the game is paused. It
hides the Screensaver's tracer copies from its lists.

**Per world.** Running totals, the census baseline and the history log describe one map,
so they are stored per world (`<key>@<store.meta.worldId>`) and swapped when another world
is loaded; anything persisted by element number carries a `{number: id}` map and is mapped
back on load.

**✎ Placed.** A collapsible "Placed (n)" list on the panel shows every Source and Remover
on the map with what it does; ✎ opens a row editor (change material / rate, "use panel" to
bake the panel's current setting into a structure already on the map, or remove it), so a
structure never has to be re-placed. Rows whose material can't be resolved on this PC are
flagged "not set".

**Height cap.** The panel is never taller than the window: `maxHeight: calc(100vh - top)`
with the title bar fixed (drag / minimize) and the rest scrolling inside.

**0.4.6.** A grain is created inside `api.world.mutate` and *re-read* there before it is
counted (`createAt` silently does nothing when the element pool is full; the callback runs
on the main thread with the sim parked, so the re-read is reliable) — the tracer is reported
to the Screensaver only once it exists. `game:ready` also fires when the SAME world is
reloaded (F10), so the structure cache and pacing state are dropped there too (✎ edits hit
dead objects otherwise). `Scene.Deploy` (3, the landing cinematic) counts as "not in a
world". The census yields while the Screensaver's map sweep runs
(`__brandonScreensaver.isSweeping()`).

It exposes a hook other mods use:

```js
window.__brandonSandboxLoop = {
  sources(),                    // [{x, y, type, rate}]
  emitOnce(type, src),          // next grain from THAT Source is emitted as `type`
  emitOnceResult(),             // {x, y, at, src:{x,y}, material} once it has fired
  cancelEmitOnce(),
}
```

The `src` argument (0.3.1) makes the swap happen at the Source the Screensaver chose, not
whichever fired first.

The panel also carries the Screensaver row: **🌙 START NOW** and a **⤓ log (n)** button that
saves the tracer flight recorder. Its companion graph page for history exports is
`tools/resource-history` in the repo.

## Screensaver v0.18.3 — what it does

After N minutes without input (or automatically from the main menu, for a Windows "on idle"
task), it hides the HUD and cursor, goes fullscreen, caps the frame rate, holds a screen wake
lock, and follows a single grain through the factory.

**The tracer.** A Source is asked to emit one grain as a tracer element instead of a normal
grain (no extra material is created). The camera rides that grain. Every material (except
particles, fire and flame) gets a **copy** at launch that carries its whole definition —
matter type, density, flags, other properties — a shade brighter, same weight; functions
and timers are not copied. Generic per-matter-type tracers remain as a fallback.

**Recipes (0.18).** Each copy is taught every rule the real material has, read from the
game's own tables (`sandkit.mods.recipes` plus the hard-wired rules):

- every **contact** rule (`api.reactions.registerContact`), e.g. soil copy + water → wet
  soil copy;
- every **machine** recipe (`api.structures.recipes.register`): smelter, condenser,
  steamDryer, synthesizer, snowmaker, shaker (including the hard-wired wet soil rule),
  **kineticPress** (burnt residue → seed) and **planterBox** growers;
- **burning**: the copy's `flammable` output points at the product's copy, always
  (residue copy → burnt residue copy, dry amethelis copy → florin copy).

**Never gold, main product.** Wherever a step produces gold and something else, the copy
continues as the something else, and the hand-back search never adopts gold. Where a step
makes several things it follows the main one.

**Hand-back fallback.** Only for the few steps the game hard-wires and a copy cannot carry
(e.g. a planter growing a flower, steam turning to cloud): the grain is turned back into its
real material, the spot is watched, and a material the chain says should appear is picked
up. Passive structures (frames, launchers, platforms) never trigger a hand-back.

**Tracker panel** (top-right, on by default): what the tracer is doing now, counts of
journeys, marks, losses, re-finds, jumps, stray tracers, copies and armed reactions, a
"why it was lost" breakdown, and the last nine events in plain language. A **flight
recorder** keeps up to 500 events and saves `tracer-log-<date>.json` to Downloads — on
demand from the panel button, and automatically when the screensaver stops if anything went
wrong.

**Other behaviour worth knowing:** if the grain is lost three times within 16 cells in 90
seconds the spot is abandoned (`hotspot` log event) and a new journey starts; extra tracer
grains near the followed one are turned back into their real material and logged; the
tracer grain is **deleted** when the screensaver ends; only the **E** key ends the
screensaver and a "press E to exit" tip sits in the top-right, with all other keys and
clicks swallowed so they can't disturb the game.

Hook: `window.__brandonScreensaver = { build, isActive(), exportLog(), logSize(), stop(), start(),
sweepMap(), isSweeping() }` (`start()` returns a short reason string, which the Sandbox Loop
button displays; `sweepMap()` starts the whole-map tracer sweep from cell 0 and returns
false when not in a world or a run is active; `isSweeping()` is true while one runs — the
Sandbox Loop's census pauses on it).

## Game internals — verified reference (keep adding to this)

Every fact here was dug out of the game's own code or observed in a save and cost real
time to learn. **When a session learns something new about the engine, it goes here**, in
the matching topic, with how it was verified. Minified names (`pk`, `Vt`, `FH`) change per
game build — search the bundle by string literals, not by those names.

### Reading the game (v0.5.6)
- Install on the desktop: `C:\Program Files (x86)\Steam\steamapps\common\Sandustry` (varies
  per PC; Steam's `libraryfolders.vdf` lists the libraries). Code is in
  `resources/app.asar`: plain asar — the 4-byte pickle at offset 4 holds the header size, the
  JSON header's length is at offset 12 and the header starts at 16, file blobs follow at
  `8 + headerSize + offset`. Inside `dist/js/`: `bundle.js` (main thread, 4.3 MB),
  `simulation-worker.js` (sim), `manager-worker.js` (ticks the passes / triggers),
  `utility-worker.js`, `external-mod-runtime.js` (the main-thread mod API) and
  `external-mod-worker-runtime.js` (the worker mod API). Sprites are in `dist/mods/*.png`.
- Mods run in **strict mode**; each entry is wrapped in an async function and `await`ed by
  the game (top-level `await` works; a throw reaches the game). `sandkit.api` is the mod
  API, `sandkit.engine.api` is the FULL engine API (`FH` — its functions take the state as
  first argument, `sandkit.engine.state`), `sandkit.state` is that state, `sandkit.react` is
  React, `sandkit.enums` holds the enums (StructureType, MatterType, ComponentId, Scene,
  Tech, ElementType.Empty, ActionState).

### Mod runtime
- Shared buffers: `api.shared.buffers.create(key, {type, length})` / `require` in workers;
  keys are namespaced `external:<modId>:<key>`; a buffer created late is still broadcast,
  and workers receive them before worker entries run.
- Events (`api.events.on`): `game:ready` (per world load), `frame:render` (every frame),
  `building:placed` `{structure, x, y, isBatch, isCopied}` — fires BEFORE the structure is
  written to the sim grid, so setting `structure.filter` / `.data` there takes effect —,
  `building:removed` `{structureId, x, y}`, `structures:placed/removed/pasted/moved`.
- `api.i18n.t(key, params)`, `api.i18n.register("en", {...})` — registering one of the
  game's own keys (e.g. `structures|filterMk2|name`) overrides it live.
- Interceptors a mod may use: `building:place`, `building:clearShape`, `input:keydown/
  keyup/escape/scroll`, `element:blocked/duration/update/move`, `cell:process`,
  `shaker:elementOn`, `fire:element:burn/ignite`, `projectile:hit`,
  `interactable:suppressHover`. `element:move` and `cell:process` run per cell per tick on
  a 14.7M-cell map — never use them for per-structure logic.
- A click on a structure: `api.signals.interactables.register(typeId, (structure) => …)`.
  The engine dispatches it from `action:intercept` (any click over that structure type,
  not while demolishing / marquee-selecting / signal-linking) and cancels the action. One
  handler per type — a second registration replaces the first.
- Manager-worker triggers: `sandkit.engine.api.workers.triggers.register(state, id,
  {interval (ms), everyTicks?, sequentialRuns, extra, callback})`. The callback is sent to
  the manager worker AS TEXT (`toString`), so it must be self-contained; it gets `(e, t)`
  with `t.runCount` / `t.extra`; inside, `e.sandkit.getApi()` gives
  `workers.messages.getIdByName("RunConveyorBelts")` and
  `postToEachThreadColumnSequentiallyAwait(e, [msgId, typeId], reverse)`. The manager keeps
  one trigger per id, so re-registering is safe.

### Structures
- `api.structures.register({id, nameKey|name, descriptionKey, categoryKey, order,
  tooltipHover:{type:"filter"}, buildModes:[{type:"line", directions:[...]}|{type:"single"}],
  variants:[{id, angles:[...]}], render:{imageName, size, offset, z, ui, spritesheet},
  defaultData, shape})` — the definition is passed through unchanged (no field whitelist).
  A variant may be a vanilla id (the Mk.3 uses `filterWallMk2` for vertical placement).
- Animated mod structures: `render.spritesheet = {frames, frameSize:{width, height},
  frameBuffer:{key, index}}` (frame = `Atomics.load(buffer, index) % frames`; the buffer must
  exist BEFORE register) or `{frames, frameSize, intervalMs}`; the sheet has
  `imageWidth / frameSize.width` columns. The Mk.2 BELT frame counter is
  `state.shared.mods.conveyorMk2AnimationIndex` (uint8[2]: [0] left, [1] right, stepped by
  the manager every 166 ms); vanilla filters and Mk.1 belts use
  `shared.conveyorBeltsAnimationIndex` (332 ms). A mod cannot name the game's buffer in
  `frameBuffer` (namespacing) — copy it into its own buffer every `frame:render`.
- `api.structures.forEachOfType(id, cb)` walks EVERY structure (~29k here) — cache results.
  `getAtCell(x, y)` answers for any cell of a tile; `updateData(s, patch)`;
  `removeAtCell(x, y)`. Engine: `structures.updateMany(state, list,
  {propagateToWorkers:true})` (what the game's filter row editor uses to write a row) and
  `structures.getConfig(id)`.
- What is "in hand": `sandkit.engine.api.action.getActive(state)` =
  `session.building.activeStructureType`, else `store.player.action`, else the active
  hotbar slot's item. The game's own deselect clears all three plus
  `session.building.placing`; `building.cancelPlacement(state)` resets ONLY the placement;
  `building.selectStructure(state, id)` puts a building in hand (resolves variants).
  Build-menu clicks set activeStructureType for every building; hotbar clicks set it only
  for the game's own filters.
- Conveyors: `api.structureBehaviors.registerConveyorType(id, {velocity:{x, y},
  transportOffset (default {x:0, y:-1} = the row above), maxTransportDistance,
  transportHeight, runWith:"left"|"right", skipQueued})`. With `velocity` set the worker
  skips its hard-coded speed switch — the earlier note "an unknown id gets speed 0" is true
  only for a plain structure. `runWith` puts the type in the 332 ms belts pass; without it
  the worker moves it whenever the manager posts `[RunConveyorBelts, id]`, i.e. from a
  trigger of your own (see above) — this is how Clearing Frames are driven. Passes
  (`transport.passes`): belts 332 ms, beltsMk2 166 ms, shakers 3333 ms, clearingFrames
  1332 ms, each run right-then-left, 1 cell per pass.
- Filters: the sim marks a tile FILTERED for ANY structure carrying a `filter` object
  `{mode:"allow"|"block", elementType: number|number[], affectsLiquid, affectsGas, density?,
  speedExemptElementTypes?}` and sorts by that object, not by the structure id — so a mod
  filter gets the Mk.2's exact rules by carrying the same object. Shakers, growers and
  critter fences carry a `filter` too (for their own use). A new Mk.2 filter copies
  `store.options.defaultFilter` plus `affectsLiquid/Gas: true` at placement; a copy-paste
  keeps `copiedStructure.filter`. The game's filter panel, labels overlay, hotbar handling
  and row editor are gated on fixed id lists (Mk.1 = StructureType 17/18,
  `filterLeft/RightMk2`, the walls) that are not exported — a mod filter needs its own
  panel. Row editor (engine): `filterGroupEditor.getSelection(state)` →
  `{structureType, memberCount, draft, isDirty, anchorX, anchorY}`, `setDraft(state, f)`,
  `apply(state)`, `cancel(state)`, `selectAt(state, x, y, {toggle})`. A row = same type, same filter
  key, touching (walls join vertically). `selectAt` also calls `building.cancelPlacement` +
  `input.resetMouseState` and sets `session.building.filterForceExpand = true` (the game's
  panel opens expanded the next time it mounts, then clears it); `apply` writes via
  `updateMany`, bumps the revision and drops the selection. Driving select→apply from a mod,
  put `filterForceExpand` back afterwards. The game's Mk.2 rules (0.15.8 copies them for the
  Mk.3, per frame on `frame:render`): no click handler on a placed filter - rows open only
  from a label, only with a filter in hand; picking the filter up (hotbar or build menu)
  sets `filterForceExpand`, so the panel opens EXPANDED; the editor's `afterRender` drops
  the row the moment the hand isn't one of its filters and, while a row is open, cancels any
  placement with the toast `ui|filter|finishEditingBeforePlacing`; Esc (an `input:escape`
  interceptor) cancels the row first. Hotbar select sets activeStructureType only for
  the game's own filters and nulls it for anything else.
- Terrain ids by name: `api.terrains.getTypeById("block")` (Block is built-in id 15); mod
  terrains are numbered by registration order — never hard-code them.
- Tech: `api.tech.registerNode(id, {nameKey, descriptionKey, cost, currencyType:"gold",
  branch, requires:[Tech.X or "modNodeId", ...], unlocks:{structures:[id]}}, {parentId,
  preferredPosition:{row, col}})` (several `requires` are fine); `isResearchedById`,
  `isLockedById`; `api.player.buildings.unlockById(id)` for saves that researched before
  the structure existed. Upgrades pane: `api.upgrades.registerCategory({id,
  requirement:{techId}})`, `register({itemId, categoryId, requirement:{building},
  upgrade:{id, maxLevel, costs, oneOff}})`, `getLevelById(itemId, upgradeId)`.

### UI
- `api.ui.inject(id, Component)` mounts globally (position it yourself, `position:fixed`).
  `api.ui.overlays.register("hotbar", id, render)` mounts in the band above the hotbar —
  `render()` is called as a plain function and must RETURN an element (`() =>
  React.createElement(Comp)`); the band lays overlays out side by side, so keep them
  narrow. `api.ui.overlays.update("hotbar")` repaints it, `api.ui.update(ComponentId.X)`
  repaints a game component, `api.ui.toast(text)` shows a toast. The game's Tailwind
  classes are available (arbitrary values like `text-[#ffe700]` only where the game itself
  uses them). The game's filter panel is `overlays.register("hotbar", "filterConfig", …)`
  gated on its id list; `session.windows.building.filterConfig` is cleared in places but
  never set true.
- World → screen: `M = session.rendering.canvas.getBoundingClientRect();
  I = (session.view?.zoom ?? 1) * session.scale; sx = M.left + (worldPx - session.camera.x)
  * I` (same for y); a cell is 4 world px. The game's own overlay labels use exactly this,
  per frame. Mouse cell: `session.input.mouse.cellPosition`.
- Input: the canvas listens for POINTER events (PIXI) and mousedown; keys on window. A
  capture-phase window listener runs first and can swallow them — but `preventDefault()`
  on `pointerdown` also suppresses the browser's follow-up mousedown/click, so handle a
  click on pointerdown itself. Esc: the game's handler runs `input:escape` interceptors
  first.
- Pickers: discovered materials are `store.discoveries.elements`; definitions via
  `api.elements.getRegisteredTypes()` + `getDefinitionByType(t)` (`metaColor`,
  `matterType`, `showInFilterPicker`), names `getNameByType`, ids `getIdByType` /
  `getTypeFromId`. Registering an element with `showInFilterPicker: false` keeps it out of
  the game's pickers. Matter tabs: solid = Solid/Powder/Wisp/Slushy, liquid = Liquid,
  gas = Gas.
- The game's row editor (`filterGroupEditor`) cancels its selection in its `afterRender`
  whenever `session.building.activeStructureType` isn't one of the game's own filter ids —
  so while it has a row open, leave the hand alone (no `cancelPlacement`, no clearing the
  hotbar slot). Seen when "put the tool down, then pick" closed the row being edited.
- The Copier: a picked-up filter travels as `session.action.customData.copiedStructure`
  (its `.filter`), and the game mirrors that filter into `store.options.defaultFilter` only
  for its own filter ids; `copiedStructure` carries no `type` — what is held is what
  `action.getActive` says. A mod filter has to mirror it itself (Manufacturing `mk3Cfg`).
- Scenes (`sandkit.enums.Scene`): MainMenu = 1, Intro = 2, Deploy = 3 (the landing
  cinematic — no world yet), Game = 4. "In a world" is Game only.
- `configSchema` (modinfo.json settings): the `*Key` fields (`labelKey`, `descriptionKey`)
  go through the translator and show the raw key if it isn't registered; plain text belongs
  in `label` / `description`.
- `session.saving` is true while a save is in flight.

### Elements and the world
- Element numbers are assigned at runtime in registration order (mods by `loadOrder`,
  then id) and differ per PC / mod set — persist materials by id string, and never reorder
  Manufacturing's element list (saves store the numbers). Types are 1–255.
- `api.world.isCellEmptyAtCell(x, y)` is false for material, terrain AND a building
  (reading the element type gives null for a building cell — that bug counted grains that
  were never made). `api.world.mutate(w => { w.elements.createAtCell / removeAtCell /
  replaceAtCell })` runs at the sim's next idle moment, on the main thread with the sim
  parked — so a read inside the callback (`api.elements.getResolvedTypeAtCell`) sees the
  writes made just before it and is reliable; that matters because `createAt` silently does
  nothing when the game's element pool is full (the re-read is the only way to know the
  grain exists), and a re-read before a delete is what keeps a grain that moved on from
  being deleted. `api.elements.removeAtCell(x, y)` is deferred too (queued, not immediate)
  and only removes a non-null cell; `removeAtCellWhenIdle` additionally requires the cell's
  id to be unchanged since the call — it still deletes whatever element sits there, not
  necessarily the one you saw. `createAtCellWhenIdle` silently no-ops on a non-empty cell;
  `replaceAtCell` often misses a moving grain. `getResolvedTypeAtCell` in a
  tight loop at ~25k cells per 50 ms tick sweeps the 14.7M-cell map in ~30 s without
  stalling. `api.world.getDimensions()` → `{widthCells, heightCells}`. The world id is
  `store.meta.worldId` (saved with the world).
- Contact recipes: `api.reactions.registerContact({inputA, inputB, outputA, outputB,
  orientation:"any"|"stacked"})`; a `null` output removes the grain; consulted in
  addition to the hard-coded mixing table. Definitions also accept a `mixes` array.
  Machine recipe ids: smelter, condenser, steamDryer, synthesizer, snowmaker, shaker
  (`outputsBelow/Above`), kineticPress, planterBox; the thermofroster is hard-coded.
  `api.elements.updateDefinition` reaches only workers that already exist — re-apply after
  `game:ready`.

### Saves, storage, logs
- A save is one JSON header line (`id, timestamp, playTime, worldId, resources…`) followed
  by gzip JSON `{store, wall:{tiles, palette}, matrix, shadow, authorization}`. Useful in
  `store`: `player.tech` (researched ids → true), `player.buildings` (unlocked ids),
  `player.hotbar`, `upgrades`, `options.defaultFilter` / `showFilterOverlay`, `structures`
  (each with `.type`, `.x/.y`, `.data`, `.filter`), `discoveries.elements`, `meta.worldId`.
  The element grid is packed (`wall.tiles` sections) and was not decoded — change the world
  from inside the game instead.
- Quickstart's F10 loads the last F5 quicksave: everything after it is undone, while
  mods' localStorage is NOT rolled back (so mod settings and the world can disagree).
- The game's localStorage is Chromium LevelDB at `%APPDATA%\sandustry\Local Storage\
  leveldb` (.ldb tables + .log; snappy-compressed blocks; values are utf16le after a
  leading type byte; keys are prefixed `_file://` + two bytes). Read a COPY — a session
  scratch script did on 2026-09-24 (recipe: copy the `leveldb` folder, walk the `.ldb`
  tables and `.log` with a LevelDB reader or a snappy-aware block parser, strip the
  `_file://` + 2-byte key prefix, decode values as utf16le after the leading type byte, and
  look for the `brandon.*` keys). Nothing of it is kept in the repo.
- `%APPDATA%\sandustry\logs\main.log` holds only startup/GPU lines, nothing about gameplay.
- Sim speed is worker message `SetSimulationSpeed = 68`; the cinematic panel's speed is
  `session.cinematic.speed.multiplier`.

## The map (world `28lnrdm8fhv`, "Loamcrest")

Three Sources: copper at 1788,3028 (1/s) and soil at 1676,3772 and 1440,3144 (3/s each).
On the belt line at y 2340, x 1968–1987, there are five `filterRightMk2` set to allow only
Water and Steam. They were briefly suspected of eating resources; Brandon concluded the belt
just runs faster there. A tracer copy is its own element type, so those filters drop it like
any disallowed material (`sim-filter.js` checks the tracker handles that cleanly).
An earlier history export showed water running a deficit, cloud climbing about 3,000/min,
and the gold chain starved (gold, residue, aurixite and auralite all falling).

## Testing

`.handoff/sim-*.js` are Node harnesses that `eval` a mod's real code in strict mode against
a mocked `sandkit`. They locate the mods relative to their own file
(`path.join(__dirname, "..", "mods", …)`), print `ok` / `FAIL` lines, and **exit non-zero
on any failure**. Run each with `node .handoff/sim-<name>.js`:

- `sim-copies.js` — Screensaver 0.18: which copies exist, what each was taught (contacts,
  burning, machines, gold rule, main-product rule), and four scenes (launcher, fire,
  planter, shaker).
- `sim-clone.js` — copies are built and armed, and a soil copy touching water becomes the
  wet-soil copy and is still followed. Fails if no copies are built.
- `sim-output.js` — a machine output is picked up and the chain hops (wet soil → residue,
  not gold).
- `sim-filter.js` — a tracer riding into the filter section: the loss is logged at the
  filter and resolved (pick-up / give-up), no stray tracers left.
- `sim-lost.js` — a spot that keeps eating the tracer: the third loss must fire the
  `hotspot` bailout, with no further pick-ups there.
- `sim-loop.js` — Sandbox Loop: a Source keeps the material baked into it by element id
  across PCs (golden Sand is number 61 on one PC and 74 on the other and still comes out as
  golden Sand while the panel default stays soil); an unknown id falls back to the panel and
  is flagged unset; `bake()` writes the id through `updateData`. Verified to FAIL against a
  copy whose `cfgFor` always returns the default (the old version only ever checked the
  default, which a broken `cfgFor` also produces).
- `sim-mapsweep.js` — Screensaver 0.18.3 map sweep, booted twice (with `api.world.mutate`
  and with the `removeAtCellWhenIdle` fallback): every tracer cell emptied, ordinary grains
  untouched, a grain that moved on between read and delete is left alone and NOT counted,
  one `map-sweep` log event with the real count, `isSweeping()` true mid-sweep, abort when
  `active`, abort after 100 consecutive read errors (30 do not), `sweepMap()` and the
  `game:ready` schedule; every `api.elements.register` call has `showInFilterPicker: false`.
- `sim-mk3.js` — Manufacturing's Filter Mk.3 from `main.real.js` (run inside the game's
  async wrapper): `building:placed` copies `defaultFilter` with affects* true and its own
  array (vanilla filters and copy-pasted Mk.3s left alone); the interactable selects the
  contiguous same-setting row and Apply writes it via `structures.updateMany` with a filter
  object per member, flags kept; trigger `brandonFilterMk3Belts` at 166 ms with a
  self-contained callback, both conveyor types, both re-sent on `game:ready`; the
  `frame:render` handler mirrors `conveyorMk2AnimationIndex` into `mk3anim`; ELEMENTS order.
- `sim-clipboard.js` — Improved Filter Options 0.2.8: COPY takes the editor's draft, else
  `defaultFilter`; PASTE into a row is `setDraft` then `apply`; the clip round-trips through
  localStorage by element id (a material from a missing mod is dropped, an unresolvable clip
  stays unloaded and is retried); Mk.1 (StructureType 17/18) rows are not pickable and show
  no strip; a paste onto a row writes only mode + elementType so `affectsLiquid: true` stays
  true and false flags are never persisted or written; arming Pick with a row open in the
  game's editor leaves the hand alone, with a Mk.2 in hand it stashes and hands back.

They are the only way to test without the game. Run them all:
`cd .handoff && for s in sim-*.js; do node $s >/dev/null 2>&1 && echo "$s pass" || echo "$s FAIL"; done`

## Before changing a mod / deploy workflow (desktop PC)

1. Edit in the clone, `C:\Users\Brand\dev\rockons-sandustry-mods\mods\<mod>\`. Read the
   current source first.
2. Bump `BUILD` in main.js (the tracker/banner shows it) and `version` in modinfo.json.
3. Manufacturing: edit `main.real.js` / `worker.real.js` only, then run
   `node tools/rebuild-manufacturing-stubs.js` (regenerates the baked copies inside
   `main.js` / `worker.js`; `git status --short mods/manufacturing` shows only the files
   you meant to change). Never recompile with `compiler.js`.
4. Run every `.handoff/sim-*.js`; all must exit 0.
5. Deploy: copy the mod's files from `mods\<mod>\` into `%APPDATA%\sandustry\mods\<mod>\`.
6. **Fully quit and relaunch** the game (the game caches mod files at launch); confirm the
   build number in game.
7. Commit on a branch, merge to `main`, `git push`. Regenerate `mods-checksums.md` after
   the commit.

There is no device bridge any more; everything happens directly on the desktop.

## Open issues / next steps

1. **Screensaver 0.18.x in-game confirmation is still partial.** 0.18.x has run on the real
   map (the 2026-09-24 save shows its tracer types in the discoveries, which is what led to
   the map sweep), but the full check has not been reported: the tracker's "reactions
   armed" count above zero, a grain following soil → wet soil → residue → burnt residue →
   seed without hand-backs, nothing refused (the log says why if so). 0.18.3's sweep
   changes are covered by `sim-mapsweep.js` only. Also unconfirmed in game: Manufacturing's
   Mk.3 belt animation and speed, Improved Filters 0.2.7, Sandbox Loop 0.4.6, Quickstart 1.0.2.
2. **Hard-wired steps still hand back** (a planter growing a flower, steam → cloud, the
   thermofroster). These are game code, not tables; hand-back is the permanent answer
   unless the game exposes them.
3. **Laptop** — the mods were installed there on 2026-09-23 (notes in the claude.ai project,
   `claude/laptop-install.md`). Left to do: update it to the current versions, delete
   `mods\workshop` by hand, and confirm the builds in game. Old Sources never opened on the
   desktop may need their material set once (Sandbox Loop 0.4.0 migration).
4. The desktop's newest saves (2026-09-21) were never committed; the snapshot branch map is
   from 2026-09-20.
5. **Push.** Everything since 2026-09-23 is on the local `audit-fixes` branch; after Brandon
   pushes, regenerate `.handoff/chunks/` (see `repo-history-README.md`) and
   `mods-checksums.md`, and fix the `1ca265d` notes in `.handoff/README.md`.

Done, for the record: the 0.17.2 in-game check and the fire-reaction / machine gaps (#1, #2
in older copies of this file) were superseded by 0.18, which copies burning and teaches
every contact, machine, kinetic-press and planter rule. The laptop "emitted golden Sand
instead of soil" bug was fixed in Sandbox Loop 0.4.0 (material stored by element id and
baked into the structure).

### 2026-09-23 audit — what was fixed this round

- `compiler.js` marked RETIRED/DANGER, refuses to overwrite `mods/manufacturing` without
  `--force`, usage message instead of a stack trace; bolt-on paths in `compiler-cfg.json`
  are repo-relative (were a dead `/home/claude/...` path).
- `studio.html`: handler-attribute escaping (`jsq`), `'` escaped, density/matter escaped,
  `hex()` safe for non-numbers, synced/localStorage data validated on load; tech-tree note
  no longer claims moves compile into the mod.
- `tools/resource-history/page.html`: colours accepted only as `#rrggbb`, names and rates
  escaped; README documents `st`.
- Harnesses: `sim-clone.js` rewritten for 0.18 (was passing with 0 clones); `sim-filter.js`,
  `sim-lost.js` (drives the third loss, asserts `hotspot`) and `sim-loop.js` now assert and
  exit non-zero; all locate mods from `__dirname`.
- Docs: `master` → `main`, versions, this PC's paths and deploy workflow; `chunks/`
  regenerated from `main`; `mods-checksums.md` reset to be regenerated after commit.
- Removed leftovers: `diag-bolton.js`, root `quickstart/` (duplicate of `mods/quickstart`
  1.0.0), root `workshop/` (early copy).
- Mods (by other sessions the same day): Sandbox Loop 0.4.3, Screensaver 0.18.1,
  Manufacturing 0.11.1, Lava Boiloff 0.1.1, Quickstart 1.0.1. Manufacturing 0.12.0 then moved
  Filter Mk.3 from the Upgrades pane to the tech tree (25,000 gold placeholder).

## Talking to other chats

Sessions cannot message each other live. The claude.ai project is the shared channel: write
what you did to a doc there and the other chat can read it (that is how the laptop install
came back). The repo on GitHub is the durable copy of everything code; the world saves are
in `world-snapshots/`, `loamcrest-transfer.zip` and on both PCs.

## Working style

Brandon iterates fast, live, against the running game. He prefers plain language over jargon
and a short summary of what changed after each build. He pushes back when a diagnosis is wrong
— check the tracer log before theorising, and say when something is a guess. The project
instruction is to ask questions when the request leaves room for interpretation.
