# Chat commands and arrow keys (`[LS]commands`)

`[LS]commands` is an optional LuaSitter2 plugin. With it, a sitter can open menus and change poses with chat commands, for example from gestures bound to function keys. In the adjust menu they can also move their pose with the arrow keys. Without the plugin nothing changes: furniture without it works exactly as before.

## Setting it up

1. Put `[LS]commands` in the prim with the `[LS]sit` scripts.
2. Optional: to use another channel than 1888, add a line to the `LSpos` (or `AVpos`) notecard:

        COMMANDS 1888

   `COMMANDS 0` switches the commands off (the plugin then does nothing). DUMP keeps this line.

## Commands

While sitting, say on the channel:

| Command | Does |
| --- | --- |
| `/1888 menu` | Opens the pose menu, as touching the furniture does. |
| `/1888 adjust` | Opens the personal adjust menu. |
| `/1888 keys` | Arrow keys move your pose (say it again to stop). |
| `/1888 swap` | Swaps seats ([SWAP]), or opens the seat menu when the furniture has `[LS]select`. |
| `/1888 next`, `/1888 prev` | Plays the next or previous pose of the menu your pose is in. |
| `/1888 rlv` | Opens the RLV menu (RLV furniture, dominant seat only). |
| `/1888 help` | Lists the commands. |

Only the furniture you sit on hears you: each sitter has their own listen, filtered on their key, open only while they sit.

## Gestures

Scripts can't create gestures, so each user (or the creator, to give away with the furniture) makes them once in the viewer:

1. Inventory > **New Gesture**.
2. Give it a name, and a shortcut key such as **F2**.
3. Add a **Chat** step with the text `/1888 menu`.
4. Save, and make the gesture active.

Repeat for the other commands, for example F3 `/1888 next`, F4 `/1888 adjust`, F5 `/1888 swap`. Because every LuaSitter2 furniture with the plugin uses channel 1888 by default, the same gestures work on all of them.

## Arrow keys

In the personal adjust menu (`[ADJUST]`), the plugin adds a **Keys** button in place of **[SAVE ALL]**. **[SAVE]** then asks whether to save for this pose or for all poses.

With **Keys** on, each key press moves your pose by 0.01 m or turns it by 1°, the smallest step, whatever step the menu shows. A held key repeats a few times per second. **Shift + Left / Right** always turn your pose. For the other keys, the **Position** / **Rotation** button switches what they do:

| Keys | Position | Rotation |
| --- | --- | --- |
| Up / Down arrow | X + / X - | turn around Y |
| Left / Right arrow | Y + / Y - | turn around Z |
| Shift + Left / Right arrow | turn around Z | turn around Z |
| PgUp / PgDn | Z + / Z - | turn around X |

Second Life only tells scripts about Shift together with Left / Right (strafing), so Shift does nothing special with the other keys. The axes are those of the furniture, as with the X+ ... Z- buttons. Use **[SAVE]** to keep the new position. The keys are given back when you press **Keys** again, say `/1888 keys`, leave the menu with **[BACK]**, stand up, or press no key for 60 seconds.

## What a command may do

Commands never do more than the menus would allow:

- With `[LS]root-security`, every command needs menu access, and `menu` is handled exactly like a touch.
- In RLV furniture (`[LS]root-RLV`), commands other than `menu` only work for a sitter in a dominant seat (`ROLES`). A captive uses the menu, as before.
- `adjust` and `keys` follow `AMENU`; `swap` follows `SWAP`, `ONSIT ASK` and `[LS]select`.
- There is no "stand up" command: unseating by script would get around RLV restrictions.

## Link messages

The plugin uses link messages, so LSL plugins can send the same commands. New in LuaSitter: 90013 / 90016 (a command checked by `[LS]root-security`), 90017 (next/previous pose) and 90018 (move the pose by key). See [LINK_MESSAGES.md](../../LuaSitter2/LINK_MESSAGES.md).
