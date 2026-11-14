--[[
  [LS]root-RLV - RLV plugin for LuaSitter
  LuaSitter: SLua port of AVsitter(TM) [AV]root-RLV and [AV]root-RLV-extra. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What this script does
  ---------------------
  RLV capture / release of sitters through an RLV relay, roles (Dominant /
  Submissive), timelock, keys, hovertext, plus the "Restrict" and "Un/Dress"
  menus (restrictions toggling, outfit / attachment removal, #RLV browsing).

  Merge
  -----
  [AV]root-RLV-extra only existed because of the 64 KB LSL memory limit. It is
  merged here (the "X" section below). The purely internal messages between the
  two scripts became direct function calls:
    - 90208 / 90209 (open Un/Dress / Restrict) are not sent. They are still
      answered when another script sends them (same payload:
      id = "<captive>|<controller>|<title>").
    - 90100 "0|Control...|<captive>", sent by the extra script for [BACK]
      (LINK_THIS only, nobody else acted on it), is a direct call.
  The extra menus keep their own dialog channel and status channel, as
  upstream. The "Restrict" and "Un/Dress" buttons are always offered
  (upstream: only when [AV]root-RLV-extra was present).

  Link messages added
  -------------------
    - 90020 (msg = sitter#, id = "[LS]root-RLV"): DUMP for [LS]adjuster
      (issue #18). For sitter "0" every RLV-owned notecard line is sent back
      verbatim as 90022 (LINK_THIS, line, sitter#); then for every sitter#
      90021 (LINK_THIS, sitter#, "[LS]root-RLV") is sent. ROLES, ONSIT and
      BRAND are dumped by [LS]sit, not here.
    - 90032: same as 90030 (swap sitters and return the menu, issue #140).
  Everything else in the public protocol is unchanged (90004, 90005, 90007,
  90012, 90014, 90015, 90030, 90045, 90060, 90065, 90070, 90100, 90201, 90206,
  90207, 90211). Relay chat protocol is byte-identical.

  Behaviour changes / fixes (see "FIX:" comments)
  -----------------------------------------------
    - PR #149 (Chorazin Allen): captives that unsit / log off and come back
      captured are returned to their previous pose. Stored as a per-captive
      record instead of parallel strided lists; `new_pose` scoping bug fixed;
      restore attempts capped so an unplayable pose cannot loop forever.
    - Upstream 4cf0c3c: 90015 triggers [STOP] (kept).
    - Clearer RLV menus: each menu starts with where you are ("RLV ▸ Bob"),
      shows the status (captured, timelock, who holds the menu) and says what
      each button does. Plain button names: "◂ Poses" (was "Menu..."),
      "Capture"/"Release" (were "Capture!"/"Release!"), "Lock menu"/"Unlock
      menu" (were "Take Keys"/"Drop Keys"), "Capture new…" (was "Capture...").
      The upstream names are still accepted. The pose menu shows "RLV ▸"
      ([LS]sit; it still sends "Control..." in 90100).
    - The submissive menu is paged ([<<] / [>>]) when it needs more than 12
      buttons.
    - No llSleep: upstream paused this script for 1 s before playing a pose
      (playpose), before swapping a sitter into a free seat and before giving
      the menu to a new dominant. Each event handler runs as a task (a
      coroutine) that waits on an LLTimers timer instead. Events that arrive
      while a task waits are queued and handled after it, in arrival order, as
      LSL queued them during llSleep, so the order of everything the script
      does and sends is unchanged. Timelock ticks are coalesced while waiting,
      like LSL timer events.
    - The single multiplexed LSL timer is split into independent LLTimers:
      timelock countdown, relay search timeout, relay check timeout (the LSL
      used a never-matching llSensorRepeat as a 2 s timer for the latter).
    - The relay search listener was never removed (llListenRemove was given
      the channel instead of the handle) and leaked one listen per search.
    - ASKROLE / CHECK listens were re-added on every sit without removing the
      previous ones (listen leak, "too many listens" after ~30 sits).
    - DESIGNATIONS_NOW was empty until the first stand-up when the notecard had
      no ROLES line, so ONSIT CAPTURE did nothing until then.
    - Notecard lines may start with a chat prefix ending in the U+25C6 marker
      (as pasted from a DUMP), like [LS]sit accepts.
    - The extra menus' llSleep(2)/llSleep(4) are timers (the merged script
      must stay responsive).
]]

local product = "LuaSitter RLV"
local version = "3.0-lua1"
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
local main_script = "[LS]sit"
local Dominant_name = "Dominant"
local Submissive_name = "Submissive"
local Submissive_name_plural = "submissives"
local RELAY_CHANNEL = -1812221819
local verbose = 0

--------------------------------------------------------------------------
-- helpers
--------------------------------------------------------------------------
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

local function L(t: {string}, i: number): string
    if i < 0 then
        i = #t + 1 + i
    end
    return t[i] or ""
end

local function contains(s: string, p: string): boolean
    return string.find(s, p, 1, true) ~= nil
end

local function replace(s: string, search: string, rep: string): string
    return ll.ReplaceSubString(s, search, rep, 0)
end

local function split(s: string, sep: string): {string}
    return ll.ParseStringKeepNulls(s, {sep}, {})
end

local function orderButtons(b: {string}): {string}
    -- rows of 3 from the end (the last 12 buttons at most), top row first
    local out = {}
    local n = #b
    for last = n, n - 9, -3 do
        table.move(b, math.max(last - 2, 1), last, #out + 1, out)
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

--------------------------------------------------------------------------
-- Tasks: waiting without llSleep
--------------------------------------------------------------------------
-- Every event handler and timer callback runs as a task (a coroutine). wait(n)
-- suspends the running task and resumes it n seconds later from an LLTimers
-- timer. While a task is suspended, new events are queued and run afterwards in
-- arrival order, exactly as LSL queued events during llSleep, so the script does
-- and sends the same things in the same order as upstream, without blocking.
type Deferred = { fn: (...any) -> (), args: { n: number, [number]: any } }
local current_task: thread? = nil
local deferred: {Deferred} = {}
local start_task: (fn: (...any) -> (), args: { n: number, [number]: any }) -> ()

local function resume_task(co: thread)
    local ok, err = coroutine.resume(co)
    if not ok or coroutine.status(co) == "dead" then
        current_task = nil
        -- run the events that arrived meanwhile, until one of them waits in turn
        -- (also after an error, so they are not left queued until the next event)
        while current_task == nil and #deferred > 0 do
            local ev = table.remove(deferred, 1) :: Deferred
            start_task(ev.fn, ev.args)
        end
    end
    if not ok then
        error(err, 0)
    end
end

start_task = function(fn: (...any) -> (), args: { n: number, [number]: any })
    local co = coroutine.create(function()
        fn(table.unpack(args, 1, args.n))
    end)
    current_task = co
    resume_task(co)
end

-- Wrap a handler so that it runs as a task, or is queued while a task waits.
-- coalesce: drop the call when the same handler is already queued (timer ticks).
local function task(fn: (...any) -> (), coalesce: boolean?): (...any) -> ()
    return function(...: any)
        if current_task then
            if coalesce then
                for _, ev in deferred do
                    if ev.fn == fn then
                        return
                    end
                end
            end
            table.insert(deferred, { fn = fn, args = table.pack(...) })
        else
            start_task(fn, table.pack(...))
        end
    end
end

-- Suspend the running task for `seconds` (replaces llSleep).
local function wait(seconds: number)
    local co = current_task
    if co and coroutine.running() == co then
        LLTimers:once(seconds, function()
            resume_task(co)
        end)
        coroutine.yield()
    end
end

-- LSL-style access to string lists with 0-based sitter indexes.
-- llList2String(list, i) (negative i counts from the end, out of range gives "")
local function at0(t: {string}, i: number): string
    local j = if i >= 0 then i + 1 else #t + 1 + i
    return t[j] or ""
end

-- llListFindList(list, [v]) : 0-based index or -1
local function find0(t: {string}, v: string): number
    local i = table.find(t, v)
    return if i then i - 1 else -1
end

-- llListReplaceList(list, [v], i, i) for i >= 0 (appends when past the end)
local function set0(t: {string}, i: number, v: string)
    if i >= #t then
        table.insert(t, v)
    else
        t[i + 1] = v
    end
end

local function owner(): string
    return tostring(ll.GetOwner())
end

local function hasScript(name: string): boolean
    return ll.GetInventoryType(name) == INVENTORY_SCRIPT
end

--------------------------------------------------------------------------
-- state
--------------------------------------------------------------------------
local ignorenextswap = false
local RLV_ON = 1
local WAITPOSE = ""
local DOMPOSE = ""
local SUBPOSE = ""
local HTEXT = 1
local SITTER_DESIGNATIONS_MASTER: {string} = {"S"}
local DESIGNATIONS_NOW: {string} = {} -- roles ("S"/"D") or the uuid of the avatar holding the role
local onTouch = "ASK"
local onSit = "CAPTURE"
local autoRecapture = 0
local notecard_key = ""
local RELAY_SEARCH_CHANNEL = 0
local RELAY_GETCAPTURESTATUSchannel = 0
local RELAY_CHECK_CHANNEL = 0
local ASKROLE_CHANNEL = -748363
local menu_channel = 0
local menu_handle = 0
local relay_handle = 0
local GETCAPTURESTATUShandle = 0
local SEARCHhandle = 0
local CHECKhandle = 0
local ASKROLEhandle = 0
local DETECTED_AVATAR_SHORTNAMES: {string} = {}
local DETECTED_AVATAR_KEYS: {string} = {}
local baseCaptureRestrictions = "@unsit=n"
local baseReleaseRestrictions = "@unsit=force"
local expected_number = 0
local expecting_relay_results = false
local controllerHasKeys = false
local PairWhoStartedCapture = "NA"
local defaultTimelock = 0
local TimelockSecUntilRelease = 0
local TimelockHidden = false
local TimelockPaused = false
local CONTROLLER = ""
local controllerName = ""
local SLAVE = ""
local slaveName = ""
local slaveWearingRelay = 0 -- 0 unknown / none, -1 waiting for reply, 1 relay answered
local SITTERS: {string} = {}
local SITTING_AVATARS: {string} = {}
local SITTERS_MENUKEYS: {string} = {}
local SITTERS_SHORTNAMES: {string} = {}
local activePrim = 0
local menu = ""
local subControl = 0
local ping = ""
local captureOnAsk = true
local doNotSayReleaseMessage = 0
local dumpLines: {string} = {} -- RLV-owned notecard lines, for the adjuster DUMP (issue #18)

-- PR #149: one record per captive (upstream: strided lists CAPTIVES [name, uuid] + CAPTIVE_POSES_FLAGS [pose, flag])
local POSE_NORMAL = 0 -- record every pose played
local POSE_GONE = 1 -- captive unsat / logged off
local POSE_RETURNED = 2 -- captive sat again: restore `pose`
local MAX_RESTORE_TRIES = 3
type Captive = { name: string, id: string, pose: string, flag: number, tries: number }
local CAPTIVES: {Captive} = {}

-- timers (the LSL multiplexed a single timer)
local timelockTimer: any = nil
local searchTimer: any = nil
local checkTimer: any = nil

-- notecard commands owned by this script, dumped by 90020
local DUMP_COMMANDS: {[string]: boolean} = {
    WAITPOSE = true, RLV = true, SUBCONTROL = true, HTEXT = true, DOMPOSE = true, SUBPOSE = true,
    ONTOUCH = true, RECAPTURE = true, TIMELOCK = true, ONCAPTURE = true, ONRELEASE = true,
}

--------------------------------------------------------------------------
-- main RLV functions
--------------------------------------------------------------------------
local function Out(level: number, out: string)
    if verbose >= level then
        print(ll.GetScriptName() .. "[" .. version .. "]:" .. out)
    end
end

local function relay(av: string, msg: string)
    ll.Say(RELAY_CHANNEL, "RLV," .. av .. "," .. msg)
end

local function shortName(id: string): string
    return ll.GetSubString(replace(ll.Key2Name(K(id)), " Resident", ""), 1, 12)
end

local function findCaptive(id: string): number?
    for i, c in CAPTIVES do
        if c.id == id then
            return i
        end
    end
    return nil
end

local function captiveRecord(id: string): Captive?
    local i = findCaptive(id)
    return if i then CAPTIVES[i] else nil
end

-- llDumpList2String(CAPTIVES, ",") of upstream's strided [name, uuid] list
local function captivesCsv(): string
    local t = {}
    for _, c in CAPTIVES do
        table.insert(t, c.name)
        table.insert(t, c.id)
    end
    return table.concat(t, ",")
end

local function humantime(): string
    local hours = TimelockSecUntilRelease // 3600
    local minutes = TimelockSecUntilRelease % 3600
    local seconds = minutes % 60
    minutes = minutes // 60
    local hours_text = ""
    local minutes_text = ""
    local seconds_text = ""
    if hours ~= 0 then
        hours_text = tostring(hours) .. " hrs, "
    end
    if minutes ~= 0 or hours ~= 0 then
        minutes_text = tostring(minutes) .. " min"
    end
    if hours == 0 then
        if minutes ~= 0 then
            seconds_text ..= ", "
        end
        seconds_text ..= tostring(seconds) .. " sec"
    end
    return hours_text .. minutes_text .. seconds_text
end

local function dialog(text: string, buttons: {string})
    ll.Dialog(K(CONTROLLER), product .. " " .. version .. "\n\n" .. text, orderButtons(buttons), menu_channel)
end

local function info_dialog(id: string, text: string)
    ll.Dialog(K(id), product .. " " .. version .. "\n\nSorry, " .. text .. ".\n", {"OK"}, -7947386)
end

local function ask_role(id: string)
    ll.Dialog(K(id), product .. " " .. version .. "\n\nPlease select your role:\n", {Dominant_name, Submissive_name}, ASKROLE_CHANNEL)
end

local function sendDesignations()
    ll.MessageLinked(LINK_THIS, 90206, table.concat(DESIGNATIONS_NOW, "|"), "")
end

-- LSL (string)vector format, as sent in 90207
local function vecStr(v: vector): string
    return string.format("<%.5f, %.5f, %.5f>", v.x, v.y, v.z)
end

local function hovertext()
    local text = ""
    local color = vector(0, 1, 0)
    if #CAPTIVES > 0 then
        local names = table.create(#CAPTIVES)
        for i, c in CAPTIVES do
            names[i] = "\"" .. c.name .. "\"\n"
        end
        text = "\n \nCaptive" .. (if #CAPTIVES > 1 then "s" else "") .. ":\n" .. table.concat(names)
        if TimelockSecUntilRelease ~= 0 then
            if TimelockPaused then
                -- nothing
            elseif #SITTING_AVATARS > 0 then
                text ..= "\n \nTimelocked for:\n"
                if TimelockHidden then
                    text ..= "(hidden)"
                else
                    text ..= humantime()
                end
            end
        end
        if controllerHasKeys then
            color = vector(1, 0, 0)
            text ..= "\n \nLocked by:\n\"" .. controllerName .. "\""
        else
            text ..= "\n \nKeys available"
        end
    end
    if HTEXT ~= 0 then
        ll.SetText(text .. string.rep("\n ", HTEXT - 1), color, 0.8) -- HTEXT - 1 blank lines below
    else
        ll.MessageLinked(LINK_SET, 90207, text, vecStr(color))
    end
    ll.MessageLinked(LINK_SET, 90014, CONTROLLER .. "|" .. captivesCsv(), "")
end

local function stopTimelock()
    if timelockTimer then
        LLTimers:off(timelockTimer)
        timelockTimer = nil
    end
end

local function reset()
    CAPTIVES = {}
    CONTROLLER = ""
    controllerHasKeys = false
    TimelockHidden = false
    TimelockPaused = false
    stopTimelock()
    TimelockSecUntilRelease = defaultTimelock
    hovertext()
end

local function unsit_all()
    local i = ll.GetNumberOfPrims()
    while ll.GetAgentSize(ll.GetLinkKey(i)) ~= ZERO_VECTOR do
        ll.UnSit(ll.GetLinkKey(i))
        i -= 1
    end
end

local function release(id: string, allowUnsit: boolean)
    local index = findCaptive(id)
    if index then
        table.remove(CAPTIVES, index)
        if doNotSayReleaseMessage == 0 then
            ll.Say(0, ll.Key2Name(K(id)) .. " was released.")
        end
        relay(id, baseReleaseRestrictions)
        relay(id, "!release")
        if allowUnsit and contains(baseReleaseRestrictions, "@unsit=force") then
            ll.UnSit(K(id))
        end
    end
    if #CAPTIVES == 0 then
        reset()
    end
end

local function release_all()
    while #CAPTIVES > 0 do
        release(CAPTIVES[1].id, false)
    end
end

local function stop()
    release_all()
    unsit_all()
    reset()
end

-- one second of timelock (the timelock half of the LSL timer event)
local function timelockTick()
    local keepRunning = #SITTING_AVATARS > 0
    if TimelockPaused then
        keepRunning = false
    elseif TimelockSecUntilRelease ~= 0 then
        TimelockSecUntilRelease -= 1
        if TimelockSecUntilRelease == 0 then
            for i = #CAPTIVES, 1, -1 do
                local c = CAPTIVES[i]
                if c and table.find(SITTING_AVATARS, c.id) then
                    release(c.id, true)
                end
            end
            keepRunning = false
        end
    else
        TimelockSecUntilRelease = defaultTimelock
        keepRunning = false
    end
    if not keepRunning then
        stopTimelock()
    end
    hovertext()
end

-- llSetTimerEvent(1) for the timelock
local function startTimelock()
    stopTimelock()
    timelockTimer = LLTimers:every(1, task(function()
        timelockTick()
    end, true))
end

local function playpose(pose: string, target_sitter: string)
    if pose ~= "" then
        wait(1) -- upstream: llSleep(1)
        ll.MessageLinked(LINK_SET, 90000, pose, target_sitter)
    end
end

-- Button labels (LuaSitter). The upstream labels are still accepted (see onMenu).
local B_POSES = "◂ Poses" -- upstream: "Menu..."
local B_CAPTURE = "Capture" -- upstream: "Capture!"
local B_RELEASE = "Release" -- upstream: "Release!"
local B_LOCK = "Lock menu" -- upstream: "Take Keys"
local B_UNLOCK = "Unlock menu" -- upstream: "Drop Keys"
local B_CAPTURE_NEW = "Capture new…" -- upstream: "Capture..."

local function Timelock_menu()
    menu = "Timelock"
    local menu_items = {"+1min", "+30min", "+1hrs"}
    local text = "RLV ▸ " .. slaveName .. " ▸ Timelock\n\n"
        .. "Releases " .. slaveName .. " automatically when the time runs out.\n"
        .. "Time remaining: " .. humantime() .. "\n"
    local pauseButton = " "
    local hidButton = " "
    if TimelockSecUntilRelease ~= 0 then
        pauseButton = "Stop"
        if TimelockPaused then
            pauseButton = "Start"
            text ..= "\nTimelock Stopped"
            table.insert(menu_items, "-1min")
            table.insert(menu_items, "-30min")
            table.insert(menu_items, "-1hrs")
        else
            hidButton = "Hide"
            if TimelockHidden then
                hidButton = "Show"
                text ..= "\nTimelock Hidden"
            end
        end
    end
    text ..= "\n+/- = add or remove time"
    if pauseButton ~= " " then
        text ..= "\nStart/Stop = run or pause the countdown"
    end
    if hidButton ~= " " then
        text ..= "\nHide/Show = hide the time from the hover text"
    end
    text ..= "\n[BACK] = RLV menu"
    dialog(text, table.move(menu_items, 1, #menu_items, 4, {"[BACK]", pauseButton, hidButton}))
end

local function relay_select_menu()
    menu = "SELECT"
    local menu_items = {}
    for i, k in DETECTED_AVATAR_KEYS do
        if not table.find(SITTING_AVATARS, k) then
            table.insert(menu_items, DETECTED_AVATAR_SHORTNAMES[i])
        end
    end
    local text = "RLV ▸ Capture new\n\nNo RLV relays found in range (20 m)."
    if #menu_items > 0 then
        text = "RLV ▸ Capture new\n\nWho do you want to capture?\nOnly avatars wearing an RLV relay are listed."
    end
    if CONTROLLER == owner() and #SITTING_AVATARS == 0 then
        table.insert(menu_items, "[SECURITY]")
    end
    dialog(text, menu_items)
end

-- The RLV menu of one avatar (SLAVE). LuaSitter: plain button names, and the text
-- says whose menu it is, their status, who holds the menu, and what each button does.
local function rlv_top_menu()
    menu = ""
    local menu_items = {}
    local status = ""
    local help: {string} = {}
    local buttons = {}
    if #SITTING_AVATARS > 1 or table.find(DESIGNATIONS_NOW, "S") then
        table.insert(buttons, "[BACK]")
    end
    local designationIndex = find0(DESIGNATIONS_NOW, SLAVE)
    if RLV_ON ~= 0 then
        if not findCaptive(SLAVE) then
            if slaveWearingRelay ~= 0 then
                if designationIndex ~= -1 and at0(SITTER_DESIGNATIONS_MASTER, designationIndex) == "D" then
                    status = slaveName .. " has not chosen the " .. string.lower(Submissive_name) .. " role."
                else
                    status = "Not captured."
                    table.insert(menu_items, B_CAPTURE)
                    table.insert(help, B_CAPTURE .. " = hold " .. slaveName .. " here with RLV")
                end
            else
                status = "No RLV relay found for " .. slaveName .. "."
            end
        else
            status = "Captured."
            if TimelockSecUntilRelease ~= 0 then
                status ..= " Timelock: " .. humantime()
                if TimelockPaused then
                    status ..= " (stopped)"
                end
            end
            status ..= if controllerHasKeys
                then "\nMenu locked by " .. controllerName .. "."
                else "\nMenu unlocked: anyone can take control."
            table.insert(menu_items, "Timelock")
            -- Restrict and Un/Dress: [AV]root-RLV-extra is merged into this script
            table.insert(menu_items, "Restrict")
            table.insert(menu_items, "Un/Dress")
            table.insert(menu_items, B_RELEASE)
            table.insert(help, B_RELEASE .. " = free " .. slaveName)
            if controllerHasKeys then
                table.insert(buttons, B_UNLOCK)
                table.insert(help, B_UNLOCK .. " = let others take control")
            else
                table.insert(buttons, B_LOCK)
                table.insert(help, B_LOCK .. " = only you can use it")
            end
            table.insert(help, "Timelock = release after a time")
            table.insert(help, "Restrict, Un/Dress = RLV limits, clothes")
        end
        -- NOTE: designationIndex -1 reads the LAST role, like llList2String(list, -1) did
        if at0(SITTER_DESIGNATIONS_MASTER, designationIndex) == "S" then
            if not table.find(SITTING_AVATARS, CONTROLLER) then
                table.insert(menu_items, "[STOP]")
                table.insert(help, "[STOP] = release everyone, all stand")
            end
            table.insert(menu_items, B_POSES)
            table.insert(help, B_POSES .. " = " .. slaveName .. "'s pose menu")
        end
    else
        status = "RLV is off."
    end
    if buttons[1] == "[BACK]" then
        table.insert(help, "[BACK] = previous menu")
    end
    table.move(menu_items, 1, #menu_items, #buttons + 1, buttons)
    local text = "RLV ▸ " .. slaveName .. "\n" .. status
    if #help > 0 then
        text ..= "\n\n" .. table.concat(help, "\n")
    end
    dialog(text, buttons)
end

local function capture_attempt(id: string, target_sitter: string)
    if RLV_ON ~= 0 then
        relay(id, baseCaptureRestrictions)
        ll.ListenRemove(GETCAPTURESTATUShandle)
        GETCAPTURESTATUShandle = ll.Listen(RELAY_GETCAPTURESTATUSchannel, "", NULL_KEY, "")
        relay(id, "@getstatus=" .. tostring(RELAY_GETCAPTURESTATUSchannel))
    end
    if hasScript(main_script .. " 1") then
        playpose(SUBPOSE, target_sitter)
    else
        playpose(SUBPOSE, id)
    end
end

local function stopCheck()
    if checkTimer then
        LLTimers:off(checkTimer)
        checkTimer = nil
    end
end

local function stopSearch()
    if searchTimer then
        LLTimers:off(searchTimer)
        searchTimer = nil
    end
    -- FIX: the LSL removed RELAY_SEARCH_CHANNEL (a channel) instead of SEARCHhandle
    ll.ListenRemove(SEARCHhandle)
    SEARCHhandle = 0
    expecting_relay_results = false
end

-- end of the relay search (the search half of the LSL timer event)
local function setSearchTimer(seconds: number)
    if searchTimer then
        LLTimers:off(searchTimer)
    end
    searchTimer = LLTimers:once(seconds, task(function()
        searchTimer = nil
        stopSearch()
        relay_select_menu()
    end))
end

local function start_relay_search()
    stopCheck() -- FIX: a pending relay check would have been reported as "No avatars found"
    stopSearch()
    DETECTED_AVATAR_KEYS = {}
    DETECTED_AVATAR_SHORTNAMES = {}
    slaveWearingRelay = 0
    ll.Sensor("", NULL_KEY, AGENT, 20, PI)
    expecting_relay_results = true
    SEARCHhandle = ll.Listen(RELAY_SEARCH_CHANNEL, "", NULL_KEY, "")
    setSearchTimer(1.5)
end

local function remove_script(reason: string)
    local message = "\n" .. ll.GetScriptName() .. " ==Script Removed==\n\n" .. reason
    ll.Dialog(ll.GetOwner(), message, {"OK"}, -3675)
    ll.InstantMessage(ll.GetOwner(), message)
    local o = owner()
    if o ~= "b30c9262-9abf-4cd1-9476-adcf5723c029" and o ~= "f2e0ed5e-6592-4199-901d-a659c324ca94" then
        ll.RemoveInventory(ll.GetScriptName())
    end
end

local function new_controller(id: string)
    CONTROLLER = id
    controllerName = ll.Key2Name(K(CONTROLLER))
    ll.ListenRemove(menu_handle)
    menu_channel = randomChannel()
    menu_handle = ll.Listen(menu_channel, "", K(CONTROLLER), "")
end

local function no_sensor_results()
    stopSearch() -- expecting_relay_results = FALSE (and drop the pending timeout)
    local menu_items = {}
    if CONTROLLER == owner() then
        table.insert(menu_items, "[SECURITY]")
    end
    dialog("No avatars found in range!", menu_items)
end

local function get_unique_channels()
    RELAY_SEARCH_CHANNEL = math.floor(ll.Frand(999999936)) + 1 -- 999999936 = max float < 1e9
    RELAY_GETCAPTURESTATUSchannel = RELAY_SEARCH_CHANNEL + 2
    RELAY_CHECK_CHANNEL = RELAY_SEARCH_CHANNEL + 4
    ASKROLE_CHANNEL = randomChannel()
    ll.ListenRemove(relay_handle)
    ping = "ping," .. tostring(ll.GetKey()) .. ",ping,ping"
    relay_handle = ll.Listen(RELAY_CHANNEL, "", NULL_KEY, ping)
end

local function check_submissive()
    relay(SLAVE, "@versionnew=" .. tostring(RELAY_CHECK_CHANNEL))
    slaveWearingRelay = -1
    -- The LSL used llSensorRepeat(owner, PASSIVE, ...) that never matches, as a 2 s timer.
    stopCheck()
    checkTimer = LLTimers:once(2, task(function()
        checkTimer = nil
        if slaveWearingRelay == -1 then
            slaveWearingRelay = 0
            rlv_top_menu()
        end
    end))
    slaveName = ll.Key2Name(K(SLAVE))
end

-- One page of a menu with one button per sitter (upstream: at most 12 buttons).
-- When everything fits in one dialog (12 buttons) there is a single page.
-- Otherwise each page shows as many names as fit, padded with " ", then the
-- fixed buttons, then PAGE_PREV / PAGE_NEXT (pages wrap around).
local PAGE_PREV, PAGE_NEXT = "[<<]", "[>>]"
local function pageOf(items: {string}, fixed: {string}, page: number): ({string}, number)
    local out = {}
    if #items + #fixed <= 12 then
        table.move(items, 1, #items, 1, out)
        table.move(fixed, 1, #fixed, #out + 1, out)
        return out, 0
    end
    local per = 12 - #fixed - 2
    local pages = (#items + per - 1) // per
    page %= pages
    table.move(items, page * per + 1, math.min(page * per + per, #items), 1, out)
    while #out < per do
        table.insert(out, " ")
    end
    table.move(fixed, 1, #fixed, #out + 1, out)
    table.insert(out, PAGE_PREV)
    table.insert(out, PAGE_NEXT)
    return out, page
end

local sub_select_page = 0 -- page of the "Which <submissive>?" menu

local function select_submissive_rlv()
    menu = "SUB_SELECT"
    local text = "RLV ▸ which " .. string.lower(Submissive_name) .. "?"
    SITTERS_MENUKEYS = {}
    local menu_items = {}
    for i, role in SITTER_DESIGNATIONS_MASTER do
        if role == "S" then
            local k = at0(DESIGNATIONS_NOW, i - 1)
            if isKey(k) then
                table.insert(menu_items, shortName(k))
                table.insert(SITTERS_MENUKEYS, k)
            end
        end
    end
    SITTERS_SHORTNAMES = menu_items -- not modified below (pageOf copies it)
    if #menu_items == 0 then
        text = "RLV ▸ there are no " .. string.lower(Submissive_name_plural) .. " sitting."
    end
    local fixed = {}
    if table.find(DESIGNATIONS_NOW, "S") and #SITTING_AVATARS < #DESIGNATIONS_NOW then
        text ..= "\n\nChoose someone to open their RLV menu.\n" .. B_CAPTURE_NEW .. " = capture an avatar nearby who wears an RLV relay."
        table.insert(fixed, B_CAPTURE_NEW)
    elseif #menu_items == 1 then
        SLAVE = SITTERS_MENUKEYS[1]
        check_submissive()
        return
    end
    menu_items, sub_select_page = pageOf(menu_items, fixed, sub_select_page)
    dialog(text, menu_items)
end

local function find_seat(id: string, index: number, msg: string, captureSub: boolean)
    if index == -1 then
        return
    end
    if msg == Dominant_name or msg == "D" then
        msg = "D"
    else
        msg = "S"
    end
    local first_available = index
    local current = find0(DESIGNATIONS_NOW, id)
    if current ~= -1 then
        first_available = current
    elseif at0(DESIGNATIONS_NOW, index) ~= msg then
        first_available = find0(DESIGNATIONS_NOW, msg)
    end
    if first_available ~= -1 then
        if msg == "D" then
            playpose(DOMPOSE, tostring(first_available))
        elseif captureSub then
            capture_attempt(id, tostring(first_available))
        end
        if first_available ~= index then
            if hasScript(main_script .. " 1") then
                wait(1) -- upstream: llSleep(1)
                ll.MessageLinked(LINK_SET, 90030, tostring(index), tostring(first_available))
                ignorenextswap = true
            end
        end
        set0(DESIGNATIONS_NOW, first_available, id)
        if not table.find(DESIGNATIONS_NOW, "S") then
            for i = #CAPTIVES, 1, -1 do
                if not table.find(SITTING_AVATARS, CAPTIVES[i].id) then
                    table.remove(CAPTIVES, i)
                end
            end
        end
        hovertext()
        sendDesignations()
        if msg == "D" then
            wait(1) -- upstream: llSleep(1)
            ll.MessageLinked(LINK_THIS, 90007, "", id)
        end
    else
        ll.UnSit(K(id))
        info_dialog(id, "there no available seats for " .. (if msg == "D" then Dominant_name else Submissive_name))
    end
end

local function back(id: string)
    if table.find(SITTING_AVATARS, id) then
        ll.MessageLinked(LINK_SET, 90005, "", id)
    else
        ll.MessageLinked(LINK_THIS, 90007, "", id)
    end
end

local function isSub(id: string, doDialog: boolean): boolean
    local index = find0(DESIGNATIONS_NOW, id)
    if index ~= -1 and at0(SITTER_DESIGNATIONS_MASTER, index) == "S" then
        if doDialog then
            info_dialog(id, Submissive_name_plural .. " can't access this")
        end
        return true
    end
    return false
end

-- 90100 "Control..." (also the [BACK] of the Restrict / Un/Dress menus)
local function controlMenu(id: string, target: string)
    if isSub(id, true) then
        return
    end
    if controllerHasKeys and id ~= CONTROLLER then
        info_dialog(id, "this item is locked by " .. controllerName)
        return
    end
    new_controller(id)
    if target == id then
        sub_select_page = 0
        select_submissive_rlv()
        return
    end
    SLAVE = target
    check_submissive()
end

--------------------------------------------------------------------------
-- X: Restrict and Un/Dress menus (upstream: [AV]root-RLV-extra)
--------------------------------------------------------------------------
local CLOTHING_LAYERS = {"gloves", "jacket", "pants", "shirt", "shoes", "skirt", "socks", "underpants", "undershirt", "", "", "", "", "alpha", "tattoo"}
local ATTACHMENT_POINTS = {"", "chest", "skull", "left shoulder", "right shoulder", "left hand", "right hand", "left foot", "right foot", "spine", "pelvis", "mouth", "chin", "left ear", "right ear", "left eyeball", "right eyeball", "nose", "r upper arm", "r forearm", "l upper arm", "l forearm", "right hip", "r upper leg", "r lower leg", "left hip", "l upper leg", "l lower leg", "stomach", "left pec", "right pec", "", "", "", "", "", "", "", "", "neck", "root"}
type Restriction = { label: string, commands: string, description: string }
local RLV_RESTRICTIONS: {Restriction} = {
    { label = "Chat", commands = "sendchat", description = "sending chat" },
    { label = "IM", commands = "sendim", description = "sending IM" },
    { label = "Touch", commands = "touchall", description = "touching" },
    { label = "Names", commands = "shownames", description = "seeing names" },
    { label = "Rez/Edit", commands = "edit,rez", description = "editing and rezzing objects" },
    { label = "Inventory", commands = "showinv", description = "accessing their inventory" },
    { label = "Map", commands = "showworldmap,showminimap", description = "seeing their map" },
    { label = "Location", commands = "showloc", description = "seeing their location" },
}
local iconActive = "✘ "
local iconInactive = "✔ "
local iconEmpty = "○"
local iconHalf = "◑"
local iconFull = "●"
local iconAdd = "[➕]"
local iconSubtract = "[➖]"

local X = {
    product = "", -- "Un/Dress" or "Restrict" (menu title)
    controller = "",
    slave = "",
    menu = "",
    menuPage = 0,
    menuChannel = 0,
    menuHandle = 0,
    statusChannel = 0,
    statusHandle = 0,
    folderPath = {} :: {string},
    folderOptions = {} :: {string},
    folderNamesFullLength = {} :: {string},
    pagedMenuText = "",
    pagedMenuButtons = {} :: {string},
}

-- FIX: llDialog refuses a button longer than 24 bytes (the whole menu fails). Upstream
-- cut folder names to 13 characters, which is too long for names with accents or
-- other non-ASCII characters. Cut whole characters until `s .. suffix` fits.
local function fitButton(s: string, suffix: string): string
    local n = utf8.len(s) or #s
    while #s + #suffix > 24 and n > 0 do
        n -= 1
        s = ll.GetSubString(s, 1, n)
    end
    return s .. suffix
end

-- pads `buttons` in place (every caller passes a fresh table)
local function xDialog(text: string, buttons: {string})
    while #buttons % 3 ~= 0 do
        table.insert(buttons, " ")
    end
    ll.Dialog(K(X.controller), product .. " " .. X.product .. " " .. version .. "\n\n" .. text, orderButtons(buttons), X.menuChannel)
end

local function xPagedMenu()
    local buttons = X.pagedMenuButtons
    local page = buttons
    local n = #buttons
    if n > 11 then
        local numberPages = (n + 8) // 9
        if X.menuPage >= numberPages then
            X.menuPage = 0
        elseif X.menuPage < 0 then
            X.menuPage = numberPages - 1
        end
        page = table.move(buttons, X.menuPage * 9 + 1, math.min(X.menuPage * 9 + 9, n), 1, {})
        while #page < 9 do
            table.insert(page, " ")
        end
        table.insert(page, "[<<]")
        table.insert(page, "[>>]")
    end
    xDialog(X.pagedMenuText, table.move(page, 1, #page, 2, {"[BACK]"}))
end

local function xNewPagedMenu(text: string, menu_items: {string})
    X.pagedMenuText = text
    X.pagedMenuButtons = menu_items
    X.menuPage = 0
    xPagedMenu()
end

local function xRemoveMenu(worn: string, slots: {string})
    local menu_items = {}
    for i, slot in slots do
        if slot ~= "" and string.sub(worn, i, i) == "1" then
            table.insert(menu_items, slot)
        end
    end
    local text = "'s RLV setup may prevent some items from being removed.\n\nSelect an item to remove:"
    if #menu_items == 0 then
        text = " is not wearing any items to " .. string.lower(X.menu) .. "."
    end
    xNewPagedMenu(X.menu .. " menu for " .. ll.Key2Name(K(X.slave)) .. "\n\nThe captive" .. text, menu_items)
end

local function xMainMenu()
    X.menu = ""
    xDialog("Un/Dress menu for " .. ll.Key2Name(K(X.slave)), {"[BACK]", "Browse #RLV", "Fast Strip", "Undress", "Detach"})
end

local function xGetInvWorn(slave: string, path: string, channel: number)
    relay(slave, "@getinvworn:" .. path .. "=" .. tostring(channel))
end

-- upstream: link messages 90208 (Un/Dress) / 90209 (Restrict) to [AV]root-RLV-extra
local function xOpen(slave: string, controller: string, title: string, undress: boolean)
    X.slave = slave
    X.controller = controller
    X.product = title
    ll.ListenRemove(X.menuHandle)
    ll.ListenRemove(X.statusHandle)
    X.menuChannel = randomChannel()
    X.menuHandle = ll.Listen(X.menuChannel, "", K(X.controller), "")
    X.statusChannel = 64 + math.floor(ll.Frand(999999936)) -- 999999936 = max float < 1e9
    X.statusHandle = ll.Listen(X.statusChannel, "", NULL_KEY, "")
    if undress then
        xMainMenu()
    else
        X.menu = "Restrict"
        relay(X.slave, "@getstatus=" .. tostring(X.statusChannel))
    end
end

local function xClose()
    ll.ListenRemove(X.menuHandle)
    ll.ListenRemove(X.statusHandle)
    X.menuHandle = 0
    X.statusHandle = 0
    X.slave = ""
end

local function xMenuListen(msg: string)
    local command
    if msg == "[>>]" or msg == "[<<]" then
        if msg == "[<<]" then
            X.menuPage -= 1
        else
            X.menuPage += 1
        end
        xPagedMenu()
    elseif X.menu == "Browse #RLV" then
        local index = table.find(X.folderOptions, msg)
        if index then
            table.insert(X.folderPath, X.folderNamesFullLength[index])
            xGetInvWorn(X.slave, table.concat(X.folderPath, "/"), X.statusChannel)
        elseif msg == "[BACK]" then
            if #X.folderPath == 0 then
                xMainMenu()
            else
                table.remove(X.folderPath)
                xGetInvWorn(X.slave, table.concat(X.folderPath, "/"), X.statusChannel)
            end
        elseif msg == iconAdd or msg == iconSubtract then
            command = if msg == iconSubtract then "detach" else "attach"
            local slave, path, channel = X.slave, table.concat(X.folderPath, "/"), X.statusChannel
            relay(slave, "@" .. command .. ":" .. path .. "=force")
            LLTimers:once(4, task(function() -- upstream: llSleep(4)
                xGetInvWorn(slave, path, channel)
            end))
        end
    elseif msg == "[BACK]" then
        if X.menu == "Restrict" or X.menu == "" then
            controlMenu(X.controller, X.slave) -- upstream: 90100 "0|Control...|<captive>"
        else
            xMainMenu()
        end
    elseif X.menu == "Detach" or X.menu == "Undress" then
        command = "outfit"
        local index = table.find(CLOTHING_LAYERS, msg)
        if not index then
            index = table.find(ATTACHMENT_POINTS, msg)
            command = "attach"
        end
        if index then
            local slave, channel, cmd = X.slave, X.statusChannel, command
            relay(slave, "@rem" .. cmd .. ":" .. msg .. "=force")
            LLTimers:once(2, task(function() -- upstream: llSleep(2)
                relay(slave, "@get" .. cmd .. "=" .. tostring(channel))
            end))
        end
    elseif msg == "Detach" or msg == "Undress" or msg == "Browse #RLV" then
        X.menu = msg
        X.folderPath = {}
        command = if msg == "Detach" then "getattach" elseif msg == "Browse #RLV" then "getinvworn" else "getoutfit"
        relay(X.slave, "@" .. command .. "=" .. tostring(X.statusChannel))
    elseif msg == "Fast Strip" then
        X.menu = "fs"
        xDialog("Are you really sure? This will try to remove almost everything the avatar is wearing.", {"[BACK]", "YES!"})
    elseif msg == "YES!" then
        for _, layer in CLOTHING_LAYERS do
            if layer ~= "" then
                relay(X.slave, "@remoutfit:" .. layer .. "=force")
            end
        end
        for _, point in ATTACHMENT_POINTS do
            if point ~= "" and point ~= "skull" then -- skull (index 2) is spared
                relay(X.slave, "@remattach:" .. point .. "=force")
            end
        end
        xMainMenu()
    else
        local word = L(ll.ParseString2List(msg, {" "}, {}), 2)
        local r: Restriction? = nil
        for _, candidate in RLV_RESTRICTIONS do
            if candidate.label == word then
                r = candidate
                break
            end
        end
        if r then
            local subRestrictions = ll.ParseString2List(r.commands, {","}, {})
            local param = "n"
            local chatText = replace(ll.Key2Name(K(X.slave)), " Resident", "") .. " is "
            if contains(msg, iconActive) then
                param = "y"
                chatText ..= "no longer "
            end
            for _, sub in subRestrictions do
                relay(X.slave, "@" .. sub .. "=" .. param)
            end
            ll.Say(0, chatText .. "restricted from " .. r.description .. ".")
            relay(X.slave, "@getstatus=" .. tostring(X.statusChannel))
        end
    end
end

local function xStatusListen(msg: string)
    if X.menu == "Browse #RLV" then
        X.folderOptions = {}
        X.folderNamesFullLength = {}
        local buttons = {}
        local results = split(msg, ",")
        local folderInfo = ""
        local subInfo = ""
        for i, result in results do
            local item = split(result, "|")
            local folder = L(item, 1)
            local worn = int(L(item, 2))
            local wornThis = worn // 10
            local wornSub = worn % 10
            local icon = "no items"
            if i > 1 then
                if wornThis ~= 0 or wornSub ~= 0 then
                    icon = iconEmpty
                    if wornThis > 1 or wornSub > 1 then
                        icon = iconHalf
                    end
                    if (wornThis == 3 and wornSub == 0) or (wornThis == 0 and wornSub == 3) or (wornThis == 3 and wornSub == 3) then
                        icon = iconFull
                    end
                    local base = icon .. " " .. ll.GetSubString(folder, 1, 13)
                    local label = fitButton(base, "")
                    -- two folders cut to the same label: number the later ones, so each
                    -- button still opens its own folder
                    local copy = 1
                    while table.find(X.folderOptions, label) do
                        copy += 1
                        label = fitButton(base, "~" .. tostring(copy))
                    end
                    table.insert(X.folderOptions, label)
                    table.insert(X.folderNamesFullLength, folder)
                    subInfo = "\nSubfolders:\n" .. iconEmpty .. " = none worn\n" .. iconHalf .. " = some worn\n" .. iconFull .. " = all worn"
                end
            else
                if wornThis ~= 0 then
                    icon = "none worn"
                    if wornThis == 2 then
                        icon = "some worn"
                    end
                    if wornThis == 3 then
                        icon = "all worn"
                    end
                    table.insert(buttons, iconAdd)
                    table.insert(buttons, iconSubtract)
                    folderInfo = "\n" .. iconAdd .. " = wear\n" .. iconSubtract .. " = remove\n"
                end
                msg = "Folder: /" .. table.concat(X.folderPath, "/") .. "\n[" .. icon .. "]\n" .. folderInfo
            end
        end
        if #X.folderOptions == 0 and #buttons == 0 then
            msg = "#RLV folder empty"
        end
        table.move(X.folderOptions, 1, #X.folderOptions, #buttons + 1, buttons)
        xNewPagedMenu(msg .. subInfo, buttons)
    elseif X.menu == "Detach" then
        xRemoveMenu(msg, ATTACHMENT_POINTS)
    elseif X.menu == "Undress" then
        xRemoveMenu(msg, CLOTHING_LAYERS)
    elseif X.menu == "Restrict" then
        local currentRestrictions = ll.ParseString2List(msg, {"/"}, {})
        local menu_items = {"[BACK]"}
        for _, r in RLV_RESTRICTIONS do
            local inActive = false
            for _, sub in ll.ParseString2List(r.commands, {","}, {}) do
                if not table.find(currentRestrictions, sub) then
                    inActive = true
                    break
                end
            end
            local btntext = (if inActive then iconInactive else iconActive) .. r.label
            -- padded to 20 characters (labels are valid UTF-8)
            table.insert(menu_items, btntext .. string.rep(" ", 20 - (utf8.len(btntext) or 0)) .. ".")
        end
        xDialog("RLV for " .. ll.Key2Name(K(X.slave)) .. "\n\n" .. iconInactive .. "= Allowed\n" .. iconActive .. "= Restricted", menu_items)
    end
end

--------------------------------------------------------------------------
-- notecard
--------------------------------------------------------------------------
local function parseLine(raw: string)
    local data = raw
    -- strip a chat prefix up to the DUMP marker, like [LS]sit does
    local mark = string.find(data, "◆", 1, true)
    if mark then
        data = string.sub(data, mark + #"◆")
    end
    data = ll.StringTrim(data, STRING_TRIM)
    local command, rest
    local sp = string.find(data, " ", 1, true)
    if sp then
        command = string.sub(data, 1, sp - 1)
        rest = string.sub(data, sp + 1)
    else
        command = ll.GetSubString(data, 1, -2) -- LSL quirk: llGetSubString(data, 0, -2)
        rest = data
    end
    local parts = ll.ParseStringKeepNulls(rest, {" | ", " |", "| ", "|"}, {})
    local part0 = ll.GetSubString(ll.StringTrim(L(parts, 1), STRING_TRIM), 1, 23)
    if DUMP_COMMANDS[command] then
        table.insert(dumpLines, data)
    end
    if command == "WAITPOSE" then
        WAITPOSE = part0
        playpose(WAITPOSE, "")
    elseif command == "RLV" then
        RLV_ON = int(part0)
    elseif command == "SUBCONTROL" then
        subControl = int(part0)
    elseif command == "HTEXT" then
        HTEXT = int(part0)
    elseif command == "DOMPOSE" then
        DOMPOSE = part0
    elseif command == "SUBPOSE" then
        SUBPOSE = part0
    elseif command == "ONTOUCH" then
        onTouch = part0
    elseif command == "ONSIT" then
        onSit = part0
        if onSit == "ASKONLY" then
            onSit = "ASK"
            captureOnAsk = false
        end
    elseif command == "BRAND" then
        product = part0
    elseif command == "RECAPTURE" then
        autoRecapture = int(part0)
    elseif command == "ROLES" then
        SITTER_DESIGNATIONS_MASTER = parts
        DESIGNATIONS_NOW = table.clone(SITTER_DESIGNATIONS_MASTER)
        sendDesignations()
    elseif command == "TIMELOCK" then
        defaultTimelock = int(part0) * 60
        TimelockSecUntilRelease = defaultTimelock
    elseif command == "ONCAPTURE" then
        baseCaptureRestrictions = table.concat(parts, "|")
    elseif command == "ONRELEASE" then
        baseReleaseRestrictions = table.concat(parts, "|")
    end
end

--------------------------------------------------------------------------
-- events (LSL "state running")
--------------------------------------------------------------------------
-- The link message numbers onLinkMessage acts on (keep in step with it): other numbers
-- are dropped before a task is created for them, as they would do nothing.
local LINK_NUMS: {[number]: boolean} = {
    [90030] = true, [90032] = true, [90045] = true, [90060] = true, [90070] = true,
    [90065] = true, [90012] = true, [90015] = true, [90100] = true, [90201] = true,
    [90211] = true, [90208] = true, [90209] = true, [90020] = true,
}

local function onLinkMessage(sender: number, num: number, msg: string, id: string)
    local one = int(msg)
    if num == 90030 or num == 90032 then -- 90032: swap and return the menu (issue #140)
        if not ignorenextswap then
            local two = int(id)
            local des1 = at0(DESIGNATIONS_NOW, one)
            local des2 = at0(DESIGNATIONS_NOW, two)
            local role1 = at0(SITTER_DESIGNATIONS_MASTER, one)
            local role2 = at0(SITTER_DESIGNATIONS_MASTER, two)
            if role1 ~= role2 then
                release_all()
            end
            set0(DESIGNATIONS_NOW, two, if isKey(des1) then des1 else role2)
            set0(DESIGNATIONS_NOW, one, if isKey(des2) then des2 else role1)
            sendDesignations()
        end
        ignorenextswap = false
    elseif num == 90045 then
        if sender == ll.GetLinkNumber() then
            local data = split(msg, "|")
            SITTERS = split(L(data, 5), "@")
            -- PR #149: keep / restore the captive's pose
            local c = captiveRecord(id)
            if c then
                local new_pose = L(data, 2) -- FIX: PR #149 declared it inside the first branch only
                if c.flag == POSE_RETURNED then
                    if new_pose ~= c.pose and c.pose ~= "" and c.tries < MAX_RESTORE_TRIES then
                        -- reapply the previous pose
                        -- FIX: limited number of tries (a pose that cannot be played looped forever)
                        c.tries += 1
                        ll.MessageLinked(LINK_THIS, 90000, c.pose, id)
                    else
                        -- the pose is right, or there was no previous pose
                        c.pose = new_pose
                        c.flag = POSE_NORMAL
                        c.tries = 0
                    end
                elseif c.flag == POSE_NORMAL then
                    c.pose = new_pose
                end
                -- POSE_GONE: unsat / logged off, keep the last pose
            end
        end
    elseif num == 90060 then
        menu = ""
        table.insert(SITTING_AVATARS, id)
        -- ONSIT CAPTURE or a force-sit: give them a submissive seat, whatever
        -- sitter number they got, and capture them as they sit
        if onSit == "CAPTURE" or CONTROLLER .. id == PairWhoStartedCapture then
            if table.find(DESIGNATIONS_NOW, "S") then
                find_seat(id, one, Submissive_name, true)
            end
        end
    elseif num == 90070 then
        -- This is the first message where we know the sitter number
        if find0(DESIGNATIONS_NOW, id) == -1 then
            if onSit == "CAPIFSUB" then
                find_seat(id, one, at0(DESIGNATIONS_NOW, one), true)
            elseif onSit == "ASK" then
                ask_role(id)
            elseif onSit == "NONE" then
                set0(DESIGNATIONS_NOW, one, id)
            end
        end
        -- PR #149: a captive has just sat again, restore their last pose
        local c = captiveRecord(id)
        if c and c.flag == POSE_GONE then
            c.flag = POSE_RETURNED
            c.tries = 0
        end
    elseif num == 90065 then
        playpose(WAITPOSE, msg)
        local index = table.find(SITTING_AVATARS, id)
        if index then
            table.remove(SITTING_AVATARS, index)
        end
        local d = find0(DESIGNATIONS_NOW, id)
        if d ~= -1 then
            local role = SITTER_DESIGNATIONS_MASTER[d + 1]
            if role then
                DESIGNATIONS_NOW[d + 1] = role
            else
                -- llListReplaceList with an empty llList2List deleted the entry
                table.remove(DESIGNATIONS_NOW, d + 1)
            end
            sendDesignations()
        end
        -- PR #149: a captive has just unsat / logged off, remember to restore their pose
        local c = captiveRecord(id)
        if c then
            c.flag = POSE_GONE
        end
        -- upstream: in [AV]root-RLV-extra
        if id == X.slave then
            xClose()
        end
    elseif num == 90012 then
        if findCaptive(id) then
            if subControl ~= 0 then
                ll.MessageLinked(LINK_THIS, 90007, "", id)
            else
                info_dialog(id, "captives can't access the menu. Enjoy your captivity :)")
            end
            return
        end
        activePrim = one
        if #SITTING_AVATARS == 0 then
            if controllerHasKeys and id ~= CONTROLLER then
                reset()
            end
            if onTouch == "NONE" then
                return
            elseif onTouch == "CAPTURE" then
                relay(id, "@sit:" .. tostring(ll.GetLinkKey(activePrim)) .. "=force")
                CONTROLLER = id
                PairWhoStartedCapture = CONTROLLER .. id
                return
            end
        else
            local designationIndex = find0(DESIGNATIONS_NOW, id)
            local isSitting = table.find(SITTING_AVATARS, id) ~= nil
            if isSitting then
                if RLV_ON ~= 0 and designationIndex ~= -1 and at0(SITTER_DESIGNATIONS_MASTER, designationIndex) == "S" then
                    if subControl ~= 0 then
                        ll.MessageLinked(LINK_THIS, 90007, "", id)
                    else
                        info_dialog(id, Submissive_name_plural .. " can't access the menu")
                    end
                    return
                end
                if onSit == "ASK" and designationIndex == -1 then
                    ask_role(id)
                    return
                end
            else
                for i, role in SITTER_DESIGNATIONS_MASTER do
                    if role == "D" and at0(DESIGNATIONS_NOW, i - 1) ~= "D" then
                        return
                    end
                end
            end
            if controllerHasKeys and id ~= CONTROLLER then
                -- designationIndex -1 reads the last role, as the LSL did
                if isSitting and at0(SITTER_DESIGNATIONS_MASTER, designationIndex) == "D" then
                    ll.MessageLinked(LINK_THIS, 90007, "", id)
                    return
                end
                info_dialog(id, "this item is locked by " .. controllerName)
                return
            end
        end
        ll.MessageLinked(LINK_THIS, 90007, "", id)
    elseif num == 90015 then
        if isKey(id) then
            if isSub(id, false) then
                return
            end
            if not controllerHasKeys or id == CONTROLLER then
                doNotSayReleaseMessage = one
                stop()
            end
        else
            if not controllerHasKeys then
                doNotSayReleaseMessage = one
                stop()
            end
        end
        doNotSayReleaseMessage = 0
    elseif num == 90100 then
        local data = ll.ParseString2List(msg, {"|"}, {})
        local button = L(data, 2)
        if button == "[STOP]" then
            if isSub(id, true) then
                return
            end
            stop()
        elseif button == "Control..." then
            controlMenu(id, L(data, 3))
        end
    elseif num == 90201 then
        playpose(WAITPOSE, "")
    elseif num == 90211 then
        if table.find(DESIGNATIONS_NOW, "S") then
            new_controller(id)
            start_relay_search()
        end
    elseif num == 90208 or num == 90209 then
        -- not sent by this script; answered for third-party scripts
        local data = split(id, "|")
        xOpen(L(data, 1), L(data, 2), L(data, 3), num == 90208)
    elseif num == 90020 then
        -- DUMP for [LS]adjuster (issue #18)
        if id == ll.GetScriptName() then
            if msg == "0" then
                for _, line in dumpLines do
                    ll.MessageLinked(LINK_THIS, 90022, line, msg)
                end
            end
            ll.MessageLinked(LINK_THIS, 90021, msg, ll.GetScriptName())
        end
    end
end

local function onMenu(id: string, msg: string)
    if msg == "[SECURITY]" then
        ll.MessageLinked(LINK_THIS, 90100, "0|[SECURITY]", owner())
    elseif msg == "[BACK]" then
        if menu ~= "" then
            rlv_top_menu()
        else
            back(id)
        end
    elseif menu == "SUB_SELECT" then
        local index = table.find(SITTERS_SHORTNAMES, msg)
        if (msg == PAGE_PREV or msg == PAGE_NEXT) and not index then
            sub_select_page += if msg == PAGE_NEXT then 1 else -1
            select_submissive_rlv()
        elseif msg == " " and not index then
            select_submissive_rlv() -- blank filler button of a paged menu
        elseif index then
            SLAVE = SITTERS_MENUKEYS[index]
            check_submissive()
        elseif msg == B_CAPTURE_NEW or msg == "Capture..." then
            start_relay_search()
        end
    elseif menu == "SELECT" then
        local index = table.find(DETECTED_AVATAR_SHORTNAMES, msg)
        if index then
            local target = DETECTED_AVATAR_KEYS[index]
            if target == CONTROLLER then
                info_dialog(CONTROLLER, "you can not capture yourself")
            else
                if RLV_ON ~= 0 then
                    controllerHasKeys = true
                end
                TimelockPaused = true
                stopTimelock()
                PairWhoStartedCapture = CONTROLLER .. target
                if table.find(SITTING_AVATARS, target) then
                    capture_attempt(target, "")
                else
                    local linkkey = tostring(ll.GetLinkKey(activePrim))
                    if linkkey == NULL then
                        linkkey = tostring(ll.GetKey())
                    end
                    relay(target, "@sit:" .. linkkey .. "=force")
                end
            end
        end
    elseif menu == "Timelock" then
        local plusMinus = 0
        local first = ll.GetSubString(msg, 1, 1)
        if first == "-" then
            plusMinus = -1
        elseif first == "+" then
            plusMinus = 1
        end
        if plusMinus ~= 0 then
            local timechange = int(ll.GetSubString(msg, 2, -4)) * 60
            if ll.GetSubString(msg, -3, -1) == "hrs" then
                timechange *= 60
            end
            TimelockSecUntilRelease += timechange * plusMinus
            if TimelockSecUntilRelease < 0 then
                TimelockSecUntilRelease = 0
            end
            -- FIX: with no TIMELOCK line the countdown had stopped at capture time (time 0),
            -- so time added here stayed frozen until Stop / Start was pressed
            if timelockTimer == nil and not TimelockPaused and TimelockSecUntilRelease > 0
                and #SITTING_AVATARS > 0 then
                startTimelock()
            end
        elseif msg == "Stop" or msg == "Start" then
            TimelockPaused = not TimelockPaused
            startTimelock()
        elseif msg == "Hide" or msg == "Show" then
            TimelockHidden = not TimelockHidden
        else
            return
        end
        Timelock_menu()
    elseif msg == "[STOP]" then
        stop()
    elseif msg == B_POSES or msg == "Menu..." then
        ll.MessageLinked(LINK_SET, 90004, "", id .. "|" .. SLAVE)
    elseif msg == "Un/Dress" then
        xOpen(SLAVE, CONTROLLER, msg, true) -- upstream: 90208
    elseif msg == "Restrict" then
        xOpen(SLAVE, CONTROLLER, msg, false) -- upstream: 90209
    elseif msg == B_LOCK or msg == "Take Keys" then
        controllerHasKeys = true
        rlv_top_menu()
        ll.Say(0, controllerName .. " takes the keys.")
    elseif msg == B_UNLOCK or msg == "Drop Keys" then
        controllerHasKeys = false
        rlv_top_menu()
        ll.Say(0, controllerName .. " relinquishes the keys.")
    elseif msg == "Timelock" then
        Timelock_menu()
    elseif msg == B_CAPTURE or msg == "Capture!" then
        controllerHasKeys = true
        TimelockPaused = true
        stopTimelock()
        PairWhoStartedCapture = CONTROLLER .. SLAVE
        local index = find0(SITTERS, SLAVE)
        if index == -1 then
            index = 0
        end
        find_seat(SLAVE, index, Submissive_name, true)
        check_submissive()
    elseif msg == B_RELEASE or msg == "Release!" then
        release(SLAVE, true)
        CONTROLLER = id
    end
    hovertext()
end

local function onListen(channel: number, _name: string, idk: uuid, msg: string)
    local id = tostring(idk)
    if channel == ASKROLE_CHANNEL then
        if table.find(SITTING_AVATARS, id) then
            find_seat(id, find0(SITTERS, id), msg, captureOnAsk)
        end
    elseif channel == RELAY_GETCAPTURESTATUSchannel then
        local newSlave = tostring(ll.GetOwnerKey(idk))
        local newSlaveName = ll.Key2Name(K(newSlave))
        if table.find(SITTING_AVATARS, newSlave) then
            if #CAPTIVES == 0 then
                TimelockSecUntilRelease = defaultTimelock
            end
            ll.Say(0, newSlaveName .. " was captured!")
            if not findCaptive(newSlave) then
                table.insert(CAPTIVES, { name = newSlaveName, id = newSlave, pose = "", flag = POSE_NORMAL, tries = 0 })
                if #CAPTIVES > #DESIGNATIONS_NOW then
                    table.remove(CAPTIVES, 1)
                end
            end
            startTimelock()
            if PairWhoStartedCapture == CONTROLLER .. newSlave then
                PairWhoStartedCapture = "NA"
                hovertext()
            else
                if CONTROLLER == newSlave then
                    controllerHasKeys = false
                    CONTROLLER = ""
                end
                TimelockPaused = false
            end
        end
    elseif channel == RELAY_CHANNEL then
        if msg == ping then
            local relayOwner = tostring(ll.GetOwnerKey(idk))
            local index = findCaptive(relayOwner)
            if index then
                if autoRecapture ~= 0 and table.find(DESIGNATIONS_NOW, "S") then
                    if isKey(CONTROLLER) then
                        PairWhoStartedCapture = CONTROLLER .. relayOwner
                    end
                    ll.RegionSay(RELAY_CHANNEL, "ping," .. relayOwner .. ",!pong")
                    return
                end
                table.remove(CAPTIVES, index)
            end
        end
    elseif channel == RELAY_CHECK_CHANNEL then
        slaveWearingRelay = 1
        rlv_top_menu()
        stopCheck()
    elseif channel == RELAY_SEARCH_CHANNEL and expecting_relay_results then
        local relayOwner = tostring(ll.GetOwnerKey(idk))
        if not table.find(DETECTED_AVATAR_KEYS, relayOwner) then
            table.insert(DETECTED_AVATAR_KEYS, relayOwner)
            table.insert(DETECTED_AVATAR_SHORTNAMES, shortName(relayOwner))
            if #DETECTED_AVATAR_KEYS == expected_number then
                setSearchTimer(0.01)
            end
        end
    elseif channel == menu_channel then
        onMenu(id, msg)
    elseif channel == X.menuChannel then
        xMenuListen(msg)
    elseif channel == X.statusChannel then
        xStatusListen(msg)
    end
end

local function startRunning()
    local linkTask = task(onLinkMessage)
    LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
        if LINK_NUMS[num] then
            linkTask(sender, num, msg, id)
        end
    end)
    LLEvents:on("listen", task(onListen))

    -- sensor: relay search only (the relay check uses a timer)
    LLEvents:on("sensor", task(function(detected: {DetectedEvent})
        expected_number = #detected
        for i = 1, math.min(#detected, 10) do
            relay(tostring(detected[i]:getKey()), "@versionnew=" .. tostring(RELAY_SEARCH_CHANNEL))
        end
    end))

    LLEvents:on("no_sensor", task(function()
        no_sensor_results()
    end))

    LLEvents:on("changed", task(function(change: number)
        if bit32.band(change, CHANGED_LINK) ~= 0 then
            if ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) == ZERO_VECTOR then
                DESIGNATIONS_NOW = table.clone(SITTER_DESIGNATIONS_MASTER)
                SITTING_AVATARS = {}
                stopTimelock()
                stopSearch()
                ll.ListenRemove(menu_handle)
                ll.ListenRemove(ASKROLEhandle)
                ll.ListenRemove(GETCAPTURESTATUShandle)
                ll.ListenRemove(CHECKhandle)
                playpose(WAITPOSE, "")
            else
                -- FIX: remove before re-adding (the LSL leaked two listens per link change)
                ll.ListenRemove(ASKROLEhandle)
                ll.ListenRemove(CHECKhandle)
                ASKROLEhandle = ll.Listen(ASKROLE_CHANNEL, "", NULL_KEY, "")
                CHECKhandle = ll.Listen(RELAY_CHECK_CHANNEL, "", NULL_KEY, "")
            end
            hovertext()
        end
        if bit32.band(change, CHANGED_INVENTORY) ~= 0 then
            if notecard_key ~= posCardSig() then
                ll.ResetScript()
            end
        end
    end))

    LLEvents:on("on_rez", task(function(_start: number)
        get_unique_channels()
    end))

    -- state_entry
    -- FIX: start with the default roles (the LSL left this empty until the first stand-up)
    DESIGNATIONS_NOW = table.clone(SITTER_DESIGNATIONS_MASTER)
    hovertext()
    get_unique_channels()
    notecard_key = posCardSig()
    if ll.GetInventoryType(notecard_name) == INVENTORY_NOTECARD then
        readNotecard(notecard_name, function(line: string, _n: number)
            parseLine(line)
        end, function(_total: number)
            Out(0, "Loaded, Memory: " .. tostring(ll.GetFreeMemory()))
        end)
    end
end

-- LSL "default" state: only one copy of this script is allowed
if string.find(ll.GetScriptName(), " ", 1, true) then
    remove_script("Use only one copy of this script!")
else
    startRunning()
end
