--[[
  [LS]plugins - Props, pose sequences and favourites in one script
  LuaSitter: SLua port of AVsitter(TM) [AV]prop, [AV]sequence and [AV]favs. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does:
    One script holding three independent features (modules):
      - PROP: rezzes props when the matching pose plays (90045) or when a BUTTON
        fires 90200/90220. Enabled by PROP/PROP1/PROP2/PROP3 lines in LSpos or AVpos (or
        props added at runtime with 90171 from [LS]adjuster / 90173 from [LS]menu).
        Talks to the props ([LS]object or the LSL [AV]object) over a random
        negative chat channel; the chat protocol and the rez start parameter are
        byte-identical to upstream.
      - SEQUENCE: plays sequences of poses defined in "[LS]sequence_settings"
        (fallback "[AV]sequence_settings"). A sequence starts when a pose/menu item
        of the same name is chosen (90000 / 90008) or from a [SEQUENCE] button
        (90210, which shows the previous / pause-play / next control dialog).
      - FAVS: per avatar and per seat favourite poses, in memory only. BUTTON lines
        send 90401 (add the playing pose), 90402 (remove it), 90403 (show the list).

  Replaces (merges) upstream [AV]prop, [AV]sequence and [AV]favs. [LS]menu and
  [LS]object are separate scripts.

  Structure:
    - shared prelude (helpers, Out, resetAll)
    - one `do ... end` block per module (PROP, SEQUENCE, FAVS), each with its own
      state and its own event handlers (LLEvents allows several handlers per
      event). Modules do not call each other; the only shared action is resetAll().

  Changes from the three upstream scripts:
    - A single feature cannot be removed, but an unused feature costs almost
      nothing:
        PROP without props: no chat listen is opened (it opens on the first rez),
        and no REM_* commands are chatted (nothing can have been rezzed).
        SEQUENCE without a settings notecard: its link_message / listen / on_rez
        handlers are never registered; only the inventory check remains.
        FAVS: a link_message handler only; a listen exists only while its dialog
        is open.
    - Resets: the script resets (ll.ResetScript) on any of the upstream scripts'
      reset triggers: LSpos (or AVpos) notecard changed (prop), sequence settings
      notecard added/changed/removed (sequence), number of "[LS]sit N" scripts
      changed while sequences are loaded (sequence). A reset reloads all three
      modules, so the in-memory favourites are lost (upstream [AV]favs never
      reset). Before every reset the prop module sends REM_ALL (as upstream
      [AV]prop did before its notecard reset), because after a reset the prop
      chat channel changes and earlier props could not be controlled.
    - Dump: the prop module answers 90020 when id == "[LS]plugins" (upstream: its
      script name "[AV]prop"), sends its 90022 lines and then 90021 with
      id = "[LS]plugins". The 90022 lines are paced by a timer (0.2 s apart, like
      upstream's llSleep) instead of blocking the script.
    - Startup chat: "N Props Ready" is only said when there are props, and
      "N Sequences Ready" only when a sequence notecard exists.
    - FAVS "Memory full" check: the script memory is shared by the three
      modules, so the check (5.5 KB below the SLua memory limit) accounts for the
      props and sequences loaded too.
    - Module-specific changes are listed above each module.
]]

local version = "3.0-lua1"
local SCRIPT = "[LS]plugins" -- name used on the 90020/90021 dump protocol

local NULL = tostring(NULL_KEY)

--------------------------------------------------------------------------
-- Shared helpers
--------------------------------------------------------------------------
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

local function num(v: any): number
    if type(v) == "number" then
        return v
    end
    local s = tostring(v or "")
    return tonumber(string.match(s, "^%s*([-+]?%d*%.?%d+[eE][-+]?%d+)") or string.match(s, "^%s*([-+]?%d*%.?%d+)") or "") or 0
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

local function Out(out: string)
    print(ll.GetScriptName() .. "[" .. version .. "] " .. out)
end

local function freeMem(): string
    return tostring(ll.GetMemoryLimit() - ll.GetUsedMemory())
end

-- Reset the whole script (all modules). Modules add cleanup hooks that run
-- first (the prop module removes its props). Safe to call more than once.
local resetHooks: {() -> ()} = {}
local resetting = false
local function resetAll()
    if resetting then
        return
    end
    resetting = true
    for _, hook in resetHooks do
        hook()
    end
    ll.ResetScript()
end

--------------------------------------------------------------------------
-- PROP module (upstream [AV]prop)
--   Works with the sit script "[LS]sit" (copies "[LS]sit 1", ...); for mixed
--   setups the LSL "[AV]sitA" is also recognised when no "[LS]sit" is present.
--   Without any sit script it works in "menu mode" ([LS]menu / [AV]menu).
--   Changes from upstream:
--     - 90032 (swap and return the menu, issue #140) is handled like 90030.
--     - Fast notecard reader (sync read with async fallback).
--------------------------------------------------------------------------
do
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

    -- LSL (string)vector format
    local function fmtVec(v: vector): string
        return string.format("<%.5f, %.5f, %.5f>", v.x, v.y, v.z)
    end

    -- LSL element(text, x): x is 0-based
    local function element(text: string, x: number): string
        return L(split(text, "|"), x + 1)
    end

    type Prop = {
        trigger: string, -- "<sitter>|<pose>"
        ptype: number, -- 0..3
        object: string,
        group: string, -- "<sitter>|<group>"
        pos: vector,
        rot: vector, -- euler degrees
        point: string, -- attach point text
    }

    local props: {Prop} = {} -- index i (1-based) is prop id i-1 on the chat protocol
    local sequential_prop_groups: {string} = {}
    local SITTERS: {string} = {} -- 1-based; SITTERS[s+1] is sitter #s
    local SITTER_POSES: {string} = {}
    local WARN = 1
    local comm_channel = 0
    local listen_handle: number = 0
    local notecard_key = NULL
    local notecard_section = 0
    local HAVENTNAGGED = true

    local ATTACH_POINTS: {any} = {
        {ATTACH_CHEST, "chest"},
        {ATTACH_HEAD, "head"},
        {ATTACH_LSHOULDER, "left shoulder"},
        {ATTACH_RSHOULDER, "right shoulder"},
        {ATTACH_LHAND, "left hand"},
        {ATTACH_RHAND, "right hand"},
        {ATTACH_LFOOT, "left foot"},
        {ATTACH_RFOOT, "right foot"},
        {ATTACH_BACK, "back"},
        {ATTACH_PELVIS, "pelvis"},
        {ATTACH_MOUTH, "mouth"},
        {ATTACH_CHIN, "chin"},
        {ATTACH_LEAR, "left ear"},
        {ATTACH_REAR, "right ear"},
        {ATTACH_LEYE, "left eye"},
        {ATTACH_REYE, "right eye"},
        {ATTACH_NOSE, "nose"},
        {ATTACH_RUARM, "right upper arm"},
        {ATTACH_RLARM, "right lower arm"},
        {ATTACH_LUARM, "left upper arm"},
        {ATTACH_LLARM, "left lower arm"},
        {ATTACH_RHIP, "right hip"},
        {ATTACH_RULEG, "right upper leg"},
        {ATTACH_RLLEG, "right lower leg"},
        {ATTACH_LHIP, "left hip"},
        {ATTACH_LULEG, "left upper leg"},
        {ATTACH_LLLEG, "left lower leg"},
        {ATTACH_BELLY, "stomach"},
        {ATTACH_LEFT_PEC, "left pectoral"},
        {ATTACH_RIGHT_PEC, "right pectoral"},
        {ATTACH_HUD_CENTER_2, "HUD center 2"},
        {ATTACH_HUD_TOP_RIGHT, "HUD top right"},
        {ATTACH_HUD_TOP_CENTER, "HUD top"},
        {ATTACH_HUD_TOP_LEFT, "HUD top left"},
        {ATTACH_HUD_CENTER_1, "HUD center"},
        {ATTACH_HUD_BOTTOM_LEFT, "HUD bottom left"},
        {ATTACH_HUD_BOTTOM, "HUD bottom"},
        {ATTACH_HUD_BOTTOM_RIGHT, "HUD bottom right"},
        {ATTACH_NECK, "neck"},
        {ATTACH_AVATAR_CENTER, "avatar center"},
    }

    -- The sit script in this prim: "[LS]sit", or the LSL "[AV]sitA" for mixed
    -- setups. nil when there is none (menu mode).
    local function main_script(): string?
        if ll.GetInventoryType("[LS]sit") == INVENTORY_SCRIPT then
            return "[LS]sit"
        elseif ll.GetInventoryType("[AV]sitA") == INVENTORY_SCRIPT then
            return "[AV]sitA"
        end
        return nil
    end

    local function get_number_of_scripts(): number
        local base = main_script() or "[LS]sit"
        local i = 1
        while ll.GetInventoryType(base .. " " .. tostring(i)) == INVENTORY_SCRIPT do
            i += 1
        end
        return i
    end

    local function getSitter(s: number): string
        return SITTERS[s + 1] or NULL
    end

    -- like llListReplaceList(SITTERS, [v], s, s): appends when past the end
    local function setSitter(s: number, v: string)
        if s < 0 then
            return
        end
        if s >= #SITTERS then
            table.insert(SITTERS, v)
        else
            SITTERS[s + 1] = v
        end
    end

    local function get_point(text: string): number
        local up = ll.ToUpper(text)
        for _, ap in ATTACH_POINTS do
            if string.find(up, ll.ToUpper(ap[2]), 1, true) then
                return ap[1]
            end
        end
        return 0
    end

    -- New random chat channel. The listen itself is opened lazily by rez_prop
    -- (props are the only senders on this channel).
    local function init_channel()
        if listen_handle ~= 0 then
            ll.ListenRemove(listen_handle)
            listen_handle = 0
        end
        comm_channel = -(int(ll.Frand(8999)) + 1000)
    end

    -- index is the 0-based prop id
    local function rez_prop(index: number)
        local p = props[index + 1]
        if p == nil then
            return
        end
        local object = p.object
        if object ~= "" then
            local pos = p.pos * ll.GetRot() + ll.GetPos()
            local r = ll.Euler2Rot(p.rot * DEG_TO_RAD) * ll.GetRot()
            if ll.GetInventoryType(object) ~= INVENTORY_OBJECT then
                ll.Say(0, "Could not find prop '" .. object .. "'.")
                return
            end
            local perms = ll.GetInventoryPermMask(object, MASK_NEXT)
            local nextText = "  for NEXT owner"
            if WARN > 1 then
                nextText = ""
                perms = -1
                if WARN == 2 then
                    perms = ll.GetInventoryPermMask(object, MASK_OWNER)
                end
            end
            local ptype = p.ptype
            if ptype == 0 or ptype == 3 then
                if bit32.band(perms, PERM_COPY) == 0 then
                    ll.Say(0, "Can't rez '" .. object .. "'. Props and their content must be COPY-OK" .. nextText)
                    return
                end
            elseif ptype > 0 then
                if bit32.band(perms, PERM_COPY) == 0 or bit32.band(perms, PERM_TRANSFER) == 0 then
                    ll.Say(0, "Can't rez '" .. object .. "'. Attachment props and their content must be COPY-TRANSFER" .. nextText)
                    return
                end
            end
            if listen_handle == 0 then
                listen_handle = ll.Listen(comm_channel, "", NULL_KEY, "")
            end
            -- Param must be:
            --   - Negative
            --   - 4 digits comm_channel
            --   - 2 digits prop_id (index)
            --   - 2 digits attachment point
            --   - 1 digit prop_type
            local point = get_point(p.point)
            ll.RezAtRoot(object, pos, ZERO_VECTOR, r, comm_channel * 100000 - (index * 1000 + point * 10 + ptype))
        end
    end

    -- Without any prop definition nothing can have been rezzed: stay silent.
    local function send_command(command: string)
        if #props == 0 then
            return
        end
        ll.RegionSay(comm_channel, command)
        ll.Say(comm_channel, command)
    end

    local function remove_all_props()
        send_command("REM_ALL")
    end

    local function rez_props_by_trigger(pose_name: string)
        for i, p in props do
            if p.trigger == pose_name then
                rez_prop(i - 1)
            end
        end
    end

    -- returns 0-based prop ids
    local function get_props_by_pose(pose_name: string): {number}
        local out = {}
        for i, p in props do
            if p.trigger == pose_name then
                table.insert(out, i - 1)
            end
        end
        return out
    end

    local function remove_props_by_sitter(sitter: string, remove_type3: boolean)
        local text = {}
        for i, p in props do
            if startsWith(p.trigger, sitter .. "|") then
                if p.ptype ~= 3 or remove_type3 then
                    table.insert(text, tostring(i - 1))
                end
            end
        end
        local command = "REM_INDEX"
        if main_script() == nil then
            command = "REM_WORLD"
        end
        if #text > 0 then
            send_command(command .. "|" .. table.concat(text, "|"))
        end
    end

    local function remove_worn(av: string)
        send_command("REM_WORN|" .. av)
    end

    local function remove_sitter_props_by_pose(sitter_pose: string, remove_type3: boolean)
        local text = {}
        for i, p in props do
            if p.trigger == sitter_pose then
                if p.ptype ~= 3 or remove_type3 then
                    table.insert(text, tostring(i - 1))
                end
            end
        end
        if #text > 0 then
            send_command("REM_INDEX|" .. table.concat(text, "|"))
        end
    end

    -- gp is the 1-based index in sequential_prop_groups
    local function remove_props_by_group(gp: number?)
        local group = if gp then sequential_prop_groups[gp] or "" else ""
        local text = ""
        for i, p in props do
            if p.group == group then
                text ..= "|" .. tostring(i - 1)
            end
        end
        if text ~= "" then
            if main_script() then
                -- with a sit script: send the command to all sitters
                send_command("REM_INDEX" .. text)
            else
                -- no sit script, so presumably [LS]menu: avoid removing others' attachments
                send_command("REM_WORLD" .. text) -- this removes inworld props only
                local s0 = getSitter(0)
                if isKey(s0) then
                    -- send command privately to current sitter
                    ll.RegionSayTo(K(s0), comm_channel, "REM_INDEX" .. text)
                end
            end
        end
    end

    local function remove_sitter_props_by_pose_group(msg: string)
        local groups = {}
        for _, i in get_props_by_pose(msg) do
            local prop_group = props[i + 1].group
            if table.find(groups, prop_group) == nil then
                table.insert(groups, prop_group)
                remove_props_by_group(table.find(sequential_prop_groups, prop_group))
            end
        end
    end

    -- Dump output queue: 90022 lines 0.2 s apart (upstream llSleep(0.2) before
    -- each line), 90021 sent right after the last line.
    type Linked = { n: number, msg: string, id: string }
    local dumpQueue: {Linked} = {}
    local dumpTimer: any = nil

    local function flushDumpEnds()
        while dumpQueue[1] ~= nil and dumpQueue[1].n == 90021 do
            local item = table.remove(dumpQueue, 1) :: Linked
            ll.MessageLinked(LINK_THIS, item.n, item.msg, item.id)
        end
    end

    local function dumpTick()
        local item = table.remove(dumpQueue, 1)
        if item then
            ll.MessageLinked(LINK_THIS, item.n, item.msg, item.id) -- dump to [LS]adjuster / [LS]menu
        end
        flushDumpEnds()
        if #dumpQueue == 0 and dumpTimer then
            LLTimers:off(dumpTimer)
            dumpTimer = nil
        end
    end

    local function queueDump(lines: {string}, msg: string)
        for _, line in lines do
            table.insert(dumpQueue, { n = 90022, msg = line, id = "" })
        end
        table.insert(dumpQueue, { n = 90021, msg = msg, id = SCRIPT }) -- notify finished dumping
        if dumpTimer == nil then
            flushDumpEnds()
            if #dumpQueue > 0 then
                dumpTimer = LLTimers:every(0.2, dumpTick)
            end
        end
    end

    local function init_sitters()
        SITTERS = {}
        SITTER_POSES = {}
        for _ = 1, get_number_of_scripts() do
            table.insert(SITTERS, NULL)
            table.insert(SITTER_POSES, "")
        end
    end

    local function addProp(p: Prop)
        table.insert(props, p)
        if table.find(sequential_prop_groups, p.group) == nil then
            table.insert(sequential_prop_groups, p.group)
        end
    end

    table.insert(resetHooks, remove_all_props)

    LLEvents:on("link_message", function(sender: number, n: number, msg: string, id: string)
        if sender ~= ll.GetLinkNumber() then
            return
        end
        if n == 90045 then -- play pose
            local data = split(msg, "|")
            local sitter = int(L(data, 1))
            if id == getSitter(sitter) then
                remove_sitter_props_by_pose(SITTER_POSES[sitter + 1] or "", false)
                local given_posename = tostring(sitter) .. "|" .. L(data, 2)
                if sitter >= 0 then
                    if sitter >= #SITTER_POSES then
                        table.insert(SITTER_POSES, given_posename)
                    else
                        SITTER_POSES[sitter + 1] = given_posename
                    end
                end
                remove_sitter_props_by_pose_group(given_posename)
                rez_props_by_trigger(given_posename)
            end
            return
        end
        if n == 90200 or n == 90220 then -- rez or clear prop with/without sending menu back
            local ids = split(id, "|")
            local sitting_av_or_sitter = L(ids, -1)
            local hasMain = main_script() ~= nil
            if not hasMain then
                SITTERS = {sitting_av_or_sitter}
            end
            if startsWith(msg, "remprop_") then
                local pose = string.sub(msg, 9)
                for i = 0, #SITTERS - 1 do
                    if SITTERS[i + 1] == sitting_av_or_sitter or id == "" or sitting_av_or_sitter == tostring(i) then
                        remove_sitter_props_by_pose(tostring(i) .. "|" .. pose, true)
                    end
                end
            else
                local flag = false
                for i = 0, #SITTERS - 1 do
                    for _, p in props do
                        if p.trigger == tostring(i) .. "|" .. msg then
                            flag = true
                            break
                        end
                    end
                end
                for i = 0, #SITTERS - 1 do
                    if SITTERS[i + 1] == sitting_av_or_sitter or id == "" or sitting_av_or_sitter == tostring(i) then
                        local trig = tostring(i) .. "|" .. msg
                        local found = false
                        for _, p in props do
                            if p.trigger == trig then
                                found = true
                                break
                            end
                        end
                        if not found then
                            if not hasMain then
                                remove_all_props()
                            elseif not flag then
                                remove_props_by_sitter(tostring(i), true)
                            end
                        else
                            remove_sitter_props_by_pose_group(trig)
                            rez_props_by_trigger(trig)
                        end
                    end
                end
            end
            if isKey(sitting_av_or_sitter) then
                if n == 90200 then -- send menu back?
                    -- send menu to same id
                    ll.MessageLinked(LINK_THIS, 90005, "", id)
                end
            end
            return
        end
        if n == 90101 then -- menu choice
            local data = ll.ParseString2List(msg, {"|"}, {})
            if L(data, 2) == "[SAVE]" and #props > 0 then
                ll.RegionSay(comm_channel, "PROPSEARCH")
            end
            return
        end
        if n == 90065 then -- stand up
            remove_props_by_sitter(msg, false)
            remove_worn(id)
            local index = table.find(SITTERS, id)
            if index then
                SITTERS[index] = NULL
            end
            return
        end
        if n == 90030 or n == 90032 then -- swap (90032: swap and return the menu, issue #140)
            remove_props_by_sitter(msg, false)
            remove_props_by_sitter(id, false)
            setSitter(int(msg), NULL)
            setSitter(int(id), NULL)
            return
        end
        if n == 90070 then -- update list of sitters
            setSitter(int(msg), id)
            return
        end
        if n == 90171 or n == 90173 then -- [LS]adjuster/[LS]menu add PROP line
            local sitter: number
            local trigger: string
            if n == 90171 then -- [LS]adjuster?
                sitter = int(msg)
                trigger = SITTER_POSES[sitter + 1] or ""
            else
                sitter = 0
                SITTER_POSES = {"0|" .. msg}
                trigger = "0|" .. msg
            end
            addProp({
                trigger = trigger,
                ptype = 0,
                object = id,
                group = tostring(sitter) .. "|G1",
                pos = vector(0, 0, 1),
                rot = ZERO_VECTOR,
                point = "",
            })
            rez_prop(#props - 1)
            local text = "PROP added: '" .. id .. "' to '" .. element(SITTER_POSES[sitter + 1] or "", 1) .. "'"
            if #SITTERS > 1 then
                text ..= " for SITTER " .. tostring(sitter)
            end
            ll.Say(0, text)
            ll.Say(0, "Position your prop and click [SAVE].")
            return
        end
        if n == 90020 and id == SCRIPT then -- dump our settings
            local lines = {}
            for _, p in props do
                if startsWith(p.trigger, msg .. "|") then
                    local ptype = tostring(p.ptype)
                    if ptype == "0" then
                        ptype = ""
                    end
                    table.insert(lines, "PROP" .. ptype .. " " .. table.concat({
                        element(p.trigger, 1),
                        p.object,
                        element(p.group, 1),
                        fmtVec(p.pos),
                        fmtVec(p.rot),
                        p.point,
                    }, "|"))
                end
            end
            queueDump(lines, msg)
            return
        end
    end)

    LLEvents:on("changed", function(change: number)
        if bit32.band(change, CHANGED_INVENTORY) ~= 0 then
            if posCardSig() ~= notecard_key then
                resetAll() -- sends REM_ALL first (reset hook)
                return
            elseif get_number_of_scripts() ~= #SITTERS then
                init_sitters()
            end
        end
        if bit32.band(change, CHANGED_LINK) ~= 0 then
            if ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) == ZERO_VECTOR then
                HAVENTNAGGED = true
                if main_script() then
                    remove_all_props()
                end
            end
        end
    end)

    LLEvents:on("on_rez", function(_start: number)
        init_channel()
    end)

    -- Chat from the props
    LLEvents:on("listen", function(channel: number, name: string, id: uuid, message: string)
        if channel ~= comm_channel or listen_handle == 0 then
            return
        end
        local data = split(message, "|")
        local cmd = L(data, 1)
        if cmd == "SAVEPROP" then
            local index = int(L(data, 2))
            local p = props[index + 1]
            if index >= 0 and p ~= nil then
                local their = ll.GetObjectDetails(id, {OBJECT_POS, OBJECT_ROT})
                if their[1] ~= nil and their[1] ~= ZERO_VECTOR then
                    local f: quaternion = ll.GetRot()
                    local ourPos = ll.GetPos()
                    local mine = ll.GetObjectDetails(ll.GetKey(), {OBJECT_POS, OBJECT_ROT})
                    if mine[2] ~= nil then
                        f = mine[2]
                        ourPos = mine[1]
                    end
                    local target_rot = ll.Rot2Euler((their[2] :: quaternion) / f) * RAD_TO_DEG
                    local target_pos = ((their[1] :: vector) - ourPos) / f
                    p.pos = target_pos
                    p.rot = target_rot
                    local ptype = tostring(p.ptype)
                    if ptype == "0" then
                        ptype = ""
                    end
                    local text = "PROP Saved to memory, SITTER " .. element(p.trigger, 0) .. ": PROP" .. ptype .. " "
                        .. element(p.trigger, 1) .. "|" .. name .. "|" .. element(p.group, 1) .. "|"
                        .. fmtVec(target_pos) .. "|" .. fmtVec(target_rot) .. "|" .. p.point
                    ll.Say(0, text)
                end
            else
                Out("Error, cannot find prop: " .. name)
            end
            return
        end
        if cmd == "ATTACHED" or cmd == "DETACHED" or cmd == "REZ" or cmd == "DEREZ" then
            local prop_index = int(L(data, 2))
            local p = props[prop_index + 1]
            local trigger = if p then p.trigger else ""
            local sitter = int(element(trigger, 0))
            local sitter_key = getSitter(sitter)
            if sitter_key ~= NULL and cmd == "REZ" and p ~= nil and p.ptype == 1 then
                ll.Say(comm_channel, "ATTACHTO|" .. sitter_key .. "|" .. tostring(id))
            end
            -- send prop event notification
            ll.MessageLinked(LINK_SET, 90500, table.concat({
                cmd,
                trigger,
                if p then p.object else "",
                if p then element(p.group, 1) else "",
                tostring(id),
            }, "|"), sitter_key)
            return
        end
        if cmd == "NAG" and HAVENTNAGGED and ll.GetAttached() == 0 then
            ll.RegionSayTo(ll.GetOwner(), 0, "To enable auto-attachments, please enable the experience '" .. L(data, 2) .. "' by Code Violet in 'About Land'.")
            HAVENTNAGGED = false
        end
    end)

    local function parseLine(data: string)
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
        return command, parts
    end

    local function onNotecardLine(line: string, _n: number)
        local command, parts = parseLine(line)
        if command == "SITTER" then
            notecard_section = int(L(parts, 1))
        end
        if string.sub(command, 1, 4) == "PROP" then
            if #props == 100 then
                Out("Max props is 100, could not add prop!")
            else
                local prop_type = 0
                if command == "PROP1" then
                    prop_type = 1
                elseif command == "PROP2" then
                    prop_type = 2
                elseif command == "PROP3" then
                    prop_type = 3
                end
                addProp({
                    trigger = tostring(notecard_section) .. "|" .. L(parts, 1),
                    ptype = prop_type,
                    object = L(parts, 2),
                    group = tostring(notecard_section) .. "|" .. L(parts, 3),
                    pos = vec(L(parts, 4)),
                    rot = vec(L(parts, 5)),
                    point = L(parts, 6),
                })
            end
        end
        if command == "WARN" then
            WARN = int(L(parts, 1))
        end
    end

    -- init (state_entry)
    init_sitters()
    init_channel()
    notecard_key = posCardSig()
    if ll.GetInventoryType(notecard_name) == INVENTORY_NOTECARD then
        readNotecard(notecard_name, onNotecardLine, function(_total: number)
            if #props > 0 then
                Out(tostring(#props) .. " Props Ready, Mem=" .. freeMem())
            end
        end)
    end
end

--------------------------------------------------------------------------
-- SEQUENCE module (upstream [AV]sequence)
--   Notecard ("[LS]sequence_settings", else "[AV]sequence_settings"):
--       SEQUENCE <name>
--       PLAY <pose> | WAIT <seconds> | SAY <text> | WHISPER <text>
--       SOUND <sound>|<volume> | LOOP
--       DEBUG <level>
--   In SAY/WHISPER text, "/0", "/1"... are replaced by the first name of that sitter.
--   Changes from upstream:
--     - No LSL states: upstream ignored link messages and dialogs until the
--       notecard was read (state default); here the handlers are registered only
--       once the notecard is loaded (never without a notecard).
--     - A one-shot LLTimers timer replaces llSetTimerEvent (WAIT n arms it for
--       n seconds; WAIT 0 or negative stops the sequence there).
--     - Sequences are stored as records instead of strings joined with "◆".
--     - 90032 (swap and return the menu, issue #140) is handled like 90030.
--     - The 0.5 s pause after each PLAY is a timer step instead of llSleep(0.5),
--       so other modules stay responsive during it. A sequence link message or
--       menu answer arriving during the pause first completes the steps up to the
--       next WAIT, so it is handled at the same point as upstream.
--     - FIX: the sound preloading during a WAIT of 2 s or more finds the next
--       SOUND before the next WAIT (upstream always looked at the step right
--       after the WAIT).
--------------------------------------------------------------------------
do
    local product = "LuaSitter sequence"
    local main_script = "[LS]sit"
    local notecard_names = { "[LS]sequence_settings", "[AV]sequence_settings" }
    local SEQUENCE_LINKNUMBER = 90210

    type Sequence = { name: string, actions: {string}, datas: {string} }

    local SEQUENCES: {Sequence} = {}
    local current: Sequence = { name = "", actions = {}, datas = {} }

    -- 1-based index of the step being executed; 0 = before the first step / stopped
    local SEQUENCE_POINTER = 0
    local sequence_running = false
    local CONTROLLER = NULL
    local CONTROLLED = NULL
    local menu_channel = 0
    local menu_handle = 0
    local playsounds = true
    local DEBUG = 0
    local ready = false -- false while upstream was in state default (loading)
    local SITTERS: {string} = {}

    local function pickNotecard(): string?
        for _, name in notecard_names do
            if ll.GetInventoryType(name) == INVENTORY_NOTECARD then
                return name
            end
        end
        return nil
    end

    local function notecardFingerprint(): string
        local fp = {}
        for _, name in notecard_names do
            table.insert(fp, tostring(ll.GetInventoryKey(name)))
        end
        return table.concat(fp, "|")
    end

    local notecard_fp = notecardFingerprint()

    local function DEBUGSay(level: number, out: string)
        if DEBUG >= level then
            ll.Whisper(0, out)
        end
    end

    -- LSL (string)float format
    local function fstr(f: number): string
        return string.format("%.6f", f)
    end

    local function get_number_of_scripts(): number
        local i = 1
        while ll.GetInventoryType(main_script .. " " .. tostring(i)) == INVENTORY_SCRIPT do
            i += 1
        end
        return i
    end

    local function findSequence(name: string): Sequence?
        for _, s in SEQUENCES do
            if s.name == name then
                return s
            end
        end
        return nil
    end

    local function parse_text(say: string): string
        for i, sitter in SITTERS do
            local sitter_name = L(ll.ParseString2List(ll.Key2Name(K(sitter)), { " " }, {}), 1)
            if sitter_name == "" then
                sitter_name = "nobody"
            end
            say = replace(say, "/" .. tostring(i - 1), sitter_name)
        end
        return say
    end

    -- Timer (one-shot, replaces llSetTimerEvent)
    local seqTimer: any = nil
    local onTimer: () -> () -- forward

    local function setTimer(seconds: number)
        if seqTimer then
            LLTimers:off(seqTimer)
            seqTimer = nil
        end
        if seconds > 0 then
            seqTimer = LLTimers:once(seconds, function()
                seqTimer = nil
                onTimer()
            end)
        end
    end

    -- true while the 0.5 s pause after a PLAY step is pending
    local play_pause_pending = false

    local function stop_sequence(stopSound: boolean)
        play_pause_pending = false
        if sequence_running then
            DEBUGSay(1, "Sequence '" .. current.name .. "' Ended!")
        end
        sequence_running = false
        SEQUENCE_POINTER = 0
        setTimer(0)
        if stopSound and table.find(current.actions, "SOUND") then
            ll.StopSound()
        end
    end

    local function run_sequence()
        setTimer(0)
        play_pause_pending = false
        local actions = current.actions
        while SEQUENCE_POINTER >= 1 do
            local command = L(actions, SEQUENCE_POINTER)
            local data = L(current.datas, SEQUENCE_POINTER)
            if command == "PLAY" then
                DEBUGSay(2, "Playing pose " .. data)
                ll.MessageLinked(LINK_THIS, 90003, data, "")
                -- pause 0.5 s before the next step (upstream: llSleep(0.5)); the timer
                -- moves the pointer on and continues, like the end of a WAIT
                setTimer(0.5)
                play_pause_pending = true
                return
            elseif command == "SAY" then
                ll.Say(0, parse_text(data))
            elseif command == "WHISPER" then
                ll.Whisper(0, parse_text(data))
            elseif command == "SOUND" then
                if playsounds then
                    local data_list = split(data, "|")
                    local sound = L(data_list, 1)
                    local volume = num(L(data_list, 2))
                    ll.PlaySound(sound, volume)
                    DEBUGSay(2, "Playing sound " .. sound .. " at volume " .. fstr(volume))
                end
            elseif command == "LOOP" then
                if SEQUENCE_POINTER == #actions then
                    SEQUENCE_POINTER = 0
                    DEBUGSay(2, "Looping back to start of sequence")
                    if sequence_running then
                        setTimer(0.1)
                    end
                    return
                end
            elseif command == "WAIT" then
                if sequence_running then
                    local time = num(data)
                    DEBUGSay(2, "Waiting for " .. fstr(time) .. " seconds")
                    setTimer(time)
                    if time >= 2 then
                        -- preload the next sound, if one comes before the next WAIT
                        -- FIX: upstream always examined the step right after this WAIT
                        for q = SEQUENCE_POINTER + 1, #actions do
                            local next_command = actions[q]
                            if next_command == "WAIT" then
                                break
                            elseif next_command == "SOUND" then
                                local sound = L(split(L(current.datas, q), "|"), 1)
                                DEBUGSay(2, "Preloading sound " .. sound)
                                ll.PreloadSound(sound)
                                break
                            end
                        end
                    end
                end
                return
            end
            SEQUENCE_POINTER += 1
            if SEQUENCE_POINTER > #actions then
                local index = table.find(actions, "LOOP")
                if index then
                    SEQUENCE_POINTER = index
                    DEBUGSay(2, "Looping back to line " .. tostring(SEQUENCE_POINTER - 1) .. " of sequence")
                    if sequence_running then
                        setTimer(0.1)
                    end
                else
                    stop_sequence(false)
                end
                return
            end
        end
    end

    onTimer = function()
        SEQUENCE_POINTER += 1
        run_sequence()
    end

    -- Upstream handled no event during the llSleep(0.5) after PLAY: they were queued
    -- until the sequence reached a WAIT. An event arriving during the pause first
    -- completes those steps, so it is handled at the same point as upstream.
    local function finish_play_pause()
        if play_pause_pending then
            SEQUENCE_POINTER += 1
            run_sequence()
        end
    end

    local function start_sequence(seq: Sequence)
        sequence_running = true
        SEQUENCE_POINTER = 1
        current = seq
        DEBUGSay(1, "Sequence '" .. current.name .. "' Started!")
    end

    local function sequence_control()
        ll.ListenRemove(menu_handle)
        menu_channel = randomChannel()
        local pauseplay = if sequence_running then "▮▮" else "▶"
        menu_handle = ll.Listen(menu_channel, "", K(CONTROLLER), "")
        ll.Dialog(K(CONTROLLER),
            product .. " " .. version .. "\n\n[" .. current.name
                .. "]\n◀◀ = previous anim in sequence.\n▮▮ = pause sequence.\n▶▶ = skip to next anim in sequence.",
            orderButtons({ "[BACK]", "◀◀", pauseplay, "▶▶" }), menu_channel)
    end

    local function onLinkMessage(sender: number, n: number, msg: string, id: string)
        if sender ~= ll.GetLinkNumber() then
            return
        end
        -- only messages this module handles end the pause: its own 90003 (PLAY) and
        -- the 90045 / 90050 the sit script answers with must not cut it short
        if n ~= 90065 and n ~= 90030 and n ~= 90032 and n ~= 90070 and n ~= 90000 and n ~= 90008
            and n ~= 90205 and n ~= SEQUENCE_LINKNUMBER then
            return
        end
        finish_play_pause()
        if n == 90065 then
            local index = table.find(SITTERS, id)
            if index then
                SITTERS[index] = NULL
            end
            stop_sequence(true)
        elseif n == 90030 or n == 90032 then
            -- swap (90032: swap and return the menu)
            local a, b = int(msg), int(id)
            if a >= 0 and a < #SITTERS then
                SITTERS[a + 1] = NULL
            end
            if b >= 0 and b < #SITTERS then
                SITTERS[b + 1] = NULL
            end
            stop_sequence(true)
        elseif n == 90070 then
            local a = int(msg)
            if a >= 0 then
                for i = #SITTERS + 1, a do
                    SITTERS[i] = NULL
                end
                SITTERS[a + 1] = id
            end
        elseif n == 90000 or n == 90008 then
            -- pose chosen: start the sequence of the same name, if any
            stop_sequence(true)
            local seq = findSequence(msg)
            if seq then
                start_sequence(seq)
                run_sequence()
            end
        elseif n == 90205 then
            ll.MessageLinked(LINK_SET, 90005, "", id)
            playsounds = not playsounds
            if playsounds then
                ll.Say(0, "Sounds ON")
            else
                ll.Say(0, "Sounds OFF")
                ll.StopSound()
            end
        elseif n == SEQUENCE_LINKNUMBER then
            stop_sequence(true)
            local data = split(id, "|")
            CONTROLLER = L(data, 1)
            CONTROLLED = L(data, -1)
            local seq = findSequence(msg)
            if seq then
                start_sequence(seq)
                if table.find(current.actions, "WAIT") and table.find(current.actions, "PLAY") then
                    sequence_control()
                else
                    ll.MessageLinked(LINK_SET, 90005, "", id)
                end
                run_sequence()
            end
        end
    end

    local function onListen(channel: number, _name: string, id: uuid, msg: string)
        if channel ~= menu_channel then
            return
        end
        finish_play_pause()
        if msg == "▮▮" then
            sequence_running = false
            setTimer(0)
            DEBUGSay(1, "Sequence '" .. current.name .. "' Paused!")
        elseif msg == "▶" then
            sequence_running = true
            SEQUENCE_POINTER += 1
            DEBUGSay(1, "Sequence '" .. current.name .. "' Resumed!")
            run_sequence()
        elseif msg == "▶▶" then
            SEQUENCE_POINTER += 1
            run_sequence()
        elseif msg == "◀◀" then
            -- go back to just after the WAIT that precedes the previous WAIT
            local count_waits = 0
            while SEQUENCE_POINTER > 0 and count_waits < 2 do
                SEQUENCE_POINTER -= 1
                if L(current.actions, SEQUENCE_POINTER) == "WAIT" then
                    count_waits += 1
                end
            end
            SEQUENCE_POINTER += 1
            run_sequence()
        elseif msg == "[BACK]" then
            ll.MessageLinked(LINK_SET, 90005, "", tostring(id) .. "|" .. CONTROLLED)
            return
        end
        sequence_control()
    end

    -- Always registered (cheap): detects the settings notecard being added,
    -- changed or removed, and sit script count changes once loaded.
    LLEvents:on("changed", function(change: number)
        if bit32.band(change, CHANGED_INVENTORY) ~= 0 then
            if notecardFingerprint() ~= notecard_fp
                or (ready and get_number_of_scripts() ~= #SITTERS) then
                resetAll()
            end
        end
    end)

    -- init: load the notecard, then become "running"
    local VALID = { PLAY = true, WAIT = true, SAY = true, WHISPER = true, SOUND = true, LOOP = true }

    local notecard_name = pickNotecard()
    if notecard_name then
        readNotecard(notecard_name, function(data: string, _n: number)
            local datalist = ll.ParseString2List(data, { " " }, {})
            local command = L(datalist, 1)
            local rest = {}
            for i = 2, #datalist do
                table.insert(rest, datalist[i])
            end
            data = ll.StringTrim(table.concat(rest, " "), STRING_TRIM)
            if command == "DEBUG" then
                DEBUG = int(data)
            elseif command == "SEQUENCE" then
                if current.name ~= "" then
                    table.insert(SEQUENCES, current)
                end
                current = { name = data, actions = {}, datas = {} }
            elseif VALID[command] then
                table.insert(current.actions, command)
                table.insert(current.datas, data)
            end
        end, function(_total: number)
            table.insert(SEQUENCES, current)
            -- "state running"
            current = { name = "", actions = {}, datas = {} }
            for i = 1, get_number_of_scripts() do
                SITTERS[i] = NULL
            end
            ready = true
            LLEvents:on("link_message", onLinkMessage)
            LLEvents:on("listen", onListen)
            LLEvents:on("on_rez", function(_start: number)
                playsounds = true
            end)
            Out(tostring(#SEQUENCES) .. " Sequences Ready, Mem=" .. freeMem())
        end)
    end
end

--------------------------------------------------------------------------
-- FAVS module (upstream [AV]favs)
--   Changes from upstream:
--     - Favourites are stored in a table keyed by "uuid..sitter#" instead of one
--       flat list with marker strings.
--     - 90032 (swap and return the menu, issue #140) is handled like 90030.
--     - "Memory full" limit is relative to the SLua memory limit (same 5.5 KB
--       margin upstream had below the 64 KB Mono limit); the memory is shared
--       with the other modules.
--     - FIX: dialog paging ([<<] / [>>]) used the length of the whole favourites
--       storage instead of the list being shown.
--------------------------------------------------------------------------
do
    -- index sitter#+1 -> sitter uuid (string, "" = empty seat) / pose playing
    local Sitters: {string} = {}
    local Poses: {string} = {}

    -- "uuid" .. sitter# -> list of pose names
    local Favs: {[string]: {string}} = {}

    local CDialog = 0 -- dialog channel
    local HDialog = 0 -- dialog listen handle
    local Page = 0 -- 0-based index of the first entry shown
    local List: {string} = {} -- sorted favs of the user the dialog was opened for

    local function pad(n: number)
        while #Sitters < n + 1 do
            table.insert(Sitters, "")
            table.insert(Poses, "")
        end
    end

    -- first seat (0-based) occupied by k, or nil
    local function findSitter(k: string): number?
        local i = table.find(Sitters, k)
        return if i then i - 1 else nil
    end

    local function dlg(): {string}
        local btns = {}
        if #List > 11 then
            for i = Page + 1, math.min(Page + 9, #List) do
                table.insert(btns, List[i])
            end
            table.insert(btns, "[BACK]")
            table.insert(btns, "[<<]")
            table.insert(btns, "[>>]")
        else
            btns = table.clone(List)
            table.insert(btns, "[BACK]")
        end
        return orderButtons(btns)
    end

    LLEvents:on("link_message", function(_l: number, n: number, s: string, k: string)
        if n == 90060 then -- sit
            local seat = int(s)
            if seat < 0 then
                return
            end
            pad(seat)
            Sitters[seat + 1] = k
            Poses[seat + 1] = ""
            return
        end

        if n == 90030 or n == 90032 then -- swap (90032: swap and return the menu)
            local a, b = int(s), int(k)
            if a < 0 or b < 0 then
                return
            end
            pad(math.max(a, b))
            Sitters[a + 1], Sitters[b + 1] = Sitters[b + 1], Sitters[a + 1]
            Poses[a + 1] = ""
            Poses[b + 1] = ""
            return
        end

        if n == 90065 then -- unsit
            local seat = int(s)
            if seat < 0 then
                return
            end
            pad(seat)
            Sitters[seat + 1] = ""
            Poses[seat + 1] = ""
            return
        end

        if n == 90045 then -- pose playing: remember it for each sitter
            local seat = int(s)
            if seat < 0 then
                return
            end
            pad(seat)
            Poses[seat + 1] = L(ll.ParseStringKeepNulls(s, { "|" }, {}), 2)
            -- also (re)learn who sits there: after a script reset no 90060 is resent
            if isKey(k) then
                Sitters[seat + 1] = k
            end
            return
        end

        if n == 90070 then -- permissions granted: sitter <s> is avatar <k>
            local seat = int(s)
            if seat >= 0 and isKey(k) then
                pad(seat)
                Sitters[seat + 1] = k
            end
            return
        end

        if n == 90401 then -- add pose to favs
            ll.MessageLinked(LINK_THIS, 90005, "", k)
            -- the memory is shared with the PROP and SEQUENCE modules
            if ll.GetUsedMemory() > ll.GetMemoryLimit() - 5536 then
                ll.RegionSayTo(K(k), 0, "Memory full")
                return
            end
            local seat = findSitter(k)
            if seat == nil then
                return
            end
            local pose = Poses[seat + 1] or ""
            if pose == "" then
                return -- something went wrong, we don't have info about the current pose
            end
            local id = k .. tostring(seat)
            local favs = Favs[id]
            if favs == nil then
                favs = {}
                Favs[id] = favs
            end
            if table.find(favs, pose) then
                ll.RegionSayTo(K(k), 0, "This pose is already in the favs for this seat")
                return
            end
            table.insert(favs, pose)
            ll.RegionSayTo(K(k), 0, pose .. " added to favs")
            return
        end

        if n == 90402 then -- remove pose from favs
            ll.MessageLinked(LINK_THIS, 90005, "", k)
            local seat = findSitter(k)
            if seat == nil then
                return
            end
            local pose = Poses[seat + 1] or ""
            local id = k .. tostring(seat)
            local favs = Favs[id]
            local idx = if favs then table.find(favs, pose) else nil
            if favs == nil or idx == nil then
                ll.RegionSayTo(K(k), 0, "This pose is not in the favs for this seat")
                return
            end
            table.remove(favs, idx)
            ll.RegionSayTo(K(k), 0, pose .. " removed from favs")
            -- if the favs list for this avatar/seat becomes empty, drop it
            if #favs == 0 then
                Favs[id] = nil
            end
            return
        end

        if n == 90403 then -- list favourites, allow user to pick one to play
            local seat = findSitter(k)
            local favs = if seat then Favs[k .. tostring(seat)] else nil
            if favs == nil or #favs == 0 then
                ll.RegionSayTo(K(k), 0, "No favs found for this seat")
                ll.MessageLinked(LINK_THIS, 90005, "", k)
                return
            end
            if HDialog ~= 0 then
                ll.ListenRemove(HDialog)
            end
            CDialog = 0x30000000 + math.floor(ll.Frand(16777216))
            HDialog = ll.Listen(CDialog, "", NULL_KEY, "")
            Page = 0
            List = ll.ListSort(table.clone(favs), 1, true)
            ll.Dialog(K(k), "Your favs for this seat:", dlg(), CDialog)
        end
    end)

    LLEvents:on("listen", function(channel: number, _name: string, id: uuid, s: string)
        if channel ~= CDialog or HDialog == 0 then
            return
        end
        local k = tostring(id)
        if s == "[BACK]" then
            ll.ListenRemove(HDialog)
            HDialog = 0
            ll.MessageLinked(LINK_THIS, 90005, "", k)
            return
        end
        if s == "[<<]" then
            Page -= 9
            if Page < 0 then
                -- FIX: upstream used the length of the whole Favs storage here
                Page = (#List - 1) // 9 * 9
            end
        end
        if s == "[>>]" then
            Page += 9
            if Page >= #List then -- FIX: idem
                Page = 0
            end
        end
        if table.find(List, s) then
            ll.MessageLinked(LINK_THIS, 90008, s, k)
        end
        ll.Dialog(id, "Your favs for this seat:", dlg(), CDialog)
    end)
end
