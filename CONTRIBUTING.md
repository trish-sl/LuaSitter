# Contributing to LuaSitter

Thanks for helping improve LuaSitter. Please read these guidelines before you open a pull request.

## Issues and pull requests

- **Open an issue for every pull request.** Describe the bug or the feature in the issue first, then link the issue from your pull request (for example `Fixes #12`). That way the problem and its fix can be discussed separately.
- **One issue per pull request.** Keep unrelated fixes and features in separate pull requests, each linked to its own issue. A pull request that mixes several changes is hard to review and test, and may be asked to be split up.
- Keep pull requests focused: avoid unrelated reformatting, renames or clean-up in the same change.

## Testing in-world

**Every proposed change must have been tested in-world by a human** before the pull request is opened. Type-checking and code review are not enough: Second Life behaviour (permissions, sitting, animations, notecard caching, timing) can only be confirmed in-world.

In your pull request, say how you tested:

- which scripts and notecards you used, and on which region (SLua is not enabled everywhere);
- what you did (for example: sat two avatars, swapped, used [ADJUST], ran DUMP);
- what you expected and what happened.

If a change affects notecard reading, also confirm that an existing AVsitter `AVpos` notecard still works unchanged. Compatibility with existing notecards and with LSL plugins that use the link message API is a core goal of LuaSitter.

## Use of AI tools

Using AI tools (code assistants, chatbots and similar) is acceptable, as long as:

- **you understand the change.** You must be able to explain what every line you submit does and answer review questions about it yourself;
- **the change is justified.** The pull request explains why the change is needed, linked to its issue;
- **the change is explained.** The pull request description says what changed and why, in your own words;
- **it was tested in-world by a human**, as described above. AI-generated code that has not been run in Second Life will not be accepted.

Unsolicited pull requests made by AI agents without human testing and review are not welcome. Pull requests made with an agent must say how the agent was used (model, autonomy, iterations, testing). See [AGENTS.md](AGENTS.md) for the details and a disclosure template.

## Code style

- Scripts are SLua (`.luau`). Type-check them against the SLua definitions (for example with the Luau Language Server and Second Life's SLua type definitions) and fix any errors before submitting.
- Follow the style of the surrounding code.
- Mark fixes of upstream AVsitter behaviour with a `-- FIX:` comment explaining what was wrong.
- Run the automated tests with `node test/run-tests.mjs` (see [test/README.md](test/README.md)) and add tests for what you change. Passing tests do not replace testing in-world.
- Update the documentation in [docs/](docs/) and the script READMEs when behaviour changes, and add an entry to [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md).

## License

By contributing, you agree that your contributions are licensed under the [Mozilla Public License Version 2.0](https://www.mozilla.org/en-US/MPL/2.0/), the same license as the rest of LuaSitter. You can add yourself to [AUTHORS.md](AUTHORS.md).
