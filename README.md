# Rockon's Sandustry mods

Mods for **Sandustry v0.5.6**, plus the tooling and the Loamcrest world they were built
against. Everything here is installed by copying folders into
`%APPDATA%\sandustry\mods\`; fully quit and relaunch the game, then enable each mod in
its Mods menu.

## The mods (`mods/`)

| Mod | Version | What it does |
| --- | --- | --- |
| **sandboxloop** | 0.4.0 | Sources and Removers for an endless, self-balancing factory, plus a whole-map balance tracker with history export. |
| **screensaver** | 0.17.2 | After a few idle minutes the HUD hides and the camera follows one real grain through the factory, material by material. Press **E** to exit. |
| **manufacturing** | 0.9.5 | Mod Tools: the Matter Gun, vacuum tank delete buttons, the Omni Vacuum, and the rename of vanilla sand to "soil" with a new golden Sand. |
| **lavaboiloff** | 0.1.0 | Lava boiling behaviour. |
| **quickstart** | 1.0.0 | Skips the intro. |

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

It borrows one grain from a Source and marks it as its own element — a clone that copies
the real material's whole definition, a shade brighter. The game's own reaction tables are
taught the clones' reactions, so the grain wets, burns and gets processed exactly like its
neighbours while staying identifiable: soil → wet soil → residue, copper → liquid copper.
A tracker panel shows what it is doing, and a flight recorder saves a JSON log of every
journey (and every loss, with the reason) to Downloads.

## The rest

- `tools/resource-history/` — the graph page for Sandbox Loop history exports.
- `studio.html`, `compiler.js`, `graph.json` — Material Studio: a graph of Sandustry's
  materials and the machines between them, which compiles into a mod.
- `exports-*/` — past compiled builds from the studio.
- `world-snapshots/` — saves of the **Loamcrest** world (`28lnrdm8fhv`). Copy the `.save`
  files into `%APPDATA%\sandustry\saves\`.
- `.handoff/` — notes, checksums and test harnesses for picking this work up in a new chat.

## Branches

`master` is the live line of work. `snapshot/loamcrest-2026-09-20` (tag
`loamcrest-2026-09-20`) is a frozen copy of the map and the mods as they were that day.
