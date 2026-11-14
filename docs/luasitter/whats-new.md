# What's new in LuaSitter

LuaSitter keeps AVsitter's features and notecard format. This page lists what is different.

## Less load on the simulator

- **Written in SLua.** Scripts run on Second Life's Luau VM instead of LSL/Mono.
- **Fewer scripts.** Scripts that AVsitter split only because of the 64 KB LSL memory limit are merged:
  - `[AV]sitA` + `[AV]sitB` became `[LS]sit`: one script per sitter instead of two.
  - `[AV]root-RLV` + `[AV]root-RLV-extra` became `[LS]root-RLV`.
  - `[AV]prop` + `[AV]sequence` + `[AV]favs` became `[LS]plugins`. Each feature switches on only when the notecards use it, so unused features cost nothing.
  - `[AV]faces` + `[AV]camera` became `[LS]faces-camera`. Cameras still need one copy per sitter (camera control is a permission a script holds for one avatar), but faces no longer need a script of their own.
  - Six utility scripts became two (`LS-setup-checker`, `LS-notecard-tools`).
  - Example: a 2-sitter bed with props, faces, cameras, sequences and favourites uses 10 scripts with AVsitter2 and 5 with LuaSitter2.
- **Fewer link messages.** Messages that only passed data between the merged scripts are no longer sent.
- **Fast notecard loading.** Notecards are read with `ll.GetNotecardLineSync`, which returns cached lines instantly. When the simulator doesn't have the notecard cached yet (it answers `NAK`), the scripts automatically fall back to the classic one-line-per-event `ll.GetNotecardLine`.
- **No blocking sleeps.** No script calls `ll.Sleep`. Every wait that froze a script in AVsitter (DUMP pacing, animation changes, sequence steps, keyframed motion, prop rezzing, RLV role changes, the notecard tools) uses a timer instead, with the same durations and the same order of events.

## New features

