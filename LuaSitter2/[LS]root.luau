--[[
  [LS]root - Activate setups in child prims by touching the root
  LuaSitter: SLua port of AVsitter(TM) [AV]root. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  Goes in the root prim when the sitter scripts live in child prims. Touching
  the root sends 90005 (show menu) to the other prims, unless the root prim
  has its own [LS]sit or [LS]menu script (they handle the touch themselves).
  Same behaviour as [AV]root; only the script names changed.
]]

local script_basename = "[LS]sit"
local menu_script = "[LS]menu"

LLEvents:on("touch_end", function(events: {DetectedEvent})
    if ll.GetInventoryType(script_basename) ~= INVENTORY_SCRIPT and ll.GetInventoryType(menu_script) ~= INVENTORY_SCRIPT then
        ll.MessageLinked(LINK_ALL_OTHERS, 90005, "", tostring(events[1]:getKey()))
    end
end)
