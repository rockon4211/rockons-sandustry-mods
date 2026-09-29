# Lessons learned — the human-readable version

What went wrong along the way, and the rule each one turned into. `CLAUDE.md` at the repo
root says the same things in Claude's terms (with the exact code recipes); this file is for
reading. Updated 2026-09-28.

## Ways of working that stuck
- **The repo is the source of truth; the game's mods folder is just where files get copied.**
  Edit in the clone, verify, copy over, restart the game fully.
- **Manufacturing has two copies of its code.** The `.real` files are the ones to edit; a
  script (`tools/rebuild-manufacturing-stubs.js`) rebuilds the other two. Editing the wrong
  one silently does nothing in the game.
- **Every build shows its number** (a toast or a panel label) so a test can prove which
  build is running. Every change bumps that number.
- **Claude cannot see the game.** It checks that code compiles the way the game loads it,
  runs the test harnesses, and then hands over a short list of what to look for. Anything
  not tested in the game is said so, every time.
- **Nothing is ever numbered by hand.** Materials, terrains and structures get their numbers
  from the game at load, differently on each PC. Everything is stored by name and looked up
  by name.

## Mistakes made once (and what they cost)
1. **The "placeholder" images.** The repo's images were smaller than the installed ones, so
   they were assumed to be broken and replaced. They were identical pixel for pixel; an old
   copy tool had merely re-encoded the installed ones — and the handoff already said so.
   *Rule: read the whole handoff before acting on a difference; compare images by pixels.*
2. **"A new filter building is impossible."** Said with confidence, wrong. The game has an
   API for exactly that; it just wasn't in the first place looked. *Rule: check the engine's
   full API before declaring a limit.*
3. **The Mk.3 that wasn't.** "Identical to the Mk.2 filter but at Mk.2 belt speed" was
   built three times as a speed-up of existing filters before being built as its own
   building. *Rule: restate a feature in one sentence and get a yes before building.*
4. **The overnight stall.** One of those wrong versions sped up every Mk.2 filter in the
   world at once; the factory stopped at 02:41 and the Sources buried the map in soil by
   morning. *Rule: never change how vanilla things behave for everyone; add a new thing or
   an opt-in per thing, and say what a change touches.*
5. **Hard-coded numbers and paths.** A terrain id that only meant something in one save, a
   file path with a user name in it. Both broke on the laptop. *Rule above.*
6. **Tracer grains in the pickers.** The screensaver's invisible helper materials showed
   up in the Matter Gun and the filter lists, and some were left lying on the map. *Rule:
   helper materials are flagged out of every picker, and the map is swept for them on load.*
7. **Menus, the hard way.** Getting a mod panel to look and act like the game's took five
   rounds: it stayed open after the filter was put away, the pick clicks never fired, the
   held tool sat over the picker, the strip spilled across the screen. Each had a one-line
   cause in the game's own code. *Rule: the recipe now lives in `CLAUDE.md`; use it.*
8. **Editing a save file.** Tempting, but the world grid inside a save is packed; the safe
   way is to fix the world from inside the game.
9. **The quicksave surprise.** F10 loads the last F5 quicksave. Anything placed after it
   vanishes, while the mods' own memory of settings doesn't roll back — which looks exactly
   like a mod bug. *Rule: check the reload story before hunting one.*
10. **A test that passed while testing nothing.** *Rule: every harness must fail loudly.*
11. **Second-guessing a safety check.** A check that a grain really appeared was removed on a
    hunch that the game might not show the write yet. The game does, and without the check a
    full material pool means grains get counted that were never made. *Rule: verify a claim
    about the game before removing a check that depends on it.*
12. **A missing setting saved as "off".** The clipboard saved absent liquid/gas flags as
    "off", and pasting that onto a row quietly let liquids and gases straight through.
    *Rule: only write the fields the game's own editor writes; never turn "not set" into "off".*
13. **Putting the tool down closed the row.** The game stops editing a row the moment the
    held tool changes, so the clipboard's "put the tool down, then pick" closed the row being
    edited. *Rule: while the game is editing a row, leave the tool alone.*
