--[[
  LS-setup-checker - diagnostics for a LuaSitter / AVsitter setup
  LuaSitter: SLua port of AVsitter(TM) Anim-perm-checker, Missing-anim-finder and Noob-detector. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  Merges three AVsitter2 utilities into one script, dropped temporarily into the
  prim holding the sitter scripts:
    PERMS  : Anim-perm-checker   (NEXT_OWNER permissions of the animations)
    ANIMS  : Missing-anim-finder (anims missing from inventory / unused anims,
             offers to delete the unused ones)
    REPORT : Noob-detector       (setup report said in chat, to copy and share;
             upstream posted it to a web service)
  On start the owner gets a dialog: ALL runs the three checks in sequence
  (PERMS, ANIMS, REPORT), or pick a single one. Touch (owner) shows the dialog
  again while the script is still in the prim. Each check keeps its original
  chat wording. The script removes itself when done, as the originals did
  (PERMS/ANIMS keep the "except from a Utilities box" rule, REPORT always
  removes itself like Noob-detector).

  Behaviour changes:
  - Reads "LSpos" when present, else "AVpos" (same format).
  - ANIMS also reads the per-sitter notecards "LSpos sitter 1"... (upstream
    PR #151 / issue #13) so anims only used there are not reported as unused.
  - REPORT recognises both LuaSitter ([LS]...) and AVsitter ([AV]...) script
    names, and adds a "----SETUP----" section (also said in chat) telling
    whether the setup is LuaSitter, AVsitter or a MIXED one. Merged LuaSitter
    scripts ([AV]sitB, [AV]root-RLV-extra) are never reported as missing.
  - Notecards are read with the fast reader (GetNotecardLineSync).
]]

local VERSION = "3.0-lua1"
local SCRIPT = ll.GetScriptName()

--------------------------------------------------------------------------
-- helpers
--------------------------------------------------------------------------

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

local function randomChannel(): number
    return -(math.floor(ll.Frand(2147483520)) + 1)
end

-- LSL llSubStringIndex: 0-based, -1 when missing
local function idx0(s: string, p: string): number
    local i = ll.SubStringIndex(s, p)
    return if i then i - 1 else -1
end

-- LSL llGetSubString with LSL (0-based / negative) indices
local function sub0(s: string, a: number, b: number): string
    return ll.GetSubString(s, if a >= 0 then a + 1 else a, if b >= 0 then b + 1 else b)
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

local function Owner_Say(say: string)
    print(SCRIPT .. ": " .. say)
end

local function inUtilitiesBox(): boolean
    return ll.SubStringIndex(ll.GetObjectName(), "Utilities") ~= nil
end

local function permLetters(perms: number): string
    local t = {}
    if bit32.band(perms, PERM_COPY) ~= 0 then
        table.insert(t, "C")
    end
    if bit32.band(perms, PERM_MODIFY) ~= 0 then
        table.insert(t, "M")
    end
    if bit32.band(perms, PERM_TRANSFER) ~= 0 then
        table.insert(t, "T")
    end
    return table.concat(t, "/")
end

--------------------------------------------------------------------------
-- run queue
--------------------------------------------------------------------------
local queue: {string} = {}
local running = false
local runNext: () -> ()

-- the step being run is the last one: originals removed themselves here
local function isLastStep(): boolean
    return #queue == 0
end

local function allDone()
    running = false
    if not inUtilitiesBox() then -- remove it except from Utilities box
        ll.RemoveInventory(SCRIPT)
    end
end

--------------------------------------------------------------------------
-- PERMS : Anim-perm-checker
--------------------------------------------------------------------------
local function checkPerms()
    local copy_trans_count = 0
    local copy_count = 0
    local trans_count = 0
    Owner_Say(" ")
    Owner_Say("================================")
    local total = ll.GetInventoryNumber(INVENTORY_ANIMATION)
    Owner_Say("Checking NEXT_OWNER permissions of ANIMATIONS.")
    for i = 1, total do
        local item = ll.GetInventoryName(INVENTORY_ANIMATION, i)
        local perms = ll.GetInventoryPermMask(item, MASK_NEXT)
        if bit32.band(perms, PERM_COPY) ~= 0 then
            if bit32.band(perms, PERM_TRANSFER) ~= 0 then
                Owner_Say(item .. " is COPY-TRANSFER!")
                copy_trans_count += 1
            else
                copy_count += 1
            end
        elseif bit32.band(perms, PERM_TRANSFER) ~= 0 then
            trans_count += 1
        end
    end
    Owner_Say(tostring(total) .. " anims total")
    Owner_Say(tostring(trans_count) .. " anims are TRANSFER")
    Owner_Say(tostring(copy_count) .. " anims are COPY.")
    Owner_Say(tostring(copy_trans_count) .. " anims are COPY-TRANSFER!")
    Owner_Say(if isLastStep() then "Check complete, removing script." else "Check complete.")
    Owner_Say("================================")
    Owner_Say(" ")
end

--------------------------------------------------------------------------
-- ANIMS : Missing-anim-finder
--------------------------------------------------------------------------
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
local NOTECARD_BASENAME = posCard()
local ANIM_DIALOG_CHANNEL = -268534

local function checkAnims(onDone: () -> ())
    local last = isLastStep()
    if ll.GetInventoryType(NOTECARD_BASENAME) ~= INVENTORY_NOTECARD then
        if last then
            Owner_Say(NOTECARD_BASENAME .. " notecard not found. Removing '" .. SCRIPT .. "' from inventory.")
        else
            Owner_Say(NOTECARD_BASENAME .. " notecard not found.")
        end
        onDone()
        return
    end
    Owner_Say(" ")
    Owner_Say("================================")
    Owner_Say("Checking for missing or unused anims.")

    -- anim name -> true when used in a variable-speed submenu (anywhere)
    local used: {[string]: boolean} = {}
    local not_found_count = 0
    local is_variable_speed_submenu = false

    -- the main notecard, then per-sitter "LSpos sitter N" notecards (PR #151)
    local cards = { NOTECARD_BASENAME }
    local seen: {[string]: boolean} = { [NOTECARD_BASENAME] = true }
    for i = 1, ll.GetInventoryNumber(INVENTORY_NOTECARD) do
        local n = ll.GetInventoryName(INVENTORY_NOTECARD, i)
        -- the cards [LS]sit reads: sitter 1 and up, no leading zero
        if string.match(n, "^LSpos sitter [1-9]%d*$") and not seen[n] then
            seen[n] = true
            table.insert(cards, n)
        end
    end

    local function finish()
        Owner_Say(if last then "Check complete, removing script." else "Check complete.")
        Owner_Say("================================")
        Owner_Say(" ")
        onDone()
    end

    local function onLine(data: string, _n: number)
        data = sub0(data, idx0(data, "◆") + 1, 99999)
        data = ll.StringTrim(data, STRING_TRIM)
        local sp = idx0(data, " ")
        local command = sub0(data, 0, sp - 1)
        local parts = ll.ParseString2List(sub0(data, sp + 1, 99999), { " | ", " |", "| ", "|" }, {})
        if command == "POSE" or command == "SYNC" then
            -- every other element after the pose name
            for i = 2, #parts, 2 do
                local anim = parts[i]
                if ll.GetInventoryType(anim) ~= INVENTORY_ANIMATION then
                    not_found_count += 1
                    Owner_Say("Animation '" .. anim .. "' not found in inventory!")
                end
                if is_variable_speed_submenu then
                    if ll.GetInventoryType(anim .. "+") ~= INVENTORY_ANIMATION then
                        Owner_Say("Variable-Speed Animation '" .. anim .. "+' not found in inventory!")
                    end
                    if ll.GetInventoryType(anim .. "-") ~= INVENTORY_ANIMATION then
                        Owner_Say("Variable-Speed Animation '" .. anim .. "-' not found in inventory!")
                    end
                end
                if used[anim] == nil then -- only add if the anim has not appeared before
                    used[anim] = is_variable_speed_submenu
                elseif is_variable_speed_submenu then
                    -- stays TRUE if ANY of the submenus the anim is used in is a Variable-Speed submenu
                    used[anim] = true
                end
            end
        elseif command == "MENU" or command == "SITTER" then
            is_variable_speed_submenu = (command == "MENU" and L(parts, -1) == "V")
        end
    end

    local function evaluate()
        if not_found_count == 0 then
            Owner_Say("All anims referenced in the notecard were accounted for.")
        else
            Owner_Say("Anims were used in the notecard but not found in inventory!")
        end
        local unused: {string} = {}
        for i = 1, ll.GetInventoryNumber(INVENTORY_ANIMATION) do
            local name = ll.GetInventoryName(INVENTORY_ANIMATION, i)
            local anim_basename = name
            local lastChar = ll.GetSubString(name, -1, -1)
            if lastChar == "+" or lastChar == "-" then
                local base = ll.GetSubString(name, 1, -2)
                -- only consider anims as variable-speed if their base name was used in a variable-speed submenu
                if used[base] == true then
                    anim_basename = base
                end
            end
            if used[anim_basename] == nil and name ~= "AVhipfix" and name ~= "LShipfix" then
                Owner_Say("Animation '" .. name .. "' found in inventory but not used in notecard!")
                table.insert(unused, name)
            end
        end
        if #unused == 0 then
            Owner_Say("No unused anims were found!")
            finish()
            return
        end
        local handle: number = 0
        local timeout: any = nil
        local listener: any = nil
        local function close()
            ll.ListenRemove(handle)
            if listener then
                LLEvents:off("listen", listener)
                listener = nil
            end
            if timeout then
                LLTimers:off(timeout)
                timeout = nil
            end
        end
        listener = LLEvents:on("listen", function(chan: number, _name: string, _id: uuid, msg: string)
            if chan ~= ANIM_DIALOG_CHANNEL then
                return
            end
            close()
            if msg == "YES" then
                for _, a in unused do
                    if ll.GetInventoryType(a) == INVENTORY_ANIMATION then
                        ll.RemoveInventory(a)
                        Owner_Say("Deleted unused anim: '" .. a .. "'")
                    end
                end
            end
            finish()
        end)
        timeout = LLTimers:once(60, function()
            timeout = nil
            close()
            Owner_Say("timeout")
            finish()
        end)
        handle = ll.Listen(ANIM_DIALOG_CHANNEL, "", ll.GetOwner(), "")
        ll.Dialog(ll.GetOwner(), "\n" .. tostring(#unused)
            .. " unused (surplus) anims were found. Do you want to delete them?\n\nMake sure you take a backup of your work first!",
            { "YES", "NO" }, ANIM_DIALOG_CHANNEL)
    end

    local function readCard(i: number)
        if i > #cards then
            evaluate()
            return
        end
        is_variable_speed_submenu = false
        readNotecard(cards[i], onLine, function(_total: number)
            readCard(i + 1)
        end)
    end
    readCard(1)
end

--------------------------------------------------------------------------
-- REPORT : Noob-detector
--------------------------------------------------------------------------
local disclaimer = "This script will inspect your object and say a report in chat (only you can see it) that you can copy and share with others.\n\nClick OK to proceed."
local start_message = "Preparing info, please wait..."
local end_message = "Inspection complete! Copy the report above from chat. Script removed."
local product = "LuaSitter setup checker"

-- the report is valid when one of these is in the prim
local allowed_products = { "LSpos", "AVpos", "[LS]menu", "[LS]object", "[AV]menu", "[AV]object" }

-- FIX: upstream listed an extra "ALL TYPES" heading without a matching type
-- (llList2Integer out of range = 0), so all textures were listed a second time.
local item_types = { "TEXTURE", "SOUND", "LANDMARK", "CLOTHING", "OBJECT", "NOTECARD", "SCRIPT", "BODYPART", "ANIMATION", "GESTURE" }
local item_ints = { INVENTORY_TEXTURE, INVENTORY_SOUND, INVENTORY_LANDMARK, INVENTORY_CLOTHING, INVENTORY_OBJECT,
    INVENTORY_NOTECARD, INVENTORY_SCRIPT, INVENTORY_BODYPART, INVENTORY_ANIMATION, INVENTORY_GESTURE }

-- core script names (copies "<name> N" count too)
local LS_NAMES = { "[LS]sit", "[LS]plugins", "[LS]adjuster", "[LS]helper", "[LS]faces-camera", "[LS]menu",
    "[LS]select", "[LS]root", "[LS]root-security", "[LS]root-RLV", "[LS]root-control", "[LS]object", "[LS]LockGuard",
    "[LS]LockMeister", "[LS]Xcite!", "[LS]commands" }
local AV_NAMES = { "[AV]sitA", "[AV]sitB", "[AV]prop", "[AV]adjuster", "[AV]helper", "[AV]faces", "[AV]camera",
    "[AV]menu", "[AV]select", "[AV]root", "[AV]root-security", "[AV]root-RLV", "[AV]root-RLV-extra", "[AV]root-control",
    "[AV]sequence", "[AV]favs", "[AV]object", "[AV]LockGuard", "[AV]LockMeister", "[AV]Xcite!" }

local function matchesCore(name: string, list: {string}): boolean
    for _, base in list do
        if name == base or (startsWith(name, base .. " ") and string.match(string.sub(name, #base + 2), "^%d+$")) then
            return true
        end
    end
    return false
end

-- returns report lines describing which family of scripts is present
local function setupLines(): {string}
    local ls, av = {}, {}
    for i = 1, ll.GetInventoryNumber(INVENTORY_ALL) do
        local name = ll.GetInventoryName(INVENTORY_ALL, i)
        if matchesCore(name, LS_NAMES) then
            table.insert(ls, name)
        elseif matchesCore(name, AV_NAMES) then
            table.insert(av, name)
        end
    end
    local kind
    if #ls > 0 and #av > 0 then
        kind = "MIXED LuaSitter and AVsitter scripts! Replace the [AV] scripts with their [LS] versions."
    elseif #ls > 0 then
        kind = "LuaSitter"
    elseif #av > 0 then
        kind = "AVsitter"
    else
        kind = "no LuaSitter/AVsitter scripts in this prim"
    end
    local lines = {
        "setup: " .. kind,
        "LuaSitter scripts (" .. tostring(#ls) .. "): " .. table.concat(ls, ", "),
        "AVsitter scripts (" .. tostring(#av) .. "): " .. table.concat(av, ", "),
        "pose notecard: " .. NOTECARD_BASENAME,
    }
    if ll.GetInventoryType("LSpos") == INVENTORY_NOTECARD and ll.GetInventoryType("AVpos") == INVENTORY_NOTECARD then
        table.insert(lines, "BOTH LSpos and AVpos notecards! LuaSitter reads LSpos only; remove the one you don't use.")
    end
    -- "LSpos 1", "AVpos 2"...: the names Second Life gives duplicate copies (for example
    -- after giving or updating a notecard that already exists). LuaSitter never reads them.
    for i = 1, ll.GetInventoryNumber(INVENTORY_NOTECARD) do
        local n = ll.GetInventoryName(INVENTORY_NOTECARD, i)
        if string.match(n, "^LSpos %d+$") or string.match(n, "^AVpos %d+$") then
            table.insert(lines, "DUPLICATE notecard \"" .. n .. "\" (a copy Second Life made?). It is not read; delete it. Per-sitter notecards are named \"LSpos sitter N\".")
        end
    end
    return lines
end

-- LuaSitter: the report is said to the owner in chat (no web service). Text is
-- buffered and sent in chunks below the 1024-byte chat limit.
local cache = ""

local function flush_out()
    if cache ~= "" then
        local objectname = ll.GetObjectName()
        ll.SetObjectName("")
        ll.RegionSayTo(ll.GetOwner(), 0, "\n" .. cache)
        ll.SetObjectName(objectname)
        cache = ""
    end
end

local function add_out(say: string, force: boolean)
    if not force then
        say ..= "\n"
    end
    if #cache + #say > 900 then
        flush_out()
    end
    -- a single over-long line is cut to the chat limit
    if #say > 1000 then
        say = string.sub(say, 1, 1000)
    end
    cache ..= say
    if force then
        flush_out()
    end
end

local function remove_script()
    print("Diagnostic script removed.")
    running = false
    ll.RemoveInventory(SCRIPT)
end

local function reportEnd()
    add_out("\nSummary created by the \"Noob-detector\" check of the LuaSitter setup checker (port of the AVsitter2 utilities box, https://avsitter.github.io/avsitter2_utilities.html)", false)
    add_out("\n\n----END----\n\nend", true)

    print(end_message)
    running = false
    ll.RemoveInventory(SCRIPT)
end

local function readNotecards(list: {string})
    local function readOne(i: number)
        if i > #list then
            reportEnd()
            return
        end
        -- (upstream labels only the first notecard with "(notecard)")
        if i == 1 then
            add_out("\n" .. list[i] .. " (notecard)\n-----------", false)
        else
            add_out("\n" .. list[i] .. "\n-----------", false)
        end
        readNotecard(list[i], function(body: string, _n: number)
            add_out(body, false)
        end, function(_total: number)
            readOne(i + 1)
        end)
    end
    readOne(1)
end

local function reportRun(menu_channel: number)
    cache = ""

    ll.Dialog(ll.GetOwner(), product .. " " .. VERSION .. "\n\n" .. start_message, { "OK" }, menu_channel)
    print(start_message)

    add_out("Share this info to get help with your LuaSitter/AVsitter build!\n", false)
    add_out("----START----", false)

    add_out("user: " .. ll.Key2Name(ll.GetOwner()) .. " (" .. tostring(ll.GetOwner()) .. ")", false)

    add_out("owner perms:[" .. permLetters(ll.GetObjectPermMask(MASK_OWNER)) .. "]", false)
    add_out("next perms:[" .. permLetters(ll.GetObjectPermMask(MASK_NEXT)) .. "]", false)

    -- Total prims
    local primCount = ll.GetObjectPrimCount(ll.GetKey())
    add_out("total prims: " .. tostring(primCount), false)

    -- Link number
    add_out("my link number: " .. tostring(ll.GetLinkNumber()), false)

    -- Script family (LuaSitter / AVsitter / mixed)
    add_out("\n----SETUP----", false)
    for _, line in setupLines() do
        add_out(line, false)
    end

    -- Read through all prims giving name and description
    add_out("\n----PRIMS----", false)
    add_out("Prim, Name, Desc", false)
    if primCount > 1 then
        for i = 1, primCount do
            add_out(tostring(i) .. ", " .. ll.DumpList2String(ll.GetLinkPrimitiveParams(i, { PRIM_NAME, PRIM_DESC }), ", "), false)
        end
    else
        add_out("0, " .. ll.DumpList2String(ll.GetLinkPrimitiveParams(0, { PRIM_NAME, PRIM_DESC }), ", "), false)
    end

    -- Inventory
    local notecards_to_read: {string} = {}
    for j = 1, #item_types do
        local itype = item_ints[j]
        local type_heading_sent = false
        local count = 0 -- numbering skips this script
        for i = 1, ll.GetInventoryNumber(itype) do
            if not type_heading_sent then
                add_out("\n----" .. item_types[j] .. "S----", false)
                type_heading_sent = true
            end
            local name = ll.GetInventoryName(itype, i)
            if name ~= SCRIPT then
                local perms = ll.GetInventoryPermMask(name, MASK_OWNER)
                if bit32.band(perms, PERM_COPY) ~= 0 then
                    if itype == INVENTORY_NOTECARD then
                        table.insert(notecards_to_read, name) -- read notecard!
                    end
                end
                local perms_owner = permLetters(perms)
                local perms_next = permLetters(ll.GetInventoryPermMask(name, MASK_NEXT))

                local warnings = ""
                if ll.SubStringIndex(name, "  ") ~= nil then
                    warnings ..= "~DOUBLE-SPACE IN NAME!~"
                end
                if itype == INVENTORY_SCRIPT and ll.GetScriptState(name) == false then
                    warnings ..= "~NOT RUNNING!~"
                end
                count += 1
                add_out(tostring(count) .. "." .. name .. " [" .. perms_owner .. "][" .. perms_next .. "]" .. warnings, false)
            end
        end
    end
    readNotecards(notecards_to_read)
end

local function checkReport()
    local found = false
    for _, p in allowed_products do
        if ll.GetInventoryType(p) ~= INVENTORY_NONE then
            found = true
            break
        end
    end
    if not found then
        print("Sorry, could not find correct product for this script.")
        remove_script()
        return
    end

    for _, line in setupLines() do
        Owner_Say(line)
    end

    local menu_channel = randomChannel()
    local handle = 0
    local listener: any = nil
    local timeout: any = nil
    local function close()
        ll.ListenRemove(handle)
        if listener then
            LLEvents:off("listen", listener)
            listener = nil
        end
        if timeout then
            LLTimers:off(timeout)
            timeout = nil
        end
    end
    timeout = LLTimers:once(120, function()
        timeout = nil
        close()
        remove_script()
    end)
    listener = LLEvents:on("listen", function(chan: number, _name: string, _id: uuid, message: string)
        if chan ~= menu_channel then
            return
        end
        close()
        if message == "OK" then
            reportRun(menu_channel)
        else
            remove_script()
        end
    end)
    handle = ll.Listen(menu_channel, "", ll.GetOwner(), "")
    ll.Dialog(ll.GetOwner(), product .. " " .. VERSION .. "\n\n" .. disclaimer, { "OK" }, menu_channel)
end

--------------------------------------------------------------------------
-- sequencing and chooser dialog
--------------------------------------------------------------------------
runNext = function()
    local step = table.remove(queue, 1)
    if step == nil then
        allDone()
    elseif step == "PERMS" then
        checkPerms()
        runNext()
    elseif step == "ANIMS" then
        checkAnims(runNext)
    elseif step == "REPORT" then
        checkReport() -- ends by removing the script, like Noob-detector
    end
end

local chooserChannel = randomChannel()
local chooserHandle = 0
local chooserTimeout: any = nil

local function closeChooser()
    if chooserHandle ~= 0 then
        ll.ListenRemove(chooserHandle)
        chooserHandle = 0
    end
    if chooserTimeout then
        LLTimers:off(chooserTimeout)
        chooserTimeout = nil
    end
end

local function showChooser()
    closeChooser()
    chooserHandle = ll.Listen(chooserChannel, "", ll.GetOwner(), "")
    chooserTimeout = LLTimers:once(120, function()
        chooserTimeout = nil
        closeChooser()
        if inUtilitiesBox() then
            Owner_Say("No check selected. Touch to show the menu again.")
        else
            Owner_Say("No check selected, removing script.")
            ll.RemoveInventory(SCRIPT)
        end
    end)
    ll.Dialog(ll.GetOwner(), product .. " " .. VERSION
        .. "\n\nALL: run every check below, in sequence."
        .. "\nPERMS: next-owner permissions of the animations."
        .. "\nANIMS: missing or unused animations (" .. NOTECARD_BASENAME .. ")."
        .. "\nREPORT: inspect your object and say a setup report in chat that you can share.",
        { "ALL", "PERMS", "ANIMS", "REPORT", "CANCEL" }, chooserChannel)
end

LLEvents:on("listen", function(chan: number, _name: string, _id: uuid, msg: string)
    if chan ~= chooserChannel or running then
        return
    end
    closeChooser()
    if msg == "ALL" then
        queue = { "PERMS", "ANIMS", "REPORT" }
    elseif msg == "PERMS" or msg == "ANIMS" or msg == "REPORT" then
        queue = { msg }
    else
        Owner_Say("Cancelled. Touch to show the menu again.")
        return
    end
    running = true
    runNext()
end)

LLEvents:on("touch_start", function(events: {DetectedEvent})
    if not running and events[1]:getKey() == ll.GetOwner() then
        showChooser()
    end
end)

showChooser()
