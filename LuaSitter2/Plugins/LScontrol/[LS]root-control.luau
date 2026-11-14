--[[
  [LS]root-control - Allow others to control the menu
  LuaSitter: SLua port of AVsitter(TM) [AV]root-control. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What this script does
  ---------------------
  When present, [LS]root-security passes touches to this script (90007, or
  through [LS]root-RLV with 90012). It lets a non-sitter (or a sitter) pick
  which sitter to control, offers "Take Control" when someone else holds the
  menu, and with [LS]root-RLV hands over to the RLV menu ("Control...",
  90100) or the capture search (90211).

  Kept as a separate script (not merged into [LS]root-RLV): it is also used
  WITHOUT RLV ("Menu Control" furniture), and [LS]root-security decides how to
  route touches by checking which of the two scripts are in the inventory.
  Conversely [LS]root-RLV needs this script to receive touches, so RLV builds
  always contain both, but not the other way round.

  Link messages: unchanged (receives 90007, 90206; sends 90005, 90033, 90100,
  90211).

  Changes
  -------
    - With [LS]root-RLV the avatar menu says what it is for ("RLV ▸ which
      avatar?") and the capture button is "Capture new…" (upstream:
      "Capture...", still accepted).
    - The avatar menu is paged ([<<] / [>>]) when it needs more than 12
      buttons (upstream: at most 12 buttons).
    - Looks for "[LS]root-RLV" instead of "[AV]root-RLV".
    - FIX: the sitter-choice buttons were passed through order_buttons()
      twice (once by the caller, once in dialog()), scrambling their order
      when there were more than 3.
    - The 120 s listen timeout is a one-shot timer (the LSL timer kept firing).
]]

local product = "LuaSitter Menu Control"
local version = "3.0-lua1"
local RLV_script = "[LS]root-RLV"

local NULL = tostring(NULL_KEY)

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

local function replace(s: string, search: string, rep: string): string
    return ll.ReplaceSubString(s, search, rep, 0)
end

local function split(s: string, sep: string): {string}
    return ll.ParseStringKeepNulls(s, {sep}, {})
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

local DESIGNATIONS_NOW: {string} = {}
local CONTROLLER = NULL
local CONTROLLER_NAME = ""
local SITTERS_MENUKEYS: {string} = {}
local SITTERS_SHORTNAMES: {string} = {}
local menu_channel = 0
local menu_handle = 0
local listenTimer: any = nil

local function check_for_RLV(): boolean
    return ll.GetInventoryType(RLV_script) == INVENTORY_SCRIPT
end

local function dialog(text: string, menu_items: {string}, id: string)
    ll.ListenRemove(menu_handle)
    menu_channel = randomChannel()
    menu_handle = ll.Listen(menu_channel, "", K(id), "")
    ll.Dialog(K(id), product .. " " .. version .. "\n\n" .. text .. "\n", orderButtons(menu_items), menu_channel)
    if listenTimer then
        LLTimers:off(listenTimer)
    end
    listenTimer = LLTimers:once(120, function()
        listenTimer = nil
        ll.ListenRemove(menu_handle)
    end)
end

