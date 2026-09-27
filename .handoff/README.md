# .handoff

Notes and test harnesses for whoever picks this up next — a person or a new chat.

- `lessons.md` — what went wrong along the way and the rule each became (human version of
  the root `CLAUDE.md`, which Claude Code loads automatically).
- `handoff.md` — **start here.** What the mods are, what the game's modding API allows,
  how to test without the game, what is still open.
- `mods-checksums.md` — sha256 of every file in `mods/`, for comparing two PCs.
  Regenerated after each commit that changes `mods/`.
- `sim-*.js` — Node harnesses that run a mod's real code against a mocked game. They find
  the mods relative to their own file, so run them from anywhere (`node .handoff/sim-clone.js`).
  Each prints ok/FAIL lines and exits non-zero on a failure. Run them all from here:
  `for s in sim-*.js; do node $s >/dev/null 2>&1 && echo "$s pass" || echo "$s FAIL"; done`
  - Screensaver: `sim-clone.js` (copies built and armed, soil copy + water → wet-soil copy),
    `sim-copies.js` (what each copy was taught, four scenes), `sim-output.js` (machine
    output picked up, never gold), `sim-filter.js` (loss at the filter section resolved),
    `sim-lost.js` (third loss fires `hotspot`), `sim-mapsweep.js` (0.18.3 whole-map tracer
    sweep, both delete paths, real-delete counting, error abort, `isSweeping()`, every
    registered element has `showInFilterPicker: false`).
  - Sandbox Loop: `sim-loop.js` (a Source keeps its material by element id across PCs;
    fails against a broken `cfgFor`).
  - Manufacturing: `sim-mk3.js` (Filter Mk.3 from `main.real.js`: placement copies the
    default filter, row editor + `updateMany`, the 166 ms belt trigger, the animation buffer).
  - Improved Filter Options: `sim-clipboard.js` (copy/paste through the game's editor, clip
    by element id across PCs, Mk.1 excluded, flags never written as false, no stash while a
    row is open).
- `chunks/` + `repo-history-README.md` — the code history as a git bundle split into ten
  base64 text parts, for the claude.ai project mirror (binaries stripped, so commit hashes
  differ from GitHub). Regenerated 2026-09-23 from `main` `1ca265d` — now ~50 commits behind
  the `audit-fixes` branch (Filter Mk.3, Improved Filter Options, the map sweep and the
  audit round are NOT in it); regenerate after the push. The README has the rebuild and
  regenerate commands.
- `binaries.md`, `binaries-b64.txt`, `repo-binaries.md`, `bin/` — the repo's PNGs and the
  Workshop map as base64. **Stale** (written before 2026-09-23; no documented regenerate
  script). Prefer the PNGs in git. PNGs from different installs differ byte-wise but are
  pixel-identical (an old device bridge re-encoded them), so compare images by pixels.
- `workshop/` — the retired Workshop mod's code, kept for reference.
