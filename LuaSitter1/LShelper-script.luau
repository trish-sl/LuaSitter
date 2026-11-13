--[[
  LShelper-script - script inside the AVsitter1-style helper object
  LuaSitter: SLua port of AVsitter(TM) Helper (AVsitter1). Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  Goes inside the helper object ("LShelper", replaces AVsitter1 "AVhelper"),
  which is put in the prim with LSadjuster. When rezzed by LSadjuster
  (start parameter = adjuster channel - sitter number) it names itself
  "LShelper N", colours itself, registers (REG), follows POS commands, and
  reports sitting avatars (ANIMA/GETUP) and touches (MENU) on the adjuster
  channel. It dies on DONE/DONEA or after 7 days.
  Rezzed by hand (start parameter 0) it just shows instructions.

  Behaviour changes
  -----------------
  - LSL integer modulo semantics kept for the start parameter (math.fmod).
  - The 7-day auto-delete uses LLTimers.
]]

local base_object_name = "LShelper"
local instructions = "Please see instructions for using the LShelper."
local colors = { vector(1, 0.5, 1), vector(0.5, 1, 1), vector(1, 1, 0.5), vector(1, 0.5, 0.5), vector(0.5, 0.5, 1), vector(0.5, 1, 0.5) }
local NULL = tostring(NULL_KEY)
local ball_size = vector(0.2, 0.2, 0.2)
local default_size = vector(0.2, 0.2, 3.5)

local start_param = 0
local comm_channel = 0
local av = NULL

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
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

local function num(v: any): number
    if type(v) == "number" then
        return v
    end
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

local function lslRot(s: string): quaternion
    local a, b, c, d = string.match(s, "^%s*<([^,]*),([^,]*),([^,]*),([^,>]*)")
    if not a then
        return ZERO_ROTATION
    end
    return quaternion(num(a), num(b), num(c), num(d))
end

local function L(t: { any }, i: number): string
    local v = t[i]
    if v == nil then
        return ""
    end
    return tostring(v)
end