-- One page of a menu with one button per sitter. When everything fits in one
-- dialog (12 buttons) there is a single page. Otherwise each page shows as many
-- names as fit, padded with " ", then the fixed buttons, then PAGE_PREV /
-- PAGE_NEXT (pages wrap around).
local PAGE_PREV, PAGE_NEXT = "[<<]", "[>>]"
local CAPTURE_NEW = "Capture new…" -- upstream: "Capture..."
local function pageOf(items: {string}, fixed: {string}, page: number): ({string}, number)
    local out = {}
    if #items + #fixed <= 12 then
        table.move(items, 1, #items, 1, out)
        table.move(fixed, 1, #fixed, #out + 1, out)
        return out, 0
    end
    local per = 12 - #fixed - 2
    local pages = (#items + per - 1) // per
    page %= pages
    table.move(items, page * per + 1, math.min(page * per + per, #items), 1, out)
    while #out < per do
        table.insert(out, " ")
    end
    table.move(fixed, 1, #fixed, #out + 1, out)
    table.insert(out, PAGE_PREV)
    table.insert(out, PAGE_NEXT)
    return out, page
end

local controller_page = 0 -- page of the "Which avatar?" menu

local function controller_menu(id: string)
    CONTROLLER = id
    CONTROLLER_NAME = ll.Key2Name(K(id))
    local SITTERS: {string} = {}
    local count = ll.GetNumberOfPrims()
    while ll.GetAgentSize(ll.GetLinkKey(count)) ~= ZERO_VECTOR do
        table.insert(SITTERS, tostring(ll.GetLinkKey(count)))
        count -= 1
    end
    local hasRLV = check_for_RLV()
    if table.find(SITTERS, id) and hasRLV then
        ll.MessageLinked(LINK_SET, 90005, "", id)
    elseif #SITTERS == 1 and (not hasRLV or not table.find(DESIGNATIONS_NOW, "S") or #DESIGNATIONS_NOW == 1) then
        if hasRLV then
            ll.MessageLinked(LINK_THIS, 90100, "x|Control...|" .. SITTERS[1], id)
        else
            ll.MessageLinked(LINK_SET, 90005, "", id .. "|" .. SITTERS[1])
        end
    else
        local menu_items = {}
        SITTERS_MENUKEYS = {}
        for _, sitter in SITTERS do
            if sitter ~= NULL then
                table.insert(menu_items, ll.GetSubString(replace(ll.Key2Name(K(sitter)), " Resident", ""), 1, 12))
                table.insert(SITTERS_MENUKEYS, sitter)
            end
        end
        SITTERS_SHORTNAMES = table.clone(menu_items)
        local text = "Which avatar?"
        local fixed = {}
        if hasRLV then
            if #menu_items == 0 then
                ll.MessageLinked(LINK_THIS, 90211, "", id)
                return
            end
            text = "RLV ▸ which avatar?\n\nChoose someone to open their RLV menu."
            if table.find(DESIGNATIONS_NOW, "S") and #SITTERS < #DESIGNATIONS_NOW then
                text ..= "\nCapture new… = capture an avatar nearby who wears an RLV relay."
                table.insert(fixed, CAPTURE_NEW)
            end
        end
        if #menu_items > 0 then
            local buttons
            buttons, controller_page = pageOf(menu_items, fixed, controller_page)
            dialog(text, buttons, id) -- FIX: was order_buttons()'d twice
        end
    end
end

LLEvents:on("on_rez", function(_x: number)
    ll.ResetScript()
end)

LLEvents:on("link_message", function(_sender: number, num: number, msg: string, id: string)
    if num == 90007 then
        controller_page = 0
        if id == CONTROLLER or CONTROLLER == NULL then
            controller_menu(id)
        else
            local text = "Take control of the menu?"
            if ll.GetAgentSize(K(CONTROLLER)) ~= ZERO_VECTOR then
                text ..= "\n\nCurrently controlled by: " .. CONTROLLER_NAME
            end
            dialog(text, {"Take Control", "[CANCEL]"}, id)
        end
    elseif num == 90206 then
        DESIGNATIONS_NOW = split(msg, "|")
    end
end)

LLEvents:on("listen", function(_channel: number, _name: string, idk: uuid, message: string)
    local id = tostring(idk)
    ll.ListenRemove(menu_handle)
    local index = table.find(SITTERS_SHORTNAMES, message)
    if (message == PAGE_PREV or message == PAGE_NEXT) and not index then
        controller_page += if message == PAGE_NEXT then 1 else -1
        controller_menu(id)
    elseif message == " " and not index then
        controller_menu(id) -- blank filler button of a paged menu
    elseif index then
        if check_for_RLV() then
            ll.MessageLinked(LINK_THIS, 90100, "x|Control...|" .. SITTERS_MENUKEYS[index], CONTROLLER)
        else
            ll.MessageLinked(LINK_SET, 90005, "", CONTROLLER .. "|" .. SITTERS_MENUKEYS[index])
        end
    elseif message == CAPTURE_NEW or message == "Capture..." then -- "Capture..." = upstream label
        ll.MessageLinked(LINK_THIS, 90211, "", id)
    elseif message == "Take Control" then
        ll.MessageLinked(LINK_SET, 90033, "", "")
        if id ~= CONTROLLER then
            ll.RegionSayTo(K(CONTROLLER), 0, ll.Key2Name(idk) .. " has taken control of the menu.")
        end
        controller_menu(id)
    end
end)

LLEvents:on("changed", function(_change: number)
    -- (any change, as in the LSL)
    if ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) == ZERO_VECTOR then
        CONTROLLER = NULL
    end
end)
