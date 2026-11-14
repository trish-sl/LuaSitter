--[[
  [LS]commands - chat commands for sitters (for gestures) and arrow-key pose adjusting
  LuaSitter plugin (new, no AVsitter equivalent).
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the LuaSitter Contributors

  What it does
  ------------
  Optional. Put it in the prim with the [LS]sit scripts. While someone sits,
  that sitter can say commands on a chat channel (1888 by default), for
  example from gestures bound to keys:

      /1888 menu     the pose menu (like touching the furniture)
      /1888 adjust   the personal adjust menu
      /1888 keys     arrow keys move the pose (again: stop)
      /1888 swap     swap seats ([SWAP], or the [LS]select seat menu)
      /1888 next     next pose of the current menu (prev: previous)
      /1888 rlv      the RLV menu (RLV furniture, dominant seats)
      /1888 help     this list

  Each sitter has their own listen, filtered on their key, open only while
  they sit. With "Keys" (adjust menu button, or the keys command) the arrow
  keys and PgUp/PgDn move the sitter's pose by the smallest step (0.01 m, or
  1° in the adjust menu's Rotation mode), and Shift+Left/Right (strafe) turn
  it by 1° in either mode; [SAVE] keeps it.
  The keys are given back when pressed again, after 60 s without a key,
  when the sitter leaves the adjust menu with [BACK], or stands up.

  Settings (main LSpos / AVpos notecard, optional):
      COMMANDS <channel>   channel of the commands (default 1888; 0 = off)

  Rules, so a command can't do what the menus wouldn't allow:
    - With [LS]root-security, every command needs menu access (90013 ->
      90016), and "menu" is handled exactly like a touch by the sitter.
    - In RLV furniture ([LS]root-RLV), commands other than "menu" only work
      for sitters in a dominant (D) seat (ROLES).
    - adjust/keys follow AMENU; swap follows SWAP, ONSIT ASK and [LS]select.
    - There is no "stand" command: unseating by script would bypass RLV.

  Link messages: sends 90005, 90009, 90013, 90017, 90018, 90100, 90101 (and
  90021, 90022 for DUMP); receives 90005, 90016, 90020, 90065, 90070, 90100.
  (see LuaSitter2/LINK_MESSAGES.md)
]]

local SCRIPT = ll.GetScriptName()
local DEFAULT_CHANNEL = 1888
local security_script = "[LS]root-security"
local rlv_script = "[LS]root-RLV"
local select_script = "[LS]select"
local sit_script = "[LS]sit"

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

local function int(v: any): number
    return tonumber(string.match(tostring(v or ""), "^%s*([-+]?%d+)")) or 0
end

local function hasScript(name: string): boolean
    return ll.GetInventoryType(name) == INVENTORY_SCRIPT
end

local function posCard(): string
    if ll.GetInventoryType("LSpos") ~= INVENTORY_NOTECARD and ll.GetInventoryType("AVpos") == INVENTORY_NOTECARD then
        return "AVpos"
    end
    return "LSpos"
end

--------------------------------------------------------------------------
-- settings (from the notecard)
--------------------------------------------------------------------------
local channel = DEFAULT_CHANNEL
local channel_line = false -- a COMMANDS line was read (dumped back by DUMP)
local ROLES = ""            -- RLV seat letters ("DS"...)
local AMENU = 2
local SWAP = 2
local ONSIT = ""
local notecard = posCard()
local notecard_key = tostring(ll.GetInventoryKey(notecard))

local function parseLine(data: string)
    local diamond = ll.SubStringIndex(data, "◆")
    if diamond then
        data = ll.GetSubString(data, diamond + 1, -1)
    end
    data = ll.StringTrim(data, STRING_TRIM)
    local command, rest = string.match(data, "^(%S+)%s*(.*)$")
    if command == nil then
        return
    end
    local first = ll.StringTrim(string.match(rest or "", "^([^|]*)") or "", STRING_TRIM)
    if command == "COMMANDS" then
        channel = if first == "" then DEFAULT_CHANNEL else int(first)
        channel_line = true
    elseif command == "ROLES" then
        ROLES = table.concat(ll.ParseString2List(rest, { "|", " " }, {}))
    elseif command == "AMENU" then
        AMENU = int(first)
    elseif command == "SWAP" then
        SWAP = int(first)
    elseif command == "ONSIT" then
        ONSIT = first
    end
end

--------------------------------------------------------------------------
-- sitters and their listens
--------------------------------------------------------------------------
local SITTERS: {[number]: string} = {} -- sitter number -> avatar key
local listens: {[string]: number} = {} -- avatar key -> listen handle

local function sitterOf(k: string): number?
    for n, who in SITTERS do
        if who == k then
            return n
        end
    end
    return nil
end

