# .handoff

Notes and test harnesses for whoever picks this up next — a person or a new chat.

- `handoff.md` — **start here.** What the mods are, what the game's modding API allows,
  how to test without the game, what is still open.
- `mods-checksums.md` — sha256 of every file in `mods/`, for comparing two PCs.
- `sim-*.js` — Node harnesses that run a mod's real `main.js` against a mocked game.
  Run them from this folder: `node sim-clone.js`.
- `binaries.md`, `binaries-b64.txt`, `bin/`, `chunks/` — the repo packed as text, for the
  claude.ai project mirror. Regenerate rather than edit.