local function color(): vector
    return colors[(start_param % #colors) + 1]
end

local function sitter(): string
    return tostring(ll.AvatarOnSitTarget())
end

local function creatorIsScriptCreator(): boolean
    local d = ll.GetObjectDetails(ll.GetKey(), { OBJECT_CREATOR })
    return tostring(d[1]) == tostring(ll.GetInventoryCreator(ll.GetScriptName()))
end

local function stop_all_anims()
    if bit32.btest(ll.GetPermissions(), PERMISSION_TRIGGER_ANIMATION) then
        local pk = ll.GetPermissionsKey()
        if ll.GetAgentSize(pk) ~= ZERO_VECTOR then
            for _, a in ll.GetAnimationList(pk) do
                ll.StopAnimation(a)
            end
        end
    end
end

local function set_text()
    local text = "▽"
    for _ = 1, start_param do
        text ..= "\n "
    end
    text = "SITTER " .. start_param .. "\n" .. text
    local hovertext_prim = 0
    if ll.GetNumberOfPrims() > 1 then
        if ll.GetAgentSize(ll.GetLinkKey(2)) == ZERO_VECTOR then
            hovertext_prim = 2
            text ..= "\n \n \n \n \n \n \n \n \n "
        end
    end
    ll.SetLinkPrimitiveParamsFast(hovertext_prim, { PRIM_TEXT, text, color(), 1 })
end

local function setup()
    local size = default_size
    if not creatorIsScriptCreator() then
        size = ll.GetScale()
    end
    size -= vector(0.01, 0.01, 0.01) * start_param
    set_text()
    ll.SetObjectName(base_object_name .. " " .. start_param)
    ll.SetLinkPrimitiveParamsFast(LINK_THIS, { PRIM_COLOR, ALL_SIDES, color(), 0.4, PRIM_SIZE, size })
    ll.RegionSay(comm_channel, "REG|" .. start_param)
end

local function warp(pos: vector)
    local rules: { any } = {}
    local n = math.ceil(vector.magnitude(pos - ll.GetPos()) / 10)
    for _ = 1, n do
        table.insert(rules, PRIM_POSITION)
        table.insert(rules, pos)
    end
    ll.SetLinkPrimitiveParamsFast(LINK_THIS, rules)
end

LLEvents:on("on_rez", function(x: number)
    if x ~= 0 then
        ll.SetClickAction(CLICK_ACTION_SIT)
        -- LSL "%" truncates toward zero: x = channel - n  ->  n = -(x % 1000)
        start_param = -math.fmod(x, 1000)
        comm_channel = x + start_param
        ll.Listen(comm_channel, "", NULL_KEY, "")
        setup()
    else
        ll.SetClickAction(CLICK_ACTION_TOUCH)
        ll.SetText("", vector(1, 1, 1), 1)
        if creatorIsScriptCreator() then
            ll.SetLinkPrimitiveParamsFast(LINK_THIS, { PRIM_SIZE, ball_size })
        end
    end
end)

LLEvents:on("listen", function(_chan: number, _name: string, id: uuid, msg: string)
    if tostring(ll.GetOwnerKey(id)) ~= tostring(ll.GetOwner()) then
        return
    end
    local data = ll.ParseString2List(msg, { "|" }, {})
    local cmd = L(data, 1)
    if (cmd == "DONE" and int(L(data, 2)) == start_param) or cmd == "DONEA" then
        if av ~= NULL and av ~= "" then
            stop_all_anims()
            ll.RegionSay(comm_channel, "GETUP|" .. start_param .. "|" .. av)
        end
        ll.Die()
    elseif cmd == "SWAP" then
        if int(L(data, 2)) == start_param then
            start_param = int(L(data, 3))
            setup()
        elseif int(L(data, 3)) == start_param then
            start_param = int(L(data, 2))
            setup()
        end
    elseif int(L(data, 2)) == start_param then
        if cmd == "POS" then
            local pos = lslVec(L(data, 3))
            local r = lslRot(L(data, 4))
            ll.SetLinkPrimitiveParamsFast(LINK_THIS, { PRIM_POSITION, pos, PRIM_ROTATION, r })
            if ll.GetPos() ~= pos then
                warp(pos)
            end
            set_text()
        end
    elseif cmd == "ANIMA" and L(data, 3) == sitter() then
        -- the avatar sitting here claimed another helper
        ll.UnSit(ll.AvatarOnSitTarget())
    end
end)

LLEvents:on("run_time_permissions", function(perm: number)
    if bit32.btest(perm, PERMISSION_TRIGGER_ANIMATION) then
        ll.StopAnimation("sit")
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.btest(change, CHANGED_LINK) then
        local s = sitter()
        if comm_channel ~= 0 then
            if s ~= NULL then
                ll.RequestPermissions(K(s), PERMISSION_TRIGGER_ANIMATION)
                av = s
                ll.RegionSay(comm_channel, "ANIMA|" .. start_param .. "|" .. s)
            else
                stop_all_anims()
                av = NULL
                ll.RegionSay(comm_channel, "GETUP|" .. start_param .. "|" .. av)
            end
        elseif s ~= NULL then
            ll.InstantMessage(K(s), instructions)
            ll.UnSit(K(s))
        end
    end
end)

LLEvents:on("touch_start", function(events: { DetectedEvent })
    local toucher = tostring(events[1]:getKey())
    if ll.GetStartParameter() ~= 0 then
        local s = sitter()
        if s == NULL then
            ll.RegionSay(comm_channel, "ANIMA|" .. start_param .. "|" .. toucher)
        elseif s == toucher then
            ll.RegionSay(comm_channel, "MENU|" .. start_param .. "|" .. toucher)
        end
    else
        ll.InstantMessage(events[1]:getKey(), instructions)
    end
end)

-- init (state_entry)
ll.SetText("", vector(1, 1, 1), 1)
ll.SetObjectName(base_object_name)
ll.SetLinkPrimitiveParamsFast(LINK_THIS, {
    PRIM_TEXTURE, ALL_SIDES, "5748decc-f629-461c-9a36-a35a221fe21f", vector(1, 1, 0), vector(0, 0, 0), 0,
    PRIM_FULLBRIGHT, ALL_SIDES, 1,
    PRIM_COLOR, ALL_SIDES, colors[1], 0.4,
    PRIM_GLOW, ALL_SIDES, 0.03,
})
if not bit32.btest(ll.GetObjectPermMask(MASK_EVERYONE), PERM_MOVE) and tostring(ll.GetOwner()) == tostring(ll.GetInventoryCreator(ll.GetScriptName())) then
    print("WARNING! LShelper should be set to 'Anyone Can Move'")
end
LLTimers:once(604800, function()
    ll.Die()
end)
ll.SitTarget(-vector(0, 0, 0.35), ZERO_ROTATION)
ll.SetStatus(STATUS_PHANTOM, true)
