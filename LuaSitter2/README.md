# LuaSitter2

LuaSitter2 is the SLua port of AVsitter2. It reads the same `AVpos` notecards and speaks the same link messages ([LINK_MESSAGES.md](LINK_MESSAGES.md)), with fewer scripts and faster notecard loading.

How to set up furniture and write notecards: see the [user guide](../docs/README.md).

## Installing a script

1. In your object, create a new script and give it the exact name shown below (for example `[LS]sit`).
2. In the script editor, set the compiler drop-down to **Lua**.
3. Paste the contents of the `.luau` file and save.

For more than one sitter, add copies of `[LS]sit` named `[LS]sit 1`, `[LS]sit 2`, and so on (sitter 0 is the script without a number).

## Script count compared with AVsitter2

| Setup | AVsitter2 | LuaSitter2 |
| --- | --- | --- |
| Core, 1 sitter | `[AV]sitA` + `[AV]sitB` (2) | `[LS]sit` (1) |
| Core, 4 sitters | 8 scripts | 4 scripts |
| RLV plugin | `[AV]root-RLV` + `[AV]root-RLV-extra` (2) | `[LS]root-RLV` (1) |
| Setup diagnostics | 3 utility scripts | `LS-setup-checker` (1) |
| Notecard tools | 3 utility scripts | `LS-notecard-tools` (1) |
| Props, sequences, favourites | `[AV]prop` + `[AV]sequence` + `[AV]favs` (3) | `[LS]plugins` (1) |
| Faces and cameras, 2 sitters | `[AV]faces` + `[AV]camera` + `[AV]camera 1` (3) | `[LS]faces-camera` + `[LS]faces-camera 1` (2) |

Example: a 2-sitter bed with props, faces, cameras, sequences and favourites uses 10 scripts in AVsitter2 and 5 in LuaSitter2 (`[LS]sit`, `[LS]sit 1`, `[LS]plugins`, `[LS]faces-camera`, `[LS]faces-camera 1`).

## What each script does

### Core (in the prim with the AVpos notecard)

| Script | Replaces | What it does |
| --- | --- | --- |
| `[LS]sit`, `[LS]sit 1`, ... | `[AV]sitA` + `[AV]sitB` | **Required, one per sitter.** Reads AVpos, sets the sit target, animates and positions its sitter, shows the pose menu and the personal [ADJUST] menu, and keeps personal position offsets. One copy per sitter is still needed because a script can only hold animation permission for one avatar at a time. |
| `[LS]adjuster` | `[AV]adjuster` | Setup tool for creators. Rezzes helpers, adds poses, submenus, props, faces and cameras from the menu, and DUMPs the setup as AVpos notecard text in chat. Delete it before selling if customers should not edit poses: it reminds the creator in chat every time the object is rezzed, and in its [NEW] menu. Type `/5 cleanup` to remove it and the helper. It may also stay: customers can then adjust and save poses with it. |
| `[LS]select` | `[AV]select` | Optional. Sitters pick a seat from a menu instead of using [SWAP]. |
| `[LS]root-security` | `[AV]root-security` | Optional. Limits who can sit and who can use the menu (owner / group / all). |

### Helper object

| Script | Replaces | What it does |
| --- | --- | --- |
| `[LS]helperscript` | `[AV]helperscript` | Goes inside the helper object (named `[LS]helper`; `[AV]helper` objects also work). Move the helper to move a pose. |

### Root prim (when the sit scripts are in a child prim)

| Script | Replaces | What it does |
| --- | --- | --- |
| `[LS]root` | `[AV]root` | Clicking the root prim opens the menu of the setup in the child prim. |

### Plugins (optional, same prim as `[LS]sit`)

