# Workshop mod (in progress)

A machine you enter: a separate Sandustry map ("the workshop") you load into,
build a processing line in, and pipe throughput back to the overworld.

## Status
- M1 DONE: enter the workshop map (custom_map boot), intro + tutorial skipped.
- Shared progression DONE: tech, factory tier (store.viability.level), gold
  (shared.gold[0] buffer), buildable machines (store.player.buildings),
  upgrades, discoveries carry base -> workshop; inventory stays separate.
- NEXT: door portal (in-world entry), input basket + per-minute metering,
  symmetric oil output, sustained-feed deficit, tool-blocking.

## Files
- main.js      - mod entry (menu button for now; progression snapshot/apply; intro skip)
- modinfo.json - manifest
- brandon_workshop_v0.custommap - the workshop map (walled sandbox room)
- make-map.js  - regenerates the .custommap (validates via Map Studio's checker)

## Install (device)
- mod:  %AppData%\sandustry\mods\workshop\{main.js,modinfo.json}
- map:  %AppData%\sandustry\custom_maps\brandon_workshop_v0.custommap

## Key engine facts (0.5.6)
- custom_map=<id> boots a .custommap; always plays intro+tutorial -> we skip via
  game.start({skipIntro}) + clearing session.ui.introScreen.visible (ui.update
  ComponentId.IntroScreen=20, Root=4) + store.tutorial.active=false.
- Gold HUD reads shared.gold[0] (sim rewrites store.resources.gold from it).
- Tier gate = store.viability.level; factoryLevelCap must be null.
- Researching a tech pushes the machine into store.player.buildings (the
  buildable list) - copying only the tech flag is not enough.
