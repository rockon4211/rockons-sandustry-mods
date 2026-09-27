# CLAUDE.md — read this first

Mods for **Sandustry v0.5.6** (Steam), written for Brandon, who plays and tests them live.
This file is for Claude: the rules, the checks, the mistakes already made once, and the
recipe for menus that match the game's. The human-readable version of the lessons is
`.handoff/lessons.md`; everything else (mods, versions, verified engine facts, open issues)
is `.handoff/handoff.md`.

## Read order
1. This file.
2. `.handoff/handoff.md` — all of it. Its **"Game internals — verified reference"** section
   is ground truth about the engine and the mod API; every new engine fact goes there in
   the same commit as the code that used it.
3. `mods/README.md` for the version list, `.handoff/README.md` for the harnesses.

## Layout and rules
- `mods/<mod>/` is the source of truth. `%APPDATA%\sandustry\mods\<mod>\` is only the
  install target — never make it a git repo, never edit it directly.
- **Manufacturing**: edit `main.real.js` / `worker.real.js` ONLY, then run
  `node tools/rebuild-manufacturing-stubs.js`. `main.js` / `worker.js` are hot-load stubs
  that embed a verbatim baked copy; hand-editing them is always wrong. Never reorder its
  `ELEMENTS` list (saves store element numbers). The Material Studio compiler is retired.
- Every change: bump `version` in `modinfo.json` AND the in-code build marker (`BUILD`
  const, or Manufacturing's "Manufacturing vX running" toast), verify (below), install,
  commit, refresh `.handoff/mods-checksums.md`, update the version lines in `README.md`,
  `mods/README.md` and `handoff.md`.
- `main` is the live branch. Work on a branch; push only when Brandon says so. Commits
  end with the `Co-Authored-By` line the session's attribution reminder gives.
- Element numbers, terrain numbers and structure indices are assigned at runtime and
  differ per PC / mod set: persist by id string, resolve by name at runtime, never
  hard-code one. No `C:\Users\Brand` or `C:\SteamLibrary` paths in code.

## Verify before installing — Claude cannot see the game
```
node --check mods/<mod>/main.js
node -e "new (Object.getPrototypeOf(async function(){}).constructor)('sandkit','\"use strict\";\n'+require('fs').readFileSync('mods/<mod>/main.js','utf8'))"   # the game's wrapper
node tools/rebuild-manufacturing-stubs.js && git status --short mods/manufacturing   # baked == real
cd .handoff && for s in sim-*.js; do node $s >/dev/null 2>&1 && echo "$s pass" || echo "$s FAIL"; done
```
Then install by copying from the commit (`git show HEAD:mods/<mod>/<file> > "$APPDATA/sandustry/mods/<mod>/<file>"`, then `cmp`),
and tell Brandon: restart the game fully, what build number to look for, and exactly what
to check. Say plainly what has **not** been tested in game. Deleting inside `%APPDATA%` is
blocked for Claude — ask Brandon.

Checksums: after committing,
`H=$(git rev-parse --short HEAD); git ls-tree -r --name-only HEAD mods | grep -v README | sort | while read p; do echo "$(git show HEAD:"$p" | sha256sum | cut -d' ' -f1)  ${p#mods/}"; done`
replaces the block in `.handoff/mods-checksums.md` (header gets `$H` and the date).

## Big mistakes already made once — don't repeat them
1. **Called the repo's PNGs placeholders and "restored" bloated copies.** They were
   pixel-identical; an old copy tool had re-encoded the installed ones. Rule: read ALL of
   `.handoff/` before acting on a repo-vs-install difference; compare images by pixels.
2. **Declared "a new filter structure is impossible (unknown id gets belt speed 0)".**
   True only for a plain structure; `api.structureBehaviors.registerConveyorType` exists.
   Rule: before saying the engine can't do something, grep the engine API
   (`sandkit.engine.api`, far bigger than `sandkit.api`) and the worker runtime.
3. **Built an upgrade when a building was asked for.** "Mk.3 identical to the Mk.2 filter
   but at Mk.2 belt speed" meant a NEW structure; three versions went the wrong way. Rule:
   restate the feature in one sentence and get a yes before building anything sizeable.
4. **A global change to every vanilla Mk.2 filter stalled the whole factory overnight.**
   Rule: never alter vanilla behaviour globally; make it a separate structure or an
   opt-in per structure, and warn what a change touches.
5. **Hard-coded ids** (terrain 56 "in this world", element numbers in localStorage) and
   **hard-coded paths** (`file:///C:/Users/Brand/…` in the hot-loader). Rule above.
