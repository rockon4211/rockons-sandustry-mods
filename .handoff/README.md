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
  Each prints ok/FAIL lines and exits non-zero on a failure.
- `chunks/` + `repo-history-README.md` — the code history as a git bundle split into ten
  base64 text parts, for the claude.ai project mirror (binaries stripped, so commit hashes
  differ from GitHub). Regenerated 2026-09-23 from `main` `1ca265d`; the README has the
  rebuild and regenerate commands.
- `binaries.md`, `binaries-b64.txt`, `repo-binaries.md`, `bin/` — the repo's PNGs and the
  Workshop map as base64. **Stale** (written before 2026-09-23; no documented regenerate
  script). Prefer the PNGs in git. PNGs from different installs differ byte-wise but are
  pixel-identical (an old device bridge re-encoded them), so compare images by pixels.
- `workshop/` — the retired Workshop mod's code, kept for reference.
