# The git repo, as text (code history)

The repo's history — every commit on `main` and `snapshot/loamcrest-2026-09-20`, plus the
tag `loamcrest-2026-09-20`, 147 commits — packed into a git bundle, xz-compressed,
base64-encoded and split across the ten `chunks/repo-history-part-NN.txt` files (mirrored
as `claude/repo-history/part-NN.txt` in the claude.ai project).

Regenerated 2026-09-27 from `main` at `f319d3e` (GitHub `main` after the 2026-09-27 push:
the audit round, Manufacturing up to 0.16.0 with the Filter Mk.3 on the game's own filter
menu, Improved Filter Options 0.3.0, Screensaver 0.18.3, Sandbox Loop 0.4.6, `CLAUDE.md`).
Commits after that (this regeneration itself, later work) are not in it — regenerate after
later pushes and update the head commit / counts here.

**The binaries are stripped, so commit hashes differ from GitHub.** To keep it small the
history was rewritten (in a throwaway clone) to drop the world saves under
`world-snapshots/`, the chunks themselves (`.handoff/chunks/`, `claude/repo-history/` — old
chunks inside new ones doubled the size) and every `.png`, `.save`, `.custommap` and `.zip`. Every other file and
every commit message/date is identical, but the ids are not: GitHub `f319d3e` is `c84e160`
here, the snapshot commit `7d2489d` is `e7516a8`. Match commits by message, not by hash.
Always prefer cloning GitHub; this is the fallback when GitHub is unreachable.

## Rebuild it

```bash
cat chunks/repo-history-part-*.txt | tr -d '\r' > all.b64   # the ten parts, in order (strip CRLF from a Windows checkout)
base64 -d all.b64 | xz -d > material-studio.bundle
sha256sum material-studio.bundle   # expect d487c594eddef5ca183decbd34c1be7bee61b444c17c95bff262ef9df1337d1a
git clone material-studio.bundle material-studio
cd material-studio
git log --oneline | head           # newest commit: c84e160 handoff: status for the push to main - ...
git branch -a                      # main, origin/snapshot/loamcrest-2026-09-20; tag loamcrest-2026-09-20
```

Binaries are in `binaries.md` / `repo-binaries.md` (see the stale note there), the saves in
`loamcrest-transfer.zip` and on both PCs.

## Regenerate it (from a clone of the real repo, with git, xz, base64, split)

Nothing here touches the real clone: everything happens in a scratch bare clone.

```bash
REPO=/path/to/rockons-sandustry-mods; OUT=$(mktemp -d)
git clone -q --bare "$REPO" "$OUT/strip" && cd "$OUT/strip"
git update-ref refs/heads/snapshot/loamcrest-2026-09-20 'loamcrest-2026-09-20^{commit}'
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/ | grep -vx -e main -e snapshot/loamcrest-2026-09-20); do git update-ref -d refs/heads/$b; done
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --index-filter \
  'git rm -r --cached --ignore-unmatch -q world-snapshots .handoff/chunks claude/repo-history >/dev/null; git ls-files -z | grep -zE "\.(png|custommap|save|zip)$" | xargs -0 -r git rm --cached -q >/dev/null' \
  --tag-name-filter cat -- main snapshot/loamcrest-2026-09-20
git symbolic-ref HEAD refs/heads/main
git bundle create ../ms.bundle HEAD refs/heads/main refs/heads/snapshot/loamcrest-2026-09-20 refs/tags/loamcrest-2026-09-20
cd .. && xz -9e -c ms.bundle | base64 -w120 > all.b64
split -l $(( ($(wc -l < all.b64) + 9) / 10 )) -d -a 2 --additional-suffix=.txt all.b64 repo-history-part-
sha256sum ms.bundle      # put this, the head commit and the counts into this README
```

Then copy the ten `repo-history-part-NN.txt` files into `.handoff/chunks/`, round-trip them
once with the Rebuild commands above, and update this README.

The current text of the mods is also in the claude.ai project as readable docs under
`claude/mods/`, so a chat that only needs to read a mod does not have to rebuild anything.