14. **Copied the game's filter menu instead of joining it.** The game only shows its filter
    menu for filters on a short list inside its code, so the Mk.3 got a hand-made copy of the
    menu, the labels and the row editor. Every copy behaved a little differently (rows that
    never closed, a menu that started small). The list turned out to be joinable, and the
    Mk.3 now uses the game's real menu. *Rule: when the game already does something for a
    sibling, find how it decides who gets it, and join that before building a copy.*

### 2026-09-28 (second PC; transcript in `transcripts/2026-09-28-session.md`)
15. **Joining the filter lists broke buying the Mk.3.** Lesson 14's trick taught the game's "is
    this in the list?" question that a Mk.3 counts wherever a Mk.2 does — for *every* list. The
    list of unlocked buildings holds the Mk.2, so the game thought the Mk.3 was already unlocked
    and never added it: bought, but missing from the build menu. *Rule: when changing a
    question the whole game asks, limit it to exactly the lists you mean (here: lists made only
    of filters), and check the unlock path.*
16. **The Mk.3 moved on its own schedule.** Per step it moved exactly like the Mk.2 filter, yet
    grains queued in front of it and went through one or two at a time. The game moves all its
    belts in one sweep, far end first, so a stream moves as a block; the Mk.3 had its own
    separate sweep, so the belt feeding it often found its first cell still full. The fix was
    to have the game treat a Mk.3 tile as a Mk.2 belt tile (`blockGridType`), so the game's own
    pass moves it — confirmed in game ("That fixed it"). *Rule: a mod belt should ride the
    game's own belt pass, not a timer of its own.*
17. **Mod panels vanish when the HUD is hidden.** Everything added with `api.ui.inject` lives in
    a layer the game doesn't draw while the HUD is off — and the screensaver always hides the
    HUD, so its label never showed. *Rule: to show something during the screensaver, put a
    plain element on the page yourself.*
18. **A look-alike material is still a different material.** The screensaver's copy of copper
    reacts like copper, but every filter compared material numbers and sent the copy another
    way. *Rule: anything that checks a material by number (filters, lists, masks) sees a copy
    as something else — handle it where the check happens.*
19. **"The tracker" meant something specific.** Three things could have been called that (a debug
    box, the screensaver's stats panel, the bright copy). Asking with a short choice got the
    right one first time; guessing had already produced one unwanted feature (the Inspect box,
    added and removed the same evening). *Rule: when a word could mean several things, ask.*
20. **The first idea for a fix wasn't the only one.** "Hand the grain back at filters" or
    "teach every filter" were offered; Brandon's own suggestion — fake the number only where
    filters look — was better than both. *Rule: lay out the options plainly; the player often
    sees the simplest one.*

## Making a menu that fits the game (in words)
- First ask whether the game's own menu can serve it (see lesson 14). Only build one when it can't.
- Put it where the game puts its own: in the band above the hotbar, appearing only while
  the matching thing is in hand — decided by asking the game what's in hand, not by
  guessing from one field.
- Use the game's own styling classes so it looks identical: the black translucent box, the
  same buttons, the same yellow for "selected", green for allow, red for block, the same
  material chips with a colour swatch and a checkbox.
- Keep the main panel the game's size (640 wide) and anything beside it to one narrow line.
- Use the game's own text where it has some (allow, block, editing, minimize, the tab names).
- Copy the game's behaviour too, not just its look: the Mk.2 menu opens expanded when you
  pick the filter up, rows open from their labels only while a filter is in hand, putting
  the filter away closes everything, and Esc cancels an edit first. (The Mk.3 once let you
  click the placed belt with an empty hand, and that edit never closed.)
- A labels overlay draws a box and a caption over each row, positioned with the same
  camera maths the game uses, so it tracks panning and zooming.
- Anything that picks from the map puts the held tool down first and hands it back after.

## What still needs a look
See "Open issues" in `handoff.md`. As of 2026-09-28: the Filter Mk.3 now moves right (confirmed);
not yet seen in game are the screensaver's filter override (a copper copy following real copper's
path through filters), the tracer sweep message after a world load, and the Sandbox Loop's
per-row editing.
