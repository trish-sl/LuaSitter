# Migrating from AVsitter

LuaSitter uses the same `AVpos` notecards and the same link messages as AVsitter, so moving a piece of furniture over is mostly a matter of swapping scripts.

## Steps

1. Take a copy of the furniture first.
2. Remove every AVsitter script (`[AV]...`) from the object. Do not mix AVsitter and LuaSitter scripts in the same prim: they find each other by name.
3. Add the LuaSitter scripts listed below. Create each one in-world with the exact name, choose **Lua** in the script editor's compiler drop-down, and paste the `.luau` code.
4. Keep your `AVpos` notecard and any other notecards as they are. Renaming `AVpos` to `LSpos` is optional (see [Notecard names](#notecard-names)).
5. In props, replace `[AV]object` with `[LS]object` when convenient. Old props with `[AV]object` keep working with `[LS]plugins`.
6. Sit and test every sitter, pose and prop.

## Migrating many objects with the updater

`LS-update-sender` has a **Migrate** mode that does steps 2 and 3 for every piece of furniture around it. It needs an update receiver (`update receiver (auto removing)`) in each prim that holds AVsitter scripts. AVsitter furniture often has the LSL one already; otherwise drop in the LuaSitter one (`LS-update-receiver`, which must be named `update receiver (auto removing)` in inventory).

1. Put in a sender prim: `LS-update-sender`, the LuaSitter `update receiver (auto removing)`, and every LuaSitter script the furniture needs, with its copies (`[LS]sit`, `[LS]sit 1`, ..., `[LS]faces-camera 1`, ...). These scripts must not be running.
2. Take a copy of the furniture and rez it near the sender: within 100 m by default. Touch the sender and choose **Migrate**. **Range** in the same menu sets how far the sender looks: 10 m, 20 m, Shout 100 m, Region, or Prim size (half the sender's X size, as in AVsitter). Only furniture you own answers.
3. The sender puts its LuaSitter receiver in prims that have another one (an LSL receiver cannot delete scripts), then says the plan in chat for each prim: the scripts it removes, adds and keeps, and any script the sender lacks (that prim is then skipped). Nothing else is changed yet.
4. Choose **APPLY**. For each prim, the sender loads the LuaSitter scripts (not running); then the receiver deletes the AVsitter scripts and starts the new ones, but only if every new script arrived. If one is missing, nothing is deleted in that prim.

The script names follow the table below; copies keep their number (`[AV]sitA 2` becomes `[LS]sit 2`, `[AV]camera 1` becomes `[LS]faces-camera 1`). AVsitter1 scripts become their LuaSitter1 versions (`AVsit` becomes `LSsit`). Notecards, objects (props) and other scripts are never touched, so the `AVpos` notecard and props with `[AV]object` keep working. Values kept only in memory (personal adjustments not saved to the notecard, favourites) are lost, as with any script reset.

The receiver only deletes known AVsitter script names and only starts known LuaSitter ones. At the end, the sender asks whether to **REMOVE** the receivers or **KEEP** them for later updates. A kept receiver removes itself when the furniture is sold or rezzed with a start parameter (for example by a rezzer). When the LuaSitter receiver removes itself, it also clears the name label (hover text) that the AVsitter receiver put on the furniture.

## Script names

| AVsitter2 | LuaSitter2 | Notes |
| --- | --- | --- |
| `[AV]sitA` + `[AV]sitB` | `[LS]sit` | One script per sitter instead of two. Copies: `[LS]sit 1`, `[LS]sit 2`, ... |
| `[AV]adjuster` | `[LS]adjuster` | DUMP prints to chat only. Reminds the creator on every rez that it can be deleted before selling; it may also stay for customers to adjust poses. |
| `[AV]helper` object with `[AV]helperscript` | `[LS]helper` object with `[LS]helperscript` | An existing `[AV]helper` object still works. |
| `[AV]select` | `[LS]select` | |
| `[AV]root` | `[LS]root` | |
| `[AV]root-security` | `[LS]root-security` | |
| `[AV]prop` + `[AV]sequence` + `[AV]favs` | `[LS]plugins` | One script for props, sequences and favourites. Reads `[LS]sequence_settings` or `[AV]sequence_settings`. |
| `[AV]object`, `[AV]menu` | `[LS]object`, `[LS]menu` | |
| `[AV]faces` + `[AV]camera` (+ copies) | `[LS]faces-camera` (+ copies) | One copy per sitter that needs a camera (`[LS]faces-camera 1`, ...). For faces only, one copy is enough. |
| `[AV]root-RLV` + `[AV]root-RLV-extra` | `[LS]root-RLV` | One script instead of two. |
| `[AV]root-control` | `[LS]root-control` | |
| `[AV]LockGuard`, `[AV]LockGuard-object`, `[AV]LockMeister`, `[AV]Xcite!` | `[LS]LockGuard`, `[LS]LockGuard-object`, `[LS]LockMeister`, `[LS]Xcite!` | Xcite reads `[LS]Xcite_settings`, or `[AV]Xcite_settings`. |
| Anim-perm-checker, Missing-anim-finder, Noob-detector | `LS-setup-checker` | One utility with a menu. |
| AVpos-generator, AVpos-shifter, MLP-converter | `LS-notecard-tools` | One utility with a menu. |
| update-sender, update-receiver | `LS-update-sender`, `LS-update-receiver` | |

For AVsitter1, the scripts are renamed from `AV...` to `LS...` (for example `AVsit` to `LSsit`); see [LuaSitter1/README.md](../../LuaSitter1/README.md).

## Notecard names

LuaSitter has its own names for notecards and the hip fix animation, and still reads the AVsitter names, so existing content works without changes:

| LuaSitter name (preferred) | AVsitter name (still read) |
| --- | --- |
| `LSpos` | `AVpos` |
| `LSpos sitter 1`, `LSpos sitter 2`, ... (per-sitter, optional) | (none: AVsitter has no per-sitter notecards) |
| `[LS]sequence_settings` | `[AV]sequence_settings` |
| `[LS]Xcite_settings` | `[AV]Xcite_settings` |
| `LShipfix` (animation) | `AVhipfix` |

- When both names are present, the LuaSitter name is read and the AVsitter one is ignored. Keep only one; `LS-setup-checker` warns when both `LSpos` and `AVpos` are in the prim.
- The content is the same, so migrating is a rename, or nothing at all.
- Keep the `AVpos` name if the furniture also has LSL plugins that read the notecard themselves (they look for `AVpos`).

## Your own LSL scripts

LSL scripts that use AVsitter link messages keep working: the messages and their contents are unchanged ([full list](../../LuaSitter2/LINK_MESSAGES.md)). Only scripts that look up AVsitter scripts by name need updating, for example `llGetInventoryType("[AV]sitA")` becomes `llGetInventoryType("[LS]sit")`.

## What behaves differently

- **DUMP** prints to chat only; there is no "Settings copy" web link. It is faster, and it includes settings that AVsitter dropped (KFM, LROT, DFLT, WARN, BRAND, ROLES, ONSIT, RLV lines).
- **Loading** is much faster when the simulator has the notecard cached.
- See [What's new in LuaSitter](whats-new.md) for every change.
