--[[
  [LS]select - Allow choosing specific seats rather than using [SWAP]
  LuaSitter: SLua port of AVsitter(TM) [AV]select. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  Optional plugin, in the prim with the [LS]sit scripts. On 90009 it shows a
  seat menu (one button per sitter, named after the SITTER line or the single
  pose of that sitter); choosing a seat swaps seats with 90030.

  Changes compared to [AV]select
    - Upstream PR #158: choosing your own seat re-shows the menu (90005)
      instead of sending a pointless swap.
    - Reads LSpos (else AVpos) with the fast notecard reader. Also reads
      per-sitter notecards "LSpos sitter N" (upstream PR #151, used by
      "[LS]sit N" when present): for those sitters the button name comes from
      that notecard.
    - Handles 90032 (swap and return the menu, issue #140) like 90030.
    - Clicking a blank filler button re-shows the menu.
    - More than 11 seats: the seat menu is paged with [<<] / [>>] (upstream
      could only show 11 seats plus [ADJUST]).
]]

local VERSION = "3.0-lua1"
local product = "LuaSitter seat select"
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
local main_script = "[LS]sit"
local verbose = 0

local NULL = tostring(NULL_KEY)

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

local function replace(s: string, search: string, rep: string): string
    return ll.ReplaceSubString(s, search, rep, 0)
end

local function orderButtons(b: {string}): {string}
    local out = {}
    local n = #b
    for _, r in { {n - 2, n}, {n - 5, n - 3}, {n - 8, n - 6}, {n - 11, n - 9} } do
        for i = math.max(r[1], 1), r[2] do
            table.insert(out, b[i])
        end
    end
    return out
end

local function randomChannel(): number
    return -(math.floor(ll.Frand(2147483520)) + 1)
end

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

--------------------------------------------------------------------------
-- State. Sitter tables are 1-based: sitter # n is at index n + 1.
--------------------------------------------------------------------------
local select_type = 0
local BUTTONS: {string} = {}
local SITTERS: {string} = {}
local SYNCS: {boolean} = {}
local CUSTOM_TEXT = ""
local menu_channel = 0
local menu_handle = 0
local reading_notecard_section = -1
local notecards_signature = ""

local function Out(level: number, out: string)
    if verbose >= level then
        print(ll.GetScriptName() .. "[" .. VERSION .. "] " .. out)
    end
end

local function get_number_of_scripts(): number
    local i = 1
    while ll.GetInventoryType(main_script .. " " .. tostring(i)) == INVENTORY_SCRIPT do
        i += 1
    end
    return i
end

-- per-sitter notecard name for sitter n (n >= 1), or nil if absent
local function own_notecard(n: number): string?
    local name = posCard(n)
    if n >= 1 and ll.GetInventoryType(name) == INVENTORY_NOTECARD then
        return name
    end
    return nil
end

-- keys of all notecards we read, to detect edits
local function get_notecards_signature(): string
    local main = posCard()
    local sig = { main .. tostring(ll.GetInventoryKey(main)) }
    for n = 1, get_number_of_scripts() - 1 do
        local nc = own_notecard(n)
        if nc then
            table.insert(sig, nc .. tostring(ll.GetInventoryKey(nc)))
        end
    end
    return table.concat(sig, "|")
end

-- Pages a list of per-sitter buttons, so there is no limit of 11 sitters. When
-- everything fits in one dialog (12 buttons) there are no pages. Otherwise each
-- page shows as many names as fit, padded with " ", then the fixed buttons, then
-- PAGE_PREV / PAGE_NEXT (pages wrap around).
local PAGE_PREV, PAGE_NEXT = "[<<]", "[>>]"
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
local menu_page: {[string]: number} = {} -- current page of the seat menu, per avatar

local function menu(av: string)
    local sitter_index = table.find(SITTERS, av)
    if sitter_index then
        local menu_buttons = {}
        for i = 1, #BUTTONS do
            local sk = SITTERS[i] or NULL
            local avname = ll.Key2Name(K(sk))
            if ((select_type == 0 and not SYNCS[i]) or select_type == 2) and avname ~= "" and av ~= sk then
                table.insert(menu_buttons, "⊘" .. ll.GetSubString(replace(avname, " Resident", " "), 1, 12))
            else
                table.insert(menu_buttons, BUTTONS[i])
            end
        end
        if #menu_buttons + 1 > 12 then
            -- more than 11 seats: paged
            menu_buttons, menu_page[av] = pageOf(menu_buttons, { "[ADJUST]" }, menu_page[av] or 0)
        else
            while (#menu_buttons + 1) % 3 ~= 0 do
                table.insert(menu_buttons, " ")
            end
            table.insert(menu_buttons, "[ADJUST]")
        end
        ll.ListenControl(menu_handle, true)
        ll.Dialog(K(av), product .. " " .. VERSION .. "\n\n" .. CUSTOM_TEXT .. "[" .. BUTTONS[sitter_index] .. "]", orderButtons(menu_buttons), menu_channel)
    end
end

LLEvents:on("listen", function(_chan: number, _name: string, uid: uuid, message: string)
    local id = tostring(uid)
    local av_index = table.find(SITTERS, id)
    local button_index = table.find(BUTTONS, message)
    if av_index then
        if (message == PAGE_PREV or message == PAGE_NEXT) and not button_index then
            menu_page[id] = (menu_page[id] or 0) + (if message == PAGE_NEXT then 1 else -1)
            menu(id)
        elseif message == "[ADJUST]" or message == "[HELPER]" then
            ll.MessageLinked(LINK_SET, 90101, "X|" .. message .. "|" .. id, id)
        elseif ll.GetSubString(message, 1, 1) == "⊘"
            or (button_index and select_type == 0 and not SYNCS[button_index] and SITTERS[button_index] ~= NULL and SITTERS[button_index] ~= id) then
            menu(id)
        elseif button_index then
            if av_index ~= button_index then
                ll.MessageLinked(LINK_SET, 90030, tostring(av_index - 1), tostring(button_index - 1))
            else
                -- upstream PR #158: own seat chosen, just show the menu again
                ll.MessageLinked(LINK_SET, 90005, "", id)
            end
        elseif message == " " then
            -- FIX: blank filler button (upstream used index -1 = last sitter here)
            menu(id)
        end
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_INVENTORY) ~= 0 then
        if get_notecards_signature() ~= notecards_signature or get_number_of_scripts() ~= #SITTERS then
            ll.ResetScript()
        end
    end
    if bit32.band(change, CHANGED_LINK) ~= 0 then
        if ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) == ZERO_VECTOR then
            ll.ListenControl(menu_handle, false)
        end
    end
end)

LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if sender ~= ll.GetLinkNumber() then
        return
    end
    local one = int(msg) + 1
    if num == 90055 then
        if one >= 1 and one <= #SYNCS then
            -- the pose name is the first "|" field of id; "P:" holds no "|"
            SYNCS[one] = string.sub(id, 1, 2) ~= "P:"
        end
    elseif num == 90065 then
        menu_page[id] = nil
        local index = table.find(SITTERS, id)
        if index then
            SITTERS[index] = NULL
        end
    elseif num == 90030 or num == 90032 then -- 90032: swap and return the menu (issue #140)
        local two = int(id) + 1
        if SITTERS[one] then
            SITTERS[one] = NULL
        end
        if SITTERS[two] then
            SITTERS[two] = NULL
        end
    elseif num == 90070 then
        if SITTERS[one] then
            SITTERS[one] = id
        end
    elseif num == 90009 then
        menu_page[id] = 0
        menu(id)
    end
end)

--------------------------------------------------------------------------
-- Notecard parsing
-- only_sitter: nil for the main notecard (LSpos or AVpos); n for "LSpos sitter n"
-- (only the section of sitter n is used; lines before any SITTER line belong to
-- sitter n).
-- skip_sections: sitters whose section is ignored in the main notecard (they
-- have their own notecard).
--------------------------------------------------------------------------
local skip_sections: {[number]: boolean} = {}

