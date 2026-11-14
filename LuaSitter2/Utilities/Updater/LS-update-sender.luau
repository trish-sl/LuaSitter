--[[
  LS-update-sender - pushes updated scripts/items into nearby furniture
  LuaSitter: SLua port of AVsitter(TM) update-sender. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  Simple script used for updating a large number of furniture items at once.
  This script goes in a "sender" prim along with the latest copies of the
  (not running) scripts and inventory objects (e.g. prop objects).
  Touching the sender (owner or same group) gives a menu:

  Update  : as upstream. Asks on the PIN channel and updates all prims that
            answer from inside the range. With the Region range, it first
            names the objects found in chat and asks UPDATE / CANCEL.
  Range   : (LuaSitter) how far to look: 10 m, 20 m, Shout 100 m (default),
            Region, or Prim size (upstream: half the sender's X size, and
            never beyond 20 m because the search used llSay). The search is
            said, shouted or region-said to match; only prims of the same
            owner answer. Kept in the sender's linkset data.
  Migrate : (LuaSitter) replaces the AVsitter (LSL) scripts of the furniture in
            the range with their LuaSitter versions (docs/luasitter/
            migrating-from-avsitter.md):
            1. finds the prims with an update receiver, and puts this sender's
               LuaSitter receiver in those that have another one (an LSL
               receiver cannot delete scripts). Objects (props) are kept.
               A LuaSitter receiver under another name (e.g.
               "LS-update-receiver") is found too (MIGRATE_SEARCH).
            2. asks each receiver for its scripts and says the plan in chat
               (scripts removed, added, kept; scripts this sender lacks), then
               asks APPLY / CANCEL. Nothing is changed before APPLY.
            3. APPLY: loads the LuaSitter scripts NOT running, then tells the
               receiver to delete the AVsitter scripts and start the new ones,
               only if every new script arrived (else nothing is deleted).
            Copies keep their number ("[AV]sitA 2" -> "[LS]sit 2"). Notecards,
            objects and other scripts are not touched (AVpos keeps working;
            props with [AV]object keep working).
            The sender needs the LuaSitter receiver and every LuaSitter script
            (and copy) the plan adds.

  The chat protocol (OBJECT_SEARCH / OBJECT_HERE on channel -29752), the
  remote script access PIN and the receiver script name are identical to
  upstream, so this sender updates items carrying the LSL receiver and the
  LSL sender updates items carrying LS-update-receiver. The receiver script
  must be named "update receiver (auto removing)" in the inventories, as
  upstream. Migration adds MIGRATE_* messages that only LS-update-receiver
  answers.

  FIX: upstream asked once and waited a fixed 10 s, so slow furniture was
  missed ("Found 0 prims"). The sender asks again after 5 and 10 s and waits
  until the answers stop (see collect).
  FIX: upstream looped forever ("Processing prim 1/0"...) when no prim
  answered; the sender reports completion and resets.
  Behaviour changes:
  - Touching gives the Update / Migrate / Range menu (upstream: touching
    started the update).
  - The default range is 100 m from the sender (upstream: half the sender's
    X size; Range > Prim size keeps that rule).
  - After an update or migration the sender asks REMOVE / KEEP for the update
    receivers of the prims of the run (upstream kept them). REMOVE sends
    RECEIVER_REMOVE; LuaSitter receivers answer RECEIVER_REMOVED, clear their
    name label and delete themselves. LSL receivers cannot, and are listed to
    remove by hand.
]]

local pin = -29752
local receiver_script = "update receiver (auto removing)"

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

local function L(t: {any}, i: number): string
    local v = t[i]
    if v == nil then
        return ""
    end
    return tostring(v)
end

local NULL = tostring(NULL_KEY)

type Target = { id: string, files: string }
local targets: {Target} = {}
local av = NULL
-- "idle", "choose" (menu shown), "range" (range menu shown), "update-collect", "update-confirm", "update",
-- "remove-confirm", "remove",
-- "migrate-find", "migrate-push", "migrate-list", "migrate-confirm", "migrate-apply"
local mode = "idle"