-- one listen per seated sitter, filtered on their key
local function syncListens()
    for k, h in listens do
        if sitterOf(k) == nil or channel == 0 then
            ll.ListenRemove(h)
            listens[k] = nil
        end
    end
    if channel == 0 then
        return
    end
    for _, k in SITTERS do
        if listens[k] == nil then
            listens[k] = ll.Listen(channel, "", K(k), "")
        end
    end
end

local function tell(k: string, text: string)
    ll.RegionSayTo(K(k), 0, text)
end

--------------------------------------------------------------------------
-- arrow keys (one sitter at a time: a script holds permissions for one avatar)
--------------------------------------------------------------------------
local KEYS = bit32.bor(CONTROL_FWD, CONTROL_BACK, CONTROL_LEFT, CONTROL_RIGHT,
    CONTROL_ROT_LEFT, CONTROL_ROT_RIGHT, CONTROL_UP, CONTROL_DOWN)
-- Seated, Left/Right arrows give CONTROL_ROT_LEFT/RIGHT and Shift+Left/Right (strafe)
-- CONTROL_LEFT/RIGHT: those turn the pose. (Shift with the other keys can't be told apart.)
local KEY_NAMES = {
    { CONTROL_FWD, "fwd" }, { CONTROL_BACK, "back" },
    { CONTROL_ROT_LEFT, "left" }, { CONTROL_ROT_RIGHT, "right" },
    { CONTROL_LEFT, "turnleft" }, { CONTROL_RIGHT, "turnright" },
    { CONTROL_UP, "up" }, { CONTROL_DOWN, "down" },
}
local keysWho = ""     -- sitter whose keys we have (or asked for)
local keysOn = false
local idleTimer: any = nil
local lastMove = 0

local function keysOff(say: string?)
    if idleTimer then
        LLTimers:off(idleTimer)
        idleTimer = nil
    end
    local who = keysWho
    keysWho = ""
    if keysOn then
        keysOn = false
        if bit32.band(ll.GetPermissions(), PERMISSION_TAKE_CONTROLS) ~= 0 then
            ll.ReleaseControls()
        end
        if say and who ~= "" then
            tell(who, say)
        end
    end
end

local function keysIdle()
    if idleTimer then
        LLTimers:off(idleTimer)
    end
    idleTimer = LLTimers:once(60, function()
        idleTimer = nil
        keysOff("Keys off (no key pressed for 60 s).")
    end)
end

local function keysStart(k: string)
    keysOff()
    keysWho = k
    -- granted automatically to an avatar sitting on the object
    ll.RequestPermissions(K(k), PERMISSION_TAKE_CONTROLS)
end

LLEvents:on("run_time_permissions", function(perm: number)
    if keysWho ~= "" and tostring(ll.GetPermissionsKey()) == keysWho
        and bit32.band(perm, PERMISSION_TAKE_CONTROLS) ~= 0 then
        ll.TakeControls(KEYS, true, false)
        keysOn = true
        keysIdle()
        tell(keysWho, "Keys on: arrows and PgUp/PgDn move your pose by 0.01 m, Shift+Left/Right turns it by 1° (the adjust menu's Rotation button makes all keys turn). Keys again to stop.")
    end
end)

LLEvents:on("control", function(avatar: uuid, level: number, edge: number)
    if not keysOn or tostring(avatar) ~= keysWho then
        return
    end
    local bits = bit32.band(level, edge) -- just pressed
    if bits == 0 then
        -- held down: repeat a few times per second
        if level == 0 or ll.GetTime() - lastMove < 0.3 then
            return
        end
        bits = level
    end
    local pressed = {}
    for _, kn in KEY_NAMES do
        if bit32.band(bits, kn[1]) ~= 0 then
            table.insert(pressed, kn[2])
        end
    end
    if #pressed > 0 then
        lastMove = ll.GetTime()
        ll.MessageLinked(LINK_SET, 90018, table.concat(pressed, "|"), keysWho)
        keysIdle()
    end
end)

--------------------------------------------------------------------------
-- commands
--------------------------------------------------------------------------
local HELP = "menu, adjust, keys, swap, next, prev, rlv, help"

local function sitterCount(): number
    local n = 1
    while hasScript(sit_script .. " " .. tostring(n)) do
        n += 1
    end
    return n
end

local function runCommand(k: string, cmd: string)
    local n = sitterOf(k)
    if n == nil then
        return
    end
    local function no()
        tell(k, "\"" .. cmd .. "\" is not available here.")
    end
    if cmd == "menu" then
        ll.MessageLinked(LINK_SET, 90005, "", k)
        return
    elseif cmd == "help" then
        tell(k, "Commands on channel " .. tostring(channel) .. ": " .. HELP .. ". For example /" .. tostring(channel) .. " menu, or a gesture that says it.")
        return
    end
    -- RLV furniture: only a dominant seat may act without going through the menu
    if hasScript(rlv_script) and ll.GetSubString(ROLES, n + 1, n + 1) ~= "D" then
        no()
        return
    end
    local seat = tostring(n)
    if cmd == "adjust" or cmd == "keys" then
        if bit32.band(AMENU, 3) == 0 then
            no()
        elseif cmd == "adjust" then
            ll.MessageLinked(LINK_SET, 90101, seat .. "|[ADJUST]|" .. k, k)
        elseif keysOn and keysWho == k then
            keysOff("Keys off.")
        else
            keysStart(k)
        end
    elseif cmd == "swap" then
        if hasScript(select_script) then
            ll.MessageLinked(LINK_SET, 90009, k, k)
        elseif SWAP ~= 0 and string.sub(ONSIT, 1, 3) ~= "ASK" and sitterCount() > 1 then
            ll.MessageLinked(LINK_SET, 90101, seat .. "|[SWAP]|" .. k, k)
        else
            no()
        end
    elseif cmd == "next" or cmd == "prev" then
        ll.MessageLinked(LINK_SET, 90017, if cmd == "next" then "1" else "-1", k)
    elseif cmd == "rlv" then
        if hasScript(rlv_script) then
            ll.MessageLinked(LINK_SET, 90100, seat .. "|Control...|" .. k, k)
        else
            no()
        end
    else
        tell(k, "Unknown command \"" .. cmd .. "\". Commands: " .. HELP .. ".")
    end
end

LLEvents:on("listen", function(_chan: number, _name: string, id: uuid, msg: string)
    local k = tostring(id)
    if sitterOf(k) == nil then
        return
    end
    local cmd = string.lower(ll.StringTrim(msg, STRING_TRIM))
    if hasScript(security_script) and cmd ~= "help" then
        -- [LS]root-security checks menu access: "menu" as a touch, others answered by 90016
        ll.MessageLinked(LINK_SET, 90013, cmd, k)
    else
        runCommand(k, cmd)
    end
end)

LLEvents:on("link_message", function(_sender: number, num: number, msg: string, id: string)
    if num == 90070 then -- sitter <msg> is <id>
        local n = int(msg)
        for m, who in SITTERS do
            if who == id then
                SITTERS[m] = nil
            end
        end
        SITTERS[n] = id
        syncListens()
    elseif num == 90065 then -- sitter <msg> (<id>) gone
        local n = int(msg)
        if SITTERS[n] == id then
            SITTERS[n] = nil
        end
        if keysWho == id then
            keysOff()
        end
        syncListens()
    elseif num == 90016 then -- [LS]root-security allows a command
        runCommand(id, msg)
    elseif num == 90100 then
        -- "Keys" in [LS]sit's adjust menu: msg = "<sitter#>|Keys|<sitter>|...", id = who clicked
        local data = ll.ParseStringKeepNulls(msg, { "|" }, {})
        if data[2] == "Keys" and data[3] == id and sitterOf(id) then
            if keysOn and keysWho == id then
                keysOff("Keys off.")
            else
                keysStart(id)
            end
        end
    elseif num == 90005 then
        -- [BACK] from the adjust menu (or any menu) of the sitter with the keys: give them back
        if keysWho ~= "" and string.find(id, keysWho, 1, true) then
            keysOff("Keys off.")
        end
    elseif num == 90020 and id == SCRIPT then
        -- DUMP ([LS]adjuster): our notecard line, then pass on
        if msg == "0" and channel_line then
            ll.MessageLinked(LINK_THIS, 90022, "COMMANDS " .. tostring(channel), msg)
        end
        ll.MessageLinked(LINK_THIS, 90021, msg, SCRIPT)
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_INVENTORY) ~= 0 then
        if posCard() ~= notecard or tostring(ll.GetInventoryKey(notecard)) ~= notecard_key then
            ll.ResetScript()
        end
    end
end)

--------------------------------------------------------------------------
-- start: read the settings (fast reader, dataserver when not cached)
--------------------------------------------------------------------------
if ll.GetInventoryType(notecard) == INVENTORY_NOTECARD then
    local line = 1
    local query: uuid? = nil
    local handler: any = nil
    local function pump()
        while true do
            local data = ll.GetNotecardLineSync(notecard, line)
            if data == NAK then
                query = ll.GetNotecardLine(notecard, line)
                return
            elseif data == EOF then
                if handler then
                    LLEvents:off("dataserver", handler)
                end
                syncListens()
                return
            end
            parseLine(data)
            line += 1
        end
    end
    handler = LLEvents:on("dataserver", function(qid: uuid, data: string)
        if qid ~= query then
            return
        end
        if data == EOF then
            LLEvents:off("dataserver", handler)
            syncListens()
            return
        end
        parseLine(data)
        line += 1
        pump()
    end)
    pump()
end
