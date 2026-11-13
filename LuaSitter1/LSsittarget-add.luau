--[[
  LSsittarget-add - sit target for an extra sitting prim
  LuaSitter: SLua port of AVsitter(TM) Sittarget-Add (AVsitter1). Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  Put one in each extra prim people should be able to sit on, in a linkset
  whose LSsit scripts live in another prim (replaces AVsitter1
  "Sittarget-Add"). The prims announce themselves (90190 "starget") and are
  sorted by link number; the N-th prim takes the sit target of "LSsit N"
  (sitter N >= 1), which that script broadcasts with 90180 after reading
  LSpos (or AVpos), so the avatar lands close to its first pose.
  It does nothing in a prim that holds a sitter script ("LSsit"/"AVsit").

  Not merged: it lives in different prims than every other script, and it
  is not a one-off tool (it re-applies the sit target every time the LSsit
  scripts re-read the pose notecard).
]]

local SITTER_SCRIPTS = { "LSsit", "AVsit" }
local sittarget_scripts: { number } = {}

local function num(v: any): number
    local s = tostring(v or "")
    return tonumber(string.match(s, "^%s*([-+]?%d*%.?%d+[eE][-+]?%d+)") or string.match(s, "^%s*([-+]?%d*%.?%d+)") or "") or 0
end

local function lslVec(s: string): vector
    local a, b, c = string.match(s, "^%s*<([^,]*),([^,]*),([^,>]*)")
    if not a then
        return ZERO_VECTOR
    end
    return vector(num(a), num(b), num(c))
end

local function hasSitterScript(): boolean
    for _, n in SITTER_SCRIPTS do
        if ll.GetInventoryType(n) == INVENTORY_SCRIPT then
            return true
        end
    end
    return false
end

LLEvents:on("link_message", function(sender: number, n: number, msg: string, id: string)
    if hasSitterScript() then
        return
    end
    if n == 90190 and msg == "starget" then
        if not table.find(sittarget_scripts, sender) then
            table.insert(sittarget_scripts, sender)
            table.sort(sittarget_scripts)
        end
    end
    if n == 90180 and sender ~= ll.GetLinkNumber() then
        local sender_channel = tonumber(string.match(msg, "^%s*([-+]?%d+)")) or 0
        local data = ll.ParseString2List(id, { "|" }, {})
        local my_index = (table.find(sittarget_scripts, ll.GetLinkNumber()) or 0) - 1
        if sender_channel - 1 == my_index then
            -- orient this prim's sit target like the first pose of that sitter
            local original_local_target_pos = lslVec(data[1] or "") - vector(0, 0, 0.35)
            local original_local_target_rot = ll.Euler2Rot(lslVec(data[2] or "") * DEG_TO_RAD)
            local world_avsit_prim_pos = (ll.GetObjectDetails(ll.GetLinkKey(sender), { OBJECT_POS })[1] or ZERO_VECTOR) :: vector
            local local_avsit_prim_pos = (world_avsit_prim_pos - ll.GetRootPosition()) / ll.GetRootRotation()
            local localrot = ZERO_ROTATION
            local localpos = ZERO_VECTOR
            if ll.GetLinkNumber() > 1 then
                localrot = ll.GetLocalRot()
                localpos = ll.GetLocalPos()
            end
            local final_local_target_pos = local_avsit_prim_pos + original_local_target_pos + vector(0, 0, 0.35)
            local my_target_pos = (final_local_target_pos - localpos) / localrot - vector(0, 0, 0.4)
            local my_target_rot = original_local_target_rot / localrot
            ll.SitTarget(my_target_pos, my_target_rot)
        end
    end
end)

-- init (state_entry)
if not hasSitterScript() then
    ll.SitTarget(vector(0, 0, 0.01), ZERO_ROTATION)
    ll.MessageLinked(LINK_SET, 90190, "starget", "")
end
