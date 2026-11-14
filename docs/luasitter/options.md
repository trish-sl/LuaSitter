# Options: lamps, sheets, music (`[LS]options`)

`[LS]options` is an optional LuaSitter2 plugin. It changes how prims of the furniture look or sound when a pose plays, when a menu button is clicked, or when everyone has stood up: a bed lamp that switches on, sheets in another colour, music. No custom LSL is needed. Without the plugin nothing changes: furniture without it works exactly as before.

## Setting it up

1. Name the prims you want to change (Edit > the prim > **Name**), for example `lamp` and `sheet`. Several prims may have the same name: an option then changes all of them.
2. Put `[LS]options` and a notecard named `[LS]options_settings` in one prim of the furniture (usually the root prim, with the `[LS]sit` scripts). Textures and sounds that the notecard names by inventory name go in that same prim.
3. Write the options in the notecard (see below), and add buttons for them to the `LSpos` (or `AVpos`) notecard if users should choose them from the menu.

If the notecard has a problem, the script tells the owner, with the line number, for example:

    [LS]options: 2 problem(s) in the notecard "[LS]options_settings":
    line 3: no prim named "lampe".
    line 7: no OPTION named "Lamp of".

The notecard is read again when it is saved. After a problem, it is also read again whenever something is dropped into the prim, so adding a missing texture or sound fixes it.

## The notecard

Blank lines and lines starting with `#`, `//` or `--` are ignored. Fields are separated by `|`.

### OPTION: what to change

    OPTION <name>|<target>|<setting>|<setting>...

`<target>` is the prim to change:

| Target | Prims |
| --- | --- |
| `lamp` | every prim named `lamp` |
| `sheet:2` | face 2 of every prim named `sheet` |
| `sheet:0,2` | faces 0 and 2 |
| `*` | the prim the script is in |
| `root` | the root prim |

Without faces, every face is changed. Faces are numbered 0 to 7, as in the viewer (Edit > Select Face shows the number).

Settings:

| Setting | Does |
| --- | --- |
| `texture <name or UUID>` | Sets the texture. The repeats, offsets and rotation of each face are kept. |
| `color <r> <g> <b>` | Sets the colour, 0-1 (`color 1 0.5 0`) or 0-255 (`color 255 128 0`); `<1,0.5,0>` works too. `colour` is accepted. The transparency is kept. |
| `alpha <0-1>` | Sets the opacity (0 = invisible, 1 = solid). The colour is kept. |
| `glow <0-1>` | Sets the glow. |
| `fullbright on` / `off` | Fullbright on or off. |
| `light <r> <g> <b> [<intensity> <radius> <falloff>]` | Turns the prim into a light with that colour. Defaults: intensity 1, radius 10 m, falloff 0.75. |
| `light on` / `light off` | A white light (intensity 1, radius 10 m), or no light. A light is per prim, faces don't matter. |
| `sound <name or UUID> [<volume>] [loop]` | Plays a sound from the target prim, once or looped. Volume 0-1 (default 1). |
| `sound stop` | Stops the sound of the target prim. |

Several `OPTION` lines with the same name add up, so one option can change several prims:

    OPTION Night|lamp|light off|glow 0
    OPTION Night|sheet|color 0.2 0.2 0.4

### TOGGLE: one button, several options in turn

    TOGGLE <name>|<option>|<option>...

Each use of the toggle applies its next option, and after the last one the first again. When one of its options is applied some other way (a pose, its own button), the toggle goes on from there. After a reset, a toggle starts again with its first option.

### POSE: options per pose

    POSE <pose>|<option>[|<sitter>]

When the pose with that menu name plays, the option is applied. `<pose>` `*` means any pose. `<sitter>` is the `SITTER` number of the `LSpos` notecard; without it the line is for every sitter. Only the most specific lines are used: first `POSE <pose>|...|<sitter>`, else `POSE <pose>`, else `POSE *|...|<sitter>`, else `POSE *`. Several lines for the same pose and sitter are all applied.

A looping sound already played by a `POSE` line is not started again by the next pose that names it (a SYNC pose is announced once per sitter).

### BUTTON: options from existing buttons and plugins

    BUTTON <number>|<option or toggle>[|<message>]

When any script of the furniture sends link message `<number>`, the option or toggle is applied. With `<message>`, only when the message is exactly that text. This connects options to existing `LSpos` `BUTTON` lines (`BUTTON Light|97` sends 97 with the message `Light`), or to other plugins.

### EMPTY: when everyone has left

    EMPTY <option>

The option is applied when the last sitter stands up, for example to switch the lamp off and stop the music.

## Buttons in the menu

The easiest way to give users a button for an option: an `LSpos` `BUTTON` line with link message **90250**. The message is the option (or toggle) name, which is the button name when no message is given:

    BUTTON Lamp|90250
    BUTTON Red sheets|90250
    BUTTON Night light|90250|Night

Put them in a submenu to keep the pose menu short:

    TOMENU Options
    MENU Options
    BUTTON Lamp|90250
    BUTTON Music|90250
    BUTTON Silence|90250

A button name is cut to 23 characters. For a longer option name, give the name as the message (`BUTTON Lamp|90250|Lamp in the left corner`).

## Examples

### A bed lamp

`[LS]options_settings`:

    # the prim named "lamp" is the lamp shade
    OPTION Lamp on|lamp|light 1 0.85 0.6 1 6 0.75|glow 0.15|fullbright on
    OPTION Lamp off|lamp|light off|glow 0|fullbright off
    TOGGLE Lamp|Lamp on|Lamp off
    # darker for the sleeping poses, off when nobody is in bed
    POSE Sleep|Lamp off
    EMPTY Lamp off

`LSpos`:

    BUTTON Lamp|90250

### Sheets in several colours

    OPTION White sheets|sheet|texture Cotton|color 1 1 1
    OPTION Red sheets|sheet|texture Satin|color 0.7 0.05 0.05
    OPTION Blue sheets|sheet:0,1|texture Satin|color 0.1 0.2 0.6

With `Cotton` and `Satin` textures in the prim with the script, and a submenu in `LSpos`:

    TOMENU Sheets
    MENU Sheets
    BUTTON White sheets|90250
    BUTTON Red sheets|90250
    BUTTON Blue sheets|90250

### Music

    OPTION Music|*|sound Slow piano 0.6 loop
    OPTION Silence|*|sound stop
    TOGGLE Music on/off|Music|Silence
    EMPTY Silence

`LSpos`:

    BUTTON Music|90250|Music on/off

A sound name may contain spaces and end in a number: when the whole text is the name of a sound in the prim, it is used as it is.

## Reset and rez

Nothing is restored or reset when the script restarts or the furniture is rezzed: Second Life keeps prim colours, textures, lights and looping sounds, so the furniture stays as it was left. Only the position of each `TOGGLE` is forgotten (its next use applies its first option).

## Link messages

New in LuaSitter: **90250** applies an option or toggle by name (message = the name). `[LS]options` also listens to **90045** (pose played) for `POSE` lines, and to the numbers of its own `BUTTON` lines. It sends no link messages. See [LINK_MESSAGES.md](../../LuaSitter2/LINK_MESSAGES.md).

## Limits

- One script changes the prims of its own linkset only.
- Textures and sounds named by inventory name must be in the prim with the script; UUIDs work from anywhere.
- `texture` sets the diffuse (Blinn-Phong) texture. PBR (GLTF) materials are not changed.
- Prims are found by name when the notecard is read and again after the linkset changes (linking or unlinking).
