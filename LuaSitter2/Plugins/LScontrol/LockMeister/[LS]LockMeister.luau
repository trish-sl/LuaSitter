--[[
  [LS]LockMeister - Creates LockMeister V1/V2 chains
  LuaSitter: SLua port of AVsitter(TM) [AV]LockMeister. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  For use attaching particle chains to LockMeister V1/V2 compatible cuffs such
  as Open Collar & KDC. Place this script inside the prim that contains your
  poses and props.
  Based on http://wiki.secondlife.com/wiki/LSL_Protocol/LockMeister_System#Advanced_Furniture_Script

  LockGuard and LockMeister are different chain protocols; use the plugin that
  matches your cuffs (they are deliberately not merged).

  Changes from the LSL
  --------------------
    - POSES is a Lua table keyed by pose name (edit it the same way).
    - FIX: the chains were not cleared on 90032 (swap sitters and return the
      menu, issue #140), only on 90030.
]]

--  SITTER:
--      The SITTER # the chain settings are for.

local SITTER = 0

--[[
POSES
      - specifies which cuffs to chain to which prims for each POSE or SYNC (these correspond to
        menu names of your poses, not animation file names!).
        e.g: ["Pose2"] = "lcuff, ring1, rcuff, ring2"
      - When the POSE "Pose2" is played, this will draw a chain from the prim named "ring1" to the
        "left wrist cuff" (lcuff) and the prim named "ring2" to the right wrist cuff (rcuff).
        The chain emitter prims in the furniture should be named (e.g. "ring1" and "ring2").
      - See http://wiki.secondlife.com/wiki/LSL_Protocol/LockMeister_System#Complete_List_of_Mooring_Points
        for a list of standard LockMeister targets and more information.
      - A pose name of "*" provides a default for all poses, should that be necessary.
]]
local POSES: {[string]: string} = {
    ["cross"] = "rcuff,ring1,lcuff,ring2,rlcuff,ring3,llcuff,ring4",
    ["reverse"] = "rcuff,ring2,lcuff,ring1,rlcuff,ring4,llcuff,ring3",
    ["arms"] = "rcuff,ring1,lcuff,ring2",
    ["upside"] = "llcuff,ring1,rlcuff,ring2",
}

local function SetChain(target: uuid, link_id: number)
    ll.LinkParticleSystem(link_id, {
        -- This is where you can customize your chain appearance.
        PSYS_PART_FLAGS, bit32.bor(PSYS_PART_FOLLOW_SRC_MASK, PSYS_PART_FOLLOW_VELOCITY_MASK, PSYS_PART_TARGET_POS_MASK),
        PSYS_SRC_PATTERN, PSYS_SRC_PATTERN_DROP,
        PSYS_PART_START_SCALE, vector(0.1, 0.1, 0),
        PSYS_PART_MAX_AGE, 3.0,
        PSYS_SRC_BURST_RATE, 0.02,
        PSYS_SRC_TEXTURE, "d7277e78-06f4-58ae-9f7c-7499e50de18a",
        PSYS_SRC_BURST_SPEED_MIN, 0,
        PSYS_SRC_BURST_SPEED_MAX, 0,
        PSYS_SRC_TARGET_KEY, target,
        PSYS_SRC_BURST_PART_COUNT, 1,
        PSYS_SRC_ACCEL, vector(0, 0, -0.3),
    })
end

---------------------------------------------------------------------------
local lm_channel = -8888
local TIMEOUT = 10 -- How long do we wait for a reply before closing communications.
local NULL = tostring(NULL_KEY)

type Emitter = { link: number, lmcode: string, state: number } -- state 0 none, 1 lmv1 ok, 2 lmv2 ok
local emitters: {Emitter} = {}
local emitter_v2_count = 0
local lm_handle: number? = nil
local avatar = NULL
local timer: any = nil

local function int(v: any): number
    return tonumber(string.match(tostring(v or ""), "^%s*([-+]?%d+)")) or 0
end

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

local function isKey(s: string?): boolean
    return s ~= nil and s ~= "" and s ~= NULL and touuid(s) ~= nil
end

local function closeListen()
    if lm_handle then
        ll.ListenRemove(lm_handle)
        lm_handle = nil
    end
    if timer then
        LLTimers:off(timer)
        timer = nil
    end
end

-- llSetTimerEvent(TIMEOUT): close the listener when nothing answers any more
-- (the LockMeister channel can be busy).
local function extendTimeout()
    if timer then
        LLTimers:off(timer)
    end
    timer = LLTimers:once(TIMEOUT, function()
        timer = nil
        closeListen()
    end)
end

local function findEmitter(lmcode: string): Emitter?
    for _, e in emitters do
        if e.lmcode == lmcode then
            return e
        end
    end
    return nil
end

local function ClearChains()
    closeListen()
    for i = #emitters, 1, -1 do
        ll.LinkParticleSystem(emitters[i].link, {})
    end
    avatar = NULL
    emitters = {}
    emitter_v2_count = 0
end

LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if sender ~= ll.GetLinkNumber() then
        return
    end

    if num == 90030 or num == 90032 then
        -- FIX: also on 90032. A swap that involves SITTER clears all drawn chains.
        if SITTER == int(msg) or SITTER == int(id) then
            if isKey(avatar) then
                ClearChains()
            end
        end
    elseif num == 90065 then
        -- our user stood up: clear all drawn chains
        if id ~= avatar then
            return
        end
        ClearChains()
    elseif num == 90045 then
        -- a pose was played: clear the old chains, draw new ones if the pose is in POSES
        if SITTER ~= int(msg) then -- msg: sitter|pose|...
            return
        end
        local pose = ll.ParseString2List(msg, {"|"}, {})[2] or ""

        if isKey(avatar) then
            ClearChains()
        end
        avatar = id

        -- no entry for this pose: use the wildcard (*) pose
        local chains = POSES[pose] or POSES["*"]
        if not chains then
            return
        end

        if not lm_handle then
            lm_handle = ll.Listen(lm_channel, "", NULL_KEY, "")
        end
        extendTimeout()

        local data = ll.CSV2List(chains)
        local prim_count = ll.GetObjectPrimCount(ll.GetKey())
        local avatar_key = K(avatar)
        local link_names: {[number]: string} = {} -- looked up once per pose
        for i = 1, #data, 2 do
            local lm_target = data[i]
            local prim_name = data[i + 1] or ""
            -- link number of the first prim whose name contains prim_name (highest link number first)
            for link_id = prim_count, 1, -1 do
                local link_name = link_names[link_id]
                if not link_name then
                    link_name = ll.GetLinkName(link_id)
                    link_names[link_id] = link_name
                end
                if string.find(link_name, prim_name, 1, true) then
                    table.insert(emitters, { link = link_id, lmcode = lm_target, state = 0 })
                    ll.RegionSayTo(avatar_key, lm_channel, avatar .. lm_target)
                    break
                end
            end
        end
    end
end)