| Script | Replaces | What it does |
| --- | --- | --- |
| `[LS]plugins` | `[AV]prop` + `[AV]sequence` + `[AV]favs` | One script for three features, each switched on by notecard content, so unused features cost nothing:<br>- **Props:** rezzes, attaches and removes props when poses play (PROP lines).<br>- **Sequences:** plays timed sequences of poses (SEQUENCE buttons and the `[LS]sequence_settings` or `[AV]sequence_settings` notecard).<br>- **Favourites:** personal favourite pose lists (BUTTON lines sending 90401-90403).<br>Changing AVpos or the sequence notecard resets the whole script (props are removed first; favourites are kept in memory only and are cleared). |
| `[LS]object` | `[AV]object` | Goes **inside each prop**. Handles attaching, derezzing and following the furniture. A prop that is never accepted or loses its furniture now removes itself (AVsitter issue #17). |
| `[LS]menu` | `[AV]menu` | Menus and props for objects that have no sit scripts ("AVmenu"). Uses `[LS]plugins` for its props. Kept separate because it only works in objects without sit scripts (it removes itself when it finds `[LS]sit`). |
| `[LS]faces-camera`, `[LS]faces-camera 1`, ... | `[AV]faces` + `[AV]camera` | Facial expressions (ANIM lines) and pose-specific cameras (CAMERA lines). Copy N handles sitter N. Cameras need one copy per sitter (camera control is a permission a script holds for one avatar); for faces, `[LS]faces-camera` (copy 0) also covers every sitter that has no copy of its own, so one copy is enough for faces alone. The `[FACES]` button in the [ADJUST] menu only appears for sitters that have ANIM lines. |
| `[LS]root-RLV` | `[AV]root-RLV` + `[AV]root-RLV-extra` | RLV captures, restrictions, undress menu and timelock. The two upstream scripts are now one. |
| `[LS]root-control` | `[AV]root-control` | Lets other avatars control the menu ("Menu Control"). Kept separate because it can be installed without RLV. |
| `[LS]LockGuard` | `[AV]LockGuard` | LockGuard V2 chains. |
| `[LS]LockGuard-object` | `[AV]LockGuard-object` | Goes inside props that act as chain points. |
| `[LS]LockMeister` | `[AV]LockMeister` | LockMeister V1/V2 chains. |
| `[LS]commands` | (new) | Chat commands for sitters, for gestures (`/1888 menu`, `adjust`, `keys`, `swap`, `next`, `prev`, `rlv`), and arrow-key pose adjusting ("Keys" in the adjust menu). Optional `COMMANDS <channel>` line. See [commands](../docs/luasitter/commands.md). |
| `[LS]Xcite!` | `[AV]Xcite!` | Xcite! and Sensations support. Reads `[LS]Xcite_settings` (example included), or `[AV]Xcite_settings` when there is no `[LS]` notecard. |

### Utilities (drop in temporarily)

| Script | Replaces | What it does |
| --- | --- | --- |
| `LS-setup-checker` | Anim-perm-checker, Missing-anim-finder, Noob-detector | Shows a menu: check animation permissions, find missing or unused animations, or make a setup report. **ALL** runs every check. It recognises both LuaSitter and AVsitter scripts and reports mixed setups. |
| `LS-notecard-tools` | AVpos-generator, AVpos-shifter, MLP-converter | Shows a menu: generate POSE lines from the animations in inventory, shift all positions/rotations, or convert an MLP notecard. Output is the same as the original tools. |
| `LS-update-sender`, `LS-update-receiver` | update-sender, update-receiver | Remote updating of object contents. Same protocol as upstream, so they work with the LSL versions. Touching the sender gives **Update** (as upstream), **Range** (how far to look: 100 m by default, up to the whole region; upstream: half the sender's size) or **Migrate**: replace the AVsitter scripts of the furniture around with LuaSitter scripts, after showing the plan. After a run it asks whether to remove the update receivers. The receiver shows no name label unless `show_name = true` ([how](../docs/luasitter/migrating-from-avsitter.md#migrating-many-objects-with-the-updater)). |

## Notecards

- **Notecard name:** the LuaSitter name of the pose notecard is `LSpos`. A notecard named `AVpos` is read the same way when there is no `LSpos`, so existing furniture works unchanged. Use `LSpos` for new furniture. (Keep `AVpos` if the object also has LSL plugins that read the notecard themselves.)
- The notecard is read exactly as in AVsitter2. Nothing needs to change in existing notecards.
- **Other names, same rule** (`[LS]` name first, AVsitter name as fallback): `[LS]Xcite_settings` / `[AV]Xcite_settings`, `[LS]sequence_settings` / `[AV]sequence_settings`, and the hip fix animation `LShipfix` / `AVhipfix`. The example Xcite notecard in this repository is `[LS]Xcite_settings`.
- **Fast loading:** notecards are read with `ll.GetNotecardLineSync`. When the simulator answers `NAK` (notecard not cached), the scripts fall back to the classic `ll.GetNotecardLine` + `dataserver` method automatically.
- **Per-sitter notecards (optional):** `[LS]sit N`, `[LS]faces-camera` and `[LS]select` also read a notecard named `LSpos sitter N` if it exists. Its contents count as sitter N's section (a `SITTER N` line in it is optional). Global settings (MTYPE, SET, AMENU, ...) and `SITTER` lines with M/F genders still belong in the main notecard. `[LS]plugins` and `[LS]root-RLV` only read the main notecard, so keep PROP and RLV lines there. Names like `LSpos 1` or `AVpos 1` are not read: Second Life gives those names to duplicate copies (for example when a notecard is given to an object that already has one), and `LS-setup-checker` reports them as duplicates to delete.
- `LS-setup-checker` reports which notecard is in use and warns when both `LSpos` and `AVpos` are present (only `LSpos` is read then).

## Changes from AVsitter2

- **DUMP** is faster and no longer freezes the sit scripts. It also keeps settings that upstream dumps lost: KFM, LROT, DFLT, WARN, BRAND, ROLES, ONSIT, the RLV plugin's settings (AVsitter issue #18), and AMENU's "4" flag.
- **New link message 90032** swaps two sitters and gives them their menu back (AVsitter issue #140).
- **The separator character** is written as an escape in the source, so copying and pasting a script can no longer break DUMP (AVsitter issues #147 and #152).
- **Merged plugins:** props, sequences and favourites are one script (`[LS]plugins`); faces and cameras are one script per sitter (`[LS]faces-camera`).
- **No limit of 11 sitters:** the `[LS]select` seat menu, the `[LS]root-control` "Which avatar?" menu and the `[LS]root-RLV` captive menu are paged with `[<<]` / `[>>]` when there are more sitters than fit in one dialog. Each sitter still needs its own `[LS]sit N` copy and its own prim with a sit target.
- **Clearer RLV menus:** "RLV ▸" (pose menu) and "◂ Poses" (RLV menu) switch between the two; RLV menus show whose menu it is, the status and what each button does, with plain button names. Old names still work; LSL plugins still get "Control..." in 90100.
- **`[FACES]` button** only appears for sitters that have facial expressions defined.
- **Setup tool reminder:** `[LS]adjuster` reminds the creator on every rez that it can be deleted before selling; a customer who owns it is told they can use it.
- **New notecard names:** `LSpos` (and `LSpos sitter N`, `[LS]Xcite_settings`, `[LS]sequence_settings`, `LShipfix`), with the AVsitter names still read as a fallback.
- **No `ll.Sleep`:** every wait upstream did with `llSleep` (keyframed motion, sequence steps, DUMP pacing, RLV role changes, prop removal, notecard tools) is an `LLTimers` timer with the same duration. Where the order of events mattered, events arriving during a wait are still handled after it (see the script headers).
- **No deprecated SLua functions:** `ll.OwnerSay`, `ll.StringLength`, `ll.VecMag` and `ll.Rot2Fwd`/`ll.Rot2Up` were replaced by `print`, `utf8.len`, `vector.magnitude` and `quaternion.tofwd`/`quaternion.toup` (Luau built-ins and fastcalls).
- **DUMP goes to chat only.** The upstream "Settings copy" web link and its server (`settings.php`) were removed. The setup checker's report and the notecard shifter also print to chat instead of uploading.

### Upstream fixes included

| Upstream | Fix | Script |
| --- | --- | --- |
| PR #149 (Chorazin Allen) | RLV captives who come back return to the pose they had. The PR's `new_pose` scoping bug is fixed, and restore attempts are capped. | `[LS]root-RLV` |
| PR #158 | Choosing your own seat in the select menu shows the menu instead of swapping with yourself. | `[LS]select` |
| PR #151 | Per-sitter notecards (`LSpos sitter N`). | `[LS]sit`, `[LS]faces-camera`, `[LS]select` |
| PR #78, issues #75 and #77 | 90004/90005 with a submenu name open that submenu in `[LS]menu`. | `[LS]menu` |
| PR #32, issue #17 | Props wait at most 120 s for attach permission, then remove themselves. | `[LS]object` |
| Issue #18 | RLV settings are included in DUMP. | `[LS]root-RLV`, `[LS]adjuster` |
| Issue #109 | DUMP no longer stalls: no blocking sleeps and no web upload. | `[LS]sit`, `[LS]adjuster` |
| Issue #140 | Link message 90032 (swap and return to menu). | `[LS]sit` and plugins |
| Issues #147 and #152 | DUMP wrote `POSE|name|anim` after copy/paste; the separator is now an escape. | all |

Several smaller upstream bugs found during the port are fixed too. Each is marked with a `-- FIX:` comment in the source.

## Developer notes

- Script names are looked up with the `[LS]` prefix. Where it is harmless, scripts also accept the old `[AV]` names (for example, an `[AV]helper` object or an LSL `[AV]sitA` next to `[LS]plugins`).
- LSL plugins keep working: link message payloads are unchanged. In SLua the 4th link message parameter is a string; LSL scripts still receive a key.
- The original LSL sources are in [../AVsitter2](../AVsitter2) for reference.
