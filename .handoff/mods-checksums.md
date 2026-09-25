# Mod file checksums — main, bf5601a, 2026-09-25

Versions: sandboxloop 0.4.5, screensaver 0.18.2, manufacturing 0.15.3, lavaboiloff 0.1.1, quickstart 1.0.1, improvedfilters 0.2.3.
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
4a05e00227d0733dec1c6ef98c3481c444bc1a07f849eb07c169edd6f8992c9e  improvedfilters/main.js
bd608c1af91a02ade94e45fc33f6fe6ad3528f0783d7b190fbb1400bb93716aa  improvedfilters/modinfo.json
b77d7dbf8f5d674034316ff9af034f1da170dad21f4bcdf12c63540916c1c653  lavaboiloff/main.js
311973d685f93b75546a1af856febf8a8e293bc8e6d1b98da2c616459b436509  lavaboiloff/modinfo.json
1e4b15b61a5006819fc8d69eeca740b230348493f97440d081812ed1c29e9fcd  lavaboiloff/worker.js
ff36b12798a7aa8d6983f2c165326ddb38391d218443498bc07cd9ab31c935cc  manufacturing/filter_left_mk3.png
9bf29fe79ee1c8870df691face431ddd948c2af078fa7524a32a7535c52c5b3e  manufacturing/filter_right_mk3.png
86f72836a83ade488204a8378831d04f1fe35032defe57d2a1573024d7f1ea68  manufacturing/main.js
1208910a22f60789605ef32073027844515876c29b16dc1c1a72c067e2d7f8aa  manufacturing/main.real.js
c124677898beaa9861eaedc1dc18d3fca47441be87e5476f412d8bcf5905d1df  manufacturing/matter_gun.png
c124677898beaa9861eaedc1dc18d3fca47441be87e5476f412d8bcf5905d1df  manufacturing/matter_gun_icon.png
7515b85fb69a87af2ffab91f48d321a64443a9b633958f1a34c1ae511652d39d  manufacturing/modinfo.json
bb6b7ac569af46b8b32072d79df284210d4f8b70e5a84ffa0407fac9c1475189  manufacturing/preview.png
8018d0144f77848af41857926ed3d93d02d0db2a5482c9ef37b590839876c1f6  manufacturing/worker.js
b5d6484016e77e14a2650302ea7da93e24213a94e7b87e0fef8facc00965310a  manufacturing/worker.real.js
6d4f399c4dffcecd3c0a94738438a2d76cd9b438135ea5c3bae94b938871a4cf  quickstart/main.js
cbe98a26414ea9cdeca5a1739a8900e1a798d274084370ca45ecfd730b34ab4e  quickstart/modinfo.json
93da1be7de59ea4f5db0384e5d83098567fbdf5e9f75ca92f20ee2c0a05708b2  quickstart/preview.png
eaff15b33cde35d7f23e1f7015b1d11fdb3091d7e12494709bc33c8c719c759a  sandboxloop/main.js
c67969b7ba30cb5a1f8967aebd2571d31cfa2945b7bed51623c4f0b4647f22d8  sandboxloop/make-sprites.js
9d4c9c4be1b51a356ac37df27fefb30901722fe780b470c7c48463f1ff19299f  sandboxloop/modinfo.json
d03eb83fbe5c5aba303955cdd28dfe08fcdfc9089a18fd5117b57cbf529b703a  sandboxloop/sink.png
2fcbee7b58f45f11f52db540b59894490f89bfa6096a1abcf0c1e7aea0d54d18  sandboxloop/source.png
897a07aeab82d48bd5aa683cc9840bf7504ef3986be6a19ffda9d1fc7d0ad381  screensaver/main.js
903f43518ef149b4646fc042f52b94b614eea16c230adcfe7d4aa6af9b52c656  screensaver/modinfo.json
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
