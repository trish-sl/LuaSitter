--[[
  [LS]chains - LockGuard V2 and LockMeister chains set up by notecard, with on/off
  LuaSitter plugin (new). Its chain logic comes from [LS]LockGuard and
  [LS]LockMeister (SLua ports of AVsitter(TM) [AV]LockGuard and [AV]LockMeister,
  derived from the AVsitter source code).
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors

  What it does
  ------------
  Optional. Put it in the prim with the [LS]sit scripts, with a notecard
  "[LS]chains_settings". One copy handles every sitter, with LockGuard V2
  cuffs (whispers on -9119) or LockMeister V1/V2 cuffs (-8888, particles drawn
  from the ring prim). Without the notecard it does nothing (one hint to the
  owner). Full guide: docs/luasitter/chains.md.

  Notecard lines (lines starting with # or //, and text after //, are comments):
      STYLE lockguard|<LockGuard parameters>   e.g. size 0.08 0.08 life 0.6 gravity 0.6 texture <uuid>
      STYLE lockmeister|<particle settings>    size x y, life s, gravity g, color r g b, texture t
          The first STYLE line also sets the protocol of CHAIN lines that don't name one
          (lockguard when there is no STYLE line).
      CHAIN <pose>|<sitter>|<cuff>,<ring>,<cuff>,<ring>...[|lockguard|lockmeister]
          pose or sitter * = any. Lookup: pose|sitter, pose|*, *|sitter, *|*.
          An empty list (or "none") means no chains for that pose.
      TOGGLE <on>|<off>[|<toggle>]   extra link numbers (e.g. 98|99 of older products)
      PROPS 1                        LockGuard rings may be in props ([LS]LockGuard-object)

  On / off
  --------
  90240 chains on, 90241 off, 90242 toggle, plus the TOGGLE numbers, accepted
  from any prim (menus may be elsewhere), e.g. "BUTTON Chains|90242" in AVpos.
  On/off is per avatar: the id of the message names the sitter (a key, or
  "controller|sitter" as [LS]sit sends for BUTTON); any other id (empty, a
  key of someone not chained here) switches every sitter. On chains the
  current pose at once; while off the sitter and pose are still tracked.
  Everyone starts "on"; an avatar who stands up is "on" again next time.

  Ring prims: the prim named exactly like the ring, else the first prim whose
  name contains it (lowest link number). Sitting avatars are never rings.
  LockMeister draws the chain from the ring prim, so a ring prim draws one
  chain at a time: when two sitters' poses use the same LockMeister ring, the
  last pose played gets it.

  Differences from [LS]LockGuard / [LS]LockMeister (which are unchanged)
  ----------------------------------------------------------------------
    - Settings in a notecard, all sitters in one script, both protocols.
    - LockMeister: only the prims the sitter's chains use are cleared; a ring
      prim taken by another sitter is not cleared by the first one.
    - With PROPS, rings of the sitter's own prop are used first, then any
      prop, then linked prims; DEREZ forgets a prop's rings.
  Do not use [LS]chains together with [LS]LockGuard / [LS]LockMeister for the
  same cuffs (it warns the owner when they are in the same prim).

  Link messages: receives 90030, 90032, 90045, 90065, 90500 (from its own
  prim) and 90240, 90241, 90242 (+ TOGGLE numbers) from any prim; sends none.
]]

local CARD = "[LS]chains_settings"
local LOCKGUARD_CHANNEL = -9119
local COMM_CHANNEL = -57841689 -- [LS]LockGuard-object
local LM_CHANNEL = -8888
local LM_TIMEOUT = 10 -- close the LockMeister listen when nothing answers anymore
local PROP_TIMEOUT = 30 -- stop waiting for a prop's ATTACHPOINTS
local MAX_REPORT = 8 -- notecard problems told to the owner per load
local NULL = tostring(NULL_KEY)
local LG_DEFAULT = "size 0.12 0.12 life 1 gravity 0.3 texture d7277e78-06f4-58ae-9f7c-7499e50de18a" -- as [LS]LockGuard
local LM_TEXTURE = "d7277e78-06f4-58ae-9f7c-7499e50de18a"

local function int(v: any): number
    return tonumber(string.match(tostring(v or ""), "^%s*([-+]?%d+)")) or 0
end

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

local function isKey(s: string?): boolean
    return s ~= nil and s ~= "" and s ~= NULL and touuid(s) ~= nil
end

local function trim(s: string?): string
    return ll.StringTrim(s or "", STRING_TRIM)
end

--------------------------------------------------------------------------
-- settings (from the notecard)
--------------------------------------------------------------------------
type Chain = { links: {string}, lm: boolean, line: number } -- links strided: cuff, ring...
local CHAINS: {[string]: Chain} = {} -- "pose|sitter" -> chain
local CHAIN_ORDER: {Chain} = {}
local lg_params = LG_DEFAULT
local lm_size = vector(0.1, 0.1, 0)
local lm_life = 3.0
local lm_gravity = 0.3
local lm_color = vector(1, 1, 1)
local lm_texture = LM_TEXTURE
local default_lm = false
local style_seen = false
local props_mode = false
local BUILTIN_TOGGLES: {[number]: number} = { [90240] = 1, [90241] = 0, [90242] = 2 } -- 1 on, 0 off, 2 toggle
local TOGGLES: {[number]: number} = table.clone(BUILTIN_TOGGLES)
local ready = false -- a notecard has been read
local load_id = 0
local card_sig = ""
type Problem = { line: number, text: string }
local problems: {Problem} = {}

--------------------------------------------------------------------------
-- state
--------------------------------------------------------------------------
type Emitter = { link: number, lmcode: string, state: number } -- state 0 asked, 1 lmv1 ok, 2 lmv2 ok
type Seat = { sc: number, avatar: string, pose: string, lg: {string}, lm: {Emitter} }
local seats: {[number]: Seat} = {} -- by sitter number
local off: {[string]: boolean} = {} -- avatars who switched their chains off
type Prop = { sitter: number, rings: {[string]: string} }
local props: {[string]: Prop} = {} -- by prop key
local prop_listens: {[string]: number} = {}
local lm_handle: number? = nil
local lm_timer: any = nil

local function seatList(): {Seat}
    local list = {}
    for _, s in seats do
        table.insert(list, s)
    end
    table.sort(list, function(a, b)
        return a.sc < b.sc
    end)
    return list
end

--------------------------------------------------------------------------
-- ring prims
--------------------------------------------------------------------------
type Scan = { names: {string}, links: {number} }

-- the prims of the linkset (not the sitting avatars), lowest link first
local function scanPrims(): Scan
    local scan: Scan = { names = {}, links = {} }
    local count = ll.GetObjectPrimCount(ll.GetKey())
    local first = if count > 1 then 1 else 0
    local last = if count > 1 then count else 0
    for link = first, last do
        -- FIX (as in [LS]LockGuard): sitting avatars are never ring prims
        if ll.GetAgentSize(ll.GetLinkKey(link)) == ZERO_VECTOR then
            table.insert(scan.names, ll.GetLinkName(link))
            table.insert(scan.links, link)
        end
    end
    return scan
end

-- link number of a ring: exact name first, else the first name that contains it
local function findRing(scan: Scan, name: string): number?
    if name == "" then
        return nil
    end
    local i = table.find(scan.names, name)
    if i then
        return scan.links[i]
    end
    for j, n in scan.names do
        if string.find(n, name, 1, true) then
            return scan.links[j]
        end
    end
    return nil
end

-- key of a LockGuard ring for a sitter: own prop, any prop (PROPS 1), then linked prims
local function lgRing(scan: Scan, sc: number, name: string): string?
    if props_mode then
        for _, p in props do
            if p.sitter == sc and p.rings[name] then
                return p.rings[name]
            end
        end
        for _, p in props do
            if p.rings[name] then
                return p.rings[name]
            end
        end
    end
    local link = findRing(scan, name)
    if link then
        return tostring(ll.GetLinkKey(link))
    end
    return nil
end

--------------------------------------------------------------------------
-- LockGuard
--------------------------------------------------------------------------
local function lgChain(seat: Seat, want: {string})
    -- unlink the cuffs the new chains don't use
    for i = 1, #seat.lg, 2 do
        local keep = false
        for j = 1, #want, 2 do
            if want[j] == seat.lg[i] then
                keep = true
                break
            end
        end
        if not keep then
            ll.Whisper(LOCKGUARD_CHANNEL, "lockguard " .. seat.avatar .. " " .. seat.lg[i] .. " unlink")
        end
    end
    if #want > 0 then
        local scan = scanPrims()
        local params = if lg_params ~= "" then " " .. lg_params else ""
        for i = 1, #want, 2 do
            local key = lgRing(scan, seat.sc, want[i + 1] or "")
            if key then
                ll.Whisper(LOCKGUARD_CHANNEL, "lockguard " .. seat.avatar .. " " .. want[i] .. " link " .. key .. params)
            end
        end
    end
    -- kept even when a ring is missing: a prop's rings may arrive later
    seat.lg = want
end

--------------------------------------------------------------------------
-- LockMeister
--------------------------------------------------------------------------
local function lmCloseListen()
    if lm_handle then
        ll.ListenRemove(lm_handle)
        lm_handle = nil
    end
    if lm_timer then
        LLTimers:off(lm_timer)
        lm_timer = nil
    end
end

local function lmExtendTimeout()
    if lm_timer then
        LLTimers:off(lm_timer)
    end
    lm_timer = LLTimers:once(LM_TIMEOUT, function()
        lm_timer = nil
        lmCloseListen()
    end)
end

-- close the listen once no cuff has anything left to answer (all LMV2)
local function lmCheckIdle()
    for _, s in seats do
        for _, e in s.lm do
            if e.state ~= 2 then
                return
            end
        end
    end
    lmCloseListen()
end

local function lmDraw(target: uuid, link: number)
    ll.LinkParticleSystem(link, {
        PSYS_PART_FLAGS, bit32.bor(PSYS_PART_FOLLOW_SRC_MASK, PSYS_PART_FOLLOW_VELOCITY_MASK, PSYS_PART_TARGET_POS_MASK),
        PSYS_SRC_PATTERN, PSYS_SRC_PATTERN_DROP,
        PSYS_PART_START_SCALE, lm_size,
        PSYS_PART_START_COLOR, lm_color,
        PSYS_PART_MAX_AGE, lm_life,
        PSYS_SRC_BURST_RATE, 0.02,
        PSYS_SRC_TEXTURE, lm_texture,
        PSYS_SRC_BURST_SPEED_MIN, 0,
        PSYS_SRC_BURST_SPEED_MAX, 0,
        PSYS_SRC_TARGET_KEY, target,
        PSYS_SRC_BURST_PART_COUNT, 1,
        PSYS_SRC_ACCEL, vector(0, 0, -lm_gravity),
    })
end

local function lmClear(seat: Seat)
    if #seat.lm == 0 then
        return
    end
    for _, e in seat.lm do
        ll.LinkParticleSystem(e.link, {})
    end
    seat.lm = {}
    lmCheckIdle()
end

local function lmChain(seat: Seat, want: {string})
    lmClear(seat)
    if #want == 0 then
        return
    end
    local scan = scanPrims()
    for i = 1, #want, 2 do
        local link = findRing(scan, want[i + 1] or "")
        if link then
            -- one chain per ring prim: the newest pose takes it from another sitter
            for _, other in seats do
                if other ~= seat then
                    for j = #other.lm, 1, -1 do
                        if other.lm[j].link == link then
                            ll.LinkParticleSystem(link, {})
                            table.remove(other.lm, j)
                        end
                    end
                end
            end
            table.insert(seat.lm, { link = link, lmcode = want[i], state = 0 })
            ll.RegionSayTo(K(seat.avatar), LM_CHANNEL, seat.avatar .. want[i])
        end
    end
    if #seat.lm > 0 then
        if not lm_handle then
            lm_handle = ll.Listen(LM_CHANNEL, "", NULL_KEY, "")
        end
        lmExtendTimeout()
    else
        lmCheckIdle()
    end
end

local function lmFind(seat: Seat, lmcode: string): Emitter?
    for _, e in seat.lm do
        if e.lmcode == lmcode then
            return e
        end
    end
    return nil
end

local function lmListen(id: uuid, msg: string)
    local owner = tostring(ll.GetOwnerKey(id))
    local seat: Seat? = nil
    for _, s in seats do
        if s.avatar == owner and #s.lm > 0 then -- the attachment belongs to a chained sitter
            seat = s
            break
        end
    end
    if not seat then
        return
    end
    local avatar = seat.avatar
    if ll.GetSubString(msg, 1, 36) ~= avatar then -- the target key must be that sitter
        return
    end
    if ll.GetSubString(msg, -3, -1) == " ok" then
        -- LMV1: request AVATAR_UUIDlmcode, reply AVATAR_UUIDlmcode ok
        local lmcode = ll.GetSubString(msg, 37, -4)
        local e = lmFind(seat, lmcode)
        if not e or e.state ~= 0 then
            return
        end
        lmDraw(id, e.link)
        e.state = 1
        -- ask for a (possible) LMV2 point and give the cuffs more time
        ll.RegionSayTo(id, LM_CHANNEL, avatar .. "|LMV2|RequestPoint|" .. lmcode)
        lmExtendTimeout()
    else
        -- LMV2: request AVATAR_UUID|LMV2|RequestPoint|lmcode, reply AVATAR_UUID|LMV2|ReplyPoint|lmcode|TARGET_UUID
        local c = ll.ParseString2List(msg, {"|"}, {})
        if c[1] ~= avatar or c[2] ~= "LMV2" or c[3] ~= "ReplyPoint" then
            return
        end
        local e = lmFind(seat, c[4] or "")
        if not e or e.state == 2 or not isKey(c[5]) then
            return
        end
        lmDraw(K(c[5]), e.link)
        e.state = 2
        lmExtendTimeout()
        lmCheckIdle()
    end
end

--------------------------------------------------------------------------
-- chaining a sitter
--------------------------------------------------------------------------
local function chainFor(pose: string, sc: number): Chain?
    local s = tostring(sc)
    return CHAINS[pose .. "|" .. s] or CHAINS[pose .. "|*"] or CHAINS["*|" .. s] or CHAINS["*|*"]
end

local function unchain(seat: Seat)
    lgChain(seat, {})
    lmClear(seat)
end

-- chain (or unchain) a sitter for their current pose and on/off state
local function apply(seat: Seat)
    local c = if ready and not off[seat.avatar] then chainFor(seat.pose, seat.sc) else nil
    if c and c.lm then
        lgChain(seat, {})
        lmChain(seat, c.links)
    else
        lmClear(seat)
        lgChain(seat, if c then c.links else {})
    end
end

local function dropSeat(sc: number)
    local seat = seats[sc]
    if seat then
        unchain(seat)
        seats[sc] = nil
    end
end

-- 90240 / 90241 / 90242 and TOGGLE numbers: action 1 on, 0 off, 2 toggle
local function onOff(action: number, id: string)
    local parts = string.split(id, "|")
    local target = parts[#parts] or "" -- "controller|sitter" (BUTTON): the sitter
    local list: {Seat} = {}
    for _, s in seatList() do
        if s.avatar == target then
            table.insert(list, s)
        end
    end
    if #list == 0 then
        list = seatList() -- not a chained sitter: every sitter
    end
    local turn_off = action == 0
    if action == 2 then
        turn_off = false
        for _, s in list do
            if not off[s.avatar] then
                turn_off = true -- toggle: off if any of them is on
            end
        end
    end
    for _, s in list do
        if (off[s.avatar] == true) ~= turn_off then
            if turn_off then
                off[s.avatar] = true
            else
                off[s.avatar] = nil
            end
            apply(s)
        end
    end
end

--------------------------------------------------------------------------
-- props (PROPS 1): rings reported by [LS]LockGuard-object
--------------------------------------------------------------------------
local function closePropListen(prop_key: string)
    local h = prop_listens[prop_key]
    if h then
        ll.ListenRemove(h)
        prop_listens[prop_key] = nil
    end
end

local function onProp(msg: string)
    local data = ll.ParseStringKeepNulls(msg, {"|"}, {})
    local event = data[1] or ""
    local prop_key = data[6] or ""
    if not isKey(prop_key) then
        return
    end
    if event == "REZ" then
        closePropListen(prop_key)
        props[prop_key] = { sitter = int(data[2]), rings = {} }
        local h = ll.Listen(COMM_CHANNEL, data[4] or "", K(prop_key), "")
        prop_listens[prop_key] = h
        LLTimers:once(PROP_TIMEOUT, function()
            if prop_listens[prop_key] == h then
                closePropListen(prop_key)
            end
        end)
        ll.RegionSayTo(K(prop_key), COMM_CHANNEL, "INFORM")
    elseif event == "DEREZ" then
        closePropListen(prop_key)
        props[prop_key] = nil
    end
end

local function onAttachPoints(id: uuid, msg: string)
    local prop_key = tostring(id)
    local data = ll.ParseString2List(msg, {"|"}, {})
    local p = props[prop_key]
    if data[1] ~= "ATTACHPOINTS" or not p then
        return
    end
    closePropListen(prop_key)
    for i = 2, #data - 1, 2 do
        if p.rings[data[i]] == nil then
            p.rings[data[i]] = data[i + 1]
        end
    end
    -- link the cuffs waiting for these rings
    for _, s in seatList() do
        if #s.lg > 0 then
            lgChain(s, s.lg)
        end
    end
end

--------------------------------------------------------------------------
-- notecard
--------------------------------------------------------------------------
local function problem(line: number, text: string)
    table.insert(problems, { line = line, text = text })
end

local function report()
    if #problems == 0 then
        return
    end
    table.sort(problems, function(a, b)
        return a.line < b.line
    end)
    local out = { ll.GetScriptName() .. ": please check \"" .. CARD .. "\":" }
    for i, p in problems do
        if i > MAX_REPORT then
            table.insert(out, "... and " .. tostring(#problems - MAX_REPORT) .. " more.")
            break
        end
        table.insert(out, if p.line > 0 then "line " .. tostring(p.line) .. ": " .. p.text else p.text)
    end
    print(table.concat(out, "\n"))
end

-- Fast notecard reader (as in [LS]Xcite!); onLine returns true to stop reading.
local function readNotecard(name: string, onLine: (string, number) -> boolean, onDone: () -> ())
    local lineNo = 1
    local query: uuid? = nil
    local handler: any = nil
    local function finish()
        if handler then
            LLEvents:off("dataserver", handler)
            handler = nil
        end
        onDone()
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

local function number(s: string?): number?
    return tonumber(trim(s))
end

local function parseLockMeister(params: string, n: number)
    local t = ll.ParseString2List(params, {" "}, {})
    local i = 1
    while i <= #t do
        local word = ll.ToLower(t[i])
        if word == "size" and number(t[i + 1]) and number(t[i + 2]) then
            lm_size = vector(number(t[i + 1]) :: number, number(t[i + 2]) :: number, 0)
            i += 3
        elseif word == "color" and number(t[i + 1]) and number(t[i + 2]) and number(t[i + 3]) then
            lm_color = vector(number(t[i + 1]) :: number, number(t[i + 2]) :: number, number(t[i + 3]) :: number)
            i += 4
        elseif word == "life" and number(t[i + 1]) then
            lm_life = number(t[i + 1]) :: number
            i += 2
        elseif word == "gravity" and number(t[i + 1]) then
            lm_gravity = number(t[i + 1]) :: number
            i += 2
        elseif word == "texture" and t[i + 1] then
            lm_texture = t[i + 1]
            i += 2
        else
            problem(n, "STYLE lockmeister: \"" .. t[i] .. "\" is not size x y, life s, gravity g, color r g b or texture t (rest of the line ignored)")
            return
        end
    end
end

local function isLinkNumber(s: string): boolean
    return string.match(s, "^%-?%d+$") ~= nil
end

local function parseLine(data: string, n: number)
    local line = trim(data)
    if line == "" or string.sub(line, 1, 1) == "#" or string.sub(line, 1, 2) == "//" then
        return
    end
    local comment = string.find(line, "//", 1, true)
    if comment then
        line = trim(string.sub(line, 1, comment - 1))
    end
    local sp = string.find(line, " ", 1, true)
    local command = ll.ToUpper(if sp then string.sub(line, 1, sp - 1) else line)
    local rest = if sp then string.sub(line, sp + 1) else ""
    local parts = ll.ParseStringKeepNulls(rest, {" | ", " |", "| ", "|"}, {})
    for i, p in parts do
        parts[i] = trim(p)
    end
    if command == "STYLE" then
        local protocol = ll.ToLower(parts[1] or "")
        if protocol == "lockguard" then
            lg_params = parts[2] or ""
        elseif protocol == "lockmeister" then
            parseLockMeister(parts[2] or "", n)
        else
            problem(n, "STYLE must be lockguard or lockmeister")
            return
        end
        if not style_seen then
            style_seen = true
            default_lm = protocol == "lockmeister"
        end
    elseif command == "CHAIN" then
        local pose = parts[1] or ""
        local sitter = parts[2] or ""
        if pose == "" or not (sitter == "*" or string.match(sitter, "^%d+$")) or #parts > 4 then
            problem(n, "expected CHAIN pose|sitter|cuff,ring,cuff,ring... (sitter: a number or *)")
            return
        end
        local links: {string} = {}
        local list = parts[3] or ""
        if list ~= "" and ll.ToLower(list) ~= "none" then
            links = ll.ParseStringKeepNulls(list, {","}, {})
            for i, l in links do
                links[i] = trim(l)
                if links[i] == "" then
                    problem(n, "an empty cuff or ring name in \"" .. list .. "\"")
                    return
                end
            end
            if #links % 2 ~= 0 then
                problem(n, "cuffs and rings must come in pairs: cuff,ring,cuff,ring...")
                return
            end
        end
        local protocol = ll.ToLower(parts[4] or "")
        local lm = default_lm
        if protocol == "lockmeister" then
            lm = true
        elseif protocol == "lockguard" then
            lm = false
        elseif protocol ~= "" then
            problem(n, "the 4th field must be lockguard or lockmeister")
            return
        end
        local key = pose .. "|" .. (if sitter == "*" then "*" else tostring(int(sitter)))
        local old = CHAINS[key]
        if old then
            problem(n, "CHAIN " .. key .. " is already on line " .. tostring(old.line) .. " (this line is ignored)")
            return
        end
        local c: Chain = { links = links, lm = lm, line = n }
        CHAINS[key] = c
        table.insert(CHAIN_ORDER, c)
    elseif command == "TOGGLE" then
        local any = false
        for i = 1, 3 do
            local v = parts[i] or ""
            if v ~= "" then
                local num = int(v)
                if not isLinkNumber(v) or (num >= 90000 and num <= 90500) then
                    problem(n, "TOGGLE: \"" .. v .. "\" is not a link number outside 90000-90500 (90240/90241/90242 work without TOGGLE)")
                    return
                end
                any = true
            end
        end
        if not any or #parts > 3 then
            problem(n, "expected TOGGLE on|off or TOGGLE on|off|toggle (link numbers)")
            return
        end
        local actions = { 1, 0, 2 }
        for i = 1, 3 do
            if (parts[i] or "") ~= "" then
                TOGGLES[int(parts[i])] = actions[i]
            end
        end
    elseif command == "PROPS" then
        props_mode = int(parts[1]) ~= 0
    else
        problem(n, "unknown command \"" .. command .. "\" (STYLE, CHAIN, TOGGLE or PROPS)")
    end
end

-- after reading: rings that no prim has, LockMeister rings used twice, other chain scripts
local function checkSettings()
    local scan = scanPrims()
    local missing: {[string]: boolean} = {}
    for _, c in CHAIN_ORDER do
        local used: {[string]: boolean} = {}
        for i = 2, #c.links, 2 do
            local ring = c.links[i]
            if (c.lm or not props_mode) and not missing[ring] and not findRing(scan, ring) then
                missing[ring] = true
                problem(c.line, "no prim named \"" .. ring .. "\" in the linkset" .. (if c.lm then "" else " (rings in props need PROPS 1)"))
            end
            if c.lm and used[ring] then
                problem(c.line, "LockMeister draws one chain per ring prim; \"" .. ring .. "\" is used twice")
            end
            used[ring] = true
        end
    end
    for _, name in { "[LS]LockGuard", "[LS]LockMeister", "[AV]LockGuard", "[AV]LockMeister" } do
        if ll.GetInventoryType(name) == INVENTORY_SCRIPT then
            problem(0, "\"" .. name .. "\" is in this prim too: use it or [LS]chains for the same cuffs, not both.")
        end
    end
end

local function cardSig(): string
    if ll.GetInventoryType(CARD) ~= INVENTORY_NOTECARD then
        return ""
    end
    return tostring(ll.GetInventoryKey(CARD))
end

local function load()
    load_id += 1
    local my_load = load_id
    for _, s in seatList() do
        unchain(s)
    end
    CHAINS = {}
    CHAIN_ORDER = {}
    lg_params = LG_DEFAULT
    lm_size = vector(0.1, 0.1, 0)
    lm_life = 3.0
    lm_gravity = 0.3
    lm_color = vector(1, 1, 1)
    lm_texture = LM_TEXTURE
    default_lm = false
    style_seen = false
    props_mode = false
    TOGGLES = table.clone(BUILTIN_TOGGLES)
    problems = {}
    ready = false
    card_sig = cardSig()
    if card_sig == "" then
        print(ll.GetScriptName() .. ": no \"" .. CARD .. "\" notecard, so no chains (see docs/luasitter/chains.md).")
        return
    end
    readNotecard(CARD, function(data: string, n: number): boolean
        if my_load ~= load_id then
            return true -- a newer load started
        end
        parseLine(data, n)
        return false
    end, function()
        if my_load ~= load_id then
            return
        end
        checkSettings()
        report()
        ready = true
        for _, s in seatList() do
            apply(s)
        end
    end)
end

--------------------------------------------------------------------------
-- events
--------------------------------------------------------------------------
LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    local action = TOGGLES[num]
    if action then -- on / off from any prim
        onOff(action, id)
        return
    end
    if sender ~= ll.GetLinkNumber() then -- sitter messages only from the [LS]sit prim
        return
    end
    if num == 90045 then -- pose played
        if not isKey(id) then
            return
        end
        local data = ll.ParseStringKeepNulls(msg, {"|"}, {})
        local sc = int(data[1])
        -- the avatar left another seat
        for osc, s in seats do
            if osc ~= sc and s.avatar == id then
                dropSeat(osc)
            end
        end
        local seat = seats[sc]
        if seat and seat.avatar ~= id then -- someone else took this seat
            dropSeat(sc)
            seat = nil
        end
        if not seat then
            seat = { sc = sc, avatar = id, pose = "", lg = {}, lm = {} }
            seats[sc] = seat
        end
        local s = seat :: Seat
        s.pose = data[2] or ""
        apply(s)
    elseif num == 90065 then -- sitter gone
        local sc = int(msg)
        local seat = seats[sc]
        if seat and seat.avatar == id then
            dropSeat(sc)
        end
        for _, s in seats do
            if s.avatar == id then
                return -- still sitting in another seat
            end
        end
        off[id] = nil -- chains are "on" again next time
    elseif num == 90030 or num == 90032 then -- swap: [LS]sit sends 90045 for the new seats
        dropSeat(int(msg))
        dropSeat(int(id))
    elseif num == 90500 and props_mode then
        onProp(msg)
    end
end)

LLEvents:on("listen", function(channel: number, _name: string, id: uuid, msg: string)
    if channel == LM_CHANNEL then
        lmListen(id, msg)
    elseif channel == COMM_CHANNEL then
        onAttachPoints(id, msg)
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_INVENTORY) ~= 0 and cardSig() ~= card_sig then
        load()
    end
    if bit32.band(change, CHANGED_LINK) ~= 0 then
        -- nobody sits any more (for example a sit script was reset): clear everything
        if ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) == ZERO_VECTOR then
            for _, s in seatList() do
                dropSeat(s.sc)
            end
            off = {}
        end
    end
end)

load()
