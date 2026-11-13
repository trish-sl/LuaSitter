# Release notes

## LuaSitter 3.0-lua1 (unreleased)

First release of LuaSitter: a rewrite of AVsitter2 and AVsitter1 in SLua (Second Life's Lua). It is based on the AVsitter source code as of AVsitter `2.2p04` (development after release 2.2-03.01, including link message 90015). These notes list what is new, changed or fixed compared to AVsitter.

### Highlights

- All AVsitter2 and AVsitter1 scripts, plugins and utilities ported to SLua. Scripts are named `[LS]...` instead of `[AV]...`.
- AVpos notecards are 100% compatible, and the link message API is unchanged, so LSL plugins keep working.
- Fewer scripts:
  - `[AV]sitA` + `[AV]sitB` merged into `[LS]sit` (one script per sitter instead of two);
  - `[AV]root-RLV` + `[AV]root-RLV-extra` merged into `[LS]root-RLV`;
  - `[AV]prop` + `[AV]sequence` + `[AV]favs` merged into `[LS]plugins`;
  - `[AV]faces` + `[AV]camera` merged into `[LS]faces-camera` (one copy per sitter that needs a camera);
  - six utilities merged into `LS-setup-checker` and `LS-notecard-tools`.
- Faster notecard loading.
- No blocking waits (`llSleep`): scripts stay responsive while they wait.
- Migrate existing AVsitter furniture to LuaSitter with `LS-update-sender`.

### New

- LuaSitter notecard names: `LSpos`, `[LS]Xcite_settings`, `[LS]sequence_settings` and the `LShipfix` animation. The AVsitter names (`AVpos`, `[AV]Xcite_settings`, `[AV]sequence_settings`, `AVhipfix`) are still read when the LuaSitter name is absent.
- Per-sitter notecards named `LSpos sitter N` (based on AVsitter PR #151). For that sitter, the per-sitter notecard replaces their section of the main notecard. Names like `LSpos 1` / `AVpos 1` are not read, because Second Life gives those names to duplicate copies.
- `LS-update-sender` Migrate mode: replaces the AVsitter scripts of the furniture around the sender with their LuaSitter versions (copies keep their number), after saying the plan in chat and asking APPLY. Notecards, props and other scripts are kept; a prim is only changed when every new script arrived.
- `[LS]commands` plugin (optional): chat commands for sitters on channel 1888 (or `COMMANDS <channel>`), for gestures: menu, adjust, keys, swap, next, prev, rlv, help. Also arrow-key pose adjusting (0.01 m / 1° per press; Shift + Left / Right turn the pose) with a "Keys" button in the personal adjust menu. Commands follow `[LS]root-security` menu access, RLV roles, AMENU and SWAP. New link messages 90013, 90016, 90017, 90018.
- Link message 90032: swap sitters and return to the menu (AVsitter issue #140).
- RLV captives return to their previous pose (AVsitter PR #149 by Chorazin Allen).
- Clearer RLV menus: "RLV ▸" in the pose menu and "◂ Poses" in the RLV menu move between the two; every RLV menu says whose menu it is, the status and what each button does; plain button names ("Capture", "Release", "Lock menu"/"Unlock menu", "Capture new…"). The AVsitter names still work, and 90100 still carries "Control...".
- More than 11 sitters: menus with one button per sitter are paged with `[<<]` / `[>>]` when they don't fit in one dialog (seat menus, the "Which avatar?" menu and the RLV captive menu).
- DUMP includes RLV settings (AVsitter issue #18) and the KFM, LROT, DFLT, WARN, BRAND, ROLES, ONSIT and full AMENU settings.
- `LS-setup-checker` recognises LuaSitter and AVsitter scripts, reports mixed setups, says which pose notecard is in use and warns when both `LSpos` and `AVpos` are present.
- The `[FACES]` adjust button only appears for sitters that have ANIM lines.

### Changed

- `[LS]adjuster` may stay in sold furniture: a customer who owns it is told they can use it to adjust, add and save poses. The creator is reminded on every rez (and in its [NEW] menu) to delete it before selling if customers should not edit poses.
- DUMP and the `[LS]menu` readout say which notecard to paste into (`LSpos`, or `AVpos` when that is the notecard in use).
- DUMP, the setup report and the notecard shifter print to chat only. The web "Settings copy" upload was removed.
- Changing the AVpos or sequence notecard reloads `[LS]plugins` as a whole: props are removed first (as `[AV]prop` did on an AVpos change) and favourites, which are kept in memory only, are cleared.
- DUMP plugin ids are now `[LS]plugins`, `[LS]faces-camera` and `[LS]root-RLV` (link message 90020). LSL plugins that used `[AV]prop`, `[AV]faces` or `[AV]camera` as DUMP ids must use these.
- Saving a camera for sitter N from the adjuster needs the `[LS]faces-camera N` copy (as `[AV]camera N` before).
- `LS-update-sender`:
  - touching it gives an Update / Migrate / Range menu (AVsitter: touching started the update);
  - range: 10 m, 20 m, Shout 100 m (the default), Region, or Prim size (AVsitter: half the sender's X size, at most 20 m). A small sender box now reaches the furniture around it. Region names the objects found and asks before updating;
  - furniture that answers late is no longer missed: it asks again and waits until the answers stop (AVsitter asked once and often reported "Found 0 prims");
  - after an update it asks REMOVE / KEEP for the update receivers of the prims it changed (AVsitter kept them).
- `LS-update-receiver` no longer labels the furniture with its name as hover text; set `show_name = true` in the script for the old shop label.

### Fixed (AVsitter bugs)

- The update receiver left its name label (hover text) on the furniture when it removed itself, so sold copies kept it.
- `[LS]menu` prop chooser and `[LS]adjuster` animation/prop/face chooser: with several long names no chooser appeared (the dialog text went over Second Life's 512-byte limit).
- `[LS]Xcite!`: an `XCITE *|<sitter>|...` line, the default for all poses of one sitter, was ignored.
- `[LS]select`: choosing your own seat no longer swaps you with yourself (AVsitter PR #158).
- `[LS]menu`: 90004/90005 open the requested submenu (AVsitter PR #78, issues #75 and #77).
- `[LS]object`: props that never get attach permission remove themselves after 120 seconds (AVsitter PR #32, issue #17).
- DUMP no longer stalls (AVsitter issue #109) and is safe from copy/paste damage to the separator character (issues #147, #152).
- `[LS]root-RLV`: time added in the Timelock menu now counts down when the furniture has no `TIMELOCK` line (it stayed frozen until Stop / Start).
- `[LS]root-RLV` Un/Dress > Browse #RLV: a folder with a long non-ASCII name made the whole menu fail.
- `[LS]sit`: a pose added from the helper whose name already exists later in the menu saved its position on the wrong entry.
- Many smaller bugs; see [What's new](luasitter/whats-new.md) and the `-- FIX:` comments in the scripts.

### Removed

- `[AV]sitB`, `[AV]root-RLV-extra`, and separate prop, sequence, favourites, faces and camera scripts (merged).
- Link messages 90299 and 90302 (were internal between `[AV]sitA` and `[AV]sitB`).
- The settings dump web service (`php/`).

## AVsitter history

LuaSitter builds on AVsitter's history:

- AVsitter releases: [github.com/AVsitter/AVsitter/releases](https://github.com/AVsitter/AVsitter/releases)
- Earlier AVsitter2 box release notes: [avsitter.github.io/updates.html](https://avsitter.github.io/updates.html)
