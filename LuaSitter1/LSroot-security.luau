--[[
  LSroot-security - touch/sit access control (ALL / OWNER ONLY / GROUP ONLY)
  LuaSitter: SLua port of AVsitter(TM) Root-Security (AVsitter1). Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  Optional, in the root prim (replaces AVsitter1 "Root-Security").
  Touches are forwarded as 90005 only for allowed avatars; avatars that are
  not allowed are unseated. A BUTTON whose text is "[SECURITY]" (owner only)
  cycles the setting, announced with link message 0.

  Not merged with LSroot (alternative scripts) nor with LSsit (optional
  feature, and it lives in the root prim, not necessarily the sitter prim).

  Behaviour change: the 2 s delay before unseating uses LLTimers instead of
  llSleep (each refused avatar still waits 2 s more than the previous one).
  An avatar is scheduled once (not again on each later link change), and is
  only unseated if it is still sitting on this object when its time comes.
]]

local SECURITY_TYPES = { "ALL", "OWNER ONLY", "GROUP ONLY" }
local security_index = 1

local function pass_security(id: uuid): boolean
    local SECURITY_TYPE = SECURITY_TYPES[security_index]
    if SECURITY_TYPE == "ALL" then
        return true
    elseif SECURITY_TYPE == "GROUP ONLY" and ll.SameGroup(id) then
        return true
    end
    return tostring(id) == tostring(ll.GetOwner())
end

local function refusal(): string
    return "Sorry, the owner of this object has set the menu to: " .. SECURITY_TYPES[security_index]
end

LLEvents:on("touch_end", function(events: { DetectedEvent })
    local id = events[1]:getKey()
    if pass_security(id) then
        ll.MessageLinked(LINK_SET, 90005, "", tostring(id))
    else
        ll.InstantMessage(id, refusal())
    end
end)

LLEvents:on("link_message", function(_sender: number, num: number, msg: string, id: string)
    local uid = touuid(id) or NULL_KEY
    if msg == "[SECURITY]" then
        if id == tostring(ll.GetOwner()) then
            security_index = security_index % #SECURITY_TYPES + 1
            ll.MessageLinked(LINK_SET, 0, SECURITY_TYPES[security_index], "")
            ll.InstantMessage(uid, "Security set to: " .. SECURITY_TYPES[security_index])
        else
            ll.InstantMessage(uid, "Sorry, only the owner can change this.")
        end
        ll.MessageLinked(LINK_SET, 90005, "", id)
    elseif num == 90060 and pass_security(uid) then
        ll.MessageLinked(LINK_SET, 90005, "", id)
    end
end)

-- refused avatars waiting to be unseated (avatar key -> true)
local unsit_pending: {[string]: boolean} = {}

-- is the avatar still sitting on this object?
local function seated(av: uuid): boolean
    local i = ll.GetNumberOfPrims()
    while ll.GetAgentSize(ll.GetLinkKey(i)) ~= ZERO_VECTOR do
        if ll.GetLinkKey(i) == av then
            return true
        end
        i -= 1
    end
    return false
end

LLEvents:on("changed", function(change: number)
    if bit32.btest(change, CHANGED_LINK) then
        local i = ll.GetNumberOfPrims()
        local delay = 0
        while ll.GetAgentSize(ll.GetLinkKey(i)) ~= ZERO_VECTOR do
            local av = ll.GetLinkKey(i)
            local avs = tostring(av)
            -- an avatar already waiting is not scheduled again: upstream's llSleep
            -- had unseated it before the next link change was handled
            if not pass_security(av) and not unsit_pending[avs] then
                delay += 2
                local text = refusal()
                unsit_pending[avs] = true
                LLTimers:once(delay, function()
                    unsit_pending[avs] = nil
                    -- only if still sitting here (llUnSit can unseat from another object on owned land)
                    if seated(av) then
                        ll.UnSit(av)
                        ll.InstantMessage(av, text)
                    end
                end)
            end
            i -= 1
        end
    end
end)
