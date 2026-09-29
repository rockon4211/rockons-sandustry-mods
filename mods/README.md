# Mods (source of truth)

These folders are what gets installed in `%APPDATA%\sandustry\mods\`:
  sandboxloop (v0.4.9), screensaver (v0.18.8), manufacturing (v0.16.1, Mod Tools),
  lavaboiloff (v0.1.1), quickstart (v1.0.2), improvedfilters (v0.3.0)

Manufacturing: edit `main.real.js` / `worker.real.js` ONLY, then run
`node tools/rebuild-manufacturing-stubs.js` to regenerate `main.js` / `worker.js` (they embed
a verbatim baked copy and must stay identical). Never hand-edit the stubs.

Retired: `workshop` (removed from main 2026-09-20; still recoverable from git history).
On the desktop it was moved to `sandustry\_to_delete\retired-2026-09-20\workshop`.

To deploy: copy each folder into `%APPDATA%\sandustry\mods\`, fully quit and relaunch
the game, enable the mods. Images may differ byte-wise from an install (an old copy
tool re-encoded them) while being pixel-identical.

Sandbox Loop's companion graph page lives in ../tools/resource-history.