LLEvents:on("listen", function(_channel: number, _name: string, id: uuid, msg: string)
    if avatar == NULL then -- We must have a user.
        return
    end
    if tostring(ll.GetOwnerKey(id)) ~= avatar then -- Attachment must belong to user.
        return
    end
    if ll.GetSubString(msg, 1, 36) ~= avatar then -- Target key must be our user.
        return
    end

    if ll.GetSubString(msg, -3, -1) == " ok" then -- lmv1 ' ok' received
        -- LMV1 Message structure:
        -- Request -> AVATAR_UUIDlmcode
        -- Reply   -> AVATAR_UUIDlmcode ok
        local lm_target = ll.GetSubString(msg, 37, -4) -- strip the target key and " ok"
        local e = findEmitter(lm_target)
        if not e then -- No emitter configured for this lm code.
            return
        end
        if e.state ~= 0 then -- This point already has an lmv1 or lmv2 target.
            return
        end
        SetChain(id, e.link) -- Draw the chain.
        e.state = 1 -- lmv1 ok
        -- Request a (possible) LMV2 and extend the time objects have to reply.
        ll.RegionSayTo(id, lm_channel, avatar .. "|LMV2|RequestPoint|" .. lm_target)
        extendTimeout()
    else
        -- LMV2 Message structure:
        -- Request -> AVATAR_UUID|LMV2|RequestPoint|lmcode
        -- Reply   -> AVATAR_UUID|LMV2|ReplyPoint|lmcode|TARGET_UUID
        local commands = ll.ParseString2List(msg, {"|"}, {})
        if commands[1] ~= avatar then -- Message doesn't target our user.
            return
        end
        if commands[2] ~= "LMV2" or commands[3] ~= "ReplyPoint" then -- Wrong header/command.
            return
        end
        local e = findEmitter(commands[4] or "")
        if not e then -- No emitter configured for this lm code.
            return
        end
        if e.state == 2 then -- This point already has an lmv2 target.
            return
        end
        local target_id = commands[5]
        if not isKey(target_id) then -- Bail out if the target key is invalid.
            return
        end
        SetChain(K(target_id), e.link) -- Update the chain.
        e.state = 2 -- lmv2 ok

        -- close the listener as soon as every anchor has an LMV2 target
        emitter_v2_count += 1
        if emitter_v2_count >= #emitters then
            closeListen()
            return
        end
        extendTimeout() -- extend the time objects have to reply.
    end
end)
