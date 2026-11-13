--[[
  [LS]object - Used in props for attaching, derezzing, etc.
  LuaSitter: SLua port of AVsitter(TM) [AV]object. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does:
    Goes inside each prop object. When rezzed by [LS]plugins (or the LSL [AV]prop)
    it decodes the start parameter (channel, prop id, attach point, prop type),
    reports REZ/ATTACHED/DETACHED/DEREZ, attaches itself to the sitter for
    PROP1/PROP2 (experience, falling back to a permission request), and derezzes
    or detaches on REM_ALL / REM_INDEX / REM_WORLD / REM_WORN. The chat protocol
    is byte-identical to upstream, so it works with an LSL [AV]prop too.

  Replaces: [AV]object (stays a separate script: it lives in a different object).

  LSL states are emulated: "default" does nothing until rezzed with a non-zero
  start parameter; then enterPropState() acts as "state prop" (and as the
  "restart_prop" round trip), clearing listens and timers like a state change.

  Behaviour changes:
    - PR #32 / issue #17: when waiting for the sitter's attach permission, the
      prop gives up after 120 s, says DEREZ and dies if it is not attached.
      Implemented as a separate LLTimers one-shot, so (unlike the LSL PR) the
      10 s "rezzer gone" watchdog keeps running after the prop is attached.
    - The "rezzer gone" watchdog now also says DEREZ before dying (PR #32).
    - "Is there a sit script" accepts "[LS]sit" or the LSL "[AV]sitA".
    - Removing a prop that avatars sit on waits 1 s after unseating them on a
      timer (upstream: llSleep(1)) before it says DEREZ and dies.
]]

local local_attach_channel = -2907539

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

local function isKey(s: string?): boolean
    return s ~= nil and s ~= "" and s ~= tostring(NULL_KEY) and touuid(s) ~= nil
end

local function int(v: any): number
    if type(v) == "number" then
        return if v >= 0 then math.floor(v) else math.ceil(v)
    end
    local s = tostring(v or "")
    return tonumber(string.match(s, "^%s*([-+]?%d+)")) or 0
end

local function L(t: {any}, i: number): string
    local v = t[i]
    if v == nil then
        return ""
    end
    return tostring(v)
end

--------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------
local comm_channel = 0
local prop_type = 0
local prop_id = 0
local prop_point = 0
local experience_denied_reason = 0
local pending_permissions = false
local originalowner = ""
local parentkey = tostring(NULL_KEY)

local inPropState = false
local listens: {number} = {} -- every listen opened in "state prop"
local watchTimer: any = nil -- 10 s rezzer watchdog
local permTimer: any = nil -- 120 s permission response timeout (PR #32)
local touchHandler: any = nil

local function attached(): boolean
    return ll.GetAttached() ~= 0
end

local function sayDerezAndDie()
    ll.Say(comm_channel, "DEREZ|" .. tostring(prop_id))
    ll.Die()
end

local function unsit_all()
    local i = ll.GetNumberOfPrims()
    while i > 0 and ll.GetAgentSize(ll.GetLinkKey(i)) ~= ZERO_VECTOR do
        ll.UnSit(ll.GetLinkKey(i))
        i -= 1
    end
end

local function stopPermTimer()
    if permTimer then
        LLTimers:off(permTimer)
        permTimer = nil
    end
end

-- give them 2 minutes to reply to the permission request
local function startPermTimer()
    stopPermTimer()
    permTimer = LLTimers:once(120, function()
        permTimer = nil
        if pending_permissions then
            if not attached() then
                sayDerezAndDie()
            else
                ll.RequestPermissions(ll.GetOwner(), PERMISSION_ATTACH)
            end
        end
    end)
end

local function attachOrDetach()
    if attached() then
        ll.DetachFromAvatar()
    else
        ll.AttachToAvatarTemp(prop_point)
    end
end

local function onTouch(events: {DetectedEvent})
    if not inPropState then
        return
    end
    if not attached() and (prop_type == 2 or prop_type == 1) then
        ll.RequestExperiencePermissions(events[1]:getKey(), "")
    end
end

-- LSL "state prop" state_entry (also reached through "state restart_prop")
local function enterPropState()
    -- state change: drop listens and timers
    for _, h in listens do
        ll.ListenRemove(h)
    end
    listens = {}
    if watchTimer then
        LLTimers:off(watchTimer)
        watchTimer = nil
    end
    stopPermTimer()
    pending_permissions = false
    inPropState = true
    if touchHandler == nil then
        touchHandler = LLEvents:on("touch_start", onTouch)
    end

    local start = ll.GetStartParameter()
    if ll.GetLinkNumber() < 2 then
        if start <= -10000000 then
            local start_param = tostring(start)
            prop_type = int(ll.GetSubString(start_param, -1, -1))
            prop_point = int(ll.GetSubString(start_param, -3, -2))
            prop_id = int(ll.GetSubString(start_param, -5, -4))
            comm_channel = int(ll.GetSubString(start_param, 1, -6))
            table.insert(listens, ll.Listen(comm_channel, "", NULL_KEY, ""))
            ll.Say(comm_channel, "REZ|" .. tostring(prop_id))
        end
    end
    if prop_type ~= 2 and prop_type ~= 1 then
        if ll.GetInventoryType("[LS]sit") == INVENTORY_NONE and ll.GetInventoryType("[AV]sitA") == INVENTORY_NONE then
            ll.SetClickAction(-1)
        end
    else
        ll.SetClickAction(CLICK_ACTION_TOUCH)
    end

    local rezzer = ll.GetObjectDetails(ll.GetKey(), {OBJECT_REZZER_KEY})[1]
    parentkey = if rezzer ~= nil then tostring(rezzer) else tostring(NULL_KEY)

    local parentPoint = ll.GetObjectDetails(K(parentkey), {OBJECT_ATTACHED_POINT})[1]
    if start ~= 0 and int(parentPoint or 0) == 0 then
        watchTimer = LLTimers:every(10, function()
            if ll.GetObjectMass(K(parentkey)) == 0 then
                if not attached() then
                    sayDerezAndDie()
                else
                    ll.RequestPermissions(ll.GetOwner(), PERMISSION_ATTACH)
                end
            end
        end)
    end
end

--------------------------------------------------------------------------
-- Events
--------------------------------------------------------------------------
LLEvents:on("on_rez", function(start: number)
    if not inPropState then
        -- state default
        if start ~= 0 then
            enterPropState()
        end
    elseif not attached() then
        -- state prop -> state restart_prop -> state prop
        enterPropState()
    end
end)

LLEvents:on("attach", function(id: uuid)
    if not inPropState or comm_channel == 0 then
        return
    end
    if isKey(tostring(id)) then
        stopPermTimer()
        pending_permissions = false
        table.insert(listens, ll.Listen(local_attach_channel, "", NULL_KEY, ""))
        ll.Say(comm_channel, "ATTACHED|" .. tostring(prop_id))
        ll.Say(local_attach_channel, "LOCAT|" .. tostring(ll.GetAttached()))
        if experience_denied_reason == XP_ERROR_NOT_PERMITTED_LAND then
            if tostring(ll.GetOwner()) == originalowner then
                local details = ll.GetExperienceDetails(NULL_KEY)
                if int(details[4]) == XP_ERROR_NOT_PERMITTED_LAND then
                    ll.Say(comm_channel, "NAG|" .. L(details, 1))
                end
            end
        end
    else
        ll.Say(comm_channel, "DETACHED|" .. tostring(prop_id))
    end
end)

LLEvents:on("run_time_permissions", function(permissions: number)
    if not inPropState then
        return
    end
    if bit32.band(permissions, PERMISSION_ATTACH) ~= 0 then
        attachOrDetach()
    else
        sayDerezAndDie()
    end
end)

LLEvents:on("experience_permissions", function(_target: uuid)
    if not inPropState then
        return
    end
    attachOrDetach()
end)

LLEvents:on("experience_permissions_denied", function(agent: uuid, reason: number)
    if not inPropState then
        return
    end
    originalowner = tostring(ll.GetOwner())
    experience_denied_reason = reason
    ll.RequestPermissions(agent, PERMISSION_ATTACH)
    if pending_permissions then
        startPermTimer() -- restart the 2 minute wait for the fallback dialog
    end
end)

LLEvents:on("listen", function(_channel: number, _name: string, id: uuid, message: string)
    if not inPropState then
        return
    end
    local data = ll.ParseString2List(message, {"|"}, {})
    local command = L(data, 1)
    if command == "LOCAT" and ll.GetOwnerKey(id) == ll.GetOwner() and L(data, 2) == tostring(ll.GetAttached()) then
        ll.RequestPermissions(ll.GetOwner(), PERMISSION_ATTACH)
    elseif command == "ATTACHTO" and prop_type == 1 and L(data, 3) == tostring(ll.GetKey()) then
        if ll.GetAgentSize(K(L(data, 2))) == ZERO_VECTOR then
            sayDerezAndDie()
        else
            ll.RequestExperiencePermissions(K(L(data, 2)), "")
            pending_permissions = true
            startPermTimer()
        end
    elseif string.sub(command, 1, 4) == "REM_" then
        local remove = false
        if command == "REM_ALL" then
            remove = true
        elseif command == "REM_INDEX" or (command == "REM_WORLD" and not attached()) then
            if table.find(data, tostring(prop_id)) then
                remove = true
            end
        elseif attached() and command == "REM_WORN" and L(data, 2) == tostring(ll.GetOwner()) then
            remove = true
        end
        if remove then
            if attached() then
                ll.RequestPermissions(ll.GetOwner(), PERMISSION_ATTACH)
            else
                if ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) ~= ZERO_VECTOR then
                    unsit_all()
                    LLTimers:once(1, sayDerezAndDie) -- upstream: llSleep(1)
                else
                    sayDerezAndDie()
                end
            end
        end
    elseif message == "PROPSEARCH" and not attached() then
        ll.Say(comm_channel, "SAVEPROP|" .. tostring(prop_id))
    end
end)