local function particles_on(target: uuid)
    ll.ParticleSystem({
        PSYS_PART_FLAGS, bit32.bor(PSYS_PART_INTERP_COLOR_MASK, PSYS_PART_INTERP_SCALE_MASK, PSYS_PART_FOLLOW_VELOCITY_MASK,
            PSYS_PART_EMISSIVE_MASK, PSYS_PART_TARGET_POS_MASK),
        PSYS_SRC_PATTERN, PSYS_SRC_PATTERN_DROP,
        PSYS_PART_START_ALPHA, 1.0,
        PSYS_PART_END_ALPHA, 1,
        PSYS_PART_START_COLOR, vector(1, 0, 0),
        PSYS_PART_END_COLOR, vector(0, 0, 1),
        PSYS_PART_START_SCALE, vector(0.08, 0.2, 0),
        PSYS_PART_END_SCALE, vector(0.08, 0.2, 0),
        PSYS_PART_MAX_AGE, 2.0,
        PSYS_SRC_MAX_AGE, 0,
        PSYS_SRC_ACCEL, vector(0, 0, 0),
        PSYS_SRC_BURST_PART_COUNT, 250,
        PSYS_SRC_BURST_RADIUS, 0.0,
        PSYS_SRC_BURST_RATE, 0.05766,
        PSYS_SRC_BURST_SPEED_MIN, 0.07813,
        PSYS_SRC_BURST_SPEED_MAX, 0.15625,
        PSYS_SRC_INNERANGLE, 0.09375,
        PSYS_SRC_OUTERANGLE, 0.0,
        PSYS_SRC_OMEGA, vector(0, 0, 0),
        PSYS_SRC_TEXTURE, "",
        PSYS_SRC_TARGET_KEY, target,
    })
end

local function say(msg: string)
    ll.RegionSayTo(K(av), 0, msg)
end