6. **Tracer elements showed up in the Matter Gun and filter pickers.** Rule: any element
   not meant for players is registered with `showInFilterPicker: false` and filtered by id
   prefix in our own pickers.
7. **Menus** (all found by trial): `overlays.register` render() must RETURN an element;
   "in hand" is `engine.api.action.getActive(state)`, not one field; `cancelPlacement`
   is not a deselect; `preventDefault` on pointerdown kills the follow-up mousedown; the
   hotbar band lays overlays side by side so extra strips must be narrow; the game's
   filter panel/overlay id lists can't be extended, so a mod filter needs a clone. Full
   recipe below.
8. **Trying to fix the world in a save file.** The element grid is packed; sweep it from
   inside the game (`api.world` in a time-sliced loop) instead.
9. **Quicksave rollback looked like a mod bug.** F10 loads the last F5 quicksave; the world
   rolls back, mod localStorage does not. Explain that before hunting.
10. **A harness that "passed" while testing nothing.** Every harness must build something
    and exit non-zero on failure.
11. **Long inline heredoc scripts in the shell tool fail silently or partially.** Write
    scratch scripts with the Write tool and run `node file.js`; keep CRLF/LF as found.
12. **Parallel fixer agents**: give each disjoint folders and no git commands; verify each
    diff yourself before committing (one of them re-checked emptiness after createAtCell,
    which would have made Sources count nothing).
13. Subagent audit findings are leads, not facts: re-read the code before acting on one.
14. **Removed a re-read inside an `api.world.mutate` callback on a hunch** ("a write may not
    be visible yet"). Wrong: the callback runs on the main thread with the sim parked, so a
    re-read is reliable — and `createAt` silently does nothing when the element pool is
    full, so the re-read is the only way to know a grain exists. Rule: verify a claim
    about the engine before removing a check that depends on it.
15. **Persisted flags as `!!undefined === false`.** A filter setting that lacks
    `affectsLiquid/affectsGas` came back from the clipboard as explicit `false` and, pasted
    onto a row, switched liquid/gas filtering off with nothing visible. Rule: write only the
    fields the game's own code writes (its row editor writes `mode` + `elementType`), and
    never materialise a missing flag as `false`.
16. **Changing what is in hand cancels the game's row editor.** Its `afterRender` drops the
    selection whenever the active structure isn't one of its filters — so "put the tool
    down, then pick" closed the row the user was editing. Rule: while the game's editor has
    a selection, leave the hand alone.
17. **Cloned the game's filter panel, labels and row editor for the Mk.3** (0.15.0–0.15.8) because the
    gating id lists aren't exported. Each clone drifted from the real thing (rows never closing,
    starting collapsed, placing while editing). The lists are all asked through
    `Array.prototype.includes`, so 0.16.0 teaches that one call that a Mk.3 is in every list its
    Mk.2 twin is in, and deleted ~300 lines. Rule: when the game already serves a sibling kind,
    find its gate (grep the bundle) and join it before cloning; patch per frame only the spots
    that name an id outright.

## Uniform menu playbook — panels that look and behave like the game's
First check whether the game's own panel can serve the thing (big mistake 17) — for filters it
does. Verified on the clipboard strip (`mods/improvedfilters/main.js`, `Strip`) and the
former Mk.3 filter panel (`FilterMk3Panel`, in Manufacturing before 0.16.0 — git history).
Copy from them.

