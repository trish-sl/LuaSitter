--[[
  [LS]helperscript - Setup aid, to move poses by moving an object
  LuaSitter: SLua port of AVsitter(TM) [AV]helperscript. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  Goes in the helper object ("[LS]helper", or a legacy "[AV]helper") that
  [LS]adjuster rezzes, one per sitter. Moving the helper moves the pose; the
  adjuster is told with "MOVED|..." on the shared comm channel.

  The chat protocol with the adjuster is unchanged (REG, POS, MOVED, MENU,
  ANIMA, GETUP, DONE, DONEA, SWAP) and so is the start parameter encoding, so
  this helper works with [LS]adjuster and with the old LSL [AV]adjuster, and
  old [AV]helper objects keep working with [LS]adjuster.

  Behaviour changes: the object keeps its "[AV]helper" base name if it was
  named like that, otherwise it uses "[LS]helper". Product text says LuaSitter.
]]

local VERSION = "3.0-lua1"
local product = "LuaSitter helper"

local NULL = tostring(NULL_KEY)

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

local function isKey(s: string?): boolean
    return s ~= nil and s ~= "" and s ~= NULL and touuid(s) ~= nil
end

local function int(v: any): number
    if type(v) == "number" then
        return if v >= 0 then math.floor(v) else math.ceil(v)
    end
    local s = tostring(v or "")
    local sign, hex = string.match(s, "^%s*([-+]?)0[xX](%x+)")
    if hex then
        local n = tonumber(hex, 16) or 0
        return if sign == "-" then -n else n
    end
    return tonumber(string.match(s, "^%s*([-+]?%d+)")) or 0
end

local function vec(s: any): vector
    if typeof(s) == "vector" then
        return s
    end
    return tovector(tostring(s or "")) or ZERO_VECTOR
end

local function rot(s: any): quaternion
    if typeof(s) == "quaternion" then
        return s
    end
    return torotation(tostring(s or "")) or ZERO_ROTATION
end

local function L(t: {any}, i: number): string
    if i < 0 then
        i = #t + 1 + i
    end
    local v = t[i]
    if v == nil then
        return ""
    end
    return tostring(v)
end

