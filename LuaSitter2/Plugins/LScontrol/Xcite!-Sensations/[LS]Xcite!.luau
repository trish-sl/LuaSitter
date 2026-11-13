--[[
  [LS]Xcite! - Allows working with Xcite!(TM) and Sensations products
  LuaSitter: SLua port of AVsitter(TM) [AV]Xcite!. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  Reads the "[LS]Xcite_settings" notecard (else "[AV]Xcite_settings", for compatibility with
  existing products) and, on each pose played (90045), sends the matching
  arousal / tilt commands to the Xcite! / Sensations partner scripts
  (link messages 20001, 20014, 20020, unchanged), re-sending arousal every
  TIMER seconds.

  Changes: fast notecard reader; the notecard lines are kept as records.
  If the notecard is missing the script says so instead of a script error.
  FIX: "XCITE *|<sitter>|..." lines (default for all poses of one sitter) are
  used; upstream ignored them. Lookup order: pose|sitter, pose|*, *|sitter, *|*.
]]

local version = "3.0-lua1"
-- "[LS]Xcite_settings" (LuaSitter name) is read when present, else "[AV]Xcite_settings".
local function settingsCard(): string
    if ll.GetInventoryType("[LS]Xcite_settings") ~= INVENTORY_NOTECARD and ll.GetInventoryType("[AV]Xcite_settings") == INVENTORY_NOTECARD then
        return "[AV]Xcite_settings"
    end
    return "[LS]Xcite_settings"
end
local function settingsCardSig(): string
    local name = settingsCard()
    return name .. tostring(ll.GetInventoryKey(name))
end
local notecard_name = settingsCard()
local verbose = 0

local NULL = tostring(NULL_KEY)

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

local function int(v: any): number
    return tonumber(string.match(tostring(v or ""), "^%s*([-+]?%d+)")) or 0
end

local function L(t: {string}, i: number): string
    return t[i] or ""
end

local function replace(s: string, search: string, rep: string): string
    return ll.ReplaceSubString(s, search, rep, 0)
end

local function split(s: string, sep: string): {string}
    return ll.ParseStringKeepNulls(s, {sep}, {})
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

-- Fast notecard reader; onLine returns true to stop reading.
local function readNotecard(name: string, onLine: (string, number) -> boolean, onDone: (number) -> ())
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
            if onLine(data, lineNo) then
                finish()
                return
            end
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
        if onLine(data, lineNo) then
            finish()
            return
        end
        lineNo += 1
        pump()
    end)
    pump()
end

type Setting = { key: string, commands: string, tilt: number } -- key = "pose|sitter"
local SETTINGS: {Setting} = {}
local TIMER_DEFAULT = 30
local TIMERS: {string} = {}
local SITTERS: {string} = {}
local DEBUG = 0
local notecard_key = ""

local function Out(level: number, out: string)
    if verbose >= level then
        print(ll.GetScriptName() .. "[" .. version .. "]:" .. out)
    end
end

-- /0, /1 ... -> first name of that sitter
local function parse_text(say: string): string
    for i, sitter in SITTERS do
        local sitter_name = ll.ParseString2List(ll.Key2Name(K(sitter)), {" "}, {})[1] or ""
        if sitter_name == "" then
            sitter_name = "(nobody)"
        end
        say = replace(say, "/" .. tostring(i - 1), sitter_name)
    end
    return say
end

local function findSetting(key: string): Setting?
    for _, s in SETTINGS do
        if s.key == key then
            return s
        end
    end
    return nil
end

local function onTimer()
    for _, t in TIMERS do
        ll.MessageLinked(LINK_SET, 20001, t, NULL)
        if DEBUG ~= 0 then
            Out(0, "Sending xcite commands: " .. t)
        end
    end
end

