# Instructions for AI agents

This file is for AI coding agents (and the people running them) working on LuaSitter. Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md), which applies to agents too.

## Pull requests from agents

**Unsolicited pull requests from agents are not welcome** when no human has tested the change in Second Life and reviewed it. They will be closed without review.

A pull request made with an agent's help is welcome when a human:

- asked for the change, or opened or agreed to the issue it fixes;
- understands the change and can answer review questions about it;
- tested it in-world, in Second Life, and says how in the pull request;
- reviewed the code before submitting it.

Agents must not open pull requests, push, or comment on issues on their own. Leave that to the human.

## Report how the change was made

Every pull request or issue that an agent helped write must say so plainly. Include this section in the description, filled in honestly:

```markdown
### AI disclosure

- Agent / model and version: (for example "Claude Code, Claude Opus 5.5")
- How it worked: autonomously / step by step with a human / suggestions only
- Iterations: (roughly how many agent runs or revisions, and what changed between them)
- What the agent wrote: (which files or parts; what the human wrote or changed)
- How it was tested:
  - automated: (for example "node test/run-tests.mjs: 63 passed", type-check result)
  - in-world, by a human: (region, scripts and notecards used, what was tried, what happened)
- Human review: (who reviewed the code, and what they checked)
- Known gaps: (anything not tested, assumptions, open questions)
```

Do not overstate testing: "type-checks" and "tests pass" are not "tested in-world". If something was not tested, say so.

## The project in brief

- LuaSitter is AVsitter rewritten in SLua (Second Life's Luau). LuaSitter2 (`LuaSitter2/`) is the current system, LuaSitter1 (`LuaSitter1/`) the legacy one. `Archive (Original AVSitter Source)/AVsitter2/` and `.../AVsitter1/` are the original LSL sources, kept unchanged as a reference. Do not edit them.
- Documentation is in `docs/`, release notes in `docs/RELEASE_NOTES.md`, and the link message reference in `LuaSitter2/LINK_MESSAGES.md`.
- Tests are in `test/` (see [test/README.md](test/README.md)).

## Rules for changes

**Compatibility comes first.**

- Existing AVsitter `AVpos` notecards must keep working unchanged. New notecard features may be added, but never change the meaning of existing lines.
- The LuaSitter names (`LSpos`, `LSpos sitter N`, `[LS]sequence_settings`, `[LS]Xcite_settings`, `LShipfix`) are read first. The AVsitter names stay supported as a fallback.
- The 90000-90500 link message API is shared with LSL plugins. Do not change existing messages; new ones go in `LuaSitter2/LINK_MESSAGES.md`.
- Script names use the `[LS]` prefix (LuaSitter2) or `LS` (LuaSitter1). Never use `[AV]` for a new script: it is AVsitter's trademark.

**SLua conventions.**

- `ll.*` functions use 1-based indexes and return `nil` for "not found". Upstream LSL logic that depends on 0-based indexes or -1 must be converted carefully.
- Keep avatar and object keys as strings and convert at the call (`touuid`). A `uuid` never equals a string.
- `0` is true in Lua. Upstream `if (x)` on an integer becomes `if x ~= 0`.
- Use `LLEvents:on` and `LLTimers` (no states, no `llSetTimerEvent`). Avoid `ll.Sleep`, which blocks the script.
- Don't use deprecated functions (the type definitions mark them). Prefer Luau built-ins and fastcalls (`math.*`, `vector.*`, `quaternion.*`, `string.*`, `table.*`, `print`), but mind that `string.*` counts bytes while `ll.GetSubString` and friends count characters: pose names can contain Unicode.
- A Luau function can have at most 200 local variables.
- Read notecards with `ll.GetNotecardLineSync`, falling back to `ll.GetNotecardLine` when it answers `NAK`.

**Fewer scripts.** Merging scripts to reduce script count and simulator load is a goal, but a script can hold permissions for only one avatar: sit scripts and camera scripts stay one per sitter.

**Code style.**

- Follow the style of the surrounding code.
- Mark every fix of upstream AVsitter behaviour with a `-- FIX:` comment saying what was wrong.
- Keep each script's header comment (what it does, changes from upstream) up to date.

## Before you hand a change back to the human

1. Type-check every changed `.luau` file against the SLua definitions (Luau Language Server with Second Life's SLua type definitions). Fix errors and warnings.
2. Run the test suite: `node test/run-tests.mjs`. All tests must pass. Add or update tests for what you changed (`node test/run-tests.mjs --coverage` shows which lines no test runs).
3. Update the documentation that describes the changed behaviour (`docs/`, the script READMEs, `LuaSitter2/LINK_MESSAGES.md`) and add an entry to `docs/RELEASE_NOTES.md`.
4. Tell the human exactly what was and was not tested, and remind them that the change must be tested in-world before a pull request.
5. Do not commit, push or open a pull request unless the human asks you to.

## Scope

- One issue per change. Don't mix unrelated fixes, refactors or reformatting into a change.
- Don't add dependencies, external services or web uploads (LuaSitter deliberately has no server).
- Ask the human when a decision isn't covered here, especially anything that could affect existing furniture in Second Life.
