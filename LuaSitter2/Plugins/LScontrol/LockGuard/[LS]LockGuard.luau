--[[
  [LS]LockGuard - Attach LockGuard V2 chains
  LuaSitter: SLua port of AVsitter(TM) [AV]LockGuard. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  For use attaching particle chains to LockGuard V2 compatible cuffs such as
  Open Collar. Place this script inside the prim that contains your poses and
  props. Inspiration and function (not code) from the Bright CISS system by
  Shan Bright & Innula Zenovka.

  LockGuard and LockMeister are different chain protocols; use the plugin that
  matches your cuffs (they are deliberately not merged).

  Changes from the LSL
  --------------------
    - POSES is a Lua table keyed by pose name (edit it the same way).
    - FIX: with USES_PROPS the chains were sent twice per pose change.
    - FIX: the ring search also matched sitting avatars whose name contains
      "ring" (avatars are part of the link set); avatars are now skipped.
]]

--  SITTER:
--      The SITTER # the chain settings are for.
--      -> You can use -1 to mean all sitters, but that will mean that the very same
--         chain settings and pose list will be applied to all at the same time. If
--         you don't want that, then you need to add one script per sitter.

local SITTER = 0

--  USES_PROPS:
--      - true for ring prims within props
--      - false for ring prims linked to furniture
--      - If you're using props, you must include the "[LS]LockGuard-object" script in your props
--        and ring prim names must contain the substring "ring". Each pose can only have 1 prop
--        for all the rings (e.g. the ring prop for each pose should be 1 linked object, not
--        separate props of individual rings).
--  NOTE:
--      - Most builds should use USES_PROPS = false
--      - USES_PROPS should only be used for specific cases. e.g. if the prop completely changes the
--        surrounding scene which the chains attach to. If you want the LockGuard rings rezzed all the
--        time then they should be permanently linked to the furniture and not approached with props.

local USES_PROPS = false

--  POSES
--      - specifies which cuffs to chain to which prims for each POSE or SYNC (these correspond to
--        menu names of your poses, not animation file names!).
--        e.g: ["Pose2"] = "leftwrist, ring1, rightwrist, ring2"
--      - When the POSE "Pose2" is played, this will chain the "leftwrist" cuff to the prim hook named
--        "ring1" and the "rightwrist" cuff to the prim hook named "ring2". The hook prims in the
--        furniture should be named (e.g. "ring1" and "ring2").
--      - See http://www.lslwiki.net/lslwiki/wakka.php?wakka=exchangeLockGuardItem
--        for a list of LockGuard V2 Standard ID Tags and more information.
--      - A pose name of "*" provides a default for all poses, should that be necessary.

local POSES: {[string]: string} = {
    ["cross"] = "rightwrist,ring1,leftwrist,ring2,rightankle,ring3,leftankle,ring4",
    ["reverse"] = "rightwrist,ring2,leftwrist,ring1,rightankle,ring4,leftankle,ring3",
    ["arms"] = "rightwrist,ring1,leftwrist,ring2",
    ["upside"] = "rightwrist,ring2,leftwrist,ring1,leftankle,ring1,rightankle,ring2",
}

--  CHAIN_PARAMETERS:
--      - For information on parameters see http://www.lslwiki.net/lslwiki/wakka.php?wakka=exchangeLockGuard
--      - Specifies any special LockGuard commands. If you do not specify any then the particle will
--        use the cuff default. Common used parameters are "gravity g", "life secs",
--        "color red green blue", "size x y", "texture uuid".
--        e.g. "color 1 0 0 texture 6808199d-e4c8-22f9-cf8a-2d9992ab630d" will bind with red ropes.

local CHAIN_PARAMETERS = "size 0.12 0.12 life 1 gravity 0.3 texture d7277e78-06f4-58ae-9f7c-7499e50de18a"
--                       "size 0.12 0.12 life 1 gravity 0.3 texture 245ea72d-bc79-fee3-a802-8e73c0f09473"
--                       "size 0.12 0.12 life 1.2 gravity 0 texture d7277e78-06f4-58ae-9f7c-7499e50de18a"

