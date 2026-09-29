# Rockon's Sandustry mods

Mods for **Sandustry v0.5.6**, plus the tooling and the Loamcrest world they were built
against. Everything here is installed by copying folders into
`%APPDATA%\sandustry\mods\`; fully quit and relaunch the game, then enable each mod in
its Mods menu.

## The mods (`mods/`)

| Mod | Version | What it does |
| --- | --- | --- |
| **sandboxloop** | 0.4.8 | Sources and Removers for an endless, self-balancing factory, plus a whole-map balance tracker with history export, a ✎ Placed list to edit what is already on the map, and a 🔍 Inspect readout of the grain under the mouse (or the grain the Screensaver is following). |
| **screensaver** | 0.18.5 | After a few idle minutes the HUD hides and the camera follows one real grain through the factory, material by material. Press **E** to exit. Sweeps stray tracer grains off the map on every world load. |
| **improvedfilters** | 0.3.0 | Filter clipboard built into the Mk.2 / Mk.3 filter menus: copy what a filter menu shows, paste it into the other (rows or new filters). |
| **manufacturing** | 0.16.0 | Renames vanilla sand to "soil" and adds a golden Sand (→ Glass on the Smelter); Mod Tools (Matter Gun, vacuum tank delete buttons, Omni Vacuum, red-block fix, cell probe, Grab Heavy Stone toggle); **Filter Mk.3** — its own building (research under Manufacturing, 25,000 gold): sorts like the Mk.2 Filter at Mk.2 belt speed, with its own copy of the filter panel and labels overlay. |
| **lavaboiloff** | 0.1.1 | Lava has a 1-in-N chance to burn itself out each time it boils water into steam. |
| **quickstart** | 1.0.2 | **F10** quick reload: reboots the game straight back into the current save (prefers the F5 quicksave). |

Versions as of 2026-09-27, on `main` (pushed 2026-09-27).

### Sandbox Loop

A **Source** emits a chosen material at an adjustable rate (decimals fine, up to 100/s);
a **Remover** is a single block that deletes one chosen material at an adjustable rate.
Each placed structure bakes in the settings shown on the panel, stored by element id
inside the save so a map opened on another PC keeps emitting the same thing. The Balance
panel counts every material on the map, shows surplus and deficit, keeps running totals,
logs a 30-second history you can export, and freezes while the game is paused. Its
companion graph page is `tools/resource-history/page.html` — open it in a browser and drop
an export on it.

### Screensaver

A Source emits one grain as the mod's own copy of that material — every material gets a
copy at launch that carries its whole definition, a shade brighter. The copies are taught
every contact, machine, kinetic-press and planter rule the real material has, and burn
like it, so the game itself carries the grain through the chain (soil → wet soil →
residue → burnt residue → seed …) while it stays identifiable. It never becomes gold. The
few hard-wired steps hand the grain back and pick up what comes out. A tracker panel shows
what it is doing, and a flight recorder saves a JSON log of every journey (and every loss,
with the reason) to Downloads.

### Manufacturing — source of truth

Edit `mods/manufacturing/main.real.js` / `worker.real.js` by hand, then run
`node tools/rebuild-manufacturing-stubs.js`. `main.js` / `worker.js` are hot-load stubs
that embed a verbatim **baked copy** of the `.real` files; the script regenerates them
(never edit the stubs directly — `git status --short mods/manufacturing` should show only
the `.real` files plus the regenerated stubs). Do **not** regenerate the mod with
`compiler.js` (see below).

## The rest

- `tools/resource-history/` — the graph page for Sandbox Loop history exports.
- `studio.html`, `graph.json` — Material Studio: a graph of Sandustry's materials and the
  machines between them. Still useful for browsing the game's recipe graph.
- `compiler.js`, `compiler-cfg.json`, `tools-bolton.js`, `tech-glass-bolton.js` — the
  studio's mod compiler. **RETIRED — DANGER.** Manufacturing has grown hand-written code
  since the last compile (HeavyStone; the Filter Mk.3 research node, building, filter-list join,
  belt trigger; the red-block fixes; the cell probe; the Grab Heavy
  Stone toggle). A recompile from `graph.json` would drop all of that, **reorder element
  registration (changing element ids and breaking saves)**, and roll the version back to
  the 0.8.1 in `compiler-cfg.json`. It refuses to write into `mods/manufacturing` without
  `--force`. Bolt-on paths in the config are relative to the config file. Its
  `cfg.hotload` is a `file:///` URL of one PC's installed mod folder
  (`C:/Users/Brand/...`) — PC-specific; change it before compiling anything else.
- `exports-*/` — past compiled builds from the studio, kept for history. Note:
  **`exports-manufacturing-current/` is actually v0.8.1**, not current (the name is kept
  because other notes point at it). The hot-load URLs baked into these builds are
  `C:/Users/Brand/...` paths from the desktop PC.
- `world-snapshots/` — saves of the **Loamcrest** world (`28lnrdm8fhv`). Copy the `.save`
  files into `%APPDATA%\sandustry\saves\`.
- `.handoff/` — notes, checksums and test harnesses for picking this work up in a new chat.
  Start with `.handoff/handoff.md`.

The retired Workshop mod lives in `.handoff/workshop/` and in git history (the early root
`workshop/` copy and its `.custommap` were removed on 2026-09-23; recover with
`git checkout c91f789 -- workshop/`).

## Testing

`node .handoff/sim-<name>.js` for each harness (see `.handoff/handoff.md` → Testing, or
`.handoff/README.md`). Each `eval`s a mod's real code against a mocked game and exits
non-zero on a failed check. Current set: `sim-clone`, `sim-copies`, `sim-output`,
`sim-filter`, `sim-lost`, `sim-mapsweep` (Screensaver), `sim-loop` (Sandbox Loop),
`sim-mk3` (Manufacturing's Filter Mk.3), `sim-clipboard` (Improved Filter Options).

## Branches and pushing

`main` is the live line of work. `snapshot/loamcrest-2026-09-20` (tag
`loamcrest-2026-09-20`) is a frozen copy of the map and the mods as they were that day.
Everything since 2026-09-23 (the audit round, Filter Mk.3, Improved Filter Options, the
map sweep) was merged into `main` on 2026-09-27 (fast-forward from `audit-fixes`).

The repo is `rockon4211/rockons-sandustry-mods` on GitHub. On the desktop PC the clone is
`C:\Users\Brand\dev\rockons-sandustry-mods` and git is already authenticated (Git
Credential Manager), so pushing from it is just `git push`.
