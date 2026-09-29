# World snapshot — 2026-09-28 (Loamcrest, `28lnrdm8fhv`)

The Loamcrest world as it stood at the end of the 2026-09-28 session, taken from the game's save
folder while it was running (every file was checked to decode: JSON header + gzip body).

| File | Saved | What |
| --- | --- | --- |
| `28lnrdm8fhv-autosave-2.save` | 22:12 | newest — the canonical snapshot |
| `28lnrdm8fhv-quicksave.save` | 22:06 | F5 quicksave (what Quick Start's F10 loads) |
| `h7jci68hi7.save` | 22:06 | newest manual save of this world |
| `28lnrdm8fhv-autosave-1.save` | 22:04 | autosave |
| `28lnrdm8fhv-autosave-3.save` | 21:59 | autosave |

State: Filter Mk.3 researched and unlocked, 17 Mk.3 placed (Manufacturing 0.16.2); mods as on
`main` at this commit (Sandbox Loop 0.4.9, Screensaver 0.19.0, Manufacturing 0.16.2, Improved Filter
Options 0.3.0, Lava Boil-Off 0.1.1, Quick Start 1.0.2).

Restore: copy the `.save` files into `%APPDATA%\sandustry\saves\` (the game lists them under the
world). Mod-side state (Sandbox Loop totals/history, panel settings) lives in the game's
localStorage, not in these files.
