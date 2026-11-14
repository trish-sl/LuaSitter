--[[
  [LS]sit - Main sitting script (one copy per sitter: "[LS]sit", "[LS]sit 1", "[LS]sit 2", ...)
  LuaSitter: SLua port of AVsitter(TM) [AV]sitA + [AV]sitB. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors

  What it does
  ------------
  Reads the LSpos (or AVpos) notecard, places the sit target for its sitter, animates and positions
  that sitter, and shows the pose menu and the personal "[ADJUST]" menu.

  This single script replaces the upstream pair [AV]sitA (animation / sit targets) and
  [AV]sitB (menu / pose memory). The pair only existed because LSL Mono scripts are limited
  to 64 KB. One copy per sitter is still required: a script can hold animation permission
  for only one avatar at a time.

  Compatibility
  -------------
  * LSpos and AVpos notecards are read exactly as upstream (same commands, same quirks).
  * All public link messages are kept (90000-90500, see LuaSitter2/LINK_MESSAGES.md).
    Messages that only travelled between sitA and sitB (90299, 90302, sitA->sitB
    90300/90301 while loading, sitB->sitA 90055) are direct calls. 90055 is still
    broadcast for [LS]adjuster, and 90300/90301 are still accepted from [LS]adjuster.

  Changes vs upstream
  -------------------
  * Notecards are read with ll.GetNotecardLineSync (instant when cached), falling back to
    ll.GetNotecardLine/dataserver when the simulator answers NAK.
  * Notecard names: "LSpos" is read when present, else "AVpos" (same format). The hip fix
    animation may be named "LShipfix" or "AVhipfix".
  * Per-sitter notecards (based on upstream PR #151): "[LS]sit N" also reads "LSpos sitter N"
    if present, as that sitter's own section (the main notecard is still read for global
    settings).
  * New link message 90032: like 90030 (swap), then gives the menu to the swapped sitters
    (upstream issue #140).
  * DUMP is paced by a timer instead of blocking the script with llSleep (upstream issue
    #109); the V: line also carries KFM, LROT, DFLT, WARN, BRAND, ROLES and ONSIT (upstream
    lost them on re-dump), and AMENU is dumped unmasked.
  * RLV: the pose menu button that opens the RLV menu is labelled "RLV ▸" (upstream:
    "Control..."). It still sends "Control..." in 90100, so LSL [AV]root-RLV keeps working.
    The menu text explains it and [STOP].
  * Keyframed furniture (KFM): the pauses around moving a sitter are LLTimers instead of
    llSleep(0.4) / llSleep(0.2); a newer move cancels the steps of an older one.
  * SEP is written as an escape, so copy/paste cannot turn it into a space
    (upstream issues #147 / #152).
  * For the optional [LS]commands plugin: 90017 (play the next/previous pose) and 90018
    (move the pose by arrow key, 0.01 m or 1°; Shift+Left/Right turn). With the plugin
    present, the sitter's own personal adjust menu has "Keys" instead of [SAVE ALL], and
    [SAVE] asks [THIS POSE] / [ALL POSES].
]]

local product = "LuaSitter"
local version = "3.0-lua1"
local main_script = "[LS]sit"
local select_script = "[LS]select"
local expression_script = "[LS]faces-camera"
local adjust_script = "[LS]adjuster"
local commands_script = "[LS]commands" -- optional plugin: chat commands (gestures) and arrow keys
local helper_objects = { "[LS]helper", "[AV]helper" }

local SEP = "\u{FFFD}"
local NULL = tostring(NULL_KEY)

--------------------------------------------------------------------------------
-- helpers
--------------------------------------------------------------------------------
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

-- Reads a string the way LSL's (vector) cast does; nil when that gives no vector.
-- tovector refuses text after the vector ("<1,2,3>// note") and a fourth number
-- ("<0,0,0,1>"), which LSL's cast ignores; this reads them as AVsitter does.
-- Only used when tovector gives nothing.
local function toVec(s: string): vector?
    local v = tovector(s)
    if v ~= nil then
        return v
    end
    local x, y, z = string.match(s, "^%s*<([^,>]*),([^,>]*),([^,>]*)")
    if x == nil or y == nil or z == nil then
        return nil
    end
    local nx, ny, nz = tonumber(x), tonumber(y), tonumber(z)
    if nx == nil or ny == nil or nz == nil then
        return nil
    end
    return vector(nx, ny, nz)
end

local function vec(s: any): vector
    if typeof(s) == "vector" then
        return s
    end
    return toVec(tostring(s or "")) or ZERO_VECTOR
end

-- LSL (string)vector format, so LSL plugins and the adjuster see what they always saw
local function vstr(v: vector): string
    return string.format("<%.5f, %.5f, %.5f>", v.x, v.y, v.z)
end

local function startsWith(s: string, p: string): boolean
    return string.sub(s, 1, #p) == p
end

local function contains(s: string, p: string): boolean
    return string.find(s, p, 1, true) ~= nil
end

local function split(s: string, sep: string): { string }
    return ll.ParseStringKeepNulls(s, { sep }, {})
end

local function trim(s: string): string
    return ll.StringTrim(s, STRING_TRIM)
end

-- LSL-style element access on a Lua array using a 0-based index (negative = from end,
-- out of range = ""). Used for the menu lists so the upstream index logic is kept intact.
local function at(t: { any }, i: number): string
    if i < 0 then
        i = #t + i
    end
    local v = t[i + 1]
    if v == nil then
        return ""
    end
    return tostring(v)
end

-- 0-based llListFindList for a single string, -1 when missing
local function find0(t: { any }, v: any): number
    local i = table.find(t, v)
    return if i then i - 1 else -1
end

local function orderButtons(b: { string }): { string }
    local out = {}
    local n = #b
    for _, r in { { n - 2, n }, { n - 5, n - 3 }, { n - 8, n - 6 }, { n - 11, n - 9 } } do
        for i = math.max(r[1], 1), r[2] do
            table.insert(out, b[i])
        end
    end
    return out
end

local function randomChannel(): number
    return -(math.floor(ll.Frand(2147483520)) + 1)
end

local function hasScript(name: string): boolean
    return ll.GetInventoryType(name) == INVENTORY_SCRIPT
end

local function helperObjectPresent(): boolean
    for _, n in helper_objects do
        if ll.GetInventoryType(n) == INVENTORY_OBJECT then
            return true
        end
    end
    return false
end

local function primDesc(link: number): string
    return tostring(ll.GetLinkPrimitiveParams(link, { PRIM_DESC })[1] or "")
end

local function agentPresent(k: string): boolean
    return isKey(k) and ll.GetAgentSize(K(k)) ~= ZERO_VECTOR
end

local function hasAnimPerm(): boolean
    return bit32.band(ll.GetPermissions(), PERMISSION_TRIGGER_ANIMATION) ~= 0
end

local function sendLinked(link: number, n: number, msg: any, id: any)
    ll.MessageLinked(link, n, tostring(msg), tostring(id))
end

local function getNumberOfScripts(): number
    local i = 1
    while hasScript(main_script .. " " .. tostring(i)) do
        i += 1
    end
    return i
end

--------------------------------------------------------------------------------
-- state (sitA half)
--------------------------------------------------------------------------------
local scriptName = ll.GetScriptName()
local SCRIPT_CHANNEL = 0
do
    local sp = ll.SubStringIndex(scriptName, " ")
    if sp then
        SCRIPT_CHANNEL = int(ll.GetSubString(scriptName, sp, -1))
    end
end
local SC = SCRIPT_CHANNEL

local SITTERS: { string } = {}      -- 0-based sitter n is SITTERS[n+1]; "" = empty seat
local SWAPPED = false
local swapMenu = false              -- set by 90032: give the menu after the swap
local swapKey = ""                  -- avatar we asked permission from because of a swap
local MY_SITTER = ""
local CONTROLLER = ""
local CUSTOM_TEXT = ""
local ADJUST_MENU: { string } = {}  -- label, link number, label, link number, ...
local SET = -1
local MTYPE = 0
local ETYPE = 1
local SELECT = 0
local SWAP = 2
local AMENU = 2
local DFLT = 1
local GENDERS: { number } = {}
local OLD_HELPER_METHOD = 0
local WARN = 1
local FIRST_POSENAME = ""
local FIRST_ANIMATION_SEQUENCE = ""
local OLD_POSE_NAME = ""
local CURRENT_POSE_NAME = ""
local OLD_ANIMATION_FILENAME = ""
local CURRENT_ANIMATION_SEQUENCE = ""
local MALE_POSENAME = ""
local FIRST_MALE_ANIMATION_SEQUENCE = ""
local FEMALE_POSENAME = ""
local FIRST_FEMALE_ANIMATION_SEQUENCE = ""
local CURRENT_ANIMATION_FILENAME = ""
local SITTER_INFO: { string } = {}
local SEQUENCE_POINTER = 0
local FIRST_POSITION = ZERO_VECTOR
local FIRST_ROTATION = ZERO_VECTOR
local DEFAULT_POSITION = ZERO_VECTOR
local DEFAULT_ROTATION = ZERO_VECTOR
local CURRENT_POSITION = ZERO_VECTOR
local CURRENT_ROTATION = ZERO_VECTOR
local wrong_primcount = false
local prims = 0
-- personal position offsets: { pose = name or "M#T!" (all poses), who = 8-char key prefix,
-- pos = vector, rot = vector }, least recently used first
local CUSTOMS: { { pose: string, who: string, pos: vector, rot: vector } } = {}
local customs_cap = 100
local HASKEYFRAME = 0
local REFERENCE = 0
local notecard_key = ""
-- pose menu button that opens the RLV menu (sent as "Control..." in 90100)
local RLV_BUTTON = "RLV ▸"
local sitter_notecard = ""          -- "LSpos sitter N" when present (PR #151)
local sitter_notecard_key = ""
local reading_notecard_section = false
local notecard_lines = 0
local my_sittarget = 0
local original_my_sittarget = 0
local SITTERS_SITTARGETS: { number } = {}
local ORIGINAL_SITTERS_SITTARGETS: { number } = {}
local has_security = false
local has_texture = false
local has_faces = false             -- this sitter has ANIM (facial expression) lines
local RLVDesignations = ""
local increment_pointer = 0
local pos_rot_adjust_toggle = false
local adj_channel = 0
local adj_handle = 0
local BRAND = ""
local onSit = ""
local speed_index = 0

--------------------------------------------------------------------------------
-- state (sitB half)
--------------------------------------------------------------------------------
local MENU_LIST: { string } = {}
local DATA_LIST: { string } = {}
local POS_LIST: { vector } = {}
local ROT_LIST: { vector } = {}
local helper_mode = false
local has_RLV = 0
local ANIM_INDEX = 0
local FIRST_INDEX = -1
local menu_handle = 0
local menu_channel = randomChannel() -- FIX: upstream started at channel 0 (public chat)
local current_menu = -1
local last_menu = 0
local menu_page = 0

-- forward declarations
local animation_menu: (number) -> number
local apply_anim_info: (boolean) -> ()

--------------------------------------------------------------------------------
-- animation helpers
--------------------------------------------------------------------------------
local function startAnim(anim: string)
    if anim ~= "" and hasAnimPerm() and agentPresent(tostring(ll.GetPermissionsKey())) then
        ll.StartAnimation(anim)
    end
end

local function stopAnim(anim: string)
    if anim ~= "" and hasAnimPerm() and agentPresent(tostring(ll.GetPermissionsKey())) then
        ll.StopAnimation(anim)
    end
end

-- Stop the previous animation a little after starting the new one (upstream used
-- llSleep, which froze the script). Skipped if that animation became current again.
local function stopOldAnimLater(old: string, delay: number)
    local who = MY_SITTER
    LLTimers:once(delay, function()
        if old ~= CURRENT_ANIMATION_FILENAME and who == MY_SITTER then
            stopAnim(old)
        end
    end)
end

--------------------------------------------------------------------------------
-- sit targets
--------------------------------------------------------------------------------
local function descAllowsSitTarget(desc: string): boolean
    return desc ~= "-1" and ll.GetSubString(desc, -3, -1) ~= "#-1"
end

local function wipe_sit_targets()
    for i = 0, ll.GetNumberOfPrims() do
        if descAllowsSitTarget(primDesc(i)) then
            ll.LinkSitTarget(i, ZERO_VECTOR, ZERO_ROTATION)
        end
    end
end

local function primcount_error()
    ll.Dialog(ll.GetOwner(), "\nThere aren't enough prims for required SitTargets.\nYou must have one prim for each avatar to sit!", { "OK" }, 23658)
end

local function set_sittarget()
    local target_pos = DEFAULT_POSITION
    local target_rot = ll.Euler2Rot(DEFAULT_ROTATION * DEG_TO_RAD)
    if my_sittarget ~= ll.GetLinkNumber() then
        local local_avsit_prim_pos = ZERO_VECTOR
        local local_avsit_prim_rot = ZERO_ROTATION
        if ll.GetLinkNumber() > 1 then
            local_avsit_prim_pos = ll.GetLocalPos()
            local_avsit_prim_rot = ll.GetLocalRot()
        end
        target_pos = local_avsit_prim_pos + DEFAULT_POSITION * local_avsit_prim_rot
        target_rot = target_rot * local_avsit_prim_rot
        if my_sittarget > 1 then
            -- no prim with that link number (a sitter without a sit target, e.g. more
            -- sitters than prims with WARN 0): empty list, read as zero like llList2Rot did
            local local_target_prim_rot: quaternion = ll.GetLinkPrimitiveParams(my_sittarget, { PRIM_ROT_LOCAL })[1] or ZERO_ROTATION
            local local_target_prim_pos: vector = ll.GetLinkPrimitiveParams(my_sittarget, { PRIM_POS_LOCAL })[1] or ZERO_VECTOR
            target_pos = (local_avsit_prim_pos + DEFAULT_POSITION * local_avsit_prim_rot - local_target_prim_pos) / local_target_prim_rot
            target_rot = target_rot / local_target_prim_rot
        end
    end
    local target = my_sittarget
    if ll.GetNumberOfPrims() == 1 and target == 1 then
        target = 0
    end
    if descAllowsSitTarget(primDesc(target)) then
        ll.LinkSitTarget(target, target_pos - vector(0, 0, 0.4) + quaternion.toup(target_rot) * 0.05, target_rot)
    end
end

local function prep()
    has_security = false
    has_texture = false
    if SC == 0 then
        sendLinked(LINK_SET, 90201, "", "") -- 90201=ask for info about plugins
    end
end

local function isInteger(data: string): boolean
    -- upstream allowed leading zeros
    return string.match(data, "^%d+$") ~= nil
end

local function sittargets()
    wrong_primcount = false
    prims = ll.GetObjectPrimCount(ll.GetKey())
    if #SITTERS > prims and WARN ~= 0 then
        if SC == 0 then
            primcount_error()
        end
        wrong_primcount = true
    end
    SITTERS_SITTARGETS = {}
    if #SITTERS == 1 then
        my_sittarget = ll.GetLinkNumber()
        SITTERS_SITTARGETS = { my_sittarget }
    else
        local assigned = {}
        for i = 1, #SITTERS do
            SITTERS_SITTARGETS[i] = 1000
            assigned[i] = false
        end
        for i = 1, prims do
            local nextFree = table.find(SITTERS_SITTARGETS, 1000)
            local desc = primDesc(i)
            local hash = ll.SubStringIndex(desc, "#")
            if hash then
                desc = ll.GetSubString(desc, hash + 1, -1)
            end
            if desc ~= "-1" then
                local data = split(desc, "-")
                if #data == 2 and isInteger(data[1]) and isInteger(data[2]) then
                    if int(data[1]) == SET then
                        local slot = int(data[2]) + 1
                        -- FIX: upstream appended out-of-range sitter numbers to the list
                        if slot >= 1 and slot <= #SITTERS then
                            SITTERS_SITTARGETS[slot] = i
                            assigned[slot] = true
                            if not table.find(assigned, false) then
                                break
                            end
                        end
                    end
                elseif nextFree then
                    SITTERS_SITTARGETS[nextFree] = i
                end
            end
        end
        my_sittarget = SITTERS_SITTARGETS[SC + 1] or 0
    end
    original_my_sittarget = my_sittarget
    ORIGINAL_SITTERS_SITTARGETS = table.clone(SITTERS_SITTARGETS)
    prep()
    set_sittarget()
end

--------------------------------------------------------------------------------
-- positioning / animation
--------------------------------------------------------------------------------
-- link number of my sitter, or nil when not seated
local function mySitterLink(): number?
    local sitter_prim = ll.GetNumberOfPrims()
    while ll.GetAgentSize(ll.GetLinkKey(sitter_prim)) ~= ZERO_VECTOR do
        if tostring(ll.GetLinkKey(sitter_prim)) == MY_SITTER then
            return sitter_prim
        end
        sitter_prim -= 1
    end
    return nil
end

local function placeSitter(sitter_prim: number)
    local localrot = ZERO_ROTATION
    local localpos = ZERO_VECTOR
    if ll.GetLinkNumber() > 1 then
        localrot = ll.GetLocalRot()
        localpos = ll.GetLocalPos()
    end
    ll.SetLinkPrimitiveParamsFast(sitter_prim, {
        PRIM_ROT_LOCAL, ll.Euler2Rot((CURRENT_ROTATION + vector(0, 0, 0.002)) * DEG_TO_RAD) * localrot,
        PRIM_POS_LOCAL, CURRENT_POSITION * localrot + localpos,
    })
end

-- Keyframed furniture: the motion is paused while the sitter is moved, as upstream,
-- but the waits (upstream llSleep(0.4) and llSleep(0.2)) are LLTimers. A newer
-- call cancels the steps of an older one; the newest one always resumes the motion.
local kfm_generation = 0

local function sit_using_prim_params()
    local sitter_prim = mySitterLink()
    if not sitter_prim then
        return
    end
    local physical = ll.GetStatus(STATUS_PHYSICS)
    if HASKEYFRAME == 0 or physical then
        placeSitter(sitter_prim)
        return
    end
    kfm_generation += 1
    local generation = kfm_generation
    local function pauseAndPlace()
        if generation ~= kfm_generation then
            return
        end
        ll.SetKeyframedMotion({}, { KFM_COMMAND, KFM_CMD_PAUSE })
        local link = mySitterLink()
        if link then
            placeSitter(link)
        end
        LLTimers:once(0.2, function()
            if generation == kfm_generation then
                ll.SetKeyframedMotion({}, { KFM_COMMAND, KFM_CMD_PLAY })
            end
        end)
    end
    if HASKEYFRAME == 2 then
        LLTimers:once(0.4, pauseAndPlace)
    else
        pauseAndPlace()
    end
end

local onSequenceTimer: (number, number?) -> ()
local seqTimer: any = nil

local function setSequenceTimer(seconds: number)
    if seqTimer then
        LLTimers:off(seqTimer)
        seqTimer = nil
    end
    if seconds > 0 then
        seqTimer = LLTimers:every(seconds, onSequenceTimer)
    end
end

local function update_current_anim_name()
    local sequence = split(CURRENT_ANIMATION_SEQUENCE, SEP)
    CURRENT_ANIMATION_FILENAME = at(sequence, SEQUENCE_POINTER)
    local speed_text = at({ "", "+", "-" }, speed_index)
    if ll.GetInventoryType(CURRENT_ANIMATION_FILENAME .. speed_text) == INVENTORY_ANIMATION then
        CURRENT_ANIMATION_FILENAME ..= speed_text
    end
    setSequenceTimer(num(at(sequence, SEQUENCE_POINTER + 1)))
end

onSequenceTimer = function()
    SEQUENCE_POINTER += 2
    local sequence = split(CURRENT_ANIMATION_SEQUENCE, SEP)
    local entry = at(sequence, SEQUENCE_POINTER)
    if SEQUENCE_POINTER >= #sequence or entry == "M" or entry == "F" then
        SEQUENCE_POINTER = 0
    end
    OLD_ANIMATION_FILENAME = CURRENT_ANIMATION_FILENAME
    update_current_anim_name()
    if hasAnimPerm() and agentPresent(MY_SITTER) then
        startAnim(CURRENT_ANIMATION_FILENAME)
        if OLD_ANIMATION_FILENAME ~= "" and OLD_ANIMATION_FILENAME ~= CURRENT_ANIMATION_FILENAME then
            stopOldAnimLater(OLD_ANIMATION_FILENAME, 1.0)
        end
    end
end

local function findCustom(pose: string, who: string): number?
    for i, c in CUSTOMS do
        if c.pose == pose and c.who == who then
            return i
        end
    end
    return nil
end

local function apply_current_anim(broadcast: boolean)
    SEQUENCE_POINTER = 0
    update_current_anim_name()
    CURRENT_POSITION = DEFAULT_POSITION
    CURRENT_ROTATION = DEFAULT_ROTATION
    local who = string.sub(MY_SITTER, 1, 8)
    local ci = findCustom(CURRENT_POSE_NAME, who) or findCustom("M#T!", who)
    if ci then
        local c = CUSTOMS[ci]
        CURRENT_POSITION += c.pos
        CURRENT_ROTATION += c.rot
        -- most recently used goes last
        table.remove(CUSTOMS, ci)
        table.insert(CUSTOMS, c)
    end
    if hasAnimPerm() and agentPresent(MY_SITTER) then
        if broadcast then
            local posename = CURRENT_POSE_NAME
            local is_sync = 0
            if not startsWith(posename, "P:") then
                is_sync = 1
            else
                posename = ll.GetSubString(posename, 3, -1)
            end
            local old_sync = ""
            if OLD_POSE_NAME ~= CURRENT_POSE_NAME and not startsWith(OLD_POSE_NAME, "P:") then
                old_sync = OLD_POSE_NAME
            end
            -- 90045=broadcast info about the pose playing
            sendLinked(LINK_SET, 90045, table.concat({
                tostring(SC), posename, CURRENT_ANIMATION_SEQUENCE, tostring(SET),
                table.concat(SITTERS, "@"), old_sync, tostring(is_sync),
            }, "|"), MY_SITTER)
        end
        if HASKEYFRAME ~= 0 then
            sit_using_prim_params()
        end
        startAnim(CURRENT_ANIMATION_FILENAME)
        if OLD_ANIMATION_FILENAME ~= "" and OLD_ANIMATION_FILENAME ~= CURRENT_ANIMATION_FILENAME then
            stopOldAnimLater(OLD_ANIMATION_FILENAME, 0.2)
        end
        if HASKEYFRAME == 0 then
            sit_using_prim_params()
        end
    end
end

local function release_sitter(i: number)
    SITTERS[i + 1] = ""
    if i == SC and hasAnimPerm() then
        if isKey(MY_SITTER) then
            sendLinked(LINK_SET, 90065, SC, MY_SITTER) -- 90065=sitter gone
        end
        if agentPresent(MY_SITTER) then
            stopAnim(CURRENT_ANIMATION_FILENAME)
        end
        MY_SITTER = ""
        ll.ListenRemove(adj_handle)
    end
end

local function end_sitter()
    setSequenceTimer(0)
    if isKey(MY_SITTER) then
        stopAnim(CURRENT_ANIMATION_FILENAME)
        if OLD_HELPER_METHOD ~= 0 then
            startAnim("sit")
        end
    end
end

-- Applies the selected pose (upstream: sitB -> sitA 90055, here a direct call).
-- 90055 is still broadcast for [LS]adjuster.
local function send_anim_info(broadcast: boolean)
    local pose = at(MENU_LIST, ANIM_INDEX)
    local data = at(DATA_LIST, ANIM_INDEX)
    local idx = if ANIM_INDEX < 0 then #MENU_LIST + ANIM_INDEX + 1 else ANIM_INDEX + 1
    local pos = POS_LIST[idx] or ZERO_VECTOR
    local rotv = ROT_LIST[idx] or ZERO_VECTOR
    sendLinked(LINK_THIS, 90055, SC, table.concat({
        pose, data, vstr(pos), vstr(rotv), if broadcast then "1" else "0", tostring(speed_index),
    }, "|"))
    OLD_POSE_NAME = CURRENT_POSE_NAME
    CURRENT_POSE_NAME = pose
    OLD_ANIMATION_FILENAME = CURRENT_ANIMATION_FILENAME
    CURRENT_ANIMATION_SEQUENCE = data
    DEFAULT_POSITION = pos
    CURRENT_POSITION = pos
    DEFAULT_ROTATION = rotv
    CURRENT_ROTATION = rotv
    if FIRST_POSENAME == "" or CURRENT_POSE_NAME == FIRST_POSENAME then
        FIRST_POSENAME = CURRENT_POSE_NAME
        FIRST_POSITION = DEFAULT_POSITION
        FIRST_ROTATION = DEFAULT_ROTATION
        FIRST_ANIMATION_SEQUENCE = CURRENT_ANIMATION_SEQUENCE
    end
    apply_anim_info(broadcast)
end

apply_anim_info = function(broadcast: boolean)
    apply_current_anim(broadcast)
    set_sittarget()
end

local function memory()
    print(scriptName .. "[" .. version .. "] " .. tostring(#MENU_LIST) .. " Items Ready, Mem=" .. tostring(ll.GetFreeMemory()))
end

--------------------------------------------------------------------------------
-- dialogs
--------------------------------------------------------------------------------
local function adj_dialog(text: string, items: { string })
    if not isKey(CONTROLLER) then
        return
    end
    ll.ListenRemove(adj_handle)
    adj_channel = randomChannel()
    adj_handle = ll.Listen(adj_channel, "", K(CONTROLLER), "")
    ll.Dialog(K(CONTROLLER), product .. " " .. version .. "\n\n" .. text, orderButtons(items), adj_channel)
end

-- the sitter adjusts their own pose and the [LS]commands plugin is present: the menu
-- has "Keys" (arrow keys move the pose) instead of [SAVE ALL], and [SAVE] asks which
local function keys_menu(): boolean
    return CONTROLLER ~= "" and CONTROLLER == MY_SITTER and hasScript(commands_script)
end

local function adjust_pose_menu()
    local posrot_button = "Position"
    local value_button = at({ "0.05m", "0.25m", "0.01m" }, increment_pointer)
    if pos_rot_adjust_toggle then
        posrot_button = "Rotation"
        value_button = at({ "5°", "25°", "1°" }, increment_pointer)
    end
    if keys_menu() then
        adj_dialog("Personal adjustment:\n\nKeys = move with the arrow keys and PgUp/PgDn, turn with Shift+Left/Right (press again to stop).",
            { "[BACK]", posrot_button, value_button, "[DEFAULT]", "[SAVE]", "Keys", "X+", "Y+", "Z+", "X-", "Y-", "Z-" })
        return
    end
    adj_dialog("Personal adjustment:", { "[BACK]", posrot_button, value_button, "[DEFAULT]", "[SAVE]", "[SAVE ALL]", "X+", "Y+", "Z+", "X-", "Y-", "Z-" })
end

local function options_menu()
    local items = {}
    if has_texture then
        table.insert(items, "[TEXTURE]")
    end
    -- only when this sitter actually has facial expressions defined
    if has_faces and hasScript(expression_script) then
        table.insert(items, "[FACES]")
    end
    if has_security then
        table.insert(items, "[SECURITY]")
    end
    for i = 1, #ADJUST_MENU, 2 do
        table.insert(items, ADJUST_MENU[i])
    end
    if helperObjectPresent() and hasScript(adjust_script) then
        table.insert(items, "[HELPER]")
    end
    if #items == 0 then
        adjust_pose_menu()
        return
    end
    table.insert(items, "[POSE]")
    table.insert(items, 1, "[BACK]")
    adj_dialog("Adjust:", items)
end

animation_menu = function(animation_menu_function: number): number
    if (animation_menu_function == -1 or #MENU_LIST < 2) and not helper_mode and hasScript(select_script) then
        sendLinked(LINK_SET, 90009, CONTROLLER, MY_SITTER)
        return 0
    end
    local menu = product .. " " .. version
    if BRAND ~= "" then
        menu = BRAND
    end
    if CONTROLLER ~= MY_SITTER or has_RLV ~= 0 then
        menu ..= "\n\nMenu for " .. ll.Key2Name(K(MY_SITTER))
    end
    menu ..= "\n\n"
    if CUSTOM_TEXT ~= "" then
        menu ..= CUSTOM_TEXT .. "\n"
    end
    if #SITTER_INFO > 0 then
        menu ..= "[" .. (SITTER_INFO[1] or "") .. "]"
    elseif #SITTERS > 1 then
        menu ..= "[Sitter " .. tostring(SC) .. "]"
    end
    local animation_file = at(split(at(DATA_LIST, ANIM_INDEX), SEP), 0)
    local current_pose_name = ""
    if FIRST_INDEX ~= -1 then
        current_pose_name = at(MENU_LIST, ANIM_INDEX)
        menu ..= " [" .. at(ll.ParseString2List(current_pose_name, { "P:" }, {}), 0)
        if ll.GetInventoryType(animation_file .. "+") == INVENTORY_ANIMATION then
            if speed_index < 0 then
                menu ..= ", Soft"
            elseif speed_index > 0 then
                menu ..= ", Hard"
            end
        end
        menu ..= "]"
    end
    local total_items = 0
    local i = current_menu + 1
    while i < #MENU_LIST and not startsWith(at(MENU_LIST, i), "M:") do
        total_items += 1
        i += 1
    end
    local items0: { string } = {}
    local items2: { string } = {}
    if current_menu ~= -1 or hasScript(select_script) then
        table.insert(items0, "[BACK]")
    end
    local submenu_info = ""
    if current_menu ~= -1 then
        submenu_info = at(DATA_LIST, current_menu)
    end
    if helper_mode then
        table.insert(items2, "[NEW]")
        if current_pose_name ~= "" then
            table.insert(items2, "[DUMP]")
            table.insert(items2, "[SAVE]")
        end
    elseif contains(submenu_info, "V") then
        table.insert(items0, "<< Softer")
        table.insert(items0, "Harder >>")
    end
    local amenu = bit32.band(AMENU, 3)
    if amenu == 2 or (amenu == 1 and current_menu == -1) or contains(submenu_info, "A") then
        if not (OLD_HELPER_METHOD ~= 0 and helper_mode) then
            table.insert(items2, "[ADJUST]")
        end
    end
    if not startsWith(onSit, "ASK")
        and ((current_menu == -1 and SWAP == 1) or SWAP == 2 or contains(submenu_info, "S"))
        and (#SITTERS > 1 and not hasScript(select_script))
    then
        table.insert(items2, "[SWAP]")
    end
    if current_menu == -1 then
        if has_RLV ~= 0 and (ll.GetSubString(RLVDesignations, SC + 1, SC + 1) == "D" or CONTROLLER ~= MY_SITTER) then
            table.insert(items2, "[STOP]")
            if not helper_mode then
                table.insert(items2, RLV_BUTTON)
                menu ..= "\n\nRLV ▸ = capture and RLV controls"
            end
            menu ..= "\n[STOP] = release everyone and stand up"
        end
    end
    local items_per_page = 12 - #items2 - #items0
    if items_per_page < total_items then
        table.insert(items2, "[<<]")
        table.insert(items2, "[>>]")
        items_per_page -= 2
    end
    local items1: { string } = {}
    i = current_menu + 1 + menu_page * items_per_page
    local page_start = i
    repeat
        if i < #MENU_LIST then
            local m = at(MENU_LIST, i)
            if startsWith(m, "M:") then
                break
            end
            local prefix = string.sub(m, 1, 2)
            if prefix == "T:" or prefix == "P:" or prefix == "B:" then
                table.insert(items1, ll.GetSubString(m, 3, -1))
            else
                table.insert(items1, m)
            end
        end
        i += 1
    until not (i < page_start + items_per_page)
    if animation_menu_function == 1 then
        return (total_items + items_per_page - 1) // items_per_page - 1
    end
    if submenu_info == "V" then
        while #items1 < items_per_page do
            table.insert(items1, " ")
        end
    end
    if not isKey(CONTROLLER) then
        return 0
    end
    ll.ListenRemove(menu_handle)
    menu_handle = ll.Listen(menu_channel, "", K(CONTROLLER), "")
    local all = {}
    table.move(items0, 1, #items0, 1, all)
    table.move(items1, 1, #items1, #all + 1, all)
    table.move(items2, 1, #items2, #all + 1, all)
    ll.Dialog(K(CONTROLLER), menu, orderButtons(all), menu_channel)
    return 0
end

--------------------------------------------------------------------------------
-- pose memory (sitB 90300 / 90301)
--------------------------------------------------------------------------------
local function lookupPose(name: string): number
    local index = find0(MENU_LIST, name)
    if index == -1 then
        index = find0(MENU_LIST, "P:" .. name)
    end
    return index
end

-- data = { name, anim/data [, pos, rot] } (upstream 90300 payload split on "|")
local function addMenuItem(data: { string })
    local index = lookupPose(data[1] or "")
    local place_to_add = #MENU_LIST -- 0-based insert position
    if #data > 2 then
        -- added from the helper: insert at the end of the current (sub)menu
        place_to_add = current_menu + 1
        while place_to_add < #MENU_LIST and not startsWith(at(MENU_LIST, place_to_add), "M:") do
            place_to_add += 1
        end
    end
    table.insert(MENU_LIST, place_to_add + 1, data[1] or "")
    table.insert(DATA_LIST, place_to_add + 1, data[2] or "")
    table.insert(POS_LIST, place_to_add + 1, ZERO_VECTOR)
    table.insert(ROT_LIST, place_to_add + 1, ZERO_VECTOR)
    -- FIX: a pose of the same name after the insert point moved down one place;
    -- upstream then saved the position on the entry before it
    if index ~= -1 and index >= place_to_add then
        index += 1
    end
    if #data == 4 then
        if FIRST_INDEX == -1 then
            FIRST_INDEX = place_to_add
        end
        if index ~= -1 then
            place_to_add = index
        end
        POS_LIST[place_to_add + 1] = vec(data[3])
        ROT_LIST[place_to_add + 1] = vec(data[4])
        ANIM_INDEX = place_to_add
        send_anim_info(true)
        memory()
    end
end

-- data = { name, pos, rot [, ""] }
local function updatePosRot(data: { string })
    local index = lookupPose(data[1] or "")
    if index ~= -1 then
        POS_LIST[index + 1] = vec(data[2])
        ROT_LIST[index + 1] = vec(data[3])
        if #data ~= 3 then
            send_anim_info(false)
        end
    end
end

--------------------------------------------------------------------------------
-- DUMP (90020 -> 90022 lines -> 90021), paced by a timer instead of llSleep
--------------------------------------------------------------------------------
local dumpTimer: any = nil

local function dump()
    if dumpTimer then
        LLTimers:off(dumpTimer)
        dumpTimer = nil
    end
    local sitterInfo = table.concat(SITTER_INFO, SEP)
    sendLinked(LINK_THIS, 90022, "V:" .. table.concat({
        version, tostring(MTYPE), tostring(ETYPE), tostring(SET), tostring(SWAP), sitterInfo,
        CUSTOM_TEXT, table.concat(ADJUST_MENU, SEP), tostring(SELECT),
        tostring(AMENU), -- FIX: upstream dumped AMENU & 3, losing the "4" flag
        tostring(OLD_HELPER_METHOD),
        -- LuaSitter additions (ignored by upstream adjusters)
        tostring(HASKEYFRAME), tostring(REFERENCE), tostring(DFLT), tostring(WARN), BRAND,
        RLVDesignations, onSit,
    }, "|"), SC)
    local lines: { string } = {}
    for i = 1, #MENU_LIST do
        table.insert(lines, "S:" .. MENU_LIST[i] .. "|" .. DATA_LIST[i])
    end
    for i = 1, #MENU_LIST do
        if POS_LIST[i] ~= ZERO_VECTOR then
            table.insert(lines, "{" .. MENU_LIST[i] .. "}" .. vstr(POS_LIST[i]) .. vstr(ROT_LIST[i]))
        end
    end
    local n = 0
    dumpTimer = LLTimers:every(0.1, function()
        n += 1
        if n <= #lines then
            sendLinked(LINK_THIS, 90022, lines[n], SC)
        else
            LLTimers:off(dumpTimer)
            dumpTimer = nil
            sendLinked(LINK_THIS, 90021, SC, "")
        end
    end)
end

--------------------------------------------------------------------------------
-- notecard
--------------------------------------------------------------------------------
-- Parse one pose notecard line. `own` = true when reading this sitter's own "LSpos sitter N" card.
local function parseLine(data: string, own: boolean)
    local diamond = ll.SubStringIndex(data, "◆")
    if diamond then
        data = ll.GetSubString(data, diamond + 1, -1)
    end
    data = ll.StringTrim(data, STRING_TRIM_HEAD)
    local command, rest
    local sp = ll.SubStringIndex(data, " ")
    if sp then
        command = ll.GetSubString(data, 1, sp - 1)
        rest = ll.GetSubString(data, sp + 1, -1)
    else
        -- upstream quirk: llGetSubString(data, 0, -2) when there is no space
        command = ll.GetSubString(data, 1, -2)
        rest = data
    end
    local parts = ll.ParseStringKeepNulls(rest, { " | ", " |", "| ", "|" }, {})
    local part0 = trim(parts[1] or "")
    local part1 = ""
    if #parts > 1 then
        part1 = trim(table.concat(parts, SEP, 2, #parts))
    end

    if command == "SITTER" then
        if own then
            if int(part0) == SC and #parts > 1 then
                SITTER_INFO = table.move(parts, 2, #parts, 1, {})
            end
            return
        end
        reading_notecard_section = false
        local g = parts[3]
        if g == "M" then
            table.insert(GENDERS, 1)
        elseif g == "F" then
            table.insert(GENDERS, 0)
        else
            table.insert(GENDERS, -1)
        end
        if int(part0) == SC then
            -- FIX: with an own "LSpos sitter N" card, that card replaces this sitter's
            -- section of the main notecard (as in upstream PR #151, where the main card was
            -- not read at all); only the SITTER line's name/gender info is kept from here.
            reading_notecard_section = sitter_notecard == ""
            if #parts > 1 then
                SITTER_INFO = table.move(parts, 2, #parts, 1, {})
            end
        end
        return
    elseif command == "MTYPE" then
        MTYPE = int(part0)
        ll.PassTouches(if MTYPE > 2 then 1 else 0)
        return
    elseif command == "ROLES" then
        RLVDesignations = table.concat(parts)
        return
    elseif command == "ETYPE" then
        ETYPE = int(part0)
        return
    elseif command == "SELECT" then
        SELECT = int(part0)
        return
    elseif command == "WARN" then
        WARN = int(part0)
        return
    elseif command == "TEXT" then
        CUSTOM_TEXT = ll.ReplaceSubString(part0, "\\n", "\n", 0)
        return
    elseif command == "SWAP" then
        SWAP = int(part0)
        return
    elseif command == "AMENU" then
        AMENU = int(part0)
        return
    elseif command == "HELPER" then
        OLD_HELPER_METHOD = int(part0)
        return
    elseif command == "SET" then
        SET = int(part0)
        return
    elseif command == "KFM" then
        HASKEYFRAME = int(part0)
        return
    elseif command == "LROT" then
        REFERENCE = int(part0)
        return
    elseif command == "BRAND" then
        BRAND = part0
        return
    elseif command == "DFLT" then
        DFLT = int(part0)
        return
    elseif command == "ONSIT" then
        onSit = part0
        return
    elseif command == "ADJUST" then
        ADJUST_MENU = parts
        return
    end

    if not (reading_notecard_section or own) then
        return
    end
    if command == "ANIM" then
        -- expressions for this sitter ([LS]faces-camera ignores the main notecard's
        -- section of a sitter that has its own "LSpos sitter N" card, so do the same here)
        if own or sitter_notecard == "" then
            has_faces = true
        end
        return
    end
    if ll.GetSubString(data, 1, 1) == "{" then
        local close = ll.SubStringIndex(data, "}") or 0
        local name = trim(ll.GetSubString(data, 2, close - 1))
        local after = ll.GetSubString(data, close + 1, -1)
        local vparts = split(ll.ReplaceSubString(after, " ", "", 0), "<")
        local pos = "<" .. (vparts[2] or "")
        local rotv = "<" .. (vparts[3] or "")
        if name == FIRST_POSENAME or "P:" .. name == FIRST_POSENAME then
            FIRST_POSITION = vec(pos)
            DEFAULT_POSITION = FIRST_POSITION
            CURRENT_POSITION = FIRST_POSITION
            FIRST_ROTATION = vec(rotv)
            DEFAULT_ROTATION = FIRST_ROTATION
            CURRENT_ROTATION = FIRST_ROTATION
        end
        updatePosRot({ name, pos, rotv })
        return
    end
    part0 = ll.GetSubString(part0, 1, 23)
    if command == "SEQUENCE" then
        command = "BUTTON" -- act as a button
        part1 = "90210" -- link code: trigger sequence
    end
    if command == "POSE" or command == "SYNC" or command == "MENU" or command == "TOMENU" or command == "BUTTON" then
        if command ~= "SYNC" then
            part0 = string.sub(command, 1, 1) .. ":" .. part0
        end
        if command == "MENU" or command == "TOMENU" then
            part0 ..= "*"
        end
        if command == "POSE" or command == "SYNC" then
            if FIRST_POSENAME == "" then
                FIRST_POSENAME = part0
                CURRENT_POSE_NAME = part0
                FIRST_ANIMATION_SEQUENCE = part1
                CURRENT_ANIMATION_SEQUENCE = part1
            end
            local last = parts[#parts]
            if last == "M" then
                MALE_POSENAME = part0
                FIRST_MALE_ANIMATION_SEQUENCE = part1
            elseif last == "F" then
                FEMALE_POSENAME = part0
                FIRST_FEMALE_ANIMATION_SEQUENCE = part1
            end
        end
        -- don't generate empty buttons (upstream issue #60)
        if part0 == "B:" then
            part0 = "B: "
        end
        if command == "BUTTON" and part1 == "" then
            part1 = "90200" -- default to rez prop
        end
        addMenuItem({ part0, part1 })
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
                -- not cached by the simulator: classic async read of this line
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

local function loadingFinished()
    if SC ~= 0 then
        sittargets()
    else
        ll.SetText("", vector(1, 1, 1), 1)
        sendLinked(LINK_SET, 90150, "", "") -- 90150=ask all sit scripts to place their sit targets again
    end
    -- former 90302 (sitA -> sitB settings)
    FIRST_INDEX = find0(MENU_LIST, FIRST_POSENAME)
    ANIM_INDEX = FIRST_INDEX
    customs_cap = math.clamp((ll.GetFreeMemory() - 8000) // 150, 10, 500)
    memory()
end

local function readSitterNotecard()
    if sitter_notecard ~= "" then
        readNotecard(sitter_notecard, function(line: string)
            parseLine(line, true)
        end, function()
            loadingFinished()
        end)
    else
        loadingFinished()
    end
end

--------------------------------------------------------------------------------
-- gender-specific first pose
--------------------------------------------------------------------------------
local function applyGenderPose(gender: number)
    if gender ~= 0 then
        if MALE_POSENAME ~= "" and CURRENT_POSE_NAME == FIRST_POSENAME then
            CURRENT_POSE_NAME = MALE_POSENAME
            CURRENT_ANIMATION_SEQUENCE = FIRST_MALE_ANIMATION_SEQUENCE
        end
    else
        if FEMALE_POSENAME ~= "" and CURRENT_POSE_NAME == FIRST_POSENAME then
            CURRENT_POSE_NAME = FEMALE_POSENAME
            CURRENT_ANIMATION_SEQUENCE = FIRST_FEMALE_ANIMATION_SEQUENCE
        end
    end
end

local function bodyShape(k: string): number
    return int(ll.GetObjectDetails(K(k), { OBJECT_BODY_SHAPE_TYPE })[1] or 0)
end

local function sendSitInfo()
    -- 90056=anim info for a sitter that sat (so helpers know where to go)
    sendLinked(LINK_THIS, 90056, SC, table.concat({
        CURRENT_POSE_NAME, CURRENT_ANIMATION_SEQUENCE, vstr(CURRENT_POSITION), vstr(CURRENT_ROTATION),
    }, "|"))
end

--------------------------------------------------------------------------------
-- events
--------------------------------------------------------------------------------
LLEvents:on("touch_end", function(events: { DetectedEvent })
    if SC == 0 and not has_security and MTYPE < 3 then
        sendLinked(LINK_SET, 90005, "", tostring(events[1]:getKey())) -- 90005=send menu to user
    end
end)

local ADJUST_BUTTONS = { "Position", "Rotation", "X+", "Y+", "Z+", "X-", "Y-", "Z-", "0.05m", "0.25m", "0.01m", "5°", "25°", "1°" }

-- move (or turn) the sitter one step along an axis ("X", "Y", "Z"; sign 1 or -1), with
-- the Position/Rotation mode and step size of the adjust menu. Used by the X+ ... Z-
-- buttons and by the arrow keys ([LS]commands, 90018).
-- step: nil = the adjust menu's step; rotate: nil = the menu's Position/Rotation mode
local function nudge(axis: string, sign: number, step: number?, rotate: boolean?)
    local amount = (step or num(at({ 0.05, 0.25, 0.01 }, increment_pointer))) * sign
    local direction = vector(1, 0, 0)
    if axis == "Y" then
        direction = vector(0, 1, 0)
    elseif axis == "Z" then
        direction = vector(0, 0, 1)
    end
    if if rotate == nil then pos_rot_adjust_toggle else rotate then
        CURRENT_ROTATION += direction * amount * 100
    else
        local c = direction * amount
        if REFERENCE ~= 0 then
            if ll.GetLinkNumber() > 1 then
                c /= ll.GetLocalRot()
            end
        else
            c /= ll.GetRot()
        end
        CURRENT_POSITION += c
    end
end

-- [SAVE] / [THIS POSE]: keep the sitter's offset for the current pose
local function save_this_pose(id: string)
    local who = string.sub(MY_SITTER, 1, 8)
    local ci = findCustom(CURRENT_POSE_NAME, who)
    if ci then
        table.remove(CUSTOMS, ci)
    end
    if #CUSTOMS >= customs_cap then
        table.remove(CUSTOMS, 1)
    end
    table.insert(CUSTOMS, { pose = CURRENT_POSE_NAME, who = who, pos = CURRENT_POSITION - DEFAULT_POSITION, rot = CURRENT_ROTATION - DEFAULT_ROTATION })
    adjust_pose_menu()
    ll.RegionSayTo(K(id), 0, "Personal position saved for this pose.")
end

-- personal [ADJUST] dialog (former sitA listener)
local function onAdjustListen(id: string, msg: string)
    local ai = table.find(ADJUST_MENU, msg)
    if ai then
        if id ~= MY_SITTER and bit32.band(AMENU, 4) == 0 then
            id = id .. "|" .. MY_SITTER
        end
        sendLinked(LINK_SET, int(ADJUST_MENU[ai + 1]), msg, id)
        return
    end
    local index = table.find(ADJUST_BUTTONS, msg)
    if msg == "[BACK]" then
        sendLinked(LINK_SET, 90005, "", CONTROLLER .. "|" .. MY_SITTER)
    elseif msg == "[POSE]" then
        adjust_pose_menu()
    elseif msg == "[DEFAULT]" then
        CURRENT_POSITION = DEFAULT_POSITION
        CURRENT_ROTATION = DEFAULT_ROTATION
        sit_using_prim_params()
        adjust_pose_menu()
    elseif msg == "[SAVE ALL]" then
        adj_dialog("Save personal position offset for all poses?", { "[BACK]", "[ALL POSES]" })
    elseif msg == "[ALL POSES]" then
        local who = string.sub(MY_SITTER, 1, 8)
        -- FIX: upstream deleted 5 list items per 4-item entry here
        for i = #CUSTOMS, 1, -1 do
            if CUSTOMS[i].who == who then
                table.remove(CUSTOMS, i)
            end
        end
        table.insert(CUSTOMS, { pose = "M#T!", who = who, pos = CURRENT_POSITION - DEFAULT_POSITION, rot = CURRENT_ROTATION - DEFAULT_ROTATION })
        adjust_pose_menu()
        ll.RegionSayTo(K(id), 0, "Personal position saved for all poses.")
    elseif msg == "[SAVE]" then
        if keys_menu() then
            -- "Keys" replaces [SAVE ALL] in this menu: ask which
            adj_dialog("Save your personal position for:", { "[BACK]", "[THIS POSE]", "[ALL POSES]" })
        else
            save_this_pose(id)
        end
    elseif msg == "[THIS POSE]" then
        save_this_pose(id)
    elseif msg == "Keys" and keys_menu() then
        -- [LS]commands takes (or gives back) the arrow keys; keep this menu open
        sendLinked(LINK_SET, 90100, tostring(SC) .. "|" .. msg .. "|" .. MY_SITTER .. "|" .. tostring(OLD_HELPER_METHOD), id)
        adjust_pose_menu()
    elseif index then
        if index <= 2 then
            pos_rot_adjust_toggle = not pos_rot_adjust_toggle
        elseif index <= 8 then
            nudge(string.sub(msg, 1, 1), if string.sub(msg, 2, 2) == "-" then -1 else 1)
            sit_using_prim_params()
        else
            increment_pointer = (increment_pointer + 1) % 3
        end
        adjust_pose_menu()
    elseif msg == "[HELPER]" and id ~= tostring(ll.GetOwner())
        and not contains(ll.GetLinkName(if ll.GetLinkNumber() ~= 0 then 1 else 0), "HELPER")
    then
        adj_dialog("Only the owner can rez the helpers. If the owner is nearby they can type '/5 helper' in chat.", { "[BACK]" })
    else
        -- 90100=menu choice
        sendLinked(LINK_SET, 90100, tostring(SC) .. "|" .. msg .. "|" .. MY_SITTER .. "|" .. tostring(OLD_HELPER_METHOD), id)
    end
end

-- pose menu (former sitB listener)
local function onMenuListen(id: string, msg: string)
    local channel = ""
    local index = find0(MENU_LIST, msg)
    if index == -1 then
        channel = tostring(SC)
        index = find0(MENU_LIST, "P:" .. msg)
    end
    if index ~= -1 then
        sendLinked(LINK_THIS, 90050, channel .. "|" .. msg .. "|" .. tostring(SET), MY_SITTER)
        sendLinked(LINK_THIS, 90000, msg, channel)
        if MTYPE ~= 2 and MTYPE ~= 4 then
            sendLinked(LINK_THIS, 90005, "", id .. "|" .. MY_SITTER)
        end
        return
    end
    index = find0(MENU_LIST, "M:" .. msg)
    if index ~= -1 then
        if table.find(MENU_LIST, "T:" .. msg) then -- security check: TOMENU must exist
            sendLinked(LINK_SET, 90051, channel .. "|" .. ll.GetSubString(msg, 1, -2) .. "|" .. tostring(SET), MY_SITTER)
            menu_page = 0
            last_menu = current_menu
            current_menu = index
            animation_menu(0)
        end
        return
    end
    index = -1
    for i = current_menu + 2, #MENU_LIST do
        if MENU_LIST[i] == "B:" .. msg then
            index = i - 1
            break
        end
    end
    if index ~= -1 then
        local button_data = split(at(DATA_LIST, index), SEP)
        if at(button_data, 1) ~= "" then
            msg = at(button_data, 1)
        end
        local n = int(at(button_data, 0))
        if #button_data > 2 then
            id = at(button_data, 2)
            if id == "<C>" then
                id = CONTROLLER
            end
            if id == "<S>" then
                id = MY_SITTER
            end
        elseif CONTROLLER ~= MY_SITTER then
            id = CONTROLLER .. "|" .. MY_SITTER
        end
        sendLinked(LINK_SET, n, msg, id)
        return
    end
    if msg == "[>>]" or msg == "[<<]" then
        if msg == "[<<]" then
            menu_page -= 1
            if menu_page == -1 then
                menu_page = animation_menu(1)
            end
        else
            menu_page += 1
            if menu_page > animation_menu(1) then
                menu_page = 0
            end
        end
        animation_menu(0)
    elseif msg == "[BACK]" then
        menu_page = 0
        if current_menu == -1 then
            if hasScript(select_script) then
                sendLinked(LINK_SET, 90009, "", id)
            end
            return
        end
        if last_menu ~= -1 then
            current_menu = last_menu
            last_menu = -1
        else
            current_menu = find0(MENU_LIST, "T:" .. ll.GetSubString(at(MENU_LIST, current_menu), 3, -1))
            if current_menu ~= -1 then
                current_menu -= 1
                while current_menu ~= -1 and not startsWith(at(MENU_LIST, current_menu), "M:") do
                    current_menu -= 1
                end
            end
        end
        animation_menu(0)
    elseif msg == RLV_BUTTON or msg == "Control..." or msg == "[STOP]" then
        if msg == RLV_BUTTON then
            msg = "Control..." -- the 90100 protocol name (LSL [AV]root-RLV understands it)
        end
        sendLinked(LINK_SET, 90100, table.concat({ tostring(SC), msg, MY_SITTER }, "|"), id)
    else
        sendLinked(LINK_SET, 90101, table.concat({ tostring(SC), msg, CONTROLLER }, "|"), MY_SITTER)
    end
end

LLEvents:on("listen", function(channel: number, _name: string, uid: uuid, msg: string)
    local id = tostring(uid)
    if channel == adj_channel and adj_channel ~= 0 then
        onAdjustListen(id, msg)
    elseif channel == menu_channel then
        onMenuListen(id, msg)
    end
end)

-- swap two sitters (90030); withMenu = 90032 (issue #140)
local function swapSitters(one: number, two: number, withMenu: boolean)
    if one == SC or two == SC then
        end_sitter()
        local other = at(SITTERS, one)
        if one == SC then
            other = at(SITTERS, two)
        end
        swapKey = other
        if isKey(other) then
            SWAPPED = true
            swapMenu = withMenu
            ll.RequestPermissions(K(other), PERMISSION_TRIGGER_ANIMATION)
        end
    end
    local t1 = SITTERS_SITTARGETS[one + 1]
    local t2 = SITTERS_SITTARGETS[two + 1]
    if t1 ~= nil and t2 ~= nil then
        SITTERS_SITTARGETS[one + 1] = t2
        SITTERS_SITTARGETS[two + 1] = t1
    end
    my_sittarget = SITTERS_SITTARGETS[SC + 1] or my_sittarget
    set_sittarget()
    if SITTERS[one + 1] ~= nil then
        SITTERS[one + 1] = ""
    end
    if SITTERS[two + 1] ~= nil then
        SITTERS[two + 1] = ""
    end
    MY_SITTER = at(SITTERS, SC)
    -- former sitB part
    if one == SC or two == SC then
        CONTROLLER = ""
        MY_SITTER = ""
    end
end

-- 90017: play the next (dir 1) or previous (dir -1) pose of the menu the current pose
-- is in, as if chosen from the menu (POSE and SYNC entries, wrapping around)
local function step_pose(dir: number)
    local s = math.max(ANIM_INDEX, 0)
    while s > 0 and not startsWith(at(MENU_LIST, s - 1), "M:") do
        s -= 1
    end
    local poses: { number } = {}
    local i = s
    while i < #MENU_LIST and not startsWith(at(MENU_LIST, i), "M:") do
        local prefix = string.sub(at(MENU_LIST, i), 1, 2)
        if prefix ~= "T:" and prefix ~= "B:" then
            table.insert(poses, i)
        end
        i += 1
    end
    if #poses == 0 then
        return
    end
    local here = table.find(poses, ANIM_INDEX)
    local target = if here then poses[(here - 1 + dir) % #poses + 1] else poses[1]
    local name = at(MENU_LIST, target)
    local channel = ""
    if startsWith(name, "P:") then
        name = ll.GetSubString(name, 3, -1)
        channel = tostring(SC)
    end
    sendLinked(LINK_THIS, 90050, channel .. "|" .. name .. "|" .. tostring(SET), MY_SITTER)
    sendLinked(LINK_THIS, 90000, name, channel)
end

local function onLinkMessage(sender: number, n: number, msg: string, id: string)
    local one = int(msg)
    local two = int(id)

    -- [LS]commands (chat commands / arrow keys) for this sitter
    if n == 90017 or n == 90018 then
        if isKey(MY_SITTER) and id == MY_SITTER then
            if n == 90017 then
                step_pose(if msg == "-1" then -1 else 1)
            else
                -- msg = the arrow keys pressed ("fwd|left"...). Position: up/down arrows = X,
                -- left/right = Y, PgUp/PgDn = Z. Rotation: left/right turn (Z), up/down tilt
                -- (Y), PgUp/PgDn roll (X). turnleft/turnright (Shift+Left/Right) always turn
                -- (Z). Axes of the object, as the X+ ... Z- buttons. Keys always use the
                -- smallest step (0.01 m, 1°), whatever the menu's step.
                local moves = if pos_rot_adjust_toggle
                    then { fwd = "Y+", back = "Y-", left = "Z+", right = "Z-", up = "X+", down = "X-" }
                    else { fwd = "X+", back = "X-", left = "Y+", right = "Y-", up = "Z+", down = "Z-" }
                for _, key in split(msg, "|") do
                    if key == "turnleft" or key == "turnright" then
                        nudge("Z", if key == "turnleft" then 1 else -1, 0.01, true)
                    else
                        local m = moves[key]
                        if m then
                            nudge(string.sub(m, 1, 1), if string.sub(m, 2, 2) == "-" then -1 else 1, 0.01)
                        end
                    end
                end
                sit_using_prim_params()
            end
        end
        return
    end

    ---------------------------------------------------------------- sitA part
    if n == 90075 then -- old-style helper asks to animate
        if one == SC then
            ll.RequestPermissions(K(id), PERMISSION_TRIGGER_ANIMATION)
        end
        return
    elseif n == 90076 then -- old-style helper stop animating
        release_sitter(one)
        return
    elseif n == 90030 or n == 90032 then -- swap sitters (90032: and give menu)
        swapSitters(one, two, n == 90032)
        return
    elseif n == 90070 then -- update SITTERS after permission granted
        if one ~= SC then
            if SITTERS[one + 1] ~= nil then
                SITTERS[one + 1] = id
            end
        else
            -- former sitB 90070
            CONTROLLER = id
            MY_SITTER = id
            menu_page = 0
            current_menu = -1
            menu_channel = randomChannel()
            ll.ListenRemove(menu_handle)
        end
        return
    elseif n == 90150 then -- place sit targets again
        sittargets()
        return
    elseif n == 90202 then -- security / RLV script present
        has_security = true
        ll.PassTouches(1)
        has_RLV = int(msg)
        return
    elseif n == 90201 then
        has_RLV = 0
        return
    elseif n == 90203 then -- a texture plugin is present (sent by third-party plugins; adds [TEXTURE])
        has_texture = true
        return
    elseif n == 90298 then -- show sit targets (/5 targets)
        local target = my_sittarget
        if ll.GetNumberOfPrims() == 1 and target == 1 then
            target = 0
        end
        ll.SetLinkPrimitiveParamsFast(target, { PRIM_TEXT, tostring(SET) .. "-" .. tostring(SC), vector(1, 1, 0), 1 })
        LLTimers:once(5, function()
            ll.SetLinkPrimitiveParamsFast(target, { PRIM_TEXT, "", vector(1, 1, 1), 1 })
        end)
        return
    elseif n == 90011 then -- set link camera
        ll.SetLinkCamera(LINK_THIS, vec(msg), vec(id))
        return
    elseif n == 90033 then -- clear menu listeners
        ll.ListenRemove(adj_handle)
        ll.ListenRemove(menu_handle)
        return
    end

    if MY_SITTER ~= "" and id == MY_SITTER then
        if (n == 90001 or n == 90002) and hasAnimPerm() then -- overlay animation start/stop
            if n == 90001 then
                startAnim(msg)
            else
                stopAnim(msg)
            end
        end
        if n == 90101 then -- menu option chosen
            local data = split(msg, "|")
            CONTROLLER = at(data, 2)
            local choice = at(data, 1)
            if choice == "[ADJUST]" then
                options_menu()
            elseif choice == "Harder >>" or choice == "<< Softer" then
                sendLinked(LINK_SET, 90005, "", CONTROLLER .. "|" .. MY_SITTER)
            elseif choice == "[SWAP]" then
                local target = SC + 1
                local x = table.clone(SITTERS)
                table.move(SITTERS, 1, #SITTERS, #x + 1, x)
                if not startsWith(CURRENT_POSE_NAME, "P:") then
                    while at(x, target) == "" and target + 1 < #x do
                        target += 1
                    end
                    if at(x, target) == MY_SITTER then
                        target += 1
                    end
                else
                    while at(x, target) ~= "" and target < #SITTERS + SC + 1 do
                        target += 1
                    end
                end
                target %= #SITTERS
                sendLinked(LINK_THIS, 90030, SC, target)
            end
        end
    end

    ---------------------------------------------------------------- sitB part
    if n == 90000 or n == 90010 or n == 90003 or n == 90008 then
        local index = find0(MENU_LIST, msg)
        if index == -1 then
            index = find0(MENU_LIST, "P:" .. msg)
            -- if it's a POSE entry, don't treat it specially
            if index ~= -1 and n == 90008 then
                n = 90000
            end
        end
        if not isKey(id) and id ~= "" then
            id = "*" -- assumed numeric
        end
        if (id == "" or id == MY_SITTER or (id == "*" and two == SC) or n == 90008) and (index ~= -1 or msg == "") then
            ANIM_INDEX = index
            send_anim_info(true)
            return
        end
        if ETYPE == 2 and n ~= 90010 and not startsWith(at(MENU_LIST, ANIM_INDEX), "P:") and MY_SITTER ~= "" then
            ll.UnSit(K(MY_SITTER))
        end
        return
    elseif n == 90045 then
        if sender == ll.GetLinkNumber() and (ETYPE == 1 or ETYPE == 2) then
            local old_sync = at(split(msg, "|"), 5)
            if old_sync ~= "" and at(MENU_LIST, ANIM_INDEX) == old_sync then
                ANIM_INDEX = FIRST_INDEX
                send_anim_info(true)
            end
        end
        return
    elseif n == 90004 or n == 90005 then
        local data = split(id, "|")
        if MY_SITTER ~= "" and at(data, -1) == MY_SITTER then
            CONTROLLER = at(data, 0)
            local index = find0(MENU_LIST, "M:" .. msg .. "*")
            if n == 90004 then
                current_menu = -1
                menu_page = 0
            elseif index ~= -1 then
                last_menu = -1
                menu_page = 0
                current_menu = index
                msg = ""
            end
            animation_menu(int(msg))
        end
        return
    elseif n == 90100 or n == 90101 then
        local data = split(msg, "|")
        local choice = at(data, 1)
        if choice == "[HELPER]" then
            menu_page = 0
            helper_mode = not helper_mode
            if at(data, 2) == MY_SITTER and OLD_HELPER_METHOD == 0 then
                animation_menu(0)
            end
        elseif choice == "[ADJUST]" then
            helper_mode = false
            menu_page = 0
        elseif choice == "Harder >>" then
            speed_index = math.min(speed_index + 1, 1)
            send_anim_info(false)
        elseif choice == "<< Softer" then
            speed_index = math.max(speed_index - 1, -1)
            send_anim_info(false)
        end
        return
    end

    if one == SC then
        local data = split(id, "|")
        if n == 90065 and sender == ll.GetLinkNumber() then
            CONTROLLER = ""
            MY_SITTER = ""
            ll.ListenRemove(menu_handle)
        elseif n == 90300 then -- add menu item (from [LS]adjuster)
            addMenuItem(data)
        elseif n == 90301 then -- update position (from [LS]adjuster)
            updatePosRot(data)
        elseif n == 90172 then -- [LS]adjuster added an ANIM (face) line for this sitter
            has_faces = true
        elseif n == 90020 and at(data, 0) == "" then -- DUMP
            dump()
        elseif n == 90057 then -- helper moved
            CURRENT_POSITION = vec(at(data, 0))
            CURRENT_ROTATION = vec(at(data, 1))
            sit_using_prim_params()
        end
    end
end
LLEvents:on("link_message", onLinkMessage)

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_LINK) ~= 0 then
        SWAPPED = false
        local stood = false
        if SET == -1 and #SITTERS > 1 then
            local avprims = {}
            local i = ll.GetNumberOfPrims()
            while ll.GetAgentSize(ll.GetLinkKey(i)) ~= ZERO_VECTOR do
                local k = tostring(ll.GetLinkKey(i))
                if not table.find(SITTERS, k) then
                    local gender = bodyShape(k)
                    local first_available = find0(SITTERS, "")
                    local first_unassigned = -1
                    local matched = false
                    for j = 0, #SITTERS - 1 do
                        if at(SITTERS, j) == "" then
                            local g = GENDERS[j + 1] or 0
                            if g == gender then
                                first_available = j
                                matched = true
                                break
                            end
                            if g == -1 and first_unassigned == -1 then
                                first_unassigned = j
                            end
                        end
                    end
                    if not matched and first_unassigned > first_available then
                        first_available = first_unassigned
                    end
                    if first_available == SC then
                        applyGenderPose(gender)
                        ll.RequestPermissions(K(k), PERMISSION_TRIGGER_ANIMATION)
                        sendLinked(LINK_SET, 90060, SC, k) -- 90060=new sitter
                    else
                        sendSitInfo()
                    end
                end
                table.insert(avprims, k)
                i -= 1
            end
            for s = 0, #SITTERS - 1 do
                local sk = at(SITTERS, s)
                if sk ~= "" and not table.find(avprims, sk) then
                    setSequenceTimer(0)
                    stood = true
                    SITTERS[s + 1] = ""
                    if s == SC and hasAnimPerm() then
                        if isKey(MY_SITTER) then
                            sendLinked(LINK_SET, 90065, SC, MY_SITTER) -- 90065=sitter gone
                        end
                        -- FIX: upstream tested (integer)CURRENT_ANIMATION_FILENAME here
                        if agentPresent(MY_SITTER) and CURRENT_ANIMATION_FILENAME ~= "" then
                            stopAnim(CURRENT_ANIMATION_FILENAME)
                        end
                        MY_SITTER = ""
                        ll.ListenRemove(adj_handle)
                    end
                end
            end
        else
            for s = 0, #SITTERS - 1 do
                local existing = at(SITTERS, s)
                local actual = tostring(ll.AvatarOnLinkSitTarget(SITTERS_SITTARGETS[s + 1] or 0))
                if #SITTERS == 1 then
                    actual = tostring(ll.AvatarOnSitTarget())
                end
                if existing ~= "" then
                    if actual == NULL then
                        setSequenceTimer(0)
                        stood = true
                        release_sitter(s)
                    end
                elseif isKey(actual) then
                    if s == SC then
                        applyGenderPose(bodyShape(actual))
                        ll.RequestPermissions(K(actual), PERMISSION_TRIGGER_ANIMATION)
                        sendLinked(LINK_SET, 90060, SC, actual) -- 90060=new sitter
                    else
                        sendSitInfo()
                    end
                end
            end
        end
        if stood and table.concat(SITTERS) == "" then
            if DFLT ~= 0 or not contains(CURRENT_POSE_NAME, "P:") then
                DEFAULT_POSITION = FIRST_POSITION
                DEFAULT_ROTATION = FIRST_ROTATION
                CURRENT_POSE_NAME = FIRST_POSENAME
                CURRENT_ANIMATION_SEQUENCE = FIRST_ANIMATION_SEQUENCE
                my_sittarget = original_my_sittarget
                SITTERS_SITTARGETS = table.clone(ORIGINAL_SITTERS_SITTARGETS)
                set_sittarget()
            end
            prep()
        end
        if prims ~= ll.GetObjectPrimCount(ll.GetKey()) then
            if SC == 0 then
                wipe_sit_targets()
                sendLinked(LINK_SET, 90150, "", "")
            end
            prep()
        end
        -- former sitB part
        if ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) == ZERO_VECTOR then
            speed_index = 0
            if OLD_HELPER_METHOD == 0 then
                helper_mode = false
            end
            MY_SITTER = ""
            ANIM_INDEX = FIRST_INDEX
        elseif OLD_HELPER_METHOD ~= 0 then
            helper_mode = false
        end
    end
    if bit32.band(change, CHANGED_INVENTORY) ~= 0 then
        local per_sitter = if SC ~= 0 then posCard(SC) else ""
        local per_sitter_key = ""
        if per_sitter ~= "" and ll.GetInventoryType(per_sitter) == INVENTORY_NOTECARD then
            per_sitter_key = per_sitter .. tostring(ll.GetInventoryKey(per_sitter))
        end
        if posCard() ~= notecard_name
            or tostring(ll.GetInventoryKey(notecard_name)) ~= notecard_key
            or per_sitter_key ~= sitter_notecard_key
            or getNumberOfScripts() ~= #SITTERS
        then
            end_sitter()
            ll.ResetScript()
        end
    end
end)

LLEvents:on("run_time_permissions", function(perm: number)
    if bit32.band(perm, PERMISSION_TRIGGER_ANIMATION) == 0 then
        return
    end
    stopAnim("sit")
    -- hip fix animation: "LShipfix" (LuaSitter name), else "AVhipfix" (AVsitter name)
    for _, hipfix in { "LShipfix", "AVhipfix" } do
        if ll.GetInventoryType(hipfix) == INVENTORY_ANIMATION then
            startAnim(hipfix)
            break
        end
    end
    local permKey = tostring(ll.GetPermissionsKey())
    local animation_menu_function = 0
    if permKey ~= swapKey then
        animation_menu_function = -1
    end
    swapKey = ""
    MY_SITTER = permKey
    CONTROLLER = permKey
    SITTERS[SC + 1] = permKey
    local channel_or_swap = tostring(SC)
    local lnk = 90000 -- play pose
    local wasSwap = SWAPPED
    local giveMenu = swapMenu
    swapMenu = false
    if SWAPPED then
        lnk = 90010 -- play pose, ignoring ETYPE
        SWAPPED = false
    elseif not startsWith(CURRENT_POSE_NAME, "P:") then
        channel_or_swap = ""
    end
    local posename = CURRENT_POSE_NAME
    if startsWith(posename, "P:") then
        posename = ll.GetSubString(posename, 3, -1)
    end
    sendLinked(LINK_THIS, 90070, SC, MY_SITTER) -- 90070=update SITTERS after permissions granted
    sendLinked(LINK_THIS, lnk, posename, channel_or_swap)
    if wrong_primcount and WARN ~= 0 then
        primcount_error()
    elseif MTYPE == 0 then
        if has_security then
            sendLinked(LINK_SET, 90006, animation_menu_function, MY_SITTER)
        else
            sendLinked(LINK_SET, 90005, animation_menu_function, CONTROLLER .. "|" .. MY_SITTER)
        end
    elseif wasSwap and giveMenu then
        -- 90032: swapped sitters get their menu back even when MTYPE hides it on sit
        sendLinked(LINK_SET, 90005, "", CONTROLLER .. "|" .. MY_SITTER)
    end
end)

--------------------------------------------------------------------------------
-- start (former state_entry)
--------------------------------------------------------------------------------
local function start()
    for _ = 1, getNumberOfScripts() do
        table.insert(SITTERS, "")
    end
    if SC ~= 0 then
        local per_sitter = posCard(SC)
        if ll.GetInventoryType(per_sitter) == INVENTORY_NOTECARD then
            sitter_notecard = per_sitter
            sitter_notecard_key = per_sitter .. tostring(ll.GetInventoryKey(per_sitter))
        end
    else
        wipe_sit_targets()
        reading_notecard_section = true
    end
    notecard_key = tostring(ll.GetInventoryKey(notecard_name))
    if ll.GetInventoryType(notecard_name) ~= INVENTORY_NOTECARD then
        return
    end
    if SC == 0 then
        print(scriptName .. "[" .. version .. "] Loading " .. notecard_name .. "...")
        -- line count only matters for the progress text while the async fallback is used
        local linesQuery = ll.GetNumberOfNotecardLines(notecard_name)
        local h: any
        h = LLEvents:on("dataserver", function(qid: uuid, data: string)
            if qid == linesQuery then
                notecard_lines = int(data)
                LLEvents:off("dataserver", h)
            end
        end)
    end
    readNotecard(notecard_name, function(line: string, lineNo: number)
        if SC == 0 and notecard_lines > 0 and lineNo % 25 == 0 then
            ll.SetText("Loading " .. tostring(lineNo * 100 // notecard_lines) .. "%", vector(1, 1, 0), 1)
        end
        parseLine(line, false)
    end, function()
        readSitterNotecard()
    end)
end

start()
