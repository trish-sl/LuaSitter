--[[
  [LS]root-security - Specify who can sit and/or use the menu
  LuaSitter: SLua port of AVsitter(TM) [AV]root-security. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  Goes in the root prim. Lets the owner restrict who can sit (ALL / OWNER /
  GROUP) and who can use the menu, through the [SECURITY] adjust button
  (90100). Gates root touches (and 90006 touches relayed by the sit scripts)
  before opening the menu (90005), or hands them to [LS]root-control
  (90007 / 90012 when [LS]root-RLV is present). Answers 90201 with 90202
  (is RLV present). Settings are not persistent (as upstream).

  Changes from upstream:
  - Checks chat commands from the optional [LS]commands plugin (90013):
    "menu" is handled like a touch by that sitter; other commands are
    answered with 90016 when the sitter has menu access.
  - An unknown answer in the Sit/Menu dialog keeps the current setting.
]]

local VERSION = "3.0-lua1"
local product = "LuaSitter Security"
local menucontrol_script = "[LS]root-control"
local RLV_script = "[LS]root-RLV"

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

local function orderButtons(b: {string}): {string}
    local out = {}
    local n = #b
    for _, r in { {n - 2, n}, {n - 5, n - 3}, {n - 8, n - 6}, {n - 11, n - 9} } do
        for i = math.max(r[1], 1), r[2] do
            if i >= 1 then
                table.insert(out, b[i])
            end
        end
    end
    return out
end

local function randomChannel(): number
    return -(math.floor(ll.Frand(2147483520)) + 1)
end

--------------------------------------------------------------------------
local active_sitter = ""
local active_script_channel = 0
local menu_channel = 0
local menu_handle = 0
local SIT_TYPES = { "ALL", "OWNER", "GROUP" }
local MENU_TYPES = SIT_TYPES
local SIT_INDEX = 1 -- 1-based index into SIT_TYPES
local MENU_INDEX = 1 -- 1-based index into MENU_TYPES
local lastmenu = ""
local menuTimer: any = nil

local function owner(): string
    return tostring(ll.GetOwner())
end

local function pass_security(id: string, context: string): boolean
    local TYPE = SIT_TYPES[SIT_INDEX]
    if context == "MENU" then
        TYPE = MENU_TYPES[MENU_INDEX]
    end
    if TYPE == "GROUP" then
        return ll.SameGroup(K(id))
    end
    return id == owner() or TYPE == "ALL"
end

local function check_sitters()
    local i = ll.GetNumberOfPrims()
    while ll.GetAgentSize(ll.GetLinkKey(i)) ~= ZERO_VECTOR do
        local av = ll.GetLinkKey(i)
        if not pass_security(tostring(av), "SIT") then
            ll.UnSit(av)
            ll.Dialog(av, product .. " " .. VERSION .. "\n\nSorry, Sit access is set to: " .. SIT_TYPES[SIT_INDEX], { "OK" }, -164289491)
        end
        i -= 1
    end
end

local function check_for_RLV(): boolean
    return ll.GetInventoryType(RLV_script) == INVENTORY_SCRIPT
end

local function register_touch(id: string, animation_menu_function: number, prim: number, giveFailedMessage: boolean)
    if pass_security(id, "MENU") then
        if ll.GetInventoryType(menucontrol_script) == INVENTORY_SCRIPT then
            if check_for_RLV() then
                ll.MessageLinked(LINK_THIS, 90012, tostring(prim), id)
            else
                ll.MessageLinked(LINK_THIS, 90007, "", id)
            end
        else
            ll.MessageLinked(LINK_SET, 90005, tostring(animation_menu_function), id)
        end
    elseif giveFailedMessage then
        ll.Dialog(K(id), product .. " " .. VERSION .. "\n\nSorry, Menu access is set to: " .. MENU_TYPES[MENU_INDEX], { "OK" }, -164289491)
    end
end

