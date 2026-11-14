# Chains set up by notecard (`[LS]chains`)

`[LS]chains` is an optional LuaSitter2 plugin that draws particle chains from the furniture to the cuffs of the people sitting on it, for every pose that should have them. It works with **LockGuard V2** cuffs and with **LockMeister** cuffs (V1 and V2), and sitters can switch their chains on and off from the menu.

It does the same job as `[LS]LockGuard` and `[LS]LockMeister`, but:

- the chains are written in a notecard, `[LS]chains_settings`, instead of a table inside the script;
- one script handles every sitter (no copy per sitter) and both protocols;
- chains can be switched on and off (menu buttons, or link messages from your own scripts);
- mistakes in the notecard are reported to the owner with their line numbers.

`[LS]LockGuard`, `[LS]LockGuard-object` and `[LS]LockMeister` are unchanged; furniture that uses them keeps working. Without the notecard `[LS]chains` does nothing (it tells the owner once that the notecard is missing).

## Setting it up

1. Name the prims the chains should go to, for example `ring1`, `ring2`, `ring3`. These are the *rings*.
2. Put `[LS]chains` in the prim with the `[LS]sit` scripts.
3. Write a notecard named `[LS]chains_settings` in the same prim (start from the example `[LS]chains_settings` notecard that comes with the script), for example:

        STYLE lockguard|size 0.08 0.08 life 0.6 gravity 0.6 texture d7277e78-06f4-58ae-9f7c-7499e50de18a
        CHAIN Kneel|*|leftwrist,ring1,rightwrist,ring2
        CHAIN *|0|leftankle,ring3,rightankle,ring4

4. Optional: add a menu button to the `LSpos` (or `AVpos`) notecard so sitters can switch their chains:

        BUTTON Chains|90242

Saving the notecard reloads it at once: current chains are removed, then everyone is chained again with the new settings.

Use **either** `[LS]chains` **or** `[LS]LockGuard` / `[LS]LockMeister` for the same cuffs, not both (they would both send commands to the cuffs). `[LS]chains` warns the owner when one of them, or `[AV]LockGuard` / `[AV]LockMeister`, is in the same prim.

## The notecard

Each line is a command, then its settings separated by `|`. Lines starting with `#` or `//` are comments, and so is anything after `//` on a line. Blank lines are ignored. Commands may be written in any case (`CHAIN`, `chain`).

### CHAIN

    CHAIN <pose>|<sitter>|<cuff>,<ring>,<cuff>,<ring>...
    CHAIN <pose>|<sitter>|<cuff>,<ring>...|lockmeister
    CHAIN <pose>|<sitter>|none

