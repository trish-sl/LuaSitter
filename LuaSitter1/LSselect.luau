--[[
  LSselect - AVsitter1-style seat selection menu ([SELECT])
  LuaSitter: SLua port of AVsitter(TM) AVselect (AVsitter1). Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  Optional, in the same prim as the LSsit scripts (replaces AVsitter1
  "AVselect"). When present, LSsit shows [SELECT] instead of [SWAP] and
  opens this menu (99899): one button per seat (SITTER name or first pose),
  occupied seats show "⊘name" unless SELECT 1. Choosing a seat sends 90030.

  Not merged into LSsit: its presence is the switch between [SWAP] and
  [SELECT] behaviour (and a one-pose sitter jumps straight to this menu),
  so merging it would change every deployment that does not use it.

  Behaviour changes
  -----------------
  - Upstream PR #158 (adapted): choosing your own seat re-shows this menu
    instead of sending a pointless swap with yourself.
  - The seat menu is paged ([<<] / [>>]) when it needs more than 12 buttons
    (upstream: at most 12).
  - The "unsit everyone" loop after reading is bounded (no endless loop if
    an avatar cannot be unseated), and paced by a timer instead of llSleep.
]]

local product_and_version = "LuaSitter LSselect 3.0-lua1"
local SITTER_BASENAME = "LSsit"
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
local NULL = tostring(NULL_KEY)

--------------------------------------------------------------------------
-- helpers
--------------------------------------------------------------------------
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

local function L(t: { any }, i: number): string
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

local function orderButtons(b: { string }): { string }
    local out = {}
    local n = #b
    for _, r in { { n - 2, n }, { n - 5, n - 3 }, { n - 8, n - 6 }, { n - 11, n - 9 } } do
        for i = math.max(r[1], 1), r[2] do
            if i >= 1 then
                table.insert(out, b[i])
            end
        end
    end
    return out
end

local function randomChannel(): number
    return -(math.floor(ll.Frand(2147483646)) + 1)
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

local function Owner_Say(say: string)
    print(ll.GetScriptName() .. ":" .. say)
end

local function lastPrimIsAgent(): boolean
    return ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) ~= ZERO_VECTOR
end

--------------------------------------------------------------------------
-- state (per-sitter tables are indexed by sitter number + 1)
--------------------------------------------------------------------------
local select_type = 0
local BUTTONS: { string } = {}
local reading_notecard_section = -1
local notecard_key = ""
local SITTERS: { string } = {}
local SYNCS: { boolean } = {}
local menu_channel = 0
local menu_handle = 0

-- LSL list access with 0-based index (negative = from the end)
local function at<T>(t: { T }, i: number, default: T): T
    if i < 0 then
        i += #t
    end
    local v = t[i + 1]
    if v == nil then
        return default
    end
    return v
end
local function setAt<T>(t: { T }, i: number, v: T)
    if i >= 0 and i < #t then
        t[i + 1] = v
    end
end

-- One page of the seat menu. When everything fits in one dialog (12 buttons)
-- there is a single page. Otherwise each page shows as many names as fit,
-- padded with " ", then the fixed buttons, then PAGE_PREV / PAGE_NEXT (pages
-- wrap around).
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
local menu_page: { [string]: number } = {} -- current page of the seat menu, per avatar

local function menu(av: string)
    local sitter_index = table.find(SITTERS, av)
    if sitter_index then
        local menu_buttons: { string } = {}
        for i = 1, #BUTTONS do
            local avname = ll.Key2Name(K(SITTERS[i]))
            if select_type == 0 and not SYNCS[i] and avname ~= "" and av ~= SITTERS[i] then
                table.insert(menu_buttons, "⊘" .. ll.GetSubString(replace(avname, " Resident", " "), 1, 12))
            else
                table.insert(menu_buttons, BUTTONS[i])
            end
        end
        local fixed = if lastPrimIsAgent() then { "[ADJUST]" } else {}
        menu_buttons, menu_page[av] = pageOf(menu_buttons, fixed, menu_page[av] or 0)
        ll.ListenControl(menu_handle, true)
        ll.Dialog(K(av), "\n" .. product_and_version .. "\n" .. BUTTONS[sitter_index], orderButtons(menu_buttons), menu_channel)
    end
end

local function get_number_of_scripts(): number
    local i = 1
    while ll.GetInventoryType(SITTER_BASENAME .. " " .. i) == INVENTORY_SCRIPT do
        i += 1
    end
    return i
end