-- Range (LuaSitter): "10", "20", "shout" (100 m, default), "region", or "prim"
-- (upstream: half the sender's X size). Kept in the sender's linkset data, so
-- it survives the reset after each run.
local RANGE_KEY = "LS-update-range"
local RANGES = { "10", "20", "shout", "region", "prim" }
local RANGE_BUTTONS = { "10 m", "20 m", "Shout 100 m", "Region", "Prim size" }

local function getRange(): string
    local r = ll.LinksetDataRead(RANGE_KEY)
    if table.find(RANGES, r) == nil then
        return "shout"
    end
    return r
end

local function radius(): number
    local r = getRange()
    if r == "10" then
        return 10
    elseif r == "20" then
        return 20
    elseif r == "shout" then
        return 100
    elseif r == "region" then
        return math.huge
    end
    return ll.GetScale().x / 2
end

local function rangeLabel(): string
    local r = getRange()
    if r == "prim" then
        return "prim size (" .. tostring(math.floor(radius() * 100 + 0.5) / 100) .. " m)"
    end
    return RANGE_BUTTONS[table.find(RANGES, r) :: number]
end

-- ask on the PIN channel far enough for the range (the receivers answer region-wide)
local function search(msg: string)
    local r = radius()
    if r <= 20 then
        ll.Say(pin, msg)
    elseif r <= 100 then
        ll.Shout(pin, msg)
    else
        ll.RegionSay(pin, msg)
    end
end

-- FIX: ask and wait for the answers. Upstream asked once and waited a fixed
-- 10 s, so furniture in a busy region often answered too late and was missed
-- ("Found 0 prims"). The question is asked again after 5 and 10 s while not
-- all answered (answers are counted once per prim), and the wait ends 3 s
-- after the last new answer (at least 8 s), when all `expected` prims
-- answered, or after 15 s.
local function collect(msgs: {string}, count: () -> number, expected: number, done: () -> ())
    local elapsed, last, lastChange = 0, 0, 0
    for _, msg in msgs do
        search(msg)
    end
    local function tick()
        elapsed += 1
        local n = count()
        if n ~= last then
            last = n
            lastChange = elapsed
        end
        local quiet = elapsed - lastChange
        if (expected > 0 and n >= expected and quiet >= 1)
            or (n > 0 and elapsed >= 8 and quiet >= 3)
            or elapsed >= 15 then
            done()
            return
        end
        if elapsed % 5 == 0 and (expected == 0 or n < expected) then
            if n == 0 then
                say("No answer yet, asking again...")
            end
            for _, msg in msgs do
                search(msg)
            end
        end
        LLTimers:once(1, tick)
    end
    LLTimers:once(1, tick)
end

-- is the answering prim inside the range?
local function inRadius(id: uuid): boolean
    local p = ll.GetObjectDetails(id, { OBJECT_POS })[1]
    if typeof(p) ~= "vector" then
        return false -- gone (upstream: ZERO_VECTOR, i.e. out of range)
    end
    return vector.magnitude(ll.GetPos() - (p :: vector)) <= radius()
end

local function finish(text: string)
    say(text)
    ll.ResetScript()
end

-- say "<title><names>" in lines that fit in chat
local function sayList(title: string, names: {string})
    local line = title
    for i, n in names do
        local piece = (if i > 1 then ", " else "") .. n
        if #line + #piece > 900 then
            say(line)
            line = "    ..." .. n
        else
            line ..= piece
        end
    end
    say(line)
end

local menuChannel = 0
local menuHandle = 0
local menuTimer: any = nil

local function closeMenu()
    if menuHandle ~= 0 then
        ll.ListenRemove(menuHandle)
        menuHandle = 0
    end
    if menuTimer then
        LLTimers:off(menuTimer)
        menuTimer = nil
    end
end

local function openMenu(text: string, buttons: {string}, onTimeout: () -> ())
    closeMenu()
    menuChannel = -(math.floor(ll.Frand(2147483520)) + 1)
    menuHandle = ll.Listen(menuChannel, "", K(av), "")
    menuTimer = LLTimers:once(120, function()
        menuTimer = nil
        closeMenu()
        onTimeout()
    end)
    ll.Dialog(K(av), text, buttons, menuChannel)
end

--------------------------------------------------------------------------
-- After a run (LuaSitter): remove the receivers?
--------------------------------------------------------------------------
type Prim = { id: string, label: string }
local removePrims: {Prim} = {}
local removedIds: {[string]: boolean} = {}

-- after a run: ask whether to remove the receivers from the prims of the run
local function askRemove(done: string, prims: {Prim})
    if #prims == 0 then
        finish(done)
        return
    end
    say(done)
    removePrims = prims
    mode = "remove-confirm"
    openMenu("\n" .. done .. "\n\nRemove the update receiver from the " .. tostring(#prims) .. " prim(s)?"
        .. "\nKEEP it to update them again later (it removes itself when the furniture is sold).",
        { "REMOVE", "KEEP" }, function()
            finish("Update receivers kept.")
        end)
end

-- REMOVE: the LuaSitter receivers answer RECEIVER_REMOVED and delete themselves
local function removeReceivers()
    mode = "remove"
    removedIds = {}
    local msg = "RECEIVER_REMOVE"
    for _, p in removePrims do
        if #msg + #p.id + 1 > 1000 then
            ll.RegionSay(pin, msg)
            msg = "RECEIVER_REMOVE"
        end
        msg ..= "|" .. p.id
    end
    ll.RegionSay(pin, msg)
    LLTimers:once(5, function()
        local count = 0
        local left: {string} = {}
        for _, p in removePrims do
            if removedIds[p.id] then
                count += 1
            else
                table.insert(left, p.label)
            end
        end
        say("Removed " .. tostring(count) .. " update receiver(s).")
        if #left > 0 then
            -- an LSL receiver cannot remove itself
            sayList("Still have an update receiver (remove it by hand): ", left)
        end
        finish("Done.")
    end)
end
-- update one target prim (upstream do_update timer body)
local function process(t: Target)
    local object = K(t.id)
    local items = ll.ParseStringKeepNulls(t.files, { "|" }, {})
    local scripts_to_update: {string} = {}
    local other_to_update: {string} = {}
    local surplus_to_update: {string} = {}
    for j = 1, #items, 2 do
        local item = items[j]
        local item_key = L(items, j + 1)
        if item_key ~= tostring(ll.GetInventoryKey(item)) or item_key == NULL then
            if ll.GetInventoryType(item) == INVENTORY_SCRIPT then
                table.insert(scripts_to_update, item)
            else
                table.insert(other_to_update, item)
            end
        elseif ll.GetInventoryType(item) == INVENTORY_OBJECT then
            table.insert(surplus_to_update, item)
        end
    end
    if #scripts_to_update == 0 and #other_to_update == 0 then
        return
    end
    particles_on(object)
    if #other_to_update > 0 and table.find(scripts_to_update, receiver_script) == nil then
        table.insert(scripts_to_update, receiver_script)
    end
    if table.find(scripts_to_update, receiver_script) ~= nil then
        -- the receiver deletes all objects when loaded with start param -1: resend them
        for _, s in surplus_to_update do
            table.insert(other_to_update, s)
        end
    end
    local objectName = ll.Key2Name(object)
    for _, script in scripts_to_update do
        say("Sending: " .. script .. " to " .. objectName)
        local running = true
        if ll.SubStringIndex(objectName, "[BOX]") ~= nil and script ~= receiver_script then
            running = false -- set scripts not running if the target name contains [BOX]
        end
        local remove_objects = -1
        ll.RemoteLoadScriptPin(object, script, pin, running, remove_objects)
    end
    for _, other in other_to_update do
        say("Sending: " .. other .. " to " .. objectName)
        ll.GiveInventory(object, other)
    end
end

local function runUpdate()
    mode = "update"
    local i = 1
    local function tick()
        say("Processing prim " .. tostring(i) .. "/" .. tostring(#targets))
        process(targets[i])
        i += 1
        if i > #targets then
            local prims: {Prim} = {}
            for _, t in targets do
                table.insert(prims, { id = t.id, label = ll.Key2Name(K(t.id)) })
            end
            askRemove("Updates complete!", prims)
            return
        end
        LLTimers:once(0.1, tick)
    end
    LLTimers:once(0.1, tick)
end

local function doUpdate()
    say("Found " .. tostring(#targets) .. " prims...")
    if #targets == 0 then
        -- FIX: upstream never finished when nothing answered
        finish("Updates complete!")
        return
    end
    if getRange() ~= "region" then
        runUpdate()
        return
    end
    -- Region range (LuaSitter): name the objects and ask first
    local names: {string} = {}
    for _, t in targets do
        local name = ll.Key2Name(K(t.id))
        if table.find(names, name) == nil then
            table.insert(names, name)
        end
    end
    say("In the region:")
    for _, name in names do
        say("  " .. name)
    end
    mode = "update-confirm"
    openMenu("\nUpdate " .. tostring(#targets) .. " prim(s) in the whole region, as listed in chat?",
        { "UPDATE", "CANCEL" }, function()
            finish("Update cancelled (no answer).")
        end)
end

local function startUpdate()
    mode = "update-collect"
    targets = {}
    local items: {string} = {}
    local me = ll.GetScriptName()
    for i = 1, ll.GetInventoryNumber(INVENTORY_ALL) do
        local name = ll.GetInventoryName(INVENTORY_ALL, i)
        if name ~= me then
            table.insert(items, name)
        end
    end
    say("listening... (range: " .. rangeLabel() .. ")")
    collect({ "OBJECT_SEARCH|" .. table.concat(items, "|") }, function(): number
        return #targets
    end, 0, doUpdate)
end

--------------------------------------------------------------------------
-- Migrate (LuaSitter)
--------------------------------------------------------------------------
-- AVsitter script -> LuaSitter script ("" = merged into another one: only removed).
-- Keep in sync with LS-update-receiver (which only deletes / starts these names).
local AV_TO_LS: {[string]: string} = {
    ["[AV]sitA"] = "[LS]sit", ["[AV]sitB"] = "",
    ["[AV]adjuster"] = "[LS]adjuster", ["[AV]select"] = "[LS]select",
    ["[AV]root"] = "[LS]root", ["[AV]root-security"] = "[LS]root-security",
    ["[AV]prop"] = "[LS]plugins", ["[AV]sequence"] = "[LS]plugins", ["[AV]favs"] = "[LS]plugins",
    ["[AV]menu"] = "[LS]menu", ["[AV]object"] = "[LS]object",
    ["[AV]faces"] = "[LS]faces-camera", ["[AV]camera"] = "[LS]faces-camera",
    ["[AV]root-RLV"] = "[LS]root-RLV", ["[AV]root-RLV-extra"] = "",
    ["[AV]root-control"] = "[LS]root-control",
    ["[AV]LockGuard"] = "[LS]LockGuard", ["[AV]LockGuard-object"] = "[LS]LockGuard-object",
    ["[AV]LockMeister"] = "[LS]LockMeister", ["[AV]Xcite!"] = "[LS]Xcite!",
    -- AVsitter1 -> LuaSitter1
    AVsit = "LSsit", AVselect = "LSselect", AVplus = "LSplus", AVadjuster = "LSadjuster", AVprop = "LSprop",
    Root = "LSroot", ["Root-Security"] = "LSroot-security", ["Sittarget-Add"] = "LSsittarget-add",
}

-- "[AV]sitA 2" -> "[AV]sitA", " 2" when it is an AVsitter script (or a copy of one)
local function avBase(name: string): (string?, string)
    if AV_TO_LS[name] ~= nil then
        return name, ""
    end
    local base, n = string.match(name, "^(.-) (%d+)$")
    if base and AV_TO_LS[base] ~= nil then
        return base, " " .. n
    end
    return nil, ""
end

local function isSitScript(name: string): boolean
    return string.match(name, "^%[LS%]sit") ~= nil or string.match(name, "^LSsit") ~= nil
end

type Found = { label: string, scripts: {string} }
type Plan = { id: string, label: string, remove: {string}, add: {string}, keep: {string}, missing: {string} }
local found: {[string]: Found} = {}
local lsFound: {[string]: boolean} = {}
local lsFoundCount = 0

-- prims found in step 1: by name (targets) or as a LuaSitter receiver (lsFound)
local function foundCount(): number
    local n = lsFoundCount
    for _, t in targets do
        if not lsFound[t.id] then
            n += 1
        end
    end
    return n
end
local foundOrder: {string} = {}
local plans: {Plan} = {}

local function makePlan(id: string, info: Found): Plan
    local plan: Plan = { id = id, label = info.label, remove = {}, add = {}, keep = {}, missing = {} }
    local adding: {[string]: boolean} = {}
    for _, s in info.scripts do
        local base, suffix = avBase(s)
        if base then
            table.insert(plan.remove, s)
            local target = AV_TO_LS[base]
            if target ~= "" and not adding[target .. suffix] then
                adding[target .. suffix] = true
                table.insert(plan.add, target .. suffix)
            end
        elseif s ~= receiver_script then
            table.insert(plan.keep, s)
        end
    end
    -- the sit scripts last, so the other scripts already run when they start
    table.sort(plan.add, function(a: string, b: string): boolean
        local sa, sb = isSitScript(a), isSitScript(b)
        if sa ~= sb then
            return sb
        end
        return a < b
    end)
    for _, s in plan.add do
        if ll.GetInventoryType(s) ~= INVENTORY_SCRIPT then
            table.insert(plan.missing, s)
        end
    end
    return plan
end

-- send "<cmd>|<prim key>|name|name..." in messages that fit in chat
local function sendList(cmd: string, id: string, names: {string})
    local head = cmd .. "|" .. id
    local msg = head
    for _, n in names do
        if #msg + #n + 1 > 1000 then
            ll.RegionSay(pin, msg)
            msg = head
        end
        msg ..= "|" .. n
    end
    if msg ~= head then
        ll.RegionSay(pin, msg)
    end
end

-- step 3: load the new scripts (not running), then let the receiver swap them in
local waiting: {id: string, timer: any, next: () -> ()}? = nil

local function migrateApply()
    mode = "migrate-apply"
    local p = 0
    local nextPlan: () -> ()
    nextPlan = function()
        p += 1
        local plan = plans[p]
        if plan == nil then
            local prims: {Prim} = {}
            for _, id in foundOrder do
                table.insert(prims, { id = id, label = found[id].label })
            end
            askRemove("Migration complete! Sit and test every sitter, pose and prop.", prims)
            return
        end
        local object = K(plan.id)
        particles_on(object)
        say("Migrating " .. plan.label .. " (" .. tostring(p) .. "/" .. tostring(#plans) .. ")")
        local i = 0
        local function loadNext()
            i += 1
            local script = plan.add[i]
            if script == nil then
                -- every script sent: the receiver deletes the old ones and starts the new ones
                local start = plan.add
                if ll.SubStringIndex(plan.label, "[BOX]") ~= nil then
                    start = {} -- as Update: scripts not running in a [BOX]
                end
                sendList("MIGRATE_REMOVE", plan.id, plan.remove)
                sendList("MIGRATE_START", plan.id, start)
                waiting = {
                    id = plan.id,
                    next = nextPlan,
                    timer = LLTimers:once(15, function()
                        waiting = nil
                        say("  no answer from " .. plan.label .. ": nothing was removed there.")
                        nextPlan()
                    end),
                }
                ll.RegionSay(pin, "MIGRATE_GO|" .. plan.id)
                return
            end
            say("Sending: " .. script .. " to " .. plan.label)
            ll.RemoteLoadScriptPin(object, script, pin, false, 0) -- not running yet; keep the objects
            LLTimers:once(0.1, loadNext)
        end
        loadNext()
    end
    nextPlan()
end

-- step 2: ask the receivers for their scripts, then say the plan
local function migratePlan()
    plans = {}
    if #foundOrder == 0 then
        finish("Found 0 prims with a LuaSitter receiver. Nothing to migrate.")
        return
    end
    for _, id in foundOrder do
        local plan = makePlan(id, found[id])
        if #plan.remove == 0 then
            say(plan.label .. ": no AVsitter scripts.")
        else
            say(plan.label .. ":")
            sayList("  remove: ", plan.remove)
            sayList("  add: ", plan.add)
            if #plan.keep > 0 then
                sayList("  keep: ", plan.keep)
            end
            if #plan.missing > 0 then
                sayList("  CANNOT migrate, this sender has no: ", plan.missing)
            else
                table.insert(plans, plan)
            end
        end
    end
    if #plans == 0 then
        finish("Nothing to migrate.")
        return
    end
    mode = "migrate-confirm"
    openMenu("\nMigrate " .. tostring(#plans) .. " prim(s) to LuaSitter as listed in chat?"
        .. "\n\nThe AVsitter scripts are deleted: take a copy of the furniture first.",
        { "APPLY", "CANCEL" }, function()
            finish("Migration cancelled (no answer).")
        end)
end

local function migrateList()
    mode = "migrate-list"
    found = {}
    foundOrder = {}
    collect({ "MIGRATE_SEARCH" }, function(): number
        return #foundOrder
    end, #targets, migratePlan)
end

-- step 1: find the receivers, and put the LuaSitter receiver where another one is
local function migratePush()
    mode = "migrate-push"
    say("Found " .. tostring(foundCount()) .. " prims with an update receiver...")
    local mine = tostring(ll.GetInventoryKey(receiver_script))
    local have = ll.GetInventoryType(receiver_script) == INVENTORY_SCRIPT
    local push: {Target} = {}
    for _, t in targets do
        local theirs = L(ll.ParseStringKeepNulls(t.files, { "|" }, {}), 2)
        if lsFound[t.id] and not have then
            -- it already has a LuaSitter receiver (perhaps under another name): it can migrate
        elseif not have or theirs ~= mine or theirs == NULL then
            table.insert(push, t)
        end
    end
    if #push > 0 and not have then
        finish("Put the LuaSitter \"" .. receiver_script .. "\" (LS-update-receiver) in this sender to migrate.")
        return
    end
    local i = 0
    local function pushNext()
        i += 1
        local t = push[i]
        if t == nil then
            LLTimers:once(3, migrateList) -- let the new receivers start
            return
        end
        say("Sending: " .. receiver_script .. " to " .. ll.Key2Name(K(t.id)))
        ll.RemoteLoadScriptPin(K(t.id), receiver_script, pin, true, 0) -- 0: keep the objects (props)
        LLTimers:once(0.1, pushNext)
    end
    pushNext()
end

local function startMigrate()
    mode = "migrate-find"
    targets = {}
    say("Migration: looking for furniture... (range: " .. rangeLabel() .. ")")
    lsFound = {}
    lsFoundCount = 0
    -- OBJECT_SEARCH finds receivers named receiver_script (LSL or LuaSitter); MIGRATE_SEARCH
    -- also finds LuaSitter receivers under another name (e.g. "LS-update-receiver")
    collect({ "OBJECT_SEARCH|" .. receiver_script, "MIGRATE_SEARCH" }, foundCount, 0, migratePush)
end

--------------------------------------------------------------------------
-- Menus
--------------------------------------------------------------------------
local function mainMenu()
    mode = "choose"
    openMenu("\nUpdate: send newer scripts and items to the furniture around."
        .. "\nMigrate: replace the AVsitter scripts of the furniture around with LuaSitter scripts (shows the plan first)."
        .. "\nRange: how far to look. Now: " .. rangeLabel() .. ".",
        { "Update", "Migrate", "Range", "Cancel" }, function()
            mode = "idle"
        end)
end

local function rangeMenu()
    mode = "range"
    openMenu("\nLook for furniture how far from this sender? Now: " .. rangeLabel() .. "."
        .. "\nOnly your own furniture with an update receiver answers."
        .. "\nRegion asks before updating.",
        RANGE_BUTTONS, function()
            mode = "idle"
        end)
end

--------------------------------------------------------------------------
-- Events
--------------------------------------------------------------------------
LLEvents:on("touch_start", function(events: {DetectedEvent})
    if mode ~= "idle" and mode ~= "choose" then
        return
    end
    local toucher = events[1]:getKey()
    if toucher == ll.GetOwner() or ll.SameGroup(toucher) then
        av = tostring(toucher)
        mainMenu()
    end
end)

LLEvents:on("listen", function(chan: number, _name: string, id: uuid, msg: string)
    if chan == menuChannel and menuHandle ~= 0 then
        closeMenu()
        if mode == "choose" then
            if msg == "Update" then
                startUpdate()
            elseif msg == "Migrate" then
                startMigrate()
            elseif msg == "Range" then
                rangeMenu()
            else
                mode = "idle"
            end
        elseif mode == "range" then
            local i = table.find(RANGE_BUTTONS, msg)
            if i then
                ll.LinksetDataWrite(RANGE_KEY, RANGES[i])
            end
            mainMenu()
        elseif mode == "remove-confirm" then
            if msg == "REMOVE" then
                removeReceivers()
            else
                finish("Update receivers kept.")
            end
        elseif mode == "update-confirm" then
            if msg == "UPDATE" then
                runUpdate()
            else
                finish("Update cancelled. Nothing was changed.")
            end
        elseif mode == "migrate-confirm" then
            if msg == "APPLY" then
                migrateApply()
            else
                finish("Migration cancelled. Nothing was changed (receivers may have been added).")
            end
        end
        return
    end
    if chan ~= pin or ll.GetOwnerKey(id) ~= ll.GetOwner() then
        return
    end
    local data = ll.ParseStringKeepNulls(msg, { "|" }, {})
    local cmd = data[1]
    if cmd == "OBJECT_HERE" and (mode == "update-collect" or mode == "migrate-find") then
        if inRadius(id) then
            -- once per prim (the sender may ask again)
            local known = false
            for _, t in targets do
                if t.id == tostring(id) then
                    known = true
                end
            end
            if not known then
                table.insert(targets, { id = tostring(id), files = table.concat(data, "|", 2) })
            end
        end
    elseif cmd == "RECEIVER_REMOVED" and mode == "remove" then
        if L(data, 2) == tostring(id) then
            removedIds[tostring(id)] = true
        end
    elseif cmd == "MIGRATE_HERE" and mode == "migrate-find" then
        -- a LuaSitter receiver, whatever its name (step 1)
        local key = L(data, 2)
        if key == tostring(id) and not lsFound[key] and inRadius(id) then
            lsFound[key] = true
            lsFoundCount += 1
        end
    elseif cmd == "MIGRATE_HERE" and mode == "migrate-list" then
        -- MIGRATE_HERE|<prim key>|<label>|script|script... (long lists come in several messages)
        local key = L(data, 2)
        if key == tostring(id) and inRadius(id) then
            local f = found[key]
            if f == nil then
                f = { label = L(data, 3), scripts = {} }
                found[key] = f
                table.insert(foundOrder, key)
            end
            for i = 4, #data do
                if data[i] ~= "" and table.find(f.scripts, data[i]) == nil then -- once (the sender may ask again)
                    table.insert(f.scripts, data[i])
                end
            end
        end
    elseif cmd == "MIGRATE_DONE" and mode == "migrate-apply" and waiting and L(data, 2) == waiting.id then
        -- MIGRATE_DONE|<prim key>|ok|<removed>|<started>  or  MIGRATE_DONE|<prim key>|missing|names...
        local w = waiting
        waiting = nil
        LLTimers:off(w.timer)
        if L(data, 3) == "ok" then
            say("  done: removed " .. L(data, 4) .. ", started " .. L(data, 5) .. ".")
        else
            local missing = {}
            for i = 4, #data do
                table.insert(missing, data[i])
            end
            sayList("  NOT migrated, these scripts did not arrive (nothing was removed): ", missing)
        end
        w.next()
    end
end)

LLEvents:on("on_rez", function(_x: number)
    if mode == "idle" or mode == "choose" then
        ll.ResetScript()
    end
end)

ll.ParticleSystem({})
ll.Listen(pin, "", NULL_KEY, "")
