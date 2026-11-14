# Writing plugins in Lua

LuaSitter scripts talk to plugins with link messages, exactly like AVsitter. You can keep using LSL plugins, or write new ones in SLua. This page shows the SLua side; the messages themselves are described in [LSL Scripting](../avsitter/avsitter2_scripting.md) and the complete [link message reference](../../LuaSitter2/LINK_MESSAGES.md).

> The SLua examples on this page are dedicated to the Public Domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). They type-check against Second Life's SLua type definitions, but test them in-world before use.

## SLua differences to keep in mind

- Handle link messages with `LLEvents:on("link_message", function(sender, num, msg, id) ... end)`.
- In SLua the 4th link message parameter (`id`) is a **string**, not a key. Convert it with `touuid(id)` before passing it to functions that need a key (`ll.Key2Name`, `ll.RegionSayTo`, `ll.Dialog`, ...). Comparing a `uuid` with a string is always false, so compare strings with strings: `tostring(ll.GetOwner()) == id`.
- `ll.MessageLinked(link, num, msg, id)` accepts a string as `id`. LSL scripts receive it as a key.
- Lists are Lua tables and start at index 1. `string.split(msg, "|")` splits a message; field 0 in the LSL reference is `data[1]` here.
- `0` is true in Lua: write `if count ~= 0 then`, not `if count then`.
- There is no `llSetTimerEvent`; use `LLTimers:once(seconds, fn)` or `LLTimers:every(seconds, fn)`.

## Custom greeting

Say hello and goodbye to sitters (messages 90060 and 90065).

```lua
-- Custom greeting: say hello and goodbye to sitters.
-- 90060 = a new sitter sat, 90065 = a sitter left. The 4th parameter is the avatar key (a string in SLua).
LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if num == 90060 then
        ll.Say(0, "Welcome, " .. ll.Key2Name(touuid(id) or NULL_KEY))
    elseif num == 90065 then
        ll.Say(0, "Goodbye, " .. ll.Key2Name(touuid(id) or NULL_KEY))
    end
end)
```

## Show the pose name

Message 90045 is sent every time a pose plays. Its fields are `SITTER|POSE|ANIMATION|SET|SITTERS|OLD_SYNC|IS_SYNC`.

```lua
-- Tell a sitter which pose is playing, using 90045 (pose info broadcast by [LS]sit).
LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if num == 90045 then
        local data = string.split(msg, "|")
        local sitter = tonumber(data[1]) or 0
        local pose = data[2] or ""
        local isSync = data[7] == "1"
        local avatar = touuid(id) or NULL_KEY
        ll.RegionSayTo(avatar, 0, `Sitter {sitter} is now playing "{pose}"` .. (if isSync then " (sync)" else ""))
    end
end)
```

## Custom menu button

A `BUTTON` line in the `LSpos` (or `AVpos`) notecard sends a link message with the number you choose.

```lua
-- Custom menu button. In the LSpos (or AVpos) notecard:
--     BUTTON Lights|500
-- pressing "Lights" sends link message 500 with msg = "Lights" and id = the avatar key
-- (or "controller|sitter" when someone controls another sitter's menu).
local lightsOn = false

LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if num == 500 then
        lightsOn = not lightsOn
        ll.SetLinkPrimitiveParamsFast(LINK_THIS, { PRIM_POINT_LIGHT, lightsOn, vector(1, 1, 1), 1, 10, 0.75 })
        -- give the menu back to the person who pressed the button
        local controller = string.split(id, "|")[1]
        ll.MessageLinked(LINK_SET, 90005, "", controller)
    end
end)
```

## Play a pose from a script

Message 90000 plays a pose. An empty target plays it for all sitters, an avatar key for that avatar, and a number for that SITTER.

```lua
-- Play a pose for everyone when this prim is touched (90000 with an empty target = all sitters).
LLEvents:on("touch_start", function(events: {DetectedEvent})
    ll.MessageLinked(LINK_SET, 90000, "Cuddle", "")
end)
```
