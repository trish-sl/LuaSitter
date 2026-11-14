--[[
  [LS]menu - Allow using props and menus without using sitting scripts
  LuaSitter: SLua port of AVsitter(TM) [AV]menu. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does:
    Touch menu built from the MENU / TOMENU / BUTTON / TEXT / MTYPE / LMSOURCE
    lines of the LSpos (or AVpos) notecard, for objects that have no sit script. BUTTONs send
    link messages (default 90200, which [LS]plugins uses to rez props). With
    [LS]plugins present, the owner gets an [OWNER] menu to add props ([NEW] -> 90173),
    save their positions ([SAVE] -> 90101), clear, dump and reset.

  Replaces [AV]menu. It is not merged into [LS]plugins because:
    - [LS]menu can be used alone (pure button menu, no [LS]plugins): the [OWNER]
      button and prop options appear only when a prop script is present.
    - [LS]plugins is used with [LS]sit, where the touch handler, 90005 handling and
      dump-to-chat belong to [LS]sit/[LS]adjuster.
    - [LS]menu removes itself when a sit script is present.

  Works with "[LS]plugins" (its PROP module), or the LSL "[AV]prop" for mixed
  setups. Removes itself when "[LS]sit" (or the LSL "[AV]sitA") is in the prim,
  like upstream.

  Changes from upstream:
    - PR #78 (issues #75, #77): 90004 and 90005 are honoured. 90004 (and touch)
      opens the top menu; 90005 with a MENU name opens that submenu; 90005 with
      no known submenu re-shows the current menu for the same avatar, or the
      top menu for a different avatar.
      FIX: upstream PR #78 compared the avatar name after overwriting it, so the
      "different avatar -> top menu" branch could never run.
    - FIX: adding a prop with [NEW] inserts a BUTTON at the start of the menu
      list; upstream did not shift the current submenu index, so it pointed at
      the wrong entry.
    - Fast notecard reader (sync read with async fallback).
    - DUMP lines are paced by a queue of LLTimers (0.2 s per line, as upstream)
      instead of llSleep; the request for the prop lines (90020) is queued after
      the menu lines, so the output order is unchanged. [RESET] waits 1 s on a
      timer instead of llSleep(1) before resetting.
]]

local product = "LuaSitter menu"
local version = "3.0-lua1"
local verbose = 0
-- Pose notecard: "LSpos" (LuaSitter name) is used when present, else "AVpos" (AVsitter name).
-- posCard(n) gives the name of sitter n's own notecard: "LSpos sitter N".
local function posCard(n: number?): string
    if n then
        -- per-sitter notecard: never "LSpos 1", the name Second Life gives a duplicate copy
        return "LSpos sitter " .. tostring(n)
    end
    if ll.GetInventoryType("LSpos") ~= INVENTORY_NOTECARD and ll.GetInventoryType("AVpos") == INVENTORY_NOTECARD then
        return "AVpos"
    end
    return "LSpos"
end
local notecard_name = posCard()
-- name and key of the current pose notecard: changes when it is edited, added, or renamed
local function posCardSig(): string
    local name = posCard()
    return name .. tostring(ll.GetInventoryKey(name))
end
local SEP = "\u{FFFD}"

