# Troubleshooting: notecard check

AVsitter silently ignores notecard lines it can't use. LuaSitter reads every line exactly as AVsitter does, and `LS-setup-checker` can **list** what is ignored or read differently than you probably meant, with the notecard name and line number.

Drop `LS-setup-checker` into the prim with the sit scripts and choose **NOTECARD** (also part of ALL). It checks the pose notecard (`LSpos`, or `AVpos`) and the `LSpos sitter N` cards, lists every problem, then removes itself. Only the owner sees the list. `[LS]sit` does not report notecard problems itself.

The check does not change how notecards are read: it only explains lines that do nothing or read a value as 0.

## Example

```
LS-setup-checker: LSpos line 14: animation 'kneel2' is not in inventory
LS-setup-checker: LSpos line 22: position for 'Cudle', but no pose of that name above it (ignored)
LS-setup-checker: LSpos line 30: MTYPE 'two' is not a number (read as 0)
LS-setup-checker: LSpos line 41: SITTER 2 is not used: there are sit scripts for SITTER 0 to 1
LS-setup-checker: LSpos line 47: PROP lines need the script '[LS]plugins' in this prim
LS-setup-checker: 5 problem(s) found.
```

## Problems and how to fix them

| Message | What it means | Fix |
| --- | --- | --- |
| `animation 'X' is not in inventory` | A POSE or SYNC line names an animation that is not in the prim. Second Life's built-in animations (`sit`, `stand`, `dance1`...) are fine. | Drop the animation in, or correct the name (names are case-sensitive). |
| `position for 'X', but no pose of that name above it (ignored)` | A `{X}<...><...>` line whose pose doesn't exist in that SITTER section, or comes only further down. | Correct the name, or move the line below its POSE / SYNC line. |
| `... (pose names are cut to 23 characters)` | Pose names are cut to 23 characters (the dialog button limit), so the position line must use the cut name. | Write the first 23 characters of the name between `{` and `}`, or shorten the pose name. |
| `position or rotation is not a <x,y,z> vector (read as <0,0,0>)` | The position or the rotation is missing or isn't three numbers. | Write `{Name}<x,y,z><x,y,z>`. |
| `position line without '}' (ignored)` | A line starting with `{` has no `}`. | Close the name: `{Name}`. |
| `MTYPE 'two' is not a number (read as 0)` | A setting that takes a number (MTYPE, ETYPE, SELECT, WARN, SWAP, AMENU, HELPER, SET, KFM, LROT, DFLT, SITTER) has text instead. | Write the number. |
| `'X' is cut to 23 characters and then has the same name as line N` | Two long names that only differ after the 23rd character become the same button. | Make the names differ in their first 23 characters. |
| `SITTER N is not used: there are sit scripts for SITTER 0 to M` | A SITTER section for which there is no sit script. Its lines are never used. | Add the script `[LS]sit N` (and a prim for its sit target), or remove the section. |
| `PROP lines need the script '[LS]plugins' in this prim` | PROP lines are read by `[LS]plugins` (or AVsitter's `[AV]prop`), which isn't there. Said once. | Add `[LS]plugins`. |
| `ANIM lines need the script '[LS]faces-camera' in this prim` / `CAMERA lines ...` | Expressions and cameras are read by `[LS]faces-camera` (or `[AV]faces` / `[AV]camera`). | Add `[LS]faces-camera`. |
| `RLV lines need the script '[LS]root-RLV' in this prim` | RLV settings (RLV, ONTOUCH, TIMELOCK, ...) without `[LS]root-RLV`. Also COMMANDS (`[LS]commands`), LMSOURCE (`[LS]menu`). | Add the script, or remove the lines. |
| `unknown command 'X' (ignored, unless a plugin reads it)` | An upper-case word no LuaSitter or AVsitter script reads. A third-party plugin might read it. | Correct the spelling (for example `POSES` → `POSE`). |
| `'pose' is ignored: commands are upper case (POSE)` | Commands are case-sensitive. | Write the command in upper case. |
| `'SITTER' without a value (ignored)` | A command alone on its line is never read (AVsitter needs a space after it). | Add the value, for example `SITTER 1`. |
| `prop object 'X' is not in inventory` | A PROP line names an object that isn't in the prim. | Drop the prop object in, or correct the name. |
| `SYNC 'X' has no SYNC line in SITTER N` | A SYNC pose needs a SYNC line with the same name in every sitter's section. | Add the SYNC line to that section. |
| `PROP lines are only read from LSpos (ignored here)` | `[LS]plugins`, `[LS]root-RLV`, `[LS]commands` and `[LS]menu` read only the main notecard, not `LSpos sitter N`. | Move the line to the main notecard. |

Lines that start with something other than a command (comments such as `// ...`, `# ...` or plain text) are ignored, as in AVsitter, and are never reported.