--------------------------------------------------------------------------
-- events
--------------------------------------------------------------------------
LLEvents:on("listen", function(_channel: number, _name: string, uid: uuid, message: string)
    local id = tostring(uid)
    local av_index = (table.find(SITTERS, id) or 0) - 1
    local button_index = (table.find(BUTTONS, message) or 0) - 1
    if av_index ~= -1 then
        if (message == PAGE_PREV or message == PAGE_NEXT) and button_index == -1 then
            menu_page[id] = (menu_page[id] or 0) + (if message == PAGE_NEXT then 1 else -1)
            menu(id)
        elseif message == " " and button_index == -1 then
            menu(id) -- blank filler button of a paged menu
        elseif message == "[ADJUST]" then
            ll.MessageLinked(LINK_SET, 90006, "", id)
        elseif ll.GetSubString(message, 1, 1) == "⊘"
            or (not at(SYNCS, button_index, false) and at(SITTERS, button_index, NULL) ~= NULL and at(SITTERS, button_index, NULL) ~= id and select_type == 0)
        then
            menu(id)
        elseif button_index ~= -1 then
            if av_index ~= button_index then
                ll.MessageLinked(LINK_SET, 90030, tostring(av_index), tostring(button_index))
            else
                -- upstream PR #158: own seat chosen, just show the menu again
                menu(id)
            end
        end
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.btest(change, CHANGED_INVENTORY) then
        if posCardSig() ~= notecard_key or get_number_of_scripts() ~= #SITTERS then
            ll.ResetScript()
        end
    end
    if bit32.btest(change, CHANGED_LINK) then
        if not lastPrimIsAgent() then
            ll.ListenControl(menu_handle, false)
        end
    end
end)

LLEvents:on("link_message", function(_sender: number, num_: number, msg: string, id: string)
    if num_ == 90045 then
        local data = ll.ParseStringKeepNulls(msg, { "|" }, {})
        local index = table.find(SITTERS, id)
        if index then
            SYNCS[index] = string.sub(L(data, 1), 1, 2) == "S:"
        end
    elseif num_ == 90065 then
        menu_page[id] = nil
        local index = table.find(SITTERS, id)
        if index then
            SITTERS[index] = NULL
        end
    elseif num_ == 90030 then
        setAt(SITTERS, int(msg), NULL)
        setAt(SITTERS, int(id), NULL)
    elseif num_ == 90070 then
        setAt(SITTERS, int(msg), id)
    elseif num_ == 90075 then
        setAt(SITTERS, int(msg), NULL)
    elseif num_ == 99899 then
        menu_page[id] = 0
        menu(id)
    end
end)

--------------------------------------------------------------------------
-- notecard
--------------------------------------------------------------------------
local function onLine(raw: string, _lineNo: number)
    local data = raw
    local p = ll.SubStringIndex(data, "◆")
    if p then
        data = ll.GetSubString(data, p + 1, -1)
    end
    data = ll.StringTrim(data, STRING_TRIM)
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
    if command == "SITTER" then
        reading_notecard_section = int(part0)
        local button_text = L(parts, 2)
        if reading_notecard_section >= 0 and reading_notecard_section < #SITTERS then
            if button_text ~= "" and not table.find(BUTTONS, button_text) then
                BUTTONS[reading_notecard_section + 1] = button_text
            end
        end
    elseif command == "SELECT" then
        select_type = int(part0)
    elseif command == "POSE" or command == "SYNC" then
        local s = reading_notecard_section
        if s >= 0 and s < #SITTERS then
            if BUTTONS[s + 1] == "SITTER " .. s then
                if (utf8.len(part0) or #part0) > 23 then
                    part0 = ll.GetSubString(part0, 1, 23)
                end
                if not table.find(BUTTONS, part0) then
                    BUTTONS[s + 1] = part0
                    reading_notecard_section = -1
                end
            end
        end
    end
end

local function onDone(_total: number)
    -- unsit everyone, one avatar every 0.1 s (upstream: llSleep(0.1) in a loop,
    -- which froze the script); bounded to 100 tries
    local guard = 0
    local function step()
        if lastPrimIsAgent() and guard < 100 then
            ll.UnSit(ll.GetLinkKey(ll.GetNumberOfPrims()))
            guard += 1
            LLTimers:once(0.1, step)
        else
            Owner_Say("Ready")
        end
    end
    step()
end

--------------------------------------------------------------------------
-- init (state_entry)
--------------------------------------------------------------------------
menu_channel = randomChannel()
menu_handle = ll.Listen(menu_channel, "", NULL_KEY, "")
ll.ListenControl(menu_handle, false)
for i = 0, get_number_of_scripts() - 1 do
    table.insert(SITTERS, NULL)
    table.insert(SYNCS, false)
    table.insert(BUTTONS, "SITTER " .. i)
end
notecard_key = posCardSig()
Owner_Say("Reading " .. notecard_name)
if ll.GetInventoryType(notecard_name) == INVENTORY_NOTECARD then
    readNotecard(notecard_name, onLine, onDone)
end