---------------------------------------------------------------------------
local LOCKGUARD_CHANNEL = -9119
local COMM_CHANNEL = -57841689
local NULL = tostring(NULL_KEY)
local comm_handle = 0
local avatar = NULL
local links: {string} = {} -- strided: cuff, ring, cuff, ring...
local ring_prims: {string} = {} -- strided: ring prim name, ring prim key...

local function int(v: any): number
    return tonumber(string.match(tostring(v or ""), "^%s*([-+]?%d+)")) or 0
end

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

-- key of the first ring prim with that name
local function ringKey(name: string): string?
    for i = 1, #ring_prims - 1, 2 do
        if ring_prims[i] == name then
            return ring_prims[i + 1]
        end
    end
    return nil
end

local function goChain(new_links: {string})
    -- unlink unused links
    for i = 1, #links, 2 do
        if not table.find(new_links, links[i]) then
            ll.Whisper(LOCKGUARD_CHANNEL, "lockguard " .. avatar .. " " .. links[i] .. " unlink")
        end
    end
    -- link new links
    for i = 1, #new_links, 2 do
        local key = ringKey(new_links[i + 1] or "")
        if key then
            ll.Whisper(LOCKGUARD_CHANNEL, "lockguard " .. avatar .. " " .. new_links[i] .. " link " .. key .. " " .. CHAIN_PARAMETERS)
        end
    end
    links = new_links
end

local function findPrimsWithSubstring(name: string): {string}
    local found = {}
    local index = if ll.GetLinkNumber() ~= 0 then 1 else 0
    local number = ll.GetNumberOfPrims() + index
    while index <= number do
        local key = ll.GetLinkKey(index)
        -- FIX: skip sitting avatars (they are link numbers too)
        if ll.GetAgentSize(key) == ZERO_VECTOR and string.find(ll.ToLower(ll.GetLinkName(index)), name, 1, true) then
            table.insert(found, ll.GetLinkName(index))
            table.insert(found, tostring(key))
        end
        index += 1
    end
    return found
end

LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if sender ~= ll.GetLinkNumber() then
        return
    end

    if num == 90500 and USES_PROPS then
        local data = ll.ParseStringKeepNulls(msg, {"|"}, {})
        local SITTER_NUMBER = int(data[2])
        if SITTER_NUMBER == SITTER or SITTER == -1 then
            avatar = id
            local EVENT = data[1] or ""
            local PROP_OBJECT = data[4] or ""
            local PROP_UUID = data[6] or ""
            if EVENT == "REZ" then
                ll.ListenRemove(comm_handle)
                comm_handle = ll.Listen(COMM_CHANNEL, PROP_OBJECT, K(PROP_UUID), "")
                ll.RegionSayTo(K(PROP_UUID), COMM_CHANNEL, "INFORM")
            end
        end
    elseif num == 90065 then -- stands up
        if id == avatar then
            goChain({})
            avatar = NULL
        end
    elseif num == 90045 then -- animation played
        local data = ll.ParseString2List(msg, {"|"}, {})
        if int(data[1]) == SITTER or SITTER == -1 then
            if id ~= avatar then
                goChain({})
            end
            avatar = id
            local POSE_NAME = data[2] or ""
            local new_links: {string} = {}
            local chains = POSES[POSE_NAME] or POSES["*"]
            if chains then
                new_links = ll.CSV2List(chains)
            end
            if not USES_PROPS then
                ring_prims = findPrimsWithSubstring("ring")
            end
            goChain(new_links)
        elseif id == avatar then
            goChain({})
            avatar = NULL
        end
    end
end)

LLEvents:on("listen", function(_channel: number, _name: string, _id: uuid, msg: string)
    local data = ll.ParseString2List(msg, {"|"}, {})
    if data[1] ~= "ATTACHPOINTS" then
        return
    end
    table.remove(data, 1)
    ring_prims = data
    goChain(links)
end)
