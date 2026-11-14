--[[
  LSplus - AVsitter1-style EXTRAS: props, sounds, items, facial expressions, camera
  LuaSitter: SLua port of AVsitter(TM) AVplus (AVsitter1). Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  Optional companion of LSsit, in the same prim (replaces AVsitter1 "AVplus").
  Reads PROP / SOUND / ITEM / ANIM / CAMERA lines from LSpos (or AVpos), rezzes props
  (containing LSprop), plays sounds, gives items, runs facial-expression
  sequences (sent to LSsit with 90001) and sets the camera of sitter 0.
  The [EXTRA] menu (helper mode, owner only) edits these settings and [DUMP]
  prints them after the LSsit readout.

  Only the copy named exactly "LSplus" is active. As in AVsitter1, numbered
  copies ("LSplus 1", ...) are inert (the LSL went to "state nothing").

  Not merged into LSsit: it holds camera permissions (TRACK_CAMERA for the
  owner, CONTROL_CAMERA for sitter 0) which would replace the animation
  permission LSsit holds, and its presence is optional (it adds [EXTRA]).

  Behaviour changes / fixes
  -------------------------
  - FIX: on_rez picked new comm/menu channels but kept listening on the old
    ones, so the EXTRAS menu and prop saving stopped working after re-rez.
    The listens are re-created on the new channels.
  - FIX: [CLEAR]/[OK]/selection loops deleted list items while iterating
    forwards and could skip an adjacent duplicate. All matches are removed.
  - FIX: the sound volume chosen in the sound menu was discarded ("|1" was
    always stored); it is saved.
  - Inventory pages skip both "LShelper" and "AVhelper" objects (upstream
    always subtracted one object from the page count).
  - FIX: running expression sequences pointed at list positions that went
    stale when a FACE was cleared/replaced (could send an empty animation
    name to LSsit). They reference the setting itself, and choosing a new
    FACE stops the owner's previous sequence first.
  - Facial-expression timer uses LLTimers; items are given via a 1 s timer
    instead of llSleep(1) (one second apart, as before).
  - A prop rezzed by a BUTTON (90200) waits 1 s on a timer instead of
    llSleep(1). A link message arriving during that second first completes
    the rez, so messages are handled in the same order as upstream.
]]

local product_and_version = "LuaSitter LSplus 3.0-lua1"
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
local HELPER_NAMES = { "LShelper", "AVhelper" }
local NULL = tostring(NULL_KEY)
local SILENCE = "ed124764-705d-d497-167a-182cd9fa2e6c"
local CAMERA_CLICK = "3d09f582-3851-c0e0-f5ba-277ac5c73fb4"
local facial_anim_list = { "express_afraid_emote", "express_anger_emote", "express_laugh_emote", "express_bored_emote", "express_cry_emote", "express_embarrassed_emote", "express_sad_emote", "express_toothsmile", "express_smile", "express_surprise_emote", "express_worry_emote", "express_repulsed_emote", "express_shrug_emote", "express_wink_emote", "express_disdain", "express_frown", "express_kiss", "express_open_mouth", "express_tongue_out" }

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

local function lslVec(s: string): vector
    local a, b, c = string.match(s, "^%s*<([^,]*),([^,]*),([^,>]*)")
    if not a then
        return ZERO_VECTOR
    end
    return vector(num(a), num(b), num(c))
end

local function fmtV(v: vector): string
    return string.format("<%.5f, %.5f, %.5f>", v.x, v.y, v.z)
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

