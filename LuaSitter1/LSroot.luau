--[[
  LSroot - forwards root-prim touches to the sitter scripts
  LuaSitter: SLua port of AVsitter(TM) Root (AVsitter1). Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  Optional, in the root prim when the sitter scripts are in a child prim
  (replaces AVsitter1 "Root"). A touch on the root prim sends
  90005 (touch duration, toucher) to the other prims. Does nothing when a
  sitter script ("LSsit", or an LSL "AVsit") is in the root prim itself.

  Not merged with LSroot-security: they are alternatives (the security one
  always forwards, to LINK_SET, after a permission check).
]]

local SITTER_SCRIPTS = { "LSsit", "AVsit" }
local touch_start_time = 0

local function hasSitterScript(): boolean
    for _, n in SITTER_SCRIPTS do
        if ll.GetInventoryType(n) == INVENTORY_SCRIPT then
            return true
        end
    end
    return false
end

LLEvents:on("touch_start", function(_events: { DetectedEvent })
    touch_start_time = ll.GetTime()
end)

LLEvents:on("touch_end", function(events: { DetectedEvent })
    if ll.GetLinkNumber() == 1 and not hasSitterScript() then
        local held = string.format("%.6f", ll.GetTime() - touch_start_time)
        ll.MessageLinked(LINK_ALL_OTHERS, 90005, held, tostring(events[1]:getKey()))
    end
end)