local function startsWith(s: string, p: string): boolean
    return string.sub(s, 1, #p) == p
end

-- LSL (string)vector / (string)rotation format, as the LSL helper sent it
local function lslVec(v: vector): string
    return string.format("<%.5f, %.5f, %.5f>", v.x, v.y, v.z)
end

local function lslRot(r: quaternion): string
    return string.format("<%.5f, %.5f, %.5f, %.5f>", r.x, r.y, r.z, r.s)
end

local timerFn: any = nil
local function setTimer(seconds: number, fn: (number, number) -> ())
    if timerFn then
        LLTimers:off(timerFn)
        timerFn = nil
    end
    if seconds > 0 then
        timerFn = LLTimers:every(seconds, fn)
    end
end

--------------------------------------------------------------------------
local OLD_HELPER_METHOD = 0
local colors = { vector(1, 0.5, 1), vector(0.5, 0.5, 1), vector(1, 0.5, 0.5), vector(0.5, 1, 0.5), vector(1, 1, 0.5), vector(0.5, 1, 1) }
local helper_index = 0
local alpha = 0
local sitter_number = 0
local CURRENT_AV = ""
local comm_channel = 0
local ball_size = vector(0.2, 0.2, 0.2)
local default_size = vector(0.12, 0.12, 3.5)
local my_pos = ZERO_VECTOR
local my_rot = ZERO_ROTATION
local rez_time = 0

-- Accept both helper names: a legacy "[AV]helper" object keeps its name
local function base_object_name(): string
    if startsWith(ll.GetObjectName(), "[AV]helper") then
        return "[AV]helper"
    end
    return "[LS]helper"
end

local function color(i: number): vector
    return colors[(i % #colors) + 1]
end

local function is_original(): boolean
    return ll.GetCreator() == ll.GetInventoryCreator(ll.GetScriptName())
end

local function stop_all_anims()
    if isKey(tostring(ll.AvatarOnSitTarget())) then
        if bit32.band(ll.GetPermissions(), PERMISSION_TRIGGER_ANIMATION) ~= 0 then
            if ll.GetAgentSize(ll.GetPermissionsKey()) ~= ZERO_VECTOR then
                for _, anim in ll.GetAnimationList(ll.GetPermissionsKey()) do
                    ll.StopAnimation(anim)
                end
            end
        end
    end
end

local function set_text()
    local text = "▽"
    local t = "SITTER"
    if ll.GetStartParameter() < -1000000000 then
        t = "PRIM"
    end
    for _ = 1, sitter_number % 5 do
        text ..= "\n \n "
    end
    text = t .. " " .. tostring(helper_index) .. "\n" .. text
    ll.SetText(text, color(helper_index), 1)
end

local function setup()
    alpha = tonumber(ll.GetPrimitiveParams({ PRIM_COLOR, 0 })[2]) or 1
    CURRENT_AV = ""
    local size = default_size
    if not is_original() then
        size = ll.GetScale()
    end
    for _ = 1, sitter_number do
        size -= vector(0.001, 0.001, 0)
    end
    set_text()
    ll.SetObjectName(base_object_name() .. " " .. tostring(helper_index))
    if is_original() then
        ll.SetLinkPrimitiveParamsFast(LINK_THIS, {
            PRIM_TYPE, PRIM_TYPE_BOX, PRIM_HOLE_DEFAULT, vector(0, 1, 0), 0, ZERO_VECTOR, vector(1, 1, 0), ZERO_VECTOR,
            PRIM_TEXTURE, ALL_SIDES, TEXTURE_BLANK, vector(1, 1, 0), ZERO_VECTOR, 0,
            PRIM_COLOR, ALL_SIDES, color(helper_index), alpha,
            PRIM_COLOR, 1, vector(1, 1, 1), alpha,
            PRIM_COLOR, 3, vector(1, 1, 1), alpha,
            PRIM_SIZE, size,
        })
    else
        ll.SetLinkPrimitiveParamsFast(LINK_THIS, { PRIM_COLOR, ALL_SIDES, color(helper_index), alpha, PRIM_SIZE, size })
    end
    ll.RegionSay(comm_channel, "REG|" .. tostring(sitter_number))
end

local function timer_tick()
    if my_pos ~= ll.GetPos() or my_rot ~= ll.GetRot() then
        my_pos = ll.GetPos()
        my_rot = ll.GetRot()
        ll.RegionSay(comm_channel, "MOVED|" .. tostring(sitter_number) .. "|" .. lslVec(my_pos) .. "|" .. lslRot(my_rot))
    elseif ll.GetTime() - rez_time > 86400 then -- auto-remove helper after 1 day
        ll.Die()
    end
end

LLEvents:on("on_rez", function(start: number)
    rez_time = ll.GetTime() -- (ll.ResetTime is not available in SLua)
    ll.SetClickAction(CLICK_ACTION_TOUCH)
    if start == 0 then
        setTimer(0, timer_tick)
        ll.SetText("", vector(1, 1, 1), 1)
        if is_original() then
            ll.SetLinkPrimitiveParamsFast(LINK_THIS, { PRIM_SIZE, ball_size })
        end
    else
        -- LSL integer % and / truncate toward zero
        helper_index = -math.fmod(start, 1000)
        if helper_index == 0 then
            helper_index = 0 -- avoid -0 (would print as "-0")
        end
        sitter_number = helper_index
        if start < -1000000000 then
            helper_index = 0
            sitter_number = 0
        end
        comm_channel = int(start / 1000) * 1000
        ll.Listen(5, "", NULL_KEY, "")
        ll.Listen(comm_channel, "", NULL_KEY, "")
        setup()
    end
end)

LLEvents:on("listen", function(chan: number, _name: string, id: uuid, msg: string)
    if chan == 5 and tostring(id) == CURRENT_AV then
        if isKey(msg) then
            local av = K(msg)
            if ll.GetAgentSize(av) ~= ZERO_VECTOR then
                local avatar_location = ll.GetObjectDetails(av, { OBJECT_POS, OBJECT_ROT })
                local apos = vec(avatar_location[1])
                if vector.magnitude(ll.GetPos() - apos) < 10 then
                    ll.SetLinkPrimitiveParamsFast(LINK_THIS, { PRIM_POSITION, apos, PRIM_ROTATION, rot(avatar_location[2]) })
                else
                    ll.RegionSayTo(id, 0, "Avatar too far away.")
                end
            else
                ll.RegionSayTo(id, 0, "Avatar not found nearby.")
            end
        end
    end
    if ll.GetOwnerKey(id) == ll.GetOwner() then
        local data = ll.ParseString2List(msg, { "|" }, {})
        local cmd = L(data, 1)
        if (cmd == "DONE" and int(L(data, 2)) == sitter_number) or cmd == "DONEA" then
            if OLD_HELPER_METHOD ~= 0 then
                if isKey(tostring(ll.AvatarOnSitTarget())) then
                    stop_all_anims()
                    ll.RegionSay(comm_channel, "GETUP")
                end
            end
            ll.Die()
        elseif cmd == "SWAP" then
            local one = int(L(data, 2))
            local two = int(L(data, 3))
            if sitter_number == one then
                sitter_number = two
                helper_index = two
                setup()
            elseif sitter_number == two then
                sitter_number = one
                helper_index = one
                setup()
            end
        elseif int(L(data, 2)) == sitter_number then
            if cmd == "POS" then
                local pos = vec(L(data, 3))
                local r = rot(L(data, 4))
                OLD_HELPER_METHOD = int(L(data, 5))
                CURRENT_AV = L(data, 6)
                if OLD_HELPER_METHOD ~= 0 then
                    ll.SetClickAction(CLICK_ACTION_SIT)
                end
                ll.SetLinkPrimitiveParamsFast(LINK_THIS, { PRIM_POSITION, pos, PRIM_ROTATION, r })
                if ll.GetPos() ~= pos then
                    ll.SetRegionPos(pos)
                end
                my_pos = ll.GetPos()
                my_rot = ll.GetRot()
                setTimer(0.01, timer_tick)
            end
        end
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_LINK) ~= 0 then
        local av = tostring(ll.AvatarOnSitTarget())
        if OLD_HELPER_METHOD ~= 0 then
            if isKey(av) then
                ll.RequestPermissions(K(av), PERMISSION_TRIGGER_ANIMATION)
                ll.RegionSay(comm_channel, "ANIMA|" .. av)
            else
                stop_all_anims()
                ll.RegionSay(comm_channel, "GETUP")
                CURRENT_AV = ""
            end
        elseif isKey(av) then
            ll.UnSit(K(av))
            ll.Dialog(K(av), product .. " " .. VERSION .. "\n\nDo not sit on the helper with LuaSitter unless you have enabled the old helper mode. Move the helper while sitting on the furniture. Please see the instructions at https://avsitter.github.io", { "OK" }, -68154283)
        end
    end
end)

LLEvents:on("touch_start", function(events: {DetectedEvent})
    if ll.GetStartParameter() ~= 0 then
        ll.RegionSay(comm_channel, "MENU|" .. tostring(sitter_number) .. "|" .. tostring(events[1]:getKey()))
    end
end)

LLEvents:on("run_time_permissions", function(perm: number)
    if bit32.band(perm, PERMISSION_TRIGGER_ANIMATION) ~= 0 then
        ll.StopAnimation("sit")
    end
end)

--------------------------------------------------------------------------
-- Init (was state_entry)
--------------------------------------------------------------------------
ll.SetText("", vector(1, 1, 1), 1)
ll.SetObjectName(base_object_name())
if is_original() then
    ll.SetLinkPrimitiveParamsFast(LINK_THIS, {
        PRIM_TEXTURE, ALL_SIDES, TEXTURE_BLANK, vector(1, 1, 0), ZERO_VECTOR, 0,
        PRIM_FULLBRIGHT, ALL_SIDES, true,
        PRIM_COLOR, ALL_SIDES, colors[1], 0.7,
        PRIM_GLOW, ALL_SIDES, 0.0,
    })
else
    ll.SetLinkPrimitiveParamsFast(LINK_THIS, {
        PRIM_TEXTURE, ALL_SIDES, TEXTURE_BLANK, vector(1, 1, 0), ZERO_VECTOR, 0,
        PRIM_FULLBRIGHT, ALL_SIDES, true,
    })
end
if bit32.band(ll.GetObjectPermMask(MASK_EVERYONE), PERM_MOVE) == 0 and ll.GetOwner() == ll.GetInventoryCreator(ll.GetScriptName()) then
    print("WARNING! The helper should be set to 'Anyone Can Move'")
end
ll.SitTarget(vector(0, 0, -0.35), ZERO_ROTATION)
ll.SetStatus(STATUS_PHANTOM, true)