local function startsWith(s: string, p: string): boolean
    return string.sub(s, 1, #p) == p
end

local function split(s: string, sep: string): { string }
    return ll.ParseStringKeepNulls(s, { sep }, {})
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

local function owner(): string
    return tostring(ll.GetOwner())
end

local function Owner_Say(say: string)
    print(ll.GetScriptName() .. ":" .. say)
end

local function Readout_Say(say: string)
    print("◆" .. say)
end

-- digits only, non-empty (AVsitter1 IsInteger)
local function IsInteger(data: string): boolean
    return data ~= "" and string.find(data, "%D") == nil
end

-- facial_anim_list addressed with the 0-based numbers stored in AVpos
local function facial(i: number): string
    return facial_anim_list[i + 1] or ""
end

local function stopSound()
    ll.PlaySound(SILENCE, 0)
end

--------------------------------------------------------------------------
-- state
--------------------------------------------------------------------------
type Setting = { trigger: string, data: string } -- trigger = pose name
type Running = { key: string, set: Setting, ptr: number } -- set = the ANIM setting being played

local SITTERS: { string } = {}
local sticky_rez = false
local expressions_toggle_off = false
local camera_position = ZERO_VECTOR
local camera_focus = ZERO_VECTOR
local script_channel = 0
local playing_sound_for = NULL
local playing_prop_for = NULL
local anim_name = ""
local pose_name = ""
local raw_pose_name = ""
local page = 0
local pages = 0
local loop = 0
local volume = 1.0
local sound = ""
local props: { Setting } = {}
local sounds: { Setting } = {}
local items: { Setting } = {}
local anims: { Setting } = {}
local comm_channel = 0
local menu_channel = 0
local comm_listen_handle = 0
local menu_listen_handle = 0
local menu_type = ""
local notecard_key = ""
local running: { Running } = {}

local function findTrigger(list: { Setting }, pose: string): number?
    for i, s in list do
        if s.trigger == pose then
            return i
        end
    end
    return nil
end

local function removeTrigger(list: { Setting }, pose: string): boolean
    local removed = false
    for i = #list, 1, -1 do
        if list[i].trigger == pose then
            table.remove(list, i)
            removed = true
        end
    end
    return removed
end

local function lastDataFor(list: { Setting }, pose: string, seps: { string }): string
    local text = "N/A"
    for _, s in list do
        if s.trigger == pose then
            text = L(ll.ParseStringKeepNulls(s.data, seps, {}), 1)
        end
    end
    return text
end

local function remove_props()
    ll.RegionSay(comm_channel, "REMPROPS")
end

local function check_sitters()
    for _, s in SITTERS do
        if s ~= NULL then
            return
        end
    end
    remove_props()
    running = {}
    setTimer(0, function() end)
    pose_name = ""
end

local function get_number_of_scripts(basename: string): number
    local i = 1
    while ll.GetInventoryType(basename .. " " .. i) == INVENTORY_SCRIPT do
        i += 1
    end
    return i
end

local function setSitter(i: number, v: string)
    if i >= 0 and i < #SITTERS then
        SITTERS[i + 1] = v
    end
end

local function rez_prop(index: number)
    local data = split(props[index].data, "|")
    local object = L(data, 1)
    local r = ll.Euler2Rot(lslVec(L(data, 3)) * DEG_TO_RAD) * ll.GetRot()
    local pos = lslVec(L(data, 2)) * ll.GetRot() + ll.GetPos()
    if ll.GetInventoryType(object) == INVENTORY_OBJECT then
        ll.RezAtRoot(object, pos, ZERO_VECTOR, r, comm_channel)
    end
end

local function play_sound(index: number)
    local data = split(sounds[index].data, "|")
    local snd = L(data, 1)
    local lp = int(L(data, 2))
    local vol = num(L(data, 3))
    if lp ~= 0 then
        ll.LoopSound(snd, vol)
    else
        ll.PlaySound(snd, vol)
    end
end

local give_delay = 0
local function give_item(index: number, anim: string, id: string)
    local data = split(items[index].data, "|")
    local item = L(data, 1)
    local filter = L(data, 2)
    if filter == "" or filter == anim then
        -- upstream: llSleep(1) before each give; keep items one second apart
        give_delay += 1
        LLTimers:once(give_delay, function()
            give_delay -= 1
            ll.GiveInventory(K(id), item)
        end)
    end
end

local function sequence()
    local seq_anims: { string } = {}
    local seq_ids: { string } = {}
    for _, run in running do
        local data = split(run.set.data, "|")
        local seq = split(L(data, 1), ":")
        local seq_animations: { string } = {}
        local seq_times: { string } = {}
        for k = 1, #seq, 2 do
            table.insert(seq_animations, seq[k])
        end
        for k = 2, #seq, 2 do
            table.insert(seq_times, seq[k])
        end
        local pointer = run.ptr
        local sequence_length = 0
        local held = false
        local j = 0
        while j <= #seq_times do
            if sequence_length == pointer then
                local anim = L(seq_animations, j + 1)
                if IsInteger(anim) then
                    anim = facial(int(anim))
                end
                table.insert(seq_anims, anim)
                table.insert(seq_ids, run.key)
            end
            if L(seq_times, j + 1) == "-" then
                -- "-" holds the expression forever
                pointer += 1
                held = true
                break
            end
            sequence_length += int(L(seq_times, j + 1))
            j += 1
        end
        if not held then
            pointer += 1
            if pointer == sequence_length then
                pointer = 0
            end
        end
        run.ptr = pointer
    end
    if not expressions_toggle_off then
        for i, a in seq_anims do
            ll.MessageLinked(LINK_SET, 90001, a, seq_ids[i])
        end
    end
end

local function onSequenceTimer()
    sequence()
    setTimer(1, onSequenceTimer)
end

local function start_sequence(index: number, anim: string, id: string)
    local set = anims[index]
    local data = split(set.data, "|")
    local filter = L(data, 2)
    if filter == "" or filter == anim then
        for i, run in running do
            if run.set == set then
                if run.key == id then
                    table.remove(running, i)
                end
                break
            end
        end
        table.insert(running, { key = id, set = set, ptr = 0 })
    end
    if #running > 0 then
        setTimer(0.01, onSequenceTimer)
    end
end

local function remove_sequences(id: string)
    for i = #running, 1, -1 do
        if running[i].key == id then
            table.remove(running, i)
        end
    end
    if #running == 0 then
        setTimer(0, onSequenceTimer)
    end
end

local function dialog(text: string, buttons: { string })
    ll.Dialog(ll.GetOwner(), text, orderButtons(buttons), menu_channel)
end

local function main_menu()
    page = 0
    local text = "N/A"
    if camera_position ~= ZERO_VECTOR then
        text = "YES"
    end
    local menu_text = "\n" .. product_and_version .. "\nEXTRAS for Pose:" .. pose_name .. "\n\nCamera:" .. text .. "\nProp:"
    menu_text ..= lastDataFor(props, pose_name, { "|" }) .. "\nSound:"
    menu_text ..= lastDataFor(sounds, pose_name, { "|" }) .. "\nItem:"
    menu_text ..= lastDataFor(items, pose_name, { "|" }) .. "\nFace:"
    menu_text ..= lastDataFor(anims, pose_name, { "|", ":" }) .. "\n"
    dialog(menu_text, { "[TOP]", "[CAMERA]", "[PROPS]", "[SOUNDS]", "[ITEMS]", "[FACES]" })
end

local function choice_menu(options: { string })
    local menu_text = "\nPlease choose your item:\n\n"
    local menu_items: { string } = {}
    if #options == 0 then
        menu_text = "\nNo items of that type in the prim inventory."
        menu_items = { "[BACK]" }
    else
        for i, o in options do
            table.insert(menu_items, tostring(i))
            menu_text ..= i .. "." .. o .. "\n"
        end
        while #menu_items < 8 do
            table.insert(menu_items, "~")
        end
        for _, b in { "[CLEAR]", "[BACK]", "[PAGE-]", "[PAGE+]" } do
            table.insert(menu_items, b)
        end
    end
    dialog(menu_text, menu_items)
end

local function facial_anims(newpage: number): { string }
    page = newpage
    pages = #facial_anim_list // 8
    local out = {}
    for i = 8 * page + 1, 8 * page + 8 do
        if facial_anim_list[i] then
            table.insert(out, facial_anim_list[i])
        end
    end
    return out
end

local function get_contents(itype: number, newpage: number): { string }
    page = newpage
    local names: { string } = {}
    for i = 1, ll.GetInventoryNumber(itype) do
        local n = ll.GetInventoryName(itype, i)
        if itype ~= INVENTORY_OBJECT or not table.find(HELPER_NAMES, n) then
            table.insert(names, n)
        end
    end
    pages = #names // 8
    local contents = {}
    for i = 8 * page + 1, 8 * page + 8 do
        if names[i] then
            table.insert(contents, names[i])
        end
    end
    return contents
end

local function camera_menu()
    dialog("\nChoose a camera angle and click [SET], or use [RELEASE] to clear it.", { "[BACK]", "[SET]", "[RELEASE]" })
end

local function menu_determine(mtype: string)
    if mtype == "[PROPS]" then
        choice_menu(get_contents(INVENTORY_OBJECT, page))
    elseif mtype == "[SOUNDS]" then
        choice_menu(get_contents(INVENTORY_SOUND, page))
    elseif mtype == "[FACES]" then
        choice_menu(facial_anims(page))
    elseif mtype == "[ITEMS]" then
        choice_menu(get_contents(INVENTORY_OBJECT, page))
    elseif mtype == "[CAMERA]" then
        if tostring(ll.GetPermissionsKey()) == owner() and bit32.btest(ll.GetPermissions(), PERMISSION_TRACK_CAMERA) then
            camera_menu()
        else
            ll.RequestPermissions(ll.GetOwner(), PERMISSION_TRACK_CAMERA)
        end
    end
    menu_type = mtype
end

local function volumeText(): string
    -- compact form for the notecard ("1", "0.8", ...)
    local v = math.floor(volume * 10 + 0.5) / 10
    if v == math.floor(v) then
        return tostring(math.floor(v))
    end
    return tostring(v)
end

local function sound_menu()
    stopSound()
    if loop ~= 0 then
        ll.LoopSound(sound, volume)
    else
        ll.PlaySound(sound, volume)
    end
    playing_sound_for = owner()
    local menu_items = { "[SOUNDS]", "~" }
    if loop ~= 0 then
        table.insert(menu_items, "[NO LOOP]")
    else
        table.insert(menu_items, "[LOOP]")
    end
    for _, b in { "[VOLUME-]", "[VOLUME+]", "[OK]" } do
        table.insert(menu_items, b)
    end
    dialog("\nConfigure your sound:\n\nSound:" .. sound .. "\nVolume:" .. math.floor(volume * 100 + 0.5) .. "%", menu_items)
end

local function openListens(menuEnabled: boolean, commEnabled: boolean)
    ll.ListenRemove(comm_listen_handle)
    ll.ListenRemove(menu_listen_handle)
    comm_listen_handle = ll.Listen(comm_channel, "", NULL_KEY, "SAVEPROP")
    menu_listen_handle = ll.Listen(menu_channel, "", ll.GetOwner(), "")
    ll.ListenControl(comm_listen_handle, commEnabled)
    ll.ListenControl(menu_listen_handle, menuEnabled)
end

local function relPosRot(other: uuid): (vector?, quaternion?)
    local mine = ll.GetObjectDetails(ll.GetKey(), { OBJECT_POS, OBJECT_ROT })
    local theirs = ll.GetObjectDetails(other, { OBJECT_POS, OBJECT_ROT })
    if theirs[1] == nil or theirs[1] == ZERO_VECTOR then
        return nil, nil
    end
    local f = mine[2] :: quaternion
    return ((theirs[1] :: vector) - (mine[1] :: vector)) / f, (theirs[2] :: quaternion) / f
end

--------------------------------------------------------------------------
-- events (only registered for the copy named exactly "LSplus")
--------------------------------------------------------------------------
local function onListen(channel: number, name: string, uid: uuid, message: string)
    local id = tostring(uid)
    if channel == menu_channel then
        if id ~= owner() then
            return
        end
        if message == "[TOP]" then
            ll.MessageLinked(LINK_SET, 90005, "", id)
        elseif message == "[CLEAR]" then
            if menu_type == "[PROPS]" then
                removeTrigger(props, pose_name)
            elseif menu_type == "[SOUNDS]" then
                if removeTrigger(sounds, pose_name) then
                    stopSound()
                end
            elseif menu_type == "[ITEMS]" then
                removeTrigger(items, pose_name)
            elseif menu_type == "[FACES]" then
                if removeTrigger(anims, pose_name) then
                    remove_sequences(owner())
                end
            end
            main_menu()
        elseif message == "[BACK]" then
            main_menu()
        elseif message == "[PAGE+]" or message == "[PAGE-]" then
            if message == "[PAGE-]" then
                page -= 1
                if page < 0 then
                    page = pages
                end
            else
                page += 1
                if page > pages then
                    page = 0
                end
            end
            menu_determine(menu_type)
        elseif message == "[SET]" then
            if bit32.btest(ll.GetPermissions(), PERMISSION_TRACK_CAMERA) then
                ll.PlaySound(CAMERA_CLICK, 1)
                local mine = ll.GetObjectDetails(ll.GetKey(), { OBJECT_POS, OBJECT_ROT })
                local f = mine[2] :: quaternion
                local camera_rotation = ll.GetCameraRot() / f
                camera_position = (ll.GetCameraPos() - (mine[1] :: vector)) / f
                camera_focus = camera_position + quaternion.tofwd(camera_rotation) * 1
                main_menu()
            end
        elseif message == "[RELEASE]" then
            camera_position = ZERO_VECTOR
            main_menu()
        elseif message == "[VOLUME+]" or message == "[VOLUME-]" then
            if message == "[VOLUME-]" then
                volume -= 0.2
            else
                volume += 0.2
            end
            volume = math.clamp(volume, 0, 1)
            sound_menu()
        elseif message == "[OK]" then
            removeTrigger(sounds, pose_name)
            -- FIX: store the chosen volume (AVsitter1 always stored 1)
            table.insert(sounds, { trigger = pose_name, data = sound .. "|" .. loop .. "|" .. volumeText() })
            main_menu()
        elseif message == "[LOOP]" or message == "[NO LOOP]" then
            loop = if message == "[LOOP]" then 1 else 0
            sound_menu()
        elseif table.find({ "1", "2", "3", "4", "5", "6", "7", "8", "9" }, message) then
            local n = int(message)
            if menu_type == "[PROPS]" then
                remove_props()
                local object = L(get_contents(INVENTORY_OBJECT, page), n)
                if object ~= "" then
                    ll.RezObject(object, ll.GetPos() + vector(0, 0, 2), ZERO_VECTOR, ll.GetRootRotation(), comm_channel)
                end
                playing_prop_for = id
                ll.Say(0, "Please position your prop and click [SAVE] when done.")
                ll.MessageLinked(LINK_SET, 90005, "", id)
            elseif menu_type == "[SOUNDS]" then
                sound = L(get_contents(INVENTORY_SOUND, page), n)
                sound_menu()
            elseif menu_type == "[FACES]" then
                removeTrigger(anims, pose_name)
                -- FIX: stop the owner's previous expression before starting the new one
                remove_sequences(owner())
                local anim = L(facial_anims(page), n)
                table.insert(anims, { trigger = pose_name, data = anim .. ":1|" })
                local index = findTrigger(anims, pose_name)
                if index then
                    start_sequence(index, anim_name, owner())
                end
                main_menu()
            elseif menu_type == "[ITEMS]" then
                removeTrigger(items, pose_name)
                local item = L(get_contents(INVENTORY_OBJECT, page), n)
                table.insert(items, { trigger = pose_name, data = item .. "|" })
                main_menu()
            end
        else
            menu_determine(message)
        end
    elseif channel == comm_channel then
        if tostring(ll.GetOwnerKey(uid)) == owner() and message == "SAVEPROP" then
            local target_pos, target_rot = relPosRot(uid)
            if target_pos and target_rot then
                removeTrigger(props, pose_name)
                table.insert(props, {
                    trigger = pose_name,
                    data = name .. "|" .. fmtV(target_pos) .. "|" .. fmtV(ll.Rot2Euler(target_rot) * RAD_TO_DEG),
                })
                ll.Say(0, "PROP for pose '" .. pose_name .. "' saved to memory.")
            end
        end
    end
end

local function readout()
    Readout_Say("-----EXTRAS------------")
    for _, s in props do
        Readout_Say("PROP " .. s.trigger .. "|" .. s.data)
    end
    for _, s in sounds do
        Readout_Say("SOUND " .. s.trigger .. "|" .. s.data)
    end
    for _, s in items do
        Readout_Say("ITEM " .. s.trigger .. "|" .. s.data)
    end
    for _, s in anims do
        local seq = split(s.data, ":")
        for x = 1, #seq, 2 do
            if IsInteger(seq[x]) then
                seq[x] = facial(int(seq[x]))
            end
        end
        Readout_Say("ANIM " .. s.trigger .. "|" .. table.concat(seq, ":"))
    end
    if camera_position ~= ZERO_VECTOR then
        Readout_Say("CAMERA " .. fmtV(camera_position) .. "|" .. fmtV(camera_focus))
    end
end

-- A prop rez from a BUTTON (90200) waits 1 s (upstream: llSleep(1) in the handler).
-- Upstream handled no other message during that second, so any message that
-- arrives while the rez is pending first completes it, keeping the same order.
local pending_rez: (() -> ())? = nil
local pending_timer: any = nil

local function flush_pending_rez()
    local run = pending_rez
    if run then
        pending_rez = nil
        if pending_timer then
            LLTimers:off(pending_timer)
            pending_timer = nil
        end
        run()
    end
end

local function onLinkMessage(sender: number, num_: number, msg: string, id: string)
    flush_pending_rez()
    if num_ == 90075 then
        stopSound()
        playing_sound_for = NULL
        setSitter(int(msg), NULL)
        check_sitters()
    elseif sender == ll.GetLinkNumber() then
        if num_ == 1125 then
            expressions_toggle_off = not expressions_toggle_off
            local expressions_text = if expressions_toggle_off then "OFF" else "ON"
            ll.InstantMessage(K(id), "Facial Expressions " .. expressions_text)
        elseif num_ == 90045 then
            local data = split(msg, "|")
            anim_name = L(data, 2)
            local given_posename = L(data, 1)
            if startsWith(given_posename, "S:") then
                given_posename = string.sub(given_posename, 3)
            end
            if given_posename ~= pose_name or string.find(L(data, 1), "S:", 1, true) == nil then
                local old_is_sync = startsWith(raw_pose_name, "S:")
                raw_pose_name = L(data, 1)
                pose_name = given_posename
                local index = findTrigger(props, pose_name)
                stopSound()
                if (not sticky_rez and (id == playing_prop_for or old_is_sync or startsWith(raw_pose_name, "S:"))) or index then
                    sticky_rez = false
                    remove_props()
                end
                if index then
                    playing_prop_for = id
                    rez_prop(index)
                end
                local sindex = findTrigger(sounds, pose_name)
                if sindex then
                    playing_sound_for = id
                    play_sound(sindex)
                end
            end
            remove_sequences(id)
            for i, s in anims do
                if s.trigger == pose_name then
                    start_sequence(i, anim_name, id)
                end
            end
            for i, s in items do
                if s.trigger == pose_name then
                    give_item(i, anim_name, id)
                end
            end
        elseif num_ == 90010 then
            ll.ListenControl(comm_listen_handle, true)
            ll.RegionSay(comm_channel, "PROPSEARCH")
        elseif num_ == 90060 then
            ll.ListenControl(comm_listen_handle, false)
            ll.ListenControl(menu_listen_handle, false)
            local index = table.find(SITTERS, NULL)
            if index then
                SITTERS[index] = id
                if camera_position ~= ZERO_VECTOR then
                    if index == 1 then
                        ll.RequestPermissions(K(id), PERMISSION_CONTROL_CAMERA)
                    else
                        -- 90150: kept for protocol compatibility (no AVsitter1 receiver)
                        ll.MessageLinked(LINK_THIS, 90150, id .. "|" .. fmtV(camera_position) .. "|" .. fmtV(camera_focus), tostring(index - 1))
                    end
                end
            end
        elseif num_ == 90065 then
            if id == playing_sound_for then
                stopSound()
                playing_sound_for = NULL
            end
            local index = table.find(SITTERS, id)
            remove_sequences(id)
            if index then
                SITTERS[index] = NULL
                check_sitters()
            end
        elseif num_ == 90030 then
            setSitter(int(msg), NULL)
            setSitter(int(id), NULL)
        elseif num_ == 90070 then
            setSitter(int(msg), id)
        elseif num_ == 90140 then
            if id == owner() then
                if pose_name == "" then
                    ll.MessageLinked(LINK_SET, 90005, "", id)
                    Owner_Say("Please select an animation first.")
                else
                    ll.ListenControl(menu_listen_handle, true)
                    main_menu()
                end
            else
                ll.InstantMessage(K(id), "Sorry, the [EXTRAS] menu is for Owner only.")
                ll.MessageLinked(LINK_SET, 90005, "", id)
            end
        elseif num_ == 90020 and int(msg) == get_number_of_scripts(SITTER_BASENAME) then
            readout()
        elseif num_ == 90200 then
            remove_props()
            local index = findTrigger(props, msg)
            if index then
                local rez_index: number = index
                pending_rez = function()
                    sticky_rez = true
                    rez_prop(rez_index)
                    ll.MessageLinked(LINK_SET, 90005, "", id)
                end
                pending_timer = LLTimers:once(1, function()
                    pending_timer = nil
                    flush_pending_rez()
                end)
            else
                ll.MessageLinked(LINK_SET, 90005, "", id)
            end
        end
    end
end

local function onPermissions(_perm: number)
    local perms = ll.GetPermissions()
    if bit32.btest(perms, PERMISSION_CONTROL_CAMERA) then
        local pos = camera_position * ll.GetRot() + ll.GetPos()
        local focus = camera_focus * ll.GetRot() + ll.GetPos()
        ll.SetCameraParams({
            CAMERA_ACTIVE, 1,
            CAMERA_FOCUS, focus,
            CAMERA_FOCUS_LOCKED, 1,
            CAMERA_POSITION, pos,
            CAMERA_POSITION_LOCKED, 1,
            CAMERA_FOCUS_OFFSET, vector(0, 0, 0),
        })
    elseif bit32.btest(perms, PERMISSION_TRACK_CAMERA) then
        camera_menu()
    end
end

local function onChanged(change: number)
    if bit32.btest(change, CHANGED_INVENTORY) then
        if posCardSig() ~= notecard_key or get_number_of_scripts(SITTER_BASENAME) ~= #SITTERS then
            remove_props()
            ll.ResetScript()
        end
    end
end

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
    local parts = ll.ParseStringKeepNulls(rest, { " | ", " |", "| ", "|" }, {})
    local rest_parts = {}
    for i = 2, #parts do
        table.insert(rest_parts, parts[i])
    end
    data = table.concat(rest_parts, "|")
    local pose = L(parts, 1)
    if startsWith(pose, "S:") then
        pose = string.sub(pose, 3)
    end
    if command == "PROP" then
        table.insert(props, { trigger = pose, data = data })
        Owner_Say("Read settings for Prop '" .. L(parts, 2) .. "'")
    elseif command == "SOUND" then
        table.insert(sounds, { trigger = pose, data = data })
        Owner_Say("Read settings for Sound '" .. L(parts, 2) .. "'")
    elseif command == "ITEM" then
        table.insert(items, { trigger = pose, data = data })
        Owner_Say("Read settings for Item '" .. L(parts, 2) .. "'")
    elseif command == "ANIM" then
        local anim_data = split(data, "|")
        local seq = split(L(anim_data, 1), ":")
        for i = 1, #seq, 2 do
            local index = table.find(facial_anim_list, seq[i])
            if index then
                seq[i] = tostring(index - 1) -- stored as AVsitter1's 0-based number
            end
        end
        anim_data[1] = table.concat(seq, ":")
        table.insert(anims, { trigger = pose, data = table.concat(anim_data, "|") })
        Owner_Say("Read settings for Expressions for '" .. pose .. "'")
    elseif command == "CAMERA" then
        camera_position = lslVec(pose)
        camera_focus = lslVec(L(parts, 2))
        Owner_Say("Read settings for Camera")
    end
end

local function onDone(_total: number)
    Owner_Say("Ready, Memory: " .. ll.GetFreeMemory())
    ll.PlaySound(SILENCE, 1)
end

--------------------------------------------------------------------------
-- init (state_entry)
--------------------------------------------------------------------------
do
    local name = ll.GetScriptName()
    local sp = string.find(name, " ", 1, true)
    script_channel = if sp then int(string.sub(name, sp)) else 0
    if script_channel == 0 then
        for _ = 1, get_number_of_scripts(SITTER_BASENAME) do
            table.insert(SITTERS, NULL)
        end
        stopSound()
        comm_channel = randomChannel()
        menu_channel = randomChannel()
        openListens(false, false)
        LLEvents:on("listen", onListen)
        LLEvents:on("link_message", onLinkMessage)
        LLEvents:on("run_time_permissions", onPermissions)
        LLEvents:on("changed", onChanged)
        LLEvents:on("on_rez", function(_start: number)
            comm_channel = randomChannel()
            menu_channel = randomChannel()
            -- FIX: AVsitter1 changed the channels but kept the old listens
            openListens(false, false)
        end)
        notecard_key = posCardSig()
        if ll.GetInventoryType(notecard_name) == INVENTORY_NOTECARD then
            Owner_Say("Reading " .. notecard_name)
            readNotecard(notecard_name, onLine, onDone)
        end
    end
    -- numbered copies stay inert (AVsitter1 "state nothing")
end
