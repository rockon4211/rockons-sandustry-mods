# Mod file checksums — main, e62b809, 2026-09-23

Versions: sandboxloop 0.4.3, screensaver 0.18.1, manufacturing 0.12.1, lavaboiloff 0.1.1, quickstart 1.0.1.
Hashes are of the files as stored in git (LF line endings). A clone with core.autocrlf=true checks
text files out with CRLF, so hash those after converting, or compare with `git hash-object`.

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
b77d7dbf8f5d674034316ff9af034f1da170dad21f4bcdf12c63540916c1c653  lavaboiloff/main.js
311973d685f93b75546a1af856febf8a8e293bc8e6d1b98da2c616459b436509  lavaboiloff/modinfo.json
1e4b15b61a5006819fc8d69eeca740b230348493f97440d081812ed1c29e9fcd  lavaboiloff/worker.js
1e5a99a17d44467ccd0f4f45923c5e6bed71ea3654873fcccf00323deccc511f  manufacturing/main.js
d72bcbb92060d85a4b86a99d0e0b14409233e36fe6d928b7a587b54ffe2337e2  manufacturing/main.real.js
c124677898beaa9861eaedc1dc18d3fca47441be87e5476f412d8bcf5905d1df  manufacturing/matter_gun.png
c124677898beaa9861eaedc1dc18d3fca47441be87e5476f412d8bcf5905d1df  manufacturing/matter_gun_icon.png
eb5c9605fae77ae95117c7572146fb0008989398caae130d303ef6d70a94d6f7  manufacturing/modinfo.json
bb6b7ac569af46b8b32072d79df284210d4f8b70e5a84ffa0407fac9c1475189  manufacturing/preview.png
b9c4e9343fa937d48ad69555d4dd79a65fbead6249b5e6459ad67e87f946bf72  manufacturing/worker.js
d2ada6a4c01c2438a5b8f8a472d9b59ae15ece21c03b195b54b6775532944d8d  manufacturing/worker.real.js
6d4f399c4dffcecd3c0a94738438a2d76cd9b438135ea5c3bae94b938871a4cf  quickstart/main.js
cbe98a26414ea9cdeca5a1739a8900e1a798d274084370ca45ecfd730b34ab4e  quickstart/modinfo.json
93da1be7de59ea4f5db0384e5d83098567fbdf5e9f75ca92f20ee2c0a05708b2  quickstart/preview.png
09dfeab0fb2939bbdb395fe9d93bc51e1dc209f886efd9e6f3375f597c542667  sandboxloop/main.js
c67969b7ba30cb5a1f8967aebd2571d31cfa2945b7bed51623c4f0b4647f22d8  sandboxloop/make-sprites.js
ae471362c32897f935439fed70296c7694bdfbb95adab756a434811f1fe50805  sandboxloop/modinfo.json
d03eb83fbe5c5aba303955cdd28dfe08fcdfc9089a18fd5117b57cbf529b703a  sandboxloop/sink.png
2fcbee7b58f45f11f52db540b59894490f89bfa6096a1abcf0c1e7aea0d54d18  sandboxloop/source.png
3ba37c94226cc7a2ec360f39444ae318f52d194e415e35770ad97ba6396a2293  screensaver/main.js
8ff452dfdd52a0ee911f3af8068d52f5e002b0f5c027739662a48125359caa7d  screensaver/modinfo.json
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
