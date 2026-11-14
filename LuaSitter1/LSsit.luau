--[[
  LSsit - AVsitter1-style per-sitter pose/animation script
  LuaSitter: SLua port of AVsitter(TM) AVsit (AVsitter1). Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  One copy per sitter, all in the same prim: "LSsit" (sitter 0), "LSsit 1",
  "LSsit 2", ... (replaces AVsitter1 "AVsit", "AVsit 1", ...). Each copy reads
  its SITTER section of the LSpos (or AVpos) notecard, holds the animation permission of
  ONE avatar (that is why the copies cannot be merged), shows the pose menu,
  the personal adjust menu and the [SWAP]/[SELECT] logic. Copy 0 also sets
  the prim sit target and forwards touches (90005).

  Companion scripts looked for in the same prim: "LSselect", "LSplus".
  Link-message protocol (numbers and payloads) is identical to AVsitter1.

  Behaviour changes
  -----------------
  - Notecard read with the fast reader (GetNotecardLineSync, async fallback).
  - The [DUMP] readout is paced by a timer (0.2 s per line, as upstream)
    instead of blocking llSleep calls; the hand-off to the next sitter (90020)
    is sent after the last line, as upstream.
  - The staggered "items Ready" message uses a timer instead of llSleep.
  - Changing pose stops the previous animation 0.5 s after starting the new
    one with a timer (upstream: llSleep(0.5), which froze the script), and a
    new sitter's permission request waits 0.1 s on a timer instead of llSleep.
  - Saved personal adjustments (CUSTOMS) were capped from llGetFreeMemory();
    the cap is clamped to 10..1000 entries (SLua has much more memory).
]]

local product_and_version = "LuaSitter 3.0-lua1"
local SITTER_BASENAME = "LSsit"
local SELECT_SCRIPT = "LSselect"
local PLUS_SCRIPT = "LSplus"
-- Pose notecard: "LSpos" (LuaSitter name) is used when present, else "AVpos" (AVsitter name).
local function posCard(): string
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
local SIT_ANIM = "1a5fe8ac-a804-8a5d-7cbd-56bd83184568"
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

local function num(v: any): number
    if type(v) == "number" then
        return v
    end
    local s = tostring(v or "")
    return tonumber(string.match(s, "^%s*([-+]?%d*%.?%d+[eE][-+]?%d+)") or string.match(s, "^%s*([-+]?%d*%.?%d+)") or "") or 0
end

-- LSL (vector)string : "<x, y, z>" (trailing text ignored), else ZERO_VECTOR
local function lslVec(s: string): vector
    local a, b, c = string.match(s, "^%s*<([^,]*),([^,]*),([^,>]*)")
    if not a then
        return ZERO_VECTOR
    end
    return vector(num(a), num(b), num(c))
end

-- LSL (string)vector and (string)float formats
local function fmtV(v: vector): string
    return string.format("<%.5f, %.5f, %.5f>", v.x, v.y, v.z)
end
local function fmtF(f: number): string
    return string.format("%.6f", f)
end

local function L(t: {any}, i: number): string
    local v = t[i]
    return if v == nil then "" else tostring(v)
end