local function dialog(text: string, menu_items: {string})
    ll.ListenRemove(menu_handle)
    menu_channel = randomChannel()
    menu_handle = ll.Listen(menu_channel, "", ll.GetOwner(), "")
    ll.Dialog(ll.GetOwner(), product .. " " .. VERSION .. "\n\n" .. text, orderButtons(menu_items), menu_channel)
    -- close the listen after 10 minutes
    if menuTimer then
        LLTimers:off(menuTimer)
    end
    menuTimer = LLTimers:once(600, function()
        menuTimer = nil
        ll.ListenRemove(menu_handle)
    end)
end

local function main_menu()
    local buttons = { "Sit", "Menu" }
    if isKey(active_sitter) then
        table.insert(buttons, 1, "[BACK]")
    end
    dialog("Sit access: " .. SIT_TYPES[SIT_INDEX] .. "\nMenu access: " .. MENU_TYPES[MENU_INDEX] .. "\n\nChange security settings:", buttons)
    lastmenu = ""
end

local function rlv_flag(): string
    return if check_for_RLV() then "1" else "0"
end

LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if num == 90201 then
        ll.MessageLinked(LINK_SET, 90202, rlv_flag(), "")
    elseif num == 90006 then
        if ll.GetInventoryType(menucontrol_script) ~= INVENTORY_SCRIPT then
            register_touch(id, int(msg), sender, false)
        end
    elseif num == 90013 then
        -- [LS]commands: a sitter's chat command. "menu" is handled as a touch;
        -- any other command is answered with 90016 if the sitter has menu access.
        if msg == "menu" then
            register_touch(id, 0, sender, true)
        elseif pass_security(id, "MENU") then
            ll.MessageLinked(sender, 90016, msg, id)
        else
            ll.Dialog(K(id), product .. " " .. VERSION .. "\n\nSorry, Menu access is set to: " .. MENU_TYPES[MENU_INDEX], { "OK" }, -164289491)
        end
    elseif num == 90100 then
        local data = ll.ParseString2List(msg, { "|" }, {})
        if L(data, 2) == "[SECURITY]" then
            if id == owner() then
                active_script_channel = int(L(data, 1))
                active_sitter = L(data, 3)
                main_menu()
            else
                ll.RegionSayTo(K(id), 0, "Sorry, only the owner can change security settings.")
                local sitter = L(data, 3)
                if sitter == "" then
                    sitter = NULL
                end
                ll.MessageLinked(sender, 90101, L(data, 1) .. "|[ADJUST]|" .. id, sitter)
            end
        end
    elseif num == 90033 then
        ll.ListenRemove(menu_handle)
    end
end)

LLEvents:on("listen", function(_chan: number, _name: string, id: uuid, msg: string)
    if msg == "Sit" then
        dialog("Sit security:", SIT_TYPES)
        lastmenu = msg
        return
    elseif msg == "Menu" then
        dialog("Menu security:", MENU_TYPES)
        lastmenu = msg
        return
    else
        if msg == "[BACK]" then
            ll.MessageLinked(LINK_SET, 90101, tostring(active_script_channel) .. "|[ADJUST]|" .. tostring(id), active_sitter)
        elseif lastmenu == "Sit" then
            -- FIX: upstream set the index to -1 for an unknown answer; keep the current one.
            SIT_INDEX = table.find(SIT_TYPES, msg) or SIT_INDEX
            main_menu()
            check_sitters()
            return
        elseif lastmenu == "Menu" then
            MENU_INDEX = table.find(MENU_TYPES, msg) or MENU_INDEX
            main_menu()
            return
        end
    end
    ll.ListenRemove(menu_handle)
end)

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_LINK) ~= 0 then
        check_sitters()
    end
end)

LLEvents:on("touch_end", function(events: {DetectedEvent})
    if check_for_RLV() or ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) ~= ZERO_VECTOR then
        register_touch(tostring(events[1]:getKey()), 0, events[1]:getLinkNumber(), true)
    end
end)

-- Init (was state_entry)
ll.MessageLinked(LINK_SET, 90202, rlv_flag(), "")
