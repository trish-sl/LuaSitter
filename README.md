# LuaSitter

LuaSitter is a furniture pose system for [Second Life](https://www.secondlife.com)&reg;, written in [SLua](https://suzanna-linn.github.io/slua/) (Second Life's Luau scripting language).

It is derived from the source code of [AVsitter](https://avsitter.github.io)&trade; and is a rewrite of it for Lua. LuaSitter is not affiliated with or endorsed by the AVsitter project.

## Why a Lua rewrite?

The goal of LuaSitter is to **reduce script time and load on the simulator** while keeping existing furniture working and compatible:

- **Lua instead of LSL.** SLua scripts run on the Luau VM, which is faster and uses memory more efficiently than LSL/Mono.
- **Fewer scripts.** LSL scripts are limited to 64 KB of memory, which forced AVsitter to split features across several scripts that talk to each other through link messages. SLua scripts have more memory, so LuaSitter merges those scripts wherever that's possible. For example, AVsitter2's `[AV]sitA` + `[AV]sitB` pair (two scripts per sitter) is now a single `[LS]sit` per sitter, which halves the core script count. Props, sequences and favourites are one `[LS]plugins` script, and faces and cameras are one `[LS]faces-camera` script. A 2-sitter bed with all of those uses 5 scripts instead of AVsitter2's 10. Fewer scripts means less scheduler overhead, fewer link messages, and less memory per object.
- **Faster loading.** Notecards are read with `ll.GetNotecardLineSync`, which returns cached lines instantly instead of waiting one dataserver event per line. This can make a furniture reset on sim reload near instant instead of taking seconds to minutes.
- **No busy waiting.** No script calls `ll.Sleep`: every upstream `llSleep` (menus, dumps, animation changes, sequences, RLV, props) became an `LLTimers` timer with the same duration and the same order of events.

## Compatibility

- **AVpos notecards are 100% compatible.** An existing `AVpos` notecard works with LuaSitter unchanged. The LuaSitter name for the notecard is `LSpos` (same format), and new furniture should use it; when both exist, `LSpos` is read. The same applies to `[LS]Xcite_settings` / `[AV]Xcite_settings`, `[LS]sequence_settings` / `[AV]sequence_settings` and the `LShipfix` / `AVhipfix` animation. Optional extras such as per-sitter `LSpos sitter 1`, `LSpos sitter 2` notecards are additions only.
- **Link messages are compatible.** The 90000-90500 link message API is preserved, so LSL plugins written for AVsitter2 keep working next to LuaSitter scripts. See [LuaSitter2/LINK_MESSAGES.md](LuaSitter2/LINK_MESSAGES.md).
- **Script names changed.** In line with the AVsitter [trademark guidelines](https://github.com/AVsitter/AVsitter/blob/master/TRADEMARK.mediawiki), LuaSitter scripts use the `[LS]` prefix instead of `[AV]` (for example `[AV]select` became `[LS]select`). Third-party LSL plugins that look up AVsitter scripts by name (for example `"[AV]sitA"`) need that name updated to `"[LS]sit"`.

## Repository layout

| Folder | Contents |
| --- | --- |
| [LuaSitter2/](LuaSitter2/) | SLua port of AVsitter2 (current system). Start with [LuaSitter2/README.md](LuaSitter2/README.md), which explains what each script does and how scripts were merged. |
| [LuaSitter1/](LuaSitter1/) | SLua port of the legacy AVsitter1 system, see [LuaSitter1/README.md](LuaSitter1/README.md). |
| [AVsitter2/](AVsitter2/), [AVsitter1/](AVsitter1/) | The original AVsitter LSL sources, kept unchanged as a reference for the port. |
| [docs/](docs/) | Documentation: the AVsitter user guide, LuaSitter additions, and release notes. |

## Getting started

1. SLua is available only on regions where LL has enabled it. Check the [SLua guide](https://suzanna-linn.github.io/slua/moving-using) for current availability and viewer requirements.
2. Create each script in-world, select **Lua** in the script editor's compiler drop-down, and paste the contents of the matching `.luau` file. Script names must match exactly (for example `[LS]sit`).
3. Follow [LuaSitter2/README.md](LuaSitter2/README.md) for which scripts go where.

The full user guide, including the AVsitter documentation (the notecard format is unchanged) with LuaSitter notes, the migration guide and the release notes, is in [docs/](docs/README.md).

## Developing
Upstream fixes and open pull requests that were folded into LuaSitter are listed in [LuaSitter2/README.md](LuaSitter2/README.md#upstream-fixes-included).

Automated tests for LuaSitter1 and LuaSitter2 run offline with [rezless](https://github.com/i-doll/rezless): `node test/run-tests.mjs` (needs Node.js 22.12 or newer). See [test/README.md](test/README.md). They help catch mistakes, but don't replace testing in-world.

Want to contribute to LuaSitter? Read [CONTRIBUTING.md](CONTRIBUTING.md) first. AI agents (and the people running them): read [AGENTS.md](AGENTS.md).

## AI disclosure

The automated tests in [test/](test/) were mostly written with AI (Claude Opus 5.5). They complement in-world testing by humans; they don't replace it. AI was also used to help review the conversion from LSL and to find bugs.

## License

LuaSitter is licensed under the [Mozilla Public License Version 2.0](https://www.mozilla.org/en-US/MPL/2.0/), the same license as the AVsitter code it is derived from. Each script keeps the original copyright notice of the AVsitter Contributors.

In short: _you must make the source code for any of your changes available under MPL, but you can combine the MPL code with proprietary code, as long as you keep the MPL code in separate files._

## Trademarks

AVsitter&trade; is a trademark of the AVsitter project. LuaSitter is derived from AVsitter software and is not the official AVsitter product. See the [AVsitter Trademark Guidelines](https://github.com/AVsitter/AVsitter/blob/master/TRADEMARK.mediawiki).

---

Second Life&reg; is a trademark of Linden Research, Inc. LuaSitter is not affiliated with or sponsored by Linden Research. Many thanks to the AVsitter contributors, whose work this is built on.
