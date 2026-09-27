# Mod file checksums — main, 5b84490, 2026-09-27

Versions: sandboxloop 0.4.6, screensaver 0.18.3, manufacturing 0.16.0, lavaboiloff 0.1.1, quickstart 1.0.2, improvedfilters 0.3.0.
All 25 installed files; every hash is of the file at the commit named in the title, which is
the mod content now on `main` (later commits only touch docs). Regenerate after changing a mod.
Hashes are of the files as stored in git (LF line endings). A clone with core.autocrlf=true checks
text files out with CRLF, so hash those after converting, or compare with `git hash-object`.
`mods/README.md` is left out on purpose (it is documentation, not an installed file), so a
listing of an install has one file fewer than the repo folder.

## How to regenerate (after committing, so the header can name the commit)

From the repo root in Git Bash (the header names the CURRENT branch, not `main`):

```bash
H=$(git rev-parse --short HEAD); B=$(git rev-parse --abbrev-ref HEAD)
( echo "# Mod file checksums — $B, $H, $(date +%F)"; echo;
  echo '```'; git ls-tree -r --name-only HEAD mods | grep -v README | sort | while read p; do echo "$(git show HEAD:"$p" | sha256sum | cut -d' ' -f1)  ${p#mods/}"; done; echo '```' ) > /tmp/sums.md
```

then paste the block over the placeholder below and keep the sections after it.
On Windows without Git Bash: `certutil -hashfile <file> SHA256` per file.
To compare an install, run the same `find … | xargs sha256sum` inside
`%APPDATA%\sandustry\mods\` (Git Bash: `cd "$APPDATA/sandustry/mods"`).

```
15904050cec367a3c67f55ea92d4c10de589df17850d0a9456249d100bc1169f  improvedfilters/main.js
8fd9641c4bd50a50f6d85b3d24f4f35bb34e6df085053019184b5f5dee844b8f  improvedfilters/modinfo.json
b77d7dbf8f5d674034316ff9af034f1da170dad21f4bcdf12c63540916c1c653  lavaboiloff/main.js
311973d685f93b75546a1af856febf8a8e293bc8e6d1b98da2c616459b436509  lavaboiloff/modinfo.json
1e4b15b61a5006819fc8d69eeca740b230348493f97440d081812ed1c29e9fcd  lavaboiloff/worker.js
ff36b12798a7aa8d6983f2c165326ddb38391d218443498bc07cd9ab31c935cc  manufacturing/filter_left_mk3.png
9bf29fe79ee1c8870df691face431ddd948c2af078fa7524a32a7535c52c5b3e  manufacturing/filter_right_mk3.png
a1892bb6800e009d55067a7ca5713ff35001b93a0576eddfdb5408ef34a31bba  manufacturing/main.js
31a052b721641d4e290dce8317c02e7f21289989e4799d286455006a0d68fffc  manufacturing/main.real.js
c124677898beaa9861eaedc1dc18d3fca47441be87e5476f412d8bcf5905d1df  manufacturing/matter_gun.png
c124677898beaa9861eaedc1dc18d3fca47441be87e5476f412d8bcf5905d1df  manufacturing/matter_gun_icon.png
b75c57f00149fbcfb64945953a3435ad25055d2f498f80d8b8681a9785da5569  manufacturing/modinfo.json
bb6b7ac569af46b8b32072d79df284210d4f8b70e5a84ffa0407fac9c1475189  manufacturing/preview.png
8018d0144f77848af41857926ed3d93d02d0db2a5482c9ef37b590839876c1f6  manufacturing/worker.js
b5d6484016e77e14a2650302ea7da93e24213a94e7b87e0fef8facc00965310a  manufacturing/worker.real.js
f4aba9709ca13335204debbc2a30cdf48158b7120f74e7ed0fe8dca740ae2287  quickstart/main.js
01c53d5949444b4b00ab65e90c51db5b1c596067467d73b04e9459089ff0b916  quickstart/modinfo.json
93da1be7de59ea4f5db0384e5d83098567fbdf5e9f75ca92f20ee2c0a05708b2  quickstart/preview.png
9bc16a7b1491fc14ec0d3689475113c41e3fe8c412d9271608d2cc5e550d5798  sandboxloop/main.js
c67969b7ba30cb5a1f8967aebd2571d31cfa2945b7bed51623c4f0b4647f22d8  sandboxloop/make-sprites.js
698edfb72208907cfcf5d1cf8555c13bb8ae9be0d96c7e73b33531a21bea1b61  sandboxloop/modinfo.json
d03eb83fbe5c5aba303955cdd28dfe08fcdfc9089a18fd5117b57cbf529b703a  sandboxloop/sink.png
2fcbee7b58f45f11f52db540b59894490f89bfa6096a1abcf0c1e7aea0d54d18  sandboxloop/source.png
46134abbe4a18ee4f6c5e9ae5d856d8eabbb234ce15f3ef4da9d4d89a54001ac  screensaver/main.js
10c029567f7fa0d1fa3cab10229b7119408297b7e3c8cecfe38f06ac5ae9ce60  screensaver/modinfo.json
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