local function parse_line(data: string, only_sitter: number?)
    local diamond = ll.SubStringIndex(data, "◆")
    if diamond then
        data = ll.GetSubString(data, diamond + 1, -1)
    end
    data = ll.StringTrim(data, STRING_TRIM)
    -- same quirk as upstream: with no space, the command loses its last character
    local sp = ll.SubStringIndex(data, " ")
    local command, rest
    if sp then
        command = ll.GetSubString(data, 1, sp - 1)
        rest = ll.GetSubString(data, sp + 1, -1)
    else
        command = ll.GetSubString(data, 1, -2)
        rest = data
    end
    local parts = ll.ParseString2List(rest, { " | ", " |", "| ", "|" }, {})
    local part0 = L(parts, 1)
    if command == "TEXT" then
        if only_sitter == nil then
            CUSTOM_TEXT = replace(part0, "\\n", "\n") .. "\n"
        end
    elseif command == "SITTER" then
        local section = int(part0)
        if (only_sitter ~= nil and section ~= only_sitter) or (only_sitter == nil and skip_sections[section]) then
            reading_notecard_section = -1
            return
        end
        reading_notecard_section = section
        local button_text = L(parts, 2)
        if section >= 0 and section < #SITTERS then
            if button_text ~= "" and table.find(BUTTONS, button_text) == nil then
                BUTTONS[section + 1] = button_text
                reading_notecard_section = -1
            end
        end
    elseif command == "MTYPE" then
        -- (read but unused, as upstream)
    elseif command == "SELECT" then
        if only_sitter == nil then
            select_type = int(part0)
        end
    elseif command == "POSE" or command == "SYNC" then
        local s = reading_notecard_section
        if s >= 0 and s < #SITTERS then
            if BUTTONS[s + 1] == "Sitter " .. tostring(s) then
                part0 = ll.GetSubString(part0, 1, 23)
                if table.find(BUTTONS, part0) == nil then
                    BUTTONS[s + 1] = part0
                end
            else
                -- more than one pose: keep the generic name
                BUTTONS[s + 1] = "Sitter " .. tostring(s)
                reading_notecard_section = -1
            end
        end
    end
end

local function init()
    menu_channel = randomChannel()
    menu_handle = ll.Listen(menu_channel, "", NULL_KEY, "")
    ll.ListenControl(menu_handle, false)
    local count = get_number_of_scripts()
    for i = 0, count - 1 do
        table.insert(SITTERS, NULL)
        table.insert(SYNCS, false)
        table.insert(BUTTONS, "Sitter " .. tostring(i))
    end
    -- per-sitter notecards (PR #151)
    local own: {number} = {}
    for n = 1, count - 1 do
        if own_notecard(n) then
            skip_sections[n] = true
            table.insert(own, n)
        end
    end
    notecards_signature = get_notecards_signature()
    Out(0, "Loading...")
    local step = 0
    local function next_notecard()
        step += 1
        if step == 1 then
            reading_notecard_section = -1
            readNotecard(notecard_name, function(line: string, _n: number)
                parse_line(line, nil)
            end, function(_total: number)
                next_notecard()
            end)
        elseif step - 1 <= #own then
            local n = own[step - 1]
            reading_notecard_section = n
            BUTTONS[n + 1] = "Sitter " .. tostring(n)
            readNotecard(posCard(n), function(line: string, _n: number)
                parse_line(line, n)
            end, function(_total: number)
                next_notecard()
            end)
        else
            Out(0, "Ready")
        end
    end
    next_notecard()
end

init()
