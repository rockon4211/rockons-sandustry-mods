# Mod file checksums — master, 617f2d6, 2026-09-23

sha256 of every file in the repo's `mods/` on branch master. Any PC running these
mods should match exactly. On Windows: `certutil -hashfile <file> SHA256`, or in PowerShell
`Get-FileHash -Algorithm SHA256 <file>`. From a Claude session with a bridge:
`cd "$HOME/mnt/sandustry/mods" && find . -type f | sort | xargs sha256sum`.

```
16180eed16e991fc0155b695cb7b6fa927ce61952b8941ce36b16fa43b195118  README.md
b9bb9e7c4dcd2f3f34698c83540da6c0034e92f59fa31d8ae190e840ef6e4d31  lavaboiloff/main.js
ebb8b12bfbcf4d4c78785d3a45c8713163837323ccfcddec8588c3be29f267ff  lavaboiloff/modinfo.json
3f4b7a7efb671385c66e19993874197bc575a2e48fc9971ebcab6489a7eabba7  lavaboiloff/worker.js
b90ee3c9febb6ac224797d8ecd8dfc88385e0bed44f592e67b7e11cb97f9ecec  manufacturing/main.js
daf378e05db2b3179a1c4e98986cd6bfca354eae1f7ec609ed8a43733360cd69  manufacturing/main.real.js
882a3af1c3a2b06c914529fa56a5fab54cb23b585f2495f77bdbe40685946242  manufacturing/main.real.json
c124677898beaa9861eaedc1dc18d3fca47441be87e5476f412d8bcf5905d1df  manufacturing/matter_gun.png
c124677898beaa9861eaedc1dc18d3fca47441be87e5476f412d8bcf5905d1df  manufacturing/matter_gun_icon.png
57747e356b32b10f06815d40a377db36fb5b4373dc1f4fe942b154fe335b3972  manufacturing/modinfo.json
bb6b7ac569af46b8b32072d79df284210d4f8b70e5a84ffa0407fac9c1475189  manufacturing/preview.png
6175e1b1d56bc1e88018760597160c900b18f3bff7b025b26503f0da2aeb9ff7  manufacturing/worker.js
f98d4b2ca0b99242f3da22f22018bd0aa6fad8d0310b56c9c9ff60722acb688e  manufacturing/worker.real.js
3c11d6119983d114441475686e40fe874a600ed706a8a284b1d64540c2197bab  quickstart/main.js
511952cc3b60ee7b8f8bbf68ad4ec3d5cc75120db5ce717e3aa07bb15798ae93  quickstart/modinfo.json
93da1be7de59ea4f5db0384e5d83098567fbdf5e9f75ca92f20ee2c0a05708b2  quickstart/preview.png
476154cbfc6c89a5137a287f8b4d2c9e0ee96ed3fd4168523060686805aaa09c  sandboxloop/main.js
9799f426bbb9991dabd5eed0f5b47ed20847363ccb1e3feb083119bf512bd085  sandboxloop/make-sprites.js
e53894f863720d6dc5e884522d04bdd90a50e78bd8d0d248c6b86387ada7cb3c  sandboxloop/modinfo.json
d03eb83fbe5c5aba303955cdd28dfe08fcdfc9089a18fd5117b57cbf529b703a  sandboxloop/sink.png
2fcbee7b58f45f11f52db540b59894490f89bfa6096a1abcf0c1e7aea0d54d18  sandboxloop/source.png
24e57df1496798cd4b80a300d6218c9e27d299f62d7f7e13f23374c337465244  screensaver/main.js
dfd4803c71b78672bfb40da7d93705879a6b9299801c1aeff3f1acecf64ac86c  screensaver/modinfo.json
```

Versions that go with these hashes: sandboxloop 0.3.1, screensaver 0.17.2,
manufacturing 0.9.5, lavaboiloff 0.1.0, quickstart 1.0.0.

Note on the PNGs: the device bridge re-encodes images on write, so a PNG copied to a PC
through it will NOT match the hash above even though it is pixel-identical. Only the .js
and .json files are expected to match byte for byte. Compare those and check the PNGs by
eye (or by pixel comparison) if it matters.

Also worth checking on any PC, because they are not in the mods folder:
- `%APPDATA%\sandustry\meta\settings.json` → `externalModSettings` holds each mod's
  settings. Different settings can make identical mods behave differently. The
  screensaver's renamed options (`rideLimitSeconds`, `tourStops`) will be absent until
  changed on that PC, which is fine — the new defaults then apply.
- Which mods are ENABLED in the game's mod menu. The rename of vanilla sand to "soil"
  and the new golden Sand element both come from the Manufacturing mod; with it off or
  failing to load, the world reverts to vanilla names and materials.
- Leftovers: a retired `mods\workshop` folder, or an old `glassworks` mod, will still
  load and register elements if present.