**Where it lives.** Panels that belong to the thing in hand go in the hotbar band:
`api.ui.overlays.register("hotbar", "<id>", () => React.createElement(Panel))` — the third
argument is called as a plain function and must return an element. Repaint with
`api.ui.overlays.update("hotbar")` plus a `useState` tick inside the component. The band
lays every overlay out side by side, left to right, in registration order: the main panel
may be 640px wide (the game's own filter panel is 640×≤600); anything else in the band
must be ONE line, ≤ 460px, with text ellipsised (`whiteSpace:nowrap; overflow:hidden;
textOverflow:ellipsis`, full text in `title`). Free-floating tools (Sandbox Loop) use
`api.ui.inject(id, Comp)` with `position:fixed` and their own drag handle.

**When it shows.** Use the game's own tests, never your own reconstruction:
- a game filter in hand: `session.building.activeStructureType` ∈ the game's ids;
- a mod building in hand: `sandkit.engine.api.action.getActive(sandkit.engine.state)`
  (`{type,id}` or null — the same call that decides whether a ghost is drawn);
- a row open in the game's editor: `engine.api.filterGroupEditor.getSelection(state)`;
- hide while `window.__brandonScreensaver.isActive()`; poll every 250 ms and repaint only
  on change.

**Look — the game's own classes (Tailwind; arbitrary values only where the game uses them):**
- collapsed bar: `bg-black bg-opacity-75 px-4 py-2 flex items-center gap-4 cursor-pointer
  border border-slate-700 rounded ui-box text-white text-xs`
- expanded box: `bg-black bg-opacity-75 flex flex-col overflow-hidden border border-slate-700
  rounded ui-box` with `style={{width:"640px", maxHeight:"600px"}}`; header
  `px-4 py-2 border-b border-slate-800 flex items-center justify-between`; toolbar
  `px-4 py-3 border-b border-slate-800 flex gap-4 items-center`; scrolling body
  `p-3 overflow-y-auto`
- button: `text-xs px-2 py-0.5 text-white bg-black border rounded-tr-lg rounded-bl-lg
  item-button-transition border-slate-200 border-opacity-25 hover:text-[#ffe700]
  hover:border-opacity-0`; selected/on: `text-[#ffe700] border-[#ffe700]`;
  allow: `text-[rgb(30,255,0)] border-[rgb(30,255,0)]`; block: `text-[rgb(255,77,21)]
  border-[rgb(255,77,21)]`; every button gets `onMouseDown: e => e.preventDefault()` and
  `tabIndex: -1` so it never steals focus from the game
- material chip: outer `group flex items-center rounded border transition-all duration-200`
  + (`border-[#ffe700] bg-[#ffe700]/10` | `border-slate-700 hover:border-slate-500
  bg-black/40 hover:bg-black/60`); checkbox `ml-2 flex h-3 w-3 flex-shrink-0 items-center
  justify-center border text-[9px]`; swatch `w-3 h-3 flex-shrink-0` with
  `backgroundColor: rgb(metaColor)` and `boxShadow: 0 0 6px <color>80`
- search input: `w-full bg-black/60 border border-slate-700 px-3 py-1.5 rounded text-xs
  text-white placeholder:text-white/70 focus:outline-none focus:border-slate-500`
- header icon: the structure's sprite via `state.sandkit.graphics[imageName].imageAsset.image.src`,
  cropped to one frame with `backgroundSize`, inside a 28px rounded-tr-lg/rounded-bl-lg
  radial-gradient box
- labels overlay: fixed full-screen `pointer-events:none` container; per row a dashed
  2px box (green allow / red block / yellow selected) and a black monospace 10px label
  above it, both positioned every frame (`requestAnimationFrame`) with
  `sx = canvasRect.left + (cellX*4 − session.camera.x) * (session.view.zoom||1) * session.scale`
  (same for y), label transform `translate(sx + w/2, sy − 4) translate(-50%, -100%)`;
  labels get `pointer-events:auto` and a click handler; rows re-read every 500 ms.

**Text.** Use the game's strings through `api.i18n.t(key, params)` with an English
fallback: `ui|filter|allow` `{check:"✓"}`, `ui|filter|block` `{cross:"✕"}`,
`ui|filter|editing`, `ui|filter|editLastPlaced`, `ui|filter|clickToExpand`,
`ui|filter|labelsOverlay`, `ui|filter|tab|solid|liquid|gas`, `ui|elementPicker|minimize`,
`ui|elementPicker|searchPlaceholder`, `ui|tooltip|filterSeparator`.

**Behaviour.** Esc: a window `keydown` listener in the capture phase (cancel edit, else
collapse). Editing a placed row: select it through the game's rule (same type, same filter
key, touching), write with `engine.api.structures.updateMany(state, members,
{propagateToWorkers:true})`, and offer Apply / Cancel. Picks on the map: handle on
`pointerdown` (capture), compute the cell from the mapping above, put the held building
down first (clear `activeStructureType`, `player.action`, `hotbar.activeSlotIndex`,
`placing`) and hand it back with `engine.api.building.selectStructure(state, id)`. Mark your
own DOM with a data attribute and ignore your own clicks in window listeners. Element
lists: `store.discoveries.elements` ∩ registered types with `showInFilterPicker !== false`,
grouped solid/liquid/gas by `MatterType`, sorted by name.

## Working with Brandon
Plain language, short summary of what changed after each build, ask when a request leaves
room for interpretation, and say when something is a guess. He tests in the game and
reports back with screenshots; check the tracer log / save before theorising. He is the one
who pushes to GitHub — ask first.
