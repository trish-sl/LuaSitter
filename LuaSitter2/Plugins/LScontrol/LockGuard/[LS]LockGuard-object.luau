--[[
  [LS]LockGuard-object - Allows props to be used as chain targets
  LuaSitter: SLua port of AVsitter(TM) [AV]LockGuard-object. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  Placed in prop objects (used with [LS]LockGuard and USES_PROPS = true, or
  [LS]chains with PROPS 1), this script sends the uuid of any LockGuard rings
  to the script in the furniture.
  Ring prims in the prop should be named with "ring" in their prim name,
  e.g. "ring1", "ring2".

  Protocol unchanged: listens for "INFORM" on -57841689 when rezzed with a
  start parameter, answers "ATTACHPOINTS|name|key|name|key...".
  FIX: sitting avatars whose name contains "ring" are no longer reported.
]]

local COMM_CHANNEL = -57841689
local comm_handle = 0

local function findPrimsWithSubstring(name: string): {string}
    local found = {}
    local index = if ll.GetLinkNumber() ~= 0 then 1 else 0
    local number = ll.GetNumberOfPrims() + index
    while index <= number do
        local key = ll.GetLinkKey(index)
        if ll.GetAgentSize(key) == ZERO_VECTOR then
            local prim_name = ll.GetLinkName(index)
            if string.find(ll.ToLower(prim_name), name, 1, true) then
                table.insert(found, prim_name)
                table.insert(found, tostring(key))
            end
        end
        index += 1
    end
    return found
end

LLEvents:on("on_rez", function(_start: number)
    if ll.GetStartParameter() == 0 then
        return
    end
    comm_handle = ll.Listen(COMM_CHANNEL, "", NULL_KEY, "INFORM")
end)

LLEvents:on("listen", function(_channel: number, _name: string, _id: uuid, _msg: string)
    local found = findPrimsWithSubstring("ring")
    table.insert(found, 1, "ATTACHPOINTS")
    ll.Say(COMM_CHANNEL, table.concat(found, "|"))
    ll.ListenRemove(comm_handle)
end)
