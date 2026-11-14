--[[
  LS-update-receiver - lets an update sender push new scripts/items into this prim
  LuaSitter: SLua port of AVsitter(TM) update-receiver. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  Simple script used for updating a large number of furniture items at once.
  This script goes in each furniture prim that expects an update from the
  sender. It sets the remote script access PIN and answers the sender's
  OBJECT_SEARCH with the names and keys of the matching inventory items.
  It auto-deletes if the furniture is rezzed with a start parameter, or
  changes owner to a non-admin avatar.

  Name it "update receiver (auto removing)" in inventory (same name as
  upstream): the chat protocol (channel -29752) and the PIN are identical to
  upstream, so LSL and LuaSitter senders/receivers interoperate.

  Behaviour change: the object name is only shown as hover text (a shop
  label) when show_name is set to true below; upstream always showed it in
  the root prim of items without an object attachment script. That check
  accepts "[LS]object" as well as "[AV]object".
  FIX: when the receiver deletes itself it clears that label (if the hover
  text is still the object name); upstream left it on the prim.

  LuaSitter: when it starts under another name (e.g. "LS-update-receiver", the
  file name), it tells the owner to rename it.

  LuaSitter: RECEIVER_REMOVE|<prim key>... (the sender's REMOVE after an
  update or migration): the listed receivers answer RECEIVER_REMOVED|<key>,
  clear the label and delete themselves.

  LuaSitter: migration (the sender's Migrate mode). The receiver answers
  MIGRATE_SEARCH with the scripts of its prim. On MIGRATE_GO it deletes the
  AVsitter scripts the sender listed and starts the LuaSitter scripts the
  sender loaded (not running), only if all of those arrived. It only deletes
  known AVsitter script names and only starts known LuaSitter ones; it never
  deletes notecards, objects or other scripts.
]]

local pin = -29752

-- Enter the list of allowed avatar UUIDs here.
local admin_avatars = { "d0a3c64c-4650-4562-925a-d33821815da4" }

local function isAdmin(): boolean
    return table.find(admin_avatars, tostring(ll.GetOwner())) ~= nil
end

-- Show the object name as hover text (a label for furniture on display in a
-- shop). Upstream always did; set to true to get it back.
local show_name = false

-- FIX: upstream left its name label on the prim after deleting itself (hover
-- text is a prim property), so sold copies kept it. Clear it, but only if it is
-- still the label this script sets (a creator's own hover text is kept).
local function removeSelf()
    if ll.GetPrimitiveParams({ PRIM_TEXT })[1] == ll.GetObjectName() then
        ll.SetText("", vector(0, 0, 0), 0)
    end
    ll.SetRemoteScriptAccessPin(0)
    ll.RemoveInventory(ll.GetScriptName())
end

local function tick()
    if show_name and (ll.GetLinkNumber() == 0 or ll.GetLinkNumber() == 1)
        and ll.GetInventoryType("[AV]object") ~= INVENTORY_SCRIPT
        and ll.GetInventoryType("[LS]object") ~= INVENTORY_SCRIPT then
        if ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) == ZERO_VECTOR then
            ll.SetText(ll.GetObjectName(), vector(1, 1, 0), 1)
        end
    end
end

LLEvents:on("on_rez", function(start: number)
    if start ~= 0 then
        if isAdmin() then
            ll.RegionSayTo(ll.GetOwner(), 0, "Removing :" .. ll.GetScriptName())
        end
        removeSelf()
    end
end)

--------------------------------------------------------------------------
-- Migration (LuaSitter)
--------------------------------------------------------------------------
-- AVsitter scripts the migration may delete -> their LuaSitter replacement
-- ("" = merged). Keep in sync with LS-update-sender.
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
    AVsit = "LSsit", AVselect = "LSselect", AVplus = "LSplus", AVadjuster = "LSadjuster", AVprop = "LSprop",
    Root = "LSroot", ["Root-Security"] = "LSroot-security", ["Sittarget-Add"] = "LSsittarget-add",
}
-- LuaSitter scripts the migration may start
local LS_NAMES: {[string]: boolean} = {}
for _, ls in AV_TO_LS do
    if ls ~= "" then
        LS_NAMES[ls] = true
    end
end

-- name, or name without its copy number, is in the set
local function known(name: string, set: {[string]: any}): boolean
    if set[name] ~= nil then
        return true
    end
    local base = string.match(name, "^(.-) %d+$")
    return base ~= nil and set[base] ~= nil
end

local pending_remove: {string} = {}
local pending_start: {string} = {}

-- say "<head>|name|name..." in messages that fit in chat (at least one message)
local function sayList(head: string, names: {string})
    local msg = head
    local sent = false
    for _, n in names do
        if #msg + #n + 1 > 1000 then
            ll.RegionSay(pin, msg)
            sent = true
            msg = head
        end
        msg ..= "|" .. n
    end
    if msg ~= head or not sent then
        ll.RegionSay(pin, msg)
    end