-- Character count (# counts bytes; ll.StringLength is deprecated).
local function charLen(s: string): number
    return utf8.len(s) or #s
end

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

--------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------
local MENUCONTROL_TYPES = {"ALL", "OWNER ONLY", "GROUP ONLY"}
local MENUCONTROL_INDEX = 1 -- 1-based index in MENUCONTROL_TYPES
local custom_text = ""
local last_menu_unixtime = 0
local last_menu_avatar = ""
local menu_channel = 0
local notecard_key = tostring(NULL_KEY)
-- MENU_LIST entries: "M:name*" (menu), "T:name*" (tomenu), "B:name" (button).
-- DATA_LIST holds the button data (num SEP msg SEP id) at the same index.
local MENU_LIST: {string} = {}
local DATA_LIST: {string} = {}
local MTYPE = 0
local LMSOURCE = 0 -- lmsource self = 0, lmsource linkset = 1
local current_menu = -1 -- 0-based index into MENU_LIST of the open "M:" entry, -1 = top
local menu_page = 0
local choosing = false
local choice = ""
local listen_handle = 0
local number_per_page = 9
local menu_pages = 0
local last_text = ""
local menuTimer: any = nil

-- 0-based access to MENU_LIST, like llList2String(MENU_LIST, i)
local function ML(i: number): string
    return MENU_LIST[i + 1] or ""
end

local function Out(level: number, out: string)
    if verbose >= level then
        print(ll.GetScriptName() .. "[" .. version .. "] " .. out)
    end
end

-- "[LS]plugins" (its PROP module), or the LSL "[AV]prop" for mixed setups;
-- nil when none.
local function prop_script(): string?
    if ll.GetInventoryType("[LS]plugins") == INVENTORY_SCRIPT then
        return "[LS]plugins"
    elseif ll.GetInventoryType("[AV]prop") == INVENTORY_SCRIPT then
        return "[AV]prop"
    end
    return nil
end

local function pass_security(id: string): boolean
    local SECURITY_TYPE = MENUCONTROL_TYPES[MENUCONTROL_INDEX]
    if SECURITY_TYPE == "ALL" then
        return true
    elseif SECURITY_TYPE == "GROUP ONLY" and ll.SameGroup(K(id)) then
        return true
    elseif id == tostring(ll.GetOwner()) then
        return true
    end
    return false
end

local function remove_script(reason: string)
    local message = "\n" .. ll.GetScriptName() .. " ==Script Removed==\n\n" .. reason
    ll.Dialog(ll.GetOwner(), message, {"OK"}, -3675)
    ll.InstantMessage(ll.GetOwner(), message)
    ll.RemoveInventory(ll.GetScriptName())
end

local function check_avsit(): boolean
    if ll.GetInventoryType("[LS]sit") == INVENTORY_SCRIPT or ll.GetInventoryType("[AV]sitA") == INVENTORY_SCRIPT then
        remove_script("This script can not be used with the sit script in the same prim. Removing script!")
        return true
    end
    return false
end

-- DUMP output queue: each line is said 0.2 s after the previous one (upstream slept
-- 0.2 s before each line); Readout_Then queues an action after the queued lines.
local outQueue: {() -> ()} = {}
local pumping = false

local function pump()
    local nextItem = table.remove(outQueue, 1)
    if nextItem then
        nextItem()
    else
        pumping = false
    end
end

local function startPump()
    if not pumping then
        pumping = true
        pump()
    end
end

local function Readout_Say(say: string)
    table.insert(outQueue, function()
        LLTimers:once(0.2, function()
            local objectname = ll.GetObjectName()
            ll.SetObjectName("")
            ll.RegionSayTo(ll.GetOwner(), 0, "◆" .. say)
            ll.SetObjectName(objectname)
            pump()
        end)
    end)
    startPump()
end

local function Readout_Then(fn: () -> ())
    table.insert(outQueue, function()
        fn()
        pump()
    end)
    startPump()
end

local function dialog(av: string, menu_text: string, menu_items: {string})
    ll.Dialog(K(av), product .. " " .. version .. "\n\n" .. menu_text, orderButtons(menu_items), menu_channel)
    last_menu_unixtime = os.time()
    -- the listen is closed 120 s after the last dialog
    if menuTimer then
        LLTimers:off(menuTimer)
    end
    menuTimer = LLTimers:once(120, function()
        menuTimer = nil
        ll.ListenRemove(listen_handle)
    end)
end

local function avprop_is_copy_transfer(mask: number): boolean
    local ps = prop_script()
    if ps == nil then
        return false
    end
    local perms = ll.GetInventoryPermMask(ps, mask)
    return bit32.band(perms, PERM_COPY) ~= 0 and bit32.band(perms, PERM_TRANSFER) ~= 0
end

local function prim_is_mod(): boolean
    return bit32.band(ll.GetObjectPermMask(MASK_OWNER), PERM_MODIFY) ~= 0
end

local function owner(): string
    return tostring(ll.GetOwner())
end

local function options_menu()
    local menu_items = {"[BACK]"}
    local text = "Prop options:\n"
    if avprop_is_copy_transfer(MASK_OWNER) and prim_is_mod() then
        table.insert(menu_items, "[NEW]")
        table.insert(menu_items, "[DUMP]")
        text ..= "\n[NEW] = Add a new prop."
        text ..= "\n[DUMP] = Read settings to chat."
    end
    for _, b in {"[SAVE]", "[CLEAR]", "[SECURITY]", "[RESET]"} do
        table.insert(menu_items, b)
    end
    text ..= "\n[SAVE] = Save prop positions."
    text ..= "\n[CLEAR] = Clear props."
    text ..= "\n[SECURITY] = Menu security."
    text ..= "\n[RESET] = Reload notecard."
    dialog(owner(), text, menu_items)
end

local function choice_menu(options: {string}, menu_text: string)
    last_text = menu_text
    choosing = true
    menu_text = "\n(Page " .. tostring(menu_page + 1) .. "/" .. tostring(menu_pages) .. ")\n" .. menu_text .. "\n\n"
    local menu_items: {string} = {}
    if #options == 0 then
        menu_text = "\nNo items of required type in the prim inventory."
        menu_items = {"[BACK]"}
    else
        local cutoff = 65
        local all_options_length = charLen(table.concat(options, ""))
        if 412 - all_options_length < 0 then
            cutoff = 43
        end
        -- FIX: the 412-character threshold above (upstream) did not count the rest of
        -- the dialog text, so long names could still make the message 512 bytes or
        -- more and llDialog showed nothing. When the lines do not fit, each name gets
        -- an equal share of the bytes left (names can hold multi-byte characters).
        local fixed = #(product .. " " .. version .. "\n\n") + #menu_text
        local lines: {string} = {}
        local total = fixed
        for i, item in options do
            if charLen(item) > cutoff then
                item = ll.GetSubString(item, 1, cutoff + 1) .. ".."
            end
            lines[i] = tostring(i) .. "." .. item .. "\n"
            total += #lines[i]
        end
        if total > 511 then
            local share = math.floor((511 - fixed) / #options)
            for i, item in options do
                local room = share - #(tostring(i) .. ".") - #"..\n"
                if #(tostring(i) .. "." .. item .. "\n") > share then
                    local n = charLen(item)
                    while n > 0 and #ll.GetSubString(item, 1, n) > room do
                        n -= 1
                    end
                    local cut = if n > 0 then ll.GetSubString(item, 1, n) else ""
                    lines[i] = tostring(i) .. "." .. cut .. "..\n"
                else
                    lines[i] = tostring(i) .. "." .. item .. "\n"
                end
            end
        end
        for i, line in lines do
            table.insert(menu_items, tostring(i))
            menu_text ..= line
        end
        while #menu_items < number_per_page do
            table.insert(menu_items, " ")
        end
        table.insert(menu_items, "[BACK]")
        table.insert(menu_items, "[<<]")
        table.insert(menu_items, "[>>]")
    end
    dialog(owner(), menu_text, menu_items)
end

local function get_choices(page: number): {string}
    menu_page = page
    local options = {}
    local start = number_per_page * menu_page
    local stop = start + number_per_page
    local count = ll.GetInventoryNumber(INVENTORY_OBJECT)
    local i = start
    while #options + start < stop and i < count do
        table.insert(options, ll.GetInventoryName(INVENTORY_OBJECT, i + 1))
        i += 1
    end
    menu_pages = math.ceil(count / number_per_page)
    return options
end

-- return_pages: only compute and return the last page number (0-based)
local function avmenu(return_pages: boolean, av: string): number
    choosing = false
    choice = ""
    local total_items = 0
    local i = current_menu + 1
    while i < #MENU_LIST and not startsWith(ML(i), "M:") do
        total_items += 1
        i += 1
    end
    local menu_items2: {string} = {}
    if current_menu ~= -1 then
        table.insert(menu_items2, "[BACK]")
    end
    local menu_items1: {string} = {}
    if prop_script() then
        table.insert(menu_items2, "[OWNER]")
    end
    if total_items + #menu_items2 > 12 then
        table.insert(menu_items2, "[<<]")
        table.insert(menu_items2, "[>>]")
    end
    local items_per_page = 12 - #menu_items2
    local page_start = current_menu + 1 + menu_page * items_per_page
    for j = page_start, page_start + items_per_page - 1 do
        if j < #MENU_LIST then
            local entry = ML(j)
            if startsWith(entry, "M:") then
                break
            end
            local pfx = string.sub(entry, 1, 2)
            if pfx ~= "T:" and pfx ~= "S:" and pfx ~= "B:" then
                table.insert(menu_items1, entry)
            else
                local first = L(ll.ParseString2List(entry, {"|"}, {}), 1)
                table.insert(menu_items1, ll.GetSubString(first, 3, 99999))
            end
        end
    end
    if return_pages then
        local pages = total_items // items_per_page
        if total_items % items_per_page == 0 then
            pages -= 1
        end
        return pages
    end
    if menu_items2[1] == "[BACK]" then
        table.insert(menu_items1, 1, "[BACK]")
        table.remove(menu_items2, 1)
    end
    menu_channel = randomChannel()
    ll.ListenRemove(listen_handle)
    listen_handle = ll.Listen(menu_channel, "", K(av), "")
    for _, b in menu_items2 do
        table.insert(menu_items1, b)
    end
    dialog(av, custom_text, menu_items1)
    return 0
end

-- menu_function: 90004 = top menu, 90005 = requested/current menu (PR #78)
local function menu_check(name: string, id: string, msg: string, menu_function: number)
    if pass_security(id) then
        if name == last_menu_avatar or os.time() - last_menu_unixtime > 5 then
            -- FIX: remember the previous avatar before overwriting it (PR #78 compared
            -- against the new value, so a different avatar never got the top menu)
            local previous_avatar = last_menu_avatar
            last_menu_unixtime = os.time()
            last_menu_avatar = name
            local index = table.find(MENU_LIST, "M:" .. msg .. "*")
            if menu_function == 90004 or (name ~= previous_avatar and index == nil) then
                menu_page = 0
                current_menu = -1
            elseif index ~= nil then
                menu_page = 0
                current_menu = index - 1
            end
            avmenu(false, id)
        else
            ll.Dialog(K(id), product .. " " .. version .. "\n\n" .. L(ll.ParseString2List(last_menu_avatar, {" "}, {}), 1) .. " is already using the menu.\nPlease wait a moment.", {"OK"}, -585868)
        end
    else
        ll.Dialog(K(id), product .. " " .. version .. "\n\n" .. "Sorry, the owner has set this menu to: " .. MENUCONTROL_TYPES[MENUCONTROL_INDEX], {"OK"}, -585868)
    end
end

local function naming()
    ll.TextBox(ll.GetOwner(), "\nPlease type a button name for your prop\nProp: " .. choice, menu_channel)
end

--------------------------------------------------------------------------
-- Dialog replies
--------------------------------------------------------------------------
LLEvents:on("listen", function(_channel: number, _name: string, uid: uuid, msg: string)
    local id = tostring(uid)
    if choice ~= "" then
        if msg == "" then
            naming()
        else
            local perms = ll.GetInventoryPermMask(choice, MASK_NEXT)
            if bit32.band(perms, PERM_COPY) == 0 then
                ll.Say(0, "Could not add prop '" .. choice .. "'. Props and their content must be COPY-OK for NEXT owner.")
            else
                ll.MessageLinked(LINK_THIS, 90173, msg, choice) -- add PROP line to [LS]plugins
                table.insert(MENU_LIST, 1, "B:" .. msg)
                table.insert(DATA_LIST, 1, "90200") -- Rez prop (with menu)
                -- FIX: keep pointing at the same submenu after the insertion
                if current_menu ~= -1 then
                    current_menu += 1
                end
            end
            choice = ""
            options_menu()
        end
        return
    end
    if choosing and table.find({"1", "2", "3", "4", "5", "6", "7", "8", "9"}, msg) then
        choosing = false
        choice = L(get_choices(menu_page), int(msg))
        naming()
        return
    end
    if msg == "[SECURITY]" then
        if id == owner() then
            dialog(owner(), "Who is allowed to control this menu?", MENUCONTROL_TYPES)
        else
            ll.RegionSayTo(uid, 0, "Sorry, only the owner can use this.")
        end
        return
    end
    local mindex_test = table.find(MENU_LIST, "M:" .. msg)
    if mindex_test then
        menu_page = 0
        current_menu = mindex_test - 1
    end
    mindex_test = table.find(MENU_LIST, "B:" .. msg)
    if mindex_test then
        local button_data = split(DATA_LIST[mindex_test] or "", SEP)
        if L(button_data, 2) ~= "" then
            msg = L(button_data, 2)
        end
        if L(button_data, 3) ~= "" then
            id = L(button_data, 3)
        end
        ll.MessageLinked(LINK_SET, int(L(button_data, 1)), msg, id)
        return
    elseif msg == "[>>]" or msg == "[<<]" then
        if choosing then
            if msg == "[>>]" then
                menu_page += 1
                if menu_page >= menu_pages then
                    menu_page = 0
                end
            else
                menu_page -= 1
                if menu_page < 0 then
                    menu_page = menu_pages - 1
                end
            end
            choice_menu(get_choices(menu_page), last_text)
        else
            if msg == "[<<]" then
                menu_page -= 1
                if menu_page < 0 then
                    menu_page = avmenu(true, tostring(NULL_KEY))
                end
            else
                menu_page += 1
                if menu_page > avmenu(true, tostring(NULL_KEY)) then
                    menu_page = 0
                end
            end
            avmenu(false, id)
        end
        return
    elseif msg == "[BACK]" then
        menu_page = 0
        current_menu = -1
    elseif msg == "[NEW]" then
        ll.MessageLinked(LINK_THIS, 90200, "", "") -- Clear props
        choice_menu(get_choices(0), "Please choose your prop:\n\n(Props must include the [LS]object or [AV]object script!)")
        return
    elseif msg == "[DUMP]" then
        Readout_Say("")
        Readout_Say("--✄--COPY BELOW INTO \"" .. posCard() .. "\" NOTECARD--✄--")
        Readout_Say("")
        if custom_text ~= "" then
            Readout_Say("TEXT " .. replace(custom_text, "\n", "\\n"))
        end
        for i, entry in MENU_LIST do
            local change_me = ll.ParseString2List(entry, {":"}, {})
            if #change_me == 2 then
                local kind = L(change_me, 1)
                local value = L(change_me, 2)
                if kind == "M" then
                    Readout_Say("MENU " .. ll.GetSubString(value, 1, -2))
                elseif kind == "T" then
                    Readout_Say("TOMENU " .. ll.GetSubString(value, 1, -2))
                elseif kind == "B" then
                    local data = replace(replace(DATA_LIST[i] or "", "90200", ""), SEP, "|")
                    if data == "" then
                        Readout_Say("BUTTON " .. value)
                    else
                        Readout_Say("BUTTON " .. value .. "|" .. data)
                    end
                end
            end
        end
        Readout_Then(function()
            ll.MessageLinked(LINK_THIS, 90020, "0", prop_script() or "[LS]plugins") -- Dump prop settings
        end)
        return
    elseif msg == "[SAVE]" and id == owner() then
        ll.MessageLinked(LINK_SET, 90101, "0|" .. msg, "") -- Menu choice notification
        options_menu()
        return
    elseif msg == "[CLEAR]" then
        Out(0, "Props have been cleared!")
        ll.MessageLinked(LINK_THIS, 90200, "", "") -- Clear props
    elseif msg == "[RESET]" then
        ll.MessageLinked(LINK_THIS, 90200, "", "") -- Clear props
        LLTimers:once(1, function() -- upstream: llSleep(1)
            local ps = prop_script()
            if ps then
                ll.ResetOtherScript(ps)
            end
            ll.ResetScript()
        end)
        return
    elseif msg == "[OWNER]" then
        if id == owner() then
            options_menu()
            return
        else
            ll.RegionSayTo(uid, 0, "Sorry, only the owner can use this.")
        end
    elseif id == owner() and table.find(MENUCONTROL_TYPES, msg) then
        MENUCONTROL_INDEX = table.find(MENUCONTROL_TYPES, msg) or 1
        Out(0, "Menu access set to: " .. MENUCONTROL_TYPES[MENUCONTROL_INDEX])
        if prop_script() then
            options_menu()
            return
        end
    end
    avmenu(false, id)
end)

LLEvents:on("touch_start", function(events: {DetectedEvent})
    if MTYPE < 3 then
        menu_check(events[1]:getName(), tostring(events[1]:getKey()), "", 90004)
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_INVENTORY) ~= 0 then
        if posCardSig() ~= notecard_key then
            ll.ResetScript()
        end
        check_avsit()
    end
end)

LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if sender == ll.GetLinkNumber() or LMSOURCE == 1 then
        if num == 90004 or num == 90005 then -- send menu to id
            menu_check(ll.Key2Name(K(id)), id, msg, num)
        elseif num == 90022 then -- dump line from [LS]plugins
            Readout_Say(msg)
        elseif num == 90021 then -- end of dump
            Readout_Say("")
            Readout_Say("--✄--COPY ABOVE INTO \"" .. posCard() .. "\" NOTECARD--✄--")
            Readout_Say("")
        end
    end
end)

--------------------------------------------------------------------------
-- Notecard
--------------------------------------------------------------------------
local function readNotecard(name: string, onLine: (string, number) -> (), onDone: (number) -> ())
    local lineNo = 1
    local query: uuid? = nil
    local handler: any = nil
    local function finish()
        if handler then
            LLEvents:off("dataserver", handler)
            handler = nil
        end
        onDone(lineNo - 1)
    end
    local function pump()
        while true do
            local data = ll.GetNotecardLineSync(name, lineNo)
            if data == NAK then
                query = ll.GetNotecardLine(name, lineNo)
                return
            elseif data == EOF then
                finish()
                return
            end
            onLine(data, lineNo)
            lineNo += 1
        end
    end
    handler = LLEvents:on("dataserver", function(qid: uuid, data: string)
        if qid ~= query then
            return
        end
        query = nil
        if data == EOF then
            finish()
            return
        end
        onLine(data, lineNo)
        lineNo += 1
        pump()
    end)
    pump()
end

local function onNotecardLine(data: string, _n: number)
    local diamond = ll.SubStringIndex(data, "◆")
    if diamond then
        data = ll.GetSubString(data, diamond + 1, 99999)
    end
    data = ll.StringTrim(data, STRING_TRIM)
    local command: string
    local rest: string
    local sp = ll.SubStringIndex(data, " ")
    if sp then
        command = ll.GetSubString(data, 1, sp - 1)
        rest = ll.GetSubString(data, sp + 1, 99999)
    else
        command = ll.GetSubString(data, 1, -2) -- upstream quirk: with no space, the last character is dropped
        rest = data
    end
    local parts = ll.ParseStringKeepNulls(rest, {" | ", " |", "| ", "|"}, {})
    local part0 = ll.StringTrim(L(parts, 1), STRING_TRIM)
    local part1 = L(parts, 2)
    if #parts > 1 then
        local tail = table.move(parts, 2, #parts, 1, {})
        part1 = ll.StringTrim(table.concat(tail, SEP), STRING_TRIM)
    end
    if command == "TEXT" then
        custom_text = replace(part0, "\\n", "\n")
    end
    part0 = ll.GetSubString(part0, 1, 23)
    if command == "MENU" then
        table.insert(MENU_LIST, "M:" .. part0 .. "*")
        table.insert(DATA_LIST, "")
    elseif command == "TOMENU" then
        table.insert(MENU_LIST, "T:" .. part0 .. "*")
        table.insert(DATA_LIST, "")
    elseif command == "BUTTON" then
        table.insert(MENU_LIST, "B:" .. part0)
        if part1 == "" then
            part1 = "90200"
        end
        table.insert(DATA_LIST, part1)
    elseif command == "MTYPE" then
        MTYPE = int(part0)
    elseif command == "LMSOURCE" then
        LMSOURCE = int(part0)
    end
end

--------------------------------------------------------------------------
-- Init (state_entry)
--------------------------------------------------------------------------
local removed = false
if string.find(ll.GetScriptName(), " ", 1, true) then
    remove_script("Use only one copy of this script!")
    removed = true
end
if not removed and not check_avsit() then
    notecard_key = posCardSig()
    Out(0, "Loading...")
    if ll.GetInventoryType(notecard_name) == INVENTORY_NOTECARD then
        readNotecard(notecard_name, onNotecardLine, function(_total: number)
            Out(0, tostring(#MENU_LIST) .. " menu items Ready, Memory: " .. tostring(ll.GetFreeMemory()))
            ll.PassTouches(0)
            if MTYPE == 3 then
                ll.PassTouches(1)
            end
        end)
    end
end
