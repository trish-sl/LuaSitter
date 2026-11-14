--[[
  [LS]faces-camera - Facial expressions and pose-specific camera settings
  LuaSitter: SLua port of AVsitter(TM) [AV]faces and [AV]camera. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does:
    Replaces upstream [AV]faces and [AV]camera in one script.
    - Faces: reads "ANIM <pose>|<anim>|<secs>|<anim>|<secs>..." lines from the LSpos (or AVpos)
      notecard(s) and, while a sitter plays a matching pose, plays that sequence of
      facial expressions on the sitter. A number instead of an anim name selects one
      of the built-in "express_*" animations. A negative duration re-triggers the
      anim every second while it lasts, "-" holds the sequence there. Expressions are
      played through the sit scripts (90001 start / 90002 stop overlay messages).
    - Camera: reads "CAMERA <pose>|<eye>|<focus>" lines and sets the camera of the
      sitter whenever the sitter plays a matching pose (or the DEFAULT camera), or
      when a camera preset is chosen by a menu BUTTON (90230/90231).

  Copies (one per sitter, like upstream [AV]camera):
    "[LS]faces-camera" is copy 0, "[LS]faces-camera N" is copy N (the number after
    the space). llSetCameraParams acts on the avatar that granted
    PERMISSION_CONTROL_CAMERA, and a script can hold permissions for only one avatar,
    so camera control needs one copy per sitter.
    - Copy N handles CAMERA lines, camera permission and faces of sitter N.
    - Copy 0 handles camera and faces of sitter 0, and the faces of every sitter N
      that has no "[LS]faces-camera N" copy in inventory (re-evaluated on
      CHANGED_INVENTORY without a reset). So a single copy behaves like a single
      [AV]faces (all sitters) plus a single [AV]camera (sitter 0).
    - Copy 0 must be present (the [LS]adjuster looks for it, and only copy 0 answers
      the [FACES] menu toggle).
    - Notecard names: "LSpos" is read when present, else "AVpos" (same format).
    - Per-sitter notecards (based on upstream PR #151): an "LSpos sitter N" card is
      sitter N's section (SITTER header optional). For sitters with an own card, their
      ANIM/CAMERA lines in the main notecard are ignored.

  Link messages (same numbers/formats as upstream, routed per copy):
    - 90020 DUMP (from [LS]adjuster, LINK_THIS): msg = sitter#, id = "[LS]faces-camera".
      Exactly one copy answers: copy N when msg == N, else copy 0 when there is no
      "[LS]faces-camera <msg>" copy. It sends that sitter's ANIM lines then CAMERA lines
      as 90022 (LINK_THIS, line, sitter#), then 90021 (LINK_THIS, sitter#,
      "[LS]faces-camera"). Other copies stay silent.
    - 90172 (adjuster adds/clears an ANIM, msg = sitter#): the copy handling that
      sitter's faces. 90174 (adjuster saves/clears a camera, msg = sitter#): copy N
      only (copy 0 for sitter 0).
    - 90100 "[FACES]" (owner only) toggles expressions in every copy; only copy 0 sends
      the 90101 menu return and the chat confirmation/refusal.
    - 90230/90231 camera preset by BUTTON: the copy whose sitter matches.
    - 90045, 90065, 90070, 90030/90032: as upstream.

  Changes from upstream:
    - Notecards are read with ll.GetNotecardLineSync (async fallback on NAK).
    - Per-sitter cards are found by name for any N (not only N below the number of
      [LS]sit copies), and are read even if the main notecard is missing.
    - The script resets when the main notecard or the per-sitter card of a sitter it
      handles changes (other cards are ignored).
    - 90032 (swap and return the menu, issue #140) is handled like 90030.
    - Running sequences and the last camera chosen by button reference data records.
      FIX: upstream stored list indices, which pointed elsewhere after the adjuster
      removed an ANIM (90172) or CAMERA (90174) line.
    - FIX: numeric (built-in) expressions are stopped (90002) when the sequence
      ends; upstream skipped them, leaving the last one playing until it expired.
    - The [FACES] confirmation and the 90101 menu return are only sent by copy 0
      (several copies would otherwise duplicate them). 90172 re-enables
      expressions in every copy (as upstream [AV]faces).
    - Ready message: "<n> Expressions, <m> Cameras Ready".
    - Timer: one LLTimers timer per copy for the expression sequences.
    - DUMP lines are paced by LLTimers (0.2 s per line, as upstream) instead of
      llSleep, with 90021 sent after the last line; dumps requested while one is
      running are sent after it. The camera refresh after another
      sitter stands up waits 0.1 s on a timer instead of llSleep.
]]

local version = "3.0-lua1"
local product = "LuaSitter faces-camera"
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
local main_notecard = posCard()
local MAIN_KEY = "" -- notecardKeys() entry of the main notecard (value = name .. key)
local main_script = "[LS]sit"

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

local function vec(s: any): vector
    if typeof(s) == "vector" then
        return s
    end
    return tovector(tostring(s or "")) or ZERO_VECTOR
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

local function split(s: string, sep: string): {string}
    return ll.ParseStringKeepNulls(s, {sep}, {})
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
-- Copy identity and responsibilities
--------------------------------------------------------------------------
local scriptName = ll.GetScriptName()

-- "[LS]faces-camera 2" -> base "[LS]faces-camera", SCRIPT_CHANNEL 2
local baseName = scriptName
local SCRIPT_CHANNEL = 0
do
    local sp = string.find(scriptName, " ", 1, true)
    if sp then
        baseName = string.sub(scriptName, 1, sp - 1)
        SCRIPT_CHANNEL = int(string.sub(scriptName, sp))
    end
end

-- copy 0 only: sitters N > 0 that have their own "[LS]faces-camera N" copy
local otherCopies: {[number]: boolean} = {}

local function findOtherCopies(): {[number]: boolean}
    local found = {}
    local prefix = baseName .. " "
    for i = 1, ll.GetInventoryNumber(INVENTORY_SCRIPT) do
        local name = ll.GetInventoryName(INVENTORY_SCRIPT, i)
        if startsWith(name, prefix) then
            local suffix = string.sub(name, #prefix + 1)
            local n = int(suffix)
            if n > 0 and tostring(n) == suffix then
                found[n] = true
            end
        end
    end
    return found
end

-- does this copy handle the faces of sitter s? (also: answers the DUMP for s)
local function handlesFaces(s: number): boolean
    if s == SCRIPT_CHANNEL then
        return true
    end
    return SCRIPT_CHANNEL == 0 and s > 0 and not otherCopies[s]
end

-- per-sitter cards present ("LSpos sitter N", N > 0), name -> N
local function ownNotecards(): {[string]: number}
    local own = {}
    for i = 1, ll.GetInventoryNumber(INVENTORY_NOTECARD) do
        local name = ll.GetInventoryName(INVENTORY_NOTECARD, i)
        local suffix = string.match(name, "^LSpos sitter (%d+)$")
        if suffix then
            local n = int(suffix)
            if n > 0 and tostring(n) == suffix then
                own[name] = n
            end
        end
    end
    return own
end

-- sitter number of a per-sitter card name ("LSpos sitter 2" -> 2), else 0
local function sitterOfCard(name: string): number
    return int(string.match(name, "^LSpos sitter (%d+)$") or "0")
end

-- keys of the notecards this copy depends on (name -> key)
local function notecardKeys(): {[string]: string}
    local main = posCard()
    local keys = { [MAIN_KEY] = main .. tostring(ll.GetInventoryKey(main)) }
    for name, n in ownNotecards() do
        if handlesFaces(n) then
            keys[name] = tostring(ll.GetInventoryKey(name))
        end
    end
    return keys
end

local function sameKeys(a: {[string]: string}, b: {[string]: string}): boolean
    for k, v in a do
        if b[k] ~= v then
            return false
        end
    end
    for k in b do
        if a[k] == nil then
            return false
        end
    end
    return true
end

local verbose = 0

local function Out(level: number, out: string)
    if verbose >= level then
        print(scriptName .. "[" .. version .. "] " .. out)
    end
end

-- Dump lines to the adjuster, paced 0.2 s apart (as upstream, so its event queue
-- cannot overflow), by a queue of LLTimers instead of llSleep.
local outQueue: {() -> ()} = {}
local pumping = false

local function pump()
    local nextItem = table.remove(outQueue, 1)
    if not nextItem then
        pumping = false
        return
    end
    nextItem()
end

local function Readout_Say(say: string, channel: string)
    table.insert(outQueue, function()
        LLTimers:once(0.2, function()
            ll.MessageLinked(LINK_THIS, 90022, say, channel)
            pump()
        end)
    end)
end

-- queue a message to send right after the queued lines
local function Readout_Then(fn: () -> ())
    table.insert(outQueue, function()
        fn()
        pump()
    end)
end

local function Readout_Start()
    if not pumping then
        pumping = true
        pump()
    end
end

--------------------------------------------------------------------------
-- Faces data
--------------------------------------------------------------------------
-- built-in expressions, selectable by 0-based number in ANIM lines
local facial_anim_list = {
    "express_afraid_emote",
    "express_anger_emote",
    "express_laugh_emote",
    "express_bored_emote",
    "express_cry_emote",
    "express_embarrassed_emote",
    "express_sad_emote",
    "express_toothsmile",
    "express_smile",
    "express_surprise_emote",
    "express_worry_emote",
    "express_repulsed_emote",
    "express_shrug_emote",
    "express_wink_emote",
    "express_disdain",
    "express_frown",
    "express_kiss",
    "express_open_mouth",
    "express_tongue_out",
}

-- like upstream IsInteger(): digits only (leading zeros allowed) and fits in an LSL integer
local function isInteger(data: string): boolean
    if data == "" or string.match(data, "^%d+$") == nil then
        return false
    end
    local n = tonumber("1" .. data)
    return n ~= nil and n <= 2147483647
end

-- 0-based expression number -> anim name ("" when out of range, like llList2String)
local function facialName(s: string): string
    return L(facial_anim_list, int(s) + 1)
end

-- One ANIM line. trigger = "sitter#|pose", seq = "anim|secs|anim|secs..."
type Face = { trigger: string, seq: string, anims: {string}, durations: {string} }
local faces: {Face} = {}

local function newFace(trigger: string, seq: string): Face
    local parts = split(seq, "|")
    local anims, durations = {}, {}
    for i, v in parts do
        if i % 2 == 1 then
            table.insert(anims, v)
        else
            table.insert(durations, v)
        end
    end
    return { trigger = trigger, seq = seq, anims = anims, durations = durations }
end

local function findFace(trigger: string): Face?
    for _, f in faces do
        if f.trigger == trigger then
            return f
        end
    end
    return nil
end

-- A sequence currently playing on an avatar (pointer = seconds into the sequence)
type Running = { uuid: string, face: Face, pointer: number }
local running: {Running} = {}

local is_running = true
local SITTERS: {string} = {} -- index sitter#+1 -> avatar key (string)
local SITTER_POSES: {string} = {}

local function get_number_of_scripts(): number
    local i = 1
    while ll.GetInventoryType(main_script .. " " .. tostring(i)) == INVENTORY_SCRIPT do
        i += 1
    end
    return i
end

local function getSitter(n: number): string
    return SITTERS[n + 1] or NULL
end

local function setSitter(n: number, id: string)
    if n < 0 then
        return
    end
    for i = #SITTERS + 1, n do
        SITTERS[i] = NULL
    end
    SITTERS[n + 1] = id
end

local function init_sitters()
    SITTERS = {}
    SITTER_POSES = {}
    for i = 1, get_number_of_scripts() do
        SITTERS[i] = NULL
        SITTER_POSES[i] = ""
    end
end

--------------------------------------------------------------------------
-- Sequence player
--------------------------------------------------------------------------
local faceTimer: any = nil

local function stopTimer()
    if faceTimer then
        LLTimers:off(faceTimer)
        faceTimer = nil
    end
end

-- one tick (one second) of all running sequences
local function sequence()
    local anims: {string} = {}
    local uuids: {string} = {}
    for _, r in running do
        local p = r.pointer
        local sAnims = r.face.anims
        local sDur = r.face.durations
        local sequence_length = 0
        local held = false
        -- j is the 0-based position as in upstream; loop runs once past the last duration
        for k = 1, #sDur + 1 do
            local j = k - 1
            -- duration of the previous anim (upstream read index -1 = last for j = 0;
            -- that value can never satisfy the repeat test below, so it is harmless)
            local lastDuration = int(if j == 0 then L(sDur, -1) else L(sDur, j))
            local repeats = false
            if lastDuration < 0 then
                repeats = true
                lastDuration = math.abs(lastDuration)
            end
            local anim = ""
            if p == sequence_length then
                anim = ll.StringTrim(L(sAnims, j + 1), STRING_TRIM)
            elseif repeats and p > sequence_length - lastDuration and p < sequence_length - 1 then
                anim = ll.StringTrim(if j == 0 then L(sAnims, -1) else L(sAnims, j), STRING_TRIM)
            end
            if anim ~= "" then
                if isInteger(anim) then
                    anim = facialName(anim)
                end
                table.insert(anims, anim)
                table.insert(uuids, r.uuid)
            end
            if L(sDur, j + 1) == "-" then
                -- hold here: keep counting, never wrap
                p += 1
                held = true
                break
            end
            sequence_length += math.abs(int(L(sDur, j + 1)))
        end
        if not held then
            p += 1
            if p == sequence_length then
                p = 0
            end
        end
        r.pointer = p
    end
    for i, anim in anims do
        if anim ~= "none" and is_running then
            ll.MessageLinked(LINK_THIS, 90001, anim, uuids[i])
        end
    end
end

local function start_sequence(face: Face, av: string)
    for i, r in running do
        -- upstream only checked the first running entry using this sequence
        if r.face == face then
            if r.uuid == av then
                table.remove(running, i)
            end
            break
        end
    end
    table.insert(running, { uuid = av, face = face, pointer = 0 })
    -- first tick right away (0.01 s), then every second
    stopTimer()
    faceTimer = LLTimers:once(0.01, function()
        faceTimer = LLTimers:every(1, function()
            sequence()
        end)
        sequence()
    end)
end

-- stop all anims of a sequence on an avatar
local function stop_anims(face: Face, id: string)
    for _, a in face.anims do
        if a ~= "none" then
            if isInteger(a) then
                -- FIX: upstream skipped numeric expressions here, never stopping them
                local name = facialName(a)
                if name ~= "" then
                    ll.MessageLinked(LINK_THIS, 90002, name, id)
                end
            else
                ll.MessageLinked(LINK_THIS, 90002, a, id)
            end
        end
    end
end

-- remove (and stop) running sequences matching a filter
local function remove_running(match: (Running) -> boolean)
    local i = 1
    while i <= #running do
        local r = running[i]
        if match(r) then
            table.remove(running, i)
            stop_anims(r.face, r.uuid)
        else
            i += 1
        end
    end
    if #running == 0 then
        stopTimer()
    end
end

-- remove (and stop) all sequences running on an avatar
local function remove_sequences(id: string)
    remove_running(function(r: Running): boolean
        return r.uuid == id
    end)
end

-- forget the ANIM lines of sitter s (another copy took it over)
local function drop_faces_of(s: number)
    local prefix = tostring(s) .. "|"
    remove_running(function(r: Running): boolean
        return startsWith(r.face.trigger, prefix)
    end)
    for i = #faces, 1, -1 do
        if startsWith(faces[i].trigger, prefix) then
            table.remove(faces, i)
        end
    end
end

--------------------------------------------------------------------------
-- Camera data
--------------------------------------------------------------------------
type Camera = { trigger: string, settings: string }
local cameras: {Camera} = {}

local myPose = ""
local mySitter = "" -- key as string ("" = never set, like an uninitialised LSL key)
local lastByButton: Camera? = nil -- last camera record chosen by a menu button
local lastPose = ""

local function findCamera(trigger: string): Camera?
    for _, c in cameras do
        if c.trigger == trigger then
            return c
        end
    end
    return nil
end

local function set_camera(byButton: boolean)
    if not isKey(mySitter) then
        return
    end
    if bit32.band(ll.GetPermissions(), PERMISSION_CONTROL_CAMERA) ~= 0
        and tostring(ll.GetPermissionsKey()) == mySitter then
        local cam = findCamera(myPose)
        if cam == nil then
            if lastByButton ~= nil then
                cam = lastByButton
            else
                cam = findCamera("DEFAULT")
            end
        end
        if cam then
            if byButton then
                lastByButton = cam
            end
            local settings = split(cam.settings, "|")
            local r = ll.GetRot()
            local p = ll.GetPos()
            local pos = vec(L(settings, 1)) * r + p
            local focus = vec(L(settings, 2)) * r + p
            ll.SetCameraParams({
                CAMERA_ACTIVE, 1,
                CAMERA_FOCUS, focus,
                CAMERA_FOCUS_LOCKED, 1,
                CAMERA_POSITION, pos,
                CAMERA_POSITION_LOCKED, 1,
                CAMERA_FOCUS_OFFSET, ZERO_VECTOR,
            })
        else
            ll.SetCameraParams({ CAMERA_ACTIVE, 0 })
        end
        return
    end
    ll.RequestPermissions(K(mySitter), PERMISSION_CONTROL_CAMERA)
end

--------------------------------------------------------------------------
-- Notecard loading
--------------------------------------------------------------------------
-- returns command, part0 (trimmed), part1 (trimmed rest after the first "|")
local function parseLine(data: string): (string, string, string)
    local diamond = ll.SubStringIndex(data, "◆")
    if diamond then
        data = ll.GetSubString(data, diamond + 1, -1)
    end
    data = ll.StringTrim(data, STRING_TRIM)
    local sp = ll.SubStringIndex(data, " ")
    -- upstream quirk: without a space the command is the line minus its last character
    local command = if sp then ll.GetSubString(data, 1, sp - 1) else ll.GetSubString(data, 1, -2)
    local rest = if sp then ll.GetSubString(data, sp + 1, -1) else data
    local parts = ll.ParseStringKeepNulls(rest, { " | ", " |", "| ", "|" }, {})
    local tail = {}
    for i = 2, #parts do
        table.insert(tail, parts[i])
    end
    return command, ll.StringTrim(L(parts, 1), STRING_TRIM), ll.StringTrim(table.concat(tail, "|"), STRING_TRIM)
end

-- Load ANIM lines of the sitters in `only` (nil = every sitter this copy handles)
-- and, when withCameras, the CAMERA lines of SCRIPT_CHANNEL.
local function loadData(only: {[number]: boolean}?, withCameras: boolean, onDone: () -> ())
    local own = ownNotecards()
    local ownBySitter: {[number]: boolean} = {}
    for _, n in own do
        ownBySitter[n] = true
    end
    local function wanted(s: number): boolean
        return handlesFaces(s) and (only == nil or only[s] == true)
    end
    local queue: {{name: string, sitter: number?}} = {}
    if ll.GetInventoryType(main_notecard) == INVENTORY_NOTECARD then
        table.insert(queue, { name = main_notecard, sitter = nil })
    end
    for name, n in own do
        if wanted(n) or (withCameras and n == SCRIPT_CHANNEL) then
            table.insert(queue, { name = name, sitter = n })
        end
    end
    local function readNext(q: number)
        local item = queue[q]
        if item == nil then
            onDone()
            return
        end
        -- a per-sitter card is sitter N's section; a "SITTER N" header in it is optional
        local section = item.sitter or 0
        readNotecard(item.name, function(line: string, _n: number)
            local command, part0, part1 = parseLine(line)
            if command == "SITTER" then
                section = int(part0)
                return
            end
            if command ~= "ANIM" and command ~= "CAMERA" then
                return
            end
            -- per-sitter cards take precedence over the main card's section
            local keep
            if item.sitter ~= nil then
                keep = section == item.sitter
            else
                keep = not ownBySitter[section]
            end
            if not keep then
                return
            end
            if command == "ANIM" then
                -- checked at insertion time: responsibilities may change while loading
                if wanted(section) then
                    local seq = ll.ParseString2List(part1, { "|" }, {})
                    table.insert(faces, newFace(tostring(section) .. "|" .. part0, table.concat(seq, "|")))
                end
            elseif withCameras and section == SCRIPT_CHANNEL then
                table.insert(cameras, { trigger = part0, settings = part1 })
            end
        end, function(_total: number)
            readNext(q + 1)
        end)
    end
    readNext(1)
end

--------------------------------------------------------------------------
-- Events
--------------------------------------------------------------------------
LLEvents:on("run_time_permissions", function(perm: number)
    if bit32.band(perm, PERMISSION_CONTROL_CAMERA) ~= 0 then
        set_camera(false)
    end
end)

LLEvents:on("on_rez", function(_start: number)
    is_running = true
    -- cancel all sequences as there can't be anyone sitting
    while #running > 0 do
        remove_sequences(running[1].uuid)
    end
end)

local function dump(msg: string)
    local s = int(msg)
    for _, f in faces do
        if startsWith(f.trigger, msg .. "|") then
            local data = ll.ParseString2List(f.trigger, { "|" }, {})
            local seq = ll.ParseString2List(f.seq, { "|" }, {})
            for x = 1, #seq, 2 do
                if isInteger(seq[x]) then
                    seq[x] = facialName(seq[x])
                end
            end
            Readout_Say("ANIM " .. L(data, 2) .. "|" .. table.concat(seq, "|"), msg)
        end
    end
    if s == SCRIPT_CHANNEL then
        for _, c in cameras do
            Readout_Say("CAMERA " .. c.trigger .. "|" .. c.settings, msg)
        end
    end
    Readout_Then(function()
        ll.MessageLinked(LINK_THIS, 90021, msg, baseName)
    end)
    Readout_Start()
end

LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if num == 90100 then
        -- menu button pressed: "[FACES]" toggles expressions (owner only) in every copy
        local data = ll.ParseString2List(msg, { "|" }, {})
        if L(data, 2) == "[FACES]" then
            local talk = SCRIPT_CHANNEL == 0
            if talk then
                ll.MessageLinked(sender, 90101, L(data, 1) .. "|[ADJUST]|" .. id, L(data, 3))
            end
            if id == tostring(ll.GetOwner()) then
                is_running = not is_running
                if talk and sender == ll.GetLinkNumber() then
                    ll.RegionSayTo(K(id), 0, "Facial Expressions " .. (if is_running then "ON" else "OFF"))
                end
            elseif talk then
                ll.RegionSayTo(K(id), 0, "Sorry, only the owner can change this.")
            end
        end
        return
    end
    if sender ~= ll.GetLinkNumber() then
        return
    end
    if num == 90045 then
        -- pose playing: "sitter#|pose|..." id = sitter uuid
        local data = split(msg, "|")
        local sitter = int(L(data, 1))
        -- faces
        if sitter >= 0 and handlesFaces(sitter) and id == getSitter(sitter) then
            local given_posename = L(data, 2)
            SITTER_POSES[sitter + 1] = given_posename
            given_posename = tostring(sitter) .. "|" .. given_posename
            remove_sequences(id)
            for _, f in faces do
                if f.trigger == given_posename then
                    -- an ANIM line may name another ANIM line of the same sitter (alias)
                    local target = findFace(tostring(sitter) .. "|" .. f.seq) or f
                    start_sequence(target, id)
                end
            end
        end
        -- camera
        if sitter == SCRIPT_CHANNEL then
            mySitter = id
            myPose = L(data, 2)
            lastPose = myPose
            set_camera(false)
        end
    elseif num == 90065 then
        -- someone stood up
        remove_sequences(id)
        for i, s in SITTERS do
            if s == id then
                SITTERS[i] = NULL
                break
            end
        end
        if id == mySitter then
            lastByButton = nil
            mySitter = NULL
        else
            LLTimers:once(0.1, function() -- upstream: llSleep(0.1)
                set_camera(false)
            end)
        end
    elseif num == 90030 or num == 90032 then
        -- swap (90032: swap and return the menu): both seats are re-sat
        local a, b = int(msg), int(id)
        if a >= 0 and a < #SITTERS then
            SITTERS[a + 1] = NULL
        end
        if b >= 0 and b < #SITTERS then
            SITTERS[b + 1] = NULL
        end
    elseif num == 90070 then
        setSitter(int(msg), id)
    elseif num == 90230 or num == 90231 then
        -- camera chosen from a menu button: id = "controller|...|sitter"
        local data = split(id, "|")
        local this_controller = L(data, 1)
        local this_sitter = L(data, -1)
        if this_sitter == mySitter then
            myPose = msg
            if myPose == "RESET" then
                lastByButton = nil
                myPose = lastPose
            end
            set_camera(true)
            if num == 90230 then
                ll.MessageLinked(LINK_THIS, 90005, "", this_controller)
            end
        end
    elseif num == 90172 then
        -- adjuster: set ("anim") or clear ("none") the expression for the current pose
        is_running = true -- in every copy, as upstream [AV]faces
        local sitter = int(msg)
        if sitter < 0 or not handlesFaces(sitter) then
            return
        end
        local pose = SITTER_POSES[sitter + 1] or ""
        local av = getSitter(sitter)
        remove_sequences(av)
        for i = #faces, 1, -1 do
            if faces[i].trigger == msg .. "|" .. pose then
                table.remove(faces, i)
            end
        end
        if id ~= "none" then
            local f = newFace(msg .. "|" .. pose, id .. "|1")
            table.insert(faces, f)
            start_sequence(f, av)
            ll.Say(0, "FACE added: '" .. id .. "' to '" .. pose .. "' for SITTER " .. tostring(sitter) .. ".")
        end
    elseif num == 90174 and int(msg) == SCRIPT_CHANNEL then
        -- adjuster: save ("eye|focus") or clear ("none") the camera for the current pose
        for i = #cameras, 1, -1 do
            if cameras[i].trigger == myPose then
                if lastByButton == cameras[i] then
                    lastByButton = nil
                end
                table.remove(cameras, i)
            end
        end
        if id ~= "none" then
            table.insert(cameras, { trigger = myPose, settings = id })
            ll.Say(0, "CAMERA saved to '" .. myPose .. "' for SITTER " .. tostring(SCRIPT_CHANNEL) .. ".")
            ll.Say(0, "CAMERA " .. myPose .. "|" .. id)
        else
            ll.Say(0, "CAMERA cleared from '" .. myPose .. "' for SITTER " .. tostring(SCRIPT_CHANNEL) .. ".")
        end
        set_camera(false)
    elseif num == 90020 and id == baseName then
        -- adjuster DUMP request for sitter msg: exactly one copy answers
        local s = int(msg)
        if s >= 0 and handlesFaces(s) then
            dump(msg)
        end
    end
end)

--------------------------------------------------------------------------
-- Init
--------------------------------------------------------------------------
init_sitters()
if SCRIPT_CHANNEL == 0 then
    otherCopies = findOtherCopies()
end
local notecard_keys = notecardKeys()

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_INVENTORY) == 0 then
        return
    end
    -- copy 0: hand over / take back the faces of sitters whose own copy came or went
    if SCRIPT_CHANNEL == 0 then
        local before = otherCopies
        otherCopies = findOtherCopies()
        local gained: {[number]: boolean} = {}
        local anyGained = false
        for n in before do
            if not otherCopies[n] then
                gained[n] = true
                anyGained = true
            end
        end
        for n in otherCopies do
            if not before[n] then
                drop_faces_of(n)
            end
        end
        -- a changed notecard of a sitter we handle resets below; skip loading then
        local keys = notecardKeys()
        if not sameKeys(keys, notecard_keys) then
            -- only cards of sitters handled before AND now count as "changed"; cards of
            -- newly handled sitters are simply read below
            local reset = keys[MAIN_KEY] ~= notecard_keys[MAIN_KEY]
            for name, k in keys do
                local n = sitterOfCard(name)
                if name ~= MAIN_KEY and not gained[n] and notecard_keys[name] ~= k then
                    reset = true
                end
            end
            for name in notecard_keys do
                local n = sitterOfCard(name)
                if name ~= MAIN_KEY and keys[name] == nil and handlesFaces(n) then
                    reset = true
                end
            end
            if reset then
                ll.ResetScript()
            end
            notecard_keys = keys
        end
        if anyGained then
            loadData(gained, false, function() end)
        end
    elseif not sameKeys(notecardKeys(), notecard_keys) then
        ll.ResetScript()
    end
    if get_number_of_scripts() ~= #SITTERS then
        init_sitters()
    end
end)

if ll.GetInventoryType(main_notecard) == INVENTORY_NOTECARD or next(ownNotecards()) ~= nil then
    Out(0, product .. " loading...")
    loadData(nil, true, function()
        Out(0, tostring(#faces) .. " Expressions, " .. tostring(#cameras) .. " Cameras Ready, Mem="
            .. tostring(ll.GetFreeMemory()))
    end)
end