- **pose**: the menu name of a POSE or SYNC (not the animation name), or `*` for any pose.
- **sitter**: the sitter number (`0`, `1`... as in `SITTER` lines), or `*` for any sitter.
- Then pairs of cuff and ring: the cuff is the LockGuard name (`leftwrist`, `rightankle`, `collar`...) or LockMeister code (`lcuff`, `rcuff`, `llcuff`...) of the attachment point on the avatar; the ring is the name of the prim the chain goes to. Spaces around names are ignored.
- An empty list, or `none`, means *no chains* for that pose (useful to leave out one pose when a `*` line chains all the others).
- Optional 4th field `lockguard` or `lockmeister`: the protocol for this line only (see [STYLE](#style)).

For each pose played, the most precise line is used:

1. `pose|sitter`
2. `pose|*`
3. `*|sitter`
4. `*|*`

If none matches, that sitter has no chains in that pose. When the same `pose|sitter` is written twice, the first line counts and the second is reported.

LockGuard cuff names: see [LockGuard V2 standard ID tags](http://www.lslwiki.net/lslwiki/wakka.php?wakka=exchangeLockGuardItem). LockMeister codes: see the [LockMeister mooring points](http://wiki.secondlife.com/wiki/LSL_Protocol/LockMeister_System#Complete_List_of_Mooring_Points).

### STYLE

    STYLE lockguard|<LockGuard parameters>
    STYLE lockmeister|<particle settings>

- `lockguard`: chains for **LockGuard V2** cuffs (Open Collar and most others). The furniture whispers to the cuffs, and the cuffs draw the chain to the ring. The parameters are sent to the cuff as written: `size x y`, `life seconds`, `gravity g`, `color red green blue`, `texture uuid` (see [LockGuard](http://www.lslwiki.net/lslwiki/wakka.php?wakka=exchangeLockGuard)). `STYLE lockguard` with no parameters leaves the cuffs' own look. Without any `STYLE lockguard` line, the parameters of `[LS]LockGuard` are used: `size 0.12 0.12 life 1 gravity 0.3 texture d7277e78-06f4-58ae-9f7c-7499e50de18a`.
- `lockmeister`: chains for **LockMeister** cuffs. The furniture asks the cuff where it is and draws the chain itself, from the ring prim. Settings (each optional, in any order): `size x y` (default 0.1 0.1), `life seconds` (3), `gravity g` (0.3), `color red green blue` (1 1 1, values 0 to 1), `texture uuid` (the `[LS]LockMeister` chain).

The **first** STYLE line also sets the protocol of the CHAIN lines that don't name one. Without any STYLE line, CHAIN lines use LockGuard. To mix them, write both STYLE lines and add `|lockmeister` or `|lockguard` to the CHAIN lines that use the other one:

    STYLE lockguard|size 0.08 0.08 life 0.6
    STYLE lockmeister|size 0.1 0.1 life 3
    CHAIN Kneel|*|leftwrist,ring1,rightwrist,ring2
    CHAIN Hang|*|lcuff,hook1,rcuff,hook2|lockmeister

### TOGGLE

    TOGGLE <on>|<off>
    TOGGLE <on>|<off>|<toggle>

Extra link message numbers that switch the chains on, off, or toggle them, in addition to 90240, 90241 and 90242 (which always work). Any of the three may be left empty (`TOGGLE ||97` adds only a toggle number). Use it when the menus or scripts of an existing product already send other numbers, for example `TOGGLE 98|99`. Numbers from 90000 to 90500 are LuaSitter's own and are refused.

### PROPS

    PROPS 1

LockGuard rings may be in props instead of linked prims. Put `[LS]LockGuard-object` in each prop with rings (their prim names must contain `ring`, for example `ring1`). When `[LS]plugins` rezzes a prop, `[LS]chains` asks it for its rings, and links the waiting cuffs as soon as it answers. A sitter's chains look for a ring in that sitter's own props first, then in any prop, then among the linked prims. Rings in props work with LockGuard only: LockMeister chains are drawn from linked prims.

Without `PROPS 1`, props are ignored (the same as `USES_PROPS = false` in `[LS]LockGuard`).

## Rings

A ring is found by its prim name: the prim named exactly like it, otherwise the first prim (lowest link number) whose name contains it. Sitting avatars are never taken for rings. Name your rings so that no ring name is part of another one's (`ring1` is part of `ring10`: the exact name still wins, but a missing `ring1` would then find `ring10`).

**LockMeister and shared rings.** A LockMeister chain is a particle stream from the ring prim, and a prim can show only one particle stream. So a LockMeister ring can hold one chain at a time: if two sitters' poses use the same ring, the sitter whose pose was played last gets it (the other sitter's chain to that ring is removed). Give each sitter their own rings, and don't use one ring for two cuffs in the same CHAIN line (reported). LockGuard rings have no such limit: the cuffs draw the chains, so many cuffs can be chained to one ring.

## Switching chains on and off

| Link message | Does |
| --- | --- |
| 90240 | chains on |
| 90241 | chains off |
| 90242 | toggle |

plus the numbers of the TOGGLE lines. They are accepted from scripts in any prim, so a menu in another prim (`[LS]menu`) can use them.

On and off are **per avatar**. The `id` of the message says whose chains:

- a sitter's key: that sitter (`BUTTON` lines of the pose menu send the sitter's key);
- `controller|sitter` (what `BUTTON` sends when someone else controls the menu): that sitter;
- anything else (empty, or the key of someone not chained here, such as the toucher of a `[LS]menu` prim): **every sitter**. A toggle then switches everyone off if anyone is on, else everyone on.

Menu buttons, in the `LSpos`/`AVpos` notecard (see BUTTON in the AVsitter guide):

    BUTTON Chains|90242
    BUTTON Chains On|90240
    BUTTON Chains Off|90241

Behaviour:

- **On** chains the sitter's current pose at once (no need to change pose).
- **Off** removes the sitter's chains at once. While off, `[LS]chains` still follows the sitter's poses, so On chains whatever pose they are in by then.
- Everyone starts **on**. An avatar who stands up is on again the next time they sit. Off stays off when the sitter changes seat or swaps.

From an LSL or SLua script in the furniture:

    llMessageLinked(LINK_SET, 90241, "", avatar);   // this sitter's chains off
    llMessageLinked(LINK_SET, 90240, "", "");       // everyone's chains on

## When chains change

- A pose is played: the chains of the new pose replace the old ones (with LockGuard, cuffs the new pose also uses are not unlinked first).
- A sitter stands up: their chains are removed.
- Sitters swap (`[SWAP]`, 90030 / 90032) or someone changes seat: the chains of the seats involved are removed, and the new poses are chained.
- Another avatar takes a seat: the previous avatar's chains are removed first.
- Nobody sits any more: everything is cleared.

## Notecard problems

After reading the notecard, `[LS]chains` tells the owner (only the owner, once per reading, at most 8 problems) about:

- unknown commands (often a typo);
- CHAIN lines with a wrong format: missing sitter, sitter not a number or `*`, cuffs and rings not in pairs, an empty name, a wrong 4th field, a second line for the same `pose|sitter`;
- rings that no prim is named like (not checked for LockGuard rings with `PROPS 1`, as they may be in props);
- a LockMeister ring used twice in one line;
- a STYLE that is not `lockguard` or `lockmeister`, or LockMeister settings it doesn't know;
- TOGGLE lines without valid numbers;
- `[LS]LockGuard`, `[LS]LockMeister`, `[AV]LockGuard` or `[AV]LockMeister` in the same prim.

Lines with a problem are skipped; the other lines work.

## Migrating

### From `[LS]LockGuard` or `[AV]LockGuard`

Each script copy had a `SITTER`, a `POSES` list, `CHAIN_PARAMETERS` and `USES_PROPS`. For example (SLua `[LS]LockGuard`):

    local SITTER = 0
    local USES_PROPS = false
    local POSES = {
        ["cross"] = "rightwrist,ring1,leftwrist,ring2",
        ["*"] = "leftankle,ring3",
    }
    local CHAIN_PARAMETERS = "size 0.12 0.12 life 1 gravity 0.3 texture d7277e78-06f4-58ae-9f7c-7499e50de18a"

or (LSL `[AV]LockGuard`) `list POSES = ["cross", "rightwrist,ring1,leftwrist,ring2", "*", "leftankle,ring3"];`. In `[LS]chains_settings` this becomes:

    STYLE lockguard|size 0.12 0.12 life 1 gravity 0.3 texture d7277e78-06f4-58ae-9f7c-7499e50de18a
    CHAIN cross|0|rightwrist,ring1,leftwrist,ring2
    CHAIN *|0|leftankle,ring3

- One CHAIN line per pose; the sitter field is the old `SITTER` (`-1`, all sitters, becomes `*`).
- One copy per sitter: put the lines of all copies in the one notecard, each with its sitter number.
- `USES_PROPS = TRUE` becomes `PROPS 1`. Keep `[LS]LockGuard-object` (or `[AV]LockGuard-object`, same protocol) in the props.
- Then remove the old `[LS]LockGuard` / `[AV]LockGuard` scripts.

Ring names: `[AV]LockGuard` only looked at prims whose name contains `ring`. `[LS]chains` looks at every prim, so rings named as before keep working.

### From `[LS]LockMeister` or `[AV]LockMeister`

    STYLE lockmeister
    CHAIN cross|0|rcuff,ring1,lcuff,ring2

The old chain look (in `SetChain`) is the `STYLE lockmeister` default; change it with `size`, `life`, `gravity`, `color`, `texture`. `[AV]LockMeister` found a ring by part of its name, highest link number first; `[LS]chains` prefers the exact name, then the lowest link number, so give rings distinct names.

### From products with on/off link messages (for example 98 / 99)

Some products switched their chain script on and off with their own link messages, for example menu lines `BUTTON Chains On|98` and `BUTTON Chains Off|99`. Keep those menu lines and add

    TOGGLE 98|99

to `[LS]chains_settings`. With `[LS]chains`, On also chains the current pose at once, and Off keeps track of the pose.

## Limits

- One `[LS]chains` per furniture is enough, and only one should be used: copies would chain the same cuffs twice.
- LockGuard commands are whispered (10 m): the cuffs must be within 10 m of the prim with the script, as with `[LS]LockGuard`.
- LockMeister: one chain per ring prim at a time (see [Rings](#rings)). The furniture listens on the LockMeister channel only for 10 s after asking the cuffs, or until every cuff answered LMV2.
- Notecard lines are read up to Second Life's notecard line length; split long chain lists by pose or sitter.
- The settings stay as read until the notecard is saved again. Linking or renaming ring prims is picked up at the next pose (rings are looked up every time).
