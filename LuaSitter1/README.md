# LuaSitter1

LuaSitter1 is the SLua port of the legacy AVsitter1 system. It reads the same notecards (named `LSpos`, or `AVpos` as in AVsitter1) and uses the same link messages as AVsitter1. For new furniture, use [LuaSitter2](../LuaSitter2/README.md).

Install each script by creating it in-world with the exact name below, selecting **Lua** in the script editor's compiler drop-down, and pasting the `.luau` file.

## What each script does

| Script | Replaces | Where | What it does |
| --- | --- | --- | --- |
| `LSsit`, `LSsit 1`, ... | `AVsit` | Sitter prim | **Required, one per sitter.** Reads LSpos (or AVpos), animates and positions its sitter, and shows the menu. |
| `LSplus` | `AVplus` | Sitter prim | Optional extras: facial expressions, props, sounds and camera ([EXTRA] button). |
| `LSselect` | `AVselect` | Sitter prim | Optional seat selection instead of [SWAP]. With more than 12 seats the menu is paged with `[<<]` / `[>>]`. |
| `LSadjuster` | `AVadjuster` | Sitter prim | Setup tool: helpers, adding poses, DUMP. Remove it when finished. |
| `LShelper-script` | `Helper` | Helper object | Goes inside the helper object (`LShelper`; `AVhelper` also works). |
| `LSroot` | `Root` | Root prim | Clicking the root prim opens the menu of a setup in a child prim. |
| `LSroot-security` | `Root-Security` | Root prim | Alternative to `LSroot` that limits who can sit and use the menu. |
| `LSsittarget-add` | `Sittarget-Add` | Other child prims | Adds a sit target in a prim without sit scripts and keeps it in sync when the pose notecard is re-read. |
| `LSprop` | `AVprop` | Inside props | Lets props be found and removed by the furniture. |

## Merges

No AVsitter1 scripts could be merged without changing behaviour:

- `LSsit` stays one per sitter, because a script holds animation permission for only one avatar.
- `LSplus` asks for camera permissions, which would replace `LSsit`'s animation permission.
- `LSselect` and `LSadjuster` are optional, and their presence changes the menus.
- `LSroot` and `LSroot-security` are alternatives to each other.
- `LSsittarget-add`, `LSprop` and `LShelper-script` live in other prims or objects.

The port still reduces load: notecards are read with `ll.GetNotecardLineSync` (falling back to `ll.GetNotecardLine` when the simulator answers `NAK`), and timed waits use `LLTimers` instead of `llSleep` (no script calls `ll.Sleep`).

## Notes

- Use LuaSitter1 scripts together in the sitter prim. AVsitter1 finds its sitter scripts by name, so LSL `AVsit` and Lua `LSsit` cannot be mixed in one prim. Cross-prim scripts (`LSroot`, `LSsittarget-add`) accept both names.
- Bugs fixed during the port are marked with `-- FIX:` comments in the source.
- The original LSL sources are in [../AVsitter1](../AVsitter1) for reference.