- **LuaSitter notecard names.** The pose notecard can be named `LSpos` (preferred for new furniture). `AVpos` is still read when there is no `LSpos`, and the same goes for `[LS]Xcite_settings` / `[AV]Xcite_settings`, `[LS]sequence_settings` / `[AV]sequence_settings` and the `LShipfix` / `AVhipfix` animation. See [Notecard names](migrating-from-avsitter.md#notecard-names).
- **Per-sitter notecards.** A notecard named `LSpos sitter 1`, `LSpos sitter 2`, ... is read as that sitter's section by `[LS]sit`, `[LS]faces-camera` and `[LS]select` (based on AVsitter PR #151). The `SITTER N` line in it is optional. Global settings, `SITTER` lines with genders, PROP, RLV and COMMANDS lines stay in the main `LSpos` or `AVpos`. Names like `LSpos 1` or `AVpos 1` are not read: Second Life gives those names to duplicate copies (for example when a notecard is given to an object that already has one), and `LS-setup-checker` reports them as duplicates to delete.
- **Link message 90032.** Swaps two sitters like 90030, then gives the swapped sitters their menu back (AVsitter issue #140).
- **RLV captives return to their pose** after standing up or logging off (AVsitter PR #149 by Chorazin Allen, with its variable-scope bug fixed and restore attempts capped).
- **No limit of 11 sitters.** Menus that list one button per sitter (seat selection, "Which avatar?" in menu control, the RLV captive menu) are paged with `[<<]` / `[>>]` when there are more sitters than fit in one dialog.
- **Chat commands and arrow keys.** The optional `[LS]commands` plugin lets sitters open menus, swap and change poses with chat commands (for gestures bound to keys), and move their pose with the arrow keys in the adjust menu ([how](commands.md)).
- **Chains by notecard.** The optional `[LS]chains` plugin chains every sitter (LockGuard or LockMeister) from one script, set up in a notecard, with chains on/off from the menu ([how](chains.md)).
- **Options.** The optional `[LS]options` plugin changes textures, colours, lights, glow and sounds per pose or by menu button, for lamps, sheets or music without custom scripts ([how](options.md)).
- **Notecard check.** `LS-setup-checker` has a NOTECARD check that lists, with line numbers, missing animations, bad position lines and other notecard mistakes ([troubleshooting](troubleshooting.md)).
- **Migrating with the updater.** `LS-update-sender` has a Migrate mode that replaces the AVsitter scripts of the furniture around it with LuaSitter scripts, after showing the plan in chat ([how](migrating-from-avsitter.md#migrating-many-objects-with-the-updater)).
- **Clearer RLV menus.** The pose menu button to the RLV menu is "RLV ▸", and the RLV menu has "◂ Poses" to go back. Each RLV menu says whose menu it is, the status (captured, timelock, who holds the menu) and what each button does. Buttons use plain names: "Capture", "Release", "Lock menu" / "Unlock menu" (were "Take Keys" / "Drop Keys"), "Capture new…". LSL plugins still get "Control..." in link message 90100, and the old button names still work.
- **`[FACES]` only when useful.** The `[FACES]` button in the [ADJUST] menu only appears for sitters that have facial expressions (ANIM lines).
- **Reminder about the adjuster.** `[LS]adjuster` tells the creator, every time the object is rezzed, that it is a setup tool to delete before selling if customers should not edit poses (and how: `/5 cleanup`). The [NEW] menu shows the same reminder. Leaving it in is fine: a customer who owns the furniture is told they can use it to adjust, add and save poses.
- **Setup report in chat.** `LS-setup-checker` says its report in chat instead of uploading it, recognises both LuaSitter and AVsitter scripts, and reports mixed setups.

## DUMP

- Prints to chat only. There is no web "Settings copy" link and no settings server.
- Much faster, and the sit scripts stay responsive while it runs (AVsitter issue #109).
- Now also writes KFM, LROT, DFLT, WARN, BRAND, ROLES, ONSIT, the full AMENU value and the RLV plugin's settings, which AVsitter lost on re-dump (AVsitter issue #18).
- Can no longer turn `POSE name|anim` into `POSE|name|anim` after the scripts were copied and pasted: the separator character is written as an escape in the source (AVsitter issues #147 and #152).

## Fixes from AVsitter pull requests and issues

| AVsitter | Fix |
| --- | --- |
| PR #149 | RLV captives restored to their previous pose. |
| PR #158 | Choosing your own seat in `[LS]select` shows the menu instead of swapping with yourself. |
| PR #151 | Per-sitter notecards (named `LSpos sitter N`). |
| PR #78, issues #75, #77 | `[LS]menu` opens the requested submenu for 90004/90005. |
| PR #32, issue #17 | Props that never get attach permission remove themselves after 120 seconds. |
| Issue #18 | RLV settings included in DUMP. |
| Issue #109 | DUMP no longer stalls. |
| Issue #140 | Link message 90032. |
| Issues #147, #152 | Separator character safe from copy/paste. |

Smaller bugs found while porting are fixed as well. Each one is marked with a `-- FIX:` comment in the script source, for example:

- `[LS]sit`: "[SAVE ALL]" deleted the wrong personal positions; an out-of-range sit target number in a prim description corrupted the sit target list.
- `[LS]adjuster`: the camera [CLEAR] skipped the last prim.
- `[LS]root-RLV`: listens leaked on every sit and relay search, eventually hitting the listen limit.
- `[LS]root-control`: sitter buttons were scrambled with more than 3 sitters.
- Favourites (`[LS]plugins`): page buttons counted the wrong list.

## Compatibility

- `AVpos` notecards: unchanged, and still read under the `AVpos` name. `LSpos` is the new, preferred name.
- Link messages: unchanged, plus 90032, the `[LS]commands` messages 90013, 90016, 90017 and 90018, and the messages of the new plugins (90240-90242, 90250). LSL plugins keep working (plugins that ask for a DUMP by script id use the new ids, see [LINK_MESSAGES.md](../../LuaSitter2/LINK_MESSAGES.md)).
- Script names: `[LS]` instead of `[AV]`; see [Migrating from AVsitter](migrating-from-avsitter.md).
