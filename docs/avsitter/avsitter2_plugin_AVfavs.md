# The AVfavs plugin

> **LuaSitter note:** This page is from the [AVsitter documentation](https://avsitter.github.io) (CC BY-SA 4.0, see [LICENSE](../LICENSE.md)), adapted for LuaSitter. Everything here applies to LuaSitter2: the AVpos notecard format and the link messages are unchanged. LuaSitter also reads the notecard under its new name, `LSpos` (preferred for new furniture). Script names differ: `[AV]name` is `[LS]name` in LuaSitter, and `[AV]sitA` + `[AV]sitB` are one script, `[LS]sit`. See [Migrating from AVsitter](../luasitter/migrating-from-avsitter.md) and the [LuaSitter notes](#luasitter-notes) at the end of this page.

# [AV]favs

`[AV]favs`, available since version 2.2r04, gives the user the ability to manage a list of their favorite poses in an engine. The use is simple: we can add the current pose to our favorites list, delete the current pose, and show a menu to select a pose to play among our favorites (select favorite menu).

It is set up through linked messages, so we need to use either the `BUTTON` or `ADJUST` commands. Below you can see some examples of how to implement the `[AV]favs` plugin.

## Example 1

We want to add all the buttons under a `FAVORITES` submenu. Snippet of the `AVpos` notecard:

```
TOMENU FAVORITES

...

MENU FAVORITES

BUTTON Add Fav|90401
BUTTON Del Fav|90402
BUTTON Favorites...|90403
```

## Example 2

We want to add the add favorite and delete favorite buttons under the `[ADJUST]` menu, and the select favorite menu as a `BUTTON` on the main menu. Snippet of the `AVpos` notecard:

```
ADJUST Add Fav|90401|Del Fav|90402

...

BUTTON Favorites...|90403
```

## Example 3

We want to add all three buttons under the `[ADJUST]` menu. Snippet of the `AVpos` notecard:

```
ADJUST Add Fav|90401|Del Fav|90402|Favorites...|90403
```

Summarizing, these are the message codes the plugin expects:

- 90401: Adds a favorite
- 90402: Deletes a favorite
- 90403: Shows the favorites menu

## LuaSitter notes

- Favourites are part of `[LS]plugins` (together with props and sequences). The BUTTON lines (90401, 90402, 90403) are unchanged.
- Favourites are kept in memory only, as before. In LuaSitter they are also cleared when the AVpos or sequence notecard is changed, because that reloads `[LS]plugins`.