end

local function migrateSearch()
    local me = ll.GetScriptName()
    local scripts: {string} = {}
    for i = 1, ll.GetInventoryNumber(INVENTORY_SCRIPT) do
        local name = ll.GetInventoryName(INVENTORY_SCRIPT, i)
        if name ~= me then
            table.insert(scripts, name)
        end
    end
    local label = ll.GetObjectName() .. " (link " .. tostring(ll.GetLinkNumber()) .. ")"
    sayList("MIGRATE_HERE|" .. tostring(ll.GetKey()) .. "|" .. label, scripts)
end

local function migrateGo()
    local me = tostring(ll.GetKey())
    local missing: {string} = {}
    for _, s in pending_start do
        if ll.GetInventoryType(s) ~= INVENTORY_SCRIPT then
            table.insert(missing, s)
        end
    end
    if #missing > 0 then
        -- a new script did not arrive: keep the old ones
        sayList("MIGRATE_DONE|" .. me .. "|missing", missing)
    else
        local removed, started = 0, 0
        local myName = ll.GetScriptName()
        for _, s in pending_remove do
            if s ~= myName and known(s, AV_TO_LS) and ll.GetInventoryType(s) == INVENTORY_SCRIPT then
                ll.RemoveInventory(s)
                removed += 1
            end
        end
        for _, s in pending_start do
            if known(s, LS_NAMES) then
                ll.SetScriptState(s, true)
                started += 1
            end
        end
        ll.RegionSay(pin, "MIGRATE_DONE|" .. me .. "|ok|" .. tostring(removed) .. "|" .. tostring(started))
    end
    pending_remove = {}
    pending_start = {}
end

LLEvents:on("listen", function(_chan: number, _name: string, id: uuid, msg: string)
    if ll.GetOwnerKey(id) ~= ll.GetOwner() then
        return
    end
    local data = ll.ParseStringKeepNulls(msg, { "|" }, {})
    local cmd = data[1]
    if cmd == "MIGRATE_SEARCH" then
        migrateSearch()
        return
    elseif cmd == "RECEIVER_REMOVE" then
        -- RECEIVER_REMOVE|<prim key>|<prim key>... (the sender's REMOVE after a run)
        local me = tostring(ll.GetKey())
        if table.find(data, me, 2) then
            ll.RegionSay(pin, "RECEIVER_REMOVED|" .. me)
            removeSelf()
        end
        return
    elseif cmd == "MIGRATE_REMOVE" or cmd == "MIGRATE_START" or cmd == "MIGRATE_GO" then
        if data[2] ~= tostring(ll.GetKey()) then
            return -- for another prim
        end
        if cmd == "MIGRATE_GO" then
            migrateGo()
        else
            local list = if cmd == "MIGRATE_REMOVE" then pending_remove else pending_start
            for i = 3, #data do
                if data[i] ~= "" then
                    table.insert(list, data[i])
                end
            end
        end
        return
    end
    if cmd == "OBJECT_SEARCH" then
        local reply: {string} = {}
        for i = 2, #data do
            local item = data[i]
            if ll.GetInventoryType(item) ~= INVENTORY_NONE then
                table.insert(reply, item)
                table.insert(reply, tostring(ll.GetInventoryKey(item)))
            end
        end
        if #reply > 0 then
            ll.RegionSay(pin, "OBJECT_HERE|" .. table.concat(reply, "|"))
        end
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_OWNER) ~= 0 and not isAdmin() then
        removeSelf()
    end
end)

-- start: loaded by the sender with start parameter -1 => drop all objects
-- (the sender resends the ones still needed)
if ll.GetStartParameter() == -1 then
    while ll.GetInventoryNumber(INVENTORY_OBJECT) > 0 do
        local item = ll.GetInventoryName(INVENTORY_OBJECT, ll.GetInventoryNumber(INVENTORY_OBJECT))
        ll.RegionSayTo(ll.GetOwner(), 0, "Removing :" .. item)
        ll.RemoveInventory(item)
    end
end
-- Update senders (LSL and LuaSitter) find the receiver by its name. Migrate finds it under
-- any name, but Update does not, and would add a second receiver: say so.
local RECEIVER_NAME = "update receiver (auto removing)"
if ll.GetScriptName() ~= RECEIVER_NAME then
    print("NOTICE: rename this script to \"" .. RECEIVER_NAME .. "\" (now \"" .. ll.GetScriptName()
        .. "\"). Update senders look for that name.")
end
ll.SetRemoteScriptAccessPin(pin)
ll.Listen(pin, "", NULL_KEY, "")
LLTimers:once(0.1, function()
    tick()
    LLTimers:every(10, tick)
end)