local function parseLine(data: string): boolean
    if ll.StringTrim(ll.ToLower(data), STRING_TRIM) == "end" then
        return true
    end
    data = ll.StringTrim(data, STRING_TRIM)
    local command, rest
    local sp = string.find(data, " ", 1, true)
    if sp then
        command = string.sub(data, 1, sp - 1)
        rest = string.sub(data, sp + 1)
    else
        command = ll.GetSubString(data, 1, -2) -- LSL quirk: llGetSubString(data, 0, -2)
        rest = data
    end
    local parts = ll.ParseStringKeepNulls(rest, {" | ", " |", "| ", "|"}, {})
    if command == "TIMER" then
        TIMER_DEFAULT = int(parts[1])
    elseif command == "DEBUG" then
        DEBUG = int(parts[1])
    elseif command == "XCITE" then
        table.insert(SETTINGS, {
            key = ll.StringTrim(L(parts, 1), STRING_TRIM) .. "|" .. L(parts, 2),
            commands = L(parts, 3) .. "|" .. L(parts, 4) .. "|" .. L(parts, 5) .. "|" .. L(parts, 6),
            tilt = int(parts[7]),
        })
    end
    return false
end

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_INVENTORY) ~= 0 then
        if settingsCardSig() ~= notecard_key then
            ll.ResetScript()
        end
    end
    if bit32.band(change, CHANGED_LINK) ~= 0 then
        if ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) == ZERO_VECTOR then
            TIMERS = {}
        end
    end
end)

LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if sender ~= ll.GetLinkNumber() or num ~= 90045 then
        return
    end
    local name = ll.Key2Name(K(id))
    if name == "" then
        return
    end
    for i = #TIMERS, 1, -1 do
        if string.sub(TIMERS[i], 1, #name + 1) == name .. "|" then
            table.remove(TIMERS, i)
        end
    end
    setTimer(TIMER_DEFAULT, onTimer)
    local data = split(msg, "|")
    local script_channel = int(data[1])
    local CURRENT_POSE = L(data, 2)
    SITTERS = split(L(data, 5), "@")
    -- FIX: upstream never looked up "*|<sitter>", so a line such as "XCITE *|1|5|90"
    -- (documented in the example notecard as the default for sitter 1's poses) was
    -- ignored and "*|*" applied. A pose's own line still wins over it.
    local s = findSetting(CURRENT_POSE .. "|" .. tostring(script_channel))
        or findSetting(CURRENT_POSE .. "|*")
        or findSetting("*|" .. tostring(script_channel))
        or findSetting("*|*")
    if not s then
        return
    end
    if s.tilt ~= 0 then
        if DEBUG ~= 0 then
            Out(0, "Setting " .. name .. "'s tilt to " .. tostring(s.tilt))
        end
        ll.MessageLinked(LINK_SET, 20020, name .. "|" .. tostring(s.tilt), "")
    else
        if DEBUG ~= 0 then
            Out(0, "Restoring " .. name .. "'s tilt.")
        end
        ll.MessageLinked(LINK_SET, 20014, name, "")
    end
    local c = split(s.commands, "|")
    table.insert(TIMERS, name .. "|" .. L(c, 1) .. "|" .. L(c, 2) .. "||" .. L(c, 4))
    local commands = parse_text(s.commands)
    ll.MessageLinked(LINK_SET, 20001, name .. "|" .. commands, NULL)
    if DEBUG ~= 0 then
        Out(0, "Sending xcite commands: " .. name .. "|" .. commands)
    end
end)

-- state_entry
notecard_key = settingsCardSig()
Out(0, "Loading...")
if ll.GetInventoryType(notecard_name) == INVENTORY_NOTECARD then
    readNotecard(notecard_name, function(line: string, _n: number): boolean
        return parseLine(line)
    end, function(_total: number)
        Out(0, tostring(#SETTINGS) .. " items Ready, Mem=" .. tostring(ll.GetFreeMemory()))
    end)
else
    Out(0, "Notecard \"" .. notecard_name .. "\" not found.")
end
