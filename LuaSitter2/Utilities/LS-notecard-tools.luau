--[[
  LS-notecard-tools - LSpos (or AVpos) notecard generation / transformation tools
  LuaSitter: SLua port of AVsitter(TM) AVpos-generator, AVpos-shifter and MLP-converter. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  Merges three AVsitter2 utilities into one script. On start (and on owner
  touch while idle) the owner picks a tool from a dialog:
    Generate    : AVpos-generator. Reads out a "POSE AnimN|<anim>" line for
                  every animation in inventory.
    Shift       : AVpos-shifter. Shows its instructions, then listens on
                  channels 5 and 6 for position / rotation offsets, or for a
                  touch on a child prim, and reads out the LSpos (or AVpos) notecard with
                  the shifted positions (chat only; upstream also uploaded a
                  copy to a web service).
    MLP convert : MLP-converter. Converts .MENUITEMS* / .POSITIONS* MLP
                  notecards into AVpos lines.
  The chat read-out of each tool is the same as the original one (same
  "◆" prefix, number formatting, quirks). The script removes itself when the
  original did (Generate / MLP: except from a "Utilities" box; Shift: always).

  Behaviour changes:
  - Works on "LSpos" when present, else "AVpos" (same format).
  - Shift: when per-sitter notecards "LSpos sitter 1"... exist (upstream
    PR #151 / issue #13) a second dialog lets you choose which notecard to
    shift (default: the main notecard, output then identical to upstream).
  - Shift: offsets/touches are ignored while a read-out is running (upstream
    could interleave two read-outs).
  - Notecards are read with the fast reader (GetNotecardLineSync).
  - Read-outs are paced by a queue of LLTimers (same 0.2 s / 0.1 s per line)
    instead of llSleep; removing the script or returning to the menu is queued
    after the last line, so the output and its order are unchanged.
]]

local VERSION = "3.0-lua1"
local SCRIPT = ll.GetScriptName()
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
local NOTECARD_BASENAME = posCard()

--------------------------------------------------------------------------
-- helpers
--------------------------------------------------------------------------
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

local function randomChannel(): number
    return -(math.floor(ll.Frand(2147483520)) + 1)
end

-- LSL llSubStringIndex: 0-based, -1 when missing
local function idx0(s: string, p: string): number
    local i = ll.SubStringIndex(s, p)
    return if i then i - 1 else -1
end

-- LSL llGetSubString with LSL (0-based / negative) indices
local function sub0(s: string, a: number, b: number): string
    return ll.GetSubString(s, if a >= 0 then a + 1 else a, if b >= 0 then b + 1 else b)
end

local function trim(s: string): string
    return ll.StringTrim(s, STRING_TRIM)
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

-- round to a 32-bit float, like an LSL float variable
local function f32(x: number): number
    return (string.unpack("<f", string.pack("<f", x)))
end

-- LSL (string)float : 6 decimals
local function lslFloatStr(f: number): string
    return string.format("%.6f", f)
end

-- LSL (string)vector : 5 decimals
local function lslVecStr(v: vector): string
    return string.format("<%.5f, %.5f, %.5f>", v.x, v.y, v.z)
end

-- strtod-like float scan at position i (whitespace, sign, digits, exponent)
local function scanFloat(s: string, i: number): (number?, number)
    local _, e1, sign = string.find(s, "^%s*([-+]?)", i)
    local j = (e1 or (i - 1)) + 1
    local _, e2, mant = string.find(s, "^(%d*%.?%d*)", j)
    if mant == nil or e2 == nil or not string.find(mant, "%d") then
        return nil, i
    end
    local k = e2 + 1
    local text = mant
    local _, e3, ex = string.find(s, "^([eE][-+]?%d+)", k)
    if e3 then
        text ..= ex
        k = e3 + 1
    end
    local n = tonumber(text)
    if n == nil then
        return nil, i
    end
    if sign == "-" then
        n = -n
    end
    return n, k
end

-- LSL (vector)string cast: "<x,y,z" (">" and trailing text ignored), else ZERO_VECTOR
local function lslVec(s: string): vector
    local _, e = string.find(s, "^%s*<")
    if not e then
        return ZERO_VECTOR
    end
    local comps = {}
    local i = e + 1
    for c = 1, 3 do
        local n, k = scanFloat(s, i)
        if n == nil then
            return ZERO_VECTOR
        end
        comps[c] = n
        i = k
        if c < 3 then
            local _, ce = string.find(s, "^%s*,", i)
            if not ce then
                return ZERO_VECTOR
            end
            i = ce + 1
        end
    end
    return vector(comps[1], comps[2], comps[3])
end

-- upstream FormatFloat (both shifter and MLP-converter), float32 arithmetic
local function FormatFloat(f: number, num_decimals: number): string
    local rounding = f32(f32(tonumber(".5e-" .. tostring(num_decimals)) or 0) - f32(0.5e-6))
    f = f32(f)
    if f < 0 then
        f = f32(f - rounding)
    else
        f = f32(f + rounding)
    end
    local ret = sub0(lslFloatStr(f), 0, num_decimals - (if num_decimals == 0 then 1 else 0) - 7)
    if ll.SubStringIndex(ret, ".") ~= nil then
        while ll.GetSubString(ret, -1, -1) == "0" do
            ret = ll.GetSubString(ret, 1, -2)
        end
    end
    if ll.GetSubString(ret, -1, -1) == "." then
        ret = ll.GetSubString(ret, 1, -2)
    end
    return ret
end

local function inUtilitiesBox(): boolean
    return ll.SubStringIndex(ll.GetObjectName(), "Utilities") ~= nil
end

-- Output queue: each entry waits its delay, then runs (upstream: llSleep before each line)
type Queued = { delay: number, run: () -> (), waited: boolean }
local outQueue: {Queued} = {}
local pumping = false

local function pump()
    while true do
        local item = outQueue[1]
        if not item then
            pumping = false
            return
        end
        if item.delay > 0 and not item.waited then
            item.waited = true
            LLTimers:once(item.delay, pump)
            return
        end
        table.remove(outQueue, 1)
        item.run()
    end
end

local function enqueue(delay: number, run: () -> ())
    table.insert(outQueue, { delay = delay, run = run, waited = false })
    if not pumping then
        pumping = true
        pump()
    end
end

-- say to the owner with an empty object name and the "◆" prefix, `sleep` s after the previous line
local function readout(say: string, sleep: number)
    enqueue(sleep, function()
        local objectname = ll.GetObjectName()
        ll.SetObjectName("")
        ll.RegionSayTo(ll.GetOwner(), 0, "◆" .. say)
        ll.SetObjectName(objectname)
    end)
end

-- run `fn` once every queued line has been said
local function afterReadout(fn: () -> ())
    enqueue(0, fn)
end

--------------------------------------------------------------------------
-- state
--------------------------------------------------------------------------
local mode = "" -- "", "generate", "shift", "mlp"
local showMenu: () -> ()

local function backToIdle()
    mode = ""
end

--------------------------------------------------------------------------
-- Generate : AVpos-generator
--------------------------------------------------------------------------
local function generate()
    local name = "Anim"
    local function Readout_Say(say: string)
        readout(say, 0.2)
    end
    if ll.GetInventoryNumber(INVENTORY_ANIMATION) > 0 then
        Readout_Say("")
        Readout_Say("--✄--COPY BELOW INTO " .. NOTECARD_BASENAME .. " NOTECARD--✄--")
        Readout_Say("")
        local i = 1
        while i <= ll.GetInventoryNumber(INVENTORY_ANIMATION) do
            Readout_Say("POSE " .. name .. tostring(i) .. "|" .. ll.GetInventoryName(INVENTORY_ANIMATION, i))
            i += 1
        end
        Readout_Say("")
        Readout_Say("--✄--COPY ABOVE INTO " .. NOTECARD_BASENAME .. " NOTECARD--✄--")
        Readout_Say("")
        if not inUtilitiesBox() then -- remove it except from Utilities box
            mode = "removed"
            afterReadout(function()
                print("Removing " .. SCRIPT .. " script")
                ll.RemoveInventory(SCRIPT)
            end)
            return
        end
        afterReadout(backToIdle)
        return
    else
        print("No animations found in inventory.")
    end
    backToIdle()
end

--------------------------------------------------------------------------
-- Shift : AVpos-shifter
--------------------------------------------------------------------------
local shift = {
    notecard_name = NOTECARD_BASENAME,
    -- LuaSitter: output goes to chat only (no web "Settings copy" service)
    target_prim_pos = ZERO_VECTOR,
    target_prim_rot = ZERO_ROTATION,
    reading = false,
    listens = {} :: {number},
}

local function IsVector(s: string): boolean
    local parts = ll.ParseString2List(s, { " " }, { "<", ">", "," })
    if #parts ~= 7 then
        return false
    end
    local negated = table.clone(parts)
    table.insert(negated, 6, "-")
    return lslVecStr(lslVec(s)) ~= lslVecStr(lslVec(table.concat(negated)))
end

local function instructions()
    print("\n\nINSTRUCTIONS:\n\nFOR MOVING ALL POSE & PROP POSITIONS BY AN OFFSET:\nManual Position: specify a position offset on channel 5, and positions will be converted by that offset. E.g. /5 <0,0,1.5>\nManual Rotation: specify a rotation offset on channel 6 (in degrees), and rotations will be converted by that offset, relative to the prim center. E.g. /6 <0,0,180>\nBoth Position and Rotation: Enter /5 <position>,<rotation> (there's a comma between both). E.g. /5 <0,0,1.5>,<0,0,180>\n\nFOR RELOCATING SCRIPTS TO NEW PRIM:\n1. Unlink your object and re-link so that the prim you want to move the animations from is the root prim, then place this script inside the root prim.\n2. Touch the prim you want to locate the poses to. This prim should be empty or contain a script with llPassTouches(TRUE);\n3. The script will read out the notecard in chat, with pos/rot modified to the prim you touched.\n\nHave Fun! :)\n")
end

local function Shift_Say(say: string)
    readout(say, 0.1)
end

local function cut_above_text()
    Shift_Say("")
    Shift_Say("--✄--COPY BELOW INTO \"" .. shift.notecard_name .. "\" NOTECARD--✄--")
    Shift_Say("")
end

local function cut_below_text()
    Shift_Say("")
    Shift_Say("--✄--COPY ABOVE INTO \"" .. shift.notecard_name .. "\" NOTECARD--✄--")
    Shift_Say("")
end

local function check_in_root(): boolean
    if ll.GetLinkNumber() > 1 or ll.GetInventoryType(NOTECARD_BASENAME) ~= INVENTORY_NOTECARD then
        if ll.GetInventoryCreator(SCRIPT) ~= ll.GetOwner() then
            print("This script must be placed only in the root prim and with an LSpos or AVpos notecard! - Removing script!")
            ll.RemoveInventory(SCRIPT)
            mode = "removed"
            return false
        end
    end
    return true
end

local function fmtPos(pos: vector): string
    return "<" .. FormatFloat(pos.x, 3) .. "," .. FormatFloat(pos.y, 3) .. "," .. FormatFloat(pos.z, 3) .. ">"
end

local function fmtRot(v: vector): string
    return "<" .. FormatFloat(v.x, 1) .. "," .. FormatFloat(v.y, 1) .. "," .. FormatFloat(v.z, 1) .. ">"
end

local function shiftLine(data: string, _n: number)
    data = trim(sub0(data, idx0(data, "◆") + 1, 99999))
    if sub0(data, 0, 0) == "{" then
        local command = trim(sub0(data, 1, idx0(data, "}") - 1))
        data = (string.gsub(data, " ", ""))
        data = sub0(data, idx0(data, "}") + 1, 99999)
        local parts = ll.ParseStringKeepNulls(data, { "<" }, {})
        local pos = lslVec("<" .. L(parts, 2))
        pos = (pos - shift.target_prim_pos) / shift.target_prim_rot
        local r = ll.Euler2Rot(lslVec("<" .. L(parts, 3)) * DEG_TO_RAD)
        local vec_rot = ll.Rot2Euler(r / shift.target_prim_rot) * RAD_TO_DEG
        Shift_Say("{" .. command .. "}" .. fmtPos(pos) .. fmtRot(vec_rot))
    else
        -- upstream tested llSubStringIndex(first char, "PROP") which is always
        -- non-zero, so every other line (empty ones included) comes here
        local index = 0
        local parts = ll.ParseStringKeepNulls(data, { "|" }, {})
        if IsVector(L(parts, 3)) and IsVector(L(parts, 4)) then
            index = 3
        elseif IsVector(L(parts, 4)) and IsVector(L(parts, 5)) then
            index = 4
        end
        if index ~= 0 then
            local pos = lslVec(L(parts, index))
            local r = ll.Euler2Rot(lslVec(L(parts, index + 1)) * DEG_TO_RAD)
            pos = (pos - shift.target_prim_pos) / shift.target_prim_rot
            local vec_rot = ll.Rot2Euler(r / shift.target_prim_rot) * RAD_TO_DEG
            parts[index] = fmtPos(pos)
            parts[index + 1] = fmtRot(vec_rot)
        end
        Shift_Say(table.concat(parts, "|"))
    end
end

local function shiftRead()
    shift.reading = true
    cut_above_text()
    readNotecard(shift.notecard_name, shiftLine, function(_total: number)
        cut_below_text()
        mode = "removed"
        afterReadout(function()
            print("Conversion complete, removing script.")
            ll.RemoveInventory(SCRIPT)
        end)
    end)
end

local function shiftListen(chan: number, msg: string)
    if shift.reading then
        return
    end
    if chan == 5 then
        local v = lslVec(msg)
        if v ~= ZERO_VECTOR then
            print("Converting positions in " .. shift.notecard_name .. " by offset: " .. lslVecStr(v))
            shift.target_prim_pos = -v
            v = lslVec(L(ll.CSV2List(msg), 2))
            if v ~= ZERO_VECTOR then
                print("Converting rotations in " .. shift.notecard_name .. " by offset: " .. lslVecStr(v))
                shift.target_prim_rot = ll.Euler2Rot(v * DEG_TO_RAD)
            end
            shiftRead()
        else
            print("You didn't enter a vector!")
        end
    elseif chan == 6 then
        local v = lslVec(msg)
        if v ~= ZERO_VECTOR then
            shift.target_prim_rot = ll.Euler2Rot(v * DEG_TO_RAD)
            print("Converting rotations in " .. shift.notecard_name .. " by offset: " .. lslVecStr(v))
            shiftRead()
        else
            print("You didn't enter a vector!")
        end
    end
end

local function shiftTouch(link: number)
    if not check_in_root() or shift.reading then
        return
    end
    if link > 1 then
        shift.target_prim_pos = ll.GetLinkPrimitiveParams(link, { PRIM_POS_LOCAL })[1] :: vector
        shift.target_prim_rot = ll.GetLinkPrimitiveParams(link, { PRIM_ROT_LOCAL })[1] :: quaternion
        print("Converting " .. shift.notecard_name .. " for use in prim #" .. tostring(link))
        shiftRead()
    end
end

local pickChannel = randomChannel()
local pickHandle = 0

local function startShift()
    if not check_in_root() then
        return
    end
    instructions()
    table.insert(shift.listens, ll.Listen(5, "", ll.GetOwner(), ""))
    table.insert(shift.listens, ll.Listen(6, "", ll.GetOwner(), ""))
    -- per-sitter notecards (PR #151): let the owner pick which one to shift
    local cards = { NOTECARD_BASENAME }
    for i = 1, ll.GetInventoryNumber(INVENTORY_NOTECARD) do
        local n = ll.GetInventoryName(INVENTORY_NOTECARD, i)
        -- the cards [LS]sit reads: sitter 1 and up, no leading zero
        if string.match(n, "^LSpos sitter [1-9]%d*$") and #cards < 12 then
            table.insert(cards, n)
        end
    end
    if #cards > 1 then
        pickHandle = ll.Listen(pickChannel, "", ll.GetOwner(), "")
        ll.Dialog(ll.GetOwner(), "\nWhich notecard do you want to shift? (default: " .. NOTECARD_BASENAME .. ")", cards, pickChannel)
    end
end

--------------------------------------------------------------------------
-- MLP convert : MLP-converter
--------------------------------------------------------------------------
local function mlpConvert()
    local ommit = { "default", "stand" }
    local verbose = 0
    local notecards: {string} = {}
    local notecard_name = ""
    local animator_count = 0
    local animator_total = 0

    local function Out(level: number, out: string)
        if verbose >= level then
            print(SCRIPT .. "[" .. VERSION .. "] " .. out)
        end
    end

    local function Readout_Say(say: string)
        readout(say, 0)
    end

    local function finish()
        if not inUtilitiesBox() then -- remove it except from Utilities box
            Out(0, "Removing script")
            mode = "removed"
            ll.RemoveInventory(SCRIPT)
            return
        end
        backToIdle()
    end

    -- (upstream also collected .PROPS notecards but never used them)
    for i = 1, ll.GetInventoryNumber(INVENTORY_NOTECARD) do
        local name = ll.GetInventoryName(INVENTORY_NOTECARD, i)
        local head = sub0(name, 0, 9)
        if head == ".MENUITEMS" or head == ".POSITIONS" then
            table.insert(notecards, name)
        end
    end

    local function onLine(data: string, _n: number)
        data = trim(L(ll.ParseString2List(data, { "//" }, {}), 1))
        if sub0(notecard_name, 0, 9) == ".MENUITEMS" then
            local sp = idx0(data, " ")
            local command = sub0(data, 0, sp - 1)
            local parts = ll.ParseString2List(sub0(data, sp + 1, 99999), { " | ", " |", "| ", "|" }, {})
            if command == "TOMENU" or command == "MENU" then
                -- nothing
            elseif command == "POSE" then
                if table.find(ommit, L(parts, 1)) == nil then
                    if #parts - 1 > animator_total then
                        animator_total = #parts - 1
                    end
                    if #parts - animator_count > 1 then
                        local out = "POSE "
                        if #parts + animator_count > 2 then
                            out = "SYNC "
                        end
                        local pose = trim(L(parts, animator_count + 2))
                        pose = L(ll.ParseString2List(pose, { "::" }, {}), 1)
                        pose = L(ll.ParseString2List(pose, { ";" }, {}), 1)
                        out ..= trim(L(parts, 1)) .. "|" .. pose
                        Readout_Say(out)
                    end
                end
            end
        elseif idx0(data, "{") ~= -1 then
            local command = trim(sub0(data, idx0(data, "{") + 1, idx0(data, "}") - 1))
            if table.find(ommit, command) == nil then
                data = (string.gsub(data, " ", ""))
                local parts = ll.ParseString2List(data, { "<" }, {})
                if #parts > animator_count * 2 + 1 then
                    local pos = lslVec("<" .. L(parts, animator_count * 2 + 2))
                    local rotv = lslVec("<" .. L(parts, animator_count * 2 + 3))
                    pos = pos + lslVec(ll.GetObjectDesc())
                    Readout_Say("{" .. command .. "}" .. fmtPos(pos) .. fmtRot(rotv))
                end
            end
        end
    end

    local readCard: (number) -> ()
    readCard = function(pointer: number)
        notecard_name = notecards[pointer]
        readNotecard(notecard_name, onLine, function(_total: number)
            if pointer < #notecards then
                readCard(pointer + 1)
            elseif animator_count + 1 < animator_total then
                animator_count += 1
                Readout_Say(" ")
                Readout_Say("SITTER " .. tostring(animator_count))
                readCard(1)
            else
                Readout_Say(" ")
                Readout_Say("--✄--COPY ABOVE INTO " .. NOTECARD_BASENAME .. " NOTECARD--✄--")
                finish()
            end
        end)
    end

    Out(0, "Reading MLP notecards...")
    Readout_Say(" ")
    if #notecards > 0 then
        Readout_Say("--✄--COPY BELOW INTO " .. NOTECARD_BASENAME .. " NOTECARD--✄--")
        Readout_Say(" ")
        Readout_Say("SITTER " .. tostring(animator_count))
        readCard(1)
    else
        Out(0, "No MLP notecards found!")
        finish()
    end
end

--------------------------------------------------------------------------
-- menu and events
--------------------------------------------------------------------------
local menuChannel = randomChannel()
local menuHandle = 0
local menuTimeout: any = nil

local function closeMenu()
    if menuHandle ~= 0 then
        ll.ListenRemove(menuHandle)
        menuHandle = 0
    end
    if menuTimeout then
        LLTimers:off(menuTimeout)
        menuTimeout = nil
    end
end

showMenu = function()
    closeMenu()
    menuHandle = ll.Listen(menuChannel, "", ll.GetOwner(), "")
    menuTimeout = LLTimers:once(120, function()
        menuTimeout = nil
        closeMenu()
        print(SCRIPT .. ": menu timed out, touch to show it again.")
    end)
    ll.Dialog(ll.GetOwner(), "LuaSitter notecard tools " .. VERSION
        .. "\n\nGenerate: read out a POSE line for every animation (AVpos-generator)."
        .. "\nShift: move/rotate all positions of the " .. NOTECARD_BASENAME .. " notecard (AVpos-shifter)."
        .. "\nMLP convert: convert MLP notecards to " .. NOTECARD_BASENAME .. " (MLP-converter).",
        { "Generate", "Shift", "MLP convert" }, menuChannel)
end

LLEvents:on("listen", function(chan: number, _name: string, _id: uuid, msg: string)
    if chan == menuChannel then
        if mode ~= "" then
            return
        end
        closeMenu()
        if msg == "Generate" then
            mode = "generate"
            generate()
        elseif msg == "Shift" then
            mode = "shift"
            startShift()
        elseif msg == "MLP convert" then
            mode = "mlp"
            mlpConvert()
        end
    elseif chan == pickChannel then
        if mode == "shift" and not shift.reading and ll.GetInventoryType(msg) == INVENTORY_NOTECARD then
            shift.notecard_name = msg
            print(SCRIPT .. ": shifting notecard \"" .. msg .. "\"")
        end
        ll.ListenRemove(pickHandle)
        pickHandle = 0
    elseif mode == "shift" and (chan == 5 or chan == 6) then
        shiftListen(chan, msg)
    end
end)

LLEvents:on("touch_start", function(events: {DetectedEvent})
    if mode == "shift" then
        shiftTouch(events[1]:getLinkNumber())
    elseif mode == "" and events[1]:getKey() == ll.GetOwner() then
        showMenu()
    end
end)

showMenu()