local function startsWith(s: string, p: string): boolean
    return string.sub(s, 1, #p) == p
end

local function contains(s: string, p: string): boolean
    return string.find(s, p, 1, true) ~= nil
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

local function hasScript(name: string): boolean
    return ll.GetInventoryType(name) == INVENTORY_SCRIPT
end

local function hasAnimPerm(): boolean
    return bit32.btest(ll.GetPermissions(), PERMISSION_TRIGGER_ANIMATION)
end

local function agentPresent(k: string): boolean
    return ll.GetAgentSize(K(k)) ~= ZERO_VECTOR
end

local function Owner_Say(say: string)
    print(ll.GetScriptName() .. ":" .. say)
end

--------------------------------------------------------------------------
-- state
--------------------------------------------------------------------------
type Entry = { name: string, data: string, pos: vector?, rot: vector? }
type Custom = { idx: number, key: string, pos: vector, rot: vector }

local avkey = ""
local controller = NULL
local sitter_text = ""
local SITTERS: { string } = {} -- index = sitter number + 1, keys as strings
local script_channel = 0
local notecard_key = ""
local has_helper = false
local helper_mode = false
local swap_text = ""
local menu_type = 0
local exit_type = 0
local select_type = 0
local loops: { number } = {} -- 0-based menu indexes (as in AVsitter1)
local menu_handle = 0
local menu_channel = 0
local MENU: { Entry } = {} -- replaces MENU_LIST/DATA_LIST/POS_LIST/ROT_LIST
local CUSTOMS: { Custom } = {}
local max_customs = 10
local reading_notecard_section = false
local CURRENT_POSITION = ZERO_VECTOR
local CURRENT_ROTATION = ZERO_VECTOR
local DEFAULT_POSITION = ZERO_VECTOR
local DEFAULT_ROTATION = ZERO_VECTOR
local CURRENT_ANIMATION_FILENAME = ""
local anim_index = 0
local first_anim = -1
local current_menu = -1
local menu_page = 0
local increment_pointer = 0
local pos_rot_adjust_toggle = false
local touch_start_time = 0

-- Menu entries are addressed with 0-based indexes like the LSL lists
-- (negative = from the end, out of range = empty entry).
local EMPTY: Entry = { name = "", data = "", pos = nil, rot = nil }
local function menuIdx(i: number): number?
    local n = #MENU
    if i < 0 then
        i += n
    end
    if i < 0 or i >= n then
        return nil
    end
    return i + 1
end
local function E(i: number): Entry
    local j = menuIdx(i)
    if j then
        return MENU[j]
    end
    return EMPTY
end
local function findMenu(name: string): number
    for i, e in MENU do
        if e.name == name then
            return i - 1
        end
    end
    return -1
end

-- SITTERS access with 0-based sitter numbers
local function S(ch: number): string
    local n = #SITTERS
    if ch < 0 then
        ch += n
    end
    return SITTERS[ch + 1] or NULL
end
local function setS(ch: number, v: string)
    if ch >= 0 and ch < #SITTERS then
        SITTERS[ch + 1] = v
    end
end

local function findCustom(idx: number, key: string): number?
    for i, c in CUSTOMS do
        if c.idx == idx and c.key == key then
            return i
        end
    end
    return nil
end

--------------------------------------------------------------------------
-- [DUMP] readout queue (replaces Readout_Say + llSleep(0.2))
--------------------------------------------------------------------------
type Job = { say: string?, nextChannel: number? }
local readoutJobs: { Job } = {}
local readoutTimer: any = nil

local function readoutTick()
    local job = table.remove(readoutJobs, 1)
    if job == nil then
        if readoutTimer then
            LLTimers:off(readoutTimer)
            readoutTimer = nil
        end
        return
    end
    if job.say then
        ll.RegionSayTo(ll.GetOwner(), 0, "◆" .. job.say)
    elseif job.nextChannel then
        ll.MessageLinked(LINK_THIS, 90020, tostring(job.nextChannel), "")
    end
end

local function queueReadout(lines: { string }, nextChannel: number)
    for _, s in lines do
        table.insert(readoutJobs, { say = s })
    end
    table.insert(readoutJobs, { nextChannel = nextChannel })
    if not readoutTimer then
        readoutTimer = LLTimers:every(0.2, readoutTick)
    end
end

--------------------------------------------------------------------------
-- menus
--------------------------------------------------------------------------
local function animation_menu(return_pages: number): number
    if return_pages == 2 or (#MENU < 2 and not helper_mode and hasScript(SELECT_SCRIPT)) then
        ll.MessageLinked(LINK_SET, 99899, "", controller)
    else
        swap_text = if hasScript(SELECT_SCRIPT) then "[SELECT]" else "[SWAP]"
        local menu = if sitter_text ~= "" then sitter_text elseif #SITTERS > 1 then "Sitter " .. script_channel else ""
        if current_menu ~= -1 then
            menu ..= ">" .. ll.GetSubString(E(current_menu).name, 3, -2)
        end
        local menu_text = "\n" .. product_and_version .. "\n" .. menu
        local total_items = 0
        local i = current_menu + 1
        while i < #MENU and not startsWith(E(i).name, "M:") do
            total_items += 1
            i += 1
        end
        local menu_items2: { string } = {}
        if helper_mode then
            if hasScript(PLUS_SCRIPT) then
                table.insert(menu_items2, "[EXTRA]")
            end
            table.insert(menu_items2, "[NEW]")
            table.insert(menu_items2, "[DUMP]")
        end
        if #SITTERS > 1 then
            table.insert(menu_items2, swap_text)
        end
        if helper_mode then
            table.insert(menu_items2, "[SAVE]")
        elseif current_menu == -1 then
            table.insert(menu_items2, "[ADJUST]")
        end
        if current_menu ~= -1 then
            table.insert(menu_items2, 1, "[BACK]")
        end
        if total_items + #menu_items2 > 12 then
            table.insert(menu_items2, "[PAGE-]")
            table.insert(menu_items2, "[PAGE+]")
        end
        local items_per_page = 12 - #menu_items2
        if return_pages == 1 then
            local pages = total_items // items_per_page
            if total_items % items_per_page == 0 then
                pages -= 1
            end
            return pages
        end
        local menu_items1: { string } = {}
        local page_start = current_menu + 1 + menu_page * items_per_page
        for j = page_start, page_start + items_per_page - 1 do
            if j < #MENU then
                local name = E(j).name
                if contains(name, "M:") then
                    break
                end
                local prefix = ll.GetSubString(name, 1, 2)
                if prefix ~= "T:" and prefix ~= "S:" and prefix ~= "B:" then
                    table.insert(menu_items1, name)
                else
                    table.insert(menu_items1, ll.GetSubString(L(ll.ParseString2List(name, { "|" }, {}), 1), 3, -1))
                end
            end
        end
        if menu_items2[1] == "[BACK]" then
            table.insert(menu_items1, 1, "[BACK]")
            table.remove(menu_items2, 1)
        end
        table.move(menu_items2, 1, #menu_items2, #menu_items1 + 1, menu_items1)
        ll.Dialog(K(controller), menu_text, orderButtons(menu_items1), menu_channel)
    end
    return 0
end

local POS_INCREMENTS = { "0.05m", "0.25m", "0.01m" }
local ROT_INCREMENTS = { "5°", "25°", "1°" }
local AXIS_BUTTONS = { "X+", "Y+", "Z+", "X-", "Y-", "Z-" }

local function adjust_menu()
    local menu_items = { "[BACK]", "[SAVE]", "[DEFAULT]" }
    table.insert(menu_items, if pos_rot_adjust_toggle then "ROT" else "POS")
    table.insert(menu_items, if has_helper then "[HELPER]" else " - ")
    table.insert(menu_items, (if pos_rot_adjust_toggle then ROT_INCREMENTS else POS_INCREMENTS)[increment_pointer + 1])
    table.move(AXIS_BUTTONS, 1, #AXIS_BUTTONS, #menu_items + 1, menu_items)
    ll.Dialog(K(controller), "\nPersonal Adjust:", orderButtons(menu_items), menu_channel)
end

local function get_number_of_scripts(): number
    local i = 1
    while hasScript(SITTER_BASENAME .. " " .. i) do
        i += 1
    end
    return i
end

local function sit_using_prim_params()
    local me = S(script_channel)
    local sitter_prim = ll.GetNumberOfPrims()
    local found = false
    while ll.GetAgentSize(ll.GetLinkKey(sitter_prim)) ~= ZERO_VECTOR do
        if tostring(ll.GetLinkKey(sitter_prim)) == me then
            found = true
            break
        end
        sitter_prim -= 1
    end
    if not found then
        return
    end
    local r = ll.Euler2Rot((CURRENT_ROTATION + vector(0, 0, 0.002)) * DEG_TO_RAD)
    local localrot = ZERO_ROTATION
    local localpos = ZERO_VECTOR
    if ll.GetLinkNumber() > 1 then
        localrot = ll.GetLocalRot()
        localpos = ll.GetLocalPos()
    end
    local rootrot = ll.GetRootRotation() * ll.Euler2Rot(vector(0.002, 0.002, 0.002))
    ll.SetLinkPrimitiveParamsFast(sitter_prim, {
        PRIM_ROTATION, r * localrot / rootrot,
        PRIM_POSITION, CURRENT_POSITION * localrot + localpos,
    })
end

-- the previous animation, waiting to be stopped 0.5 s after the new one started
local pending_old = ""
local pending_old_timer: any = nil

local function play_anim(new_index: number)
    anim_index = new_index
    local OLD = CURRENT_ANIMATION_FILENAME
    local e = E(anim_index)
    local me = S(script_channel)
    CURRENT_ANIMATION_FILENAME = e.data
    DEFAULT_POSITION = e.pos or ZERO_VECTOR
    DEFAULT_ROTATION = e.rot or ZERO_VECTOR
    CURRENT_POSITION = DEFAULT_POSITION
    CURRENT_ROTATION = DEFAULT_ROTATION
    local ci = findCustom(anim_index, me)
    if ci then
        -- personal adjustment found: use it and move it to the end (most recent)
        local c = table.remove(CUSTOMS, ci) :: Custom
        CURRENT_POSITION = c.pos
        CURRENT_ROTATION = c.rot
        table.insert(CUSTOMS, c)
    end
    if hasAnimPerm() and agentPresent(me) then
        ll.MessageLinked(LINK_SET, 90045, e.name .. "|" .. CURRENT_ANIMATION_FILENAME, me)
        if not helper_mode then
            sit_using_prim_params()
        end
        if CURRENT_ANIMATION_FILENAME ~= "" then
            ll.StartAnimation(CURRENT_ANIMATION_FILENAME)
        end
        if OLD ~= "" and OLD ~= CURRENT_ANIMATION_FILENAME then
            -- stop the old animation a little later (upstream: llSleep(0.5)); skipped
            -- if it became current again or the sitter changed meanwhile.
            -- A swap or stand-up before then stops it at once (stopCurrentAnimation),
            -- as upstream, whose llSleep stopped it before handling the swap.
            if pending_old_timer then
                LLTimers:off(pending_old_timer)
                if pending_old ~= CURRENT_ANIMATION_FILENAME then
                    ll.StopAnimation(pending_old)
                end
            end
            pending_old = OLD
            pending_old_timer = LLTimers:once(0.5, function()
                pending_old_timer = nil
                if OLD ~= CURRENT_ANIMATION_FILENAME and S(script_channel) == me
                    and hasAnimPerm() and agentPresent(me) then
                    ll.StopAnimation(OLD)
                end
                pending_old = ""
            end)
        end
    end
end

local function stopCurrentAnimation()
    if pending_old_timer then
        LLTimers:off(pending_old_timer)
        pending_old_timer = nil
        if hasAnimPerm() and pending_old ~= "" then
            ll.StopAnimation(pending_old)
        end
        pending_old = ""
    end
    if hasAnimPerm() and CURRENT_ANIMATION_FILENAME ~= "" then
        ll.StopAnimation(CURRENT_ANIMATION_FILENAME)
    end
end

-- in helper mode, ask LSadjuster to refresh the helpers (90040 "sitter|number of sitters")
local function notify_helper_mode()
    if helper_mode then
        ll.MessageLinked(LINK_SET, 90040, script_channel .. "|" .. #SITTERS, "")
    end
end

--------------------------------------------------------------------------
-- events
--------------------------------------------------------------------------
LLEvents:on("listen", function(_channel: number, _name: string, uid: uuid, message: string)
    local id = tostring(uid)
    if message == "[BACK]" then
        if menu_type == 3 or (#MENU == 1 and hasScript(SELECT_SCRIPT)) then
            ll.MessageLinked(LINK_SET, 99899, "", id)
        else
            menu_page = 0
            current_menu = -1
            animation_menu(0)
        end
        return
    end
    local mindex_test = findMenu("S:" .. message)
    if mindex_test ~= -1 then
        animation_menu(0)
        ll.MessageLinked(LINK_SET, 90055, "S:" .. message, id)
        notify_helper_mode()
        return
    end
    mindex_test = findMenu(message)
    if mindex_test ~= -1 then
        ll.MessageLinked(LINK_SET, 90055, message, id)
        notify_helper_mode()
        play_anim(mindex_test)
        animation_menu(0)
        return
    end
    mindex_test = findMenu("M:" .. message)
    if mindex_test ~= -1 then
        menu_page = 0
        current_menu = mindex_test
        animation_menu(0)
        return
    end
    mindex_test = findMenu("B:" .. message)
    if mindex_test ~= -1 then
        ll.MessageLinked(LINK_SET, int(E(mindex_test).data), message, id)
        return
    end
    if message == "[PAGE+]" or message == "[PAGE-]" then
        if message == "[PAGE-]" then
            menu_page -= 1
            if menu_page < 0 then
                menu_page = animation_menu(1)
            end
        else
            menu_page += 1
            if menu_page > animation_menu(1) then
                menu_page = 0
            end
        end
        animation_menu(0)
    elseif message == swap_text then
        if hasScript(SELECT_SCRIPT) then
            ll.MessageLinked(LINK_SET, 99899, "", id)
        else
            local n = #SITTERS
            local function X(i: number): string -- SITTERS + SITTERS
                if i < 0 or i >= 2 * n then
                    return NULL
                end
                return SITTERS[(i % n) + 1]
            end
            local target_script = script_channel + 1
            if startsWith(E(anim_index).name, "S:") and not helper_mode then
                while X(target_script) == NULL and target_script + 1 < 2 * n do
                    target_script += 1
                end
                if X(target_script) == S(script_channel) then
                    target_script += 1
                end
            elseif not helper_mode then
                while X(target_script) ~= NULL and target_script < n + script_channel + 1 do
                    target_script += 1
                end
            end
            target_script = target_script % n
            ll.MessageLinked(LINK_SET, 90030, tostring(script_channel), tostring(target_script))
        end
    elseif message == "[DUMP]" then
        ll.MessageLinked(LINK_THIS, 90020, "0", "")
        animation_menu(0)
    elseif message == "[SAVE]" then
        if helper_mode then
            ll.MessageLinked(LINK_SET, 90010, "", "")
            animation_menu(0)
        else
            local me = S(script_channel)
            local ci = findCustom(anim_index, me)
            if ci then
                table.remove(CUSTOMS, ci)
            end
            if CURRENT_POSITION ~= DEFAULT_POSITION or CURRENT_ROTATION ~= DEFAULT_ROTATION then
                if #CUSTOMS >= max_customs and #CUSTOMS > 0 then
                    table.remove(CUSTOMS, 1)
                end
                table.insert(CUSTOMS, { idx = anim_index, key = me, pos = CURRENT_POSITION, rot = CURRENT_ROTATION })
            end
            ll.InstantMessage(uid, "Saved")
            adjust_menu()
        end
    elseif message == "[DEFAULT]" then
        CURRENT_POSITION = DEFAULT_POSITION
        CURRENT_ROTATION = DEFAULT_ROTATION
        sit_using_prim_params()
        adjust_menu()
    elseif message == "[ADJUST]" then
        adjust_menu()
    elseif message == "POS" or message == "ROT" then
        pos_rot_adjust_toggle = not pos_rot_adjust_toggle
        adjust_menu()
    elseif table.find(AXIS_BUTTONS, message) then
        local increments = if pos_rot_adjust_toggle then ROT_INCREMENTS else POS_INCREMENTS
        local change = num(increments[increment_pointer + 1])
        if string.sub(message, 2, 2) == "-" then
            change = -1 * change
        end
        local direction = vector(1, 0, 0)
        local axis = string.sub(message, 1, 1)
        if axis == "Y" then
            direction = vector(0, 1, 0)
        elseif axis == "Z" then
            direction = vector(0, 0, 1)
        end
        if pos_rot_adjust_toggle then
            CURRENT_ROTATION += direction * change
        else
            CURRENT_POSITION += direction * change
        end
        sit_using_prim_params()
        adjust_menu()
    elseif table.find(POS_INCREMENTS, message) or table.find(ROT_INCREMENTS, message) then
        increment_pointer += 1
        if increment_pointer > 2 then
            increment_pointer = 0
        end
        adjust_menu()
    elseif message == "[EXTRA]" then
        ll.MessageLinked(LINK_THIS, 90140, "", id)
    elseif message == "[NEW]" then
        ll.MessageLinked(LINK_SET, 90160, tostring(script_channel), id)
    elseif message == "[HELPER]" then
        ll.MessageLinked(LINK_SET, 90100, script_channel .. "|" .. #SITTERS, "")
    end
end)

LLEvents:on("touch_start", function(_events: { DetectedEvent })
    touch_start_time = ll.GetTime()
end)

LLEvents:on("touch_end", function(events: { DetectedEvent })
    if script_channel == 0 and menu_type ~= 3 then
        ll.MessageLinked(LINK_SET, 90005, fmtF(ll.GetTime() - touch_start_time), tostring(events[1]:getKey()))
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.btest(change, CHANGED_LINK) then
        if helper_mode then
            setS(script_channel, NULL)
        end
        local AVRPRIMS: { string } = {}
        if #SITTERS == 1 then
            local onTarget = tostring(ll.AvatarOnSitTarget())
            if onTarget ~= NULL then
                if onTarget ~= S(0) then
                    -- upstream: llSleep(0.1) before asking; a timer keeps the script responsive
                    LLTimers:once(0.1, function()
                        if tostring(ll.AvatarOnSitTarget()) == onTarget then
                            ll.RequestPermissions(K(onTarget), PERMISSION_TRIGGER_ANIMATION)
                        end
                        ll.MessageLinked(LINK_SET, 90060, "", onTarget) -- after the request, as upstream
                    end)
                end
                table.insert(AVRPRIMS, onTarget)
            end
        else
            local i = ll.GetNumberOfPrims()
            while ll.GetAgentSize(ll.GetLinkKey(i)) ~= ZERO_VECTOR do
                local k = tostring(ll.GetLinkKey(i))
                if not table.find(SITTERS, k) then
                    local first_available = (table.find(SITTERS, NULL) or 0) - 1
                    if first_available == script_channel then
                        ll.RequestPermissions(K(k), PERMISSION_TRIGGER_ANIMATION)
                        ll.MessageLinked(LINK_SET, 90060, "", k)
                    end
                end
                table.insert(AVRPRIMS, k)
                i -= 1
            end
        end
        for i = 0, #SITTERS - 1 do
            if not table.find(AVRPRIMS, S(i)) then
                if i == script_channel and hasAnimPerm() then
                    ll.ListenRemove(menu_handle)
                    local me = S(script_channel)
                    if me ~= NULL then
                        ll.MessageLinked(LINK_SET, 90065, "", me)
                        controller = NULL
                    end
                    if agentPresent(me) and CURRENT_ANIMATION_FILENAME ~= "" then
                        ll.StopAnimation(CURRENT_ANIMATION_FILENAME)
                    end
                end
                setS(i, NULL)
            end
        end
        if #AVRPRIMS > 0 then
            helper_mode = false
        else
            play_anim(first_anim)
            has_helper = false
        end
    elseif bit32.btest(change, CHANGED_INVENTORY) then
        if posCardSig() ~= notecard_key or get_number_of_scripts() ~= #SITTERS then
            ll.ResetScript()
        end
    end
end)

LLEvents:on("run_time_permissions", function(perm: number)
    if bit32.btest(perm, PERMISSION_TRIGGER_ANIMATION) then
        ll.StopAnimation(SIT_ANIM) -- string form: accepted everywhere (rezless refuses a uuid here)
        -- hip fix animation: "LShipfix" (LuaSitter name), else "AVhipfix" (AVsitter name)
        for _, hipfix in { "LShipfix", "AVhipfix" } do
            if ll.GetInventoryType(hipfix) == INVENTORY_ANIMATION then
                ll.StartAnimation(hipfix)
                break
            end
        end
        local pk = tostring(ll.GetPermissionsKey())
        local new = if pk ~= avkey then 2 else 0
        avkey = ""
        ll.MessageLinked(LINK_SET, 90070, tostring(script_channel), pk)
        controller = pk
        setS(script_channel, pk)
        menu_channel = randomChannel()
        menu_handle = ll.Listen(menu_channel, "", K(pk), "")
        menu_page = 0
        current_menu = -1
        ll.MessageLinked(LINK_SET, 90055, E(anim_index).name, pk)
        if not startsWith(E(anim_index).name, "S:") then
            play_anim(anim_index)
        end
        if helper_mode or menu_type == 0 then
            animation_menu(new)
        end
        notify_helper_mode()
    end
end)

local function readout()
    local lines: { string } = {}
    if script_channel == 0 then
        if menu_type ~= 0 then
            table.insert(lines, "MTYPE " .. menu_type)
        end
        if exit_type ~= 0 then
            table.insert(lines, "ETYPE " .. exit_type)
        end
        if select_type ~= 0 then
            table.insert(lines, "SELECT " .. select_type)
        end
    end
    table.insert(lines, "")
    table.insert(lines, "SITTER " .. script_channel .. "|" .. sitter_text)
    for i, e in MENU do
        local change_me = ll.ParseString2List(e.name, { ":" }, {})
        if table.find(loops, i - 1) then
            table.insert(lines, "LOOP")
        end
        if #change_me == 2 then
            local kind = change_me[1]
            if kind == "M" then
                table.insert(lines, "MENU " .. ll.GetSubString(change_me[2], 1, -2))
            elseif kind == "T" then
                table.insert(lines, "TOMENU " .. ll.GetSubString(change_me[2], 1, -2))
            elseif kind == "B" then
                table.insert(lines, "BUTTON " .. change_me[2] .. "|" .. e.data)
            elseif kind == "S" then
                table.insert(lines, "SYNC " .. change_me[2] .. "|" .. e.data)
            end
        else
            table.insert(lines, "POSE " .. L(change_me, 1) .. "|" .. e.data)
        end
    end
    for _, e in MENU do
        if e.pos then
            local name = e.name
            local change_me = ll.ParseString2List(name, { ":" }, {})
            if #change_me == 2 then
                name = change_me[2]
            end
            table.insert(lines, "{" .. name .. "}" .. fmtV(e.pos) .. fmtV(e.rot or ZERO_VECTOR))
        end
    end
    queueReadout(lines, script_channel + 1)
end

LLEvents:on("link_message", function(sender: number, num_: number, msg: string, id: string)
    local me = S(script_channel)
    if num_ == 90030 then
        local a = int(msg)
        local b = int(id)
        if a == script_channel or b == script_channel then
            if me ~= NULL then
                stopCurrentAnimation()
                if helper_mode and hasAnimPerm() then
                    ll.StartAnimation("sit")
                end
            end
            if a == script_channel and S(b) ~= NULL then
                ll.RequestPermissions(K(S(b)), PERMISSION_TRIGGER_ANIMATION)
                avkey = S(b)
            elseif b == script_channel and S(a) ~= NULL then
                ll.RequestPermissions(K(S(a)), PERMISSION_TRIGGER_ANIMATION)
                avkey = S(a)
            end
            ll.ListenRemove(menu_handle)
        end
        setS(a, NULL)
        setS(b, NULL)
    elseif num_ == 90001 and id == me then
        if hasAnimPerm() then
            ll.StartAnimation(msg)
        end
    elseif num_ == 90000 or num_ == 90055 then
        local x = findMenu(msg)
        if x ~= -1 and (startsWith(msg, "S:") or num_ == 90000) then
            play_anim(x)
        elseif me == NULL then
            play_anim(first_anim)
        elseif exit_type ~= 0 and startsWith(E(anim_index).name, "S:") then
            play_anim(first_anim)
        end
    elseif num_ == 90070 then
        local n = int(msg)
        if n ~= script_channel and sender == ll.GetLinkNumber() then
            setS(n, id)
        end
    elseif num_ == 90075 then
        local n = int(msg)
        if n == script_channel then
            if agentPresent(me) then
                stopCurrentAnimation()
            end
            ll.ListenRemove(menu_handle)
        end
        setS(n, NULL)
    elseif num_ == 90085 then
        has_helper = true
    elseif num_ == 90120 then
        helper_mode = true
        local involved = 0
        local cur = E(anim_index).name
        if (startsWith(cur, "S:") and id == cur) or int(msg) == script_channel then
            involved = 1
        end
        ll.MessageLinked(LINK_SET, 90130, fmtV(CURRENT_POSITION) .. fmtV(CURRENT_ROTATION) .. involved, tostring(script_channel))
    elseif num_ == 90006 and id == me then
        adjust_menu()
    elseif num_ == 90005 and id == me then
        if num(msg) > 2 or menu_type < 2 or menu_type == 3 then
            animation_menu(0)
        else
            -- MTYPE 2: touching cycles to the next pose (honouring LOOP marks)
            local next_anim: number? = nil
            for i = anim_index + 1, #MENU - 1 do
                local x = table.find(loops, i)
                if x == nil then
                    local prefix = ll.GetSubString(E(i).name, 1, 2)
                    if prefix ~= "T:" and prefix ~= "M:" and prefix ~= "B:" then
                        next_anim = i
                        break
                    end
                else
                    if x == 1 then
                        next_anim = first_anim
                    else
                        next_anim = loops[x - 1]
                    end
                    break
                end
            end
            if next_anim == nil then
                next_anim = first_anim
                if #loops > 0 then
                    next_anim = loops[#loops]
                end
            end
            local na = next_anim :: number
            ll.MessageLinked(LINK_SET, 90055, E(na).name, id)
            if not startsWith(E(na).name, "S:") then
                play_anim(na)
            end
        end
    elseif num_ == 89999 and id == me then
        controller = msg
        ll.ListenRemove(menu_handle)
        menu_handle = ll.Listen(menu_channel, "", K(controller), "")
        animation_menu(0)
    elseif int(msg) == script_channel then
        if num_ == 90110 then
            ll.MessageLinked(LINK_THIS, 90120, tostring(script_channel), E(anim_index).name)
        elseif num_ == 90050 then
            ll.RequestPermissions(K(id), PERMISSION_TRIGGER_ANIMATION)
        elseif num_ == 90090 then
            local parts = ll.ParseString2List(id, { "<" }, {})
            local j = menuIdx(anim_index)
            if j then
                MENU[j].pos = lslVec("<" .. L(parts, 1))
                MENU[j].rot = lslVec("<" .. L(parts, 2))
            end
        elseif num_ == 90170 then
            local place_to_add = current_menu
            while place_to_add < #MENU and not startsWith(E(place_to_add + 1).name, "M:") do
                place_to_add += 1
            end
            if startsWith(E(place_to_add + 1).name, "M:") then
                place_to_add += 1
            end
            local data = ll.ParseStringKeepNulls(id, { "|" }, {})
            local pos = math.clamp(place_to_add + 1, 1, #MENU + 1)
            table.insert(MENU, pos, { name = L(data, 1), data = L(data, 2), pos = nil, rot = nil })
            if L(data, 2) ~= "" then
                play_anim(pos - 1)
            end
        elseif num_ == 90020 then
            readout()
        end
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
        -- LSL quirk kept: without a space the command loses its last character ("LOOP" -> "LOO")
        command = ll.GetSubString(data, 1, -2)
        rest = data
    end
    local parts = ll.ParseString2List(rest, { " | ", " |", "| ", "|" }, {})
    local part0 = ll.StringTrim(L(parts, 1), STRING_TRIM)
    local part1 = L(parts, 2)
    if command == "SITTER" then
        reading_notecard_section = false
        if int(part0) == script_channel then
            reading_notecard_section = true
            sitter_text = part1
        end
    elseif command == "MTYPE" then
        menu_type = int(part0)
        ll.PassTouches(0)
        if menu_type == 3 then
            ll.PassTouches(1)
        end
    elseif command == "ETYPE" then
        exit_type = int(part0)
    elseif command == "SELECT" then
        select_type = int(part0)
    elseif reading_notecard_section then
        if ll.GetSubString(data, 1, 1) == "{" then
            local cb = ll.SubStringIndex(data, "}")
            local name = ll.StringTrim(ll.GetSubString(data, 2, if cb then cb - 1 else -2), STRING_TRIM)
            local index = findMenu(name)
            if index == -1 then
                index = findMenu("S:" .. name)
            end
            if index == -1 then
                Owner_Say("Error: '" .. name .. "' not found in menu structure")
            else
                local d = (string.gsub(data, " ", ""))
                local cb2 = ll.SubStringIndex(d, "}")
                d = ll.GetSubString(d, (cb2 or 0) + 1, -1)
                local pr = ll.ParseStringKeepNulls(d, { "<" }, {})
                local e = MENU[index + 1]
                e.pos = lslVec("<" .. L(pr, 2))
                e.rot = lslVec("<" .. L(pr, 3))
            end
        else
            if (utf8.len(part0) or #part0) > 23 then
                part0 = ll.GetSubString(part0, 1, 23)
            end
            if command == "POSE" or command == "SYNC" then
                if command == "SYNC" then
                    part0 = "S:" .. part0
                end
                if findMenu(part0) == -1 then
                    table.insert(MENU, { name = part0, data = part1, pos = nil, rot = nil })
                    if first_anim == -1 then
                        first_anim = #MENU - 1
                    end
                end
            elseif command == "MENU" then
                table.insert(MENU, { name = "M:" .. part0 .. "*", data = "", pos = nil, rot = nil })
            elseif command == "TOMENU" then
                table.insert(MENU, { name = "T:" .. part0 .. "*", data = "", pos = nil, rot = nil })
            elseif command == "BUTTON" then
                table.insert(MENU, { name = "B:" .. part0, data = tostring(int(L(parts, 2))), pos = nil, rot = nil })
            elseif command == "LOO" then
                table.insert(loops, #MENU)
            end
        end
    end
end

local function onDone(_total: number)
    play_anim(first_anim)
    if script_channel == 0 then
        -- vector components are 32-bit floats: compare against a float32 0.35
        if CURRENT_POSITION.x == vector(0.35, 0, 0).x then
            CURRENT_POSITION = vector(CURRENT_POSITION.x + 0.001, CURRENT_POSITION.y, CURRENT_POSITION.z)
        end
        ll.SitTarget(CURRENT_POSITION - vector(0, 0, 0.35), ll.Euler2Rot(CURRENT_ROTATION * DEG_TO_RAD))
    else
        ll.MessageLinked(LINK_SET, 90180, tostring(script_channel), fmtV(CURRENT_POSITION) .. "|" .. fmtV(CURRENT_ROTATION))
    end
    max_customs = math.clamp((ll.GetFreeMemory() - 2000) // 200, 10, 1000)
    local function ready()
        Owner_Say(#MENU .. " items Ready, Memory: " .. ll.GetFreeMemory())
    end
    if script_channel > 0 then
        LLTimers:once(script_channel, ready) -- staggered like upstream's llSleep(script_channel)
    else
        ready()
    end
end

--------------------------------------------------------------------------
-- init (state_entry)
--------------------------------------------------------------------------
do
    local name = ll.GetScriptName()
    local sp = string.find(name, " ", 1, true)
    script_channel = if sp then int(string.sub(name, sp)) else 0
    if script_channel == 0 then
        reading_notecard_section = true
    end
    for _ = 1, get_number_of_scripts() do
        table.insert(SITTERS, NULL)
    end
    notecard_key = posCardSig()
    if script_channel == 0 then
        Owner_Say("Reading...")
    end
    if ll.GetInventoryType(notecard_name) == INVENTORY_NOTECARD then
        readNotecard(notecard_name, onLine, onDone)
    else
        Owner_Say("Error: notecard '" .. notecard_name .. "' not found")
    end
end
