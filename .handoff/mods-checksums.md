# Mod file checksums — TO BE REGENERATED

The hashes that used to be here were for an old commit (`cf615c2`, before Sandbox Loop
0.4.3, Screensaver 0.18.1, Manufacturing 0.11.1, Lava Boiloff 0.1.1, Quickstart 1.0.1).
They will be regenerated after the 2026-09-23 audit round is committed.

## How to regenerate (after committing, so the header can name the commit)

From the repo root in Git Bash:

```bash
( echo "# Mod file checksums — main, $(git rev-parse --short HEAD), $(date +%F)"; echo;
  echo '```'; (cd mods && find . -type f | sort | sed 's|^\./||' | xargs sha256sum); echo '```' ) > /tmp/sums.md
```

then paste the block over the placeholder below and keep the sections after it.
On Windows without Git Bash: `certutil -hashfile <file> SHA256` per file.
To compare an install, run the same `find … | xargs sha256sum` inside
`%APPDATA%\sandustry\mods\` (Git Bash: `cd "$APPDATA/sandustry/mods"`).

```
(placeholder — regenerate after commit)
```

## PNGs

PNGs will not match byte-for-byte across installs: an old device bridge re-encoded them
when writing. They are pixel-identical, so compare images by pixels (decode and diff), not
by hash. Expect the .js and .json files to match exactly.

## Worth checking when two PCs behave differently

Not in the mods folder, but worth checking:
- `%APPDATA%\sandustry\meta\settings.json` → `externalModSettings` (per-mod settings).
- Which mods are ENABLED in the game's mod menu. Manufacturing is what renames vanilla
  sand to "soil" and adds the new golden Sand.
- Leftover `mods\workshop` or `glassworks` folders: they still load if present.
- `localStorage` for the game's page holds Sandbox Loop's panel selections and (before
  0.4.0) every placed Source/Remover's material. It does NOT travel with a save. From
  0.4.0 the material is baked into the structure inside the save instead.
- Manufacturing: `main.js`/`worker.js` are hot-load stubs that load `main.real.js` /
  `worker.real.js` from the mod's own folder and fall back to their baked copy if that
  fails. If the baked copy is out of step with `.real`, a PC where the load fails behaves
  differently — check the console for "using baked".
