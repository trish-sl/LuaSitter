--[[
  [LS]options - textures, colours, lights, glow, alpha and sounds per pose or per button
  LuaSitter plugin (new, no AVsitter equivalent).
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the LuaSitter Contributors

  What it does
  ------------
  Optional. Changes how prims of the furniture look or sound (a bed lamp, the
  colour of the sheets, music) when a pose plays, when a menu button is
  clicked, or when everyone has stood up, so creators don't need their own
  LSL for that. Put it, with its notecard "[LS]options_settings", in any prim
  of the furniture (textures and sounds named in the notecard go in that same
  prim). Without the script nothing changes.

  Notecard "[LS]options_settings" (blank lines and lines starting with #, //
  or -- are ignored):

      OPTION <name>|<target>|<setting>|<setting>...
          <target>  a prim name (every prim with that name), * (the prim of
                    this script) or root (the root prim), optionally with
                    :<face>[,<face>...] (faces 0-7; default all faces)
          settings  texture <inventory name or UUID>  (keeps repeats, offsets, rotation)
                    color <r> <g> <b>                  (0-1, or 0-255; also <r,g,b>)
                    alpha <0-1>
                    glow <0-1>
                    fullbright on|off
                    light <r> <g> <b> [<intensity> <radius> <falloff>] | light on | light off
                    sound <inventory name or UUID> [<volume>] [loop] | sound stop
          Several OPTION lines with the same name add up (one per target).
      TOGGLE <name>|<option>|<option>...   each use applies the next option, in turn
      POSE <pose>|<option>[|<sitter>]      when that pose (menu name) plays; pose * = any
                                           pose, sitter = SITTER number (default: any).
                                           Most specific wins: pose|sitter, pose, *|sitter, *.
      BUTTON <number>|<option or toggle>[|<message>]
                                           on link message <number> (for example from an
                                           LSpos "BUTTON Lamp|97" line); with <message>,
                                           only when the message is that text
      EMPTY <option>                       when the last sitter stands up

  Link message 90250 (msg = option or toggle name) applies it, so an LSpos
  line "BUTTON Lamp on|90250" in the pose menu applies the option "Lamp on".
  Problems in the notecard (unknown settings, missing prims, textures or
  sounds, references to unknown options) are said to the owner, with their
  line number, once per load.

  Nothing is restored on reset or rez: Second Life keeps prim settings and
  looping sounds, so the furniture stays as it was. A TOGGLE starts again at
  its first option after a reset.

  Link messages: receives 90045, 90250 and the numbers of its BUTTON lines.
  (see LuaSitter2/LINK_MESSAGES.md)
]]

local SCRIPT = ll.GetScriptName()
local CARD = "[LS]options_settings"
local MAX_PROBLEMS = 20

local function cardSig(): string
    if ll.GetInventoryType(CARD) ~= INVENTORY_NOTECARD then
        return ""
    end
    return tostring(ll.GetInventoryKey(CARD))
end
local card_sig = cardSig()

local function trim(s: string?): string
    return ll.StringTrim(s or "", STRING_TRIM)
end

local function isKey(s: string): boolean
    return string.match(s, "^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$") ~= nil
end

-- every number in a text ("1 0.5 0", "<1, 0.5, 0>")
local function numbers(s: string): {number}
    local out = {}
    for token in string.gmatch(s, "[-+]?[%d%.]+") do
        local n = tonumber(token)
        if n == nil then
            return {}
        end
        table.insert(out, n)
    end
    return out
end

-- a colour from 0-1 values, or 0-255 when any value is above 1
local function colour(n: {number}): vector
    local scale = if n[1] > 1 or n[2] > 1 or n[3] > 1 then 255 else 1
    return vector(n[1] / scale, n[2] / scale, n[3] / scale)
end

--------------------------------------------------------------------------
-- settings
--------------------------------------------------------------------------
type Light = { on: boolean, color: vector, intensity: number, radius: number, falloff: number }
type Target = {
    prim: string, faces: {number},
    texture: string?, color: vector?, alpha: number?, glow: number?, fullbright: boolean?,
    light: Light?, sound: string?, volume: number, loop: boolean,
}
type Ref = { line: number, name: string, toggle: boolean } -- an option named by another line

