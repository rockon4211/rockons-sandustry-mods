# The git repo, as text (code history)

The whole Material Studio repo — every commit on `master` and
`snapshot/loamcrest-2026-09-20`, 74 commits, both branches — packed into a git
bundle, xz-compressed, base64-encoded and split across the ten
`claude/repo-history/part-NN.txt` docs in this project.

Left out, because they are binary and would not fit: the world saves under
`world-snapshots/` (about 12 MB of .save files), all PNG sprites, and the
`.custommap` file. Everything else — every version of every mod, the Material
Studio tooling, the graph page — is in here with its full history.

## Rebuild it

In a Claude session with a shell, or on any machine with git:

```bash
cat part-*.txt > all.b64            # the ten parts, in order
base64 -d all.b64 | xz -d > material-studio.bundle
sha256sum material-studio.bundle    # expect 6848e5f423d201a2c97f5f68fc767c5a0331a3cedea9a2463bdf6e0dbc08b90e
git clone material-studio.bundle material-studio
cd material-studio
git log --oneline | head            # newest commit: 57d5d64 handoff: sandboxloop 0.4.0, refreshed checksums, sim-loop harness
git branch -a
```

A Claude session reads the parts with `project_read` (each one is written to a
local file it names, since they are large), concatenates those files in order, and
runs the commands above.

## What is in it

Head of master at the time of writing: `57d5d64` — handoff: sandboxloop 0.4.0, refreshed checksums, sim-loop harness

Mod versions on master: sandboxloop 0.4.0, screensaver 0.17.2, manufacturing 0.9.5,
lavaboiloff 0.1.0, quickstart 1.0.0. Branch `snapshot/loamcrest-2026-09-20` is the
frozen map + mods snapshot (its saves are the part left out; they are also in the
`loamcrest-transfer.zip` Brandon has).

The current text of the mods is also in this project as readable docs under
`claude/mods/`, so a chat that only needs to read a mod does not have to rebuild
anything.
