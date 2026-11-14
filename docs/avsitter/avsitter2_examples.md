# AVsitter2 Examples

> **LuaSitter note:** This page is from the [AVsitter documentation](https://avsitter.github.io) (CC BY-SA 4.0, see [LICENSE](../LICENSE.md)), adapted for LuaSitter. Everything here applies to LuaSitter2: the AVpos notecard format and the link messages are unchanged. LuaSitter also reads the notecard under its new name, `LSpos` (preferred for new furniture). Script names differ: `[AV]name` is `[LS]name` in LuaSitter, and `[AV]sitA` + `[AV]sitB` are one script, `[LS]sit`. See [Migrating from AVsitter](../luasitter/migrating-from-avsitter.md) and the [LuaSitter notes](#luasitter-notes) at the end of this page.

The following examples are provided in the AVsitter2 package (available on the [Second Life Marketplace](https://marketplace.secondlife.com/stores/79645)).

### Examples box
These AVsitter2 examples are provided in the Examples [BOX], inside the main AVsitter2 package:

- Example#01 (basic chair)
- Example#02a (sitters in each cushion)
- Example#02b (all sitters in one cushion)
- Example#03 (all sitters in one cushion w/couples)
- Example#04 (bed)
- Example#05 (singles poseball)
- Example#06a ([AV]select, one pose per sitter)
- Example#06b ([AV]select, multiple poses per sitter)
- Example#07a (sequence with "built-in" sequence)
- Example#07b (sequence with [AV]sequence)
- Example#07c (piano with [AV]sequence)
- Example#08 (3 seats w/couples)
- Example#09 (3 single seats+couples)
- Example#10a (2 couples same prim)
- Example#10b (2 couples different prims)
- Example#11a (couples/3some)
- Example#11b (couples/3some/4some)
- Example#12a (couples poseball: static poses)
- Example#12b (couples poseball: sequenced animation)
- Example#12c (Tai-Chi/Yoga/LineDance)
- Example#13a (Singles Chair w/couples ~ Autoplay)
- Example#13b (Singles w/couples & 3some ~ Autoplay)
- Vehicle Setup#1 (Driver+Sitter)
- Vehicle Setup#2 (Driver+3xSitter)
- Vehicle Setup#3 (Driver+Solo+Couple)
- Vehicle Setup#4 (Multiple Setups)

Also be sure to see [these example notecards](avsitter2_avpos.md#example-notecards).

### AVprop Examples
These [AVprop](avsitter2_prop.md) examples are provided in the Plugins [BOX], inside the main AVsitter2 package:

- [AV]prop Example#01 (single sitter)
- [AV]prop Example#02 (all sitters in one prim)
- [AV]prop Example#03 (table)
- [AV]prop Example#04 (shelf)
- [AV]prop Example#05 (drink dispenser)

### AVfaces Examples
These [AVfaces](avsitter2_faces.md) examples are provided in the Plugins [BOX], inside the main AVsitter2 package:

- [AV]faces Example#01 (single sitter)
- [AV]faces Example#02 (multiple sitters in one prim)

### AVcontrol Examples
See the [AVcontrol instructions](avsitter2_control.md) for a list of AVcontrol examples.

## LuaSitter notes

- The examples box is part of the AVsitter package and is not included with LuaSitter. The example notecards work with LuaSitter scripts, because the notecard format is unchanged (replace the `[AV]` scripts with the matching `[LS]` scripts).