local OPTIONS: {[string]: {Target}} = {}    -- option name -> targets
local TOGGLES: {[string]: {string}} = {}    -- toggle name -> option names
local toggleAt: {[string]: number} = {}     -- toggle name -> option last applied (0 = none yet)
local POSES: {[string]: {string}} = {}      -- "pose|sitter" (or *) -> option names
local BUTTONS: {[number]: {{ name: string, msg: string? }}} = {}
local EMPTY: {string} = {}
local refs: {Ref} = {}
local problems: {string} = {}
local optionLine: {[string]: number} = {}   -- first line of each OPTION / TOGGLE (for name clashes)

local function problem(line: number, text: string)
    table.insert(problems, "line " .. tostring(line) .. ": " .. text)
end

--------------------------------------------------------------------------
-- prims: names -> link numbers (cached until the links change)
--------------------------------------------------------------------------
local linkCache: {[string]: {number}} = {}
local ruleCache: {[string]: {any}} = {}     -- option name -> PRIM_* rules that don't depend on the prim
local soundOn: {[number]: string} = {}      -- link -> looping sound we started (pose lines don't restart it)
local ALL_FACES = { ALL_SIDES }              -- the faces of a target without :<faces> (never changed)

-- prims without the seated avatars (they are the last links)
local function primCount(): number
    local n = ll.GetNumberOfPrims()
    while n > 1 and ll.GetAgentSize(ll.GetLinkKey(n)) ~= ZERO_VECTOR do
        n -= 1
    end
    return n
end

local function linksOf(prim: string): {number}
    local cached = linkCache[prim]
    if cached then
        return cached
    end
    local out = {}
    local n = primCount()
    if prim == "*" or (n <= 1 and (prim == "root" or prim == ll.GetObjectName())) then
        table.insert(out, ll.GetLinkNumber())
    elseif prim == "root" then
        table.insert(out, LINK_ROOT)
    elseif n > 1 then
        for link = 1, n do
            if ll.GetLinkName(link) == prim then
                table.insert(out, link)
            end
        end
    end
    linkCache[prim] = out
    return out
end

--------------------------------------------------------------------------
-- reading the notecard
--------------------------------------------------------------------------
local function parseTarget(line: number, text: string): Target?
    local prim, faceText = string.match(text, "^(.-)%s*:%s*([%d%s,]+)$")
    local faces = {}
    if prim and #linksOf(trim(prim)) == 0 and #linksOf(trim(text)) > 0 then
        prim = nil -- a prim name with a colon in it, such as "Clock 12:30"
    end
    if prim and prim ~= "" then
        for f in string.gmatch(faceText or "", "%d+") do
            local face = tonumber(f) or 0
            if face > 7 then
                problem(line, "face " .. f .. " (faces are 0 to 7).")
                return nil
            end
            table.insert(faces, face)
        end
    else
        prim = text
    end
    prim = trim(prim)
    if prim == "" then
        problem(line, "no target prim (a prim name, * or root).")
        return nil
    end
    if #linksOf(prim) == 0 then
        problem(line, "no prim named \"" .. prim .. "\".")
        return nil
    end
    return {
        prim = prim, faces = faces,
        texture = nil, color = nil, alpha = nil, glow = nil, fullbright = nil,
        light = nil, sound = nil, volume = 1, loop = false,
    }
end

-- one "keyword value" setting into the target; false (and a problem) when wrong
local function parseSetting(line: number, t: Target, setting: string): boolean
    local word, value = string.match(setting, "^(%S+)%s*(.-)$")
    word = string.lower(word or "")
    value = trim(value)
    local lower = string.lower(value)
    local n = numbers(value)
    if word == "texture" then
        if value == "" or not (isKey(value) or ll.GetInventoryType(value) == INVENTORY_TEXTURE) then
            problem(line, "texture \"" .. value .. "\" is not in the prim's contents (or not a UUID).")
            return false
        end
        t.texture = value
    elseif word == "color" or word == "colour" then
        if #n < 3 then
            problem(line, "color needs three numbers, for example color 1 0.5 0.")
            return false
        end
        t.color = colour(n)
    elseif word == "alpha" or word == "glow" then
        if #n ~= 1 then
            problem(line, word .. " needs a number from 0 to 1.")
            return false
        end
        local v = math.clamp(n[1], 0, 1)
        if word == "alpha" then
            t.alpha = v
        else
            t.glow = v
        end
    elseif word == "fullbright" then
        if lower == "on" or lower == "1" or lower == "yes" or lower == "true" then
            t.fullbright = true
        elseif lower == "off" or lower == "0" or lower == "no" or lower == "false" then
            t.fullbright = false
        else
            problem(line, "fullbright needs on or off.")
            return false
        end
    elseif word == "light" then
        if lower == "off" or lower == "0" then
            t.light = { on = false, color = vector(1, 1, 1), intensity = 1, radius = 10, falloff = 0.75 }
        elseif lower == "on" or lower == "1" then
            t.light = { on = true, color = vector(1, 1, 1), intensity = 1, radius = 10, falloff = 0.75 }
        elseif #n >= 3 then
            t.light = {
                on = true, color = colour(n),
                intensity = math.clamp(n[4] or 1, 0, 1),
                radius = math.clamp(n[5] or 10, 0.1, 20),
                falloff = math.clamp(n[6] or 0.75, 0.01, 2),
            }
        else
            problem(line, "light needs off, on, or a colour (and intensity, radius, falloff).")
            return false
        end
    elseif word == "sound" then
        if lower == "stop" then
            t.sound = ""
            return true
        end
        local name = value
        local function known(s: string): boolean
            return s ~= "" and (isKey(s) or ll.GetInventoryType(s) == INVENTORY_SOUND)
        end
        if not known(name) then
            -- "<name> [<volume>] [loop]"
            local rest, last = string.match(name, "^(.-)%s*(%S+)$")
            if last and string.lower(last) == "loop" then
                t.loop = true
                name = trim(rest)
            end
            local before, vol = string.match(name, "^(.-)%s+([%d%.]+)$")
            if before and tonumber(vol) and not known(name) then
                t.volume = math.clamp(tonumber(vol) or 1, 0, 1)
                name = trim(before)
            end
        end
        if not known(name) then
            problem(line, "sound \"" .. name .. "\" is not in the prim's contents (or not a UUID).")
            return false
        end
        t.sound = name
    else
        problem(line, "unknown setting \"" .. setting .. "\" (texture, color, alpha, glow, fullbright, light, sound).")
        return false
    end
    return true
end

local function addRef(line: number, name: string, toggle: boolean): boolean
    if name == "" then
        problem(line, "no option name.")
        return false
    end
    table.insert(refs, { line = line, name = name, toggle = toggle })
    return true
end

local function parseLine(data: string, line: number)
    data = trim(data)
    if data == "" or string.sub(data, 1, 1) == "#" or string.sub(data, 1, 2) == "//" or string.sub(data, 1, 2) == "--" then
        return
    end
    local command, rest = string.match(data, "^(%S+)%s*(.*)$")
    command = command or ""
    local parts = ll.ParseStringKeepNulls(rest or "", { "|" }, {})
    for i, p in parts do
        parts[i] = trim(p)
    end
    local first = parts[1] or ""
    if command == "OPTION" then
        if first == "" then
            problem(line, "OPTION without a name.")
            return
        end
        if TOGGLES[first] then
            problem(line, "\"" .. first .. "\" is already a TOGGLE.")
            return
        end
        if (parts[2] or "") == "" then
            problem(line, "OPTION " .. first .. ": no target prim (a prim name, * or root).")
            return
        end
        local t = parseTarget(line, parts[2])
        if t == nil then
            return
        end
        if #parts < 3 then
            problem(line, "OPTION " .. first .. ": no settings.")
            return
        end
        for i = 3, #parts do
            if parts[i] ~= "" and not parseSetting(line, t, parts[i]) then
                return
            end
        end
        if OPTIONS[first] == nil then
            OPTIONS[first] = {}
            optionLine[first] = line
        end
        table.insert(OPTIONS[first], t)
    elseif command == "TOGGLE" then
        if first == "" or #parts < 2 then
            problem(line, "TOGGLE needs a name and options: TOGGLE <name>|<option>|<option>.")
            return
        end
        if OPTIONS[first] or TOGGLES[first] then
            problem(line, "\"" .. first .. "\" is already an OPTION or TOGGLE.")
            return
        end
        local list = {}
        for i = 2, #parts do
            if addRef(line, parts[i], false) then
                table.insert(list, parts[i])
            end
        end
        TOGGLES[first] = list
        toggleAt[first] = 0
        optionLine[first] = line
    elseif command == "POSE" then
        local option = parts[2] or ""
        local sitter = parts[3] or ""
        if first == "" then
            problem(line, "POSE needs a pose name (or *): POSE <pose>|<option>[|<sitter>].")
            return
        end
        if sitter == "" then
            sitter = "*"
        elseif sitter ~= "*" and string.match(sitter, "^%d+$") == nil then
            problem(line, "sitter \"" .. sitter .. "\" is not a SITTER number.")
            return
        else
            sitter = tostring(tonumber(sitter) or sitter)
        end
        if not addRef(line, option, false) then
            return
        end
        -- [LS]sit cuts pose names to 23 characters
        local key = (if first == "*" then "*" else ll.GetSubString(first, 1, 23)) .. "|" .. sitter
        POSES[key] = POSES[key] or {}
        table.insert(POSES[key], option)
    elseif command == "BUTTON" then
        local num = if string.match(first, "^[-+]?%d+$") then tonumber(first) else nil
        if num == nil then
            problem(line, "BUTTON needs a link message number: BUTTON <number>|<option>[|<message>].")
            return
        end
        if num == 90250 then
            problem(line, "BUTTON 90250 is not needed: 90250 applies the option named in its message.")
            return
        end
        if not addRef(line, parts[2] or "", true) then
            return
        end
        BUTTONS[num] = BUTTONS[num] or {}
        table.insert(BUTTONS[num], { name = parts[2], msg = if #parts >= 3 then parts[3] else nil })
    elseif command == "EMPTY" then
        if addRef(line, first, false) then
            table.insert(EMPTY, first)
        end
    else
        problem(line, "unknown line \"" .. ll.GetSubString(data, 1, 40) .. "\" (OPTION, TOGGLE, POSE, BUTTON, EMPTY; # for comments).")
    end
end

-- after the last line: lines naming options that don't exist
local function checkRefs()
    for _, r in refs do
        if OPTIONS[r.name] == nil and not (r.toggle and TOGGLES[r.name]) then
            if TOGGLES[r.name] then
                problem(r.line, "\"" .. r.name .. "\" is a TOGGLE; only BUTTON lines and 90250 can use it.")
            else
                problem(r.line, "no OPTION named \"" .. r.name .. "\".")
            end
        end
    end
    refs = {}
end

local hadProblems = false

local function report()
    if #problems == 0 then
        return
    end
    hadProblems = true
    print(SCRIPT .. ": " .. tostring(#problems) .. " problem(s) in the notecard \"" .. CARD .. "\":")
    for i, p in problems do
        if i > MAX_PROBLEMS then
            print("... and " .. tostring(#problems - MAX_PROBLEMS) .. " more.")
            break
        end
        print(p)
    end
end

--------------------------------------------------------------------------
-- applying options
--------------------------------------------------------------------------

-- the PRIM_* rules of an option that never change (built once until the links change)
local function staticRules(name: string): {any}
    local rules = ruleCache[name]
    if rules then
        return rules
    end
    rules = {}
    local targets: {Target} = OPTIONS[name] or {}
    for _, t in targets do
        local faces = if #t.faces == 0 then ALL_FACES else t.faces
        for _, link in linksOf(t.prim) do
            local start = #rules
            table.insert(rules, PRIM_LINK_TARGET)
            table.insert(rules, link)
            for _, face in faces do
                if t.color and t.alpha then
                    table.move({ PRIM_COLOR, face, t.color, t.alpha }, 1, 4, #rules + 1, rules)
                end
                if t.glow then
                    table.move({ PRIM_GLOW, face, t.glow }, 1, 3, #rules + 1, rules)
                end
                if t.fullbright ~= nil then
                    table.move({ PRIM_FULLBRIGHT, face, t.fullbright }, 1, 3, #rules + 1, rules)
                end
            end
            local l = t.light
            if l then
                table.move({ PRIM_POINT_LIGHT, l.on, l.color, l.intensity, l.radius, l.falloff }, 1, 6, #rules + 1, rules)
            end
            if #rules == start + 2 then -- nothing for this prim
                table.remove(rules)
                table.remove(rules)
            end
        end
    end
    ruleCache[name] = rules
    return rules
end

-- the settings that depend on the prim (texture repeats, colour without alpha...), and sounds
local function applyDynamic(t: Target, fromPose: boolean)
    local faces = if #t.faces == 0 then ALL_FACES else t.faces
    for _, link in linksOf(t.prim) do
        local tex = t.texture
        if tex then
            local rules = {}
            for _, face in faces do
                -- keep each face's repeats, offsets and rotation
                local cur = ll.GetLinkPrimitiveParams(link, { PRIM_TEXTURE, face })
                local f = if face == ALL_SIDES then 0 else face
                for i = 1, #cur - 3, 4 do
                    table.move({ PRIM_TEXTURE, f, tex, cur[i + 1], cur[i + 2], cur[i + 3] }, 1, 6, #rules + 1, rules)
                    f += 1
                end
            end
            if #rules > 0 then
                ll.SetLinkPrimitiveParamsFast(link, rules)
            end
        end
        if (t.color == nil) ~= (t.alpha == nil) then
            for _, face in faces do
                if t.color then
                    ll.SetLinkColor(link, t.color, face)
                elseif t.alpha then
                    ll.SetLinkAlpha(link, t.alpha, face)
                end
            end
        end
        local sound = t.sound
        if sound == "" then
            ll.LinkStopSound(link)
            soundOn[link] = nil
        elseif sound then
            local sig = sound .. "|" .. tostring(t.volume)
            -- a pose line doesn't restart the loop it already plays (SYNC poses send one 90045 per sitter)
            if not (fromPose and t.loop and soundOn[link] == sig) then
                ll.LinkPlaySound(link, sound, t.volume, if t.loop then SOUND_LOOP else SOUND_PLAY)
                soundOn[link] = if t.loop then sig else nil
            end
        end
    end
end

local function applyOption(name: string, fromPose: boolean)
    local targets = OPTIONS[name]
    if targets == nil then
        return
    end
    local rules = staticRules(name)
    if #rules > 0 then
        ll.SetLinkPrimitiveParamsFast(LINK_THIS, rules)
    end
    for _, t in targets do
        applyDynamic(t, fromPose)
    end
    -- toggles go on from the option applied last
    for toggle, list in TOGGLES do
        local i = table.find(list, name)
        if i then
            toggleAt[toggle] = i
        end
    end
end

-- an option, or the next option of a toggle
local function applyName(name: string)
    local list = TOGGLES[name]
    if list then
        if #list > 0 then
            applyOption(list[(toggleAt[name] or 0) % #list + 1], false)
        end
    else
        applyOption(name, false)
    end
end

local function posePlayed(msg: string)
    local data = ll.ParseStringKeepNulls(msg, { "|" }, {})
    local sitter = tostring(tonumber(data[1]) or 0)
    local pose = data[2] or ""
    local list: {string} = POSES[pose .. "|" .. sitter] or POSES[pose .. "|*"]
        or POSES["*|" .. sitter] or POSES["*|*"] or {}
    for _, name in list do
        applyOption(name, true)
    end
end

--------------------------------------------------------------------------
-- events
--------------------------------------------------------------------------
local loaded = false
local occupied = ll.GetNumberOfPrims() > primCount()

LLEvents:on("link_message", function(_sender: number, num: number, msg: string, _id: string)
    if not loaded then
        return
    end
    if num == 90045 then
        posePlayed(msg)
    elseif num == 90250 then
        applyName(trim(msg))
    end
    local buttons = BUTTONS[num]
    if buttons then
        for _, b in buttons do
            if b.msg == nil or b.msg == msg then
                applyName(b.name)
            end
        end
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_INVENTORY) ~= 0 then
        -- the notecard changed, or a texture / sound it missed may have been added
        if cardSig() ~= card_sig or hadProblems then
            ll.ResetScript()
        end
    end
    if bit32.band(change, CHANGED_LINK) ~= 0 then
        linkCache = {}
        ruleCache = {}
        local now = ll.GetNumberOfPrims() > primCount()
        if occupied and not now and loaded then
            for _, name in EMPTY do
                applyOption(name, false)
            end
        end
        occupied = now
    end
end)

--------------------------------------------------------------------------
-- start: read the notecard (fast reader, dataserver when not cached)
--------------------------------------------------------------------------
local function finished()
    checkRefs()
    report()
    problems = {}
    loaded = true
end

if card_sig == "" then
    print(SCRIPT .. ": no \"" .. CARD .. "\" notecard in this prim, nothing to do.")
else
    local line = 1
    local query: uuid? = nil
    local handler: any = nil
    local function done()
        if handler then
            LLEvents:off("dataserver", handler)
            handler = nil
        end
        finished()
    end
    local function pump()
        while true do
            local data = ll.GetNotecardLineSync(CARD, line)
            if data == NAK then
                query = ll.GetNotecardLine(CARD, line)
                return
            elseif data == EOF then
                done()
                return
            end
            parseLine(data, line)
            line += 1
        end
    end
    handler = LLEvents:on("dataserver", function(qid: uuid, data: string)
        if qid ~= query then
            return
        end
        query = nil
        if data == EOF then
            done()
            return
        end
        parseLine(data, line)
        line += 1
        pump()
    end)
    pump()
end
